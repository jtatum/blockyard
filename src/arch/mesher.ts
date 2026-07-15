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
import { emitArch } from './arches';
import { GeoSink } from './geom';
import { emitGroundProps } from './groundprops';
import { computeOutlinesForLevel, type Outline } from './outline';
import { emitBunting, emitGardenCell, emitLantern } from './props';
import { computeRecipes, recipeSignature, type RecipeSet } from './recipes';
import { computeRoofRegionsForLevel, emitChimney, emitRoofCell, emitRoofEdges, type RoofRegion } from './roofs';
import { emitLargeStairs, emitStairs } from './stairs';
import { emitWallSegment } from './walls';

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
  private outlines: Outline[] = [];
  /** per-level caches — an edit at level L only invalidates outlines at L and
   *  regions at L-1/L, so re-solves stay O(affected levels), not O(town) */
  private levelOutlines: Outline[][] = [];
  private levelRegions: RoofRegion[][] = [];
  /** state snapshots for diffing which levels an update actually touched */
  private prevFilled: Uint32Array;
  private prevColors: Uint8Array;
  /** current special-build matches; terrainmesh reads gardens from here */
  recipes: RecipeSet = {
    lanterns: new Map(),
    shafts: new Set(),
    buntings: [],
    gardens: new Set(),
    stairs: [],
    arches: new Map(),
    claimed: new Set(),
  };

  constructor(town: Town) {
    this.town = town;
    this.grid = town.grid;
    this.prevFilled = new Uint32Array(town.filled.length);
    this.prevColors = new Uint8Array(town.colors.length);
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
    // recipes first: claimed staircase cells feed the outline/roof derivation
    this.recipes = computeRecipes(this.town);
    for (let l = 0; l < MAX_LEVELS; l++) {
      this.levelRegions[l] = computeRoofRegionsForLevel(this.town, l, this.recipes.claimed);
      this.levelOutlines[l] = computeOutlinesForLevel(this.town, l, this.recipes.claimed);
    }
    this.flattenLevelCaches();
    this.prevFilled.set(this.town.filled);
    this.prevColors.set(this.town.colors);
    for (const key of this.chunkCells.keys()) this.buildChunk(key);
  }

  private flattenLevelCaches(): void {
    this.regions = this.levelRegions.flat();
    this.outlines = this.levelOutlines.flat();
  }

  /** diff snapshots against current state → levels needing recompute */
  private refreshDirtyLevels(
    dirty: Set<number>,
    forceOutline?: Set<number>,
    forceRegion?: Set<number>
  ): void {
    const town = this.town;
    const outlineLevels = new Set<number>(forceOutline);
    const regionLevels = new Set<number>(forceRegion);
    for (const c of dirty) {
      const now = town.filled[c]!;
      const diff = (this.prevFilled[c]! ^ now) >>> 0;
      for (let l = 0; l < MAX_LEVELS; l++) {
        const bit = 1 << l;
        if (diff & bit) {
          outlineLevels.add(l);
          regionLevels.add(l);
          if (l > 0) regionLevels.add(l - 1); // exposure of the level below
        } else if (now & bit) {
          // occupied both before and after: roof kind changes with color
          if (this.prevColors[c * MAX_LEVELS + l] !== town.colors[c * MAX_LEVELS + l]) {
            regionLevels.add(l);
          }
        }
      }
      this.prevFilled[c] = now;
      for (let l = 0; l < MAX_LEVELS; l++) {
        this.prevColors[c * MAX_LEVELS + l] = town.colors[c * MAX_LEVELS + l]!;
      }
    }
    for (const l of outlineLevels) {
      this.levelOutlines[l] = computeOutlinesForLevel(town, l, this.recipes.claimed);
    }
    for (const l of regionLevels) {
      this.levelRegions[l] = computeRoofRegionsForLevel(town, l, this.recipes.claimed);
    }
    if (outlineLevels.size || regionLevels.size) this.flattenLevelCaches();
  }

  update(dirty: Set<number>): void {
    // outline fillets depend on LOOP-adjacent edges, which can belong to
    // cells that only share a corner — expand over vertex adjacency
    const expanded = new Set(dirty);
    const ring = (d: number): void => {
      for (const vi of this.grid.cells[d]!.corners) {
        for (const n of this.grid.vertices[vi]!.cells) expanded.add(n);
      }
    };
    for (const d of dirty) ring(d);

    // recipes are global pattern matches, recomputed FIRST because claimed
    // staircase cells feed the outline/roof derivation refreshed below
    const oldSig = recipeSignature(this.recipes);
    const oldClaimed = this.recipes.claimed;
    this.recipes = computeRecipes(this.town);
    const newSig = recipeSignature(this.recipes);

    // a claim toggling on/off changes derived walls/roofs at that cell's
    // filled levels even when no voxel there changed (e.g. a flank grew to
    // two storeys three cells away) — force those levels to re-solve, and
    // spread dirtiness around the toggled cell like any other edit
    const forceOutline = new Set<number>();
    const forceRegion = new Set<number>();
    const toggled: number[] = [];
    for (const c of oldClaimed) if (!this.recipes.claimed.has(c)) toggled.push(c);
    for (const c of this.recipes.claimed) if (!oldClaimed.has(c)) toggled.push(c);
    for (const c of toggled) {
      expanded.add(c);
      ring(c);
      const m = (this.prevFilled[c]! | this.town.filled[c]!) >>> 0;
      for (let l = 0; l < MAX_LEVELS; l++) {
        if (!(m & (1 << l))) continue;
        forceOutline.add(l);
        forceRegion.add(l);
        if (l > 0) forceRegion.add(l - 1);
      }
    }

    const touches = (r: RoofRegion) => {
      for (const c of expanded) if (r.cells.has(c)) return true;
      return false;
    };
    const affectedCells = new Set<number>(expanded);
    for (const r of this.regions) if (touches(r)) for (const c of r.cells) affectedCells.add(c);
    this.refreshDirtyLevels(dirty, forceOutline, forceRegion);
    for (const r of this.regions) if (touches(r)) for (const c of r.cells) affectedCells.add(c);

    // rebuild chunks wherever a recipe's per-cell signature changed
    // (appearance, disappearance, OR value change — e.g. a bunting endpoint
    // recolored two cells away)
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
      if (mask === 0) {
        // ground charm on open land; gardens dress themselves
        if (town.isLand(cellId) && !this.recipes.gardens.has(cellId)) {
          emitGroundProps(solid, glass, town, cellId);
        }
        continue;
      }
      // staircase trigger columns are fully replaced by stair geometry
      if (this.recipes.claimed.has(cellId)) continue;
      const cell = grid.cells[cellId]!;

      const lantern = this.recipes.lanterns.get(cellId);
      const arch = this.recipes.arches.get(cellId);

      for (let level = 0; level < MAX_LEVELS; level++) {
        if (!(mask & (1 << level))) continue;

        // lighthouse lantern replaces the whole top voxel (walls skipped below)
        if (lantern && level === lantern.level) {
          emitLantern(solid, glass, town, lantern);
          continue;
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
            // an archway carries its span level — the vault replaces the posts
            if (arch && level === arch.top) continue;
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

    // walls along the smoothed outlines (segments owned by this chunk's cells)
    const inChunk = (c: number) => this.chunkOfCell[c] === key;
    const largeStair = new Set<number>();
    for (const s of this.recipes.stairs) if (s.kind === 'large') largeStair.add(s.cell);
    // a ground-level wall the large stairs climb against stays blank —
    // windows and doors would be buried behind the treads
    const facesLargeStair = (cell: number, k: number): boolean => {
      const n = grid.cells[cell]!.neighbors[k]!;
      return n >= 0 && largeStair.has(n);
    };
    for (const outline of this.outlines) {
      for (const loop of outline.loops) {
        for (const seg of loop) {
          if (!inChunk(seg.cell)) continue;
          const lantern = this.recipes.lanterns.get(seg.cell);
          if (lantern && lantern.level === outline.level) continue; // lantern replaces walls
          const blank =
            this.recipes.shafts.has(seg.cell + ':' + outline.level) ||
            (outline.level === 0 && facesLargeStair(seg.cell, seg.k));
          emitWallSegment(solid, glass, town, seg, outline.level, blank);
        }
      }
    }

    // roofs: surfaces per cell, boundary trim owned by this chunk's cells
    // (lighthouse cells skip the roof — the lantern caps them)
    for (const region of this.regions) {
      let any = false;
      for (const c of region.cells) {
        if (inChunk(c) && !this.recipes.lanterns.has(c)) {
          emitRoofCell(solid, town, region, c);
          any = true;
        }
      }
      if (any) {
        emitRoofEdges(
          solid,
          town,
          region,
          (c) => inChunk(c) && !this.recipes.lanterns.has(c),
          // a plaza's parapet/eave opens where large stairs land against it
          region.level === 0 ? (seg) => facesLargeStair(seg.cell, seg.k) : undefined
        );
        emitChimney(solid, town, region, inChunk);
      }
    }

    // special builds owned by this chunk
    for (const b of this.recipes.buntings) {
      if (inChunk(b.cellA)) emitBunting(solid, town, b);
    }
    for (const g of this.recipes.gardens) {
      if (inChunk(g)) emitGardenCell(solid, town, g);
    }
    for (const s of this.recipes.stairs) {
      if (!inChunk(s.cell)) continue;
      if (s.kind === 'large') emitLargeStairs(solid, town, s);
      else emitStairs(solid, town, s);
    }
    for (const a of this.recipes.arches.values()) {
      if (inChunk(a.cell)) emitArch(solid, town, a);
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
