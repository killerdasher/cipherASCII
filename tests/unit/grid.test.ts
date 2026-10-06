import { describe, expect, it } from 'vitest';
import {
  createGrid,
  linesToGrid,
  gridToLines,
  gridToString,
  cloneGrid,
  gridsEqual,
  getCell,
  setCell,
  ensureSize,
  contentBounds,
  trimGrid,
  extractRegion,
  overlayGrid,
  flipHorizontal,
  flipVertical,
  rotate90,
  toMutable,
  fromMutable,
  mutableEnsure,
  countInk,
} from '../../src/core/grid';

describe('grid', () => {
  const g = (w: number, h: number, fill = ' ') => createGrid(w, h, fill);

  describe('createGrid', () => {
    it('creates correct dimensions', () => {
      const grid = g(5, 3);
      expect(grid.width).toBe(5);
      expect(grid.height).toBe(3);
      expect(grid.chars.length).toBe(15);
    });
    it('fills with provided char', () => {
      const grid = g(2, 2, '#');
      expect(grid.chars.every((c) => c === '#')).toBe(true);
    });
  });

  describe('linesToGrid / gridToLines', () => {
    it('round-trips uniform lines', () => {
      const lines = ['abc', 'def'];
      const grid = linesToGrid(lines);
      expect(grid.width).toBe(3);
      expect(grid.height).toBe(2);
      expect(gridToLines(grid)).toEqual(lines);
    });
    it('pads ragged lines', () => {
      const grid = linesToGrid(['a', 'bc']);
      expect(grid.width).toBe(2);
      expect(gridToLines(grid)).toEqual(['a ', 'bc']);
    });
  });

  describe('gridToString', () => {
    it('joins with newlines', () => {
      const grid = linesToGrid(['ab', 'cd']);
      expect(gridToString(grid)).toBe('ab\ncd');
    });
  });

  describe('cloneGrid', () => {
    it('deep clones chars', () => {
      const a = linesToGrid(['ab', 'cd']);
      const b = cloneGrid(a);
      b.chars[0] = 'x';
      expect(a.chars[0]).toBe('a');
    });
    it('copies fg/bg', () => {
      const a = linesToGrid(['x']);
      a.fg = new Int32Array([0xff0000]);
      a.bg = new Int32Array([0x00ff00]);
      const b = cloneGrid(a);
      expect(b.fg![0]).toBe(0xff0000);
      expect(b.bg![0]).toBe(0x00ff00);
      b.fg![0] = 0;
      expect(a.fg![0]).toBe(0xff0000);
    });
  });

  describe('gridsEqual', () => {
    it('true for identical', () => {
      const a = linesToGrid(['ab']);
      const b = linesToGrid(['ab']);
      expect(gridsEqual(a, b)).toBe(true);
    });
    it('false for different dims', () => {
      expect(gridsEqual(g(2, 1), g(3, 1))).toBe(false);
    });
    it('false for different chars', () => {
      expect(gridsEqual(g(1, 1, 'a'), g(1, 1, 'b'))).toBe(false);
    });
    it('compares fg/bg', () => {
      const a = linesToGrid(['x']);
      a.fg = new Int32Array([1]);
      const b = linesToGrid(['x']);
      b.fg = new Int32Array([2]);
      expect(gridsEqual(a, b)).toBe(false);
    });
  });

  describe('getCell / setCell', () => {
    it('getCell in bounds', () => {
      const grid = linesToGrid(['abc']);
      expect(getCell(grid, 1, 0)).toBe('b');
    });
    it('getCell out of bounds = space', () => {
      expect(getCell(g(1, 1), 5, 5)).toBe(' ');
    });
    it('setCell returns new grid', () => {
      const a = g(2, 1, 'a');
      const b = setCell(a, 0, 0, 'z');
      expect(b).not.toBe(a);
      expect(getCell(b, 0, 0)).toBe('z');
      expect(getCell(a, 0, 0)).toBe('a');
    });
  });

  describe('ensureSize', () => {
    it('grows grid', () => {
      const a = g(2, 2, 'a');
      const b = ensureSize(a, 4, 3);
      expect(b.width).toBe(4);
      expect(b.height).toBe(3);
      expect(getCell(b, 0, 0)).toBe('a');
      expect(getCell(b, 3, 2)).toBe(' ');
    });
    it('does not shrink grid (only grows)', () => {
      const a = linesToGrid(['abcd', 'efgh', 'ijkl']);
      const b = ensureSize(a, 2, 2);
      // ensureSize uses Math.max, so it keeps original size
      expect(b.width).toBe(4);
      expect(b.height).toBe(3);
    });
  });

  describe('contentBounds', () => {
    it('returns null for empty grid', () => {
      expect(contentBounds(g(5, 5, ' '))).toBeNull();
    });
    it('bounds of single char', () => {
      const grid = g(5, 5, ' ');
      grid.chars[2 + 3 * 5] = '#';
      const b = contentBounds(grid);
      expect(b).toEqual({ x: 2, y: 3, width: 1, height: 1 });
    });
    it('bounds of multiple', () => {
      const grid = g(5, 5, ' ');
      grid.chars[1 + 1 * 5] = '#';
      grid.chars[3 + 2 * 5] = '#';
      expect(contentBounds(grid)).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    });
  });

  describe('trimGrid', () => {
    it('removes empty border', () => {
      const grid = linesToGrid(['   ', ' # ', '   ']);
      const trimmed = trimGrid(grid);
      expect(trimmed.width).toBe(1);
      expect(trimmed.height).toBe(1);
      expect(trimmed.chars[0]).toBe('#');
    });
    it('no-op when no empty border', () => {
      const grid = linesToGrid(['#', '#']);
      expect(trimGrid(grid).chars).toEqual(grid.chars);
    });
  });

  describe('extractRegion', () => {
    it('extracts sub-rectangle', () => {
      const grid = linesToGrid(['abcd', 'efgh']);
      const region = extractRegion(grid, 1, 0, 2, 1);
      expect(gridToLines(region)).toEqual(['bc']);
    });
    it('clamps to bounds', () => {
      const grid = linesToGrid(['ab']);
      const region = extractRegion(grid, -1, 0, 5, 2);
      expect(region.width).toBe(2);
      expect(region.height).toBe(1);
    });
  });

  describe('overlayGrid', () => {
    it('overlays opaque onto base', () => {
      const base = linesToGrid(['aaaa', 'aaaa']);
      const over = linesToGrid(['bb', 'bb']);
      const out = overlayGrid(base, over, 1, 1);
      // base is 4x2, overlay 2x2 at (1,1)
      expect(out.height).toBe(2);
      expect(out.width).toBe(4);
      // row 0 unchanged (dy=1), row 1 has overlay at x=1,2
      expect(gridToLines(out)[0]).toBe('aaaa');
      expect(gridToLines(out)[1]).toBe('abba');
    });
    it('spaceIsTransparent option', () => {
      const base = linesToGrid(['aa', 'aa']);
      const over = linesToGrid([' b', 'b ']);
      const out = overlayGrid(base, over, 0, 0, { spaceIsTransparent: true });
      // space in overlay is transparent, so base 'a' shows through
      expect(out.chars[0]).toBe('a'); // overlay[0,0] is space -> transparent
      expect(out.chars[1]).toBe('b'); // overlay[0,1] is 'b'
      expect(out.chars[2]).toBe('b'); // overlay[1,0] is 'b'
      expect(out.chars[3]).toBe('a'); // overlay[1,1] is space -> transparent
    });
  });

  describe('flipHorizontal / flipVertical / rotate90', () => {
    it('flipHorizontal mirrors', () => {
      expect(gridToLines(flipHorizontal(linesToGrid(['abc', 'def'])))).toEqual(['cba', 'fed']);
    });
    it('flipVertical mirrors', () => {
      expect(gridToLines(flipVertical(linesToGrid(['abc', 'def'])))).toEqual(['def', 'abc']);
    });
    it('rotate90 clockwise', () => {
      expect(gridToLines(rotate90(linesToGrid(['ab', 'cd'])))).toEqual(['ca', 'db']);
    });
  });

  describe('MutableGrid', () => {
    it('round-trips via toMutable/fromMutable', () => {
      const a = linesToGrid(['abc', 'def']);
      const m = toMutable(a);
      m.chars[0] = 'x';
      const b = fromMutable(m);
      expect(b.chars[0]).toBe('x');
    });
    it('mutableEnsure returns new grown grid', () => {
      const m = toMutable(g(2, 2, 'a'));
      const grown = mutableEnsure(m, 4, 4);
      expect(grown.width).toBe(4);
      expect(grown.height).toBe(4);
      // original unchanged
      expect(m.width).toBe(2);
    });
  });

  describe('countInk', () => {
    it('counts non-space chars', () => {
      // 'a #', '   ', '#b ' -> non-space: a, #, #, b = 4
      const grid = linesToGrid(['a #', '   ', '#b ']);
      expect(countInk(grid)).toBe(4);
    });
  });
});