/**
 * Versioned compact binary codec for the whole town (product spec §3.11,
 * tech doc §7). One flat byte layout, then optionally deflate + base64url
 * for share codes.
 *
 * Layout (version 1, all multi-byte ints little-endian or LEB128 varint):
 *   [0]      version byte (=1)
 *   [1..4]   gridSeed uint32 LE — the grid is NOT stored; it regenerates
 *            deterministically from this seed (determinism law)
 *   [5]      timeOfDay quantized to uint8 (0..255)
 *   varint   cell count n (decode must not assume the caller's grid, so the
 *            arrays are self-describing; the caller validates n afterwards)
 *   n/8 bits terrain, bit=LAND, LSB-first per byte, padding bits zero
 *   records  per non-empty cell, in ascending cell order:
 *              varint  cellId delta from previous non-empty cell (prev
 *                      starts at -1, so deltas are always >= 1)
 *              varint  uint32 level bitmask
 *              bytes   one 4-bit palette index per set bit (level order,
 *                      low nibble first, odd count padded with 0)
 *   [last]   checksum: XOR of every previous byte
 *
 * Decode is defensive: every malformed input — wrong version, bad checksum,
 * overrun, out-of-range id/mask/color — throws Error('bad save code') and
 * nothing else. Corrupt data must never surface as a random exception.
 */

import { MAX_LEVELS } from '../core/constants';
import { PALETTE } from './palette';
import { LAND, type Town } from './town';

const VERSION = 1;
/** allocation guard: a corrupt varint must not make us allocate gigabytes */
const MAX_CELLS = 1 << 20;
const LEVEL_MASK_LIMIT = 1 << MAX_LEVELS;

export interface DecodedTown {
  gridSeed: number;
  timeOfDay: number;
  /** LAND/WATER per cell, length = cell count */
  terrain: Uint8Array;
  /** level bitmask per cell, length = cell count */
  filled: Uint32Array;
  /** color per (cell, level), length = cell count * MAX_LEVELS */
  colors: Uint8Array;
}

function badSave(): Error {
  return new Error('bad save code');
}

function pushVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

/** bounds-checked byte reader — any overrun is a bad save, not a crash */
class Reader {
  private off = 0;
  constructor(private readonly bytes: Uint8Array, private readonly end: number) {}

  get remaining(): number {
    return this.end - this.off;
  }

  byte(): number {
    if (this.off >= this.end) throw badSave();
    return this.bytes[this.off++]!;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw badSave();
    }
    if (result > 0xffffffff) throw badSave();
    return result;
  }
}

export function encodeTown(town: Town): Uint8Array {
  const out: number[] = [];
  out.push(VERSION);
  const seed = town.grid.seed >>> 0;
  out.push(seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff, (seed >>> 24) & 0xff);
  const t = Math.min(1, Math.max(0, town.timeOfDay));
  out.push(Math.round(t * 255));

  const n = town.grid.cells.length;
  pushVarint(out, n);

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
    pushVarint(out, cell - prev);
    prev = cell;
    pushVarint(out, mask);
    const nibbles: number[] = [];
    for (let level = 0; level < MAX_LEVELS; level++) {
      if ((mask & (1 << level)) === 0) continue;
      const color = town.colors[cell * MAX_LEVELS + level]!;
      if (color > 0xf) throw new Error(`color ${color} exceeds 4-bit save range`);
      nibbles.push(color);
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

export function decodeTown(bytes: Uint8Array): DecodedTown {
  if (bytes.length < 8) throw badSave();
  let checksum = 0;
  for (let i = 0; i < bytes.length - 1; i++) checksum ^= bytes[i]!;
  if (checksum !== bytes[bytes.length - 1]) throw badSave();

  const r = new Reader(bytes, bytes.length - 1);
  if (r.byte() !== VERSION) throw badSave();
  const gridSeed = (r.byte() | (r.byte() << 8) | (r.byte() << 16) | (r.byte() << 24)) >>> 0;
  const timeOfDay = r.byte() / 255;

  const n = r.varint();
  if (n > MAX_CELLS) throw badSave();

  const terrain = new Uint8Array(n);
  for (let i = 0; i < n; i += 8) {
    const b = r.byte();
    for (let j = 0; j < 8; j++) {
      if (i + j < n) terrain[i + j] = (b >> j) & 1;
      else if ((b >> j) & 1) throw badSave(); // padding bits must be zero
    }
  }

  const filled = new Uint32Array(n);
  const colors = new Uint8Array(n * MAX_LEVELS);
  let cell = -1;
  while (r.remaining > 0) {
    const delta = r.varint();
    if (delta < 1) throw badSave();
    cell += delta;
    if (cell >= n) throw badSave();
    const mask = r.varint();
    if (mask === 0 || mask >= LEVEL_MASK_LIMIT) throw badSave();
    filled[cell] = mask;
    let pending = -1; // buffered byte holding the next high nibble, or -1
    for (let level = 0; level < MAX_LEVELS; level++) {
      if ((mask & (1 << level)) === 0) continue;
      let color: number;
      if (pending < 0) {
        pending = r.byte();
        color = pending & 0xf;
      } else {
        color = pending >> 4;
        pending = -1;
      }
      if (color >= PALETTE.length) throw badSave();
      colors[cell * MAX_LEVELS + level] = color;
    }
    if (pending >= 0 && pending >> 4 !== 0) throw badSave(); // pad nibble must be zero
  }

  return { gridSeed, timeOfDay, terrain, filled, colors };
}

/**
 * Overwrite a town's state from a decoded snapshot, in place. The caller is
 * responsible for having regenerated the grid from snap.gridSeed; mismatched
 * seed or array lengths mean the save does not fit this grid.
 */
export function applySnapshot(town: Town, snap: DecodedTown): void {
  if (
    (town.grid.seed >>> 0) !== snap.gridSeed ||
    snap.terrain.length !== town.terrain.length ||
    snap.filled.length !== town.filled.length ||
    snap.colors.length !== town.colors.length
  ) {
    throw badSave();
  }
  town.terrain.set(snap.terrain);
  town.filled.set(snap.filled);
  town.colors.set(snap.colors);
  town.timeOfDay = snap.timeOfDay;
  town.notify(new Set(town.grid.cells.map((c) => c.id)));
}

// -- share codes: deflate-raw + base64url ------------------------------------

async function pipeThrough(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  // fresh copy pins the buffer type to ArrayBuffer for BlobPart
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(code: string): Uint8Array {
  if (code.length === 0 || !/^[A-Za-z0-9_-]+$/.test(code)) throw badSave();
  let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw badSave();
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeShareCode(town: Town): Promise<string> {
  const deflated = await pipeThrough(encodeTown(town), new CompressionStream('deflate-raw'));
  return toBase64url(deflated);
}

export async function decodeShareCode(code: string): Promise<DecodedTown> {
  let bytes: Uint8Array;
  try {
    bytes = await pipeThrough(fromBase64url(code), new DecompressionStream('deflate-raw'));
  } catch {
    throw badSave();
  }
  return decodeTown(bytes);
}
