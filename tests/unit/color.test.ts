import { describe, expect, it } from 'vitest';
import {
  ANSI256,
  rgb,
  red,
  green,
  blue,
  luminance,
  toHex,
  fromHex,
  rgbToAnsi16,
  rgbToAnsi256,
  hslToRgb,
} from '../../src/core/color';

describe('color', () => {
  describe('rgb/red/green/blue', () => {
    it('packs and unpacks', () => {
      const packed = rgb(0x12, 0x34, 0x56);
      expect(red(packed)).toBe(0x12);
      expect(green(packed)).toBe(0x34);
      expect(blue(packed)).toBe(0x56);
    });
  });

  describe('luminance (rec709)', () => {
    it('white = 1', () => expect(luminance(0xffffff)).toBe(1));
    it('black = 0', () => expect(luminance(0x000000)).toBe(0));
    it('mid grey ~0.5', () => expect(luminance(0x808080)).toBeCloseTo(128 / 255, 2));
    it('pure green > pure red', () => expect(luminance(0x00ff00)).toBeGreaterThan(luminance(0xff0000)));
  });

  describe('toHex / fromHex', () => {
    it('round-trips', () => {
      expect(fromHex(toHex(0xabcdef))).toBe(0xabcdef);
    });
    it('handles leading zeros', () => expect(toHex(0x0000ff)).toBe('#0000ff'));
  });

  describe('ansi16', () => {
    it('maps primary colors to 0..15 range', () => {
      expect(rgbToAnsi16(0x000000)).toBeLessThan(16);
      expect(rgbToAnsi16(0xffffff)).toBeLessThan(16);
    });
  });

  describe('ansi256', () => {
    it('maps to 0..255', () => {
      expect(rgbToAnsi256(0x000000)).toBeLessThan(256);
      expect(rgbToAnsi256(0xffffff)).toBeLessThan(256);
    });

    it('hits the exact cube slot for saturated primaries', () => {
      // Regression: Math.round((255 - 35) / 40) is 6, which used to index past
      // the cube and send pure red to the grey ramp instead of index 196.
      expect(rgbToAnsi256(0xff0000)).toBe(196);
      expect(rgbToAnsi256(0x00ff00)).toBe(46);
      expect(rgbToAnsi256(0x0000ff)).toBe(21);
      expect(rgbToAnsi256(0xffff00)).toBe(226);
      expect(rgbToAnsi256(0xff00ff)).toBe(201);
      expect(rgbToAnsi256(0x00ffff)).toBe(51);
    });

    it('always resolves inside the palette', () => {
      const samples = [0x000000, 0xffffff, 0xff0000, 0x010101, 0xfefefe, 0x123456, 0x808080, 0x7f7f7f, 0x203040];
      for (const c of samples) {
        const idx = rgbToAnsi256(c);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(256);
        expect(ANSI256[idx]).toBeDefined();
      }
    });
  });

  describe('hslToRgb', () => {
    it('hue 0 and 1/3 and 2/3 produce different colors (normalized input)', () => {
      const r0 = hslToRgb(0, 1, 0.5);
      const r120 = hslToRgb(1 / 3, 1, 0.5);
      const r240 = hslToRgb(2 / 3, 1, 0.5);
      expect(r0).not.toBe(r120);
      expect(r120).not.toBe(r240);
      expect(r240).not.toBe(r0);
    });
    it('saturation 0 = grey', () => {
      const g = hslToRgb(0.3, 0, 0.5);
      expect(red(g)).toBe(green(g));
      expect(green(g)).toBe(blue(g));
    });
    it('lightness 0 = black, 1 = white', () => {
      expect(hslToRgb(0, 1, 0)).toBe(0x000000);
      expect(hslToRgb(0, 1, 1)).toBe(0xffffff);
    });
  });
});