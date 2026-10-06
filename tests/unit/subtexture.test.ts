import { describe, expect, it } from 'vitest';
import {
  SUBTEXTURE_MAX_PIXELS,
  applySubtexture,
  normalizeSubtexture,
  shouldApplySubtexture,
  subtextureMask,
} from '../../src/core/subtexture';
import { DEFAULT_SUBTEXTURE, type SubtexturePattern, type SubtextureSettings } from '../../src/core/types';

const PATTERNS: SubtexturePattern[] = ['scanlines', 'rgbStripes', 'rgbRosette', 'grid'];

function settings(patch: Partial<SubtextureSettings> = {}): SubtextureSettings {
  return { ...DEFAULT_SUBTEXTURE, ...patch };
}

function buffer(width: number, height: number, value = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return data;
}

describe('subtexture mask math', () => {
  it('returns identity factors for the none pattern', () => {
    expect(subtextureMask('none', 3, 7, 4, 'linear')).toEqual([1, 1, 1]);
    expect(subtextureMask('none', 3, 7, 4, 'nearest')).toEqual([1, 1, 1]);
  });

  it.each(PATTERNS)('%s factors stay inside 0..1', (pattern) => {
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const [r, g, b] = subtextureMask(pattern, x, y, 3, 'linear');
        for (const v of [r, g, b]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('scanlines darken one band of every 2*scale rows and repeat', () => {
    const s = 3;
    for (const interp of ['nearest', 'linear'] as const) {
      const top = subtextureMask('scanlines', 0, 1, s, interp)[0];
      const bottom = subtextureMask('scanlines', 0, 1 + 2 * s, s, interp)[0];
      expect(bottom).toBe(top);
      // Nearest: the first band is fully dark, the second fully lit.
      if (interp === 'nearest') {
        expect(top).toBe(0);
        expect(subtextureMask('scanlines', 0, s, s, interp)[0]).toBe(1);
      }
      // The two bands must differ under either interpolation.
      expect(subtextureMask('scanlines', 0, s, s, interp)[0]).not.toBe(top);
    }
  });

  it('rgbStripes hand exactly one unmasked channel to each pixel (nearest)', () => {
    const s = 2;
    for (let x = 0; x < 18; x++) {
      const [r, g, b] = subtextureMask('rgbStripes', x, 0, s, 'nearest');
      const lit = [r, g, b].filter((v) => v === 1).length;
      expect(lit).toBe(1);
      // Stripe period is 3*scale: the channel order repeats.
      const again = subtextureMask('rgbStripes', x + 3 * s, 0, s, 'nearest');
      expect(again).toEqual([r, g, b]);
    }
  });

  it('rgbRosette peaks on a dot centre and dies in the gaps', () => {
    const s = 4;
    const period = 3 * s;
    // Red dot centre sits at (0.25 * period, 0.25 * period).
    const onDot = subtextureMask('rgbRosette', period / 4, period / 4, s, 'linear');
    expect(onDot[0]).toBeCloseTo(1, 5);
    expect(onDot[1]).toBeLessThan(0.6);
    // A point outside every dot (cell edge, mid-height) is fully masked.
    const gap = subtextureMask('rgbRosette', 0, period / 2, s, 'nearest');
    expect(Math.max(...gap)).toBe(0);
  });

  it('grid lines sit on multiples of the scale and vanish at scale 1', () => {
    for (const interp of ['nearest', 'linear'] as const) {
      // scale 1 has no gap between lines, so the mask is identity.
      expect(subtextureMask('grid', 0, 0, 1, interp)).toEqual([1, 1, 1]);
      expect(subtextureMask('grid', 1, 0, 1, interp)).toEqual([1, 1, 1]);
    }
    expect(subtextureMask('grid', 0, 5, 4, 'nearest')[0]).toBe(0);
    expect(subtextureMask('grid', 5, 0, 4, 'nearest')[0]).toBe(0);
    expect(subtextureMask('grid', 3, 3, 4, 'nearest')[0]).toBe(1);
  });
});

describe('applySubtexture', () => {
  it('leaves the buffer untouched when the mask is off', () => {
    const data = buffer(6, 6, 200);
    const before = new Uint8ClampedArray(data);
    applySubtexture(data, 6, 6, settings({ pattern: 'none', opacity: 1 }));
    applySubtexture(data, 6, 6, settings({ pattern: 'scanlines', opacity: 0 }));
    expect([...data]).toEqual([...before]);
  });

  it('blend matches the documented 1 - opacity * (1 - mask) formula', () => {
    const data = buffer(4, 4, 200);
    // Nearest scanlines: row 0 dark (mask 0), row 1 lit (mask 1). With a
    // 4-wide buffer row 1 starts at byte 4 * 4 = 16.
    applySubtexture(data, 4, 4, settings({ pattern: 'scanlines', scale: 1, opacity: 0.5, interpolation: 'nearest' }));
    expect(data[0]).toBe(100);
    expect(data[16]).toBe(200);
    // Opacity 1 would zero the dark band entirely.
    const full = buffer(4, 1, 200);
    applySubtexture(full, 4, 1, settings({ pattern: 'scanlines', scale: 1, opacity: 1, interpolation: 'nearest' }));
    expect(full[0]).toBe(0);
  });

  it('applies per-channel multiplication for rgbStripes', () => {
    const data = buffer(6, 1, 200);
    applySubtexture(data, 6, 1, settings({ pattern: 'rgbStripes', scale: 1, opacity: 1, interpolation: 'nearest' }));
    // Pixel 0 is the red stripe: only the red channel survives.
    expect(data[0]).toBe(200);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
    // Pixel 1 is the green stripe.
    expect(data[4]).toBe(0);
    expect(data[5]).toBe(200);
    expect(data[6]).toBe(0);
  });

  it('ignores buffers that are too short for the stated size', () => {
    const data = new Uint8ClampedArray(4);
    const before = new Uint8ClampedArray(data);
    applySubtexture(data, 4, 4, settings({ pattern: 'scanlines', opacity: 1 }));
    expect([...data]).toEqual([...before]);
  });

  it('does not mutate alpha', () => {
    const data = buffer(4, 4, 128);
    applySubtexture(data, 4, 4, settings({ pattern: 'grid', scale: 2, opacity: 1 }));
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });
});

describe('subtexture gating and normalisation', () => {
  it('only applies when a visible mask fits the canvas', () => {
    expect(shouldApplySubtexture(settings({ pattern: 'scanlines' }), 100, 100)).toBe(true);
    expect(shouldApplySubtexture(settings({ pattern: 'none' }), 100, 100)).toBe(false);
    expect(shouldApplySubtexture(settings({ pattern: 'scanlines', opacity: 0 }), 100, 100)).toBe(false);
    expect(shouldApplySubtexture(null, 100, 100)).toBe(false);
    expect(
      shouldApplySubtexture(settings({ pattern: 'scanlines' }), SUBTEXTURE_MAX_PIXELS + 1, 1),
    ).toBe(false);
  });

  it('normalises garbage back to safe values', () => {
    expect(normalizeSubtexture(undefined, DEFAULT_SUBTEXTURE)).toEqual(DEFAULT_SUBTEXTURE);
    expect(normalizeSubtexture({ pattern: 'nope', scale: -4, opacity: 9 }, DEFAULT_SUBTEXTURE)).toEqual({
      pattern: 'none',
      scale: 1,
      opacity: 1,
      interpolation: 'linear',
    });
    const clamped = normalizeSubtexture(
      { pattern: 'grid', scale: 999, opacity: -1, interpolation: 'nearest' },
      DEFAULT_SUBTEXTURE,
    );
    expect(clamped).toEqual({ pattern: 'grid', scale: 32, opacity: 0, interpolation: 'nearest' });
  });
});
