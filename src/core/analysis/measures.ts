/**
 * Content-aware image measures over luminance fields.
 *
 * Every function takes an {@link AnalysisField} holding a luminance plane
 * (0..1) and returns same-size 0..1 fields calibrated against theoretical
 * extrema rather than photographic averages, so thresholds stay portable
 * across images:
 *
 *   contrast   2 x local standard deviation        (1 = full 0..1 swing)
 *   edge       Sobel magnitude / 4                 (1 = step edge)
 *   texture    2 x mean |luma - boxBlur(luma)|     (1 = pixel checkerboard)
 *   frequency  gradient zero-crossing rate         (1 = Nyquist checkerboard)
 *   structure  tensor coherence in [0,1], orientation in [0, pi)
 *
 * Every result carries a `fieldCacheKey` source key derived from the input
 * key and the measure parameters, so repeated analyses of the same image hit
 * the cache in `imageAnalysis.ts`.
 *
 * Pure module: no DOM; input fields are never mutated.
 */

import { boxBlur } from '../mapping';
import { clamp } from '../util';
import { fieldCacheKey, fieldFromData, resampleField, type AnalysisField } from './field';

/** Box radius of the local standard deviation (contrast). */
export const DEFAULT_CONTRAST_RADIUS = 3;
/** Box radius of the detail residual (texture). */
export const DEFAULT_TEXTURE_RADIUS = 2;
/** Structure-tensor integration radius. */
export const DEFAULT_STRUCTURE_RADIUS = 3;
/** Edge length in pixels of one frequency counting block. */
export const DEFAULT_FREQUENCY_WINDOW = 8;

/** Sobel magnitude of a step edge on 0..1 input: -2-2 +1+2+1 -> 4. */
const SOBEL_STEP_MAX = 4;

// ---------------------------------------------------------------------------
// Cache keys - one source of truth, shared by the measures and the analysis
// orchestrator, so a cached field is found by exactly the key it stores.
// ---------------------------------------------------------------------------

/** Cache key of a contrast field for `from` at `radius`. */
export function contrastKey(from: string, radius: number): string {
  return fieldCacheKey('contrast', { from, radius: Math.max(1, Math.round(radius)) });
}

/** Cache key of an edge field for `from`. */
export function edgeKey(from: string): string {
  return fieldCacheKey('edge', { from });
}

/** Cache key of a texture field for `from` at `radius`. */
export function textureKey(from: string, radius: number): string {
  return fieldCacheKey('texture', { from, radius: Math.max(1, Math.round(radius)) });
}

/** Cache key of a frequency field for `from` at `window`. */
export function frequencyKey(from: string, window: number): string {
  return fieldCacheKey('frequency', { from, window: Math.max(3, Math.round(window)) });
}

/** Cache keys of the structure-tensor pair for `from` at `radius`. */
export function structureKeys(from: string, radius: number): { coherence: string; orientation: string } {
  const params = { from, radius: Math.max(1, Math.round(radius)) };
  return {
    coherence: fieldCacheKey('coherence', params),
    orientation: fieldCacheKey('orientation', params),
  };
}


/** Variance at or below single-precision noise reads as a flat field. */
const VARIANCE_EPS = 1e-7;

function squarePlane(plane: Float32Array): Float32Array {
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i++) out[i] = plane[i] * plane[i];
  return out;
}

/**
 * Local contrast: twice the standard deviation inside a box of `radius`.
 *
 * A 0..1 sample never exceeds a standard deviation of 0.5, so the doubled
 * value covers exactly [0,1] and a flat field reads 0.
 *
 * @param luma - luminance field (0..1), never mutated
 * @param radius - box radius in pixels (rounded, minimum 1)
 * @returns same-size contrast field
 */
export function contrastField(
  luma: AnalysisField,
  radius: number = DEFAULT_CONTRAST_RADIUS,
): AnalysisField {
  const r = Math.max(1, Math.round(radius));
  const sourceKey = contrastKey(luma.sourceKey, r);
  const mean = boxBlur(luma.data, luma.width, luma.height, r);
  const meanSq = boxBlur(squarePlane(luma.data), luma.width, luma.height, r);
  const out = new Float32Array(luma.data.length);
  for (let i = 0; i < out.length; i++) {
    // mean and meanSquare are single precision: the difference of two nearly
    // equal values carries rounding noise that would read as micro-contrast.
    const variance = meanSq[i] - mean[i] * mean[i];
    out[i] = variance > VARIANCE_EPS ? clamp(2 * Math.sqrt(variance), 0, 1) : 0;
  }
  return fieldFromData('contrast', luma.width, luma.height, out, sourceKey);
}

/**
 * Sobel edge magnitude, borders included by clamping the neighbourhood.
 *
 * @param luma - luminance field (0..1), never mutated
 * @returns same-size edge field; a vertical/horizontal step edge reads 1
 */
export function edgeField(luma: AnalysisField): AnalysisField {
  const { width: w, height: h, data: d } = luma;
  const sourceKey = edgeKey(luma.sourceKey);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w;
    const yp = Math.min(h - 1, y + 1) * w;
    const y0 = y * w;
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const gx =
        -d[ym + xm] - 2 * d[y0 + xm] - d[yp + xm] + d[ym + xp] + 2 * d[y0 + xp] + d[yp + xp];
      const gy =
        -d[ym + xm] - 2 * d[ym + x] - d[ym + xp] + d[yp + xm] + 2 * d[yp + x] + d[yp + xp];
      out[y0 + x] = clamp(Math.sqrt(gx * gx + gy * gy) / SOBEL_STEP_MAX, 0, 1);
    }
  }
  return fieldFromData('edge', w, h, out, sourceKey);
}

/**
 * Texture: twice the mean absolute residual against a box blur.
 *
 * A 0..1 sample deviates from any local mean by at most 0.5, so a pixel
 * checkerboard reads 1 (up to the box parity: an odd window contains one
 * sample more of one phase, giving 0.96) and a smooth ramp reads 0.
 *
 * @param luma - luminance field (0..1), never mutated
 * @param radius - blur radius in pixels (rounded, minimum 1)
 * @returns same-size texture field
 */
export function textureField(
  luma: AnalysisField,
  radius: number = DEFAULT_TEXTURE_RADIUS,
): AnalysisField {
  const r = Math.max(1, Math.round(radius));
  const sourceKey = textureKey(luma.sourceKey, r);
  const blurred = boxBlur(luma.data, luma.width, luma.height, r);
  const out = new Float32Array(luma.data.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp(2 * Math.abs(luma.data[i] - blurred[i]), 0, 1);
  }
  return fieldFromData('texture', luma.width, luma.height, out, sourceKey);
}

/**
 * Sign changes between successive non-zero first differences of `count`
 * samples read with `step` stride from `start`.
 *
 * Flat runs are skipped rather than counted as "no change": a square wave of
 * period 4 changes sign twice per period even though most of its samples are
 * zero, and that is exactly the periodicity the frequency measure is after.
 */
function crossingCount(d: Float32Array, start: number, step: number, count: number): number {
  let crossings = 0;
  let last = 0;
  for (let k = 0; k + 1 < count; k++) {
    const diff = d[start + (k + 1) * step] - d[start + k * step];
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign === 0) continue;
    if (last !== 0 && sign !== last) crossings++;
    last = sign;
  }
  return crossings;
}

/**
 * Local spatial frequency: the rate of gradient sign changes, normalised so
 * 1 means a sign flip at every sample (the Nyquist checkerboard).
 *
 * Counting runs block by block keeps the cost linear in pixels; the block map
 * is bilinearly upsampled to the source size, so the field stays directly
 * comparable with the other measures. A field with no variation at all
 * (all differences zero) reads 0 - no periodicity is not high frequency.
 *
 * @param luma - luminance field (0..1), never mutated
 * @param window - block edge in pixels (minimum 3)
 * @returns same-size frequency field
 */
export function frequencyField(
  luma: AnalysisField,
  window: number = DEFAULT_FREQUENCY_WINDOW,
): AnalysisField {
  const win = Math.max(3, Math.round(window));
  const { width: w, height: h, data: d } = luma;
  const cols = Math.max(1, Math.ceil(w / win));
  const rows = Math.max(1, Math.ceil(h / win));
  const blocks = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    const y0 = by * win;
    const y1 = Math.min(h, y0 + win);
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * win;
      const x1 = Math.min(w, x0 + win);
      let crossings = 0;
      let slots = 0;
      // Horizontal differences inside the block: one crossing per sign flip.
      const hLen = x1 - x0;
      const hPairs = Math.max(0, hLen - 2);
      if (hPairs > 0) {
        for (let y = y0; y < y1; y++) crossings += crossingCount(d, y * w + x0, 1, hLen);
        slots += hPairs * (y1 - y0);
      }
      const vLen = y1 - y0;
      const vPairs = Math.max(0, vLen - 2);
      if (vPairs > 0) {
        for (let x = x0; x < x1; x++) crossings += crossingCount(d, y0 * w + x, w, vLen);
        slots += vPairs * (x1 - x0);
      }
      blocks[by * cols + bx] = slots > 0 ? crossings / slots : 0;
    }
  }
  const sourceKey = frequencyKey(luma.sourceKey, win);
  const blockField = fieldFromData('frequency', cols, rows, blocks, sourceKey);
  return resampleField(blockField, w, h);
}

export interface StructureTensor {
  /** Local orientation coherence in [0,1]; 0 = isotropic, 1 = one direction. */
  coherence: AnalysisField;
  /** Direction of fastest brightness change, radians in [0, pi). */
  orientation: AnalysisField;
}

/**
 * Structure tensor of the luminance gradient.
 *
 * `coherence` normalises the tensor eigenvalue spread, so flat regions and
 * isotropic texture read 0 while lines and edges read close to 1.
 * `orientation` is the half-angle of the tensor (edges run perpendicular to
 * it); it is a directional quantity, so regions combine it with a
 * coherence-weighted circular mean rather than a plain average.
 *
 * @param luma - luminance field (0..1), never mutated
 * @param radius - tensor integration radius (rounded, minimum 1)
 * @returns coherence and orientation fields
 */
export function structureTensor(
  luma: AnalysisField,
  radius: number = DEFAULT_STRUCTURE_RADIUS,
): StructureTensor {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h, data: d } = luma;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w;
    const yp = Math.min(h - 1, y + 1) * w;
    const y0 = y * w;
    const dy = y === 0 || y === h - 1 ? 0 : 0.5;
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      const dx = x === 0 || x === w - 1 ? 0 : 0.5;
      gx[y0 + x] = dx * (d[y0 + xp] - d[y0 + xm]);
      gy[y0 + x] = dy * (d[yp + x] - d[ym + x]);
    }
  }
  const gxx = squarePlane(gx);
  const gyy = squarePlane(gy);
  const gxy = new Float32Array(w * h);
  for (let i = 0; i < gxy.length; i++) gxy[i] = gx[i] * gy[i];
  const jxx = boxBlur(gxx, w, h, r);
  const jyy = boxBlur(gyy, w, h, r);
  const jxy = boxBlur(gxy, w, h, r);
  const coherence = new Float32Array(w * h);
  const orientation = new Float32Array(w * h);
  for (let i = 0; i < coherence.length; i++) {
    const trace = jxx[i] + jyy[i];
    const spread = Math.sqrt((jxx[i] - jyy[i]) * (jxx[i] - jyy[i]) + 4 * jxy[i] * jxy[i]);
    coherence[i] = trace > 1e-12 ? clamp(spread / trace, 0, 1) : 0;
    let theta = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]);
    if (theta < 0) theta += Math.PI;
    orientation[i] = theta;
  }
  const key = structureKeys(luma.sourceKey, r);
  return {
    coherence: fieldFromData('coherence', w, h, coherence, key.coherence),
    orientation: fieldFromData('orientation', w, h, orientation, key.orientation),
  };
}
