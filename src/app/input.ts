/**
 * Pointer/keyboard → build commands (tech doc §4 /app/input).
 * Left click/drag paints blocks; a quick right-click removes (right-drag
 * orbits); Alt+click eyedrops; number keys / , . pick colors; Ctrl+Z undo.
 */

import * as THREE from 'three';
import type { Grid } from '../grid/grid';
import { pick, type Pick } from '../grid/picking';
import type { History } from '../town/history';
import { PALETTE } from '../town/palette';
import { LAND, WATER, type Town } from '../town/town';
import type { CameraRig } from '../render/camera';
import type { HoverHighlight } from '../render/highlight';
import type { Chrome } from '../ui/chrome';

export class InputController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private painting = false;
  private lastPlaced: { cell: number; level: number } | null = null;
  /** last pointer ground point during a paint stroke, for gap-free drags */
  private lastPaintPt: { x: number; z: number } | null = null;
  private rightDown: { x: number; y: number; t: number } | null = null;
  private lastPick: Pick | null = null;

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

  private pickAt(e: PointerEvent): Pick | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    return pick(this.grid, this.town, this.raycaster.ray);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) {
      const p = this.pickAt(e);
      if (e.altKey) {
        // eyedropper
        if (p?.remove) this.chrome.setColor(this.town.colorAt(p.remove.cell, p.remove.level));
        return;
      }
      this.painting = true;
      this.lastPlaced = null;
      this.lastPaintPt = p ? { x: p.point.x, z: p.point.z } : null;
      this.history.beginStroke();
      if (this.chrome.tool !== 'build') {
        if (p) this.terraformAt(p.cell);
        return;
      }
      if (p?.place) this.placeAt(p.place);
    } else if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pickAt(e);
    this.lastPick = p;
    if (this.chrome.tool !== 'build') {
      if (this.painting && p) {
        for (const cell of this.strokeCells(p)) this.terraformAt(cell);
      }
      if (p) this.highlight.show(this.grid, p.cell, 0);
      else this.highlight.hide();
      return;
    }
    if (this.painting && p?.place) {
      // gap-free ground painting: fill every cell the pointer crossed
      if (p.face === 'ground') {
        for (const cell of this.strokeCells(p)) {
          if (!this.town.isFilled(cell, 0)) this.placeAt({ cell, level: 0 });
        }
      }
      const lp = this.lastPlaced;
      if (!lp || lp.cell !== p.place.cell || lp.level !== p.place.level) this.placeAt(p.place);
    }
    if (p?.place) this.highlight.show(this.grid, p.place.cell, p.place.level);
    else this.highlight.hide();
  };

  private onPointerUp = (e: PointerEvent): void => {
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

  private placeAt(target: { cell: number; level: number }): void {
    this.history.commit([
      { kind: 'voxel', cell: target.cell, level: target.level, after: this.chrome.color },
    ]);
    this.lastPlaced = target;
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

  /** raise/dig the base cell under the pointer (T1–T3); buildings adapt */
  private terraformAt(cell: number): void {
    const want = this.chrome.tool === 'land' ? LAND : WATER;
    if (this.town.base(cell) === want) return;
    this.history.commit([{ kind: 'terrain', cell, after: want }]);
  }

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
    if (e.key.toLowerCase() === 'b') this.chrome.setTool('build');
    else if (e.key.toLowerCase() === 'l') this.chrome.setTool('land');
    else if (e.key.toLowerCase() === 'w') this.chrome.setTool('water');
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
