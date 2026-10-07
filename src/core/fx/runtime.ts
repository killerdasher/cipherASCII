/**
 * Live cell-effect runtime.
 *
 * Wraps {@link CellEffectPipeline} behind the one shape the editor needs:
 * *document grid in, animated grid out*. It owns the working {@link Plane},
 * decides when the source snapshot must be recaptured (the document changed,
 * not the effect), rebinds when the canvas resizes, and reuses its output grid
 * so a 60 fps preview allocates nothing after the first frame.
 *
 * The runtime is deliberately *not* in the Zustand store: it is mutable
 * machinery, while the store keeps only serialisable {@link CellEffectEntry}
 * values that round-trip through the project file.
 */

import type { AsciiGrid } from '../types';
import { Plane } from '../canvas/plane';
import { CELL_EFFECT_MAP } from './registry';
import { CellEffectPipeline, type CellEffectEntry } from './pipeline';
import { gridToPlane, planeToGrid } from './bridge';

export class CellFxRuntime {
  private readonly plane = new Plane(1, 1);
  private readonly pipeline = new CellEffectPipeline();
  private entries: readonly CellEffectEntry[] = [];
  private seed = 0;
  private sourceGrid: AsciiGrid | null = null;
  private out: AsciiGrid | null = null;
  private pending = true;
  private loop = false;

  /**
   * Replay finished one-shots instead of going idle (editor preview mode).
   *
   * Off by default so callers that want a *baked* end state — the demo, the
   * goldens, an exporter — keep the settle-once semantics. The editor turns it
   * on so an effect stays on screen instead of flashing once and vanishing.
   */
  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  /** Paper colour behind the grid; forwarded to every effect's context. */
  setPaper(color: number): void {
    this.pipeline.setPaper(color);
  }

  /**
   * Adopt the store's current entry list and seed.
   *
   * Cheap by design — both are compared by identity/value, so calling it every
   * frame while nothing changed does no work.
   */
  sync(entries: readonly CellEffectEntry[], seed: number): void {
    if (seed !== this.seed) {
      this.seed = seed;
      this.pipeline.setSeed(seed);
      this.pipeline.resetClocks();
      this.pending = true;
    }
    if (entries !== this.entries) {
      this.entries = entries;
      this.pending = true;
    }
  }

  /**
   * Advance the effects by `dt` milliseconds and return the grid to paint.
   *
   * Returns `null` when there is nothing to draw (no entries, or every
   * one-shot has settled while looping is off) — callers use that to skip the
   * repaint and to stop their animation loop.
   */
  frame(grid: AsciiGrid, dt: number): AsciiGrid | null {
    if (this.plane.width !== grid.width || this.plane.height !== grid.height) {
      this.plane.resize(grid.width, grid.height);
      this.pending = true;
      this.sourceGrid = null;
    }
    if (grid !== this.sourceGrid) {
      gridToPlane(this.plane, grid);
      this.pipeline.setSource(this.plane);
      this.sourceGrid = grid;
      this.out = null;
    }
    if (this.pending) {
      this.pipeline.setEntries(this.entries, CELL_EFFECT_MAP, this.plane);
      this.pending = false;
    }
    if (this.entries.length === 0) return null;
    if (!this.pipeline.needsFrames) {
      if (!this.loop) return null;
      // Everything settled: replay the stack from t=0 so the effect keeps
      // playing (deterministic — resetClocks also rewinds the RNG).
      this.pipeline.resetClocks();
    }
    this.pipeline.apply(this.plane, dt);
    this.out = planeToGrid(this.plane, this.out);
    return this.out;
  }

  /** True while the runtime can still change pixels on the next frame. */
  get needsFrames(): boolean {
    return this.entries.length > 0 && (this.pipeline.needsFrames || this.loop);
  }

  /** Drop all entries and forget the source; used when a document closes. */
  reset(): void {
    this.entries = [];
    this.pending = true;
    this.sourceGrid = null;
    this.out = null;
    this.seed = 0;
    this.pipeline.setSeed(0);
    this.pipeline.resetClocks();
  }
}

/** Process-wide runtime used by the editor canvas. */
export const cellFxRuntime = new CellFxRuntime();
