import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHARSET_PRESETS,
  boxBlur,
  inkToIndex,
  listMappingStrategies,
  runMapping,
  validateCharset,
  type MappingContext,
} from '../../src/core/mapping';
import { computeCellFeatures } from '../../src/core/analysis/cellFeatures';
import { createRaster } from '../../src/core/image/raster';
import { renderImageToGrid } from '../../src/core/renderImage';
import { DEFAULT_IMAGE_RENDER, type MappingSettings } from '../../src/core/types';
import { Rng } from '../../src/core/util';

const WIDTH = 16;
const HEIGHT = 8;
const RAMP = '@%#*+=-:. ';

const DEFAULT_MAPPING: MappingSettings = {
  strategy: 'luminance',
  radius: 3,
  threshold: 0.5,
  strength: 1,
  curve: [],
};

function plane(width: number, height: number, at: (x: number, y: number) => number): Float32Array {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = at(x, y);
  }
  return data;
}

function constant(width: number, height: number, value: number): Float32Array {
  return plane(width, height, () => value);
}

function noise(width: number, height: number, seed = 42): Float32Array {
  const rng = new Rng(seed);
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rng.next();
  return data;
}

function ramp(width: number, height: number): Float32Array {
  return plane(width, height, (x) => (width <= 1 ? 0 : x / (width - 1)));
}

function step(width: number, height: number, cut: number, bright: number, dark: number): Float32Array {
  return plane(width, height, (x) => (x < cut ? bright : dark));
}

function ctx(
  luma: Float32Array,
  width: number,
  height: number,
  over: Partial<MappingSettings> = {},
): MappingContext {
  return { luma, width, height, settings: { ...DEFAULT_MAPPING, ...over } };
}

function variance(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return acc / values.length;
}

function inRange(data: Float32Array): boolean {
  for (const v of data) {
    if (!(v >= 0 && v <= 1)) return false;
  }
  return true;
}

describe('runMapping strategies', () => {
  it('returns an in-range ink plane of the same length for every registered strategy', () => {
    const strategies = listMappingStrategies();
    expect(strategies.length).toBeGreaterThan(0);
    const luma = noise(WIDTH, HEIGHT, 7);
    for (const strategy of strategies) {
      const out = runMapping(ctx(luma, WIDTH, HEIGHT, { strategy: strategy.id }));
      expect(out).toBeInstanceOf(Float32Array);
      expect(out.length).toBe(luma.length);
      expect(inRange(out)).toBe(true);
      expect(Array.from(out)).not.toEqual(Array.from(luma));
    }
  });

  it('maps a constant-1 (white) plane to the lightest glyph with default settings', () => {
    const out = runMapping(ctx(constant(WIDTH, HEIGHT, 1), WIDTH, HEIGHT));
    expect(out.length).toBe(WIDTH * HEIGHT);
    for (const count of [2, 5, 10, 70]) {
      for (const ink of out) expect(inkToIndex(ink, count)).toBe(count - 1);
    }
  });

  it('maps a constant-0 (black) plane to the densest glyph with default settings', () => {
    const out = runMapping(ctx(constant(WIDTH, HEIGHT, 0), WIDTH, HEIGHT));
    expect(out.length).toBe(WIDTH * HEIGHT);
    for (const count of [2, 5, 10, 70]) {
      for (const ink of out) expect(inkToIndex(ink, count)).toBe(0);
    }
  });
});

describe('output.invert', () => {
  it('flips the glyph chosen for a uniform source', () => {
    const source = createRaster(8, 8, 0x404040);
    const base = { ...DEFAULT_IMAGE_RENDER, columns: 4 };
    const plain = renderImageToGrid(source, {
      ...base,
      output: { ...base.output, invert: false },
    });
    const inverted = renderImageToGrid(source, {
      ...base,
      output: { ...base.output, invert: true },
    });

    const charset = [...base.output.charset];
    const plainIdx = plain.grid.chars.map((ch) => charset.indexOf(ch));
    const invIdx = inverted.grid.chars.map((ch) => charset.indexOf(ch));

    expect(plain.grid.chars.length).toBe(inverted.grid.chars.length);
    expect(plainIdx.length).toBeGreaterThan(0);
    // A uniform source renders as one uniform glyph ...
    expect(new Set(plainIdx).size).toBe(1);
    expect(new Set(invIdx).size).toBe(1);
    for (let i = 0; i < plainIdx.length; i++) {
      expect(plainIdx[i]).toBeGreaterThanOrEqual(0);
      expect(invIdx[i]).toBeGreaterThanOrEqual(0);
      // ... and inversion mirrors that index around the middle of the ramp.
      expect(plainIdx[i] + invIdx[i]).toBe(charset.length - 1);
    }
    expect(plainIdx[0]).not.toBe(invIdx[0]);
  });
});

describe('edge strategy', () => {
  it('produces high values on a step edge and low values in flat areas', () => {
    const src = step(WIDTH, 16, 8, 1, 0.5);
    const out = runMapping(ctx(src, WIDTH, 16, { strategy: 'edge' }));
    const at = (x: number, y: number) => out[y * WIDTH + x];

    expect(at(8, 8)).toBeCloseTo(1, 5);
    expect(at(4, 8)).toBeCloseTo(0, 5);
    expect(at(12, 8)).toBeCloseTo(0.5, 5);
    expect(at(8, 8)).toBeGreaterThan(at(4, 8) + 0.4);
    expect(at(8, 8)).toBeGreaterThan(at(12, 8) + 0.4);
  });

  it('leaves a flat plane at plain ink (no edge response)', () => {
    const out = runMapping(ctx(constant(WIDTH, 16, 0.5), WIDTH, 16, { strategy: 'edge' }));
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });
});

describe('detail strategy', () => {
  it('passes flat regions through as plain luminance', () => {
    const luma = constant(WIDTH, HEIGHT, 0.5);
    const features = computeCellFeatures(luma, WIDTH, HEIGHT, WIDTH, HEIGHT);
    const out = runMapping({ ...ctx(luma, WIDTH, HEIGHT, { strategy: 'detail' }), features });
    const plain = runMapping(ctx(luma, WIDTH, HEIGHT));
    expect(Array.from(out)).toEqual(Array.from(plain));
  });

  it('falls back to plain luminance when the caller extracted no features', () => {
    const luma = noise(WIDTH, HEIGHT, 11);
    const out = runMapping(ctx(luma, WIDTH, HEIGHT, { strategy: 'detail' }));
    const plain = runMapping(ctx(luma, WIDTH, HEIGHT));
    expect(Array.from(out)).toEqual(Array.from(plain));
  });

  it('separates structured cells from their neighbourhood', () => {
    const luma = noise(WIDTH, HEIGHT, 11);
    const features = computeCellFeatures(luma, WIDTH, HEIGHT, WIDTH, HEIGHT);
    const out = runMapping({ ...ctx(luma, WIDTH, HEIGHT, { strategy: 'detail' }), features });
    const plain = runMapping(ctx(luma, WIDTH, HEIGHT));
    expect(inRange(out)).toBe(true);
    expect(Array.from(out)).not.toEqual(Array.from(plain));
  });

  it('applies nothing at strength 0', () => {
    const luma = noise(WIDTH, HEIGHT, 5);
    const features = computeCellFeatures(luma, WIDTH, HEIGHT, WIDTH, HEIGHT);
    const out = runMapping({
      ...ctx(luma, WIDTH, HEIGHT, { strategy: 'detail', strength: 0 }),
      features,
    });
    const plain = runMapping(ctx(luma, WIDTH, HEIGHT));
    expect(Array.from(out)).toEqual(Array.from(plain));
  });
});

describe('edge strategy with cell features', () => {
  it('uses the measured per-cell gradient when features are aligned', () => {
    const src = step(WIDTH, 16, 8, 1, 0.5);
    const features = computeCellFeatures(src, WIDTH, 16, WIDTH, 16);
    const measured = runMapping({ ...ctx(src, WIDTH, 16, { strategy: 'edge' }), features });
    const sobel = runMapping(ctx(src, WIDTH, 16, { strategy: 'edge' }));
    const plain = runMapping(ctx(src, WIDTH, 16));
    expect(inRange(measured)).toBe(true);
    expect(Array.from(measured)).not.toEqual(Array.from(sobel));
    // Both edge paths answer the step; the feature path just measures it on
    // the cell grid instead of convolving a Sobel kernel.
    expect(measured[8 * WIDTH + 8]).toBeGreaterThan(plain[8 * WIDTH + 8] + 0.1);
    expect(sobel[8 * WIDTH + 8]).toBeGreaterThan(plain[8 * WIDTH + 8] + 0.4);
    // Flat corners are untouched by both.
    expect(measured[0]).toBeCloseTo(plain[0], 6);
    expect(sobel[0]).toBeCloseTo(plain[0], 6);
  });
});

describe('threshold strategy', () => {
  it('splits a ramp plane cleanly at 0.5', () => {
    const width = 11;
    const out = runMapping(ctx(ramp(width, 1), width, 1, { strategy: 'threshold', threshold: 0.5 }));
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });
});

describe('boxBlur', () => {
  it('keeps random noise inside [0,1] and reduces its variance with radius 2', () => {
    const width = 32;
    const height = 16;
    const src = noise(width, height, 42);
    const before = Array.from(src);

    const out = boxBlur(src, width, height, 2);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(src.length);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(variance(Array.from(out))).toBeLessThan(variance(before));
    // Input plane is never mutated.
    expect(Array.from(src)).toEqual(before);
  });
});

describe('inkToIndex', () => {
  it('selects the densest glyph for full ink and the lightest for no ink', () => {
    for (const count of [2, 5, 10, 70]) {
      expect(inkToIndex(1, count, 0, 1)).toBe(0);
      expect(inkToIndex(0, count, 0, 1)).toBe(count - 1);
    }
  });

  it('shifts towards darker glyphs as the offset grows', () => {
    const plain = inkToIndex(0.6, 10, 0, 1);
    const shifted = inkToIndex(0.6, 10, 3, 1);
    expect(shifted).toBeLessThan(plain);
    expect(inkToIndex(0.6, 10, 100, 1)).toBe(0);
    expect(inkToIndex(0.6, 10, -100, 1)).toBe(9);
  });

  it('clamps out-of-range ink values', () => {
    expect(inkToIndex(5, 10, 0, 1)).toBe(0);
    expect(inkToIndex(-3, 10, 0, 1)).toBe(9);
    expect(inkToIndex(1, 10, 0, 1)).toBe(0);
    expect(inkToIndex(0, 10, 0, 1)).toBe(9);
  });

  it('returns 0 when the character count is <= 0', () => {
    expect(inkToIndex(0.5, 0)).toBe(0);
    expect(inkToIndex(0, -5)).toBe(0);
    expect(inkToIndex(1, 0, 2, 3)).toBe(0);
    expect(inkToIndex(0.5, 1)).toBe(0);
  });
});

describe('validateCharset', () => {
  it('rejects an empty string', () => {
    const res = validateCharset('');
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
    expect(res.normalized).toBe('');
  });

  it('rejects control characters', () => {
    expect(validateCharset('a\nb').ok).toBe(false);
    expect(validateCharset('\t').ok).toBe(false);
    expect(validateCharset(' \u009b').ok).toBe(false);
  });

  it('accepts a normal ramp and returns it normalized', () => {
    const res = validateCharset(RAMP);
    expect(res.ok).toBe(true);
    expect(res.normalized).toBe(RAMP);
  });

  // Validation walks code points, so a "cell" built from several code points
  // (combining marks, emoji sequences) currently passes untouched.
  it('accepts multi-codepoint grapheme cells', () => {
    const combining = 'e\u0301';
    const res = validateCharset(combining);
    expect(res.ok).toBe(true);
    expect(res.normalized).toBe(combining);

    const emoji = '😀🚀';
    const emojiRes = validateCharset(emoji);
    expect(emojiRes.ok).toBe(true);
    expect(emojiRes.normalized).toBe(emoji);
  });
});

describe('CHARSET_PRESETS', () => {
  it('has non-empty entries with unique ids', () => {
    expect(CHARSET_PRESETS.length).toBeGreaterThan(0);
    for (const preset of CHARSET_PRESETS) {
      expect(preset.id.trim().length).toBeGreaterThan(0);
      expect(preset.label.trim().length).toBeGreaterThan(0);
      expect(preset.chars.length).toBeGreaterThan(0);
      expect(preset.description.trim().length).toBeGreaterThan(0);
    }
    const ids = CHARSET_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every preset's ramp unique characters", () => {
    const repeated = CHARSET_PRESETS.filter((preset) => {
      const cells = [...preset.chars];
      return new Set(cells).size !== cells.length;
    }).map((preset) => preset.id);
    expect(repeated).toEqual([]);
  });
});

describe('listMappingStrategies', () => {
  it('includes the core strategy ids', () => {
    const ids = listMappingStrategies().map((strategy) => strategy.id);
    for (const id of [
      'luminance',
      'brightness',
      'contrast',
      'localContrast',
      'edge',
      'threshold',
      'adaptive',
      'detail',
      'custom',
    ]) {
      expect(ids).toContain(id);
    }
  });
});

describe('documentation stays measurable', () => {
  it('README quotes the strategy count this registry produces', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8');
    expect(readme).toContain(`${listMappingStrategies().length} tone-mapping strategies`);
  });
});
