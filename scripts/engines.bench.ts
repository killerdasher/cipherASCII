/**
 * `npm run bench:engines` — wall-clock benchmarks for the engines added by the
 * cipherASCII evolution: the layered canvas, the animation/compositor core and
 * the cell-effect pipeline.
 *
 * Run through vitest (`vitest.scripts.config.ts`) so the extensionless
 * TypeScript imports resolve exactly as they do in the app. Each case reports
 * the best of N runs; assertions only guard that the measurement is real.
 *
 * The "naive" rows are deliberate reference implementations of the old
 * behaviour (per-cell grid clones, per-effect full-frame copies). They exist
 * so the tables state a *relative* number instead of an absolute one that
 * depends on the machine.
 */

import { describe, expect, it } from 'vitest';
import { Plane } from '../src/core/canvas/plane';
import { FrameBuffer, composite } from '../src/core/canvas/compose';
import { diffFrames } from '../src/core/canvas/diff';
import { cellFxRuntime, gridToPlane, planeToGrid, CellEffectPipeline, CELL_EFFECT_MAP } from '../src/core/fx';
import { cloneGrid, createGrid } from '../src/core/grid';
import { Tween } from '../src/core/animation/tween';
import { getEasing } from '../src/core/animation/easing';
import type { AsciiGrid, Raster } from '../src/core/types';
import { applyEffectsToRaster, type EffectSettings, type EffectId } from '../src/core/effects/pipeline';

const SIZE: Array<[number, number]> = [
  [100, 50],
  [200, 100],
];

function bench(runs: number, fn: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

function printTable(title: string, headers: string[], rows: (string | number)[][]): void {
  const cells = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, col) => Math.max(...cells.map((row) => String(row[col]).length)));
  const line = (row: (string | number)[]) =>
    row.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  console.log(`\n${title}`);
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

/** In-place cell write — the operation the brush performs per touched cell. */
function writeCell(grid: AsciiGrid, x: number, y: number, ch: string, color: number): void {
  const i = y * grid.width + x;
  grid.chars[i] = ch;
  if (!grid.fg) grid.fg = new Int32Array(grid.width * grid.height).fill(-1);
  grid.fg[i] = color;
}

function makeGrid(width: number, height: number): AsciiGrid {
  const grid = createGrid(width, height);
  const ramp = ' .:-=+*#%@';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      writeCell(grid, x, y, ramp[(x * 7 + y * 3) % ramp.length], 0x88ccff);
    }
  }
  return grid;
}

function makePlane(width: number, height: number): Plane {
  const plane = new Plane(width, height);
  gridToPlane(plane, makeGrid(width, height));
  return plane;
}

describe('cell-effect pipeline', () => {
  const EFFECTS = ['decrypt', 'rain', 'scatter', 'cipherlock'];

  it('renders frames per effect at both grid sizes', () => {
    const rows: (string | number)[][] = [];
    for (const [w, h] of SIZE) {
      const source = makeGrid(w, h);
      for (const effectId of EFFECTS) {
        const pipeline = new CellEffectPipeline({ seed: 42, entries: [{ effect: effectId }] });
        const plane = new Plane(w, h);
        pipeline.bind(CELL_EFFECT_MAP, plane);
        gridToPlane(plane, source);
        pipeline.setSource(plane);
        const ms = bench(20, () => pipeline.apply(plane, 16));
        rows.push([
          `${w}x${h}`,
          effectId,
          ms.toFixed(3),
          Math.round((w * h) / (ms / 1000)).toLocaleString('en-US'),
        ]);
      }
    }
    printTable('cell effects (ms / frame — best of 20)', ['grid', 'effect', 'ms', 'cells/s'], rows);
    // Sanity: every case produced a real, sub-second measurement.
    expect(rows.length).toBe(SIZE.length * EFFECTS.length);
    for (const [, , ms] of rows) expect(Number(ms)).toBeGreaterThan(0);
    expect(Number(rows[0][2])).toBeLessThan(1000);
  });

  it('measures the whole editor runtime (bridge + effects)', () => {
    const rows: (string | number)[][] = [];
    for (const [w, h] of SIZE) {
      const grid = makeGrid(w, h);
      for (const effectId of ['rain', 'cipherlock']) {
        cellFxRuntime.reset();
        cellFxRuntime.sync([{ effect: effectId }], 42);
        const ms = bench(20, () => {
          cellFxRuntime.frame(grid, 16);
        });
        rows.push([`${w}x${h}`, effectId, ms.toFixed(3)]);
      }
    }
    printTable('live runtime frame (bridge + effect + readback, ms)', ['grid', 'effect', 'ms'], rows);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('measures grid ⇄ plane bridge throughput', () => {
    const rows: (string | number)[][] = [];
    for (const [w, h] of SIZE) {
      const grid = makeGrid(w, h);
      const plane = new Plane(w, h);
      const toPlane = bench(50, () => gridToPlane(plane, grid));
      let out: AsciiGrid | null = null;
      const toGrid = bench(50, () => {
        out = planeToGrid(plane, out);
      });
      const cells = w * h;
      rows.push([
        `${w}x${h}`,
        toPlane.toFixed(3),
        Math.round(cells / (toPlane / 1000)).toLocaleString('en-US'),
        toGrid.toFixed(3),
        Math.round(cells / (toGrid / 1000)).toLocaleString('en-US'),
      ]);
      expect(out).not.toBeNull();
    }
    printTable(
      'bridge (ms / pass — best of 50)',
      ['grid', '→plane ms', 'cells/s', '→grid ms', 'cells/s'],
      rows,
    );
    expect(rows.length).toBe(SIZE.length);
  });
});

describe('grid mutation: clone-per-cell vs clone-once', () => {
  it('measures a brush stroke against the old per-cell clone cost', () => {
    const rows: (string | number)[][] = [];
    for (const [w, h] of SIZE) {
      const grid = makeGrid(w, h);
      const cells = w * h;

      // Old behaviour: every touched cell cloned the whole grid.
      const naive = bench(10, () => {
        let g = grid;
        for (let i = 0; i < 64; i++) g = cloneGrid(g);
        void g;
      });

      // Current behaviour: one clone per stroke, then in-place writes.
      const current = bench(10, () => {
        const g = cloneGrid(grid);
        for (let i = 0; i < 64; i++) {
          const x = i % w;
          const y = (i * 3) % h;
          writeCell(g, x, y, '#', 0xffffff);
        }
      });

      rows.push([
        `${w}x${h}`,
        naive.toFixed(3),
        current.toFixed(3),
        (naive / current).toFixed(1) + 'x',
        Math.round(cells * 64).toLocaleString('en-US'),
      ]);
    }
    printTable(
      '64-cell stroke (ms — best of 10)',
      ['grid', 'clone/cell', 'clone/once', 'speedup', 'cells touched'],
      rows,
    );
    for (const row of rows) expect(Number(String(row[3]).replace('x', ''))).toBeGreaterThan(1);
  });
});

describe('layered canvas compositor', () => {
  it('composites two planes and diffs the result', () => {
    const rows: (string | number)[][] = [];
    for (const [w, h] of SIZE) {
      const target = new FrameBuffer(w, h);
      const scratch = new FrameBuffer(w, h);
      const a = makePlane(w, h);
      const b = makePlane(w, h);
      // Second plane only touches a corner, which is what a real layer does.
      for (let y = 0; y < Math.min(8, h); y++) {
        for (let x = 0; x < Math.min(16, w); x++) b.setGlyph(x, y, '*', 0xff0000);
      }

      const composeMs = bench(50, () => {
        composite([a, b], target, scratch);
      });

      // Compose twice: the second pass is over identical content, so the diff
      // should report zero changed cells.
      composite([a, b], target, scratch);
      const prev = new FrameBuffer(w, h);
      prev.glyph.set(target.glyph);
      prev.fg.set(target.fg);
      prev.bg.set(target.bg);
      prev.alpha.set(target.alpha);
      prev.attr.set(target.attr);
      const clean = diffFrames(prev, target, { boundsW: w, boundsH: h });
      const diffClean = bench(50, () => diffFrames(prev, target, { boundsW: w, boundsH: h }));

      // Recolour the top two rows — a contiguous change, which is what an
      // animated band looks like, and what the diff should turn into one run.
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < w; x++) target.fg[y * w + x] = 0xff00ff;
      }
      const dirty = diffFrames(prev, target, { boundsW: w, boundsH: h });

      rows.push([
        `${w}x${h}`,
        composeMs.toFixed(3),
        diffClean.toFixed(3),
        clean.changed,
        dirty.strategy,
      ]);
    }
    printTable(
      'composite + dirty diff (ms — best of 50)',
      ['grid', 'compose', 'diff (clean)', 'clean cells', 'dirty strategy'],
      rows,
    );
    expect(Number(rows[0][3])).toBe(0);
    for (const row of rows) expect(row[4]).toBe('diff');
  });
});

describe('animation core', () => {
  it('advances tweens at frame rate', () => {
    const rows: (string | number)[][] = [];
    for (const count of [1000, 10000]) {
      const tweens = Array.from(
        { length: count },
        () => new Tween({ from: 0, to: 1, duration: 1000, ease: getEasing('easeOutCubic') }),
      );
      const ms = bench(50, () => {
        for (const t of tweens) t.update(16);
      });
      rows.push([count, ms.toFixed(3), Math.round(count / (ms / 1000)).toLocaleString('en-US')]);
    }
    printTable('tween update (ms — best of 50)', ['tweens', 'ms', 'tweens/s'], rows);
    expect(rows.length).toBe(2);
    expect(Number(rows[1][1])).toBeLessThan(1000);
  });
});

describe('raster effects pipeline', () => {
  // 512x512 RGBA (1 MB per frame) with a realistic six-effect stack. Every
  // effect used to allocate its own full-frame copy (N+1 allocations per
  // render), which is what this case exists to measure.
  const SIZE = 512;
  const STACK: EffectId[] = ['bloom', 'chromaticAberration', 'blur', 'scanlines', 'filmGrain', 'vignette'];

  function makeRaster(): Raster {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        data[i] = (x * 7) & 0xff;
        data[i + 1] = (y * 5) & 0xff;
        data[i + 2] = ((x ^ y) * 3) & 0xff;
        data[i + 3] = 255;
      }
    }
    return { width: SIZE, height: SIZE, data };
  }

  const effects: EffectSettings[] = STACK.map((id) => ({ id, enabled: true, intensity: 0.7, params: {} }));

  it('breaks the stack down effect by effect', async () => {
    const rows: (string | number)[][] = [];
    for (const id of STACK) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 4; i++) {
        const started = performance.now();
        await applyEffectsToRaster(makeRaster(), { effects: [{ id, enabled: true, intensity: 0.7, params: {} }] }, 1);
        best = Math.min(best, performance.now() - started);
      }
      rows.push([id, best.toFixed(2)]);
    }
    rows.sort((a, b) => Number(b[1]) - Number(a[1]));
    printTable('per-effect cost (512x512, single effect, best ms)', ['effect', 'ms'], rows);
    expect(rows.length).toBe(STACK.length);
  });

  it('shows how cost scales with source size', async () => {
    const rows: (string | number)[][] = [];
    for (const size of [512, 1024, 2048]) {
      const data = new Uint8ClampedArray(size * size * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (i * 7) & 0xff;
        data[i + 1] = (i * 5) & 0xff;
        data[i + 2] = (i * 3) & 0xff;
        data[i + 3] = 255;
      }
      const raster: Raster = { width: size, height: size, data };
      const started = performance.now();
      await applyEffectsToRaster(raster, { effects }, 1);
      const ms = performance.now() - started;
      const megarixels = (size * size) / 1e6;
      rows.push([`${size}x${size}`, megarixels.toFixed(2), ms.toFixed(1), ((megarixels / ms) * 1000).toFixed(1)]);
    }
    printTable('stack cost vs source size (6 effects)', ['source', 'Mpx', 'ms', 'Mpx/s'], rows);
    expect(rows.length).toBe(3);
  });

  it('applies a six-effect stack to a 512x512 raster', async () => {
    const runs = 5;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < runs; i++) {
      const started = performance.now();
      await applyEffectsToRaster(makeRaster(), { effects }, 1);
      best = Math.min(best, performance.now() - started);
    }
    const megarixels = (SIZE * SIZE) / 1e6;
    printTable(
      'raster effects (512x512 RGBA = 1 MB, 6-effect stack)',
      ['best ms', 'Mpx/s', 'per-effect ms'],
      [[best.toFixed(2), ((megarixels / best) * 1000).toFixed(1), (best / STACK.length).toFixed(2)]],
    );
    expect(best).toBeGreaterThan(0);
  });
});
