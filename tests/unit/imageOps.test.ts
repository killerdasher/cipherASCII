import { describe, expect, it } from 'vitest';
import {
  MAX_PIXELS,
  cloneRaster,
  createRaster,
  flattenOverWhite,
  getPixel,
  lumaPlane,
  setPixel,
} from '../../src/core/image/raster';
import { resizeArea, resizeBicubic, resizeBilinear, resizeLanczos, resizeNearest, resizeRaster } from '../../src/core/image/resize';
import {
  DEFAULT_PREPROCESS,
  type PreprocessSettings,
} from '../../src/core/types';
import { applyPreprocess, CancelledError, gaussianBlur, unsharpMask } from '../../src/core/image/preprocess';

function preprocess(patch: Partial<PreprocessSettings> = {}): PreprocessSettings {
  return { ...DEFAULT_PREPROCESS, ...patch };
}

describe('raster', () => {
  it('creates opaque rasters and fills colours', () => {
    const black = createRaster(4, 3);
    expect(black.width).toBe(4);
    expect(black.height).toBe(3);
    expect(black.data.length).toBe(4 * 3 * 4);
    expect(black.data[3]).toBe(255);

    const red = createRaster(2, 2, 0xff0000);
    expect(getPixel(red, 1, 1)).toBe(0xff0000);
  });

  it('refuses rasters beyond the decompression-bomb limit', () => {
    expect(() => createRaster(MAX_PIXELS + 1, 1)).toThrow(RangeError);
  });

  it('clones without aliasing', () => {
    const a = createRaster(2, 2, 0x123456);
    const b = cloneRaster(a);
    setPixel(b, 0, 0, 0x654321);
    expect(getPixel(a, 0, 0)).toBe(0x123456);
    expect(getPixel(b, 0, 0)).toBe(0x654321);
  });

  it('lumaPlane reads rec709 luminance in 0..1', () => {
    const white = lumaPlane(createRaster(2, 2, 0xffffff));
    const black = lumaPlane(createRaster(2, 2, 0x000000));
    const grey = lumaPlane(createRaster(2, 2, 0x808080));

    expect([...white].every((v) => v === 1)).toBe(true);
    expect([...black].every((v) => v === 0)).toBe(true);
    expect(Math.abs(grey[0] - 128 / 255)).toBeLessThan(1e-3);
  });

  it('flattenOverWhite composites transparency onto white', () => {
    const src = createRaster(1, 2);
    setPixel(src, 0, 0, 0x808080, 0);
    setPixel(src, 0, 1, 0x808080, 255);

    const flat = flattenOverWhite(src);
    expect(getPixel(flat, 0, 0)).toBe(0xffffff);
    expect(getPixel(flat, 0, 1)).toBe(0x808080);
  });
});

describe('resize', () => {
  function checker(size: number) {
    const r = createRaster(size, size, 0x000000);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if ((x + y) % 2 === 1) setPixel(r, x, y, 0xffffff);
      }
    }
    return r;
  }

  it('area-downsampling a checkerboard converges toward mid grey', () => {
    const small = resizeArea(checker(8), 2, 2);
    expect(small.width).toBe(2);
    expect(small.height).toBe(2);
    const luma = lumaPlane(small);
    for (const v of luma) {
      expect(v).toBeGreaterThan(0.4);
      expect(v).toBeLessThan(0.6);
    }
  });

  it('nearest keeps exact source colours when upscaling', () => {
    const src = createRaster(2, 1);
    setPixel(src, 0, 0, 0xff0000);
    setPixel(src, 1, 0, 0x0000ff);
    const up = resizeNearest(src, 4, 2);
    expect(up.width).toBe(4);
    expect(getPixel(up, 0, 0)).toBe(0xff0000);
    expect(getPixel(up, 3, 0)).toBe(0x0000ff);
  });

  it('bilinear and bicubic preserve dimensions and stay in range', () => {
    const src = checker(6);
    for (const fn of [resizeBilinear, resizeBicubic]) {
      const out = fn(src, 5, 3);
      expect(out.width).toBe(5);
      expect(out.height).toBe(3);
      expect(out.data.length).toBe(5 * 3 * 4);
      for (const value of out.data) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
      }
    }
  });

  it('lanczos keeps dimensions, range and flat fields exactly', () => {
    const out = resizeLanczos(checker(6), 5, 3);
    expect(out.width).toBe(5);
    expect(out.height).toBe(3);
    expect(out.data.length).toBe(5 * 3 * 4);
    for (const value of out.data) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }

    // A DC field must survive normalisation without drift: every weight sum
    // is normalised to 1, so a constant in is a constant out (alpha stays
    // fully opaque).
    const flat = createRaster(6, 6, 0x808080);
    const flatOut = resizeLanczos(flat, 3, 3);
    for (let i = 0; i < flatOut.data.length; i++) {
      expect(flatOut.data[i]).toBe(i % 4 === 3 ? 255 : 128);
    }
  });

  it('lanczos blends across a hard edge instead of copying pixels', () => {
    const step = createRaster(8, 1, 0x000000);
    for (let x = 4; x < 8; x++) setPixel(step, x, 0, 0xffffff);
    const out = resizeLanczos(step, 4, 1);
    const values = [0, 4, 8, 12].map((i) => out.data[i]);
    // Somewhere in the transition the filter must produce intermediate grey.
    expect(values.some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('resizeRaster dispatches by filter name', () => {
    const src = checker(4);
    expect(resizeRaster(src, 3, 3, 'nearest').width).toBe(3);
    expect(resizeRaster(src, 3, 3, 'area').width).toBe(3);
    expect(resizeRaster(src, 3, 3, 'bilinear').width).toBe(3);
    expect(resizeRaster(src, 3, 3, 'bicubic').width).toBe(3);
    expect(resizeRaster(src, 3, 3, 'lanczos').width).toBe(3);
  });
});

describe('preprocess', () => {
  it('is a no-op for neutral settings', () => {
    const src = createRaster(3, 3, 0x4080c0);
    const out = applyPreprocess(src, preprocess());
    expect(out.width).toBe(3);
    expect([...out.data]).toEqual([...src.data]);
  });

  it('invert flips channels', () => {
    const src = createRaster(1, 1, 0x000000);
    const out = applyPreprocess(src, preprocess({ invert: true }));
    expect(getPixel(out, 0, 0)).toBe(0xffffff);
  });

  it('grayscale collapses channels to luminance', () => {
    const src = createRaster(1, 1, 0xff0000);
    const out = applyPreprocess(src, preprocess({ grayscale: true }));
    const i = 0;
    expect(out.data[i]).toBe(out.data[i + 1]);
    expect(out.data[i + 1]).toBe(out.data[i + 2]);
    expect(out.data[i]).toBeGreaterThan(0);
    expect(out.data[i]).toBeLessThan(255);
  });

  it('threshold produces a hard cut', () => {
    const src = createRaster(2, 1);
    setPixel(src, 0, 0, 0x202020);
    setPixel(src, 1, 0, 0xe0e0e0);
    const out = applyPreprocess(src, preprocess({ threshold: 0.5 }));
    expect(getPixel(out, 0, 0)).toBe(0x000000);
    expect(getPixel(out, 1, 0)).toBe(0xffffff);
  });

  it('gaussianBlur leaves uniform images untouched and softens edges', () => {
    const flat = createRaster(5, 5, 0x306090);
    const blurredFlat = gaussianBlur(flat, 2);
    expect([...blurredFlat.data]).toEqual([...flat.data]);

    const edge = createRaster(5, 5, 0x000000);
    for (let y = 0; y < 5; y++) {
      for (let x = 3; x < 5; x++) setPixel(edge, x, y, 0xffffff);
    }
    const blurred = gaussianBlur(edge, 1.5);
    const before = getPixel(edge, 2, 2);
    const after = getPixel(blurred, 2, 2);
    expect(before).not.toBe(after);
    expect(after).not.toBe(0x000000);
    expect(after).not.toBe(0xffffff);
  });

  it('unsharpMask increases edge contrast', () => {
    const edge = createRaster(7, 7, 0x404040);
    for (let y = 0; y < 7; y++) {
      for (let x = 4; x < 7; x++) setPixel(edge, x, y, 0xc0c0c0);
    }
    const sharp = unsharpMask(edge, 1);
    expect(getPixel(sharp, 3, 3)).toBeLessThan(getPixel(edge, 3, 3));
    expect(getPixel(sharp, 4, 3)).toBeGreaterThan(getPixel(edge, 4, 3));
  });

  it('throws CancelledError when the cancel flag trips', () => {
    const src = createRaster(4, 4, 0x101010);
    expect(() => applyPreprocess(src, preprocess({ brightness: 0.5 }), () => true)).toThrow(
      CancelledError,
    );
  });
});
