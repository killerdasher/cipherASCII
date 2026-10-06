/**
 * Built-in bitmap font catalogue.
 *
 * Fonts are composed from hand-authored glyph tables (letters, digits and
 * punctuation are authored as separate chunks and merged here) plus derived
 * variants (wide, outline) produced programmatically from a base font so the
 * derived forms always stay in sync with their source.
 *
 * External FIGlet fonts are loaded at runtime through `./figlet` and are not
 * bundled, which keeps us free of third-party font licensing concerns.
 */

import { BLOCK_LETTERS } from './fonts/blockLetters';
import { BLOCK_PUNCT } from './fonts/blockPunct';
import { DIGITS_FONT } from './fonts/digits';
import { SLIM_LETTERS } from './fonts/slimLetters';
import { SLANT_LETTERS } from './fonts/slantLetters';

export type FontCategory = 'block' | 'banner' | 'terminal' | 'outline' | 'compact';

export interface BitmapFont {
  id: string;
  name: string;
  category: FontCategory;
  glyphHeight: number;
  /** char -> glyphHeight rows; '#' ink, '.' empty; every row the same length. */
  glyphs: Record<string, string[]>;
  supportsLowercase: boolean;
  description: string;
}

type RawGlyphFont = {
  id: string;
  name: string;
  category: string;
  glyphHeight: number;
  supportsLowercase: boolean;
  description?: string;
  glyphs: Record<string, readonly string[]>;
};

/** Pad all rows of a glyph to equal length and drop malformed glyphs. */
function normalizeGlyphs(glyphs: Record<string, readonly string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(glyphs)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (width === 0) continue;
    out[ch] = rows.map((r) => r.padEnd(width, '.').slice(0, width));
  }
  return out;
}

/** Merge glyph tables left-to-right; later tables win on conflicts. */
function mergeGlyphs(
  ...tables: Array<Record<string, readonly string[]>>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tables) Object.assign(out, normalizeGlyphs(t));
  return out;
}

/** Nearest-neighbour resample of a glyph to a new height (and optional width). */
function resampleGlyph(rows: string[], targetHeight: number, targetWidth?: number): string[] {
  const srcH = rows.length;
  const srcW = rows[0]?.length ?? 0;
  const dstW = targetWidth ?? srcW;
  const out: string[] = [];
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / targetHeight));
    let line = '';
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      line += rows[sy][sx] === '#' ? '#' : '.';
    }
    out.push(line);
  }
  return out;
}

function resampleFontGlyphs(
  glyphs: Record<string, string[]>,
  targetHeight: number,
  widthScale = 1,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(glyphs)) {
    const w = rows[0]?.length ?? 0;
    out[ch] = resampleGlyph(rows, targetHeight, Math.max(1, Math.round(w * widthScale)));
  }
  return out;
}

/** Keep only outline pixels: ink with at least one empty 4-neighbour. */
function hollowGlyphs(glyphs: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(glyphs)) {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    const next: string[] = [];
    for (let y = 0; y < h; y++) {
      let line = '';
      for (let x = 0; x < w; x++) {
        if (rows[y][x] !== '#') {
          line += '.';
          continue;
        }
        const up = y > 0 ? rows[y - 1][x] : '.';
        const down = y < h - 1 ? rows[y + 1][x] : '.';
        const left = x > 0 ? rows[y][x - 1] : '.';
        const right = x < w - 1 ? rows[y][x + 1] : '.';
        const isEdge = up === '.' || down === '.' || left === '.' || right === '.';
        line += isEdge ? '#' : '.';
      }
      next.push(line);
    }
    out[ch] = next;
  }
  return out;
}

function composeFont(
  base: RawGlyphFont,
  parts: Array<Record<string, readonly string[]>>,
  overrides: Partial<BitmapFont>,
): BitmapFont {
  return {
    id: base.id,
    name: base.name,
    category: base.category as FontCategory,
    glyphHeight: base.glyphHeight,
    supportsLowercase: base.supportsLowercase,
    description: base.description ?? '',
    glyphs: mergeGlyphs(...parts),
    ...overrides,
  };
}

// --- Block: hand-authored letters + digits + punctuation --------------------

const BLOCK: BitmapFont = composeFont(
  { ...BLOCK_LETTERS, description: 'Solid 7-row block capitals — the default studio face.' },
  [BLOCK_LETTERS.glyphs, DIGITS_FONT.glyphs, BLOCK_PUNCT.glyphs],
  {},
);

// --- Slim: hand-authored 5-row letters, resampled digits/punctuation --------

const SLIM: BitmapFont = composeFont(
  { ...SLIM_LETTERS, description: 'Narrow 5-row capitals for dense, low-profile text.' },
  [
    SLIM_LETTERS.glyphs,
    resampleFontGlyphs(DIGITS_FONT.glyphs, 5),
    resampleFontGlyphs(BLOCK_PUNCT.glyphs, 5),
  ],
  { id: 'slim', name: 'Slim', category: 'compact' },
);

// --- Slant: hand-authored italic letters, resampled companions --------------

const SLANT: BitmapFont = composeFont(
  { ...SLANT_LETTERS, description: 'Italic 7-row capitals with a steady rightward slant.' },
  [
    SLANT_LETTERS.glyphs,
    resampleFontGlyphs(DIGITS_FONT.glyphs, 7),
    resampleFontGlyphs(BLOCK_PUNCT.glyphs, 7),
  ],
  { id: 'slant', name: 'Slant', category: 'terminal' },
);

// --- Derived variants -------------------------------------------------------

/** Block letters stretched to double width — chunky banner proportions. */
const BANNER: BitmapFont = {
  id: 'banner',
  name: 'Banner',
  category: 'banner',
  glyphHeight: BLOCK.glyphHeight,
  supportsLowercase: false,
  description: 'Block capitals widened to banner proportions (derived from Block).',
  glyphs: resampleFontGlyphs(BLOCK.glyphs, BLOCK.glyphHeight, 2),
};

/** Stroke-only variant of Block. */
const OUTLINE: BitmapFont = {
  id: 'outline',
  name: 'Outline',
  category: 'outline',
  glyphHeight: BLOCK.glyphHeight,
  supportsLowercase: false,
  description: 'Hollow stroke-only capitals (derived from Block).',
  glyphs: hollowGlyphs(BLOCK.glyphs),
};

export const BUILTIN_FONTS: BitmapFont[] = [BLOCK, BANNER, SLIM, SLANT, OUTLINE];

const byId = new Map(BUILTIN_FONTS.map((f) => [f.id, f]));

export function getBitmapFont(id: string): BitmapFont | undefined {
  return byId.get(id);
}

export function listBitmapFonts(): BitmapFont[] {
  return [...BUILTIN_FONTS];
}

/** Runtime validation used by tests and the font inspector. */
export function validateBitmapFont(font: BitmapFont): string[] {
  const problems: string[] = [];
  const entries = Object.entries(font.glyphs);
  if (entries.length === 0) problems.push('font has no glyphs');
  for (const [ch, rows] of entries) {
    if (rows.length !== font.glyphHeight) {
      problems.push(`glyph '${ch}' has ${rows.length} rows, expected ${font.glyphHeight}`);
    }
    const width = rows[0]?.length ?? 0;
    for (const row of rows) {
      if (row.length !== width) problems.push(`glyph '${ch}' has inconsistent row lengths`);
      if (/[^#.]/.test(row)) problems.push(`glyph '${ch}' contains characters other than # and .`);
      break;
    }
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    if (!font.glyphs[ch]) problems.push(`missing glyph for '${ch}'`);
  }
  return problems;
}
