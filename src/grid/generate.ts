/**
 * System A — organic irregular quad grid (tech doc §2.2).
 * Pipeline: triangular lattice in a hex region → seed-shuffled greedy merge of
 * triangle pairs into quads → quadrangulating subdivision (quads→4, leftover
 * tris→3, guaranteeing an all-quad mesh) → best-fit-square relaxation with
 * pinned boundary → bake adjacency.
 *
 * Determinism note: this path uses only +,-,*,/ and sqrt (IEEE exact-rounded
 * in JS) plus the seeded RNG — no sin/cos/atan2 — so the same seed yields a
 * bit-identical grid on every engine.
 */

import { rng } from '../core/rng';
import { Grid, type GridCell, type GridVertex } from './grid';

const SQRT3_2 = Math.sqrt(3) / 2;

export interface GridParams {
  seed: number;
  /** hexagon radius in triangle-lattice units */
  hexRadius: number;
  /** triangle edge length in world units (final cell size ≈ half this) */
  triEdge: number;
  relaxIterations: number;
  relaxStep: number;
}

export const DEFAULT_GRID: GridParams = {
  seed: 1337,
  hexRadius: 10,
  triEdge: 2.4,
  relaxIterations: 120,
  relaxStep: 0.2,
};

interface Pt { x: number; y: number }

export function generateGrid(params: Partial<GridParams> = {}): Grid {
  const p = { ...DEFAULT_GRID, ...params };
  const R = p.hexRadius;

  // -- 1. triangular lattice bounded to a hexagon ---------------------------
  const latticeIds = new Map<string, number>();
  const points: Pt[] = [];
  const inHex = (q: number, r: number) =>
    Math.abs(q) <= R && Math.abs(r) <= R && Math.abs(q + r) <= R;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      if (!inHex(q, r)) continue;
      latticeIds.set(q + ',' + r, points.length);
      points.push({ x: (q + r / 2) * p.triEdge, y: r * SQRT3_2 * p.triEdge });
    }
  }
  const lid = (q: number, r: number) => latticeIds.get(q + ',' + r);

  // -- 2. triangles (both CCW) ----------------------------------------------
  const tris: [number, number, number][] = [];
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const a = lid(q, r), b = lid(q + 1, r), c = lid(q, r + 1), d = lid(q + 1, r + 1);
      if (a !== undefined && b !== undefined && c !== undefined) tris.push([a, b, c]);
      if (b !== undefined && d !== undefined && c !== undefined) tris.push([b, d, c]);
    }
  }

  // -- 3. greedy random merge of triangle pairs into quads ------------------
  // interior edges: sorted vertex pair -> [triIndex, triIndex]
  const edgeTris = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = t[k]!, b = t[(k + 1) % 3]!;
      const key = Math.min(a, b) + ',' + Math.max(a, b);
      let arr = edgeTris.get(key);
      if (!arr) edgeTris.set(key, (arr = []));
      arr.push(ti);
    }
  });
  const interior: [number, number, string][] = [];
  for (const [key, arr] of edgeTris) {
    if (arr.length === 2) interior.push([arr[0]!, arr[1]!, key]);
  }
  rng(p.seed, 'merge').shuffle(interior);

  const merged = new Array<boolean>(tris.length).fill(false);
  const faces: number[][] = []; // polygon faces (quads + leftover tris), CCW
  for (const [ta, tb, key] of interior) {
    if (merged[ta] || merged[tb]) continue;
    merged[ta] = merged[tb] = true;
    const [sa, sb] = key.split(',').map(Number) as [number, number];
    const t1 = tris[ta]!;
    // orient shared edge as it appears in t1 (v0 -> v1), apex of t1 is v2
    let v0 = -1, v1 = -1, v2 = -1;
    for (let k = 0; k < 3; k++) {
      const a = t1[k]!, b = t1[(k + 1) % 3]!;
      if ((a === sa && b === sb) || (a === sb && b === sa)) {
        v0 = a; v1 = b; v2 = t1[(k + 2) % 3]!;
        break;
      }
    }
    const t2 = tris[tb]!;
    const w = t2.find((v) => v !== sa && v !== sb)!;
    faces.push([v0, w, v1, v2]); // CCW union of the two CCW triangles
  }
  tris.forEach((t, ti) => {
    if (!merged[ti]) faces.push([...t]);
  });

  // -- 4. quadrangulating subdivision (every n-gon -> n quads) ---------------
  const verts: Pt[] = points.map((pt) => ({ ...pt }));
  const midIds = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    let id = midIds.get(key);
    if (id === undefined) {
      id = verts.length;
      verts.push({ x: (verts[a]!.x + verts[b]!.x) / 2, y: (verts[a]!.y + verts[b]!.y) / 2 });
      midIds.set(key, id);
    }
    return id;
  };
  const quads: [number, number, number, number][] = [];
  for (const face of faces) {
    const n = face.length;
    let cx = 0, cy = 0;
    for (const vi of face) { cx += verts[vi]!.x; cy += verts[vi]!.y; }
    const fid = verts.length;
    verts.push({ x: cx / n, y: cy / n });
    const mids = face.map((vi, k) => midpoint(vi, face[(k + 1) % n]!));
    for (let k = 0; k < n; k++) {
      quads.push([face[k]!, mids[k]!, fid, mids[(k - 1 + n) % n]!]);
    }
  }

  // -- 5. adjacency + boundary ------------------------------------------------
  // edge key -> [cellId, edgeIndexInCell][]
  const quadEdges = new Map<string, [number, number][]>();
  quads.forEach((qd, qi) => {
    for (let k = 0; k < 4; k++) {
      const a = qd[k]!, b = qd[(k + 1) % 4]!;
      const key = Math.min(a, b) + ',' + Math.max(a, b);
      let arr = quadEdges.get(key);
      if (!arr) quadEdges.set(key, (arr = []));
      arr.push([qi, k]);
    }
  });
  const boundary = new Array<boolean>(verts.length).fill(false);
  for (const [key, arr] of quadEdges) {
    if (arr.length === 1) {
      const [a, b] = key.split(',').map(Number) as [number, number];
      boundary[a] = boundary[b] = true;
    }
  }

  // -- 6. relaxation: pull every quad toward its best-fit square --------------
  // target corner radius from mean quad area (uniform target -> even cells)
  let areaSum = 0;
  for (const qd of quads) {
    let a2 = 0;
    for (let k = 0; k < 4; k++) {
      const va = verts[qd[k]!]!, vb = verts[qd[(k + 1) % 4]!]!;
      a2 += va.x * vb.y - vb.x * va.y;
    }
    areaSum += a2 / 2;
  }
  const targetR = Math.sqrt(areaSum / quads.length) * Math.SQRT1_2; // side/√2

  const forceX = new Float64Array(verts.length);
  const forceY = new Float64Array(verts.length);
  const forceN = new Float64Array(verts.length);
  for (let iter = 0; iter < p.relaxIterations; iter++) {
    forceX.fill(0); forceY.fill(0); forceN.fill(0);
    for (const qd of quads) {
      let cx = 0, cy = 0;
      for (const vi of qd) { cx += verts[vi]!.x; cy += verts[vi]!.y; }
      cx /= 4; cy /= 4;
      // v = mean of corner offsets each rotated by -k·90° (CW k times):
      // rotCW(x,y) = (y, -x)
      let vx = 0, vy = 0;
      for (let k = 0; k < 4; k++) {
        let dx = verts[qd[k]!]!.x - cx;
        let dy = verts[qd[k]!]!.y - cy;
        for (let j = 0; j < k; j++) { const t = dx; dx = dy; dy = -t; }
        vx += dx; vy += dy;
      }
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      vx = (vx / len) * targetR;
      vy = (vy / len) * targetR;
      // ideal corner k = centroid + rotCCW^k(v);  rotCCW(x,y) = (-y, x)
      for (let k = 0; k < 4; k++) {
        const vi = qd[k]!;
        forceX[vi] += cx + vx - verts[vi]!.x;
        forceY[vi] += cy + vy - verts[vi]!.y;
        forceN[vi]++;
        const t = vx; vx = -vy; vy = t;
      }
    }
    for (let vi = 0; vi < verts.length; vi++) {
      if (boundary[vi] || forceN[vi] === 0) continue;
      verts[vi]!.x += (forceX[vi]! / forceN[vi]!) * p.relaxStep;
      verts[vi]!.y += (forceY[vi]! / forceN[vi]!) * p.relaxStep;
    }
  }

  // -- 7. bake ---------------------------------------------------------------
  const gridVerts: GridVertex[] = verts.map((pt, i) => ({
    id: i,
    x: pt.x,
    y: pt.y,
    boundary: boundary[i]!,
    cells: [],
  }));
  const cells: GridCell[] = quads.map((qd, qi) => {
    let cx = 0, cy = 0;
    for (const vi of qd) {
      cx += verts[vi]!.x;
      cy += verts[vi]!.y;
      gridVerts[vi]!.cells.push(qi);
    }
    return {
      id: qi,
      corners: [...qd] as [number, number, number, number],
      neighbors: [-1, -1, -1, -1],
      cx: cx / 4,
      cy: cy / 4,
    };
  });
  for (const arr of quadEdges.values()) {
    if (arr.length === 2) {
      const [[qa, ka], [qb, kb]] = arr as [[number, number], [number, number]];
      cells[qa]!.neighbors[ka] = qb;
      cells[qb]!.neighbors[kb] = qa;
    }
  }

  return new Grid(p.seed, gridVerts, cells);
}
