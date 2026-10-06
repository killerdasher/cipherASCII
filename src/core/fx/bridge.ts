/**
 * AsciiGrid ⇄ Plane bridge.
 *
 * The document is an `AsciiGrid` (string cells, the canonical, serialisable
 * representation); effects and the layered renderer operate on a `Plane`
 * (interned glyph indices, structure-of-arrays). These two converters are the
 * only place that translation happens, so the fast path stays allocation-free
 * once the arrays exist.
 */

import type { AsciiGrid } from '../types';
import { Plane } from '../canvas/plane';
import { NO_CELL } from '../canvas/cell';

/** Copy an `AsciiGrid` into `plane`, resizing it to the grid first. */
export function gridToPlane(plane: Plane, grid: AsciiGrid): void {
  if (plane.width !== grid.width || plane.height !== grid.height) {
    plane.resize(grid.width, grid.height);
  }
  const n = grid.width * grid.height;
  const { chars, fg, bg } = grid;
  const glyph = plane.glyph;
  const planeFg = plane.fg;
  const planeBg = plane.bg;
  const alpha = plane.alpha;
  const table = plane.glyphTable;
  for (let i = 0; i < n; i++) {
    glyph[i] = table.intern(chars[i] ?? ' ');
    planeFg[i] = fg ? fg[i] : NO_CELL;
    planeBg[i] = bg ? bg[i] : NO_CELL;
    alpha[i] = 255;
  }
}

/**
 * Copy `plane` into an `AsciiGrid`.
 *
 * `target` is reused when its dimensions match, so an animation loop costs one
 * pass and no allocation; pass `null` to force a fresh grid (used when the
 * source document changed, so the caller never aliases the document's arrays).
 */
export function planeToGrid(plane: Plane, target?: AsciiGrid | null): AsciiGrid {
  const n = plane.width * plane.height;
  const reuse = !!target && target.width === plane.width && target.height === plane.height && target.chars.length === n;
  const chars = reuse ? target!.chars : new Array<string>(n);
  const fg = reuse && target!.fg ? target!.fg : new Int32Array(n);
  const bg = reuse && target!.bg ? target!.bg : new Int32Array(n);
  const table = plane.glyphTable;
  const glyph = plane.glyph;
  const planeFg = plane.fg;
  const planeBg = plane.bg;
  for (let i = 0; i < n; i++) {
    chars[i] = table.resolve(glyph[i]);
    fg[i] = planeFg[i];
    bg[i] = planeBg[i];
  }
  if (reuse) return target!;
  return { width: plane.width, height: plane.height, chars, fg, bg };
}
