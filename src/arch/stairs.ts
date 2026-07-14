/**
 * Alley staircase special build (product: the Townscaper switchback stair).
 *
 * An empty land cell squeezed between two ground-rooted buildings on roughly
 * opposite edges becomes a solid masonry stair tower: per storey a straight
 * 5-step flight with a landing at the turnaround end, climb direction
 * alternating each storey (switchback), low parapets along both sides, a back
 * wall at each turnaround, and closed skirts/bottom caps so the mass never
 * reads hollow. Detection is deterministic (CD4 — no random gate) and reads
 * only the gap cell's 1-ring, so the mesher's dirty contract holds. All
 * color jitter comes from rng(grid.seed, 'stairs', cell, storey).
 */

import * as THREE from 'three';
import { LAND_TOP, levelY } from '../core/constants';
import { rng } from '../core/rng';
import type { Grid, GridCell } from '../grid/grid';
import type { Town } from '../town/town';
import type { GeoSink, P3 } from './geom';

export interface StairSpec {
  /** the empty gap cell hosting the stairs */
  cell: number;
  /** the gap cell's edge index facing cellA */
  kA: number;
  cellA: number;
  cellB: number;
  /** storeys the stair climbs (2..5) */
  levels: number;
}

const STONE = 0xb9b0a2;
const PARAPET_RISE = 0.32;
const EDGE_INSET = 0.06;
const STEPS = 5;

/**
 * The edge of `cell` roughly opposite edge k: outward normals must point
 * against each other (dot < -0.2), pick the most opposite. Same rule as
 * recipes.ts oppositeEdge, keyed by edge index instead of neighbor id.
 */
function oppositeEdgeOf(grid: Grid, cell: GridCell, k: number): number {
  const nIn = grid.edgeNormal(cell, k);
  let best = -1;
  let bestDot = 0.2; // require -(nJ · nK) > 0.2, i.e. nJ · nK < -0.2
  for (let j = 0; j < 4; j++) {
    if (j === k) continue;
    const n = grid.edgeNormal(cell, j);
    const d = -(n.x * nIn.x + n.y * nIn.y);
    if (d > bestDot) {
      bestDot = d;
      best = j;
    }
  }
  return best;
}

/**
 * A gap cell qualifies iff it is empty, LAND, and two roughly opposite edges
 * have neighbors both filled at level 0. levels = min column height clamped
 * to 5; stairs only appear beside real masses (levels >= 2). One spec per
 * gap cell — the qualifying pair with the lowest kA wins.
 */
export function detectStairs(town: Town): StairSpec[] {
  const grid = town.grid;
  const out: StairSpec[] = [];
  for (const cell of grid.cells) {
    if (town.filled[cell.id] !== 0) continue;
    if (!town.isLand(cell.id)) continue;
    for (let kA = 0; kA < 4; kA++) {
      const a = cell.neighbors[kA]!;
      if (a < 0 || !town.isFilled(a, 0)) continue;
      const kB = oppositeEdgeOf(grid, cell, kA);
      if (kB < 0) continue;
      const b = cell.neighbors[kB]!;
      if (b < 0 || b === a || !town.isFilled(b, 0)) continue;
      const levels = Math.max(1, Math.min(5, Math.min(town.columnHeight(a), town.columnHeight(b))));
      if (levels < 2) continue;
      out.push({ cell: cell.id, kA, cellA: a, cellB: b, levels });
      break; // lowest qualifying kA wins; one spec per gap cell
    }
  }
  return out;
}

/** stable dirty-diff signature (mirrors recipeSignature's value-carrying style) */
export function stairsSignature(spec: StairSpec): string {
  return `S${spec.cell},${spec.kA},${spec.cellA},${spec.cellB},${spec.levels}`;
}

/**
 * Emit the switchback stone staircase filling the gap cell from LAND_TOP up
 * to levelY(spec.levels). Local frame: u = climb axis from edge kA's midpoint
 * toward the opposite edge's midpoint, v = lateral; the frame rectangle is
 * shrunk until it provably sits inside the (irregular, convex) quad footprint
 * with EDGE_INSET clearance.
 */
export function emitStairs(sink: GeoSink, town: Town, spec: StairSpec): void {
  const grid = town.grid;
  const c = grid.cells[spec.cell];
  if (!c) return;

  // edge facing cellB (prefer the actual adjacency; fall back to geometry)
  let kB = -1;
  for (let k = 0; k < 4; k++) {
    if (k !== spec.kA && c.neighbors[k] === spec.cellB) {
      kB = k;
      break;
    }
  }
  if (kB < 0) kB = oppositeEdgeOf(grid, c, spec.kA);
  if (kB < 0) return;

  // ---- local frame -------------------------------------------------------
  const mA = grid.edgeMid(c, spec.kA);
  const mB = grid.edgeMid(c, kB);
  let ux = mB.x - mA.x;
  let uy = mB.y - mA.y;
  const axisLen = Math.hypot(ux, uy);
  if (axisLen < 1e-6) return;
  ux /= axisLen;
  uy /= axisLen;
  const vx = -uy; // perpendicular (grid coords), right-handed with u
  const vy = ux;
  const cx = c.cx;
  const cy = c.cy;

  // largest safe centered rectangle: for each edge (outward normal n, corner
  // a) require uHalf·|u·n| + vHalf·|v·n| <= dist(centroid, edge) − inset
  const eA0 = grid.corner(c, spec.kA);
  const eA1 = grid.corner(c, spec.kA + 1);
  const eB0 = grid.corner(c, kB);
  const eB1 = grid.corner(c, kB + 1);
  const wEdgeA = Math.hypot(eA1.x - eA0.x, eA1.y - eA0.y);
  const wEdgeB = Math.hypot(eB1.x - eB0.x, eB1.y - eB0.y);
  const lu0 = axisLen / 2;
  const lv0 = Math.min(wEdgeA, wEdgeB) / 2;
  let s = 1;
  for (let k = 0; k < 4; k++) {
    const n = grid.edgeNormal(c, k);
    const a = grid.corner(c, k);
    const dist = (a.x - cx) * n.x + (a.y - cy) * n.y; // centroid → edge, > 0
    const denom = lu0 * Math.abs(ux * n.x + uy * n.y) + lv0 * Math.abs(vx * n.x + vy * n.y);
    if (denom > 1e-9) s = Math.min(s, (dist - EDGE_INSET) / denom);
  }
  if (!(s > 0)) return; // degenerate cell — nothing safe to emit
  const uHalf = lu0 * s;
  const vHalf = lv0 * s;

  // ---- layout (t-space: −uHalf = start end, +uHalf = turnaround end) ------
  const landDepth = 0.18 * (2 * uHalf); // landing slab depth each end
  const fs = -uHalf + landDepth; // flight start
  const fe = uHalf - landDepth; // flight end
  const run = (fe - fs) / STEPS;
  const sw = 0.55 * vHalf; // stair strip half-width
  const pt = Math.max(0.02, Math.min(0.14, sw * 0.35)); // parapet thickness

  const P = (uu: number, vv: number, y: number): P3 => ({
    x: cx + ux * uu + vx * vv,
    y,
    z: cy + uy * uu + vy * vv,
  });

  for (let l = 0; l < spec.levels; l++) {
    const dir = l % 2 === 0 ? 1 : -1; // switchback: even storeys climb +u
    const y0 = l === 0 ? LAND_TOP : levelY(l);
    const y1 = levelY(l + 1);
    const rise = (y1 - y0) / STEPS;
    // slight per-storey lateral taper — keeps adjacent storeys' side planes
    // from being coplanar (no z-fighting) and reads as masonry batter
    const swl = Math.max(sw * 0.55, sw - l * 0.015);
    const wIn = swl - pt; // parapet inner face plane
    const stepHalf = Math.max(0.02, wIn - 0.01);

    const r = rng(grid.seed, 'stairs', spec.cell, l);
    const tread = new THREE.Color(STONE).offsetHSL(
      r.range(-0.012, 0.012),
      r.range(-0.03, 0.03),
      r.range(-0.035, 0.035)
    );
    const riser = tread.clone().offsetHSL(0, 0, -0.05);
    const para = tread.clone().offsetHSL(0, 0.01, 0.055);

    const U = (t: number): number => dir * t;

    /** wall in a constant-t plane; ft = +1 faces the turnaround end */
    const crossWall = (
      t: number, v0: number, v1: number, yLo: number, yHi: number, ft: number, col: THREE.Color
    ): void => {
      const uPos = U(t);
      const fu = ft * dir; // facing in real u
      // facing +u ⇒ traverse a→b along +v (outward normal = rot(b−a))
      const va = fu > 0 ? v0 : v1;
      const vb = fu > 0 ? v1 : v0;
      sink.quad(P(uPos, va, yLo), P(uPos, va, yHi), P(uPos, vb, yHi), P(uPos, vb, yLo), col);
    };

    /** wall in a constant-v plane spanning t0..t1 (y linear per end); fv = +1 faces +v */
    const sideWall = (
      vPos: number,
      t0: number, y0lo: number, y0hi: number,
      t1: number, y1lo: number, y1hi: number,
      fv: number, col: THREE.Color
    ): void => {
      let uA = U(t0), yAlo = y0lo, yAhi = y0hi;
      let uB = U(t1), yBlo = y1lo, yBhi = y1hi;
      if (uA > uB) {
        [uA, uB] = [uB, uA];
        [yAlo, yBlo] = [yBlo, yAlo];
        [yAhi, yBhi] = [yBhi, yAhi];
      }
      if (fv > 0) {
        // facing +v ⇒ traverse along −u
        sink.quad(P(uB, vPos, yBlo), P(uB, vPos, yBhi), P(uA, vPos, yAhi), P(uA, vPos, yAlo), col);
      } else {
        sink.quad(P(uA, vPos, yAlo), P(uA, vPos, yAhi), P(uB, vPos, yBhi), P(uB, vPos, yBlo), col);
      }
    };

    /** up-facing quad spanning t0..t1 (y linear in t) × v0..v1 */
    const topQ = (
      t0: number, yT0: number, t1: number, yT1: number, v0: number, v1: number, col: THREE.Color
    ): void => {
      let uA = U(t0), yA = yT0;
      let uB = U(t1), yB = yT1;
      if (uA > uB) {
        [uA, uB] = [uB, uA];
        [yA, yB] = [yB, yA];
      }
      // (lo,lo)→(hi,lo)→(hi,hi)→(lo,hi) is grid-CCW in the (u,v) frame
      sink.horzUp(P(uA, v0, yA), P(uB, v0, yB), P(uB, v1, yB), P(uA, v1, yA), col);
    };

    /** down-facing flat quad */
    const botQ = (t0: number, t1: number, v0: number, v1: number, y: number, col: THREE.Color): void => {
      const uA = Math.min(U(t0), U(t1));
      const uB = Math.max(U(t0), U(t1));
      sink.horzDown(P(uA, v0, y), P(uB, v0, y), P(uB, v1, y), P(uA, v1, y), col);
    };

    // ---- flight: 5 step boxes (top + riser + two tiny sides) --------------
    for (let i = 0; i < STEPS; i++) {
      const t0 = fs + i * run;
      const t1 = t0 + run;
      const yPrev = y0 + i * rise;
      const yTop = y0 + (i + 1) * rise;
      topQ(t0, yTop, t1, yTop, -stepHalf, stepHalf, tread);
      crossWall(t0, -stepHalf, stepHalf, yPrev, yTop, -1, riser);
      sideWall(stepHalf, t0, yPrev, yTop, t1, yPrev, yTop, 1, tread);
      sideWall(-stepHalf, t0, yPrev, yTop, t1, yPrev, yTop, -1, tread);
    }

    // ---- turnaround landing (full stair width) + end wall -----------------
    topQ(fe, y1, uHalf, y1, -swl, swl, tread);
    crossWall(uHalf, -swl, swl, y0, y1, 1, tread);

    // ---- back wall at the turnaround (between the side parapets) ----------
    const backHalf = stepHalf;
    crossWall(uHalf - pt, -backHalf, backHalf, y1, y1 + PARAPET_RISE, -1, para);
    crossWall(uHalf, -backHalf, backHalf, y1, y1 + PARAPET_RISE, 1, para);
    topQ(uHalf - pt, y1 + PARAPET_RISE, uHalf, y1 + PARAPET_RISE, -backHalf, backHalf, para);
    sideWall(backHalf, uHalf - pt, y1, y1 + PARAPET_RISE, uHalf, y1, y1 + PARAPET_RISE, 1, para);
    sideWall(-backHalf, uHalf - pt, y1, y1 + PARAPET_RISE, uHalf, y1, y1 + PARAPET_RISE, -1, para);

    // ---- side parapet bands (double as skirts: outer face drops to y0) ----
    const slope0 = y0 + PARAPET_RISE;
    const slope1 = y1 + PARAPET_RISE;
    for (const sg of [1, -1] as const) {
      const vOut = sg * swl;
      const vIn = sg * wIn;
      const vLo = Math.min(vOut, vIn);
      const vHi = Math.max(vOut, vIn);
      // flight band — sloped parapet, outer wall sealing the storey side
      sideWall(vOut, fs, y0, slope0, fe, y0, slope1, sg, para);
      sideWall(vIn, fs, y0, slope0, fe, y0, slope1, -sg, para);
      topQ(fs, slope0, fe, slope1, vLo, vHi, para);
      // end-zone band over the landing
      sideWall(vOut, fe, y0, slope1, uHalf, y0, slope1, sg, para);
      sideWall(vIn, fe, y0, slope1, uHalf, y0, slope1, -sg, para);
      topQ(fe, slope1, uHalf, slope1, vLo, vHi, para);
      crossWall(uHalf, vLo, vHi, y1, slope1, 1, para); // cap above the end wall
      if (l === 0) {
        // start-zone band alongside the ground pad
        sideWall(vOut, -uHalf, y0, slope0, fs, y0, slope0, sg, para);
        sideWall(vIn, -uHalf, y0, slope0, fs, y0, slope0, -sg, para);
        topQ(-uHalf, slope0, fs, slope0, vLo, vHi, para);
        crossWall(-uHalf, vLo, vHi, y0, slope0, -1, para);
      } else {
        crossWall(fs, vLo, vHi, y0, slope0, -1, para); // band front cap
      }
    }

    if (l === 0) {
      // ---- ground landing pad (raised 0.02 to avoid z-fighting the land) --
      const padTop = y0 + 0.02;
      topQ(-uHalf, padTop, fs, padTop, -stepHalf, stepHalf, tread);
      crossWall(-uHalf, -stepHalf, stepHalf, y0, padTop, -1, tread);
      sideWall(stepHalf, -uHalf, y0, padTop, fs, y0, padTop, 1, tread);
      sideWall(-stepHalf, -uHalf, y0, padTop, fs, y0, padTop, -1, tread);
    } else {
      // ---- bottom cap sealing the storey mass from below ------------------
      // (start zone belongs to the previous storey's landing below)
      botQ(fs, uHalf, -swl, swl, y0, tread);
    }
  }
}
