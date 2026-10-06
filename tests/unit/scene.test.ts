import { describe, expect, it, vi } from 'vitest';
import { Animator, tween } from '../../src/core/animation/tween';
import { Delay, Scene, SceneDirector } from '../../src/core/scene/scene';

describe('Delay', () => {
  it('holds for its duration then finishes with leftover', () => {
    const d = new Delay(100);
    expect(d.update(60)).toBe(0);
    expect(d.status).toBe('running');
    const left = d.update(60);
    expect(left).toBeCloseTo(20, 6);
    expect(d.status).toBe('finished');
    expect(d.progress).toBe(1);
  });

  it('zero delay finishes immediately', () => {
    const d = new Delay(0);
    d.update(16);
    expect(d.status).toBe('finished');
  });

  it('cancels', () => {
    const d = new Delay(100);
    d.cancel();
    d.update(200);
    expect(d.status).toBe('cancelled');
  });
});

describe('Scene', () => {
  it('starts children after their absolute delay', () => {
    const a = vi.fn();
    const b = vi.fn();
    const scene = new Scene('s');
    scene.add(tween(0, 1, 50, { on: { update: a } }));
    scene.add(tween(0, 1, 50, { on: { update: b } }), 100);

    scene.update(60);
    expect(a).toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();

    scene.update(60);
    expect(b).toHaveBeenCalled();
  });

  it('completes when every child finishes', () => {
    const on = { complete: vi.fn() };
    const scene = new Scene('s', { on });
    scene.add(tween(0, 1, 50));
    scene.add(tween(0, 1, 80));
    scene.update(40);
    expect(scene.status).toBe('running');
    expect(on.complete).not.toHaveBeenCalled();
    scene.update(60);
    expect(scene.status).toBe('complete');
    expect(on.complete).toHaveBeenCalledTimes(1);
    // Terminal: further updates are no-ops.
    scene.update(1000);
    expect(on.complete).toHaveBeenCalledTimes(1);
  });

  it('holds open for tailHold before completing', () => {
    const scene = new Scene('s', { tailHold: 50 });
    scene.add(tween(0, 1, 20));
    scene.update(20);
    expect(scene.status).toBe('running');
    scene.update(40);
    expect(scene.status).toBe('complete');
  });

  it('waits insert pauses between children', () => {
    const fired: string[] = [];
    const scene = new Scene('s');
    scene.add(tween(0, 1, 50, { on: { complete: () => fired.push('first') } }));
    scene.wait(100);
    scene.add(tween(0, 1, 50, { on: { complete: () => fired.push('second') } }));
    scene.update(60);
    expect(fired).toEqual(['first']);
    scene.update(40);
    expect(fired).toEqual(['first']);
    scene.update(60);
    expect(fired).toEqual(['first', 'second']);
    expect(scene.status).toBe('complete');
  });

  it('trigger starts only the matching children', () => {
    const plain = vi.fn();
    const gated = vi.fn();
    const scene = new Scene('s');
    scene.add(tween(0, 1, 100, { on: { update: plain } }));
    scene.onTrigger('reveal', tween(0, 1, 100, { on: { update: gated } }));

    scene.update(50);
    expect(plain).toHaveBeenCalled();
    expect(gated).not.toHaveBeenCalled();

    scene.trigger('reveal');
    scene.update(50);
    expect(gated).toHaveBeenCalled();
    expect(scene.status).toBe('running');
  });

  it('scene stays open while a trigger has not fired', () => {
    const scene = new Scene('s');
    scene.onTrigger('later', tween(0, 1, 10));
    scene.update(1000);
    expect(scene.status).toBe('running');
    scene.trigger('later');
    scene.update(20);
    expect(scene.status).toBe('complete');
  });

  it('subscribe fires handlers on trigger', () => {
    const handler = vi.fn();
    const scene = new Scene('s');
    scene.onTrigger('go', tween(0, 1, 10));
    scene.subscribe('go', handler);
    scene.trigger('go');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(scene.hasTrigger('go')).toBe(true);
    expect(scene.hasTrigger('nope')).toBe(false);
  });

  it('cancel terminates the scene and its children', () => {
    const child = tween(0, 1, 100);
    const on = { cancel: vi.fn() };
    const scene = new Scene('s', { on });
    scene.add(child);
    scene.update(10);
    scene.cancel();
    expect(scene.status).toBe('cancelled');
    expect(child.status).toBe('cancelled');
    expect(on.cancel).toHaveBeenCalled();
    scene.update(100);
    expect(scene.status).toBe('cancelled');
  });

  it('loop rewinds instead of completing', () => {
    const scene = new Scene('s', { loop: true });
    scene.add(tween(0, 1, 50));
    for (let i = 0; i < 10; i++) scene.update(30);
    expect(scene.status).not.toBe('complete');
    expect(scene.time).toBeLessThan(100);
  });

  it('restart rewinds every child', () => {
    const scene = new Scene('s');
    const t = tween(0, 1, 50);
    scene.add(t);
    scene.update(60);
    expect(scene.status).toBe('complete');
    scene.restart();
    expect(scene.status).toBe('idle');
    expect(t.status).toBe('idle');
    scene.update(25);
    expect(t.current).toBeCloseTo(0.5, 6);
  });

  it('reports progress across children', () => {
    const scene = new Scene('s');
    scene.add(tween(0, 1, 100));
    scene.add(tween(0, 1, 100));
    scene.update(50);
    expect(scene.progress).toBeCloseTo(0.5, 6);
  });

  it('drives from the Animator like any other node', () => {
    const anim = new Animator();
    const scene = new Scene('s');
    scene.add(tween(0, 1, 50));
    anim.add(scene);
    anim.tick(60);
    expect(scene.status).toBe('complete');
    expect(anim.count).toBe(0);
  });
});

describe('SceneDirector', () => {
  it('builds scenes lazily from factories and caches them', () => {
    const factory = vi.fn(() => new Scene('intro'));
    const director = new SceneDirector();
    director.define('intro', factory);
    expect(director.has('intro')).toBe(true);
    director.play('intro');
    expect(factory).toHaveBeenCalledTimes(1);
    director.play('intro');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('cancels the outgoing scene when switching', () => {
    const director = new SceneDirector();
    const first = new Scene('a');
    const second = new Scene('b');
    first.add(tween(0, 1, 1000));
    director.add(first);
    director.add(second);
    director.play('a');
    director.update(16);
    expect(first.status).toBe('running');
    director.play('b');
    expect(first.status).toBe('cancelled');
    expect(director.currentId).toBe('b');
  });

  it('notifies on scene change', () => {
    const onSceneChange = vi.fn();
    const director = new SceneDirector({ onSceneChange });
    director.add(new Scene('a'));
    director.play('a');
    expect(onSceneChange).toHaveBeenCalledWith('a');
  });

  it('plays the transition scene before handing over to the pending one', () => {
    const changes: string[] = [];
    const director = new SceneDirector({
      transition: () => {
        const bridge = new Scene('transition');
        bridge.add(tween(0, 1, 50));
        return bridge;
      },
      onSceneChange: (id) => changes.push(id),
    });
    const target = new Scene('target');
    target.add(tween(0, 1, 50));
    director.add(target);

    director.play('target', { transition: true });
    expect(director.currentId).toBe('transition');
    director.update(60);
    expect(director.currentId).toBe('target');
    expect(changes).toEqual(['transition', 'target']);
  });

  it('throws for unknown scenes', () => {
    const director = new SceneDirector();
    expect(() => director.play('missing')).toThrow(/Unknown scene/);
  });

  it('replays the same scene from the start', () => {
    const director = new SceneDirector();
    const scene = new Scene('a');
    scene.add(tween(0, 1, 50));
    director.add(scene);
    director.play('a');
    director.update(60);
    expect(scene.status).toBe('complete');
    director.play('a');
    expect(scene.status).toBe('idle');
  });

  it('update is a no-op without an active scene', () => {
    const director = new SceneDirector();
    expect(() => director.update(16)).not.toThrow();
    director.cancel();
  });
});
