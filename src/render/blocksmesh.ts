/**
 * Interim block renderer: extruded colored prisms per voxel (P2 gate look).
 * Replaced by the procedural architecture mesher; kept for debug/fallback.
 */

import * as THREE from 'three';
import { levelY, MAX_LEVELS } from '../core/constants';
import { PALETTE } from '../town/palette';
import type { Town } from '../town/town';

const tmpColor = new THREE.Color();

export function buildBlocksMesh(town: Town): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const grid = town.grid;

  const quad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    r: number, g: number, b: number
  ) => {
    pos.push(ax, ay, az, cx, cy, cz, bx, by, bz, ax, ay, az, dx, dy, dz, cx, cy, cz);
    for (let i = 0; i < 6; i++) col.push(r, g, b);
  };

  for (const cell of grid.cells) {
    const mask = town.filled[cell.id]!;
    if (mask === 0) continue;
    for (let level = 0; level < MAX_LEVELS; level++) {
      if (!(mask & (1 << level))) continue;
      tmpColor.setHex(PALETTE[town.colorAt(cell.id, level)]!.hex);
      const { r, g, b } = tmpColor;
      const y0 = levelY(level);
      const y1 = levelY(level + 1);
      const c = [grid.corner(cell, 0), grid.corner(cell, 1), grid.corner(cell, 2), grid.corner(cell, 3)];
      // sides where the neighbor at this level is empty
      for (let k = 0; k < 4; k++) {
        const n = cell.neighbors[k]!;
        if (n >= 0 && town.isFilled(n, level)) continue;
        const a = c[k]!;
        const bb = c[(k + 1) % 4]!;
        // outward-facing: grid CCW edge -> wall wound so normal faces out
        quad(a.x, y0, a.y, bb.x, y0, bb.y, bb.x, y1, bb.y, a.x, y1, a.y, r, g, b);
      }
      // top when nothing above
      if (!town.isFilled(cell.id, level + 1)) {
        quad(
          c[0]!.x, y1, c[0]!.y, c[1]!.x, y1, c[1]!.y,
          c[2]!.x, y1, c[2]!.y, c[3]!.x, y1, c[3]!.y,
          Math.min(1, r * 1.06), Math.min(1, g * 1.06), Math.min(1, b * 1.06)
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
