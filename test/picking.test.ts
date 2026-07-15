/**
 * Exact ray-picking properties (tech doc §4). pick() clips rays against
 * voxel prisms analytically, so tests can assert exact cells, levels, and
 * faces rather than mesh-raycast approximations. Headless: pure three.js
 * vector math, no WebGL. Random rays come from the seeded rng only.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAND_TOP, levelY, MAX_LEVELS } from '../src/core/constants';
import { rng } from '../src/core/rng';
import { generateGrid } from '../src/grid/generate';
import { pick } from '../src/grid/picking';
import { PALETTE } from '../src/town/palette';
import { Town, type Edit } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)
const N_CELLS = grid.cells.length;
const N_COLORS = PALETTE.length;

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

function fillColumn(town: Town, cell: number, lo: number, hi: number, color = 0): void {
  const edits: Edit[] = [];
  for (let l = lo; l <= hi; l++) edits.push({ kind: 'voxel', cell, level: l, after: color });
  town.apply(edits);
}

/** nearest cell to a world point (deterministic; the grid is fixed) */
function cellNear(x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (const c of grid.cells) {
    const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c.id;
    }
  }
  return best;
}

/** vertical ray straight down from high above */
const down = (x: number, z: number): THREE.Ray =>
  new THREE.Ray(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));

describe('exact ray picking', () => {
  it('down-ray onto a filled column hits its top face, stacks above, removes the top', () => {
    const town = freshTown();
    const cell = cellNear(0, 0);
    expect(town.isLand(cell)).toBe(true);
    fillColumn(town, cell, 0, 4, 2);
    const c = grid.cells[cell]!;
    const p = pick(grid, town, down(c.cx, c.cy));
    expect(p).not.toBeNull();
    expect(p!.cell).toBe(cell);
    expect(p!.face).toBe('top');
    expect(p!.level).toBe(4);
    expect(p!.place).toEqual({ cell, level: 5 });
    expect(p!.remove).toEqual({ cell, level: 4 });
    expect(p!.point.y).toBeCloseTo(levelY(5), 5);
  });

  it('down-ray onto empty land picks the ground plane at level 0', () => {
    const town = freshTown();
    const cell = cellNear(3, -2);
    expect(town.isLand(cell)).toBe(true);
    const c = grid.cells[cell]!;
    const p = pick(grid, town, down(c.cx, c.cy));
    expect(p).not.toBeNull();
    expect(p!.face).toBe('ground');
    expect(p!.cell).toBe(cell);
    expect(p!.place).toEqual({ cell, level: 0 });
    expect(p!.remove).toBeNull();
    expect(p!.point.y).toBeCloseTo(LAND_TOP, 6);
  });

  it('45° ray into a tower side reports the side face and neighbor placement', () => {
    const town = freshTown();
    const cell = cellNear(0, 0);
    fillColumn(town, cell, 0, 11, 0);
    const c = grid.cells[cell]!;
    const k = c.neighbors.findIndex((n) => n >= 0);
    expect(k).toBeGreaterThanOrEqual(0);
    const mid = grid.edgeMid(c, k);
    const nrm = grid.edgeNormal(c, k);
    const hitLevel = 3;
    // aim at the wall's midpoint mid-voxel, descending at 45° along the
    // outward normal; the origin sits below the tower top so the ray can
    // only enter through side k
    const target = new THREE.Vector3(mid.x, levelY(hitLevel) + 0.5, mid.y);
    const origin = new THREE.Vector3(mid.x + nrm.x * 8, target.y + 8, mid.y + nrm.y * 8);
    const dir = target.clone().sub(origin).normalize();
    const p = pick(grid, town, new THREE.Ray(origin, dir));
    expect(p).not.toBeNull();
    expect(p!.face).toBe(k);
    expect(p!.cell).toBe(cell);
    expect(p!.level).toBe(hitLevel);
    expect(p!.remove).toEqual({ cell, level: hitLevel });
    expect(town.isFilled(p!.remove!.cell, p!.remove!.level)).toBe(true);
    const neighbor = c.neighbors[k]!;
    expect(p!.place).toEqual({ cell: neighbor, level: hitLevel });
    expect(town.isFilled(neighbor, hitLevel)).toBe(false);
  });

  it('property sweep: 500 random rays keep pick() total and consistent', { timeout: 120_000 }, () => {
    const town = freshTown();
    const r = rng('pick');
    // scatter a random skyline (some columns float, some sit over water)
    const edits: Edit[] = [];
    for (let i = 0; i < 400; i++) {
      edits.push({ kind: 'voxel', cell: r.int(N_CELLS), level: r.int(20), after: r.int(N_COLORS) });
    }
    town.apply(edits);

    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const origin = new THREE.Vector3(r.range(-16, 16), r.range(15, 60), r.range(-16, 16));
      const c = grid.cells[r.int(N_CELLS)]!;
      const dir = new THREE.Vector3(c.cx, LAND_TOP, c.cy).sub(origin).normalize();
      let p;
      try {
        p = pick(grid, town, new THREE.Ray(origin, dir));
      } catch (err) {
        throw new Error(`ray ${i} threw: ${String(err)}`);
      }
      if (!p) continue;
      hits++;
      const ctx = `ray ${i} (cell ${p.cell}, level ${p.level}, face ${p.face})`;
      if (!Number.isFinite(p.t) || !p.point.toArray().every(Number.isFinite)) {
        throw new Error(`${ctx}: non-finite hit`);
      }
      if (p.place) {
        const { cell, level } = p.place;
        if (cell < 0 || cell >= N_CELLS) throw new Error(`${ctx}: place cell ${cell} out of range`);
        if (level < 0 || level >= MAX_LEVELS)
          throw new Error(`${ctx}: place level ${level} out of range`);
        if (town.isFilled(cell, level))
          throw new Error(`${ctx}: place targets filled voxel ${cell}:${level}`);
      }
      if (p.remove && !town.isFilled(p.remove.cell, p.remove.level)) {
        throw new Error(`${ctx}: remove targets empty voxel ${p.remove.cell}:${p.remove.level}`);
      }
    }
    // the sweep must actually exercise hits, not vacuously pass
    expect(hits).toBeGreaterThan(100);
  });

  it('place-on-top respects the MAX_LEVELS cap', () => {
    const town = freshTown();
    const cell = cellNear(-2, 1);
    fillColumn(town, cell, 0, MAX_LEVELS - 1, 5);
    const c = grid.cells[cell]!;
    const p = pick(grid, town, down(c.cx, c.cy));
    expect(p).not.toBeNull();
    expect(p!.face).toBe('top');
    expect(p!.level).toBe(MAX_LEVELS - 1);
    expect(p!.place).toBeNull(); // cap respected — nowhere to stack
    expect(p!.remove).toEqual({ cell, level: MAX_LEVELS - 1 });
  });
});
