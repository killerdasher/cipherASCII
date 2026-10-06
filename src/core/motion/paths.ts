/**
 * Motion paths.
 *
 * Every path is a pure function `t ∈ [0,1] → (x,y)`. Paths are resolved at
 * construction time where possible (random walks are pre-sampled from a seeded
 * RNG) so sampling during animation is branch-light and allocation-free.
 *
 * Determinism matters: the same spec and seed always produce the same curve,
 * which is what makes screenshots, demos and visual regression tests stable.
 */

import { Rng } from '../util';

export interface Point {
  x: number;
  y: number;
}

export type PathSpec =
  | { kind: 'linear'; from: Point; to: Point }
  | { kind: 'polyline'; points: readonly Point[] }
  | { kind: 'smooth'; points: readonly Point[] }
  | { kind: 'quadratic'; from: Point; control: Point; to: Point }
  | { kind: 'cubic'; from: Point; c1: Point; c2: Point; to: Point }
  | { kind: 'arc'; cx: number; cy: number; radius: number; startAngle: number; sweep: number }
  | { kind: 'spiral'; cx: number; cy: number; r0: number; r1: number; turns: number; startAngle?: number }
  | { kind: 'radial'; cx: number; cy: number; angle: number; r0: number; r1: number }
  | { kind: 'randomWalk'; from: Point; step: number; steps: number; seed?: number }
  | { kind: 'attractor'; from: Point; to: Point; turns?: number; pull?: number }
  | { kind: 'repulsion'; from: Point; away: Point; distance: number; spread?: number; seed?: number };

export interface Path {
  readonly spec: PathSpec;
  /** Write the position at `t` into `out` and return it. */
  sample(t: number, out: Point): Point;
  /** Approximate arc length (sampled once at construction). */
  readonly length: number;
}

const TAU = Math.PI * 2;

/** Catmull-Rom interpolation through `p0..p3` at local parameter `t`. */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number, out: Point): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  out.x =
    0.5 *
    (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y =
    0.5 *
    (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return out;
}

function polylineSampler(points: readonly Point[]): (t: number, out: Point) => Point {
  if (points.length === 0) return (_t, out) => ((out.x = 0), (out.y = 0), out);
  if (points.length === 1) return (_t, out) => ((out.x = points[0].x), (out.y = points[0].y), out);

  const segments = points.length - 1;
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dy);
  }
  const total = cumulative[segments] || 1;

  return (t, out) => {
    // Not clamped: easing curves such as back/elastic legitimately leave
    // [0,1], and a path that clamps would swallow the overshoot.
    const target = t * total;
    let lo = 0;
    let hi = segments;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const span = cumulative[i] - cumulative[i - 1] || 1;
    const local = (target - cumulative[i - 1]) / span;
    out.x = points[i - 1].x + (points[i].x - points[i - 1].x) * local;
    out.y = points[i - 1].y + (points[i].y - points[i - 1].y) * local;
    return out;
  };
}

function smoothSampler(points: readonly Point[]): (t: number, out: Point) => Point {
  if (points.length < 3) return polylineSampler(points);
  const p = [points[0], ...points, points[points.length - 1]];
  const segments = p.length - 3;
  return (t, out) => {
    // Spline extrapolation is undefined outside the control polygon, so the
    // smooth path is the one place that clamps.
    const x = (t < 0 ? 0 : t > 1 ? 1 : t) * segments;
    const i = Math.min(segments - 1, Math.floor(x));
    return catmullRom(p[i], p[i + 1], p[i + 2], p[i + 3], x - i, out);
  };
}

/** Build a path from a declarative spec. */
export function createPath(spec: PathSpec): Path {
  switch (spec.kind) {
    case 'linear': {
      const { from, to } = spec;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      return {
        spec,
        length,
        sample: (t, out) => {
          out.x = from.x + (to.x - from.x) * t;
          out.y = from.y + (to.y - from.y) * t;
          return out;
        },
      };
    }

    case 'polyline':
      return makePath(spec, polylineSampler(spec.points));

    case 'smooth':
      return makePath(spec, smoothSampler(spec.points));

    case 'quadratic': {
      const { from, control, to } = spec;
      return makePath(spec, (t, out) => {
        const u = 1 - t;
        out.x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
        out.y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
        return out;
      });
    }

    case 'cubic': {
      const { from, c1, c2, to } = spec;
      return makePath(spec, (t, out) => {
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        out.x = a * from.x + b * c1.x + c * c2.x + d * to.x;
        out.y = a * from.y + b * c1.y + c * c2.y + d * to.y;
        return out;
      });
    }

    case 'arc': {
      const { cx, cy, radius, startAngle, sweep } = spec;
      return makePath(spec, (t, out) => {
        const a = startAngle + sweep * t;
        out.x = cx + Math.cos(a) * radius;
        out.y = cy + Math.sin(a) * radius;
        return out;
      });
    }

    case 'spiral': {
      const { cx, cy, r0, r1, turns } = spec;
      const startAngle = spec.startAngle ?? 0;
      return makePath(spec, (t, out) => {
        const a = startAngle + TAU * turns * t;
        const r = r0 + (r1 - r0) * t;
        out.x = cx + Math.cos(a) * r;
        out.y = cy + Math.sin(a) * r;
        return out;
      });
    }

    case 'radial': {
      const { cx, cy, angle, r0, r1 } = spec;
      return makePath(spec, (t, out) => {
        const r = r0 + (r1 - r0) * t;
        out.x = cx + Math.cos(angle) * r;
        out.y = cy + Math.sin(angle) * r;
        return out;
      });
    }

    case 'randomWalk': {
      const { from, step, steps, seed } = spec;
      const rng = new Rng(seed ?? 1);
      const pts: Point[] = [{ ...from }];
      let x = from.x;
      let y = from.y;
      for (let i = 0; i < steps; i++) {
        const angle = rng.next() * TAU;
        const magnitude = step * (0.5 + rng.next());
        x += Math.cos(angle) * magnitude;
        y += Math.sin(angle) * magnitude;
        pts.push({ x, y });
      }
      return makePath(spec, polylineSampler(pts));
    }

    case 'attractor': {
      const { from, to } = spec;
      const turns = spec.turns ?? 1.5;
      const pull = spec.pull ?? 2.4;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const r0 = Math.hypot(dx, dy);
      const startAngle = Math.atan2(dy, dx);
      const norm = 1 - Math.exp(-pull);
      return makePath(spec, (t, out) => {
        // Normalised exponential decay: starts at full radius and lands
        // exactly on the target at t=1 while keeping the "falling in" spiral.
        const decay = (Math.exp(-pull * t) - Math.exp(-pull)) / norm;
        const r = r0 * decay;
        const a = startAngle + TAU * turns * t;
        out.x = to.x + Math.cos(a) * r;
        out.y = to.y + Math.sin(a) * r;
        return out;
      });
    }

    case 'repulsion': {
      const { from, away, distance, spread } = spec;
      const seed = spec.seed ?? 7;
      const dx = from.x - away.x;
      const dy = from.y - away.y;
      const baseAngle = Math.atan2(dy, dx);
      const spreadAmt = spread ?? 0.5;
      const rng = new Rng(seed);
      const jitter = (rng.next() - 0.5) * spreadAmt;
      const angle = baseAngle + jitter;
      const lateral = (rng.next() - 0.5) * spreadAmt * 0.5;
      return makePath(spec, (t, out) => {
        // Fast escape that decelerates — reads as physics rather than a lerp.
        const eased = 1 - (1 - t) * (1 - t);
        const r = distance * eased;
        const curve = angle + lateral * (1 - t);
        out.x = from.x + Math.cos(curve) * r;
        out.y = from.y + Math.sin(curve) * r;
        return out;
      });
    }
  }
}

function makePath(spec: PathSpec, sample: (t: number, out: Point) => Point): Path {
  const probe: Point = { x: 0, y: 0 };
  const steps = 32;
  let length = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= steps; i++) {
    sample(i / steps, probe);
    if (i > 0) length += Math.hypot(probe.x - px, probe.y - py);
    px = probe.x;
    py = probe.y;
  }
  return { spec, length, sample };
}

/** Sample a path into a fresh point (convenience for one-shot queries). */
export function pointOnPath(path: Path, t: number): Point {
  return path.sample(t, { x: 0, y: 0 });
}

/**
 * Full character-level motion state (section 18 of the design brief).
 *
 * Bodies integrate position with velocity/acceleration and can also be driven
 * directly by a {@link Path}. Both modes are supported because reveal effects
 * want scripted motion while particle/trail effects want physics.
 */
export interface BodyInit {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  home?: Point;
  target?: Point;
  layer?: number;
  lifetime?: number;
}

export class Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax = 0;
  ay = 0;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  layer: number;
  age = 0;
  lifetime: number;
  alive = true;

  constructor(init: BodyInit = {}) {
    this.x = init.x ?? 0;
    this.y = init.y ?? 0;
    this.vx = init.vx ?? 0;
    this.vy = init.vy ?? 0;
    this.homeX = init.home?.x ?? this.x;
    this.homeY = init.home?.y ?? this.y;
    this.targetX = init.target?.x ?? this.x;
    this.targetY = init.target?.y ?? this.y;
    this.layer = init.layer ?? 0;
    this.lifetime = init.lifetime ?? Infinity;
  }

  /** Euler integration with optional spring pull toward the target. */
  step(dt: number, damping = 0, spring = 0): void {
    const seconds = dt / 1000;
    if (spring > 0) {
      this.ax += (this.targetX - this.x) * spring;
      this.ay += (this.targetY - this.y) * spring;
    }
    this.vx += this.ax * seconds;
    this.vy += this.ay * seconds;
    if (damping > 0) {
      const d = Math.max(0, 1 - damping * seconds);
      this.vx *= d;
      this.vy *= d;
    }
    this.x += this.vx * seconds;
    this.y += this.vy * seconds;
    this.ax = 0;
    this.ay = 0;
    this.age += dt;
    if (this.age >= this.lifetime) this.alive = false;
  }

  /** Place the body exactly on a path at `t`. */
  follow(path: Path, t: number): void {
    const p = path.sample(t, tmpPoint);
    this.x = p.x;
    this.y = p.y;
  }

  distanceTo(x: number, y: number): number {
    return Math.hypot(this.x - x, this.y - y);
  }
}

const tmpPoint: Point = { x: 0, y: 0 };
