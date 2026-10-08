/**
 * Image -> ASCII rendering pipeline.
 *
 *   crop -> resize (per render-mode geometry) -> [effects] -> preprocess
 *   -> luminance -> mapping strategy -> dither -> glyph selection
 *   -> colour sampling -> AsciiGrid
 *
 * The `[effects]` slot is where `effectSpace: 'grid'` inserts the raster
 * effect stack; the default (`'source'`) runs it on the full-resolution image
 * before `prepareSampledRaster` instead.
 *
 * The pipeline is pure and synchronous; the application runs it inside a
 * worker with generation checks so the UI never shows stale results.
 */

import { applyDither } from './dither';
import { getMappingStrategy, inkToIndex, runMapping } from './mapping';
import { computeCellFeatures } from './analysis/cellFeatures';
import { sortRampByInk } from './glyph/sort';
import { applyPreprocess, type ShouldCancel } from './image/preprocess';
import { resizeRaster } from './image/resize';
import { lumaPlane } from './image/raster';
import { ANSI16, ANSI256, rgbToAnsi16, rgbToAnsi256 } from './color';
import { clamp } from './util';
import {
  ASPECT_PRESETS,
  CELL_SIZE,
  NO_COLOR,
  StudioError,
  type AsciiGrid,
  type ColorMode,
  type ImageRenderSettings,
  type Raster,
  type RenderResult,
} from './types';

export const MAX_COLUMNS = 1000;
export const MAX_ROWS = 1000;

/**
 * Column count that makes the rendered grid occupy the same pixel width as the
 * source image: the editor draws one `CELL_SIZE.width` (8px) wide cell per
 * column, so `width / 8` lines the ASCII up with the original picture.
 */
export function columnsForImageWidth(sourceWidth: number): number {
  return clamp(Math.round(sourceWidth / CELL_SIZE.width), 1, MAX_COLUMNS);
}

export class CancelledRender extends StudioError {
  constructor() {
    super('cancelled', 'Render cancelled');
  }
}

function check(cancel?: ShouldCancel): void {
  if (cancel && cancel()) throw new CancelledRender();
}

export interface GridSize {
  cols: number;
  rows: number;
}

/**
 * Compute the output grid size for a source image.
 *
 * `rows = round(sourceHeight * cols / sourceWidth * aspectRatio)` where
 * `aspectRatio = cellWidth / cellHeight`. Terminal cells are about half as
 * wide as they are tall (0.5), so a square image needs half as many rows as
 * columns to stay square once rendered.
 */
export function computeGridSize(
  sourceWidth: number,
  sourceHeight: number,
  settings: ImageRenderSettings,
  targetRows?: number,
): GridSize {
  const cols = clamp(Math.round(settings.columns), 1, MAX_COLUMNS);
  const ratio =
    settings.aspect.preset === 'custom'
      ? clamp(settings.aspect.ratio, 0.05, 10)
      : ASPECT_PRESETS[settings.aspect.preset] ?? 0.5;
  const srcW = Math.max(1, sourceWidth);
  const srcH = Math.max(1, sourceHeight);

  if (targetRows !== undefined && targetRows > 0) {
    const maxRows = clamp(Math.round(targetRows), 1, MAX_ROWS);
    if (settings.fit === 'contain') {
      const natural = ((srcH * cols) / srcW) * ratio;
      return { cols, rows: clamp(Math.round(natural), 1, maxRows) };
    }
    return { cols, rows: maxRows };
  }
  const rows = Math.round(((srcH * cols) / srcW) * ratio);
  return { cols, rows: clamp(rows, 1, MAX_ROWS) };
}

interface Geometry {
  /** Sampling resolution before per-cell reduction. */
  sampleW: number;
  sampleH: number;
  /** Per-cell sub-pixel layout. */
  subX: number;
  subY: number;
  pack: 'average' | 'braille' | 'halfblock' | 'quadrant';
}

function geometryFor(settings: ImageRenderSettings, cols: number, rows: number): Geometry {
  const ss = clamp(Math.round(settings.supersample), 1, 8);
  switch (settings.mode) {
    case 'braille':
      return { sampleW: cols * 2, sampleH: rows * 4, subX: 2, subY: 4, pack: 'braille' };
    case 'halfblocks':
      return { sampleW: cols, sampleH: rows * 2, subX: 1, subY: 2, pack: 'halfblock' };
    case 'quadrants':
      return { sampleW: cols * 2, sampleH: rows * 2, subX: 2, subY: 2, pack: 'quadrant' };
    case 'chars':
    default:
      return { sampleW: cols * ss, sampleH: rows * ss, subX: ss, subY: ss, pack: 'average' };
  }
}

/** Average an (cols*subX, rows*subY) plane down to one value per cell. */
function averageToCells(
  plane: Float32Array,
  sampleW: number,
  cols: number,
  rows: number,
  subX: number,
  subY: number,
): Float32Array {
  const out = new Float32Array(cols * rows);
  const sampleH = plane.length / sampleW;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0;
      let n = 0;
      for (let sy = 0; sy < subY; sy++) {
        const y = cy * subY + sy;
        if (y >= sampleH) break;
        const rowBase = y * sampleW;
        for (let sx = 0; sx < subX; sx++) {
          const x = cx * subX + sx;
          if (x >= sampleW) break;
          const idx = rowBase + x;
          if (idx >= plane.length) break;
          sum += plane[idx];
          n++;
        }
      }
      out[cy * cols + cx] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

const BRAILLE_BASE = 0x2800;
/**
 * Unicode braille dot layout inside a 2x4 cell:
 *   col0 rows: dots 1,2,3,7 -> bits 0,1,2,6
 *   col1 rows: dots 4,5,6,8 -> bits 3,4,5,7
 */
function brailleChar(on: (x: number, y: number) => boolean, x0: number, y0: number): string {
  let bits = 0;
  if (on(x0, y0)) bits |= 1 << 0;
  if (on(x0, y0 + 1)) bits |= 1 << 1;
  if (on(x0, y0 + 2)) bits |= 1 << 2;
  if (on(x0 + 1, y0)) bits |= 1 << 3;
  if (on(x0 + 1, y0 + 1)) bits |= 1 << 4;
  if (on(x0 + 1, y0 + 2)) bits |= 1 << 5;
  if (on(x0, y0 + 3)) bits |= 1 << 6;
  if (on(x0 + 1, y0 + 3)) bits |= 1 << 7;
  return bits === 0 ? ' ' : String.fromCharCode(BRAILLE_BASE + bits);
}

const QUADRANT_CHARS = [
  ' ', // 0000
  '▘', // 0001 top-left
  '▝', // 0010 top-right
  '▀', // 0011 top half
  '▖', // 0100 bottom-left
  '▚', // 0101 top-left + bottom-right
  '▐', // 0110 right half
  '▛', // 0111
  '▗', // 1000 bottom-right
  '▌', // 1001 left half
  '▞', // 1010 top-right + bottom-left
  '▜', // 1011
  '▄', // 1100 bottom half
  '▙', // 1101
  '▟', // 1110
  '█', // 1111
];

export interface RenderImageOptions {
  shouldCancel?: ShouldCancel;
  /** Force a fixed row count (canvas / terminal fitting). */
  targetRows?: number;
}


/**
 * Full pipeline: crop -> geometry -> fit -> resize -> preprocess -> luminance
 * -> mapping -> dither -> colour sampling -> glyph selection.
 *
 * Equivalent to {@link prepareSampledRaster} followed by {@link rasterToGrid};
 * the split exists so the worker can run raster effects between the two.
 */
export function renderImageToGrid(
  source: Raster,
  settings: ImageRenderSettings,
  options: RenderImageOptions = {},
): RenderResult {
  return rasterToGrid(source, prepareSampledRaster(source, settings, options), settings, options);
}

export interface SampledStage {
  /** Cropped, fitted and downscaled RGBA raster at render resolution. */
  sampled: Raster;
  geo: Geometry;
  cols: number;
  rows: number;
  /** Pipeline entry time, so `stats.durationMs` spans both stages. */
  startedAt: number;
}

export function prepareSampledRaster(
  source: Raster,
  settings: ImageRenderSettings,
  options: RenderImageOptions = {},
): SampledStage {
  const started = Date.now();
  const cancel = options.shouldCancel;
  check(cancel);

  if (source.width <= 0 || source.height <= 0) {
    throw new StudioError('invalid-input', 'Source image has no pixels');
  }

  // --- crop ---------------------------------------------------------------
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;
  if (settings.crop.enabled) {
    const c = settings.crop;
    const x0 = clamp(Math.floor(c.x * source.width), 0, source.width - 1);
    const y0 = clamp(Math.floor(c.y * source.height), 0, source.height - 1);
    const x1 = clamp(Math.ceil((c.x + c.width) * source.width), x0 + 1, source.width);
    const y1 = clamp(Math.ceil((c.y + c.height) * source.height), y0 + 1, source.height);
    sx = x0;
    sy = y0;
    sw = x1 - x0;
    sh = y1 - y0;
  }
  check(cancel);

  const { cols, rows } = computeGridSize(sw, sh, settings, options.targetRows);
  const geo = geometryFor(settings, cols, rows);

  // --- fit -----------------------------------------------------------------
  let drawW = sw;
  let drawH = sh;
  let offX = 0;
  let offY = 0;
  if (settings.fit === 'cover' && options.targetRows !== undefined) {
    const targetAspect = (cols * geo.subX) / Math.max(1, rows * geo.subY);
    const srcAspect = sw / sh;
    if (srcAspect > targetAspect) {
      drawW = Math.round(sh * targetAspect);
      offX = Math.round((sw - drawW) / 2);
    } else {
      drawH = Math.round(sw / targetAspect);
      offY = Math.round((sh - drawH) / 2);
    }
  }
  // 'contain' letterboxes vertically (computeGridSize already reduced rows);
  // 'stretch' and the no-target case map the crop rect onto the grid directly.

  const region = { x: sx + offX, y: sy + offY, w: drawW, h: drawH };

  // --- resize -------------------------------------------------------------
  const clipped = cropRegion(source, region);
  const sampled = resizeRaster(clipped, geo.sampleW, geo.sampleH, settings.resizeFilter);
  check(cancel);

  return { sampled, geo, cols, rows, startedAt: started };
}


/**
 * Stage 2 of the pipeline: preprocess -> luminance -> mapping -> dither ->
 * colour sampling -> glyph selection. Runs on the downscaled raster, which is
 * also where `effectSpace: 'grid'` inserts the raster effect stack.
 */
export function rasterToGrid(
  source: Raster,
  stage: SampledStage,
  settings: ImageRenderSettings,
  options: RenderImageOptions = {},
): RenderResult {
  const started = stage.startedAt;
  const cancel = options.shouldCancel;
  const { sampled, geo, cols, rows } = stage;
  check(cancel);

  // --- preprocess ---------------------------------------------------------
  const processed = applyPreprocess(sampled, settings.preprocess, cancel);
  check(cancel);

  // --- luminance ----------------------------------------------------------
  // Projects written before `luminanceStandard` existed default to BT.709,
  // which is what the pipeline always used.
  const rawLuma = lumaPlane(processed, settings.luminanceStandard ?? 'rec709');
  const cellLuma =
    geo.pack === 'average'
      ? averageToCells(rawLuma, geo.sampleW, cols, rows, geo.subX, geo.subY)
      : rawLuma;
  check(cancel);

  // --- mapping ------------------------------------------------------------
  const decisionW = geo.pack === 'average' ? cols : geo.sampleW;
  const decisionH = geo.pack === 'average' ? rows : geo.sampleH;
  // Per-cell features (contrast / edge / texture measured inside each cell of
  // the sampled raster) are extracted only for strategies that consume them,
  // and only where cells and the decision grid agree: sub-cell modes decide
  // per sample, so there is no cell plane to align them with. The default
  // strategy therefore pays nothing for the capability.
  const features =
    geo.pack === 'average' && getMappingStrategy(settings.mapping.strategy)?.usesFeatures
      ? computeCellFeatures(rawLuma, geo.sampleW, geo.sampleH, cols, rows)
      : null;
  check(cancel);
  let ink = runMapping({
    luma: cellLuma,
    width: decisionW,
    height: decisionH,
    settings: settings.mapping,
    features,
  });
  if (settings.output.invert) {
    const inv = new Float32Array(ink.length);
    for (let i = 0; i < ink.length; i++) inv[i] = 1 - ink[i];
    ink = inv;
  }
  check(cancel);

  // --- dither -------------------------------------------------------------
  const levels =
    geo.pack === 'average' ? Math.max(2, [...(settings.output.charset || ' ')].length) : 2;
  if (settings.dither.algorithm !== 'none') {
    ink = applyDither(ink, decisionW, decisionH, settings.dither, levels);
  } else if (geo.pack !== 'average') {
    // Binary render modes need a hard cut when no dithering is selected.
    const cut = new Float32Array(ink.length);
    for (let i = 0; i < ink.length; i++) cut[i] = ink[i] >= 0.5 ? 1 : 0;
    ink = cut;
  }
  check(cancel);

  // --- colour sampling ----------------------------------------------------
  const colorMode = settings.colorMode;
  let fg: Int32Array | null = null;
  let bg: Int32Array | null = null;
  if (colorMode !== 'none') {
    if (geo.pack === 'halfblock') {
      const top = quantizeColors(sampleCellColors(processed, cols, rows, 1, 1, 2, 0), colorMode);
      const bottom = quantizeColors(
        sampleCellColors(processed, cols, rows, 1, 1, 2, 1),
        colorMode,
      );
      fg = top;
      bg = bottom;
    } else {
      fg = quantizeColors(sampleCellColors(processed, cols, rows, geo.subX, geo.subY, 0, 0), colorMode);
    }
  }
  check(cancel);

  // --- glyph selection ----------------------------------------------------
  const grid = assembleGrid(ink, cols, rows, geo, settings, fg, bg);

  return {
    grid,
    stats: {
      durationMs: Date.now() - started,
      cells: cols * rows,
      sourceWidth: source.width,
      sourceHeight: source.height,
    },
  };
}

function cropRegion(
  source: Raster,
  region: { x: number; y: number; w: number; h: number },
): Raster {
  const x0 = clamp(region.x, 0, source.width - 1);
  const y0 = clamp(region.y, 0, source.height - 1);
  const w = clamp(region.w, 1, source.width - x0);
  const h = clamp(region.h, 1, source.height - y0);
  if (x0 === 0 && y0 === 0 && w === source.width && h === source.height) return source;
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let row = 0; row < h; row++) {
    const si = ((y0 + row) * source.width + x0) * 4;
    out.data.set(source.data.subarray(si, si + w * 4), row * w * 4);
  }
  return out;
}

/**
 * Average colours for `cols x rows` cells.
 * `subRows`/`subRow` pick which sub-row of a two-high cell to average
 * (used by half-blocks so fg/bg come from the correct half).
 */
function sampleCellColors(
  raster: Raster,
  cols: number,
  rows: number,
  subX: number,
  subY: number,
  subRow: number,
  subRowOffset: number,
): Int32Array {
  const out = new Int32Array(cols * rows);
  const cellW = raster.width / (cols * subX);
  const cellH = raster.height / (rows * subY);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * subX * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * subX * cellW));
      const y0 = Math.floor((cy * subY + subRowOffset * (subRow || 1)) * cellH);
      const y1 = subRow
        ? Math.max(y0 + 1, Math.floor((cy * subY + subRowOffset + 1) * cellH))
        : Math.max(y0 + 1, Math.floor((cy + 1) * subY * cellH));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < raster.height; y++) {
        for (let x = x0; x < x1 && x < raster.width; x++) {
          const i = (y * raster.width + x) * 4;
          r += raster.data[i];
          g += raster.data[i + 1];
          b += raster.data[i + 2];
          n++;
        }
      }
      out[cy * cols + cx] =
        n > 0
          ? ((Math.round(r / n) & 0xff) << 16) | ((Math.round(g / n) & 0xff) << 8) | (Math.round(b / n) & 0xff)
          : NO_COLOR;
    }
  }
  return out;
}

function quantizeColors(plane: Int32Array, mode: ColorMode): Int32Array {
  if (mode === 'sample' || mode === 'truecolor') return plane;
  const out = new Int32Array(plane.length);
  if (mode === 'ansi256') {
    for (let i = 0; i < plane.length; i++) out[i] = ANSI256[rgbToAnsi256(plane[i])];
  } else if (mode === 'ansi16') {
    for (let i = 0; i < plane.length; i++) out[i] = ANSI16[rgbToAnsi16(plane[i])];
  } else {
    out.set(plane);
  }
  return out;
}

function assembleGrid(
  ink: Float32Array,
  cols: number,
  rows: number,
  geo: Geometry,
  settings: ImageRenderSettings,
  fg: Int32Array | null,
  bg: Int32Array | null,
): AsciiGrid {
  const chars: string[] = new Array(cols * rows);
  const rawCharset =
    settings.output.charset && settings.output.charset.length > 0
      ? settings.output.charset
      : '@%#*+=-:. ';
  // `measured` re-orders by calibration-table ink (dark -> light); `positional`
  // trusts the typed order. Projects written before `inkOrder` existed have
  // `undefined` here and render exactly as before.
  const charset = [
    ...(settings.output.inkOrder === 'measured' ? sortRampByInk(rawCharset).sorted : rawCharset),
  ];
  const offset = settings.output.offset;
  const density = settings.output.density > 0 ? settings.output.density : 1;
  const on = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= geo.sampleW || y >= geo.sampleH) return false;
    return ink[y * geo.sampleW + x] >= 0.5;
  };

  switch (geo.pack) {
    case 'braille': {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          chars[cy * cols + cx] = brailleChar(on, cx * 2, cy * 4);
        }
      }
      break;
    }
    case 'halfblock': {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const top = on(cx, cy * 2);
          const bottom = on(cx, cy * 2 + 1);
          chars[cy * cols + cx] =
            top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
        }
      }
      break;
    }
    case 'quadrant': {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const x0 = cx * 2;
          const y0 = cy * 2;
          let code = 0;
          if (on(x0, y0)) code |= 1;
          if (on(x0 + 1, y0)) code |= 2;
          if (on(x0, y0 + 1)) code |= 4;
          if (on(x0 + 1, y0 + 1)) code |= 8;
          chars[cy * cols + cx] = QUADRANT_CHARS[code];
        }
      }
      break;
    }
    case 'average':
    default: {
      for (let i = 0; i < cols * rows; i++) {
        const idx = inkToIndex(ink[i], charset.length, offset, density);
        chars[i] = charset[idx];
      }
      break;
    }
  }

  // Half-block cells pick fg/bg from the half that is actually visible:
  // the ON half draws with fg, the OFF half shows through as bg.
  let outFg = fg;
  let outBg = geo.pack === 'halfblock' ? bg : null;
  if (geo.pack === 'halfblock' && fg && bg) {
    const topFg = fg;
    const bottomBg = bg;
    const swappedFg = new Int32Array(fg.length);
    const swappedBg = new Int32Array(bg.length);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '▀') {
        swappedFg[i] = topFg[i];
        swappedBg[i] = bottomBg[i];
      } else if (ch === '▄') {
        // Bottom glyph is drawn with fg, so fg must be the bottom colour.
        swappedFg[i] = bottomBg[i];
        swappedBg[i] = topFg[i];
      } else if (ch === '█') {
        swappedFg[i] = topFg[i];
        swappedBg[i] = NO_COLOR;
      } else {
        swappedFg[i] = NO_COLOR;
        swappedBg[i] = NO_COLOR;
      }
    }
    outFg = swappedFg;
    outBg = swappedBg;
  }

  return {
    width: cols,
    height: rows,
    chars,
    fg: outFg,
    bg: outBg,
  };
}
