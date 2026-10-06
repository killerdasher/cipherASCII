/**
 * `AsciiGrid` construction and geometry operations.
 *
 * All operations are pure: they never mutate their input, which keeps the
 * immutable document model (and structural-sharing undo) correct.
 */

import { NO_COLOR, type AsciiGrid } from './types';
import { clamp } from './util';

/** Create a grid filled with `fill` (defaults to space). */
export function createGrid(width: number, height: number, fill = ' '): AsciiGrid {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const chars: string[] = new Array(w * h);
  chars.fill(fill.length === 0 ? ' ' : fill[0]);
  return { width: w, height: h, chars, fg: null, bg: null };
}

/** Convert ragged text lines into a uniform grid (padded with spaces). */
export function linesToGrid(lines: readonly string[], fill = ' '): AsciiGrid {
  const height = lines.length;
  let width = 0;
  for (const line of lines) width = Math.max(width, line.length);
  const chars: string[] = new Array(width * height);
  const f = fill.length === 0 ? ' ' : fill[0];
  for (let y = 0; y < height; y++) {
    const line = lines[y];
    for (let x = 0; x < width; x++) {
      chars[y * width + x] = x < line.length ? line[x] : f;
    }
  }
  return { width, height, chars, fg: null, bg: null };
}

/** Convert a grid back to text lines (trailing spaces are preserved). */
export function gridToLines(grid: AsciiGrid): string[] {
  const out: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    out.push(grid.chars.slice(y * grid.width, (y + 1) * grid.width).join(''));
  }
  return out;
}

/** Grid → single string with newlines (used by txt export). */
export function gridToString(grid: AsciiGrid): string {
  return gridToLines(grid).join('\n');
}

export function cloneGrid(grid: AsciiGrid): AsciiGrid {
  return {
    width: grid.width,
    height: grid.height,
    chars: grid.chars.slice(),
    fg: grid.fg ? Int32Array.from(grid.fg) : null,
    bg: grid.bg ? Int32Array.from(grid.bg) : null,
  };
}

export function gridsEqual(a: AsciiGrid, b: AsciiGrid): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) if (a.chars[i] !== b.chars[i]) return false;
  for (let i = 0; i < n; i++) {
    const af = a.fg ? a.fg[i] : NO_COLOR;
    const bf = b.fg ? b.fg[i] : NO_COLOR;
    if (af !== bf) return false;
    const ab = a.bg ? a.bg[i] : NO_COLOR;
    const bb = b.bg ? b.bg[i] : NO_COLOR;
    if (ab !== bb) return false;
  }
  return true;
}

export function getCell(grid: AsciiGrid, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return ' ';
  return grid.chars[y * grid.width + x];
}

/** Write a single-character string at (x, y); returns a new grid if changed. */
export function setCell(grid: AsciiGrid, x: number, y: number, ch: string): AsciiGrid {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return grid;
  const c = ch.length === 0 ? ' ' : [...ch][0];
  const i = y * grid.width + x;
  if (grid.chars[i] === c) return grid;
  const next = cloneGrid(grid);
  next.chars[i] = c;
  return next;
}

/** Ensure the grid is at least `width x height`, preserving content. */
export function ensureSize(grid: AsciiGrid, width: number, height: number): AsciiGrid {
  const w = Math.max(grid.width, Math.floor(width));
  const h = Math.max(grid.height, Math.floor(height));
  if (w === grid.width && h === grid.height) return grid;
  const next = createGrid(w, h);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      next.chars[y * w + x] = grid.chars[y * grid.width + x];
      if (grid.fg) next.fg![y * w + x] = grid.fg[y * grid.width + x];
      if (grid.bg) next.bg![y * w + x] = grid.bg[y * grid.width + x];
    }
  }
  return next;
}

/** Bounding box of non-space content; returns null for empty grids. */
export function contentBounds(grid: AsciiGrid): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.chars[y * grid.width + x] !== ' ') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Crop to the content bounding box (returns original when nothing to crop). */
export function trimGrid(grid: AsciiGrid): AsciiGrid {
  const b = contentBounds(grid);
  if (!b) return grid;
  if (b.x === 0 && b.y === 0 && b.width === grid.width && b.height === grid.height) {
    return grid;
  }
  return extractRegion(grid, b.x, b.y, b.width, b.height);
}

/** Extract a (clipped) sub-region. */
export function extractRegion(
  grid: AsciiGrid,
  x: number,
  y: number,
  width: number,
  height: number,
): AsciiGrid {
  const x0 = clamp(x, 0, grid.width);
  const y0 = clamp(y, 0, grid.height);
  const w = clamp(Math.floor(width), 0, grid.width - x0);
  const h = clamp(Math.floor(height), 0, grid.height - y0);
  const out = createGrid(w, h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const si = (y0 + yy) * grid.width + (x0 + xx);
      const di = yy * w + xx;
      out.chars[di] = grid.chars[si];
      if (grid.fg) out.fg![di] = grid.fg[si];
      if (grid.bg) out.bg![di] = grid.bg[si];
    }
  }
  return out;
}

export interface CompositeOptions {
  /** When true (default) space cells of the overlay do not erase the base. */
  spaceIsTransparent?: boolean;
}

/** Composite `over` onto `base` at (dx, dy). Returns `base` when nothing changed. */
export function overlayGrid(
  base: AsciiGrid,
  over: AsciiGrid,
  dx: number,
  dy: number,
  opts: CompositeOptions = {},
): AsciiGrid {
  const transparent = opts.spaceIsTransparent ?? true;
  const out = cloneGrid(base);
  let changed = false;
  for (let y = 0; y < over.height; y++) {
    const by = y + dy;
    if (by < 0 || by >= out.height) continue;
    for (let x = 0; x < over.width; x++) {
      const bx = x + dx;
      if (bx < 0 || bx >= out.width) continue;
      const ch = over.chars[y * over.width + x];
      if (transparent && ch === ' ') continue;
      const di = by * out.width + bx;
      const si = y * over.width + x;
      if (out.chars[di] !== ch) {
        out.chars[di] = ch;
        changed = true;
      }
      if (over.fg) {
        if (!out.fg) {
          out.fg = new Int32Array(out.width * out.height).fill(NO_COLOR);
        }
        const c = over.fg[si];
        if (c !== NO_COLOR && out.fg[di] !== c) {
          out.fg[di] = c;
          changed = true;
        }
      }
      if (over.bg) {
        if (!out.bg) {
          out.bg = new Int32Array(out.width * out.height).fill(NO_COLOR);
        }
        const c = over.bg[si];
        if (c !== NO_COLOR && out.bg[di] !== c) {
          out.bg[di] = c;
          changed = true;
        }
      }
    }
  }
  return changed ? out : base;
}

// ---------------------------------------------------------------------------
// Geometry transforms
// ---------------------------------------------------------------------------

export function flipHorizontal(grid: AsciiGrid): AsciiGrid {
  const out = createGrid(grid.width, grid.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const si = y * grid.width + x;
      const di = y * grid.width + (grid.width - 1 - x);
      out.chars[di] = grid.chars[si];
      if (grid.fg) out.fg![di] = grid.fg[si];
      if (grid.bg) out.bg![di] = grid.bg[si];
    }
  }
  return out;
}

export function flipVertical(grid: AsciiGrid): AsciiGrid {
  const out = createGrid(grid.width, grid.height);
  for (let y = 0; y < grid.height; y++) {
    const srcRow = grid.height - 1 - y;
    for (let x = 0; x < grid.width; x++) {
      const si = srcRow * grid.width + x;
      const di = y * grid.width + x;
      out.chars[di] = grid.chars[si];
      if (grid.fg) out.fg![di] = grid.fg[si];
      if (grid.bg) out.bg![di] = grid.bg[si];
    }
  }
  return out;
}

/** Rotate 90° clockwise: width and height swap. */
export function rotate90(grid: AsciiGrid): AsciiGrid {
  const out = createGrid(grid.height, grid.width);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const si = y * grid.width + x;
      const di = x * out.width + (grid.height - 1 - y);
      out.chars[di] = grid.chars[si];
      if (grid.fg) out.fg![di] = grid.fg[si];
      if (grid.bg) out.bg![di] = grid.bg[si];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Destructive-style editing helpers (operate on a mutable copy)
// ---------------------------------------------------------------------------

/** Mutable grid used by editor and drawing tools (never shared with docs). */
export interface MutableGrid {
  width: number;
  height: number;
  chars: string[];
  fg: Int32Array | null;
  bg: Int32Array | null;
}

export function toMutable(grid: AsciiGrid): MutableGrid {
  return {
    width: grid.width,
    height: grid.height,
    chars: grid.chars.slice(),
    fg: grid.fg ? Int32Array.from(grid.fg) : null,
    bg: grid.bg ? Int32Array.from(grid.bg) : null,
  };
}

export function fromMutable(m: MutableGrid): AsciiGrid {
  return {
    width: m.width,
    height: m.height,
    chars: m.chars,
    fg: m.fg,
    bg: m.bg,
  };
}

/** Grow the mutable grid so (x, y) fits (with optional margin columns). */
export function mutableEnsure(m: MutableGrid, width: number, height: number): MutableGrid {
  const w = Math.max(m.width, width);
  const h = Math.max(m.height, height);
  if (w === m.width && h === m.height) return m;
  const chars: string[] = new Array(w * h).fill(' ');
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) chars[y * w + x] = m.chars[y * m.width + x];
  }
  const fg = m.fg ? new Int32Array(w * h).fill(NO_COLOR) : null;
  const bg = m.bg ? new Int32Array(w * h).fill(NO_COLOR) : null;
  if (fg && m.fg) {
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) fg[y * w + x] = m.fg[y * m.width + x];
    }
  }
  if (bg && m.bg) {
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) bg[y * w + x] = m.bg[y * m.width + x];
    }
  }
  return { width: w, height: h, chars, fg, bg };
}

/** Number of cells whose character is not a space. */
export function countInk(grid: AsciiGrid): number {
  let n = 0;
  for (const c of grid.chars) if (c !== ' ') n++;
  return n;
}
