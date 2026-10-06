import { useState } from 'react';
import { createDocument } from '../core/project/schema';
import { CELL_SIZE, DEFAULT_SUBTEXTURE, DEFAULT_IMAGE_RENDER } from '../core/types';
import {
  CANVAS_PRESETS,
  canvasPresetToCells,
  matchCanvasPreset,
  type CanvasPresetId,
} from '../core/canvasPresets';

interface NewProjectModalProps {
  onCreate: (overrides?: Partial<any>) => void;
}

export function NewProjectModal({ onCreate }: NewProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Untitled');
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(24);
  const [presetId, setPresetId] = useState<CanvasPresetId>('custom');

  const applyPreset = (id: CanvasPresetId) => {
    setPresetId(id);
    const preset = CANVAS_PRESETS.find((p) => p.id === id);
    if (preset && id !== 'custom') {
      const cells = canvasPresetToCells(preset);
      setWidth(cells.columns);
      setHeight(cells.rows);
    }
  };

  const setManualWidth = (value: number) => {
    setWidth(value);
    setPresetId(matchCanvasPreset(value, height));
  };

  const setManualHeight = (value: number) => {
    setHeight(value);
    setPresetId(matchCanvasPreset(width, value));
  };

  const handleCreate = () => {
    const doc = createDocument({
      metadata: { name, author: '', description: '', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      canvas: { width, height, background: 0x0c0c10, showGrid: true, snap: false, showGuides: false, margins: { top: 0, right: 0, bottom: 0, left: 0 }, subtexture: { ...DEFAULT_SUBTEXTURE } },
      imageSettings: { ...DEFAULT_IMAGE_RENDER, columns: width },
    });
    onCreate(doc);
    setOpen(false);
  };

  return (
    <>
      <button className="modal-trigger" onClick={() => setOpen(true)}>New Project</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Project</h2>
            <div className="prop-row">
              <label>Name:</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="prop-row">
              <label>Preset:</label>
              <select
                value={presetId}
                onChange={(e) => applyPreset(e.target.value as CanvasPresetId)}
                title="Platform size; snaps to the 8 x 16 cell grid"
              >
                {CANVAS_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="prop-row">
              <label>Width:</label>
              <input type="number" value={width} min="1" max="500" onChange={(e) => setManualWidth(Number(e.target.value))} />
            </div>
            <div className="prop-row">
              <label>Height:</label>
              <input type="number" value={height} min="1" max="500" onChange={(e) => setManualHeight(Number(e.target.value))} />
            </div>
            <div className="prop-row">
              <label>
                Footprint: {width * CELL_SIZE.width} x {height * CELL_SIZE.height} px
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
