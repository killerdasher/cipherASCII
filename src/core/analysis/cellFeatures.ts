/**
 * Per-cell feature extraction - what the renderer discards today.
 *
 * `averageToCells` collapses a source region to one luminance, so mapping
 * strategies can only ever see brightness. The four planes computed here
 * describe *how* a cell looks, not just how bright it is:
 *
 * - `luminance` - mean brightness (what the pipeline already keeps),
 * - `contrast`  - local standard deviation, doubled and clamped,
 * - `edge`      - mean central-difference gradient magnitude,
 * - `texture`   - high-frequency energy left after a radius-1 box blur.
 *
 * Every plane is `cols * rows` samples in 0..1, row-major, so content-aware
 * mapping (Phase 4) can index them exactly like the ink plane it already uses.
 *
 * Pure module: no DOM, no registry.
 */

import { boxBlur } from '../mapping';

export interface CellFeatures {
  cols: number;
  rows: number;
  /** Mean luminance per cell, 0..1. */
  luminance: Float32Array;
  /** Local standard deviation x2, clamped to 0..1. */
  contrast: Float32Array;
  /** Mean gradient magnitude / sqrt(2), clamped to 0..1. */
  edge: Float32Array;
  /** Residual after a radius-1 blur x2, clamped to 0..1. */
  texture: Float32Array;
}

/** Cell rect in source pixels: `[x0, x1)` x `[y0, y1)`, at least one pixel. */
export function cellRect(
  cols: number,
  rows: number,
  col: number,
  row: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const x0 = Math.min(width - 1, Math.floor((col * width) / cols));
  const y0 = Math.min(height - 1, Math.floor((row * height) / rows));
  const x1 = Math.min(width, Math.max(x0 + 1, Math.floor(((col + 1) * width) / cols)));
  const y1 = Math.min(height, Math.max(y0 + 1, Math.floor(((row + 1) * height) / rows)));
  return [x0, x1, y0, y1];
}

/**
 * Extract the per-cell feature planes from a luminance map.
 *
 * @param luma - source luminance, 0..1, row-major, `width * height` samples
 * @param width - source columns (> 0)
 * @param height - source rows (> 0)
 * @param cols - cell columns (> 0)
 * @param rows - cell rows (> 0)
 * @returns the four feature planes; each value is clamped to 0..1
 * @throws RangeError on non-positive dimensions or a `luma` length mismatch
 */
export function computeCellFeatures(
  luma: Float32Array,
  width: number,
  height: number,
  cols: number,
  rows: number,
): CellFeatures {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`height must be a positive integer, got ${height}`);
  }
  if (!Number.isInteger(cols) || cols <= 0) {
    throw new RangeError(`cols must be a positive integer, got ${cols}`);
  }
  if (!Number.isInteger(rows) || rows <= 0) {
    throw new RangeError(`rows must be a positive integer, got ${rows}`);
  }
  if (luma.length !== width * height) {
    throw new RangeError(`luma has ${luma.length} samples but ${width}x${height} needs ${width * height}`);
  }

  const cells = cols * rows;
  const luminance = new Float32Array(cells);
  const contrast = new Float32Array(cells);
  const edge = new Float32Array(cells);
  const texture = new Float32Array(cells);

  // Gradient magnitude per source pixel (one-sided at the borders) and the
  // radius-1 residual are computed once, then averaged over each cell.
  const gradient = new Float32Array(luma.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let gx = 0;
      if (width > 1) gx = x === 0 ? luma[i + 1] - luma[i] : x === width - 1 ? luma[i] - luma[i - 1] : luma[i + 1] - luma[i - 1];
      let gy = 0;
      if (height > 1) gy = y === 0 ? luma[i + width] - luma[i] : y === height - 1 ? luma[i] - luma[i - width] : luma[i + width] - luma[i - width];
      gradient[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const blurred = boxBlur(luma, width, height, 1);
  const residual = new Float32Array(luma.length);
  for (let i = 0; i < luma.length; i++) residual[i] = Math.abs(luma[i] - blurred[i]);

  const invSqrt2 = 1 / Math.SQRT2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const [x0, x1, y0, y1] = cellRect(cols, rows, col, row, width, height);
      const n = (x1 - x0) * (y1 - y0);
      let sum = 0;
      let sq = 0;
      let grad = 0;
      let res = 0;
      for (let y = y0; y < y1; y++) {
        const base = y * width;
        for (let x = x0; x < x1; x++) {
          const v = luma[base + x];
          sum += v;
          sq += v * v;
          grad += gradient[base + x];
          res += residual[base + x];
        }
      }
      const mean = sum / n;
      const variance = Math.max(0, sq / n - mean * mean);
      const cell = row * cols + col;
      luminance[cell] = mean;
      contrast[cell] = Math.min(1, Math.sqrt(variance) * 2);
      edge[cell] = Math.min(1, (grad / n) * invSqrt2);
      texture[cell] = Math.min(1, (res / n) * 2);
    }
  }

  return { cols, rows, luminance, contrast, edge, texture };
}
