/**
 * Alley staircase special build — detection rules, emission safety envelope
 * (finite, budgeted, inside the gap cell), and determinism. Headless: GeoSink
 * needs no WebGL.
 */

import { describe, expect, it } from 'vitest';
import { GeoSink } from '../src/arch/geom';
import { detectStairs, emitStairs, stairsSignature, type StairSpec } from '../src/arch/stairs';
import { LAND_TOP, levelY } from '../src/core/constants';
import { generateGrid } from '../src/grid/generate';
import { Town, type Edit } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(13);
  return town;
}

const place = (cell: number, level: number, color = 1): Edit => ({
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

/** same "roughly opposite" rule stairs.ts uses (dot of outward normals < −0.2) */
function oppositeEdge(cellId: number, k: number): number {
  const c = grid.cells[cellId]!;
  const nIn = grid.edgeNormal(c, k);
  let best = -1;
  let bestDot = 0.2;
  for (let j = 0; j < 4; j++) {
    if (j === k) continue;
    const n = grid.edgeNormal(c, j);
    const d = -(n.x * nIn.x + n.y * nIn.y);
    if (d > bestDot) {
      bestDot = d;
      best = j;
    }
  }
  return best;
}

/**
 * A known qualifying site found programmatically: a land gap cell with a
 * valid opposite pair (A, B), chosen so that NO other cell is adjacent to
 * both A and B — filling only A and B then makes the gap the unique match.
 */
function findSite(): { gap: number; kA: number; A: number; B: number } {
  const town = freshTown(); // fresh island just for isLand queries
  for (const c of grid.cells) {
    if (!town.isLand(c.id)) continue;
    for (let kA = 0; kA < 4; kA++) {
      const A = c.neighbors[kA]!;
      if (A < 0 || !town.isLand(A)) continue;
      const kB = oppositeEdge(c.id, kA);
      if (kB < 0) continue;
      const B = c.neighbors[kB]!;
      if (B < 0 || B === A || !town.isLand(B)) continue;
      const nearA = new Set(grid.cells[A]!.neighbors.filter((n) => n >= 0));
      const shared = grid.cells[B]!.neighbors.filter(
        (n) => n >= 0 && n !== c.id && nearA.has(n)
      );
      if (shared.length > 0) continue; // another cell flanks both — ambiguous
      return { gap: c.id, kA, A, B };
    }
  }
  throw new Error('no qualifying stair site on the default grid');
}

const SITE = findSite();

describe('stairs detection', () => {
  it('finds exactly the constructed gap with levels = min column height', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 3);
    fillColumn(town, SITE.B, 3);
    const specs = detectStairs(town);
    expect(specs).toHaveLength(1);
    const spec = specs[0]!;
    expect(spec.cell).toBe(SITE.gap);
    expect(spec.levels).toBe(3);
    expect(new Set([spec.cellA, spec.cellB])).toEqual(new Set([SITE.A, SITE.B]));
    // kA is the gap's edge facing cellA
    expect(grid.cells[spec.cell]!.neighbors[spec.kA]).toBe(spec.cellA);
  });

  it('does not fire when the gap cell itself is filled', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 3);
    fillColumn(town, SITE.B, 3);
    town.apply([place(SITE.gap, 0)]);
    expect(detectStairs(town)).toHaveLength(0);
  });

  it('does not fire between a tower and a 1-storey shed (levels >= 2 rule)', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 3);
    fillColumn(town, SITE.B, 1);
    expect(detectStairs(town)).toHaveLength(0);
  });

  it('clamps levels to 5 beside very tall towers, and emits within budget there', () => {
    const town = freshTown();
    fillColumn(town, SITE.A, 9);
    fillColumn(town, SITE.B, 7);
    const specs = detectStairs(town);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.levels).toBe(5);
    const sink = new GeoSink();
    emitStairs(sink, town, specs[0]!);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(900);
    for (const v of sink.pos) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('stairs emission', () => {
  function emitSite(): { spec: StairSpec; sink: GeoSink } {
    const town = freshTown();
    fillColumn(town, SITE.A, 3);
    fillColumn(town, SITE.B, 3);
    const spec = detectStairs(town)[0]!;
    const sink = new GeoSink();
    emitStairs(sink, town, spec);
    return { spec, sink };
  }

  it('emits finite, budgeted geometry inside the gap cell footprint', () => {
    const { spec, sink } = emitSite();
    expect(sink.pos.length).toBeGreaterThan(0);
    expect(sink.pos.length % 9).toBe(0);
    expect(sink.col.length).toBe(sink.pos.length);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(900); // triangle budget

    // gap cell AABB (grid plane (x, y) -> three (x, z)), inflated 0.05
    const c = grid.cells[spec.cell]!;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const v = grid.corner(c, k);
      bx0 = Math.min(bx0, v.x);
      bx1 = Math.max(bx1, v.x);
      bz0 = Math.min(bz0, v.y);
      bz1 = Math.max(bz1, v.y);
    }
    const yMin = LAND_TOP - 0.05;
    const yMax = levelY(spec.levels) + 0.6;
    for (let i = 0; i < sink.pos.length; i += 3) {
      const x = sink.pos[i]!;
      const y = sink.pos[i + 1]!;
      const z = sink.pos[i + 2]!;
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(Number.isFinite(z)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(yMin);
      expect(y).toBeLessThanOrEqual(yMax);
      expect(x).toBeGreaterThanOrEqual(bx0 - 0.05);
      expect(x).toBeLessThanOrEqual(bx1 + 0.05);
      expect(z).toBeGreaterThanOrEqual(bz0 - 0.05);
      expect(z).toBeLessThanOrEqual(bz1 + 0.05);
    }
    for (const v of sink.col) expect(Number.isFinite(v)).toBe(true);
  });

  it('is deterministic: two runs produce identical arrays', () => {
    const a = emitSite();
    const b = emitSite();
    expect(b.spec).toEqual(a.spec);
    expect(b.sink.pos).toEqual(a.sink.pos);
    expect(b.sink.col).toEqual(a.sink.col);
  });

  it('stairsSignature encodes every spec field and distinguishes specs', () => {
    const { spec } = emitSite();
    expect(stairsSignature(spec)).toBe(
      `S${spec.cell},${spec.kA},${spec.cellA},${spec.cellB},${spec.levels}`
    );
    expect(stairsSignature({ ...spec, levels: spec.levels + 1 })).not.toBe(stairsSignature(spec));
    expect(stairsSignature({ ...spec, kA: (spec.kA + 1) % 4 })).not.toBe(stairsSignature(spec));
  });
});

describe('stairs sweep', () => {
  it('two 4-tall towers + a 3-cell row: detection total, specs valid, emission safe', () => {
    const town = freshTown();
    // two separated 4-tall towers (they flank the known gap, so the sweep
    // is guaranteed non-vacuous) ...
    fillColumn(town, SITE.A, 4);
    fillColumn(town, SITE.B, 4);
    // ... plus a 3-cell row walked along adjacency
    const row: number[] = [cellNear(-5, 3)];
    while (row.length < 3) {
      const cur = grid.cells[row[row.length - 1]!]!;
      const next = cur.neighbors.find((n) => n >= 0 && !row.includes(n));
      if (next === undefined) break;
      row.push(next);
    }
    expect(row).toHaveLength(3);
    for (const cell of row) fillColumn(town, cell, 2);

    let specs: StairSpec[] = [];
    expect(() => {
      specs = detectStairs(town);
    }).not.toThrow();
    expect(specs.length).toBeGreaterThanOrEqual(1); // at least the known gap

    const seenGaps = new Set<number>();
    for (const s of specs) {
      // one spec per gap cell
      expect(seenGaps.has(s.cell)).toBe(false);
      seenGaps.add(s.cell);
      // gap is empty land; flanks are ground-rooted neighbors
      expect(town.filled[s.cell]).toBe(0);
      expect(town.isLand(s.cell)).toBe(true);
      expect(town.isFilled(s.cellA, 0)).toBe(true);
      expect(town.isFilled(s.cellB, 0)).toBe(true);
      expect(grid.cells[s.cell]!.neighbors[s.kA]).toBe(s.cellA);
      expect(grid.cells[s.cell]!.neighbors).toContain(s.cellB);
      expect(s.levels).toBeGreaterThanOrEqual(2);
      expect(s.levels).toBeLessThanOrEqual(5);
      // emission never throws and stays finite + budgeted
      const sink = new GeoSink();
      expect(() => emitStairs(sink, town, s)).not.toThrow();
      expect(sink.pos.length / 9).toBeLessThanOrEqual(900);
      for (const v of sink.pos) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
