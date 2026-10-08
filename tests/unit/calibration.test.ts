import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CHARSET_PRESETS } from '../../src/core/charsets/extendedCharsets';
import { countUniqueCharacters } from '../../src/core/charsets/unicodeCharsets';
import {
  calibratedCount,
  calibratedGlyph,
  calibratedIndex,
  calibrationCoverage,
  calibrationMeta,
  glyphIndexForChars,
  isCalibrated,
  uncalibratedGlyphs,
} from '../../src/core/glyph/calibration';
import { sortRampByInk } from '../../src/core/glyph/sort';
import { CALIBRATION_TABLE } from '../../src/core/glyph/calibrationTable';

const ALL_PRESET_CHARS = ALL_CHARSET_PRESETS.flatMap((preset) => Array.from(preset.chars)).join('');
const PRESET_RAMP = ' .:-=+*#%@█';
const UNCALIBRATED = '😀';

describe('calibration table', () => {
  it('metadata matches the shipped library exactly', () => {
    const meta = calibrationMeta();
    expect(meta.presets).toBe(ALL_CHARSET_PRESETS.length);
    expect(meta.glyphs).toBe(countUniqueCharacters(ALL_CHARSET_PRESETS));
    expect(meta.glyphs).toBeGreaterThanOrEqual(3000);
    expect(calibratedCount()).toBe(meta.glyphs);
    expect(meta.cell.width).toBeGreaterThan(0);
    expect(meta.cell.height).toBeGreaterThan(0);
    expect(meta.font).toContain('px');
    expect(meta.tool).toBe('scripts/calibrate-glyphs.ts');
    expect(meta.empty).toBeLessThan(meta.glyphs * 0.05);
  });

  it('covers every preset character - no character is unmeasured', () => {
    expect(uncalibratedGlyphs(ALL_PRESET_CHARS)).toBe('');
    const coverage = calibrationCoverage();
    expect(coverage.presets).toBe(ALL_CHARSET_PRESETS.length);
    expect(coverage.unique).toBe(countUniqueCharacters(ALL_CHARSET_PRESETS));
    expect(coverage.calibrated).toBe(coverage.unique);
    expect(coverage.coverage).toBe(1);
  });

  it('reports characters that were never measured instead of guessing', () => {
    for (const ch of UNCALIBRATED) {
      expect(isCalibrated(ch), ch).toBe(false);
      expect(calibratedGlyph(ch), ch).toBeUndefined();
    }
    expect(uncalibratedGlyphs(`a${UNCALIBRATED}b${UNCALIBRATED}`)).toBe(UNCALIBRATED);
    expect(
      calibrationCoverage([
        { id: 'uncal', label: 'uncal', category: 'custom', chars: UNCALIBRATED, description: 'not measured' },
      ]).coverage,
    ).toBe(0);
  });

  it('keeps every record inside the documented feature ranges', () => {
    for (const [key, record] of Object.entries(CALIBRATION_TABLE)) {
      const [ink, aspect, bboxX, bboxY, bboxW, bboxH, density, centroidX, centroidY, edgeRatio, symmetryX] = record;
      const where = `U+${key.toUpperCase()}`;
      expect(ink, where).toBeGreaterThanOrEqual(0);
      expect(ink, where).toBeLessThanOrEqual(1);
      expect(bboxX, where).toBeGreaterThanOrEqual(0);
      expect(bboxY, where).toBeGreaterThanOrEqual(0);
      expect(bboxX + bboxW, where).toBeLessThanOrEqual(1.0001);
      expect(bboxY + bboxH, where).toBeLessThanOrEqual(1.0001);
      expect(density, where).toBeGreaterThanOrEqual(0);
      expect(density, where).toBeLessThanOrEqual(1);
      expect(centroidX, where).toBeGreaterThanOrEqual(0);
      expect(centroidX, where).toBeLessThanOrEqual(1);
      expect(centroidY, where).toBeGreaterThanOrEqual(0);
      expect(centroidY, where).toBeLessThanOrEqual(1);
      expect(edgeRatio, where).toBeGreaterThanOrEqual(0);
      expect(edgeRatio, where).toBeLessThanOrEqual(1);
      expect(symmetryX, where).toBeGreaterThanOrEqual(0);
      expect(symmetryX, where).toBeLessThanOrEqual(1);
      expect(aspect, where).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(aspect), where).toBe(true);
    }
  });

  it('measures plausible ink for known glyphs', () => {
    const space = calibratedGlyph(' ')!;
    const dot = calibratedGlyph('.')!;
    const at = calibratedGlyph('@')!;
    const block = calibratedGlyph('█')!;
    expect(space.ink).toBe(0);
    expect(space.bbox.w).toBe(0);
    expect(dot.ink).toBeGreaterThan(0);
    expect(dot.ink).toBeLessThan(at.ink);
    expect(at.ink).toBeLessThan(block.ink);
    expect(block.ink).toBeGreaterThan(0.6);
    expect(block.density).toBeGreaterThan(0.9);
  });
});

describe('glyph index over calibrated characters', () => {
  it('memoises one index per character set', () => {
    const first = glyphIndexForChars(PRESET_RAMP);
    expect(first).toBeInstanceOf(Object);
    expect(glyphIndexForChars(PRESET_RAMP)).toBe(first);
    expect(glyphIndexForChars(`${PRESET_RAMP} `)).not.toBe(first);
  });

  it('indexes only calibrated characters, sorted by ink', () => {
    const index = glyphIndexForChars(`${PRESET_RAMP}${UNCALIBRATED}`);
    expect(index.size).toBe(new Set(PRESET_RAMP).size);
    expect(index.featuresOf(UNCALIBRATED)).toBeUndefined();
    const inks = index.glyphs().map((ch) => calibratedGlyph(ch)!.ink);
    for (let i = 1; i < inks.length; i++) expect(inks[i - 1]).toBeLessThanOrEqual(inks[i]);
    expect(index.featuresOf('@')!.ink).toBe(calibratedGlyph('@')!.ink);
  });

  it('exposes a shared whole-library index', () => {
    expect(calibratedIndex()).toBe(calibratedIndex());
    expect(calibratedIndex().size).toBe(calibratedCount());
  });
});

describe('sortRampByInk', () => {
  it('orders the preset ramp dark to light by measured ink', () => {
    const { sorted, source, uncalibrated } = sortRampByInk(PRESET_RAMP);
    expect(source).toBe('calibrated');
    expect(uncalibrated).toBe(0);
    expect(sorted.length).toBe(Array.from(PRESET_RAMP).length);
    const glyphs = Array.from(sorted);
    for (let i = 1; i < glyphs.length; i++) {
      expect(calibratedGlyph(glyphs[i - 1])!.ink).toBeGreaterThanOrEqual(calibratedGlyph(glyphs[i])!.ink);
    }
    expect(calibratedGlyph(glyphs[0])!.ink).toBeGreaterThan(0.9); // █
  });

  it('light-to-dark is the inverse order of dark-to-light', () => {
    const darkFirst = sortRampByInk(PRESET_RAMP, 'dark-to-light').sorted;
    const lightFirst = sortRampByInk(PRESET_RAMP, 'light-to-dark').sorted;
    expect(Array.from(lightFirst)).toEqual([...Array.from(darkFirst)].reverse());
  });

  it('preserves duplicates and reports uncalibrated fallbacks', () => {
    const mixed = `aa${UNCALIBRATED}`;
    const { sorted, source, uncalibrated } = sortRampByInk(mixed);
    expect(source).toBe('calibrated');
    expect(uncalibrated).toBe(1);
    expect(Array.from(sorted).filter((ch) => ch === 'a').length).toBe(2);
    const allUncalibrated = sortRampByInk(`${UNCALIBRATED}龘`);
    expect(allUncalibrated.source).toBe('heuristic');
    expect(allUncalibrated.uncalibrated).toBe(2);
    expect(sortRampByInk('').source).toBe('heuristic');
  });

  it('is deterministic for the same input', () => {
    expect(sortRampByInk(ALL_PRESET_CHARS.slice(0, 64)).sorted).toBe(
      sortRampByInk(ALL_PRESET_CHARS.slice(0, 64)).sorted,
    );
  });
});

describe('documentation stays measurable', () => {
  it('README quotes only counts this code can produce', () => {
    const readme = readFileSync(join(__dirname, '../../README.md'), 'utf8');
    const presets = ALL_CHARSET_PRESETS.length;
    const unique = countUniqueCharacters(ALL_CHARSET_PRESETS).toLocaleString('en-US');
    const calibrated = calibrationCoverage().calibrated.toLocaleString('en-US');
    expect(readme).toContain(`${presets} character sets / ${unique} unique characters`);
    expect(readme).toContain(`${calibrated} calibrated`);
    expect(readme).not.toContain('7,000');
  });
});
