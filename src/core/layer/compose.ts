/**
 * Layer composition: flatten a document's layer stack into a single AsciiGrid.
 *
 * Layers are rendered bottom-to-top (index order). Each layer contributes its
 * grid at its (x, y) offset with opacity blending. Only visible layers are
 * included. Image/Text layers use their cached grid when available.
 */

import { NO_COLOR, type AsciiGrid, type Document, type Layer } from '../types';
import {
  cloneGrid,
  createGrid,
  overlayGrid,
  type CompositeOptions,
} from '../grid';

export interface ComposeOptions {
  /** Only include layers up to this index (exclusive). Useful for preview. */
  layerLimit?: number;
  /** Background fill when no layer covers a cell. */
  background?: string;
}

function layerGrid(layer: Layer): AsciiGrid | null {
  switch (layer.kind) {
    case 'ascii':
      return layer.grid;
    case 'image':
    case 'text':
    case 'creative':
      return layer.grid;
    default:
      return null;
  }
}

function applyOpacity(base: AsciiGrid, over: AsciiGrid, opacity: number): AsciiGrid {
  if (opacity >= 1) return overlayGrid(base, over, over.width > 0 ? 0 : 0, 0, { spaceIsTransparent: true });
  if (opacity <= 0) return base;

  const out = cloneGrid(base);
  const ow = over.width;
  const oh = over.height;

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const oi = y * ow + x;
      const oc = over.chars[oi];
      if (oc === ' ') continue;

      const bi = y * out.width + x;
      if (bi < 0 || bi >= out.chars.length) continue;

      // Simple opacity: randomly choose base or over char based on opacity
      // For deterministic composition, use a threshold on position
      const threshold = opacity;
      const hash = ((x * 73856093) ^ (y * 19349663)) & 0xffff;
      const rand = hash / 65535;
      if (rand < threshold) {
        out.chars[bi] = oc;
        if (over.fg && over.fg[oi] !== NO_COLOR) {
          if (!out.fg) out.fg = new Int32Array(out.width * out.height).fill(NO_COLOR);
          out.fg[bi] = over.fg[oi];
        }
        if (over.bg && over.bg[oi] !== NO_COLOR) {
          if (!out.bg) out.bg = new Int32Array(out.width * out.height).fill(NO_COLOR);
          out.bg[bi] = over.bg[oi];
        }
      }
    }
  }
  return out;
}

/**
 * Compose all visible layers of a document into a single grid.
 *
 * The canvas size determines the output grid dimensions. Layers are positioned
 * at their (x, y) offsets and clipped to the canvas bounds.
 */
export function composeDocument(doc: Document, opts: ComposeOptions = {}): AsciiGrid {
  const canvasW = doc.canvas.width;
  const canvasH = doc.canvas.height;
  const bg = opts.background ?? ' ';

  let result = createGrid(canvasW, canvasH, bg);

  const limit = opts.layerLimit ?? doc.layers.length;
  for (let i = 0; i < Math.min(limit, doc.layers.length); i++) {
    const layer = doc.layers[i];
    if (!layer.visible) continue;

    const grid = layerGrid(layer);
    if (!grid) continue;

    const dx = Math.floor(layer.x);
    const dy = Math.floor(layer.y);

    let positioned = createGrid(canvasW, canvasH, ' ');
    const opts: CompositeOptions = { spaceIsTransparent: true };
    positioned = overlayGrid(positioned, grid, dx, dy, opts);

    result = applyOpacity(result, positioned, layer.opacity);
  }

  return result;
}

/**
 * Compose only the active layer (for editing preview).
 */
export function composeActiveLayer(doc: Document): AsciiGrid {
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  if (!layer) return createGrid(doc.canvas.width, doc.canvas.height, ' ');
  const grid = layerGrid(layer);
  if (!grid) return createGrid(doc.canvas.width, doc.canvas.height, ' ');

  let out = createGrid(doc.canvas.width, doc.canvas.height, ' ');
  out = overlayGrid(out, grid, Math.floor(layer.x), Math.floor(layer.y), { spaceIsTransparent: true });
  return out;
}