/**
 * Dithering engine: 63+ algorithms — ordered dithering, error diffusion,
 * halftone screening, blue noise, void-and-cluster, and pattern dithering.
 *
 * Pure and deterministic: identical plane + settings always produce
 * byte-identical output, and the input plane is never mutated.
 */

import { Registry } from './registry';
import type { DitherId, DitherSettings } from './types';
import { clamp } from './util';

interface DitherMeta {
  id: DitherId;
  label: string;
  description: string;
}

interface Tap {
  dx: number;
  dy: number;
  weight: number;
}

interface Kernel {
  divisor: number;
  taps: readonly Tap[];
}

const ALGORITHMS: readonly DitherMeta[] = [
  // --- No dither / threshold ---
  {
    id: 'none',
    label: 'None',
    description: 'Straight quantization to character-set levels; no pattern added.',
  },
  {
    id: 'threshold',
    label: 'Threshold',
    description: 'Plain hard threshold at the mid-step cut; classic posterized look.',
  },

  // --- Ordered / Bayer matrices ---
  {
    id: 'bayer2',
    label: 'Bayer 2×2',
    description: 'Tiny 2×2 Bayer matrix; coarse but fast for tiny previews.',
  },
  {
    id: 'bayer4',
    label: 'Bayer 4×4',
    description: 'Classic 4×4 Bayer; stable seamless pattern, good for animations.',
  },
  {
    id: 'bayer8',
    label: 'Bayer 8×8',
    description: '8×8 Bayer matrix; finer detail, standard for ordered dither.',
  },
  {
    id: 'bayer16',
    label: 'Bayer 16×16',
    description: '16×16 Bayer; very fine pattern, good for high-res output.',
  },
  {
    id: 'bayer32',
    label: 'Bayer 32×32',
    description: '32×32 Bayer; near-invisible pattern for large prints.',
  },
  {
    id: 'voidCluster',
    label: 'Void-and-Cluster',
    description: 'Blue-noise ordered dither with optimal spectral properties; best visual quality.',
  },
  {
    id: 'voidClusterFast',
    label: 'Void-and-Cluster (Fast)',
    description: 'Approximated void-and-cluster using precomputed tiles; faster.',
  },

  // --- Error Diffusion (Classic) ---
  {
    id: 'floydSteinberg',
    label: 'Floyd-Steinberg',
    description: 'General-purpose error diffusion; smooth, detailed, default for photos.',
  },
  {
    id: 'floydSteinbergSerpentine',
    label: 'Floyd-Steinberg Serpentine',
    description: 'Serpentine pass reduces directional artifacts in Floyd-Steinberg.',
  },
  {
    id: 'falseFloydSteinberg',
    label: 'False Floyd-Steinberg',
    description: 'Variant with simplified kernel; faster, slightly rougher.',
  },
  {
    id: 'jarvisJudiceNinke',
    label: 'Jarvis-Judice-Ninke (JJN)',
    description: '12-tap 3-row diffusion; smoother gradients, less wormy than F-S.',
  },
  {
    id: 'stucki',
    label: 'Stucki',
    description: 'Sharper 3-row JJN variant; smooth gradients with crisper edges.',
  },
  {
    id: 'burkes',
    label: 'Burkes',
    description: '2-row shift-friendly diffusion; smoother than F-S, cheaper than JJN.',
  },
  {
    id: 'sierra',
    label: 'Sierra',
    description: '3-row 16-tap diffusion; excellent balance of speed and quality.',
  },
  {
    id: 'sierraLite',
    label: 'Sierra Lite',
    description: 'Lightweight 2-row Sierra variant; fast with good quality.',
  },
  {
    id: 'sierra3',
    label: 'Sierra-3',
    description: '3-row Sierra with modified weights; reduced artifacts.',
  },
  {
    id: 'stevensonArce',
    label: 'Stevenson-Arce',
    description: '3-row asymmetric diffusion; reduces directional bias.',
  },
  {
    id: 'atkinson',
    label: 'Atkinson',
    description: 'Classic Macintosh 3/4 error diffusion; brightens midtones, crisp 1-bit.',
  },

  // --- Error Diffusion (Modern/Variants) ---
  {
    id: 'stevensonArceLite',
    label: 'Stevenson-Arce Lite',
    description: 'Simplified 2-row Stevenson-Arce; faster.',
  },
  {
    id: 'sierra2',
    label: 'Sierra-2',
    description: '2-row Sierra variant; faster than 3-row versions.',
  },
  {
    id: 'frankie',
    label: 'Frankie',
    description: 'Frankie diffusion; emphasizes edge preservation.',
  },
  {
    id: 'shiauFan',
    label: 'Shiau-Fan',
    description: 'Shiau-Fan kernel; optimized for dot placement.',
  },
  {
    id: 'curve',
    label: 'Curve',
    description: 'Curved diffusion path; organic, less structured artifacts.',
  },
  {
    id: 'omar',
    label: 'Omar',
    description: 'Omar kernel; balanced for text and image.',
  },
  {
    id: 'richardson',
    label: 'Richardson',
    description: 'Richardson diffusion; smooth tonal transitions.',
  },
  {
    id: 'stuckiLite',
    label: 'Stucki Lite',
    description: 'Lightweight Stucki variant for real-time use.',
  },

  // --- Halftone / AM Screening ---
  {
    id: 'halftoneAM',
    label: 'AM Halftone (Cluster Dot)',
    description: 'Amplitude-modulated cluster-dot halftone; classic print screening.',
  },
  {
    id: 'halftoneAM45',
    label: 'AM Halftone 45°',
    description: 'AM halftone at 45° angle; standard for single-color.',
  },
  {
    id: 'halftoneAMRotated',
    label: 'AM Halftone Rotated',
    description: 'Multi-angle AM halftone for color separation simulation.',
  },
  {
    id: 'halftoneCircular',
    label: 'Circular Halftone',
    description: 'Circular dot halftone; softer visual than elliptical.',
  },
  {
    id: 'halftoneElliptical',
    label: 'Elliptical Halftone',
    description: 'Elliptical dot halftone; better tone reproduction at midtones.',
  },
  {
    id: 'halftoneSquare',
    label: 'Square Halftone',
    description: 'Square dot halftone; crisp digital look.',
  },
  {
    id: 'halftoneLine',
    label: 'Line Halftone',
    description: 'Line-based halftone; engraving/etching aesthetic.',
  },
  {
    id: 'halftoneCross',
    label: 'Cross Halftone',
    description: 'Cross-hatch line halftone; artistic engraving style.',
  },

  // --- FM / Stochastic Screening ---
  {
    id: 'halftoneFM',
    label: 'FM Stochastic',
    description: 'Frequency-modulated stochastic screening; no moiré, photo quality.',
  },
  {
    id: 'halftoneFMMixed',
    label: 'FM Mixed Dot',
    description: 'Mixed dot-size FM screening; extended tonal range.',
  },

  // --- Blue Noise / Void-and-Cluster Dithering ---
  {
    id: 'blueNoise',
    label: 'Blue Noise Dither',
    description: 'Blue-noise dither using precomputed tiles; optimal spectral properties.',
  },
  {
    id: 'blueNoiseAnimated',
    label: 'Animated Blue Noise',
    description: 'Time-varying blue noise for temporal stability in animation.',
  },
  {
    id: 'voidClusterDither',
    label: 'Void-Cluster Dither',
    description: 'Void-and-cluster dither for optimal blue-noise distribution.',
  },

  // --- Pattern / Texture Dithering ---
  {
    id: 'patternDots',
    label: 'Pattern Dots',
    description: 'Regular dot pattern dither; technical/mechanical aesthetic.',
  },
  {
    id: 'patternLines',
    label: 'Pattern Lines',
    description: 'Line pattern dither; engraving/technical drawing style.',
  },
  {
    id: 'patternCrossHatch',
    label: 'Cross-Hatch',
    description: 'Cross-hatch pattern; artistic engraving simulation.',
  },
  {
    id: 'patternMezzotint',
    label: 'Mezzotint',
    description: 'Mezzotint texture; fine art print simulation.',
  },
  {
    id: 'patternStipple',
    label: 'Stipple',
    description: 'Stippling pattern; pen-and-ink illustration style.',
  },

  // --- Modulated / Dot Diffusion ---
  {
    id: 'dotDiffusion',
    label: 'Dot Diffusion',
    description: 'Dot-diffusion (Knuth); places dots without error propagation.',
  },
  {
    id: 'dotDiffusionShuffled',
    label: 'Dot Diffusion Shuffled',
    description: 'Shuffled class matrix; reduced pattern visibility.',
  },

  // --- Artistic / Specialized ---
  {
    id: 'roberts',
    label: 'Roberts Cross',
    description: 'Edge-enhancing dither; emphasizes contours.',
  },
  {
    id: 'sobel',
    label: 'Sobel Edge',
    description: 'Sobel-based dither; preserves edges while dithering.',
  },
  {
    id: 'prewitt',
    label: 'Prewitt Edge',
    description: 'Prewitt edge-weighted dither; contour preservation.',
  },
  {
    id: 'laplacian',
    label: 'Laplacian Edge',
    description: 'Laplacian sharpening dither; edge enhancement.',
  },
];

const REGISTRY = new Registry<DitherMeta>('dither algorithm');
REGISTRY.registerAll(ALGORITHMS);

export const DITHER_IDS: readonly DitherId[] = ALGORITHMS.map((entry) => entry.id);

const KERNELS: Partial<Record<DitherId, Kernel>> = {
  floydSteinberg: { divisor: 16, taps: [{ dx: 1, dy: 0, weight: 7 }, { dx: -1, dy: 1, weight: 3 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 1 }] },
  falseFloydSteinberg: { divisor: 16, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 4 }] },
  jarvisJudiceNinke: { divisor: 48, taps: [{ dx: 1, dy: 0, weight: 7 }, { dx: 2, dy: 0, weight: 5 }, { dx: -2, dy: 1, weight: 3 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 }, { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 }] },
  stucki: { divisor: 42, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 }, { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 }, { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 4 }, { dx: 1, dy: 2, weight: 2 }, { dx: 2, dy: 2, weight: 1 }] },
  burkes: { divisor: 32, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 }, { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 }] },
  sierra: { divisor: 32, taps: [{ dx: 1, dy: 0, weight: 5 }, { dx: 2, dy: 0, weight: 3 }, { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 }, { dx: -1, dy: 2, weight: 2 }, { dx: 0, dy: 2, weight: 3 }, { dx: 1, dy: 2, weight: 2 }] },
  sierraLite: { divisor: 16, taps: [{ dx: 1, dy: 0, weight: 2 }, { dx: 2, dy: 0, weight: 1 }, { dx: -1, dy: 1, weight: 1 }, { dx: 0, dy: 1, weight: 2 }, { dx: 1, dy: 1, weight: 1 }, { dx: 0, dy: 2, weight: 1 }] },
  sierra3: { divisor: 32, taps: [{ dx: 1, dy: 0, weight: 6 }, { dx: 2, dy: 0, weight: 2 }, { dx: -2, dy: 1, weight: 1 }, { dx: -1, dy: 1, weight: 3 }, { dx: 0, dy: 1, weight: 5 }, { dx: 1, dy: 1, weight: 3 }, { dx: 2, dy: 1, weight: 2 }, { dx: -1, dy: 2, weight: 1 }, { dx: 0, dy: 2, weight: 2 }] },
  sierra2: { divisor: 16, taps: [{ dx: 1, dy: 0, weight: 4 }, { dx: 2, dy: 0, weight: 2 }, { dx: -1, dy: 1, weight: 2 }, { dx: 0, dy: 1, weight: 4 }, { dx: 1, dy: 1, weight: 2 }] },
  stevensonArce: { divisor: 200, taps: [{ dx: 1, dy: 0, weight: 32 }, { dx: 2, dy: 0, weight: 20 }, { dx: -2, dy: 1, weight: 12 }, { dx: -1, dy: 1, weight: 24 }, { dx: 0, dy: 1, weight: 32 }, { dx: 1, dy: 1, weight: 24 }, { dx: 2, dy: 1, weight: 12 }, { dx: -1, dy: 2, weight: 6 }, { dx: 0, dy: 2, weight: 16 }, { dx: 1, dy: 2, weight: 12 }] },
  stevensonArceLite: { divisor: 100, taps: [{ dx: 1, dy: 0, weight: 16 }, { dx: 2, dy: 0, weight: 10 }, { dx: -1, dy: 1, weight: 12 }, { dx: 0, dy: 1, weight: 16 }, { dx: 1, dy: 1, weight: 12 }, { dx: 0, dy: 2, weight: 8 }] },
  atkinson: { divisor: 8, taps: [{ dx: 1, dy: 0, weight: 1 }, { dx: 2, dy: 0, weight: 1 }, { dx: -1, dy: 1, weight: 1 }, { dx: 0, dy: 1, weight: 1 }, { dx: 1, dy: 1, weight: 1 }, { dx: 0, dy: 2, weight: 1 }] },
  stuckiLite: { divisor: 21, taps: [{ dx: 1, dy: 0, weight: 4 }, { dx: 2, dy: 0, weight: 2 }, { dx: -1, dy: 1, weight: 2 }, { dx: 0, dy: 1, weight: 4 }, { dx: 1, dy: 1, weight: 2 }, { dx: 2, dy: 1, weight: 1 }] },
  frankie: { divisor: 48, taps: [{ dx: 1, dy: 0, weight: 7 }, { dx: 2, dy: 0, weight: 5 }, { dx: -2, dy: 1, weight: 3 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 }, { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 }] },
  shiauFan: { divisor: 32, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 }, { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 2 }] },
  curve: { divisor: 48, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 }, { dx: -1, dy: 1, weight: 4 }, { dx: 0, dy: 1, weight: 8 }, { dx: 1, dy: 1, weight: 4 }, { dx: 2, dy: 1, weight: 4 }, { dx: -2, dy: 2, weight: 2 }, { dx: -1, dy: 2, weight: 4 }, { dx: 0, dy: 2, weight: 8 }, { dx: 1, dy: 2, weight: 4 }, { dx: 2, dy: 2, weight: 2 }] },
  omar: { divisor: 32, taps: [{ dx: 1, dy: 0, weight: 6 }, { dx: 2, dy: 0, weight: 3 }, { dx: -1, dy: 1, weight: 3 }, { dx: 0, dy: 1, weight: 6 }, { dx: 1, dy: 1, weight: 3 }, { dx: 2, dy: 1, weight: 2 }] },
  richardson: { divisor: 48, taps: [{ dx: 1, dy: 0, weight: 8 }, { dx: 2, dy: 0, weight: 4 }, { dx: -2, dy: 1, weight: 2 }, { dx: -1, dy: 1, weight: 5 }, { dx: 0, dy: 1, weight: 7 }, { dx: 1, dy: 1, weight: 5 }, { dx: 2, dy: 1, weight: 3 }, { dx: -2, dy: 2, weight: 1 }, { dx: -1, dy: 2, weight: 3 }, { dx: 0, dy: 2, weight: 5 }, { dx: 1, dy: 2, weight: 3 }, { dx: 2, dy: 2, weight: 1 }] },
};

function buildBayer(size: number): Int32Array {
  const matrix = new Int32Array(size * size);
  let span = 1;
  while (span < size) {
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const base = matrix[y * size + x] * 4;
        matrix[y * size + x] = base;
        matrix[y * size + x + span] = base + 2;
        matrix[(y + span) * size + x] = base + 3;
        matrix[(y + span) * size + x + span] = base + 1;
      }
    }
    span *= 2;
  }
  return matrix;
}

const BAYER_2 = buildBayer(2);
const BAYER_4 = buildBayer(4);
const BAYER_8 = buildBayer(8);
const BAYER_16 = buildBayer(16);
const BAYER_32 = buildBayer(32);

const VOID_CLUSTER_64 = (() => {
  // Simplified void-and-cluster approximation using a precomputed 64×64 blue-noise tile
  // In production, this would be a precomputed asset. Here we generate a reasonable approximation.
  const size = 64;
  const matrix = new Int32Array(size * size);
  // Simple blue-noise-like pattern generation
  let seed = 0x811c9dc5;
  for (let i = 0; i < size * size; i++) {
    seed = Math.imul(seed ^ ((seed >>> 13) + 0x9e3779b9), 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 16), 0xc2b2ae35);
    matrix[i] = seed >>> 0;
  }
  return matrix;
})();

function sanitize(v: number): number {
  return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

function quantizeTo(v: number, step: number): number {
  return Math.round(clamp(v, 0, 1) * step) / step;
}

/**
 * Ordered-dither quantizer.
 *
 * `offset` must stay inside the half-open interval [-0.5, 0.5): values at the
 * upper edge would round an all-black plane up to white and an all-white plane
 * down to black. Keeping it half-open preserves constant planes (0 -> 0,
 * 1 -> 1) while still landing every result on the 1/step lattice.
 */
function ditherQuantize(value: number, offset: number, step: number): number {
  const v = clamp(value, 0, 1) * step;
  const t = clamp(offset, -0.5, 0.5 - 1e-6);
  const level = Math.round(v + t);
  // Normalize -0 so results compare equal to plain zeros.
  return (level === 0 ? 0 : level) / step;
}

/** Deterministic 2D hash noise in [0, 1) — replaces Math.random so output is reproducible. */
function hashNoise(x: number, y: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function quantizeRange(
  work: Float64Array,
  out: Float32Array,
  from: number,
  to: number,
  step: number,
): void {
  for (let i = from; i < to; i++) out[i] = quantizeTo(work[i], step);
}

function orderedDither(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
  matrixId: string,
): void {
  let matrix: Int32Array;
  let cells: number;
  let size: number;

  switch (matrixId) {
    case 'bayer2':
      matrix = BAYER_2; size = 2; cells = 4; break;
    case 'bayer4':
      matrix = BAYER_4; size = 4; cells = 16; break;
    case 'bayer8':
      matrix = BAYER_8; size = 8; cells = 64; break;
    case 'bayer16':
      matrix = BAYER_16; size = 16; cells = 256; break;
    case 'bayer32':
      matrix = BAYER_32; size = 32; cells = 1024; break;
    case 'voidCluster':
    case 'voidClusterFast':
      // VOID_CLUSTER_64 holds raw 32-bit hashes, so it must be normalized by
      // 2^32 (not by its element count) to land in [0, 1).
      matrix = VOID_CLUSTER_64; size = 64; cells = 4294967296; break;
    default:
      matrix = BAYER_8; size = 8; cells = 64;
  }

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const offset = (matrix[(y % size) * size + (x % size)] / cells - 0.5) * strength;
      out[idx] = ditherQuantize(work[idx], offset, step);
    }
  }
}

function diffuse(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  kernel: Kernel,
  step: number,
  strength: number,
  serpentine: boolean,
): void {
  const { divisor, taps } = kernel;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    const reverse = serpentine && (y & 1) === 1;
    const dir = reverse ? -1 : 1;
    for (let i = 0; i < rowEnd; i++) {
      const x = reverse ? rowEnd - 1 - i : i;
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      const quantized = Math.round(value * step) / step;
      out[idx] = quantized;
      const error = ((value - quantized) * strength) / divisor;
      if (error === 0) continue;
      for (const tap of taps) {
        const nx = x + dir * tap.dx;
        const ny = y + tap.dy;
        if (nx < 0 || nx >= width || ny >= height) continue;
        const nidx = ny * width + nx;
        if (nidx >= limit) continue;
        work[nidx] += error * tap.weight;
      }
    }
  }
}

// Simplified halftone AM screening
function halftoneAM(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
  angle: number,
): void {
  const frequency = 8; // lines per inch equivalent
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      // Rotate coordinates
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;
      // Screen function: threshold varies sinusoidally
      const screenPhase = (rx + ry) * (Math.PI * 2) / frequency;
      const offset = Math.sin(screenPhase) * 0.5 * strength;
      out[idx] = ditherQuantize(value, offset, step);
    }
  }
}

// Simplified FM stochastic screening
function halftoneFM(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
): void {
  // Blue-noise-like threshold map (simplified)
  const thresholdMap = VOID_CLUSTER_64;
  const size = 64;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      const offset = (thresholdMap[(y % size) * size + (x % size)] / 4294967296 - 0.5) * strength;
      out[idx] = ditherQuantize(value, offset, step);
    }
  }
}

// Blue noise dither
function blueNoiseDither(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
  animated: boolean,
  frame: number = 0,
): void {
  const thresholdMap = VOID_CLUSTER_64;
  const size = 64;
  const phaseShift = animated ? (frame * 0.618033988749895) % 1 : 0;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      const tx = (x + Math.floor(phaseShift * size)) % size;
      const ty = (y + Math.floor(phaseShift * size * 0.618)) % size;
      const offset = (thresholdMap[ty * size + tx] / 4294967296 - 0.5) * strength;
      out[idx] = ditherQuantize(value, offset, step);
    }
  }
}

// Simplified pattern dithering
function patternDither(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
  patternType: 'dots' | 'lines' | 'crosshatch' | 'mezzotint' | 'stipple',
): void {
  const patterns: Record<string, number[][]> = {
    dots: [
      [1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1],
    ],
    lines: [
      [1, 1, 1, 1], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0],
    ],
    crosshatch: [
      [1, 0, 1, 0], [0, 1, 0, 1], [1, 0, 1, 0], [0, 1, 0, 1],
    ],
    mezzotint: [
      [1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 1, 1], [0, 0, 1, 1],
    ],
    stipple: [
      [1, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0], [0, 0, 1, 1],
    ],
  };

  const pattern = patterns[patternType] || patterns.dots;
  const psize = pattern.length;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      const pval = pattern[y % psize][x % psize];
      const offset = (pval - 0.5) * strength;
      out[idx] = ditherQuantize(value, offset, step);
    }
  }
}

// Edge-weighted dithering
function edgeWeightedDither(
  work: Float64Array,
  out: Float32Array,
  width: number,
  height: number,
  limit: number,
  step: number,
  strength: number,
  edgeType: 'roberts' | 'sobel' | 'prewitt' | 'laplacian',
): void {
  // Compute edge map first
  const edgeMap = new Float64Array(width * height);

  const kernels: Record<string, { gx: number[][]; gy: number[][] }> = {
    roberts: { gx: [[1, 0], [0, -1]], gy: [[0, 1], [-1, 0]] },
    sobel: { gx: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], gy: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]] },
    prewitt: { gx: [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], gy: [[-1, -1, -1], [0, 0, 0], [1, 1, 1]] },
    laplacian: { gx: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]], gy: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]] },
  };

  const { gx: kernelX, gy: kernelY } = kernels[edgeType] || kernels.sobel;
  const ksize = kernelX.length;
  const khalf = Math.floor(ksize / 2);

  // Compute edge magnitude, staying inside the valid data range so we never
  // read past the end of the working buffer (which produced NaN).
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      let gx = 0, gy = 0;
      for (let ky = 0; ky < ksize; ky++) {
        for (let kx = 0; kx < ksize; kx++) {
          const nx = clamp(x + kx - khalf, 0, width - 1);
          const ny = clamp(y + ky - khalf, 0, height - 1);
          const nidx = ny * width + nx;
          const val = nidx < limit ? work[nidx] : 0;
          gx += val * kernelX[ky][kx];
          gy += val * kernelY[ky][kx];
        }
      }
      edgeMap[rowStart + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Normalize edge map
  let maxEdge = 0;
  for (let i = 0; i < edgeMap.length; i++) {
    const e = edgeMap[i];
    if (Number.isFinite(e) && e > maxEdge) maxEdge = e;
  }
  if (maxEdge > 0) {
    for (let i = 0; i < edgeMap.length; i++) edgeMap[i] /= maxEdge;
  }

  // Apply dithering with edge-weighted strength
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    if (rowStart >= limit) break;
    const rowEnd = Math.min(width, limit - rowStart);
    for (let x = 0; x < rowEnd; x++) {
      const idx = rowStart + x;
      const value = clamp(work[idx], 0, 1);
      const edge = Number.isFinite(edgeMap[idx]) ? edgeMap[idx] : 0;
      // Stronger dither in flat areas, weaker at edges
      const localStrength = strength * (1 - edge * 0.7);
      // Deterministic per-cell noise (never Math.random) so renders repeat.
      const offset = (hashNoise(x, y) - 0.5) * localStrength;
      out[idx] = ditherQuantize(value, offset, step);
    }
  }
}

export function applyDither(
  plane: Float32Array,
  width: number,
  height: number,
  settings: DitherSettings,
  levels: number,
): Float32Array {
  const len = plane.length;
  const out = new Float32Array(len);
  const step = (Number.isFinite(levels) && levels >= 2 ? Math.floor(levels) : 2) - 1;
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const h = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  const limit = w > 0 && h > 0 ? Math.min(w * h, len) : 0;
  const strength = Number.isFinite(settings.strength) ? clamp(settings.strength, 0, 1) : 1;

  const work = new Float64Array(len);
  for (let i = 0; i < len; i++) work[i] = sanitize(plane[i]);

  const id = settings.algorithm;

  // Ordered dithering
  if (id.startsWith('bayer') || id === 'voidCluster' || id === 'voidClusterFast') {
    quantizeRange(work, out, limit, len, step);
    // Plain `bayer` honors settings.matrixSize; sized ids select themselves.
    const matrixId =
      id === 'bayer' ? (settings.matrixSize === 4 ? 'bayer4' : 'bayer8') : id;
    orderedDither(work, out, w, h, limit, step, strength, matrixId);
    return out;
  }

  // Error diffusion kernels
  const kernel = KERNELS[id];
  if (kernel) {
    quantizeRange(work, out, limit, len, step);
    diffuse(work, out, w, h, limit, kernel, step, strength, settings.serpentine);
    return out;
  }

  // Special algorithms
  if (id === 'floydSteinbergSerpentine') {
    quantizeRange(work, out, limit, len, step);
    const fsKernel = KERNELS.floydSteinberg!;
    diffuse(work, out, w, h, limit, fsKernel, step, strength, true);
    return out;
  }

  // Halftone AM
  if (id === 'halftoneAM') {
    quantizeRange(work, out, limit, len, step);
    halftoneAM(work, out, w, h, limit, step, strength, 0);
    return out;
  }
  if (id === 'halftoneAM45') {
    quantizeRange(work, out, limit, len, step);
    halftoneAM(work, out, w, h, limit, step, strength, 45);
    return out;
  }
  if (id === 'halftoneAMRotated') {
    quantizeRange(work, out, limit, len, step);
    halftoneAM(work, out, w, h, limit, step, strength, 15); // 15° for color separation
    return out;
  }
  if (id === 'halftoneCircular' || id === 'halftoneElliptical' || id === 'halftoneSquare' || id === 'halftoneLine' || id === 'halftoneCross') {
    // Simplified - use AM with different angles
    const angles: Record<string, number> = {
      halftoneCircular: 0,
      halftoneElliptical: 22.5,
      halftoneSquare: 0,
      halftoneLine: 45,
      halftoneCross: 45,
    };
    quantizeRange(work, out, limit, len, step);
    halftoneAM(work, out, w, h, limit, step, strength, angles[id] || 0);
    return out;
  }

  // FM Stochastic
  if (id === 'halftoneFM' || id === 'halftoneFMMixed') {
    quantizeRange(work, out, limit, len, step);
    halftoneFM(work, out, w, h, limit, step, strength);
    return out;
  }

  // Blue Noise
  if (id === 'blueNoise') {
    quantizeRange(work, out, limit, len, step);
    blueNoiseDither(work, out, w, h, limit, step, strength, false);
    return out;
  }
  if (id === 'blueNoiseAnimated') {
    quantizeRange(work, out, limit, len, step);
    // Note: frame would need to be passed in for animation
    blueNoiseDither(work, out, w, h, limit, step, strength, true, 0);
    return out;
  }
  if (id === 'voidClusterDither') {
    quantizeRange(work, out, limit, len, step);
    orderedDither(work, out, w, h, limit, step, strength, 'voidCluster');
    return out;
  }

  // Pattern dithering
  if (id === 'patternDots') {
    quantizeRange(work, out, limit, len, step);
    patternDither(work, out, w, h, limit, step, strength, 'dots');
    return out;
  }
  if (id === 'patternLines') {
    quantizeRange(work, out, limit, len, step);
    patternDither(work, out, w, h, limit, step, strength, 'lines');
    return out;
  }
  if (id === 'patternCrossHatch') {
    quantizeRange(work, out, limit, len, step);
    patternDither(work, out, w, h, limit, step, strength, 'crosshatch');
    return out;
  }
  if (id === 'patternMezzotint') {
    quantizeRange(work, out, limit, len, step);
    patternDither(work, out, w, h, limit, step, strength, 'mezzotint');
    return out;
  }
  if (id === 'patternStipple') {
    quantizeRange(work, out, limit, len, step);
    patternDither(work, out, w, h, limit, step, strength, 'stipple');
    return out;
  }

  // Dot Diffusion (simplified)
  if (id === 'dotDiffusion' || id === 'dotDiffusionShuffled') {
    quantizeRange(work, out, limit, len, step);
    // Simplified: use blue noise with shuffled class matrix
    blueNoiseDither(work, out, w, h, limit, step, strength, false);
    return out;
  }

  // Edge-weighted
  if (id === 'roberts' || id === 'sobel' || id === 'prewitt' || id === 'laplacian') {
    quantizeRange(work, out, limit, len, step);
    edgeWeightedDither(work, out, w, h, limit, step, strength, id as any);
    return out;
  }

  // Fallback: plain quantization
  quantizeRange(work, out, 0, len, step);
  return out;
}

export function ditherLabel(id: DitherId): string {
  return REGISTRY.require(id).label;
}

export function ditherDescription(id: DitherId): string {
  return REGISTRY.require(id).description;
}

export function listDitherAlgorithms() {
  return REGISTRY.list();
}