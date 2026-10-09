import { describe, it, expect } from 'vitest';
import {
  ALL_IMAGE_MEASURES,
  analyzeImage,
  analyzeLumaField,
  imageAnalysisCache,
  pixelSignature,
} from '../../src/core/analysis/imageAnalysis';
import { AnalysisCache } from '../../src/core/analysis/cache';
import { textureKey } from '../../src/core/analysis/measures';
import { fieldFromData, type AnalysisField } from '../../src/core/analysis/field';
import { analysisSampleSize } from '../../src/core/analysis/sampleSize';
import type { Raster } from '../../src/core/types';

const W = 40;
const H = 28;

/** Dark field with a bright disc - enough structure for every measure. */
function testRaster(width = W, height = H): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x - width / 2;
      const dy = y - height / 2;
      const v = dx * dx + dy * dy <= 36 ? 230 : 40;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function lumaField(sourceKey: string): AnalysisField {
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) data[y * W + x] = (x + y) / (W + H);
  }
  return fieldFromData('luma', W, H, data, sourceKey);
}

function inUnitRange(field: AnalysisField): boolean {
  for (const v of field.data) {
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

describe('pixelSignature', () => {
  it('is stable for identical bytes and separates different ones', () => {
    const a = testRaster();
    const b = testRaster();
    const c = testRaster(39, H);
    expect(pixelSignature(a.data)).toBe(pixelSignature(b.data));
    expect(pixelSignature(a.data)).not.toBe(pixelSignature(c.data));
    expect(pixelSignature(a.data)).toMatch(/^px/);
  });

  it('agrees across buffer alignments', () => {
    const raster = testRaster();
    const padded = new Uint8ClampedArray(raster.data.length + 1);
    padded.set(raster.data, 1);
    const view = padded.subarray(1); // byteOffset 1: exercises the byte path
    expect(pixelSignature(view)).toBe(pixelSignature(raster.data));
  });
});

describe('analyzeImage', () => {
  it('returns every measure in canonical order at source size', () => {
    const cache = new AnalysisCache(64);
    const result = analyzeImage(testRaster(), { cache, regionSize: 14 });
    expect(result.measures).toEqual(ALL_IMAGE_MEASURES);
    expect(result.width).toBe(W);
    expect(result.height).toBe(H);
    expect(result.luma.width).toBe(W);
    expect(result.sourceKey).toBe(pixelSignature(testRaster().data));
    for (const field of [
      result.contrast,
      result.edge,
      result.texture,
      result.frequency,
      result.coherence,
      result.saliency,
    ]) {
      expect(field).not.toBeNull();
      expect(field!.width).toBe(W);
      expect(field!.height).toBe(H);
      expect(inUnitRange(field!)).toBe(true);
    }
    // Orientation is an angle, not a magnitude: [0, pi).
    expect(result.orientation).not.toBeNull();
    for (const v of result.orientation!.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(Math.PI);
    }
    expect(result.regions).not.toBeNull();
    expect(result.regions!.cols).toBe(Math.ceil(W / 14));
    expect(result.regions!.rows).toBe(Math.ceil(H / 14));
    expect(result.key).toMatch(/^image:/);
  });

  it('computes only the requested measures and leaves the rest null', () => {
    const cache = new AnalysisCache(64);
    const edgeOnly = analyzeImage(testRaster(), { cache, measures: ['edge'] });
    expect(edgeOnly.measures).toEqual(['edge']);
    expect(edgeOnly.edge).not.toBeNull();
    expect(edgeOnly.contrast).toBeNull();
    expect(edgeOnly.texture).toBeNull();
    expect(edgeOnly.frequency).toBeNull();
    expect(edgeOnly.coherence).toBeNull();
    expect(edgeOnly.orientation).toBeNull();
    expect(edgeOnly.saliency).toBeNull();
    expect(edgeOnly.regions).toBeNull();

    const structure = analyzeImage(testRaster(), {
      cache,
      measures: ['structure', 'structure'], // duplicates collapse
    });
    expect(structure.measures).toEqual(['structure']);
    expect(structure.coherence).not.toBeNull();
    expect(structure.orientation).not.toBeNull();
    expect(structure.key).not.toBe(edgeOnly.key);
  });

  it('reuses the cache: a warm repeat is all hits', () => {
    const cache = new AnalysisCache(64);
    const options = { cache, regionSize: 14 };
    analyzeImage(testRaster(), options);
    const before = cache.stats();
    analyzeImage(testRaster(), options);
    const after = cache.stats();
    expect(after.misses).toBe(before.misses);
    expect(after.hits).toBeGreaterThan(before.hits);
  });

  it('computes only the missing channel when the request grows', () => {
    const cache = new AnalysisCache(64);
    analyzeImage(testRaster(), { cache, measures: ['contrast'] });
    const before = cache.stats();
    const grown = analyzeImage(testRaster(), { cache, measures: ['contrast', 'edge'] });
    const after = cache.stats();
    expect(grown.contrast).not.toBeNull();
    expect(grown.edge).not.toBeNull();
    expect(after.misses - before.misses).toBe(1); // just the edge field
    expect(after.hits - before.hits).toBeGreaterThanOrEqual(1); // luma + contrast
  });

  it('separates luminance standards into distinct cache entries', () => {
    const cache = new AnalysisCache(64);
    const rec709 = analyzeImage(testRaster(), { cache, lumaStandard: 'rec709' });
    const rec601 = analyzeImage(testRaster(), { cache, lumaStandard: 'rec601' });
    expect(rec709.key).not.toBe(rec601.key);
    expect(rec709.contrast!.sourceKey).not.toBe(rec601.contrast!.sourceKey);
    // Same pixels, so the grey-only rasters coincide numerically anyway; the
    // keys still must not collide once colour enters the plane.
    expect(cache.stats().size).toBeGreaterThan(4);
  });

  it('is deterministic across independent caches', () => {
    const a = analyzeImage(testRaster(), { cache: new AnalysisCache(64), regionSize: 14 });
    const b = analyzeImage(testRaster(), { cache: new AnalysisCache(64), regionSize: 14 });
    expect(a.key).toBe(b.key);
    expect(a.edge!.data).toEqual(b.edge!.data);
    expect(a.saliency!.data).toEqual(b.saliency!.data);
    expect(a.regions!.stats).toEqual(b.regions!.stats);
  });

  it('composites transparent pixels over white', () => {
    const transparent: Raster = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(4 * 4 * 4), // black with alpha 0
    };
    const opaqueBlack: Raster = {
      width: 4,
      height: 4,
      data: (() => {
        const d = new Uint8ClampedArray(4 * 4 * 4);
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
        return d;
      })(),
    };
    const clear = analyzeImage(transparent, { cache: new AnalysisCache(8), measures: [] });
    expect(clear.luma.mean).toBeCloseTo(1, 6);
    const black = analyzeImage(opaqueBlack, { cache: new AnalysisCache(8), measures: [] });
    expect(black.luma.mean).toBeCloseTo(0, 6);
  });

  it('honours an explicit source key over the pixel hash', () => {
    const cache = new AnalysisCache(8);
    const result = analyzeImage(testRaster(), { cache, sourceKey: 'layer:7', measures: [] });
    expect(result.sourceKey).toBe('layer:7');
    expect(result.key).toMatch(/^image:layer:7:/);
    expect(cache.get(result.luma.sourceKey)).toBe(result.luma);
  });

  it('rejects bad rasters, measures and region sizes', () => {
    const cache = new AnalysisCache(8);
    const raster = testRaster();
    expect(() => analyzeImage({ ...raster, width: 0 }, { cache })).toThrow(RangeError);
    expect(() => analyzeImage({ ...raster, width: 1.5 }, { cache })).toThrow(RangeError);
    expect(() => analyzeImage({ ...raster, data: new Uint8ClampedArray(10) }, { cache })).toThrow(
      RangeError,
    );
    expect(() =>
      analyzeImage(raster, { cache, measures: ['nope' as never] }),
    ).toThrow(RangeError);
    for (const regionSize of [-1, 0.5]) {
      expect(() => analyzeImage(raster, { cache, regionSize })).toThrow(RangeError);
    }
  });

  it('skips the region map when regionSize is 0 or unset', () => {
    const cache = new AnalysisCache(8);
    expect(analyzeImage(testRaster(), { cache, regionSize: 0, measures: [] }).regions).toBeNull();
    expect(analyzeImage(testRaster(), { cache, measures: [] }).regions).toBeNull();
  });
});

describe('analyzeLumaField', () => {
  it('keys measures from the field source key and honors overrides', () => {
    const cache = new AnalysisCache(64);
    const result = analyzeLumaField(lumaField('img:1'), {
      cache,
      measures: ['texture'],
      textureRadius: 5,
    });
    expect(result.sourceKey).toBe('img:1');
    expect(result.texture!.sourceKey).toBe(textureKey('img:1', 5));
    expect(cache.get(result.texture!.sourceKey)).toBe(result.texture);
    // A different radius misses, the same one hits.
    const before = cache.stats();
    analyzeLumaField(lumaField('img:1'), { cache, measures: ['texture'], textureRadius: 5 });
    expect(cache.stats().misses).toBe(before.misses);
    analyzeLumaField(lumaField('img:1'), { cache, measures: ['texture'], textureRadius: 2 });
    expect(cache.stats().misses).toBeGreaterThan(before.misses);
  });

  it('accepts a source key that differs from the field key', () => {
    const result = analyzeLumaField(lumaField('anon'), {
      cache: new AnalysisCache(8),
      sourceKey: 'layer:3',
      measures: [],
    });
    expect(result.sourceKey).toBe('layer:3');
    expect(result.key).toMatch(/^image:layer:3:/);
    expect(result.key).not.toMatch(/^image:anon:/);
  });

  it('produces region aggregates over the field', () => {
    const result = analyzeLumaField(lumaField('img:2'), {
      cache: new AnalysisCache(64),
      measures: ['contrast'],
      regionSize: 14,
    });
    const regions = result.regions!;
    expect(regions.stats).toHaveLength(regions.cols * regions.rows);
    for (const stat of regions.stats) {
      expect(stat.luma).toBeGreaterThanOrEqual(0);
      expect(stat.contrast).toBeGreaterThanOrEqual(0);
      expect(stat.edge).toBe(0); // not analyzed
      expect(stat.toneHigh).toBeGreaterThanOrEqual(stat.toneLow);
    }
  });
});

describe('imageAnalysisCache', () => {
  it('is a bounded shared default', () => {
    expect(imageAnalysisCache).toBeInstanceOf(AnalysisCache);
    const before = imageAnalysisCache.stats().size;
    analyzeImage(testRaster(), { measures: [] });
    expect(imageAnalysisCache.stats().size).toBeGreaterThan(before);
    imageAnalysisCache.clear();
    expect(imageAnalysisCache.stats().size).toBe(0);
  });
});

describe('analysisSampleSize', () => {
  it('follows the requested column count within the [8, 240] clamp', () => {
    expect(analysisSampleSize(1000, 500, 100)).toEqual({ width: 100, height: 25 });
    expect(analysisSampleSize(4000, 2000, 1000)).toEqual({ width: 240, height: 60 });
    expect(analysisSampleSize(4000, 2000, 4)).toEqual({ width: 8, height: 8 });
  });

  it('never drops below 8x8 whatever the source', () => {
    expect(analysisSampleSize(4, 4)).toEqual({ width: 8, height: 8 });
    expect(analysisSampleSize(1, 10000, 400)).toEqual({ width: 8, height: 240 });
  });

  it('keeps the 2x cell aspect for typical photos', () => {
    // 16:9 photo at 100 columns: 100 * 0.5 * 9/16 ≈ 28 rows
    expect(analysisSampleSize(1920, 1080, 100)).toEqual({ width: 100, height: 28 });
  });
});
