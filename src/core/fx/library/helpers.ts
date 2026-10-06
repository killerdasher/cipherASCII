/**
 * Shared building blocks for cell effects.
 *
 * Every helper is allocation-free and deterministic: the same coordinates and
 * salt always produce the same value, which is what makes `--seed` and the
 * visual-regression demos reproducible.
 */

import type { EffectContext } from '../types';

/** Character pools used by reveal/scramble effects, dark → chaotic. */
export const GLYPH_CIPHER = '0123456789ABCDEF#$%&*+=<>/\\|';
export const GLYPH_GREEK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
export const GLYPH_RUNE = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
export const GLYPH_BLOCKS = '░▒▓█';
export const GLYPH_SPARK = '·:*+•∙';
export const GLYPH_MIXED = '01ABC#$%&*+=<>/\\|·:*';

/** Stable hash → [0,1) for a cell coordinate + salt. */
export function cellRand(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Seed-sensitive variant of {@link cellRand}.
 *
 * Every stochastic effect hashes through this so two `--seed` values produce
 * two visibly different (but individually reproducible) patterns.
 */
export function cellSalt(ctx: EffectContext, x: number, y: number, salt: number): number {
  return cellRand(x, y, (salt + ctx.salt) | 0);
}

/** Pick a glyph from `pool` for a cell, stable for a given salt + seed. */
export function pick(ctx: EffectContext, pool: string, x: number, y: number, salt: number): string {
  const idx = Math.floor(cellSalt(ctx, x, y, salt) * pool.length) % pool.length;
  return pool[idx];
}

/** Restore the source cell (glyph + colours) at full alpha. */
export function restore(ctx: EffectContext, index: number): void {
  ctx.set(index, ctx.sourceGlyph[index], ctx.sourceFg[index], ctx.sourceBg[index], 255);
}

/** Blank the source cell to a space. */
export function erase(ctx: EffectContext, index: number): void {
  ctx.set(index, ctx.intern(' '), NO_COLOR, ctx.sourceBg[index], 255);
}

export const NO_COLOR = -1;

/** Ramp a colour toward white by `amount` (0..1) — used for highlights. */
export function boost(color: number, amount: number): number {
  if (color === NO_COLOR || amount <= 0) return color;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const k = Math.max(0, Math.min(1, amount));
  const nr = Math.min(255, Math.round(r + (255 - r) * k));
  const ng = Math.min(255, Math.round(g + (255 - g) * k));
  const nb = Math.min(255, Math.round(b + (255 - b) * k));
  return (nr << 16) | (ng << 8) | nb;
}

/** Dim a colour toward black by `amount` (0..1). */
export function dim(color: number, amount: number): number {
  if (color === NO_COLOR || amount <= 0) return color;
  const k = 1 - Math.max(0, Math.min(1, amount));
  const r = Math.round(((color >> 16) & 0xff) * k);
  const g = Math.round(((color >> 8) & 0xff) * k);
  const b = Math.round((color & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/** Linear interpolation on a scalar. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp to [0,1]. */
export function sat(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Per-cell activation order in [0,1).
 *
 * Used by assemble/disassemble/burn so cells fire in a scattered but stable
 * sequence rather than a scan order that reads as a wipe.
 */
export function order01(ctx: EffectContext, x: number, y: number, salt: number): number {
  return cellSalt(ctx, x, y, salt);
}

/** Distance from the centre of the canvas, normalised to the corner distance. */
export function radial(ctx: EffectContext, x: number, y: number): number {
  const cx = (ctx.width - 1) / 2;
  const cy = (ctx.height - 1) / 2;
  const max = Math.hypot(cx, cy) || 1;
  return Math.hypot(x - cx, y - cy) / max;
}

/** Centre of the canvas as `[cx, cy]`. */
export function centre(ctx: EffectContext): [number, number] {
  return [(ctx.width - 1) / 2, (ctx.height - 1) / 2];
}

/**
 * Move a source cell to a displaced position.
 *
 * Displacement effects call `ctx.blankMasked()` first, so the cell's original
 * position is empty and this write does not leave a ghost behind.
 */
export function moveCell(ctx: EffectContext, index: number, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) {
    restore(ctx, index);
    return;
  }
  const x = index % ctx.width;
  const y = (index / ctx.width) | 0;
  const tx = Math.round(x + dx);
  const ty = Math.round(y + dy);
  if (tx < 0 || ty < 0 || tx >= ctx.width || ty >= ctx.height) return;
  if (!ctx.mask.test(tx, ty)) return;
  const target = ty * ctx.width + tx;
  ctx.set(target, ctx.sourceGlyph[index], ctx.sourceFg[index], ctx.sourceBg[index], 255);
}

/**
 * Envelope that lifts a displacement off zero and returns it to zero, so a
 * one-shot motion effect ends with the content exactly where it started.
 */
export function swing(progress: number): number {
  return Math.sin(Math.PI * sat(progress));
}
