import { describe, expect, it } from 'vitest';
import { Body, createPath, pointOnPath } from '../../src/core/motion/paths';

describe('paths', () => {
  it('linear interpolates endpoints', () => {
    const p = createPath({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 10, y: 20 } });
    const a = pointOnPath(p, 0);
    const b = pointOnPath(p, 1);
    const m = pointOnPath(p, 0.5);
    expect([a.x, a.y]).toEqual([0, 0]);
    expect([b.x, b.y]).toEqual([10, 20]);
    expect([m.x, m.y]).toEqual([5, 10]);
    expect(p.length).toBeCloseTo(Math.hypot(10, 20), 6);
  });

  it('extrapolates outside the unit interval so overshoot easings survive', () => {
    const p = createPath({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    expect(pointOnPath(p, -0.5).x).toBe(-5);
    expect(pointOnPath(p, 1.5).x).toBe(15);
  });

  it('polyline lands exactly on the vertices', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const p = createPath({ kind: 'polyline', points: pts });
    expect(pointOnPath(p, 0)).toEqual({ x: 0, y: 0 });
    const half = pointOnPath(p, 0.5);
    expect(half.x).toBeCloseTo(10, 6);
    expect(pointOnPath(p, 1)).toEqual({ x: 10, y: 10 });
  });

  it('polyline distributes by arc length, not by vertex index', () => {
    const p = createPath({ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 1 }] });
    const at = pointOnPath(p, 0.5);
    // 100 + 1 = 101 units of arc; half of that is inside the long first leg.
    expect(at.x).toBeCloseTo(50.5, 6);
    expect(at.y).toBeCloseTo(0, 6);
    expect(pointOnPath(p, 1)).toEqual({ x: 100, y: 1 });
  });

  it('smooth path passes through the first and last point', () => {
    const p = createPath({
      kind: 'smooth',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ],
    });
    expect(pointOnPath(p, 0).x).toBeCloseTo(0, 5);
    expect(pointOnPath(p, 1).x).toBeCloseTo(20, 5);
    const mid = pointOnPath(p, 0.5);
    expect(Number.isFinite(mid.x)).toBe(true);
  });

  it('quadratic and cubic curves start and end correctly', () => {
    const q = createPath({ kind: 'quadratic', from: { x: 0, y: 0 }, control: { x: 5, y: 20 }, to: { x: 10, y: 0 } });
    expect(pointOnPath(q, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnPath(q, 1)).toEqual({ x: 10, y: 0 });
    expect(pointOnPath(q, 0.5).y).toBeCloseTo(10, 6);

    const c = createPath({ kind: 'cubic', from: { x: 0, y: 0 }, c1: { x: 0, y: 10 }, c2: { x: 10, y: 10 }, to: { x: 10, y: 0 } });
    expect(pointOnPath(c, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnPath(c, 1)).toEqual({ x: 10, y: 0 });
    expect(pointOnPath(c, 0.5).y).toBeGreaterThan(0);
  });

  it('arc stays on the circle', () => {
    const p = createPath({ kind: 'arc', cx: 5, cy: 5, radius: 3, startAngle: 0, sweep: Math.PI });
    for (let i = 0; i <= 10; i++) {
      const pt = pointOnPath(p, i / 10);
      expect(Math.hypot(pt.x - 5, pt.y - 5)).toBeCloseTo(3, 6);
    }
  });

  it('spiral moves monotonically outward', () => {
    const p = createPath({ kind: 'spiral', cx: 0, cy: 0, r0: 1, r1: 9, turns: 2 });
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const pt = pointOnPath(p, i / 20);
      const r = Math.hypot(pt.x, pt.y);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
    expect(Math.hypot(...(Object.values(pointOnPath(p, 1)) as [number, number]))).toBeCloseTo(9, 6);
  });

  it('radial interpolates the radius', () => {
    const p = createPath({ kind: 'radial', cx: 0, cy: 0, angle: 0, r0: 2, r1: 8 });
    expect(pointOnPath(p, 0).x).toBeCloseTo(2, 6);
    expect(pointOnPath(p, 1).x).toBeCloseTo(8, 6);
    expect(pointOnPath(p, 0.5).x).toBeCloseTo(5, 6);
  });

  it('random walk is deterministic for a seed and differs across seeds', () => {
    const spec = { kind: 'randomWalk' as const, from: { x: 0, y: 0 }, step: 3, steps: 12, seed: 42 };
    const a = createPath(spec);
    const b = createPath(spec);
    const c = createPath({ ...spec, seed: 43 });
    for (let i = 0; i <= 12; i++) {
      const pa = pointOnPath(a, i / 12);
      const pb = pointOnPath(b, i / 12);
      expect(pa.x).toBeCloseTo(pb.x, 9);
      expect(pa.y).toBeCloseTo(pb.y, 9);
    }
    const ca = pointOnPath(c, 0.5);
    const aa = pointOnPath(a, 0.5);
    expect(ca.x !== aa.x || ca.y !== aa.y).toBe(true);
  });

  it('attractor converges on its target', () => {
    const p = createPath({ kind: 'attractor', from: { x: 50, y: 50 }, to: { x: 10, y: 10 }, turns: 1.5, pull: 3 });
    const start = pointOnPath(p, 0);
    const end = pointOnPath(p, 1);
    expect(Math.hypot(start.x - 50, start.y - 50)).toBeCloseTo(0, 6);
    expect(Math.hypot(end.x - 10, end.y - 10)).toBeLessThan(1);
    const mid = pointOnPath(p, 0.5);
    expect(Math.hypot(mid.x - 10, mid.y - 10)).toBeLessThan(Math.hypot(start.x - 10, start.y - 10));
  });

  it('repulsion moves away and decelerates', () => {
    const p = createPath({ kind: 'repulsion', from: { x: 10, y: 10 }, away: { x: 0, y: 10 }, distance: 20, seed: 3 });
    const start = pointOnPath(p, 0);
    const mid = pointOnPath(p, 0.5);
    const end = pointOnPath(p, 1);
    expect(start.x).toBeCloseTo(10, 6);
    expect(end.x - start.x).toBeGreaterThan(0);
    const firstHalf = Math.abs(mid.x - start.x);
    const secondHalf = Math.abs(end.x - mid.x);
    expect(firstHalf).toBeGreaterThan(secondHalf);
  });

  it('samples without allocating a new point when given one', () => {
    const p = createPath({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    const out = { x: 0, y: 0 };
    expect(p.sample(0.5, out)).toBe(out);
    expect(out.x).toBeCloseTo(0.5, 6);
  });

  it('handles degenerate inputs', () => {
    const empty = createPath({ kind: 'polyline', points: [] });
    expect(pointOnPath(empty, 0.5)).toEqual({ x: 0, y: 0 });
    const single = createPath({ kind: 'polyline', points: [{ x: 4, y: 5 }] });
    expect(pointOnPath(single, 0.5)).toEqual({ x: 4, y: 5 });
    const zeroLinear = createPath({ kind: 'linear', from: { x: 3, y: 3 }, to: { x: 3, y: 3 } });
    expect(zeroLinear.length).toBe(0);
    expect(pointOnPath(zeroLinear, 0.7)).toEqual({ x: 3, y: 3 });
  });
});

describe('Body', () => {
  it('integrates velocity over time', () => {
    const b = new Body({ x: 0, y: 0, vx: 100, vy: 0 });
    b.step(500);
    expect(b.x).toBeCloseTo(50, 6);
    expect(b.age).toBe(500);
  });

  it('applies spring force toward the target', () => {
    const b = new Body({ x: 0, y: 0, target: { x: 100, y: 0 } });
    b.step(16, 0, 4);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x).toBeGreaterThan(0);
  });

  it('damping reduces speed', () => {
    const b = new Body({ x: 0, y: 0, vx: 1000 });
    b.step(100, 5);
    expect(b.vx).toBeLessThan(1000);
  });

  it('dies at its lifetime', () => {
    const b = new Body({ lifetime: 100 });
    b.step(150);
    expect(b.alive).toBe(false);
  });

  it('follow places it on a path', () => {
    const b = new Body();
    const p = createPath({ kind: 'linear', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    b.follow(p, 0.5);
    expect(b.x).toBeCloseTo(5, 6);
    expect(b.distanceTo(5, 5)).toBeCloseTo(0, 6);
  });
});
