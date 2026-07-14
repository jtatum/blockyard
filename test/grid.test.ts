import { describe, expect, it } from 'vitest';
import { generateGrid } from '../src/grid/generate';
import { hashKey, rng } from '../src/core/rng';

describe('seeded rng', () => {
  it('is deterministic for the same key', () => {
    const a = rng(42, 'x');
    const b = rng(42, 'x');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs across keys', () => {
    expect(rng(1, 'a').next()).not.toBe(rng(1, 'b').next());
  });
  it('stays in [0,1) and is roughly uniform', () => {
    const r = rng(7);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 10000).toBeGreaterThan(0.47);
    expect(sum / 10000).toBeLessThan(0.53);
  });
});

describe('organic grid', () => {
  const grid = generateGrid({ seed: 1337 });

  it('is all quads with valid invariants (convex, non-degenerate, symmetric adjacency)', () => {
    const { ok, problems } = grid.validate();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  it('has a sensible cell count for the default world', () => {
    expect(grid.cells.length).toBeGreaterThan(800);
    expect(grid.cells.length).toBeLessThan(2500);
  });

  it('is deterministic: same seed -> identical vertex positions', () => {
    const again = generateGrid({ seed: 1337 });
    const h = (g: typeof grid) =>
      hashKey(...g.vertices.flatMap((v) => [v.x, v.y]));
    expect(h(again)).toBe(h(grid));
    expect(again.cells.length).toBe(grid.cells.length);
  });

  it('differs across seeds', () => {
    const other = generateGrid({ seed: 2 });
    const h = (g: typeof grid) => hashKey(...g.vertices.flatMap((v) => [v.x, v.y]));
    expect(h(other)).not.toBe(h(grid));
  });

  it('point lookup finds the containing cell', () => {
    let hits = 0;
    for (const c of grid.cells) {
      const found = grid.cellAt(c.cx, c.cy);
      if (found === c.id) hits++;
    }
    // centroid of a convex quad is always inside it — every lookup must hit
    expect(hits).toBe(grid.cells.length);
  });

  it('relaxation produced near-square cells (aspect sanity)', () => {
    let worst = Infinity;
    for (const c of grid.cells) {
      let minEdge = Infinity, maxEdge = 0;
      for (let k = 0; k < 4; k++) {
        const a = grid.corner(c, k), b = grid.corner(c, k + 1);
        const len = Math.hypot(a.x - b.x, a.y - b.y);
        minEdge = Math.min(minEdge, len);
        maxEdge = Math.max(maxEdge, len);
      }
      worst = Math.min(worst, minEdge / maxEdge);
    }
    // interior cells should be quite square; boundary cells are pinned and rougher
    expect(worst).toBeGreaterThan(0.25);
  });
});
