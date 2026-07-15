/**
 * Staircase special builds — placed-block detection rules (small switchback
 * + large plaza stairs), emission safety envelope (finite, budgeted, inside
 * the trigger cell), and determinism. Headless: GeoSink needs no WebGL.
 */

import { describe, expect, it } from 'vitest';
import { GeoSink } from '../src/arch/geom';
import {
  detectStairs,
  emitLargeStairs,
  emitStairs,
  stairsSignature,
  type StairSpec,
} from '../src/arch/stairs';
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

const isNeighbor = (a: number, b: number): boolean =>
  grid.cells[a]!.neighbors.includes(b);

/**
 * A known qualifying SMALL site found programmatically: a land trigger cell
 * with a valid opposite flank pair (A, B) plus flank-extension cells (the
 * "2 long" rule), chosen so no other cell flanks both A and B and the
 * extensions never touch the trigger cell or the far flank.
 */
function findSmallSite(): { gap: number; kA: number; A: number; B: number; extA: number; extB: number } {
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
      const pickExt = (flank: number, avoid: number[]): number =>
        grid.cells[flank]!.neighbors.find(
          (n) =>
            n >= 0 &&
            town.isLand(n) &&
            !avoid.includes(n) &&
            !isNeighbor(n, c.id) // extensions never flank the trigger cell
        ) ?? -1;
      const extA = pickExt(A, [c.id, B]);
      const extB = pickExt(B, [c.id, A, extA]);
      if (extA < 0 || extB < 0 || isNeighbor(extA, extB)) continue;
      return { gap: c.id, kA, A, B, extA, extB };
    }
  }
  throw new Error('no qualifying small-stair site on the default grid');
}

/**
 * A known qualifying LARGE site: a land cell whose strict-opposite pair
 * (kL, kL+2) flanks it, with an empty front, a plaza cell behind, and a
 * plaza-continuation cell — all land, all distinct.
 */
function findLargeSite(): {
  cell: number;
  L: number;
  R: number;
  front: number;
  plaza: number;
  plazaExt: number;
} {
  const town = freshTown();
  for (const c of grid.cells) {
    if (!town.isLand(c.id)) continue;
    const n = c.neighbors;
    if (n.some((x) => x < 0 || !town.isLand(x))) continue;
    for (const kL of [0, 1]) {
      const L = n[kL]!;
      const R = n[kL + 2]!;
      for (const kF of [(kL + 1) % 4, (kL + 3) % 4]) {
        const front = n[kF]!;
        const plaza = n[(kF + 2) % 4]!;
        const plazaExt =
          grid.cells[plaza]!.neighbors.find(
            (q) =>
              q >= 0 &&
              q !== c.id &&
              town.isLand(q) &&
              q !== L &&
              q !== R &&
              q !== front &&
              !isNeighbor(q, c.id) // keep the plaza extension away from the trigger
          ) ?? -1;
        if (plazaExt < 0) continue;
        return { cell: c.id, L, R, front, plaza, plazaExt };
      }
    }
  }
  throw new Error('no qualifying large-stair site on the default grid');
}

const SMALL = findSmallSite();
const LARGE = findLargeSite();

/** flanks 3 tall, both extensions 2 tall (satisfies the "2 long" rule) */
function buildSmallFlanks(town: Town, hA = 3, hB = 3): void {
  fillColumn(town, SMALL.A, hA);
  fillColumn(town, SMALL.B, hB);
  fillColumn(town, SMALL.extA, 2);
  fillColumn(town, SMALL.extB, 2);
}

describe('small stairs detection', () => {
  it('a placed column between long, taller flanks becomes stairs of its own height', () => {
    const town = freshTown();
    buildSmallFlanks(town, 4, 4);
    fillColumn(town, SMALL.gap, 1);
    const specs = detectStairs(town);
    expect(specs).toHaveLength(1);
    const spec = specs[0]!;
    expect(spec.kind).toBe('small');
    expect(spec.cell).toBe(SMALL.gap);
    expect(spec.levels).toBe(1);
    expect(new Set([spec.cellA, spec.cellB])).toEqual(new Set([SMALL.A, SMALL.B]));
    expect(grid.cells[spec.cell]!.neighbors[spec.kA]).toBe(spec.cellA);

    // stack the trigger column and the stairs climb with it
    town.apply([place(SMALL.gap, 1), place(SMALL.gap, 2)]);
    const taller = detectStairs(town);
    expect(taller).toHaveLength(1);
    expect(taller[0]!.levels).toBe(3);
  });

  it('does NOT fire on an empty gap (stairs are placed, not spawned)', () => {
    const town = freshTown();
    buildSmallFlanks(town);
    expect(detectStairs(town)).toHaveLength(0);
  });

  it('does not fire when the column reaches or overtops the flanks, or floats', () => {
    const town = freshTown();
    buildSmallFlanks(town); // min flank height 3
    fillColumn(town, SMALL.gap, 3); // equal height = just more building
    expect(detectStairs(town)).toHaveLength(0);
    // non-contiguous column (floating span) is arch territory, not stairs
    const town2 = freshTown();
    buildSmallFlanks(town2);
    town2.apply([place(SMALL.gap, 1)]);
    expect(detectStairs(town2)).toHaveLength(0);
  });

  it('never eats the interior of a uniformly tall building (slab regression)', () => {
    const town = freshTown();
    // 2-ring blob around the small site, filled to a uniform flat slab
    const seen = new Set<number>([SMALL.gap]);
    let frontier = [SMALL.gap];
    for (let r = 0; r < 2; r++) {
      const next: number[] = [];
      for (const ci of frontier) {
        for (const n of grid.cells[ci]!.neighbors) {
          if (n >= 0 && town.isLand(n) && !seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    for (const c of seen) fillColumn(town, c, 2);
    expect(detectStairs(town)).toHaveLength(0);
    for (const c of seen) town.apply([place(c, 2), place(c, 3)]);
    expect(detectStairs(town)).toHaveLength(0);
  });

  it('requires flanks at least 2 tall AND 2 long', () => {
    const town = freshTown();
    fillColumn(town, SMALL.A, 3);
    fillColumn(town, SMALL.B, 1); // too short
    fillColumn(town, SMALL.extA, 2);
    fillColumn(town, SMALL.extB, 2);
    fillColumn(town, SMALL.gap, 1);
    expect(detectStairs(town)).toHaveLength(0);

    const town2 = freshTown();
    fillColumn(town2, SMALL.A, 3); // tall but lone towers — not "2 long"
    fillColumn(town2, SMALL.B, 3);
    fillColumn(town2, SMALL.gap, 1);
    expect(detectStairs(town2)).toHaveLength(0);
  });

  it('caps at 5 storeys and stays within the emission budget there', () => {
    const town = freshTown();
    buildSmallFlanks(town, 9, 7);
    fillColumn(town, SMALL.gap, 5);
    const specs = detectStairs(town);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.levels).toBe(5);
    const sink = new GeoSink();
    emitStairs(sink, town, specs[0]!);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(900);
    for (const v of sink.pos) expect(Number.isFinite(v)).toBe(true);
    // a 6-tall column is a building again
    town.apply([place(SMALL.gap, 5)]);
    expect(detectStairs(town)).toHaveLength(0);
  });
});

describe('large stairs detection', () => {
  function buildLargeSite(town: Town): void {
    fillColumn(town, LARGE.L, 2);
    fillColumn(town, LARGE.R, 2);
    fillColumn(town, LARGE.plaza, 1);
    fillColumn(town, LARGE.plazaExt, 1);
    fillColumn(town, LARGE.cell, 1);
  }

  it('a block with 2-tall flanks, plaza behind and open land in front goes monumental', () => {
    const town = freshTown();
    buildLargeSite(town);
    const specs = detectStairs(town).filter((s) => s.cell === LARGE.cell);
    expect(specs).toHaveLength(1);
    const spec = specs[0]!;
    expect(spec.kind).toBe('large');
    expect(spec.levels).toBe(1);
    expect(spec.cellA).toBe(LARGE.front);
    expect(spec.cellB).toBe(LARGE.plaza);
    expect(new Set([spec.flankL, spec.flankR])).toEqual(new Set([LARGE.L, LARGE.R]));
    expect(grid.cells[spec.cell]!.neighbors[spec.kA]).toBe(LARGE.front);
  });

  it('needs the open approach and the plaza continuation', () => {
    const town = freshTown();
    buildLargeSite(town);
    town.apply([place(LARGE.front, 0)]); // block the approach
    expect(detectStairs(town).filter((s) => s.cell === LARGE.cell && s.kind === 'large')).toHaveLength(0);

    const town2 = freshTown();
    fillColumn(town2, LARGE.L, 2);
    fillColumn(town2, LARGE.R, 2);
    fillColumn(town2, LARGE.plaza, 1); // lone deck cell — not a plaza
    fillColumn(town2, LARGE.cell, 1);
    expect(detectStairs(town2).filter((s) => s.cell === LARGE.cell && s.kind === 'large')).toHaveLength(0);
  });

  it('a second storey on the plaza (now a wall) kills the match', () => {
    const town = freshTown();
    buildLargeSite(town);
    town.apply([place(LARGE.plaza, 1)]);
    expect(detectStairs(town).filter((s) => s.cell === LARGE.cell && s.kind === 'large')).toHaveLength(0);
  });

  it('emits finite, budgeted geometry inside the trigger cell footprint', () => {
    const town = freshTown();
    buildLargeSite(town);
    const spec = detectStairs(town).find((s) => s.cell === LARGE.cell)!;
    const sink = new GeoSink();
    emitLargeStairs(sink, town, spec);
    expect(sink.pos.length).toBeGreaterThan(0);
    expect(sink.pos.length % 9).toBe(0);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(200);

    const c = grid.cells[spec.cell]!;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const v = grid.corner(c, k);
      bx0 = Math.min(bx0, v.x);
      bx1 = Math.max(bx1, v.x);
      bz0 = Math.min(bz0, v.y);
      bz1 = Math.max(bz1, v.y);
    }
    for (let i = 0; i < sink.pos.length; i += 3) {
      const x = sink.pos[i]!;
      const y = sink.pos[i + 1]!;
      const z = sink.pos[i + 2]!;
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(LAND_TOP - 0.05);
      expect(y).toBeLessThanOrEqual(levelY(1) + 0.05);
      expect(x).toBeGreaterThanOrEqual(bx0 - 0.05);
      expect(x).toBeLessThanOrEqual(bx1 + 0.05);
      expect(z).toBeGreaterThanOrEqual(bz0 - 0.05);
      expect(z).toBeLessThanOrEqual(bz1 + 0.05);
    }
  });
});

describe('stairs emission', () => {
  function emitSite(): { spec: StairSpec; sink: GeoSink } {
    const town = freshTown();
    buildSmallFlanks(town, 4, 4);
    fillColumn(town, SMALL.gap, 3);
    const spec = detectStairs(town)[0]!;
    const sink = new GeoSink();
    emitStairs(sink, town, spec);
    return { spec, sink };
  }

  it('emits finite, budgeted geometry inside the trigger cell footprint', () => {
    const { spec, sink } = emitSite();
    expect(sink.pos.length).toBeGreaterThan(0);
    expect(sink.pos.length % 9).toBe(0);
    expect(sink.col.length).toBe(sink.pos.length);
    expect(sink.pos.length / 9).toBeLessThanOrEqual(900); // triangle budget

    // trigger cell AABB (grid plane (x, y) -> three (x, z)), inflated 0.05
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
      `S${spec.kind[0]}${spec.cell},${spec.kA},${spec.cellA},${spec.cellB},${spec.flankL},${spec.flankR},${spec.levels}`
    );
    expect(stairsSignature({ ...spec, levels: spec.levels + 1 })).not.toBe(stairsSignature(spec));
    expect(stairsSignature({ ...spec, kA: (spec.kA + 1) % 4 })).not.toBe(stairsSignature(spec));
    expect(stairsSignature({ ...spec, kind: 'large' })).not.toBe(stairsSignature(spec));
  });
});

describe('stairs sweep', () => {
  it('a dense mixed build: detection total, specs valid, emission safe', () => {
    const town = freshTown();
    buildSmallFlanks(town, 4, 4);
    fillColumn(town, SMALL.gap, 2);
    // pile more mass around the large site too
    fillColumn(town, LARGE.L, 2);
    fillColumn(town, LARGE.R, 2);
    fillColumn(town, LARGE.plaza, 1);
    fillColumn(town, LARGE.plazaExt, 1);
    fillColumn(town, LARGE.cell, 1);

    let specs: StairSpec[] = [];
    expect(() => {
      specs = detectStairs(town);
    }).not.toThrow();
    expect(specs.length).toBeGreaterThanOrEqual(1);

    const seen = new Set<number>();
    for (const s of specs) {
      expect(seen.has(s.cell)).toBe(false); // one spec per trigger cell
      seen.add(s.cell);
      expect(town.isLand(s.cell)).toBe(true);
      expect(town.filled[s.cell]).not.toBe(0);
      expect(s.levels).toBeGreaterThanOrEqual(1);
      expect(s.levels).toBeLessThanOrEqual(5);
      const sink = new GeoSink();
      expect(() => {
        if (s.kind === 'large') emitLargeStairs(sink, town, s);
        else emitStairs(sink, town, s);
      }).not.toThrow();
      expect(sink.pos.length / 9).toBeLessThanOrEqual(900);
      for (const v of sink.pos) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
