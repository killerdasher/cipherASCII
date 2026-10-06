/**
 * Color science and terminal-color conversion helpers.
 *
 * All functions are pure; colors are packed `0xRRGGBB` numbers unless noted.
 */

import { clamp } from './util';
import type { LuminanceStandard } from './types';

export type { LuminanceStandard };

export function rgb(r: number, g: number, b: number): number {
  return (
    ((clamp(Math.round(r), 0, 255) & 0xff) << 16) |
    ((clamp(Math.round(g), 0, 255) & 0xff) << 8) |
    (clamp(Math.round(b), 0, 255) & 0xff)
  );
}

export function red(c: number): number {
  return (c >> 16) & 0xff;
}
export function green(c: number): number {
  return (c >> 8) & 0xff;
}
export function blue(c: number): number {
  return c & 0xff;
}

export function toHex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function fromHex(hex: string): number | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return parseInt(h, 16);
}

export function mix(a: number, b: number, t: number): number {
  const k = clamp(t, 0, 1);
  return rgb(
    red(a) + (red(b) - red(a)) * k,
    green(a) + (green(b) - green(a)) * k,
    blue(a) + (blue(b) - blue(a)) * k,
  );
}

// ---------------------------------------------------------------------------
// Luminance
// ---------------------------------------------------------------------------

/**
 * Relative luminance of an sRGB color, normalized to 0..1.
 *
 * - `rec601` / `rec709`: weighted sums in gamma space (cheap, perceptually useful).
 * - `average`: naive mean, matches legacy ASCII tools.
 * - `luma`: the widespread 0.299/0.587/0.114 weights without linearization.
 * - `srgb-linear`: true relative luminance after linearization; best when
 *   brightness comparisons must be physically meaningful.
 */
export function luminance(color: number, standard: LuminanceStandard = 'rec709'): number {
  const r = red(color) / 255;
  const g = green(color) / 255;
  const b = blue(color) / 255;
  switch (standard) {
    case 'average':
      return (r + g + b) / 3;
    case 'rec601':
    case 'luma':
      return 0.299 * r + 0.587 * g + 0.114 * b;
    case 'rec709':
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    case 'srgb-linear': {
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
  }
}

// ---------------------------------------------------------------------------
// ANSI conversions
// ---------------------------------------------------------------------------

/** Standard xterm 16-color palette (indexes 0..15). */
export const ANSI16: number[] = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0,
  0x808080, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];

function xterm256Color(i: number): number {
  if (i < 16) return ANSI16[i];
  if (i < 232) {
    const v = i - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    return rgb(steps[Math.floor(v / 36) % 6], steps[Math.floor(v / 6) % 6], steps[v % 6]);
  }
  const gray = 8 + (i - 232) * 10;
  return rgb(gray, gray, gray);
}

/** Precomputed xterm-256 palette as RGB. */
export const ANSI256: number[] = Array.from({ length: 256 }, (_, i) => xterm256Color(i));

/** Map an RGB color to the nearest xterm-256 index. */
export function rgbToAnsi256(color: number): number {
  const r = red(color);
  const g = green(color);
  const b = blue(color);

  // Grayscale ramp check first: it avoids colorful bleed into gray bands.
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }

  const to6 = (c: number) => (c < 48 ? 0 : c < 114 ? 1 : Math.round((c - 35) / 40));
  const idx = 16 + 36 * to6(r) + 6 * to6(g) + to6(b);

  // Compare against the grayscale ramp as well, keep whichever is closer.
  const grayIdx = clamp(232 + Math.round((Math.round((r + g + b) / 3) - 8) / 10), 232, 255);
  return dist2(color, ANSI256[idx]) <= dist2(color, ANSI256[grayIdx]) ? idx : grayIdx;
}

/** Map an RGB color to the nearest of the 16 ANSI colors. */
export function rgbToAnsi16(color: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 16; i++) {
    const d = dist2(color, ANSI16[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function dist2(a: number, b: number): number {
  const dr = red(a) - red(b);
  const dg = green(a) - green(b);
  const db = blue(a) - blue(b);
  return dr * dr + dg * dg + db * db;
}

// ---------------------------------------------------------------------------
// HSL helpers (used by saturation adjustments in preprocessing)
// ---------------------------------------------------------------------------

export function rgbToHsl(color: number): [number, number, number] {
  const r = red(color) / 255;
  const g = green(color) / 255;
  const b = blue(color) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): number {
  if (s === 0) {
    const v = l * 255;
    return rgb(v, v, v);
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgb(
    hue2rgb(p, q, h + 1 / 3) * 255,
    hue2rgb(p, q, h) * 255,
    hue2rgb(p, q, h - 1 / 3) * 255,
  );
}
