import { describe, expect, it, vi } from 'vitest';
import { Animator, Parallel, Sequence, TweenVec, lerpNumber, stagger, tween } from '../../src/core/animation/tween';

describe('Tween', () => {
  it('advances by elapsed time, not by frame count', () => {
    const a = tween(0, 100, 1000);
    a.update(250);
    expect(a.current).toBeCloseTo(25, 6);
    a.update(750);
    expect(a.current).toBeCloseTo(100, 6);
    expect(a.status).toBe('finished');
  });

  it('produces identical results for slow and fast frame rates', () => {
    const slow = tween(0, 10, 1000, { ease: 'easeInOutCubic' });
    const fast = tween(0, 10, 1000, { ease: 'easeInOutCubic' });
    for (let i = 0; i < 10; i++) slow.update(100);
    for (let i = 0; i < 100; i++) fast.update(10);
    expect(slow.current).toBeCloseTo(fast.current, 6);
    expect(slow.current).toBeCloseTo(10, 6);
  });

  it('applies delay before starting', () => {
    const onUpdate = vi.fn();
    const a = tween(0, 1, 100, { delay: 50, on: { update: onUpdate } });
    a.update(40);
    expect(a.status).toBe('running');
    expect(onUpdate).not.toHaveBeenCalled();
    a.update(20);
    expect(onUpdate).toHaveBeenCalled();
    expect(a.current).toBeGreaterThan(0);
  });

  it('honours easing', () => {
    const linear = tween(0, 1, 100);
    const quad = tween(0, 1, 100, { ease: 'easeInQuad' });
    linear.update(50);
    quad.update(50);
    expect(linear.current).toBeCloseTo(0.5, 6);
    expect(quad.current).toBeCloseTo(0.25, 6);
  });

  it('repeats and fires onRepeat/onComplete exactly once', () => {
    const onRepeat = vi.fn();
    const onComplete = vi.fn();
    const a = tween(0, 1, 100, { repeat: 2, on: { repeat: onRepeat, complete: onComplete } });
    for (let i = 0; i < 40; i++) a.update(10);
    expect(onRepeat).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('finished');
  });

  it('ping-pong plays backwards on odd iterations', () => {
    const seen: number[] = [];
    const a = tween(0, 100, 100, { repeat: 1, pingPong: true, on: { update: (v) => seen.push(v) } });
    a.update(100);
    expect(a.current).toBeCloseTo(100, 6);
    a.update(100);
    expect(a.current).toBeCloseTo(0, 6);
    expect(a.status).toBe('finished');
    expect(seen.length).toBeGreaterThan(1);
  });

  it('reverse plays the whole segment backwards', () => {
    const a = tween(0, 100, 100, { reverse: true });
    a.update(50);
    expect(a.current).toBeCloseTo(50, 6);
    a.update(50);
    expect(a.current).toBeCloseTo(0, 6);
  });

  it('reports leftover time when it finishes early', () => {
    const a = tween(0, 1, 100);
    const left = a.update(150);
    expect(left).toBeCloseTo(50, 6);
    expect(a.status).toBe('finished');
  });

  it('cancel and finish are terminal and idempotent', () => {
    const onComplete = vi.fn();
    const a = tween(0, 1, 100, { on: { complete: onComplete } });
    a.cancel();
    a.update(200);
    expect(a.status).toBe('cancelled');
    expect(a.current).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();

    const b = tween(0, 1, 100, { on: { complete: onComplete } });
    b.finish();
    b.finish();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(b.current).toBe(1);
  });

  it('reset restarts playback', () => {
    const a = tween(0, 1, 100);
    a.update(100);
    expect(a.status).toBe('finished');
    a.reset();
    expect(a.status).toBe('idle');
    a.update(50);
    expect(a.current).toBeCloseTo(0.5, 6);
  });

  it('seek jumps within the segment', () => {
    const a = tween(0, 100, 1000);
    a.seek(250);
    expect(a.current).toBeCloseTo(25, 6);
    a.seek(9999);
    expect(a.current).toBeCloseTo(100, 6);
  });

  it('zero duration completes on first update', () => {
    const onComplete = vi.fn();
    const a = tween(5, 9, 0, { on: { complete: onComplete } });
    a.update(16);
    expect(a.status).toBe('finished');
    expect(a.current).toBe(9);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('TweenVec', () => {
  it('interpolates every component into a reusable buffer', () => {
    const from = new Float32Array([0, 10, 20]);
    const to = new Float32Array([100, 20, 40]);
    const a = new TweenVec({ from, to, duration: 100 });
    a.update(50);
    expect(Array.from(a.values)).toEqual([50, 15, 30]);
    const first = a.values;
    a.update(50);
    expect(a.values).toBe(first);
  });
});

describe('Sequence', () => {
  it('runs children back to back without losing time at the seam', () => {
    const order: string[] = [];
    const seq = new Sequence([
      tween(0, 1, 100, { on: { complete: () => order.push('a') } }),
      tween(0, 1, 100, { on: { complete: () => order.push('b') } }),
    ]);
    seq.update(150);
    expect(order).toEqual(['a']);
    expect(seq.status).toBe('running');
    seq.update(100);
    expect(order).toEqual(['a', 'b']);
    expect(seq.status).toBe('finished');
  });

  it('completes exactly at total duration', () => {
    let done = false;
    const seq = new Sequence([tween(0, 1, 100), tween(0, 1, 100)], { on: { complete: () => (done = true) } });
    seq.update(200);
    expect(done).toBe(true);
    expect(seq.progress).toBe(1);
  });

  it('cancels all children', () => {
    const seq = new Sequence([tween(0, 1, 100), tween(0, 1, 100)]);
    seq.cancel();
    expect(seq.status).toBe('cancelled');
    seq.update(100);
    expect(seq.status).toBe('cancelled');
  });
});

describe('Parallel', () => {
  it('waits for the longest child', () => {
    let done = false;
    const par = new Parallel([tween(0, 1, 50), tween(0, 1, 200)], { on: { complete: () => (done = true) } });
    par.update(100);
    expect(done).toBe(false);
    par.update(150);
    expect(done).toBe(true);
    expect(par.status).toBe('finished');
  });

  it('reports average progress', () => {
    const par = new Parallel([tween(0, 1, 100), tween(0, 1, 100)]);
    par.update(50);
    expect(par.progress).toBeCloseTo(0.5, 6);
  });
});

describe('stagger', () => {
  it('offsets each child by the step', () => {
    const par = stagger(3, 50, (i) => tween(i, i + 1, 100));
    par.update(0);
    expect(par.items[0]['status']).toBe('running');
    expect((par.items[1] as unknown as { delay: number }).delay).toBeGreaterThan(0);
  });
});

describe('Animator', () => {
  it('ticks children and compacts finished ones', () => {
    const anim = new Animator();
    const a = tween(0, 1, 100);
    const b = tween(0, 1, 1000);
    anim.add(a);
    anim.add(b);
    expect(anim.count).toBe(2);
    anim.tick(150);
    expect(anim.count).toBe(1);
    expect(b.current).toBeCloseTo(0.15, 6);
    anim.tick(1000);
    expect(anim.count).toBe(0);
  });

  it('accumulates elapsed time', () => {
    const anim = new Animator();
    anim.tick(16);
    anim.tick(16);
    expect(anim.elapsed).toBe(32);
  });

  it('cancelAll terminates everything', () => {
    const anim = new Animator();
    const a = tween(0, 1, 100);
    anim.add(a);
    anim.cancelAll();
    expect(anim.count).toBe(0);
    expect(a.status).toBe('cancelled');
  });

  it('remove detaches a single animation', () => {
    const anim = new Animator();
    const a = tween(0, 1, 100);
    const b = tween(0, 1, 100);
    anim.add(a);
    anim.add(b);
    anim.remove(a);
    expect(anim.count).toBe(1);
  });
});

describe('interpolation', () => {
  it('lerpNumber handles endpoints and extrapolation-free range', () => {
    expect(lerpNumber(2, 8, 0)).toBe(2);
    expect(lerpNumber(2, 8, 1)).toBe(8);
    expect(lerpNumber(2, 8, 0.5)).toBe(5);
  });
});
