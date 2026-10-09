import { useRef, useState, memo } from 'react';
import { useStore } from '../store';
import { listExporters, runExport, renderExportFrame } from '../core/export';
import { drawGridToContext, type CanvasLike } from '../core/export/png';
import { VIDEO_FORMATS } from '../core/export/videoArgs';
import { applySubtexture, shouldApplySubtexture } from '../core/subtexture';
import { exportVideo, type ExportProgress } from '../services/videoExport';
import { themeColor } from '../utils/themeColor';

/** Raster cell metrics used when writing the PNG (2x for crisp text). */
const PNG_CELL = { width: 9, height: 18, scale: 2 };
const PNG_FONT = "'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace";

const FORMAT_LABELS: Record<string, string> = {
  txt: 'Plain Text (.txt)',
  asc: 'ASCII Art (.asc)',
  ansi: 'ANSI Art (.ans)',
  json: 'JSON (.json)',
  html: 'HTML (.html)',
  svg: 'SVG (.svg)',
  aap: 'Project (.aap)',
  png: 'PNG Image (.png)',
};

const PROGRESS_LABELS: Record<ExportProgress['phase'], string> = {
  load: 'Loading encoder',
  render: 'Rendering frames',
  encode: 'Encoding',
  done: 'Done',
};

function ExportPanelInner() {
  const { document, timeline } = useStore();
  const [format, setFormat] = useState('txt');
  const [output, setOutput] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const binaryRef = useRef<Blob | null>(null);

  const exporters = listExporters();
  const exporter = exporters.find((e) => e.id === format);
  const allFormats = [
    ...exporters.map((e) => ({ id: e.id, label: FORMAT_LABELS[e.id] ?? e.id })),
    ...VIDEO_FORMATS.map((f) => ({ id: f.id, label: f.label })),
  ];
  const busy = progress !== null;

  const handleExport = async () => {
    binaryRef.current = null;
    try {
      // ---- Video: full timeline through ffmpeg.wasm ----
      if (format === 'mp4' || format === 'gif') {
        if (!timeline) {
          setOutput('Error: there is no timeline to export');
          return;
        }
        setProgress({ phase: 'load', value: 0 });
        try {
          const bytes = await exportVideo({
            document,
            timeline,
            format,
            onProgress: setProgress,
          });
          binaryRef.current = new Blob([bytes], {
            type: format === 'mp4' ? 'video/mp4' : 'image/gif',
          });
          const seconds = (timeline.duration / Math.max(1, timeline.fps)).toFixed(1);
          setOutput(
            `${format.toUpperCase()} rendered: ${timeline.duration} frames at ` +
              `${timeline.fps} fps (${seconds}s), ${bytes.length.toLocaleString()} bytes` +
              (timeline.tracks.length === 0
                ? '.\nNote: the timeline has no tracks, so every frame is identical.'
                : '') +
              `.\nPress Download to save the file.`,
          );
        } finally {
          setProgress(null);
        }
        return;
      }

      // ---- One frame for every static format: the unified renderer ----
      // Full visible stack + timeline frame + cell effects — the exact grid
      // video frame 0 would show at the playhead, not just the active layer.
      const grid = renderExportFrame(document, {
        timeline,
        frame: timeline?.currentFrame ?? 0,
        paper: themeColor('--bg-elevated', themeColor('--bg', 0x0c0c10)),
      });

      // ---- PNG: rasterise that frame ----
      if (format === 'png') {
        if (grid.width === 0) {
          setOutput('Error: the canvas has no cells to rasterize');
          return;
        }
        const canvas = window.document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setOutput('Error: a 2D canvas is unavailable, cannot rasterize PNG');
          return;
        }
        canvas.width = grid.width * PNG_CELL.width * PNG_CELL.scale;
        canvas.height = grid.height * PNG_CELL.height * PNG_CELL.scale;
        // The core's CanvasLike types fillStyle as a plain `string` so it can
        // stay DOM-free; a real context is structurally identical apart from
        // also allowing gradients/patterns.
        const target = ctx as unknown as CanvasLike;
        const painted = drawGridToContext(target, grid, {
          cellWidth: PNG_CELL.width,
          cellHeight: PNG_CELL.height,
          scale: PNG_CELL.scale,
          fontFamily: PNG_FONT,
          background: themeColor('--bg', 0x0c0c10),
          foreground: themeColor('--fg', 0xd4d4d8),
        });
        // Same subtexture mask the editor preview uses, so the PNG matches
        // what is on screen.
        const subtexture = document.canvas.subtexture;
        const masked = shouldApplySubtexture(subtexture, canvas.width, canvas.height);
        if (masked) {
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          applySubtexture(pixels.data, pixels.width, pixels.height, subtexture);
          ctx.putImageData(pixels, 0, 0);
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (!blob) {
          setOutput('Error: the browser could not encode the canvas as PNG');
          return;
        }
        binaryRef.current = blob;
        setOutput(
          `PNG rendered: ${painted.width}x${painted.height} px from a ` +
            `${grid.width}x${grid.height} composed frame` +
            (masked ? ` with the ${subtexture.pattern} subtexture mask` : '') +
            `.\nPress Download to save the file.`,
        );
        return;
      }

      const ctx = {
        grid,
        settings: document.exportSettings,
        document,
      };
      const result = runExport(format as Parameters<typeof runExport>[0], ctx);
      if (result.ok) {
        const text = typeof result.value === 'string' ? result.value : new TextDecoder().decode(result.value);
        setOutput(text);
      } else {
        setOutput(`Error: ${result.error.message}`);
      }
    } catch (e) {
      setOutput(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  const handleDownload = () => {
    if (!output || output.startsWith('Error:') || busy) return;
    setDownloading(true);
    try {
      const ext =
        format === 'png' || format === 'mp4' || format === 'gif'
          ? format
          : exporter?.ext ?? 'txt';
      const blob =
        (format === 'png' || format === 'mp4' || format === 'gif') && binaryRef.current
          ? binaryRef.current
          : new Blob([output], { type: exporter?.mime ?? 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${document.metadata.name || 'ascii-art'}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="export-panel">
      <h3>Export</h3>
      <div className="prop-row">
        <label>Format:</label>
        <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
          {allFormats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {progress && (
        <div className="export-progress" role="status" aria-live="polite">
          <span className="export-progress-label">
            {PROGRESS_LABELS[progress.phase]} {Math.round(progress.value * 100)}%
          </span>
          <div className="export-progress-track">
            <div
              className="export-progress-fill"
              style={{ width: `${Math.round(progress.value * 100)}%` }}
            />
          </div>
        </div>
      )}
      <button onClick={() => void handleExport()} disabled={downloading || busy}>
        {busy ? 'Working...' : 'Generate'}
      </button>
      <button onClick={handleDownload} disabled={!output || downloading || busy}>
        {downloading ? 'Downloading...' : 'Download'}
      </button>
      <textarea
        value={output}
        readOnly
        rows={10}
        className="export-output"
        placeholder="Export output will appear here..."
      />
    </div>
  );
}

export const ExportPanel = memo(ExportPanelInner);
