/**
 * Pins the optimised blur primitives to naive reference implementations.
 *
 * `gaussianRGBA` (shared by blur, bloom, sharpen, motionBlur and
 * epsilonGlow) was rewritten to gather tap positions once per pixel and
 * accumulate all three channels in a single tap loop. The reference below is
 * the naive per-channel form - same kernel, same tap order, same clamping.
 *
 * It also pins `boxBlurCopy` (diffractionStars, epsilonGlow), whose write
 * steps were transposed relative to its read steps. Both references encode
 * the *correct* addressing: the pre-optimisation gaussian wrote its vertical
 * pass to `y * 4 + x * w * 4` (a transpose) and the box pass wrote to the
 * wrong axis entirely, so matching the old output byte for byte would mean
 * re-pinning the bugs.
 */

import { describe, expect, it } from 'vitest';
import { boxBlurCopy, gaussianRGBA } from '../../src/core/effects/imageEffects';

function kernelOf(sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v | 0;

/** Naive separable blur: one clamp per channel per tap, correct addressing. */
function referenceGaussian(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  sigma: number,
): Uint8ClampedArray {
  const kernel = kernelOf(sigma);
  const radius = (kernel.length - 1) / 2;
  const tmp = new Float32Array(w * h * 4);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -radius; i <= radius; i++) {
          const sx = clamp(x + i, 0, w - 1);
          acc += src[row + sx * 4 + c] * kernel[i + radius];
        }
        tmp[o + c] = acc;
      }
      tmp[o + 3] = src[o + 3];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -radius; i <= radius; i++) {
          const sy = clamp(y + i, 0, h - 1);
          acc += tmp[(sy * w + x) * 4 + c] * kernel[i + radius];
        }
        out[o + c] = acc;
      }
      out[o + 3] = tmp[o + 3];
    }
  }

  return out;
}

/** Naive sliding-window box blur over both axes, `passes` iterations. */
function referenceBox(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  passes = 3,
): Uint8ClampedArray {
  const win = radius * 2 + 1;
  let cur = Uint8ClampedArray.from(src);
  for (let pass = 0; pass < passes; pass++) {
    // Each axis rounds to integers, exactly as boxPass writes into u8 buffers.
    const tmp = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let i = -radius; i <= radius; i++) acc += cur[(y * w + clamp(x + i, 0, w - 1)) * 4 + c];
          tmp[o + c] = acc / win;
        }
        tmp[o + 3] = cur[o + 3];
      }
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let i = -radius; i <= radius; i++) acc += tmp[(clamp(y + i, 0, h - 1) * w + x) * 4 + c];
          out[o + c] = acc / win;
        }
        out[o + 3] = tmp[o + 3];
      }
    }
    cur = out;
  }
  return cur;
}

/** Deterministic RGBA pattern: gradients, steps and a punched-out corner. */
function makePattern(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 17 + y * 3) & 0xff;
      data[i + 1] = (x * y * 7) & 0xff;
      data[i + 2] = ((x ^ y) * 13) & 0xff;
      data[i + 3] = x === 0 || y === h - 1 ? 0 : 255;
    }
  }
  return data;
}

describe('gaussianRGBA optimisation equivalence', () => {
  const sizes: Array<[number, number]> = [
    [17, 13], // narrower than a wide kernel: every column hits the clamp
    [64, 48],
    [1, 1], // degenerate single pixel
  ];
  const sigmas = [0.8, 2, 5, 12];

  for (const [w, h] of sizes) {
    for (const sigma of sigmas) {
      it(`matches the naive reference at ${w}x${h}, sigma ${sigma}`, () => {
        const src = makePattern(w, h);
        expect(gaussianRGBA(src, w, h, sigma)).toEqual(referenceGaussian(src, w, h, sigma));
      });
    }
  }

  it('preserves alpha and leaves the input untouched', () => {
    const src = makePattern(32, 32);
    const before = Uint8ClampedArray.from(src);
    const out = gaussianRGBA(src, 32, 32, 3);
    expect(src).toEqual(before);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(src[i]);
  });

  it('blurs across the image instead of transposing it', () => {
    // Horizontal ramp: a correct blur keeps the ramp along x and flattens y.
    const w = 8;
    const h = 4;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        src[i] = x * 30;
        src[i + 1] = y * 60;
        src[i + 2] = 10;
        src[i + 3] = 255;
      }
    }
    const out = gaussianRGBA(src, w, h, 1.5);
    const at = (x: number, y: number) => out[(y * w + x) * 4];
    // Row 0 must still rise across x (the old transpose wrote it flat).
    expect(at(0, 0)).toBeLessThan(at(w - 1, 0));
    // Column 0 must still be flat across y (the old transpose ramped it).
    expect(at(0, 0)).toBe(at(0, h - 1));
  });
});

describe('boxBlurCopy equivalence', () => {
  for (const [w, h] of [[17, 13], [64, 48]] as Array<[number, number]>) {
    for (const radius of [1, 3, 8]) {
      it(`matches the naive reference at ${w}x${h}, radius ${radius}`, () => {
        const src = makePattern(w, h);
        expect(boxBlurCopy(src, w, h, radius)).toEqual(referenceBox(src, w, h, radius));
      });
    }
  }
});
