/**
 * Roof system. Top-exposed voxels form connected regions per (level, roof
 * kind); pitched regions get a hip-roof heightfield — roof height rises with
 * distance from the region boundary (multi-source Dijkstra over the corner
 * graph), capped at a ridge height. Ridgelines, hips, and valleys emerge from
 * the footprint automatically.
 *
 * Boundaries follow the same smoothed outlines as the walls (see outline.ts):
 * surface corners shrink to the fillet points, eaves/parapets run along the
 * smoothed loops, and an isolated one-cell tower trades its hip for a cone —
 * so curved walls meet curved roof edges everywhere.
 */

import * as THREE from 'three';
import { levelY, MAX_LEVELS } from '../core/constants';
import { hashKey, rng } from '../core/rng';
import type { Grid } from '../grid/grid';
import { PALETTE, type RoofKind } from '../town/palette';
import type { Town } from '../town/town';
import { GeoSink, type P3 } from './geom';
import { smoothLoop, walkLoops, type OSeg } from './outline';

const SLOPE = 0.62;
const MAX_RISE = 0.8;
const OVERHANG = 0.15;
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
  /** smoothed boundary loops (shared geometry language with the walls) */
  loops: OSeg[][];
  /** boundary grid-vertex -> fillet point the surface shrinks to */
  cornerPoint: Map<number, { x: number; y: number }>;
  /** 'cell:k' -> the straight central segment of that boundary edge */
  centralSeg: Map<string, OSeg>;
  /** single isolated cell at this level -> cone roof */
  cone: boolean;
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
  const assigned = new Map<string, number>();

  for (const start of grid.cells) {
    for (let level = 0; level < MAX_LEVELS; level++) {
      if (!isTopExposed(town, start.id, level)) continue;
      const key = start.id + ':' + level;
      if (assigned.has(key)) continue;
      const kind = roofKindOf(town, start.id, level);
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
      regions.push(buildRegion(town, regions.length, level, kind, cells));
    }
  }
  return regions;
}

function buildRegion(
  town: Town,
  id: number,
  level: number,
  kind: RoofKind,
  cells: Set<number>
): RoofRegion {
  const grid = town.grid;
  const baseY = levelY(level + 1);

  // a cone tower = a region that is also isolated at its own level
  // (no filled neighbor at this level at all, exposed or not)
  let cone = false;
  if (cells.size === 1 && kind === 'pitched') {
    const only = [...cells][0]!;
    cone = grid.cells[only]!.neighbors.every((n) => n < 0 || !town.isFilled(n, level));
  }

  // boundary vertices for the heightfield
  const boundaryVerts = new Set<number>();
  for (const ci of cells) {
    const c = grid.cells[ci]!;
    for (let k = 0; k < 4; k++) {
      const n = c.neighbors[k]!;
      if (n >= 0 && cells.has(n)) continue;
      boundaryVerts.add(c.corners[k]!);
      boundaryVerts.add(c.corners[(k + 1) % 4]!);
    }
  }

  // multi-source Dijkstra over corner graph (edges of region cells)
  const dist = new Map<number, number>();
  if (kind === 'pitched' && !cone) {
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
  if (kind === 'pitched' && !cone) {
    for (const [v, d] of dist) vertexY.set(v, roofY(d));
    for (const ci of cells) {
      const c = grid.cells[ci]!;
      let cd = Infinity;
      for (const vi of c.corners) {
        const v = grid.vertices[vi]!;
        const d = (dist.get(vi) ?? 0) + Math.hypot(v.x - c.cx, v.y - c.cy);
        cd = Math.min(cd, d);
      }
      centerY.set(ci, roofY(cd));
    }
  }

  // smoothed boundary loops, shared with the wall system
  const cornerPoint = new Map<number, { x: number; y: number }>();
  const loops = walkLoops(grid, (c) => cells.has(c), cells).map((loop) =>
    smoothLoop(grid, loop, cells.size === 1, cornerPoint)
  );
  const centralSeg = new Map<string, OSeg>();
  for (const loop of loops) {
    for (const s of loop) if (s.central) centralSeg.set(s.cell + ':' + s.k, s);
  }

  return { id, level, kind, cells, vertexY, centerY, loops, cornerPoint, centralSeg, cone };
}

const cTmp = new THREE.Color();
const cTmp2 = new THREE.Color();

/** corner position: fillet point on the boundary, original vertex inside */
function cornerPos(region: RoofRegion, grid: Grid, vId: number): { x: number; y: number } {
  return region.cornerPoint.get(vId) ?? { x: grid.vertices[vId]!.x, y: grid.vertices[vId]!.y };
}

/** emit the roof surface belonging to `cellId` */
export function emitRoofCell(sink: GeoSink, town: Town, region: RoofRegion, cellId: number): void {
  if (region.cone) {
    emitConeRoof(sink, town, region);
    return;
  }
  const grid = town.grid;
  const c = grid.cells[cellId]!;
  const baseY = levelY(region.level + 1);
  cTmp.setHex(PALETTE[town.colorAt(cellId, region.level)]!.roofHex);
  const shade = (((hashKey(grid.seed, 'roofshade', cellId) % 100) / 100) - 0.5) * 0.05;
  cTmp.offsetHSL(0, 0, shade);

  if (region.kind === 'flat') {
    const y = baseY + 0.04;
    const p = [0, 1, 2, 3].map((k) => {
      const pos = cornerPos(region, grid, c.corners[k]!);
      return { x: pos.x, y, z: pos.y };
    });
    sink.horzUp(p[0]!, p[1]!, p[2]!, p[3]!, cTmp);
    emitBoundaryInfill(sink, town, region, cellId, y);
    return;
  }

  // pitched: triangle fan around the centroid using the region heightfield
  const cy = region.centerY.get(cellId) ?? baseY;
  const center = { x: c.cx, y: cy, z: c.cy };
  for (let k = 0; k < 4; k++) {
    const aId = c.corners[k]!;
    const bId = c.corners[(k + 1) % 4]!;
    const aPos = cornerPos(region, grid, aId);
    const bPos = cornerPos(region, grid, bId);
    const pa = { x: aPos.x, y: region.vertexY.get(aId) ?? baseY, z: aPos.y };
    const pb = { x: bPos.x, y: region.vertexY.get(bId) ?? baseY, z: bPos.y };
    sink.tri(pa, center, pb, cTmp);
  }
  emitBoundaryInfill(sink, town, region, cellId, baseY);
}

/**
 * The surface's boundary edge is the straight chord between two fillet
 * points, but eaves/parapets run along the smoothed polyline which bulges
 * outward through the original edge's central segment. Fill the flat sliver
 * between chord and polyline so the roof stays watertight (all at boundary
 * height — boundary Dijkstra distance is 0).
 */
function emitBoundaryInfill(
  sink: GeoSink,
  town: Town,
  region: RoofRegion,
  cellId: number,
  y: number
): void {
  const grid = town.grid;
  const c = grid.cells[cellId]!;
  for (let k = 0; k < 4; k++) {
    const seg = region.centralSeg.get(cellId + ':' + k);
    if (!seg) continue;
    const ma = cornerPos(region, grid, c.corners[k]!);
    const mb = cornerPos(region, grid, c.corners[(k + 1) % 4]!);
    const MA = { x: ma.x, y, z: ma.y };
    const MB = { x: mb.x, y, z: mb.y };
    const P0 = { x: seg.ax, y, z: seg.ay };
    const P1 = { x: seg.bx, y, z: seg.by };
    // polygon MA -> P0 -> P1 -> MB is grid-CCW; up-faces reverse the winding
    sink.tri(MA, P1, P0, cTmp);
    sink.tri(MA, MB, P1, cTmp);
  }
}

/** cone roof for isolated towers, ringed on the smoothed outline */
function emitConeRoof(sink: GeoSink, town: Town, region: RoofRegion): void {
  const grid = town.grid;
  const cellId = [...region.cells][0]!;
  const c = grid.cells[cellId]!;
  const loop = region.loops[0];
  if (!loop || loop.length === 0) return;
  const baseY = levelY(region.level + 1);
  cTmp.setHex(PALETTE[town.colorAt(cellId, region.level)]!.roofHex);
  cTmp2.copy(cTmp).offsetHSL(0, 0, -0.06);

  const r = rng(grid.seed, 'cone', cellId);
  const apex: P3 = { x: c.cx, y: baseY + r.range(0.55, 0.75), z: c.cy };

  // ring points from the loop (each segment start)
  const ring = loop.map((s) => ({ x: s.ax, y: s.ay }));
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    // outward skirt with a small drop, then cone side above it
    const oa = outward(a, c);
    const ob = outward(b, c);
    const A: P3 = { x: a.x, y: baseY + 0.06, z: a.y };
    const B: P3 = { x: b.x, y: baseY + 0.06, z: b.y };
    const A2: P3 = { x: a.x + oa.x * OVERHANG * 0.8, y: baseY - 0.04, z: a.y + oa.y * OVERHANG * 0.8 };
    const B2: P3 = { x: b.x + ob.x * OVERHANG * 0.8, y: baseY - 0.04, z: b.y + ob.y * OVERHANG * 0.8 };
    sink.quad(A, B, B2, A2, cTmp);
    sink.quad(A, A2, B2, B, cTmp2); // underside
    sink.tri(A, apex, B, cTmp);
  }
}

function outward(p: { x: number; y: number }, c: { cx: number; cy: number }): { x: number; y: number } {
  let dx = p.x - c.cx;
  let dy = p.y - c.cy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** eaves (pitched) or parapets (flat) along the smoothed loops */
export function emitRoofEdges(
  sink: GeoSink,
  town: Town,
  region: RoofRegion,
  own: (cell: number) => boolean
): void {
  if (region.cone) return; // the cone's skirt is its eave
  const baseY = levelY(region.level + 1);

  for (const loop of region.loops) {
    const n = loop.length;
    // per-point mitred outward normals (points are shared segment endpoints)
    const normals = loop.map((s) => {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const len = Math.hypot(dx, dy) || 1;
      // interior is left of a→b, outward is right: (dy, -dx)
      return { x: dy / len, y: -dx / len };
    });
    const miter = (i: number): { x: number; y: number } => {
      const nPrev = normals[(i - 1 + n) % n]!;
      const nCur = normals[i]!;
      let mx = nPrev.x + nCur.x;
      let my = nPrev.y + nCur.y;
      const len = Math.hypot(mx, my) || 1;
      mx /= len;
      my /= len;
      const scale = 1 / Math.max(0.45, mx * nCur.x + my * nCur.y);
      return { x: mx * scale, y: my * scale };
    };

    for (let i = 0; i < n; i++) {
      const s = loop[i]!;
      if (!own(s.cell)) continue;
      const ma = miter(i);
      const mb = miter((i + 1) % n);
      cTmp.setHex(PALETTE[town.colorAt(s.cell, region.level)]!.roofHex);
      cTmp2.copy(cTmp).offsetHSL(0, 0, -0.06);

      if (region.kind === 'pitched') {
        const oy = baseY - EAVE_DROP;
        const A: P3 = { x: s.ax, y: baseY, z: s.ay };
        const B: P3 = { x: s.bx, y: baseY, z: s.by };
        const A2: P3 = { x: s.ax + ma.x * OVERHANG, y: oy, z: s.ay + ma.y * OVERHANG };
        const B2: P3 = { x: s.bx + mb.x * OVERHANG, y: oy, z: s.by + mb.y * OVERHANG };
        sink.quad(A, B, B2, A2, cTmp);
        sink.quad(A, A2, B2, B, cTmp2); // underside
        const A3: P3 = { x: A2.x, y: A2.y - FASCIA, z: A2.z };
        const B3: P3 = { x: B2.x, y: B2.y - FASCIA, z: B2.z };
        sink.quad(A2, B2, B3, A3, cTmp2);
        sink.quad(A2, A3, B3, B2, cTmp2);
      } else {
        const y1 = baseY + PARAPET_H;
        const ia = { x: s.ax - ma.x * PARAPET_T, y: s.ay - ma.y * PARAPET_T };
        const ib = { x: s.bx - mb.x * PARAPET_T, y: s.by - mb.y * PARAPET_T };
        const A0: P3 = { x: s.ax, y: baseY, z: s.ay };
        const B0: P3 = { x: s.bx, y: baseY, z: s.by };
        const A1: P3 = { x: s.ax, y: y1, z: s.ay };
        const B1: P3 = { x: s.bx, y: y1, z: s.by };
        const IA1: P3 = { x: ia.x, y: y1, z: ia.y };
        const IB1: P3 = { x: ib.x, y: y1, z: ib.y };
        const IA0: P3 = { x: ia.x, y: baseY + 0.04, z: ia.y };
        const IB0: P3 = { x: ib.x, y: baseY + 0.04, z: ib.y };
        sink.quad(A0, A1, B1, B0, cTmp); // outer
        sink.quad(IA0, IB0, IB1, IA1, cTmp2); // inner
        sink.quad(A1, IA1, IB1, B1, cTmp2); // cap
      }
    }
  }
}

/** a chimney near the ridge of larger pitched regions — quiet rooftop life */
export function emitChimney(
  sink: GeoSink,
  town: Town,
  region: RoofRegion,
  own: (cell: number) => boolean
): void {
  if (region.kind !== 'pitched' || region.cone || region.cells.size < 3) return;
  const grid = town.grid;
  const r = rng(grid.seed, 'chimney', region.level, Math.min(...region.cells));
  if (!r.chance(Math.min(0.85, region.cells.size / 6))) return;

  // stand it on the highest cell of the region (ties broken by id)
  let bestCell = -1;
  let bestY = -Infinity;
  for (const c of region.cells) {
    const y = region.centerY.get(c) ?? 0;
    if (y > bestY || (y === bestY && c < bestCell)) {
      bestY = y;
      bestCell = c;
    }
  }
  if (bestCell < 0 || !own(bestCell)) return;
  const c = grid.cells[bestCell]!;
  const px = c.cx + r.range(-0.15, 0.15);
  const pz = c.cy + r.range(-0.15, 0.15);
  cTmp.setHex(PALETTE[town.colorAt(bestCell, region.level)]!.hex).offsetHSL(0, -0.08, -0.12);
  const topY = bestY + r.range(0.28, 0.42);
  sink.post(px, pz, bestY - 0.25, topY, 0.075, cTmp);
  // cap slab
  cTmp2.copy(cTmp).offsetHSL(0, 0, -0.1);
  sink.post(px, pz, topY, topY + 0.045, 0.1, cTmp2);
}
