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
      e = (byStart.get(endV) ?? []).find((c) => !used.has(c.cell + ':' + c.k));
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}

/** max distance cut back from a corner along each edge */
const CUT_CAP = 0.24;
const CUT_FRAC = 0.3;
const SINGLE_FRAC = 0.42;
/** how far the chamfer midpoint bulges back toward the original corner */
const BULGE = 0.45;

/**
 * Fillet a loop of half-edges into smoothed segments.
 * Each original edge keeps a straight central piece (window host); each
 * corner becomes two short bulged pieces owned by the adjacent edges' cells.
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

  // per edge: endpoints + length
  const pts = loop.map((e) => {
    const c = grid.cells[e.cell]!;
    const a = grid.vertices[c.corners[e.k]!]!;
    const b = grid.vertices[c.corners[(e.k + 1) % 4]!]!;
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, len: Math.hypot(b.x - a.x, b.y - a.y), vId: c.corners[(e.k + 1) % 4]! };
  });

  const segs: OSeg[] = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i]!;
    const nxt = pts[(i + 1) % n]!;
    const eCur = loop[i]!;
    const eNxt = loop[(i + 1) % n]!;
    // cut distances at the corner between edge i and edge i+1
    const d = Math.min(cap, frac * cur.len, frac * nxt.len);
    const dPrev = Math.min(
      cap,
      frac * cur.len,
      frac * pts[(i - 1 + n) % n]!.len
    );
    // central straight piece of edge i (from dPrev past a, to d before b)
    const ux = (cur.bx - cur.ax) / cur.len;
    const uy = (cur.by - cur.ay) / cur.len;
    const p0 = { x: cur.ax + ux * dPrev, y: cur.ay + uy * dPrev };
    const p1 = { x: cur.bx - ux * d, y: cur.by - uy * d };
    segs.push({ ax: p0.x, ay: p0.y, bx: p1.x, by: p1.y, cell: eCur.cell, k: eCur.k, central: true });

    // fillet across the corner at V = end of edge i: p1 -> M -> q0
    const vx = cur.bx;
    const vy = cur.by;
    const wx = (nxt.bx - nxt.ax) / nxt.len;
    const wy = (nxt.by - nxt.ay) / nxt.len;
    const q0 = { x: nxt.ax + wx * d, y: nxt.ay + wy * d };
    const mx = (p1.x + q0.x) / 2 + (vx - (p1.x + q0.x) / 2) * BULGE;
    const my = (p1.y + q0.y) / 2 + (vy - (p1.y + q0.y) / 2) * BULGE;
    segs.push({ ax: p1.x, ay: p1.y, bx: mx, by: my, cell: eCur.cell, k: eCur.k, central: false });
    segs.push({ ax: mx, ay: my, bx: q0.x, by: q0.y, cell: eNxt.cell, k: eNxt.k, central: false });
    cornerPoint?.set(cur.vId, { x: mx, y: my });
  }
  return segs;
}

/** all smoothed outlines for every level's connected filled regions */
export function computeOutlines(town: Town): Outline[] {
  const grid = town.grid;
  const outlines: Outline[] = [];
  const assigned = new Set<string>();

  for (const start of grid.cells) {
    for (let level = 0; level < MAX_LEVELS; level++) {
      if (!town.isFilled(start.id, level)) continue;
      const key = start.id + ':' + level;
      if (assigned.has(key)) continue;
      // flood-fill the region at this level
      const cells = new Set<number>([start.id]);
      assigned.add(key);
      const stack = [start.id];
      while (stack.length) {
        const c = grid.cells[stack.pop()!]!;
        for (const nb of c.neighbors) {
          if (nb < 0 || cells.has(nb) || !town.isFilled(nb, level)) continue;
          cells.add(nb);
          assigned.add(nb + ':' + level);
          stack.push(nb);
        }
      }
      const single = cells.size === 1;
      const cornerPoint = new Map<number, { x: number; y: number }>();
      const loops = walkLoops(grid, (c) => town.isFilled(c, level), cells).map((loop) =>
        smoothLoop(grid, loop, single, cornerPoint)
      );
      outlines.push({ level, cells, loops, single, cornerPoint });
    }
  }
  return outlines;
}
