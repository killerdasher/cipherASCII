import { memo } from 'react';
import { useStore, useStoreShallow } from '../store';
import type { DitherId, Layer, LayerBlend, MappingId } from '../core/types';
import { LAYER_BLENDS } from '../core/layer/blends';
import { listDitherAlgorithms } from '../core/dither';
import { listMappingStrategies } from '../core/mapping';
import { Slider } from './Slider';

interface PropertyPanelProps {
  layer: Layer | null;
}

function PropertyPanelInner({ layer }: PropertyPanelProps) {
  // Hooks run before any early return so React always sees the same hook order.
  const { updateLayer, updateCreativeLayer, setActiveRightPanel } = useStoreShallow((s) => ({
    updateLayer: s.updateLayer,
    updateCreativeLayer: s.updateCreativeLayer,
    setActiveRightPanel: s.setActiveRightPanel,
  }));
  const generators = useStore((s) => s.document.generators);
  const mappingStrategies = listMappingStrategies();
  const dithers = listDitherAlgorithms();

  if (!layer) return <div className="property-panel">No layer selected</div>;

  const blendId = layer.blend ?? 'normal';
  const blendOption = LAYER_BLENDS.find((b) => b.id === blendId) ?? LAYER_BLENDS[0];

  return (
    <div className="property-panel">
      <h3>Layer Properties</h3>
      <div className="prop-row">
        <label>Name:</label>
        <input
          value={layer.name}
          onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
        />
      </div>
      <div className="prop-row">
        <label>Visible:</label>
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={(e) => updateLayer(layer.id, { visible: e.target.checked })}
        />
      </div>
      <div className="prop-row">
        <label>Locked:</label>
        <input
          type="checkbox"
          checked={layer.locked}
          onChange={(e) => updateLayer(layer.id, { locked: e.target.checked })}
        />
      </div>
      <Slider
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        step={0.05}
        display={`${Math.round(layer.opacity * 100)}%`}
        onChange={(v) => updateLayer(layer.id, { opacity: v })}
      />
      <div className="prop-row">
        <label>Blend:</label>
        <select
          value={blendId}
          title={blendOption.description}
          onChange={(e) => updateLayer(layer.id, { blend: e.target.value as LayerBlend })}
        >
          {LAYER_BLENDS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <label>X Offset:</label>
        <input
          type="number"
          value={layer.x}
          onChange={(e) => updateLayer(layer.id, { x: Number(e.target.value) })}
        />
      </div>
      <div className="prop-row">
        <label>Y Offset:</label>
        <input
          type="number"
          value={layer.y}
          onChange={(e) => updateLayer(layer.id, { y: Number(e.target.value) })}
        />
      </div>

      {layer.kind === 'text' && (
        <div className="prop-section">
          <h4>Text Settings</h4>
          <textarea
            value={(layer as any).text || ''}
            onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
            rows={4}
            placeholder="Enter text..."
          />
        </div>
      )}

      {layer.kind === 'image' && (
        <div className="prop-section">
          <h4>Image Source</h4>
          <p>{layer.source?.name || 'No image loaded'}</p>
        </div>
      )}

      {layer.kind === 'creative' && (
        <div className="prop-section">
          <h4>Generative</h4>
          <div className="prop-row">
            <label>Graph:</label>
            <select
              value={layer.graphId}
              onChange={(e) => updateCreativeLayer(layer.id, { graphId: e.target.value })}
            >
              {generators.length === 0 && <option value={layer.graphId}>(no graphs)</option>}
              {generators.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name || g.id}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <label>Mapping:</label>
            <select
              value={layer.render.mapping.strategy}
              title="How the field becomes ink before dithering and glyph selection"
              onChange={(e) =>
                updateCreativeLayer(layer.id, {
                  render: {
                    ...layer.render,
                    mapping: { ...layer.render.mapping, strategy: e.target.value as MappingId },
                  },
                })
              }
            >
              {mappingStrategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <label>Dither:</label>
            <select
              value={layer.render.dither}
              onChange={(e) =>
                updateCreativeLayer(layer.id, {
                  render: { ...layer.render, dither: e.target.value as DitherId },
                })
              }
            >
              <option value="none">None</option>
              {dithers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <label>Invert:</label>
            <input
              type="checkbox"
              checked={layer.render.output.invert}
              onChange={(e) =>
                updateCreativeLayer(layer.id, {
                  render: {
                    ...layer.render,
                    output: { ...layer.render.output, invert: e.target.checked },
                  },
                })
              }
            />
          </div>
          <Slider
            label="Density"
            value={layer.render.output.density}
            min={0.1}
            max={3}
            step={0.1}
            display={layer.render.output.density.toFixed(1)}
            onChange={(v) =>
              updateCreativeLayer(layer.id, {
                render: { ...layer.render, output: { ...layer.render.output, density: v } },
              })
            }
          />
          <Slider
            label="Glyph offset"
            value={layer.render.output.offset}
            min={-10}
            max={10}
            step={1}
            onChange={(v) =>
              updateCreativeLayer(layer.id, {
                render: { ...layer.render, output: { ...layer.render.output, offset: v } },
              })
            }
          />
          <button
            className="gen-edit-link"
            onClick={() => setActiveRightPanel('generators')}
            title="Open the node graph editor"
          >
            Edit node graph…
          </button>
        </div>
      )}
    </div>
  );
}

export const PropertyPanel = memo(PropertyPanelInner);
