/**
 * Property tests for text rendering, palette import/export and ink mapping.
 * Every entry point must tolerate arbitrary strings and numbers without
 * throwing or producing out-of-range indices.
 */

import { describe, expect, it } from 'vitest';
import { renderTextToGrid } from '../../src/core/text/render';
import { listBitmapFonts } from '../../src/core/text/bitmapFonts';
import { importPaletteFromText, exportPaletteAsText, type Palette } from '../../src/core/palette/palette';
import { inkToIndex, listMappingStrategies } from '../../src/core/mapping';
import {
  DEFAULT_TEXT_RENDER,
  type AsciiGrid,
  type TextAlign,
  type TextRenderSettings,
  type TextStyleId,
} from '../../src/core/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x7e57);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

const TEXT_POOL = [
  '',
  ' ',
  '\n',
  '\n\n\n',
  'ASCII',
  'ascii art studio 1234567890 !@#$%^&*()',
  '日本語テキスト',
  'العربية עברית',
  '🇺🇸🇩🇪🇯🇵',
  '😀🎉👨‍👩‍👧‍👦',
  '\u0000\u0001\u001b[31mred\u001b[0m',
  '   \t\t   \r\n   ',
  'x'.repeat(512),
  '_'.repeat(64),
  String.fromCodePoint(0x10ffff),
  '̧́̈',
  'W\\W/W\\W',
];

const JUNK_TEXT = [
  '',
  'no colours here',
  '#fff',
  '#123456',
  '#123456 #abcdef #FEDCBA',
  'rgb(1,2,3) #zzzzzz #12 #12345',
  '#000000\n#ffffff\n#808080',
  'random text with 12345 and spaces',
  '######',
  '🫠 palette: #0d1117, #161b22, #21262d',
];

function randomText(): string {
  const parts: string[] = [];
  const count = int(1, 6);
  for (let i = 0; i < count; i++) {
    parts.push(pick(TEXT_POOL));
    if (rand() < 0.5) parts.push(rand() < 0.5 ? '\n' : ' ');
  }
  return parts.join('');
}

function randomTextSettings(): TextRenderSettings {
  const base = structuredClone(DEFAULT_TEXT_RENDER);
  const styles: TextStyleId[] = ['plain', 'shadow', 'outline', 'double', 'banner', 'frame'];
  const aligns: TextAlign[] = ['left', 'center', 'right'];
  return {
    ...base,
    font: pick(listBitmapFonts()).id,
    scale: int(1, 4),
    letterSpacing: int(0, 4),
    lineSpacing: int(0, 4),
    align: pick(aligns),
    style: pick(styles),
    shadowChar: pick(['#', '@', '█', ' ']),
    shadowOffsetX: int(-3, 3),
    shadowOffsetY: int(-3, 3),
    frameChars: pick(['─│┌┐└┘', '+-|+', '#', '']),
    upperCaseOnly: rand() < 0.5,
  };
}

describe('fuzz: text render', () => {
  it('never throws and always returns a self-consistent grid', () => {
    for (let iteration = 0; iteration < 80; iteration++) {
      const text = randomText();
      const settings = randomTextSettings();

      let grid: AsciiGrid | undefined;
      expect(() => {
        grid = renderTextToGrid(text, settings);
      }).not.toThrow();
      if (!grid) continue;

      expect(grid.width).toBeGreaterThanOrEqual(0);
      expect(grid.height).toBeGreaterThanOrEqual(0);
      expect(grid.chars.length).toBe(grid.width * grid.height);
      expect(grid.fg === null || grid.fg.length === grid.chars.length).toBe(true);
      expect(grid.bg === null || grid.bg.length === grid.chars.length).toBe(true);
    }
  });

  it('empty input is stable across every style', () => {
    for (const style of ['plain', 'shadow', 'outline', 'double', 'banner', 'frame'] as const) {
      const grid = renderTextToGrid('', { ...structuredClone(DEFAULT_TEXT_RENDER), style });
      expect(grid.chars.length).toBe(grid.width * grid.height);
    }
  });
});

describe('fuzz: palette import/export', () => {
  it('accepts arbitrary junk without throwing', () => {
    for (let iteration = 0; iteration < 60; iteration++) {
      const source = pick(JUNK_TEXT) + (rand() < 0.5 ? ` #${int(0, 0xffffff).toString(16).padStart(6, '0')}` : '');
      let palette: Palette | undefined;
      expect(() => {
        palette = importPaletteFromText(source);
      }).not.toThrow();
      if (!palette) continue;
      expect(Array.isArray(palette.colors)).toBe(true);
      for (const colour of palette.colors) {
        expect(Number.isInteger(colour.rgb)).toBe(true);
        expect(colour.rgb).toBeGreaterThanOrEqual(0);
        expect(colour.rgb).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('export -> import round-trips the colour set', () => {
    for (let iteration = 0; iteration < 30; iteration++) {
      const hexes: string[] = [];
      const count = int(1, 24);
      for (let i = 0; i < count; i++) hexes.push(`#${int(0, 0xffffff).toString(16).padStart(6, '0')}`);
      const original = importPaletteFromText(hexes.join('\n'));
      const reimported = importPaletteFromText(exportPaletteAsText(original));
      expect(reimported.colors.length).toBe(original.colors.length);
      expect(reimported.colors.map((c) => c.rgb)).toEqual(original.colors.map((c) => c.rgb));
    }
  });
});

describe('fuzz: ink mapping', () => {
  it('inkToIndex always lands inside the ramp', () => {
    const strategies = listMappingStrategies();
    expect(strategies.length).toBeGreaterThan(0);

    for (let iteration = 0; iteration < 500; iteration++) {
      const count = int(1, 256);
      const ink = (rand() - 0.5) * 4; // -2..2, finite
      const offset = int(-8, 8);
      const density = pick([0, 0.25, 1, 2, 8]);
      const index = inkToIndex(ink, count, offset, density);
      expect(Number.isFinite(index)).toBe(true);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
  });
});
