/**
 * Layer composition: flatten a document's layer stack into a single AsciiGrid.
 *
 * This module is THE compositor — there is no second path. Every visible
 * layer becomes a {@link Plane} on one shared {@link GlyphTable} (cells store
 * glyph *indices*; a table per layer would splice unrelated code points
 * together at composite time), and `core/canvas/compose.ts` walks them
 * bottom-to-top with real per-cell alpha and the layer's blend mode:
 *
 * - opacity 0..1 maps onto plane alpha 0..255 — no hash dither;
 * - space cells carry alpha 0, so a space is fully transparent (colour and
 *   glyph) exactly like the old `spaceIsTransparent` overlay;
 * - the document background colour is the backdrop the first colour in a
 *   cell blends against, so a lone layer at 50% reads as 50% against the
 *   page instead of staying fully saturated;
 * - ASCII glyphs cannot cross-fade, so a glyph flips over at half effective
 *   alpha (`GLYPH_COVERAGE_ALPHA`) while colours blend continuously;
 * - `overlayGrid` in `core/grid.ts` remains only as the cell-stamp primitive
 *   (text tool, paste) — it is not a layer compositor.
 */

import { NO_CELL } from '../canvas/cell';
import { FrameBuffer, composite } from '../canvas/compose';
import { GlyphTable } from '../canvas/glyphTable';
import { Plane } from '../canvas/plane';
import { frameToGrid } from '../fx/bridge';
import { createGrid } from '../grid';
import { blendModeFor } from './blends';
import type { AsciiGrid, Document, Layer } from '../types';

export interface ComposeOptions {
  /** Only include layers up to this index (exclusive). Useful for preview. */
  layerLimit?: number;
  /** Character painted under every layer (document background glyph). */
  background?: string;
}

/** Layer opacity 0..1 → compositor alpha 0..255 (rounded, clamped). */
function opacityToAlpha(opacity: number): number {
  if (!Number.isFinite(opacity)) return 255;
  const a = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  return a;
}

/**
 * Copy `grid` into a canvas-sized plane at (dx, dy).
 *
 * Space cells get alpha 0 so they never paint colour or glyph; every other
 * cell is fully opaque at the cell level (layer opacity rides on the plane).
 * The plane is freshly constructed, so only the cells the grid actually
 * covers need writing.
 */
function fillPlaneFromGrid(
  plane: Plane,
  table: GlyphTable,
  grid: AsciiGrid,
  dx: number,
  dy: number,
): void {
  const cw = plane.width;
  const ch = plane.height;
  for (let y = 0; y < grid.height; y++) {
    const py = dy + y;
    if (py < 0 || py >= ch) continue;
    for (let x = 0; x < grid.width; x++) {
      const px = dx + x;
      if (px < 0 || px >= cw) continue;
      const si = y * grid.width + x;
      const cell = grid.chars[si];
      const di = py * cw + px;
      plane.glyph[di] = table.intern(cell);
      plane.fg[di] = grid.fg ? grid.fg[si] : NO_CELL;
      plane.bg[di] = grid.bg ? grid.bg[si] : NO_CELL;
      plane.alpha[di] = cell === ' ' ? 0 : 255;
    }
  }
}

/** Compose `layers` (bottom-to-top) onto an empty frame and return the grid. */
function composePlanes(
  layers: readonly Layer[],
  width: number,
  height: number,
  paper: string,
  backdrop: number,
): AsciiGrid {
  const table = new GlyphTable();
  const planes: Plane[] = [];

  if (paper.length > 0 && paper[0] !== ' ') {
    const fill = new Plane(width, height, { glyphTable: table, z: -1 });
    fill.glyph.fill(table.intern(paper[0]));
    fill.alpha.fill(255);
    planes.push(fill);
  }

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer.visible) continue;
    const grid = layer.grid;
    if (!grid || grid.width === 0 || grid.height === 0) continue;
    const plane = new Plane(width, height, {
      glyphTable: table,
      z: i,
      opacity: opacityToAlpha(layer.opacity),
      blend: blendModeFor(layer.blend),
    });
    fillPlaneFromGrid(plane, table, grid, Math.floor(layer.x), Math.floor(layer.y));
    planes.push(plane);
  }

  const target = new FrameBuffer(width, height);
  composite(planes, target, undefined, backdrop);
  return frameToGrid(target, table);
}

/**
 * Compose all visible layers of a document into a single grid.
 *
 * The canvas size determines the output grid dimensions. Layers are positioned
 * at their (x, y) offsets and clipped to the canvas bounds; colours blend
 * against `doc.canvas.background` where nothing has painted yet.
 */
export function composeDocument(doc: Document, opts: ComposeOptions = {}): AsciiGrid {
  const limit = opts.layerLimit ?? doc.layers.length;
  const layers = doc.layers.slice(0, Math.max(0, Math.min(limit, doc.layers.length)));
  const backdrop = typeof doc.canvas.background === 'number' ? doc.canvas.background : NO_CELL;
  return composePlanes(
    layers,
    doc.canvas.width,
    doc.canvas.height,
    opts.background ?? ' ',
    backdrop,
  );
}

/**
 * Compose only the active layer (for editing preview).
 *
 * Same compositor as {@link composeDocument} — no page backdrop, so the
 * preview shows exactly this layer's contribution.
 */
export function composeActiveLayer(doc: Document): AsciiGrid {
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) return createGrid(doc.canvas.width, doc.canvas.height);
  return composePlanes([layer], doc.canvas.width, doc.canvas.height, ' ', NO_CELL);
}
