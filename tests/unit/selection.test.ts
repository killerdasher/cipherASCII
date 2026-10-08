import { describe, expect, it } from 'vitest';
import { linesToGrid } from '../../src/core/grid';
import {
  allowAllClip,
  clampRect,
  clearSelection,
  emptySelection,
  extractSelection,
  isCellSelected,
  pasteGrid,
  rectFromPoints,
  rectSelection,
  regionSelectionFromSeed,
  selectionClip,
} from '../../src/core/selection';
import { NO_COLOR, type SelectionState } from '../../src/core/types';

function fgGrid(rows: string[], fg: number | null = null): ReturnType<typeof linesToGrid> {
  const grid = linesToGrid(rows);
  if (fg !== null) {
    grid.fg = new Int32Array(grid.chars.length).fill(fg);
  }
  return grid;
}

describe('rectangle selections', () => {
  it('normalises drag endpoints into an inclusive rectangle', () => {
    expect(rectFromPoints(5, 7, 2, 3)).toEqual({ x: 2, y: 3, width: 4, height: 5 });
    expect(rectFromPoints(2, 3, 5, 7)).toEqual({ x: 2, y: 3, width: 4, height: 5 });
    expect(rectFromPoints(4, 4, 4, 4)).toEqual({ x: 4, y: 4, width: 1, height: 1 });
  });

  it('clips to the canvas and reports fully-outside as empty', () => {
    expect(clampRect({ x: -2, y: -2, width: 5, height: 5 }, 10, 10)).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 3,
    });
    expect(clampRect({ x: 8, y: 8, width: 4, height: 4 }, 10, 10)).toEqual({
      x: 8,
      y: 8,
      width: 2,
      height: 2,
    });
    expect(clampRect({ x: 20, y: 20, width: 4, height: 4 }, 10, 10)).toBeNull();
    expect(clampRect({ x: -5, y: -5, width: 3, height: 3 }, 10, 10)).toBeNull();
  });

  it('rectSelection clips and leaves no mask', () => {
    const sel = rectSelection({ x: -1, y: 0, width: 4, height: 2 }, 3, 3);
    expect(sel.type).toBe('rectangle');
    expect(sel.bounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(sel.mask).toBeNull();
    expect(rectSelection({ x: 99, y: 99, width: 2, height: 2 }, 3, 3).bounds).toBeNull();
  });

  it('treats an empty selection as no restriction and a bound one as full', () => {
    expect(isCellSelected(null, 0, 0)).toBe(false);
    expect(isCellSelected(emptySelection(), 0, 0)).toBe(false);
    const sel = rectSelection({ x: 1, y: 1, width: 2, height: 2 }, 4, 4);
    expect(isCellSelected(sel, 1, 1)).toBe(true);
    expect(isCellSelected(sel, 2, 2)).toBe(true);
    expect(isCellSelected(sel, 0, 0)).toBe(false);
    expect(isCellSelected(sel, 3, 3)).toBe(false);
  });

  it('selectionClip allows everything when nothing is selected', () => {
    expect(selectionClip(null)(5, 5)).toBe(true);
    expect(selectionClip(emptySelection())(5, 5)).toBe(true);
    expect(allowAllClip(5, 5)).toBe(true);
    const sel = rectSelection({ x: 0, y: 0, width: 1, height: 1 }, 4, 4);
    const clip = selectionClip(sel);
    expect(clip(0, 0)).toBe(true);
    expect(clip(1, 0)).toBe(false);
  });
});

describe('region selections', () => {
  it('selects the connected run of matching characters, masked inside its bounds', () => {
    //  A A A . .        bounds (0,0,3,2) with the L-shape selected:
    //  A . . . .        row0: AAA, row1: only the first cell
    const grid = fgGrid(['AAA..', 'A....']);
    const sel = regionSelectionFromSeed(grid, 1, 0);
    expect(sel.type).toBe('region');
    expect(sel.bounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(sel.mask).not.toBeNull();
    // row 0: three selected; row 1: first cell only (diagonals don't connect)
    expect([...sel.mask!.slice(0, 6)]).toEqual([1, 1, 1, 1, 0, 0]);
    expect(isCellSelected(sel, 0, 1)).toBe(true);
    expect(isCellSelected(sel, 1, 1)).toBe(false);
    expect(isCellSelected(sel, 2, 1)).toBe(false);
  });

  it('is bounded by different characters', () => {
    const grid = fgGrid(['ab', 'ab']);
    const sel = regionSelectionFromSeed(grid, 0, 0);
    expect(sel.bounds).toEqual({ x: 0, y: 0, width: 1, height: 2 });
    expect(isCellSelected(sel, 0, 0)).toBe(true);
    expect(isCellSelected(sel, 0, 1)).toBe(true);
    expect(isCellSelected(sel, 1, 0)).toBe(false);
  });

  it('rejects out-of-bounds seeds', () => {
    const grid = fgGrid(['ab']);
    expect(regionSelectionFromSeed(grid, -1, 0).bounds).toBeNull();
    expect(regionSelectionFromSeed(grid, 0, 9).bounds).toBeNull();
  });
});

describe('extract and clear', () => {
  it('extracts a rectangle verbatim, including colours', () => {
    const grid = fgGrid(['abcd', 'efgh'], 0x123456);
    const stamp = extractSelection(grid, rectSelection({ x: 1, y: 0, width: 2, height: 2 }, 4, 2));
    expect(stamp).not.toBeNull();
    expect(stamp!.width).toBe(2);
    expect(stamp!.height).toBe(2);
    expect(stamp!.chars.slice(0, 2).join('')).toBe('bc');
    expect(stamp!.chars.slice(2).join('')).toBe('fg');
    expect(stamp!.fg![0]).toBe(0x123456);
  });

  it('extracts only masked cells; the rest of the bounds become blank', () => {
    const grid = fgGrid(['ab']);
    const sel = regionSelectionFromSeed(grid, 0, 0); // only the "a" cell
    const stamp = extractSelection(grid, sel)!;
    expect(stamp.width).toBe(1);
    expect(stamp.chars[0]).toBe('a');
    // Bounds are 1 wide here, so also check a mixed mask directly:
    const mixed: SelectionState = {
      type: 'region',
      bounds: { x: 0, y: 0, width: 2, height: 1 },
      mask: Uint8Array.from([1, 0]),
    };
    const mixedStamp = extractSelection(grid, mixed)!;
    expect(mixedStamp.chars).toEqual(['a', ' ']);
    expect(mixedStamp.fg![1]).toBe(NO_COLOR);
  });

  it('returns null without bounds', () => {
    expect(extractSelection(fgGrid(['a']), null)).toBeNull();
    expect(extractSelection(fgGrid(['a']), emptySelection())).toBeNull();
  });

  it('clears selected cells to blank and keeps unselected ones', () => {
    const grid = fgGrid(['ab', 'cd'], 0xff0000);
    const sel = rectSelection({ x: 0, y: 0, width: 1, height: 2 }, 2, 2);
    const cleared = clearSelection(grid, sel);
    expect(cleared.chars).toEqual([' ', 'b', ' ', 'd']);
    expect(cleared.fg![0]).toBe(NO_COLOR);
    expect(cleared.fg![1]).toBe(0xff0000);
    // The input grid is untouched (clone-on-write).
    expect(grid.chars[0]).toBe('a');
    expect(grid.fg![0]).toBe(0xff0000);
  });

  it('returns the same grid when nothing applies (identity no-op)', () => {
    const grid = fgGrid(['ab']);
    expect(clearSelection(grid, null)).toBe(grid);
    expect(clearSelection(grid, emptySelection())).toBe(grid);
    // Already blank inside the selection.
    const blank = fgGrid(['  ']);
    expect(clearSelection(blank, rectSelection({ x: 0, y: 0, width: 2, height: 1 }, 2, 1))).toBe(blank);
  });
});

describe('pasteGrid', () => {
  it('stamps non-space cells with their exact colours at an offset', () => {
    const base = fgGrid(['....', '....']);
    const stamp = fgGrid(['XY'], 0xabcdef);
    const pasted = pasteGrid(base, stamp, 2, 1)!;
    expect(pasted.chars[1 * 4 + 2]).toBe('X');
    expect(pasted.chars[1 * 4 + 3]).toBe('Y');
    expect(pasted.fg![6]).toBe(0xabcdef);
    expect(pasted.chars[0]).toBe('.');
    expect(base.chars[4 + 2]).toBe('.');
  });

  it('treats stamp spaces as transparent so cut/paste never eats the art', () => {
    const base = fgGrid(['ab']);
    const stamp = fgGrid(['  ']); // a copied all-space region
    expect(pasteGrid(base, stamp, 0, 0)).toBe(base);
    const mixed = fgGrid(['a b'], 0x111111);
    const pasted = pasteGrid(base, mixed, 0, 0)!;
    // The middle space left the underlying 'b' alone.
    expect(pasted.chars).toEqual(['a', 'b']);
    expect(pasted.fg![0]).toBe(0x111111);
    expect(pasted.fg![1]).toBe(NO_COLOR);
  });

  it('writes an uncoloured non-space cell over a coloured one (exact round trip)', () => {
    const base = fgGrid(['X'], 0xff0000);
    const stamp = fgGrid(['Y'], null);
    const pasted = pasteGrid(base, stamp, 0, 0)!;
    expect(pasted.chars[0]).toBe('Y');
    expect(pasted.fg![0]).toBe(NO_COLOR);
  });

  it('clips stamps to the canvas and reports no-ops by identity', () => {
    const base = fgGrid(['ab']);
    expect(pasteGrid(base, fgGrid(['Z']), 5, 5)).toBe(base);
    const same = fgGrid(['ab']);
    expect(pasteGrid(base, same, 0, 0)).toBe(base);
  });

  it('round-trips cut → paste back into place', () => {
    const grid = fgGrid(['abcd'], 0x222222);
    const sel = rectSelection({ x: 1, y: 0, width: 2, height: 1 }, 4, 1);
    const stamp = extractSelection(grid, sel)!;
    const cut = clearSelection(grid, sel)!;
    expect(cut.chars).toEqual(['a', ' ', ' ', 'd']);
    const pasted = pasteGrid(cut, stamp, 1, 0)!;
    expect(pasted.chars.join('')).toBe('abcd');
    expect(pasted.fg![1]).toBe(0x222222);
    expect(pasted.fg![2]).toBe(0x222222);
  });
});
