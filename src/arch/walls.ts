/**
 * Wall + opening generation (product A1/A2, CD1) over smoothed outline
 * segments. Central segments (the straight middle of each original cell edge)
 * host windows and doors; fillet segments render plain so the curve reads
 * clean. Every palette entry has its own window kind, and some add plinth
 * base bands or timber cross-bracing — color changes the architecture.
 *
 * All variation is seeded on (gridSeed, cell, level, edge) so smoothing and
 * re-solves never scramble existing art.
 */

import * as THREE from 'three';
import { levelY } from '../core/constants';
import { rng } from '../core/rng';
import type { Grid } from '../grid/grid';
import { PALETTE, type WindowKind } from '../town/palette';
import type { Town } from '../town/town';
import { GeoSink, WallFrame } from './geom';
import type { OSeg } from './outline';

const REVEAL_D = 0.07;
const FRAME_T = 0.014;
const PLINTH_H = 0.22;

interface WindowSpec {
  w: number;
  h: number;
  sill: number;
  shutters?: boolean;
  mullion?: boolean;
  lattice?: boolean;
  lunette?: boolean;
  heavyFrame?: boolean;
}

const WINDOWS: Record<WindowKind, WindowSpec> = {
  cottage:  { w: 0.4,  h: 0.48, sill: 0.31, mullion: true },
  arch:     { w: 0.34, h: 0.46, sill: 0.28, lunette: true },
  shutter:  { w: 0.32, h: 0.56, sill: 0.27, shutters: true },
  wide:     { w: 0.52, h: 0.38, sill: 0.37 },
  slit:     { w: 0.24, h: 0.52, sill: 0.29 },
  lattice:  { w: 0.42, h: 0.5,  sill: 0.3,  lattice: true },
  porthole: { w: 0.26, h: 0.3,  sill: 0.42, heavyFrame: true },
};

/** fallback for short curved-tower faces */
const COMPACT: WindowSpec = { w: 0.22, h: 0.3, sill: 0.4, heavyFrame: true };

const wallColor = new THREE.Color();
const trimColor = new THREE.Color();
const darkColor = new THREE.Color();
const plinthColor = new THREE.Color();
const glassColor = new THREE.Color(0xfff1cf);

interface Opening {
  kind: 'window' | 'door';
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  spec: WindowSpec;
}

function emitWindowDressing(sink: GeoSink, glass: GeoSink, f: WallFrame, o: Opening): void {
  const { u0, u1, v0, v1, spec } = o;
  const fr = spec.heavyFrame ? 0.07 : 0.05;

  f.box(sink, u0 - fr, v0 - fr, u1 + fr, v0, FRAME_T, trimColor);
  f.box(sink, u0 - fr, v1, u1 + fr, v1 + fr, FRAME_T, trimColor);
  f.box(sink, u0 - fr, v0, u0, v1, FRAME_T, trimColor);
  f.box(sink, u1, v0, u1 + fr, v1, FRAME_T, trimColor);
  f.reveal(sink, u0, v0, u1, v1, REVEAL_D, darkColor);
  f.rect(glass, u0, v0, u1, v1, REVEAL_D, glassColor);
  f.box(sink, u0 - fr - 0.02, v0 - fr - 0.05, u1 + fr + 0.02, v0 - fr, 0.055, trimColor);

  if (spec.mullion) {
    const cu = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    f.rect(sink, cu - 0.016, v0, cu + 0.016, v1, REVEAL_D - 0.012, trimColor);
    f.rect(sink, u0, vm - 0.016, u1, vm + 0.016, REVEAL_D - 0.012, trimColor);
  }
  if (spec.lattice) {
    const du = (u1 - u0) / 3;
    const dv = (v1 - v0) / 3;
    for (let i = 1; i < 3; i++) {
      f.rect(sink, u0 + du * i - 0.011, v0, u0 + du * i + 0.011, v1, REVEAL_D - 0.012, trimColor);
      f.rect(sink, u0, v0 + dv * i - 0.011, u1, v0 + dv * i + 0.011, REVEAL_D - 0.012, trimColor);
    }
  }
  if (spec.shutters) {
    f.box(sink, u0 - fr - 0.14, v0, u0 - fr - 0.03, v1, 0.03, trimColor);
    f.box(sink, u1 + fr + 0.03, v0, u1 + fr + 0.14, v1, 0.03, trimColor);
  }
  if (spec.lunette) {
    // half-round fan window above the lintel
    const cu = (u0 + u1) / 2;
    const r = (u1 - u0) / 2;
    const vb = v1 + fr;
    const SEGS = 4;
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI;
      const a1 = ((i + 1) / SEGS) * Math.PI;
      const p0 = f.p(cu + Math.cos(a0) * r, vb + Math.sin(a0) * r * 0.7, REVEAL_D - 0.01);
      const p1 = f.p(cu + Math.cos(a1) * r, vb + Math.sin(a1) * r * 0.7, REVEAL_D - 0.01);
      glass.tri(f.p(cu, vb, REVEAL_D - 0.01), p1, p0, glassColor);
      // thin trim along the arc
      const q0 = f.p(cu + Math.cos(a0) * (r + 0.04), vb + Math.sin(a0) * (r + 0.04) * 0.7, -FRAME_T);
      const q1 = f.p(cu + Math.cos(a1) * (r + 0.04), vb + Math.sin(a1) * (r + 0.04) * 0.7, -FRAME_T);
      const q0i = f.p(cu + Math.cos(a0) * r, vb + Math.sin(a0) * r * 0.7, -FRAME_T);
      const q1i = f.p(cu + Math.cos(a1) * r, vb + Math.sin(a1) * r * 0.7, -FRAME_T);
      sink.quad(q0i, q0, q1, q1i, trimColor);
    }
  }
}

function emitDoorDressing(sink: GeoSink, glass: GeoSink, f: WallFrame, o: Opening): void {
  const { u0, u1, v1: h } = o;
  const fr = 0.055;

  f.box(sink, u0 - fr, h, u1 + fr, h + fr, FRAME_T, trimColor);
  f.box(sink, u0 - fr, 0, u0, h, FRAME_T, trimColor);
  f.box(sink, u1, 0, u1 + fr, h, FRAME_T, trimColor);
  f.reveal(sink, u0, 0, u1, h, REVEAL_D, darkColor);
  f.rect(sink, u0, 0, u1, h, REVEAL_D - 0.015, darkColor);
  f.rect(glass, u0 + 0.07, h - 0.15, u1 - 0.07, h - 0.04, REVEAL_D - 0.014, glassColor);
  f.box(sink, u0 - 0.05, -0.01, u1 + 0.05, 0.04, 0.1, trimColor);
}

/** does this ground-level wall face an open, walkable land cell? */
function facesWalkable(town: Town, grid: Grid, cell: number, k: number): boolean {
  const n = grid.cells[cell]!.neighbors[k]!;
  if (n < 0) return false;
  return !town.isFilled(n, 0) && town.isLand(n);
}

export function emitWallSegment(
  sink: GeoSink,
  glass: GeoSink,
  town: Town,
  seg: OSeg,
  level: number,
  forceBlank = false
): void {
  const grid = town.grid;
  const f = new WallFrame(seg.ax, seg.ay, seg.bx, seg.by, levelY(level), levelY(level + 1));
  if (f.width < 1e-4) return;
  const w0 = f.width;

  // smooth-shaded wall rect: normals interpolate between the segment's
  // loop-smoothed endpoint normals, so filleted corners read round
  const nAt = (u: number): { x: number; y: number; z: number } => {
    const t = Math.max(0, Math.min(1, u / w0));
    let nx = seg.nax + (seg.nbx - seg.nax) * t;
    let nz = seg.nay + (seg.nby - seg.nay) * t;
    const len = Math.hypot(nx, nz) || 1;
    return { x: nx / len, y: 0, z: nz / len };
  };
  const smoothRect = (u0: number, v0: number, u1: number, v1: number, d: number, color: THREE.Color): void => {
    const na = nAt(u0);
    const nb = nAt(u1);
    sink.quadN(f.p(u0, v0, d), f.p(u0, v1, d), f.p(u1, v1, d), f.p(u1, v0, d), na, na, nb, nb, color);
  };

  const entry = PALETTE[town.colorAt(seg.cell, level)]!;
  wallColor.setHex(entry.hex);
  trimColor.setHex(entry.trim);
  darkColor.setHex(entry.hex).offsetHSL(0, -0.05, -0.18);
  const w = f.width;
  const H = f.height;

  // ground-floor plinth band for stone-based entries
  const plinth = entry.plinth && level === 0;
  const vBase = plinth ? PLINTH_H : 0;
  if (plinth) {
    plinthColor.setHex(entry.hex).offsetHSL(0.01, -0.12, -0.09);
    smoothRect(0, 0, w, PLINTH_H, -0.02, plinthColor);
    // small ledge where plinth meets wall
    f.box(sink, 0, PLINTH_H, w, PLINTH_H + 0.025, 0.02, plinthColor);
  }

  const openings: Opening[] = [];
  if (!forceBlank && seg.central) {
    const r = rng(grid.seed, 'wall', seg.cell, level, seg.k);
    const spec = WINDOWS[entry.window];
    const isGround = level === 0;
    const margin = spec.shutters ? 0.24 : 0.12;

    if (!r.chance(0.13)) {
      if (isGround && facesWalkable(town, grid, seg.cell, seg.k) && w > 0.68 && r.chance(0.45)) {
        const dw = 0.46;
        openings.push({ kind: 'door', u0: w / 2 - dw / 2, u1: w / 2 + dw / 2, v0: 0, v1: 0.74, spec });
      } else {
        // shrink the window to the segment; drop to a porthole on tight faces
        let s = spec;
        let eff = Math.min(s.w, w - 2 * margin);
        if (eff < s.w * 0.6) {
          s = COMPACT;
          eff = Math.min(s.w, w - 0.18);
        }
        if (eff >= 0.15) {
          const half = eff / 2;
          const v0 = Math.max(s.sill, vBase + 0.06);
          openings.push({ kind: 'window', u0: w / 2 - half, u1: w / 2 + half, v0, v1: v0 + s.h, spec: s });
        }
      }
    }
  }

  // wall plane with real holes cut around openings
  openings.sort((a, b) => a.u0 - b.u0);
  let uPrev = 0;
  for (const o of openings) {
    const oBase = o.kind === 'door' ? 0 : vBase;
    if (o.u0 > uPrev) smoothRect(uPrev, vBase, o.u0, H, 0, wallColor);
    if (o.v0 > oBase) smoothRect(o.u0, vBase, o.u1, o.v0, 0, wallColor);
    if (o.v1 < H) smoothRect(o.u0, o.v1, o.u1, H, 0, wallColor);
    uPrev = o.u1;
  }
  if (uPrev < w) smoothRect(uPrev, vBase, w, H, 0, wallColor);

  // timber cross-bracing on blank-ish central faces
  if (entry.timber && seg.central && openings.length === 0 && w > 0.5 && !forceBlank) {
    const t = 0.035;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      sink.quad(
        f.p(0.08 + (w - 0.16) * t0, vBase + 0.05 + (H - vBase - 0.15) * t0 - t, -0.012),
        f.p(0.08 + (w - 0.16) * t0, vBase + 0.05 + (H - vBase - 0.15) * t0 + t, -0.012),
        f.p(0.08 + (w - 0.16) * t1, vBase + 0.05 + (H - vBase - 0.15) * t1 + t, -0.012),
        f.p(0.08 + (w - 0.16) * t1, vBase + 0.05 + (H - vBase - 0.15) * t1 - t, -0.012),
        trimColor
      );
    }
    // verticals at both ends
    f.box(sink, 0.05, vBase, 0.05 + 0.04, H, 0.012, trimColor);
    f.box(sink, w - 0.09, vBase, w - 0.05, H, 0.012, trimColor);
  }

  for (const o of openings) {
    if (o.kind === 'door') emitDoorDressing(sink, glass, f, o);
    else emitWindowDressing(sink, glass, f, o);
  }
}
