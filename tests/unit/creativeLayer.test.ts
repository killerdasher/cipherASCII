import { describe, it, expect } from 'vitest';
import { creativeCacheKey, creativeGridFresh, renderCreativeLayer } from '../../src/core/layer/creative';
import { defaultGeneratorGraph, setNodeParam } from '../../src/core/generators/edit';
import type { GeneratorGraph } from '../../src/core/generators/graph';
import { createDocument, validateDocument } from '../../src/core/project/schema';
import {
  DEFAULT_CREATIVE_RENDER,
  type CreativeLayer,
  type AsciiLayer,
  type DitherId,
  type Result,
  type StudioError,
} from '../../src/core/types';

/** Flat-field graph used to pin exact glyph selection. */
function constantGraph(value: number): GeneratorGraph {
  return {
    id: 'graph-1',
    name: 'Flat',
    seed: 0,
    nodes: [{ id: 'k', kind: 'constant', params: { value } }],
    edges: [],
    output: 'k',
  };
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function failure<T>(result: Result<T>): StudioError {
  if (result.ok) throw new Error('expected an error result');
  return result.error;
}

function creativeLayer(overrides: Partial<CreativeLayer> = {}): CreativeLayer {
  return {
    id: 'creative-1',
    name: 'Generative',
    kind: 'creative',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: 0,
    y: 0,
    graphId: 'graph-1',
    render: DEFAULT_CREATIVE_RENDER,
    grid: null,
    cacheKey: '',
    ...overrides,
  };
}

describe('creativeCacheKey', () => {
  const canvas = { width: 80, height: 24 };

  it('is stable for identical inputs and independent of key order', () => {
    const layer = creativeLayer();
    const same = creativeLayer({
      render: {
        dither: DEFAULT_CREATIVE_RENDER.dither,
        output: DEFAULT_CREATIVE_RENDER.output,
        mapping: DEFAULT_CREATIVE_RENDER.mapping,
      },
    });
    expect(creativeCacheKey(layer, canvas, 123)).toBe(creativeCacheKey(same, canvas, 123));
  });

  it('changes when the graph, canvas, seed or mapping settings change', () => {
    const base = creativeCacheKey(creativeLayer(), canvas, 1);
    expect(creativeCacheKey(creativeLayer({ graphId: 'graph-2' }), canvas, 1)).not.toBe(base);
    expect(creativeCacheKey(creativeLayer(), { width: 40, height: 24 }, 1)).not.toBe(base);
    expect(creativeCacheKey(creativeLayer(), canvas, 2)).not.toBe(base);
    expect(
      creativeCacheKey(creativeLayer({ render: { ...DEFAULT_CREATIVE_RENDER, dither: 'bayer4' } }), canvas, 1),
    ).not.toBe(base);
  });
});

describe('creative layers in the project schema', () => {
  it('creates a document with empty generators and the default seed', () => {
    const doc = createDocument();
    expect(doc.generators).toEqual([]);
    expect(doc.fxSeed).toBe(0x5eed);
  });

  it('accepts a document carrying a creative layer and its generator graph', () => {
    const doc = createDocument();
    doc.layers = [
      { ...doc.layers[0], id: 'bg' } as AsciiLayer,
      creativeLayer(),
    ];
    doc.activeLayerId = 'creative-1';
    doc.generators = [
      {
        id: 'graph-1',
        name: 'Waves',
        seed: 3,
        nodes: [{ id: 'n', kind: 'valueNoise', params: { scale: 8 } }],
        edges: [],
        output: 'n',
      },
    ];
    const restored = value(validateDocument(doc));
    expect(restored.layers).toHaveLength(2);
    expect(restored.layers[1].kind).toBe('creative');
    expect(restored.generators).toHaveLength(1);
    expect(restored.fxSeed).toBe(0x5eed);
  });

  it('accepts a creative layer whose grid cache is still empty', () => {
    const doc = createDocument();
    doc.layers = [creativeLayer()];
    const restored = value(validateDocument(doc));
    expect(restored.layers[0].kind).toBe('creative');
    expect((restored.layers[0] as CreativeLayer).grid).toBeNull();
  });

  it('rejects a non-array generators block', () => {
    const doc = { ...createDocument(), generators: 'nope' } as unknown;
    expect(failure(validateDocument(doc)).code).toBe('invalid-project');
  });

  it('repairs a creative layer with missing or malformed settings', () => {
    const doc = createDocument();
    doc.layers = [
      creativeLayer({
        graphId: 42 as unknown as string,
        cacheKey: 9 as unknown as string,
        render: { dither: 7, mapping: { strategy: 'wat' }, output: { invert: 'yes' } } as never,
      }),
    ];
    const restored = value(validateDocument(doc)).layers[0] as CreativeLayer;
    expect(restored.graphId).toBe('');
    expect(restored.cacheKey).toBe('');
    expect(restored.render.dither).toBe(DEFAULT_CREATIVE_RENDER.dither);
    expect(restored.render.output.invert).toBe(false);
    expect(restored.render.output.charset).toBe(DEFAULT_CREATIVE_RENDER.output.charset);
    expect(restored.render.mapping.radius).toBe(DEFAULT_CREATIVE_RENDER.mapping.radius);
    // String fields survive as-is; runMapping falls back to luminance.
    expect(restored.render.mapping.strategy).toBe('wat');

    doc.layers = [creativeLayer({ render: {} as never })];
    const full = value(validateDocument(doc)).layers[0] as CreativeLayer;
    expect(full.render).toEqual(DEFAULT_CREATIVE_RENDER);
  });
});


describe('renderCreativeLayer', () => {
  const canvas = { width: 24, height: 8 };
  const graph = defaultGeneratorGraph('graph-1');
  const seed = 7;

  it('renders a canvas-sized monochrome grid with a matching cache key', () => {
    const layer = creativeLayer();
    const result = value(renderCreativeLayer([graph], layer, canvas, seed));
    expect(result.grid.width).toBe(24);
    expect(result.grid.height).toBe(8);
    expect(result.grid.chars).toHaveLength(24 * 8);
    expect(result.grid.fg).toBeNull();
    expect(result.grid.bg).toBeNull();
    expect(result.cacheKey).toBe(creativeCacheKey(layer, canvas, seed, graph));
  });

  it('is deterministic: identical inputs repeat byte for byte', () => {
    const layer = creativeLayer();
    const a = value(renderCreativeLayer([graph], layer, canvas, seed));
    const b = value(renderCreativeLayer([graph], layer, canvas, seed));
    expect(a.grid.chars).toEqual(b.grid.chars);
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it('changes with the seed (document fxSeed animates the field)', () => {
    const layer = creativeLayer();
    const a = value(renderCreativeLayer([graph], layer, canvas, seed));
    const b = value(renderCreativeLayer([graph], layer, canvas, seed + 1));
    expect(a.cacheKey).not.toBe(b.cacheKey);
    expect(a.grid.chars).not.toEqual(b.grid.chars);
  });

  it('maps a white field to the lightest glyph and a black field to the densest', () => {
    // ink = 1 - luma: a full-brightness field carries no ink, so it renders
    // as spaces; a zero field picks the first (densest) charset character.
    const white = value(renderCreativeLayer([constantGraph(1)], creativeLayer(), canvas, 0));
    expect([...new Set(white.grid.chars)]).toEqual([' ']);

    const black = value(renderCreativeLayer([constantGraph(0)], creativeLayer(), canvas, 0));
    expect([...new Set(black.grid.chars)]).toEqual(['@']);
  });

  it('clamps out-of-range generator math instead of extrapolating the ramp', () => {
    const hot = value(renderCreativeLayer([constantGraph(5)], creativeLayer(), canvas, 0));
    expect([...new Set(hot.grid.chars)]).toEqual([' ']);
    const cold = value(renderCreativeLayer([constantGraph(-3)], creativeLayer(), canvas, 0));
    expect([...new Set(cold.grid.chars)]).toEqual(['@']);
  });

  it('reports a missing graph instead of throwing', () => {
    const result = failure(renderCreativeLayer([graph], creativeLayer({ graphId: 'gone' }), canvas, 0));
    expect(result.code).toBe('invalid-input');
    expect(result.message).toContain('gone');
  });

  it('invalidates the cache when only the graph content changes', () => {
    const layer = creativeLayer();
    const before = value(renderCreativeLayer([graph], layer, canvas, seed));
    const edited = value(setNodeParam(graph, 'cut', 'threshold', 0.85));
    const after = value(renderCreativeLayer([edited], layer, canvas, seed));
    expect(after.cacheKey).not.toBe(before.cacheKey);
    const cached: CreativeLayer = { ...layer, grid: before.grid, cacheKey: before.cacheKey };
    expect(creativeGridFresh(cached, [graph], canvas, seed)).toBe(true);
    expect(creativeGridFresh(cached, [edited], canvas, seed)).toBe(false);
  });

  it('skips unknown dither ids gracefully (same output as no dither)', () => {
    const plain = value(renderCreativeLayer([graph], creativeLayer(), canvas, seed));
    const bogus = creativeLayer({
      render: { ...DEFAULT_CREATIVE_RENDER, dither: 'nonexistent-dither' as DitherId },
    });
    const result = value(renderCreativeLayer([graph], bogus, canvas, seed));
    expect(result.grid.chars).toEqual(plain.grid.chars);
  });
});

describe('creativeGridFresh', () => {
  const canvas = { width: 24, height: 8 };
  const graph = defaultGeneratorGraph('graph-1');

  it('treats an empty cache as stale and a rendered one as fresh', () => {
    const layer = creativeLayer();
    expect(creativeGridFresh(layer, [graph], canvas, 1)).toBe(false);
    const result = value(renderCreativeLayer([graph], layer, canvas, 1));
    const cached: CreativeLayer = { ...layer, grid: result.grid, cacheKey: result.cacheKey };
    expect(creativeGridFresh(cached, [graph], canvas, 1)).toBe(true);

    // Every output-affecting input invalidates it.
    expect(creativeGridFresh(cached, [graph], { width: 40, height: 8 }, 1)).toBe(false);
    expect(creativeGridFresh(cached, [graph], canvas, 2)).toBe(false);
    expect(creativeGridFresh(cached, [], canvas, 1)).toBe(false);
    const rerendered = creativeLayer({
      render: { ...DEFAULT_CREATIVE_RENDER, dither: 'bayer4' },
      grid: cached.grid,
      cacheKey: cached.cacheKey,
    });
    expect(creativeGridFresh(rerendered, [graph], canvas, 1)).toBe(false);
  });
});
