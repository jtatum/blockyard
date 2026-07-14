/**
 * Grid overlay (product U-GRID): renders every cell boundary as soft lines.
 * Used as the "show the whole grid" toggle; also the first debug view of
 * System A during development.
 */

import * as THREE from 'three';
import type { Grid } from '../grid/grid';

export function buildGridOverlay(grid: Grid, y = 0.36): THREE.LineSegments {
  const positions: number[] = [];
  const seen = new Set<string>();
  for (const cell of grid.cells) {
    for (let k = 0; k < 4; k++) {
      const a = grid.corner(cell, k);
      const b = grid.corner(cell, k + 1);
      const key = Math.min(a.id, b.id) + ',' + Math.max(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      positions.push(a.x, y, a.y, b.x, y, b.y);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 5;
  return lines;
}
