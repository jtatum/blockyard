/**
 * Archway special build (product §8; the Townscaper "add a roof between two
 * buildings" arch, plus the beach-stairway variant).
 *
 * A cell whose column FLOATS (lowest filled level ≥ 1, ground level empty)
 * and whose two strict-opposite neighbors both support the void — either
 * solid through every void level ('wall') or floating themselves ('pier',
 * a continuing span) — gets a barrel-vault opening cut under its span:
 * solid leg boxes at both ends, vertical jambs, an elliptical intrados to a
 * crown just under the span's soffit, and spandrel faces on both open sides.
 * Adjacent floating cells each emit their own bay, so a row of spans over
 * water reads as an arcade bridge with shared piers.
 *
 * Beach stairway: an arch cell on LAND whose open side faces an empty water
 * cell grows stone steps descending through the opening to below the
 * waterline (CD4 — deterministic, no random gate). All color jitter comes
 * from rng(grid.seed, 'arch', cell).
 */

import * as THREE from 'three';
import { LAND_TOP, levelY, SEA_FLOOR, WATER_Y } from '../core/constants';
import { rng } from '../core/rng';
import type { GridCell } from '../grid/grid';
import { PALETTE } from '../town/palette';
import type { Town } from '../town/town';
import type { GeoSink, P3 } from './geom';

export type ArchEnd = 'wall' | 'pier';

export interface ArchSpec {
  /** the floating (void-under-span) cell hosting the arch */
  cell: number;
  /** support axis: edge kA and its strict quad-opposite kA+2 */
  kA: number;
  /** the span's lowest filled level; the void spans levels 0..top-1 */
  top: number;
  endA: ArchEnd;
  endB: ArchEnd;
  /** neighbor cell ids across kA / kA+2 (signature participants) */
  supportA: number;
  supportB: number;
  /** beach stairway: edge whose empty-water neighbor receives descending steps (-1 = none) */
  beachK: number;
  beachCell: number;
}

const NARC = 8; // intrados samples across the opening
const STONE = 0xb9b0a2;

/** 'wall' = solid through every void level; 'pier' = floats too (span continues) */
function supportKind(town: Town, n: number, voidMask: number): ArchEnd | null {
  if (n < 0) return null;
  const m = town.filled[n]!;
  if ((m & voidMask) === voidMask) return 'wall';
  if (m !== 0 && (m & 1) === 0) return 'pier';
  return null;
}

/**
 * A cell qualifies iff its column floats (bit 0 empty, something above) and
 * one strict-opposite edge pair has support at both ends. Wall supports beat
 * pier supports; ties resolve to the lower kA. Beach steps attach when the
 * cell is land and an open-side neighbor is empty water.
 */
export function detectArches(town: Town): Map<number, ArchSpec> {
  const grid = town.grid;
  const out = new Map<number, ArchSpec>();
  for (const cell of grid.cells) {
    const mask = town.filled[cell.id]!;
    if (mask === 0 || (mask & 1) !== 0) continue;
    const top = 31 - Math.clz32(mask & -mask); // lowest set bit, ≥ 1
    const voidMask = (1 << top) - 1;
    let best: { kA: number; endA: ArchEnd; endB: ArchEnd; score: number } | null = null;
    for (const kA of [0, 1]) {
      const endA = supportKind(town, cell.neighbors[kA]!, voidMask);
      const endB = supportKind(town, cell.neighbors[kA + 2]!, voidMask);
      if (!endA || !endB) continue;
      const score = (endA === 'wall' ? 2 : 1) + (endB === 'wall' ? 2 : 1);
      if (!best || score > best.score) best = { kA, endA, endB, score };
    }
    if (!best) continue;
    let beachK = -1;
    let beachCell = -1;
    if (town.isLand(cell.id)) {
      for (const kV of [(best.kA + 1) % 4, (best.kA + 3) % 4]) {
        const w = cell.neighbors[kV]!;
        if (w >= 0 && town.filled[w] === 0 && !town.isLand(w)) {
          beachK = kV;
          beachCell = w;
          break;
        }
      }
    }
    out.set(cell.id, {
      cell: cell.id,
      kA: best.kA,
      top,
      endA: best.endA,
      endB: best.endB,
      supportA: cell.neighbors[best.kA]!,
      supportB: cell.neighbors[best.kA + 2]!,
      beachK,
      beachCell,
    });
  }
  return out;
}

/** stable dirty-diff signature (value-carrying, mirrors stairsSignature) */
export function archSignature(spec: ArchSpec): string {
  return `A${spec.cell},${spec.kA},${spec.top},${spec.endA[0]},${spec.endB[0]},${spec.supportA},${spec.supportB},${spec.beachK},${spec.beachCell}`;
}

/**
 * Emit the arch bay. The bay is modeled as the void volume made solid with a
 * barrel-vault opening cut through it along the open (±s) sides:
 *
 *   t ∈ [0,1] runs support→support (bilinear between edges kA and kA+2),
 *   s ∈ [0,1] runs across the open sides, y up.
 *
 * Solid legs occupy t ∈ [0,tp] and [1-tp,1]; between them the opening rises
 * with vertical jambs to the spring line, then an elliptical intrados to the
 * crown. End closures at t≈0/1 are full-height: against a 'wall' support they
 * back the neighbor's (filleted, receding) wall; against a 'pier' support the
 * two neighboring bays' closures read as one shared pier.
 */
export function emitArch(sink: GeoSink, town: Town, spec: ArchSpec): void {
  const grid = town.grid;
  const c = grid.cells[spec.cell];
  if (!c) return;
  const kA = spec.kA;

  // bilinear frame between edge kA (t=0) and edge kA+2 (t=1); s follows the
  // side edges: s=0 tracks edge kA+3 (reversed), s=1 tracks edge kA+1
  const a0 = grid.corner(c, kA);
  const a1 = grid.corner(c, kA + 1);
  const b0 = grid.corner(c, kA + 3);
  const b1 = grid.corner(c, kA + 2);
  const at = (t: number, s: number): { x: number; y: number } => {
    const fx = a0.x + (a1.x - a0.x) * s;
    const fy = a0.y + (a1.y - a0.y) * s;
    const gx = b0.x + (b1.x - b0.x) * s;
    const gy = b0.y + (b1.y - b0.y) * s;
    return { x: fx + (gx - fx) * t, y: fy + (gy - fy) * t };
  };
  const P = (t: number, s: number, y: number): P3 => {
    const p = at(t, s);
    return { x: p.x, y, z: p.y };
  };

  const mA = grid.edgeMid(c, kA);
  const mB = grid.edgeMid(c, kA + 2);
  const axisLen = Math.hypot(mB.x - mA.x, mB.y - mA.y);
  if (axisLen < 1e-4) return;
  // world axis direction (for intrados normals; straight-axis approximation)
  const ax = (mB.x - mA.x) / axisLen;
  const ay = (mB.y - mA.y) / axisLen;

  const yTop = levelY(spec.top);
  const land = town.isLand(spec.cell);
  const groundY = land ? LAND_TOP : WATER_Y - 0.15;
  const legFootY = land ? LAND_TOP : SEA_FLOOR; // closures/legs reach real support
  const yCrown = yTop - 0.1;
  const ySpring = groundY + (yCrown - groundY) * 0.52;
  const tp = Math.min(0.22, Math.max(0.08, 0.14 / axisLen)); // leg fraction
  const tEps = Math.min(0.02, tp * 0.25); // end-closure inset (kills z-fighting)

  const r = rng(grid.seed, 'arch', spec.cell);
  const wall = new THREE.Color(PALETTE[town.colorAt(spec.cell, spec.top)]!.hex).offsetHSL(
    0,
    -0.02,
    r.range(-0.02, 0.02) - 0.04
  );
  const under = wall.clone().offsetHSL(0, -0.03, -0.09);

  // opening profile: vertical jambs to the spring, elliptical arc to the crown
  const yArc = (t: number): number => {
    const xi = (2 * (t - tp)) / (1 - 2 * tp) - 1; // -1..1 across the opening
    return ySpring + (yCrown - ySpring) * Math.sqrt(Math.max(0, 1 - xi * xi));
  };

  /** trapezoid strip of a side face; winding keeps the normal outward per side */
  const sideQuad = (
    s: number,
    t0: number, y0lo: number, y0hi: number,
    t1: number, y1lo: number, y1hi: number
  ): void => {
    if (s === 1) {
      sink.quad(P(t0, s, y0lo), P(t0, s, y0hi), P(t1, s, y1hi), P(t1, s, y1lo), wall);
    } else {
      sink.quad(P(t1, s, y1lo), P(t1, s, y1hi), P(t0, s, y0hi), P(t0, s, y0lo), wall);
    }
  };

  // ---- side faces (both open sides): legs + spandrel strips over the arc ---
  for (const s of [0, 1] as const) {
    sideQuad(s, 0, legFootY, yTop, tp, legFootY, yTop);
    sideQuad(s, 1 - tp, legFootY, yTop, 1, legFootY, yTop);
    for (let i = 0; i < NARC; i++) {
      const t0 = tp + ((1 - 2 * tp) * i) / NARC;
      const t1 = tp + ((1 - 2 * tp) * (i + 1)) / NARC;
      sideQuad(s, t0, yArc(t0), yTop, t1, yArc(t1), yTop);
    }
  }

  // ---- end closures: full width & height, facing into the bay -------------
  // (at t≈0 the face points +t: traverse s 1→0 so "right of a→b" is inward)
  sink.quad(
    P(tEps, 1, legFootY), P(tEps, 1, yTop), P(tEps, 0, yTop), P(tEps, 0, legFootY),
    under
  );
  sink.quad(
    P(1 - tEps, 0, legFootY), P(1 - tEps, 0, yTop), P(1 - tEps, 1, yTop), P(1 - tEps, 1, legFootY),
    under
  );

  // ---- jambs: vertical reveals bounding the opening, facing inward --------
  sink.quad(P(tp, 1, groundY), P(tp, 1, ySpring), P(tp, 0, ySpring), P(tp, 0, groundY), under);
  sink.quad(
    P(1 - tp, 0, groundY), P(1 - tp, 0, ySpring), P(1 - tp, 1, ySpring), P(1 - tp, 1, groundY),
    under
  );

  // ---- intrados: smooth-shaded barrel vault over the opening --------------
  const samples: { t: number; y: number; n: P3 }[] = [];
  for (let i = 0; i <= NARC; i++) {
    const t = tp + ((1 - 2 * tp) * i) / NARC;
    const y = yArc(t);
    // profile normal in the (axis, y) plane, pointing down into the opening
    const dt = (1 - 2 * tp) / NARC;
    const yPrev = yArc(Math.max(tp, t - dt));
    const yNext = yArc(Math.min(1 - tp, t + dt));
    const du = axisLen * Math.min(2 * dt, (Math.min(1 - tp, t + dt) - Math.max(tp, t - dt)));
    const dy = yNext - yPrev;
    let nu = dy;
    let ny = -du;
    const len = Math.hypot(nu, ny) || 1;
    nu /= len;
    ny /= len;
    samples.push({ t, y, n: { x: nu * ax, y: ny, z: nu * ay } });
  }
  for (let i = 0; i < NARC; i++) {
    const s0 = samples[i]!;
    const s1 = samples[i + 1]!;
    sink.quadN(
      P(s0.t, 0, s0.y), P(s0.t, 1, s0.y), P(s1.t, 1, s1.y), P(s1.t, 0, s1.y),
      s0.n, s0.n, s1.n, s1.n,
      under
    );
  }

  if (spec.beachK >= 0) emitBeachSteps(sink, town, spec);
}

/**
 * Beach stairway: stone steps descending from the arch cell's deck line
 * through the open side into the empty water neighbor, ending below the
 * waterline. Clipped so every vertex stays inside the water cell footprint.
 */
function emitBeachSteps(sink: GeoSink, town: Town, spec: ArchSpec): void {
  const grid = town.grid;
  const c = grid.cells[spec.cell];
  const w = grid.cells[spec.beachCell];
  if (!c || !w) return;

  const e0 = grid.corner(c, spec.beachK);
  const e1 = grid.corner(c, spec.beachK + 1);
  const mid = grid.edgeMid(c, spec.beachK);
  const edgeLen = Math.hypot(e1.x - e0.x, e1.y - e0.y);
  if (edgeLen < 1e-4) return;
  const dx = (e1.x - e0.x) / edgeLen; // lateral
  const dy = (e1.y - e0.y) / edgeLen;
  const o = grid.edgeNormal(c, spec.beachK); // outward, into the water cell
  const half = edgeLen * 0.28;

  // how far the stepped strip can extend into the water cell: clip both
  // rails and the centerline against the water cell's edge half-planes
  let tMax = Infinity;
  for (const lat of [-half, 0, half]) {
    const px = mid.x + dx * lat;
    const py = mid.y + dy * lat;
    for (let k = 0; k < 4; k++) {
      const n = grid.edgeNormal(w, k);
      const denom = o.x * n.x + o.y * n.y;
      if (denom <= 1e-6) continue; // moving away from this edge
      const a = grid.corner(w, k);
      const tHit = ((a.x - px) * n.x + (a.y - py) * n.y) / denom;
      tMax = Math.min(tMax, tHit);
    }
  }
  if (!Number.isFinite(tMax) || tMax < 0.35) return; // no room — skip steps

  const RISE = 0.13;
  const yBottom = WATER_Y - 0.5;
  const steps = Math.ceil((LAND_TOP - (WATER_Y - 0.3)) / RISE);
  const run = Math.min(0.26, (tMax * 0.94) / steps);

  const r = rng(grid.seed, 'arch', spec.cell, 'beach');
  const tread = new THREE.Color(STONE).offsetHSL(
    r.range(-0.01, 0.01),
    r.range(-0.02, 0.02),
    r.range(-0.03, 0.03)
  );
  const riser = tread.clone().offsetHSL(0, 0, -0.05);

  const Q = (tt: number, lat: number, y: number): P3 => ({
    x: mid.x + o.x * tt + dx * lat,
    y,
    z: mid.y + o.y * tt + dy * lat,
  });

  for (let i = 0; i < steps; i++) {
    const t0 = i * run;
    const t1 = t0 + run;
    const yHi = LAND_TOP - i * RISE;
    const yLo = yHi - RISE;
    // riser at t0, facing out to sea (right of the +lateral traverse)
    sink.quad(Q(t0, -half, yLo), Q(t0, -half, yHi), Q(t0, half, yHi), Q(t0, half, yLo), riser);
    // tread (up-facing: with t×lateral crossing downward, reverse the loop)
    sink.quad(Q(t0, -half, yLo), Q(t0, half, yLo), Q(t1, half, yLo), Q(t1, -half, yLo), tread);
    // side skirts down to the underwater base
    sink.quad(Q(t1, half, yBottom), Q(t1, half, yLo), Q(t0, half, yLo), Q(t0, half, yBottom), tread);
    sink.quad(Q(t0, -half, yBottom), Q(t0, -half, yLo), Q(t1, -half, yLo), Q(t1, -half, yBottom), tread);
  }
  const tEnd = steps * run;
  const yEnd = LAND_TOP - steps * RISE;
  // face at the deep end + bottom cap (both mostly underwater)
  sink.quad(Q(tEnd, -half, yBottom), Q(tEnd, -half, yEnd), Q(tEnd, half, yEnd), Q(tEnd, half, yBottom), riser);
  sink.quad(Q(0, -half, yBottom), Q(tEnd, -half, yBottom), Q(tEnd, half, yBottom), Q(0, half, yBottom), tread);
  // back face against the shoreline skirt (rarely visible, seals the mass)
  sink.quad(Q(0, half, yBottom), Q(0, half, LAND_TOP), Q(0, -half, LAND_TOP), Q(0, -half, yBottom), riser);
}

/** convex-quad containment guard used by tests (all cell edges' half-planes) */
export function insideCell(grid: { edgeNormal(c: GridCell, k: number): { x: number; y: number }; corner(c: GridCell, k: number): { x: number; y: number } }, c: GridCell, x: number, y: number, slack: number): boolean {
  for (let k = 0; k < 4; k++) {
    const n = grid.edgeNormal(c, k);
    const a = grid.corner(c, k);
    if ((x - a.x) * n.x + (y - a.y) * n.y > slack) return false;
  }
  return true;
}
