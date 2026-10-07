/**
 * Creative-layer helpers - the bridge between a document's generator graphs
 * and the layer that shows their output.
 *
 * The layer itself is pure data (see `CreativeLayer` in `../types`); this
 * module owns the one piece of behaviour that must stay identical wherever a
 * creative layer is evaluated: knowing when its cached grid is stale.
 *
 * Pure module: no DOM.
 */

import type { CreativeLayer, Size } from '../types';
import { hashString, stableStringify } from '../util';

/**
 * Cache key for a creative layer's derived grid.
 *
 * Two evaluations may share a cached grid only when the graph, its mapping
 * settings, the canvas dimensions (the field is evaluated at grid
 * resolution) and the procedural seed are all identical - so flipping a
 * slider, resizing the canvas or reseeding the RNG all invalidate the cache
 * exactly once.
 *
 * @param layer - layer supplying the graph id and glyph-mapping controls
 * @param canvas - canvas size in cells; the field is evaluated at this size
 * @param seed - procedural seed the graph is evaluated with
 * @returns a short base36 key, identical for identical inputs
 */
export function creativeCacheKey(layer: Pick<CreativeLayer, 'graphId' | 'render'>, canvas: Size, seed: number): string {
  return `${layer.graphId}:${hashString(
    stableStringify({ render: layer.render, width: canvas.width, height: canvas.height, seed: seed | 0 }),
  )}`;
}
