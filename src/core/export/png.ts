/**
 * PNG rasterization support.
 *
 * Two independent pieces live here:
 *
 * - {@link drawGridToContext} paints an {@link AsciiGrid} onto any canvas-like
 *   2D context (the UI uses it to preview and capture PNGs, since the core has
 *   no DOM dependency).
 * - {@link encodePng} is a minimal, dependency-free PNG encoder that turns raw
 *   RGBA pixels into a valid PNG byte stream using an externally supplied
 *   zlib/deflate implementation.
 */

import { toHex } from '../color';
import { NO_COLOR, StudioError, type AsciiGrid } from '../types';

/**
 * The subset of `CanvasRenderingContext2D` used to paint a grid. Kept
 * structural so the core never depends on DOM lib types.
 */
export interface CanvasLike {
  fillStyle: string;
  font: string;
  textBaseline: string;
  textAlign: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

/**
 * Paint `grid` into `ctx`.
 *
 * The painted area is `cols * cellWidth * scale` wide and
 * `rows * cellHeight * scale` tall. When `background` is not `null` the whole
 * area is filled with its hex color first. Cells carrying a background color
 * get their own `fillRect` (hex) before their glyph. For every row,
 * consecutive cells sharing the same effective foreground color — and not
 * interrupted by a background cell — are coalesced into a single run drawn
 * with ONE `fillText` call. Cells whose foreground is `NO_COLOR` use
 * `opts.foreground` when provided (otherwise they inherit the context's
 * current `fillStyle`).
 *
 * @param ctx - Canvas-like target (already sized to the returned dimensions).
 * @param grid - The character grid to paint.
 * @param opts - Cell metrics, scale, font family and fallback colors.
 * @returns The pixel dimensions of the painted area.
 */
export function drawGridToContext(
  ctx: CanvasLike,
  grid: AsciiGrid,
  opts: {
    cellWidth: number;
    cellHeight: number;
    scale: number;
    fontFamily: string;
    background: number | null;
    foreground: number | null;
  },
): { width: number; height: number } {
  const { cellWidth, cellHeight, scale, fontFamily, background, foreground } = opts;
  const cw = cellWidth * scale;
  const ch = cellHeight * scale;
  const width = grid.width * cw;
  const height = grid.height * ch;

  ctx.font = `${ch * 0.86}px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  if (background !== null) {
    ctx.fillStyle = toHex(background);
    ctx.fillRect(0, 0, width, height);
  }

  const drawRun = (row: number, start: number, length: number, color: number): void => {
    if (length <= 0) return;
    const from = row * grid.width + start;
    const text = grid.chars.slice(from, from + length).join('');
    if (color !== NO_COLOR) ctx.fillStyle = toHex(color);
    const x = start * cw;
    const y = row * ch + ch * 0.5 + 0.85 * ch * 0.35;
    ctx.fillText(text, x, y);
  };

  for (let row = 0; row < grid.height; row++) {
    let runStart = -1;
    let runColor = NO_COLOR;
    let runEnd = 0;
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      const rawFg = grid.fg ? grid.fg[i] : NO_COLOR;
      const fg = rawFg === NO_COLOR && foreground !== null ? foreground : rawFg;
      const bg = grid.bg ? grid.bg[i] : NO_COLOR;
      if (bg !== NO_COLOR) {
        if (runStart >= 0) {
          drawRun(row, runStart, runEnd - runStart, runColor);
          runStart = -1;
        }
        ctx.fillStyle = toHex(bg);
        ctx.fillRect(col * cw, row * ch, cw, ch);
        drawRun(row, col, 1, fg);
        continue;
      }
      if (runStart >= 0 && fg === runColor) {
        runEnd = col + 1;
      } else {
        if (runStart >= 0) drawRun(row, runStart, runEnd - runStart, runColor);
        runStart = col;
        runEnd = col + 1;
        runColor = fg;
      }
    }
    if (runStart >= 0) drawRun(row, runStart, runEnd - runStart, runColor);
  }

  return { width, height };
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  const MOD = 65521;
  const NMAX = 5552;
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + NMAX, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= MOD;
    b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Build one PNG chunk: length, type, payload, big-endian CRC of type+payload. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode raw RGBA pixels as a PNG (8-bit, color type 6, non-interlaced).
 *
 * Every scanline is prefixed with filter byte `0`; the filtered stream is
 * wrapped in a zlib container (`0x78 0x01` header, caller-provided deflate
 * output, big-endian Adler-32 of the filtered scanlines) and emitted as an
 * `IDAT` chunk between `IHDR` and `IEND`, each CRC32-checked via a table built
 * at module load.
 *
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param rgba - Pixel data, 4 bytes per pixel, row-major.
 * @param deflate - zlib/deflate compressor applied to the filtered scanlines.
 * @returns The complete PNG file bytes.
 * @throws {StudioError} `invalid-input` when the dimensions are not positive
 * integers or `rgba.length !== width * height * 4`.
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
  deflate: (data: Uint8Array) => Uint8Array,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length !== width * height * 4
  ) {
    throw new StudioError(
      'invalid-input',
      'Invalid RGBA buffer for the requested PNG dimensions',
      `width=${width}, height=${height}, expected=${width * height * 4}, got=${rgba.length}`,
    );
  }

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), dst + 1);
  }

  const compressed = deflate(raw);
  const idat = new Uint8Array(2 + compressed.length + 4);
  idat[0] = 0x78;
  idat[1] = 0x01;
  idat.set(compressed, 2);
  const checksum = adler32(raw);
  const idatEnd = 2 + compressed.length;
  idat[idatEnd] = (checksum >>> 24) & 0xff;
  idat[idatEnd + 1] = (checksum >>> 16) & 0xff;
  idat[idatEnd + 2] = (checksum >>> 8) & 0xff;
  idat[idatEnd + 3] = checksum & 0xff;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}
