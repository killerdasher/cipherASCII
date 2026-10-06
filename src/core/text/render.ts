/**
 * Text -> AsciiGrid typography renderer.
 *
 * Takes a string plus `TextRenderSettings` and produces a uniform grid:
 * glyph lookup -> pixel scaling -> letter spacing -> alignment -> line spacing
 * -> style (plain / shadow / outline / double / banner / frame).
 *
 * Styles are deterministic post-processing passes over the ink layer, which is
 * why any style can be applied to any font without per-font special cases.
 */

import { NO_COLOR, type AsciiGrid, type TextRenderSettings } from '../types';
import { clamp } from '../util';
import { linesToGrid } from '../grid';
import { getBitmapFont, type BitmapFont } from './bitmapFonts';

export interface RenderTextOptions {
  /** Character used for '#' ink pixels (default '#'). */
  inkChar?: string;
  /** Foreground colour applied to ink cells (0xRRGGBB). */
  fg?: number;
  /** Optional font (e.g. an imported FIGlet font); overrides `settings.font`. */
  fontOverride?: BitmapFont;
}

function emptyGlyph(height: number, width: number): string[] {
  return Array.from({ length: height }, () => ' '.repeat(width));
}

function glyphWidth(font: BitmapFont): number {
  const g = font.glyphs[' '] ?? font.glyphs['A'];
  return g?.[0]?.length ?? 3;
}

function scaleGlyph(rows: string[], scale: number): string[] {
  if (scale <= 1) return rows;
  const out: string[] = [];
  for (const row of rows) {
    let scaled = '';
    for (const ch of row) scaled += ch.repeat(scale);
    for (let i = 0; i < scale; i++) out.push(scaled);
  }
  return out;
}

function padRows(rows: string[], width: number, fill = ' '): string[] {
  return rows.map((r) => r.padEnd(width, fill).slice(0, width));
}

function maxWidth(layers: string[][]): number {
  return layers.reduce((m, l) => Math.max(m, l[0]?.length ?? 0), 0);
}

/** Rasterize a single text line into an ink layer. */
function lineToLayer(line: string, font: BitmapFont, settings: TextRenderSettings): string[] {
  const scale = clamp(Math.round(settings.scale), 1, 16);
  const spacing = clamp(Math.round(settings.letterSpacing), 0, 16);
  const height = font.glyphHeight;
  const rows: string[] = Array.from({ length: height * scale }, () => '');

  for (const ch of line) {
    const lookup = font.supportsLowercase ? ch : ch.toUpperCase();
    const glyph = font.glyphs[lookup];
    const glyphRows = glyph ?? emptyGlyph(height, glyphWidth(font));
    const scaled = scaleGlyph(glyphRows, scale);
    for (let y = 0; y < scaled.length; y++) {
      rows[y] += scaled[y].replace(/\./g, ' ') + ' '.repeat(spacing);
    }
  }
  // Strip the trailing spacing column so alignment math stays tight.
  if (spacing > 0) {
    for (let y = 0; y < rows.length; y++) {
      rows[y] = rows[y].slice(0, Math.max(0, rows[y].length - spacing));
    }
  }
  return rows.map((r) => r.replace(/\./g, ' '));
}

function alignLayer(rows: string[], width: number, align: TextRenderSettings['align']): string[] {
  return rows.map((r) => {
    const content = r.replace(/\s+$/, '');
    const pad = Math.max(0, width - content.length);
    if (align === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + content + ' '.repeat(pad - left);
    }
    if (align === 'right') return ' '.repeat(pad) + content;
    return content + ' '.repeat(pad);
  });
}

function hollow(rows: string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '#') {
        line += ' ';
        continue;
      }
      const up = y > 0 ? rows[y - 1][x] : ' ';
      const down = y < h - 1 ? rows[y + 1][x] : ' ';
      const left = x > 0 ? rows[y][x - 1] : ' ';
      const right = x < w - 1 ? rows[y][x + 1] : ' ';
      line += up === ' ' || down === ' ' || left === ' ' || right === ' ' ? '#' : ' ';
    }
    out.push(line);
  }
  return out;
}

function stampShadow(rows: string[], settings: TextRenderSettings): string[] {
  const w = rows[0]?.length ?? 0;
  const dx = settings.shadowOffsetX;
  const dy = settings.shadowOffsetY;
  const shadow = settings.shadowChar[0] ?? '#';
  const out = rows.map((r) => r.slice());
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '#') continue;
      const sy = y + dy;
      const sx = x + dx;
      if (sy < 0 || sx < 0 || sy >= rows.length || sx >= w) continue;
      if (out[sy][sx] === ' ') {
        out[sy] = out[sy].slice(0, sx) + shadow + out[sy].slice(sx + 1);
      }
    }
  }
  return out;
}

function stampDouble(rows: string[]): string[] {
  const w = rows[0]?.length ?? 0;
  const out = rows.map((r) => r.slice());
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== '#') continue;
      const sy = y + 1;
      const sx = x + 1;
      if (sy >= rows.length || sx >= w) continue;
      out[sy] = out[sy].slice(0, sx) + '#' + out[sy].slice(sx + 1);
    }
  }
  return out;
}

function frameParts(frameChars: string): {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
} {
  const chars = [...frameChars];
  return {
    h: chars[0] ?? '-',
    v: chars[1] ?? '|',
    tl: chars[2] ?? '+',
    tr: chars[3] ?? '+',
    bl: chars[4] ?? '+',
    br: chars[5] ?? '+',
  };
}

function boxWrap(rows: string[], settings: TextRenderSettings, pad: number): string[] {
  const f = frameParts(settings.frameChars);
  const innerWidth = (rows[0]?.length ?? 0) + pad * 2;
  const inner = rows.map((r) => f.v + ' '.repeat(pad) + r + ' '.repeat(pad) + f.v);
  const top = f.tl + f.h.repeat(innerWidth) + f.tr;
  const bottom = f.bl + f.h.repeat(innerWidth) + f.br;
  return [top, ...inner, ...Array.from({ length: pad }, () => f.v + ' '.repeat(innerWidth) + f.v), bottom];
}

function renderStyle(rows: string[], settings: TextRenderSettings): string[] {
  switch (settings.style) {
    case 'shadow':
      return stampShadow(rows, settings);
    case 'outline':
      return hollow(rows);
    case 'double':
      return stampDouble(rows);
    case 'banner':
      return boxWrap(rows, settings, 0);
    case 'frame':
      return boxWrap(rows, settings, 1);
    case 'plain':
    default:
      return rows;
  }
}

/**
 * Render text into a uniform AsciiGrid. Never throws for any string input:
 * unknown characters become blank glyphs of the font's nominal width.
 */
export function renderTextToGrid(
  text: string,
  settings: TextRenderSettings,
  opts: RenderTextOptions = {},
): AsciiGrid {
  const font = opts.fontOverride ?? getBitmapFont(settings.font) ?? getBitmapFont('block')!;
  const sourceLines = text.replace(/\r\n?/g, '\n').split('\n');
  const prepared = sourceLines.map((line) =>
    settings.upperCaseOnly && !font.supportsLowercase ? line.toUpperCase() : line,
  );

  let layers = prepared.map((line) => lineToLayer(line, font, settings));
  const lineSpacing = clamp(Math.round(settings.lineSpacing), 0, 16);

  // Align every line against the widest one before stacking.
  const targetWidth = maxWidth(layers);
  layers = layers.map((l) => alignLayer(padRows(l, targetWidth), targetWidth, settings.align));

  // Apply the style to each line independently, then re-align (styles may
  // widen a line, e.g. shadow and frame).
  layers = layers.map((l) => renderStyle(l, settings));
  const styledWidth = maxWidth(layers);
  layers = layers.map((l) => padRows(l, styledWidth));

  const stacked: string[] = [];
  layers.forEach((l, i) => {
    if (i > 0) {
      for (let s = 0; s < lineSpacing; s++) stacked.push(' '.repeat(styledWidth));
    }
    stacked.push(...l);
  });
  if (stacked.length === 0) stacked.push('');

  const inkChar = (opts.inkChar ?? '#')[0] ?? '#';
  const finalRows = stacked.map((r) =>
    r
      .replace(/\r/g, '')
      .split('')
      .map((ch) => (ch === '#' ? inkChar : ch))
      .join(''),
  );

  const grid = linesToGrid(finalRows);
  if (opts.fg !== undefined) {
    const fg = new Int32Array(grid.width * grid.height).fill(NO_COLOR);
    for (let i = 0; i < grid.chars.length; i++) {
      if (grid.chars[i] !== ' ') fg[i] = opts.fg!;
    }
    grid.fg = fg;
  }
  return grid;
}
