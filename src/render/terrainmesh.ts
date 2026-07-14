/**
 * Interim terrain renderer: flat land fill + coastline skirt down into the
 * water. Replaced by the solver-driven terrain-edge tiles later.
 */

import * as THREE from 'three';
import { LAND_TOP, SEA_FLOOR } from '../core/constants';
import { hashKey } from '../core/rng';
import type { Town } from '../town/town';

const GRASS = new THREE.Color(0xa8bf7e);
const COBBLE = new THREE.Color(0xc9bda6);
const SAND = new THREE.Color(0xd8c48e);

export function buildTerrainMesh(town: Town): THREE.Mesh {
  const grid = town.grid;
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();

  const push = (v: THREE.Vector3Like[], color: THREE.Color) => {
    for (const p of v) {
      pos.push(p.x, p.y, p.z);
      col.push(color.r, color.g, color.b);
    }
  };

  for (const cell of grid.cells) {
    if (!town.isLand(cell.id)) continue;
    const corners = [0, 1, 2, 3].map((k) => grid.corner(cell, k));
    // cells beside buildings pave into plazas; open land stays grass (A4)
    let nearBuilding = town.hasAnyBlock(cell.id);
    for (const n of cell.neighbors) if (n >= 0 && town.hasAnyBlock(n)) nearBuilding = true;
    // subtle deterministic shade variation per cell
    const shade = ((hashKey(grid.seed, cell.id, 'shade') % 1000) / 1000 - 0.5) * 0.07;
    c.copy(nearBuilding ? COBBLE : GRASS).offsetHSL(0, 0, shade);
    const y = LAND_TOP;
    push(
      [
        { x: corners[0]!.x, y, z: corners[0]!.y },
        { x: corners[2]!.x, y, z: corners[2]!.y },
        { x: corners[1]!.x, y, z: corners[1]!.y },
        { x: corners[0]!.x, y, z: corners[0]!.y },
        { x: corners[3]!.x, y, z: corners[3]!.y },
        { x: corners[2]!.x, y, z: corners[2]!.y },
      ],
      c
    );
    // coastline skirt where the neighbor is water / world edge
    for (let k = 0; k < 4; k++) {
      const n = cell.neighbors[k]!;
      if (n >= 0 && town.isLand(n)) continue;
      const a = corners[k]!;
      const b = corners[(k + 1) % 4]!;
      c.copy(SAND).offsetHSL(0, 0, shade * 0.6);
      push(
        [
          { x: a.x, y: LAND_TOP, z: a.y },
          { x: b.x, y: LAND_TOP, z: b.y },
          { x: b.x, y: SEA_FLOOR, z: b.y },
          { x: a.x, y: LAND_TOP, z: a.y },
          { x: b.x, y: SEA_FLOOR, z: b.y },
          { x: a.x, y: SEA_FLOOR, z: a.y },
        ],
        c
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  );
  mesh.receiveShadow = true;
  return mesh;
}
