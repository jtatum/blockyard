/**
 * Special-build recipe engine (tech doc §3.7, product §8).
 * Recipes are spatial+color pattern matchers evaluated globally after each
 * edit (cheap — O(filled voxels)) whose matches override or augment the plain
 * tile output in the mesher:
 *
 *  LIGHTHOUSE — an isolated 1-cell tower ≥4 high whose top 3+ blocks
 *    alternate between two colors grows a glazed lantern room, gallery deck
 *    and cap instead of a roof; its shaft drops windows so the stripes read.
 *  FLAG BUNTINGS — two facing walls one empty cell apart at the same level
 *    get a catenary string of pennants; endpoint colors decide flag colors
 *    (same → uniform, different → alternating hybrid).
 *  GARDEN COURTYARD — an enclosed open ground region whose surrounding
 *    ground-floor blocks use ≥2 distinct colors becomes a garden (richer
 *    grass; hedges, trees and a bench emitted by the mesher).
 *
 * Everything is deterministic: seeded by (gridSeed, stable cell/level ids).
 */

import type { Grid } from '../grid/grid';
import type { Town } from '../town/town';
import { archSignature, detectArches, type ArchSpec } from './arches';
import { detectStairs, stairsSignature, type StairSpec } from './stairs';

export interface LanternSpec {
  cell: number;
  level: number; // the top voxel that becomes the lantern room
}

export interface BuntingSpec {
  /** wall anchors: from cell A's edge kA, across gap cell, to cell B */
  cellA: number;
  kA: number;
  cellB: number;
  kB: number;
  level: number;
  colorA: number;
  colorB: number;
}

export interface RecipeSet {
  /** cell -> lantern top (only one per column) */
  lanterns: Map<number, LanternSpec>;
  /** 'cell:level' voxels that are lighthouse shaft (suppress windows) */
  shafts: Set<string>;
  buntings: BuntingSpec[];
  /** ground cells that are garden courtyard floor */
  gardens: Set<number>;
  /** placed-block staircases between buildings / onto plazas (spec §8) */
  stairs: StairSpec[];
  /** barrel-vault archways under floating spans, by cell (spec §8) */
  arches: Map<number, ArchSpec>;
  /** trigger cells whose columns are replaced by special geometry — the
   *  mesher excludes these from outline and roof derivation entirely */
  claimed: Set<number>;
}

const voxKey = (cell: number, level: number) => cell + ':' + level;

// ---------------------------------------------------------------------------

function detectLighthouses(town: Town, out: RecipeSet): void {
  const grid = town.grid;
  for (const cell of grid.cells) {
    const mask = town.filled[cell.id]!;
    if (mask === 0) continue;
    const top = 32 - Math.clz32(mask) - 1;
    if (top < 3) continue;
    // contiguous column from 0..top required
    if (mask !== (top === 31 ? -1 >>> 0 : (1 << (top + 1)) - 1) >>> 0) continue;
    // isolated above ground level: no filled edge neighbor at levels >= 1
    let isolated = true;
    for (let l = 1; l <= top && isolated; l++) {
      for (const n of cell.neighbors) {
        if (n >= 0 && town.isFilled(n, l)) { isolated = false; break; }
      }
    }
    if (!isolated) continue;
    // top >=3 blocks alternate between exactly two colors
    const c0 = town.colorAt(cell.id, top);
    const c1 = town.colorAt(cell.id, top - 1);
    if (c0 === c1) continue;
    let runs = 2; // top and top-1 already alternate
    for (let l = top - 2; l >= 0; l--) {
      const want = (top - l) % 2 === 0 ? c0 : c1;
      if (town.colorAt(cell.id, l) !== want) break;
      runs++;
    }
    if (runs < 3) continue;
    out.lanterns.set(cell.id, { cell: cell.id, level: top });
    for (let l = 0; l <= top; l++) out.shafts.add(voxKey(cell.id, l));
  }
}

// ---------------------------------------------------------------------------

/** the edge of `gap` that faces away from the edge shared with `from` */
function oppositeEdge(grid: Grid, gap: number, from: number): number {
  const g = grid.cells[gap]!;
  let entry = -1;
  for (let k = 0; k < 4; k++) if (g.neighbors[k] === from) entry = k;
  if (entry < 0) return -1;
  const nIn = grid.edgeNormal(g, entry);
  let best = -1;
  let bestDot = -0.2; // must be roughly opposite
  for (let k = 0; k < 4; k++) {
    if (k === entry) continue;
    const n = grid.edgeNormal(g, k);
    const dot = -(n.x * nIn.x + n.y * nIn.y);
    if (dot > bestDot) { bestDot = dot; best = k; }
  }
  return best;
}

function detectBuntings(town: Town, out: RecipeSet): void {
  const grid = town.grid;
  for (const a of grid.cells) {
    const maskA = town.filled[a.id]!;
    if (maskA === 0) continue;
    for (let kA = 0; kA < 4; kA++) {
      const gap = a.neighbors[kA]!;
      if (gap < 0 || town.filled[gap] !== 0) continue; // gap must be an empty column
      const kGap = oppositeEdge(grid, gap, a.id);
      if (kGap < 0) continue;
      const b = grid.cells[gap]!.neighbors[kGap]!;
      if (b < 0 || b === a.id || a.id > b) continue; // dedupe pairs
      const maskB = town.filled[b]!;
      if (maskB === 0) continue;
      // string level: highest level where BOTH have a filled voxel with air in the gap
      for (let l = Math.min(31 - Math.clz32(maskA), 31 - Math.clz32(maskB)); l >= 1; l--) {
        if (!town.isFilled(a.id, l) || !town.isFilled(b, l)) continue;
        // the wall faces must be exposed; precondition met -> flags appear (CD4)
        if (town.isFilled(gap, l)) break;
        const kB = grid.cells[b]!.neighbors.indexOf(gap);
        out.buntings.push({
          cellA: a.id,
          kA,
          cellB: b,
          kB: kB >= 0 ? kB : kGap,
          level: l,
          colorA: town.colorAt(a.id, l),
          colorB: town.colorAt(b, l),
        });
        break; // only the top qualifying level
      }
    }
  }
}

// ---------------------------------------------------------------------------

function detectGardens(town: Town, out: RecipeSet): void {
  const grid = town.grid;
  const visited = new Set<number>();
  for (const start of grid.cells) {
    if (visited.has(start.id)) continue;
    if (town.filled[start.id] !== 0 || !town.isLand(start.id)) continue;
    // flood-fill open land region; abort if it leaks to water/world edge or grows big
    const region: number[] = [start.id];
    const seen = new Set<number>([start.id]);
    const wallColors = new Set<number>();
    let enclosed = true;
    for (let i = 0; i < region.length && enclosed; i++) {
      const c = grid.cells[region[i]!]!;
      for (const n of c.neighbors) {
        if (n < 0) { enclosed = false; break; }
        if (seen.has(n)) continue;
        if (town.filled[n] !== 0) {
          wallColors.add(town.colorAt(n, 0));
          continue;
        }
        if (!town.isLand(n)) { enclosed = false; break; }
        seen.add(n);
        region.push(n);
        if (region.length > 14) { enclosed = false; break; }
      }
    }
    for (const c of region) visited.add(c);
    // the color rule (CD3): differing colors around the courtyard
    if (enclosed && region.length >= 1 && wallColors.size >= 2) {
      for (const c of region) out.gardens.add(c);
    }
  }
}

// ---------------------------------------------------------------------------

export function computeRecipes(town: Town): RecipeSet {
  const out: RecipeSet = {
    lanterns: new Map(),
    shafts: new Set(),
    buntings: [],
    gardens: new Set(),
    stairs: [],
    arches: new Map(),
    claimed: new Set(),
  };
  detectLighthouses(town, out);
  detectBuntings(town, out);
  detectGardens(town, out);
  out.stairs = detectStairs(town);
  out.arches = detectArches(town);
  // stair triggers are filled columns, so they never collide with gardens or
  // buntings (both require empty columns) or arches (which require a floating
  // span); they do claim their cell out of the wall/roof systems
  for (const s of out.stairs) out.claimed.add(s.cell);
  return out;
}

/**
 * Stable per-cell signature used by the mesher to diff recipe output across
 * edits. Values matter, not just membership: a bunting whose far endpoint
 * changed color must dirty the chunk that OWNS the bunting geometry (cellA).
 */
export function recipeSignature(r: RecipeSet): Map<number, string> {
  const sig = new Map<number, string>();
  const add = (cell: number, s: string) => sig.set(cell, (sig.get(cell) ?? '') + s + ';');
  for (const l of r.lanterns.values()) add(l.cell, 'L' + l.level);
  for (const b of r.buntings) {
    const s = `B${b.cellA},${b.kA},${b.cellB},${b.kB},${b.level},${b.colorA},${b.colorB}`;
    add(b.cellA, s);
    add(b.cellB, s);
  }
  for (const c of r.gardens) add(c, 'G');
  for (const s of r.stairs) {
    // register on all cells the spec depends on: lowering a flanking tower
    // two chunks away must rebuild the trigger cell's chunk
    const ss = stairsSignature(s);
    add(s.cell, ss);
    add(s.cellA, ss);
    add(s.cellB, ss);
    if (s.flankL >= 0) add(s.flankL, ss);
    if (s.flankR >= 0) add(s.flankR, ss);
  }
  for (const a of r.arches.values()) {
    const as = archSignature(a);
    add(a.cell, as);
    if (a.supportA >= 0) add(a.supportA, as);
    if (a.supportB >= 0) add(a.supportB, as);
    if (a.beachCell >= 0) add(a.beachCell, as); // steps live in the water cell
  }
  return sig;
}
