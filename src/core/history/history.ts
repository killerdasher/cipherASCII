/**
 * Undo/redo history over immutable snapshots.
 *
 * Documents are structurally shared (see `src/core/grid.ts`), so storing
 * snapshots is cheap: unchanged layers and grids are referenced, not copied.
 * Undo/redo therefore never mutates data — it swaps references.
 *
 * Coalescing keeps typing responsive: consecutive pushes that share a key and
 * happen inside the window collapse into one undo step (the first keystroke
 * records the pre-typing state, later ones replace the present value).
 */

export interface HistoryOptions {
  /** Maximum number of undo steps kept (oldest dropped first). Default 200. */
  limit?: number;
  /** Coalescing window in milliseconds. Default 800. */
  coalesceWindowMs?: number;
}

export interface PushOptions {
  /** Pushes sharing a key inside the window collapse into one undo step. */
  key?: string;
  /** Injectable clock (ms) for deterministic tests. */
  now?: number;
}

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private present: T;
  private lastKey: string | null = null;
  private lastAt = 0;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(initial: T, options: HistoryOptions = {}) {
    this.present = initial;
    this.limit = Math.max(1, options.limit ?? 200);
    this.windowMs = Math.max(0, options.coalesceWindowMs ?? 800);
  }

  get value(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Number of undo steps currently stored. */
  get undoDepth(): number {
    return this.past.length;
  }

  /** Number of redo steps currently stored. */
  get redoDepth(): number {
    return this.future.length;
  }

  /**
   * Record a new state.
   *
   * When `key` matches the previous push and the timestamp is inside the
   * coalescing window, the present value is replaced without adding an undo
   * step; otherwise the old present is pushed onto the undo stack and the
   * redo stack is cleared.
   */
  push(next: T, options: PushOptions = {}): void {
    const now = options.now ?? Date.now();
    const key = options.key ?? null;
    const coalesce =
      key !== null &&
      key === this.lastKey &&
      this.past.length > 0 &&
      now - this.lastAt <= this.windowMs;

    if (coalesce) {
      this.present = next;
      this.lastAt = now;
      return;
    }

    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    this.lastKey = key;
    this.lastAt = now;
  }

  /** Step back one state; returns null when there is nothing to undo. */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    this.lastKey = null;
    return this.present;
  }

  /** Step forward one state; returns null when there is nothing to redo. */
  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    this.lastKey = null;
    return this.present;
  }

  /** Drop all history; optionally replace the present value. */
  clear(present?: T): void {
    this.past = [];
    this.future = [];
    if (present !== undefined) this.present = present;
    this.lastKey = null;
    this.lastAt = 0;
  }
}
