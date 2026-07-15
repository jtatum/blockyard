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
  /** edge-midpoint heights, keyed 'minVid_maxVid' — these carry the ridges */
  midY: Map<string, number>;
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

/** `exclude` masks recipe-claimed cells (staircases) out of the roof system —
 *  they read as unfilled, so e.g. a plaza's eave line opens where stairs land. */
export function computeRoofRegionsForLevel(
  town: Town,
  level: number,
  exclude?: ReadonlySet<number>
): RoofRegion[] {
  const grid = town.grid;
  const regions: RoofRegion[] = [];
  const assigned = new Set<number>();
  const exposed = (c: number): boolean => isTopExposed(town, c, level) && !exclude?.has(c);

  for (const start of grid.cells) {
    if (!exposed(start.id) || assigned.has(start.id)) continue;
    const kind = roofKindOf(town, start.id, level);
    const cells = new Set<number>([start.id]);
    assigned.add(start.id);
    const stack = [start.id];
    while (stack.length) {
      const c = grid.cells[stack.pop()!]!;
      for (const n of c.neighbors) {
        if (n < 0 || cells.has(n)) continue;
        if (!exposed(n)) continue;
        if (roofKindOf(town, n, level) !== kind) continue;
        cells.add(n);
        assigned.add(n);
        stack.push(n);
      }
    }
    regions.push(buildRegion(town, regions.length, level, kind, cells, exclude));
  }
  return regions;
}

/** all levels (full rebuilds and tests; the mesher caches per level) */
export function computeRoofRegions(town: Town, exclude?: ReadonlySet<number>): RoofRegion[] {
  const out: RoofRegion[] = [];
  for (let level = 0; level < MAX_LEVELS; level++) {
    out.push(...computeRoofRegionsForLevel(town, level, exclude));
  }
  return out;
}

function buildRegion(
  town: Town,
  id: number,
  level: number,
  kind: RoofKind,
  cells: Set<number>,
  exclude?: ReadonlySet<number>
): RoofRegion {
  const grid = town.grid;
  const baseY = levelY(level + 1);

  // a cone tower = a region that is also isolated at its own level
  // (no filled neighbor at this level at all, exposed or not; claimed
  // staircase cells don't break the isolation)
  let cone = false;
  if (cells.size === 1 && kind === 'pitched') {
    const only = [...cells][0]!;
    cone = grid.cells[only]!.neighbors.every(
      (n) => n < 0 || !town.isFilled(n, level) || exclude?.has(n) === true
    );
  }

  // multi-source Dijkstra over corners + EDGE MIDPOINTS + centroids.
  // Midpoints are what let ridges run continuously along rows of cells —
  // without them every cell peaks alone and long roofs read as sawtooth.
  const midKey = (a: number, b: number) => (a < b ? a + '_' + b : b + '_' + a);
  const dist = new Map<string, number>();
  const vertexY = new Map<number, number>();
  const midY = new Map<string, number>();
  const centerY = new Map<number, number>();

  if (kind === 'pitched' && !cone) {
    const adj = new Map<string, { v: string; w: number }[]>();
    const link = (a: string, b: string, w: number) => {
      let arr = adj.get(a);
      if (!arr) adj.set(a, (arr = []));
      arr.push({ v: b, w });
      let brr = adj.get(b);
      if (!brr) adj.set(b, (brr = []));
      brr.push({ v: a, w });
    };
    const seeds: string[] = [];
    for (const ci of cells) {
      const c = grid.cells[ci]!;
      for (let k = 0; k < 4; k++) {
        const aId = c.corners[k]!;
        const bId = c.corners[(k + 1) % 4]!;
        const va = grid.vertices[aId]!;
        const vb = grid.vertices[bId]!;
        const mx = (va.x + vb.x) / 2;
        const my = (va.y + vb.y) / 2;
        const half = Math.hypot(vb.x - va.x, vb.y - va.y) / 2;
        const mk = 'm' + midKey(aId, bId);
        link('v' + aId, mk, half);
        link('v' + bId, mk, half);
        link('c' + ci, mk, Math.hypot(c.cx - mx, c.cy - my));
        link('c' + ci, 'v' + aId, Math.hypot(c.cx - va.x, c.cy - va.y));
        const n = c.neighbors[k]!;
        if (n < 0 || !cells.has(n)) {
          seeds.push('v' + aId, 'v' + bId, mk);
        }
      }
    }
    // binary min-heap — the midpoint graph tripled node counts, and an
    // array-scan queue turned dense-town re-solves quadratic
    const heapV: string[] = [];
    const heapD: number[] = [];
    const push = (v: string, d: number) => {
      let i = heapV.length;
      heapV.push(v);
      heapD.push(d);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapD[p]! <= heapD[i]!) break;
        [heapD[p], heapD[i]] = [heapD[i]!, heapD[p]!];
        [heapV[p], heapV[i]] = [heapV[i]!, heapV[p]!];
        i = p;
      }
    };
    const pop = (): { v: string; d: number } => {
      const top = { v: heapV[0]!, d: heapD[0]! };
      const lv = heapV.pop()!;
      const ld = heapD.pop()!;
      if (heapV.length > 0) {
        heapV[0] = lv;
        heapD[0] = ld;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let s = i;
          if (l < heapD.length && heapD[l]! < heapD[s]!) s = l;
          if (r < heapD.length && heapD[r]! < heapD[s]!) s = r;
          if (s === i) break;
          [heapD[s], heapD[i]] = [heapD[i]!, heapD[s]!];
          [heapV[s], heapV[i]] = [heapV[i]!, heapV[s]!];
          i = s;
        }
      }
      return top;
    };
    for (const s of seeds) {
      if (dist.get(s) === 0) continue;
      dist.set(s, 0);
      push(s, 0);
    }
    while (heapV.length > 0) {
      const { v, d } = pop();
      if (d > (dist.get(v) ?? Infinity)) continue;
      for (const e of adj.get(v) ?? []) {
        const nd = d + e.w;
        if (nd < (dist.get(e.v) ?? Infinity)) {
          dist.set(e.v, nd);
          push(e.v, nd);
        }
      }
    }
    const roofY = (d: number) => baseY + Math.min(d * SLOPE, MAX_RISE);
    for (const [node, d] of dist) {
      if (node.startsWith('v')) vertexY.set(Number(node.slice(1)), roofY(d));
      else if (node.startsWith('m')) midY.set(node.slice(1), roofY(d));
      else centerY.set(Number(node.slice(1)), roofY(d));
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

  return { id, level, kind, cells, vertexY, midY, centerY, loops, cornerPoint, centralSeg, cone };
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

  // pitched: 8-triangle fan through edge midpoints — midpoint heights carry
  // ridgelines across cell boundaries (Townscaper's diamond-facet roofs)
  const cy = region.centerY.get(cellId) ?? baseY;
  const center = { x: c.cx, y: cy, z: c.cy };
  for (let k = 0; k < 4; k++) {
    const aId = c.corners[k]!;
    const bId = c.corners[(k + 1) % 4]!;
    const va = grid.vertices[aId]!;
    const vb = grid.vertices[bId]!;
    const mKey = aId < bId ? aId + '_' + bId : bId + '_' + aId;
    const aPos = cornerPos(region, grid, aId);
    const bPos = cornerPos(region, grid, bId);
    const pa = { x: aPos.x, y: region.vertexY.get(aId) ?? baseY, z: aPos.y };
    const pb = { x: bPos.x, y: region.vertexY.get(bId) ?? baseY, z: bPos.y };
    const pm = {
      x: (va.x + vb.x) / 2,
      y: region.midY.get(mKey) ?? baseY,
      z: (va.y + vb.y) / 2,
    };
    sink.tri(pa, center, pm, cTmp);
    sink.tri(pm, center, pb, cTmp);
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
  const coneH = r.range(0.55, 0.75);
  const apex: P3 = { x: c.cx, y: baseY + 0.06 + coneH, z: c.cy };

  // ring points from the loop (each segment start), smooth radial shading
  const ring = loop.map((s) => ({ x: s.ax, y: s.ay }));
  const n = ring.length;
  const coneNormal = (p: { x: number; y: number }): P3 => {
    const o = outward(p, c);
    const rad = Math.hypot(p.x - c.cx, p.y - c.cy) || 1;
    // right-cone surface normal: h·radial + r·up, normalized
    const nx = o.x * coneH;
    const nz = o.y * coneH;
    const ny = rad;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  };
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
    const na = coneNormal(a);
    const nb = coneNormal(b);
    const nApex = { x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2, z: (na.z + nb.z) / 2 };
    sink.triN(A, apex, B, na, nApex, nb, cTmp);
  }
}

function outward(p: { x: number; y: number }, c: { cx: number; cy: number }): { x: number; y: number } {
  let dx = p.x - c.cx;
  let dy = p.y - c.cy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** eaves (pitched) or parapets (flat) along the smoothed loops.
 *  `skipSeg` suppresses individual segments (e.g. a plaza's parapet opens
 *  where a large staircase lands against it). */
export function emitRoofEdges(
  sink: GeoSink,
  town: Town,
  region: RoofRegion,
  own: (cell: number) => boolean,
  skipSeg?: (seg: OSeg) => boolean
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
      if (skipSeg?.(s)) continue;
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
