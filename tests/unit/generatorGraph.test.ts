import { describe, it, expect } from 'vitest';
import {
  canonicalGeneratorGraph,
  evaluateGraph,
  generatorNodes,
  listGeneratorNodes,
  topologicalOrder,
  validateGeneratorGraph,
  type GeneratorGraph,
  type GeneratorNode,
} from '../../src/core/generators/graph';

function ok<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${String((result as { error: unknown }).error)}`);
  return result.value;
}

function code<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): string {
  if (result.ok) throw new Error('expected an error result');
  return result.error.code;
}

function message<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): string {
  if (result.ok) throw new Error('expected an error result');
  return result.error.message;
}

function gradientGraph(overrides: Partial<GeneratorGraph> = {}): GeneratorGraph {
  return {
    id: 'g1',
    name: 'Ramp',
    seed: 7,
    nodes: [{ id: 'grad', kind: 'gradient', params: { axis: 'x', from: 0, to: 1 } }],
    edges: [],
    output: 'grad',
    ...overrides,
  };
}

describe('generator node registry', () => {
  it('exposes the built-in kinds with unique ids', () => {
    const ids = listGeneratorNodes().map((n) => n.id);
    expect(ids).toEqual(['constant', 'gradient', 'valueNoise', 'threshold', 'combine']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const def of listGeneratorNodes()) {
      expect(generatorNodes.get(def.id)).toBe(def);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });
});

describe('validateGeneratorGraph', () => {
  it('accepts a well-formed graph unchanged', () => {
    const graph = gradientGraph({
      nodes: [
        { id: 'a', kind: 'gradient', params: { axis: 'x' } },
        { id: 'b', kind: 'threshold', params: { threshold: 0.5 } },
      ],
      edges: [{ from: 'a', to: 'b' }],
      output: 'b',
    });
    const result = validateGeneratorGraph(graph);
    expect(result.ok).toBe(true);
    expect(ok(result)).toEqual(graph);
  });

  it('keeps unknown node kinds (they only fail at evaluation)', () => {
    const result = validateGeneratorGraph(
      gradientGraph({ nodes: [{ id: 'n', kind: 'from-the-future', params: {} }], output: 'n' }),
    );
    expect(result.ok).toBe(true);
    expect(ok(result).nodes[0].kind).toBe('from-the-future');
  });

  it('repairs malformed params, seed and editor coordinates', () => {
    const result = validateGeneratorGraph({
      id: 'g',
      name: 42,
      seed: 'not-a-number',
      nodes: [{ id: 'n', kind: 'constant', params: { value: 1, bad: null, text: 'ok', flag: true, nan: Number.NaN }, x: 'left', y: 3 }],
      edges: [],
      output: 'n',
    });
    const graph = ok(result);
    expect(graph.name).toBe('');
    expect(graph.seed).toBe(0);
    expect(graph.nodes[0].params).toEqual({ value: 1, text: 'ok', flag: true });
    expect(graph.nodes[0].x).toBeUndefined();
    expect(graph.nodes[0].y).toBe(3);
  });

  it('rejects structural violations with invalid-input', () => {
    expect(code(validateGeneratorGraph(null))).toBe('invalid-input');
    expect(code(validateGeneratorGraph({}))).toBe('invalid-input');
    expect(code(validateGeneratorGraph({ id: '', nodes: [], edges: [], output: '' }))).toBe('invalid-input');
    expect(code(validateGeneratorGraph({ id: 'g', nodes: [], edges: [], output: '' }))).toBe('invalid-input');
    expect(
      code(validateGeneratorGraph({ id: 'g', nodes: [{ id: 'a', kind: 'constant' }], edges: 'nope', output: 'a' })),
    ).toBe('invalid-input');
    expect(
      code(validateGeneratorGraph({ id: 'g', nodes: [{ id: 'a', kind: 'constant' }], edges: [], output: 'zzz' })),
    ).toBe('invalid-input');
    expect(
      code(
        validateGeneratorGraph({
          id: 'g',
          nodes: [
            { id: 'a', kind: 'constant' },
            { id: 'a', kind: 'constant' },
          ],
          edges: [],
          output: 'a',
        }),
      ),
    ).toBe('invalid-input');
    expect(
      code(
        validateGeneratorGraph({
          id: 'g',
          nodes: [
            { id: 'a', kind: 'constant' },
            { id: 'b', kind: 'threshold' },
          ],
          edges: [{ from: 'a', to: 'ghost' }],
          output: 'b',
        }),
      ),
    ).toBe('invalid-input');
  });

  it('rejects cyclic graphs', () => {
    const cyclic = gradientGraph({
      nodes: [
        { id: 'a', kind: 'threshold', params: {} },
        { id: 'b', kind: 'threshold', params: {} },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      output: 'b',
    });
    expect(code(validateGeneratorGraph(cyclic))).toBe('invalid-input');
    expect(message(validateGeneratorGraph(cyclic))).toContain('cycle');
  });

  it('canonicalGeneratorGraph mirrors validation with null on failure', () => {
    expect(canonicalGeneratorGraph(gradientGraph())).toEqual(gradientGraph());
    expect(canonicalGeneratorGraph({ id: 'g' })).toBeNull();
  });
});

describe('topologicalOrder', () => {
  it('orders dependencies before their consumers, deterministically', () => {
    const graph = gradientGraph({
      nodes: [
        { id: 'out', kind: 'threshold', params: {} },
        { id: 'left', kind: 'gradient', params: {} },
        { id: 'right', kind: 'gradient', params: {} },
        { id: 'mix', kind: 'combine', params: {} },
      ],
      edges: [
        { from: 'left', to: 'mix' },
        { from: 'right', to: 'mix' },
        { from: 'mix', to: 'out' },
      ],
      output: 'out',
    });
    const order = ok(topologicalOrder(graph));
    expect(order[0]).toBe('left');
    expect(order.indexOf('mix')).toBeGreaterThan(order.indexOf('left'));
    expect(order.indexOf('mix')).toBeGreaterThan(order.indexOf('right'));
    expect(order[order.length - 1]).toBe('out');
    expect(ok(topologicalOrder(graph))).toEqual(order);
  });

  it('reports a cycle instead of hanging', () => {
    const graph = gradientGraph({
      nodes: [
        { id: 'a', kind: 'threshold', params: {} },
        { id: 'b', kind: 'threshold', params: {} },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      output: 'b',
    });
    expect(code(topologicalOrder(graph))).toBe('invalid-input');
  });
});

describe('evaluateGraph', () => {
  it('produces a constant field with exact statistics', () => {
    const graph: GeneratorGraph = {
      id: 'g',
      name: 'Flat',
      seed: 1,
      nodes: [{ id: 'c', kind: 'constant', params: { value: 0.7 } }],
      edges: [],
      output: 'c',
    };
    const field = ok(evaluateGraph(graph, { width: 4, height: 3 }));
    expect(field.name).toBe('Flat');
    expect(field.data).toHaveLength(12);
    for (const v of field.data) expect(v).toBeCloseTo(0.7, 6);
    expect(field.min).toBeCloseTo(0.7, 6);
    expect(field.max).toBeCloseTo(0.7, 6);
    expect(field.sourceKey.length).toBeGreaterThan(0);
  });

  it('falls back to the graph id when the graph is unnamed', () => {
    const graph = gradientGraph({ name: '' });
    expect(ok(evaluateGraph(graph, { width: 2, height: 2 })).name).toBe('g1');
  });

  it('ramps linearly along the chosen axis', () => {
    const graph = gradientGraph();
    const field = ok(evaluateGraph(graph, { width: 5, height: 2 }));
    expect(Array.from(field.data.slice(0, 5))).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(field.data[5]).toBeCloseTo(0, 6); // row 1 starts again at the left

    const vertical = ok(
      evaluateGraph(gradientGraph({ nodes: [{ id: 'grad', kind: 'gradient', params: { axis: 'y', from: 1, to: 0 } }] }), {
        width: 2,
        height: 3,
      }),
    );
    expect(Array.from(vertical.data)).toEqual([1, 1, 0.5, 0.5, 0, 0]);
  });

  it('rejects an unknown gradient axis at the failing node', () => {
    const graph = gradientGraph({ nodes: [{ id: 'grad', kind: 'gradient', params: { axis: 'z' } }] });
    const result = evaluateGraph(graph, { width: 2, height: 2 });
    expect(code(result)).toBe('invalid-input');
    expect(message(result)).toContain('grad');
  });

  it('is deterministic per seed and changes when the seed changes', () => {
    const graph: GeneratorGraph = {
      id: 'g',
      name: '',
      seed: 5,
      nodes: [{ id: 'n', kind: 'valueNoise', params: { scale: 4 } }],
      edges: [],
      output: 'n',
    };
    const a = ok(evaluateGraph(graph, { width: 16, height: 16 }));
    const b = ok(evaluateGraph(graph, { width: 16, height: 16 }));
    expect(Array.from(a.data)).toEqual(Array.from(b.data));

    const c = ok(evaluateGraph(graph, { width: 16, height: 16, seed: 99 }));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));

    for (const v of a.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(a.min).toBeLessThan(a.max); // noise actually varies
  });

  it('thresholds an input into hard cuts and soft ramps', () => {
    const graph = gradientGraph({
      nodes: [
        { id: 'grad', kind: 'gradient', params: { axis: 'x', from: 0, to: 1 } },
        { id: 'cut', kind: 'threshold', params: { threshold: 0.5 } },
      ],
      edges: [{ from: 'grad', to: 'cut' }],
      output: 'cut',
    });
    const hard = ok(evaluateGraph(graph, { width: 5, height: 1 }));
    expect(Array.from(hard.data)).toEqual([0, 0, 1, 1, 1]);

    graph.nodes[1].params = { threshold: 0.5, softness: 1 };
    const soft = ok(evaluateGraph(graph, { width: 5, height: 1 }));
    expect(soft.data[0]).toBeCloseTo(0, 6);
    expect(soft.data[4]).toBeCloseTo(1, 6);
    expect(soft.data[2]).toBeGreaterThan(soft.data[1]);
    expect(soft.data[3]).toBeGreaterThan(soft.data[2]);
  });

  it('feeds input slots in edges-array order', () => {
    const nodes: GeneratorNode[] = [
      { id: 'a', kind: 'gradient', params: { axis: 'x', from: 0, to: 1 } },
      { id: 'b', kind: 'gradient', params: { axis: 'x', from: 1, to: 0 } },
      { id: 'mix', kind: 'combine', params: { mode: 'subtract' } },
    ];
    const forwards = ok(
      evaluateGraph(
        gradientGraph({
          nodes,
          edges: [
            { from: 'a', to: 'mix' },
            { from: 'b', to: 'mix' },
          ],
          output: 'mix',
        }),
        { width: 5, height: 1 },
      ),
    );
    const backwards = ok(
      evaluateGraph(
        gradientGraph({
          nodes,
          edges: [
            { from: 'b', to: 'mix' },
            { from: 'a', to: 'mix' },
          ],
          output: 'mix',
        }),
        { width: 5, height: 1 },
      ),
    );
    expect(Array.from(forwards.data)).toEqual([0, 0, 0, 0.5, 1]);
    expect(Array.from(backwards.data)).toEqual([1, 0.5, 0, 0, 0]);
  });

  it('combines with every registered mode, clamping additive results', () => {
    const nodes: GeneratorNode[] = [
      { id: 'a', kind: 'constant', params: { value: 0.75 } },
      { id: 'b', kind: 'constant', params: { value: 0.5 } },
      { id: 'mix', kind: 'combine', params: { mode: 'add' } },
    ];
    const graph = gradientGraph({ nodes, edges: [{ from: 'a', to: 'mix' }, { from: 'b', to: 'mix' }], output: 'mix' });
    expect(ok(evaluateGraph(graph, { width: 2, height: 1 })).data[0]).toBeCloseTo(1, 6);

    graph.nodes[2].params = { mode: 'multiply' };
    expect(ok(evaluateGraph(graph, { width: 2, height: 1 })).data[0]).toBeCloseTo(0.375, 6);

    graph.nodes[2].params = { mode: 'min' };
    expect(ok(evaluateGraph(graph, { width: 2, height: 1 })).data[0]).toBeCloseTo(0.5, 6);

    graph.nodes[2].params = { mode: 'max' };
    expect(ok(evaluateGraph(graph, { width: 2, height: 1 })).data[0]).toBeCloseTo(0.75, 6);

    graph.nodes[2].params = { mode: 'divide' };
    expect(code(evaluateGraph(graph, { width: 2, height: 1 }))).toBe('invalid-input');
  });

  it('reports wiring mistakes at the offending node', () => {
    const missing = gradientGraph({
      nodes: [{ id: 'cut', kind: 'threshold', params: {} }],
      edges: [],
      output: 'cut',
    });
    expect(code(evaluateGraph(missing, { width: 2, height: 2 }))).toBe('invalid-input');
    expect(message(evaluateGraph(missing, { width: 2, height: 2 }))).toContain('cut');

    const extra = gradientGraph({
      nodes: [
        { id: 'c', kind: 'constant', params: {} },
        { id: 'src', kind: 'gradient', params: {} },
      ],
      edges: [{ from: 'src', to: 'c' }],
      output: 'c',
    });
    expect(code(evaluateGraph(extra, { width: 2, height: 2 }))).toBe('invalid-input');
    expect(message(evaluateGraph(extra, { width: 2, height: 2 }))).toContain('accepts 0 input');

    const unknown = gradientGraph({ nodes: [{ id: 'n', kind: 'mystery', params: {} }], output: 'n' });
    expect(code(evaluateGraph(unknown, { width: 2, height: 2 }))).toBe('invalid-input');
    expect(message(evaluateGraph(unknown, { width: 2, height: 2 }))).toContain('mystery');
  });

  it('refuses bad output dimensions without throwing', () => {
    const graph = gradientGraph();
    expect(code(evaluateGraph(graph, { width: 0, height: 2 }))).toBe('invalid-input');
    expect(code(evaluateGraph(graph, { width: 2, height: -1 }))).toBe('invalid-input');
    expect(code(evaluateGraph(graph, { width: 2.5, height: 2 }))).toBe('invalid-input');
  });

  it('keys the field cache on the graph, size and seed', () => {
    const graph = gradientGraph();
    const a = ok(evaluateGraph(graph, { width: 4, height: 4, seed: 1 }));
    const b = ok(evaluateGraph(graph, { width: 4, height: 4, seed: 1 }));
    const c = ok(evaluateGraph(graph, { width: 4, height: 4, seed: 2 }));
    const d = ok(evaluateGraph(graph, { width: 8, height: 4, seed: 1 }));
    expect(a.sourceKey).toBe(b.sourceKey);
    expect(a.sourceKey).not.toBe(c.sourceKey);
    expect(a.sourceKey).not.toBe(d.sourceKey);
  });
});
