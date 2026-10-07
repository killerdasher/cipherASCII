import { describe, it, expect } from 'vitest';
import { saliencyField, saliencyKey } from '../../src/core/analysis/saliency';
import { fieldFromData, type AnalysisField } from '../../src/core/analysis/field';

function lumaField(
  width: number,
  height: number,
  fn: (x: number, y: number) => number,
  sourceKey = 'test:luma',
): AnalysisField {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y);
  }
  return fieldFromData('luma', width, height, data, sourceKey);
}

/** Bright disk of `radius` around (`cx`, `cy`) on a dark field. */
function blob(cx: number, cy: number, radius: number) {
  return (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius ? 0.92 : 0.08;
  };
}

function argmax(field: AnalysisField): { x: number; y: number; value: number } {
  let best = 0;
  let index = 0;
  for (let i = 0; i < field.data.length; i++) {
    if (field.data[i] > best) {
      best = field.data[i];
      index = i;
    }
  }
  return { x: index % field.width, y: Math.floor(index / field.width), value: best };
}

describe('saliencyKey', () => {
  it('folds sizes onto their scratch grid', () => {
    expect(saliencyKey('a', 64)).toBe(saliencyKey('a', 100)); // both floor to 64
    expect(saliencyKey('a', 128)).not.toBe(saliencyKey('a', 64));
    expect(saliencyKey('a', 512)).toBe(saliencyKey('a', 256)); // capped at 256
    expect(saliencyKey('a', 128)).not.toBe(saliencyKey('b', 128));
  });
});

describe('saliencyField', () => {
  it('peaks on a bright blob against a dark field', () => {
    const luma = lumaField(64, 64, blob(18, 20, 6));
    const f = saliencyField(luma, 64);
    expect(f.width).toBe(64);
    expect(f.height).toBe(64);
    expect(f.sourceKey).toBe(saliencyKey('test:luma', 64));
    const peak = argmax(f);
    expect(Math.hypot(peak.x - 18, peak.y - 20)).toBeLessThanOrEqual(8);
    expect(peak.value).toBeCloseTo(1, 3);
  });

  it('reads all zeros on a featureless field', () => {
    const flat = saliencyField(lumaField(32, 32, () => 0.5), 32);
    for (const v of flat.data) expect(v).toBe(0);
    // Under one 8-bit code value of range is still featureless.
    const nearFlat = saliencyField(lumaField(32, 32, (x) => 0.5 + x / 16384), 32);
    for (const v of nearFlat.data) expect(v).toBe(0);
  });

  it('normalises to a peak of 1 and stays in range', () => {
    const f = saliencyField(lumaField(48, 40, blob(24, 20, 5)), 64);
    expect(Math.max(...f.data)).toBeCloseTo(1, 3);
    for (const v of f.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('resamples to the source size', () => {
    const f = saliencyField(lumaField(100, 56, blob(30, 28, 6)), 64);
    expect(f.width).toBe(100);
    expect(f.height).toBe(56);
    expect(Math.max(...f.data)).toBeGreaterThan(0.5);
  });

  it('is deterministic for the same pixels and size', () => {
    const luma = lumaField(40, 40, blob(20, 20, 5));
    expect(saliencyField(luma, 64).data).toEqual(saliencyField(luma, 64).data);
    expect(saliencyField(luma, 32).sourceKey).not.toBe(saliencyField(luma, 64).sourceKey);
  });

  it('works on inputs smaller than the scratch grid', () => {
    const f = saliencyField(lumaField(8, 8, blob(4, 4, 2)), 64);
    expect(f.width).toBe(8);
    expect(f.height).toBe(8);
    expect(Math.max(...f.data)).toBeGreaterThan(0.5);
  });
});
