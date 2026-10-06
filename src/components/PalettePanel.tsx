import { useEffect, useRef, useState } from 'react';
import { useStore, useStoreShallow, selectPalettes, selectActivePaletteId } from '../store';
import type { Palette } from '../core/types';
import { createPalette, sortPalette, importPaletteFromText, extractPalette } from '../core/palette/palette';
import { decodeImage } from '../worker/client';

/** The auto-palette feature promises the 5 dominant colours of the image. */
const AUTO_PALETTE_COLORS = 5;

function PaletteItem({
  palette,
  isActive,
  onActivate,
  onDelete,
  onExport,
  onSort,
}: {
  palette: Palette;
  isActive: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onSort: (mode: 'luminance' | 'hue' | 'saturation') => void;
}) {
  return (
    <div className={`palette-item ${isActive ? 'active' : ''}`} onClick={onActivate}>
      <div className="palette-swatch">
        {palette.colors.slice(0, 8).map((c, i) => (
          <div key={i} className="swatch-color" style={{ backgroundColor: `#${c.rgb.toString(16).padStart(6, '0')}` }} />
        ))}
      </div>
      <div className="palette-info">
        <div className="palette-name">{palette.name}</div>
        <div className="palette-meta">{palette.colors.length} colors · {palette.source}</div>
      </div>
      <div className="palette-actions">
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} title="Export">⬇</button>
        <button onClick={(e) => { e.stopPropagation(); onSort('luminance'); }} title="Sort by Luminance">⬍</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">🗑</button>
      </div>
    </div>
  );
}

export function PalettePanel() {
  const {
    palettes,
    activePaletteId,
    addPalette,
    removePalette,
    updatePalette,
  } = useStoreShallow(
    (s) => ({
      palettes: selectPalettes(s),
      activePaletteId: selectActivePaletteId(s),
      addPalette: s.addPalette,
      removePalette: s.removePalette,
      updatePalette: s.updatePalette,
    })
  );

  const activePalette = palettes.find((p) => p.id === activePaletteId);
  const [newPaletteName, setNewPaletteName] = useState('');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Newly created / extracted palettes are appended, so keep the active one
  // visible instead of leaving the user to hunt for it.
  useEffect(() => {
    const el = listRef.current?.querySelector('.palette-item.active');
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' });
  }, [activePaletteId]);

  const handleExtractFromImage = async () => {
    const state = useStore.getState();
    const activeLayer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
    if (!activeLayer || activeLayer.kind !== 'image' || !activeLayer.source) {
      alert('No image layer selected');
      return;
    }
    setExtracting(true);
    try {
      const raster = await decodeImage(activeLayer.source.dataUrl);
      const palette = extractPalette(raster, { maxColors: AUTO_PALETTE_COLORS });
      if (palette.colors.length === 0) {
        alert('No opaque pixels found in the image');
        return;
      }
      palette.name = `${activeLayer.name} · ${palette.colors.length} colors`;
      palette.colors = palette.colors.map((c) => ({
        ...c,
        name: `#${c.rgb.toString(16).padStart(6, '0')}`,
      }));
      addPalette(palette);
      useStore.getState().setActivePalette(palette.id);
    } catch (e) {
      alert(`Failed to extract palette: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExtracting(false);
    }
  };

  const handleCreatePalette = () => {
    if (!newPaletteName.trim()) return;
    const palette = createPalette(newPaletteName.trim(), [
      { rgb: 0x000000, name: 'Black' },
      { rgb: 0xffffff, name: 'White' },
      { rgb: 0xff0000, name: 'Red' },
      { rgb: 0x00ff00, name: 'Green' },
      { rgb: 0x0000ff, name: 'Blue' },
    ]);
    addPalette(palette);
    setNewPaletteName('');
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      const palette = importPaletteFromText(importText);
      addPalette(palette);
      setImportText('');
      setShowImport(false);
    } catch {
      alert('Failed to import palette');
    }
  };

  const handleExport = (palette: Palette) => {
    const text = palette.colors.map((c) => `#${c.rgb.toString(16).padStart(6, '0')}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${palette.name.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (paletteId: string, mode: 'luminance' | 'hue' | 'saturation') => {
    const palette = palettes.find((p) => p.id === paletteId);
    if (palette) {
      updatePalette(paletteId, sortPalette(palette, mode));
    }
  };

  return (
    <div className="palette-panel">
      <div className="panel-header">
        <h3>Palettes</h3>
        <div className="panel-actions">
          <button onClick={() => setShowImport(true)}>Import</button>
        </div>
      </div>

      <div className="palette-list" ref={listRef}>
        {palettes.map((palette) => (
          <PaletteItem
            key={palette.id}
            palette={palette}
            isActive={palette.id === useStore.getState().activePaletteId}
            onActivate={() => useStore.getState().setActivePalette(palette.id)}
            onDelete={() => removePalette(palette.id)}
            onExport={() => handleExport(palette)}
            onSort={(mode) => handleSort(palette.id, mode)}
          />
        ))}
      </div>

      <div className="palette-create">
        <h4>Create New Palette</h4>
        <div className="prop-row">
          <input
            type="text"
            placeholder="Palette name"
            value={newPaletteName}
            onChange={(e) => setNewPaletteName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreatePalette()}
          />
          <button onClick={handleCreatePalette} disabled={!newPaletteName.trim()}>
            Create
          </button>
        </div>
        <button
          onClick={() => void handleExtractFromImage()}
          disabled={extracting}
          title="Quantise the active image layer to its 5 dominant colours and add it as a palette"
        >
          {extracting ? 'Extracting…' : `Auto Palette · ${AUTO_PALETTE_COLORS} Colors`}
        </button>
      </div>

      {showImport && (
        <div className="palette-import">
          <h4>Import Palette</h4>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste hex colors (one per line): #ff0000&#10;#00ff00&#10;#0000ff"
            rows={5}
          />
          <div className="modal-actions">
            <button onClick={() => setShowImport(false)}>Cancel</button>
            <button className="primary" onClick={handleImport}>Import</button>
          </div>
        </div>
      )}

      {activePaletteId && (
        <div className="active-palette-editor">
          <h4>Editing: {activePalette?.name}</h4>
          <div className="palette-colors">
            {activePalette?.colors.map((color, index) => (
              <div key={`${activePaletteId}-${index}`} className="palette-color-item">
                <input
                  type="color"
                  value={`#${color.rgb.toString(16).padStart(6, '0')}`}
                  onChange={(e) => updatePalette(activePaletteId!, {
                    colors: activePalette!.colors.map((c, i) => i === index ? { ...c, rgb: parseInt(e.target.value.slice(1), 16) } : c)
                  })}
                />
                <input
                  type="text"
                  value={color.name || ''}
                  placeholder="Name"
                  onChange={(e) => updatePalette(activePaletteId!, {
                    colors: activePalette!.colors.map((c, i) => i === index ? { ...c, name: e.target.value } : c)
                  })}
                />
                <button onClick={() => updatePalette(activePaletteId!, {
                  colors: activePalette!.colors.filter((_, i) => i !== index)
                })}>✕</button>
              </div>
            ))}
            <button onClick={() => updatePalette(activePaletteId!, {
              colors: [...(activePalette?.colors || []), { rgb: 0xffffff, name: `Color ${(activePalette?.colors.length || 0) + 1}` }]
            })}>+ Add Color</button>
          </div>
          <div className="palette-actions">
            <button onClick={() => updatePalette(activePaletteId!, sortPalette(activePalette!, 'luminance'))}>Sort by Luminance</button>
            <button onClick={() => updatePalette(activePaletteId!, sortPalette(activePalette!, 'hue'))}>Sort by Hue</button>
            <button onClick={() => updatePalette(activePaletteId!, sortPalette(activePalette!, 'saturation'))}>Sort by Saturation</button>
          </div>
        </div>
      )}
    </div>
  );
}