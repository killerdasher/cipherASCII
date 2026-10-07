import fs from 'node:fs';
import path from 'node:path';

import { gridToLines, gridToString, linesToGrid, overlayGrid } from '../../src/core/grid';
import { BUILTIN_FONTS } from '../../src/core/text/bitmapFonts';
import { figletToBitmapFont, parseFiglet, type FigletFont } from '../../src/core/text/figlet';
import { renderTextToGrid } from '../../src/core/text/render';
import { DEFAULT_TEXT_RENDER } from '../../src/core/types';
import type { AsciiGrid, TextRenderSettings } from '../../src/core/types';

const FIXTURE_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../tests/fixtures/test-font.flf'),
  'utf8',
);

const BLOCK_FONT = BUILTIN_FONTS.find((font) => font.id === 'block');
if (!BLOCK_FONT) throw new Error('block font missing from BUILTIN_FONTS');

const SAMPLE_FONT: FigletFont = {
  id: 'sample',
  name: 'Sample',
  glyphHeight: 3,
  hardblank: '_',
  glyphs: {
    A: ['##', '#', '###'],
    B: ['####', '##', '#'],
  },
};

function settings(over: Partial<TextRenderSettings> = {}): TextRenderSettings {
  return { ...DEFAULT_TEXT_RENDER, ...over };
}

function countChar(grid: AsciiGrid, ch: string): number {
  let count = 0;
  for (const cell of grid.chars) if (cell === ch) count++;
  return count;
}

describe('BUILTIN_FONTS', () => {
  it('exposes the block, banner, slim, slant and outline faces', () => {
    const ids = BUILTIN_FONTS.map((font) => font.id);
    expect(ids).toHaveLength(5);
    for (const id of ['block', 'banner', 'slim', 'slant', 'outline']) expect(ids).toContain(id);
  });

  it('gives every font non-empty glyphs of uniform height and row width', () => {
    for (const font of BUILTIN_FONTS) {
      const entries = Object.entries(font.glyphs);
      expect(entries.length).toBeGreaterThan(0);
      expect(font.glyphHeight).toBeGreaterThan(0);
      for (const [, rows] of entries) {
        expect(rows.length).toBe(font.glyphHeight);
        const width = rows[0].length;
        expect(width).toBeGreaterThan(0);
        for (const row of rows) expect(row.length).toBe(width);
      }
    }
  });

  it('restricts glyph rows to hash, dot and space characters', () => {
    for (const font of BUILTIN_FONTS) {
      for (const rows of Object.values(font.glyphs)) {
        for (const row of rows) expect(row).toMatch(/^[#. ]*$/);
      }
    }
  });
});

describe('renderTextToGrid layout', () => {
  it('stacks multi-line text at lines * glyphHeight when lineSpacing is 0', () => {
    const grid = renderTextToGrid('AB\nC\nD', settings({ letterSpacing: 0, lineSpacing: 0 }));
    expect(grid.height).toBe(3 * BLOCK_FONT.glyphHeight);
    expect(grid.width).toBeGreaterThan(0);
    expect(grid.chars).toHaveLength(grid.width * grid.height);
  });

  it('inserts lineSpacing blank rows between the stacked lines', () => {
    const grid = renderTextToGrid('AB\nC', settings({ letterSpacing: 0, lineSpacing: 2 }));
    expect(grid.height).toBe(2 * BLOCK_FONT.glyphHeight + 2);
    const lines = gridToLines(grid);
    const gap = lines.slice(BLOCK_FONT.glyphHeight, BLOCK_FONT.glyphHeight + 2);
    expect(gap).toHaveLength(2);
    for (const row of gap) expect(row.trim()).toBe('');
  });

  it('aligns content left, centre and right inside the widest line', () => {
    const base = settings({ letterSpacing: 0, lineSpacing: 0, align: 'left' });
    const left = renderTextToGrid('E\n!', base);
    const centre = renderTextToGrid('E\n!', { ...base, align: 'center' });
    const right = renderTextToGrid('E\n!', { ...base, align: 'right' });

    const leftLines = gridToLines(left);
    const centreLines = gridToLines(centre);
    const rightLines = gridToLines(right);

    expect(centre.width).toBe(left.width);
    expect(right.width).toBe(left.width);
    expect(centreLines).toHaveLength(leftLines.length);
    expect(rightLines).toHaveLength(leftLines.length);

    let padded = 0;
    for (let i = 0; i < leftLines.length; i++) {
      const content = leftLines[i].replace(/\s+$/, '');
      const pad = left.width - content.length;
      const centrePad = Math.floor(pad / 2);
      expect(leftLines[i]).toBe(content + ' '.repeat(pad));
      expect(centreLines[i]).toBe(' '.repeat(centrePad) + content + ' '.repeat(pad - centrePad));
      expect(rightLines[i]).toBe(' '.repeat(pad) + content);
      if (content.length > 0 && content.length < left.width) padded++;
    }
    expect(padded).toBeGreaterThan(0);
  });

  it('widens the grid by one column per step of letterSpacing', () => {
    const width0 = renderTextToGrid('AB', settings({ letterSpacing: 0 })).width;
    const width1 = renderTextToGrid('AB', settings({ letterSpacing: 1 })).width;
    const width2 = renderTextToGrid('AB', settings({ letterSpacing: 2 })).width;
    expect(width1).toBe(width0 + 1);
    expect(width2).toBe(width0 + 2);
    expect(width2).toBeGreaterThan(width1);
  });

  it('doubles both dimensions when scale is 2', () => {
    const scale1 = renderTextToGrid('AB', settings({ letterSpacing: 0, scale: 1 }));
    const scale2 = renderTextToGrid('AB', settings({ letterSpacing: 0, scale: 2 }));
    expect(scale1.height).toBe(BLOCK_FONT.glyphHeight);
    expect(scale2.width).toBe(scale1.width * 2);
    expect(scale2.height).toBe(scale1.height * 2);
  });
});

describe('renderTextToGrid missing glyphs', () => {
  it('falls back to a blank glyph of the nominal width', () => {
    expect(BLOCK_FONT.glyphs['@']).toBeUndefined();

    const widthA = BLOCK_FONT.glyphs['A'][0].length;
    const widthB = BLOCK_FONT.glyphs['B'][0].length;
    const widthSpace = BLOCK_FONT.glyphs[' '][0].length;

    const withUnknown = renderTextToGrid('A@B', settings({ letterSpacing: 0 }));
    const withSpace = renderTextToGrid('A B', settings({ letterSpacing: 0 }));

    expect(withUnknown.height).toBe(BLOCK_FONT.glyphHeight);
    expect(withUnknown.width).toBe(widthA + widthSpace + widthB);
    expect(withUnknown.width).toBe(withSpace.width);
    expect(withUnknown.chars).toEqual(withSpace.chars);
    expect(withUnknown.chars).not.toContain('@');
  });
});

describe('renderTextToGrid styles', () => {
  it('shadow stamps a shifted duplicate of the ink', () => {
    const plain = renderTextToGrid('AB', settings({ style: 'plain' }));
    const shadow = renderTextToGrid(
      'AB',
      settings({ style: 'shadow', shadowChar: '*', shadowOffsetX: 1, shadowOffsetY: 1 }),
    );

    expect(shadow.width).toBe(plain.width);
    expect(shadow.height).toBe(plain.height);
    expect(countChar(plain, '*')).toBe(0);
    expect(countChar(shadow, '*')).toBeGreaterThan(0);
    expect(countChar(shadow, '#')).toBe(countChar(plain, '#'));

    let shifted = 0;
    for (let y = 0; y < plain.height - 1; y++) {
      for (let x = 0; x < plain.width - 1; x++) {
        const ink = plain.chars[y * plain.width + x];
        const belowRight = shadow.chars[(y + 1) * shadow.width + x + 1];
        if (ink === '#' && belowRight === '*') shifted++;
      }
    }
    expect(shifted).toBeGreaterThan(0);
  });

  it('outline hollows the ink', () => {
    const plain = renderTextToGrid('AB', settings({ style: 'plain' }));
    const outlined = renderTextToGrid('AB', settings({ style: 'outline' }));

    expect(outlined.width).toBe(plain.width);
    expect(outlined.height).toBe(plain.height);
    expect(countChar(outlined, '#')).toBeGreaterThan(0);
    expect(countChar(outlined, '#')).toBeLessThan(countChar(plain, '#'));

    for (let y = 0; y < outlined.height; y++) {
      for (let x = 0; x < outlined.width; x++) {
        if (outlined.chars[y * outlined.width + x] !== '#') continue;
        const up = y > 0 ? outlined.chars[(y - 1) * outlined.width + x] : ' ';
        const down = y + 1 < outlined.height ? outlined.chars[(y + 1) * outlined.width + x] : ' ';
        const left = x > 0 ? outlined.chars[y * outlined.width + x - 1] : ' ';
        const right = x + 1 < outlined.width ? outlined.chars[y * outlined.width + x + 1] : ' ';
        expect(up === ' ' || down === ' ' || left === ' ' || right === ' ').toBe(true);
      }
    }
  });

  it('frame draws its border from settings.frameChars', () => {
    const plain = renderTextToGrid('E', settings({ letterSpacing: 0, style: 'plain' }));
    const framed = renderTextToGrid(
      'E',
      settings({ letterSpacing: 0, style: 'frame', frameChars: 'abcxyz' }),
    );
    const innerWidth = plain.width + 2;

    expect(framed.width).toBe(plain.width + 4);
    expect(framed.height).toBe(plain.height + 3);

    const lines = gridToLines(framed);
    expect(lines).toHaveLength(plain.height + 3);
    expect(lines[0]).toBe('c' + 'a'.repeat(innerWidth) + 'x');
    expect(lines[lines.length - 1]).toBe('y' + 'a'.repeat(innerWidth) + 'z');
    expect(lines[plain.height + 1]).toBe('b' + ' '.repeat(innerWidth) + 'b');
    expect(lines[1]).toBe('b ' + gridToLines(plain)[0] + ' b');
    for (let i = 1; i <= plain.height; i++) {
      expect(lines[i][0]).toBe('b');
      expect(lines[i][lines[i].length - 1]).toBe('b');
    }
  });

  it('double thickens the ink', () => {
    const plain = renderTextToGrid('AB', settings({ style: 'plain' }));
    const doubled = renderTextToGrid('AB', settings({ style: 'double' }));

    expect(doubled.width).toBe(plain.width);
    expect(doubled.height).toBe(plain.height);
    expect(countChar(doubled, '#')).toBeGreaterThan(countChar(plain, '#'));

    const keepsInk = plain.chars.every((ch, i) => ch !== '#' || doubled.chars[i] === '#');
    expect(keepsInk).toBe(true);
  });
});

describe('parseFiglet', () => {
  it('parses the fixture font', () => {
    const parsed = parseFiglet(FIXTURE_SOURCE, 'Test Font');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.glyphHeight).toBe(4);
    expect(parsed.value.name).toBe('Test Font');
    const glyphA = parsed.value.glyphs['A'];
    expect(glyphA).toBeDefined();
    expect(glyphA).toHaveLength(4);
    for (const row of glyphA) expect(row).toMatch(/^[#.]+$/);
  });

  it('rejects an empty source with invalid-input', () => {
    const parsed = parseFiglet('');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('invalid-input');
  });

  it('rejects garbage that has no flf2a signature', () => {
    const parsed = parseFiglet('this is definitely not a figlet font\nheight 4 baseline 3');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('invalid-input');
  });
});

describe('figletToBitmapFont', () => {
  it('produces a terminal-category bitmap font without lowercase support', () => {
    const bitmap = figletToBitmapFont(SAMPLE_FONT, 'sample', 'Sample');
    expect(bitmap.id).toBe('sample');
    expect(bitmap.name).toBe('Sample');
    expect(bitmap.category).toBe('terminal');
    expect(bitmap.supportsLowercase).toBe(false);
    expect(bitmap.glyphHeight).toBe(SAMPLE_FONT.glyphHeight);
    expect(Object.keys(bitmap.glyphs)).toEqual(['A', 'B']);
    expect(bitmap.description).toContain('Sample');
  });

  it('pads ragged glyph rows to a uniform width', () => {
    const bitmap = figletToBitmapFont(SAMPLE_FONT, 'sample', 'Sample');
    expect(bitmap.glyphs['A']).toEqual(['##.', '#..', '###']);
    expect(bitmap.glyphs['B']).toEqual(['####', '##..', '#...']);

    for (const rows of Object.values(bitmap.glyphs)) {
      const width = rows[0].length;
      expect(width).toBeGreaterThan(0);
      for (const row of rows) expect(row).toHaveLength(width);
    }
  });
});

describe('text tool stamp composition', () => {
  // The editor text tool renders a stamp with renderTextToGrid and composes
  // it over the active layer with overlayGrid(..., spaceIsTransparent) — the
  // same call the live preview and the committed grid/paint both go through.
  const stamp = (text: string, opts: { fg?: number; inkChar?: string } = {}) =>
    renderTextToGrid(text, DEFAULT_TEXT_RENDER, opts);

  it('keeps the artwork showing through the stamp spaces', () => {
    const base = linesToGrid(['........', '........', '........']);
    const out = overlayGrid(base, stamp('A', { fg: 0xff0000 }), 2, 0, {
      spaceIsTransparent: true,
    });
    const lines = gridToLines(out);
    // The margin column is untouched; the glyph interior and its surrounding
    // spaces keep the base character wherever the stamp did not write ink.
    expect(lines.every((row) => row.startsWith('.'))).toBe(true);
    expect(lines.flat().some((row) => row.includes('#'))).toBe(true);
    expect(lines.flat().some((row) => row.includes('.'))).toBe(true);
  });

  it('applies the foreground to ink only, leaving base cells colourless', () => {
    const base = linesToGrid(['....', '....', '....']);
    const out = overlayGrid(base, stamp('A', { fg: 0xff0000 }), 0, 0, {
      spaceIsTransparent: true,
    });
    expect(out.fg).toBeTruthy();
    let ink = 0;
    for (let i = 0; i < out.chars.length; i++) {
      if (out.chars[i] === '#') {
        expect(out.fg![i]).toBe(0xff0000);
        ink++;
      } else {
        expect(out.fg![i]).toBe(-1);
      }
    }
    expect(ink).toBeGreaterThan(0);
  });

  it('honours the brush character as ink', () => {
    const grid = stamp('A', { inkChar: '@' });
    expect(gridToString(grid)).toContain('@');
    expect(gridToString(grid)).not.toContain('#');
  });

  it('clips stamps that hang off the canvas without throwing', () => {
    const base = linesToGrid(['....', '....']);
    expect(() =>
      overlayGrid(base, stamp('HELLO WORLD'), -3, -2, { spaceIsTransparent: true }),
    ).not.toThrow();
    expect(() =>
      overlayGrid(base, stamp('HELLO WORLD'), 60, 40, { spaceIsTransparent: true }),
    ).not.toThrow();
    // Far outside the canvas: nothing changes.
    const out = overlayGrid(base, stamp('HI'), 60, 40, { spaceIsTransparent: true });
    expect(gridToLines(out)).toEqual(gridToLines(base));
  });
});
