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
import type { Town } from '../town/town';
import type { CameraRig } from '../render/camera';
import type { HoverHighlight } from '../render/highlight';
import type { Chrome } from '../ui/chrome';

export class InputController {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private painting = false;
  private lastPlaced: { cell: number; level: number } | null = null;
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
      this.history.beginStroke();
      if (p?.place) this.placeAt(p.place);
    } else if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pickAt(e);
    this.lastPick = p;
    if (this.painting && p?.place) {
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
    if (e.key >= '1' && e.key <= '9') this.chrome.setColor(Number(e.key) - 1);
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
