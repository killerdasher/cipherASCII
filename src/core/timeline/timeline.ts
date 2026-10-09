/**
 * Timeline / Animation System - video and animation support with keyframes.
 *
 * Supports: multi-track timeline, keyframe animation, onion skinning,
 * frame-by-frame editing, export to GIF/MP4/WebM.
 */

import type { Document } from '../types';

export interface Keyframe<T> {
  frame: number;
  value: T;
  easing?: EasingType;
}

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInQuint'
  | 'easeOutQuint'
  | 'easeInOutQuint'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInCirc'
  | 'easeOutCirc'
  | 'easeInOutCirc'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'
  | 'steps';

export interface AnimationTrack {
  id: string;
  name: string;
  layerId: string;        // Target layer
  property: string;       // Property path (e.g., 'imageSettings.columns', 'x', 'opacity')
  keyframes: Keyframe<any>[];
  enabled: boolean;
}

export interface Timeline {
  id: string;
  name: string;
  fps: number;
  duration: number;       // Total frames
  currentFrame: number;
  tracks: AnimationTrack[];
  loop: boolean;
  playing: boolean;
  onionSkinEnabled: boolean;
  onionSkinFrames: number; // Frames before/after to show
  onionSkinOpacity: number;
}

/**
 * The timeline every fresh document starts with. Deterministic id so
 * `createDocument()` output is stable for tests and golden fixtures.
 */
export function defaultTimeline(): Timeline {
  return createTimeline('Main Timeline', 30, 300, 'timeline_main');
}

export function createTimeline(
  name: string,
  fps = 30,
  duration = 300,
  id?: string,
): Timeline {
  return {
    id: id ?? `timeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    fps,
    duration,
    currentFrame: 0,
    tracks: [],
    loop: true,
    playing: false,
    onionSkinEnabled: false,
    onionSkinFrames: 1,
    onionSkinOpacity: 0.3,
  };
}

export function addTrack(
  timeline: Timeline,
  layerId: string,
  property: string,
  name?: string,
): Timeline {
  return {
    ...timeline,
    tracks: [
      ...timeline.tracks,
      {
        id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name || property,
        layerId,
        property,
        keyframes: [],
        enabled: true,
      },
    ],
  };
}

export function removeTrack(timeline: Timeline, trackId: string): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((t) => t.id !== trackId),
  };
}

export function setKeyframe(
  timeline: Timeline,
  trackId: string,
  frame: number,
  value: any,
  easing: EasingType = 'linear',
): Timeline {
  const trackIndex = timeline.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex < 0) return timeline;

  const track = timeline.tracks[trackIndex];
  const existingIndex = track.keyframes.findIndex((k) => k.frame === frame);
  const keyframe: Keyframe<any> = { frame, value, easing };

  let newKeyframes: Keyframe<any>[];
  if (existingIndex >= 0) {
    newKeyframes = [...track.keyframes];
    newKeyframes[existingIndex] = keyframe;
  } else {
    newKeyframes = [...track.keyframes, keyframe].sort((a, b) => a.frame - b.frame);
  }

  return {
    ...timeline,
    tracks: timeline.tracks.map((t, i) =>
      i === trackIndex ? { ...t, keyframes: newKeyframes } : t
    ),
  };
}

export function removeKeyframe(timeline: Timeline, trackId: string, frame: number): Timeline {
  const trackIndex = timeline.tracks.findIndex((t) => t.id === trackId);
  if (trackIndex < 0) return timeline;

  return {
    ...timeline,
    tracks: timeline.tracks.map((t, i) =>
      i === trackIndex
        ? { ...t, keyframes: t.keyframes.filter((k) => k.frame !== frame) }
        : t
    ),
  };
}

export function getValueAtFrame(
  timeline: Timeline,
  trackId: string,
  frame: number,
): any {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track || track.keyframes.length === 0) return null;

  const keyframes = track.keyframes;
  if (keyframes.length === 1) return keyframes[0].value;

  // Find surrounding keyframes
  let prev = keyframes[0];
  let next = keyframes[keyframes.length - 1];

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= frame) {
      prev = keyframes[i];
    }
    if (keyframes[i].frame > frame) {
      next = keyframes[i];
      break;
    }
  }

  if (prev.frame === next.frame) return prev.value;
  if (frame <= prev.frame) return prev.value;
  if (frame >= next.frame) return next.value;

  const t = (frame - prev.frame) / (next.frame - prev.frame);
  const easedT = applyEasing(t, prev.easing || 'linear');

  return interpolate(prev.value, next.value, easedT);
}

function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'linear': return t;
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeInQuad': return t * t;
    case 'easeOutQuad': return 1 - (1 - t) * (1 - t);
    case 'easeInOutQuad': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeInCubic': return t * t * t;
    case 'easeOutCubic': return 1 - Math.pow(1 - t, 3);
    case 'easeInOutCubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeInQuart': return t * t * t * t;
    case 'easeOutQuart': return 1 - Math.pow(1 - t, 4);
    case 'easeInOutQuart': return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    case 'easeInQuint': return t * t * t * t * t;
    case 'easeOutQuint': return 1 - Math.pow(1 - t, 5);
    case 'easeInOutQuint': return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    case 'easeInSine': return 1 - Math.cos((t * Math.PI) / 2);
    case 'easeOutSine': return Math.sin((t * Math.PI) / 2);
    case 'easeInOutSine': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'easeInExpo': return t === 0 ? 0 : Math.pow(2, 10 * (t - 1));
    case 'easeOutExpo': return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'easeInOutExpo': return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    case 'easeInCirc': return 1 - Math.sqrt(1 - Math.pow(t, 2));
    case 'easeOutCirc': return Math.sqrt(1 - Math.pow(t - 1, 2));
    case 'easeInOutCirc': return t < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
    case 'easeInBack': return 2.70158 * t * t * t - 1.70158 * t * t;
    case 'easeOutBack': return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
    case 'easeInOutBack': return t < 0.5
      ? (Math.pow(2 * t, 2) * ((2.70158 + 1) * 2 * t - 2.70158)) / 2
      : (Math.pow(2 * t - 2, 2) * ((2.70158 + 1) * (2 * t - 2) + 2.70158) + 2) / 2;
    case 'easeInElastic': return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3);
    case 'easeOutElastic': return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    case 'easeInOutElastic': return t === 0 ? 0 : t === 1 ? 1 : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * (2 * Math.PI) / 4.5)) / 2 + 1;
    case 'easeInBounce': return 1 - easeOutBounce(1 - t);
    case 'easeOutBounce': return easeOutBounce(t);
    case 'easeInOutBounce': return t < 0.5 ? (1 - easeOutBounce(1 - 2 * t)) / 2 : (1 + easeOutBounce(2 * t - 1)) / 2;
    case 'steps': return Math.floor(t * 10) / 10;
    default: return t;
  }
}

function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function interpolate(a: any, b: any, t: number): any {
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((v, i) => interpolate(v, b[i], t));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const result: any = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      result[key] = interpolate(a[key], b[key], t);
    }
    return result;
  }
  return t < 0.5 ? a : b;
}

export function getOnionSkinFrames(
  timeline: Timeline,
  frame: number,
  direction: 'before' | 'after' | 'both' = 'both',
): number[] {
  const frames: number[] = [];
  const range = timeline.onionSkinFrames;

  if (direction === 'before' || direction === 'both') {
    for (let i = 1; i <= range; i++) {
      const f = frame - i;
      if (f >= 0) frames.push(f);
      else if (timeline.loop) frames.push(timeline.duration + f);
    }
  }
  if (direction === 'after' || direction === 'both') {
    for (let i = 1; i <= range; i++) {
      const f = frame + i;
      if (f < timeline.duration) frames.push(f);
      else if (timeline.loop) frames.push(f - timeline.duration);
    }
  }
  return frames;
}

export function applyTimelineToDocument(
  document: Document,
  timeline: Timeline,
  frame: number,
): Document {
  let result = document;
  for (const track of timeline.tracks) {
    if (!track.enabled) continue;
    const value = getValueAtFrame(timeline, track.id, frame);
    if (value === null) continue;

    // Apply value to document via property path
    result = setPropertyPath(result, track.layerId, track.property, value);
  }
  return result;
}

function setPropertyPath(doc: Document, layerId: string, path: string, value: any): Document {
  // Simplified property path setter
  // Path format: 'imageSettings.columns' or 'x' or 'opacity'
  const parts = path.split('.');
  if (parts.length === 1) {
    // Layer property
    return applyCommand(doc, { type: 'layer/update', layerId, patch: { [path]: value } } as any);
  } else if (parts[0] === 'imageSettings') {
    return applyCommand(doc, { type: 'document/imageSettings', patch: { [parts[1]]: value } } as any);
  } else if (parts[0] === 'textSettings') {
    return applyCommand(doc, { type: 'document/textSettings', patch: { [parts[1]]: value } } as any);
  } else if (parts[0] === 'canvas') {
    return applyCommand(doc, { type: 'document/canvas', patch: { [parts[1]]: value } } as any);
  }
  return doc;
}

// Import applyCommand from history
import { applyCommand } from '../history/commands';