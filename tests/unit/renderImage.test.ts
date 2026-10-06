import { describe, expect, it } from 'vitest';
import {
  CancelledRender,
  MAX_COLUMNS,
  MAX_ROWS,
  columnsForImageWidth,
  computeGridSize,
  renderImageToGrid,
} from '../../src/core/renderImage';
import { createRaster, setPixel } from '../../src/core/image/raster';
import {
  CELL_SIZE,
  DEFAULT_IMAGE_RENDER,
  StudioError,
  type ImageRenderSettings,
  type Raster,
} from '../../src/core/types';

function solid(width: number, height: number, color: number): Raster {
  return createRaster(width, height, color);
}

function horizontalGradient(width: number, height: number): Raster {
  const r = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = width > 1 ? Math.round((x / (width - 1)) * 255) : 0;
      setPixel(r, x, y, (v << 16) | (v << 8) | v);
    }
  }
  return r;
}

function leftBlackRightWhite(width: number, height: number): Raster {
  const r = createRaster(width, height, 0xffffff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width / 2; x++) setPixel(r, x, y, 0x000000);
  }
  return r;
}

function settings(patch: Partial<ImageRenderSettings> = {}): ImageRenderSettings {
  return {
    ...structuredClone(DEFAULT_IMAGE_RENDER),
    columns: 24,
    ...patch,
  };
}

describe('computeGridSize', () => {
  it('applies the terminal aspect ratio (half the rows of square cells)', () => {
    const terminal = computeGridSize(100, 50, settings({ columns: 40 }));
    expect(terminal).toEqual({ cols: 40, rows: 10 });

    const square = computeGridSize(
      100,
      50,
      settings({ columns: 40, aspect: { preset: 'square', ratio: 1 } }),
    );
    expect(square).toEqual({ cols: 40, rows: 20 });
  });

  it('keeps a square source square under the terminal ratio', () => {
    expect(computeGridSize(64, 64, settings({ columns: 100 }))).toEqual({
      cols: 100,
      rows: 50,
    });
  });

  it('honours a custom aspect ratio', () => {
    const size = computeGridSize(
      100,
      100,
      settings({ columns: 20, aspect: { preset: 'custom', ratio: 2 } }),
    );
    expect(size).toEqual({ cols: 20, rows: 40 });
  });

  it('clamps to the hard cell limits', () => {
    const size = computeGridSize(1, 1, settings({ columns: 5000 }));
    expect(size.cols).toBe(MAX_COLUMNS);

    const rows = computeGridSize(10000, 9999, settings({ columns: MAX_COLUMNS }));
    expect(rows.rows).toBeLessThanOrEqual(MAX_ROWS);
    expect(rows.rows).toBeGreaterThanOrEqual(1);
  });

  it('supports fixed target rows', () => {
    const cover = settings({ fit: 'cover', columns: 30 });
    expect(computeGridSize(100, 40, cover, 12)).toEqual({ cols: 30, rows: 12 });

    const contain = settings({ fit: 'contain', columns: 30 });
    const natural = Math.round(((40 * 30) / 100) * 0.5);
    expect(computeGridSize(100, 40, contain, 1000)).toEqual({ cols: 30, rows: natural });
    expect(computeGridSize(100, 40, contain, 5).rows).toBeLessThanOrEqual(5);
  });

  it('never returns zero dimensions for degenerate sources', () => {
    const size = computeGridSize(0, 0, settings({ columns: 10 }));
    expect(size.cols).toBeGreaterThanOrEqual(1);
    expect(size.rows).toBeGreaterThanOrEqual(1);
  });
});

describe('renderImageToGrid', () => {
  it('maps a white source to the lightest charset cell everywhere', () => {
    const { grid, stats } = renderImageToGrid(solid(16, 16, 0xffffff), settings());
    const charset = [...DEFAULT_IMAGE_RENDER.output.charset];
    const lightest = charset[charset.length - 1];

    expect(grid.width).toBe(24);
    expect(grid.height).toBeGreaterThan(0);
    expect(grid.chars.every((ch) => ch === lightest)).toBe(true);
    expect(stats.cells).toBe(grid.width * grid.height);
    expect(stats.sourceWidth).toBe(16);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps a black source to the densest charset cell everywhere', () => {
    const { grid } = renderImageToGrid(solid(16, 16, 0x000000), settings());
    expect(grid.chars.every((ch) => ch === '@')).toBe(true);
  });

  it('produces a monotonic ramp for a horizontal gradient', () => {
    const { grid } = renderImageToGrid(horizontalGradient(64, 16), settings());
    const charset = [...DEFAULT_IMAGE_RENDER.output.charset];
    const firstRow = [...grid.chars.slice(0, grid.width)];

    expect(firstRow[0]).toBe('@');
    expect(firstRow[firstRow.length - 1]).toBe(' ');
    for (let x = 1; x < firstRow.length; x++) {
      const prev = charset.indexOf(firstRow[x - 1]);
      const cur = charset.indexOf(firstRow[x]);
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });

  it('flips the ramp when output.invert is set', () => {
    const inverted = settings();
    inverted.output = { ...inverted.output, invert: true };
    const { grid } = renderImageToGrid(solid(16, 16, 0xffffff), inverted);
    expect(grid.chars.every((ch) => ch === '@')).toBe(true);
  });

  it('honours the luminance standard when selecting glyphs', () => {
    // Pure red reads brighter under BT.601 (0.299) than BT.709 (0.2126),
    // so the same pixel must land on a lighter glyph of the ramp.
    const red = solid(1, 1, 0xff0000);
    const base = settings({
      columns: 1,
      aspect: { preset: 'custom', ratio: 0.5 },
      colorMode: 'none',
    });
    const bt601 = renderImageToGrid(red, { ...base, luminanceStandard: 'rec601' });
    const bt709 = renderImageToGrid(red, { ...base, luminanceStandard: 'rec709' });

    expect(bt601.grid.chars[0]).not.toBe(bt709.grid.chars[0]);
    const charset = [...DEFAULT_IMAGE_RENDER.output.charset];
    expect(charset.indexOf(bt601.grid.chars[0])).toBeGreaterThan(
      charset.indexOf(bt709.grid.chars[0]),
    );
  });

  it('crops to the selected region before rendering', () => {
    const source = leftBlackRightWhite(32, 16);
    const cropped = settings({
      columns: 20,
      crop: { enabled: true, x: 0, y: 0, width: 0.5, height: 1 },
    });
    const { grid } = renderImageToGrid(source, cropped);
    expect(grid.chars.every((ch) => ch === '@')).toBe(true);
  });

  it('renders braille cells at the requested grid size', () => {
    const braille = settings({ columns: 12, mode: 'braille' });
    const black = renderImageToGrid(solid(8, 8, 0x000000), braille);
    expect(black.grid.width).toBe(12);
    expect(black.grid.height).toBeGreaterThan(0);
    expect(black.grid.chars.every((ch) => ch === '⣿')).toBe(true);

    const white = renderImageToGrid(solid(8, 8, 0xffffff), braille);
    expect(white.grid.chars.every((ch) => ch === ' ')).toBe(true);
  });

  it('packs half-blocks with upper/lower block characters', () => {
    const half = settings({
      columns: 4,
      aspect: { preset: 'square', ratio: 1 },
      mode: 'halfblocks',
    });
    const source = solid(4, 4, 0xffffff);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) setPixel(source, x, y, 0x000000);
    }

    const { grid } = renderImageToGrid(source, half);
    expect(grid.height).toBe(4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < grid.width; x++) {
        expect(grid.chars[y * grid.width + x]).toBe('█');
      }
    }
    for (let y = 2; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        expect(grid.chars[y * grid.width + x]).toBe(' ');
      }
    }
  });

  it('samples colours only when colorMode is enabled', () => {
    const none = renderImageToGrid(solid(8, 8, 0xff0000), settings({ colorMode: 'none' }));
    expect(none.grid.fg).toBeNull();
    expect(none.grid.bg).toBeNull();

    const sample = renderImageToGrid(
      solid(8, 8, 0xff0000),
      settings({ columns: 6, colorMode: 'sample' }),
    );
    expect(sample.grid.fg).not.toBeNull();
    expect([...(sample.grid.fg ?? [])].every((c) => c === 0xff0000)).toBe(true);

    const ansi = renderImageToGrid(
      solid(8, 8, 0xff0000),
      settings({ columns: 6, colorMode: 'ansi256' }),
    );
    const colors = new Set([...(ansi.grid.fg ?? [])]);
    expect(colors.size).toBe(1);
    expect(colors.has(-1) || colors.has(0)).toBe(false);
  });

  it('honours target rows for fixed-height output', () => {
    const fixed = settings({ columns: 40, fit: 'cover' });
    const { grid } = renderImageToGrid(solid(100, 30, 0x808080), fixed, { targetRows: 9 });
    expect(grid.height).toBe(9);
    expect(grid.width).toBe(40);
  });

  it('throws CancelledRender when the cancel flag trips', () => {
    let thrown: unknown;
    try {
      renderImageToGrid(solid(8, 8, 0x000000), settings(), { shouldCancel: () => true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CancelledRender);
    expect((thrown as StudioError).code).toBe('cancelled');
  });

  it('rejects a source with no pixels', () => {
    const empty: Raster = { width: 0, height: 0, data: new Uint8ClampedArray(0) };
    let thrown: unknown;
    try {
      renderImageToGrid(empty, settings());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StudioError);
    expect((thrown as StudioError).code).toBe('invalid-input');
  });

  it('is deterministic: identical inputs give identical grids', () => {
    const source = horizontalGradient(32, 32);
    const a = renderImageToGrid(source, settings({ mode: 'braille' })).grid;
    const b = renderImageToGrid(horizontalGradient(32, 32), settings({ mode: 'braille' })).grid;
    expect(a.chars).toEqual(b.chars);
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
  });

  it('applies dithering when requested without changing the grid size', () => {
    const plain = renderImageToGrid(horizontalGradient(32, 16), settings());
    const dithered = renderImageToGrid(
      horizontalGradient(32, 16),
      settings({ dither: { algorithm: 'floydSteinberg', strength: 1, serpentine: true, matrixSize: 8 } }),
    );
    expect(dithered.grid.width).toBe(plain.grid.width);
    expect(dithered.grid.height).toBe(plain.grid.height);
    expect(dithered.grid.chars).not.toEqual(plain.grid.chars);
  });
});

describe('columnsForImageWidth (import auto-size)', () => {
  it('maps image pixels to columns of 8px cells', () => {
    expect(columnsForImageWidth(1920)).toBe(240);
    expect(columnsForImageWidth(64)).toBe(8);
    expect(columnsForImageWidth(8)).toBe(1);
    expect(columnsForImageWidth(1)).toBe(1);
    expect(columnsForImageWidth(0)).toBe(1);
  });

  it('never exceeds the grid limits', () => {
    expect(columnsForImageWidth(MAX_COLUMNS * CELL_SIZE.width + 400)).toBe(MAX_COLUMNS);
    expect(columnsForImageWidth(-500)).toBe(1);
  });

  it('gives a grid whose pixel footprint matches the source image', () => {
    const sizes: Array<[number, number]> = [
      [1920, 1080],
      [64, 64],
      [100, 100],
      [375, 667],
      [800, 450],
    ];
    for (const [w, h] of sizes) {
      const settings: ImageRenderSettings = {
        ...structuredClone(DEFAULT_IMAGE_RENDER),
        columns: columnsForImageWidth(w),
        aspect: { preset: 'terminal', ratio: 0.5 },
      };
      const { cols, rows } = computeGridSize(w, h, settings);
      expect(Math.abs(cols * CELL_SIZE.width - w)).toBeLessThanOrEqual(CELL_SIZE.width);
      expect(Math.abs(rows * CELL_SIZE.height - h)).toBeLessThanOrEqual(CELL_SIZE.height);
    }
  });
});
