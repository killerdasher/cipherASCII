import { useEffect, useState } from 'react';
import { serializeProject } from '../core/project/serialize';
import type { Document } from '../core/types';
import { useStore } from '../store';
import { getProjectBridge, saveProjectViaDialog } from '../services/projectFiles';

interface SaveProjectModalProps {
  document: Document;
  isDirty: boolean;
}

export function SaveProjectModal({ document, isDirty }: SaveProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'aap' | 'json'>('aap');
  const [error, setError] = useState('');

  // Ctrl+S / Cmd+S (see App.tsx) opens the save dialog.
  useEffect(() => {
    const handleSaveShortcut = () => {
      if (isDirty) setOpen(true);
    };
    window.addEventListener('ascii:save', handleSaveShortcut);
    return () => window.removeEventListener('ascii:save', handleSaveShortcut);
  }, [isDirty]);

  const projectContent = (): string =>
    format === 'aap' ? serializeProject(document) : JSON.stringify(document, null, 2);

  const filename = (): string => `${document.metadata.name || 'ascii-art'}.${format}`;

  const markSaved = () => {
    useStore.getState().markClean();
    setOpen(false);
    setError('');
  };

  const downloadFile = (content: string, name: string) => {
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    markSaved();
  };

  const handleSave = async () => {
    const content = projectContent();
    const bridge = getProjectBridge();
    if (bridge) {
      setError('');
      try {
        const path = await saveProjectViaDialog(filename(), content);
        if (path === null) return; // canceled: keep the dialog open
        useStore.getState().markClean();
        useStore.getState().setStatusMessage(`Saved ${path}`);
        setOpen(false);
      } catch (e) {
        setError(`Failed to save: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
      return;
    }
    downloadFile(content, filename());
  };

  return (
    <>
      {!isDirty ? null : (
        <>
          <button className="modal-trigger" onClick={() => setOpen(true)}>Save Project</button>
          {open && (
            <div className="modal-overlay" onClick={() => setOpen(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h2>Save Project</h2>
                <div className="prop-row">
                  <label>Format:</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
                    <option value="aap">ASCII Art Project (.aap)</option>
                    <option value="json">JSON (.json)</option>
                  </select>
                </div>
                {error && <p role="alert">{error}</p>}
                <div className="modal-actions">
                  <button onClick={() => setOpen(false)}>Cancel</button>
                  <button className="primary" onClick={() => void handleSave()}>Save</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
