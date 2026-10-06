import { useRef, useEffect, useMemo } from 'react';
import type { Document } from '../core/types';
import { composeDocument } from '../core/layer/compose';

interface TerminalPreviewProps {
  document: Document;
  cols: number;
  rows: number;
  onResize: (cols: number, rows: number) => void;
}

export function TerminalPreview({ document, cols, rows, onResize }: TerminalPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const composedGrid = useMemo(() => composeDocument(document), [document]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const grid = composedGrid;
    let output = '';
    for (let y = 0; y < Math.min(rows, grid.height); y++) {
      let line = '';
      for (let x = 0; x < Math.min(cols, grid.width); x++) {
        line += grid.chars[y * grid.width + x] || ' ';
      }
      output += line + '\n';
    }
    container.textContent = output;
  }, [composedGrid, cols, rows]);

  return (
    <div className="terminal-preview">
      <div className="terminal-header">
        <span>Terminal Preview ({cols}×{rows})</span>
        <div className="terminal-controls">
          <button onClick={() => onResize(Math.max(40, cols - 10), rows)} title="Decrease width">−</button>
          <button onClick={() => onResize(cols + 10, rows)} title="Increase width">+</button>
          <button onClick={() => onResize(cols, Math.max(10, rows - 5))} title="Decrease height">−</button>
          <button onClick={() => onResize(cols, rows + 5)} title="Increase height">+</button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-content" style={{ width: cols * 8, height: rows * 16 }} />
    </div>
  );
}