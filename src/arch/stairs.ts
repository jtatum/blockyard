/**
 * Staircase special builds (product §8; Townscaper's placed-block triggers).
 *
 * SMALL (the switchback tower): a placed column 1..5 blocks tall squeezed
 * between two ≥2-cell-long buildings that STRICTLY overtop it on roughly
 * opposite edges — with at least one open non-flank side as the approach —
 * is re-read as a solid masonry stair tower climbing exactly the column's
 * height: per storey a straight 5-step flight with a landing at the
 * turnaround end, climb direction alternating each storey, low parapets, a
 * back wall at each turnaround, and closed skirts/bottom caps so the mass
 * never reads hollow. Stack the trigger column higher (while the flanks stay
 * taller) and the stairs climb with it; erase it and the alley returns. The
 * strict-overtop + open-approach rules are what keep a uniformly filled
 * building reading as a building instead of a stairwell farm.
 *
 * LARGE (the plaza stair): a single placed block whose strict-opposite
 * flanks are ≥2 storeys, with a flat one-storey plaza directly behind and
 * open walkable land in front, becomes monumental full-width steps from the
 * ground up to the plaza deck.
 *
 * Detection is deterministic (CD4 — no random gate). The claimed cells are
 * excluded from outline/roof derivation by the mesher, so flank walls and
 * plaza eaves render around the stairs exactly as around an open gap. All
 * color jitter comes from rng(grid.seed, 'stairs', cell, storey).
 */

import * as THREE from 'three';
import { LAND_TOP, levelY } from '../core/constants';
import { rng } from '../core/rng';
import type { Grid, GridCell } from '../grid/grid';
import type { Town } from '../town/town';
import type { GeoSink, P3 } from './geom';

export type StairKind = 'small' | 'large';

export interface StairSpec {
  kind: StairKind;
  /** the placed trigger cell the stairs replace */
  cell: number;
  /** small: the cell's edge facing flank A (climb axis A→B).
   *  large: the cell's edge facing the open approach (steps start there). */
  kA: number;
  /** small: flank A. large: the open approach cell in front. */
  cellA: number;
  /** small: flank B. large: the plaza cell behind. */
  cellB: number;
  /** large only: the ≥2-storey flanking cells (-1 for small) */
  flankL: number;
  flankR: number;
  /** storeys climbed (small: the trigger column height, 1..5; large: 1) */
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

/** ground-rooted and at least two storeys */
function twoTall(town: Town, c: number): boolean {
  return c >= 0 && town.isFilled(c, 0) && town.isFilled(c, 1);
}

/** the flank belongs to a mass ≥2 cells at two storeys (Townscaper's "2 long") */
function longFlank(town: Town, grid: Grid, flank: number, stairCell: number): boolean {
  for (const q of grid.cells[flank]!.neighbors) {
    if (q >= 0 && q !== stairCell && twoTall(town, q)) return true;
  }
  return false;
}

/** a flat one-storey deck cell that continues into at least one more deck cell */
function plazaish(town: Town, grid: Grid, p: number, stairCell: number): boolean {
  const deck = (c: number): boolean =>
    c >= 0 && town.isFilled(c, 0) && !town.isFilled(c, 1);
  if (!deck(p)) return false;
  for (const q of grid.cells[p]!.neighbors) {
    if (q !== stairCell && deck(q)) return true;
  }
  return false;
}

function matchLarge(town: Town, grid: Grid, cell: GridCell): StairSpec | null {
  for (const kL of [0, 1]) {
    const L = cell.neighbors[kL]!;
    const R = cell.neighbors[kL + 2]!;
    if (!twoTall(town, L) || !twoTall(town, R)) continue;
    for (const kF of [(kL + 1) % 4, (kL + 3) % 4]) {
      const kB = (kF + 2) % 4;
      const front = cell.neighbors[kF]!;
      const back = cell.neighbors[kB]!;
      if (front < 0 || town.filled[front] !== 0 || !town.isLand(front)) continue;
      if (!plazaish(town, grid, back, cell.id)) continue;
      return {
        kind: 'large',
        cell: cell.id,
        kA: kF,
        cellA: front,
        cellB: back,
        flankL: L,
        flankR: R,
        levels: 1,
      };
    }
  }
  return null;
}

function matchSmall(town: Town, grid: Grid, cell: GridCell, h: number): StairSpec | null {
  // stairs live in an alley SLOT, not inside a solid mass: at least one
  // non-flank side must be open air (this is what keeps a uniformly-filled
  // building's interior from being re-read as a forest of stair towers)
  const open = (k: number): boolean => {
    const n = cell.neighbors[k]!;
    return n >= 0 && town.filled[n] === 0;
  };
  for (let kA = 0; kA < 4; kA++) {
    const a = cell.neighbors[kA]!;
    if (!twoTall(town, a)) continue;
    const kB = oppositeEdgeOf(grid, cell, kA);
    if (kB < 0) continue;
    const b = cell.neighbors[kB]!;
    if (b < 0 || b === a || !twoTall(town, b)) continue;
    // flanks must overtop the stairs ("lock them in place") — equal height
    // is just more building, which also keeps flat slabs reading as slabs
    if (Math.min(town.columnHeight(a), town.columnHeight(b)) < Math.max(2, h + 1)) continue;
    if (!longFlank(town, grid, a, cell.id) || !longFlank(town, grid, b, cell.id)) continue;
    let hasApproach = false;
    for (let k = 0; k < 4 && !hasApproach; k++) {
      if (k !== kA && k !== kB && open(k)) hasApproach = true;
    }
    if (!hasApproach) continue;
    return {
      kind: 'small',
      cell: cell.id,
      kA,
      cellA: a,
      cellB: b,
      flankL: -1,
      flankR: -1,
      levels: h,
    };
  }
  return null;
}

/**
 * A trigger cell qualifies iff it is LAND and its column is contiguous from
 * the ground, 1..5 blocks tall. Large stairs (plaza behind, opening in
 * front, single block) take precedence over small; one spec per cell.
 */
export function detectStairs(town: Town): StairSpec[] {
  const grid = town.grid;
  const out: StairSpec[] = [];
  for (const cell of grid.cells) {
    const mask = town.filled[cell.id]!;
    if (mask === 0 || !town.isLand(cell.id)) continue;
    const h = 32 - Math.clz32(mask);
    if (h > 5 || mask !== (1 << h) - 1) continue; // contiguous ground column only
    const spec =
      (h === 1 ? matchLarge(town, grid, cell) : null) ?? matchSmall(town, grid, cell, h);
    if (spec) out.push(spec);
  }
  return out;
}

/** stable dirty-diff signature (mirrors recipeSignature's value-carrying style) */
export function stairsSignature(spec: StairSpec): string {
  return `S${spec.kind[0]}${spec.cell},${spec.kA},${spec.cellA},${spec.cellB},${spec.flankL},${spec.flankR},${spec.levels}`;
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

const LARGE_STEPS = 8;
const LARGE_STONE = 0xbdb4a6;

/**
 * Emit the monumental plaza staircase: full-width steps climbing the trigger
 * cell from the open approach edge (kA) up to the plaza deck at levelY(1).
 * The tread field is a bilinear patch between the approach edge and its
 * strict opposite, inset a hair from the side edges where the flank walls
 * stand; per-step side skirts close the slivers the wall fillets expose.
 */
export function emitLargeStairs(sink: GeoSink, town: Town, spec: StairSpec): void {
  const grid = town.grid;
  const c = grid.cells[spec.cell];
  if (!c) return;
  const kF = spec.kA;

  // bilinear frame: t=0 on the approach edge kF, t=1 on edge kF+2;
  // s follows the flank side edges (s=0 tracks edge kF+3 reversed)
  const f0 = grid.corner(c, kF);
  const f1 = grid.corner(c, kF + 1);
  const g0 = grid.corner(c, kF + 3);
  const g1 = grid.corner(c, kF + 2);
  const P = (t: number, s: number, y: number): P3 => {
    const fx = f0.x + (f1.x - f0.x) * s;
    const fy = f0.y + (f1.y - f0.y) * s;
    const gx = g0.x + (g1.x - g0.x) * s;
    const gy = g0.y + (g1.y - g0.y) * s;
    return { x: fx + (gx - fx) * t, y, z: fy + (gy - fy) * t };
  };
  const sLo = 0.02;
  const sHi = 0.98;

  const r = rng(grid.seed, 'stairs', spec.cell, 'large');
  const tread = new THREE.Color(LARGE_STONE).offsetHSL(
    r.range(-0.01, 0.01),
    r.range(-0.02, 0.02),
    r.range(-0.03, 0.03)
  );
  const riser = tread.clone().offsetHSL(0, 0, -0.055);

  const y0 = LAND_TOP;
  const y1 = levelY(1);
  const rise = (y1 - y0) / LARGE_STEPS;

  for (let i = 0; i < LARGE_STEPS; i++) {
    const t0 = i / LARGE_STEPS;
    const t1 = (i + 1) / LARGE_STEPS;
    const yLo = y0 + i * rise;
    const yHi = y0 + (i + 1) * rise;
    // riser at t0, facing the approach (−t)
    sink.quad(P(t0, sLo, yLo), P(t0, sLo, yHi), P(t0, sHi, yHi), P(t0, sHi, yLo), riser);
    // tread (up-facing)
    sink.quad(P(t0, sLo, yHi), P(t1, sLo, yHi), P(t1, sHi, yHi), P(t0, sHi, yHi), tread);
    // side skirts down to the ground, closing the fillet slivers
    sink.quad(P(t0, sHi, y0), P(t0, sHi, yHi), P(t1, sHi, yHi), P(t1, sHi, y0), tread);
    sink.quad(P(t1, sLo, y0), P(t1, sLo, yHi), P(t0, sLo, yHi), P(t0, sLo, y0), tread);
  }
}
