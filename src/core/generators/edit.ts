/**
 * Generator graph editing - pure structural operations behind the graph editor.
 *
 * Every helper takes a graph and returns a new one (or an `err` when the
 * operation would break the graph's contract); nothing mutates its input, so
 * the store can push results straight into history. Input slots follow the
 * evaluation contract documented on {@link GeneratorGraph}: the *n*-th edge
 * in `edges` order that targets a node feeds its *n*-th input, which is why
 * {@link connectNodes} inserts at a position, not just at the end.
 *
 * Connections are cycle-checked with the same {@link topologicalOrder} the
 * evaluator uses, so the editor can never produce a graph that refuses to
 * run. Parameter writes type-check against the node kind's descriptor when
 * the kind is registered and stay permissive for unknown kinds - the same
 * repair philosophy as project validation.
 *
 * Pure module: no DOM.
 */

import { err, ok, type Result } from '../types';
import {
  generatorNodes,
  topologicalOrder,
  type GeneratorGraph,
  type GeneratorNode,
  type GeneratorParamValue,
} from './graph';

/** Valid node ids already present in the graph (empty for malformed input). */
function nodeIds(graph: GeneratorGraph): Set<string> {
  const ids = new Set<string>();
  for (const node of graph.nodes ?? []) ids.add(node.id);
  return ids;
}

function nodeById(graph: GeneratorGraph, id: string): GeneratorNode | undefined {
  return (graph.nodes ?? []).find((n) => n.id === id);
}

/** Smallest unused `n1`, `n2`, ... id in the graph. */
function uniqueNodeId(graph: GeneratorGraph): string {
  const ids = nodeIds(graph);
  let i = 1;
  while (ids.has(`n${i}`)) i++;
  return `n${i}`;
}

/**
 * A ready-to-edit starter graph: seeded value noise cut by a soft threshold.
 *
 * This is what a fresh creative layer points at, so the first thing an artist
 * sees is real moving texture rather than an empty canvas.
 *
 * @param id - graph id (the creative layer stores this)
 * @param seed - base evaluation seed
 * @returns a two-node graph whose output is the threshold node
 */
export function defaultGeneratorGraph(id: string, seed = 0): GeneratorGraph {
  return {
    id,
    name: 'Drift',
    seed,
    nodes: [
      {
        id: 'noise',
        kind: 'valueNoise',
        params: { scale: 14, octaves: 3 },
        x: 40,
        y: 56,
      },
      {
        id: 'cut',
        kind: 'threshold',
        params: { threshold: 0.5, softness: 0.12 },
        x: 300,
        y: 56,
      },
    ],
    edges: [{ from: 'noise', to: 'cut' }],
    output: 'cut',
  };
}

/**
 * Append a node of a registered kind with a fresh `n1`, `n2`, ... id.
 *
 * @param graph - graph to extend (unchanged when the result is discarded)
 * @param kind - registered node kind
 * @returns the graph with the node appended, or the first violation found
 */
export function addGraphNode(graph: GeneratorGraph, kind: string): Result<GeneratorGraph> {
  if (!generatorNodes.has(kind)) {
    return err('invalid-input', `unknown generator node kind "${kind}"`);
  }
  const index = graph.nodes.length;
  const node: GeneratorNode = {
    id: uniqueNodeId(graph),
    kind,
    params: {},
    x: 40 + (index % 3) * 260,
    y: 40 + Math.floor(index / 3) * 170,
  };
  return ok({ ...graph, nodes: [...graph.nodes, node] });
}

/**
 * Remove a node together with its edges.
 *
 * Removing the graph's last node is refused (validation requires a non-empty
 * graph). If the removed node was the output, the first remaining node
 * becomes the output so the graph stays evaluable.
 *
 * @param graph - graph to edit
 * @param nodeId - node to remove
 * @returns the graph without the node, or the first violation found
 */
export function removeGraphNode(graph: GeneratorGraph, nodeId: string): Result<GeneratorGraph> {
  if (!nodeById(graph, nodeId)) {
    return err('invalid-input', `node "${nodeId}" is not in this graph`);
  }
  if (graph.nodes.length <= 1) {
    return err('invalid-input', 'a graph needs at least one node');
  }
  const nodes = graph.nodes.filter((n) => n.id !== nodeId);
  const edges = graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  const output = graph.output === nodeId ? nodes[0].id : graph.output;
  return ok({ ...graph, nodes, edges, output });
}

/**
 * Set one parameter on a node.
 *
 * Registered kinds type-check the value against the parameter descriptor:
 * numbers must be finite, selects must name a known option. Unknown kinds
 * accept any key/value (they fail later at evaluation, with a clear message).
 *
 * @param graph - graph to edit
 * @param nodeId - target node
 * @param key - parameter key
 * @param value - replacement value
 * @returns the graph with the parameter set, or the first violation found
 */
export function setNodeParam(
  graph: GeneratorGraph,
  nodeId: string,
  key: string,
  value: GeneratorParamValue,
): Result<GeneratorGraph> {
  const node = nodeById(graph, nodeId);
  if (!node) return err('invalid-input', `node "${nodeId}" is not in this graph`);
  const def = generatorNodes.get(node.kind);
  const paramDef = def?.params.find((p) => p.key === key);
  if (def && !paramDef) {
    return err('invalid-input', `node kind "${node.kind}" has no parameter "${key}"`);
  }
  if (paramDef?.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return err('invalid-input', `parameter "${key}" of node "${nodeId}" must be a finite number`);
    }
  } else if (paramDef?.type === 'select') {
    if (typeof value !== 'string' || !paramDef.options.some((o) => o.value === value)) {
      return err(
        'invalid-input',
        `parameter "${key}" of node "${nodeId}" must be one of: ${paramDef.options.map((o) => o.value).join(', ')}`,
      );
    }
  }
  const nodes = graph.nodes.map((n) =>
    n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n,
  );
  return ok({ ...graph, nodes });
}

/**
 * Point the graph's output at a different node.
 *
 * @param graph - graph to edit
 * @param nodeId - node whose output becomes the field
 * @returns the graph with the new output, or the first violation found
 */
export function setGraphOutput(graph: GeneratorGraph, nodeId: string): Result<GeneratorGraph> {
  if (!nodeById(graph, nodeId)) {
    return err('invalid-input', `node "${nodeId}" is not in this graph`);
  }
  if (graph.output === nodeId) return ok(graph);
  return ok({ ...graph, output: nodeId });
}

/**
 * Wire `from` into input slot `slot` of `to` (replacing the edge already in
 * that slot when there is one).
 *
 * The candidate graph is cycle-checked with the evaluator's own topological
 * order, so a rejected connection is exactly one that would make
 * {@link evaluateGraph} refuse to run. Appending past the target kind's
 * `maxInputs` is refused as well.
 *
 * @param graph - graph to edit
 * @param from - source node id
 * @param to - target node id
 * @param slot - input slot: `0 .. existing input count` (count = append)
 * @returns the re-wired graph, or the first violation found
 */
export function connectNodes(
  graph: GeneratorGraph,
  from: string,
  to: string,
  slot: number,
): Result<GeneratorGraph> {
  const ids = nodeIds(graph);
  if (!ids.has(from)) return err('invalid-input', `node "${from}" is not in this graph`);
  if (!ids.has(to)) return err('invalid-input', `node "${to}" is not in this graph`);
  if (from === to) return err('invalid-input', 'a node cannot feed itself');

  const target = nodeById(graph, to)!;
  const def = generatorNodes.get(target.kind);
  const slotIndices: number[] = [];
  graph.edges.forEach((e, i) => {
    if (e.to === to) slotIndices.push(i);
  });
  if (!Number.isInteger(slot) || slot < 0 || slot > slotIndices.length) {
    return err(
      'invalid-input',
      `input slot must be between 0 and ${slotIndices.length} for node "${to}"`,
    );
  }
  if (def && slot === slotIndices.length && slotIndices.length >= def.maxInputs) {
    return err(
      'invalid-input',
      `node kind "${def.label}" accepts at most ${def.maxInputs} input(s)`,
    );
  }

  const existing = graph.edges[slotIndices[slot]];
  if (existing && existing.from === from) return ok(graph); // already wired there

  const edges = graph.edges.slice();
  const edge = { from, to };
  if (slot < slotIndices.length) edges[slotIndices[slot]] = edge;
  else edges.push(edge);

  const candidate: GeneratorGraph = { ...graph, edges };
  const order = topologicalOrder(candidate);
  if (!order.ok) return err('invalid-input', `connection ${from} -> ${to} would create a cycle`);
  return ok(candidate);
}

/**
 * Remove the edge in input slot `slot` of `to` (the other slots shift down,
 * exactly as evaluation would read them).
 *
 * @param graph - graph to edit
 * @param to - target node id
 * @param slot - zero-based input slot present on the target
 * @returns the graph without that input, or the first violation found
 */
export function disconnectNodeInput(graph: GeneratorGraph, to: string, slot: number): Result<GeneratorGraph> {
  if (!nodeIds(graph).has(to)) return err('invalid-input', `node "${to}" is not in this graph`);
  const slotIndices: number[] = [];
  graph.edges.forEach((e, i) => {
    if (e.to === to) slotIndices.push(i);
  });
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotIndices.length) {
    return err(
      'invalid-input',
      `node "${to}" has ${slotIndices.length} input(s); slot ${slot} does not exist`,
    );
  }
  const edges = graph.edges.slice();
  edges.splice(slotIndices[slot], 1);
  return ok({ ...graph, edges });
}
