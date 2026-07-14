/**
 * Seeded PRNG utilities — the ONLY legal source of randomness in generation
 * code (tech doc §1, determinism law). Every consumer derives a stream from
 * a stable key (seed + cell/vertex/voxel ids) so results are reproducible
 * across machines and releases. `Math.random()` is banned outside UI fluff.
 */

/** 32-bit string/int mixer (xmur3) used to fold arbitrary keys into seeds. */
function mix(h: number, x: number): number {
  h = Math.imul(h ^ x, 2654435761);
  h = (h << 13) | (h >>> 19);
  return Math.imul(h, 5) + 0x6ed9eb1;
}

export function hashKey(...parts: (number | string)[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    if (typeof p === 'number') {
      // fold doubles safely: split into two 32-bit halves
      const i = Math.floor(p);
      h = mix(h, i | 0);
      h = mix(h, Math.round((p - i) * 0xffffffff) | 0);
    } else {
      for (let i = 0; i < p.length; i++) h = mix(h, p.charCodeAt(i));
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Rng {
  /** uniform float in [0, 1) */
  next(): number;
  /** uniform int in [0, n) */
  int(n: number): number;
  /** uniform float in [a, b) */
  range(a: number, b: number): number;
  /** true with probability p */
  chance(p: number): boolean;
  /** pick a uniform element */
  pick<T>(arr: readonly T[]): T;
  /** weighted index pick; weights need not sum to 1 */
  weighted(weights: readonly number[]): number;
  /** Fisher–Yates shuffle in place */
  shuffle<T>(arr: T[]): T[];
}

/** sfc32 — fast, high-quality 128-bit-state PRNG. */
export function rng(...key: (number | string)[]): Rng {
  let a = hashKey(...key, 'a');
  let b = hashKey(...key, 'b');
  let c = hashKey(...key, 'c');
  let d = hashKey(...key, 'd');
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // warm up past any seed correlation
  for (let i = 0; i < 12; i++) next();
  const r: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)]!,
    weighted: (weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let x = next() * total;
      for (let i = 0; i < weights.length; i++) {
        x -= weights[i]!;
        if (x <= 0) return i;
      }
      return weights.length - 1;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    },
  };
  return r;
}
