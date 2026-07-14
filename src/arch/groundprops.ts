/**
 * Ground charm between buildings (product feedback: "gardens, entryways,
 * stairs" — the small stuff Townscaper scatters on open ground). Empty land
 * cells adjacent to buildings become plazas: stepping-stone paths, the odd
 * lamp post, flower beds hugging walls, and picket fences where the plaza
 * meets open grass. Everything else gets sparse grass tufts.
 *
 * Determinism law: every roll comes from rng(grid.seed, 'ground', cellId, …)
 * and geometry reads ONLY the 1-ring (this cell + edge neighbors' fill /
 * terrain), so the mesher's existing 1-ring dirty expansion keeps chunks
 * correct. groundPropsSignature() encodes exactly those dynamic inputs so
 * the mesher can diff prop output across edits the way it diffs recipes.
 */

import * as THREE from 'three';
import { LAND_TOP } from '../core/constants';
import { rng, type Rng } from '../core/rng';
import type { Town } from '../town/town';
import type { GeoSink, P3 } from './geom';

// props.ts keeps ring/tube/disc/cone private; re-declared here (do-not-edit
// rule) with identical semantics: ring() runs CCW in grid coords, which reads
// clockwise from above in three XZ, so tube() faces outward and disc() up.

/** n-gon ring of points around a center; radius per vertex via rad(i) */
function irregularRing(
  cx: number, cz: number, y: number, n: number, phase: number,
  rad: (i: number) => number
): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const r = rad(i);
    pts.push({ x: cx + Math.cos(a) * r, y, z: cz + Math.sin(a) * r });
  }
  return pts;
}

/** closed side wall between two same-count rings (outward-facing) */
function tube(sink: GeoSink, lo: P3[], hi: P3[], color: THREE.Color): void {
  const n = lo.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sink.quad(lo[i]!, hi[i]!, hi[j]!, lo[j]!, color);
  }
}

/** upward-facing fan over a ring */
function disc(sink: GeoSink, pts: P3[], cy: number, color: THREE.Color): void {
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  const c = { x: cx / n, y: cy, z: cz / n };
  for (let i = 0; i < n; i++) {
    sink.tri(pts[i]!, c, pts[(i + 1) % n]!, color);
  }
}

function cone(sink: GeoSink, base: P3[], apex: P3, color: THREE.Color): void {
  const n = base.length;
  for (let i = 0; i < n; i++) {
    sink.tri(base[i]!, apex, base[(i + 1) % n]!, color);
  }
}

const GROUND = LAND_TOP + 0.002; // hairline lift over the terrain mesh

const stoneBase = new THREE.Color(0x9d968b); // warm gray
const lampDark = new THREE.Color(0x3a3d43);
const lampGlass = new THREE.Color(0xffe9b8);
const soil = new THREE.Color(0x4a3a2c);
const picketWhite = new THREE.Color(0xf2ede1);
const tuftGreen = new THREE.Color(0x6f9a4e);
/** fixed cheerful flower set — bed rng picks per dot */
const FLOWERS: readonly THREE.Color[] = [
  new THREE.Color(0xe85f7a), // rose
  new THREE.Color(0xf6c94f), // marigold
  new THREE.Color(0xf7f3e8), // daisy
  new THREE.Color(0x9a6fd0), // lavender
  new THREE.Color(0xef8a3d), // poppy
];

const LAMP_P = 0.18;
const BED_P = 0.45;
const FENCE_P = 0.25;
const TUFT_P = 0.3;

/** per-edge 1-ring classification — the ONLY dynamic state props read */
interface Ring1 {
  /** neighbor across k has any block (plaza-maker) */
  building: [boolean, boolean, boolean, boolean];
  /** neighbor across k filled at level 0 (wall at ground → flower bed) */
  groundBlock: [boolean, boolean, boolean, boolean];
  /** neighbor across k is empty land (fence candidate / lamp rival) */
  grass: [boolean, boolean, boolean, boolean];
  buildingCount: number;
}

function classify(town: Town, cellId: number): Ring1 {
  const cell = town.grid.cells[cellId]!;
  const out: Ring1 = {
    building: [false, false, false, false],
    groundBlock: [false, false, false, false],
    grass: [false, false, false, false],
    buildingCount: 0,
  };
  for (let k = 0; k < 4; k++) {
    const n = cell.neighbors[k]!;
    if (n < 0) continue;
    if (town.filled[n]! !== 0) {
      out.building[k] = true;
      out.buildingCount++;
      if (town.isFilled(n, 0)) out.groundBlock[k] = true;
    } else if (town.isLand(n)) {
      out.grass[k] = true;
    }
  }
  return out;
}

/**
 * Cheap per-cell fingerprint of everything emitGroundProps reads. Same
 * string ⇒ identical output; the mesher diffs it across edits (recipe-style)
 * so prop changes rebuild exactly the right chunks. '' = cell emits nothing
 * structurally (filled or water).
 */
export function groundPropsSignature(town: Town, cellId: number): string {
  if (town.filled[cellId]! !== 0 || !town.isLand(cellId)) return '';
  const cell = town.grid.cells[cellId]!;
  let s = 'g';
  for (let k = 0; k < 4; k++) {
    const n = cell.neighbors[k]!;
    if (n < 0) s += 'x';
    else if (town.filled[n]! !== 0) s += town.isFilled(n, 0) ? 'B' : 'b';
    else s += town.isLand(n) ? 'l' : 'w';
  }
  return s;
}

/**
 * The raw lamp dice roll — a pure function of (seed, cellId) so a cell can
 * evaluate its neighbors' rolls without reading beyond the 1-ring. A lamp
 * shows only when the cell rolls true AND no smaller-id empty-land neighbor
 * also rolls true, so two lamps can never stand on adjacent cells.
 */
function lampRoll(seed: number, cellId: number): boolean {
  return rng(seed, 'ground', cellId, 'lamp').chance(LAMP_P);
}

/** bilinear point inside the cell quad; (u,v) ∈ (0,1)² stays interior */
function interiorPoint(
  c: readonly { x: number; y: number }[], u: number, v: number
): { x: number; z: number } {
  const ax = c[0]!.x + (c[1]!.x - c[0]!.x) * u;
  const ay = c[0]!.y + (c[1]!.y - c[0]!.y) * u;
  const bx = c[3]!.x + (c[2]!.x - c[3]!.x) * u;
  const by = c[3]!.y + (c[2]!.y - c[3]!.y) * u;
  return { x: ax + (bx - ax) * v, z: ay + (by - ay) * v };
}

/** squashed irregular hexagonal stone slab */
function emitStone(
  sink: GeoSink, cx: number, cz: number, r: Rng
): void {
  const radius = r.range(0.12, 0.2);
  const h = r.range(0.015, 0.03);
  const phase = r.range(0, Math.PI * 2);
  const radii: number[] = [];
  for (let i = 0; i < 6; i++) radii.push(radius * r.range(0.78, 1.12));
  const lo = irregularRing(cx, cz, GROUND, 6, phase, (i) => radii[i]!);
  const hi = lo.map((p) => ({ ...p, y: GROUND + h }));
  const col = new THREE.Color().copy(stoneBase)
    .offsetHSL(r.range(-0.02, 0.02), r.range(-0.02, 0.04), r.range(-0.04, 0.04));
  tube(sink, lo, hi, col);
  disc(sink, hi, GROUND + h, col);
}

/**
 * Emit ground props for one EMPTY LAND cell. The mesher calls this from
 * buildChunk for every such cell; anything else returns immediately.
 */
export function emitGroundProps(
  solid: GeoSink, glass: GeoSink, town: Town, cellId: number
): void {
  if (town.filled[cellId]! !== 0 || !town.isLand(cellId)) return;
  const grid = town.grid;
  const cell = grid.cells[cellId]!;
  const ring1 = classify(town, cellId);
  const corners = [0, 1, 2, 3].map((k) => grid.corner(cell, k));

  if (ring1.buildingCount === 0) {
    // open grass: sparse tufts only (runs for ~700 cells — stay tiny)
    const r = rng(grid.seed, 'ground', cellId, 'tuft');
    if (!r.chance(TUFT_P)) return;
    const count = 2 + r.int(2); // 2-3
    for (let i = 0; i < count; i++) {
      const p = interiorPoint(corners, r.range(0.2, 0.8), r.range(0.2, 0.8));
      const rad = r.range(0.028, 0.048);
      const h = r.range(0.05, 0.07);
      const base = irregularRing(p.x, p.z, GROUND, 3, r.range(0, Math.PI * 2), () => rad);
      const col = new THREE.Color().copy(tuftGreen)
        .offsetHSL(r.range(-0.02, 0.02), 0, r.range(-0.05, 0.05));
      cone(solid, base, { x: p.x, y: GROUND + h, z: p.z }, col);
    }
    return;
  }

  // ---- plaza cell (adjacent to at least one building) --------------------

  // 1. stepping-stone path: stratified slots + jitter so slabs rarely overlap
  {
    const r = rng(grid.seed, 'ground', cellId, 'stones');
    const count = ring1.buildingCount >= 2 ? 5 + r.int(3) : 3 + r.int(4);
    const slots: [number, number][] = [];
    for (const u of [0.27, 0.5, 0.73]) for (const v of [0.27, 0.5, 0.73]) slots.push([u, v]);
    r.shuffle(slots);
    for (let i = 0; i < count; i++) {
      const s = slots[i]!;
      const p = interiorPoint(
        corners,
        s[0] + r.range(-0.06, 0.06),
        s[1] + r.range(-0.06, 0.06)
      );
      emitStone(solid, p.x, p.z, r);
    }
  }

  // 2. lamp post (warm glass head glows at night via the glass material)
  {
    const r = rng(grid.seed, 'ground', cellId, 'lamp');
    let lamp = r.chance(LAMP_P);
    if (lamp) {
      for (let k = 0; k < 4 && lamp; k++) {
        const n = cell.neighbors[k]!;
        // suppress if a smaller-id empty-land rival also rolls true — only
        // 1-ring state + the rival's pure (seed, id) roll, so deterministic
        if (n >= 0 && n < cellId && ring1.grass[k]! && lampRoll(grid.seed, n)) lamp = false;
      }
    }
    if (lamp) {
      const p = interiorPoint(corners, 0.5 + r.range(-0.12, 0.12), 0.5 + r.range(-0.12, 0.12));
      solid.post(p.x, p.z, GROUND, GROUND + 0.05, 0.05, lampDark); // foot
      solid.post(p.x, p.z, GROUND, GROUND + 0.85, 0.03, lampDark); // post
      glass.post(p.x, p.z, GROUND + 0.85, GROUND + 0.97, 0.052, lampGlass); // lantern
      solid.post(p.x, p.z, GROUND + 0.97, GROUND + 1.0, 0.062, lampDark); // cap
    }
  }

  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t,
  });

  // 3. flower beds along walls with a ground-level block behind them
  for (let k = 0; k < 4; k++) {
    if (!ring1.groundBlock[k]!) continue;
    const r = rng(grid.seed, 'ground', cellId, 'bed', k);
    if (!r.chance(BED_P)) continue;
    const a = grid.corner(cell, k);
    const b = grid.corner(cell, k + 1);
    const nrm = grid.edgeNormal(cell, k); // outward; bed sits just inside
    const inX = -nrm.x, inZ = -nrm.y;
    const off = 0.05, wid = 0.14, h = 0.06;
    const p0 = lerp(a, b, 0.15), p1 = lerp(a, b, 0.85);
    const lo = [
      { x: p0.x + inX * off, y: GROUND, z: p0.z + inZ * off },
      { x: p1.x + inX * off, y: GROUND, z: p1.z + inZ * off },
      { x: p1.x + inX * (off + wid), y: GROUND, z: p1.z + inZ * (off + wid) },
      { x: p0.x + inX * (off + wid), y: GROUND, z: p0.z + inZ * (off + wid) },
    ];
    const hi = lo.map((p) => ({ ...p, y: GROUND + h }));
    tube(solid, lo, hi, soil);
    disc(solid, hi, GROUND + h, soil);
    const dots = 3 + r.int(3); // 3-5
    for (let i = 0; i < dots; i++) {
      const t = r.range(0.08, 0.92);
      const d = off + wid * r.range(0.25, 0.75);
      const q = lerp(a, b, 0.15 + 0.7 * t);
      solid.post(
        q.x + inX * d, q.z + inZ * d,
        GROUND + h, GROUND + h + 0.03, 0.015,
        r.pick(FLOWERS)
      );
    }
  }

  // 4. picket fence where the plaza borders open grass
  for (let k = 0; k < 4; k++) {
    if (!ring1.grass[k]!) continue;
    const r = rng(grid.seed, 'ground', cellId, 'fence', k);
    if (!r.chance(FENCE_P)) continue;
    const a = grid.corner(cell, k);
    const b = grid.corner(cell, k + 1);
    const nrm = grid.edgeNormal(cell, k);
    const inX = -nrm.x, inZ = -nrm.y;
    const off = 0.05;
    const e0 = lerp(a, b, 0.18), e1 = lerp(a, b, 0.82);
    const p0 = { x: e0.x + inX * off, z: e0.z + inZ * off };
    const p1 = { x: e1.x + inX * off, z: e1.z + inZ * off };
    const n = 3 + r.int(3); // 3-5 pickets
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      solid.post(
        p0.x + (p1.x - p0.x) * t, p0.z + (p1.z - p0.z) * t,
        GROUND, GROUND + 0.16, 0.012, picketWhite
      );
    }
    // one horizontal rail (thin box; footprint CCW in grid coords)
    const hw = 0.008;
    const railLo = [
      { x: p0.x - inX * hw, y: GROUND + 0.09, z: p0.z - inZ * hw },
      { x: p1.x - inX * hw, y: GROUND + 0.09, z: p1.z - inZ * hw },
      { x: p1.x + inX * hw, y: GROUND + 0.09, z: p1.z + inZ * hw },
      { x: p0.x + inX * hw, y: GROUND + 0.09, z: p0.z + inZ * hw },
    ];
    const railHi = railLo.map((p) => ({ ...p, y: GROUND + 0.115 }));
    tube(solid, railLo, railHi, picketWhite);
    disc(solid, railHi, GROUND + 0.115, picketWhite);
    solid.horzDown(railLo[0]!, railLo[1]!, railLo[2]!, railLo[3]!, picketWhite);
  }
}
