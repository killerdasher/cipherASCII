/**
 * Subtexture masks: per-channel multipliers that make the rendered ASCII read
 * as pixels seen through an LCD or CRT screen.
 *
 * The math is deliberately pixel-space and DOM-free so the exact same mask can
 * run over the editor canvas pixels and over the exported PNG. Each pattern
 * returns factors in 0..1:
 *
 * - `scanlines`: horizontal bright/dark band pairs with period `2 * scale`.
 * - `rgbStripes`: vertical aperture-grille stripes, one per channel, so every
 *   pixel shows a single colour component like an LCD subpixel.
 * - `rgbRosette`: a triad of circular phosphor dots per `3 * scale` cell with
 *   genuinely dark gaps between them.
 * - `grid`: intersecting dark lines every `scale` pixels (line width
 *   `floor(scale / 2)`, minimum 1; at `scale` 1 there is no gap and the mask
 *   degrades to identity).
 *
 * `interpolation` picks the edge treatment: `nearest` is a hard mask,
 * `linear` is a cosine falloff. Opacity is applied as
 * `value *= 1 - opacity * (1 - mask)`, so opacity 0 leaves the image
 * untouched and opacity 1 applies the full mask.
 */

import type { SubtextureSettings, SubtexturePattern } from './types';

/** Largest canvas the pixel-space mask will process (guards getImageData on huge grids). */
export const SUBTEXTURE_MAX_PIXELS = 16 * 1024 * 1024;

/** True when a mask should run for these settings on a canvas of the given size. */
export function shouldApplySubtexture(
  settings: SubtextureSettings | undefined | null,
  width: number,
  height: number,
): boolean {
  if (!settings) return false;
  if (settings.pattern === 'none') return false;
  if (!(settings.opacity > 0)) return false;
  return width * height <= SUBTEXTURE_MAX_PIXELS;
}

/** Clamp and normalise a settings object coming from persisted state. */
export function normalizeSubtexture(
  settings: unknown,
  fallback: SubtextureSettings,
): SubtextureSettings {
  const src = (
    settings && typeof settings === 'object' ? settings : {}
  ) as Partial<SubtextureSettings>;
  const pattern = src.pattern;
  const known: SubtexturePattern[] = ['none', 'scanlines', 'rgbStripes', 'rgbRosette', 'grid'];
  const scale =
    typeof src.scale === 'number' && Number.isFinite(src.scale)
      ? Math.min(32, Math.max(1, Math.round(src.scale)))
      : fallback.scale;
  const opacity =
    typeof src.opacity === 'number' && Number.isFinite(src.opacity)
      ? Math.min(1, Math.max(0, src.opacity))
      : fallback.opacity;
  const interpolation = src.interpolation === 'nearest' ? 'nearest' : 'linear';
  return {
    pattern: pattern && known.includes(pattern) ? pattern : fallback.pattern,
    scale,
    opacity,
    interpolation,
  };
}

/**
 * Brightness of the gap between mask lines at coordinate `q`.
 * Returns 1 well inside the gap, 0 across the dark line, cosine in between.
 *
 * Periods shorter than 4 px cannot carry a smooth ramp at integer pixel
 * coordinates, so `linear` degrades to `nearest` instead of aliasing.
 */
function gapMask(q: number, period: number, line: number, linear: boolean): number {
  if (line <= 0) return 1;
  if (line >= period) return 0;
  const t = ((q % period) + period) % period;
  if (!linear || period < 4) return t >= line ? 1 : 0;
  const gapCenter = line + (period - line) / 2;
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (t - gapCenter)) / period);
}

/** One channel of the aperture-grille mask: a stripe of width `stripe` every `period`. */
function stripeMask(
  x: number,
  channel: number,
  stripe: number,
  period: number,
  linear: boolean,
): number {
  const offset = channel * stripe;
  const t = (((x - offset) % period) + period) % period;
  if (!linear || period < 4) return t < stripe ? 1 : 0;
  const center = offset + stripe / 2;
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (x - center)) / period);
}

/**
 * Raw mask factors for one pixel, before opacity blending.
 * Returns `[red, green, blue]` multipliers in 0..1 (grayscale patterns return
 * the same value for every channel).
 */
export function subtextureMask(
  pattern: SubtexturePattern,
  x: number,
  y: number,
  scale: number,
  interpolation: 'nearest' | 'linear',
): [number, number, number] {
  const s = Math.max(1, Math.round(scale));
  const linear = interpolation === 'linear';
  switch (pattern) {
    case 'none':
      return [1, 1, 1];

    case 'scanlines': {
      const v = gapMask(y, 2 * s, s, linear);
      return [v, v, v];
    }

    case 'grid': {
      const line = Math.floor(s / 2);
      const v = gapMask(x, s, line, linear) * gapMask(y, s, line, linear);
      return [v, v, v];
    }

    case 'rgbStripes': {
      const period = 3 * s;
      return [0, 1, 2].map((channel) =>
        stripeMask(x, channel, s, period, linear),
      ) as [number, number, number];
    }

    case 'rgbRosette': {
      const period = 3 * s;
      const cx = ((x % period) + period) % period;
      const cy = ((y % period) + period) % period;
      const centers: [number, number][] = [
        [0.25 * period, 0.25 * period],
        [0.75 * period, 0.25 * period],
        [0.5 * period, 0.75 * period],
      ];
      const radius = 0.28 * period;
      return centers.map(([dx, dy]) => {
        const d = Math.hypot(cx - dx, cy - dy);
        if (!linear) return d <= radius ? 1 : 0;
        if (d >= radius) return 0;
        return 0.5 + 0.5 * Math.cos((Math.PI * d) / radius);
      }) as [number, number, number];
    }

    default:
      return [1, 1, 1];
  }
}

/**
 * Multiply the subtexture mask into an RGBA pixel buffer in place.
 * `width`/`height` describe the buffer; a mismatched buffer length is a no-op.
 */
export function applySubtexture(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  settings: SubtextureSettings,
): void {
  if (settings.pattern === 'none' || !(settings.opacity > 0)) return;
  if (width <= 0 || height <= 0) return;
  if (pixels.length < width * height * 4) return;

  const opacity = Math.min(1, Math.max(0, settings.opacity));
  const scale = Math.max(1, Math.round(settings.scale));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [mr, mg, mb] = subtextureMask(
        settings.pattern,
        x,
        y,
        scale,
        settings.interpolation,
      );
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i] * (1 - opacity * (1 - mr));
      pixels[i + 1] = pixels[i + 1] * (1 - opacity * (1 - mg));
      pixels[i + 2] = pixels[i + 2] * (1 - opacity * (1 - mb));
    }
  }
}
