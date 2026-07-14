/**
 * Ray → (cell, level, face) picking (tech doc §4 /grid/picking).
 * Blocks are convex prisms (irregular quad footprint × level slab), so we clip
 * the ray against 4 side half-planes + top/bottom — exact, fast, no meshes.
 *
 * Face semantics feed interaction:
 *   top    → stack above / remove this voxel
 *   side k → place into neighbor across edge k at same level / remove this
 *   ground → place at level 0
 */

import * as THREE from 'three';
import { LAND_TOP, levelY, MAX_LEVELS } from '../core/constants';
import type { Grid } from '../grid/grid';
import type { Town } from '../town/town';

export interface Pick {
  /** world-space point of the hit */
  point: THREE.Vector3;
  t: number;
  /** the voxel hit, or ground cell */
  cell: number;
  level: number;
  face: 'top' | 'bottom' | 'ground' | number; // number = side edge index
  /** where a placement would go (null = nowhere valid) */
  place: { cell: number; level: number } | null;
  /** which voxel a removal would take (null on ground) */
  remove: { cell: number; level: number } | null;
}

interface Clip {
  tEnter: number;
  tExit: number;
  enterFace: 'top' | 'bottom' | number;
}

/** clip ray against a cell's vertical prism between y0..y1; null if missed */
function clipPrism(
  grid: Grid,
  cellId: number,
  y0: number,
  y1: number,
  o: THREE.Vector3,
  d: THREE.Vector3
): Clip | null {
  const cell = grid.cells[cellId]!;
  let tEnter = 0;
  let tExit = Infinity;
  let enterFace: 'top' | 'bottom' | number = 'top';

  // side half-planes: interior is left of each CCW edge in grid coords (x, z)
  for (let k = 0; k < 4; k++) {
    const a = grid.corner(cell, k);
    const b = grid.corner(cell, k + 1);
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const c0 = nx * (o.x - a.x) + ny * (o.z - a.y);
    const c1 = nx * d.x + ny * d.z;
    if (Math.abs(c1) < 1e-12) {
      if (c0 < 0) return null; // parallel and outside
      continue;
    }
    const t = -c0 / c1;
    if (c1 > 0) {
      // f increases: inside for t >= t  → lower bound
      if (t > tEnter) { tEnter = t; enterFace = k; }
    } else {
      if (t < tExit) tExit = t;
    }
  }

  // y slab
  if (Math.abs(d.y) < 1e-12) {
    if (o.y < y0 || o.y > y1) return null;
  } else {
    const tA = (y0 - o.y) / d.y;
    const tB = (y1 - o.y) / d.y;
    const tLo = Math.min(tA, tB);
    const tHi = Math.max(tA, tB);
    if (tLo > tEnter) {
      tEnter = tLo;
      enterFace = d.y < 0 ? 'top' : 'bottom';
    }
    tExit = Math.min(tExit, tHi);
  }

  if (tEnter > tExit || tExit < 0) return null;
  return { tEnter, tExit, enterFace };
}

export function pick(grid: Grid, town: Town, ray: THREE.Ray): Pick | null {
  const o = ray.origin;
  const d = ray.direction;

  // ground-plane hit (placement plane at LAND_TOP for land and water alike)
  let tGround = Infinity;
  if (d.y < -1e-9) tGround = (LAND_TOP - o.y) / d.y;

  // candidate cells along the ray's ground track (generous margin: tall towers)
  const tFar = Math.min(tGround + MAX_LEVELS * 1.5, 400);
  const candidates = grid.cellsAlong(
    o.x, o.z,
    o.x + d.x * tFar, o.z + d.z * tFar
  );

  let best: Pick | null = null;

  for (const cellId of candidates) {
    const mask = town.filled[cellId]!;
    if (mask === 0) continue;
    // walk contiguous filled runs so shared interior faces are never hit
    let level = 0;
    while (level < MAX_LEVELS) {
      if (!(mask & (1 << level))) { level++; continue; }
      let top = level;
      while (top + 1 < MAX_LEVELS && mask & (1 << (top + 1))) top++;
      const clip = clipPrism(grid, cellId, levelY(level), levelY(top + 1), o, d);
      if (clip && clip.tEnter < (best?.t ?? Infinity) && clip.tEnter >= 0) {
        // which voxel within the run: from the hit height
        const hitY = o.y + d.y * clip.tEnter;
        let hitLevel =
          clip.enterFace === 'top'
            ? top
            : clip.enterFace === 'bottom'
              ? level
              : Math.min(top, Math.max(level, Math.floor((hitY - LAND_TOP) / 1.0)));
        const point = new THREE.Vector3().copy(d).multiplyScalar(clip.tEnter).add(o);
        let place: Pick['place'] = null;
        if (clip.enterFace === 'top') {
          if (top + 1 < MAX_LEVELS) place = { cell: cellId, level: top + 1 };
        } else if (clip.enterFace === 'bottom') {
          if (level - 1 >= 0) place = { cell: cellId, level: level - 1 };
        } else {
          const n = grid.cells[cellId]!.neighbors[clip.enterFace as number]!;
          if (n >= 0 && !town.isFilled(n, hitLevel)) place = { cell: n, level: hitLevel };
        }
        best = {
          point,
          t: clip.tEnter,
          cell: cellId,
          level: hitLevel,
          face: clip.enterFace,
          place,
          remove: { cell: cellId, level: hitLevel },
        };
      }
      level = top + 1;
    }
  }

  // ground fallback
  if (!best && tGround < Infinity) {
    const point = new THREE.Vector3().copy(d).multiplyScalar(tGround).add(o);
    const cellId = grid.cellAt(point.x, point.z);
    if (cellId >= 0 && !town.isFilled(cellId, 0)) {
      best = {
        point,
        t: tGround,
        cell: cellId,
        level: 0,
        face: 'ground',
        place: { cell: cellId, level: 0 },
        remove: null,
      };
    }
  }

  return best;
}
