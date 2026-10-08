/**
 * Phase 4 end-to-end: content-aware mapping through the real render path.
 *
 * Unit tests pin the strategies in isolation (mapping.test.ts); these prove
 * the renderer actually extracts and passes the per-cell features, that the
 * measured-ink ramp order changes glyph selection, and that older projects
 * (no `inkOrder` field) render exactly as they did before.
 */

import { describe, expect, it } from 'vitest';
import { renderImageToGrid } from '../../src/core/renderImage';
import { createRaster, setPixel } from '../../src/core/image/raster';
import { calibratedGlyph } from '../../src/core/glyph/calibration';
import {
  DEFAULT_IMAGE_RENDER,
  type ImageRenderSettings,
  type MappingOutputSettings,
  type Raster,
} from '../../src/core/types';
import { Rng } from '../../src/core/util';

/** The default ramp typed light -> dark: wrong on purpose, as users do. */
const REVERSED_RAMP = ' .:-=+*#%@';

function noiseRaster(width: number, height: number, seed: number): Raster {
  const raster = createRaster(width, height);
  const rng = new Rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(rng.next() * 255);
      setPixel(raster, x, y, (v << 16) | (v << 8) | v);
    }
  }
  return raster;
}

function gradientRaster(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = width > 1 ? Math.round((x / (width - 1)) * 255) : 0;
      setPixel(raster, x, y, (v << 16) | (v << 8) | v);
    }
  }
  return raster;
}

function settings(over: Partial<ImageRenderSettings> = {}): ImageRenderSettings {
  return {
    ...DEFAULT_IMAGE_RENDER,
    columns: 16,
    aspect: { preset: 'custom', ratio: 1 },
    ...over,
  };
}

function withMapping(strategy: ImageRenderSettings['mapping']['strategy']): ImageRenderSettings {
  return settings({ mapping: { ...DEFAULT_IMAGE_RENDER.mapping, strategy } });
}

function withOutput(output: MappingOutputSettings): ImageRenderSettings {
  return settings({ output });
}

function rowInks(grid: string[], width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const inks: number[] = [];
    for (let x = 0; x < width; x++) inks.push(calibratedGlyph(grid[y * width + x])?.ink ?? 0);
    rows.push(inks);
  }
  return rows;
}

function nonIncreasing(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1] + 1e-9) return false;
  }
  return true;
}

describe('cell features reach the mapping strategy', () => {
  it('gives content-aware strategies information plain luminance never gets', () => {
    const src = noiseRaster(32, 32, 9);
    const plain = renderImageToGrid(src, withMapping('luminance'));
    const detail = renderImageToGrid(src, withMapping('detail'));
    // Without features `detail` degrades to plain luminance, so a differing
    // grid is proof that renderImage extracted and passed the feature planes.
    expect(detail.grid.chars).not.toEqual(plain.grid.chars);
    expect(detail.grid.width).toBe(plain.grid.width);
    expect(detail.grid.height).toBe(plain.grid.height);
  });

  it('falls back to plain luminance in sub-cell modes (no cell plane to align)', () => {
    const src = noiseRaster(32, 32, 9);
    const plain = renderImageToGrid(src, { ...withMapping('luminance'), mode: 'braille' });
    const detail = renderImageToGrid(src, { ...withMapping('detail'), mode: 'braille' });
    expect(detail.grid.chars).toEqual(plain.grid.chars);
  });

  it('leaves the default strategy untouched (zero feature cost when unused)', () => {
    const src = noiseRaster(32, 32, 4);
    const explicit = renderImageToGrid(src, withMapping('luminance'));
    const byDefault = renderImageToGrid(src, settings());
    expect(explicit.grid.chars).toEqual(byDefault.grid.chars);
  });
});

describe('measured ink ordering', () => {
  const src = gradientRaster(32, 32);

  it('defaults to the typed order', () => {
    expect(DEFAULT_IMAGE_RENDER.output.inkOrder).toBe('positional');
  });

  it('renders a reversed ramp monotone in measured ink when enabled', () => {
    const grid = renderImageToGrid(
      src,
      withOutput({
        charset: REVERSED_RAMP,
        offset: 0,
        density: 1,
        invert: false,
        inkOrder: 'measured',
      }),
    );
    expect(grid.grid.width).toBe(16);
    expect(grid.grid.height).toBe(16);
    for (const row of rowInks(grid.grid.chars, grid.grid.width, grid.grid.height)) {
      expect(nonIncreasing(row)).toBe(true);
    }
  });

  it('keeps the typed order for positional, so a reversed ramp stays wrong', () => {
    const grid = renderImageToGrid(
      src,
      withOutput({
        charset: REVERSED_RAMP,
        offset: 0,
        density: 1,
        invert: false,
        inkOrder: 'positional',
      }),
    );
    const rows = rowInks(grid.grid.chars, grid.grid.width, grid.grid.height);
    expect(rows.some((row) => !nonIncreasing(row))).toBe(true);
  });

  it('renders projects written before inkOrder existed as positional', () => {
    const legacyOutput = {
      charset: REVERSED_RAMP,
      offset: 0,
      density: 1,
      invert: false,
    } as MappingOutputSettings;
    const legacy = renderImageToGrid(src, withOutput(legacyOutput));
    const explicit = renderImageToGrid(
      src,
      withOutput({ ...legacyOutput, inkOrder: 'positional' }),
    );
    expect(legacy.grid.chars).toEqual(explicit.grid.chars);
  });

  it('keeps uncalibrated characters instead of dropping them', () => {
    const charset = '😀@#* ';
    const grid = renderImageToGrid(
      src,
      withOutput({ charset, offset: 0, density: 1, invert: false, inkOrder: 'measured' }),
    );
    const allowed = new Set(Array.from(charset));
    for (const ch of grid.grid.chars) expect(allowed.has(ch)).toBe(true);
    expect(new Set(grid.grid.chars).size).toBeGreaterThan(1);
  });
});
