/**
 * Archway special build — detection rules (wall/pier supports, beach
 * stairway attachment), emission safety envelope, and determinism.
 * Headless: GeoSink needs no WebGL.
 */

import { describe, expect, it } from 'vitest';
import { archSignature, detectArches, emitArch, insideCell, type ArchSpec } from '../src/arch/arches';
import { GeoSink } from '../src/arch/geom';
import { LAND_TOP, SEA_FLOOR, levelY } from '../src/core/constants';
import { generateGrid } from '../src/grid/generate';
import { Town, type Edit } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

const place = (cell: number, level: number, color = 2): Edit => ({
  kind: 'voxel',
  cell,
  level,
  after: color,
});

function fillColumn(town: Town, cell: number, height: number): void {
  const edits: Edit[] = [];
  for (let l = 0; l < height; l++) edits.push(place(cell, l));
  town.apply(edits);
}

/** a land cell whose strict-opposite pair (kA, kA+2) are both land — and
 *  whose perpendicular neighbors are land too, so no beach stairway attaches
 *  and the emission-bounds assertions stay meaningful on any default grid */
function findSpanSite(): { cell: number; kA: number; A: number; B: number } {
  const town = freshTown();
  for (const c of grid.cells) {
    if (!town.isLand(c.id)) continue;
    if (c.neighbors.some((n) => n < 0 || !town.isLand(n))) continue;
    for (const kA of [0, 1]) {
      const A = c.neighbors[kA]!;
      const B = c.neighbors[kA + 2]!;
      return { cell: c.id, kA, A, B };
    }
  }
  throw new Error('no qualifying arch site on the default grid');
}

/** a coastal land cell: strict-axis neighbors on land, a side neighbor in water */
function findBeachSite(): { cell: number; kA: number; A: number; B: number; sea: number } {
  const town = freshTown();
  for (const c of grid.cells) {
    if (!town.isLand(c.id)) continue;
    for (const kA of [0, 1]) {
      const A = c.neighbors[kA]!;
      const B = c.neighbors[kA + 2]!;
      if (A < 0 || B < 0 || !town.isLand(A) || !town.isLand(B)) continue;
      for (const kV of [(kA + 1) % 4, (kA + 3) % 4]) {
        const w = c.neighbors[kV]!;
        if (w >= 0 && !town.isLand(w)) {
          return { cell: c.id, kA, A, B, sea: w };
        }
      }
    }
  }
  throw new Error('no qualifying beach site on the default grid');
}

const SITE = findSpanSite();
const BEACH = findBeachSite();

describe('arch detection', () => {
  it('a span bridging two ground columns gets a wall/wall arch', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 2);
    fillColumn(town, SITE.B, 2);
    town.apply([place(SITE.cell, 1)]); // floating span, void at level 0
    const arches = detectArches(town);
    const spec = arches.get(SITE.cell);
    expect(spec).toBeDefined();
    expect(spec!.top).toBe(1);
    expect(spec!.endA).toBe('wall');
    expect(spec!.endB).toBe('wall');
    expect(new Set([spec!.supportA, spec!.supportB])).toEqual(new Set([SITE.A, SITE.B]));
  });

  it('needs support at BOTH ends and a truly floating column', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 2);
    town.apply([place(SITE.cell, 1)]); // only one side supported
    expect(detectArches(town).has(SITE.cell)).toBe(false);

    const town2 = freshTown(); // lone floating block: posts, not an arch
    town2.apply([place(SITE.cell, 1)]);
    expect(detectArches(town2).has(SITE.cell)).toBe(false);

    const town3 = freshTown(); // grounded column is never an arch
    fillColumn(town3, SITE.A, 2);
    fillColumn(town3, SITE.B, 2);
    fillColumn(town3, SITE.cell, 2);
    expect(detectArches(town3).has(SITE.cell)).toBe(false);
  });

  it('a taller void arches all the way up when both supports wall it', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 3);
    fillColumn(town, SITE.B, 3);
    town.apply([place(SITE.cell, 2)]); // void spans levels 0..1
    const spec = detectArches(town).get(SITE.cell);
    expect(spec).toBeDefined();
    expect(spec!.top).toBe(2);
    expect(spec!.endA).toBe('wall');
    // supports must cover the whole void: 1-tall neighbors are too short
    const town2 = freshTown();
    fillColumn(town2, SITE.A, 1);
    fillColumn(town2, SITE.B, 1);
    town2.apply([place(SITE.cell, 2)]);
    expect(detectArches(town2).has(SITE.cell)).toBe(false);
  });

  it('two floating spans in a row share pier ends', () => {
    const town = freshTown();
    // find the strict-opposite chain around SITE: A | cell | B, extend past B
    const cB = grid.cells[SITE.B]!;
    let kBack = -1;
    for (let k = 0; k < 4; k++) if (cB.neighbors[k] === SITE.cell) kBack = k;
    expect(kBack).toBeGreaterThanOrEqual(0);
    const far = cB.neighbors[(kBack + 2) % 4]!;
    // loud failure, not a silent skip: this is the only 'pier' coverage
    expect(far, 'strict chain beyond SITE.B must exist for pier coverage').toBeGreaterThanOrEqual(0);
    fillColumn(town, SITE.A, 2);
    town.apply([place(SITE.cell, 1), place(SITE.B, 1)]);
    fillColumn(town, far, 2);
    const arches = detectArches(town);
    const s1 = arches.get(SITE.cell);
    const s2 = arches.get(SITE.B);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    expect([s1!.endA, s1!.endB].sort()).toEqual(['pier', 'wall']);
    expect([s2!.endA, s2!.endB].sort()).toEqual(['pier', 'wall']);
  });

  it("a neighbor hovering far above the void is NOT a pier (nothing supports that end)", () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 2); // proper wall on one side
    town.apply([place(SITE.B, 10)]); // floater 9 levels above the void
    town.apply([place(SITE.cell, 1)]);
    expect(detectArches(town).has(SITE.cell)).toBe(false);
  });

  it('beach stairway attaches when an open side faces empty water', () => {
    const town = freshTown();
    fillColumn(town, BEACH.A, 1);
    fillColumn(town, BEACH.B, 1);
    town.apply([place(BEACH.cell, 1)]);
    const spec = detectArches(town).get(BEACH.cell);
    expect(spec).toBeDefined();
    expect(spec!.beachK).toBeGreaterThanOrEqual(0);
    expect(spec!.beachCell).toBeGreaterThanOrEqual(0);
    expect(town.isLand(spec!.beachCell)).toBe(false);
    expect(town.filled[spec!.beachCell]).toBe(0);
    // filling the water cell removes the steps but keeps the arch
    town.apply([place(spec!.beachCell, 0)]);
    const after = detectArches(town).get(BEACH.cell);
    expect(after).toBeDefined();
    expect(after!.beachCell).not.toBe(spec!.beachCell);
  });

  it('archSignature encodes every spec field', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 2);
    fillColumn(town, SITE.B, 2);
    town.apply([place(SITE.cell, 1)]);
    const spec = detectArches(town).get(SITE.cell)!;
    expect(archSignature(spec)).toBe(
      `A${spec.cell},${spec.kA},${spec.top},${spec.endA[0]},${spec.endB[0]},${spec.supportA},${spec.supportB},${spec.beachK},${spec.beachCell}`
    );
    expect(archSignature({ ...spec, top: spec.top + 1 })).not.toBe(archSignature(spec));
    expect(archSignature({ ...spec, endA: 'pier' })).not.toBe(archSignature(spec));
    expect(archSignature({ ...spec, beachK: 2 })).not.toBe(archSignature(spec));
  });
});

describe('arch emission', () => {
  function emitSite(): { spec: ArchSpec; sink: GeoSink } {
    const town = freshTown();
    fillColumn(town, SITE.A, 2);
    fillColumn(town, SITE.B, 2);
    town.apply([place(SITE.cell, 1)]);
    const spec = detectArches(town).get(SITE.cell)!;
    const sink = new GeoSink();
    emitArch(sink, town, spec);
    return { spec, sink };
  }

  it('emits finite, budgeted geometry inside the arch cell footprint', () => {
    const { spec, sink } = emitSite();
    expect(sink.pos.length).toBeGreaterThan(0);
    expect(sink.pos.length % 9).toBe(0);
    expect(sink.col.length).toBe(sink.pos.length);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(400);

    const c = grid.cells[spec.cell]!;
    for (let i = 0; i < sink.pos.length; i += 3) {
      const x = sink.pos[i]!;
      const y = sink.pos[i + 1]!;
      const z = sink.pos[i + 2]!;
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(insideCell(grid, c, x, z, 0.02)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(SEA_FLOOR - 0.05);
      expect(y).toBeLessThanOrEqual(levelY(spec.top) + 0.05);
    }
  });

  it('beach steps actually descend into the water cell, inside both footprints', () => {
    const town = freshTown();
    fillColumn(town, BEACH.A, 1);
    fillColumn(town, BEACH.B, 1);
    town.apply([place(BEACH.cell, 1)]);
    const spec = detectArches(town).get(BEACH.cell)!;
    const sink = new GeoSink();
    emitArch(sink, town, spec);
    const cArch = grid.cells[spec.cell]!;
    const cSea = grid.cells[spec.beachCell]!;
    let seaVerts = 0;
    let submerged = 0;
    for (let i = 0; i < sink.pos.length; i += 3) {
      const x = sink.pos[i]!;
      const y = sink.pos[i + 1]!;
      const z = sink.pos[i + 2]!;
      const inSea = insideCell(grid, cSea, x, z, 0.02);
      const ok = insideCell(grid, cArch, x, z, 0.02) || inSea;
      expect(ok).toBe(true);
      if (inSea && !insideCell(grid, cArch, x, z, 0.02)) {
        seaVerts++;
        if (y < LAND_TOP - 0.1) submerged++;
      }
    }
    // the steps must exist: a clipping regression that silently skips them
    // (tMax guard, edge-normal sign) would otherwise leave this test green
    expect(seaVerts).toBeGreaterThan(20);
    expect(submerged).toBeGreaterThan(10);
  });

  it('is deterministic: two runs produce identical arrays', () => {
    const a = emitSite();
    const b = emitSite();
    expect(b.spec).toEqual(a.spec);
    expect(b.sink.pos).toEqual(a.sink.pos);
    expect(b.sink.col).toEqual(a.sink.col);
  });
});
