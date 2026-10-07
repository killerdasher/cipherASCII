/**
 * Spectral-residual saliency (Hou & Zhang, 2004).
 *
 * The algorithm whitens the luminance spectrum: the log magnitude spectrum is
 * dominated by a smooth component that carries no "interestingness", so
 * subtracting a blurred copy of it leaves a residual that, transformed back
 * with the original phase, highlights the structures the image spends fewer
 * bits than expected on. The result is normalised so the peak reads 1 and
 * resampled to the source size.
 *
 * Everything runs on power-of-two scratch grids (default 128), so a
 * multi-megapixel photo costs a fixed number of FFT bins, and the whole
 * pipeline is deterministic: same pixels in, same samples out.
 *
 * Featureless input (less than one 8-bit code value of range) has no phase
 * structure to sharpen - it reads all zeros instead of a corner artefact.
 *
 * Pure module: no DOM, input fields are never mutated.
 */

import { boxBlur } from '../mapping';
import { fieldCacheKey, fieldFromData, resampleField, type AnalysisField } from './field';

/** Scratch edge length of the frequency transform. */
export const DEFAULT_SALIENCY_SIZE = 128;

/** Smallest image range (in 0..1 units) that still carries structure. */
const MIN_STRUCTURE_RANGE = 1 / 255;

/** Differences below this are numerical noise in the log spectrum. */
const SPECTRUM_EPS = 1e-12;

/** In-place iterative radix-2 FFT; `n` must be a power of two. */
function fft(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let base = 0; base < n; base += len) {
      let curR = 1;
      let curI = 0;
      for (let j = 0; j < half; j++) {
        const a = base + j;
        const b = a + half;
        const vr = re[b] * curR - im[b] * curI;
        const vi = re[b] * curI + im[b] * curR;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nextR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nextR;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Separable in-place 2D FFT on a `width * height` grid (both powers of two). */
function fft2(re: Float64Array, im: Float64Array, width: number, height: number, inverse: boolean): void {
  const lineR = new Float64Array(Math.max(width, height));
  const lineI = new Float64Array(Math.max(width, height));
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      lineR[x] = re[row + x];
      lineI[x] = im[row + x];
    }
    fft(lineR, lineI, width, inverse);
    for (let x = 0; x < width; x++) {
      re[row + x] = lineR[x];
      im[row + x] = lineI[x];
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      lineR[y] = re[y * width + x];
      lineI[y] = im[y * width + x];
    }
    fft(lineR, lineI, height, inverse);
    for (let y = 0; y < height; y++) {
      re[y * width + x] = lineR[y];
      im[y * width + x] = lineI[y];
    }
  }
}

/** Largest power of two that fits `target`, clamped to [32, 256]. */
function scratchSize(target: number): number {
  let size = 32;
  while (size < 256 && size * 2 <= Math.max(32, Math.round(target))) size *= 2;
  return size;
}

/**
 * Cache key of a saliency field for `from` at scratch size `size`.
 *
 * Sizes that round to the same power of two share a key, so `size: 100` and
 * `size: 128` both resolve to the one 128-grid result.
 *
 * @param from - source key of the luminance field
 * @param size - requested scratch edge (rounded like {@link saliencyField})
 */
export function saliencyKey(from: string, size: number): string {
  return fieldCacheKey('saliency', { from, size: scratchSize(size) });
}

/**
 * Spectral-residual saliency of a luminance field.
 *
 * @param luma - luminance field (0..1), never mutated
 * @param size - scratch grid edge; rounded to a power of two in [32, 256]
 * @returns same-size saliency field normalised so the peak reads 1 (all
 *   zeros when the image has no measurable range)
 */
export function saliencyField(luma: AnalysisField, size: number = DEFAULT_SALIENCY_SIZE): AnalysisField {
  const s = scratchSize(size);
  const sourceKey = saliencyKey(luma.sourceKey, s);
  if (luma.max - luma.min <= MIN_STRUCTURE_RANGE) {
    return fieldFromData('saliency', luma.width, luma.height, new Float32Array(luma.width * luma.height), sourceKey);
  }

  const small = resampleField(luma, s, s);
  const re = Float64Array.from(small.data);
  const im = new Float64Array(s * s);
  fft2(re, im, s, s, false);

  // Log magnitude spectrum and its smoothed baseline: the difference is the
  // residual, everything shared with the baseline is the image's "average
  // signature" and carries no surprise.
  const logA = new Float32Array(s * s);
  const magnitude = new Float64Array(s * s);
  for (let i = 0; i < logA.length; i++) {
    const a = Math.hypot(re[i], im[i]);
    magnitude[i] = a;
    logA[i] = Math.log(a + SPECTRUM_EPS);
  }
  const smoothed = boxBlur(logA, s, s, Math.max(1, Math.floor(s / 16)));

  // Rebuild the spectrum from exp(residual) with the original phase, then
  // transform back: whitened structures land where they are in the image.
  for (let i = 0; i < re.length; i++) {
    const residual = Math.exp(logA[i] - smoothed[i]);
    const a = magnitude[i];
    const phaseR = a > 0 ? re[i] / a : 0;
    const phaseI = a > 0 ? im[i] / a : 0;
    re[i] = residual * phaseR;
    im[i] = residual * phaseI;
  }
  fft2(re, im, s, s, true);

  const saliency = new Float32Array(s * s);
  for (let i = 0; i < saliency.length; i++) {
    saliency[i] = re[i] * re[i] + im[i] * im[i];
  }
  // Two box passes approximate the Gaussian the reference implementation uses.
  const blurred = boxBlur(boxBlur(saliency, s, s, 2), s, s, 2);
  let peak = 0;
  for (let i = 0; i < blurred.length; i++) if (blurred[i] > peak) peak = blurred[i];
  if (!(peak > SPECTRUM_EPS)) {
    return fieldFromData('saliency', luma.width, luma.height, new Float32Array(luma.width * luma.height), sourceKey);
  }
  for (let i = 0; i < blurred.length; i++) blurred[i] /= peak;

  const normalized = fieldFromData('saliency', s, s, blurred, sourceKey);
  return resampleField(normalized, luma.width, luma.height);
}
