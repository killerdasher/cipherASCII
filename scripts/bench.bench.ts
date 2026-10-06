/**
 * `npm run bench` — wall-clock benchmarks for the hot paths of the core.
 *
 * Executed through vitest (see `vitest.scripts.config.ts`) so the extensionless
 * TypeScript imports used by `src/**` resolve exactly as they do in the app.
 * Every case reports the best of N runs and prints a table; assertions only
 * guard that the measurements are real (non-zero, well-formed output).
 */

import { describe, expect, it } from 'vitest';
import { renderImageToGrid } from '../src/core/renderImage';
import { renderTextToGrid } from '../src/core/text/render';
import { DITHER_IDS, applyDither } from '../src/core/dither';
import { createRaster, setPixel } from '../src/core/image/raster';
import {
  DEFAULT_IMAGE_RENDER,
  DEFAULT_TEXT_RENDER,
  type DitherSettings,
  type ImageRenderSettings,
  type Raster,
} from '../src/core/types';

function gradient(size: number): Raster {
  const raster = createRaster(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = size > 1 ? Math.round((x / (size - 1)) * 255) : 0;
      setPixel(raster, x, y, (v << 16) | (v << 8) | v);
    }
  }
  return raster;
}

function bench<T>(runs: number, fn: () => T): { ms: number; result: T } {
  let ms = Number.POSITIVE_INFINITY;
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    result = fn();
    ms = Math.min(ms, performance.now() - started);
  }
  return { ms, result };
}

function printTable(headers: string[], rows: (string | number)[][]): void {
  const cells = [headers, ...rows.map((row) => row.map(String))];
  const widths = headers.map((_, col) =>
    Math.max(...cells.map((row) => String(row[col]).length)),
  );
  const line = (row: (string | number)[]) =>
    row.map((value, col) => String(value).padEnd(widths[col])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log('');
}

const imageSettings = (): ImageRenderSettings => ({
  ...structuredClone(DEFAULT_IMAGE_RENDER),
  columns: 160,
});

describe('bench', () => {
  it('image -> ASCII render throughput', () => {
    const rows: (string | number)[][] = [];
    for (const size of [256, 512, 1024]) {
      const raster = gradient(size);
      const settings = imageSettings();
      renderImageToGrid(raster, settings); // warm up
      const { ms, result } = bench(5, () => renderImageToGrid(raster, settings));
      const cells = result.grid.width * result.grid.height;
      rows.push([
        `${size}x${size}`,
        ms.toFixed(2),
        `${result.grid.width}x${result.grid.height}`,
        Math.round((cells / ms) * 1000).toLocaleString('en-US'),
      ]);
      expect(cells).toBeGreaterThan(0);
      expect(ms).toBeGreaterThan(0);
    }
    console.log('image -> ASCII (columns=160, best of 5)');
    printTable(['source', 'ms', 'grid', 'cells/s'], rows);
  });

  it('text -> ASCII render throughput', () => {
    const rows: (string | number)[][] = [];
    const settings = structuredClone(DEFAULT_TEXT_RENDER);
    for (const length of [50, 500, 5000]) {
      const text = 'ASCII Art Studio 0123456789 @#%&*\n'.repeat(
        Math.max(1, Math.ceil(length / 34)),
      );
      renderTextToGrid(text.slice(0, length), settings); // warm up
      const { ms, result } = bench(5, () => renderTextToGrid(text.slice(0, length), settings));
      rows.push([
        `${length} chars`,
        ms.toFixed(2),
        `${result.width}x${result.height}`,
        Math.round((result.width * result.height * 1000) / ms).toLocaleString('en-US'),
      ]);
      expect(result.chars.length).toBe(result.width * result.height);
    }
    console.log('text -> ASCII (font=block, best of 5)');
    printTable(['input', 'ms', 'grid', 'cells/s'], rows);
  });

  it('dither throughput', () => {
    const width = 256;
    const height = 256;
    const plane = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) plane[y * width + x] = x / (width - 1);
    }
    const rows: (string | number)[][] = [];
    for (const algorithm of DITHER_IDS) {
      const settings: DitherSettings = {
        algorithm,
        strength: 1,
        serpentine: true,
        matrixSize: 8,
      };
      applyDither(plane, width, height, settings, 8); // warm up
      const { ms } = bench(20, () => applyDither(plane, width, height, settings, 8));
      rows.push([algorithm, ms.toFixed(3), Math.round((plane.length / ms) * 1000).toLocaleString('en-US')]);
      expect(ms).toBeGreaterThan(0);
    }
    console.log(`dither on 256x256 plane to 8 levels (best of 20, ${DITHER_IDS.length} algorithms)`);
    printTable(['algorithm', 'ms', 'px/s'], rows);
  });
});
