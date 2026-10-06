/**
 * Resampling filters for the image pipeline.
 *
 * Downscaling uses proper area averaging (box filter with fractional pixel
 * coverage) so fine detail is averaged instead of aliased; upscaling uses
 * bilinear/bicubic/nearest depending on the selected filter.
 */

import type { Raster, ResizeFilter } from '../types';
import { clamp } from '../util';
import { createRaster, sampleBilinear } from './raster';

/** Separable area-average resize (correct for both up and down scaling). */
export function resizeArea(src: Raster, width: number, height: number): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;
  const out = createRaster(tw, th);
  const scaleX = src.width / tw;
  const scaleY = src.height / th;
  const d = src.data;
  const o = out.data;
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * scaleY;
    const y1 = (ty + 1) * scaleY;
    const yStart = Math.floor(y0);
    const yEnd = Math.min(Math.ceil(y1), src.height);
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * scaleX;
      const x1 = (tx + 1) * scaleX;
      const xStart = Math.floor(x0);
      const xEnd = Math.min(Math.ceil(x1), src.width);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;
      for (let y = yStart; y < yEnd; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = xStart; x < xEnd; x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (y * src.width + x) * 4;
          r += d[i] * w;
          g += d[i + 1] * w;
          b += d[i + 2] * w;
          a += d[i + 3] * w;
          weightSum += w;
        }
      }
      const di = (ty * tw + tx) * 4;
      if (weightSum > 0) {
        o[di] = Math.round(r / weightSum);
        o[di + 1] = Math.round(g / weightSum);
        o[di + 2] = Math.round(b / weightSum);
        o[di + 3] = Math.round(a / weightSum);
      }
    }
  }
  return out;
}

export function resizeNearest(src: Raster, width: number, height: number): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;
  const out = createRaster(tw, th);
  const xRatio = src.width / tw;
  const yRatio = src.height / th;
  for (let ty = 0; ty < th; ty++) {
    const sy = clamp(Math.floor((ty + 0.5) * yRatio), 0, src.height - 1);
    for (let tx = 0; tx < tw; tx++) {
      const sx = clamp(Math.floor((tx + 0.5) * xRatio), 0, src.width - 1);
      const si = (sy * src.width + sx) * 4;
      const di = (ty * tw + tx) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function resizeBilinear(src: Raster, width: number, height: number): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;
  const out = createRaster(tw, th);
  const xRatio = src.width / tw;
  const yRatio = src.height / th;
  for (let ty = 0; ty < th; ty++) {
    const sy = (ty + 0.5) * yRatio - 0.5;
    for (let tx = 0; tx < tw; tx++) {
      const sx = (tx + 0.5) * xRatio - 0.5;
      const [r, g, b, a] = sampleBilinear(src, sx, sy);
      const di = (ty * tw + tx) * 4;
      out.data[di] = Math.round(r);
      out.data[di + 1] = Math.round(g);
      out.data[di + 2] = Math.round(b);
      out.data[di + 3] = Math.round(a);
    }
  }
  return out;
}

/** Catmull-Rom bicubic interpolation (sharper than bilinear, no ringing clamp issues). */
export function resizeBicubic(src: Raster, width: number, height: number): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;
  const out = createRaster(tw, th);
  const xRatio = src.width / tw;
  const yRatio = src.height / th;
  const cubic = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    // Catmull-Rom
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
    );
  };
  const clampByte = (v: number) => clamp(Math.round(v), 0, 255);
  for (let ty = 0; ty < th; ty++) {
    const sy = (ty + 0.5) * yRatio - 0.5;
    const y1 = Math.floor(sy);
    const fy = sy - y1;
    for (let tx = 0; tx < tw; tx++) {
      const sx = (tx + 0.5) * xRatio - 0.5;
      const x1 = Math.floor(sx);
      const fx = sx - x1;
      const di = (ty * tw + tx) * 4;
      for (let c = 0; c < 4; c++) {
        const col: number[] = [];
        for (let row = -1; row <= 2; row++) {
          const yy = clamp(y1 + row, 0, src.height - 1);
          const p0 = src.data[(yy * src.width + clamp(x1 - 1, 0, src.width - 1)) * 4 + c];
          const p1 = src.data[(yy * src.width + clamp(x1, 0, src.width - 1)) * 4 + c];
          const p2 = src.data[(yy * src.width + clamp(x1 + 1, 0, src.width - 1)) * 4 + c];
          const p3 = src.data[(yy * src.width + clamp(x1 + 2, 0, src.width - 1)) * 4 + c];
          col.push(cubic(p0, p1, p2, p3, fx));
        }
        out.data[di + c] = clampByte(cubic(col[0], col[1], col[2], col[3], fy));
      }
    }
  }
  return out;
}

const LANCZOS_A = 3;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Windowed-sinc Lanczos kernel: `sinc(t) * sinc(t/a)` inside +/-a. */
function lanczos3(t: number): number {
  return Math.abs(t) >= LANCZOS_A ? 0 : sinc(t) * sinc(t / LANCZOS_A);
}

/**
 * Lanczos-3 resampling: windowed sinc with a 6-lobed support, run as two
 * separable passes. When downscaling, the kernel is stretched by the scale
 * factor so the wider footprint averages fine detail instead of aliasing -
 * the same area-averaging guarantee `resizeArea` gives, with more detail
 * retention than a box filter.
 */
export function resizeLanczos(src: Raster, width: number, height: number): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;

  const horizontal = (input: Raster, outW: number): Raster => {
    const ratio = input.width / outW;
    const support = Math.max(1, ratio);
    const radius = LANCZOS_A * support;
    const out = createRaster(outW, input.height);
    // Filter taps depend only on the output column, so precompute them once.
    const columns = Array.from({ length: outW }, (_unused, tx) => {
      const center = (tx + 0.5) * ratio - 0.5;
      const from = Math.max(0, Math.ceil(center - radius));
      const to = Math.min(input.width - 1, Math.floor(center + radius));
      let wsum = 0;
      const weights: number[] = [];
      const taps: number[] = [];
      for (let x = from; x <= to; x++) {
        const w = lanczos3((x - center) / support);
        if (w === 0) continue;
        weights.push(w);
        taps.push(x);
        wsum += w;
      }
      const fallback = clamp(Math.round(center), 0, input.width - 1);
      return { taps, weights, wsum, fallback };
    });

    for (let y = 0; y < input.height; y++) {
      const row = y * input.width * 4;
      for (let tx = 0; tx < outW; tx++) {
        const plan = columns[tx];
        const di = (y * outW + tx) * 4;
        if (plan.wsum === 0 || plan.taps.length === 0) {
          const si = row + plan.fallback * 4;
          for (let c = 0; c < 4; c++) out.data[di + c] = input.data[si + c];
          continue;
        }
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = 0; k < plan.taps.length; k++) {
            sum += input.data[row + plan.taps[k] * 4 + c] * plan.weights[k];
          }
          out.data[di + c] = clamp(Math.round(sum / plan.wsum), 0, 255);
        }
      }
    }
    return out;
  };

  const vertical = (input: Raster, outH: number): Raster => {
    const ratio = input.height / outH;
    const support = Math.max(1, ratio);
    const radius = LANCZOS_A * support;
    const out = createRaster(input.width, outH);
    for (let ty = 0; ty < outH; ty++) {
      const center = (ty + 0.5) * ratio - 0.5;
      const from = Math.max(0, Math.ceil(center - radius));
      const to = Math.min(input.height - 1, Math.floor(center + radius));
      let wsum = 0;
      const weights: number[] = [];
      const taps: number[] = [];
      for (let y = from; y <= to; y++) {
        const w = lanczos3((y - center) / support);
        if (w === 0) continue;
        weights.push(w);
        taps.push(y);
        wsum += w;
      }
      if (wsum === 0 || taps.length === 0) {
        const sy = clamp(Math.round(center), 0, input.height - 1);
        const rowStart = ty * input.width * 4;
        const srcStart = sy * input.width * 4;
        out.data.set(input.data.subarray(srcStart, srcStart + input.width * 4), rowStart);
        continue;
      }
      for (let x = 0; x < input.width; x++) {
        const di = (ty * input.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let k = 0; k < taps.length; k++) {
            sum += input.data[(taps[k] * input.width + x) * 4 + c] * weights[k];
          }
          out.data[di + c] = clamp(Math.round(sum / wsum), 0, 255);
        }
      }
    }
    return out;
  };

  return vertical(horizontal(src, tw), th);
}

/**
 * Resize with the selected filter. `area` is chosen for downscaling because it
 * averages correctly; upscaling with `area` degrades to a bilinear-equivalent
 * box filter, which is acceptable and keeps preview/render consistent.
 */
export function resizeRaster(
  src: Raster,
  width: number,
  height: number,
  filter: ResizeFilter = 'area',
): Raster {
  const tw = Math.max(1, Math.floor(width));
  const th = Math.max(1, Math.floor(height));
  if (tw === src.width && th === src.height) return src;
  switch (filter) {
    case 'nearest':
      return resizeNearest(src, tw, th);
    case 'bilinear':
      return resizeBilinear(src, tw, th);
    case 'bicubic':
      return resizeBicubic(src, tw, th);
    case 'lanczos':
      return resizeLanczos(src, tw, th);
    case 'area':
    default:
      return resizeArea(src, tw, th);
  }
}
