/**
 * The architecture mesher — orchestrates walls, roofs, and supports into
 * chunked GPU geometry (tech doc §3.5, §6.2/6.4).
 *
 * Cells are partitioned into spatial chunks; an edit re-derives roof regions
 * (cheap, global) but only rebuilds geometry for chunks touched by the edit's
 * 1-ring plus any roof region it grew/shrank. Two materials total: one solid
 * vertex-colored, one glass/emissive (night windows ramp a single uniform).
 */

import * as THREE from 'three';
import { LAND_TOP, levelY, MAX_LEVELS, SEA_FLOOR } from '../core/constants';
import type { Grid } from '../grid/grid';
import type { Town } from '../town/town';
import { GeoSink } from './geom';
import { emitBunting, emitGardenCell, emitLantern } from './props';
import { computeRecipes, recipeSignature, type RecipeSet } from './recipes';
import { computeRoofRegions, emitRoofCell, emitRoofEdges, type RoofRegion } from './roofs';
import { emitWall } from './walls';

const CHUNK = 8; // world units per chunk bin
const POST_R = 0.06;
const postColor = new THREE.Color(0x6b5a44);
const capColor = new THREE.Color();

export const solidMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.92,
  metalness: 0,
});

/** shared window-glass material; daylight rig drives color/emissive at night */
export const glassMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  color: 0x4a5c6e,
  roughness: 0.25,
  metalness: 0,
  emissive: 0xffb765,
  emissiveIntensity: 0,
});

export class ArchMesher {
  readonly group = new THREE.Group();
  private town: Town;
  private grid: Grid;
  private chunkOfCell: Int32Array;
  private chunkCells = new Map<number, number[]>();
  private chunkMeshes = new Map<number, THREE.Mesh[]>();
  private regions: RoofRegion[] = [];
  /** current special-build matches; terrainmesh reads gardens from here */
  recipes: RecipeSet = { lanterns: new Map(), shafts: new Set(), buntings: [], gardens: new Set() };

  constructor(town: Town) {
    this.town = town;
    this.grid = town.grid;
    this.chunkOfCell = new Int32Array(this.grid.cells.length);
    for (const c of this.grid.cells) {
      const key = (Math.floor((c.cx + 200) / CHUNK) << 8) | Math.floor((c.cy + 200) / CHUNK);
      this.chunkOfCell[c.id] = key;
      let arr = this.chunkCells.get(key);
      if (!arr) this.chunkCells.set(key, (arr = []));
      arr.push(c.id);
    }
    this.rebuildAll();
  }

  rebuildAll(): void {
    this.regions = computeRoofRegions(this.town);
    this.recipes = computeRecipes(this.town);
    for (const key of this.chunkCells.keys()) this.buildChunk(key);
  }

  update(dirty: Set<number>): void {
    // walls/supports change in the edited cells and their edge neighbors
    const expanded = new Set(dirty);
    for (const d of dirty) {
      for (const n of this.grid.cells[d]!.neighbors) if (n >= 0) expanded.add(n);
    }
    const touches = (r: RoofRegion) => {
      for (const c of expanded) if (r.cells.has(c)) return true;
      return false;
    };
    const affectedCells = new Set<number>(expanded);
    for (const r of this.regions) if (touches(r)) for (const c of r.cells) affectedCells.add(c);
    this.regions = computeRoofRegions(this.town);
    for (const r of this.regions) if (touches(r)) for (const c of r.cells) affectedCells.add(c);

    // recipes are global pattern matches; rebuild chunks wherever their
    // per-cell signature changed (appearance, disappearance, OR value change —
    // e.g. a bunting endpoint recolored two cells away)
    const oldSig = recipeSignature(this.recipes);
    this.recipes = computeRecipes(this.town);
    const newSig = recipeSignature(this.recipes);
    for (const [c, s] of oldSig) if (newSig.get(c) !== s) affectedCells.add(c);
    for (const [c, s] of newSig) if (oldSig.get(c) !== s) affectedCells.add(c);

    const chunks = new Set<number>();
    for (const c of affectedCells) chunks.add(this.chunkOfCell[c]!);
    for (const key of chunks) this.buildChunk(key);
  }

  private disposeChunk(key: number): void {
    const meshes = this.chunkMeshes.get(key);
    if (meshes) {
      for (const m of meshes) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
    this.chunkMeshes.delete(key);
  }

  private buildChunk(key: number): void {
    this.disposeChunk(key);
    const cells = this.chunkCells.get(key);
    if (!cells) return;

    const solid = new GeoSink();
    const glass = new GeoSink();
    const town = this.town;
    const grid = this.grid;

    for (const cellId of cells) {
      const mask = town.filled[cellId]!;
      if (mask === 0) continue;
      const cell = grid.cells[cellId]!;

      const lantern = this.recipes.lanterns.get(cellId);

      for (let level = 0; level < MAX_LEVELS; level++) {
        if (!(mask & (1 << level))) continue;

        // lighthouse lantern replaces the whole top voxel
        if (lantern && level === lantern.level) {
          emitLantern(solid, glass, town, lantern);
          continue;
        }

        // exposed walls (lighthouse shafts stay blank so stripes read)
        const blank = this.recipes.shafts.has(cellId + ':' + level);
        for (let k = 0; k < 4; k++) {
          const n = cell.neighbors[k]!;
          if (n >= 0 && town.isFilled(n, level)) continue;
          emitWall(solid, glass, town, { cell: cellId, level, k }, blank);
        }

        // support: bottom cap + posts when nothing directly below
        if (!town.isFilled(cellId, level - 1)) {
          const y = levelY(level);
          capColor.setHex(0x8a7c6a);
          const corners = [0, 1, 2, 3].map((k) => {
            const v = grid.corner(cell, k);
            return { x: v.x, y, z: v.y };
          });
          if (level > 0 || !town.isLand(cellId)) {
            solid.horzDown(corners[0]!, corners[1]!, corners[2]!, corners[3]!, capColor);
            // posts down to the next support (block top, ground, or sea floor)
            let supportY: number;
            if (level === 0) {
              supportY = SEA_FLOOR; // over water: pilings
            } else {
              let below = -1;
              for (let l = level - 1; l >= 0; l--) {
                if (town.isFilled(cellId, l)) { below = l; break; }
              }
              supportY = below >= 0 ? levelY(below + 1) : town.isLand(cellId) ? LAND_TOP : SEA_FLOOR;
            }
            for (let k = 0; k < 4; k++) {
              const v = grid.corner(cell, k);
              const px = v.x + (cell.cx - v.x) * 0.16;
              const pz = v.y + (cell.cy - v.y) * 0.16;
              solid.post(px, pz, supportY, y, POST_R, postColor);
            }
          }
        }
      }
    }

    // roofs: surfaces per cell, boundary trim owned by this chunk's cells
    // (lighthouse cells skip the roof — the lantern caps them)
    const inChunk = (c: number) => this.chunkOfCell[c] === key;
    for (const region of this.regions) {
      let any = false;
      for (const c of region.cells) {
        if (inChunk(c) && !this.recipes.lanterns.has(c)) {
          emitRoofCell(solid, town, region, c);
          any = true;
        }
      }
      if (any) emitRoofEdges(solid, town, region, (c) => inChunk(c) && !this.recipes.lanterns.has(c));
    }

    // special builds owned by this chunk
    for (const b of this.recipes.buntings) {
      if (inChunk(b.cellA)) emitBunting(solid, town, b);
    }
    for (const g of this.recipes.gardens) {
      if (inChunk(g)) emitGardenCell(solid, town, g);
    }

    const meshes: THREE.Mesh[] = [];
    if (!solid.isEmpty()) {
      const m = new THREE.Mesh(solid.build(), solidMaterial);
      m.castShadow = true;
      m.receiveShadow = true;
      meshes.push(m);
    }
    if (!glass.isEmpty()) {
      const m = new THREE.Mesh(glass.build(), glassMaterial);
      m.receiveShadow = true;
      meshes.push(m);
    }
    for (const m of meshes) this.group.add(m);
    if (meshes.length) this.chunkMeshes.set(key, meshes);
  }
}
