/**
 * Pointer/keyboard → build commands (tech doc §4 /app/input).
 *
 * Mouse: left click/drag paints (or erases/terraforms per tool); a quick
 * right-click removes; right-drag orbits; Alt+click eyedrops in build mode;
 * Alt+drag with line/area tools bulk-removes.
 *
 * Touch: TAP acts, one-finger DRAG orbits (never edits — calm over power),
 * except the deliberate line/area tools, which capture the drag as a gesture
 * and pause the camera while it runs. Pinch zooms, two-finger drag pans.
 */

import * as THREE from 'three';
import type { Grid } from '../grid/grid';
import { pick, type Pick } from '../grid/picking';
import type { History } from '../town/history';
import { PALETTE } from '../town/palette';
import { LAND, WATER, type Edit, type Town } from '../town/town';
import type { CameraRig } from '../render/camera';
import type { HoverHighlight } from '../render/highlight';
import type { Chrome } from '../ui/chrome';

const TAP_SLOP_PX = 9;
const TAP_MS = 450;

export class InputController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private painting = false;
  private lastPlaced: { cell: number; level: number } | null = null;
  /** last pointer ground point during a paint stroke, for gap-free drags */
  private lastPaintPt: { x: number; z: number } | null = null;
  private rightDown: { x: number; y: number; t: number } | null = null;
  /** pending touch tap (deferred until pointerup so drags stay pure orbit) */
  private touchTap: { x: number; y: number; t: number } | null = null;
  private lastPick: Pick | null = null;
  /** active bulk line/area gesture (BB1/BB2/BB4) */
  private bulk: {
    startCell: number;
    startNdc: THREE.Vector2;
    level: number;
    removing: boolean;
    targets: number[];
  } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private grid: Grid,
    private town: Town,
    private history: History,
    private rig: CameraRig,
    private chrome: Chrome,
    private highlight: HoverHighlight
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('pointerleave', () => this.highlight.hide());
  }

  private pickAt(e: { clientX: number; clientY: number }): Pick | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    return pick(this.grid, this.town, this.raycaster.ray);
  }

  // -- gestures --------------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY, t: performance.now() };
      return;
    }
    if (e.button !== 0) return;
    const tool = this.chrome.tool;
    const isTouch = e.pointerType !== 'mouse';
    const p = this.pickAt(e);

    // build-mode Alt+click = eyedropper (mouse); other tools keep Alt free
    if (!isTouch && e.altKey && tool === 'build') {
      if (p?.remove) this.chrome.setColor(this.town.colorAt(p.remove.cell, p.remove.level));
      return;
    }

    if (tool === 'line' || tool === 'area') {
      if (!p) return;
      const removing = e.altKey;
      const level = removing ? (p.remove?.level ?? 0) : (p.place?.level ?? 0);
      const startCell = removing ? (p.remove?.cell ?? p.cell) : (p.place?.cell ?? p.cell);
      this.bulk = { startCell, startNdc: this.ndc.clone(), level, removing, targets: [startCell] };
      this.highlight.showCells(this.grid, [startCell], level, removing);
      if (isTouch) this.rig.controls.enabled = false; // gesture owns the finger
      return;
    }

    if (isTouch) {
      // defer: a tap acts on pointerup; a drag is pure camera orbit
      this.touchTap = { x: e.clientX, y: e.clientY, t: performance.now() };
      return;
    }

    this.painting = true;
    this.lastPlaced = null;
    this.lastPaintPt = p ? { x: p.point.x, z: p.point.z } : null;
    this.history.beginStroke();
    if (p) this.actAt(tool, p, true);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pickAt(e);
    this.lastPick = p;

    if (this.bulk) {
      this.updateBulkTargets(p);
      this.highlight.showCells(this.grid, this.bulk.targets, this.bulk.level, this.bulk.removing);
      return;
    }

    const tool = this.chrome.tool;
    if (this.painting && p) {
      this.actAt(tool, p, false);
    }

    // hover ghost
    if (!p) {
      this.highlight.hide();
    } else if (tool === 'build' || tool === 'line' || tool === 'area') {
      if (p.place) this.highlight.show(this.grid, p.place.cell, p.place.level);
      else this.highlight.hide();
    } else if (tool === 'erase') {
      if (p.remove) this.highlight.showCells(this.grid, [p.remove.cell], p.remove.level, true);
      else this.highlight.hide();
    } else {
      this.highlight.show(this.grid, p.cell, 0);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0 && this.bulk) {
      const { targets, level, removing } = this.bulk;
      this.bulk = null;
      this.rig.controls.enabled = true;
      this.highlight.hide();
      const edits: Edit[] = [];
      for (const cell of targets) {
        if (removing) {
          if (this.town.isFilled(cell, level)) edits.push({ kind: 'voxel', cell, level, after: null });
        } else if (!this.town.isFilled(cell, level)) {
          edits.push({ kind: 'voxel', cell, level, after: this.chrome.color });
        }
      }
      this.history.commit(edits); // one undo step (BB1/BB2 acceptance)
      return;
    }
    if (e.button === 0 && this.touchTap) {
      const tap = this.touchTap;
      this.touchTap = null;
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      if (moved < TAP_SLOP_PX && performance.now() - tap.t < TAP_MS) {
        const p = this.pickAt(e);
        if (p) {
          this.history.beginStroke();
          this.actAt(this.chrome.tool, p, true);
          this.history.endStroke();
        }
      }
      return;
    }
    if (e.button === 0 && this.painting) {
      this.painting = false;
      this.history.endStroke();
    } else if (e.button === 2 && this.rightDown) {
      const moved = Math.hypot(e.clientX - this.rightDown.x, e.clientY - this.rightDown.y);
      const dt = performance.now() - this.rightDown.t;
      this.rightDown = null;
      if (moved < 6 && dt < 350) {
        const p = this.pickAt(e);
        if (p?.remove) this.history.commit([
          { kind: 'voxel', cell: p.remove.cell, level: p.remove.level, after: null },
        ]);
      }
    }
  };

  // -- actions ---------------------------------------------------------------

  /** apply the current tool at a pick; batches everything into one commit */
  private actAt(tool: string, p: Pick, isFirst: boolean): void {
    const edits: Edit[] = [];
    if (tool === 'build') {
      if (p.face === 'ground' && !isFirst) {
        for (const cell of this.strokeCells(p)) {
          if (!this.town.isFilled(cell, 0)) {
            edits.push({ kind: 'voxel', cell, level: 0, after: this.chrome.color });
            this.lastPlaced = { cell, level: 0 };
          }
        }
      }
      if (p.place) {
        const lp = this.lastPlaced;
        if (!lp || lp.cell !== p.place.cell || lp.level !== p.place.level) {
          edits.push({ kind: 'voxel', cell: p.place.cell, level: p.place.level, after: this.chrome.color });
          this.lastPlaced = { cell: p.place.cell, level: p.place.level };
        }
      }
    } else if (tool === 'erase') {
      if (p.remove) {
        const lp = this.lastPlaced;
        if (!lp || lp.cell !== p.remove.cell || lp.level !== p.remove.level) {
          edits.push({ kind: 'voxel', cell: p.remove.cell, level: p.remove.level, after: null });
          this.lastPlaced = { cell: p.remove.cell, level: p.remove.level };
        }
      }
    } else if (tool === 'land' || tool === 'water') {
      const want = tool === 'land' ? LAND : WATER;
      const cells = isFirst ? [p.cell] : this.strokeCells(p);
      for (const cell of cells) {
        if (this.town.base(cell) !== want) edits.push({ kind: 'terrain', cell, after: want });
      }
    }
    if (edits.length > 0) this.history.commit(edits);
  }

  /** recompute bulk gesture targets from the current pointer */
  private updateBulkTargets(p: Pick | null): void {
    const bulk = this.bulk!;
    if (this.chrome.tool === 'line') {
      let endCell = bulk.startCell;
      if (p) {
        const ground = this.grid.cellAt(p.point.x, p.point.z);
        endCell = ground >= 0 ? ground : p.cell;
      }
      bulk.targets = this.linePath(bulk.startCell, endCell);
    } else {
      // area: cells whose centroid projects into the dragged screen rect
      const x0 = Math.min(bulk.startNdc.x, this.ndc.x);
      const x1 = Math.max(bulk.startNdc.x, this.ndc.x);
      const y0 = Math.min(bulk.startNdc.y, this.ndc.y);
      const y1 = Math.max(bulk.startNdc.y, this.ndc.y);
      const v = new THREE.Vector3();
      const targets: number[] = [];
      for (const c of this.grid.cells) {
        v.set(c.cx, 0.3, c.cy).project(this.rig.camera);
        if (v.x >= x0 && v.x <= x1 && v.y >= y0 && v.y <= y1 && v.z < 1) targets.push(c.id);
      }
      bulk.targets = targets.length > 0 ? targets : [bulk.startCell];
    }
  }

  /** straightest path between two cells over edge adjacency (BB1) */
  private linePath(from: number, to: number): number[] {
    const grid = this.grid;
    const B = grid.cells[to]!;
    const A = grid.cells[from]!;
    const dx = B.cx - A.cx;
    const dy = B.cy - A.cy;
    const len2 = dx * dx + dy * dy || 1;
    const path = [from];
    let cur = from;
    while (cur !== to && path.length < 96) {
      const c = grid.cells[cur]!;
      const curDist = Math.hypot(c.cx - B.cx, c.cy - B.cy);
      let best = -1;
      let bestScore = Infinity;
      for (const n of c.neighbors) {
        if (n < 0) continue;
        const nc = grid.cells[n]!;
        const distT = Math.hypot(nc.cx - B.cx, nc.cy - B.cy);
        if (distT >= curDist) continue; // must make progress
        const t = Math.max(0, Math.min(1, ((nc.cx - A.cx) * dx + (nc.cy - A.cy) * dy) / len2));
        const dev = Math.hypot(nc.cx - (A.cx + dx * t), nc.cy - (A.cy + dy * t));
        const score = distT + dev * 1.6;
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best < 0) break;
      path.push(best);
      cur = best;
    }
    return path;
  }

  /** cells crossed since the last paint sample (segment-walk, gap-free drags) */
  private strokeCells(p: Pick): number[] {
    const out: number[] = [];
    const to = { x: p.point.x, z: p.point.z };
    const from = this.lastPaintPt ?? to;
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(dist / (this.grid.cellSize * 0.35)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cell = this.grid.cellAt(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
      if (cell >= 0 && out[out.length - 1] !== cell) out.push(cell);
    }
    this.lastPaintPt = to;
    return out;
  }

  // -- keyboard ---------------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.history.redo();
      else this.history.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.history.redo();
      return;
    }
    if (mod || e.altKey) return; // browser chords (Cmd+1, Ctrl+W…) are not ours
    const k = e.key.toLowerCase();
    if (k === 'b') this.chrome.setTool('build');
    else if (k === 'e') this.chrome.setTool('erase');
    else if (k === 'n') this.chrome.setTool('line');
    else if (k === 'm') this.chrome.setTool('area');
    else if (k === 'l') this.chrome.setTool('land');
    else if (k === 'w') this.chrome.setTool('water');
    else if (e.key >= '1' && e.key <= '9') this.chrome.setColor(Number(e.key) - 1);
    else if (e.key === '0') this.chrome.setColor(9);
    else if (e.key === ',') this.chrome.setColor((this.chrome.color + PALETTE.length - 1) % PALETTE.length);
    else if (e.key === '.') this.chrome.setColor((this.chrome.color + 1) % PALETTE.length);
  };

  /** re-evaluate hover after camera motion or town edits */
  refreshHover(): void {
    if (this.lastPick?.place)
      this.highlight.show(this.grid, this.lastPick.place.cell, this.lastPick.place.level);
  }
}
