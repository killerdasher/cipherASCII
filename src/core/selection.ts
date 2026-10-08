/**
 * Document selection: rectangle marquee, click-to-select regions, and the
 * extract / clear / paste operations the clipboard is built on.
 *
 * A selection is a cell-space `bounds` rectangle plus an optional per-cell
 * `mask` inside it (`1` = selected). Everything is pure: no store, no DOM.
 * `null` bounds (or a `null` selection) means "nothing selected", which the
 * drawing tools read as "no restriction" — see {@link selectionClip}.
 */

import { cloneGrid } from './grid';
import { NO_COLOR, type AsciiGrid, type SelectionState } from './types';

/** The rectangle half of {@link SelectionState.bounds}. */
export type SelectionBounds = NonNullable<SelectionState['bounds']>;

/** Predicate the drawing primitives use to accept or skip a cell. */
export type SelectionClip = (x: number, y: number) => boolean;

/** Accepts every cell — the clip used when there is no selection. */
export const allowAllClip: SelectionClip = () => true;

/** The empty selection (`bounds: null` → nothing selected). */
export function emptySelection(): SelectionState {
  return { type: 'rectangle', bounds: null, mask: null };
}

/** Inclusive endpoints → normalised rectangle (width/height ≥ 1). */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): SelectionBounds {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, width: Math.abs(x1 - x0) + 1, height: Math.abs(y1 - y0) + 1 };
}

/** Intersect with the canvas; `null` when the result is empty. */
export function clampRect(
  rect: SelectionBounds,
  canvasWidth: number,
  canvasHeight: number,
): SelectionBounds | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(canvasWidth, rect.x + rect.width);
  const bottom = Math.min(canvasHeight, rect.y + rect.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Rectangle selection clipped to the canvas; empty when fully outside. */
export function rectSelection(
  rect: SelectionBounds,
  canvasWidth: number,
  canvasHeight: number,
): SelectionState {
  const bounds = clampRect(rect, canvasWidth, canvasHeight);
  if (!bounds) return emptySelection();
  return { type: 'rectangle', bounds, mask: null };
}

/**
 * Click-to-select: the 4-connected region of cells sharing the seed cell's
 * character, reduced to its bounding box plus a mask — the same region the
 * fill tool would paint ("select what the fill covers").
 *
 * Out-of-bounds seeds yield the empty selection.
 */
export function regionSelectionFromSeed(grid: AsciiGrid, startX: number, startY: number): SelectionState {
  if (startX < 0 || startY < 0 || startX >= grid.width || startY >= grid.height) {
    return emptySelection();
  }
  const i0 = startY * grid.width + startX;
  const target = grid.chars[i0];

  const seen = new Uint8Array(grid.width * grid.height);
  const stack: number[] = [i0];
  seen[i0] = 1;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  const hits: number[] = [];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (grid.chars[i] !== target) continue;
    hits.push(i);
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0 && !seen[i - 1]) {
      seen[i - 1] = 1;
      stack.push(i - 1);
    }
    if (x + 1 < grid.width && !seen[i + 1]) {
      seen[i + 1] = 1;
      stack.push(i + 1);
    }
    if (y > 0 && !seen[i - grid.width]) {
      seen[i - grid.width] = 1;
      stack.push(i - grid.width);
    }
    if (y + 1 < grid.height && !seen[i + grid.width]) {
      seen[i + grid.width] = 1;
      stack.push(i + grid.width);
    }
  }

  const bounds: SelectionBounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const mask = new Uint8Array(bounds.width * bounds.height);
  for (const i of hits) {
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    mask[(y - bounds.y) * bounds.width + (x - bounds.x)] = 1;
  }
  return { type: 'region', bounds, mask };
}

/**
 * Is `x, y` inside the selection?
 *
 * A `null` selection or one with no bounds selects nothing; use
 * {@link selectionClip} when "no selection" should mean "everything".
 */
export function isCellSelected(selection: SelectionState | null, x: number, y: number): boolean {
  const b = selection?.bounds;
  if (!b) return false;
  if (x < b.x || y < b.y || x >= b.x + b.width || y >= b.y + b.height) return false;
  if (!selection.mask) return true;
  return selection.mask[(y - b.y) * b.width + (x - b.x)] === 1;
}

/**
 * Clip predicate for the drawing primitives: no selection means every cell
 * is allowed, otherwise only selected cells paint or fill.
 */
export function selectionClip(selection: SelectionState | null): SelectionClip {
  if (!selection || !selection.bounds) return allowAllClip;
  return (x, y) => isCellSelected(selection, x, y);
}

/**
 * Copy the selected cells into a `bounds`-sized grid.
 *
 * Cells outside the selection (only possible with a mask) become spaces with
 * no colour, so pasting the result never touches them.
 */
export function extractSelection(grid: AsciiGrid, selection: SelectionState | null): AsciiGrid | null {
  const b = selection?.bounds;
  if (!b) return null;
  const out = {
    width: b.width,
    height: b.height,
    chars: new Array<string>(b.width * b.height).fill(' '),
    fg: new Int32Array(b.width * b.height).fill(NO_COLOR),
    bg: new Int32Array(b.width * b.height).fill(NO_COLOR),
  };
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const gx = b.x + x;
      const gy = b.y + y;
      if (gx >= grid.width || gy >= grid.height) continue;
      if (!isCellSelected(selection, gx, gy)) continue;
      const si = gy * grid.width + gx;
      const di = y * b.width + x;
      out.chars[di] = grid.chars[si];
      if (grid.fg) out.fg[di] = grid.fg[si];
      if (grid.bg) out.bg[di] = grid.bg[si];
    }
  }
  return out;
}

/**
 * Blank the selected cells (space, no colour). Returns the input grid when
 * nothing is selected or nothing changed, so callers can detect no-ops by
 * identity the same way `floodFill` does.
 */
export function clearSelection(grid: AsciiGrid, selection: SelectionState | null): AsciiGrid {
  const b = selection?.bounds;
  if (!b) return grid;
  const out = cloneGrid(grid);
  let changed = false;
  for (let y = b.y; y < b.y + b.height; y++) {
    if (y < 0 || y >= grid.height) continue;
    for (let x = b.x; x < b.x + b.width; x++) {
      if (x < 0 || x >= grid.width) continue;
      if (!isCellSelected(selection, x, y)) continue;
      const i = y * grid.width + x;
      if (out.chars[i] !== ' ') {
        out.chars[i] = ' ';
        changed = true;
      }
      if (out.fg && out.fg[i] !== NO_COLOR) {
        out.fg[i] = NO_COLOR;
        changed = true;
      }
      if (out.bg && out.bg[i] !== NO_COLOR) {
        out.bg[i] = NO_COLOR;
        changed = true;
      }
    }
  }
  return changed ? out : grid;
}

/**
 * Stamp `stamp` onto `base` at (dx, dy).
 *
 * Space cells are transparent — consistent with the compositor, where a
 * space paints nothing — so a region cut/paste round-trip restores exactly
 * what was cut without erasing the artwork around it. Non-space cells write
 * character *and* colour, colour included when the stamp cell is uncoloured.
 *
 * Returns `base` when nothing changed (identity no-op, like `floodFill`).
 */
export function pasteGrid(base: AsciiGrid, stamp: AsciiGrid, dx: number, dy: number): AsciiGrid {
  const out = cloneGrid(base);
  let changed = false;
  for (let y = 0; y < stamp.height; y++) {
    const by = y + dy;
    if (by < 0 || by >= out.height) continue;
    for (let x = 0; x < stamp.width; x++) {
      const ch = stamp.chars[y * stamp.width + x];
      if (ch === ' ') continue;
      const bx = x + dx;
      if (bx < 0 || bx >= out.width) continue;
      const si = y * stamp.width + x;
      const di = by * out.width + bx;
      if (out.chars[di] !== ch) {
        out.chars[di] = ch;
        changed = true;
      }
      const sfg = stamp.fg ? stamp.fg[si] : NO_COLOR;
      if (!out.fg) out.fg = new Int32Array(out.width * out.height).fill(NO_COLOR);
      if (out.fg[di] !== sfg) {
        out.fg[di] = sfg;
        changed = true;
      }
      const sbg = stamp.bg ? stamp.bg[si] : NO_COLOR;
      if (!out.bg) out.bg = new Int32Array(out.width * out.height).fill(NO_COLOR);
      if (out.bg[di] !== sbg) {
        out.bg[di] = sbg;
        changed = true;
      }
    }
  }
  return changed ? out : base;
}
