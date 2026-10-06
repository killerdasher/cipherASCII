/**
 * `effectSpace` decides where the raster effect stack runs:
 *
 * - `'source'` (default): on the full-resolution image, before the downscale.
 *   Unchanged from the original pipeline.
 * - `'grid'`: between resize and preprocessing, on the downscaled raster -
 *   the split the worker uses via `prepareSampledRaster` / `rasterToGrid`.
 */

import { describe, expect, it } from 'vitest';
import {
  prepareSampledRaster,
  rasterToGrid,
  renderImageToGrid,
} from '../../src/core/renderImage';
import { applyEffectsToRaster } from '../../src/core/effects/pipeline';
import {
  DEFAULT_IMAGE_RENDER,
  type EffectsPipeline,
  type ImageRenderSettings,
  type Raster,
} from '../../src/core/types';

function makeRaster(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = (x * 3) & 0xff;
      data[i + 1] = (y * 5) & 0xff;
      data[i + 2] = ((x + y) * 7) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const scanlines: EffectsPipeline = {
  effects: [{ id: 'scanlines', enabled: true, intensity: 1, params: { spacing: 2, opacity: 1 } }],
};

/** Same render, minus the wall-clock duration (which is never equal). */
const same = (r: ReturnType<typeof renderImageToGrid>) => ({
  ...r,
  stats: { ...r.stats, durationMs: 0 },
});

const settings = (over: Partial<ImageRenderSettings> = {}): ImageRenderSettings => ({
  ...structuredClone(DEFAULT_IMAGE_RENDER),
  columns: 80,
  ...over,
});

describe('prepareSampledRaster / rasterToGrid split', () => {
  for (const mode of ['chars', 'braille', 'halfblocks'] as const) {
    it(`matches renderImageToGrid in ${mode} mode`, () => {
      const src = makeRaster(320, 240);
      const s = settings({ mode });
      expect(same(rasterToGrid(src, prepareSampledRaster(src, s), s))).toEqual(
        same(renderImageToGrid(src, s)),
      );
    });
  }

  it('matches when cropping and cover-fit are active', () => {
    const src = makeRaster(500, 200);
    const s = settings({
      fit: 'cover',
      crop: { enabled: true, x: 0.2, y: 0.1, width: 0.5, height: 0.7 },
    });
    expect(same(rasterToGrid(src, prepareSampledRaster(src, s), s))).toEqual(
      same(renderImageToGrid(src, s)),
    );
  });

  it('produces a sample at grid resolution, not source resolution', () => {
    const src = makeRaster(4000, 3000);
    const stage = prepareSampledRaster(src, settings({ columns: 100 }));
    expect(stage.sampled.width * stage.sampled.height).toBeLessThan(src.width * src.height / 100);
    expect(stage.cols).toBe(100);
  });
});

describe('effectSpace: grid', () => {
  it('runs the stack on the downscaled raster and yields a valid grid', async () => {
    const src = makeRaster(1600, 1200);
    const s = settings({ effectSpace: 'grid' });
    const stage = prepareSampledRaster(src, s);
    const effected = await applyEffectsToRaster(stage.sampled, scanlines);
    expect(effected.width).toBe(stage.sampled.width);
    expect(effected.height).toBe(stage.sampled.height);
    // opacity 1 on every second sample row must actually darken the frame
    expect(effected).not.toEqual(stage.sampled);

    const grid = rasterToGrid(effected, { ...stage, sampled: effected }, s).grid;
    expect(grid.width).toBe(80);
    expect(grid.height).toBeGreaterThan(0);
    expect(grid.chars.join('')).not.toBe('');
  });

  it('gives a different result from running the same stack at source resolution', async () => {
    const src = makeRaster(800, 600);
    const s = settings({ effectSpace: 'grid' });

    // grid space
    const stage = prepareSampledRaster(src, s);
    const gridEffected = await applyEffectsToRaster(stage.sampled, scanlines);
    const gridOut = rasterToGrid(gridEffected, { ...stage, sampled: gridEffected }, s);

    // source space (what the default path does)
    const sourceEffected = await applyEffectsToRaster(src, scanlines);
    const sourceOut = renderImageToGrid(sourceEffected, s);

    expect(gridOut.grid).not.toEqual(sourceOut.grid);
  });

  it('leaves the default path untouched when effectSpace is source', () => {
    const src = makeRaster(400, 300);
    const s = settings({ effectSpace: 'source' });
    expect(same(renderImageToGrid(src, s))).toEqual(
      same(rasterToGrid(src, prepareSampledRaster(src, s), s)),
    );
  });
});
