/**
 * Generates `src/core/glyph/calibrationTable.ts` - the pre-measured feature
 * table every calibrated glyph decision reads at runtime.
 *
 *   npm run calibrate
 *
 * Phase 3's rule (docs/V2_AUDIT.md P8): calibration happens here, once, at
 * development time - never per session. The script rasterises every distinct
 * character of every `ALL_CHARSET_PRESETS` entry at a fixed cell and font,
 * runs the same `glyphFeaturesFromBitmap` extractor the app uses, and writes
 * a deterministic table: glyphs in code-point order, values rounded to four
 * decimals, no timestamps. Re-running on the same machine reproduces the
 * file byte for byte; a font change shows up as a diff, which is exactly the
 * intent - the table records which font it was measured against.
 *
 * Output shape (see `src/core/glyph/calibration.ts` for the reader):
 *   CALIBRATION_META   cell, font, preset/glyph/empty counts
 *   CALIBRATION_TABLE  code point (hex) -> [ink, aspect, bbox..., density,
 *                      centroid, edgeRatio, symmetryX]
 *
 * The suite fails (without writing) when the measurements look broken - a
 * missing font would silently blank half the table, and a half-blank table
 * is worse than none.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { ALL_CHARSET_PRESETS } from '../src/core/charsets/extendedCharsets';
import { countUniqueCharacters } from '../src/core/charsets/unicodeCharsets';
import { glyphFeaturesFromBitmap, type GlyphFeatureVector } from '../src/core/glyph/features';

const OUT = join(process.cwd(), 'src', 'core', 'glyph', 'calibrationTable.ts');

/** Fixed measurement font - same stack the script mock-ups draw with. */
const FONT = '20px "DejaVu Sans Mono", "Liberation Mono", monospace';
/** Cell height in px; ink is a fraction of exactly this box. */
const CELL_H = 24;
/**
 * Cell width follows the font's own advance, so a monospace full block fills
 * the cell instead of half of it. Measured from the font at run time and
 * recorded in the generated metadata.
 */
let CELL_W = 12;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toRecord(f: GlyphFeatureVector): number[] {
  return [
    round4(f.ink),
    round4(f.aspect),
    round4(f.bbox.x),
    round4(f.bbox.y),
    round4(f.bbox.w),
    round4(f.bbox.h),
    round4(f.density),
    round4(f.centroidX),
    round4(f.centroidY),
    round4(f.edgeRatio),
    round4(f.symmetryX),
  ];
}

function renderGlyph(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  ch: string,
): GlyphFeatureVector {
  ctx.clearRect(0, 0, CELL_W, CELL_H);
  ctx.fillText(ch, CELL_W / 2, CELL_H / 2);
  const image = ctx.getImageData(0, 0, CELL_W, CELL_H);
  return glyphFeaturesFromBitmap(ch, image.data, CELL_W, CELL_H);
}

describe('glyph calibration', () => {
  it('measures every preset character and writes the table', () => {
    const glyphs = Array.from(
      new Set(ALL_CHARSET_PRESETS.flatMap((preset) => Array.from(preset.chars))),
    ).sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0));

    // Measure the advance on a scratch surface: resizing a canvas resets the
    // context (font falls back to 10px sans-serif), so the real surface is
    // created at the final size instead.
    const scratch = createCanvas(48, CELL_H);
    const scratchCtx = scratch.getContext('2d');
    scratchCtx.font = FONT;
    CELL_W = Math.max(1, Math.ceil(scratchCtx.measureText('M').width));

    const canvas = createCanvas(CELL_W, CELL_H);
    const ctx = canvas.getContext('2d');
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    expect(ctx.font).toContain('20px');

    const started = Date.now();
    const features = glyphs.map((ch) => renderGlyph(ctx, ch));
    const elapsed = Date.now() - started;

    const empty = features.filter((f) => f.bbox.w === 0 && f.glyph !== ' ').length;
    const total = countUniqueCharacters(ALL_CHARSET_PRESETS);

    // Honest-count guard: the table must cover the library exactly, and a
    // font fallback failure would show up as most glyphs rendering blank.
    expect(glyphs.length).toBe(total);
    expect(total).toBeGreaterThanOrEqual(3000);
    expect(features.length).toBe(total);
    expect(empty / total).toBeLessThan(0.05);

    // Font sanity: the densest glyphs must actually dominate the sparse ones,
    // otherwise the cell geometry or the font stack is broken.
    const inkOf = (ch: string) => features[glyphs.indexOf(ch)]!.ink;
    expect(inkOf('█')).toBeGreaterThan(0.6);
    expect(inkOf('@')).toBeGreaterThan(inkOf('.'));
    expect(inkOf(' ')).toBe(0);

    const lines = glyphs.map((ch, i) => {
      const cp = (ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0');
      return `  '${cp}': [${toRecord(features[i]).join(', ')}],`;
    });

    const content = `/**
 * GENERATED by \`npm run calibrate\` - do not edit by hand.
 *
 * One record per preset glyph, code point ascending: the 11 measured features
 * of GlyphFeatureVector (ink, aspect, bbox x/y/w/h, density, centroidX/Y,
 * edgeRatio, symmetryX) rounded to four decimals. Reading and validating
 * this table is \`src/core/glyph/calibration.ts\`'s job.
 */
import type { CalibrationRecord } from './calibration';

/** How the table was measured; re-run \`npm run calibrate\` to refresh. */
export const CALIBRATION_META = {
  cell: { width: ${CELL_W}, height: ${CELL_H} },
  font: ${JSON.stringify(FONT)},
  presets: ${ALL_CHARSET_PRESETS.length},
  glyphs: ${features.length},
  empty: ${empty},
  tool: 'scripts/calibrate-glyphs.ts',
} as const;

/** Code point (4-digit hex) -> measured feature record. */
export const CALIBRATION_TABLE: Record<string, CalibrationRecord> = {
${lines.join('\n')}
};
`;

    expect(features.some((f) => f.ink > 0.5)).toBe(true);
    expect(features.some((f) => f.ink > 0 && f.ink < 0.05)).toBe(true);

    writeFileSync(OUT, content);

    console.log(
      `calibrated ${features.length} glyphs across ${ALL_CHARSET_PRESETS.length} presets ` +
        `(${empty} blank, ${elapsed} ms) -> ${OUT}`,
    );
  });
});
