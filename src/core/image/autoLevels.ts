/**
 * Auto levels: fit the point-op tone controls so the image's luminance
 * percentiles stretch onto the full 0..1 range - the single biggest lever
 * for ASCII photo contrast (flat sources otherwise waste most of the glyph
 * ladder; reference-quality renders keep a decisive dark/light split).
 *
 * The fit is exact for the pipeline's point-op order in
 * `applyPreprocess` (exposure, then brightness + contrast around 128,
 * then gamma):
 *
 *   x' = (x * gain + b255 - 128) * Fc + 128
 *
 * Choosing gain = 1 (exposure 0) and Fc = F = 1 / (p98 - p2), the two
 * constraints x'(p2) = 0 and x'(p98) = 1 give
 *
 *   Fc       = F
 *   b255     = 128 - p2 * 255 - 128 / F
 *   contrast = (4 / pi) * atan(F) - 1        // inverse of tan((c+1)pi/4)
 *   gamma    = 1                             // the fit is exact only for gamma 1
 *
 * All outputs are clamped to the documented `PreprocessSettings` ranges;
 * effectively flat images (p98 - p2 < 0.02) return a neutral patch with
 * `fitted: false` instead of amplifying noise.
 */
import type { PreprocessSettings } from '../types';
import { clamp } from '../util';

export interface AutoLevelsResult {
  /** Ready-to-merge preprocess patch (gamma normalised to 1). */
  patch: Pick<PreprocessSettings, 'exposure' | 'brightness' | 'contrast' | 'gamma'>;
  /** Low percentile used for the black point. */
  p2: number;
  /** High percentile used for the white point. */
  p98: number;
  /** Stretch factor F (1 when not fitted). */
  stretch: number;
  /** False when the image is too flat for a meaningful stretch. */
  fitted: boolean;
}

const NEUTRAL: AutoLevelsResult['patch'] = { exposure: 0, brightness: 0, contrast: 0, gamma: 1 };

/** Smallest p98 - p2 spread we will amplify (below this: noise, not tone). */
const MIN_SPREAD = 0.02;
/** Largest stretch: keeps the fit inside the exposure/contrast ranges. */
const MAX_STRETCH = 40;

function percentile(sorted: Float32Array, q: number): number {
  if (sorted.length === 0) return 0;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Compute the tone patch that maps `[low, high]` luminance percentiles onto
 * the full range. `low`/`high` are quantiles in 0..1 (defaults 2% / 98%).
 */
export function computeAutoLevels(
  luma: Float32Array,
  low = 0.02,
  high = 0.98,
): AutoLevelsResult {
  if (luma.length === 0) return { patch: { ...NEUTRAL }, p2: 0, p98: 1, stretch: 1, fitted: false };

  const sorted = Float32Array.from(luma);
  sorted.sort();
  const p2 = percentile(sorted, low);
  const p98 = percentile(sorted, high);
  const spread = p98 - p2;

  if (!(spread >= MIN_SPREAD)) {
    return { patch: { ...NEUTRAL }, p2, p98, stretch: 1, fitted: false };
  }

  const stretch = clamp(1 / spread, 1, MAX_STRETCH);
  const contrast = clamp((4 / Math.PI) * Math.atan(stretch) - 1, -1, 1);
  const brightness = clamp((128 - p2 * 255 - 128 / stretch) / 255, -1, 1);

  return {
    patch: { exposure: 0, brightness, contrast, gamma: 1 },
    p2,
    p98,
    stretch,
    fitted: true,
  };
}
