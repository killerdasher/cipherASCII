import { useEffect, useState } from 'react';
import { deserializeProject } from '../core/project/serialize';
import { getProjectBridge, openProjectViaDialog } from '../services/projectFiles';

interface OpenProjectModalProps {
  onOpen: (doc: any, handle?: any) => void;
}

export function OpenProjectModal({ onOpen }: OpenProjectModalProps) {
  const [open, setOpen] = useState(false);
  // The pending project, from either picker: the native dialog or the
  // browser <input type=file>. Open always deserializes this one source.
  const [pending, setPending] = useState<{ name: string; data: string } | null>(null);
  const [error, setError] = useState('');
  const native = getProjectBridge() !== null;

  // File > Open Project... in the native menu (see electron/main.ts).
  useEffect(() => {
    const handleOpenShortcut = () => setOpen(true);
    window.addEventListener('ascii:open', handleOpenShortcut);
    return () => window.removeEventListener('ascii:open', handleOpenShortcut);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    void picked.text().then((data) => setPending({ name: picked.name, data }));
  };

  const handleNativePick = async () => {
    setError('');
    try {
      const file = await openProjectViaDialog();
      if (file) setPending(file); // null = canceled, keep the modal open
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    }
  };

  const handleOpen = () => {
    if (!pending) return;
    const result = deserializeProject(pending.data);
    if (result.ok) {
      onOpen(result.value, { name: pending.name, data: pending.data });
      setPending(null);
      setError('');
      setOpen(false);
    } else {
      setError(`Failed to open project: ${result.error.message}`);
    }
  };

  return (
    <>
      <button className="modal-trigger" onClick={() => setOpen(true)}>Open Project</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Open Project</h2>
            {native ? (
              <button className="primary" onClick={() => void handleNativePick()}>
                Choose file…
              </button>
            ) : (
              <input type="file" accept=".aap,.json" onChange={handleFileSelect} />
            )}
            {pending && <p>Selected: {pending.name}</p>}
            {error && <p role="alert">{error}</p>}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleOpen} disabled={!pending}>Open</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
