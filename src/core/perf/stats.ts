/**
 * Frame statistics surfaced by the debug overlay (Ctrl+K -> "debug overlay").
 *
 * Kept separate from the controller state so the store can hold a plain,
 * serialisable snapshot without pulling the adaptive internals into React.
 */

export interface PerfStats {
  /** Smoothed frames per second (0 before the first sample). */
  readonly fps: number;
  /** Smoothed frame time in ms. */
  readonly frameMs: number;
  /** Adaptive level in use, 0..3 (only meaningful in `auto` mode). */
  readonly level: number;
  /** Cell-effect update rate of the budget in force, in Hz. */
  readonly effectHz: number;
  /** Cell effects currently stacked (0 = the loop is not running). */
  readonly effects: number;
  /** Last worker render duration, ms (null if nothing rendered yet). */
  readonly renderMs: number | null;
  /** Cells produced by that render (null if nothing rendered yet). */
  readonly renderCells: number | null;
  /** Render generation - increments each time a render is queued. */
  readonly generation: number;
  /** Composed grid dimensions in cells. */
  readonly gridWidth: number;
  readonly gridHeight: number;
}
