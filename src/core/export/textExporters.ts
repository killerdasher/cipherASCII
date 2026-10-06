import {
  err,
  NO_COLOR,
  type AsciiGrid,
  type Document,
  type ExportSettings,
  type Result,
} from '../types';
import { blue, green, red, rgbToAnsi16, rgbToAnsi256 } from '../color';
import { gridToLines } from '../grid';
import { toAsciiOnly } from './fallback';

/**
 * Inputs shared by every text exporter: the grid to serialize, the export
 * settings controlling encoding and colors, and the optional source document
 * whose metadata is embedded in structured formats.
 */
export interface ExportContext {
  grid: AsciiGrid;
  settings: ExportSettings;
  document?: Document;
}

/**
 * Export the grid as plain `.txt`: rows joined with `\n` plus a trailing
 * newline, reduced to printable ASCII when `settings.asciiOnly` is set.
 *
 * @param ctx - Grid plus export settings.
 * @returns The text payload, or an `invalid-input` error for an empty grid.
 */
export function exportTxt(ctx: ExportContext): Result<string> {
  const { grid, settings } = ctx;
  if (grid.width === 0 || grid.height === 0) {
    return err<string>(
      'invalid-input',
      'Cannot export an empty grid',
      `width=${grid.width}, height=${grid.height}`,
    );
  }
  const lines = gridToLines(grid).map((line) =>
    settings.asciiOnly ? toAsciiOnly(line) : line,
  );
  return { ok: true, value: `${lines.join('\n')}\n` };
}

/**
 * Export the grid as plain `.asc`: identical to {@link exportTxt} but exposed
 * as its own entry point so the two formats can diverge later.
 *
 * @param ctx - Grid plus export settings.
 * @returns The text payload, or an `invalid-input` error for an empty grid.
 */
export function exportAsc(ctx: ExportContext): Result<string> {
  const { grid, settings } = ctx;
  if (grid.width === 0 || grid.height === 0) {
    return err<string>(
      'invalid-input',
      'Cannot export an empty grid',
      `width=${grid.width}, height=${grid.height}`,
    );
  }
  const lines = gridToLines(grid).map((line) =>
    settings.asciiOnly ? toAsciiOnly(line) : line,
  );
  return { ok: true, value: `${lines.join('\n')}\n` };
}

/**
 * Export the grid as ANSI-colored text. Every line is bracketed by a reset
 * sequence, a further reset terminates the output, and color codes are only
 * emitted when the foreground or background actually changes between adjacent
 * cells. Colors are omitted entirely when `settings.includeColors` is off or
 * the grid carries no color plane; cells holding `NO_COLOR` emit nothing.
 *
 * @param ctx - Grid plus export settings (`ansiLevel` selects 16/256/truecolor).
 * @returns The escape-coded payload.
 */
export function exportAnsi(ctx: ExportContext): Result<string> {
  const { grid, settings } = ctx;
  const ESC = String.fromCharCode(27);
  const colored = settings.includeColors && (grid.fg !== null || grid.bg !== null);
  if (!colored) {
    return { ok: true, value: `${gridToLines(grid).join('\n')}\n` };
  }
  const level = settings.ansiLevel;
  const sequence = (color: number, background: boolean): string => {
    if (level === '16') {
      const n = rgbToAnsi16(color);
      if (background) return String(n < 8 ? 40 + n : 100 + (n - 8));
      return String(n < 8 ? 30 + n : 90 + (n - 8));
    }
    if (level === '256') {
      return background
        ? `48;5;${rgbToAnsi256(color)}`
        : `38;5;${rgbToAnsi256(color)}`;
    }
    return background
      ? `48;2;${red(color)};${green(color)};${blue(color)}`
      : `38;2;${red(color)};${green(color)};${blue(color)}`;
  };
  let out = '';
  for (let y = 0; y < grid.height; y++) {
    out += `${ESC}[0m`;
    let prevFg = NO_COLOR;
    let prevBg = NO_COLOR;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const fg = grid.fg ? grid.fg[i] : NO_COLOR;
      const bg = grid.bg ? grid.bg[i] : NO_COLOR;
      if (fg !== NO_COLOR && fg !== prevFg) {
        out += `${ESC}[${sequence(fg, false)}m`;
        prevFg = fg;
      }
      if (bg !== NO_COLOR && bg !== prevBg) {
        out += `${ESC}[${sequence(bg, true)}m`;
        prevBg = bg;
      }
      out += grid.chars[i];
    }
    out += `${ESC}[0m\n`;
  }
  out += `${ESC}[0m`;
  return { ok: true, value: out };
}

/**
 * Export the grid as a pretty-printed JSON document carrying the format
 * marker, version, dimensions, per-row text lines, optional per-row color
 * planes (`-1` where a cell has no color) and the document metadata when a
 * document is supplied.
 *
 * @param ctx - Grid, export settings and optional source document.
 * @returns The JSON payload.
 */
export function exportJson(ctx: ExportContext): Result<string> {
  const { grid, settings, document } = ctx;
  const payload: {
    format: string;
    version: number;
    width: number;
    height: number;
    lines: string[];
    fg?: number[][];
    bg?: number[][];
    metadata?: Document['metadata'];
  } = {
    format: 'ascii-art-studio/json',
    version: 1,
    width: grid.width,
    height: grid.height,
    lines: gridToLines(grid),
  };
  if (settings.includeColors && grid.fg) {
    const plane = grid.fg;
    const rows: number[][] = [];
    for (let y = 0; y < grid.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < grid.width; x++) {
        row.push(plane[y * grid.width + x] ?? NO_COLOR);
      }
      rows.push(row);
    }
    payload.fg = rows;
  }
  if (settings.includeColors && grid.bg) {
    const plane = grid.bg;
    const rows: number[][] = [];
    for (let y = 0; y < grid.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < grid.width; x++) {
        row.push(plane[y * grid.width + x] ?? NO_COLOR);
      }
      rows.push(row);
    }
    payload.bg = rows;
  }
  if (document) {
    payload.metadata = document.metadata;
  }
  return { ok: true, value: JSON.stringify(payload, null, 2) };
}
