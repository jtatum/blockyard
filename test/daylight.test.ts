import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { evalDay, type DayState } from '../src/render/daylight';

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

  it('golden hour is warm and low, night light is cool and dim', () => {
    const golden = evalDay(0.78);
    expect(golden.sunColor.r).toBeGreaterThan(golden.sunColor.b); // warm
    expect(-golden.sunDir.y).toBeLessThan(Math.sin((25 * Math.PI) / 180)); // low sun
    const night = evalDay(0.97);
    expect(night.sunColor.b).toBeGreaterThan(night.sunColor.r); // cool
    expect(night.sunIntensity).toBeLessThan(0.6); // dim but present
    expect(night.sunIntensity).toBeGreaterThan(0.1);
  });
});
