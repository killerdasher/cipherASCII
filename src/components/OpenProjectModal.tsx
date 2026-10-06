import { useEffect, useState } from 'react';
import { deserializeProject } from '../core/project/serialize';

interface OpenProjectModalProps {
  onOpen: (doc: any, handle?: any) => void;
}

export function OpenProjectModal({ onOpen }: OpenProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  // File > Open Project... in the native menu (see electron/main.ts).
  useEffect(() => {
    const handleOpenShortcut = () => setOpen(true);
    window.addEventListener('ascii:open', handleOpenShortcut);
    return () => window.removeEventListener('ascii:open', handleOpenShortcut);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] || null);
  };

  const handleOpen = async () => {
    if (!file) return;
    const text = await file.text();
    const result = deserializeProject(text);
    if (result.ok) {
      onOpen(result.value, { name: file.name, data: text });
      setOpen(false);
    } else {
      alert(`Failed to open project: ${result.error.message}`);
    }
  };

  return (
    <>
      <button className="modal-trigger" onClick={() => setOpen(true)}>Open Project</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Open Project</h2>
            <input type="file" accept=".aap,.json" onChange={handleFileSelect} />
            {file && <p>Selected: {file.name}</p>}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleOpen} disabled={!file}>Open</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}