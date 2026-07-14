import { describe, expect, it } from 'vitest';
import { generateGrid } from '../src/grid/generate';
import { rng } from '../src/core/rng';
import { MAX_LEVELS } from '../src/core/constants';
import { PALETTE } from '../src/town/palette';
import { LAND, Town, WATER, type Edit } from '../src/town/town';
import {
  applySnapshot,
  decodeShareCode,
  decodeTown,
  encodeShareCode,
  encodeTown,
} from '../src/town/serialize';

const ISLAND_RADIUS = 13; // matches main.ts

// grid generation is the slow part — share one immutable grid across tests
const grid = generateGrid({});

function freshTown(): Town {
  const town = new Town(grid);
  town.seedIsland(ISLAND_RADIUS);
  return town;
}

/** ~200 seeded random voxel/color/terrain edits — deterministic by law */
function scatteredTown(): Town {
  const town = freshTown();
  const r = rng('serialize-test', grid.seed);
  const edits: Edit[] = [];
  for (let i = 0; i < 200; i++) {
    if (r.chance(0.15)) {
      edits.push({
        kind: 'terrain',
        cell: r.int(grid.cells.length),
        after: r.chance(0.5) ? LAND : WATER,
      });
    } else {
      edits.push({
        kind: 'voxel',
        cell: r.int(grid.cells.length),
        level: r.int(MAX_LEVELS),
        after: r.chance(0.2) ? null : r.int(PALETTE.length),
      });
    }
  }
  town.apply(edits);
  town.timeOfDay = 0.62;
  town.sunAzimuth = 0.31;
  return town;
}

// -- frozen v1 encoder --------------------------------------------------------
// The version-1 codec as it shipped (no sunAzimuth byte), copied verbatim so
// we can prove decodeTown keeps reading old autosaves and share codes forever.

function pushVarintV1(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function encodeV1(town: Town): Uint8Array {
  const out: number[] = [];
  out.push(1); // version
  const seed = town.grid.seed >>> 0;
  out.push(seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff, (seed >>> 24) & 0xff);
  const t = Math.min(1, Math.max(0, town.timeOfDay));
  out.push(Math.round(t * 255));

  const n = town.grid.cells.length;
  pushVarintV1(out, n);

  for (let i = 0; i < n; i += 8) {
    let b = 0;
    for (let j = 0; j < 8 && i + j < n; j++) {
      if (town.terrain[i + j] === LAND) b |= 1 << j;
    }
    out.push(b);
  }

  let prev = -1;
  for (let cell = 0; cell < n; cell++) {
    const mask = town.filled[cell]!;
    if (mask === 0) continue;
    pushVarintV1(out, cell - prev);
    prev = cell;
    pushVarintV1(out, mask);
    const nibbles: number[] = [];
    for (let level = 0; level < MAX_LEVELS; level++) {
      if ((mask & (1 << level)) === 0) continue;
      nibbles.push(town.colors[cell * MAX_LEVELS + level]!);
    }
    for (let i = 0; i < nibbles.length; i += 2) {
      out.push(nibbles[i]! | ((nibbles[i + 1] ?? 0) << 4));
    }
  }

  let checksum = 0;
  for (const b of out) checksum ^= b;
  out.push(checksum);
  return Uint8Array.from(out);
}

/**
 * town.colors keeps stale values where blocks were deleted ("meaningful only
 * where filled") — the codec canonically stores 0 there, so build the
 * canonical expectation before comparing.
 */
function canonicalColors(town: Town): Uint8Array {
  const out = new Uint8Array(town.colors.length);
  for (const c of grid.cells) {
    for (let level = 0; level < MAX_LEVELS; level++) {
      if (town.isFilled(c.id, level)) out[c.id * MAX_LEVELS + level] = town.colorAt(c.id, level);
    }
  }
  return out;
}

function expectSnapshotMatches(snap: ReturnType<typeof decodeTown>, town: Town): void {
  expect(snap.gridSeed).toBe(grid.seed >>> 0);
  expect(Math.abs(snap.timeOfDay - town.timeOfDay)).toBeLessThanOrEqual(1 / 255);
  expect(Math.abs(snap.sunAzimuth - (town.sunAzimuth ?? 0))).toBeLessThanOrEqual(1 / 255);
  expect(snap.terrain).toEqual(town.terrain);
  expect(snap.filled).toEqual(town.filled);
  expect(snap.colors).toEqual(canonicalColors(town));
}

describe('town codec', () => {
  it('round-trips a scattered town exactly (v2, including sunAzimuth)', () => {
    const town = scatteredTown();
    expect(town.blockCount()).toBeGreaterThan(100); // the scatter actually built things
    const bytes = encodeTown(town);
    expect(bytes[0]).toBe(2); // format version 2
    const snap = decodeTown(bytes);
    expectSnapshotMatches(snap, town);
    expect(snap.sunAzimuth).toBeGreaterThan(0.3); // the azimuth byte is real
  });

  it('still decodes a version-1 byte stream, azimuth defaulting to 0', () => {
    const town = scatteredTown();
    const v1 = encodeV1(town);
    expect(v1[0]).toBe(1);
    const snap = decodeTown(v1);
    expect(snap.sunAzimuth).toBe(0); // v1 predates the field
    expect(snap.gridSeed).toBe(grid.seed >>> 0);
    expect(Math.abs(snap.timeOfDay - town.timeOfDay)).toBeLessThanOrEqual(1 / 255);
    expect(snap.terrain).toEqual(town.terrain);
    expect(snap.filled).toEqual(town.filled);
    expect(snap.colors).toEqual(canonicalColors(town));
  });

  it('round-trips an empty town', () => {
    const town = freshTown();
    const snap = decodeTown(encodeTown(town));
    expectSnapshotMatches(snap, town);
    expect(snap.filled.every((m) => m === 0)).toBe(true);
  });

  it('round-trips a full 24-level column', () => {
    const town = freshTown();
    const edits: Edit[] = [];
    for (let level = 0; level < MAX_LEVELS; level++) {
      edits.push({ kind: 'voxel', cell: 0, level, after: level % PALETTE.length });
    }
    town.apply(edits);
    const snap = decodeTown(encodeTown(town));
    expectSnapshotMatches(snap, town);
    expect(snap.filled[0]).toBe((1 << MAX_LEVELS) - 1 >>> 0);
  });

  it('round-trips all-water terrain', () => {
    const town = new Town(grid); // no seedIsland — everything WATER
    const snap = decodeTown(encodeTown(town));
    expectSnapshotMatches(snap, town);
    expect(snap.terrain.every((t) => t === WATER)).toBe(true);
  });

  it('is deterministic: same town encodes to identical bytes', () => {
    expect(encodeTown(scatteredTown())).toEqual(encodeTown(scatteredTown()));
  });

  it('applySnapshot overwrites in place and notifies all cells', () => {
    const town = scatteredTown();
    const snap = decodeTown(encodeTown(town));
    const target = new Town(grid);
    target.sunAzimuth = 0; // Town declares this; keep explicit for the guard
    let dirtySize = 0;
    target.onChange((dirty) => (dirtySize = dirty.size));
    applySnapshot(target, snap);
    expect(target.filled).toEqual(town.filled);
    expect(target.terrain).toEqual(town.terrain);
    expect(target.colors).toEqual(canonicalColors(town));
    expect(Math.abs(target.timeOfDay - town.timeOfDay)).toBeLessThanOrEqual(1 / 255);
    expect(Math.abs((target.sunAzimuth ?? 0) - town.sunAzimuth)).toBeLessThanOrEqual(1 / 255);
    expect(dirtySize).toBe(grid.cells.length);
  });

  it('applySnapshot rejects a snapshot for a different grid', () => {
    const town = scatteredTown();
    const snap = decodeTown(encodeTown(town));
    const otherGrid = generateGrid({ seed: 2, hexRadius: 3 });
    expect(() => applySnapshot(new Town(otherGrid), snap)).toThrow('bad save code');
  });
});

describe('corruption handling', () => {
  it('rejects single-byte flips with bad save code (never a random exception)', () => {
    const bytes = encodeTown(scatteredTown());
    const r = rng('corruption', 7);
    let throws = 0;
    for (let i = 0; i < 20; i++) {
      const copy = bytes.slice();
      const idx = r.int(copy.length);
      copy[idx] = copy[idx]! ^ (1 + r.int(255)); // xor nonzero -> guaranteed change
      try {
        decodeTown(copy);
      } catch (err) {
        expect((err as Error).message).toBe('bad save code');
        throws++;
      }
    }
    expect(throws).toBeGreaterThanOrEqual(15);
  });

  it('rejects a flip of the checksum byte itself', () => {
    const bytes = encodeTown(scatteredTown());
    const copy = bytes.slice();
    copy[copy.length - 1] = copy[copy.length - 1]! ^ 0xff;
    expect(() => decodeTown(copy)).toThrow('bad save code');
  });

  it('rejects truncated, empty, and wrong-version input', () => {
    const bytes = encodeTown(scatteredTown());
    expect(() => decodeTown(bytes.slice(0, bytes.length - 5))).toThrow('bad save code');
    expect(() => decodeTown(new Uint8Array(0))).toThrow('bad save code');
    expect(() => decodeTown(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]))).toThrow('bad save code');
    // versions outside 1..2 must be rejected; re-fix the checksum each time
    // so the version byte is the ONLY problem
    for (const version of [0, 3, 9]) {
      const wrongVersion = bytes.slice();
      wrongVersion[0] = version;
      let x = 0;
      for (let i = 0; i < wrongVersion.length - 1; i++) x ^= wrongVersion[i]!;
      wrongVersion[wrongVersion.length - 1] = x;
      expect(() => decodeTown(wrongVersion)).toThrow('bad save code');
    }
  });
});

// CompressionStream is global in Node >= 18 and all modern browsers; guard
// anyway so the suite degrades instead of crashing on exotic runtimes.
const hasStreams =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

describe.skipIf(!hasStreams)('share codes', () => {
  it('round-trips through deflate + base64url', async () => {
    const town = scatteredTown();
    const code = await encodeShareCode(town);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe, no padding
    const snap = await decodeShareCode(code);
    expectSnapshotMatches(snap, town);
  });

  it('rejects garbage codes with bad save code', async () => {
    await expect(decodeShareCode('')).rejects.toThrow('bad save code');
    await expect(decodeShareCode('!!!not base64url!!!')).rejects.toThrow('bad save code');
    await expect(decodeShareCode('AAAA')).rejects.toThrow('bad save code');
    await expect(decodeShareCode('A')).rejects.toThrow('bad save code');
    // valid deflate of garbage bytes -> inflates fine, fails the codec check
    const town = scatteredTown();
    const code = await encodeShareCode(town);
    await expect(decodeShareCode(code.slice(0, code.length - 4))).rejects.toThrow(
      'bad save code'
    );
  });
});
