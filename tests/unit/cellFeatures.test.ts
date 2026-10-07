import { describe, it, expect } from 'vitest';
import { cellRect, computeCellFeatures } from '../../src/core/analysis/cellFeatures';

function plane(width: number, height: number, fn: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = fn(x, y);
  }
  return out;
}

function inUnitRange(values: Float32Array): boolean {
  for (const v of values) {
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

describe('cellRect', () => {
  it('covers the whole image exactly once', () => {
    const width = 5;
    const height = 3;
    let covered = 0;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const [x0, x1, y0, y1] = cellRect(5, 3, col, row, width, height);
        covered += (x1 - x0) * (y1 - y0);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
    }
    expect(covered).toBe(width * height);
  });

  it('keeps at least one pixel per cell when the grid is finer than the image', () => {
    const [x0, x1, y0, y1] = cellRect(8, 4, 0, 0, 2, 2);
    expect(x1 - x0).toBeGreaterThanOrEqual(1);
    expect(y1 - y0).toBeGreaterThanOrEqual(1);
    expect(x1).toBeLessThanOrEqual(2);
  });
});

describe('computeCellFeatures', () => {
  it('reports brightness alone for a flat plane', () => {
    const luma = plane(8, 8, () => 0.4);
    const f = computeCellFeatures(luma, 8, 8, 4, 4);
    expect(f.luminance).toHaveLength(16);
    for (const v of f.luminance) expect(v).toBeCloseTo(0.4, 6);
    for (const v of f.contrast) expect(v).toBeCloseTo(0, 6);
    for (const v of f.edge) expect(v).toBeCloseTo(0, 6);
    for (const v of f.texture) expect(v).toBeCloseTo(0, 6);
  });

  it('measures contrast, edge and texture only where the step lands', () => {
    // Step at x = 3, inside cell column 1 (x 2..3).
    const luma = plane(8, 8, (x) => (x < 3 ? 0 : 1));
    const f = computeCellFeatures(luma, 8, 8, 4, 4);

    // Columns 0 and 3 are flat; column 1 owns the 0|1 boundary.
    expect(f.edge[0]).toBeCloseTo(0, 6);
    expect(f.edge[3]).toBeCloseTo(0, 6);
    expect(f.contrast[0]).toBeCloseTo(0, 6);
    expect(f.contrast[3]).toBeCloseTo(0, 6);
    expect(f.edge[1]).toBeGreaterThan(0);
    expect(f.contrast[1]).toBeGreaterThan(0);
    expect(f.texture[1]).toBeGreaterThan(0);

    // Luminance still reads the underlying brightness on both sides.
    expect(f.luminance[0]).toBeCloseTo(0, 6);
    expect(f.luminance[3]).toBeCloseTo(1, 6);
    expect(inUnitRange(f.contrast)).toBe(true);
    expect(inUnitRange(f.edge)).toBe(true);
    expect(inUnitRange(f.texture)).toBe(true);
  });

  it('reads a checkerboard as texture, not as gradient', () => {
    const luma = plane(8, 8, (x, y) => ((x + y) % 2 === 0 ? 1 : 0));
    const f = computeCellFeatures(luma, 8, 8, 2, 2);
    for (const v of f.contrast) expect(v).toBeGreaterThan(0.4);
    for (const v of f.texture) expect(v).toBeGreaterThan(0.4);
    expect(inUnitRange(f.edge)).toBe(true);
  });

  it('stays finite on a 1x1 image', () => {
    const f = computeCellFeatures(Float32Array.from([0.5]), 1, 1, 1, 1);
    for (const planeValues of [f.luminance, f.contrast, f.edge, f.texture]) {
      expect(planeValues).toHaveLength(1);
      expect(Number.isNaN(planeValues[0])).toBe(false);
    }
    expect(f.luminance[0]).toBeCloseTo(0.5, 6);
  });

  it('stays finite when the grid is finer than the image', () => {
    const luma = plane(3, 3, (x, y) => (x + y) / 4);
    const f = computeCellFeatures(luma, 3, 3, 7, 5);
    expect(f.luminance).toHaveLength(35);
    for (const values of [f.luminance, f.contrast, f.edge, f.texture]) {
      expect(inUnitRange(values)).toBe(true);
    }
  });

  it('rejects malformed inputs with a RangeError', () => {
    const ok = new Float32Array(16);
    expect(() => computeCellFeatures(ok, 0, 4, 2, 2)).toThrow(RangeError);
    expect(() => computeCellFeatures(ok, 4, -1, 2, 2)).toThrow(RangeError);
    expect(() => computeCellFeatures(ok, 4, 4, 0, 2)).toThrow(RangeError);
    expect(() => computeCellFeatures(ok, 4, 4, 2, 2.5)).toThrow(RangeError);
    expect(() => computeCellFeatures(new Float32Array(15), 4, 4, 2, 2)).toThrow(RangeError);
  });
});
