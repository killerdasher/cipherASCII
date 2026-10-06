import { describe, expect, it } from 'vitest';
import {
  clamp,
  hashString,
  isCellCount,
  isPrintableChar,
  lerp,
  newId,
  Rng,
  sanitizeText,
  stableStringify,
} from '../../src/core/util';

describe('util', () => {
  describe('clamp', () => {
    it('clamps below min', () => expect(clamp(-5, 0, 10)).toBe(0));
    it('clamps above max', () => expect(clamp(15, 0, 10)).toBe(10));
    it('passes through in range', () => expect(clamp(5, 0, 10)).toBe(5));
    it('does not normalize inverted range', () => {
      // min > max: values below min return min
      expect(clamp(5, 10, 0)).toBe(10);
    });
  });

  describe('lerp', () => {
    it('returns start at t=0', () => expect(lerp(10, 20, 0)).toBe(10));
    it('returns end at t=1', () => expect(lerp(10, 20, 1)).toBe(20));
    it('interpolates mid', () => expect(lerp(10, 20, 0.5)).toBe(15));
  });

  describe('hashString', () => {
    it('is deterministic', () => {
      expect(hashString('hello')).toBe(hashString('hello'));
    });
    it('differs for different inputs', () => {
      expect(hashString('a')).not.toBe(hashString('b'));
    });
    it('produces base36 string', () => {
      const h = hashString('x');
      expect(h).toMatch(/^[0-9a-z]+$/);
    });
  });

  describe('stableStringify', () => {
    it('sorts object keys', () => {
      const a = stableStringify({ b: 1, a: 2 });
      const b = stableStringify({ a: 2, b: 1 });
      expect(a).toBe(b);
    });
    it('handles nested objects', () => {
      expect(stableStringify({ a: { c: 1, b: 2 } })).toBe('{"a":{"b":2,"c":1}}');
    });
    it('handles arrays in order', () => {
      expect(stableStringify([2, 1])).toBe('[2,1]');
    });
  });

  describe('newId', () => {
    it('includes prefix', () => expect(newId('test').startsWith('test')).toBe(true));
    it('is unique', () => expect(newId('x')).not.toBe(newId('x')));
  });

  describe('Rng', () => {
    it('same seed = same sequence', () => {
      const a = new Rng('seed');
      const b = new Rng('seed');
      expect(a.next()).toBe(b.next());
      expect(a.next()).toBe(b.next());
    });
    it('different seeds = different sequence', () => {
      const a = new Rng('a');
      const b = new Rng('b');
      expect(a.next()).not.toBe(b.next());
    });
    it('produces 0..1 floats', () => {
      const r = new Rng(1);
      for (let i = 0; i < 100; i++) {
        const v = r.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('isPrintableChar', () => {
    it('accepts printable ASCII', () => {
      expect(isPrintableChar('a')).toBe(true);
      expect(isPrintableChar(' ')).toBe(true);
      expect(isPrintableChar('~')).toBe(true);
    });
    it('rejects control chars', () => {
      expect(isPrintableChar('\x00')).toBe(false);
      expect(isPrintableChar('\t')).toBe(false);
      expect(isPrintableChar('\n')).toBe(false);
      expect(isPrintableChar('\x7f')).toBe(false);
    });
    it('rejects empty string', () => expect(isPrintableChar('')).toBe(false));
  });

  describe('sanitizeText', () => {
    it('strips C0 controls except tab/newline/carriage return', () => {
      expect(sanitizeText('a\x00b\nc')).toBe('ab\nc');
    });
    it('keeps printable', () => expect(sanitizeText('hello')).toBe('hello'));
    it('handles empty', () => expect(sanitizeText('')).toBe(''));
  });

  describe('isCellCount', () => {
    it('accepts positive integers', () => {
      expect(isCellCount(1)).toBe(true);
      expect(isCellCount(100)).toBe(true);
    });
    it('accepts zero', () => expect(isCellCount(0)).toBe(true));
    it('rejects non-integers', () => expect(isCellCount(1.5)).toBe(false));
    it('rejects negative', () => expect(isCellCount(-1)).toBe(false));
    it('rejects non-numbers', () => {
      expect(isCellCount('1')).toBe(false);
      expect(isCellCount(NaN)).toBe(false);
    });
  });
});