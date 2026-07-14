/**
 * Roof system. Top-exposed voxels form connected regions per (level, roof
 * kind); pitched regions get a hip-roof heightfield — roof height rises with
 * distance from the region boundary (multi-source Dijkstra over the corner
 * graph), capped at a ridge height. Ridgelines, hips, and valleys emerge from
 * the footprint automatically, which is what makes joined buildings read as
 * one continuous roof on an irregular grid.
 */

import * as THREE from 'three';
import { levelY, MAX_LEVELS } from '../core/constants';
import { hashKey } from '../core/rng';
import type { Grid } from '../grid/grid';
import { PALETTE, type RoofKind } from '../town/palette';
import type { Town } from '../town/town';
import { GeoSink } from './geom';

const SLOPE = 0.62;
const MAX_RISE = 0.8;
const OVERHANG = 0.16;
const EAVE_DROP = 0.1;
const FASCIA = 0.09;
const PARAPET_H = 0.2;
const PARAPET_T = 0.11;

export interface RoofRegion {
  id: number;
  level: number;
  kind: RoofKind;
  cells: Set<number>;
  /** corner-vertex heights (world Y of the roof surface) */
  vertexY: Map<number, number>;
  /** centroid heights per cell */
  centerY: Map<number, number>;
  /** ordered boundary loops as half-edges (cell, k) */
  loops: { cell: number; k: number }[][];
  /** per-vertex mitred outward offset for eaves/parapets: vertexId -> (x, z) */
  miter: Map<number, { x: number; z: number }>;
}

/** top-exposed voxel = filled with empty above */
function isTopExposed(town: Town, cell: number, level: number): boolean {
  return town.isFilled(cell, level) && !town.isFilled(cell, level + 1);
}

export function roofKindOf(town: Town, cell: number, level: number): RoofKind {
  return PALETTE[town.colorAt(cell, level)]!.roof;
}

export function computeRoofRegions(town: Town): RoofRegion[] {
  const grid = town.grid;
  const regions: RoofRegion[] = [];
  const assigned = new Map<string, number>(); // "cell:level" -> region id

  for (const start of grid.cells) {
    for (let level = 0; level < MAX_LEVELS; level++) {
      if (!isTopExposed(town, start.id, level)) continue;
      const key = start.id + ':' + level;
      if (assigned.has(key)) continue;
      const kind = roofKindOf(town, start.id, level);
      // flood fill same level + same kind
      const cells = new Set<number>([start.id]);
      assigned.set(key, regions.length);
      const stack = [start.id];
      while (stack.length) {
        const c = grid.cells[stack.pop()!]!;
        for (const n of c.neighbors) {
          if (n < 0 || cells.has(n)) continue;
          if (!isTopExposed(town, n, level)) continue;
          if (roofKindOf(town, n, level) !== kind) continue;
          cells.add(n);
          assigned.set(n + ':' + level, regions.length);
          stack.push(n);
        }
      }
      regions.push(buildRegion(grid, regions.length, level, kind, cells));
    }
  }
  return regions;
}

function buildRegion(
  grid: Grid,
  id: number,
  level: number,
  kind: RoofKind,
  cells: Set<number>
): RoofRegion {
  const baseY = levelY(level + 1);

  // boundary half-edges + boundary vertices
  const boundaryEdges: { cell: number; k: number }[] = [];
  const boundaryVerts = new Set<number>();
  for (const ci of cells) {
    const c = grid.cells[ci]!;
    for (let k = 0; k < 4; k++) {
      const n = c.neighbors[k]!;
      if (n >= 0 && cells.has(n)) continue;
      boundaryEdges.push({ cell: ci, k });
      boundaryVerts.add(c.corners[k]!);
      boundaryVerts.add(c.corners[(k + 1) % 4]!);
    }
  }

  // multi-source Dijkstra over corner graph (edges of region cells)
  const dist = new Map<number, number>();
  if (kind === 'pitched') {
    const adj = new Map<number, { v: number; w: number }[]>();
    const link = (a: number, b: number) => {
      const va = grid.vertices[a]!;
      const vb = grid.vertices[b]!;
      const w = Math.hypot(va.x - vb.x, va.y - vb.y);
      let arr = adj.get(a);
      if (!arr) adj.set(a, (arr = []));
      arr.push({ v: b, w });
    };
    for (const ci of cells) {
      const c = grid.cells[ci]!;
      for (let k = 0; k < 4; k++) {
        link(c.corners[k]!, c.corners[(k + 1) % 4]!);
        link(c.corners[(k + 1) % 4]!, c.corners[k]!);
      }
    }
    // simple priority queue (regions are small; array-based is fine)
    const pq: { v: number; d: number }[] = [];
    for (const v of boundaryVerts) {
      dist.set(v, 0);
      pq.push({ v, d: 0 });
    }
    while (pq.length) {
      let bi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i]!.d < pq[bi]!.d) bi = i;
      const { v, d } = pq.splice(bi, 1)[0]!;
      if (d > (dist.get(v) ?? Infinity)) continue;
      for (const e of adj.get(v) ?? []) {
        const nd = d + e.w;
        if (nd < (dist.get(e.v) ?? Infinity)) {
          dist.set(e.v, nd);
          pq.push({ v: e.v, d: nd });
        }
      }
    }
  }

  const roofY = (d: number) => baseY + Math.min(d * SLOPE, MAX_RISE);
  const vertexY = new Map<number, number>();
  const centerY = new Map<number, number>();
  if (kind === 'pitched') {
    for (const [v, d] of dist) vertexY.set(v, roofY(d));
    for (const ci of cells) {
      const c = grid.cells[ci]!;
      // centroid distance ≈ min corner distance + distance to that corner
      let cd = Infinity;
      for (const vi of c.corners) {
        const v = grid.vertices[vi]!;
        const d = (dist.get(vi) ?? 0) + Math.hypot(v.x - c.cx, v.y - c.cy);
        cd = Math.min(cd, d);
      }
      centerY.set(ci, roofY(cd));
    }
  }

  // walk boundary loops (next edge = the one starting at this edge's end vertex)
  const byStart = new Map<number, { cell: number; k: number }[]>();
  for (const e of boundaryEdges) {
    const start = grid.cells[e.cell]!.corners[e.k]!;
    let arr = byStart.get(start);
    if (!arr) byStart.set(start, (arr = []));
    arr.push(e);
  }
  const used = new Set<string>();
  const loops: { cell: number; k: number }[][] = [];
  for (const e0 of boundaryEdges) {
    const key0 = e0.cell + ':' + e0.k;
    if (used.has(key0)) continue;
    const loop: { cell: number; k: number }[] = [];
    let e: { cell: number; k: number } | undefined = e0;
    while (e) {
      const ekey = e.cell + ':' + e.k;
      if (used.has(ekey)) break;
      used.add(ekey);
      loop.push(e);
      const endV: number = grid.cells[e.cell]!.corners[(e.k + 1) % 4]!;
      e = (byStart.get(endV) ?? []).find((c) => !used.has(c.cell + ':' + c.k));
    }
    if (loop.length > 0) loops.push(loop);
  }

  // mitred outward offsets per boundary vertex (average of adjacent edge normals)
  const miter = new Map<number, { x: number; z: number }>();
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const cur = loop[i]!;
      const nxt = loop[(i + 1) % loop.length]!;
      const cCur = grid.cells[cur.cell]!;
      const vId = cCur.corners[(cur.k + 1) % 4]!;
      const nA = grid.edgeNormal(cCur, cur.k);
      const nB = grid.edgeNormal(grid.cells[nxt.cell]!, nxt.k);
      let mx = nA.x + nB.x;
      let mz = nA.y + nB.y;
      const len = Math.hypot(mx, mz) || 1;
      mx /= len;
      mz /= len;
      const scale = 1 / Math.max(0.45, mx * nA.x + mz * nA.y);
      miter.set(vId, { x: mx * scale, z: mz * scale });
    }
  }
  // any boundary vertex not covered (open walks): fall back to edge normal
  for (const e of boundaryEdges) {
    const c = grid.cells[e.cell]!;
    for (const vId of [c.corners[e.k]!, c.corners[(e.k + 1) % 4]!]) {
      if (!miter.has(vId)) {
        const n = grid.edgeNormal(c, e.k);
        miter.set(vId, { x: n.x, z: n.y });
      }
    }
  }

  return { id, level, kind, cells, vertexY, centerY, loops, miter };
}

const cTmp = new THREE.Color();
const cTmp2 = new THREE.Color();

/** emit the roof geometry belonging to `cellId` (its surface wedges) */
export function emitRoofCell(sink: GeoSink, town: Town, region: RoofRegion, cellId: number): void {
  const grid = town.grid;
  const c = grid.cells[cellId]!;
  const baseY = levelY(region.level + 1);
  cTmp.setHex(PALETTE[town.colorAt(cellId, region.level)]!.roofHex);
  const shade = (((hashKey(grid.seed, 'roofshade', cellId) % 100) / 100) - 0.5) * 0.05;
  cTmp.offsetHSL(0, 0, shade);

  if (region.kind === 'flat') {
    const y = baseY + 0.04;
    const p = [0, 1, 2, 3].map((k) => {
      const v = grid.corner(c, k);
      return { x: v.x, y, z: v.y };
    });
    sink.horzUp(p[0]!, p[1]!, p[2]!, p[3]!, cTmp);
    return;
  }

  // pitched: triangle fan around the centroid using the region heightfield
  const cy = region.centerY.get(cellId) ?? baseY;
  const center = { x: c.cx, y: cy, z: c.cy };
  for (let k = 0; k < 4; k++) {
    const a = grid.corner(c, k);
    const b = grid.corner(c, k + 1);
    const pa = { x: a.x, y: region.vertexY.get(a.id) ?? baseY, z: a.y };
    const pb = { x: b.x, y: region.vertexY.get(b.id) ?? baseY, z: b.y };
    sink.tri(pa, center, pb, cTmp);
  }
}

/** emit eaves (pitched) or parapets (flat) for boundary edges owned by cells in `own` */
export function emitRoofEdges(
  sink: GeoSink,
  town: Town,
  region: RoofRegion,
  own: (cell: number) => boolean
): void {
  const grid = town.grid;
  const baseY = levelY(region.level + 1);

  for (const loop of region.loops) {
    for (let i = 0; i < loop.length; i++) {
      const e = loop[i]!;
      if (!own(e.cell)) continue;
      const c = grid.cells[e.cell]!;
      const a = grid.corner(c, e.k);
      const b = grid.corner(c, e.k + 1);
      const ma = region.miter.get(a.id)!;
      const mb = region.miter.get(b.id)!;
      cTmp.setHex(PALETTE[town.colorAt(e.cell, region.level)]!.roofHex);
      cTmp2.copy(cTmp).offsetHSL(0, 0, -0.06);

      if (region.kind === 'pitched') {
        const oy = baseY - EAVE_DROP;
        const A = { x: a.x, y: baseY, z: a.y };
        const B = { x: b.x, y: baseY, z: b.y };
        const A2 = { x: a.x + ma.x * OVERHANG, y: oy, z: a.y + ma.z * OVERHANG };
        const B2 = { x: b.x + mb.x * OVERHANG, y: oy, z: b.y + mb.z * OVERHANG };
        // sloped apron (visible from above) + underside + fascia lip
        sink.quad(A, B, B2, A2, cTmp);
        sink.quad(A, A2, B2, B, cTmp2); // underside
        const A3 = { x: A2.x, y: A2.y - FASCIA, z: A2.z };
        const B3 = { x: B2.x, y: B2.y - FASCIA, z: B2.z };
        sink.quad(A2, B2, B3, A3, cTmp2);
        sink.quad(A2, A3, B3, B2, cTmp2);
      } else {
        // parapet: outer face flush with wall, capped, inner face inset
        const y1 = baseY + PARAPET_H;
        const ia = { x: a.x + ma.x * -PARAPET_T, z: a.y + ma.z * -PARAPET_T };
        const ib = { x: b.x + mb.x * -PARAPET_T, z: b.y + mb.z * -PARAPET_T };
        const A0 = { x: a.x, y: baseY, z: a.y };
        const B0 = { x: b.x, y: baseY, z: b.y };
        const A1 = { x: a.x, y: y1, z: a.y };
        const B1 = { x: b.x, y: y1, z: b.y };
        const IA1 = { x: ia.x, y: y1, z: ia.z };
        const IB1 = { x: ib.x, y: y1, z: ib.z };
        const IA0 = { x: ia.x, y: baseY + 0.04, z: ia.z };
        const IB0 = { x: ib.x, y: baseY + 0.04, z: ib.z };
        sink.quad(A0, A1, B1, B0, cTmp); // outer (faces outward)
        sink.quad(IA0, IB0, IB1, IA1, cTmp2); // inner (faces inward)
        sink.quad(A1, IA1, IB1, B1, cTmp2); // cap
      }
    }
  }
}
