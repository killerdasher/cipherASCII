/**
 * Effects Pipeline - stackable post-processing effects like Dither Boy.
 *
 * Effects are applied in sequence after the main render, enabling
 * creative combinations: glow, glitch, chromatic aberration, etc.
 */

import type { Raster } from '../types';
import { applyRasterEffect, pixelNoise } from './imageEffects';

/** Effect params are a loose record; read one as a finite number. */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export type EffectId =
  | 'none'
  | 'epsilonGlow'
  | 'jpegGlitch'
  | 'chromaticAberration'
  | 'scanlines'
  | 'vignette'
  | 'filmGrain'
  | 'bloom'
  | 'diffractionStars'
  | 'crtCurvature'
  | 'colorShift'
  | 'paletteShift'
  | 'ditherOverlay'
  | 'edgeEnhance'
  | 'sharpen'
  | 'blur'
  | 'noise'
  | 'halftoneOverlay'
  | 'medianFilter'
  | 'motionBlur'
  | 'lensDistortion';

export interface EffectMeta {
  id: EffectId;
  label: string;
  description: string;
  category: 'glow' | 'glitch' | 'color' | 'texture' | 'blur' | 'distortion' | 'style';
}

export interface EffectSettings {
  id: EffectId;
  enabled: boolean;
  intensity: number; // 0..1
  params: Record<string, number | boolean | string>;
}

export const EFFECT_PRESETS: EffectMeta[] = [
  {
    id: 'epsilonGlow',
    label: 'Epsilon Glow',
    description: 'Subtle neon glow on bright edges; cyberpunk aesthetic.',
    category: 'glow',
  },
  {
    id: 'jpegGlitch',
    label: 'JPEG Glitch',
    description: 'Simulated JPEG compression artifacts; digital decay.',
    category: 'glitch',
  },
  {
    id: 'chromaticAberration',
    label: 'Chromatic Aberration',
    description: 'RGB channel separation on edges; lens imperfection.',
    category: 'color',
  },
  {
    id: 'scanlines',
    label: 'Scanlines',
    description: 'CRT scanline overlay; retro monitor simulation.',
    category: 'texture',
  },
  {
    id: 'vignette',
    label: 'Vignette',
    description: 'Darkened corners; photographic lens effect.',
    category: 'style',
  },
  {
    id: 'filmGrain',
    label: 'Film Grain',
    description: 'Photographic film grain texture; analog feel.',
    category: 'texture',
  },
  {
    id: 'bloom',
    label: 'Bloom',
    description: 'Light bleeding from bright areas; HDR glow.',
    category: 'glow',
  },
  {
    id: 'diffractionStars',
    label: 'Diffraction Stars',
    description: 'Thin rays radiating from isolated highlights; telescope spike bloom.',
    category: 'glow',
  },
  {
    id: 'crtCurvature',
    label: 'CRT Curvature',
    description: 'Barrel distortion simulating curved CRT screen.',
    category: 'distortion',
  },
  {
    id: 'colorShift',
    label: 'Color Shift',
    description: 'Global hue/saturation/lightness offset.',
    category: 'color',
  },
  {
    id: 'paletteShift',
    label: 'Palette Shift',
    description: 'Remap colors through a target palette; stylized recoloring.',
    category: 'color',
  },
  {
    id: 'ditherOverlay',
    label: 'Dither Overlay',
    description: 'Overlay a secondary dither pattern; texture layering.',
    category: 'texture',
  },
  {
    id: 'edgeEnhance',
    label: 'Edge Enhance',
    description: 'Sharpen edges via unsharp mask; detail pop.',
    category: 'style',
  },
  {
    id: 'sharpen',
    label: 'Sharpen',
    description: 'General sharpening; contrast edge enhancement.',
    category: 'style',
  },
  {
    id: 'blur',
    label: 'Blur',
    description: 'Gaussian blur; soften detail, reduce noise.',
    category: 'blur',
  },
  {
    id: 'noise',
    label: 'Noise',
    description: 'Add random noise; texture or dither seed.',
    category: 'texture',
  },
  {
    id: 'halftoneOverlay',
    label: 'Halftone Overlay',
    description: 'Overlay halftone screen pattern; print simulation.',
    category: 'texture',
  },
  {
    id: 'medianFilter',
    label: 'Median Filter',
    description: 'Edge-preserving noise reduction; cleanup.',
    category: 'blur',
  },
  {
    id: 'motionBlur',
    label: 'Motion Blur',
    description: 'Directional blur; speed/motion simulation.',
    category: 'blur',
  },
  {
    id: 'lensDistortion',
    label: 'Lens Distortion',
    description: 'Barrel/pincushion distortion; wide-angle simulation.',
    category: 'distortion',
  },
];

export const DEFAULT_EFFECT_PARAMS: Record<EffectId, Record<string, number | boolean | string>> = {
  none: {},
  epsilonGlow: { radius: 3, threshold: 0.7, color: '#00ffff', blend: 'screen' },
  jpegGlitch: { quality: 10, blockSize: 8, artifacts: 0.5 },
  chromaticAberration: { offsetR: 2, offsetB: -2, angle: 0, strength: 0.5 },
  scanlines: { spacing: 2, opacity: 0.3, color: '#000000' },
  vignette: { radius: 0.5, feather: 0.3, color: '#000000' },
  filmGrain: { size: 1, strength: 0.15, monochrome: true },
  bloom: { threshold: 0.8, radius: 4, intensity: 0.5 },
  diffractionStars: { spikes: 6, threshold: 0.75, length: 12, blur: 1, angle: 0 },
  crtCurvature: { barrel: 0.15, pincushion: 0, corners: true },
  colorShift: { hue: 0, saturation: 1, lightness: 0 },
  paletteShift: { paletteId: 'default', strength: 1, dither: true },
  ditherOverlay: { algorithm: 'bayer4', strength: 0.3, invert: false },
  edgeEnhance: { radius: 1, amount: 1.5, threshold: 0.05 },
  sharpen: { radius: 1, amount: 1, threshold: 0 },
  blur: { radius: 2, sigma: 1 },
  noise: { amount: 0.1, monochrome: true, distribution: 'gaussian' },
  halftoneOverlay: { frequency: 12, angle: 45, dotShape: 'circular' },
  medianFilter: { radius: 1 },
  motionBlur: { angle: 0, distance: 10 },
  lensDistortion: { barrel: 0.1, pincushion: 0, scale: 1 },
};

export interface EffectsPipeline {
  effects: EffectSettings[];
}

export function createEffectsPipeline(): EffectsPipeline {
  return { effects: [] };
}

export function addEffect(pipeline: EffectsPipeline, id: EffectId, params?: Record<string, number | boolean | string>): EffectsPipeline {
  const defaults = DEFAULT_EFFECT_PARAMS[id] || {};
  const mergedParams = { ...defaults, ...params };
  return {
    effects: [...pipeline.effects, { id, enabled: true, intensity: 1, params: mergedParams }],
  };
}

export function removeEffect(pipeline: EffectsPipeline, index: number): EffectsPipeline {
  return { effects: pipeline.effects.filter((_, i) => i !== index) };
}

export function reorderEffects(pipeline: EffectsPipeline, fromIndex: number, toIndex: number): EffectsPipeline {
  const effects = [...pipeline.effects];
  const [moved] = effects.splice(fromIndex, 1);
  effects.splice(toIndex, 0, moved);
  return { effects };
}

export function updateEffectParams(pipeline: EffectsPipeline, index: number, params: Record<string, number | boolean | string>): EffectsPipeline {
  return {
    effects: pipeline.effects.map((e, i) =>
      i === index ? { ...e, params: { ...e.params, ...params } } : e
    ),
  };
}

export function setEffectEnabled(pipeline: EffectsPipeline, index: number, enabled: boolean): EffectsPipeline {
  return {
    effects: pipeline.effects.map((e, i) =>
      i === index ? { ...e, enabled } : e
    ),
  };
}

export function setEffectIntensity(pipeline: EffectsPipeline, index: number, intensity: number): EffectsPipeline {
  return {
    effects: pipeline.effects.map((e, i) =>
      i === index ? { ...e, intensity: Math.max(0, Math.min(1, intensity)) } : e
    ),
  };
}

/**
 * Apply effects pipeline to a raster (for image-based effects).
 * Returns a new raster with effects applied.
 */
export async function applyEffectsToRaster(
  input: Raster,
  pipeline: EffectsPipeline,
  frame: number = 0,
): Promise<Raster> {
  // Ping-pong between two pre-allocated frames: N effects used to allocate a
  // fresh full-frame copy each (N+1 allocations of `width*height*4` bytes per
  // render, all garbage the next render has to collect). The copy itself
  // stays - every effect mutates its target in place and must see the previous
  // frame - but only two buffers are ever allocated, and they are reused for
  // the whole stack.
  let front: Raster = { ...input, data: new Uint8ClampedArray(input.data) };
  let spare: Uint8ClampedArray = new Uint8ClampedArray(input.data.length);

  for (const effect of pipeline.effects) {
    if (!effect.enabled) continue;
    const recycled = front.data;
    front = await applySingleEffect(front, effect, frame, spare);
    spare = recycled;
  }

  return front;
}

async function applySingleEffect(
  input: Raster,
  effect: EffectSettings,
  frame: number,
  target?: Uint8ClampedArray,
): Promise<Raster> {
  const { id, intensity, params } = effect;
  const data = target ?? new Uint8ClampedArray(input.data.length);
  data.set(input.data);
  const output = { ...input, data };
  const { width, height } = output;

  // Simplified effect implementations - in production these would be
  // full shader/GPU implementations. Here we provide CPU fallbacks.

  switch (id) {
    case 'vignette': {
      const radius = num(params.radius, 0.5);
      const feather = num(params.feather, 0.3);
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = (x - cx) / cx;
          const dy = (y - cy) / cy;
          const dist = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2);
          const vignette = Math.max(0, 1 - Math.pow(Math.max(0, (dist - radius) / feather), 2) * intensity);
          const i = (y * width + x) * 4;
          data[i] = Math.round(data[i] * vignette);
          data[i + 1] = Math.round(data[i + 1] * vignette);
          data[i + 2] = Math.round(data[i + 2] * vignette);
        }
      }
      break;
    }
    case 'filmGrain': {
      const strength = num(params.strength, 0.15);
      const monochrome = params.monochrome ?? true;
      const cell = Math.max(1, Math.round(num(params.size, 1)));
      const seed = frame * 7919 + 41;
      const grain = new Uint8ClampedArray(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          grain[y * width + x] =
            (pixelNoise(Math.floor(x / cell), Math.floor(y / cell), seed) - 0.5) *
            255 *
            intensity *
            (strength as number);
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const g = grain[y * width + x];
          if (monochrome) {
            data[i] = clamp255(data[i] + g);
            data[i + 1] = clamp255(data[i + 1] + g);
            data[i + 2] = clamp255(data[i + 2] + g);
          } else {
            data[i] = clamp255(data[i] + g);
            data[i + 1] = clamp255(data[i + 1] + g * 0.5);
            data[i + 2] = clamp255(data[i + 2] - g * 0.5);
          }
        }
      }
      break;
    }
    case 'scanlines': {
      const spacing = Math.max(1, Math.round(num(params.spacing, 2)));
      const opacity = num(params.opacity, 0.3);
      for (let y = 0; y < height; y += spacing) {
        const rowStart = y * width * 4;
        const rowEnd = Math.min(rowStart + width * 4, data.length);
        for (let i = rowStart; i < rowEnd; i += 4) {
          data[i] = Math.round(data[i] * (1 - intensity * opacity));
          data[i + 1] = Math.round(data[i + 1] * (1 - intensity * opacity));
          data[i + 2] = Math.round(data[i + 2] * (1 - intensity * opacity));
        }
      }
      break;
    }
    case 'chromaticAberration': {
      const { offsetR = 2, offsetB = -2, strength: str = 0.5 } = params;
      // Simplified: shift R and B channels slightly
      const temp = new Uint8ClampedArray(data);
      const offR = Math.round((offsetR as number) * intensity);
      const offB = Math.round((offsetB as number) * intensity);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const rx = clampCoord(x + offR, width);
          const bx = clampCoord(x + offB, width);
          const ri = (y * width + rx) * 4;
          const bi = (y * width + bx) * 4;
          const newR = temp[ri];
          const newB = temp[bi + 2];
          data[i] = Math.round(data[i] * (1 - intensity * (str as number)) + newR * intensity * (str as number));
          data[i + 2] = Math.round(data[i + 2] * (1 - intensity * (str as number)) + newB * intensity * (str as number));
        }
      }
      break;
    }
    default:
      // Every other effect lives in imageEffects.ts and mutates `output`.
      applyRasterEffect(output, effect, frame);
      break;
  }

  return output;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clampCoord(v: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.round(v)));
}