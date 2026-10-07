import { describe, it, expect } from 'vitest';
import {
  createField,
  fieldCacheKey,
  fieldFromData,
  normalizeField,
  resampleField,
  sampleBilinear,
  sampleNearest,
} from '../../src/core/analysis/field';

function field(name: string, width: number, height: number, values: number[]) {
  return fieldFromData(name, width, height, Float32Array.from(values));
}

describe('createField / fieldFromData', () => {
  it('fills a constant field and reports exact statistics', () => {
    const f = createField('flat', 4, 3, 0.25, 'src:key');
    expect(f.width).toBe(4);
    expect(f.height).toBe(3);
    expect(f.data).toHaveLength(12);
    expect(f.min).toBeCloseTo(0.25, 6);
    expect(f.max).toBeCloseTo(0.25, 6);
    expect(f.mean).toBeCloseTo(0.25, 6);
    expect(f.sourceKey).toBe('src:key');
  });

  it('computes min, max and mean from data', () => {
    const f = field('t', 3, 1, [1, -2, 3]);
    expect(f.min).toBe(-2);
    expect(f.max).toBe(3);
    expect(f.mean).toBeCloseTo(2 / 3, 6);
  });

  it('rejects non-positive or fractional dimensions', () => {
    for (const [w, h] of [[0, 4], [4, 0], [-1, 4], [2.5, 4], [4, -2.5]]) {
      expect(() => createField('t', w, h)).toThrow(RangeError);
      expect(() => fieldFromData('t', w, h, new Float32Array(1))).toThrow(RangeError);
    }
  });

  it('rejects a data length that does not match the dimensions', () => {
    expect(() => fieldFromData('t', 2, 2, new Float32Array(3))).toThrow(RangeError);
  });
});

describe('sampleNearest / sampleBilinear', () => {
  const f = field('ramp', 2, 1, [0, 1]);

  it('snaps to the closest sample and clamps to the edges', () => {
    expect(sampleNearest(f, 0.4, 0)).toBe(0);
    expect(sampleNearest(f, 0.6, 0)).toBe(1);
    expect(sampleNearest(f, -5, 0)).toBe(0);
    expect(sampleNearest(f, 9, 0)).toBe(1);
  });

  it('interpolates between samples at pixel centres', () => {
    expect(sampleBilinear(f, 0, 0)).toBeCloseTo(0, 6);
    expect(sampleBilinear(f, 1, 0)).toBeCloseTo(1, 6);
    expect(sampleBilinear(f, 0.5, 0)).toBeCloseTo(0.5, 6);
    expect(sampleBilinear(f, -1, 0)).toBeCloseTo(0, 6);
    expect(sampleBilinear(f, 4, 0)).toBeCloseTo(1, 6);
  });

  it('keeps a constant field constant', () => {
    const flat = createField('flat', 3, 3, 0.75);
    expect(sampleBilinear(flat, 1.3, 2.9)).toBeCloseTo(0.75, 6);
  });
});

describe('resampleField', () => {
  it('returns the same field when the size is unchanged', () => {
    const f = createField('t', 4, 4, 0.5);
    expect(resampleField(f, 4, 4)).toBe(f);
  });

  it('box-averages when shrinking', () => {
    const f = field('t', 2, 2, [0, 1, 1, 0]);
    const out = resampleField(f, 1, 1);
    expect(out.width).toBe(1);
    expect(out.data[0]).toBeCloseTo(0.5, 6);
    expect(out.mean).toBeCloseTo(0.5, 6);
  });

  it('keeps every source sample when growing a single pixel', () => {
    const f = field('t', 1, 1, [0.25]);
    const out = resampleField(f, 3, 2);
    expect(out.data).toHaveLength(6);
    for (const v of out.data) expect(v).toBeCloseTo(0.25, 6);
  });

  it('preserves a linear ramp under bilinear upscaling', () => {
    const f = field('ramp', 2, 1, [0, 1]);
    const out = resampleField(f, 4, 1);
    expect(Array.from(out.data).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.25, 0.75, 1]);
    expect(out.min).toBeCloseTo(0, 6);
    expect(out.max).toBeCloseTo(1, 6);
  });

  it('keeps the producer name and source key', () => {
    const f = fieldFromData('luma', 2, 2, Float32Array.from([0, 1, 2, 3]), 'k');
    const out = resampleField(f, 1, 1);
    expect(out.name).toBe('luma');
    expect(out.sourceKey).toBe('k');
  });
});

describe('normalizeField', () => {
  it('remaps the measured extent onto 0..1', () => {
    const out = normalizeField(field('t', 3, 1, [2, 4, 6]));
    expect(out.data[0]).toBeCloseTo(0, 6);
    expect(out.data[1]).toBeCloseTo(0.5, 6);
    expect(out.data[2]).toBeCloseTo(1, 6);
    expect(out.min).toBeCloseTo(0, 6);
    expect(out.max).toBeCloseTo(1, 6);
    expect(out.mean).toBeCloseTo(0.5, 6);
  });

  it('maps a flat field to zeros instead of dividing by zero', () => {
    const out = normalizeField(field('flat', 2, 2, [3, 3, 3, 3]));
    for (const v of out.data) expect(v).toBe(0);
    expect(out.min).toBe(0);
    expect(out.max).toBe(0);
    expect(Number.isNaN(out.mean)).toBe(false);
  });

  it('renames the field when asked', () => {
    expect(normalizeField(field('a', 1, 1, [1]), 'b').name).toBe('b');
  });
});

describe('fieldCacheKey', () => {
  it('is stable across parameter key order', () => {
    expect(fieldCacheKey('gen', { a: 1, b: 2 })).toBe(fieldCacheKey('gen', { b: 2, a: 1 }));
  });

  it('changes when a parameter or the base changes', () => {
    const base = fieldCacheKey('gen', { a: 1 });
    expect(fieldCacheKey('gen', { a: 2 })).not.toBe(base);
    expect(fieldCacheKey('other', { a: 1 })).not.toBe(base);
  });
});
