import { useEffect, useState } from 'react';
import { serializeProject } from '../core/project/serialize';
import type { Document } from '../core/types';

interface SaveProjectModalProps {
  document: Document;
  isDirty: boolean;
}

export function SaveProjectModal({ document, isDirty }: SaveProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'aap' | 'json'>('aap');

  // Ctrl+S / Cmd+S (see App.tsx) opens the save dialog.
  useEffect(() => {
    const handleSaveShortcut = () => {
      if (isDirty) setOpen(true);
    };
    window.addEventListener('ascii:save', handleSaveShortcut);
    return () => window.removeEventListener('ascii:save', handleSaveShortcut);
  }, [isDirty]);

  const handleSave = () => {
    if (format === 'aap') {
      const data = serializeProject(document);
      downloadFile(data, `${document.metadata.name || 'ascii-art'}.aap`);
    } else {
      const data = JSON.stringify(document, null, 2);
      downloadFile(data, `${document.metadata.name || 'ascii-art'}.json`);
    }
    setOpen(false);
  };

  const downloadFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
                <div className="modal-actions">
                  <button onClick={() => setOpen(false)}>Cancel</button>
                  <button className="primary" onClick={handleSave}>Save</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}