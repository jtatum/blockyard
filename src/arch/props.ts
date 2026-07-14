/**
 * Prop & recipe geometry: lighthouse lanterns, flag buntings, garden
 * furniture (hedges, trees, benches). Small, chunky, low-poly pieces that
 * read at toy scale. All placement/variation is seeded.
 */

import * as THREE from 'three';
import { LAND_TOP, levelY } from '../core/constants';
import { rng } from '../core/rng';
import type { Grid } from '../grid/grid';
import { PALETTE } from '../town/palette';
import type { Town } from '../town/town';
import { GeoSink, type P3 } from './geom';
import type { BuntingSpec, LanternSpec } from './recipes';

const cap = new THREE.Color(0x8c3b30);
const white = new THREE.Color(0xf4efe2);
const glassWarm = new THREE.Color(0xffe9b8);
const railing = new THREE.Color(0x3c3f45);
const stringCol = new THREE.Color(0x5c5348);
const hedge = new THREE.Color(0x4c7040);
const canopy = new THREE.Color(0x5d8a4a);
const canopy2 = new THREE.Color(0x74a058);
const trunk = new THREE.Color(0x6d5236);
const benchWood = new THREE.Color(0x9a7a52);
const gardenGrass = new THREE.Color(0x8fb96b);

/** n-gon ring of points around a center */
function ring(cx: number, cz: number, y: number, r: number, n: number, phase = 0): P3[] {
  const pts: P3[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
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

/** upward-facing disc from a ring */
function disc(sink: GeoSink, pts: P3[], cy: number, color: THREE.Color): void {
  const n = pts.length;
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  const c = { x: cx / n, y: cy, z: cz / n };
  for (let i = 0; i < n; i++) {
    // note: ring() runs clockwise when viewed from +Y in three space
    sink.tri(pts[i]!, c, pts[(i + 1) % n]!, color);
  }
}

function cone(sink: GeoSink, base: P3[], apex: P3, color: THREE.Color): void {
  const n = base.length;
  for (let i = 0; i < n; i++) {
    sink.tri(base[i]!, apex, base[(i + 1) % n]!, color);
  }
}

/** the lighthouse lantern room replacing the top voxel's plain block */
export function emitLantern(
  sink: GeoSink,
  glass: GeoSink,
  town: Town,
  spec: LanternSpec
): void {
  const grid = town.grid;
  const c = grid.cells[spec.cell]!;
  // radius from mean corner distance, slightly inset from the tower walls
  let rad = 0;
  for (let k = 0; k < 4; k++) rad += Math.hypot(grid.corner(c, k).x - c.cx, grid.corner(c, k).y - c.cy);
  rad = (rad / 4) * 0.78;
  const y0 = levelY(spec.level); // lantern replaces the top voxel entirely
  const cx = c.cx, cz = c.cy;
  const N = 8;

  // gallery deck with lip
  const deckR = rad * 1.12;
  const deck0 = ring(cx, cz, y0, deckR, N);
  const deck1 = ring(cx, cz, y0 + 0.09, deckR, N);
  tube(sink, deck0, deck1, white);
  disc(sink, deck1, y0 + 0.09, white);
  // railing posts
  for (const p of ring(cx, cz, y0 + 0.09, deckR * 0.96, N)) {
    sink.post(p.x, p.z, y0 + 0.09, y0 + 0.34, 0.016, railing);
  }
  // glazed lantern room
  const glassR = rad * 0.66;
  const g0 = ring(cx, cz, y0 + 0.09, glassR, N);
  const g1 = ring(cx, cz, y0 + 0.7, glassR, N);
  tube(glass, g0, g1, glassWarm);
  // corner mullions
  for (let i = 0; i < N; i += 2) {
    const p = g0[i]!;
    sink.post(p.x, p.z, y0 + 0.09, y0 + 0.7, 0.022, railing);
  }
  // cap cone + finial
  const capBase = ring(cx, cz, y0 + 0.7, glassR * 1.25, N);
  disc(sink, capBase, y0 + 0.7, cap);
  cone(sink, capBase, { x: cx, y: y0 + 1.08, z: cz }, cap);
  sink.post(cx, cz, y0 + 1.05, y0 + 1.2, 0.02, railing);
}

/** catenary pennant string between two facing walls (color-hybrid, CD3) */
export function emitBunting(sink: GeoSink, town: Town, spec: BuntingSpec): void {
  const grid = town.grid;
  const a = grid.cells[spec.cellA]!;
  const b = grid.cells[spec.cellB]!;
  const mA = grid.edgeMid(a, spec.kA);
  const mB = grid.edgeMid(b, spec.kB);
  const y = levelY(spec.level) + 0.82;
  const from = { x: mA.x, y, z: mA.y };
  const to = { x: mB.x, y, z: mB.y };
  const colA = new THREE.Color(PALETTE[spec.colorA]!.hex).offsetHSL(0, 0.05, 0.06);
  const colB = new THREE.Color(PALETTE[spec.colorB]!.hex).offsetHSL(0, 0.05, 0.06);

  const SEG = 8;
  const sag = 0.22;
  const pts: P3[] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    pts.push({
      x: from.x + (to.x - from.x) * t,
      y: y - Math.sin(Math.PI * t) * sag,
      z: from.z + (to.z - from.z) * t,
    });
  }
  // string ribbon (double-sided thin quads)
  for (let i = 0; i < SEG; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    const up = 0.012;
    sink.quad(p, { ...p, y: p.y + up }, { ...q, y: q.y + up }, q, stringCol);
    sink.quad(q, { ...q, y: q.y + up }, { ...p, y: p.y + up }, p, stringCol);
  }
  // pennants along interior points, alternating endpoint colors
  const r = rng(grid.seed, 'flags', spec.cellA, spec.cellB, spec.level);
  for (let i = 1; i < SEG; i++) {
    const p = pts[i]!;
    const q = pts[i + 1] ?? pts[i - 1]!;
    const dirx = (q.x - p.x) * 0.4;
    const dirz = (q.z - p.z) * 0.4;
    const col = i % 2 === 0 ? colA : colB;
    const drop = 0.16 + r.range(-0.02, 0.02);
    const apex = { x: p.x + dirx * 0.5, y: p.y - drop, z: p.z + dirz * 0.5 };
    const p2 = { x: p.x + dirx, y: p.y, z: p.z + dirz };
    sink.tri(p, p2, apex, col);
    sink.tri(apex, p2, p, col);
  }
}

/** garden courtyard furnishing for one ground cell (grass emitted here too) */
export function emitGardenCell(sink: GeoSink, town: Town, cellId: number): void {
  const grid = town.grid;
  const c = grid.cells[cellId]!;
  const y = LAND_TOP + 0.012;
  const corners = [0, 1, 2, 3].map((k) => {
    const v = grid.corner(c, k);
    return { x: v.x, y, z: v.y };
  });
  const r = rng(grid.seed, 'garden', cellId);
  const g = new THREE.Color().copy(gardenGrass).offsetHSL(0, 0, r.range(-0.03, 0.03));
  sink.horzUp(corners[0]!, corners[1]!, corners[2]!, corners[3]!, g);

  // hedge strips along edges that face the enclosing buildings
  for (let k = 0; k < 4; k++) {
    const n = c.neighbors[k]!;
    if (n < 0 || town.filled[n] === 0) continue;
    const a = grid.corner(c, k);
    const b = grid.corner(c, k + 1);
    const nrm = grid.edgeNormal(c, k); // outward; hedge sits just inside
    const inX = -nrm.x * 0.12, inZ = -nrm.y * 0.12;
    const h = 0.16;
    const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({
      x: p.x + (q.x - p.x) * t, z: p.y + (q.y - p.y) * t,
    });
    const p0 = lerp(a, b, 0.12), p1 = lerp(a, b, 0.88);
    const lo = [
      { x: p0.x, y, z: p0.z }, { x: p1.x, y, z: p1.z },
      { x: p1.x + inX, y, z: p1.z + inZ }, { x: p0.x + inX, y, z: p0.z + inZ },
    ];
    const hi = lo.map((p) => ({ ...p, y: y + h }));
    tube(sink, lo, hi, hedge);
    disc(sink, hi, y + h, hedge);
  }

  // a tree on some cells, a bench on others
  if (r.chance(0.55)) {
    const tx = c.cx + r.range(-0.18, 0.18);
    const tz = c.cy + r.range(-0.18, 0.18);
    const th = r.range(0.5, 0.75);
    sink.post(tx, tz, y, y + th, 0.045, trunk);
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const rr = (0.34 - t * 0.22) * r.range(0.9, 1.1);
      const base = ring(tx, tz, y + th + t * 0.42, rr, 6, r.next() * Math.PI);
      disc(sink, base, y + th + t * 0.42, i % 2 ? canopy2 : canopy);
      cone(sink, base, { x: tx, y: y + th + t * 0.42 + 0.3, z: tz }, i % 2 ? canopy2 : canopy);
    }
  } else if (r.chance(0.4)) {
    // tiny bench: two legs + seat slab
    const bx = c.cx, bz = c.cy;
    const ang = r.next() * Math.PI;
    const dx = Math.cos(ang) * 0.16, dz = Math.sin(ang) * 0.16;
    sink.post(bx - dx, bz - dz, y, y + 0.09, 0.02, trunk);
    sink.post(bx + dx, bz + dz, y, y + 0.09, 0.02, trunk);
    const sx = Math.cos(ang) * 0.24, sz = Math.sin(ang) * 0.24;
    const px = -Math.sin(ang) * 0.07, pz = Math.cos(ang) * 0.07;
    sink.quad(
      { x: bx - sx - px, y: y + 0.11, z: bz - sz - pz },
      { x: bx - sx + px, y: y + 0.11, z: bz - sz + pz },
      { x: bx + sx + px, y: y + 0.11, z: bz + sz + pz },
      { x: bx + sx - px, y: y + 0.11, z: bz + sz - pz },
      benchWood
    );
    sink.quad(
      { x: bx + sx - px, y: y + 0.11, z: bz + sz - pz },
      { x: bx + sx + px, y: y + 0.11, z: bz + sz + pz },
      { x: bx - sx + px, y: y + 0.11, z: bz - sz + pz },
      { x: bx - sx - px, y: y + 0.11, z: bz - sz - pz },
      benchWood
    );
  }
}
