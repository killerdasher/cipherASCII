/**
 * Analysis fields - dense scalar maps over a rectangular grid.
 *
 * An `AnalysisField` is the common currency of the analysis and generator
 * layers: luminance, saliency, procedural noise and per-cell feature planes
 * all travel in the same typed container, so downstream code can resample,
 * normalise and cache them without special cases.
 *
 * Pure module: no DOM, no registry, no allocation beyond the buffers it owns.
 * Fields are treated as immutable - every transform returns a new field (or,
 * for a size-preserving {@link resampleField}, the field itself).
 */

import { clamp, hashString, stableStringify } from '../util';

export interface AnalysisField {
  /** Producer identity (`luma`, `saliency`, generator node name...). */
  name: string;
  width: number;
  height: number;
  /** Row-major samples, `width * height` elements; owned by the field. */
  data: Float32Array;
  min: number;
  max: number;
  mean: number;
  /** Cache key of the producer settings; `''` for anonymous fields. */
  sourceKey: string;
}

function fieldStats(data: Float32Array): { min: number; max: number; mean: number } {
  if (data.length === 0) return { min: 0, max: 0, mean: 0 };
  let min = data[0];
  let max = data[0];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / data.length };
}

function assertGrid(width: number, height: number): void {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`field width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`field height must be a positive integer, got ${height}`);
  }
}

/**
 * Allocate a field filled with a constant.
 *
 * @param name - producer identity stored on the field
 * @param width - columns (> 0)
 * @param height - rows (> 0)
 * @param fill - initial sample value
 * @param sourceKey - producer cache key
 * @returns the allocated field with computed statistics
 * @throws RangeError when `width`/`height` are not positive integers
 */
export function createField(
  name: string,
  width: number,
  height: number,
  fill = 0,
  sourceKey = '',
): AnalysisField {
  assertGrid(width, height);
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  const { min, max, mean } = fieldStats(data);
  return { name, width, height, data, min, max, mean, sourceKey };
}

/**
 * Wrap an existing buffer as a field, computing its statistics.
 *
 * The field takes ownership of `data`: callers must not mutate it afterwards.
 *
 * @param name - producer identity stored on the field
 * @param width - columns (> 0)
 * @param height - rows (> 0)
 * @param data - exactly `width * height` samples, row-major
 * @param sourceKey - producer cache key
 * @returns the field describing `data`
 * @throws RangeError on bad dimensions or a buffer length mismatch
 */
export function fieldFromData(
  name: string,
  width: number,
  height: number,
  data: Float32Array,
  sourceKey = '',
): AnalysisField {
  assertGrid(width, height);
  if (data.length !== width * height) {
    throw new RangeError(
      `field data has ${data.length} samples but ${width}x${height} needs ${width * height}`,
    );
  }
  const { min, max, mean } = fieldStats(data);
  return { name, width, height, data, min, max, mean, sourceKey };
}

/** Nearest-neighbour sample; coordinates clamp to the field edges. */
export function sampleNearest(field: AnalysisField, x: number, y: number): number {
  const px = clamp(Math.round(x), 0, field.width - 1);
  const py = clamp(Math.round(y), 0, field.height - 1);
  return field.data[py * field.width + px];
}

/** Bilinear sample; coordinates clamp to the field edges (pixel centres at integers). */
export function sampleBilinear(field: AnalysisField, x: number, y: number): number {
  const cx = clamp(x, 0, field.width - 1);
  const cy = clamp(y, 0, field.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, field.width - 1);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const d = field.data;
  const w = field.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bottom = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Resample a field to new dimensions.
 *
 * Shrinking pools source pixels by exact box (area) average, so downsampling
 * never aliases structure away; enlarging interpolates bilinearly, so smooth
 * gradients stay smooth. A size-preserving request returns `field` itself.
 *
 * @param field - source field (never mutated)
 * @param width - target columns (> 0)
 * @param height - target rows (> 0)
 * @returns the resampled field, keeping `name` and `sourceKey`
 * @throws RangeError on non-positive target dimensions
 */
export function resampleField(field: AnalysisField, width: number, height: number): AnalysisField {
  assertGrid(width, height);
  if (width === field.width && height === field.height) return field;

  const out = new Float32Array(width * height);
  const sw = field.width;
  const sh = field.height;
  const src = field.data;
  const shrink = width < sw || height < sh;

  if (shrink) {
    for (let ty = 0; ty < height; ty++) {
      const y0 = Math.floor((ty * sh) / height);
      const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor(((ty + 1) * sh) / height)));
      for (let tx = 0; tx < width; tx++) {
        const x0 = Math.floor((tx * sw) / width);
        const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor(((tx + 1) * sw) / width)));
        let sum = 0;
        for (let y = y0; y < y1; y++) {
          const row = y * sw;
          for (let x = x0; x < x1; x++) sum += src[row + x];
        }
        out[ty * width + tx] = sum / ((x1 - x0) * (y1 - y0));
      }
    }
  } else {
    for (let ty = 0; ty < height; ty++) {
      const sy = ((ty + 0.5) * sh) / height - 0.5;
      for (let tx = 0; tx < width; tx++) {
        const sx = ((tx + 0.5) * sw) / width - 0.5;
        out[ty * width + tx] = sampleBilinear(field, sx, sy);
      }
    }
  }

  const { min, max, mean } = fieldStats(out);
  return { name: field.name, width, height, data: out, min, max, mean, sourceKey: field.sourceKey };
}

/**
 * Linearly remap samples onto 0..1 using the field's own extent.
 *
 * A flat field (no dynamic range) normalises to zeros instead of dividing by
 * zero, so callers can rely on `min === 0 && max === 0` there.
 *
 * @param field - source field (never mutated)
 * @param name - optional renamed identity for the result
 * @returns a 0..1 field with recomputed statistics
 */
export function normalizeField(field: AnalysisField, name = field.name): AnalysisField {
  const span = field.max - field.min;
  const out = new Float32Array(field.data.length);
  if (!(span > 0)) {
    const { min, max, mean } = fieldStats(out);
    return { name, width: field.width, height: field.height, data: out, min, max, mean, sourceKey: field.sourceKey };
  }
  const scale = 1 / span;
  for (let i = 0; i < field.data.length; i++) out[i] = (field.data[i] - field.min) * scale;
  const { min, max, mean } = fieldStats(out);
  return { name, width: field.width, height: field.height, data: out, min, max, mean, sourceKey: field.sourceKey };
}

/**
 * Deterministic cache key for a field producer.
 *
 * @param base - producer id (`generator`, `saliency`, ...)
 * @param params - settings that affect the produced samples; hashed stably
 * @returns a short base36 key, identical for identical inputs
 */
export function fieldCacheKey(base: string, params: unknown): string {
  return `${base}:${hashString(stableStringify(params))}`;
}
