/**
 * Frame differ.
 *
 * Compares the previous frame buffer with the current one and decides *how* to
 * repaint. The choice is measured, not assumed:
 *
 * - nothing changed  → emit nothing
 * - a few row-runs   → emit those runs as dirty rectangles
 * - most of the screen → emit one full-screen rectangle (beating thousands of
 *   fragments on every renderer that has per-rectangle overhead)
 *
 * Row runs are written into a reusable `Int32Array`, so diffing a 200x50 frame
 * allocates nothing.
 */

import { FrameBuffer } from './compose';
import { DirtyRegions } from './dirty';

export type DiffStrategy = 'none' | 'diff' | 'full';

export interface DiffOptions {
  /** Above this changed-cell ratio, prefer one full-screen rectangle. */
  fullThreshold?: number;
  /** Emit run rectangles wider than this as single regions per row. */
  boundsW: number;
  boundsH: number;
}

export interface DiffResult {
  strategy: DiffStrategy;
  regions: DirtyRegions;
  changed: number;
  visited: number;
  /** changed / visited, 0..1 */
  ratio: number;
  /** Wall-clock cost of the scan in milliseconds. */
  ms: number;
}

export const DEFAULT_FULL_THRESHOLD = 0.55;

export function diffFrames(prev: FrameBuffer, next: FrameBuffer, options: DiffOptions): DiffResult {
  const started = performance.now();
  const regions = new DirtyRegions(32, 24);
  const w = next.width;
  const h = next.height;

  if (prev.width !== w || prev.height !== h || w === 0 || h === 0) {
    regions.mark(0, 0, w, h, options.boundsW, options.boundsH);
    return { strategy: 'full', regions, changed: w * h, visited: w * h, ratio: 1, ms: performance.now() - started };
  }

  const threshold = options.fullThreshold ?? DEFAULT_FULL_THRESHOLD;
  const total = w * h;
  let changed = 0;

  // Reusable run buffer: two ints (x, width) per row maximum.
  let runX = -1;
  let runW = 0;
  let runActive = false;
  const pending: number[] = [];

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x = 0;
    let rowHasChange = false;
    while (x < w) {
      const i = row + x;
      const differs =
        prev.glyph[i] !== next.glyph[i] ||
        prev.fg[i] !== next.fg[i] ||
        prev.bg[i] !== next.bg[i] ||
        prev.alpha[i] !== next.alpha[i] ||
        prev.attr[i] !== next.attr[i];
      if (!differs) {
        x++;
        continue;
      }
      rowHasChange = true;
      const start = x;
      while (x < w) {
        const j = row + x;
        const d =
          prev.glyph[j] !== next.glyph[j] ||
          prev.fg[j] !== next.fg[j] ||
          prev.bg[j] !== next.bg[j] ||
          prev.alpha[j] !== next.alpha[j] ||
          prev.attr[j] !== next.attr[j];
        if (!d) break;
        x++;
      }
      const width = x - start;
      changed += width;
      // Extend a run that continues directly from the previous row.
      if (runActive && runX === start && runW === width && pending.length >= 2) {
        pending[pending.length - 1] += 1; // grow height by one row
      } else {
        if (runActive) flushRun(pending, regions, options);
        runX = start;
        runW = width;
        runActive = true;
        pending.push(start, y, width, 1);
      }
    }
    if (!rowHasChange && runActive) {
      flushRun(pending, regions, options);
      runActive = false;
    }
    if (changed > total * threshold) break;
  }
  if (runActive) flushRun(pending, regions, options);

  const ratio = total === 0 ? 0 : changed / total;
  let strategy: DiffStrategy;
  if (changed === 0) {
    strategy = 'none';
  } else if (ratio >= threshold || regions.size > 16) {
    regions.reset();
    regions.mark(0, 0, w, h, options.boundsW, options.boundsH);
    strategy = 'full';
  } else {
    regions.merge(1);
    strategy = 'diff';
  }

  return { strategy, regions, changed, visited: total, ratio, ms: performance.now() - started };
}

function flushRun(pending: number[], regions: DirtyRegions, options: DiffOptions): void {
  if (pending.length === 0) return;
  const x = pending[pending.length - 4];
  const y = pending[pending.length - 3];
  const w = pending[pending.length - 2];
  const h = pending[pending.length - 1];
  regions.mark(x, y, w, h, options.boundsW, options.boundsH);
  pending.length = 0;
}
