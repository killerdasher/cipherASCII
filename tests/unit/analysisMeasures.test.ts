import { describe, it, expect } from 'vitest';
import {
  contrastField,
  contrastKey,
  edgeField,
  edgeKey,
  frequencyField,
  frequencyKey,
  structureKeys,
  structureTensor,
  textureField,
  textureKey,
} from '../../src/core/analysis/measures';
import { fieldFromData, type AnalysisField } from '../../src/core/analysis/field';

const PI = Math.PI;

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

function inUnitRange(field: AnalysisField): boolean {
  for (const v of field.data) {
    if (!Number.isFinite(v) || v < 0 || v > 1) return false;
  }
  return true;
}

/** Vertical step: columns < `at` are black, the rest white. */
function verticalStep(at: number) {
  return (x: number) => (x < at ? 0 : 1);
}

/** Horizontal step: rows < `at` are black, the rest white. */
function horizontalStep(at: number) {
  return (_x: number, y: number) => (y < at ? 0 : 1);
}

function checkerboard(x: number, y: number): number {
  return (x + y) % 2;
}

describe('measure cache keys', () => {
  it('separates parameters and folds equal ones together', () => {
    expect(contrastKey('a', 3)).not.toBe(contrastKey('a', 4));
    expect(contrastKey('a', 3)).toBe(contrastKey('a', 3));
    // Radius normalisation matches the measures' own rounding.
    expect(contrastKey('a', 0)).toBe(contrastKey('a', 1));
    expect(textureKey('a', 0.4)).toBe(textureKey('a', 1));
    expect(frequencyKey('a', 8.4)).toBe(frequencyKey('a', 8));
    expect(structureKeys('a', 2).coherence).toBe(structureKeys('a', 2).coherence);
    expect(structureKeys('a', 2).coherence).not.toBe(structureKeys('a', 3).coherence);
    expect(structureKeys('a', 2).coherence).not.toBe(structureKeys('a', 2).orientation);
    expect(edgeKey('a')).not.toBe(edgeKey('b'));
  });
});

describe('contrastField', () => {
  it('reads zero on a flat plane', () => {
    const f = contrastField(lumaField(8, 8, () => 0.4));
    for (const v of f.data) expect(v).toBeCloseTo(0, 6);
  });

  it('saturates on the seam of a step and ignores flat sides', () => {
    const luma = lumaField(16, 8, verticalStep(8));
    const f = contrastField(luma, 3);
    // A 7px window straddling the step holds 3 blacks and 4 whites:
    // 2 * sqrt(3/7 * 4/7) = 0.9897.
    expect(f.data[8]).toBeCloseTo(0.9897, 3);
    expect(f.data[0]).toBeCloseTo(0, 6);
    expect(f.data[15]).toBeCloseTo(0, 6);
  });

  it('stays in range, is deterministic and keys by radius', () => {
    let s = 1;
    const random = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s >>> 8) / 0xffffff;
    };
    const luma = lumaField(32, 24, random);
    const a = contrastField(luma, 2);
    const b = contrastField(luma, 2);
    expect(inUnitRange(a)).toBe(true);
    expect(a.data).toEqual(b.data);
    expect(a.sourceKey).toBe(contrastKey('test:luma', 2));
    expect(contrastField(luma, 5).sourceKey).not.toBe(a.sourceKey);
  });
});

describe('edgeField', () => {
  it('reads zero on a flat plane', () => {
    const f = edgeField(lumaField(8, 8, () => 0.7));
    for (const v of f.data) expect(v).toBeCloseTo(0, 6);
  });

  it('reads 1 on both columns a vertical step passes through', () => {
    const f = edgeField(lumaField(16, 8, verticalStep(8)));
    expect(f.data[7]).toBeCloseTo(1, 6);
    expect(f.data[8]).toBeCloseTo(1, 6);
    expect(f.data[0]).toBeCloseTo(0, 6);
    expect(f.data[15]).toBeCloseTo(0, 6);
  });

  it('reads 1 on both rows a horizontal step passes through', () => {
    const f = edgeField(lumaField(8, 16, horizontalStep(8)));
    expect(f.data[7 * 8]).toBeCloseTo(1, 6);
    expect(f.data[8 * 8]).toBeCloseTo(1, 6);
    expect(f.data[0]).toBeCloseTo(0, 6);
    expect(f.data[15 * 8]).toBeCloseTo(0, 6);
  });

  it('stays in range and keys from the source', () => {
    const luma = lumaField(16, 16, checkerboard);
    const f = edgeField(luma);
    expect(inUnitRange(f)).toBe(true);
    expect(f.sourceKey).toBe(edgeKey('test:luma'));
    expect(f.data).toEqual(edgeField(luma).data);
  });
});

describe('textureField', () => {
  it('reads zero on a flat plane and near zero on a smooth ramp', () => {
    for (const v of textureField(lumaField(8, 8, () => 0.4)).data) expect(v).toBeCloseTo(0, 6);
    const ramp = textureField(lumaField(32, 32, (x) => x / 31), 2);
    expect(ramp.data[16 * 32 + 16]).toBeLessThan(0.01);
  });

  it('saturates on a pixel checkerboard', () => {
    const f = textureField(lumaField(32, 32, checkerboard), 2);
    // Odd box parity leaves one sample of one phase over: 0.96, not 1.
    expect(f.data[16 * 32 + 16]).toBeCloseTo(0.96, 5);
    expect(inUnitRange(f)).toBe(true);
    expect(f.sourceKey).toBe(textureKey('test:luma', 2));
  });
});

describe('frequencyField', () => {
  it('reads zero where nothing varies', () => {
    const f = frequencyField(lumaField(16, 16, () => 0.5));
    expect(f.width).toBe(16);
    expect(f.height).toBe(16);
    for (const v of f.data) expect(v).toBeCloseTo(0, 6);
  });

  it('saturates on a pixel checkerboard', () => {
    const f = frequencyField(lumaField(32, 32, checkerboard), 8);
    expect(f.data[16 * 32 + 16]).toBeCloseTo(1, 6);
    expect(inUnitRange(f)).toBe(true);
  });

  it('ranks a tight pattern above a loose one', () => {
    const tight = frequencyField(lumaField(64, 32, (x) => ((x % 4) < 2 ? 0 : 1)), 8);
    const loose = frequencyField(lumaField(64, 32, (x) => ((x % 16) < 8 ? 0 : 1)), 8);
    expect(tight.data[16 * 64 + 32]).toBeGreaterThan(loose.data[16 * 64 + 32]);
  });

  it('upsamples the block map back to the source size and keys by window', () => {
    const luma = lumaField(64, 40, checkerboard);
    const f = frequencyField(luma, 8);
    expect(f.width).toBe(64);
    expect(f.height).toBe(40);
    expect(f.sourceKey).toBe(frequencyKey('test:luma', 8));
    expect(frequencyField(luma, 16).sourceKey).not.toBe(f.sourceKey);
  });
});

describe('structureTensor', () => {
  it('reports no coherence and no orientation structure on a flat plane', () => {
    const { coherence, orientation } = structureTensor(lumaField(8, 8, () => 0.5));
    for (const v of coherence.data) expect(v).toBeCloseTo(0, 6);
    for (const v of orientation.data) expect(v).toBeGreaterThanOrEqual(0);
    expect(Math.max(...orientation.data)).toBeLessThan(PI);
  });

  it('aligns a vertical step to 0 radians with coherence 1', () => {
    const luma = lumaField(16, 16, verticalStep(8));
    const { coherence, orientation } = structureTensor(luma, 3);
    const i = 8 * 16 + 8;
    expect(orientation.data[i]).toBeCloseTo(0, 2);
    expect(coherence.data[i]).toBeCloseTo(1, 2);
  });

  it('aligns a horizontal step to pi/2 radians', () => {
    const luma = lumaField(16, 16, horizontalStep(8));
    const { coherence, orientation } = structureTensor(luma, 3);
    const i = 8 * 16 + 8;
    expect(orientation.data[i]).toBeCloseTo(PI / 2, 2);
    expect(coherence.data[i]).toBeCloseTo(1, 2);
  });

  it('aligns diagonal stripes to the gradient diagonal', () => {
    // Stripes along y = x + k: brightness varies with (x - y), so the gradient
    // points at -45 degrees, normalised into [0, pi) as 3pi/4.
    const luma = lumaField(32, 32, (x, y) => (((x - y) % 8 + 8) % 8 < 4 ? 0 : 1));
    const { coherence, orientation } = structureTensor(luma, 3);
    const i = 16 * 32 + 16;
    expect(orientation.data[i]).toBeCloseTo((3 * PI) / 4, 1);
    expect(coherence.data[i]).toBeGreaterThan(0.8);
  });

  it('keeps orientation inside [0, pi) and keys by radius', () => {
    let s = 7;
    const random = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s >>> 8) / 0xffffff;
    };
    const luma = lumaField(24, 24, random);
    const { coherence, orientation } = structureTensor(luma, 2);
    expect(inUnitRange(coherence)).toBe(true);
    for (const v of orientation.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(PI);
    }
    expect(coherence.sourceKey).toBe(structureKeys('test:luma', 2).coherence);
    expect(orientation.sourceKey).toBe(structureKeys('test:luma', 2).orientation);
    expect(structureTensor(luma, 4).coherence.sourceKey).not.toBe(coherence.sourceKey);
  });
});
