/**
 * Frame-time based animation primitives.
 *
 * Animations advance by **elapsed milliseconds**, never by "one step per
 * frame", so a dropped frame slows motion down instead of speeding it up.
 *
 * Three tiers are provided:
 * - {@link Tween}       scalar values — allocation free per frame
 * - {@link TweenVec}    fixed-size vectors backed by `Float32Array`
 * - {@link Animator}    the scheduler that owns every live tween
 *
 * Composition helpers ({@link Sequence}, {@link Parallel}, {@link stagger})
 * build pipelines without introducing a scene graph of their own.
 */

import { type EasingFn, type EasingName, getEasing } from './easing';

export interface TweenOptions<T> {
  from: T;
  to: T;
  /** Total playback time in milliseconds, excluding delay. */
  duration: number;
  /** Milliseconds to wait before the first update. */
  delay?: number;
  ease?: EasingName | EasingFn;
  /** Extra plays after the first one. `Infinity` repeats forever. */
  repeat?: number;
  /** Alternate direction on every repeat (a.k.a. yoyo). */
  pingPong?: boolean;
  /** Play the segment backwards on odd iterations. */
  reverse?: boolean;
  on?: {
    start?: () => void;
    update?: (value: T, progress: number) => void;
    repeat?: (iteration: number) => void;
    complete?: () => void;
  };
}

export type Interpolate<T> = (from: T, to: T, t: number) => T;

export const lerpNumber: Interpolate<number> = (from, to, t) => from + (to - from) * t;

export type TweenState = 'idle' | 'running' | 'finished' | 'cancelled';

/**
 * Any lifecycle a node can report. `'complete'` is used by scenes, which stay
 * alive after their children finish for the same reason a tween does.
 */
export type LifecycleStatus = TweenState | 'complete';

/** True when a node will never advance again. */
export function isTerminal(status: LifecycleStatus | undefined): boolean {
  return status === 'finished' || status === 'cancelled' || status === 'complete';
}

/** A single value animated over time. */
export class Tween<T> {
  readonly from: T;
  readonly to: T;
  readonly duration: number;
  /** Remaining milliseconds of initial hold. Public so composers can offset. */
  delay: number;
  readonly ease: EasingFn;
  readonly repeat: number;
  readonly pingPong: boolean;
  readonly reverse: boolean;
  private readonly interpolate: Interpolate<T>;
  private readonly onStart?: () => void;
  private readonly onUpdate?: (value: T, progress: number) => void;
  private readonly onRepeat?: (iteration: number) => void;
  private readonly onComplete?: () => void;

  private elapsed = 0;
  /** Index of the play currently in progress (0-based). */
  private iteration = 0;
  private state: LifecycleStatus = 'idle';
  private started = false;
  private value: T;
  /** Milliseconds not consumed by the last {@link update}. */
  private overflow = 0;

  constructor(options: TweenOptions<T>, interpolate: Interpolate<T> = lerpNumber as unknown as Interpolate<T>) {
    this.from = options.from;
    this.to = options.to;
    this.value = options.from;
    this.duration = Math.max(0, options.duration);
    this.delay = Math.max(0, options.delay ?? 0);
    this.ease = getEasing(options.ease);
    this.repeat = options.repeat ?? 0;
    this.pingPong = options.pingPong ?? false;
    this.reverse = options.reverse ?? false;
    this.interpolate = interpolate;
    this.onStart = options.on?.start;
    this.onUpdate = options.on?.update;
    this.onRepeat = options.on?.repeat;
    this.onComplete = options.on?.complete;
  }

  get status(): LifecycleStatus {
    return this.state;
  }

  /** Latest interpolated value (valid before, during and after playback). */
  get current(): T {
    return this.value;
  }

  /** 0..1 progress of the current iteration. */
  get progress(): number {
    if (this.duration === 0) return 1;
    const t = this.elapsed / this.duration;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  get done(): boolean {
    return this.state === 'finished' || this.state === 'cancelled';
  }

  /** Milliseconds the most recent {@link update} did not consume. */
  get leftover(): number {
    return this.overflow;
  }

  /**
   * Advance by `dt` milliseconds.
   *
   * Returns milliseconds that this tween did not consume so a {@link Sequence}
   * can hand them straight to the next child without losing a frame at the seam.
   */
  update(dt: number): number {
    this.overflow = 0;
    if (this.done) return Math.max(0, dt);
    if (this.state === 'idle') this.state = 'running';

    if (this.delay > 0) {
      if (dt < this.delay) {
        this.delay -= dt;
        return 0;
      }
      const leftover = dt - this.delay;
      this.delay = 0;
      this.begin();
      return this.advance(leftover);
    }

    this.begin();
    return this.advance(Math.max(0, dt));
  }

  private begin(): void {
    if (this.started) return;
    this.started = true;
    this.onStart?.();
  }

  private advance(dt: number): number {
    this.elapsed += dt;
    const duration = this.duration;

    if (duration === 0) {
      this.state = 'finished';
      this.applyTo(this.iteration, 1);
      this.onComplete?.();
      return 0;
    }

    while (this.elapsed >= duration) {
      const overflow = this.elapsed - duration;
      if (this.iteration >= this.repeat) {
        this.elapsed = duration;
        this.state = 'finished';
        this.applyTo(this.iteration, 1);
        this.overflow = overflow;
        this.onComplete?.();
        return overflow;
      }
      this.iteration++;
      this.onRepeat?.(this.iteration);
      this.elapsed = overflow;
    }

    this.applyTo(this.iteration, this.progress);
    return 0;
  }

  private applyTo(play: number, normalized: number): void {
    const eased = this.ease(this.direction(play, normalized));
    this.value = this.interpolate(this.from, this.to, eased);
    this.onUpdate?.(this.value, normalized);
  }

  private direction(play: number, normalized: number): number {
    const backward = this.pingPong ? play % 2 === 1 : false;
    const reversed = this.reverse !== backward;
    return reversed ? 1 - normalized : normalized;
  }

  /** Jump to an absolute elapsed time within the current play. */
  seek(ms: number): T {
    this.elapsed = Math.max(0, Math.min(this.duration, ms));
    this.applyTo(this.iteration, this.progress);
    return this.value;
  }

  /** Restart from the beginning, keeping the tween live. */
  reset(): void {
    this.elapsed = 0;
    this.iteration = 0;
    this.state = 'idle';
    this.started = false;
    this.overflow = 0;
    this.value = this.from;
  }

  cancel(): void {
    if (this.done) return;
    this.state = 'cancelled';
  }

  /** Snap to the end state and fire `onComplete` exactly once. */
  finish(): void {
    if (this.done) return;
    this.elapsed = this.duration;
    this.state = 'finished';
    this.applyTo(this.iteration, 1);
    this.onComplete?.();
  }
}

/** Tween over a fixed-length float vector without allocating per frame. */
export class TweenVec extends Tween<Float32Array> {
  private readonly buffer: Float32Array;

  constructor(options: TweenOptions<Float32Array>, out?: Float32Array) {
    const buffer = out ?? new Float32Array(options.from.length);
    super(
      options,
      (from, to, t) => {
        for (let i = 0; i < from.length; i++) buffer[i] = from[i] + (to[i] - from[i]) * t;
        return buffer;
      },
    );
    this.buffer = buffer;
  }

  /** The reusable output buffer (stable reference). */
  get values(): Float32Array {
    return this.buffer;
  }
}

/** Animate a scalar. */
export function tween(
  from: number,
  to: number,
  duration: number,
  options: Omit<TweenOptions<number>, 'from' | 'to' | 'duration'> = {},
): Tween<number> {
  return new Tween({ from, to, duration, ...options });
}

export interface CompositeOptions {
  /** Delay before the first child starts. */
  delay?: number;
  on?: { start?: () => void; complete?: () => void };
}

/**
 * Something the {@link Animator} can drive.
 *
 * `update` returns the milliseconds it did **not** consume so sequences can
 * hand the remainder straight to the next child without losing a frame.
 */
export interface Updatable {
  update(dt: number): number;
  cancel?(): void;
  readonly status?: LifecycleStatus;
  /** 0..1 completion, when the implementation exposes one. */
  readonly progress?: number;
}

/** Run children one after another, propagating unused time across seams. */
export class Sequence implements Updatable {
  private index = 0;
  private state: LifecycleStatus = 'idle';
  readonly items: Updatable[];

  constructor(items: Updatable[], private readonly options: CompositeOptions = {}) {
    this.items = items;
  }

  get status(): LifecycleStatus {
    return this.state;
  }

  get progress(): number {
    if (this.items.length === 0) return 1;
    return (this.index + (this.items[this.index]?.progress ?? 0)) / this.items.length;
  }

  update(dt: number): number {
    if (this.state === 'finished' || this.state === 'cancelled') return Math.max(0, dt);
    if (this.state === 'idle') {
      this.state = 'running';
      this.options.on?.start?.();
    }
    let remaining = Math.max(0, dt);
    if (this.options.delay && this.options.delay > 0) {
      const consumed = Math.min(this.options.delay, remaining);
      this.options.delay -= consumed;
      remaining -= consumed;
      if (remaining <= 0) return 0;
    }

    while (this.index < this.items.length) {
      remaining = this.items[this.index].update(remaining);
      const status = this.items[this.index].status;
      if (isTerminal(status)) {
        this.index++;
        continue;
      }
      return remaining;
    }
    this.state = 'finished';
    this.options.on?.complete?.();
    return remaining;
  }

  cancel(): void {
    this.state = 'cancelled';
    for (const item of this.items) item.cancel?.();
  }
}

/** Run children simultaneously; completes when the last one completes. */
export class Parallel implements Updatable {
  private state: LifecycleStatus = 'idle';
  readonly items: Updatable[];

  constructor(items: Updatable[], private readonly options: CompositeOptions = {}) {
    this.items = items;
  }

  get status(): LifecycleStatus {
    return this.state;
  }

  get progress(): number {
    if (this.items.length === 0) return 1;
    let sum = 0;
    for (const item of this.items) sum += item.progress ?? 0;
    return sum / this.items.length;
  }

  update(dt: number): number {
    if (this.state === 'finished' || this.state === 'cancelled') return Math.max(0, dt);
    if (this.state === 'idle') {
      this.state = 'running';
      this.options.on?.start?.();
    }
    let remaining = Math.max(0, dt);
    if (this.options.delay && this.options.delay > 0) {
      const consumed = Math.min(this.options.delay, remaining);
      this.options.delay -= consumed;
      remaining -= consumed;
      if (remaining <= 0) return 0;
    }
    let allDone = true;
    let minLeftover = remaining;
    for (const item of this.items) {
      const left = item.update(remaining);
      if (left < minLeftover) minLeftover = left;
      if (!isTerminal(item.status)) allDone = false;
    }
    if (allDone) {
      this.state = 'finished';
      this.options.on?.complete?.();
    }
    return minLeftover;
  }

  cancel(): void {
    this.state = 'cancelled';
    for (const item of this.items) item.cancel?.();
  }
}

/**
 * Start `count` copies of `factory`, offsetting child `i` by `i * step` ms.
 * The offset is applied through {@link Tween.delay}, so no wrapper objects are
 * needed and the children stay directly cancellable.
 */
export function stagger<T>(count: number, step: number, factory: (index: number) => Tween<T>): Parallel {
  const items: Updatable[] = [];
  for (let i = 0; i < count; i++) {
    const child = factory(i);
    if (step > 0 && i > 0) child.delay = Math.max(child.delay, i * step);
    items.push(child);
  }
  return new Parallel(items);
}

/**
 * Scheduler owning every live animation.
 *
 * A single `tick(dt)` per frame advances all children; finished entries are
 * compacted out of the backing array in place — no per-frame allocation.
 */
export class Animator {
  private items: Updatable[] = [];
  private time = 0;

  /** Total milliseconds fed into {@link tick}. */
  get elapsed(): number {
    return this.time;
  }

  get count(): number {
    return this.items.length;
  }

  add(item: Updatable): Updatable {
    this.items.push(item);
    return item;
  }

  remove(item: Updatable): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Advance every animation by `dt` ms; returns how many are still live. */
  tick(dt: number): number {
    this.time += dt;
    let live = 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      item.update(dt);
      if (isTerminal(item.status)) continue;
      this.items[live++] = item;
    }
    this.items.length = live;
    return live;
  }

  cancelAll(): void {
    for (const item of this.items) item.cancel?.();
    this.items.length = 0;
  }

  clear(): void {
    this.items.length = 0;
  }
}
