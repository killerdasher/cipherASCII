/**
 * CPU implementations of the raster post-processing effects.
 *
 * Effects run inside the render worker on the source raster, *before* ASCII
 * mapping, so the character grid reflects the processed image. Every effect
 * honours `effect.intensity` (0 = untouched, 1 = full effect) and mutates the
 * raster it is handed - `applyEffectsToRaster` in `pipeline.ts` owns the copy.
 *
 * The four effects that already lived in `pipeline.ts` (vignette, film grain,
 * scanlines, chromatic aberration) stay there; everything else is handled here.
 */

import type { Raster, EffectSettings, EffectId } from '../types';

type Params = Record<string, number | boolean | string>;

const HANDLED: ReadonlySet<string> = new Set<string>([
  'blur',
  'sharpen',
  'edgeEnhance',
  'medianFilter',
  'motionBlur',
  'noise',
  'halftoneOverlay',
  'ditherOverlay',
  'paletteShift',
  'colorShift',
  'bloom',
  'diffractionStars',
  'epsilonGlow',
  'crtCurvature',
  'lensDistortion',
  'jpegGlitch',
]);

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function text(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v | 0;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** BT.601 luma, 0..255. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Deterministic hash noise so renders (and animation frames) reproduce. */
export function pixelNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f);
  h ^= Math.imul(seed + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const hash01 = pixelNoise;

/** Approximate standard normal from three uniform hashes (CLT), roughly -1.5..1.5. */
function gauss01(x: number, y: number, seed: number): number {
  return hash01(x, y, seed) + hash01(x, y, seed + 7) + hash01(x, y, seed + 13) - 1.5;
}

function mixInto(target: Uint8ClampedArray, processed: Uint8ClampedArray, k: number): void {
  if (k >= 1) {
    target.set(processed);
    return;
  }
  for (let i = 0; i < target.length; i++) {
    target[i] = target[i] + (processed[i] - target[i]) * k;
  }
}

function parseHexColor(value: string, fallback: number): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!m) return fallback;
  return parseInt(m[1], 16);
}

// ---------------------------------------------------------------------------
// Blur primitives
// ---------------------------------------------------------------------------

function gaussianKernel(sigma: number): Float64Array {
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

/** Separable Gaussian blur; returns a new RGBA buffer (alpha preserved). */
function gaussianRGBA(src: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  const kernel = gaussianKernel(sigma);
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
          const sx = clampInt(x + i, 0, w - 1);
          acc += src[row + sx * 4 + c] * kernel[i + radius];
        }
        tmp[o + c] = acc;
      }
      tmp[o + 3] = src[o + 3];
    }
  }

  for (let y = 0; y < h; y++) {
    const col = y * 4;
    for (let x = 0; x < w; x++) {
      const o = col + x * w * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -radius; i <= radius; i++) {
          const sy = clampInt(y + i, 0, h - 1);
          acc += tmp[sy * w * 4 + x * 4 + c] * kernel[i + radius];
        }
        out[o + c] = acc;
      }
      out[o + 3] = tmp[o + 3];
    }
  }

  return out;
}

function boxPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): void {
  const win = radius * 2 + 1;
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const stepSrc = horizontal ? 4 : w * 4;
  const stepDst = horizontal ? w * 4 : 4;

  for (let a = 0; a < outer; a++) {
    const base = horizontal ? a * w * 4 : a * 4;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let i = -radius; i <= radius; i++) {
      const b = clampInt(i, 0, inner - 1);
      const o = base + b * stepSrc;
      sr += src[o];
      sg += src[o + 1];
      sb += src[o + 2];
    }
    for (let b = 0; b < inner; b++) {
      const o = base + b * stepDst;
      dst[o] = sr / win;
      dst[o + 1] = sg / win;
      dst[o + 2] = sb / win;
      dst[o + 3] = src[o + 3];
      const add = clampInt(b + radius + 1, 0, inner - 1);
      const sub = clampInt(b - radius, 0, inner - 1);
      const oa = base + add * stepSrc;
      const os = base + sub * stepSrc;
      sr += src[oa] - src[os];
      sg += src[oa + 1] - src[os + 1];
      sb += src[oa + 2] - src[os + 2];
    }
  }
}

/** Multi-pass box blur (3 passes approximate a Gaussian); returns a new buffer. */
function boxBlurCopy(src: Uint8ClampedArray, w: number, h: number, radius: number, passes = 3): Uint8ClampedArray {
  const a = new Uint8ClampedArray(src);
  const b = new Uint8ClampedArray(src.length);
  for (let p = 0; p < passes; p++) {
    boxPass(a, b, w, h, radius, true);
    boxPass(b, a, w, h, radius, false);
  }
  return a;
}

/** 3x3 mean filter over RGB (alpha preserved); returns a new buffer. */
function mean3RGBA(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = clampInt(y + dy, 0, h - 1);
        for (let dx = -1; dx <= 1; dx++) {
          const sx = clampInt(x + dx, 0, w - 1);
          const o = (sy * w + sx) * 4;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / 9;
      out[o + 1] = g / 9;
      out[o + 2] = b / 9;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hn < 60) rgb = [c, x, 0];
  else if (hn < 120) rgb = [x, c, 0];
  else if (hn < 180) rgb = [0, c, x];
  else if (hn < 240) rgb = [0, x, c];
  else if (hn < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

// ---------------------------------------------------------------------------
// Effect parameter tables
// ---------------------------------------------------------------------------

const BAYER4: readonly number[] = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
];

function bayerValue(algorithm: string, x: number, y: number): number {
  if (algorithm.startsWith('bayer2')) {
    const v = ((x & 1) << 1) | (y & 1);
    return v / 4 - 0.5;
  }
  if (algorithm.startsWith('bayer8')) {
    let h = Math.imul((x & 7) + 1, 0x9e3779b1) ^ Math.imul((y & 7) + 1, 0x85ebca6b);
    h ^= h >>> 11;
    return ((h >>> 0) % 64) / 64 - 0.5;
  }
  const gx = x & 3;
  const gy = y & 3;
  return BAYER4[gy * 4 + gx] / 16 - 0.5;
}

/** Stylised recolor palettes for `paletteShift` (0xRRGGBB). */
const RASTER_PALETTES: Record<string, number[]> = {
  default: [
    0x000000, 0x1a1a2e, 0x333366, 0x4a4a8c, 0x6666aa, 0x8c8ccc, 0xaaaaee, 0xd0d0ff,
    0xffffff, 0xd4a53c, 0xa86a2c, 0x7a4a1e, 0x4e8c4a, 0x2e6e3a, 0x8c3a4a, 0x2e2e2e,
  ],
  gameboy: [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f],
  cga: [0x000000, 0x555555, 0xaaaaaa, 0xffffff, 0x0000aa, 0x0000ff, 0xaa00aa, 0xff00ff],
  gray: [0x000000, 0x333333, 0x666666, 0x999999, 0xcccccc, 0xffffff],
  amber: [0x000000, 0x331a00, 0x663300, 0x994d00, 0xcc6600, 0xff8000, 0xffa64d, 0xffd9b3],
};

function nearestPaletteColor(r: number, g: number, b: number, palette: number[]): number {
  let best = palette[0];
  let bestD = Infinity;
  for (const color of palette) {
    const pr = (color >> 16) & 0xff;
    const pg = (color >> 8) & 0xff;
    const pb = color & 0xff;
    const dr = pr - r;
    const dg = pg - g;
    const db = pb - b;
    const d = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
    if (d < bestD) {
      bestD = d;
      best = color;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Effect implementations
// ---------------------------------------------------------------------------

function effectBlur(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const sigma = Math.max(0.1, num(p.radius, 2) * num(p.sigma, 1) * 0.5);
  if (sigma < 0.4) return;
  mixInto(data, gaussianRGBA(data, w, h, sigma), k);
}

function effectSharpen(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const amount = num(p.amount, 1) * k;
  const threshold = num(p.threshold, 0) * 255;
  const sigma = Math.max(0.5, num(p.radius, 1));
  const blurred = gaussianRGBA(data, w, h, sigma);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[i + c];
      if (Math.abs(diff) >= threshold) data[i + c] = clamp255(data[i + c] + amount * diff);
    }
  }
}

function effectEdgeEnhance(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const amount = num(p.amount, 1.5) * k;
  const threshold = num(p.threshold, 0.05) * 255;
  const mean = mean3RGBA(data, w, h);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - mean[i + c];
      if (Math.abs(diff) >= threshold) data[i + c] = clamp255(data[i + c] + amount * diff);
    }
  }
}

function effectMedian(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const radius = clampInt(Math.round(num(p.radius, 1)), 1, 3);
  const window: number[] = [];
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        window.length = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const sy = clampInt(y + dy, 0, h - 1);
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = clampInt(x + dx, 0, w - 1);
            window.push(src[(sy * w + sx) * 4 + c]);
          }
        }
        window.sort((a, b) => a - b);
        const median = window[window.length >> 1];
        out[o + c] = src[o + c] + (median - src[o + c]) * k;
      }
      out[o + 3] = src[o + 3];
    }
  }
  data.set(out);
}

function effectMotionBlur(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const distance = Math.round(num(p.distance, 10) * k);
  if (distance < 1) return;
  const angle = (num(p.angle, 0) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const samples = Math.min(33, distance + 1);
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < samples; s++) {
        const t = samples === 1 ? 0 : s / (samples - 1) - 0.5;
        const sx = clampInt(Math.round(x + dx * t * distance), 0, w - 1);
        const sy = clampInt(Math.round(y + dy * t * distance), 0, h - 1);
        const so = (sy * w + sx) * 4;
        r += src[so];
        g += src[so + 1];
        b += src[so + 2];
      }
      out[o] = src[o] + (r / samples - src[o]) * k;
      out[o + 1] = src[o + 1] + (g / samples - src[o + 1]) * k;
      out[o + 2] = src[o + 2] + (b / samples - src[o + 2]) * k;
      out[o + 3] = src[o + 3];
    }
  }
  data.set(out);
}

function effectNoise(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number, frame: number): void {
  const amount = num(p.amount, 0.1) * k * 255;
  if (amount <= 0) return;
  const monochrome = bool(p.monochrome, true);
  const gaussian = text(p.distribution, 'gaussian') !== 'uniform';
  const seed = frame * 7919 + 101;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const n = (gaussian ? gauss01(x, y, seed) : hash01(x, y, seed) - 0.5) * amount;
      if (monochrome) {
        data[o] = clamp255(data[o] + n);
        data[o + 1] = clamp255(data[o + 1] + n);
        data[o + 2] = clamp255(data[o + 2] + n);
      } else {
        data[o] = clamp255(data[o] + n);
        data[o + 1] = clamp255(data[o + 1] + (gaussian ? gauss01(x, y, seed + 3) : hash01(x, y, seed + 3) - 0.5) * amount);
        data[o + 2] = clamp255(data[o + 2] + (gaussian ? gauss01(x, y, seed + 5) : hash01(x, y, seed + 5) - 0.5) * amount);
      }
    }
  }
}

function effectHalftone(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const frequency = Math.max(1, num(p.frequency, 12));
  const angle = (num(p.angle, 45) * Math.PI) / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const scale = frequency / Math.max(w, h);
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const bright = luma(src[o], src[o + 1], src[o + 2]) / 255;
      const rx = x * cosA + y * sinA;
      const ry = -x * sinA + y * cosA;
      const cx = rx * scale;
      const cy = ry * scale;
      const fx = cx - Math.floor(cx) - 0.5;
      const fy = cy - Math.floor(cy) - 0.5;
      const dist = Math.sqrt(fx * fx + fy * fy);
      const radius = Math.sqrt(1 - bright) * 0.707;
      const dot = smoothstep(radius + 0.08, radius - 0.08, dist);
      const factor = 0.25 + 0.75 * dot;
      data[o] = clamp255(src[o] + (src[o] * factor - src[o]) * k);
      data[o + 1] = clamp255(src[o + 1] + (src[o + 1] * factor - src[o + 1]) * k);
      data[o + 2] = clamp255(src[o + 2] + (src[o + 2] * factor - src[o + 2]) * k);
    }
  }
}

function effectDitherOverlay(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const strength = num(p.strength, 0.3) * k;
  if (strength <= 0) return;
  const invert = bool(p.invert, false) ? -1 : 1;
  const algorithm = text(p.algorithm, 'bayer4');
  const offset = strength * 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const v = bayerValue(algorithm, x, y) * offset * invert;
      data[o] = clamp255(data[o] + v);
      data[o + 1] = clamp255(data[o + 1] + v);
      data[o + 2] = clamp255(data[o + 2] + v);
    }
  }
}

function effectPaletteShift(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const paletteId = text(p.paletteId, 'default');
  const palette = RASTER_PALETTES[paletteId] ?? RASTER_PALETTES.default;
  const strength = clamp01(num(p.strength, 1)) * k;
  if (strength <= 0) return;
  const useDither = bool(p.dither, true);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = useDither ? bayerValue('bayer4', x, y) * 32 : 0;
      const nearest = nearestPaletteColor(
        clamp255(data[o] + d),
        clamp255(data[o + 1] + d),
        clamp255(data[o + 2] + d),
        palette,
      );
      const nr = (nearest >> 16) & 0xff;
      const ng = (nearest >> 8) & 0xff;
      const nb = nearest & 0xff;
      data[o] = clamp255(data[o] + (nr - data[o]) * strength);
      data[o + 1] = clamp255(data[o + 1] + (ng - data[o + 1]) * strength);
      data[o + 2] = clamp255(data[o + 2] + (nb - data[o + 2]) * strength);
    }
  }
}

function effectColorShift(data: Uint8ClampedArray, p: Params, k: number): void {
  const hue = num(p.hue, 0) * k;
  const saturation = 1 + (num(p.saturation, 1) - 1) * k;
  const lightness = num(p.lightness, 0) * k;
  if (hue === 0 && saturation === 1 && lightness === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    const [h0, s0, l0] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const s1 = clamp01(s0 * saturation);
    const l1 = clamp01(l0 + lightness);
    const [r, g, b] = hslToRgb(h0 + hue, s1, l1);
    data[i] = clamp255(r);
    data[i + 1] = clamp255(g);
    data[i + 2] = clamp255(b);
  }
}

function effectBloom(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const threshold = num(p.threshold, 0.8) * 255;
  const radius = clampInt(Math.round(num(p.radius, 4)), 1, 64);
  const amount = clamp01(num(p.intensity, 0.5)) * k;
  if (amount <= 0) return;
  const bright = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    if (luma(data[i], data[i + 1], data[i + 2]) >= threshold) {
      bright[i] = data[i];
      bright[i + 1] = data[i + 1];
      bright[i + 2] = data[i + 2];
      bright[i + 3] = 255;
    } else {
      bright[i + 3] = 255;
    }
  }
  const glow = boxBlurCopy(bright, w, h, radius, 3);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const base = data[i + c];
      const g = glow[i + c];
      // Screen blend, then scale by the effect amount.
      const screened = 255 - ((255 - base) * (255 - g)) / 255;
      data[i + c] = clamp255(base + (screened - base) * amount);
    }
  }
}

function effectEpsilonGlow(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const threshold = num(p.threshold, 0.7) * 255;
  const radius = clampInt(Math.round(num(p.radius, 3)), 1, 64);
  const color = parseHexColor(text(p.color, '#00ffff'), 0x00ffff);
  const cr = (color >> 16) & 0xff;
  const cg = (color >> 8) & 0xff;
  const cb = color & 0xff;
  const mask = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    const edge = l >= threshold ? l : 0;
    mask[i] = edge;
    mask[i + 1] = edge;
    mask[i + 2] = edge;
    mask[i + 3] = 255;
  }
  const glow = boxBlurCopy(mask, w, h, radius, 3);
  for (let i = 0; i < data.length; i += 4) {
    const m = glow[i] / 255;
    if (m <= 0) continue;
    const gr = cr * m;
    const gg = cg * m;
    const gb = cb * m;
    const sr = 255 - ((255 - data[i]) * (255 - gr)) / 255;
    const sg = 255 - ((255 - data[i + 1]) * (255 - gg)) / 255;
    const sb = 255 - ((255 - data[i + 2]) * (255 - gb)) / 255;
    data[i] = clamp255(data[i] + (sr - data[i]) * k);
    data[i + 1] = clamp255(data[i + 1] + (sg - data[i + 1]) * k);
    data[i + 2] = clamp255(data[i + 2] + (sb - data[i + 2]) * k);
  }
}

/** Shared inverse radial remap for CRT curvature and lens distortion. */
function radialWarp(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  k1: number,
  scale: number,
  blackOutside: boolean,
  k: number,
): void {
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const invScale = scale === 0 ? 1 : 1 / scale;
  for (let y = 0; y < h; y++) {
    const ny = (y - cy) / cy;
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / cx;
      const r2 = nx * nx + ny * ny;
      const factor = (1 + k1 * r2) * invScale;
      const sx = Math.round(cx * (nx * factor) + cx);
      const sy = Math.round(cy * (ny * factor) + cy);
      const o = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
        if (blackOutside) {
          out[o] = 0;
          out[o + 1] = 0;
          out[o + 2] = 0;
          out[o + 3] = src[o + 3];
          continue;
        }
        const cxClamped = clampInt(sx, 0, w - 1);
        const cyClamped = clampInt(sy, 0, h - 1);
        const so = (cyClamped * w + cxClamped) * 4;
        out[o] = src[so];
        out[o + 1] = src[so + 1];
        out[o + 2] = src[so + 2];
        out[o + 3] = src[so + 3];
        continue;
      }
      const so = (sy * w + sx) * 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = src[o + c] + (src[so + c] - src[o + c]) * k;
      }
    }
  }
  data.set(out);
}

function effectCrtCurvature(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const k1 = (num(p.barrel, 0.15) - num(p.pincushion, 0)) * k;
  if (k1 === 0) return;
  radialWarp(data, w, h, k1, 1, bool(p.corners, true), k);
}

function effectLensDistortion(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const k1 = (num(p.barrel, 0.1) - num(p.pincushion, 0)) * k;
  const scale = num(p.scale, 1);
  if (k1 === 0 && scale === 1) return;
  radialWarp(data, w, h, k1, scale, false, k);
}

function effectJpegGlitch(data: Uint8ClampedArray, w: number, h: number, p: Params, k: number): void {
  const quality = clampInt(Math.round(num(p.quality, 10)), 1, 100);
  const blockSize = clampInt(Math.round(num(p.blockSize, 8)), 2, 32);
  const artifacts = clamp01(num(p.artifacts, 0.5)) * k;
  const step = Math.max(1, 64 / quality);
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);

  for (let by = 0; by < h; by += blockSize) {
    for (let bx = 0; bx < w; bx += blockSize) {
      const maxX = Math.min(w, bx + blockSize);
      const maxY = Math.min(h, by + blockSize);
      let mr = 0;
      let mg = 0;
      let mb = 0;
      let count = 0;
      for (let y = by; y < maxY; y++) {
        for (let x = bx; x < maxX; x++) {
          const o = (y * w + x) * 4;
          mr += src[o];
          mg += src[o + 1];
          mb += src[o + 2];
          count++;
        }
      }
      if (count === 0) continue;
      mr /= count;
      mg /= count;
      mb /= count;
      const blockId = (by / blockSize) * 1013 + bx / blockSize;
      const shifted = hash01(blockId, 1, 7) < artifacts * 0.25;
      const shift = shifted ? Math.round((hash01(blockId, 2, 11) - 0.5) * 8) : 0;
      const tint = hash01(blockId, 3, 13) < artifacts * 0.2 ? 24 : 0;

      for (let y = by; y < maxY; y++) {
        for (let x = bx; x < maxX; x++) {
          const o = (y * w + x) * 4;
          const sx = clampInt(x + shift, 0, w - 1);
          const so = (y * w + sx) * 4;
          const qr = mr + Math.round((src[so] - mr) / step) * step;
          const qg = mg + Math.round((src[so + 1] - mg) / step) * step;
          const qb = mb + Math.round((src[so + 2] - mb) / step) * step;
          out[o] = src[o] + (clamp255(qr + tint) - src[o]) * k;
          out[o + 1] = src[o + 1] + (clamp255(qg) - src[o + 1]) * k;
          out[o + 2] = src[o + 2] + (clamp255(qb - tint) - src[o + 2]) * k;
          out[o + 3] = src[o + 3];
        }
      }
    }
  }

  data.set(out);
}

/**
 * Diffraction star spikes: thin rays radiating from isolated highlights, the
 * way a telescope's secondary-mirror vanes (or a camera aperture) smear bright
 * point sources.
 *
 * Only local luminance maxima at or above `threshold` emit spikes, so broad
 * bright areas stay untouched; equal-value plateaus emit from their first
 * pixel in scan order only, which also keeps cost bounded on flat white
 * images. Rays are stamped tinted by the source colour into a separate
 * buffer, optionally softened with a Gaussian blur, then added on top and
 * scaled by the effect intensity.
 *
 * Params: `spikes` (4 | 6 | 8, default 6), `threshold` (0..1, default 0.75),
 * `length` (ray length in pixels, default 12), `blur` (Gaussian sigma,
 * default 1), `angle` (degrees, rotates the whole star, default 0).
 */
function effectDiffractionStars(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  p: Params,
  k: number,
): void {
  const rawSpikes = Math.round(num(p.spikes, 6));
  const spikes = rawSpikes === 4 || rawSpikes === 8 ? rawSpikes : 6;
  const threshold = clamp01(num(p.threshold, 0.75)) * 255;
  const length = clampInt(Math.round(num(p.length, 12)), 1, 64);
  const blur = Math.min(8, Math.max(0, num(p.blur, 1)));
  const angle = (num(p.angle, 0) * Math.PI) / 180;

  // Luminance of the untouched source, needed before rays are stamped.
  const source = new Float32Array(w * h);
  for (let i = 0, o = 0; i < source.length; i++, o += 4) {
    source[i] = luma(data[o], data[o + 1], data[o + 2]);
  }

  const rays = new Uint8ClampedArray(w * h * 4);
  const amp = 230 * k;
  const direction: [number, number][] = [];
  for (let s = 0; s < spikes; s++) {
    const theta = angle + (2 * Math.PI * s) / spikes;
    direction.push([Math.cos(theta), Math.sin(theta)]);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const l = source[idx];
      if (l < threshold) continue;
      // Local maximum over the 8-neighbourhood; out-of-bounds counts as pass
      // so highlights on the border still spike.
      let isMax = true;
      for (let ny = -1; ny <= 1 && isMax; ny++) {
        for (let nx = -1; nx <= 1; nx++) {
          if (nx === 0 && ny === 0) continue;
          const sx = x + nx;
          const sy = y + ny;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          if (source[sy * w + sx] > l) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      // Plateaus: only the first pixel in scan order emits.
      if ((x > 0 && source[idx - 1] >= l) || (y > 0 && source[idx - w] >= l)) continue;

      const o = idx * 4;
      const tintR = data[o] / 255;
      const tintG = data[o + 1] / 255;
      const tintB = data[o + 2] / 255;
      for (const [dx, dy] of direction) {
        for (let d = 1; d <= length; d++) {
          const px = x + Math.round(dx * d);
          const py = y + Math.round(dy * d);
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const falloff = 1 - d / length;
          const add = amp * falloff * falloff;
          const po = (py * w + px) * 4;
          rays[po] = clamp255(rays[po] + add * tintR);
          rays[po + 1] = clamp255(rays[po + 1] + add * tintG);
          rays[po + 2] = clamp255(rays[po + 2] + add * tintB);
        }
      }
    }
  }

  const softened = blur > 0 ? gaussianRGBA(rays, w, h, blur) : rays;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] + softened[i]);
    data[i + 1] = clamp255(data[i + 1] + softened[i + 1]);
    data[i + 2] = clamp255(data[i + 2] + softened[i + 2]);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Apply one raster effect in place.
 *
 * Returns `false` when the effect id belongs to `pipeline.ts` (or is unknown),
 * so the caller can keep its own implementation.
 */
export function applyRasterEffect(target: Raster, effect: EffectSettings, frame = 0): boolean {
  const id = String(effect.id);
  if (!HANDLED.has(id)) return false;

  const { width: w, height: h, data } = target;
  if (w <= 0 || h <= 0 || data.length === 0) return true;

  const k = clamp01(effect.intensity);
  if (k <= 0) return true;
  const p = effect.params ?? {};

  switch (id) {
    case 'blur':
      effectBlur(data, w, h, p, k);
      break;
    case 'sharpen':
      effectSharpen(data, w, h, p, k);
      break;
    case 'edgeEnhance':
      effectEdgeEnhance(data, w, h, p, k);
      break;
    case 'medianFilter':
      effectMedian(data, w, h, p, k);
      break;
    case 'motionBlur':
      effectMotionBlur(data, w, h, p, k);
      break;
    case 'noise':
      effectNoise(data, w, h, p, k, frame);
      break;
    case 'halftoneOverlay':
      effectHalftone(data, w, h, p, k);
      break;
    case 'ditherOverlay':
      effectDitherOverlay(data, w, h, p, k);
      break;
    case 'paletteShift':
      effectPaletteShift(data, w, h, p, k);
      break;
    case 'colorShift':
      effectColorShift(data, p, k);
      break;
    case 'bloom':
      effectBloom(data, w, h, p, k);
      break;
    case 'diffractionStars':
      effectDiffractionStars(data, w, h, p, k);
      break;
    case 'epsilonGlow':
      effectEpsilonGlow(data, w, h, p, k);
      break;
    case 'crtCurvature':
      effectCrtCurvature(data, w, h, p, k);
      break;
    case 'lensDistortion':
      effectLensDistortion(data, w, h, p, k);
      break;
    case 'jpegGlitch':
      effectJpegGlitch(data, w, h, p, k);
      break;
    default:
      return false;
  }

  return true;
}

export const RASTER_EFFECT_IDS: readonly EffectId[] = [...HANDLED] as EffectId[];
