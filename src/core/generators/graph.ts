/**
 * Generator graphs - deterministic procedural fields as editable node graphs.
 *
 * A graph is pure data ({@link GeneratorGraph}) that can live inside a project
 * document: nodes are small typed operations, edges carry data from an output
 * slot into the *n*-th input slot of another node (input order = edge order in
 * the `edges` array), and `output` names the node whose result is the field.
 *
 * Two phases keep editing safe:
 *
 * - {@link validateGeneratorGraph} checks structure (unique ids, no dangling
 *   edges, no cycles, resolvable output) and keeps unknown node kinds, exactly
 *   like the cell-effect stack keeps unknown effect ids - a project saved by a
 *   newer build still loads. {@link canonicalGeneratorGraph} is what the
 *   serializer uses to drop irreparable graphs.
 * - {@link evaluateGraph} runs the graph in topological order and refuses
 *   unknown kinds / impossible wiring with an `invalid-input` result.
 *
 * Evaluation is seeded and allocation-stable: the same graph, seed and size
 * always produce byte-identical fields.
 *
 * Pure module: no DOM.
 */

import { Registry } from '../registry';
import { err, ok, type Result } from '../types';
import { clamp, hashString } from '../util';
import { fieldCacheKey, fieldFromData, type AnalysisField } from '../analysis/field';

export type GeneratorParamValue = number | string | boolean;
export type GeneratorParams = Record<string, GeneratorParamValue>;

export interface GeneratorNode {
  /** Unique within the graph; also the salt for seeded evaluation. */
  id: string;
  /** Registered node kind; unknown kinds are kept but fail at evaluation. */
  kind: string;
  params: GeneratorParams;
  /** Editor canvas position (pure UI state, ignored by evaluation). */
  x?: number;
  y?: number;
}

export interface GeneratorEdge {
  from: string;
  to: string;
}

export interface GeneratorGraph {
  id: string;
  name: string;
  /** Base evaluation seed; overridden by `GraphEvalContext.seed`. */
  seed: number;
  nodes: GeneratorNode[];
  edges: GeneratorEdge[];
  /** Id of the node whose output becomes the field. */
  output: string;
}

export interface GeneratorNodeContext {
  /** Input buffers, ordered by the edges targeting this node. */
  inputs: Float32Array[];
  params: GeneratorParams;
  width: number;
  height: number;
  /** Seed already salted with the node id; identical inputs repeat exactly. */
  seed: number;
}

/** Numeric parameter of a node kind: editable from the graph editor. */
export interface GeneratorParamNumberDef {
  key: string;
  label: string;
  type: 'number';
  min: number;
  max: number;
  step: number;
  /** Same fallback the node's `evaluate` uses when the key is absent. */
  default: number;
}

/** Enumerated parameter of a node kind (drop-down in the graph editor). */
export interface GeneratorParamSelectDef {
  key: string;
  label: string;
  type: 'select';
  default: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

export type GeneratorParamDef = GeneratorParamNumberDef | GeneratorParamSelectDef;

export interface GeneratorNodeDef {
  id: string;
  label: string;
  description: string;
  /** Fewest input slots the node reads; 0 for sources. */
  minInputs: number;
  /** Most input slots the node reads; `Infinity` for reducers. */
  maxInputs: number;
  /**
   * Editable parameters in editor order. The keys mirror what `evaluate`
   * reads; defaults mirror its fallbacks, so an empty `params` object and an
   * explicitly-defaulted one behave identically.
   */
  params: readonly GeneratorParamDef[];
  evaluate(ctx: GeneratorNodeContext): Result<Float32Array>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numParam(ctx: GeneratorNodeContext, key: string, fallback: number): number {
  const v = ctx.params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function strParam(ctx: GeneratorNodeContext, key: string, fallback: string): string {
  const v = ctx.params[key];
  return typeof v === 'string' ? v : fallback;
}

function fill(width: number, height: number, value: number): Float32Array {
  const out = new Float32Array(width * height);
  out.fill(value);
  return out;
}

/** Deterministic lattice value in 0..1 for an integer coordinate + seed. */
function latticeHash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise at continuous coordinates. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const tx = fx * fx * (3 - 2 * fx);
  const ty = fy * fy * (3 - 2 * fy);
  const a = latticeHash(ix, iy, seed);
  const b = latticeHash(ix + 1, iy, seed);
  const c = latticeHash(ix, iy + 1, seed);
  const d = latticeHash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

// ---------------------------------------------------------------------------
// Built-in node kinds
// ---------------------------------------------------------------------------

const constantNode: GeneratorNodeDef = {
  id: 'constant',
  label: 'Constant',
  description: 'Fills the field with a single value.',
  minInputs: 0,
  maxInputs: 0,
  params: [{ key: 'value', label: 'Value', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 }],
  evaluate(ctx) {
    return ok(fill(ctx.width, ctx.height, numParam(ctx, 'value', 0.5)));
  },
};

const gradientNode: GeneratorNodeDef = {
  id: 'gradient',
  label: 'Gradient',
  description: 'Linear ramp from `from` to `to` along the x or y axis.',
  minInputs: 0,
  maxInputs: 0,
  params: [
    {
      key: 'axis',
      label: 'Axis',
      type: 'select',
      default: 'x',
      options: [
        { value: 'x', label: 'Horizontal' },
        { value: 'y', label: 'Vertical' },
      ],
    },
    { key: 'from', label: 'From', type: 'number', min: -1, max: 2, step: 0.01, default: 0 },
    { key: 'to', label: 'To', type: 'number', min: -1, max: 2, step: 0.01, default: 1 },
  ],
  evaluate(ctx) {
    const axis = strParam(ctx, 'axis', 'x');
    if (axis !== 'x' && axis !== 'y') {
      return err('invalid-input', `gradient axis must be "x" or "y", got "${axis}"`);
    }
    const from = numParam(ctx, 'from', 0);
    const to = numParam(ctx, 'to', 1);
    const out = new Float32Array(ctx.width * ctx.height);
    const spanX = ctx.width > 1 ? ctx.width - 1 : 1;
    const spanY = ctx.height > 1 ? ctx.height - 1 : 1;
    for (let y = 0; y < ctx.height; y++) {
      for (let x = 0; x < ctx.width; x++) {
        const t = axis === 'x' ? x / spanX : y / spanY;
        out[y * ctx.width + x] = from + (to - from) * t;
      }
    }
    return ok(out);
  },
};

const valueNoiseNode: GeneratorNodeDef = {
  id: 'valueNoise',
  label: 'Value noise',
  description: 'Smooth seeded noise; `scale` is the feature size in cells, `octaves` adds detail.',
  minInputs: 0,
  maxInputs: 0,
  params: [
    { key: 'scale', label: 'Scale (cells)', type: 'number', min: 0.5, max: 64, step: 0.5, default: 16 },
    { key: 'octaves', label: 'Octaves', type: 'number', min: 1, max: 6, step: 1, default: 1 },
    { key: 'seed', label: 'Seed', type: 'number', min: -9999, max: 9999, step: 1, default: 0 },
  ],
  evaluate(ctx) {
    const scale = Math.max(0.5, numParam(ctx, 'scale', 16));
    const octaves = clamp(Math.round(numParam(ctx, 'octaves', 1)), 1, 6);
    const seed = Math.round(numParam(ctx, 'seed', 0)) ^ ctx.seed;
    const out = new Float32Array(ctx.width * ctx.height);
    let amplitude = 1;
    let frequency = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      for (let y = 0; y < ctx.height; y++) {
        const ny = (y * frequency) / scale;
        for (let x = 0; x < ctx.width; x++) {
          out[y * ctx.width + x] += amplitude * valueNoise((x * frequency) / scale, ny, seed + o);
        }
      }
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    if (total > 0) {
      for (let i = 0; i < out.length; i++) out[i] /= total;
    }
    return ok(out);
  },
};

const thresholdNode: GeneratorNodeDef = {
  id: 'threshold',
  label: 'Threshold',
  description: 'Cuts the input at `threshold`; `softness` widens the cut into a ramp.',
  minInputs: 1,
  maxInputs: 1,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'softness', label: 'Softness', type: 'number', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  evaluate(ctx) {
    const input = ctx.inputs[0];
    const t = numParam(ctx, 'threshold', 0.5);
    const softness = Math.max(0, numParam(ctx, 'softness', 0));
    const out = new Float32Array(input.length);
    if (softness <= 0) {
      for (let i = 0; i < input.length; i++) out[i] = input[i] >= t ? 1 : 0;
      return ok(out);
    }
    const lo = t - softness / 2;
    for (let i = 0; i < input.length; i++) {
      const u = clamp((input[i] - lo) / softness, 0, 1);
      out[i] = u * u * (3 - 2 * u);
    }
    return ok(out);
  },
};

const COMBINE_MODES = new Set(['add', 'subtract', 'multiply', 'min', 'max']);

const combineNode: GeneratorNodeDef = {
  id: 'combine',
  label: 'Combine',
  description:
    'Reduces two or more inputs left-to-right with `mode`: add, subtract, multiply, min or max.',
  minInputs: 2,
  maxInputs: Number.POSITIVE_INFINITY,
  params: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'add',
      options: [
        { value: 'add', label: 'Add' },
        { value: 'subtract', label: 'Subtract' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
      ],
    },
  ],
  evaluate(ctx) {
    const mode = strParam(ctx, 'mode', 'add');
    if (!COMBINE_MODES.has(mode)) {
      return err('invalid-input', `combine mode must be add, subtract, multiply, min or max, got "${mode}"`);
    }
    const first = ctx.inputs[0];
    const out = new Float32Array(first);
    for (let k = 1; k < ctx.inputs.length; k++) {
      const next = ctx.inputs[k];
      for (let i = 0; i < out.length; i++) {
        const a = out[i];
        const b = next[i];
        if (mode === 'add') out[i] = clamp(a + b, 0, 1);
        else if (mode === 'subtract') out[i] = clamp(a - b, 0, 1);
        else if (mode === 'multiply') out[i] = a * b;
        else if (mode === 'min') out[i] = a < b ? a : b;
        else out[i] = a > b ? a : b;
      }
    }
    return ok(out);
  },
};

/** Registry of the node kinds a graph may use. */
export const generatorNodes = new Registry<GeneratorNodeDef>('generator node');

generatorNodes.registerAll([constantNode, gradientNode, valueNoiseNode, thresholdNode, combineNode]);

/** Known node kinds in registration order (for graph-editor palettes). */
export function listGeneratorNodes(): GeneratorNodeDef[] {
  return generatorNodes.list();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function canonicalParams(value: unknown): GeneratorParams {
  if (!isPlainObject(value)) return {};
  const params: GeneratorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) params[key] = entry;
    else if (typeof entry === 'string' || typeof entry === 'boolean') params[key] = entry;
  }
  return params;
}

function canonicalNode(value: unknown): GeneratorNode | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.kind !== 'string' || value.kind.length === 0) return null;
  const node: GeneratorNode = {
    id: value.id,
    kind: value.kind,
    params: canonicalParams(value.params),
  };
  if (typeof value.x === 'number' && Number.isFinite(value.x)) node.x = value.x;
  if (typeof value.y === 'number' && Number.isFinite(value.y)) node.y = value.y;
  return node;
}

/**
 * Validate and canonicalise an unknown value as a {@link GeneratorGraph}.
 *
 * Structural checks only: unique non-empty node ids, every edge resolving to
 * two existing nodes, a non-empty node set and an `output` naming one of
 * them. Unknown node kinds are kept (they fail only at evaluation) and
 * malformed params are repaired field by field, so a hand-edited project
 * repairs instead of exploding.
 *
 * @param raw - candidate graph, typically from `JSON.parse`
 * @returns the canonical graph, or the first structural violation found
 */
export function validateGeneratorGraph(raw: unknown): Result<GeneratorGraph> {
  if (!isPlainObject(raw)) return err('invalid-input', 'generator graph must be an object');
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return err('invalid-input', 'generator graph id must be a non-empty string');
  }
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return err('invalid-input', 'generator graph must contain at least one node');
  }
  if (!Array.isArray(raw.edges)) return err('invalid-input', 'generator graph edges must be an array');
  if (typeof raw.output !== 'string' || raw.output.length === 0) {
    return err('invalid-input', 'generator graph output must name a node');
  }

  const nodes: GeneratorNode[] = [];
  const seen = new Set<string>();
  for (const entry of raw.nodes) {
    const node = canonicalNode(entry);
    if (!node) return err('invalid-input', 'generator graph contains a malformed node');
    if (seen.has(node.id)) return err('invalid-input', `duplicate generator node id "${node.id}"`);
    seen.add(node.id);
    nodes.push(node);
  }

  const edges: GeneratorEdge[] = [];
  for (const entry of raw.edges) {
    if (!isPlainObject(entry) || typeof entry.from !== 'string' || typeof entry.to !== 'string') {
      return err('invalid-input', 'generator graph contains a malformed edge');
    }
    if (!seen.has(entry.from) || !seen.has(entry.to)) {
      return err('invalid-input', `generator edge "${entry.from}" -> "${entry.to}" references an unknown node`);
    }
    edges.push({ from: entry.from, to: entry.to });
  }

  if (!seen.has(raw.output)) {
    return err('invalid-input', `generator output "${raw.output}" is not a node in this graph`);
  }

  const graph: GeneratorGraph = {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : '',
    seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? Math.trunc(raw.seed) : 0,
    nodes,
    edges,
    output: raw.output,
  };

  const order = topologicalOrder(graph);
  if (!order.ok) return err(order.error.code, order.error.message);
  return ok(graph);
}

/** Canonical form of a candidate graph, or `null` when it cannot be repaired. */
export function canonicalGeneratorGraph(raw: unknown): GeneratorGraph | null {
  const result = validateGeneratorGraph(raw);
  return result.ok ? result.value : null;
}

/**
 * Kahn topological sort of the graph's nodes.
 *
 * Ties resolve in node-declaration order, so a given graph always evaluates
 * in the same sequence.
 *
 * @param graph - graph to order (assumes unique node ids)
 * @returns node ids in dependency order, or `err` when a cycle exists
 */
export function topologicalOrder(graph: GeneratorGraph): Result<string[]> {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of graph.nodes) indegree.set(node.id, 0);
  for (const edge of graph.edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) {
      return err('invalid-input', `generator edge "${edge.from}" -> "${edge.to}" references an unknown node`);
    }
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const list = outgoing.get(edge.from);
    if (list) list.push(edge.to);
    else outgoing.set(edge.from, [edge.to]);
  }

  const queue = graph.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  if (order.length !== graph.nodes.length) {
    const stuck = graph.nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return err('invalid-input', `generator graph contains a cycle through ${stuck.join(', ')}`);
  }
  return ok(order);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface GraphEvalContext {
  /** Field columns (> 0). */
  width: number;
  /** Field rows (> 0). */
  height: number;
  /** Overrides `graph.seed` (the document's animation seed, for instance). */
  seed?: number;
}

/**
 * Evaluate a graph into a single analysis field.
 *
 * Nodes run in topological order; each node's inputs are the buffers of the
 * edges targeting it, in `edges` array order. Unknown node kinds, missing
 * inputs and input-count violations come back as `err('invalid-input', ...)`.
 * Nothing throws.
 *
 * @param graph - graph to run; pass it through {@link validateGeneratorGraph}
 * first when it came from a file or the UI
 * @param ctx - output size and optional seed override
 * @returns the produced field, or the first failure encountered
 */
export function evaluateGraph(graph: GeneratorGraph, ctx: GraphEvalContext): Result<AnalysisField> {
  try {
    if (!Number.isInteger(ctx.width) || ctx.width <= 0) {
      return err('invalid-input', `generator field width must be a positive integer, got ${ctx.width}`);
    }
    if (!Number.isInteger(ctx.height) || ctx.height <= 0) {
      return err('invalid-input', `generator field height must be a positive integer, got ${ctx.height}`);
    }
    const ordered = topologicalOrder(graph);
    if (!ordered.ok) return ordered;

    const byId = new Map<string, GeneratorNode>();
    for (const node of graph.nodes) byId.set(node.id, node);
    if (!byId.has(graph.output)) {
      return err('invalid-input', `generator output "${graph.output}" is not a node in this graph`);
    }

    // Input slots of a node, in `edges` array order: `slot k` of node T is the
    // (k+1)-th edge whose `to` is T.
    const inputSources = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const slots = inputSources.get(edge.to);
      if (slots) slots.push(edge.from);
      else inputSources.set(edge.to, [edge.from]);
    }

    const baseSeed = Math.trunc(ctx.seed ?? graph.seed) | 0;
    const outputs = new Map<string, Float32Array>();

    for (const id of ordered.value) {
      const node = byId.get(id)!;
      const def = generatorNodes.get(node.kind);
      if (!def) {
        return err('invalid-input', `unknown generator node kind "${node.kind}" at node "${id}"`);
      }
      const sources = inputSources.get(id) ?? [];
      if (sources.length < def.minInputs) {
        return err(
          'invalid-input',
          `generator node "${id}" needs ${def.minInputs} input(s) but has ${sources.length}`,
        );
      }
      if (sources.length > def.maxInputs) {
        return err(
          'invalid-input',
          `generator node "${id}" accepts ${def.maxInputs} input(s) but has ${sources.length}`,
        );
      }
      const slots: Float32Array[] = [];
      for (const source of sources) {
        const produced = outputs.get(source);
        if (!produced) {
          return err('invalid-input', `generator node "${id}" reads input "${source}" before it is produced`);
        }
        slots.push(produced);
      }
      const nodeSeed = (baseSeed ^ (parseInt(hashString(node.id), 36) | 0)) | 0;
      const result = def.evaluate({
        inputs: slots,
        params: node.params,
        width: ctx.width,
        height: ctx.height,
        seed: nodeSeed,
      });
      if (!result.ok) return err(result.error.code, `generator node "${id}": ${result.error.message}`);
      outputs.set(id, result.value);
    }

    const data = outputs.get(graph.output)!;
    return ok(
      fieldFromData(
        graph.name.length > 0 ? graph.name : graph.id,
        ctx.width,
        ctx.height,
        data,
        fieldCacheKey(`generator:${graph.id}`, {
          graph,
          width: ctx.width,
          height: ctx.height,
          seed: baseSeed,
        }),
      ),
    );
  } catch (e) {
    return err('internal', 'Failed to evaluate generator graph', e instanceof Error ? e.message : String(e));
  }
}

