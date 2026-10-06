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
   * one-shot has settled) — callers use that to skip the repaint and to stop
   * their animation loop.
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
    if (!this.pipeline.needsFrames) return null;
    this.pipeline.apply(this.plane, dt);
    this.out = planeToGrid(this.plane, this.out);
    return this.out;
  }

  /** True while at least one bound entry can still change the plane. */
  get needsFrames(): boolean {
    return this.entries.length > 0 && this.pipeline.needsFrames;
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
