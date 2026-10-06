/**
 * Scene system.
 *
 * A scene is a bag of {@link Updatable} nodes with absolute start times, plus
 * named triggers for anything that must start on demand (a user click, a
 * render finishing, an error). Scenes never render by themselves — they only
 * advance animation state, which the compositor later reads.
 *
 * The {@link SceneDirector} owns scene lifetime and can play an optional
 * transition scene between two scenes, which is what makes "intro → interface"
 * feel authored instead of abrupt.
 */

import { type TweenState, type Updatable, isTerminal } from '../animation/tween';

export type SceneStatus = 'idle' | 'running' | 'complete' | 'cancelled';

export interface SceneOptions {
  /** Loop back to the beginning when every child has finished. */
  loop?: boolean;
  /** Milliseconds held open after all children finish before completing. */
  tailHold?: number;
  on?: {
    start?: () => void;
    complete?: () => void;
    cancel?: () => void;
    /** Fired the first time a trigger name is used. */
    event?: (name: string) => void;
  };
}

interface Child {
  node: Updatable;
  startAt: number;
  lastElapsed: number;
  started: boolean;
  trigger: string | null;
}

/** A pure time pause usable as a scene child. */
export class Delay implements Updatable {
  private elapsed = 0;
  private state: TweenState = 'idle';

  constructor(private readonly duration: number) {}

  get status(): TweenState {
    return this.state;
  }

  get progress(): number {
    return this.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.duration);
  }

  update(dt: number): number {
    if (isTerminal(this.state)) return Math.max(0, dt);
    if (this.state === 'idle') this.state = 'running';
    if (this.duration <= 0) {
      this.state = 'finished';
      return Math.max(0, dt);
    }
    this.elapsed += dt;
    if (this.elapsed >= this.duration) {
      const leftover = this.elapsed - this.duration;
      this.elapsed = this.duration;
      this.state = 'finished';
      return leftover;
    }
    return 0;
  }

  cancel(): void {
    this.state = 'cancelled';
  }

  reset(): void {
    this.elapsed = 0;
    this.state = 'idle';
  }
}

export class Scene implements Updatable {
  readonly id: string;
  private readonly children: Child[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly fired = new Set<string>();
  private elapsed = 0;
  private tail = 0;
  private state: SceneStatus = 'idle';
  private readonly options: SceneOptions;
  /**
   * Time cursor for the next {@link add}. `add` places its node at the cursor,
   * `wait` advances it — so a scene reads top-to-bottom as a script.
   */
  private cursor = 0;

  constructor(id: string, options: SceneOptions = {}) {
    this.id = id;
    this.options = options;
  }

  get status(): SceneStatus {
    return this.state;
  }

  get progress(): number {
    if (this.children.length === 0) return 1;
    let sum = 0;
    for (const child of this.children) sum += child.started ? (child.node.progress ?? 0) : 0;
    return sum / this.children.length;
  }

  get time(): number {
    return this.elapsed;
  }

  get childCount(): number {
    return this.children.length;
  }

  /** Append a node starting at the cursor (+ optional extra `delayMs`). */
  add(node: Updatable, delayMs = 0): this {
    const startAt = Math.max(0, this.cursor + delayMs);
    this.cursor = startAt;
    this.children.push({ node, startAt, lastElapsed: 0, started: false, trigger: null });
    return this;
  }

  /** Append a node that only starts when {@link trigger} fires with `name`. */
  onTrigger(name: string, node: Updatable): this {
    this.children.push({ node, startAt: 0, lastElapsed: 0, started: false, trigger: name });
    return this;
  }

  /** Advance the cursor so the next {@link add} starts `ms` later. */
  wait(ms: number): this {
    this.cursor += Math.max(0, ms);
    return this;
  }

  /** Append an explicit timed pause (occupies a child slot). */
  pause(ms: number): this {
    return this.add(new Delay(ms));
  }

  /** Register a callback fired when `name` is triggered (once per firing). */
  subscribe(name: string, handler: () => void): this {
    const list = this.listeners.get(name);
    if (list) list.push(handler);
    else this.listeners.set(name, [handler]);
    return this;
  }

  /** Start every node registered under `name`. */
  trigger(name: string): void {
    this.fired.add(name);
    let any = false;
    for (const child of this.children) {
      if (child.trigger === name && !child.started) {
        child.startAt = this.elapsed;
        child.lastElapsed = 0;
        any = true;
      }
    }
    const handlers = this.listeners.get(name);
    if (handlers) {
      for (const handler of handlers) handler();
    }
    if (any && this.state === 'idle') this.state = 'running';
  }

  hasTrigger(name: string): boolean {
    return this.children.some((c) => c.trigger === name);
  }

  update(dt: number): number {
    if (this.state === 'complete') return Math.max(0, dt);
    if (this.state === 'cancelled') return Math.max(0, dt);
    if (this.state === 'idle') {
      this.state = 'running';
      this.options.on?.start?.();
    }
    this.elapsed += dt;

    const remaining = Math.max(0, dt);
    let allDone = true;
    let minLeftover = remaining;

    for (const child of this.children) {
      if (child.trigger !== null && !child.started && !this.fired.has(child.trigger)) {
        allDone = false;
        continue;
      }
      // Not due yet: never touch the node, so a delayed child cannot fire its
      // callbacks early just because the frame clock passed through.
      if (this.elapsed < child.startAt) {
        allDone = false;
        continue;
      }
      const childElapsed = this.elapsed - child.startAt;
      const delta = childElapsed - child.lastElapsed;
      const left = child.node.update(delta);
      child.lastElapsed = childElapsed;
      child.started = true;
      if (left < minLeftover) minLeftover = left;
      if (!isTerminal(child.node.status)) allDone = false;
    }

    if (allDone) {
      const tail = this.options.tailHold ?? 0;
      if (tail > 0) {
        this.tail += dt;
        if (this.tail < tail) return minLeftover;
      }
      if (this.options.loop) {
        this.rewind();
        return minLeftover;
      }
      this.state = 'complete';
      this.options.on?.complete?.();
    }
    return minLeftover;
  }

  private rewind(): void {
    this.elapsed = 0;
    this.tail = 0;
    this.cursor = 0;
    this.fired.clear();
    for (const child of this.children) {
      child.started = false;
      child.lastElapsed = 0;
      const resettable = child.node as { reset?: () => void };
      if (typeof resettable.reset === 'function') resettable.reset();
    }
  }

  cancel(): void {
    if (this.state === 'cancelled' || this.state === 'complete') return;
    this.state = 'cancelled';
    for (const child of this.children) child.node.cancel?.();
    this.options.on?.cancel?.();
  }

  /** Rewind every child so the scene can play again from the top. */
  restart(): void {
    this.rewind();
    this.state = 'idle';
  }

  reset(): void {
    this.restart();
  }
}

export interface DirectorOptions {
  /** Scene played while the next scene prepares (crossfade/transition). */
  transition?: () => Scene | null;
  onSceneChange?: (id: string) => void;
}

/**
 * Owns the active scene and drives it once per frame.
 *
 * Scenes are cached by id after their first construction so a director can
 * replay "startup" without rebuilding its nodes.
 */
export class SceneDirector {
  private readonly scenes = new Map<string, Scene>();
  private readonly factories = new Map<string, () => Scene>();
  private active: Scene | null = null;
  private pending: Scene | null = null;

  constructor(private readonly options: DirectorOptions = {}) {}

  get current(): Scene | null {
    return this.active;
  }

  get currentId(): string | null {
    return this.active?.id ?? null;
  }

  /** Register (or replace) the factory used to build `id` on demand. */
  define(id: string, factory: () => Scene): void {
    this.factories.set(id, factory);
    this.scenes.delete(id);
  }

  /** Build a scene now and cache it. */
  add(scene: Scene): Scene {
    this.scenes.set(scene.id, scene);
    return scene;
  }

  has(id: string): boolean {
    return this.scenes.has(id) || this.factories.has(id);
  }

  /**
   * Switch to scene `id`, optionally playing the director's transition scene
   * first. Cancels the outgoing scene immediately so input is never blocked.
   */
  play(id: string, options: { transition?: boolean } = {}): Scene {
    const next = this.resolve(id);
    if (this.active && this.active.id === id && this.active.status !== 'complete') {
      this.active.restart();
      return this.active;
    }
    if (this.active) this.active.cancel();

    if (options.transition && this.options.transition) {
      const bridge = this.options.transition();
      if (bridge) {
        this.pending = next;
        this.active = bridge;
        this.options.onSceneChange?.(bridge.id);
        return bridge;
      }
    }
    this.active = next;
    next.restart();
    this.options.onSceneChange?.(id);
    return next;
  }

  private resolve(id: string): Scene {
    const cached = this.scenes.get(id);
    if (cached) return cached;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown scene: '${id}'`);
    const scene = factory();
    this.scenes.set(id, scene);
    return scene;
  }

  /** Advance the active scene (and any pending transition handover). */
  update(dt: number): void {
    const scene = this.active;
    if (!scene) return;
    scene.update(dt);
    if (scene.status === 'complete' && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.active = next;
      next.restart();
      this.options.onSceneChange?.(next.id);
    }
  }

  cancel(): void {
    this.active?.cancel();
    this.pending = null;
  }
}
