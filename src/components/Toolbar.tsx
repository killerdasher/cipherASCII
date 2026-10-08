import type { ToolState } from '../core/types';

const TOOLS = [
  {
    id: 'select',
    label: 'Select — drag a rectangle, click a region (S)',
    icon: <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="5 4" />,
  },
  {
    id: 'brush',
    label: 'Brush (B)',
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </>
    ),
  },
  {
    id: 'eraser',
    label: 'Eraser (E)',
    icon: (
      <>
        <path d="M9 21H5" />
        <path d="M14.5 4.5 4.8 14.2a2 2 0 0 0 0 2.8l2.7 2.7a2 2 0 0 0 2.8 0L20 9.5a2 2 0 0 0 0-2.8l-2.7-2.7a2 2 0 0 0-2.8 0z" />
        <path d="m9 9 6 6" />
      </>
    ),
  },
  {
    id: 'fill',
    label: 'Flood fill (F)',
    icon: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  },
  {
    id: 'text',
    label: 'Text (T)',
    icon: (
      <>
        <path d="M4 7V4h16v3" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </>
    ),
  },
  {
    id: 'eyedropper',
    label: 'Pick character (I)',
    icon: (
      <>
        <path d="m2 22 1-1h3l9-9" />
        <path d="M3 21v-3l9-9" />
        <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z" />
      </>
    ),
  },
  {
    id: 'pan',
    label: 'Pan (H)',
    icon: (
      <>
        <polyline points="5 9 2 12 5 15" />
        <polyline points="9 5 12 2 15 5" />
        <polyline points="15 19 12 22 9 19" />
        <polyline points="19 9 22 12 19 15" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="12" y1="2" x2="12" y2="22" />
      </>
    ),
  },
] as const;

export function Toolbar({
  onNew,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleTerminal,
  terminalMode,
  zoomLevel,
  onZoomChange,
  crtGlow,
  onToggleCrtGlow,
  gpuPreview,
  onToggleGpuPreview,
  modals,
  tool,
  onToolChange,
}: {
  onNew: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onToggleTerminal: () => void;
  terminalMode: boolean;
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  crtGlow: boolean;
  onToggleCrtGlow: () => void;
  gpuPreview: boolean;
  onToggleGpuPreview: () => void;
  modals?: React.ReactNode;
  tool: ToolState;
  onToolChange: (patch: Partial<ToolState>) => void;
}) {
  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onNew} title="New (Ctrl+N)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          New
        </button>
        <button className="toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>
        <button className="toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
        </button>
        {modals}
      </div>

      <div className="toolbar-group toolbar-tools" role="group" aria-label="Drawing tools">
        {TOOLS.map((entry) => {
          const active = tool.activeTool === entry.id;
          return (
            <button
              key={entry.id}
              className={`toolbar-btn tool-btn ${active ? 'active' : ''}`}
              onClick={() => onToolChange({ activeTool: entry.id })}
              title={entry.label}
              aria-label={entry.label}
              aria-pressed={active}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {entry.icon}
              </svg>
            </button>
          );
        })}
        <label className="toolbar-label" title="Character painted by the brush and fill tools">
          Char
          <input
            className="tool-char-input"
            type="text"
            value={tool.brushChar}
            onChange={(e) => onToolChange({ brushChar: Array.from(e.target.value)[0] ?? '#' })}
          />
        </label>
        <label className="toolbar-label" title="Colour painted by the brush, fill and eyedropper tools">
          Colour
          <input
            className="tool-color-input"
            type="color"
            value={`#${(tool.foregroundColor & 0xffffff).toString(16).padStart(6, '0')}`}
            onChange={(e) => onToolChange({ foregroundColor: parseInt(e.target.value.slice(1), 16) })}
          />
        </label>
        <label className="toolbar-label" title="Brush size in cells">
          Size
          <select
            className="toolbar-select"
            value={tool.brushSize}
            onChange={(e) => onToolChange({ brushSize: Number(e.target.value) })}
          >
            <option value={1}>1</option>
            <option value={3}>3</option>
            <option value={5}>5</option>
          </select>
        </label>
      </div>

      <div className="toolbar-group toolbar-spacer" />

      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${crtGlow ? 'active' : ''}`}
          onClick={onToggleCrtGlow}
          title="CRT glow - bloom the editor preview (display only, does not change the art)"
        >
          CRT
        </button>
        <button
          className={`toolbar-btn ${gpuPreview ? 'active' : ''}`}
          onClick={onToggleGpuPreview}
          title="GPU preview - render the canvas through PixiJS/WebGL with the CRT shader; falls back to the 2D canvas if WebGL is unavailable"
        >
          GPU
        </button>
        <label className="toolbar-label">
          Zoom:{' '}
          <select value={zoomLevel} onChange={(e) => onZoomChange(Number(e.target.value))} className="toolbar-select">
            <option value={0.25}>25%</option>
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
            <option value={3}>300%</option>
            <option value={4}>400%</option>
          </select>
        </label>
        <button
          className={`toolbar-btn ${terminalMode ? 'active' : ''}`}
          onClick={onToggleTerminal}
          title="Terminal Preview (Space)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 9h8"/><path d="M8 15h8"/><path d="M12 9v6"/></svg>
        </button>
      </div>
    </header>
  );
}
