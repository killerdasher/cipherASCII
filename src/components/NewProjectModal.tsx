import { useEffect, useState } from 'react';
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

/** "TikTok / Reels - 1080 x 1920" -> "TikTok / Reels" */
const presetTitle = (label: string): string => label.split(' - ')[0];

export function NewProjectModal({ onCreate }: NewProjectModalProps) {
  // Open at launch: the first thing you do is choose the artboard ratio,
  // Canva-style. The toolbar "New Project" button reopens the same picker.
  const [open, setOpen] = useState(true);
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
      // Suggest a document name from the ratio while the name is untouched.
      if (name.trim() === '' || name === 'Untitled') setName(presetTitle(preset.label));
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
          <div className="modal project-modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Project</h2>
            <p className="modal-sub">Start from a platform ratio, or enter your own size.</p>
            <div className="preset-grid" role="radiogroup" aria-label="Canvas presets">
              {CANVAS_PRESETS.filter((p) => p.id !== 'custom').map((p) => {
                const cells = canvasPresetToCells(p);
                const [title, dims] = p.label.split(' - ');
                const selected = presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? 'preset-card selected' : 'preset-card'}
                    onClick={() => applyPreset(p.id)}
                  >
                    <span
                      className="preset-swatch"
                      style={{ aspectRatio: `${p.width} / ${p.height}` }}
                      aria-hidden="true"
                    />
                    <span className="preset-title">{title}</span>
                    <span className="preset-dims">
                      {dims} · {cells.columns}×{cells.rows} cells
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="preset-custom-row">
              <div className="prop-row">
                <label>Name:</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="prop-row">
                <label>Width:</label>
                <input type="number" value={width} min="1" max="500" onChange={(e) => setManualWidth(Number(e.target.value))} />
              </div>
              <div className="prop-row">
                <label>Height:</label>
                <input type="number" value={height} min="1" max="500" onChange={(e) => setManualHeight(Number(e.target.value))} />
              </div>
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
