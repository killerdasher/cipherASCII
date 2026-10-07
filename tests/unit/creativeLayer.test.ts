import { describe, it, expect } from 'vitest';
import { creativeCacheKey } from '../../src/core/layer/creative';
import { createDocument, validateDocument } from '../../src/core/project/schema';
import { DEFAULT_CREATIVE_RENDER, type CreativeLayer, type AsciiLayer, type Result, type StudioError } from '../../src/core/types';

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
});
