import {
  DITHER_IDS,
  applyDither,
  ditherDescription,
  ditherLabel,
} from '../../src/core/dither';
import type { DitherId, DitherSettings } from '../../src/core/types';

const LEVELS = [2, 3, 10] as const;
const DITHERING_ALGORITHMS: readonly DitherId[] = ['floydSteinberg', 'atkinson', 'bayer'];

function settings(algorithm: DitherId, over: Partial<DitherSettings> = {}): DitherSettings {
  return { algorithm, strength: 1, serpentine: false, matrixSize: 8, ...over };
}

function plane(width: number, height: number, at: (x: number, y: number) => number): Float32Array {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = at(x, y);
  }
  return data;
}

function gradient(width: number, height: number): Float32Array {
  return plane(width, height, (x) => (width <= 1 ? 0.5 : x / (width - 1)));
}

function constant(width: number, height: number, value: number): Float32Array {
  return plane(width, height, () => value);
}

function noise(width: number, height: number): Float32Array {
  return plane(width, height, (x, y) => ((x * 73 + y * 151 + x * y * 17) % 101) / 100);
}

function bytes(data: Float32Array): number[] {
  return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function rowMean(data: Float32Array, y: number, width: number): number {
  let sum = 0;
  for (let x = 0; x < width; x++) sum += data[y * width + x];
  return sum / width;
}

function countValue(data: Float32Array, value: number): number {
  let n = 0;
  for (const v of data) if (v === value) n++;
  return n;
}

function expectLattice(data: Float32Array, levels: number): void {
  const step = levels - 1;
  for (const v of data) {
    expect(Number.isFinite(v)).toBe(true);
    const nearest = Math.round(v * step) / step;
    expect(Math.abs(v - nearest)).toBeLessThanOrEqual(1e-6);
  }
}

describe('DITHER_IDS', () => {
  it('lists every registered algorithm in display order', () => {
    const ids = [...DITHER_IDS];
    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('none');
    expect(ids[1]).toBe('threshold');
  });

  it('keeps the classic families in a stable relative order', () => {
    const ids = [...DITHER_IDS];
    const families: DitherId[] = [
      'none',
      'threshold',
      'bayer8',
      'voidCluster',
      'floydSteinberg',
      'atkinson',
      'halftoneAM',
      'blueNoise',
      'patternDots',
      'roberts',
      'laplacian',
    ];
    let previous = -1;
    for (const id of families) {
      const index = ids.indexOf(id);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
  });
});

describe('applyDither invariants', () => {
  for (const algorithm of DITHER_IDS) {
    for (const levels of LEVELS) {
      it(`${algorithm} @ ${levels} levels: same length, lattice values, input untouched`, () => {
        for (const src of [gradient(24, 10), noise(24, 10)]) {
          const before = Array.from(src);
          const out = applyDither(src, 24, 10, settings(algorithm), levels);
          expect(out).toBeInstanceOf(Float32Array);
          expect(out.length).toBe(src.length);
          expect(Array.from(src)).toEqual(before);
          expectLattice(out, levels);
        }
      });
    }
  }

  it('treats NaN and Infinity inputs as 0', () => {
    const src = new Float32Array([NaN, Infinity, -Infinity, 0.5, 0.25]);
    const plain = applyDither(src, 5, 1, settings('none'), 10);
    expect(Array.from(plain.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Number.isNaN(src[0])).toBe(true);

    for (const algorithm of DITHER_IDS) {
      const out = applyDither(src, 5, 1, settings(algorithm), 10);
      expect(out.length).toBe(5);
      expectLattice(out, 10);
    }
  });

  it('keeps an all-zero plane at 0', () => {
    for (const algorithm of DITHER_IDS) {
      for (const levels of LEVELS) {
        const out = applyDither(constant(16, 8, 0), 16, 8, settings(algorithm), levels);
        for (const v of out) expect(v).toBe(0);
      }
    }
  });

  it('keeps an all-one plane at 1 for 2 and 10 levels', () => {
    for (const algorithm of DITHER_IDS) {
      for (const levels of [2, 10]) {
        const out = applyDither(constant(16, 8, 1), 16, 8, settings(algorithm), levels);
        for (const v of out) expect(v).toBe(1);
      }
    }
  });

  it('strength 0 equals plain quantization for every algorithm', () => {
    const src = noise(20, 12);
    const expected = Array.from(applyDither(src, 20, 12, settings('none'), 10));
    for (const algorithm of DITHER_IDS) {
      const out = applyDither(src, 20, 12, settings(algorithm, { strength: 0 }), 10);
      expect(Array.from(out)).toEqual(expected);
    }
  });

  it('is deterministic: byte-identical output across two calls', () => {
    const src = noise(24, 16);
    for (const algorithm of DITHER_IDS) {
      const config = settings(algorithm, { serpentine: true, matrixSize: 4 });
      const first = applyDither(src, 24, 16, config, 10);
      const second = applyDither(src, 24, 16, config, 10);
      expect(bytes(first)).toEqual(bytes(second));
    }
  });
});

describe('bayer (ordered dither)', () => {
  it('repeats its matrix tile exactly every matrixSize cells', () => {
    for (const size of [4, 8] as const) {
      const width = 24;
      const height = 24;
      const src = constant(width, height, 0.5);
      const out = applyDither(src, width, height, settings('bayer', { matrixSize: size }), 10);

      let mismatches = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x + size < width; x++) {
          if (out[y * width + x] !== out[y * width + x + size]) mismatches++;
        }
      }
      for (let y = 0; y + size < height; y++) {
        for (let x = 0; x < width; x++) {
          if (out[y * width + x] !== out[(y + size) * width + x]) mismatches++;
        }
      }
      expect(mismatches).toBe(0);

      const tile = new Set(Array.from(out.slice(0, size * size)));
      expect(tile.size).toBeGreaterThan(1);
    }
  });

  it('matrixSize 4 and 8 produce different outputs for a gradient', () => {
    const src = gradient(64, 8);
    const small = applyDither(src, 64, 8, settings('bayer', { matrixSize: 4 }), 2);
    const large = applyDither(src, 64, 8, settings('bayer', { matrixSize: 8 }), 2);
    expect(bytes(small)).not.toEqual(bytes(large));
    expectLattice(small, 2);
    expectLattice(large, 2);
  });
});

describe('serpentine scanning', () => {
  it('changes floydSteinberg output while staying on the lattice', () => {
    const src = gradient(64, 8);
    const straight = applyDither(src, 64, 8, settings('floydSteinberg', { serpentine: false }), 10);
    const snake = applyDither(src, 64, 8, settings('floydSteinberg', { serpentine: true }), 10);
    expect(bytes(straight)).not.toEqual(bytes(snake));
    expectLattice(straight, 10);
    expectLattice(snake, 10);

    for (const out of [straight, snake]) {
      for (let y = 0; y < 8; y++) {
        expect(Math.abs(rowMean(out, y, 64) - rowMean(src, y, 64))).toBeLessThan(0.1);
      }
    }
  });
});

describe('error diffusion actually dithers', () => {
  it('mixes both levels on a constant mid-gray plane', () => {
    const width = 32;
    const height = 32;
    const src = constant(width, height, 0.5);
    for (const algorithm of DITHERING_ALGORITHMS) {
      const out = applyDither(src, width, height, settings(algorithm), 2);
      const ones = countValue(out, 1);
      const zeros = countValue(out, 0);
      expect(zeros).toBeGreaterThan(0);
      expect(ones).toBeGreaterThan(0);
      expect(ones).toBeLessThan(out.length);
      const ratio = ones / out.length;
      expect(ratio).toBeGreaterThan(0.1);
      expect(ratio).toBeLessThan(0.9);
    }
  });

  it('spreads error beyond the first cell (atkinson is not a plain threshold)', () => {
    const width = 16;
    const height = 16;
    const src = constant(width, height, 0.5);
    const dithered = applyDither(src, width, height, settings('atkinson'), 2);
    const plain = applyDither(src, width, height, settings('none'), 2);
    expect(bytes(dithered)).not.toEqual(bytes(plain));
  });
});

describe('brightness preservation', () => {
  it('floydSteinberg keeps the per-row mean of a 0..1 gradient within 0.1', () => {
    const width = 64;
    const height = 16;
    const levels = 10;
    const src = gradient(width, height);
    const out = applyDither(src, width, height, settings('floydSteinberg'), levels);

    for (let y = 0; y < height; y++) {
      const drift = Math.abs(rowMean(out, y, width) - rowMean(src, y, width));
      expect(drift).toBeLessThan(0.1);

      let drops = 0;
      let maxDrop = 0;
      for (let x = 1; x < width; x++) {
        const drop = out[y * width + x - 1] - out[y * width + x];
        if (drop > 1e-6) {
          drops++;
          if (drop > maxDrop) maxDrop = drop;
        }
      }
      expect(maxDrop).toBeLessThanOrEqual(1 / (levels - 1) + 1e-6);
      expect(drops).toBeLessThan(width / 2);

      const blocks = 8;
      const blockSize = width / blocks;
      let previous = -Infinity;
      for (let b = 0; b < blocks; b++) {
        let sum = 0;
        for (let x = b * blockSize; x < (b + 1) * blockSize; x++) sum += out[y * width + x];
        const mean = sum / blockSize;
        expect(mean).toBeGreaterThanOrEqual(previous - 0.02);
        previous = mean;
      }
    }
  });
});

describe('edge cases', () => {
  it('handles a 1x1 plane without out-of-bounds access', () => {
    for (const algorithm of DITHER_IDS) {
      const out = applyDither(new Float32Array([0.42]), 1, 1, settings(algorithm), 10);
      expect(out.length).toBe(1);
      expectLattice(out, 10);
    }
  });

  it('handles zero width or height by plain-quantizing the whole plane', () => {
    const src = noise(10, 3);
    const plain = Array.from(applyDither(src, 10, 3, settings('none'), 10));
    const noWidth = applyDither(src, 0, 3, settings('floydSteinberg'), 10);
    const noHeight = applyDither(src, 10, 0, settings('floydSteinberg'), 10);
    expect(noWidth.length).toBe(src.length);
    expect(noHeight.length).toBe(src.length);
    expect(Array.from(noWidth)).toEqual(plain);
    expect(Array.from(noHeight)).toEqual(plain);
  });

  it('scans only width*height cells when the plane is longer', () => {
    const src = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]);
    const before = Array.from(src);
    const out = applyDither(src, 2, 2, settings('floydSteinberg'), 10);
    expect(out.length).toBe(10);
    expect(Array.from(src)).toEqual(before);
    expectLattice(out, 10);

    const plain = applyDither(src, 10, 1, settings('none'), 10);
    expect(Array.from(out.slice(4))).toEqual(Array.from(plain.slice(4)));
  });

  it('never reads past the end when width*height exceeds the plane', () => {
    const src = new Float32Array([0.2, 0.4, 0.6, 0.8, 0.5]);
    for (const algorithm of DITHER_IDS) {
      const out = applyDither(src, 4, 4, settings(algorithm), 2);
      expect(out.length).toBe(5);
      expectLattice(out, 2);
    }
  });
});

describe('metadata', () => {
  it('provides a non-empty label and description for every algorithm', () => {
    const labels: string[] = [];
    for (const id of DITHER_IDS) {
      expect(ditherLabel(id).trim().length).toBeGreaterThan(0);
      expect(ditherDescription(id).trim().length).toBeGreaterThan(0);
      labels.push(ditherLabel(id));
    }
    expect(new Set(labels).size).toBe(labels.length);
  });
});
