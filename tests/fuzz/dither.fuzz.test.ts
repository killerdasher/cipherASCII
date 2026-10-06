/**
 * Property tests for `applyDither`: adversarial planes (NaN, Infinity, huge
 * magnitudes), mismatched dimensions and nonsensical levels must never throw
 * and must always produce a finite plane of the same length as the input.
 */

import { describe, expect, it } from 'vitest';
import { DITHER_IDS, applyDither } from '../../src/core/dither';
import type { DitherSettings } from '../../src/core/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xd17be3);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];

const ADVERSARIAL = [
  0,
  -1,
  1,
  1e-9,
  1e9,
  -1e9,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
];

const BAD_LEVELS = [0, -1, 1, 1.7, 2, 8, 64, 1000, Number.NaN, Number.POSITIVE_INFINITY];

function randomSettings(): DitherSettings {
  return {
    algorithm: pick(DITHER_IDS),
    strength: pick([...ADVERSARIAL, rand(), -3, 42]),
    serpentine: rand() < 0.5,
    matrixSize: rand() < 0.5 ? 4 : 8,
  };
}

describe('fuzz: dither', () => {
  it('survives adversarial planes, sizes and levels', () => {
    for (let iteration = 0; iteration < 120; iteration++) {
      const length = int(1, 512);
      const plane = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        plane[i] =
          rand() < 0.4 ? pick(ADVERSARIAL) : (rand() - 0.5) * int(1, 1000);
      }

      // Dimensions deliberately allowed to disagree with the plane length and
      // to be zero/negative: callers hand these straight from user input.
      const width = pick([-4, 0, 1, int(1, 64)]);
      const height = pick([-4, 0, 1, int(1, 64)]);
      const settings = randomSettings();
      const levels = pick(BAD_LEVELS);

      let out: Float32Array | undefined;
      expect(() => {
        out = applyDither(plane, width, height, settings, levels);
      }).not.toThrow();
      if (!out) continue;

      expect(out.length).toBe(plane.length);
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i])).toBe(true);
        expect(out[i]).toBeGreaterThanOrEqual(0);
        expect(out[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('strength 0 leaves the plane alone, strength 1 fully applies it', () => {
    const width = 16;
    const height = 16;
    const plane = new Float32Array(width * height);
    for (let i = 0; i < plane.length; i++) plane[i] = (i % 7) / 7;

    const base: DitherSettings = {
      algorithm: 'floydSteinberg',
      strength: 0,
      serpentine: true,
      matrixSize: 8,
    };
    const untouched = applyDither(plane, width, height, base, 4);
    for (let i = 0; i < plane.length; i++) {
      expect(untouched[i]).toBeCloseTo(Math.round(plane[i] * 3) / 3, 5);
    }

    const applied = applyDither(plane, width, height, { ...base, strength: 1 }, 4);
    expect(applied.length).toBe(plane.length);
    for (const value of applied) expect(Number.isFinite(value)).toBe(true);
  });
});
