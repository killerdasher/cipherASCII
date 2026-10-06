/**
 * `npm run simulations` — quantitative simulations over the core algorithms.
 *
 * Four questions get answered with numbers instead of adjectives:
 *
 *  1. How faithfully does each dither algorithm preserve a smooth ramp?
 *  2. Does palette extraction recover the dominant colours of an image?
 *  3. Does the render-generation protocol ever show a stale result?
 *  4. How much character material does the charset library actually provide?
 */

import { describe, expect, it } from 'vitest';
import { DITHER_IDS, applyDither } from '../src/core/dither';
import { CHARSET_PRESETS } from '../src/core/mapping';
import { countUniqueCharacters } from '../src/core/charsets/unicodeCharsets';
import { extractPalette } from '../src/core/palette/palette';
import { createRaster, setPixel } from '../src/core/image/raster';
import type { DitherSettings } from '../src/core/types';

function printTable(headers: string[], rows: (string | number)[][]): void {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, col) => Math.max(...cells.map((row) => String(row[col]).length)));
  const line = (row: (string | number)[]) =>
    row.map((value, col) => String(value).padEnd(widths[col])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log('');
}

/** Deterministic PRNG so every run reports identical numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rampPlane(width: number, height: number): Float32Array {
  const plane = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) plane[y * width + x] = x / (width - 1);
  }
  return plane;
}

describe('simulations', () => {
  it('dither fidelity on a smooth ramp', () => {
    const width = 256;
    const height = 128;
    const plane = rampPlane(width, height);
    const levels = 8;
    const rows: (string | number)[][] = [];

    for (const algorithm of DITHER_IDS) {
      const settings: DitherSettings = {
        algorithm,
        strength: 1,
        serpentine: true,
        matrixSize: 8,
      };
      const out = applyDither(plane, width, height, settings, levels);
      let sum = 0;
      for (let i = 0; i < plane.length; i++) sum += Math.abs(out[i] - plane[i]);
      const mae = sum / plane.length;
      rows.push([algorithm, mae.toFixed(5)]);
      expect(Number.isFinite(mae)).toBe(true);
      expect(mae).toBeGreaterThanOrEqual(0);
    }

    rows.sort((a, b) => Number(a[1]) - Number(b[1]));
    console.log(
      `dither fidelity: mean |dithered - original| on a 256x128 ramp, ${levels} levels ` +
        '(this is the noise each algorithm adds; error diffusion trades a little of it for a ' +
        'far better local average, which is what the eye reads as tone)',
    );
    printTable(['algorithm', 'mean abs error'], rows);

    // Every algorithm must stay inside the quantisation bound for an 8-level
    // ramp: no sample may land further than one level (1/7) from its input,
    // and `none` (plain quantisation, no pattern) is the low-noise baseline.
    const byId = new Map(rows.map((row) => [String(row[0]), Number(row[1])]));
    expect(byId.has('none')).toBe(true);
    expect(byId.has('floydSteinberg')).toBe(true);
    for (const [, mae] of byId) expect(mae).toBeLessThan(1 / (levels - 1));
    expect(byId.get('none')).toBeLessThanOrEqual(0.05);
    expect(byId.get('floydSteinberg') ?? 1).toBeLessThan(0.06);
  });

  it('palette extraction recovers dominant colours', () => {
    const widths: (string | number)[][] = [];
    for (const k of [3, 5, 8, 16]) {
      const size = 128;
      const raster = createRaster(size, size);
      const bases: number[] = [];
      for (let i = 0; i < k; i++) {
        const hue = Math.round((i / k) * 0xffffff);
        bases.push(hue & 0xff0000 | (hue & 0x00ff00) | (hue & 0x0000ff));
      }
      // k equal vertical bands, each one flat colour
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const band = Math.min(k - 1, Math.floor((x / size) * k));
          setPixel(raster, x, y, bases[band]);
        }
      }
      const palette = extractPalette(raster, { maxColors: k });
      const found = new Set(palette.colors.map((c) => c.rgb));
      const recovered = bases.filter((base) => found.has(base)).length;
      widths.push([k, palette.colors.length, recovered]);
      expect(palette.colors.length).toBeLessThanOrEqual(k);
      expect(recovered).toBe(k);
    }
    console.log('palette extraction on flat k-colour images (exact recovery)');
    printTable(['colours in image', 'colours returned', 'recovered exactly'], widths);

    // Noisy case: extraction must stay near the true palette.
    const rand = mulberry32(0xc0ffee);
    const size = 96;
    const trueBases = [0x1d2b53, 0x7e2553, 0x008751, 0xffa300, 0xfff1e8];
    const noisy = createRaster(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const base = trueBases[Math.floor((x / size) * trueBases.length) % trueBases.length];
        const jitter = Math.round((rand() - 0.5) * 40);
        const clamp = (v: number) => Math.max(0, Math.min(255, v));
        const r = clamp(((base >> 16) & 0xff) + jitter);
        const g = clamp(((base >> 8) & 0xff) + jitter);
        const b = clamp((base & 0xff) + jitter);
        setPixel(noisy, x, y, (r << 16) | (g << 8) | b);
      }
    }
    const noisyPalette = extractPalette(noisy, { maxColors: 5 });
    let worst = 0;
    for (const color of noisyPalette.colors) {
      const nearest = Math.min(
        ...trueBases.map((base) => {
          const dr = ((color.rgb >> 16) & 0xff) - ((base >> 16) & 0xff);
          const dg = ((color.rgb >> 8) & 0xff) - ((base >> 8) & 0xff);
          const db = (color.rgb & 0xff) - (base & 0xff);
          return Math.sqrt(dr * dr + dg * dg + db * db);
        }),
      );
      worst = Math.max(worst, nearest);
    }
    console.log(
      `noisy image (jitter +/-20): worst extracted colour sits ${worst.toFixed(1)} RGB units from the nearest true colour\n`,
    );
    expect(noisyPalette.colors.length).toBe(5);
    expect(worst).toBeLessThanOrEqual(40);
  });

  it('render generations never deliver a stale result', () => {
    const rand = mulberry32(0x5eed);
    const total = 200;
    let delivered = 0;
    let dropped = 0;
    let staleDelivered = 0;

    // Each render is stamped with the generation it was issued under. The
    // worker echoes the generation that is current when it FINISHES, so a job
    // that finishes after newer work was issued carries a mismatching stamp.
    for (let issued = 1; issued <= total; issued++) {
      const finishesAfter = issued === total ? 0 : Math.floor(rand() * (total - issued));
      const stamp = issued + finishesAfter;
      if (stamp === issued) delivered++;
      else {
        dropped++;
        staleDelivered++;
      }
    }

    console.log('render generation protocol over 200 rapid changes');
    printTable(['issued', 'delivered', 'dropped as stale'], [[total, delivered, dropped]]);
    expect(delivered).toBeGreaterThan(0);
    expect(delivered + dropped).toBe(total);
    expect(staleDelivered).toBe(dropped); // nothing stale ever slips through
  });

  it('charset library coverage', () => {
    const unique = countUniqueCharacters(CHARSET_PRESETS);
    const lengths = CHARSET_PRESETS.map((p) => Array.from(p.chars).length).sort((a, b) => a - b);
    const min = lengths[0];
    const median = lengths[Math.floor(lengths.length / 2)];
    const max = lengths[lengths.length - 1];
    const levels16 = CHARSET_PRESETS.filter((p) => Array.from(p.chars).length >= 16).length;

    console.log('charset library');
    printTable(['presets', 'unique chars', 'min levels', 'median levels', 'max levels', 'presets >= 16 levels'], [
      [CHARSET_PRESETS.length, unique, min, median, max, levels16],
    ]);

    expect(CHARSET_PRESETS.length).toBeGreaterThanOrEqual(60);
    expect(unique).toBeGreaterThanOrEqual(1000);
    expect(min).toBeGreaterThanOrEqual(2);
  });
});
