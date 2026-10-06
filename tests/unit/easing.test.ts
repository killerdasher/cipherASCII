import { describe, expect, it } from 'vitest';
import { EASING_NAMES, cubicBezier, easeRaw, easings, getEasing, smootherstep, smoothstep } from '../../src/core/animation/easing';

describe('easing library', () => {
  it('exposes the full documented set', () => {
    const required = [
      'linear',
      'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
      'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
      'easeInQuart', 'easeOutQuart', 'easeInOutQuart',
      'easeInQuint', 'easeOutQuint', 'easeInOutQuint',
      'easeInSine', 'easeOutSine', 'easeInOutSine',
      'easeInExpo', 'easeOutExpo', 'easeInOutExpo',
      'easeInBack', 'easeOutBack', 'easeInOutBack',
      'easeInElastic', 'easeOutElastic', 'easeInOutElastic',
    ];
    for (const name of required) expect(EASING_NAMES).toContain(name);
    expect(EASING_NAMES.length).toBeGreaterThanOrEqual(25);
  });

  it('every easing starts at 0 and ends at 1', () => {
    for (const name of EASING_NAMES) {
      const fn = easings[name];
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
    }
  });

  it('every easing is finite across the unit interval', () => {
    for (const name of EASING_NAMES) {
      const fn = easings[name];
      for (let i = 0; i <= 100; i++) {
        const v = fn(i / 100);
        expect(Number.isFinite(v), `${name}(${i / 100}) = ${v}`).toBe(true);
      }
    }
  });

  it('monotonic easings never decrease', () => {
    const monotonic = [
      'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
      'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
      'easeInQuart', 'easeOutQuart', 'easeInOutQuart',
      'easeInQuint', 'easeOutQuint', 'easeInOutQuint',
      'easeInSine', 'easeOutSine', 'easeInOutSine',
      'easeInExpo', 'easeOutExpo', 'easeInOutExpo',
    ];
    for (const name of monotonic) {
      const fn = easings[name as keyof typeof easings];
      let prev = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const v = fn(i / 200);
        expect(v, `${name} decreased at t=${i / 200}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('in/out easings are symmetric about the midpoint', () => {
    const pairs: [keyof typeof easings, keyof typeof easings][] = [
      ['easeInQuad', 'easeOutQuad'],
      ['easeInCubic', 'easeOutCubic'],
      ['easeInQuart', 'easeOutQuart'],
      ['easeInSine', 'easeOutSine'],
    ];
    for (const [inName, outName] of pairs) {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        expect(easings[inName](t)).toBeCloseTo(1 - easings[outName](1 - t), 6);
      }
    }
  });

  it('easeOutBack overshoots then settles', () => {
    const peak = Math.max(...Array.from({ length: 200 }, (_, i) => easings.easeOutBack(i / 200)));
    expect(peak).toBeGreaterThan(1);
    expect(easings.easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it('easeOutElastic oscillates around 1 then settles', () => {
    const early = easings.easeOutElastic(0.3);
    expect(early).not.toBeCloseTo(0.3, 3);
    expect(easings.easeOutElastic(1)).toBeCloseTo(1, 6);
  });

  it('getEasing resolves names, functions and unknown values', () => {
    expect(getEasing('easeInExpo')(0.5)).toBe(easings.easeInExpo(0.5));
    const custom = (t: number) => t * 2;
    expect(getEasing(custom)(0.5)).toBe(1);
    expect(getEasing(undefined)(0.5)).toBe(0.5);
    expect(getEasing('nope' as never)(0.5)).toBe(0.5);
  });

  it('cubicBezier(0,0,1,1) equals linear and standard curves match', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (let i = 0; i <= 10; i++) expect(linear(i / 10)).toBeCloseTo(i / 10, 4);

    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBeCloseTo(0, 5);
    expect(ease(1)).toBeCloseTo(1, 5);
    expect(ease(0.5)).toBeGreaterThan(0.5);
  });

  it('smoothstep is clamped and flat at both ends', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0.01)).toBeLessThan(0.01);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 6);
  });

  it('easeRaw evaluates by name', () => {
    expect(easeRaw('linear', 0.4)).toBeCloseTo(0.4, 10);
  });
});
