/**
 * FIGlet (`.flf`) font parser.
 *
 * Converts the plain-text FIGlet font format into the studio's glyph-table
 * shapes: {@link FigletFont} (raw parsed data) and {@link BitmapFont} (what
 * the text renderer consumes).
 *
 * **Known limitation — no smushing or kerning.** FIGlet's layout engine
 * (oldLayout/fullLayout, smushing rules, optional kerning) is intentionally
 * not implemented: every glyph is kept at its full authored width and
 * consumers concatenate glyphs edge to edge. Text rendered from a FIGlet
 * font is therefore wider than real FIGlet output for fonts that rely on
 * smushing, and the header's layout fields are only skipped, never applied.
 *
 * The parser never throws: malformed input yields `err('invalid-input', …)`.
 */

import type { Result } from '../types';
import { err, ok } from '../types';
import type { BitmapFont } from './bitmapFonts';

export interface FigletFont {
  id: string;
  name: string;
  /** Number of rows in every glyph (`height` field of the header). */
  glyphHeight: number;
  /** char -> glyphHeight rows; '#' ink, '.' empty; uniform height. */
  glyphs: Record<string, string[]>;
  /** Hardblank character from the signature line (renders as a space). */
  hardblank: string;
}

const SIGNATURE = 'flf2a';

/** The fixed German/ligature block that follows codes 32..126 when present. */
const EXTENDED_CODES = [196, 214, 220, 228, 246, 252, 223];

/** A code-tag line: an integer, optionally followed by a char/comment. */
const CODE_TAG = /^\s*-?\d+(?:\s|$)/;
const CODE_VALUE = /^\s*(-?\d+)/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse a FIGlet `.flf` font.
 *
 * Reads the `flf2a` header, skips `commentLines` comment lines, then reads
 * the 95 glyphs for codes 32..126, the optional block of codes
 * 196, 214, 220, 228, 246, 252, 223, and finally any code-tagged glyphs
 * (a line starting with a number, followed by that glyph's rows).
 *
 * Each glyph row ends with an end marker (the last character of the glyph's
 * first line, repeated once or twice); a doubled marker is stripped when
 * present, otherwise a single trailing occurrence. Rows become '#' ink for
 * any character that is neither a space nor the hardblank, '.' otherwise.
 *
 * CRLF line endings and a missing final newline are accepted. Returns
 * `err('invalid-input', …)` — never throws — for an empty source, a missing
 * `flf2a` signature, a height below 1, or fewer glyph lines than the header
 * promises.
 *
 * Known limitation: no smushing or kerning — glyphs keep their full width
 * (see the module JSDoc).
 *
 * @param source Raw `.flf` file contents.
 * @param name Optional font name; also used to derive `id`.
 */
export function parseFiglet(source: string, name?: string): Result<FigletFont> {
  if (typeof source !== 'string' || source.trim() === '') {
    return err<FigletFont>('invalid-input', 'FIGlet source is empty');
  }

  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  // A missing final newline only adds an empty trailing entry; drop trailing
  // blank lines so the glyph cursor is not pushed past the real data.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const header = lines[0] ?? '';
  if (!header.startsWith(SIGNATURE) || header.length <= SIGNATURE.length) {
    return err<FigletFont>('invalid-input', 'FIGlet font is missing the flf2a signature');
  }

  const hardblank = header[SIGNATURE.length];
  const fields = header.slice(SIGNATURE.length + 1).trim().split(/\s+/);
  const height = Math.floor(Number(fields[0]));
  const commentField = Number(fields[4]);
  const commentLines =
    Number.isFinite(commentField) && commentField > 0 ? Math.floor(commentField) : 0;

  if (!Number.isFinite(height) || height < 1) {
    return err<FigletFont>('invalid-input', `invalid FIGlet glyph height: ${fields[0] ?? ''}`);
  }

  const truncated = () =>
    err<FigletFont>('invalid-input', 'FIGlet font has fewer glyph lines than its header promises');

  let cursor = 1;
  if (cursor + commentLines > lines.length) return truncated();
  cursor += commentLines;

  const glyphs: Record<string, string[]> = {};

  /** Consume `height` lines and turn them into '#'/ '.' rows, or fail. */
  const readGlyph = (): string[] | null => {
    if (cursor + height > lines.length) return null;
    const raw = lines.slice(cursor, cursor + height);
    cursor += height;
    const first = raw[0];
    if (first.length === 0) return null;
    const marker = first[first.length - 1];
    const doubleMarker = marker + marker;
    return raw.map((line) => {
      let text = line;
      if (text.endsWith(doubleMarker)) text = text.slice(0, -2);
      else if (text.endsWith(marker)) text = text.slice(0, -1);
      let row = '';
      for (const ch of text) row += ch === ' ' || ch === hardblank ? '.' : '#';
      return row;
    });
  };

  for (let code = 32; code <= 126; code++) {
    const rows = readGlyph();
    if (!rows) return truncated();
    glyphs[String.fromCharCode(code)] = rows;
  }

  // Optional German/ligature block: present only when it fits and is not
  // already introduced by a code tag.
  if (
    lines.length - cursor >= EXTENDED_CODES.length * height &&
    !CODE_TAG.test(lines[cursor])
  ) {
    for (const code of EXTENDED_CODES) {
      const rows = readGlyph();
      if (!rows) return truncated();
      glyphs[String.fromCharCode(code)] = rows;
    }
  }

  // Code-tagged glyphs: `<code>` on its own line, then that glyph's rows.
  while (cursor < lines.length && CODE_TAG.test(lines[cursor])) {
    const match = CODE_VALUE.exec(lines[cursor]);
    const code = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(code)) break;
    cursor += 1;
    const rows = readGlyph();
    if (!rows) {
      return err<FigletFont>('invalid-input', `FIGlet font is missing glyph data for code ${code}`);
    }
    // Negative codes are FIGlet's right-to-left variants; they are parsed
    // (and consumed) but not stored, since the renderer has no RTL support.
    if (code > 0 && code <= 0x10ffff) glyphs[String.fromCodePoint(code)] = rows;
  }

  const fontName = (name ?? '').trim() || 'figlet';
  return ok<FigletFont>({
    id: slugify(fontName) || 'figlet',
    name: fontName,
    glyphHeight: height,
    glyphs,
    hardblank,
  });
}

/**
 * Convert a parsed FIGlet font into the studio's {@link BitmapFont} shape
 * (category `terminal`, no lowercase support; rows padded to a uniform width).
 *
 * Known limitation: glyphs are exported at full width — no smushing or
 * kerning is applied, so concatenating them renders wider than FIGlet.
 *
 * @param font Parsed font (see {@link parseFiglet}).
 * @param id Font id to register it under.
 * @param name Display name for the font picker.
 */
export function figletToBitmapFont(font: FigletFont, id: string, name: string): BitmapFont {
  const glyphs: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(font.glyphs)) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    glyphs[ch] = rows.map((row) => row.padEnd(width, '.').slice(0, width));
  }
  return {
    id,
    name,
    category: 'terminal',
    glyphHeight: font.glyphHeight,
    glyphs,
    supportsLowercase: false,
    description: `Imported FIGlet font "${font.name}" (${font.glyphHeight} rows, hardblank '${font.hardblank}').`,
  };
}
