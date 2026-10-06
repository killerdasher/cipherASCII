import { describe, expect, it } from 'vitest';
import {
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