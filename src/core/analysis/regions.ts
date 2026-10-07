/**
 * Regional maps: one aggregate row per rectangular block of the analyzed
 * image.
 *
 * Full-resolution measures answer "what is at this pixel"; regions answer
 * "what is going on over here", which is what a content-aware mapping
 * strategy, a selection tool or a layout hint needs. Aggregation is a plain
 * mean of each channel over the block, except `orientation`, which is a
 * coherence-weighted circular mean (averaging angles directly would cancel a
 * vertical and a horizontal stripe into noise), and the tone bounds, which
 * come from the same percentile fitter the auto-levels button uses.
 *
 * Channels that were not analyzed aggregate to 0 rather than NaN, so a
 * partially analyzed image still yields a usable region map.
 *
 * Pure module: no DOM; input fields are never mutated.
 */

import { computeAutoLevels } from '../image/autoLevels';
import type { AnalysisField } from './field';

/** Nominal block edge in pixels. */
export const DEFAULT_REGION_SIZE = 32;

/** Samples above which a region tone fit subsamples with a fixed stride. */
const MAX_TONE_SAMPLES = 4096;

/** Channels a region aggregates; every field must match the luma size. */
export interface RegionFields {
  luma: AnalysisField;
  contrast?: AnalysisField;
  edge?: AnalysisField;
  texture?: AnalysisField;
  frequency?: AnalysisField;
  coherence?: AnalysisField;
  orientation?: AnalysisField;
  saliency?: AnalysisField;
}

export interface RegionStats {
  /** Block column / row. */
  col: number;
  row: number;
  /** Pixel origin and size of the block; edge blocks may be smaller. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Mean of each channel over the block; 0 when the channel was not analyzed. */
  luma: number;
  contrast: number;
  edge: number;
  texture: number;
  frequency: number;
  structure: number;
  saliency: number;
  /** Coherence-weighted dominant gradient direction, radians in [0, pi). */
  orientation: number;
  /** 2nd / 98th luminance percentiles of the block (auto-levels fit). */
  toneLow: number;
  toneHigh: number;
  /** Percentile stretch the fitter would apply (`1` for a flat block). */
  toneStretch: number;
}

export interface RegionMap {
  /** Blocks per axis. */
  cols: number;
  rows: number;
  /** Nominal block size in pixels; edge blocks shrink to fit the image. */
  regionWidth: number;
  regionHeight: number;
  /** Analyzed image size. */
  width: number;
  height: number;
  /** Row-major block statistics, `cols * rows` entries. */
  stats: RegionStats[];
}

function meanOf(field: AnalysisField | undefined, x0: number, y0: number, x1: number, y1: number): number {
  if (!field) return 0;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * field.width;
    for (let x = x0; x < x1; x++) sum += field.data[row + x];
  }
  return sum / ((x1 - x0) * (y1 - y0));
}

/** Tone fit of the block's luminance samples, via `computeAutoLevels`. */
function toneOf(
  luma: AnalysisField,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { toneLow: number; toneHigh: number; toneStretch: number } {
  const stride = Math.max(1, Math.ceil(((x1 - x0) * (y1 - y0)) / MAX_TONE_SAMPLES));
  const ySteps = Math.ceil((y1 - y0) / stride);
  const xSteps = Math.ceil((x1 - x0) / stride);
  const samples = new Float32Array(ySteps * xSteps);
  let next = 0;
  for (let y = y0; y < y1; y += stride) {
    const row = y * luma.width;
    for (let x = x0; x < x1; x += stride) samples[next++] = luma.data[row + x];
  }
  const fit = computeAutoLevels(samples, 0.02, 0.98);
  return { toneLow: fit.p2, toneHigh: fit.p98, toneStretch: fit.stretch };
}

/**
 * Aggregate the supplied channels into rectangular block statistics.
 *
 * @param fields - channels to aggregate; `luma` is required and fixes the
 *   image size, optional channels must match it
 * @param regionSize - nominal block edge in pixels (integer >= 1)
 * @returns the region map covering the whole image (edge blocks included)
 * @throws RangeError when dimensions disagree or `regionSize` is not a
 *   positive integer
 */
export function buildRegionMap(fields: RegionFields, regionSize: number = DEFAULT_REGION_SIZE): RegionMap {
  const luma = fields.luma;
  if (!Number.isInteger(regionSize) || regionSize < 1) {
    throw new RangeError(`region size must be a positive integer, got ${regionSize}`);
  }
  const channels: Array<AnalysisField | undefined> = [
    fields.contrast,
    fields.edge,
    fields.texture,
    fields.frequency,
    fields.coherence,
    fields.saliency,
  ];
  for (const field of channels) {
    if (field && (field.width !== luma.width || field.height !== luma.height)) {
      throw new RangeError(
        `region channel "${field.name}" is ${field.width}x${field.height}, expected ${luma.width}x${luma.height}`,
      );
    }
  }
  const orientation = fields.orientation;
  if (orientation && (orientation.width !== luma.width || orientation.height !== luma.height)) {
    throw new RangeError(
      `region channel "${orientation.name}" is ${orientation.width}x${orientation.height}, expected ${luma.width}x${luma.height}`,
    );
  }

  const cols = Math.max(1, Math.ceil(luma.width / regionSize));
  const rows = Math.max(1, Math.ceil(luma.height / regionSize));
  const stats: RegionStats[] = [];
  for (let row = 0; row < rows; row++) {
    const y0 = row * regionSize;
    const y1 = Math.min(luma.height, y0 + regionSize);
    for (let col = 0; col < cols; col++) {
      const x0 = col * regionSize;
      const x1 = Math.min(luma.width, x0 + regionSize);

      let sin = 0;
      let cos = 0;
      if (orientation) {
        for (let y = y0; y < y1; y++) {
          const orow = y * orientation.width;
          for (let x = x0; x < x1; x++) {
            // Weight by coherence when known so flat areas stop voting.
            const weight = fields.coherence ? fields.coherence.data[orow + x] : 1;
            const angle = orientation.data[orow + x];
            sin += weight * Math.sin(2 * angle);
            cos += weight * Math.cos(2 * angle);
          }
        }
      }
      let domAngle = 0;
      if (sin !== 0 || cos !== 0) {
        let theta = 0.5 * Math.atan2(sin, cos);
        if (theta < 0) theta += Math.PI;
        domAngle = theta;
      }

      stats.push({
        col,
        row,
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        luma: meanOf(luma, x0, y0, x1, y1),
        contrast: meanOf(fields.contrast, x0, y0, x1, y1),
        edge: meanOf(fields.edge, x0, y0, x1, y1),
        texture: meanOf(fields.texture, x0, y0, x1, y1),
        frequency: meanOf(fields.frequency, x0, y0, x1, y1),
        structure: meanOf(fields.coherence, x0, y0, x1, y1),
        saliency: meanOf(fields.saliency, x0, y0, x1, y1),
        orientation: domAngle,
        ...toneOf(luma, x0, y0, x1, y1),
      });
    }
  }

  return {
    cols,
    rows,
    regionWidth: regionSize,
    regionHeight: regionSize,
    width: luma.width,
    height: luma.height,
    stats,
  };
}

/**
 * Statistics of the block containing a pixel; coordinates clamp to the map.
 *
 * @param map - region map from {@link buildRegionMap}
 * @param x - pixel column
 * @param y - pixel row
 * @returns the containing block's statistics
 */
export function regionAt(map: RegionMap, x: number, y: number): RegionStats {
  const col = Math.min(map.cols - 1, Math.max(0, Math.floor(x / map.regionWidth)));
  const row = Math.min(map.rows - 1, Math.max(0, Math.floor(y / map.regionHeight)));
  return map.stats[row * map.cols + col];
}
