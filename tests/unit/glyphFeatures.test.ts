import { describe, it, expect } from 'vitest';
import {
  glyphFeaturesFromAlpha,
  glyphFeaturesFromBitmap,
} from '../../src/core/glyph/features';

function grid(width: number, height: number, inked: Array<[number, number]>): Float32Array {
  const out = new Float32Array(width * height);
  for (const [x, y] of inked) out[y * width + x] = 1;
  return out;
}

describe('glyphFeaturesFromAlpha', () => {
  it('reports an empty glyph as zero ink with a neutral centre and perfect symmetry', () => {
    const f = glyphFeaturesFromAlpha(' ', new Float32Array(16), 4, 4);
    expect(f.glyph).toBe(' ');
    expect(f.ink).toBe(0);
    expect(f.bbox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(f.aspect).toBe(0);
    expect(f.density).toBe(0);
    expect(f.edgeRatio).toBe(0);
    expect(f.centroidX).toBe(0.5);
    expect(f.centroidY).toBe(0.5);
    expect(f.symmetryX).toBe(1);
  });

  it('reports a solid block as full ink, full density and no edges', () => {
    const f = glyphFeaturesFromAlpha('█', new Float32Array(16).fill(1), 4, 4);
    expect(f.ink).toBe(1);
    expect(f.bbox).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(f.aspect).toBe(1);
    expect(f.density).toBe(1);
    expect(f.edgeRatio).toBe(0);
    expect(f.centroidX).toBeCloseTo(0.5, 6);
    expect(f.centroidY).toBeCloseTo(0.5, 6);
    expect(f.symmetryX).toBe(1);
  });

  it('measures a centred vertical bar', () => {
    const inked: Array<[number, number]> = [];
    for (let y = 0; y < 4; y++) {
      inked.push([1, y], [2, y]);
    }
    const f = glyphFeaturesFromAlpha('│', grid(4, 4, inked), 4, 4);
    expect(f.ink).toBeCloseTo(0.5, 6);
    expect(f.bbox).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(f.aspect).toBeCloseTo(0.5, 6);
    expect(f.density).toBeCloseTo(1, 6); // the box is completely filled
    expect(f.edgeRatio).toBe(1); // every inked pixel touches empty space
    expect(f.centroidX).toBeCloseTo(0.5, 6);
    expect(f.symmetryX).toBe(1);
  });

  it('scores an asymmetric glyph below perfect symmetry', () => {
    const f = glyphFeaturesFromAlpha('L', grid(4, 4, [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]), 4, 4);
    expect(f.symmetryX).toBeLessThan(1);
    expect(f.symmetryX).toBeGreaterThan(0);
    expect(f.ink).toBeCloseTo(5 / 16, 6);
  });

  it('accepts byte masks and matches the unit-scale result', () => {
    const mask = grid(4, 4, [[1, 1], [2, 1], [1, 2]]);
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = mask[i] * 255;
    const unit = glyphFeaturesFromAlpha('x', mask, 4, 4);
    const fromBytes = glyphFeaturesFromAlpha('x', bytes, 4, 4);
    expect(fromBytes.ink).toBeCloseTo(unit.ink, 6);
    expect(fromBytes.bbox).toEqual(unit.bbox);
    expect(fromBytes.edgeRatio).toBeCloseTo(unit.edgeRatio, 6);
    expect(fromBytes.symmetryX).toBeCloseTo(unit.symmetryX, 6);
  });

  it('rejects malformed bitmaps with a RangeError', () => {
    expect(() => glyphFeaturesFromAlpha('x', new Float32Array(4), 0, 4)).toThrow(RangeError);
    expect(() => glyphFeaturesFromAlpha('x', new Float32Array(4), 4, -1)).toThrow(RangeError);
    expect(() => glyphFeaturesFromAlpha('x', new Float32Array(4), 4, 4)).toThrow(RangeError);
  });
});

describe('glyphFeaturesFromBitmap', () => {
  it('reads the alpha channel of an RGBA bitmap', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const on = i % 3 === 0;
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = on ? 255 : 0;
    }
    const f = glyphFeaturesFromBitmap('r', rgba, 4, 4);
    expect(f.ink).toBeCloseTo(6 / 16, 6);
    expect(f.bbox.w).toBeGreaterThan(0);
    expect(f.symmetryX).toBeLessThan(1);
  });

  it('falls back to a single-channel bitmap of matching length', () => {
    const mask = new Float32Array(16).fill(1);
    expect(glyphFeaturesFromBitmap('m', mask, 4, 4).ink).toBe(1);
  });

  it('rejects an unexpected sample count', () => {
    expect(() => glyphFeaturesFromBitmap('m', new Float32Array(17), 4, 4)).toThrow(RangeError);
  });
});
