/**
 * Wall + opening generation (product A1/A2, CD1).
 * Every exposed voxel side becomes a wall rectangle; windows and doors are
 * laid out in wall-local space and conditioned on the block's color FAMILY —
 * different families get visibly different window shapes, sills, shutters,
 * and mullions. All variation is seeded on (gridSeed, cell, level, edge).
 *
 * Openings are genuinely cut out of the wall plane (strips around the hole)
 * so recessed glass reads as depth, Townscaper-style, with zero z-fighting.
 */

import * as THREE from 'three';
import { levelY } from '../core/constants';
import { rng } from '../core/rng';
import type { Grid } from '../grid/grid';
import { PALETTE, type ColorFamily } from '../town/palette';
import type { Town } from '../town/town';
import { GeoSink, WallFrame } from './geom';

const REVEAL_D = 0.07;
const FRAME_T = 0.014; // how proud frames sit off the wall plane

interface WindowStyle {
  w: number;
  h: number;
  sill: number;
  shutters?: boolean;
  mullion?: boolean;
  slit?: boolean;
}

const STYLES: Record<ColorFamily, WindowStyle> = {
  warm:  { w: 0.4,  h: 0.5,  sill: 0.3, mullion: true },
  light: { w: 0.34, h: 0.58, sill: 0.27, shutters: true },
  green: { w: 0.44, h: 0.46, sill: 0.31, mullion: true },
  cool:  { w: 0.5,  h: 0.4,  sill: 0.36 },
  dark:  { w: 0.26, h: 0.5,  sill: 0.3, slit: true },
};

const wallColor = new THREE.Color();
const trimColor = new THREE.Color();
const darkColor = new THREE.Color();
const glassColor = new THREE.Color(0xfff1cf);

interface Opening {
  kind: 'window' | 'door';
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  style: WindowStyle;
}

function emitWindowDressing(sink: GeoSink, glass: GeoSink, f: WallFrame, o: Opening): void {
  const { u0, u1, v0, v1, style } = o;
  const fr = 0.05;

  // proud frame boxes around the opening
  f.box(sink, u0 - fr, v0 - fr, u1 + fr, v0, FRAME_T, trimColor);
  f.box(sink, u0 - fr, v1, u1 + fr, v1 + fr, FRAME_T, trimColor);
  f.box(sink, u0 - fr, v0, u0, v1, FRAME_T, trimColor);
  f.box(sink, u1, v0, u1 + fr, v1, FRAME_T, trimColor);
  // recessed reveals + glass
  f.reveal(sink, u0, v0, u1, v1, REVEAL_D, darkColor);
  f.rect(glass, u0, v0, u1, v1, REVEAL_D, glassColor);
  // sill ledge under the frame
  f.box(sink, u0 - fr - 0.02, v0 - fr - 0.05, u1 + fr + 0.02, v0 - fr, 0.055, trimColor);

  if (style.mullion) {
    const cu = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    f.rect(sink, cu - 0.016, v0, cu + 0.016, v1, REVEAL_D - 0.012, trimColor);
    f.rect(sink, u0, vm - 0.016, u1, vm + 0.016, REVEAL_D - 0.012, trimColor);
  }
  if (style.shutters) {
    f.box(sink, u0 - fr - 0.15, v0, u0 - fr - 0.03, v1, 0.03, trimColor);
    f.box(sink, u1 + fr + 0.03, v0, u1 + fr + 0.15, v1, 0.03, trimColor);
  }
}

function emitDoorDressing(sink: GeoSink, glass: GeoSink, f: WallFrame, o: Opening): void {
  const { u0, u1, v1: h } = o;
  const fr = 0.055;

  f.box(sink, u0 - fr, h, u1 + fr, h + fr, FRAME_T, trimColor); // lintel
  f.box(sink, u0 - fr, 0, u0, h, FRAME_T, trimColor);
  f.box(sink, u1, 0, u1 + fr, h, FRAME_T, trimColor);
  f.reveal(sink, u0, 0, u1, h, REVEAL_D, darkColor);
  // door slab closes the hole just in front of full depth
  f.rect(sink, u0, 0, u1, h, REVEAL_D - 0.015, darkColor);
  // transom glass above the slab
  f.rect(glass, u0 + 0.07, h - 0.15, u1 - 0.07, h - 0.04, REVEAL_D - 0.014, glassColor);
  // threshold step
  f.box(sink, u0 - 0.05, -0.01, u1 + 0.05, 0.04, 0.1, trimColor);
}

export interface WallJob {
  cell: number;
  level: number;
  k: number;
}

/** does this ground-level wall face an open, walkable land cell? */
function facesWalkable(town: Town, grid: Grid, cell: number, k: number): boolean {
  const n = grid.cells[cell]!.neighbors[k]!;
  if (n < 0) return false;
  return !town.isFilled(n, 0) && town.isLand(n);
}

export function emitWall(sink: GeoSink, glass: GeoSink, town: Town, job: WallJob): void {
  const grid = town.grid;
  const c = grid.cells[job.cell]!;
  const a = grid.corner(c, job.k);
  const b = grid.corner(c, job.k + 1);
  const f = new WallFrame(a.x, a.y, b.x, b.y, levelY(job.level), levelY(job.level + 1));

  const entry = PALETTE[town.colorAt(job.cell, job.level)]!;
  wallColor.setHex(entry.hex);
  trimColor.setHex(entry.trim);
  darkColor.setHex(entry.hex).offsetHSL(0, -0.05, -0.18);

  const r = rng(grid.seed, 'wall', job.cell, job.level, job.k);
  const style = STYLES[entry.family];
  const w = f.width;
  const H = f.height;

  // margin needed so frames/shutters stay inside the wall rectangle
  const sideMargin = style.shutters ? 0.26 : 0.13;

  const openings: Opening[] = [];
  const addWindow = (cu: number, st: WindowStyle) => {
    const half = st.w / 2;
    if (cu - half < sideMargin || cu + half > w - sideMargin) return;
    openings.push({ kind: 'window', u0: cu - half, u1: cu + half, v0: st.sill, v1: st.sill + st.h, style: st });
  };

  if (w >= 0.6 && !r.chance(0.13)) {
    const isGround = job.level === 0;
    if (isGround && facesWalkable(town, grid, job.cell, job.k) && r.chance(0.45)) {
      const dw = 0.46;
      openings.push({ kind: 'door', u0: w / 2 - dw / 2, u1: w / 2 + dw / 2, v0: 0, v1: 0.74, style });
    } else {
      let st = style;
      if (st.slit && w > 1.0 && r.chance(0.5)) st = { ...st, w: st.w * 1.7, slit: false };
      if (w > 1.4 && r.chance(0.55) && !st.shutters) {
        addWindow(w * 0.3, st);
        addWindow(w * 0.7, st);
      } else {
        addWindow(w / 2, st);
      }
    }
  }

  // wall plane with real holes: vertical strips between openings,
  // horizontal strips above/below each opening
  openings.sort((x, y) => x.u0 - y.u0);
  let uPrev = 0;
  for (const o of openings) {
    if (o.u0 > uPrev) f.rect(sink, uPrev, 0, o.u0, H, 0, wallColor);
    if (o.v0 > 0) f.rect(sink, o.u0, 0, o.u1, o.v0, 0, wallColor);
    if (o.v1 < H) f.rect(sink, o.u0, o.v1, o.u1, H, 0, wallColor);
    uPrev = o.u1;
  }
  if (uPrev < w) f.rect(sink, uPrev, 0, w, H, 0, wallColor);

  for (const o of openings) {
    if (o.kind === 'door') emitDoorDressing(sink, glass, f, o);
    else emitWindowDressing(sink, glass, f, o);
  }
}
