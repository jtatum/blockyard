/**
 * Placement pop — a translucent ghost of each newly placed block springs in
 * and fades, echoing Townscaper's "the town reacts" feel without animating
 * the merged chunk geometry itself. Bulk line/area placements stagger their
 * pops into a little wave.
 */

import * as THREE from 'three';
import { levelY } from '../core/constants';
import type { Grid } from '../grid/grid';

const LIFE = 0.34;

interface Pop {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  startAt: number;
}

export class PopFX {
  readonly group = new THREE.Group();
  private items: Pop[] = [];
  private now = 0;

  spawn(grid: Grid, cell: number, level: number, delay = 0): void {
    const c = grid.cells[cell]!;
    const y0 = levelY(level);
    const cy = y0 + 0.5;
    const pos: number[] = [];
    const corners = [0, 1, 2, 3].map((k) => grid.corner(c, k));
    // sides + top, positions local to the block center so scaling pops in place
    for (let k = 0; k < 4; k++) {
      const a = corners[k]!;
      const b = corners[(k + 1) % 4]!;
      pos.push(
        a.x - c.cx, y0 - cy, a.y - c.cy, a.x - c.cx, y0 + 1 - cy, a.y - c.cy,
        b.x - c.cx, y0 + 1 - cy, b.y - c.cy, a.x - c.cx, y0 - cy, a.y - c.cy,
        b.x - c.cx, y0 + 1 - cy, b.y - c.cy, b.x - c.cx, y0 - cy, b.y - c.cy
      );
    }
    pos.push(
      corners[0]!.x - c.cx, y0 + 1 - cy, corners[0]!.y - c.cy,
      corners[2]!.x - c.cx, y0 + 1 - cy, corners[2]!.y - c.cy,
      corners[1]!.x - c.cx, y0 + 1 - cy, corners[1]!.y - c.cy,
      corners[0]!.x - c.cx, y0 + 1 - cy, corners[0]!.y - c.cy,
      corners[3]!.x - c.cx, y0 + 1 - cy, corners[3]!.y - c.cy,
      corners[2]!.x - c.cx, y0 + 1 - cy, corners[2]!.y - c.cy
    );
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(c.cx, cy, c.cy);
    mesh.visible = false;
    this.group.add(mesh);
    this.items.push({ mesh, material, startAt: this.now + delay });
  }

  update(time: number): void {
    this.now = time;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]!;
      const t = (time - p.startAt) / LIFE;
      if (t < 0) {
        p.mesh.visible = false;
        continue;
      }
      if (t >= 1) {
        this.group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      p.mesh.visible = true;
      // spring up with a slight overshoot, fade through the back half
      const s = 0.55 + 0.57 * Math.sin(Math.min(t * 1.25, 1) * Math.PI * 0.5) + 0.06 * Math.sin(t * Math.PI);
      p.mesh.scale.setScalar(s);
      p.material.opacity = 0.4 * (1 - t * t);
    }
  }
}
