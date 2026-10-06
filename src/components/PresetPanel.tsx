import { useState } from 'react';
import { useStore, useStoreShallow, selectRenderPresets } from '../store';

export function PresetPanel() {
  const {
    renderPresets,
    saveRenderPreset,
    deleteRenderPreset,
    document,
    effectsPipeline,
    activePaletteId,
  } = useStoreShallow(
    (s) => ({
      renderPresets: selectRenderPresets(s),
      saveRenderPreset: s.saveRenderPreset,
      deleteRenderPreset: s.deleteRenderPreset,
      document: s.document,
      effectsPipeline: s.effectsPipeline,
      activePaletteId: s.activePaletteId,
    })
  );

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [newPresetDesc, setNewPresetDesc] = useState<string>('');

  const handleSave = () => {
    if (!newPresetName.trim()) return;
    saveRenderPreset({
      name: newPresetName,
      description: newPresetDesc,
      imageSettings: document.imageSettings,
      textSettings: document.textSettings,
      exportSettings: document.exportSettings,
      effectsPipeline,
      paletteId: activePaletteId ?? undefined,
      tags: [],
    });
    setNewPresetName('');
    setNewPresetDesc('');
    setShowSaveDialog(false);
  };

  return (
    <div className="preset-panel">
      <div className="panel-header">
        <h3>Render Presets</h3>
        <button onClick={() => setShowSaveDialog(true)}>Save Current as Preset</button>
      </div>

      <div className="preset-list">
        {renderPresets.length === 0 ? (
          <div className="preset-empty">
            <p>No presets saved</p>
            <p className="hint">Configure your settings and click "Save Current as Preset"</p>
          </div>
        ) : (
          renderPresets.map((preset) => (
            <PresetItem
              key={preset.id}
              preset={preset}
              onApply={() => useStore.getState().applyRenderPreset(preset.id)}
              onDelete={() => deleteRenderPreset(preset.id)}
            />
          ))
        )}
      </div>

      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Save Render Preset</h2>
            <div className="prop-row">
              <label>Name:</label>
              <input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="My Awesome Preset"
              />
            </div>
            <div className="prop-row">
              <label>Description:</label>
              <textarea
                value={newPresetDesc}
                onChange={(e) => setNewPresetDesc(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button className="primary" onClick={handleSave} disabled={!newPresetName.trim()}>
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PresetItem({ preset, onApply, onDelete }: { preset: any; onApply: () => void; onDelete: () => void }) {
  return (
    <div className="preset-item">
      <div className="preset-info">
        <div className="preset-name">{preset.name}</div>
        <div className="preset-desc">{preset.description}</div>
        <div className="preset-tags">
          {preset.tags.map((tag: string) => <span key={tag} className="tag">{tag}</span>)}
        </div>
      </div>
      <div className="preset-actions">
        <button onClick={onApply} className="primary">Apply</button>
        <button onClick={onDelete} title="Delete">🗑</button>
      </div>
    </div>
  );
}