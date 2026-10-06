/**
 * Easing library.
 *
 * Every easing maps a normalized time `t ∈ [0,1]` to a normalized value
 * `e(t) ∈ [0,1]` (overshooting functions may leave that range mid-flight, but
 * they are still `f(0)=0` and `f(1)=1`).
 *
 * Nothing here allocates, branches on input type, or reads global state, so an
 * easing can be called thousands of times per frame without cost.
 */

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInQuint'
  | 'easeOutQuint'
  | 'easeInOutQuint'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic'
  | 'easeOutBounce';

export type EasingFn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const n1 = 2.75;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export const easings: Record<EasingName, EasingFn> = {
  linear: (t) => t,

  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 + --t * t * t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 + 4 * --t * t * t),

  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - --t * t * t * t,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),

  easeInQuint: (t) => t * t * t * t * t,
  easeOutQuint: (t) => 1 + --t * t * t * t * t,
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t),

  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

  easeInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
  },

  easeInBack: (t) => c3 * t * t * t - c1 * t * t,
  easeOutBack: (t) => 1 + c3 * --t * t * t + c1 * t * t,
  easeInOutBack: (t) =>
    t < 0.5
      ? (2 * t * 2 * t * ((c2 + 1) * 2 * t - c2)) / 2
      : (2 * t - 2) * (2 * t - 2) * ((c2 + 1) * (t * 2 - 2) + c2) / 2 + 1,

  easeInElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
  },
  easeOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  easeInOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? -(2 ** (20 * t - 10)) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5))
      : 2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ((2 * Math.PI) / 4.5)) + 1;
  },

  easeOutBounce: (t) => {
    if (t < 1 / n1) return 7.5625 * t * t;
    if (t < 2 / n1) return 7.5625 * (t -= 1.5 / n1) * t + 0.75;
    if (t < 2.5 / n1) return 7.5625 * (t -= 2.25 / n1) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / n1) * t + 0.984375;
  },
};

/** Resolve an easing by name (unknown names fall back to `linear`). */
export function getEasing(name: EasingName | EasingFn | undefined): EasingFn {
  if (typeof name === 'function') return name;
  if (name && easings[name]) return easings[name];
  return easings.linear;
}

export const EASING_NAMES = Object.keys(easings) as EasingName[];

/**
 * Cubic Bezier solver for CSS-style `cubic-bezier(x1,y1,x2,y2)` curves.
 * Newton-Raphson with a bisection fallback; converges in <5 iterations for
 * animation-rate curves.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const A = (a1: number, b1: number) => 1 - 3 * b1 + 3 * a1;
  const B = (a1: number, b1: number) => 3 * b1 - 6 * a1;
  const C = (a1: number) => 3 * a1;
  const calc = (t: number, a1: number, b1: number) => ((A(a1, b1) * t + B(a1, b1)) * t + C(a1)) * t;
  const slope = (t: number, a1: number, b1: number) => 3 * A(a1, b1) * t * t + 2 * B(a1, b1) * t + C(a1);

  return (x: number) => {
    const t = clamp01(x);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let guess = t;
    for (let i = 0; i < 8; i++) {
      const slopeT = slope(guess, x1, x2);
      if (Math.abs(slopeT) < 1e-6) break;
      const error = calc(guess, x1, x2) - t;
      if (Math.abs(error) < 1e-6) break;
      guess -= error / slopeT;
    }
    if (guess < 0 || guess > 1 || Number.isNaN(guess)) {
      let lo = 0;
      let hi = 1;
      guess = t;
      for (let i = 0; i < 20; i++) {
        const v = calc(guess, x1, x2);
        if (Math.abs(v - t) < 1e-6) break;
        if (v < t) lo = guess;
        else hi = guess;
        guess = (lo + hi) / 2;
      }
    }
    return calc(guess, y1, y2);
  };
}

/** Smoothstep (Hermite) — the default for cross-fades and value interpolation. */
export const smoothstep: EasingFn = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Smootherstep (Perlin) — flatter ends, useful for camera moves. */
export const smootherstep: EasingFn = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Catmull-Rom style overshoot curve defined by an amplitude knob. */
export function backOut(amplitude = 1.70158): EasingFn {
  const c = amplitude + 1;
  return (t) => {
    const x = clamp01(t) - 1;
    return 1 + c * x * x * x + amplitude * x * x;
  };
}

/** Evaluate a named easing without clamping (used by spring/elastic drivers). */
export function easeRaw(name: EasingName, t: number): number {
  return easings[name](t);
}
