/**
 * Raster primitives: construction, pixel access, cropping, sampling and
 * luminance extraction. A `Raster` is always RGBA, row-major, 4 bytes/pixel.
 */

import { NO_COLOR, type Raster } from '../types';
import { clamp } from '../util';
import { luminance, type LuminanceStandard, red, green, blue, rgb } from '../color';

export const MAX_PIXELS = 64 * 1024 * 1024; // decompression-bomb guard (64 MP)

export function createRaster(width: number, height: number, fill?: number): Raster {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w * h > MAX_PIXELS) {
    throw new RangeError(`Raster too large: ${w}x${h} exceeds ${MAX_PIXELS} pixels`);
  }
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill !== undefined) {
    const r = red(fill);
    const g = green(fill);
    const b = blue(fill);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  } else {
    // Opaque black by default: ASCII conversion treats missing alpha as black.
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
  }
  return { width: w, height: h, data };
}

export function cloneRaster(src: Raster): Raster {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

export function getPixel(src: Raster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
  const i = (y * src.width + x) * 4;
  return rgb(src.data[i], src.data[i + 1], src.data[i + 2]);
}

export function setPixel(dst: Raster, x: number, y: number, color: number, alpha = 255): void {
  if (x < 0 || y < 0 || x >= dst.width || y >= dst.height) return;
  const i = (y * dst.width + x) * 4;
  dst.data[i] = red(color);
  dst.data[i + 1] = green(color);
  dst.data[i + 2] = blue(color);
  dst.data[i + 3] = alpha;
}

/**
 * Extract a sub-rectangle (clipped to bounds). Coordinates are in pixels.
 * Returns the input unchanged when the rect already matches.
 */
export function cropRaster(src: Raster, x: number, y: number, w: number, h: number): Raster {
  const x0 = clamp(Math.round(x), 0, src.width);
  const y0 = clamp(Math.round(y), 0, src.height);
  const x1 = clamp(x0 + Math.round(w), x0, src.width);
  const y1 = clamp(y0 + Math.round(h), y0, src.height);
  const width = x1 - x0;
  const height = y1 - y0;
  if (x0 === 0 && y0 === 0 && width === src.width && height === src.height) return src;
  const out = createRaster(width, height);
  for (let row = 0; row < height; row++) {
    const si = ((y0 + row) * src.width + x0) * 4;
    const di = row * width * 4;
    out.data.set(src.data.subarray(si, si + width * 4), di);
  }
  return out;
}

/** Bilinear sample at continuous coordinates; outside samples clamp to edge. */
export function sampleBilinear(src: Raster, x: number, y: number): [number, number, number, number] {
  const maxX = src.width - 1;
  const maxY = src.height - 1;
  const cx = clamp(x, 0, maxX);
  const cy = clamp(y, 0, maxY);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, maxX);
  const y1 = Math.min(y0 + 1, maxY);
  const fx = cx - x0;
  const fy = cy - y0;
  const i00 = (y0 * src.width + x0) * 4;
  const i10 = (y0 * src.width + x1) * 4;
  const i01 = (y1 * src.width + x0) * 4;
  const i11 = (y1 * src.width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = src.data[i00 + c] * (1 - fx) + src.data[i10 + c] * fx;
    const bottom = src.data[i01 + c] * (1 - fx) + src.data[i11 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/**
 * Composite-source over white: ASCII conversion reads brightness, so fully
 * transparent pixels must read as bright (paper) rather than black.
 * Alpha is preserved in the returned raster so later stages can still see it.
 */
export function flattenOverWhite(src: Raster): Raster {
  let hasAlpha = false;
  for (let i = 3; i < src.data.length; i += 4) {
    if (src.data[i] !== 255) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha) return src;
  const out = cloneRaster(src);
  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3] / 255;
    if (a === 1) continue;
    out.data[i] = Math.round(out.data[i] * a + 255 * (1 - a));
    out.data[i + 1] = Math.round(out.data[i + 1] * a + 255 * (1 - a));
    out.data[i + 2] = Math.round(out.data[i + 2] * a + 255 * (1 - a));
    out.data[i + 3] = 255;
  }
  return out;
}

/** Per-pixel luminance plane in 0..1 (0 = black, 1 = white). */
export function lumaPlane(src: Raster, standard: LuminanceStandard = 'rec709'): Float32Array {
  const n = src.width * src.height;
  const plane = new Float32Array(n);
  const d = src.data;
  if (standard === 'rec709' || standard === 'rec601' || standard === 'luma') {
    const weights =
      standard === 'rec709' ? [0.2126, 0.7152, 0.0722] : [0.299, 0.587, 0.114];
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      plane[p] =
        (weights[0] * d[i] + weights[1] * d[i + 1] + weights[2] * d[i + 2]) / 255;
    }
  } else if (standard === 'average') {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      plane[p] = (d[i] + d[i + 1] + d[i + 2]) / 765;
    }
  } else {
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      plane[p] = luminance(rgb(d[i], d[i + 1], d[i + 2]), 'srgb-linear');
    }
  }
  return plane;
}

/** Extract the per-cell color (0xRRGGBB) for every pixel position. */
export function colorPlane(src: Raster): Int32Array {
  const n = src.width * src.height;
  const plane = new Int32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    plane[p] = (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2];
  }
  return plane;
}

/** Downsample a color plane to target dimensions by box averaging. */
export function downsampleColors(
  plane: Int32Array,
  width: number,
  height: number,
  targetW: number,
  targetH: number,
): Int32Array {
  const out = new Int32Array(targetW * targetH).fill(NO_COLOR);
  const sx = width / targetW;
  const sy = height / targetH;
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const c = plane[y * width + x];
          r += (c >> 16) & 0xff;
          g += (c >> 8) & 0xff;
          b += c & 0xff;
          count++;
        }
      }
      if (count > 0) out[ty * targetW + tx] = rgb(r / count, g / count, b / count);
    }
  }
  return out;
}
