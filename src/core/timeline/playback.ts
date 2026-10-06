/**
 * Playback helpers shared by the transport buttons, the rAF playback loop in
 * the app shell, the editor preview and the video exporter. All pure - the
 * store owns the actual timeline state.
 */

import type { Document } from '../types';
import type { Timeline } from './timeline';

/** True when at least one enabled track actually carries keyframes. */
export function timelineHasAnimation(timeline: Timeline | null): boolean {
  if (!timeline) return false;
  return timeline.tracks.some((t) => t.enabled && t.keyframes.length > 0);
}

/**
 * The frame a playing timeline moves to after one tick.
 *
 * Returns `null` when a non-looping timeline reaches its end (the caller
 * should stop playback); a looping timeline wraps to frame 0 instead.
 */
export function advanceFrame(
  timeline: Pick<Timeline, 'currentFrame' | 'duration' | 'loop'>,
): { frame: number | null } {
  const duration = Math.max(1, Math.floor(timeline.duration));
  if (timeline.currentFrame >= duration - 1) {
    return { frame: timeline.loop ? 0 : null };
  }
  return { frame: timeline.currentFrame + 1 };
}

/**
 * Read the current numeric value a track animates, straight from the
 * document (the same property paths {@link applyTimelineToDocument} writes).
 * Returns `null` for unknown paths or non-numeric values so callers can skip
 * the keyframe instead of writing garbage.
 */
export function readTrackValue(doc: Document, layerId: string, path: string): number | null {
  const parts = path.split('.');
  if (parts.length === 1) {
    const layer = doc.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    const raw = (layer as unknown as Record<string, unknown>)[parts[0]];
    return typeof raw === 'number' ? raw : null;
  }
  let root: unknown = null;
  if (parts[0] === 'imageSettings') root = doc.imageSettings;
  else if (parts[0] === 'textSettings') root = doc.textSettings;
  else if (parts[0] === 'canvas') root = doc.canvas;
  if (!root) return null;
  const raw = (root as Record<string, unknown>)[parts[1]];
  return typeof raw === 'number' ? raw : null;
}

/** Track properties the UI offers, with the label shown in the picker. */
export const ANIMATABLE_PROPERTIES: ReadonlyArray<{ path: string; label: string }> = [
  { path: 'x', label: 'Position X' },
  { path: 'y', label: 'Position Y' },
  { path: 'opacity', label: 'Opacity' },
];
