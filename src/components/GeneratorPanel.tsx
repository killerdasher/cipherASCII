import { memo, useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  generatorNodes,
  listGeneratorNodes,
  topologicalOrder,
  type GeneratorGraph,
} from '../core/generators/graph';
import {
  addGraphNode,
  connectNodes,
  defaultGeneratorGraph,
  disconnectNodeInput,
  removeGraphNode,
  setGraphOutput,
  setNodeParam,
} from '../core/generators/edit';
import type { Result } from '../core/types';

/**
 * Node-graph editor for the document's generator graphs.
 *
 * Nodes render as cards in dependency order (sources first), which keeps the
 * editor honest inside a 320px dock: input slots are drop-downs listing only
 * nodes earlier in the topological order, so a connection made here can
 * never introduce a cycle - the same guarantee `connectNodes` enforces for
 * programmatic edits. Every commit runs through `upsertGenerator`, which
 * canonicalises the graph and pushes one coalescing undo step.
 */
function GeneratorPanelInner() {
  const generators = useStore((s) => s.document.generators);
  const activeCreativeGraphId = useStore((s) => {
    const layer = s.document.layers.find((l) => l.id === s.document.activeLayerId);
    return layer && layer.kind === 'creative' ? layer.graphId : null;
  });
  const creativeUses = useStore((s) => s.document.layers.filter((l) => l.kind === 'creative').length);
  const fxSeed = useStore((s) => s.document.fxSeed);
  const upsertGenerator = useStore((s) => s.upsertGenerator);
  const removeGenerator = useStore((s) => s.removeGenerator);
  const addCreativeLayer = useStore((s) => s.addCreativeLayer);
  const setStatusMessage = useStore((s) => s.setStatusMessage);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graphId =
    (selectedId && generators.some((g) => g.id === selectedId) ? selectedId : null) ??
    (activeCreativeGraphId && generators.some((g) => g.id === activeCreativeGraphId)
      ? activeCreativeGraphId
      : generators[0]?.id ?? null);
  const graph = generators.find((g) => g.id === graphId) ?? null;
  const order = useMemo(() => (graph ? topologicalOrder(graph) : null), [graph]);

  const commit = (result: Result<GeneratorGraph>) => {
    if (!result.ok) {
      setStatusMessage(result.error.message);
      return;
    }
    upsertGenerator(result.value);
  };

  const createGraph = () => {
    const id = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (upsertGenerator(defaultGeneratorGraph(id, fxSeed))) setSelectedId(id);
  };

  if (generators.length === 0) {
    return (
      <div className="generator-panel">
        <div className="panel-header">
          <h3>Generators</h3>
        </div>
        <div className="gen-empty">
          <p>No generator graphs yet.</p>
          <p className="hint">Graphs turn seeded math into ASCII fields.</p>
          <button onClick={createGraph}>＋ Create starter graph</button>
          <button onClick={() => addCreativeLayer()}>＋ Add generative layer</button>
        </div>
      </div>
    );
  }

  const orderIds = order && order.ok ? order.value : graph ? graph.nodes.map((n) => n.id) : [];
  const orderIndex = new Map(orderIds.map((id, i) => [id, i]));

  return (
    <div className="generator-panel">
      <div className="panel-header">
        <h3>Generators</h3>
        <div className="panel-actions">
          <button onClick={createGraph} title="New graph">＋</button>
          <button
            onClick={() => graphId && removeGenerator(graphId)}
            disabled={!graphId}
            title="Delete graph"
          >
            🗑
          </button>
        </div>
      </div>

      <div className="gen-graph-row">
        <select
          value={graphId ?? ''}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Active generator graph"
        >
          {generators.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name || g.id}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value && graph) commit(addGraphNode(graph, e.target.value));
          }}
          aria-label="Add node"
        >
          <option value="">＋ Node…</option>
          {listGeneratorNodes().map((def) => (
            <option key={def.id} value={def.id}>
              {def.label}
            </option>
          ))}
        </select>
      </div>

      {order && !order.ok && <p className="gen-error">{order.error.message}</p>}

      {graph &&
        orderIds.map((nodeId) => {
          const node = graph.nodes.find((n) => n.id === nodeId);
          if (!node) return null;
          const def = generatorNodes.get(node.kind);
          const inputs = graph.edges.filter((e) => e.to === node.id);
          const myIndex = orderIndex.get(nodeId) ?? 0;
          const candidates = graph.nodes.filter((n) => {
            const idx = orderIndex.get(n.id) ?? 0;
            return n.id !== node.id && idx < myIndex;
          });
          const canAddInput = def ? inputs.length < def.maxInputs : false;
          const needsInput = def ? inputs.length < def.minInputs : false;

          return (
            <div
              key={node.id}
              className={`gen-card${graph.output === node.id ? ' gen-card-output' : ''}`}
            >
              <div className="gen-card-head">
                <span className="gen-kind">{def?.label ?? node.kind}</span>
                {!def && <span className="gen-unknown">unknown kind</span>}
                {graph.output === node.id && <span className="gen-out-badge">output</span>}
                <button
                  className="gen-out-btn"
                  onClick={() => commit(setGraphOutput(graph, node.id))}
                  disabled={graph.output === node.id}
                  title="Use this node's value as the field"
                >
                  ◎
                </button>
                <button
                  className="gen-del-btn"
                  onClick={() => commit(removeGraphNode(graph, node.id))}
                  title="Delete node"
                >
                  ×
                </button>
              </div>

              {inputs.map((edge, slot) => (
                <div className="gen-row" key={`slot-${slot}`}>
                  <span className="gen-row-label">in {slot}</span>
                  <select
                    value={edge.from}
                    onChange={(e) => {
                      if (e.target.value === '') commit(disconnectNodeInput(graph, node.id, slot));
                      else commit(connectNodes(graph, e.target.value, node.id, slot));
                    }}
                    aria-label={`Input ${slot} of ${node.id}`}
                  >
                    <option value="">— disconnect —</option>
                    {candidates.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id} · {generatorNodes.get(n.kind)?.label ?? n.kind}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

              {canAddInput && (
                <div className="gen-row">
                  <span className="gen-row-label">in {inputs.length}</span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value && graph)
                        commit(connectNodes(graph, e.target.value, node.id, inputs.length));
                    }}
                    aria-label={`Connect input ${inputs.length} of ${node.id}`}
                  >
                    <option value="">— connect —</option>
                    {candidates.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id} · {generatorNodes.get(n.kind)?.label ?? n.kind}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {needsInput && <p className="gen-warning">needs {def?.minInputs} input(s)</p>}

              {def?.params.map((p) =>
                p.type === 'select' ? (
                  <div className="gen-row" key={p.key}>
                    <span className="gen-row-label">{p.label}</span>
                    <select
                      value={typeof node.params[p.key] === 'string' ? String(node.params[p.key]) : p.default}
                      onChange={(e) => commit(setNodeParam(graph, node.id, p.key, e.target.value))}
                    >
                      {p.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="gen-param" key={p.key}>
                    <label htmlFor={`param-${node.id}-${p.key}`}>{p.label}</label>
                    <input
                      id={`param-${node.id}-${p.key}`}
                      type="range"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={
                        typeof node.params[p.key] === 'number' ? (node.params[p.key] as number) : p.default
                      }
                      onChange={(e) => {
                        const v = e.target.valueAsNumber;
                        if (Number.isFinite(v)) commit(setNodeParam(graph, node.id, p.key, v));
                      }}
                    />
                  </div>
                ),
              )}
            </div>
          );
        })}

      <p className="gen-hint">
        {creativeUses > 0
          ? `Evaluated for ${creativeUses} generative layer${creativeUses > 1 ? 's' : ''} at canvas size`
          : 'No layer points here yet - add a generative layer to see output'}
      </p>
    </div>
  );
}

export const GeneratorPanel = memo(GeneratorPanelInner);
