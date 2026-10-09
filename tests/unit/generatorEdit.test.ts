import { describe, it, expect } from 'vitest';
import {
  addGraphNode,
  connectNodes,
  defaultGeneratorGraph,
  disconnectNodeInput,
  removeGraphNode,
  setGraphOutput,
  setNodeParam,
} from '../../src/core/generators/edit';
import {
  evaluateGraph,
  generatorNodes,
  listGeneratorNodes,
  topologicalOrder,
  validateGeneratorGraph,
  type GeneratorGraph,
} from '../../src/core/generators/graph';
import type { Result, StudioError } from '../../src/core/types';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok result, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function failure<T>(result: Result<T>): StudioError {
  if (result.ok) throw new Error('expected an error result');
  return result.error;
}

/** Two constants feeding a combine node, for slot-ordering experiments. */
function pairGraph(): GeneratorGraph {
  return {
    id: 'pair',
    name: 'Pair',
    seed: 0,
    nodes: [
      { id: 'a', kind: 'constant', params: { value: 0.2 } },
      { id: 'b', kind: 'constant', params: { value: 0.9 } },
      { id: 'c', kind: 'combine', params: { mode: 'subtract' } },
    ],
    edges: [],
    output: 'c',
  };
}

describe('defaultGeneratorGraph', () => {
  it('is a valid, evaluable noise -> threshold pipeline', () => {
    const graph = defaultGeneratorGraph('gen-1');
    value(validateGeneratorGraph(graph));
    value(topologicalOrder(graph));
    const field = value(evaluateGraph(graph, { width: 8, height: 4, seed: 1 }));
    expect(field.data).toHaveLength(32);
    // Soft threshold: everything stays inside the luminance range.
    expect([...field.data].every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('addGraphNode', () => {
  it('appends registered kinds with fresh ids, empty params and a position', () => {
    let graph = defaultGeneratorGraph('gen-1');
    graph = value(addGraphNode(graph, 'constant'));
    graph = value(addGraphNode(graph, 'gradient'));
    expect(graph.nodes).toHaveLength(4);
    const added = graph.nodes.slice(-2);
    expect(added[0].kind).toBe('constant');
    expect(added[1].kind).toBe('gradient');
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(4);
    expect(added.every((n) => Object.keys(n.params).length === 0)).toBe(true);
    expect(added.every((n) => typeof n.x === 'number' && typeof n.y === 'number')).toBe(true);
    value(validateGeneratorGraph(graph));
  });

  it('refuses unknown node kinds', () => {
    const result = addGraphNode(defaultGeneratorGraph('gen-1'), 'raymarcher');
    expect(failure(result).code).toBe('invalid-input');
    expect(failure(result).message).toContain('raymarcher');
  });
});

describe('removeGraphNode', () => {
  it('removes the node with its edges and keeps the graph valid', () => {
    const graph = value(removeGraphNode(defaultGeneratorGraph('gen-1'), 'noise'));
    expect(graph.nodes.map((n) => n.id)).toEqual(['cut']);
    expect(graph.edges).toEqual([]);
    expect(graph.output).toBe('cut');
    value(validateGeneratorGraph(graph));
  });

  it('repoints the output when the output node goes away', () => {
    const graph = value(removeGraphNode(defaultGeneratorGraph('gen-1'), 'cut'));
    expect(graph.output).toBe('noise');
    expect(graph.edges).toEqual([]);
    value(validateGeneratorGraph(graph));
  });

  it('refuses an unknown id and the last node', () => {
    expect(failure(removeGraphNode(defaultGeneratorGraph('gen-1'), 'ghost')).code).toBe('invalid-input');
    const single = value(addGraphNode({ ...defaultGeneratorGraph('g'), nodes: [], edges: [] }, 'constant'));
    expect(single.nodes).toHaveLength(1);
    const solo = value(setGraphOutput(single, single.nodes[0].id));
    expect(failure(removeGraphNode(solo, solo.nodes[0].id)).message).toContain('at least one node');
  });
});

describe('setNodeParam', () => {
  it('sets a number parameter and leaves the other nodes untouched', () => {
    const base = defaultGeneratorGraph('gen-1');
    const graph = value(setNodeParam(base, 'cut', 'threshold', 0.9));
    const cut = graph.nodes.find((n) => n.id === 'cut')!;
    expect(cut.params.threshold).toBe(0.9);
    expect(graph.nodes.find((n) => n.id === 'noise')).toBe(base.nodes.find((n) => n.id === 'noise'));
    value(validateGeneratorGraph(graph));
  });

  it('accepts registered select options and rejects everything else', () => {
    const withGradient = value(addGraphNode(defaultGeneratorGraph('gen-1'), 'gradient'));
    const gid = withGradient.nodes[withGradient.nodes.length - 1].id;
    const graph = value(setNodeParam(withGradient, gid, 'axis', 'y'));
    expect(graph.nodes.find((n) => n.id === gid)!.params.axis).toBe('y');

    expect(failure(setNodeParam(graph, gid, 'axis', 'diagonal')).message).toContain('axis');
    expect(failure(setNodeParam(graph, gid, 'nope', 1)).code).toBe('invalid-input');
    expect(failure(setNodeParam(graph, 'cut', 'threshold', 'half')).message).toContain('finite');
    expect(failure(setNodeParam(graph, 'ghost', 'value', 1)).code).toBe('invalid-input');
  });

  it('stays permissive for unknown kinds (newer-build graphs keep loading)', () => {
    const graph: GeneratorGraph = {
      id: 'x',
      name: 'X',
      seed: 0,
      nodes: [{ id: 'm', kind: 'holographic', params: {} }],
      edges: [],
      output: 'm',
    };
    const next = value(setNodeParam(graph, 'm', 'anything', 3));
    expect(next.nodes[0].params.anything).toBe(3);
  });
});

describe('setGraphOutput', () => {
  it('switches the output and no-ops when it is already set', () => {
    const base = defaultGeneratorGraph('gen-1');
    const graph = value(setGraphOutput(base, 'noise'));
    expect(graph.output).toBe('noise');
    expect(value(setGraphOutput(graph, 'noise'))).toBe(graph);
    expect(failure(setGraphOutput(graph, 'ghost')).code).toBe('invalid-input');
  });
});

describe('connectNodes', () => {
  it('replaces a slot in place and appends beyond the existing inputs', () => {
    const wired = value(connectNodes(pairGraph(), 'a', 'c', 0));
    expect(wired.edges).toEqual([{ from: 'a', to: 'c' }]);

    const replaced = value(connectNodes(wired, 'b', 'c', 0));
    expect(replaced.edges).toEqual([{ from: 'b', to: 'c' }]);

    // The edges array order is the input order the evaluator reads.
    const appended = value(connectNodes(replaced, 'a', 'c', 1));
    expect(appended.edges).toEqual([
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ]);
    value(validateGeneratorGraph(appended));
  });

  it('feeds input slots in edges order all the way to evaluation', () => {
    // slots [b, a] with mode subtract: 0.9 - 0.2 = 0.7 (float32 rounding)
    let graph = value(connectNodes(pairGraph(), 'b', 'c', 0));
    graph = value(connectNodes(graph, 'a', 'c', 1));
    const reversed = value(evaluateGraph(graph, { width: 4, height: 2, seed: 0 }));
    expect(reversed.data[0]).toBeCloseTo(0.7, 5);

    // Swapping the slots flips the subtraction: 0.2 - 0.9 clamps to 0.
    let other = value(connectNodes(pairGraph(), 'a', 'c', 0));
    other = value(connectNodes(other, 'b', 'c', 1));
    const forwards = value(evaluateGraph(other, { width: 4, height: 2, seed: 0 }));
    expect(forwards.data[0]).toBeCloseTo(0, 5);
  });

  it('is idempotent when the slot already carries that source', () => {
    const base = value(connectNodes(pairGraph(), 'a', 'c', 0));
    expect(value(connectNodes(base, 'a', 'c', 0))).toBe(base);
  });

  it('rejects cycles, self-feeds, out-of-range slots and input overflow', () => {
    // A real cycle needs targets that accept inputs: combine -> combine back.
    const cyclic: GeneratorGraph = {
      id: 'loop',
      name: 'Loop',
      seed: 0,
      nodes: [
        { id: 'x', kind: 'combine', params: {} },
        { id: 'y', kind: 'combine', params: {} },
      ],
      edges: [],
      output: 'y',
    };
    const wired = value(connectNodes(cyclic, 'x', 'y', 0));
    expect(failure(connectNodes(wired, 'y', 'x', 0)).message).toContain('cycle');

    const base = defaultGeneratorGraph('gen-1');
    // Sources take no inputs, so they are caught before the cycle check.
    expect(failure(connectNodes(base, 'cut', 'noise', 0)).message).toContain('at most 0');
    expect(failure(connectNodes(base, 'noise', 'noise', 0)).message).toContain('cannot feed itself');
    expect(failure(connectNodes(base, 'noise', 'cut', 5)).message).toContain('slot');
    expect(failure(connectNodes(base, 'ghost', 'cut', 0)).code).toBe('invalid-input');
  });

  it('refuses to exceed a node kind\'s input capacity', () => {
    const graph = value(addGraphNode(defaultGeneratorGraph('g'), 'constant'));
    const tid = graph.nodes[graph.nodes.length - 1].id;
    const wired = value(connectNodes(graph, tid, 'cut', 0));
    const overflow = connectNodes(wired, 'noise', 'cut', 1);
    expect(failure(overflow).message).toContain('at most 1');
  });

  it('rejects connecting into an unknown target', () => {
    expect(failure(connectNodes(defaultGeneratorGraph('g'), 'noise', 'ghost', 0)).code).toBe('invalid-input');
  });
});

describe('disconnectNodeInput', () => {
  it('drops the chosen slot and shifts the rest down', () => {
    let graph = value(connectNodes(pairGraph(), 'a', 'c', 0));
    graph = value(connectNodes(graph, 'b', 'c', 1));
    const shortened = value(disconnectNodeInput(graph, 'c', 0));
    expect(shortened.edges).toEqual([{ from: 'b', to: 'c' }]);
    value(validateGeneratorGraph(shortened));
  });

  it('rejects missing slots and unknown targets', () => {
    const graph = value(connectNodes(pairGraph(), 'a', 'c', 0));
    expect(failure(disconnectNodeInput(graph, 'c', 3)).message).toContain('does not exist');
    expect(failure(disconnectNodeInput(graph, 'ghost', 0)).code).toBe('invalid-input');
  });
});

describe('node parameter descriptors', () => {
  it('every registered kind describes unique params with usable defaults', () => {
    const kinds = listGeneratorNodes();
    expect(kinds.length).toBeGreaterThan(0);
    for (const def of kinds) {
      expect(generatorNodes.has(def.id)).toBe(true);
      const keys = def.params.map((p) => p.key);
      expect(new Set(keys).size, `${def.id} duplicate param keys`).toBe(keys.length);
      for (const p of def.params) {
        if (p.type === 'number') {
          expect(Number.isFinite(p.default), `${def.id}.${p.key} default`).toBe(true);
          expect(p.default).toBeGreaterThanOrEqual(p.min);
          expect(p.default).toBeLessThanOrEqual(p.max);
          expect(p.step).toBeGreaterThan(0);
        } else {
          expect(p.options.length, `${def.id}.${p.key} options`).toBeGreaterThan(0);
          expect(
            p.options.some((o) => o.value === p.default),
            `${def.id}.${p.key} default in options`,
          ).toBe(true);
        }
      }
    }
  });
});
