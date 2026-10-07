import { describe, it, expect } from 'vitest';
import {
  ANALYZER_DITHERS,
  analyzeLuma,
  analyzeLumaChunked,
  describeTraits,
} from '../../src/core/analyze';
import { CHARSET_PRESETS, getCharset } from '../../src/core/mapping';

const W = 96;
const H = 48;

/** Smooth left-to-right ramp - the classic banding trap. */
function gradientPlane(w = W, h = H): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = w > 1 ? x / (w - 1) : 0;
  }
  return out;
}

/** Deterministic pseudo-photo: noise with structure (a vertical "subject"). */
function photoPlane(w = W, h = H, seed = 42): Float32Array {
  const out = new Float32Array(w * h);
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = 0.5 + 0.4 * Math.sin((x / w) * Math.PI * 2);
      out[y * w + x] = Math.min(1, Math.max(0, base * 0.7 + rand() * 0.3));
    }
  }
  return out;
}

function flatPlane(value = 0.5, w = 32, h = 16): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** Hard two-tone logo: black square on white. */
function logoPlane(w = W, h = H): Float32Array {
  const out = new Float32Array(w * h).fill(1);
  for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y++) {
    for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) {
      out[y * w + x] = 0;
    }
  }
  return out;
}

describe('analyzeLuma', () => {
  it('returns ranked, in-range recommendations over real presets', () => {
    const { recommendations, traits } = analyzeLuma(gradientPlane(), W, H);
    expect(recommendations.length).toBe(6);
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i].score).toBeLessThanOrEqual(recommendations[i - 1].score);
    }
    for (const r of recommendations) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
      const preset = getCharset(r.charsetId);
      expect(preset).toBeTruthy();
      expect(r.chars).toBe(preset!.chars);
      expect(ANALYZER_DITHERS).toContain(r.ditherId);
      expect(r.metrics.sharp).toBeGreaterThanOrEqual(0);
      expect(r.metrics.soft).toBeLessThanOrEqual(1);
      expect(r.metrics.deflat).toBeLessThanOrEqual(1);
      expect(r.metrics.tone).toBeLessThanOrEqual(1);
      expect(r.metrics.legibility).toBeGreaterThanOrEqual(0);
      expect(r.metrics.legibility).toBeLessThanOrEqual(1);
      expect(Number.isFinite(r.score)).toBe(true);
    }
    expect(traits.contrast).toBeGreaterThan(0.5); // full-range ramp
    expect(traits.bandingRisk).toBeGreaterThan(0.2); // smooth ramp present
  });

  it('is deterministic for the same input', () => {
    const a = analyzeLuma(photoPlane(48, 24), 48, 24);
    const b = analyzeLuma(photoPlane(48, 24), 48, 24);
    expect(a).toEqual(b);
  });

  it('prefers dithering for smooth gradients (banding relief wins)', () => {
    const top = analyzeLuma(gradientPlane(), W, H, { limit: 1 }).recommendations[0];
    expect(top.ditherId).not.toBe('none');
    expect(top.metrics.deflat).toBeGreaterThan(0.8);
    // Same charset, dithered vs plain: the dithered variant must score higher.
    const charset = getCharset(top.charsetId)!;
    const twins = analyzeLuma(gradientPlane(), W, H, {
      charsets: [charset],
      limit: 9999,
    }).recommendations;
    const none = twins.find((r) => r.ditherId === 'none')!;
    expect(none).toBeTruthy();
    expect(top.score).toBeGreaterThan(none.score);
  });

  it('prefers undithered output for noisy photo detail', () => {
    const winner = analyzeLuma(photoPlane(), W, H, { limit: 1 }).recommendations[0];
    expect(winner.ditherId).toBe('none');
    // No dithered twin of the winning charset may outscore its 'none' twin.
    const twins = analyzeLuma(photoPlane(), W, H, {
      charsets: [getCharset(winner.charsetId)!],
      limit: 9999,
    }).recommendations;
    const plain = twins.find((r) => r.ditherId === 'none')!;
    for (const twin of twins) {
      expect(twin.score).toBeLessThanOrEqual(plain.score);
    }
  });

  it('stays finite on degenerate planes', () => {
    for (const plane of [flatPlane(0), flatPlane(1), flatPlane(0.5)]) {
      const { recommendations, traits } = analyzeLuma(plane, 32, 16);
      expect(recommendations.length).toBeGreaterThan(0);
      for (const r of recommendations) {
        expect(Number.isFinite(r.score)).toBe(true);
        expect(Number.isFinite(r.metrics.deflat)).toBe(true);
      }
      expect(Number.isFinite(traits.bandingRisk)).toBe(true);
    }
  });

  it('rejects a plane that does not match the dimensions', () => {
    expect(() => analyzeLuma(new Float32Array(10), 4, 3)).toThrow(RangeError);
  });

  it('honours the limit and custom candidate lists', () => {
    const { recommendations } = analyzeLuma(logoPlane(), W, H, {
      limit: 3,
      dithers: ['none', 'floydSteinberg'],
    });
    expect(recommendations.length).toBe(3);
    for (const r of recommendations) {
      expect(['none', 'floydSteinberg']).toContain(r.ditherId);
    }
    const tiny = analyzeLuma(logoPlane(), W, H, {
      charsets: CHARSET_PRESETS.slice(0, 2),
      dithers: ['none'],
      limit: 100,
    });
    expect(tiny.recommendations.length).toBe(2);
  });

  it('completes a realistic analysis quickly', () => {
    const started = performance.now();
    analyzeLuma(photoPlane(120, 72), 120, 72);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('analyzeLumaChunked', () => {
  it('matches the sync result exactly', async () => {
    const luma = photoPlane(48, 24);
    const sync = analyzeLuma(luma, 48, 24, { limit: 6 });
    const chunked = await analyzeLumaChunked(
      luma,
      48,
      24,
      { limit: 6 },
      () => Promise.resolve(),
    );
    expect(chunked).toEqual(sync);
  });
});

describe('describeTraits', () => {
  it('names the dominant content trait', () => {
    expect(describeTraits({ contrast: 0.1, detail: 0, bandingRisk: 0 })).toBe('low contrast');
    expect(describeTraits({ contrast: 0.8, detail: 0.1, bandingRisk: 0.5 })).toBe(
      'smooth gradients - dithering helps',
    );
    expect(describeTraits({ contrast: 0.8, detail: 0.7, bandingRisk: 0 })).toBe('fine detail');
    expect(describeTraits({ contrast: 0.8, detail: 0.3, bandingRisk: 0.1 })).toBe('mixed tones');
  });
});
