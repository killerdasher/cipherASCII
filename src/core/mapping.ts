/**
 * Character-mapping engine.
 *
 * A mapping strategy converts a luminance plane (0 = black, 1 = white) into an
 * *ink plane* (0 = no ink / lightest glyph, 1 = full ink / darkest glyph).
 * Strategies are registered in a `Registry`, so new ones can be added without
 * touching the renderer or the UI.
 *
 * After the strategy runs, the pipeline applies dithering (optional) and then
 * selects a glyph:
 *
 *   index = clamp(floor(clamp(ink^density + offsetStep, 0, 1) * (n-1)), 0, n-1)
 *
 * where `n` is the character-set length ordered dark -> light.
 */

import { Registry } from './registry';
import type { MappingId, MappingSettings } from './types';
import { clamp } from './util';

export interface MappingContext {
  /** Luminance plane, 0..1, row-major, width*height elements. */
  luma: Float32Array;
  width: number;
  height: number;
  settings: MappingSettings;
}

export interface MappingStrategy {
  id: MappingId;
  label: string;
  description: string;
  /** True when the strategy reads neighbourhood information. */
  usesNeighbourhood: boolean;
  /** Returns the ink plane (0..1). Never mutates the input. */
  map(ctx: MappingContext): Float32Array;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Separable box blur with radius r (cells), clamped edges. Returns a new plane. */
export function boxBlur(plane: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(1, Math.floor(radius));
  const horizontal = new Float32Array(plane.length);
  const out = new Float32Array(plane.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += plane[row + clamp(x, 0, width - 1)];
    const window = 2 * r + 1;
    for (let x = 0; x < width; x++) {
      horizontal[row + x] = sum / window;
      const add = plane[row + clamp(x + r + 1, 0, width - 1)];
      const remove = plane[row + clamp(x - r, 0, width - 1)];
      sum += add - remove;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    const window = 2 * r + 1;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / window;
      const add = horizontal[clamp(y + r + 1, 0, height - 1) * width + x];
      const remove = horizontal[clamp(y - r, 0, height - 1) * width + x];
      sum += add - remove;
    }
  }
  return out;
}

/** Invert luminance to ink and optionally apply an S-curve for contrast. */
function inkFromLuma(luma: Float32Array, contrast = 0): Float32Array {
  const out = new Float32Array(luma.length);
  // contrast in -1..1 around 0.5; tan trick mirrors the preprocessing contrast.
  const k = contrast === 0 ? 1 : Math.tan(((clamp(contrast, -0.999, 0.999) + 1) * Math.PI) / 4);
  for (let i = 0; i < luma.length; i++) {
    const ink = 1 - luma[i];
    const v = (ink - 0.5) * k + 0.5;
    out[i] = clamp(v, 0, 1);
  }
  return out;
}

function applyCurve(ink: Float32Array, curve: Array<{ x: number; y: number }>): Float32Array {
  if (!curve || curve.length < 2) return ink;
  const pts = [...curve].sort((a, b) => a.x - b.x);
  const out = new Float32Array(ink.length);
  for (let i = 0; i < ink.length; i++) {
    const x = ink[i];
    let y = pts[pts.length - 1].y;
    if (x <= pts[0].x) {
      y = pts[0].y;
    } else {
      for (let p = 0; p < pts.length - 1; p++) {
        const a = pts[p];
        const b = pts[p + 1];
        if (x >= a.x && x <= b.x) {
          const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
          y = a.y + (b.y - a.y) * t;
          break;
        }
      }
    }
    out[i] = clamp(y, 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

const luminanceStrategy: MappingStrategy = {
  id: 'luminance',
  label: 'Luminance',
  description:
    'Perceptual brightness mapped directly to glyph density; the weights come from the selected luminance standard.',
  usesNeighbourhood: false,
  map: (ctx) => inkFromLuma(ctx.luma),
};

const brightnessStrategy: MappingStrategy = {
  id: 'brightness',
  label: 'Brightness',
  description: 'Naive mean of intensity; flatter and brighter-looking than luminance.',
  usesNeighbourhood: false,
  map: (ctx) => {
    // Recomputing from luma is an approximation of RGB mean; acceptable because
    // the pipeline has already collapsed colour for mono output. Documented as
    // such: this mode differs from luminance mainly via the contrast curve.
    return inkFromLuma(ctx.luma, -0.15);
  },
};

const contrastStrategy: MappingStrategy = {
  id: 'contrast',
  label: 'Contrast',
  description: 'Luminance with an S-curve so mid-tones separate into more glyph levels.',
  usesNeighbourhood: false,
  map: (ctx) => inkFromLuma(ctx.luma, clamp(ctx.settings.strength, -0.99, 0.99) * 0.8),
};

const localContrastStrategy: MappingStrategy = {
  id: 'localContrast',
  label: 'Local contrast',
  description:
    'Divides detail by the local average so both shadows and highlights keep texture (tone-mapped local contrast).',
  usesNeighbourhood: true,
  map: (ctx) => {
    const { luma, width, height, settings } = ctx;
    const radius = clamp(Math.round(settings.radius), 1, 64);
    const mean = boxBlur(luma, width, height, radius);
    const strength = clamp(settings.strength, 0, 2);
    const out = new Float32Array(luma.length);
    for (let i = 0; i < luma.length; i++) {
      const base = mean[i];
      // Local detail relative to neighbourhood mean, remapped to 0..1 ink.
      const detail = base > 1e-4 ? luma[i] / base : luma[i];
      const mapped = 1 - clamp((detail - 1) * strength + 0.5 + (1 - luma[i]) * 0.5, 0, 1);
      out[i] = clamp(1 - mapped, 0, 1);
    }
    return out;
  },
};

const edgeStrategy: MappingStrategy = {
  id: 'edge',
  label: 'Edge aware',
  description: 'Sobel edge magnitude combined with luminance so contours stay crisp.',
  usesNeighbourhood: true,
  map: (ctx) => {
    const { luma, width, height, settings } = ctx;
    const ink = inkFromLuma(luma);
    const strength = clamp(settings.strength, 0, 2);
    const out = new Float32Array(ink.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx =
          -luma[i - width - 1] - 2 * luma[i - 1] - luma[i + width - 1] +
          luma[i - width + 1] + 2 * luma[i + 1] + luma[i + width + 1];
        const gy =
          -luma[i - width - 1] - 2 * luma[i - width] - luma[i - width + 1] +
          luma[i + width - 1] + 2 * luma[i + width] + luma[i + width + 1];
        const mag = clamp(Math.sqrt(gx * gx + gy * gy), 0, 1);
        out[i] = clamp(ink[i] + mag * strength * 0.5, 0, 1);
      }
    }
    // Edges of the plane keep plain ink (no neighbourhood available).
    for (let x = 0; x < width; x++) {
      out[x] = ink[x];
      out[(height - 1) * width + x] = ink[(height - 1) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width] = ink[y * width];
      out[y * width + width - 1] = ink[y * width + width - 1];
    }
    return out;
  },
};

const gradientStrategy: MappingStrategy = {
  id: 'gradient',
  label: 'Gradient',
  description: 'Emphasises shading transitions: ink follows the rate of brightness change.',
  usesNeighbourhood: true,
  map: (ctx) => {
    const { luma, width, height, settings } = ctx;
    const base = inkFromLuma(luma);
    const strength = clamp(settings.strength, 0, 2);
    const out = new Float32Array(base.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const xm = x > 0 ? luma[i - 1] : luma[i];
        const xp = x < width - 1 ? luma[i + 1] : luma[i];
        const ym = y > 0 ? luma[i - width] : luma[i];
        const yp = y < height - 1 ? luma[i + width] : luma[i];
        const dx = xp - xm;
        const dy = yp - ym;
        const mag = Math.sqrt(dx * dx + dy * dy) * strength;
        out[i] = clamp(base[i] + mag * 0.5, 0, 1);
      }
    }
    return out;
  },
};

const thresholdStrategy: MappingStrategy = {
  id: 'threshold',
  label: 'Threshold',
  description: 'Hard black/white cut at the configured level; ideal for logos and line art.',
  usesNeighbourhood: false,
  map: (ctx) => {
    const cut = clamp(ctx.settings.threshold, 0, 1);
    const out = new Float32Array(ctx.luma.length);
    for (let i = 0; i < ctx.luma.length; i++) out[i] = ctx.luma[i] <= cut ? 1 : 0;
    return out;
  },
};

const adaptiveStrategy: MappingStrategy = {
  id: 'adaptive',
  label: 'Adaptive',
  description:
    'Heuristic per-region normalisation: each pixel is judged against its local mean and spread, so mixed lighting stays readable.',
  usesNeighbourhood: true,
  map: (ctx) => {
    const { luma, width, height, settings } = ctx;
    const radius = clamp(Math.round(settings.radius), 1, 64);
    const mean = boxBlur(luma, width, height, radius);
    const meanSq = boxBlur(squarePlane(luma), width, height, radius);
    const out = new Float32Array(luma.length);
    const strength = clamp(settings.strength, 0, 2);
    for (let i = 0; i < luma.length; i++) {
      const variance = Math.max(0, meanSq[i] - mean[i] * mean[i]);
      const std = Math.sqrt(variance);
      const local = std > 1e-3 ? (luma[i] - mean[i]) / (std * 2) : 0;
      // local > 0 -> brighter than surroundings -> less ink.
      const ink = clamp(0.5 - local * strength * 0.5, 0, 1);
      out[i] = ink;
    }
    return out;
  },
};

const customStrategy: MappingStrategy = {
  id: 'custom',
  label: 'Custom curve',
  description: 'User-defined transfer curve applied to plain luminance.',
  usesNeighbourhood: false,
  map: (ctx) => applyCurve(inkFromLuma(ctx.luma), ctx.settings.curve),
};

function squarePlane(plane: Float32Array): Float32Array {
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i++) out[i] = plane[i] * plane[i];
  return out;
}

export const mappingRegistry = new Registry<MappingStrategy>('mapping strategy');
mappingRegistry.registerAll([
  luminanceStrategy,
  brightnessStrategy,
  contrastStrategy,
  localContrastStrategy,
  edgeStrategy,
  gradientStrategy,
  thresholdStrategy,
  adaptiveStrategy,
  customStrategy,
]);

export function listMappingStrategies(): MappingStrategy[] {
  return mappingRegistry.list();
}

export function runMapping(ctx: MappingContext): Float32Array {
  const strategy = mappingRegistry.get(ctx.settings.strategy) ?? luminanceStrategy;
  return strategy.map(ctx);
}

// ---------------------------------------------------------------------------
// Character-set presets (Character Set Lab)
// ---------------------------------------------------------------------------

import { ALL_CHARSET_PRESETS, CHARSET_CATEGORIES, type CharsetCategory } from './charsets/extendedCharsets';

export type { CharsetCategory };
export { CHARSET_CATEGORIES };

export interface CharsetDescription {
  id: string;
  label: string;
  category: CharsetCategory;
  /** Ordered dark -> light. */
  chars: string;
  description: string;
}

/**
 * Presets are ordered DARK -> LIGHT: index 0 is used for the darkest ink and
 * the last index for the lightest. `output.invert` swaps this at render time.
 */
export const CHARSET_PRESETS: CharsetDescription[] = ALL_CHARSET_PRESETS;

export function getCharset(id: string): CharsetDescription | undefined {
  return CHARSET_PRESETS.find((c) => c.id === id);
}

/** Validate a user-provided character sequence for the Character Set Lab. */
export function validateCharset(chars: string): { ok: boolean; message?: string; normalized: string } {
  const trimmed = chars;
  if (trimmed.length === 0) {
    return { ok: false, message: 'Character set must contain at least one character.', normalized: trimmed };
  }
  if (trimmed.length > 256) {
    return { ok: false, message: 'Character set is limited to 256 characters.', normalized: trimmed.slice(0, 256) };
  }
  // Reject control characters (newlines/tabs would corrupt the grid).
  for (const ch of trimmed) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || (code >= 0x7f && code <= 0x9f)) {
      return { ok: false, message: 'Control characters are not allowed in a character set.', normalized: trimmed };
    }
  }
  return { ok: true, normalized: trimmed };
}

/**
 * Map an ink value (0..1, 1 = full ink) to an index into a character set
 * ordered DARK -> LIGHT. Ink 1 selects the densest glyph (index 0); ink 0
 * selects the lightest (index n-1).
 *
 * - `offset` (glyph steps): positive values select denser glyphs (darker output).
 * - `density`: exponent on the ink curve; > 1 lifts shadows / keeps highlights.
 */
export function inkToIndex(ink: number, count: number, offset = 0, density = 1): number {
  const n = Math.max(1, count);
  if (n === 1) return 0;
  const d = density > 0 ? density : 1;
  const v = Math.pow(clamp(ink, 0, 1), d);
  const pos = (1 - v) * (n - 1) - offset;
  return clamp(Math.round(pos), 0, n - 1);
}

export type { MappingId, MappingSettings };
