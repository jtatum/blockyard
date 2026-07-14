/**
 * Town — the entire editable state (tech doc §2.4): per-cell terrain base,
 * filled voxels as level bitmasks, per-voxel color, and lighting.
 * Everything rendered is a pure function of this + the grid.
 *
 * Mutations flow through `apply(edits)` which records precise before/after
 * per voxel/cell so history can invert exactly, and notifies listeners with
 * the set of touched cells (the mesher's dirty region).
 */

import { MAX_LEVELS } from '../core/constants';
import type { Grid } from '../grid/grid';

export const LAND = 1;
export const WATER = 0;
export type Base = typeof LAND | typeof WATER;

export interface VoxelEdit {
  kind: 'voxel';
  cell: number;
  level: number;
  /** null = empty; number = color index */
  after: number | null;
  /** filled in by apply() for undo */
  before?: number | null;
}

export interface TerrainEdit {
  kind: 'terrain';
  cell: number;
  after: Base;
  before?: Base;
}

export type Edit = VoxelEdit | TerrainEdit;

export type TownListener = (dirtyCells: Set<number>) => void;

export class Town {
  readonly grid: Grid;
  /** level occupancy bitmask per cell (bit L = level L filled) */
  readonly filled: Uint32Array;
  /** color index per (cell, level) — meaningful only where filled */
  readonly colors: Uint8Array;
  /** LAND / WATER per cell */
  readonly terrain: Uint8Array;
  /** time-of-day 0..1 (0 = dawn, 0.5 = noonish arc peak — see daylight.ts) */
  timeOfDay = 0.35;

  private listeners: TownListener[] = [];

  constructor(grid: Grid) {
    this.grid = grid;
    this.filled = new Uint32Array(grid.cells.length);
    this.colors = new Uint8Array(grid.cells.length * MAX_LEVELS);
    this.terrain = new Uint8Array(grid.cells.length); // all water
  }

  /** default starting island: land within a radius, water beyond */
  seedIsland(radius: number): void {
    for (const c of this.grid.cells) {
      if (Math.hypot(c.cx, c.cy) <= radius) this.terrain[c.id] = LAND;
    }
  }

  isFilled(cell: number, level: number): boolean {
    if (level < 0 || level >= MAX_LEVELS) return false;
    return (this.filled[cell]! & (1 << level)) !== 0;
  }

  colorAt(cell: number, level: number): number {
    return this.colors[cell * MAX_LEVELS + level]!;
  }

  base(cell: number): Base {
    return this.terrain[cell]! as Base;
  }

  isLand(cell: number): boolean {
    return this.terrain[cell] === LAND;
  }

  /** highest filled level + 1, or 0 if empty */
  columnHeight(cell: number): number {
    return 32 - Math.clz32(this.filled[cell]!);
  }

  hasAnyBlock(cell: number): boolean {
    return this.filled[cell] !== 0;
  }

  /** total filled voxel count (for stats / degradation guards) */
  blockCount(): number {
    let n = 0;
    for (let i = 0; i < this.filled.length; i++) {
      let m = this.filled[i]!;
      while (m) { m &= m - 1; n++; }
    }
    return n;
  }

  onChange(fn: TownListener): void {
    this.listeners.push(fn);
  }

  /**
   * Apply edits, fill in `before` fields, notify listeners.
   * Returns the edits that actually changed something (for history).
   */
  apply(edits: Edit[]): Edit[] {
    const dirty = new Set<number>();
    const real: Edit[] = [];
    for (const e of edits) {
      if (e.kind === 'voxel') {
        if (e.level < 0 || e.level >= MAX_LEVELS) continue;
        const wasFilled = this.isFilled(e.cell, e.level);
        const before = wasFilled ? this.colorAt(e.cell, e.level) : null;
        if (before === e.after) continue;
        e.before = before;
        if (e.after === null) {
          this.filled[e.cell]! &= ~(1 << e.level);
        } else {
          this.filled[e.cell]! |= 1 << e.level;
          this.colors[e.cell * MAX_LEVELS + e.level] = e.after;
        }
        real.push(e);
        dirty.add(e.cell);
      } else {
        const before = this.base(e.cell);
        if (before === e.after) continue;
        e.before = before;
        this.terrain[e.cell] = e.after;
        real.push(e);
        dirty.add(e.cell);
      }
    }
    if (real.length > 0) this.notify(dirty);
    return real;
  }

  /** invert a set of applied edits (history undo) */
  revert(edits: Edit[]): void {
    const dirty = new Set<number>();
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i]!;
      if (e.kind === 'voxel') {
        if (e.before === null || e.before === undefined) {
          this.filled[e.cell]! &= ~(1 << e.level);
        } else {
          this.filled[e.cell]! |= 1 << e.level;
          this.colors[e.cell * MAX_LEVELS + e.level] = e.before;
        }
      } else {
        this.terrain[e.cell] = e.before!;
      }
      dirty.add(e.cell);
    }
    if (dirty.size > 0) this.notify(dirty);
  }

  /** re-apply a set of edits (history redo) */
  reapply(edits: Edit[]): void {
    const dirty = new Set<number>();
    for (const e of edits) {
      if (e.kind === 'voxel') {
        if (e.after === null) {
          this.filled[e.cell]! &= ~(1 << e.level);
        } else {
          this.filled[e.cell]! |= 1 << e.level;
          this.colors[e.cell * MAX_LEVELS + e.level] = e.after;
        }
      } else {
        this.terrain[e.cell] = e.after;
      }
      dirty.add(e.cell);
    }
    if (dirty.size > 0) this.notify(dirty);
  }

  /** wipe all blocks and reset terrain to the default island */
  clear(islandRadius: number): void {
    this.filled.fill(0);
    this.colors.fill(0);
    this.terrain.fill(WATER);
    this.seedIsland(islandRadius);
    this.notify(new Set(this.grid.cells.map((c) => c.id)));
  }

  notify(dirty: Set<number>): void {
    for (const fn of this.listeners) fn(dirty);
  }
}
