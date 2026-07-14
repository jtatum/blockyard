/**
 * Ground-prop gate (round-2 charm pass). Laws under test: emitGroundProps is
 * total over empty land cells (no throw, finite floats), deterministic (two
 * runs → bit-identical arrays), 1-ring scoped (signature moves with adjacent
 * edits, ignores distant ones), and cheap enough for a whole island
 * (< 120k position floats on the default empty island). Headless — GeoSink
 * is plain arrays, no WebGL needed.
 */

import { describe, expect, it } from 'vitest';
import { GeoSink } from '../src/arch/geom';
import { emitGroundProps, groundPropsSignature } from '../src/arch/groundprops';
import { generateGrid } from '../src/grid/generate';
import { Town, type Edit } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

const place = (cell: number, level: number, color: number): Edit => ({
  kind: 'voxel',
  cell,
  level,
  after: color,
});

/** deterministic scatter of small buildings so plaza branches all run */
function scatterTown(): Town {
  const town = freshTown();
  const edits: Edit[] = [];
  for (const c of grid.cells) {
    if (c.id % 7 === 0 && town.isLand(c.id)) {
      edits.push(place(c.id, 0, c.id % 15));
      if (c.id % 14 === 0) edits.push(place(c.id, 1, (c.id + 3) % 15));
    }
  }
  town.apply(edits);
  return town;
}

/** run the mesher-style loop: every empty land cell into one sink pair */
function emitAll(town: Town): { solid: GeoSink; glass: GeoSink } {
  const solid = new GeoSink();
  const glass = new GeoSink();
  for (const c of grid.cells) {
    if (town.filled[c.id]! === 0 && town.isLand(c.id)) {
      emitGroundProps(solid, glass, town, c.id);
    }
  }
  return { solid, glass };
}

function emitOne(town: Town, cellId: number): { solid: GeoSink; glass: GeoSink } {
  const solid = new GeoSink();
  const glass = new GeoSink();
  emitGroundProps(solid, glass, town, cellId);
  return { solid, glass };
}

function assertSinkSane(sink: GeoSink, label: string): void {
  expect(sink.pos.length % 9, `${label}: positions form whole triangles`).toBe(0);
  expect(sink.col.length, `${label}: one color per vertex`).toBe(sink.pos.length);
  for (let i = 0; i < sink.pos.length; i++) {
    if (!Number.isFinite(sink.pos[i]!)) throw new Error(`${label}: non-finite pos[${i}]`);
  }
  for (let i = 0; i < sink.col.length; i++) {
    if (!Number.isFinite(sink.col[i]!)) throw new Error(`${label}: non-finite col[${i}]`);
  }
}

/** nearest cell to a grid-plane point (deterministic; the grid is fixed) */
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

describe('ground props', () => {
  it('default empty island: no throw, finite geometry, under triangle budget', () => {
    const town = freshTown();
    const { solid, glass } = emitAll(town);
    assertSinkSane(solid, 'solid');
    assertSinkSane(glass, 'glass');
    // grass tufts exist somewhere on ~30% of ~hundreds of land cells
    expect(solid.pos.length).toBeGreaterThan(0);
    // budget for the per-chunk rebuild path: whole island well under 120k floats
    expect(solid.pos.length + glass.pos.length).toBeLessThan(120_000);
  });

  it('deterministic: two runs over a built town yield identical arrays', () => {
    const town = scatterTown();
    const a = emitAll(town);
    const b = emitAll(town);
    expect(a.solid.pos).toEqual(b.solid.pos);
    expect(a.solid.col).toEqual(b.solid.col);
    expect(a.glass.pos).toEqual(b.glass.pos);
    expect(a.glass.col).toEqual(b.glass.col);
    assertSinkSane(a.solid, 'scatter solid');
    assertSinkSane(a.glass, 'scatter glass');
    // plaza branches actually ran: stones are unconditional on plaza cells,
    // and with ~hundreds of plaza cells the 18% lamp roll lights some glass
    const plaza = grid.cells.find(
      (c) =>
        town.filled[c.id]! === 0 &&
        town.isLand(c.id) &&
        c.neighbors.some((n) => n >= 0 && town.filled[n]! !== 0)
    );
    expect(plaza).toBeDefined();
    expect(emitOne(town, plaza!.id).solid.pos.length).toBeGreaterThan(0);
    expect(a.glass.pos.length).toBeGreaterThan(0);
  });

  it('signature changes when an edge neighbor gains a block', () => {
    const town = freshTown();
    // first empty land cell with an empty land edge neighbor
    const x = grid.cells.find(
      (c) =>
        town.filled[c.id]! === 0 &&
        town.isLand(c.id) &&
        c.neighbors.some((n) => n >= 0 && town.filled[n]! === 0 && town.isLand(n))
    );
    expect(x).toBeDefined();
    const n0 = x!.neighbors.find(
      (n) => n >= 0 && town.filled[n]! === 0 && town.isLand(n)
    )!;
    const before = groundPropsSignature(town, x!.id);
    expect(before).not.toBe('');
    const geoBefore = emitOne(town, x!.id);
    town.apply([place(n0, 0, 3)]);
    const after = groundPropsSignature(town, x!.id);
    expect(after).not.toBe(before);
    // and the output really does change (cell became a plaza)
    const geoAfter = emitOne(town, x!.id);
    expect(geoAfter.solid.pos).not.toEqual(geoBefore.solid.pos);
    // a filled cell has no ground-prop output at all
    expect(groundPropsSignature(town, n0)).toBe('');
  });

  it('signature and output are stable when a DISTANT cell changes', () => {
    const town = freshTown();
    const x = cellNear(0, 0);
    const far = cellNear(8, 8);
    expect(far).not.toBe(x);
    expect(grid.cells[x]!.neighbors.includes(far)).toBe(false);
    const sigBefore = groundPropsSignature(town, x);
    const geoBefore = emitOne(town, x);
    town.apply([place(far, 0, 5)]);
    expect(groundPropsSignature(town, x)).toBe(sigBefore);
    const geoAfter = emitOne(town, x);
    expect(geoAfter.solid.pos).toEqual(geoBefore.solid.pos);
    expect(geoAfter.glass.pos).toEqual(geoBefore.glass.pos);
  });
});
