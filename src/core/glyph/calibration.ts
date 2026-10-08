/**
 * Calibrated glyph measurements - the runtime half of Phase 3.
 *
 * `scripts/calibrate-glyphs.ts` rasterises every preset character once and
 * commits the features to `calibrationTable.ts`; this module is the reader:
 * it turns records into {@link GlyphFeatureVector}s on demand, answers the
 * honest-count questions ("how much of the library is actually measured?")
 * and hands {@link GlyphIndex}s to anything that needs a ramp ordered by
 * real ink instead of a hand-tuned guess.
 *
 * Nothing here measures pixels - calibration never runs per session
 * (docs/V2_AUDIT.md P8). Unmeasured characters are reported, never
 * pretended: `uncalibratedGlyphs` names them, `glyphIndexForChars` leaves
 * them out, and `sortRampByInk` (see `sort.ts`) falls back to the coverage
 * table for them.
 *
 * Pure module: no DOM; the table is static data.
 */

import { ALL_CHARSET_PRESETS } from '../charsets/extendedCharsets';
import type { CharsetDescription } from '../mapping';
import type { GlyphFeatureVector } from './features';
import { GlyphIndex } from './glyphIndex';
import { CALIBRATION_META, CALIBRATION_TABLE } from './calibrationTable';

/**
 * One measured glyph: the eleven `GlyphFeatureVector` scalars in the order
 * `[ink, aspect, bbox.x, bbox.y, bbox.w, bbox.h, density, centroidX,
 * centroidY, edgeRatio, symmetryX]`.
 */
export type CalibrationRecord = readonly [
  ink: number,
  aspect: number,
  bboxX: number,
  bboxY: number,
  bboxW: number,
  bboxH: number,
  density: number,
  centroidX: number,
  centroidY: number,
  edgeRatio: number,
  symmetryX: number,
];

/** Measurement setup the table was produced with (cell, font, counts). */
export function calibrationMeta(): typeof CALIBRATION_META {
  return CALIBRATION_META;
}

let byGlyph: Map<string, GlyphFeatureVector> | null = null;

function table(): Map<string, GlyphFeatureVector> {
  if (!byGlyph) {
    const map = new Map<string, GlyphFeatureVector>();
    for (const key of Object.keys(CALIBRATION_TABLE)) {
      const [
        ink,
        aspect,
        bboxX,
        bboxY,
        bboxW,
        bboxH,
        density,
        centroidX,
        centroidY,
        edgeRatio,
        symmetryX,
      ] = CALIBRATION_TABLE[key];
      map.set(String.fromCodePoint(parseInt(key, 16)), {
        glyph: String.fromCodePoint(parseInt(key, 16)),
        ink,
        aspect,
        bbox: { x: bboxX, y: bboxY, w: bboxW, h: bboxH },
        density,
        centroidX,
        centroidY,
        edgeRatio,
        symmetryX,
      });
    }
    byGlyph = map;
  }
  return byGlyph;
}

/**
 * Measured features of a character.
 *
 * @param ch - single character (a code point, possibly outside the BMP)
 * @returns its feature vector, or `undefined` when it was never calibrated
 */
export function calibratedGlyph(ch: string): GlyphFeatureVector | undefined {
  return table().get(ch);
}

/** True when `ch` has a committed measurement. */
export function isCalibrated(ch: string): boolean {
  return table().has(ch);
}

/** Number of characters with committed measurements. */
export function calibratedCount(): number {
  return table().size;
}

/**
 * Characters of `chars` that have no measurement, in input order.
 *
 * @param chars - characters to check (duplicates collapse to first occurrence)
 * @returns the unmeasured subset, e.g. for a "2 fallbacks" hint in the UI
 */
export function uncalibratedGlyphs(chars: string): string {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ch of chars) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    if (!table().has(ch)) missing.push(ch);
  }
  return missing.join('');
}

export interface CalibrationCoverage {
  /** Presets scanned. */
  presets: number;
  /** Distinct characters across those presets. */
  unique: number;
  /** Distinct characters with a committed measurement. */
  calibrated: number;
  /** Measured characters that render blank in the calibration font (not counting space). */
  empty: number;
  /** `calibrated / unique`, 0..1. */
  coverage: number;
}

/**
 * Honest coverage of a charset library: every number here is derived from
 * the presets and the table, so docs and UI can only state what is true.
 *
 * @param presets - library to scan (defaults to every shipped preset)
 */
export function calibrationCoverage(
  presets: readonly CharsetDescription[] = ALL_CHARSET_PRESETS,
): CalibrationCoverage {
  const unique = new Set<string>();
  let calibrated = 0;
  let empty = 0;
  for (const preset of presets) {
    for (const ch of preset.chars) {
      if (unique.has(ch)) continue;
      unique.add(ch);
      const features = table().get(ch);
      if (!features) continue;
      calibrated++;
      if (features.bbox.w === 0 && ch !== ' ') empty++;
    }
  }
  return {
    presets: presets.length,
    unique: unique.size,
    calibrated,
    empty,
    coverage: unique.size > 0 ? calibrated / unique.size : 0,
  };
}

const indexCache = new Map<string, GlyphIndex>();
let fullIndex: GlyphIndex | null = null;

/**
 * Glyph index over the calibrated characters of `chars` (uncalibrated ones
 * are excluded - check {@link uncalibratedGlyphs} to report them).
 *
 * Memoised per character set: building an index sorts, and ramps are asked
 * for repeatedly while a slider moves.
 *
 * @param chars - the ramp's characters
 * @returns the shared index for that exact string (do not mutate)
 */
export function glyphIndexForChars(chars: string): GlyphIndex {
  const cached = indexCache.get(chars);
  if (cached) return cached;
  const seen = new Set<string>();
  const features: GlyphFeatureVector[] = [];
  for (const ch of chars) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    const vector = table().get(ch);
    if (vector) features.push(vector);
  }
  const index = GlyphIndex.from(features);
  indexCache.set(chars, index);
  return index;
}

/**
 * Index over the whole calibrated library, built once per session.
 *
 * @returns the shared global index (do not mutate)
 */
export function calibratedIndex(): GlyphIndex {
  if (!fullIndex) fullIndex = GlyphIndex.from([...table().values()]);
  return fullIndex;
}
