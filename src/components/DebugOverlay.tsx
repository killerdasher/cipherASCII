/**
 * Debug overlay (Ctrl+K -> "Toggle debug overlay").
 *
 * A passive, click-through readout of the adaptive controller and the last
 * worker render. Values are published by the editor at ~2 Hz, so this panel
 * never forces a render of its own - it just displays the latest snapshot.
 */

import { resolveBudget } from '../core/perf/quality';
import { selectDebugOverlay, selectPerfStats, selectQualityMode, useStore } from '../store';

const num = (value: number, digits = 0): string => (Number.isFinite(value) ? value.toFixed(digits) : '-');

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function DebugOverlay() {
  const enabled = useStore(selectDebugOverlay);
  const stats = useStore(selectPerfStats);
  const mode = useStore(selectQualityMode);
  if (!enabled || !stats) return null;

  const budget = resolveBudget(mode, stats.level);

  return (
    <div className="debug-overlay" role="status" aria-label="Performance overlay">
      <div className="debug-title">perf</div>
      <Row label="fps" value={num(stats.fps)} />
      <Row label="frame" value={`${num(stats.frameMs, 1)} ms`} />
      <Row
        label="quality"
        value={mode === 'auto' ? `auto · ${budget.tier} (${stats.level})` : `${mode} · pinned`}
      />
      <Row label="effects" value={`${num(stats.effectHz)} Hz · ${stats.effects}`} />
      <Row
        label="render"
        value={stats.renderMs === null ? 'not yet' : `${num(stats.renderMs, 1)} ms · ${stats.renderCells ?? 0} cells`}
      />
      <Row label="gen" value={String(stats.generation)} />
      <Row label="grid" value={`${stats.gridWidth} × ${stats.gridHeight}`} />
    </div>
  );
}
