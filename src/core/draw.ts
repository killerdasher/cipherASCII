/**
 * Stroke and fill primitives for the editor: single-cell writes, square
 * brush stamps, gap-free lines and 4-connected flood fill.
 *
 * Moved out of `EditorCanvas.tsx` so they are unit-testable (the audit's
 * coverage blind spot) and so every one of them accepts a selection clip —
 * painting and filling honour the active selection instead of silently
 * ignoring it.
 */

import { cloneGrid } from './grid';
import { NO_COLOR, type AsciiGrid } from './types';
import type { SelectionClip } from './selection';

/**
 * Write one cell into a grid the caller already owns.
 *
 * Returns whether anything changed. The stroke path clones the layer grid
 * exactly once when the pointer goes down and then mutates that clone, so a
 * brush costs O(1) allocations per stroke instead of O(cells) per cell.
 */
export function paintCellInPlace(
  grid: AsciiGrid,
  x: number,
  y: number,
  ch: string,
  color: number,
  clip: SelectionClip = () => true,
): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  if (!clip(x, y)) return false;
  const c = ch.length === 0 ? ' ' : [...ch][0];
  const i = y * grid.width + x;
  const current = grid.fg ? grid.fg[i] : NO_COLOR;
  if (grid.chars[i] === c && current === color) return false;
  grid.chars[i] = c;
  if (grid.fg) {
    grid.fg[i] = color;
  } else if (color !== NO_COLOR) {
    grid.fg = new Int32Array(grid.width * grid.height).fill(NO_COLOR);
    grid.fg[i] = color;
  }
  return true;
}

/** Stamp a square brush of `size` cells centred on (cx, cy), in place. */
export function stampInPlace(
  grid: AsciiGrid,
  cx: number,
  cy: number,
  size: number,
  ch: string,
  color: number,
  clip: SelectionClip = () => true,
): boolean {
  const radius = Math.floor((Math.max(1, size) - 1) / 2);
  let changed = false;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (paintCellInPlace(grid, cx + dx, cy + dy, ch, color, clip)) changed = true;
    }
  }
  return changed;
}

/** Bresenham line so fast pointer moves leave no gaps in the stroke. */
export function walkLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * 4-connected flood fill by character; returns the input grid when nothing
 * changed (identity no-op). Cells are matched on their character alone, so
 * the fill crosses colour changes inside a run of glyphs — and the region
 * selection uses the exact same criterion ("what this fill would cover").
 *
 * `clip` confines both the seed and everything the flood can walk into —
 * a fill started inside a selection never leaks past it.
 */
export function floodFill(
  grid: AsciiGrid,
  startX: number,
  startY: number,
  ch: string,
  color: number,
  clip: SelectionClip = () => true,
): AsciiGrid {
  if (startX < 0 || startY < 0 || startX >= grid.width || startY >= grid.height) return grid;
  if (!clip(startX, startY)) return grid;
  const i0 = startY * grid.width + startX;
  const target = grid.chars[i0];
  const targetColor = grid.fg ? grid.fg[i0] : NO_COLOR;
  if (target === ch && targetColor === color) return grid;
  const next = cloneGrid(grid);
  if (!next.fg) next.fg = new Int32Array(grid.width * grid.height).fill(NO_COLOR);
  const stack: number[] = [i0];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (next.chars[i] !== target) continue;
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    if (!clip(x, y)) continue;
    next.chars[i] = ch;
    next.fg[i] = color;
    if (x > 0) stack.push(i - 1);
    if (x + 1 < grid.width) stack.push(i + 1);
    if (y > 0) stack.push(i - grid.width);
    if (y + 1 < grid.height) stack.push(i + grid.width);
  }
  return next;
}
