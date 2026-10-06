import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFECT_PARAMS,
  EFFECT_PRESETS,
  addEffect,
  applyEffectsToRaster,
  createEffectsPipeline,
  setEffectEnabled,
} from '../../src/core/effects/pipeline';
import { RASTER_EFFECT_IDS, applyRasterEffect } from '../../src/core/effects/imageEffects';
import { createRaster } from '../../src/core/image/raster';
import type { EffectId, Raster } from '../../src/core/types';

/** Textured 32x32 source: gradient, checker and a bright highlight. */
function textured(width = 32, height = 32): Raster {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = Math.round((x / (width - 1)) * 180 + (y / (height - 1)) * 74);
      const checker = (x + y) % 4 === 0 ? 40 : 0;
      // A blown-out highlight so threshold effects (bloom, epsilon glow) bite.
      const lit = x >= width - 6 && y < 6;
      const r = lit ? 248 : Math.min(255, base + checker);
      const g = lit ? 252 : Math.min(255, 255 - base);
      const b = lit ? 255 : Math.min(255, Math.round(base / 2) + checker);
      const i = (y * width + x) * 4;
      raster.data[i] = r;
      raster.data[i + 1] = g;
      raster.data[i + 2] = b;
      raster.data[i + 3] = 255;
    }
  }
  return raster;
}

function differingBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
  return count;
}

function paramsFor(id: (typeof EFFECT_PRESETS)[number]['id']): Record<string, number | boolean | string> {
  const base = { ...DEFAULT_EFFECT_PARAMS[id] };
  // The shipped default is a neutral offset (the slider starts at zero), so
  // give it a visible value the way a user would.
  if (id === 'colorShift') base.hue = 90;
  return base;
}

describe('effects pipeline', () => {
  it('advertises every effect id once and knows how to run all of them', () => {
    const ids = EFFECT_PRESETS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
    expect(ids).not.toContain('none' as (typeof ids)[number]);
    expect(RASTER_EFFECT_IDS.length).toBe(16);
    // The five legacy effects stay in pipeline.ts; the rest are delegated.
    for (const id of ['vignette', 'filmGrain', 'scanlines', 'chromaticAberration'] as const) {
      expect(RASTER_EFFECT_IDS).not.toContain(id);
    }
  });

  it.each(EFFECT_PRESETS.map((e) => [e.id] as const))('%s changes a textured raster', async (id) => {
    const input = textured();
    const before = new Uint8ClampedArray(input.data);
    const pipeline = createEffectsPipeline();
    const withEffect = addEffect(pipeline, id, paramsFor(id));
    withEffect.effects[0].intensity = 1;

    const output = await applyEffectsToRaster(input, withEffect);

    expect(output.width).toBe(input.width);
    expect(output.height).toBe(input.height);
    expect(output.data.length).toBe(input.data.length);
    expect(differingBytes(output.data, before)).toBeGreaterThan(0);
    // The source raster must never be mutated in place.
    expect(differingBytes(input.data, before)).toBe(0);
  });

  it.each(['blur', 'bloom', 'noise', 'vignette', 'diffractionStars'] as const)(
    '%s honours intensity 0',
    async (id) => {
      const input = textured();
      const before = new Uint8ClampedArray(input.data);
      const pipeline = addEffect(createEffectsPipeline(), id, paramsFor(id));
      pipeline.effects[0].intensity = 0;

      const output = await applyEffectsToRaster(input, pipeline);
      expect(differingBytes(output.data, before)).toBe(0);
    },
  );

  it('skips disabled effects', async () => {
    const input = textured();
    const before = new Uint8ClampedArray(input.data);
    const pipeline = setEffectEnabled(addEffect(createEffectsPipeline(), 'scanlines'), 0, false);

    const output = await applyEffectsToRaster(input, pipeline);
    expect(differingBytes(output.data, before)).toBe(0);
  });

  it('is deterministic: the same input yields the same output', async () => {
    const pipeline = addEffect(createEffectsPipeline(), 'filmGrain');
    const a = await applyEffectsToRaster(textured(), pipeline);
    const b = await applyEffectsToRaster(textured(), pipeline);
    expect(differingBytes(a.data, b.data)).toBe(0);
  });

  it('runs the whole stack without destroying the image', async () => {
    let pipeline = createEffectsPipeline();
    for (const meta of EFFECT_PRESETS) {
      pipeline = addEffect(pipeline, meta.id, paramsFor(meta.id));
    }
    const output = await applyEffectsToRaster(textured(), pipeline);
    const nonBlack = [...output.data].filter((v, i) => i % 4 !== 3 && v > 8).length;
    expect(nonBlack).toBeGreaterThan(0);
    expect(output.data.length).toBe(32 * 32 * 4);
  });

  it('applies effects in pipeline order', async () => {
    const colorThenGrain = addEffect(addEffect(createEffectsPipeline(), 'colorShift', { hue: 180 }), 'filmGrain');
    const grainThenColor = addEffect(addEffect(createEffectsPipeline(), 'filmGrain'), 'colorShift', { hue: 180 });

    const a = await applyEffectsToRaster(textured(), colorThenGrain);
    const b = await applyEffectsToRaster(textured(), grainThenColor);
    expect(differingBytes(a.data, b.data)).toBeGreaterThan(0);
  });

  it('leaves ids it does not own alone', () => {
    const input = textured();
    const before = new Uint8ClampedArray(input.data);
    expect(
      applyRasterEffect(input, { id: 'none', enabled: true, intensity: 1, params: {} }),
    ).toBe(false);
    expect(
      applyRasterEffect(input, { id: 'vignette', enabled: true, intensity: 1, params: {} }),
    ).toBe(false);
    expect(
      applyRasterEffect(input, { id: 'not-an-effect' as EffectId, enabled: true, intensity: 1, params: {} }),
    ).toBe(false);
    expect(differingBytes(input.data, before)).toBe(0);
  });
});

describe('diffractionStars', () => {
  /** Black field with one (optionally dim) highlight in the centre. */
  function starField(highlight = 255, size = 21): Raster {
    const raster = createRaster(size, size);
    const c = Math.floor(size / 2);
    const o = (c * size + c) * 4;
    raster.data[o] = highlight;
    raster.data[o + 1] = highlight;
    raster.data[o + 2] = highlight;
    return raster;
  }

  function starPipeline(params: Record<string, number | boolean | string>) {
    const pipeline = addEffect(createEffectsPipeline(), 'diffractionStars', params);
    pipeline.effects[0].intensity = 1;
    return pipeline;
  }

  const at = (raster: Raster, x: number, y: number): number =>
    raster.data[(y * raster.width + x) * 4];

  it('radiates axis-aligned rays from an isolated highlight', async () => {
    const input = starField();
    const before = new Uint8ClampedArray(input.data);
    const output = await applyEffectsToRaster(
      input,
      starPipeline({ spikes: 4, threshold: 0.5, length: 8, blur: 0, angle: 0 }),
    );

    expect(at(output, 14, 10)).toBeGreaterThan(0); // ray to the right
    expect(at(output, 10, 14)).toBeGreaterThan(0); // ray downward
    expect(at(output, 6, 10)).toBeGreaterThan(0); // ray to the left
    expect(at(output, 14, 14)).toBe(0); // 4 spikes means no diagonal
    expect(at(output, 2, 2)).toBe(0); // far corner untouched
    // The source raster is never mutated.
    expect(differingBytes(input.data, before)).toBe(0);
  });

  it('leaves highlights below the threshold untouched', async () => {
    const input = starField(200);
    const before = new Uint8ClampedArray(input.data);
    const output = await applyEffectsToRaster(
      input,
      starPipeline({ spikes: 6, threshold: 0.99, length: 8, blur: 0, angle: 0 }),
    );
    expect(differingBytes(output.data, before)).toBe(0);
  });

  it('emits a single star for an equal-brightness plateau', async () => {
    // Two adjacent identical highlights: only the first in scan order may
    // emit, otherwise the ray at x=7 would receive both contributions.
    const input = createRaster(9, 5);
    for (const x of [4, 5]) {
      const o = (2 * 9 + x) * 4;
      input.data[o] = 255;
      input.data[o + 1] = 255;
      input.data[o + 2] = 255;
    }
    const output = await applyEffectsToRaster(
      input,
      starPipeline({ spikes: 4, threshold: 0.5, length: 4, blur: 0, angle: 0 }),
    );

    const single = at(output, 7, 2); // one contribution: ~14
    expect(single).toBeGreaterThan(0);
    expect(single).toBeLessThan(40); // two contributions would be ~72
  });

  it('is deterministic and scales with intensity', async () => {
    const pipeline = starPipeline({ spikes: 8, threshold: 0.5, length: 10, blur: 1, angle: 45 });
    const a = await applyEffectsToRaster(starField(), pipeline);
    const b = await applyEffectsToRaster(starField(), pipeline);
    expect(differingBytes(a.data, b.data)).toBe(0);

    const dim = starPipeline({ spikes: 8, threshold: 0.5, length: 10, blur: 1, angle: 45 });
    dim.effects[0].intensity = 0.5;
    const half = await applyEffectsToRaster(starField(), dim);
    expect(at(half, 14, 10)).toBeGreaterThan(0);
    expect(at(half, 14, 10)).toBeLessThan(at(a, 14, 10));
  });
});
