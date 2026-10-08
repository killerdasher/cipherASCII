import { memo } from 'react';
import { useStore } from '../store';
import type { Layer, LayerBlend } from '../core/types';
import { LAYER_BLENDS } from '../core/layer/blends';
import { Slider } from './Slider';

interface PropertyPanelProps {
  layer: Layer | null;
}

function PropertyPanelInner({ layer }: PropertyPanelProps) {
  // Hooks run before any early return so React always sees the same hook order.
  const { updateLayer } = useStore();

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
    </div>
  );
}

export const PropertyPanel = memo(PropertyPanelInner);
