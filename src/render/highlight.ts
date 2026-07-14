/**
 * Hover highlight (product U-GRID / B7 feel): a soft ghost of the block that
 * would be placed, plus a cell outline. Updated every pointer move.
 */

import * as THREE from 'three';
import { levelY } from '../core/constants';
import type { Grid } from '../grid/grid';

export class HoverHighlight {
  readonly group = new THREE.Group();
  private ghost: THREE.Mesh;
  private outline: THREE.LineLoop;

  constructor() {
    this.ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.outline = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
    );
    this.group.add(this.ghost, this.outline);
    this.group.visible = false;
    this.group.renderOrder = 10;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** show ghost block at (cell, level) */
  show(grid: Grid, cell: number, level: number): void {
    const c = grid.cells[cell]!;
    const corners = [0, 1, 2, 3].map((k) => grid.corner(c, k));
    const y0 = levelY(level) + 0.02;
    const y1 = levelY(level + 1) - 0.02;
    const pos: number[] = [];
    // top
    pos.push(
      corners[0]!.x, y1, corners[0]!.y, corners[2]!.x, y1, corners[2]!.y, corners[1]!.x, y1, corners[1]!.y,
      corners[0]!.x, y1, corners[0]!.y, corners[3]!.x, y1, corners[3]!.y, corners[2]!.x, y1, corners[2]!.y
    );
    // sides
    for (let k = 0; k < 4; k++) {
      const a = corners[k]!;
      const b = corners[(k + 1) % 4]!;
      pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
    }
    this.ghost.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.ghost.geometry = g;

    const oPos: number[] = [];
    for (const p of corners) oPos.push(p.x, y0, p.y);
    this.outline.geometry.dispose();
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
    this.outline.geometry = og;

    this.group.visible = true;
  }
}
