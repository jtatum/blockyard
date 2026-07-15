/**
 * Smoothed building outlines — the curved-silhouette system.
 *
 * For every level, connected filled regions get their boundary walked into
 * loops, then every corner is filleted: the sharp vertex is replaced by a
 * two-segment bulged chamfer. Walls, eaves and parapets all follow these
 * smoothed loops, so irregular buildings read as gently curved masses and an
 * isolated one-cell tower's four corners round it into a ~12-gon cylinder —
 * which is exactly how the lighthouse becomes a lighthouse.
 *
 * Segments remember which (cell, edge) they came from: color, windows, doors
 * and all seeded decoration stay keyed on stable ids, so smoothing never
 * scrambles existing art (product C6 spirit).
 */

import { MAX_LEVELS } from '../core/constants';
import type { Grid } from '../grid/grid';
import type { Town } from '../town/town';

export interface OSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** owning cell (color, decoration seed) */
  cell: number;
  /** original edge index within the owning cell */
  k: number;
  /** true for the straight mid-part of an original edge (window/door host) */
  central: boolean;
  /** loop-smoothed outward normals at each endpoint (grid coords) — these
   *  are what make filleted corners SHADE round instead of faceted */
  nax: number;
  nay: number;
  nbx: number;
  nby: number;
}

export interface Outline {
  level: number;
  cells: Set<number>;
  loops: OSeg[][];
  /** exactly one cell — a tower; walls round fully and the roof may cone */
  single: boolean;
  /** per boundary grid-vertex: the fillet midpoint (roof surfaces shrink to it) */
  cornerPoint: Map<number, { x: number; y: number }>;
}

interface HalfEdge {
  cell: number;
  k: number;
}

/** walk boundary half-edges of a cell set into ordered loops (interior left) */
export function walkLoops(
  grid: Grid,
  inSet: (cell: number) => boolean,
  cells: Iterable<number>
): HalfEdge[][] {
  const edges: HalfEdge[] = [];
  const byStart = new Map<number, HalfEdge[]>();
  for (const ci of cells) {
    const c = grid.cells[ci]!;
    for (let k = 0; k < 4; k++) {
      const n = c.neighbors[k]!;
      if (n >= 0 && inSet(n)) continue;
      const e = { cell: ci, k };
      edges.push(e);
      const start = c.corners[k]!;
      let arr = byStart.get(start);
      if (!arr) byStart.set(start, (arr = []));
      arr.push(e);
    }
  }
  const used = new Set<string>();
  const dirOf = (he: HalfEdge): { x: number; y: number } => {
    const c = grid.cells[he.cell]!;
    const a = grid.vertices[c.corners[he.k]!]!;
    const b = grid.vertices[c.corners[(he.k + 1) % 4]!]!;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const loops: HalfEdge[][] = [];
  for (const e0 of edges) {
    if (used.has(e0.cell + ':' + e0.k)) continue;
    const loop: HalfEdge[] = [];
    let e: HalfEdge | undefined = e0;
    while (e) {
      const key = e.cell + ':' + e.k;
      if (used.has(key)) break;
      used.add(key);
      loop.push(e);
      const endV: number = grid.cells[e.cell]!.corners[(e.k + 1) % 4]!;
      const candidates = (byStart.get(endV) ?? []).filter((c) => !used.has(c.cell + ':' + c.k));
      if (candidates.length <= 1) {
        e = candidates[0];
      } else {
        // pinch vertex — several boundary edges continue from here. Take the
        // sharpest LEFT turn (interior stays left, loops never cross). The
        // choice depends only on geometry, never on flood-fill discovery
        // order, so remote edits cannot silently re-pair distant loops
        // (determinism law: derived geometry is a pure function of state).
        const din = dirOf(e);
        let best: HalfEdge | undefined;
        let bestAngle = -Infinity;
        for (const c of candidates) {
          const dout = dirOf(c);
          const angle = Math.atan2(
            din.x * dout.y - din.y * dout.x,
            din.x * dout.x + din.y * dout.y
          );
          if (angle > bestAngle) {
            bestAngle = angle;
            best = c;
          }
        }
        e = best;
      }
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}

/** max distance cut back from a corner along each edge */
const CUT_CAP = 0.24;
const CUT_FRAC = 0.3;
const SINGLE_FRAC = 0.42;
/** arc quality: bezier samples per corner (towers rounder than buildings) */
const ARC_STEPS = 3;
const SINGLE_ARC_STEPS = 4;

/**
 * Fillet a loop of half-edges into smoothed segments.
 * Each original edge keeps a straight central piece (window host); each
 * corner becomes a quadratic-bezier arc (control point = the original
 * corner) sampled into short segments. Loop-smoothed endpoint normals are
 * attached so curves also SHADE round.
 */
export function smoothLoop(
  grid: Grid,
  loop: HalfEdge[],
  single: boolean,
  cornerPoint?: Map<number, { x: number; y: number }>
): OSeg[] {
  const n = loop.length;
  const frac = single ? SINGLE_FRAC : CUT_FRAC;
  const cap = single ? Infinity : CUT_CAP;
  const steps = single ? SINGLE_ARC_STEPS : ARC_STEPS;

  // per edge: endpoints + length
  const pts = loop.map((e) => {
    const c = grid.cells[e.cell]!;
    const a = grid.vertices[c.corners[e.k]!]!;
    const b = grid.vertices[c.corners[(e.k + 1) % 4]!]!;
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, len: Math.hypot(b.x - a.x, b.y - a.y), vId: c.corners[(e.k + 1) % 4]! };
  });

  const raw: Omit<OSeg, 'nax' | 'nay' | 'nbx' | 'nby'>[] = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i]!;
    const nxt = pts[(i + 1) % n]!;
    const eCur = loop[i]!;
    const eNxt = loop[(i + 1) % n]!;
    // cut distances at the corner between edge i and edge i+1
    const d = Math.min(cap, frac * cur.len, frac * nxt.len);
    const dPrev = Math.min(cap, frac * cur.len, frac * pts[(i - 1 + n) % n]!.len);
    // central straight piece of edge i (from dPrev past a, to d before b)
    const ux = (cur.bx - cur.ax) / cur.len;
    const uy = (cur.by - cur.ay) / cur.len;
    const p0 = { x: cur.ax + ux * dPrev, y: cur.ay + uy * dPrev };
    const p1 = { x: cur.bx - ux * d, y: cur.by - uy * d };
    raw.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, cell: eCur.cell, k: eCur.k, central: true });

    // corner arc: quadratic bezier p1 → q0 with the original corner as control
    const vx = cur.bx;
    const vy = cur.by;
    const wx = (nxt.bx - nxt.ax) / nxt.len;
    const wy = (nxt.by - nxt.ay) / nxt.len;
    const q0 = { x: nxt.ax + wx * d, y: nxt.ay + wy * d };
    const bez = (t: number) => {
      const s = 1 - t;
      return {
        x: s * s * p1.x + 2 * s * t * vx + t * t * q0.x,
        y: s * s * p1.y + 2 * s * t * vy + t * t * q0.y,
      };
    };
    let prev = { x: p1.x, y: p1.y };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const p = bez(t);
      const midT = (t + (s - 1) / steps) / 2;
      raw.push({
        ax: prev.x, ay: prev.y, bx: p.x, by: p.y,
        cell: midT < 0.5 ? eCur.cell : eNxt.cell,
        k: midT < 0.5 ? eCur.k : eNxt.k,
        central: false,
      });
      prev = p;
    }
    cornerPoint?.set(cur.vId, bez(0.5));
  }

  // loop-smoothed endpoint normals: average the outward normals of the two
  // segments meeting at each point (collinear joins are unaffected)
  const m = raw.length;
  const segN = raw.map((s) => {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dy / len, y: -dx / len }; // outward = right of a→b
  });
  return raw.map((s, i) => {
    const nPrev = segN[(i - 1 + m) % m]!;
    const nCur = segN[i]!;
    const nNext = segN[(i + 1) % m]!;
    let nax = nPrev.x + nCur.x;
    let nay = nPrev.y + nCur.y;
    let l = Math.hypot(nax, nay) || 1;
    nax /= l;
    nay /= l;
    let nbx = nCur.x + nNext.x;
    let nby = nCur.y + nNext.y;
    l = Math.hypot(nbx, nby) || 1;
    nbx /= l;
    nby /= l;
    return { ...s, nax, nay, nbx, nby };
  });
}

/** smoothed outlines for one level's connected filled regions.
 *  `exclude` masks recipe-claimed cells (staircases) out of the wall system —
 *  they read as unfilled, so neighbors grow boundary walls facing them. */
export function computeOutlinesForLevel(
  town: Town,
  level: number,
  exclude?: ReadonlySet<number>
): Outline[] {
  const grid = town.grid;
  const outlines: Outline[] = [];
  const assigned = new Set<number>();
  const filled = (c: number): boolean => town.isFilled(c, level) && !exclude?.has(c);

  for (const start of grid.cells) {
    if (!filled(start.id) || assigned.has(start.id)) continue;
    // flood-fill the region at this level
    const cells = new Set<number>([start.id]);
    assigned.add(start.id);
    const stack = [start.id];
    while (stack.length) {
      const c = grid.cells[stack.pop()!]!;
      for (const nb of c.neighbors) {
        if (nb < 0 || cells.has(nb) || !filled(nb)) continue;
        cells.add(nb);
        assigned.add(nb);
        stack.push(nb);
      }
    }
    const single = cells.size === 1;
    const cornerPoint = new Map<number, { x: number; y: number }>();
    const loops = walkLoops(grid, filled, cells).map((loop) =>
      smoothLoop(grid, loop, single, cornerPoint)
    );
    outlines.push({ level, cells, loops, single, cornerPoint });
  }
  return outlines;
}

/** all levels (full rebuilds and tests; the mesher caches per level) */
export function computeOutlines(town: Town, exclude?: ReadonlySet<number>): Outline[] {
  const out: Outline[] = [];
  for (let level = 0; level < MAX_LEVELS; level++) {
    out.push(...computeOutlinesForLevel(town, level, exclude));
  }
  return out;
}
