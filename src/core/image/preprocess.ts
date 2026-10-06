/**
 * Image preprocessing: spatial operations (blur / sharpen) followed by
 * point operations (exposure, brightness, contrast, saturation, gamma,
 * posterize, threshold, invert).
 *
 * Order is fixed and documented because it is observable: spatial operators
 * run first so sharpening acts on the captured detail, then tone operators
 * shape the histogram that the mapping stage will read.
 */

import type { PreprocessSettings, Raster } from '../types';
import { clamp } from '../util';
import { cloneRaster, createRaster, flattenOverWhite } from './raster';

export type ShouldCancel = () => boolean;

export class CancelledError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'CancelledError';
  }
}

function checkCancel(shouldCancel?: ShouldCancel): void {
  if (shouldCancel && shouldCancel()) throw new CancelledError();
}

// ---------------------------------------------------------------------------
// Spatial operations
// ---------------------------------------------------------------------------

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / s2);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

/** Separable Gaussian blur; `sigma` in pixels. */
export function gaussianBlur(src: Raster, sigma: number, shouldCancel?: ShouldCancel): Raster {
  if (sigma <= 0.01) return src;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const { width, height } = src;
  const tmp = createRaster(width, height);
  const out = createRaster(width, height);
  checkCancel(shouldCancel);

  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clamp(x + k, 0, width - 1);
        const i = (y * width + sx) * 4;
        const w = kernel[k + radius];
        r += src.data[i] * w;
        g += src.data[i + 1] * w;
        b += src.data[i + 2] * w;
        a += src.data[i + 3] * w;
      }
      const di = (y * width + x) * 4;
      tmp.data[di] = r;
      tmp.data[di + 1] = g;
      tmp.data[di + 2] = b;
      tmp.data[di + 3] = a;
    }
  }
  checkCancel(shouldCancel);

  // Vertical pass.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clamp(y + k, 0, height - 1);
        const i = (sy * width + x) * 4;
        const w = kernel[k + radius];
        r += tmp.data[i] * w;
        g += tmp.data[i + 1] * w;
        b += tmp.data[i + 2] * w;
        a += tmp.data[i + 3] * w;
      }
      const di = (y * width + x) * 4;
      out.data[di] = r;
      out.data[di + 1] = g;
      out.data[di + 2] = b;
      out.data[di + 3] = a;
    }
  }
  return out;
}

/**
 * Unsharp mask: `amount` in 0..1 blends an amplified high-frequency layer
 * back into the image. Also used with a negative-equivalent path for
 * `edgeEnhance` by blurring the difference instead of the original.
 */
export function unsharpMask(
  src: Raster,
  amount: number,
  shouldCancel?: ShouldCancel,
): Raster {
  if (amount <= 0.001) return src;
  const sigma = 1.2;
  const blurred = gaussianBlur(src, sigma, shouldCancel);
  const out = cloneRaster(src);
  const strength = amount * 1.5;
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = src.data[i + c] - blurred.data[i + c];
      out.data[i + c] = clamp(src.data[i + c] + diff * strength, 0, 255);
    }
  }
  return out;
}

/** Sobel edge magnitude added back to the image (edge enhancement). */
export function edgeEnhance(src: Raster, amount: number, shouldCancel?: ShouldCancel): Raster {
  if (amount <= 0.001) return src;
  const { width, height } = src;
  const out = cloneRaster(src);
  const luma = new Float32Array(width * height);
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = (src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114) / 255;
  }
  checkCancel(shouldCancel);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx =
        -luma[i - width - 1] - 2 * luma[i - 1] - luma[i + width - 1] +
        luma[i - width + 1] + 2 * luma[i + 1] + luma[i + width + 1];
      const gy =
        -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1] +
        luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1];
      const mag = clamp(Math.sqrt(gx * gx + gy * gy) * amount * 2, 0, 1);
      const di = i * 4;
      const l = mag * 255;
      out.data[di] = clamp(out.data[di] + l, 0, 255);
      out.data[di + 1] = clamp(out.data[di + 1] + l, 0, 255);
      out.data[di + 2] = clamp(out.data[di + 2] + l, 0, 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Point operations
// ---------------------------------------------------------------------------

export function applyPreprocess(
  input: Raster,
  settings: PreprocessSettings,
  shouldCancel?: ShouldCancel,
): Raster {
  let src = flattenOverWhite(input);
  checkCancel(shouldCancel);

  if (settings.blur > 0.01) src = gaussianBlur(src, settings.blur, shouldCancel);
  if (settings.sharpness > 0.001) src = unsharpMask(src, settings.sharpness, shouldCancel);
  if (settings.edgeEnhance > 0.001) src = edgeEnhance(src, settings.edgeEnhance, shouldCancel);
  checkCancel(shouldCancel);

  if (
    settings.exposure === 0 &&
    settings.brightness === 0 &&
    settings.contrast === 0 &&
    settings.saturation === 0 &&
    settings.gamma === 1 &&
    settings.posterize === 0 &&
    settings.threshold < 0 &&
    !settings.invert &&
    !settings.grayscale
  ) {
    return src;
  }

  const out = cloneRaster(src);
  const d = out.data;
  // Exposure as a multiplicative gain in stops-like fashion: 2^(exposure*2).
  const gain = Math.pow(2, settings.exposure * 2);
  const brightnessOffset = settings.brightness * 255;
  // Contrast factor: 0 -> neutral mapping around mid grey.
  const contrastFactor = Math.tan(((settings.contrast + 1) * Math.PI) / 4);
  const gamma = clamp(settings.gamma, 0.01, 10);
  const invGamma = 1 / gamma;
  const posterizeLevels = settings.posterize >= 2 ? Math.floor(settings.posterize) : 0;
  const thresholdCut = settings.threshold >= 0 ? settings.threshold * 255 : -1;
  const saturation = clamp(1 + settings.saturation, 0, 4);

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * gain;
    let g = d[i + 1] * gain;
    let b = d[i + 2] * gain;

    // Brightness (offset) and contrast (around 128).
    r = (r + brightnessOffset - 128) * contrastFactor + 128;
    g = (g + brightnessOffset - 128) * contrastFactor + 128;
    b = (b + brightnessOffset - 128) * contrastFactor + 128;

    // Saturation via luma interpolation.
    if (saturation !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
    }

    r = clamp(r, 0, 255);
    g = clamp(g, 0, 255);
    b = clamp(b, 0, 255);

    // Gamma (applied on normalized values).
    if (gamma !== 1) {
      r = Math.pow(r / 255, invGamma) * 255;
      g = Math.pow(g / 255, invGamma) * 255;
      b = Math.pow(b / 255, invGamma) * 255;
    }

    if (settings.grayscale) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = l;
    }

    if (posterizeLevels > 0) {
      const step = 255 / (posterizeLevels - 1);
      r = Math.round(r / step) * step;
      g = Math.round(g / step) * step;
      b = Math.round(b / step) * step;
    }

    if (thresholdCut >= 0) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = l >= thresholdCut ? 255 : 0;
      r = g = b = v;
    }

    if (settings.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    d[i] = clamp(Math.round(r), 0, 255);
    d[i + 1] = clamp(Math.round(g), 0, 255);
    d[i + 2] = clamp(Math.round(b), 0, 255);
  }

  return out;
}
