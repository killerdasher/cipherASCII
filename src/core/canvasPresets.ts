/**
 * Named canvas sizes for the common delivery platforms.
 *
 * Cells are a fixed 8 x 16 px, so a preset target in pixels snaps to the
 * nearest whole cell: the effective size can differ from the marketing size
 * by less than one cell (e.g. 1080 x 1080 -> 135 x 68 cells -> 1080 x 1088 px).
 */
import { CELL_SIZE } from './types';

export type CanvasPresetId =
  | 'tiktok'
  | 'square'
  | 'portrait'
  | 'story'
  | 'wide'
  | 'banner'
  | 'leaderboard'
  | 'hd'
  | 'youtube'
  | 'xpost'
  | 'custom';

export interface CanvasPreset {
  id: CanvasPresetId;
  label: string;
  /** Target width in pixels. */
  width: number;
  /** Target height in pixels. */
  height: number;
}

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: 'tiktok', label: 'TikTok / Reels - 1080 x 1920', width: 1080, height: 1920 },
  { id: 'square', label: 'Square post - 1080 x 1080', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Instagram Portrait - 1080 x 1350', width: 1080, height: 1350 },
  { id: 'story', label: 'Instagram Story - 1080 x 1920', width: 1080, height: 1920 },
  { id: 'wide', label: 'Wide banner - 1080 x 440', width: 1080, height: 440 },
  { id: 'banner', label: 'Web Banner - 720 x 300', width: 720, height: 300 },
  { id: 'leaderboard', label: 'Ad Leaderboard - 728 x 90', width: 728, height: 90 },
  { id: 'hd', label: 'HD 16:9 - 1920 x 1080', width: 1920, height: 1080 },
  { id: 'youtube', label: 'YouTube Thumbnail - 1280 x 720', width: 1280, height: 720 },
  { id: 'xpost', label: 'X / Twitter Post - 1600 x 900', width: 1600, height: 900 },
  { id: 'custom', label: 'Custom size', width: 800, height: 600 },
];

/** Artboard limits, mirroring the Width/Height inputs in Settings. */
export const MIN_CANVAS_CELLS = 1;
export const MAX_CANVAS_CELLS = 500;

export interface CanvasCells {
  columns: number;
  rows: number;
}

const clampCells = (value: number): number =>
  Math.min(MAX_CANVAS_CELLS, Math.max(MIN_CANVAS_CELLS, value));

/** Snap a pixel target to the nearest whole number of 8 x 16 cells. */
export function canvasPresetToCells(target: { width: number; height: number }): CanvasCells {
  return {
    columns: clampCells(Math.round(target.width / CELL_SIZE.width)),
    rows: clampCells(Math.round(target.height / CELL_SIZE.height)),
  };
}

/** The pixel footprint a cell grid actually produces. */
export function canvasCellsToPixels(cells: CanvasCells): { width: number; height: number } {
  return {
    width: cells.columns * CELL_SIZE.width,
    height: cells.rows * CELL_SIZE.height,
  };
}

/**
 * Which named preset (if any) an artboard size corresponds to; `custom` when
 * the size was entered by hand or matches no preset.
 */
export function matchCanvasPreset(width: number, height: number): CanvasPresetId {
  const found = CANVAS_PRESETS.find(
    (p) =>
      p.id !== 'custom' &&
      canvasPresetToCells(p).columns === width &&
      canvasPresetToCells(p).rows === height,
  );
  return found ? found.id : 'custom';
}
