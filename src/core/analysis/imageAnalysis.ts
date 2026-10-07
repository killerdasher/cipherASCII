/**
 * Image analysis: one entry point turns a raster (or a luminance field) into
 * the full set of content-aware {@link AnalysisField}s plus an optional
 * region map.
 *
 * Design rules:
 * - **Everything is a field.** Luminance, contrast, edge, texture, frequency,
 *   coherence, orientation and saliency all travel in the same container, so
 *   Phase 4's mapping strategies can consume them interchangeably.
 * - **Everything is cached.** Each artefact is stored under its own
 *   `fieldCacheKey` (image identity + measure parameters) in an
 *   {@link AnalysisCache}, so asking for a subset, asking twice, or asking
 *   with different parameters only computes what is actually missing.
 * - **Everything is deterministic.** No clocks, no randomness: the same
 *   pixels and options produce byte-identical fields.
 *
 * Pure module: no DOM; the input raster is never mutated.
 */

import { flattenOverWhite, lumaPlane } from '../image/raster';
import type { LuminanceStandard, Raster } from '../types';
import { AnalysisCache } from './cache';
import { fieldCacheKey, fieldFromData, type AnalysisField } from './field';
import {
  contrastField,
  contrastKey,
  edgeField,
  edgeKey,
  frequencyField,
  frequencyKey,
  structureKeys,
  structureTensor,
  textureField,
  textureKey,
  DEFAULT_CONTRAST_RADIUS,
  DEFAULT_FREQUENCY_WINDOW,
  DEFAULT_STRUCTURE_RADIUS,
  DEFAULT_TEXTURE_RADIUS,
} from './measures';
import { saliencyField, saliencyKey, DEFAULT_SALIENCY_SIZE } from './saliency';
import { buildRegionMap, type RegionMap } from './regions';

/** Channels computed on demand; `structure` yields coherence + orientation. */
export type ImageMeasure = 'contrast' | 'edge' | 'texture' | 'frequency' | 'structure' | 'saliency';

/** Every measure, in canonical (deterministic) order. */
export const ALL_IMAGE_MEASURES: readonly ImageMeasure[] = [
  'contrast',
  'edge',
  'texture',
  'frequency',
  'structure',
  'saliency',
];

/**
 * Shared cache for analyses that do not inject their own.
 *
 * Bounded by {@link AnalysisCache}'s defaults (64 entries / 512 MB), so a
 * multi-megapixel photo keeps roughly one image's worth of fields warm.
 */
export const imageAnalysisCache = new AnalysisCache();

export interface ImageAnalysisOptions {
  /**
   * Image identity for cache keys. Defaults to a hash of the pixel bytes for
   * rasters, or the luminance field's own `sourceKey`.
   */
  sourceKey?: string;
  /** Measures to compute; defaults to every measure. Duplicates collapse. */
  measures?: readonly ImageMeasure[];
  /** Luminance weights used to build the plane (rasters only). */
  lumaStandard?: LuminanceStandard;
  /** Local standard deviation radius (default {@link DEFAULT_CONTRAST_RADIUS}). */
  contrastRadius?: number;
  /** Detail residual radius (default {@link DEFAULT_TEXTURE_RADIUS}). */
  textureRadius?: number;
  /** Structure-tensor radius (default {@link DEFAULT_STRUCTURE_RADIUS}). */
  structureRadius?: number;
  /** Frequency counting block edge (default {@link DEFAULT_FREQUENCY_WINDOW}). */
  frequencyWindow?: number;
  /** Saliency scratch grid edge (default {@link DEFAULT_SALIENCY_SIZE}). */
  saliencySize?: number;
  /** Region block edge; `0`/undefined skips the region map. */
  regionSize?: number;
  /** Cache to fill; defaults to {@link imageAnalysisCache}. */
  cache?: AnalysisCache;
}

export interface ImageAnalysisResult {
  /** Cache key of this exact configuration (`image:<sourceKey>:<params>`). */
  key: string;
  /** Image identity the keys are derived from. */
  sourceKey: string;
  width: number;
  height: number;
  /** Luminance plane; always present. */
  luma: AnalysisField;
  /** Measures actually computed, canonical order. */
  measures: readonly ImageMeasure[];
  contrast: AnalysisField | null;
  edge: AnalysisField | null;
  texture: AnalysisField | null;
  frequency: AnalysisField | null;
  /** Structure-tensor pair; both set iff `structure` was requested. */
  coherence: AnalysisField | null;
  orientation: AnalysisField | null;
  saliency: AnalysisField | null;
  regions: RegionMap | null;
}

function normalizeMeasures(measures?: readonly ImageMeasure[]): ImageMeasure[] {
  const wanted = measures ?? ALL_IMAGE_MEASURES;
  const seen = new Set<ImageMeasure>();
  for (const measure of wanted) {
    if (!ALL_IMAGE_MEASURES.includes(measure)) {
      throw new RangeError(`unknown image measure "${String(measure)}"`);
    }
    seen.add(measure);
  }
  return ALL_IMAGE_MEASURES.filter((measure) => seen.has(measure));
}

/**
 * FNV-1a over the pixel bytes, tagged with the byte count so buffers of
 * different lengths never collide. Used as the default cache identity when a
 * raster arrives without an explicit `sourceKey`.
 *
 * @param data - RGBA pixel bytes
 * @returns stable cache identity
 */
export function pixelSignature(data: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  if (data.byteOffset % 4 === 0 && data.byteLength % 4 === 0) {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    for (let i = 0; i < words.length; i++) {
      h ^= words[i] & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (words[i] >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (words[i] >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= words[i] >>> 24;
      h = Math.imul(h, 0x01000193);
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  return `px${data.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

/**
 * Analyze an already-built luminance field.
 *
 * @param luma - luminance field (0..1); its `sourceKey` seeds every cache key,
 *   so anonymous fields (`sourceKey === ''`) only make sense with an injected
 *   cache
 * @param options - subset of measures, parameters and cache (see
 *   {@link ImageAnalysisOptions})
 * @returns the requested fields; unrequested channels are `null`
 * @throws RangeError on unknown measures or an invalid `regionSize`
 */
export function analyzeLumaField(
  luma: AnalysisField,
  options: ImageAnalysisOptions = {},
): ImageAnalysisResult {
  const cache = options.cache ?? imageAnalysisCache;
  const measures = normalizeMeasures(options.measures);
  const sourceKey = options.sourceKey ?? luma.sourceKey;
  const params = {
    contrastRadius: options.contrastRadius ?? DEFAULT_CONTRAST_RADIUS,
    textureRadius: options.textureRadius ?? DEFAULT_TEXTURE_RADIUS,
    structureRadius: options.structureRadius ?? DEFAULT_STRUCTURE_RADIUS,
    frequencyWindow: options.frequencyWindow ?? DEFAULT_FREQUENCY_WINDOW,
    saliencySize: options.saliencySize ?? DEFAULT_SALIENCY_SIZE,
  };
  const wanted = (measure: ImageMeasure) => measures.includes(measure);
  const from = luma.sourceKey;

  const contrast = wanted('contrast')
    ? cache.getOrCompute(contrastKey(from, params.contrastRadius), () =>
        contrastField(luma, params.contrastRadius),
      )
    : null;
  const edge = wanted('edge')
    ? cache.getOrCompute(edgeKey(from), () => edgeField(luma))
    : null;
  const texture = wanted('texture')
    ? cache.getOrCompute(textureKey(from, params.textureRadius), () =>
        textureField(luma, params.textureRadius),
      )
    : null;
  const frequency = wanted('frequency')
    ? cache.getOrCompute(frequencyKey(from, params.frequencyWindow), () =>
        frequencyField(luma, params.frequencyWindow),
      )
    : null;

  // The tensor produces a pair; on a cold cache it is computed once and both
  // halves are stored under their own field keys.
  let coherence: AnalysisField | null = null;
  let orientation: AnalysisField | null = null;
  if (wanted('structure')) {
    const keys = structureKeys(from, params.structureRadius);
    coherence = cache.get(keys.coherence) ?? null;
    orientation = cache.get(keys.orientation) ?? null;
    if (!coherence || !orientation) {
      const pair = structureTensor(luma, params.structureRadius);
      coherence = pair.coherence;
      orientation = pair.orientation;
      cache.set(keys.coherence, coherence);
      cache.set(keys.orientation, orientation);
    }
  }

  const saliency = wanted('saliency')
    ? cache.getOrCompute(saliencyKey(from, params.saliencySize), () =>
        saliencyField(luma, params.saliencySize),
      )
    : null;

  const regionSize = options.regionSize ?? 0;
  let regions: RegionMap | null = null;
  if (regionSize !== 0) {
    if (!Number.isInteger(regionSize) || regionSize < 1) {
      throw new RangeError(`region size must be a positive integer, got ${regionSize}`);
    }
    const channelKeys = [contrast, edge, texture, frequency, coherence, orientation, saliency]
      .filter((field): field is AnalysisField => field !== null)
      .map((field) => field.sourceKey);
    const regionKey = fieldCacheKey('regions', { from, size: regionSize, channels: channelKeys });
    regions = cache.getOrCompute(regionKey, () =>
      buildRegionMap(
        {
          luma,
          contrast: contrast ?? undefined,
          edge: edge ?? undefined,
          texture: texture ?? undefined,
          frequency: frequency ?? undefined,
          coherence: coherence ?? undefined,
          orientation: orientation ?? undefined,
          saliency: saliency ?? undefined,
        },
        regionSize,
      ),
    );
  }

  const key = fieldCacheKey(`image:${sourceKey}`, {
    from: luma.sourceKey,
    measures,
    regionSize,
    ...params,
  });
  return {
    key,
    sourceKey,
    width: luma.width,
    height: luma.height,
    luma,
    measures,
    contrast,
    edge,
    texture,
    frequency,
    coherence,
    orientation,
    saliency,
    regions,
  };
}

/**
 * Analyze a raster: build the luminance plane (compositing over white when
 * the image carries alpha), then run {@link analyzeLumaField}.
 *
 * @param raster - RGBA raster; never mutated
 * @param options - see {@link ImageAnalysisOptions}
 * @returns the requested fields for `raster`
 * @throws RangeError on bad dimensions, a data length mismatch, unknown
 *   measures or an invalid `regionSize`
 */
export function analyzeImage(raster: Raster, options: ImageAnalysisOptions = {}): ImageAnalysisResult {
  if (!Number.isInteger(raster.width) || raster.width <= 0) {
    throw new RangeError(`raster width must be a positive integer, got ${raster.width}`);
  }
  if (!Number.isInteger(raster.height) || raster.height <= 0) {
    throw new RangeError(`raster height must be a positive integer, got ${raster.height}`);
  }
  if (raster.data.length !== raster.width * raster.height * 4) {
    throw new RangeError(
      `raster data has ${raster.data.length} bytes but ${raster.width}x${raster.height} RGBA needs ${raster.width * raster.height * 4}`,
    );
  }
  const cache = options.cache ?? imageAnalysisCache;
  const sourceKey = options.sourceKey ?? pixelSignature(raster.data);
  const standard: LuminanceStandard = options.lumaStandard ?? 'rec709';
  const lumaKey = fieldCacheKey(`luma:${sourceKey}`, { standard });
  const luma = cache.getOrCompute(lumaKey, () => {
    const flat = flattenOverWhite(raster);
    return fieldFromData('luma', raster.width, raster.height, lumaPlane(flat, standard), lumaKey);
  });
  return analyzeLumaField(luma, { ...options, sourceKey, cache });
}
