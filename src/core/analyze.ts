/**
 * Auto glyph & dither analyzer - the "math core" behind recommendation chips.
 *
 * Given a luminance plane (0 = black, 1 = white) at analysis resolution, the
 * module scores every (charset x dither) combination against the actual image
 * content and returns the strongest candidates. The user still chooses: this
 * only ranks, it never mutates settings.
 *
 * Scoring (all terms 0..1, score is their clamped weighted sum):
 *
 * - `sharp`    - per-cell accuracy: 1 - RMSE(source ink, reconstructed ink),
 *                after a perceptual cap: errors under 5% of full range are
 *                invisible in a glyph grid and do not separate candidates.
 * - `soft`     - structure without pixel noise: same, measured after a
 *                radius-1 box blur on both planes, so dither noise is judged
 *                by its low-frequency shape rather than its per-cell grain.
 * - `deflat`   - local-variation retention: how much of the source's
 *                radius-1-blurred gradient energy survived quantisation.
 *                Measured after the blur so per-cell dither grain (which the
 *                eye cannot read as structure) does not count: banded
 *                gradients collapse to flat steps (low); error-diffusion
 *                dithers restore the smooth low-frequency slope (high).
 *                Truly flat source cells are neutral.
 * - `tone`     - ladder utilisation: entropy of the used glyph levels
 *                normalised by log(min(levels, 12)); a charset that only
 *                ever shows three of its ten glyphs is wasting steps.
 * - `legibility` - discriminability prior: adjacent ladder steps closer than
 *                ~7% ink are indistinguishable as glyphs, so ladders longer
 *                than 16 levels pay a waste penalty (16/len, clamped).
 *
 *   score = 0.30*soft + 0.20*sharp + 0.20*deflat + 0.10*tone + 0.20*legibility
 *
 * The legibility term is what keeps the ranking honest: once fidelity is
 * perceptually saturated (fine ladders all score ~1), the simpler, more
 * legible charset wins - and on smooth gradients the dithered short ladder
 * beats the undithered long one because banding is still penalised.
 *
 * Dithers are scored over a curated shortlist ({@link ANALYZER_DITHERS}) so
 * recommendations stay recognisable; pass `options.dithers` to widen it.
 * The analysis is deterministic: same plane in, same ranking out.
 */
import { applyDither, ditherLabel } from './dither';
import { boxBlur, CHARSET_PRESETS, inkToIndex, type CharsetDescription } from './mapping';
import type { DitherId } from './types';

/** Dithers the analyzer considers by default (recognisable, high-quality). */
export const ANALYZER_DITHERS: readonly DitherId[] = [
  'none',
  'threshold',
  'bayer4',
  'bayer8',
  'floydSteinberg',
  'atkinson',
  'jarvisJudiceNinke',
  'stucki',
  'sierraLite',
  'blueNoise',
  'halftoneAM',
  'voidCluster',
];

export interface AnalyzeOptions {
  /** Charsets to rank; defaults to every registered preset. */
  charsets?: readonly CharsetDescription[];
  /** Dithers to rank; defaults to {@link ANALYZER_DITHERS}. */
  dithers?: readonly DitherId[];
  /** How many recommendations to return; default 6. */
  limit?: number;
}

export interface RecommendationMetrics {
  /** Per-cell accuracy against the source (perceptually capped), 0..1. */
  sharp: number;
  /** Blur-compensated structural fidelity (perceptually capped), 0..1. */
  soft: number;
  /** Local-variation retention; 1 = no banding, 0 = flattened, 0..1. */
  deflat: number;
  /** Utilisation of the charset's tonal ladder, 0..1. */
  tone: number;
  /** Glyph discriminability prior for long ladders, 0..1. */
  legibility: number;
}

export interface RenderRecommendation {
  charsetId: string;
  charsetLabel: string;
  /** The raw character sequence for `output.charset`, dark -> light. */
  chars: string;
  ditherId: DitherId;
  ditherLabel: string;
  score: number;
  metrics: RecommendationMetrics;
}

/** Coarse content summary used for the "why" copy next to the chips. */
export interface ImageTraits {
  /** Dynamic range of the ink plane, 0..1. */
  contrast: number;
  /** Mean edge energy, 0..1. */
  detail: number;
  /** Fraction of cells sitting in smooth ramps (banding risk), 0..1. */
  bandingRisk: number;
}

export interface AnalyzeResult {
  recommendations: RenderRecommendation[];
  traits: ImageTraits;
}

/** An analysis bound to the image it came from, for display next to chips. */
export interface RenderAnalysis extends AnalyzeResult {
  /** Display name of the analyzed image (usually the layer/file name). */
  source: string;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

function rmse(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / Math.max(1, a.length));
}

function meanStd(ink: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < ink.length; i++) sum += ink[i];
  const mean = sum / Math.max(1, ink.length);
  let varSum = 0;
  for (let i = 0; i < ink.length; i++) {
    const d = ink[i] - mean;
    varSum += d * d;
  }
  return Math.sqrt(varSum / Math.max(1, ink.length));
}

function meanAbsGradient(ink: Float32Array, width: number, height: number): number {
  if (width < 2 || height < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const right = x + 1 < width ? Math.abs(ink[i + 1] - ink[i]) : 0;
      const down = y + 1 < height ? Math.abs(ink[i + width] - ink[i]) : 0;
      sum += right + down;
      count += 2;
    }
  }
  return sum / Math.max(1, count);
}

/** Per-cell gradient energy: |dx| + |dy| with clamped borders. */
function gradientEnergy(plane: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const right = x + 1 < width ? Math.abs(plane[i + 1] - plane[i]) : 0;
      const down = y + 1 < height ? Math.abs(plane[i + width] - plane[i]) : 0;
      out[i] = right + down;
    }
  }
  return out;
}

/**
 * Perceptual error cap: RMSE below `cap` of the full range is invisible on a
 * glyph grid, so it scores as a perfect match; above it the remaining error
 * is rescaled to 0..1.
 */
function perceptualError(rmseValue: number, cap: number): number {
  if (rmseValue <= cap) return 0;
  return Math.min(1, (rmseValue - cap) / (1 - cap));
}

/**
 * Fraction of cells living in a smooth ramp: measurable neighbourhood range
 * (a gradient is moving) but tiny neighbourhood standard deviation (it is
 * moving slowly). Compared against an 8-level ladder step as reference.
 */
function bandingRisk(ink: Float32Array, width: number, height: number): number {
  if (width < 5 || height < 5) return 0;
  const step = 1 / 7;
  let hits = 0;
  let cells = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let sumSq = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = ink[(y + dy) * width + (x + dx)];
          if (v < min) min = v;
          if (v > max) max = v;
          sum += v;
          sumSq += v * v;
        }
      }
      const count = 25;
      const std = Math.sqrt(Math.max(0, sumSq / count - (sum / count) ** 2));
      if (max - min >= step * 0.25 && std <= step * 0.4) hits++;
      cells++;
    }
  }
  return cells > 0 ? hits / cells : 0;
}

function entropyTone(hist: Float64Array, total: number, levels: number): number {
  if (total <= 0 || levels < 2) return 0;
  let h = 0;
  for (let i = 0; i < hist.length; i++) {
    const p = hist[i] / total;
    if (p > 0) h -= p * Math.log(p);
  }
  const norm = Math.log(Math.min(levels, 12));
  return norm > 0 ? clamp01(h / norm) : 0;
}

/**
 * Rank charset x dither combinations for a luminance plane.
 * Throws RangeError when `luma.length !== width * height`.
 */
export function analyzeLuma(
  luma: Float32Array,
  width: number,
  height: number,
  options: AnalyzeOptions = {},
): AnalyzeResult {
  if (luma.length !== width * height || width <= 0 || height <= 0) {
    throw new RangeError(
      `analyzeLuma: plane ${luma.length} does not match ${width}x${height}`,
    );
  }
  const charsets = (options.charsets ?? CHARSET_PRESETS).filter(
    (c) => [...c.chars].length >= 2,
  );
  const dithers = options.dithers ?? ANALYZER_DITHERS;
  const limit = Math.max(1, options.limit ?? 6);
  const n = luma.length;

  // Default pipeline mapping is luminance -> ink (dark = 1); see mapping.ts.
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) ink[i] = clamp01(1 - luma[i]);

  const traits: ImageTraits = {
    contrast: clamp01(meanStd(ink) * 3.2),
    detail: clamp01(meanAbsGradient(ink, width, height) * 6),
    bandingRisk: clamp01(bandingRisk(ink, width, height)),
  };

  const inkBlur = boxBlur(ink, width, height, 1);
  const inkGrad = gradientEnergy(inkBlur, width, height);

  const results: RenderRecommendation[] = [];
  for (const charset of charsets) {
    const chars = [...charset.chars];
    const len = chars.length;
    const legibility = clamp01(16 / len);
    for (const algorithm of dithers) {
      const dithered =
        algorithm === 'none'
          ? ink
          : applyDither(
              ink,
              width,
              height,
              { algorithm, strength: 1, serpentine: false, matrixSize: 8 },
              len,
            );

      const recon = new Float32Array(n);
      const hist = new Float64Array(len);
      const denom = len - 1;
      for (let i = 0; i < n; i++) {
        const idx = inkToIndex(dithered[i], len, 0, 1);
        recon[i] = 1 - idx / denom;
        hist[idx]++;
      }

      const reconBlur = boxBlur(recon, width, height, 1);
      const reconGrad = gradientEnergy(reconBlur, width, height);

      let penSum = 0;
      let penCells = 0;
      for (let i = 0; i < n; i++) {
        const gOrig = inkGrad[i];
        if (gOrig <= 1e-5) continue; // Already flat: dither noise is neutral.
        penSum += clamp01((gOrig - reconGrad[i]) / gOrig);
        penCells++;
      }

      const sharp = clamp01(1 - perceptualError(rmse(ink, recon), 0.05));
      const soft = clamp01(1 - perceptualError(rmse(inkBlur, reconBlur), 0.04));
      const deflat = clamp01(1 - (penCells > 0 ? penSum / penCells : 0));
      const tone = entropyTone(hist, n, len);
      const score = clamp01(
        0.3 * soft + 0.2 * sharp + 0.2 * deflat + 0.1 * tone + 0.2 * legibility,
      );

      results.push({
        charsetId: charset.id,
        charsetLabel: charset.label,
        chars: charset.chars,
        ditherId: algorithm,
        ditherLabel: ditherLabel(algorithm),
        score: round4(score),
        metrics: {
          sharp: round4(sharp),
          soft: round4(soft),
          deflat: round4(deflat),
          tone: round4(tone),
          legibility: round4(legibility),
        },
      });
    }
  }

  // Stable descending sort: ties keep the registration order (deterministic).
  results.sort((a, b) => b.score - a.score);
  return { recommendations: results.slice(0, limit), traits };
}

/**
 * Chunked wrapper around {@link analyzeLuma} for interactive use: scores the
 * charset list in batches and awaits `yieldFn()` between them so a large
 * image never freezes the UI thread. Results are merged and re-sorted, and
 * are identical to a single sync run.
 */
export async function analyzeLumaChunked(
  luma: Float32Array,
  width: number,
  height: number,
  options: AnalyzeOptions = {},
  yieldFn: () => Promise<void>,
): Promise<AnalyzeResult> {
  const charsets = options.charsets ?? CHARSET_PRESETS;
  const CHUNK = 8;
  const collected: RenderRecommendation[] = [];
  let traits: ImageTraits | null = null;
  for (let i = 0; i < charsets.length; i += CHUNK) {
    const slice = charsets.slice(i, i + CHUNK);
    const part = analyzeLuma(luma, width, height, { ...options, charsets: slice });
    traits = traits ?? part.traits;
    collected.push(...part.recommendations);
    if (i + CHUNK < charsets.length) await yieldFn();
  }
  const limit = Math.max(1, options.limit ?? 6);
  collected.sort((a, b) => b.score - a.score);
  return {
    recommendations: collected.slice(0, limit),
    traits: traits ?? { contrast: 0, detail: 0, bandingRisk: 0 },
  };
}

/** Human-readable "why" line for a traits summary. */
export function describeTraits(traits: ImageTraits): string {
  if (traits.contrast < 0.25) return 'low contrast';
  if (traits.bandingRisk > 0.35) return 'smooth gradients - dithering helps';
  if (traits.detail > 0.5) return 'fine detail';
  return 'mixed tones';
}
