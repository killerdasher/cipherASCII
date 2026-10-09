/**
 * Unified export frame renderer — the ONE function every file format consumes.
 *
 * Policy (explicit, test-enforced in `tests/unit/exportFrame.test.ts`):
 *
 * - **Layers**: the full visible stack through `composeDocument` (the same
 *   compositor the editor preview uses), never just the active layer.
 * - **Timeline**: when the timeline has animation, the document is evaluated
 *   at the requested frame (`applyTimelineToDocument`); a timeline without
 *   keyframes is a no-op, exactly like the preview.
 * - **Cell effects**: the document's cell-effect stack runs on a *private*
 *   {@link CellFxRuntime} (never the editor singleton), settle-once baking
 *   semantics (`loop` off), advanced `1000/fps` ms per rendered frame from
 *   t = 0. Single-frame formats (PNG, text) therefore equal the session's
 *   first output; video steps the same session across the timeline, so
 *   every format shows the same frame at the same frame index.
 * - **Excluded**: the `aap` project format serializes the raw document and
 *   never goes through this renderer.
 */

import type { AsciiGrid, Document } from '../types';
import type { Timeline } from '../timeline/timeline';
import { applyTimelineToDocument } from '../timeline/timeline';
import { timelineHasAnimation } from '../timeline/playback';
import { composeDocument } from '../layer/compose';
import { CellFxRuntime } from '../fx/runtime';

export interface ExportFrameOptions {
  /** Timeline whose tracks animate the document. `null`/absent skips animation. */
  timeline?: Timeline | null;
  /** Timeline frame index to evaluate (single-frame entry points). Default 0. */
  frame?: number;
  /** Paper colour handed to cell effects (fades blend toward it). Defaults to the document background, then near-black. */
  paper?: number | null;
  /** Apply the document's cell-effect stack. Default true. */
  cellEffects?: boolean;
}

/**
 * Create a frame evaluator over one document.
 *
 * The returned function renders timeline frame `frame` and advances the
 * cell-effect clock by one frame step (`1000/fps` ms) per call, so calling it
 * with an increasing frame list reproduces the preview's animation
 * deterministically from `fxSeed`. A fresh session (and a fresh runtime)
 * always replays from t = 0 — two sessions over the same document produce
 * byte-identical grids.
 */
export function createExportFrameSession(
  doc: Document,
  opts: ExportFrameOptions = {},
): (frame: number) => AsciiGrid {
  const timeline = opts.timeline ?? null;
  const animated = timelineHasAnimation(timeline);
  const fps = timeline ? Math.max(1, Math.round(timeline.fps)) : 30;
  const stepMs = 1000 / fps;
  const paper =
    typeof opts.paper === 'number'
      ? opts.paper
      : typeof doc.canvas.background === 'number'
        ? doc.canvas.background
        : 0x0c0c10;
  const useEffects = opts.cellEffects !== false && doc.cellEffects.length > 0;

  // Private runtime: exporting must never disturb the editor's live preview.
  const fx = new CellFxRuntime();
  fx.setLoop(false); // bake: one-shots settle instead of replaying

  return (frame: number): AsciiGrid => {
    const frameDoc =
      animated && timeline !== null ? applyTimelineToDocument(doc, timeline, frame) : doc;
    let grid = composeDocument(frameDoc);
    if (!useEffects) return grid;
    fx.setPaper(paper);
    fx.sync(doc.cellEffects, doc.fxSeed);
    const out = fx.frame(grid, stepMs);
    if (out) grid = out;
    return grid;
  };
}

/**
 * Render exactly one export frame: document → timeline frame → composed
 * stack → cell effects. This is what PNG and the text/HTML/SVG/JSON
 * exporters serialize; video exports call
 * {@link createExportFrameSession} and render every frame instead.
 *
 * @param doc - Source document (never mutated).
 * @param opts - See {@link ExportFrameOptions}; `opts.frame` selects the
 * timeline frame (default 0).
 * @returns The composed, effects-baked grid for that frame.
 */
export function renderExportFrame(doc: Document, opts: ExportFrameOptions = {}): AsciiGrid {
  return createExportFrameSession(doc, opts)(opts.frame ?? 0);
}
