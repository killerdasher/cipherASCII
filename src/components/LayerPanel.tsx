import { memo } from 'react';
import { useStore } from '../store';
import { createGrid } from '../core/grid';
import type { Layer } from '../core/types';

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string | null;
}

function LayerPanelInner({ layers, activeLayerId }: LayerPanelProps) {
  const { setActiveLayer, addLayer, removeLayer, duplicateLayer, moveLayer, addCreativeLayer } = useStore();

  const handleDragStart = (e: React.DragEvent, layerId: string) => {
    e.dataTransfer.setData('text/plain', layerId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetLayerId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== targetLayerId) {
      const layers = useStore.getState().document.layers;
      const fromIndex = layers.findIndex((l) => l.id === draggedId);
      const toIndex = layers.findIndex((l) => l.id === targetLayerId);
      if (fromIndex >= 0 && toIndex >= 0) moveLayer(draggedId, toIndex);
    }
  };

  return (
    <div className="layer-panel">
      <div className="layer-list">
        {layers.map((layer) => (
          <div
            key={layer.id}
            className={`layer-item ${layer.id === activeLayerId ? 'active' : ''} ${!layer.visible ? 'hidden' : ''} ${layer.locked ? 'locked' : ''}`}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, layer.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, layer.id)}
            onClick={() => setActiveLayer(layer.id)}
            onDoubleClick={() => layer.kind === 'text' && setActiveLayer(layer.id)}
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(e) => {
                e.stopPropagation();
                useStore.getState().updateLayer(layer.id, { visible: e.target.checked });
              }}
              className="layer-visibility"
            />
            <span className="layer-name">{layer.name}</span>
            <span className="layer-kind">{layer.kind}</span>
            {layer.locked && <span className="layer-lock" title="Locked">🔒</span>}
            <div className="layer-actions">
              <button className="layer-btn" onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }} title="Duplicate">⧉</button>
              <button className="layer-btn" onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }} title="Delete">🗑</button>
            </div>
          </div>
        ))}
      </div>
      <div className="layer-footer">
        <button className="layer-add-btn" onClick={() => {
          addLayer({
            id: `layer_${Date.now()}`,
            name: `Layer ${layers.length + 1}`,
            kind: 'ascii',
            visible: true,
            locked: false,
            opacity: 1,
            blend: 'normal',
            x: 0,
            y: 0,
            grid: createGrid(80, 24),
          });
        }}>
          + Add Layer
        </button>
        <button className="layer-add-btn" onClick={() => addCreativeLayer()}>
          ✦ Generative
        </button>
      </div>
    </div>
  );
}

export const LayerPanel = memo(LayerPanelInner);
