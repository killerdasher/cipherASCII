import { useRef, useState } from 'react';
import { useStore } from '../store';
import { fileToImageSource, createImageLayer, isImageFile } from './imageImport';

/**
 * Import images (PNG/JPEG/WebP/BMP) into an image layer, ready for ASCII
 * mapping. Doubles as a drop target so users can drag a picture straight in.
 */
export function useImportImage() {
  const addLayer = useStore((s) => s.addLayer);
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const fitGridToImage = useStore((s) => s.fitGridToImage);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const images = list.filter(isImageFile);
    if (images.length === 0) {
      setError('No supported image found. Use PNG, JPEG, WebP or BMP.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      for (const file of images) {
        const source = await fileToImageSource(file);
        const layer = createImageLayer(source);
        addLayer(layer);
        setActiveLayer(layer.id);
        // Size the grid to the picture so the ASCII covers the same
        // footprint as the source image (8px cells, terminal aspect).
        fitGridToImage(source);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return { importFiles, error, busy };
}

export function ImportImageButton() {
  const { importFiles, error, busy } = useImportImage();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        className="toolbar-btn"
        disabled={busy}
        title={error ?? 'Import image (PNG, JPEG, WebP, BMP)'}
        onClick={() => inputRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {busy ? 'Importing…' : 'Image'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {error && <span className="import-error" title={error}>⚠</span>}
    </>
  );
}

/** Wraps the editor in a drop target so pictures can be dragged in. */
export function ImageDropZone({ children }: { children: React.ReactNode }) {
  const { importFiles } = useImportImage();
  const [over, setOver] = useState(false);

  return (
    <div
      className={`image-dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files);
      }}
    >
      {children}
      {over && (
        <div className="dropzone-overlay">
          <span>Drop image to convert to ASCII</span>
        </div>
      )}
    </div>
  );
}
