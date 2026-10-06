import { memo } from 'react';
import { useStore } from '../store';

interface StatusBarProps {
  isDirty: boolean;
  renderGeneration: number;
  pendingRender: boolean;
  cursor: { x: number; y: number } | null;
  zoomLevel: number;
}

function StatusBarInner({ isDirty, renderGeneration, pendingRender, cursor, zoomLevel }: StatusBarProps) {
  const { statusMessage } = useStore();

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className={isDirty ? 'dirty' : 'clean'}>{isDirty ? '● Modified' : '● Clean'}</span>
        <span>Gen: {renderGeneration}</span>
        {pendingRender && <span className="rendering">⟳ Rendering...</span>}
      </div>
      <div className="status-center">
        {statusMessage}
      </div>
      <div className="status-right">
        {cursor && <span>Ln {cursor.y + 1}, Col {cursor.x + 1}</span>}
        <span>Zoom: {Math.round(zoomLevel * 100)}%</span>
      </div>
    </footer>
  );
}

export const StatusBar = memo(StatusBarInner);
