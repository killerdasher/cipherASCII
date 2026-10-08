import { describe, it, expect } from 'vitest';
import {
  ALL_CHARSET_PRESETS,
  CHARSET_CATEGORIES,
  getCharsetById,
  getCharsetsByCategory,
} from '../../src/core/charsets/extendedCharsets';
import {
  countUniqueCharacters,
  characterDensity,
  sortCharactersByDensity,
} from '../../src/core/charsets/unicodeCharsets';

const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]');

describe('charset library', () => {
  it('ships at least 1000 distinct characters', () => {
    expect(countUniqueCharacters(ALL_CHARSET_PRESETS)).toBeGreaterThanOrEqual(1000);
  });

  it('ships at least 60 presets', () => {
    expect(ALL_CHARSET_PRESETS.length).toBeGreaterThanOrEqual(60);
  });

  it('uses unique preset ids', () => {
    const ids = ALL_CHARSET_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never contains control characters', () => {
    for (const preset of ALL_CHARSET_PRESETS) {
      expect(CONTROL.test(preset.chars), `${preset.id} contains control characters`).toBe(false);
    }
  });

  it('every preset has a non-empty ramp, a label and a known category', () => {
    const known = new Set<string>(CHARSET_CATEGORIES);
    for (const preset of ALL_CHARSET_PRESETS) {
      expect(preset.chars.length, `${preset.id} is empty`).toBeGreaterThan(0);
      expect(preset.label.length, `${preset.id} has no label`).toBeGreaterThan(0);
      expect(preset.description.length, `${preset.id} has no description`).toBeGreaterThan(0);
      expect(known.has(preset.category), `${preset.id} has unknown category`).toBe(true);
    }
  });

  it('exposes every category through the lookup helpers', () => {
    for (const category of CHARSET_CATEGORIES) {
      if (category === 'custom') continue;
      const sets = getCharsetsByCategory(category);
      expect(sets.length, `${category} has no presets`).toBeGreaterThan(0);
      for (const set of sets) expect(set.category).toBe(category);
    }
  });

  it('resolves presets by id', () => {
    for (const preset of ALL_CHARSET_PRESETS) {
      expect(getCharsetById(preset.id)?.chars).toBe(preset.chars);
    }
    expect(getCharsetById('does-not-exist')).toBeUndefined();
  });

  it('braille density ramp is ordered darkest-first by dot count', () => {
    const ramp = getCharsetById('braille-density');
    expect(ramp).toBeDefined();
    const chars = Array.from(ramp!.chars);
    expect(chars.length).toBe(256);
    const dots = (s: string) => {
      const mask = s.codePointAt(0)! - 0x2800;
      let n = 0;
      for (let i = 0; i < 8; i++) if (mask & (1 << i)) n++;
      return n;
    };
    for (let i = 1; i < chars.length; i++) {
      expect(dots(chars[i - 1])).toBeGreaterThanOrEqual(dots(chars[i]));
    }
    expect(dots(chars[0])).toBe(8);
    expect(dots(chars[chars.length - 1])).toBe(0);
  });

  it('includes the complete Unicode blocks it claims to', () => {
    const len = (id: string) => Array.from(getCharsetById(id)?.chars ?? '').length;
    expect(len('box-grid-full')).toBe(128);
    expect(len('braille-density')).toBe(256);
    expect(len('math-operators')).toBe(256);
    expect(len('technical-misc')).toBe(256);
    expect(len('arrows-all')).toBe(112);
  });
});

describe('character density ordering', () => {
  it('ranks printable ASCII dark to light', () => {
    expect(characterDensity(' ')).toBeLessThan(characterDensity('.'));
    expect(characterDensity('.')).toBeLessThan(characterDensity('#'));
    expect(characterDensity('#')).toBeLessThan(characterDensity('@'));
    expect(characterDensity('@')).toBeLessThan(characterDensity('█'));
  });

  it('scores solid and shaded blocks explicitly', () => {
    expect(characterDensity('█')).toBe(1);
    expect(characterDensity('░')).toBe(0.25);
    expect(characterDensity('▒')).toBe(0.5);
    expect(characterDensity('▓')).toBe(0.75);
    expect(characterDensity('')).toBe(0);
  });

  it('falls back to neutral density for unknown glyphs', () => {
    expect(characterDensity('中')).toBe(0.5);
    expect(characterDensity('🙂')).toBe(0.5);
  });

  it('sorts a ramp dark to light without losing characters', () => {
    expect(sortCharactersByDensity('@# .')).toBe('@#. ');
    const ramp = ' .:-=+*#%@█';
    const sorted = sortCharactersByDensity(ramp);
    expect(sorted.length).toBe(Array.from(ramp).length);
    const counts = (s: string) => {
      const m = new Map<string, number>();
      for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
      return m;
    };
    expect(counts(sorted)).toEqual(counts(ramp));
    const glyphs = Array.from(sorted);
    for (let i = 1; i < glyphs.length; i++) {
      expect(characterDensity(glyphs[i - 1])).toBeGreaterThanOrEqual(characterDensity(glyphs[i]));
    }
  });

  it('is stable for equal densities', () => {
    expect(sortCharactersByDensity('ab')).toBe('ab');
    expect(sortCharactersByDensity('ba')).toBe('ba');
    expect(sortCharactersByDensity('hello')).toBe(sortCharactersByDensity('hello'));
  });

  it('sorts every shipped preset without changing its character set', () => {
    for (const preset of ALL_CHARSET_PRESETS) {
      const sorted = sortCharactersByDensity(preset.chars);
      expect(Array.from(sorted).length, preset.id).toBe(Array.from(preset.chars).length);
      expect(new Set(sorted), preset.id).toEqual(new Set(preset.chars));
    }
  });
});
