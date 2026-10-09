/**
 * Creative-layer helpers - the bridge between a document's generator graphs
 * and the layer that shows their output.
 *
 * The layer itself is pure data (see `CreativeLayer` in `../types`); this
 * module owns the pipeline that turns a {@link GeneratorGraph} into the
 * derived cell grid, plus the one piece of behaviour that must stay
 * identical wherever a creative layer is evaluated: knowing when its cached
 * grid is stale.
 *
 * The pipeline mirrors the image renderer's decision order (mapping ->
 * invert -> dither -> glyph selection), so a creative layer and an image
 * layer given the same luminance values and render settings produce the
 * same characters.
 *
 * Pure module: no DOM.
 */

import { DITHER_IDS, applyDither } from '../dither';
import { sortRampByInk } from '../glyph/sort';
import { evaluateGraph, type GeneratorGraph } from '../generators/graph';
import { inkToIndex, runMapping } from '../mapping';
import { err, ok, type AsciiGrid, type CreativeLayer, type Result, type Size } from '../types';
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
 * When a `graph` is supplied its output-affecting content (nodes, wiring,
 * output choice) is folded into the key as well, so editing a parameter or
 * rewiring an edge invalidates the cache even though the graph id stays the
 * same. Editor positions and the display name do not affect output and are
 * deliberately excluded.
 *
 * @param layer - layer supplying the graph id and glyph-mapping controls
 * @param canvas - canvas size in cells; the field is evaluated at this size
 * @param seed - procedural seed the graph is evaluated with
 * @param graph - bound graph, when available (content folded into the key)
 * @returns a short base36 key, identical for identical inputs
 */
export function creativeCacheKey(
  layer: Pick<CreativeLayer, 'graphId' | 'render'>,
  canvas: Size,
  seed: number,
  graph?: GeneratorGraph,
): string {
  const base = {
    render: layer.render,
    width: canvas.width,
    height: canvas.height,
    seed: seed | 0,
  };
  const content = graph
    ? hashString(
        stableStringify({
          nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind, params: n.params })),
          edges: graph.edges,
          output: graph.output,
        }),
      )
    : null;
  return `${layer.graphId}:${hashString(stableStringify({ ...base, content }))}`;
}

/** Ramp used when a layer's output charset is empty (same as the image pipeline). */
const DEFAULT_CHARSET = '@%#*+=-:. ';

/**
 * True when a creative layer's cached grid may be reused as-is.
 *
 * @param layer - layer whose `cacheKey` is compared
 * @param generators - document graphs (absence of the graph still counts as stale)
 * @param canvas - canvas size the field would be evaluated at
 * @param seed - procedural seed the graph would be evaluated with
 * @returns whether the cached grid matches every input that affects output
 */
export function creativeGridFresh(
  layer: CreativeLayer,
  generators: readonly GeneratorGraph[],
  canvas: Size,
  seed: number,
): boolean {
  if (!layer.grid) return false;
  const graph = generators.find((g) => g.id === layer.graphId);
  if (!graph) return false;
  return layer.cacheKey === creativeCacheKey(layer, canvas, seed, graph);
}

/**
 * Evaluate a creative layer's graph into its derived cell grid.
 *
 * The field samples are clamped to 0..1 (generator math may produce values
 * outside the luminance range), then handed to the same mapping -> invert ->
 * dither -> glyph-selection chain the image renderer uses, at canvas
 * resolution. Colors stay unset (`fg`/`bg` are null): a generative layer is
 * structure, colour comes from the palette/compositor.
 *
 * Pure and deterministic: identical inputs always produce a byte-identical
 * grid and a cache key that matches {@link creativeCacheKey} for the same
 * inputs.
 *
 * @param generators - document graphs to look the layer's `graphId` up in
 * @param layer - creative layer supplying graph id and render settings
 * @param canvas - canvas size in cells (the field is evaluated at this size)
 * @param seed - procedural seed (the document's `fxSeed`)
 * @returns the derived grid plus its cache key, or the first failure found
 */
export function renderCreativeLayer(
  generators: readonly GeneratorGraph[],
  layer: CreativeLayer,
  canvas: Size,
  seed: number,
): Result<{ grid: AsciiGrid; cacheKey: string }> {
  const graph = generators.find((g) => g.id === layer.graphId);
  if (!graph) {
    return err('invalid-input', `generator graph "${layer.graphId}" not found`);
  }
  const { width, height } = canvas;

  const field = evaluateGraph(graph, { width, height, seed });
  if (!field.ok) return err(field.error.code, field.error.message, field.error.detail);

  // Generator math is not luminance-bound; clamp before mapping so a wild
  // combine/gradient result lands on the ramp's endpoints instead of
  // extrapolating (non-finite output from a broken node falls to 0).
  const luma = new Float32Array(field.value.data.length);
  for (let i = 0; i < luma.length; i++) {
    const v = field.value.data[i];
    luma[i] = !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
  }

  let ink = runMapping({ luma, width, height, settings: layer.render.mapping, features: null });

  if (layer.render.output.invert) {
    const inv = new Float32Array(ink.length);
    for (let i = 0; i < ink.length; i++) inv[i] = 1 - ink[i];
    ink = inv;
  }

  const rawCharset =
    layer.render.output.charset && layer.render.output.charset.length > 0
      ? layer.render.output.charset
      : DEFAULT_CHARSET;
  const charset =
    layer.render.output.inkOrder === 'measured'
      ? sortRampByInk(rawCharset).sorted
      : [...rawCharset];

  if (layer.render.dither !== 'none' && DITHER_IDS.includes(layer.render.dither)) {
    ink = applyDither(
      ink,
      width,
      height,
      { algorithm: layer.render.dither, strength: 1, serpentine: false, matrixSize: 8 },
      charset.length,
    );
  }

  const chars: string[] = new Array(width * height);
  const { offset, density } = layer.render.output;
  for (let i = 0; i < chars.length; i++) {
    chars[i] = charset[inkToIndex(ink[i], charset.length, offset, density)];
  }

  return ok({
    grid: { width, height, chars, fg: null, bg: null },
    cacheKey: creativeCacheKey(layer, canvas, seed, graph),
  });
}
