/** World-scale constants shared by state, meshing, and picking. */

/** height of one block level in world units */
export const BLOCK_H = 1.0;
/** top surface of ground (land cells and over-water decks) */
export const LAND_TOP = 0.3;
/** water surface plane */
export const WATER_Y = 0.0;
/** sea floor shown through water at shorelines */
export const SEA_FLOOR = -0.9;
/** maximum stack height in levels (spec asks ≥16) */
export const MAX_LEVELS = 24;

/** world Y of the bottom of a block at `level` */
export function levelY(level: number): number {
  return LAND_TOP + level * BLOCK_H;
}
