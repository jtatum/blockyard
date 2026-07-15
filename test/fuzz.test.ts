/**
 * Totality / fuzz gate (product spec §5.2 "Solver totality", §4 "Undo
 * fidelity"). Law under test: for ANY sequence of user actions the derived
 * geometry never throws, never hangs, and is always finite. Runs headless —
 * three.js BufferGeometry/Mesh need no WebGL. Every random choice comes from
 * the seeded rng, so any failure replays exactly from its seed string.
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArchMesher } from '../src/arch/mesher';
import { MAX_LEVELS } from '../src/core/constants';
import { hashKey, rng } from '../src/core/rng';
import { generateGrid } from '../src/grid/generate';
import { buildTerrainMesh } from '../src/render/terrainmesh';
import { History } from '../src/town/history';
import { PALETTE } from '../src/town/palette';
import { LAND, Town, WATER, type Base, type Edit } from '../src/town/town';

const grid = generateGrid(); // default world (seed 1337)
const N_CELLS = grid.cells.length;
const N_COLORS = PALETTE.length;

// ------------------------------------------------------------------ helpers

/** throw (with context) on the first non-finite float in a mesh's attributes */
function assertMeshFinite(mesh: THREE.Mesh, label: string): void {
  for (const name of ['position', 'normal', 'color'] as const) {
    const attr = mesh.geometry.getAttribute(name);
    if (!attr) continue;
    const arr = attr.array;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!;
      if (!Number.isFinite(v)) {
        throw new Error(`${label}: non-finite ${name}[${i}] = ${v}`);
      }
    }
  }
}

function assertGroupFinite(group: THREE.Group, label: string): void {
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) assertMeshFinite(obj as THREE.Mesh, label);
  });
}

/** town + incrementally-updated mesher wired the way the app wires them */
function buildTown(): { town: Town; mesher: ArchMesher } {
  const town = new Town(grid);
  town.seedIsland(13);
  const mesher = new ArchMesher(town);
  town.onChange((dirty) => mesher.update(dirty));
  return { town, mesher };
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

/** center cell + `rings` BFS rings of neighbors (a "5x5-ish" blob at rings=2) */
function blob(center: number, rings: number): number[] {
  const seen = new Set<number>([center]);
  let frontier = [center];
  for (let r = 0; r < rings; r++) {
    const next: number[] = [];
    for (const ci of frontier) {
      for (const n of grid.cells[ci]!.neighbors) {
        if (n >= 0 && !seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

const place = (cell: number, level: number, color: number): Edit => ({
  kind: 'voxel',
  cell,
  level,
  after: color,
});
const remove = (cell: number, level: number): Edit => ({
  kind: 'voxel',
  cell,
  level,
  after: null,
});
const terra = (cell: number, after: Base): Edit => ({ kind: 'terrain', cell, after });

/**
 * Colors are "meaningful only where filled" (town.ts): apply() deliberately
 * leaves stale color bytes under removed voxels, so state comparisons mask
 * colors to filled voxels — the observable colorAt() surface.
 */
function maskedColors(town: Town): Uint8Array {
  const out = new Uint8Array(town.colors.length);
  for (let c = 0; c < N_CELLS; c++) {
    for (let l = 0; l < MAX_LEVELS; l++) {
      if (town.isFilled(c, l)) out[c * MAX_LEVELS + l] = town.colors[c * MAX_LEVELS + l]!;
    }
  }
  return out;
}

/** quantize a float to 1e-4 for hashing (absorbs fp noise, normalizes -0) */
const q = (x: number): number => Math.round(x * 1e4) | 0;

/**
 * Group-order-independent geometry hash: geometries sorted by (vertex count,
 * then lexicographic quantized positions) so child order in the group —
 * which differs between incremental updates and a fresh rebuild — cannot
 * change the hash. hashKey folds in 4096-value chunks because spreading a
 * whole position array as arguments would blow the call stack.
 */
function hashGroup(group: THREE.Group): number {
  const geos: Float32Array[] = [];
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    geos.push(mesh.geometry.getAttribute('position')!.array as Float32Array);
  });
  geos.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    for (let i = 0; i < a.length; i++) {
      const d = q(a[i]!) - q(b[i]!);
      if (d !== 0) return d;
    }
    return 0;
  });
  let h = hashKey('geometry');
  let chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length) {
      h = hashKey(h, ...chunk);
      chunk = [];
    }
  };
  for (const arr of geos) {
    chunk.push(arr.length);
    for (let i = 0; i < arr.length; i++) {
      chunk.push(q(arr[i]!));
      if (chunk.length >= 4096) flush();
    }
  }
  flush();
  return h;
}

/** hash of the full observable town state (filled + masked colors + terrain) */
function hashTownState(town: Town): number {
  let h = hashKey('state');
  let chunk: number[] = [];
  const flush = (): void => {
    if (chunk.length) {
      h = hashKey(h, ...chunk);
      chunk = [];
    }
  };
  const push = (v: number): void => {
    chunk.push(v);
    if (chunk.length >= 4096) flush();
  };
  for (let i = 0; i < town.filled.length; i++) push(town.filled[i]!);
  const colors = maskedColors(town);
  for (let i = 0; i < colors.length; i++) push(colors[i]!);
  for (let i = 0; i < town.terrain.length; i++) push(town.terrain[i]!);
  flush();
  return h;
}

// ------------------------------------------------------------------- tests

describe('totality fuzz gate', () => {
  it('A: thousands of random edits never throw, geometry stays finite', { timeout: 25_000 }, () => {
    const { town, mesher } = buildTown();
    const r = rng('fuzz-a');
    const N = 4000;
    const t0 = performance.now();
    for (let i = 1; i <= N; i++) {
      const cell = r.int(N_CELLS);
      const roll = r.next();
      let edit: Edit;
      if (roll < 0.55) edit = place(cell, r.int(MAX_LEVELS), r.int(N_COLORS));
      else if (roll < 0.85) edit = remove(cell, r.int(MAX_LEVELS));
      else edit = terra(cell, r.chance(0.5) ? LAND : WATER);
      town.apply([edit]); // onChange listener drives mesher.update(dirty)
      // The app rebuilds the terrain mesh per edit; a full rebuild is O(all
      // cells) so the fuzz loop samples it every 50 edits to stay fast.
      if (i % 50 === 0) assertMeshFinite(buildTerrainMesh(town), `terrain after edit ${i}`);
      if (i % 500 === 0) assertGroupFinite(mesher.group, `arch after edit ${i}`);
    }
    const dt = (performance.now() - t0) / 1000;
    assertGroupFinite(mesher.group, 'arch at end');
    expect(town.blockCount()).toBeGreaterThan(0);
    console.log(`fuzz A: ${N} edits in ${dt.toFixed(1)}s (${Math.round(N / dt)} edits/s)`);
  });

  it('B: adversarial patterns mesh clean and finite', { timeout: 20_000 }, () => {
    // 1. tall isolated towers at the level cap
    {
      const { town, mesher } = buildTown();
      const spots: [number, number][] = [[0, 0], [6, 0], [-6, 4], [0, -7], [10, 10]];
      spots.forEach(([x, y], i) => {
        const cell = cellNear(x, y);
        const edits: Edit[] = [];
        for (let l = 0; l < MAX_LEVELS; l++) edits.push(place(cell, l, i % N_COLORS));
        town.apply(edits);
      });
      assertGroupFinite(mesher.group, 'isolated 24-level towers');
    }

    // 2. blob, then gut its supports so a slab floats
    {
      const { town, mesher } = buildTown();
      const cells = blob(cellNear(0, 0), 2);
      expect(cells.length).toBeGreaterThanOrEqual(9); // "5x5-ish"
      const fill: Edit[] = [];
      for (const c of cells) for (let l = 0; l < 3; l++) fill.push(place(c, l, 3));
      town.apply(fill);
      const inner = blob(cellNear(0, 0), 1);
      town.apply(inner.flatMap((c) => [remove(c, 0), remove(c, 1)]));
      for (const c of inner) {
        expect(town.isFilled(c, 2)).toBe(true); // the floater survives
        expect(town.isFilled(c, 0)).toBe(false);
      }
      assertGroupFinite(mesher.group, 'floating slab');
    }

    // 3. color stripes every level (roof kind flips per level)
    {
      const { town, mesher } = buildTown();
      const cell = cellNear(2, 2);
      const edits: Edit[] = [];
      for (let l = 0; l < MAX_LEVELS; l++) edits.push(place(cell, l, l % N_COLORS));
      town.apply(edits);
      assertGroupFinite(mesher.group, 'striped tower');
    }

    // 4. a single land cell surrounded by water, built on
    {
      const { town, mesher } = buildTown();
      const cell = cellNear(0, 0);
      const edits: Edit[] = grid.cells[cell]!.neighbors
        .filter((n) => n >= 0)
        .map((n) => terra(n, WATER));
      for (let l = 0; l < 6; l++) edits.push(place(cell, l, 9));
      town.apply(edits);
      assertGroupFinite(mesher.group, 'lone land cell');
      assertMeshFinite(buildTerrainMesh(town), 'lone land cell terrain');
    }

    // 5. blocks placed directly on water (pilings path)
    {
      const { town, mesher } = buildTown();
      const cell = cellNear(18, 0);
      expect(town.isLand(cell)).toBe(false);
      town.apply([0, 1, 2, 3].map((l) => place(cell, l, 10)));
      assertGroupFinite(mesher.group, 'stilt house on water');
    }

    // 6. an entire ring of land drowned under existing buildings
    {
      const { town, mesher } = buildTown();
      const ring = grid.cells
        .filter((c) => {
          const d = Math.hypot(c.cx, c.cy);
          return d >= 5 && d <= 7;
        })
        .map((c) => c.id);
      expect(ring.length).toBeGreaterThan(10);
      town.apply(ring.flatMap((c) => [place(c, 0, 1), place(c, 1, 1)]));
      town.apply(ring.map((c) => terra(c, WATER)));
      assertGroupFinite(mesher.group, 'drowned ring');
      assertMeshFinite(buildTerrainMesh(town), 'drowned ring terrain');
    }
  });

  it('C: undo/redo storm restores pristine state exactly (undo fidelity, product §4)', { timeout: 15_000 }, () => {
    const town = new Town(grid);
    town.seedIsland(13);
    const history = new History(town);
    const r = rng('fuzz-c');

    const pristineFilled = town.filled.slice();
    const pristineTerrain = town.terrain.slice();
    const pristineColors = maskedColors(town);

    // 300 commits — 150 standalone + 50 strokes of 3 — which fold into at
    // most 200 undoable commands, safely under History's MAX_DEPTH (250) so
    // the entire storm stays rewindable. (At >250 commands the oldest fall
    // off the stack by design and pristine recovery is impossible.)
    const script: ('solo' | 'stroke')[] = [
      ...(Array(150).fill('solo') as 'solo'[]),
      ...(Array(50).fill('stroke') as 'stroke'[]),
    ];
    r.shuffle(script);
    const randomEdit = (): Edit => {
      const cell = r.int(N_CELLS);
      const roll = r.next();
      if (roll < 0.5) return place(cell, r.int(MAX_LEVELS), r.int(N_COLORS));
      if (roll < 0.8) return remove(cell, r.int(MAX_LEVELS));
      return terra(cell, r.chance(0.5) ? LAND : WATER);
    };
    let commits = 0;
    for (const step of script) {
      if (step === 'solo') {
        history.commit([randomEdit()]);
        commits++;
      } else {
        history.beginStroke();
        for (let i = 0; i < 3; i++) {
          history.commit([randomEdit()]);
          commits++;
        }
        history.endStroke();
      }
    }
    expect(commits).toBe(300);

    const stormFilled = town.filled.slice();
    const stormTerrain = town.terrain.slice();
    const stormColors = maskedColors(town);
    expect(stormFilled).not.toEqual(pristineFilled); // the storm did something

    const checkPristine = (): void => {
      expect(town.filled).toEqual(pristineFilled);
      expect(town.terrain).toEqual(pristineTerrain);
      expect(maskedColors(town)).toEqual(pristineColors);
    };

    let undos = 0;
    while (history.undo()) undos++;
    expect(history.canUndo).toBe(false);
    expect(undos).toBeLessThanOrEqual(200);
    checkPristine();

    let redos = 0;
    while (history.redo()) redos++;
    expect(redos).toBe(undos);
    expect(town.filled).toEqual(stormFilled);
    expect(town.terrain).toEqual(stormTerrain);
    expect(maskedColors(town)).toEqual(stormColors);

    while (history.undo()) {
      /* rewind once more */
    }
    checkPristine();
  });

  // GOLDEN CONSTANTS — regenerate by setting both to 0, running
  //   npx vitest run test/fuzz.test.ts
  // and copying the "received" values from the two failing assertions.
  // They change whenever grid generation, meshing, the palette, or the
  // scripted edit sequence changes — that is the point: any unintended
  // drift in derived geometry or state fails this test.
  // (regenerated 2026-07-14: arc fillets, smooth normals, midpoint ridges)
  const GOLDEN_GEOMETRY_HASH = 1381507880;
  const GOLDEN_STATE_HASH = 4068677882;

  it('E: incremental ≡ rebuild across arch/staircase claim toggles', { timeout: 20_000 }, () => {
    const { town, mesher } = buildTown();
    const same = (label: string): void => {
      const rebuilt = hashGroup(new ArchMesher(town).group);
      expect(hashGroup(mesher.group), label).toBe(rebuilt);
    };

    // ---- large staircase site (strict-opposite flanks, plaza, open front) --
    const site = ((): { cell: number; L: number; R: number; front: number; plaza: number; ext: number } => {
      for (const c of grid.cells) {
        if (!town.isLand(c.id)) continue;
        if (c.neighbors.some((n) => n < 0 || !town.isLand(n))) continue;
        for (const kL of [0, 1]) {
          const L = c.neighbors[kL]!;
          const R = c.neighbors[kL + 2]!;
          for (const kF of [(kL + 1) % 4, (kL + 3) % 4]) {
            const front = c.neighbors[kF]!;
            const plaza = c.neighbors[(kF + 2) % 4]!;
            const ext = grid.cells[plaza]!.neighbors.find(
              (q) =>
                q >= 0 && q !== c.id && town.isLand(q) && q !== L && q !== R && q !== front &&
                !grid.cells[q]!.neighbors.includes(c.id)
            );
            if (ext !== undefined) return { cell: c.id, L, R, front, plaza, ext };
          }
        }
      }
      throw new Error('no claim-toggle site on the default grid');
    })();

    // build the surroundings, then the trigger block: claim toggles ON
    town.apply([0, 1].map((l) => place(site.L, l, 4)));
    town.apply([0, 1].map((l) => place(site.R, l, 5)));
    town.apply([place(site.plaza, 0, 6), place(site.ext, 0, 6)]);
    same('large-stair surroundings');
    town.apply([place(site.cell, 0, 7)]);
    expect(mesher.recipes.stairs.some((s) => s.cell === site.cell && s.kind === 'large')).toBe(true);
    same('large stair claimed');

    // a DISTANT edit kills the claim: the flank drops to one storey
    town.apply([remove(site.L, 1)]);
    expect(mesher.recipes.claimed.has(site.cell)).toBe(false);
    same('claim released by distant flank edit');
    town.apply([place(site.L, 1, 4)]);
    expect(mesher.recipes.claimed.has(site.cell)).toBe(true);
    same('claim restored by distant flank edit');

    // ---- archway on the same flanks: span the front cell over the ground ---
    town.apply([place(site.front, 1, 8)]); // floats between... may or may not arch
    same('floating span placed');
    town.apply([remove(site.front, 1)]);
    same('floating span removed');

    // ---- guaranteed arch: bridge the trigger cell axis ---------------------
    town.apply([remove(site.cell, 0)]);
    town.apply([place(site.cell, 1, 9)]); // L and R wall the void at level 0
    expect(mesher.recipes.arches.has(site.cell)).toBe(true);
    same('arch claimed');
    town.apply([remove(site.L, 0)]); // support hollowed out — arch must react
    same('arch support edited at distance');
  });

  it('D: scripted build hashes to the golden constants (determinism law)', { timeout: 20_000 }, () => {
    const { town, mesher } = buildTown();
    const r = rng('golden');
    for (let i = 0; i < 80; i++) {
      const cell = r.int(N_CELLS);
      const roll = r.next();
      let edit: Edit;
      if (roll < 0.7) edit = place(cell, r.int(6), r.int(N_COLORS));
      else if (roll < 0.85) edit = remove(cell, r.int(6));
      else edit = terra(cell, r.chance(0.5) ? LAND : WATER);
      town.apply([edit]);
    }
    const incremental = hashGroup(mesher.group);
    const rebuilt = hashGroup(new ArchMesher(town).group); // fresh full rebuild
    expect(incremental).toBe(rebuilt); // incremental updates ≡ full rebuild
    expect(incremental).toBe(GOLDEN_GEOMETRY_HASH);
    expect(hashTownState(town)).toBe(GOLDEN_STATE_HASH);
  });
});
