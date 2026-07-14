/**
 * Baked, immutable irregular quad grid (tech doc §2.3).
 * Generated once from a seed by generate.ts; everything downstream
 * (town state, solver, mesher, picking) queries this structure.
 */

export interface GridVertex {
  id: number;
  x: number;
  y: number; // grid plane coords; rendered as (x, z) in three.js space
  boundary: boolean;
  /** ids of cells incident to this vertex (unordered) */
  cells: number[];
}

export interface GridCell {
  id: number;
  /** 4 vertex ids, CCW */
  corners: [number, number, number, number];
  /** neighbor cell id across edge k (corners[k] -> corners[k+1]), or -1 */
  neighbors: [number, number, number, number];
  cx: number;
  cy: number;
}

const BIN = 4; // spatial-hash bin size in world units

export class Grid {
  readonly seed: number;
  readonly vertices: GridVertex[];
  readonly cells: GridCell[];
  /** approximate mean cell edge length — the world's characteristic scale */
  readonly cellSize: number;
  private bins = new Map<string, number[]>();

  constructor(seed: number, vertices: GridVertex[], cells: GridCell[]) {
    this.seed = seed;
    this.vertices = vertices;
    this.cells = cells;

    let edgeSum = 0;
    let edgeCount = 0;
    for (const c of cells) {
      for (let k = 0; k < 4; k++) {
        const a = vertices[c.corners[k]!]!;
        const b = vertices[c.corners[(k + 1) % 4]!]!;
        edgeSum += Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        edgeCount++;
      }
      // spatial hash by AABB
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const vi of c.corners) {
        const v = vertices[vi]!;
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      for (let bx = Math.floor(minX / BIN); bx <= Math.floor(maxX / BIN); bx++) {
        for (let by = Math.floor(minY / BIN); by <= Math.floor(maxY / BIN); by++) {
          const key = bx + ',' + by;
          let arr = this.bins.get(key);
          if (!arr) this.bins.set(key, (arr = []));
          arr.push(c.id);
        }
      }
    }
    this.cellSize = edgeCount > 0 ? edgeSum / edgeCount : 1;
  }

  corner(cell: GridCell, k: number): GridVertex {
    return this.vertices[cell.corners[((k % 4) + 4) % 4]!]!;
  }

  /** id of the cell containing point (x, y), or -1 */
  cellAt(x: number, y: number): number {
    const key = Math.floor(x / BIN) + ',' + Math.floor(y / BIN);
    const candidates = this.bins.get(key);
    if (!candidates) return -1;
    for (const ci of candidates) {
      if (this.contains(this.cells[ci]!, x, y)) return ci;
    }
    return -1;
  }

  contains(cell: GridCell, x: number, y: number): boolean {
    // convex CCW quad: point is inside iff left of every edge
    for (let k = 0; k < 4; k++) {
      const a = this.vertices[cell.corners[k]!]!;
      const b = this.vertices[cell.corners[(k + 1) % 4]!]!;
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  }

  /** cell ids whose AABB-bins a segment from (x0,y0) to (x1,y1) passes through */
  cellsAlong(x0: number, y0: number, x1: number, y1: number): Set<number> {
    const out = new Set<number>();
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (BIN * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const key =
        Math.floor((x0 + (x1 - x0) * t) / BIN) + ',' + Math.floor((y0 + (y1 - y0) * t) / BIN);
      const arr = this.bins.get(key);
      if (arr) for (const ci of arr) out.add(ci);
    }
    return out;
  }

  /** midpoint of edge k of a cell */
  edgeMid(cell: GridCell, k: number): { x: number; y: number } {
    const a = this.corner(cell, k);
    const b = this.corner(cell, k + 1);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** outward unit normal of edge k (perpendicular, pointing away from centroid) */
  edgeNormal(cell: GridCell, k: number): { x: number; y: number } {
    const a = this.corner(cell, k);
    const b = this.corner(cell, k + 1);
    // CCW winding: outward normal is (dy, -dx) normalized
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    return { x: nx / len, y: ny / len };
  }

  /** grid invariant check used by tests and the generator (never in the hot path) */
  validate(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    for (const c of this.cells) {
      // convexity + winding: all cross products strictly positive
      let minCross = Infinity;
      let area = 0;
      for (let k = 0; k < 4; k++) {
        const a = this.corner(c, k);
        const b = this.corner(c, k + 1);
        const d = this.corner(c, k + 2);
        const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
        minCross = Math.min(minCross, cross);
        area += a.x * b.y - b.x * a.y;
      }
      area /= 2;
      if (minCross <= 1e-6) problems.push(`cell ${c.id} non-convex (minCross=${minCross})`);
      if (area < 0.05) problems.push(`cell ${c.id} degenerate area ${area}`);
      for (let k = 0; k < 4; k++) {
        const n = c.neighbors[k]!;
        if (n >= 0) {
          const nc = this.cells[n];
          if (!nc) problems.push(`cell ${c.id} neighbor ${n} missing`);
          else if (!nc.neighbors.includes(c.id))
            problems.push(`cell ${c.id} <-> ${n} adjacency not symmetric`);
        }
      }
    }
    return { ok: problems.length === 0, problems };
  }
}
