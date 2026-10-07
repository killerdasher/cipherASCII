import { describe, it, expect } from 'vitest';
import { GlyphIndex } from '../../src/core/glyph/glyphIndex';
import type { GlyphFeatureVector } from '../../src/core/glyph/features';

function feature(glyph: string, ink: number, density = Math.min(1, ink)): GlyphFeatureVector {
  return {
    glyph,
    ink,
    aspect: 1,
    bbox: { x: 0, y: 0, w: 1, h: 1 },
    density,
    centroidX: 0.5,
    centroidY: 0.5,
    edgeRatio: 0,
    symmetryX: 1,
  };
}

describe('GlyphIndex.from', () => {
  it('sorts by ink ascending and breaks ties by code point', () => {
    const index = GlyphIndex.from([feature('b', 0.5), feature('a', 0.5), feature('z', 0.1)]);
    expect(index.glyphs()).toEqual(['z', 'a', 'b']);
    expect(index.size).toBe(3);
  });

  it('keeps the first entry of duplicated characters', () => {
    const index = GlyphIndex.from([feature('a', 0.9), feature('a', 0.2)]);
    expect(index.size).toBe(2);
    expect(index.featuresOf('a')?.ink).toBeCloseTo(0.9, 6);
  });

  it('answers undefined / empty for an empty index', () => {
    const index = GlyphIndex.from([]);
    expect(index.size).toBe(0);
    expect(index.featuresOf('a')).toBeUndefined();
    expect(index.nearestByInk(0.5)).toBeUndefined();
    expect(index.ramp(4)).toEqual([]);
    expect(index.byDensityRange(0, 1)).toEqual([]);
  });
});

describe('nearestByInk', () => {
  const index = GlyphIndex.from([feature('a', 0.1), feature('b', 0.5), feature('c', 0.9)]);

  it('finds an exact match', () => {
    expect(index.nearestByInk(0.5)?.glyph).toBe('b');
  });

  it('picks the closer neighbour on either side', () => {
    expect(index.nearestByInk(0.2)?.glyph).toBe('a');
    expect(index.nearestByInk(0.8)?.glyph).toBe('c');
  });

  it('clamps outside the measured range', () => {
    expect(index.nearestByInk(-3)?.glyph).toBe('a');
    expect(index.nearestByInk(7)?.glyph).toBe('c');
  });

  it('breaks exact ties by code point', () => {
    const tied = GlyphIndex.from([feature('m', 0.4), feature('b', 0.6)]);
    expect(tied.nearestByInk(0.5)?.glyph).toBe('b');
  });
});

describe('ramp', () => {
  it('returns characters dark to light across even ink quantiles', () => {
    const index = GlyphIndex.from([feature('a', 0.9), feature('b', 0.1), feature('c', 0.5)]);
    expect(index.ramp(3)).toEqual(['a', 'c', 'b']);
    expect(index.ramp(2)).toEqual(['a', 'b']);
  });

  it('returns a single dense glyph for a one-level ladder', () => {
    const index = GlyphIndex.from([feature('a', 0.9), feature('b', 0.1)]);
    expect(index.ramp(1)).toEqual(['a']);
  });

  it('skips empty glyphs by default and can be asked to keep them', () => {
    const index = GlyphIndex.from([feature(' ', 0), feature('#', 0.8), feature('.', 0.2)]);
    expect(index.ramp(3)).toEqual(['#', '.']);
    expect(index.ramp(3, { skipEmpty: false })).toEqual(['#', '.', ' ']);
  });

  it('de-duplicates repeated picks from a short ladder', () => {
    const index = GlyphIndex.from([feature('a', 0.9), feature('b', 0.1)]);
    expect(index.ramp(6)).toEqual(['a', 'b']);
  });

  it('rejects non-positive or fractional level counts', () => {
    const index = GlyphIndex.from([feature('a', 0.5)]);
    expect(index.ramp(0)).toEqual([]);
    expect(index.ramp(-2)).toEqual([]);
    expect(index.ramp(1.5)).toEqual([]);
  });
});

describe('byDensityRange', () => {
  it('keeps glyphs inside the inclusive density band, in index order', () => {
    const index = GlyphIndex.from([
      feature('a', 0.9, 0.95),
      feature('b', 0.5, 0.5),
      feature('c', 0.1, 0.05),
    ]);
    expect(index.byDensityRange(0.4, 1).map((f) => f.glyph)).toEqual(['b', 'a']);
    expect(index.byDensityRange(0.5, 0.5).map((f) => f.glyph)).toEqual(['b']);
    expect(index.byDensityRange(0.6, 0.9)).toEqual([]);
  });
});
