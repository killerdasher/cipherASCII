import { describe, expect, it } from 'vitest';
import { floodFill, paintCellInPlace, stampInPlace, walkLine } from '../../src/core/draw';
import { rectSelection, selectionClip } from '../../src/core/selection';
import { linesToGrid } from '../../src/core/grid';
import { NO_COLOR, type AsciiGrid } from '../../src/core/types';

function grid(rows: string[]): AsciiGrid {
  return linesToGrid(rows);
}

describe('paintCellInPlace', () => {
  it('writes a cell and reports real changes only', () => {
    const g = grid(['..']);
    expect(paintCellInPlace(g, 0, 0, '#', 0xff0000)).toBe(true);
    expect(g.chars[0]).toBe('#');
    expect(g.fg![0]).toBe(0xff0000);
    expect(paintCellInPlace(g, 0, 0, '#', 0xff0000)).toBe(false);
  });

  it('ignores out-of-bounds coordinates', () => {
    const g = grid(['..']);
    expect(paintCellInPlace(g, -1, 0, 'x', NO_COLOR)).toBe(false);
    expect(paintCellInPlace(g, 0, 9, 'x', NO_COLOR)).toBe(false);
    expect(g.chars.every((c) => c === '.')).toBe(true);
  });

  it('honours the selection clip', () => {
    const g = grid(['..']);
    const clip = selectionClip(rectSelection({ x: 0, y: 0, width: 1, height: 1 }, 2, 1));
    expect(paintCellInPlace(g, 0, 0, 'x', NO_COLOR, clip)).toBe(true);
    expect(paintCellInPlace(g, 1, 0, 'x', NO_COLOR, clip)).toBe(false);
    expect(g.chars).toEqual(['x', '.']);
  });

  it('allocates the colour plane lazily for colourless grids', () => {
    const g = grid(['..']);
    expect(g.fg).toBeNull();
    paintCellInPlace(g, 1, 0, 'x', 0x00ff00);
    expect(g.fg).not.toBeNull();
    expect(g.fg![0]).toBe(NO_COLOR);
    expect(g.fg![1]).toBe(0x00ff00);
  });
});

describe('stampInPlace', () => {
  it('stamps a square brush centred on the pointer', () => {
    const g = grid(['...', '...', '...']);
    expect(stampInPlace(g, 1, 1, 3, '#', NO_COLOR)).toBe(true);
    expect(g.chars.join('')).toBe('###' + '###' + '###');
    // size 1 is the cell itself
    const h = grid(['..']);
    stampInPlace(h, 0, 0, 1, 'o', NO_COLOR);
    expect(h.chars).toEqual(['o', '.']);
  });

  it('clips every cell of the stamp to the selection', () => {
    const g = grid(['...', '...', '...']);
    const clip = selectionClip(rectSelection({ x: 0, y: 0, width: 3, height: 1 }, 3, 3));
    stampInPlace(g, 1, 1, 3, '#', NO_COLOR, clip);
    expect(g.chars.join('')).toBe('###' + '...' + '...');
  });
});

describe('walkLine', () => {
  it('visits both endpoints and never jumps between cells', () => {
    const seen = new Set<string>();
    walkLine(0, 0, 4, 2, (x, y) => seen.add(`${x},${y}`));
    expect(seen.has('0,0')).toBe(true);
    expect(seen.has('4,2')).toBe(true);
    // A Bresenham walk changes x or y by at most one per step, so every
    // visited cell (the walk is longer than one cell here) touches another
    // visited cell at Chebyshev distance 1 — no teleporting gaps.
    const pts = [...seen].map((p) => p.split(',').map(Number));
    for (const [x, y] of pts) {
      const touches = pts.some((p) => Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) === 1);
      expect(touches).toBe(true);
    }
  });

  it('walks a single cell for a zero-length line', () => {
    const visits: Array<[number, number]> = [];
    walkLine(2, 2, 2, 2, (x, y) => visits.push([x, y]));
    expect(visits).toEqual([[2, 2]]);
  });
});

describe('floodFill', () => {
  it('fills the connected run of the seed character', () => {
    const g = grid(['aaba', 'aaba']);
    const filled = floodFill(g, 0, 0, '#', 0xff00ff);
    // Everything reachable through 'a' becomes '#'; the 'b' column blocks
    // the right-hand run.
    expect(filled.chars.join('')).toBe('##ba' + '##ba');
    expect(filled.fg![1]).toBe(0xff00ff);
    expect(filled.fg![4]).toBe(0xff00ff);
    expect(filled.fg![3]).toBe(NO_COLOR);
    // Original untouched (fill clones).
    expect(g.chars[0]).toBe('a');
  });

  it('returns the input grid when the seed already holds the fill', () => {
    const g = grid(['#a']);
    expect(floodFill(g, 0, 0, '#', NO_COLOR)).toBe(g);
  });

  it('ignores out-of-bounds seeds', () => {
    const g = grid(['ab']);
    expect(floodFill(g, -1, 0, '#', NO_COLOR)).toBe(g);
    expect(floodFill(g, 0, 5, '#', NO_COLOR)).toBe(g);
  });

  it('never escapes a selection clip', () => {
    const g = grid(['aaaa', 'aaaa']);
    const clip = selectionClip(rectSelection({ x: 0, y: 0, width: 2, height: 4 }, 4, 4));
    const filled = floodFill(g, 0, 0, '#', NO_COLOR, clip);
    expect(filled.chars.slice(0, 2)).toEqual(['#', '#']);
    expect(filled.chars.slice(2, 4)).toEqual(['a', 'a']);
    expect(filled.chars.slice(4, 6)).toEqual(['#', '#']);
  });

  it('does not start outside the selection', () => {
    const g = grid(['aaaa']);
    const clip = selectionClip(rectSelection({ x: 2, y: 0, width: 2, height: 1 }, 4, 1));
    expect(floodFill(g, 0, 0, '#', NO_COLOR, clip)).toBe(g);
  });
});
