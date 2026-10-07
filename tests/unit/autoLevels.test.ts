import { describe, it, expect } from 'vitest';
import { computeAutoLevels } from '../../src/core/image/autoLevels';
import { applyPreprocess } from '../../src/core/image/preprocess';
import { lumaPlane } from '../../src/core/image/raster';
import { DEFAULT_PREPROCESS, type Raster } from '../../src/core/types';

function grayRaster(pixels: number[], width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, pixels[i])) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function quantile(luma: Float32Array, q: number): number {
  const sorted = Float32Array.from(luma);
  sorted.sort();
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

describe('computeAutoLevels', () => {
  it('stretches a flat 0.4..0.6 source onto the full range', () => {
    const n = 4096;
    const pixels = Array.from({ length: n }, (_, i) => 0.4 + (0.2 * i) / (n - 1));
    const raster = grayRaster(pixels, 64, 64);
    const luma = lumaPlane(raster, 'rec709');

    const levels = computeAutoLevels(luma);
    expect(levels.fitted).toBe(true);
    expect(levels.p2).toBeCloseTo(0.404, 2); // 2% into the ramp
    expect(levels.p98).toBeCloseTo(0.596, 2);
    expect(levels.stretch).toBeGreaterThan(4.5);

    // End to end: after the patch the percentiles span the full range.
    const processed = applyPreprocess(raster, { ...DEFAULT_PREPROCESS, ...levels.patch });
    const after = lumaPlane(processed, 'rec709');
    expect(quantile(after, 0.02)).toBeLessThan(0.03);
    expect(quantile(after, 0.98)).toBeGreaterThan(0.97);
  });

  it('is near-neutral for an image that already uses the full range', () => {
    const n = 2048;
    const pixels = Array.from({ length: n }, (_, i) => i / (n - 1));
    const raster = grayRaster(pixels, 64, 32);
    const levels = computeAutoLevels(lumaPlane(raster, 'rec709'));
    expect(levels.fitted).toBe(true);
    expect(Math.abs(levels.patch.contrast)).toBeLessThan(0.12);
    expect(Math.abs(levels.patch.brightness)).toBeLessThan(0.05);
    expect(levels.patch.exposure).toBe(0);
    expect(levels.patch.gamma).toBe(1);
  });

  it('returns a neutral patch for a flat image instead of amplifying noise', () => {
    const flat = lumaPlane(grayRaster(new Array(1024).fill(0.5), 32, 32), 'rec709');
    const levels = computeAutoLevels(flat);
    expect(levels.fitted).toBe(false);
    expect(levels.patch).toEqual({ exposure: 0, brightness: 0, contrast: 0, gamma: 1 });
    expect(levels.stretch).toBe(1);

    const empty = computeAutoLevels(new Float32Array(0));
    expect(empty.fitted).toBe(false);
  });

  it('keeps every control inside the documented PreprocessSettings ranges', () => {
    // Heavily skewed histogram: a dark mass with bright highlights.
    const pixels = [
      ...new Array(900).fill(0.15),
      ...Array.from({ length: 100 }, (_, i) => 0.15 + (0.85 * i) / 99),
    ];
    const levels = computeAutoLevels(lumaPlane(grayRaster(pixels, 40, 25), 'rec709'));
    expect(levels.fitted).toBe(true);
    expect(levels.patch.contrast).toBeGreaterThanOrEqual(-1);
    expect(levels.patch.contrast).toBeLessThanOrEqual(1);
    expect(levels.patch.brightness).toBeGreaterThanOrEqual(-1);
    expect(levels.patch.brightness).toBeLessThanOrEqual(1);
    expect(levels.patch.exposure).toBe(0);
    expect(levels.patch.gamma).toBe(1);
  });

  it('honours custom quantiles', () => {
    const pixels = Array.from({ length: 1000 }, (_, i) => i / 999);
    const luma = lumaPlane(grayRaster(pixels, 50, 20), 'rec709');
    const strict = computeAutoLevels(luma, 0.1, 0.9);
    const loose = computeAutoLevels(luma, 0.001, 0.999);
    expect(strict.p2).toBeGreaterThan(loose.p2);
    expect(strict.p98).toBeLessThan(loose.p98);
    expect(strict.stretch).toBeGreaterThan(loose.stretch);
  });
});
