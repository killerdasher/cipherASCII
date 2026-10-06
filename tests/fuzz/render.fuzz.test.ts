/**
 * Property tests for the image -> ASCII pipeline: random rasters and settings
 * must never throw, never exceed the documented limits, and always return a
 * grid whose buffers line up. Seeds are fixed so a failure is reproducible.
 */

import { describe, expect, it } from 'vitest';
import { renderImageToGrid, MAX_COLUMNS, MAX_ROWS } from '../../src/core/renderImage';
import { createRaster, setPixel } from '../../src/core/image/raster';
import { DITHER_IDS } from '../../src/core/dither';
import { CHARSET_PRESETS, listMappingStrategies } from '../../src/core/mapping';
import {
  DEFAULT_IMAGE_RENDER,
  type ColorMode,
  type ImageRenderSettings,
  type RenderMode,
  type Raster,
  type RenderResult,
} from '../../src/core/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x1badb002);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

function randomRaster(width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Mix of saturated colours, greys and fully transparent pixels.
      const roll = rand();
      if (roll < 0.15) setPixel(raster, x, y, 0x000000, 0);
      else if (roll < 0.4) setPixel(raster, x, y, int(0, 0xffffff));
      else {
        const v = int(0, 255);
        setPixel(raster, x, y, (v << 16) | (v << 8) | v, int(0, 255));
      }
    }
  }
  return raster;
}

function randomSettings(): ImageRenderSettings {
  const base = structuredClone(DEFAULT_IMAGE_RENDER);
  const strategies = listMappingStrategies();
  const charset = pick(CHARSET_PRESETS);
  const modes: RenderMode[] = ['chars', 'braille', 'halfblocks', 'quadrants'];
  const colorModes: ColorMode[] = ['none', 'sample', 'ansi16', 'ansi256', 'truecolor'];
  const aspets: ImageRenderSettings['aspect']['preset'][] = [
    'terminal',
    'square',
    'narrow',
    'wide',
    'custom',
  ];
  return {
    ...base,
    columns: int(1, 200),
    aspect: { preset: pick(aspets), ratio: 0.1 + rand() * 2 },
    mode: pick(modes),
    colorMode: pick(colorModes),
    mapping: {
      ...base.mapping,
      strategy: pick(strategies).id as ImageRenderSettings['mapping']['strategy'],
      radius: int(0, 8),
      threshold: rand(),
      strength: rand() * 2,
      curve:
        rand() < 0.3
          ? [
              { x: 0, y: rand() },
              { x: 0.5, y: rand() },
              { x: 1, y: rand() },
            ]
          : [],
    },
    dither: {
      algorithm: pick(DITHER_IDS),
      strength: rand(),
      serpentine: rand() < 0.5,
      matrixSize: rand() < 0.5 ? 4 : 8,
    },
    output: {
      ...base.output,
      charset: charset.chars,
      offset: int(-4, 4),
      density: 0.2 + rand() * 2,
      invert: rand() < 0.5,
    },
  };
}

describe('fuzz: image -> ASCII render', () => {
  it('never throws and always returns a self-consistent grid', () => {
    for (let iteration = 0; iteration < 60; iteration++) {
      const raster = randomRaster(int(1, 48), int(1, 48));
      const settings = randomSettings();

      let result: RenderResult | undefined;
      expect(() => {
        result = renderImageToGrid(raster, settings);
      }).not.toThrow();
      if (!result) continue;

      const grid = result.grid;
      expect(grid.width).toBeGreaterThanOrEqual(1);
      expect(grid.height).toBeGreaterThanOrEqual(1);
      expect(grid.width).toBeLessThanOrEqual(MAX_COLUMNS);
      expect(grid.height).toBeLessThanOrEqual(MAX_ROWS);
      expect(grid.chars.length).toBe(grid.width * grid.height);
      expect(grid.fg === null || grid.fg.length === grid.chars.length).toBe(true);
      expect(grid.bg === null || grid.bg.length === grid.chars.length).toBe(true);
      for (const cell of grid.chars.slice(0, 64)) {
        expect(typeof cell).toBe('string');
        expect(cell.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('degenerate dimensions still produce a grid', () => {
    for (const [width, height] of [
      [1, 1],
      [1, 32],
      [32, 1],
      [3, 3],
    ] as const) {
      const raster = randomRaster(width, height);
      const settings: ImageRenderSettings = {
        ...structuredClone(DEFAULT_IMAGE_RENDER),
        columns: 1,
        aspect: { preset: 'custom', ratio: 0.01 },
      };
      const { grid } = renderImageToGrid(raster, settings);
      expect(grid.chars.length).toBe(grid.width * grid.height);
      expect(grid.width).toBeLessThanOrEqual(MAX_COLUMNS);
      expect(grid.height).toBeLessThanOrEqual(MAX_ROWS);
    }
  });
});
