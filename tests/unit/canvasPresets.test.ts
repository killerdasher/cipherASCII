// @vitest-environment jsdom
// The store action at the end needs the document store (theme touches the DOM).
import { describe, it, expect } from 'vitest';
import {
  CANVAS_PRESETS,
  MAX_CANVAS_CELLS,
  canvasCellsToPixels,
  canvasPresetToCells,
  matchCanvasPreset,
} from '../../src/core/canvasPresets';
import { useStore } from '../../src/store';

describe('canvas presets', () => {
  it('snaps pixel targets to the 8 x 16 cell grid', () => {
    expect(canvasPresetToCells({ width: 1080, height: 1920 })).toEqual({ columns: 135, rows: 120 });
    expect(canvasPresetToCells({ width: 1920, height: 1080 })).toEqual({ columns: 240, rows: 68 });
    // 1080/16 = 67.5 rounds up to 68 -> 1088 px, one pixel-row of slack.
    expect(canvasPresetToCells({ width: 1080, height: 1080 })).toEqual({ columns: 135, rows: 68 });
    expect(canvasPresetToCells({ width: 1080, height: 440 })).toEqual({ columns: 135, rows: 28 });
  });

  it('reports the effective pixel footprint of a cell grid', () => {
    expect(canvasCellsToPixels({ columns: 135, rows: 120 })).toEqual({ width: 1080, height: 1920 });
    expect(canvasCellsToPixels({ columns: 135, rows: 68 })).toEqual({ width: 1080, height: 1088 });
  });

  it('clamps tiny targets to one cell and huge ones to the artboard cap', () => {
    expect(canvasPresetToCells({ width: 2, height: 3 })).toEqual({ columns: 1, rows: 1 });
    expect(canvasPresetToCells({ width: 99999, height: 99999 })).toEqual({
      columns: MAX_CANVAS_CELLS,
      rows: MAX_CANVAS_CELLS,
    });
  });

  it('matches a preset by its snapped cell size and falls back to custom', () => {
    expect(matchCanvasPreset(135, 120)).toBe('tiktok');
    expect(matchCanvasPreset(135, 68)).toBe('square');
    expect(matchCanvasPreset(135, 28)).toBe('wide');
    expect(matchCanvasPreset(240, 68)).toBe('hd');
    expect(matchCanvasPreset(80, 24)).toBe('custom');
    expect(matchCanvasPreset(135, 999)).toBe('custom');
  });

  it('lists unique preset ids including custom', () => {
    const ids = CANVAS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('custom');
    for (const preset of CANVAS_PRESETS) {
      expect(canvasPresetToCells(preset).columns).toBeGreaterThanOrEqual(1);
      expect(canvasPresetToCells(preset).rows).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('applyCanvasPreset (store)', () => {
  it('resizes the artboard and image columns together in one undo step', () => {
    const before = useStore.getState().document;

    useStore.getState().applyCanvasPreset('tiktok');
    const applied = useStore.getState();
    expect(applied.document.canvas.width).toBe(135);
    expect(applied.document.canvas.height).toBe(120);
    expect(applied.document.imageSettings.columns).toBe(135);
    expect(applied.isDirty).toBe(true);
    expect(applied.statusMessage).toContain('135 x 120');
    expect(applied.statusMessage).toContain('1080 x 1920 px');

    useStore.getState().undo();
    const undone = useStore.getState();
    expect(undone.document.canvas.width).toBe(before.canvas.width);
    expect(undone.document.canvas.height).toBe(before.canvas.height);
    expect(undone.document.imageSettings.columns).toBe(before.imageSettings.columns);
  });

  it('ignores the custom pseudo-preset and unknown ids', () => {
    useStore.setState({ isDirty: false });
    const before = useStore.getState().document;
    useStore.getState().applyCanvasPreset('custom');
    useStore.getState().applyCanvasPreset('nope' as never);
    expect(useStore.getState().document).toBe(before);
    expect(useStore.getState().isDirty).toBe(false);
  });
});
