/**
 * The curated palette (product C1) — original values, not Townscaper's.
 * Color is first-class state: each entry carries a *family* that conditions
 * generated art (CD1: roof kind, trim, window style), not just tint.
 */

export type ColorFamily = 'warm' | 'light' | 'green' | 'cool' | 'dark';
export type RoofKind = 'pitched' | 'flat';

export interface PaletteEntry {
  name: string;
  hex: number;
  family: ColorFamily;
  /** family-conditioned roof: warm/light/green pitch, cool mixes, dark goes flat */
  roof: RoofKind;
  /** trim/frame tint used for window frames, fences, roof edges */
  trim: number;
  /** roof color (differs from wall — the painted-wood look) */
  roofHex: number;
}

export const PALETTE: readonly PaletteEntry[] = [
  { name: 'Brick',    hex: 0xc45848, family: 'warm',  roof: 'pitched', trim: 0xf4eeda, roofHex: 0x9c4437 },
  { name: 'Rust',     hex: 0xd97e41, family: 'warm',  roof: 'pitched', trim: 0xf4eeda, roofHex: 0xa85a2c },
  { name: 'Marigold', hex: 0xe6b84f, family: 'light', roof: 'pitched', trim: 0xffffff, roofHex: 0xb08432 },
  { name: 'Cream',    hex: 0xf0e8d2, family: 'light', roof: 'pitched', trim: 0x8a7a5e, roofHex: 0xc9b184 },
  { name: 'Blossom',  hex: 0xe3a2a2, family: 'warm',  roof: 'pitched', trim: 0xffffff, roofHex: 0xb87676 },
  { name: 'Plum',     hex: 0x96608a, family: 'warm',  roof: 'pitched', trim: 0xe8d8e4, roofHex: 0x6e4465 },
  { name: 'Meadow',   hex: 0x8fae56, family: 'green', roof: 'pitched', trim: 0xf0e8d2, roofHex: 0x67833a },
  { name: 'Pine',     hex: 0x4d7351, family: 'green', roof: 'pitched', trim: 0xd8e4d4, roofHex: 0x35543a },
  { name: 'Teal',     hex: 0x51948b, family: 'cool',  roof: 'pitched', trim: 0xe0efec, roofHex: 0x386e66 },
  { name: 'Harbor',   hex: 0x6da3c9, family: 'cool',  roof: 'pitched', trim: 0xf0f6fa, roofHex: 0x4a7ba0 },
  { name: 'Indigo',   hex: 0x45598c, family: 'cool',  roof: 'flat',    trim: 0xc8d2e8, roofHex: 0x33406a },
  { name: 'Timber',   hex: 0x83603f, family: 'dark',  roof: 'pitched', trim: 0xd9c7ae, roofHex: 0x5e4227 },
  { name: 'Slate',    hex: 0x8e979e, family: 'cool',  roof: 'flat',    trim: 0xe6eaee, roofHex: 0x6a7379 },
  { name: 'Charcoal', hex: 0x4c4a52, family: 'dark',  roof: 'flat',    trim: 0x9c98a6, roofHex: 0x36343c },
  { name: 'Snow',     hex: 0xf5f2ea, family: 'light', roof: 'pitched', trim: 0x8f8878, roofHex: 0xcdc5b2 },
];

export const DEFAULT_COLOR = 0; // Brick
