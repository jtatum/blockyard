import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { evalDay, evalSun, type DayState } from '../src/render/daylight';

const STEPS = 512;
const samples: DayState[] = [];
for (let i = 0; i <= STEPS; i++) samples.push(evalDay(i / STEPS));

const COLOR_CHANNELS: readonly (keyof DayState)[] = [
  'sunColor', 'skyZenith', 'skyHorizon', 'ambientSky', 'ambientGround',
  'fogColor', 'waterDeep', 'waterShallow',
];

function channels(s: DayState, key: keyof DayState): [number, number, number] {
  const c = s[key] as THREE.Color;
  return [c.r, c.g, c.b];
}

describe('evalDay', () => {
  it('returns finite, in-range values across the full sweep', () => {
    for (const s of samples) {
      for (const v of [s.sunDir.x, s.sunDir.y, s.sunDir.z]) expect(Number.isFinite(v)).toBe(true);
      for (const key of COLOR_CHANNELS) {
        for (const v of channels(s, key)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      for (const v of [s.sunIntensity, s.ambientIntensity, s.exposure]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      expect(s.nightness).toBeGreaterThanOrEqual(0);
      expect(s.nightness).toBeLessThanOrEqual(1);
    }
  });

  it('sunDir is normalized everywhere', () => {
    for (const s of samples) expect(s.sunDir.length()).toBeCloseTo(1, 6);
  });

  it('is full day at midday, full night by 0.95', () => {
    expect(evalDay(0.4).nightness).toBe(0);
    expect(evalDay(0.5).nightness).toBe(0);
    expect(evalDay(0.95).nightness).toBeGreaterThan(0.95);
    expect(evalDay(1).nightness).toBeGreaterThan(0.95);
  });

  it('nightness ramps monotonically into night after 0.8', () => {
    let prev = evalDay(0.8).nightness;
    for (let t = 0.8; t <= 0.95; t += 0.005) {
      const n = evalDay(t).nightness;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(evalDay(0.95).nightness).toBeGreaterThan(evalDay(0.8).nightness);
  });

  it('has no keyframe jumps: adjacent samples differ by small deltas', () => {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      expect(a.sunDir.distanceTo(b.sunDir)).toBeLessThan(0.05);
      for (const key of COLOR_CHANNELS) {
        const ca = channels(a, key);
        const cb = channels(b, key);
        for (let c = 0; c < 3; c++) expect(Math.abs(ca[c]! - cb[c]!)).toBeLessThan(0.08);
      }
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.1);
      expect(Math.abs(a.ambientIntensity - b.ambientIntensity)).toBeLessThan(0.05);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.05);
      expect(Math.abs(a.nightness - b.nightness)).toBeLessThan(0.05);
    }
  });

  it('golden hour is warm and low, moonlight is cool and casts real shadows', () => {
    const golden = evalDay(0.78);
    expect(golden.sunColor.r).toBeGreaterThan(golden.sunColor.b); // warm
    expect(-golden.sunDir.y).toBeLessThan(Math.sin((25 * Math.PI) / 180)); // low sun
    const day = evalDay(0.5);
    const night = evalDay(0.97);
    expect(night.sunColor.b).toBeGreaterThan(night.sunColor.r); // cool
    // strong enough for readable shadows, still clearly weaker than the sun
    expect(night.sunIntensity).toBeGreaterThan(day.sunIntensity * 0.3);
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity * 0.55);
  });

  it('night stays readable: ambient, sky, and exposure above the floors', () => {
    // "bright moonlit night" — unlit walls must read; see daylight.ts header
    const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const day = evalDay(0.5);
    for (const t of [0.95, 1]) {
      const night = evalDay(t);
      expect(night.ambientIntensity).toBeGreaterThanOrEqual(0.5);
      expect(night.ambientIntensity).toBeGreaterThanOrEqual(day.ambientIntensity * 0.5);
      // deep-but-readable indigo, not near-black (linear-space luminance)
      expect(lum(night.skyZenith)).toBeGreaterThan(0.02);
      expect(lum(night.skyHorizon)).toBeGreaterThan(0.04);
      expect(night.exposure).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe('evalSun (azimuth)', () => {
  it('azimuth 0 (and a full turn) match the classic evalDay path', () => {
    for (const t of [0, 0.25, 0.5, 0.78, 0.95, 1]) {
      const base = evalDay(t).sunDir;
      expect(evalSun(t, 0).sunDir.distanceTo(base)).toBeLessThan(1e-9);
      expect(evalSun(t, 1).sunDir.distanceTo(base)).toBeLessThan(1e-6);
    }
  });

  it('rotates around Y only: elevation and normalization preserved', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const base = evalDay(t).sunDir;
      for (const az of [0.1, 0.25, 0.37, 0.5, 0.62, 0.9]) {
        const dir = evalSun(t, az).sunDir;
        expect(dir.length()).toBeCloseTo(1, 6);
        expect(dir.y).toBeCloseTo(base.y, 6);
      }
    }
  });

  it('azimuth 0.25 is a quarter turn, 0.5 mirrors the sun to the far horizon', () => {
    const base = evalDay(0.5).sunDir;
    const quarter = evalSun(0.5, 0.25).sunDir;
    expect(quarter.x).toBeCloseTo(base.z, 6);
    expect(quarter.z).toBeCloseTo(-base.x, 6);
    // half a turn negates the horizontal component: the noon sun that sat on
    // the +Z side of the sky now hangs over the opposite (northern) horizon
    const half = evalSun(0.5, 0.5).sunDir;
    expect(half.x).toBeCloseTo(-base.x, 6);
    expect(half.z).toBeCloseTo(-base.z, 6);
    expect(Math.sign(-half.z)).toBe(-Math.sign(-base.z));
  });

  it('azimuth only moves the sun — every other channel is unchanged', () => {
    const plain = evalDay(0.82);
    const spun = evalSun(0.82, 0.7);
    expect(spun.sunIntensity).toBe(plain.sunIntensity);
    expect(spun.ambientIntensity).toBe(plain.ambientIntensity);
    expect(spun.nightness).toBe(plain.nightness);
    expect(spun.exposure).toBe(plain.exposure);
    expect(spun.sunColor.getHex()).toBe(plain.sunColor.getHex());
    expect(spun.skyZenith.getHex()).toBe(plain.skyZenith.getHex());
  });
});
