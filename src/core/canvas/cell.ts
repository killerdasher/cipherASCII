/**
 * Low-level cell model shared by every layer of the rendering stack.
 *
 * Cells are stored as structure-of-arrays inside a {@link Plane} rather than as
 * one object per cell: an animation frame that touches 20,000 cells must not
 * allocate 20,000 objects. Colors are packed `0xRRGGBB` integers; {@link NO_CELL}
 * marks an absent background so composited layers can stay transparent.
 */

/** Sentinel meaning "no colour" (transparent background / inherit foreground). */
export const NO_CELL = -1;

/** Per-cell attribute bit flags. */
export const enum Attr {
  None = 0,
  Bold = 1 << 0,
  Dim = 1 << 1,
  Italic = 1 << 2,
  Underline = 1 << 3,
  Inverse = 1 << 4,
  Strikethrough = 1 << 5,
}

/** How a layer blends with the layers below it. */
export type BlendMode = 'source' | 'over' | 'add' | 'multiply' | 'screen';

/** Read-only view of a single cell. */
export interface CellView {
  glyph: string;
  fg: number;
  bg: number;
  alpha: number;
  attr: number;
}

/** Pack r/g/b (0-255) into the integer colour form used across the engine. */
export function rgb(r: number, g: number, b: number): number {
  return (
    (Math.max(0, Math.min(255, r | 0)) << 16) |
    (Math.max(0, Math.min(255, g | 0)) << 8) |
    Math.max(0, Math.min(255, b | 0))
  );
}

/** Split a packed colour into `[r, g, b]`. */
export function unpackRgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha is ignored) into a packed int. */
export function parseHex(hex: string): number {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const v = parseInt(h.slice(0, 6), 16);
  return Number.isNaN(v) ? NO_CELL : v;
}

/** Format a packed colour as lowercase `#rrggbb`. */
export function toHex(color: number): string {
  if (color === NO_CELL) return 'transparent';
  return '#' + (color >>> 0).toString(16).padStart(6, '0');
}

/** Pack an 8-bit opacity into an attribute-free intensity channel. */
export function clampAlpha(a: number): number {
  return a < 0 ? 0 : a > 255 ? 255 : a | 0;
}

/** Perceptual luminance (BT.709) of a packed colour, 0..1. */
export function luminance(color: number): number {
  if (color === NO_CELL) return 0;
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
