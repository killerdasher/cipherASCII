import { describe, expect, it } from 'vitest';
import {
  ANIMATABLE_PROPERTIES,
  advanceFrame,
  readTrackValue,
  timelineHasAnimation,
} from '../../src/core/timeline/playback';
import { createDocument } from '../../src/core/project/schema';
import { createTimeline } from '../../src/core/timeline/timeline';
import type { AnimationTrack, Timeline } from '../../src/core/timeline/timeline';

function makeTimeline(patch: Partial<Timeline> = {}): Timeline {
  return { ...createTimeline('t', 30, 300), ...patch };
}

function makeTrack(patch: Partial<AnimationTrack> = {}): AnimationTrack {
  return {
    id: 'trk_1',
    name: 'x',
    layerId: 'layer_1',
    property: 'x',
    keyframes: [{ frame: 0, value: 4 }],
    enabled: true,
    ...patch,
  };
}

describe('timelineHasAnimation', () => {
  it('returns false for a null timeline', () => {
    expect(timelineHasAnimation(null)).toBe(false);
  });

  it('returns false when no track has keyframes', () => {
    expect(timelineHasAnimation(makeTimeline({ tracks: [] }))).toBe(false);
    expect(
      timelineHasAnimation(makeTimeline({ tracks: [makeTrack({ keyframes: [] })] })),
    ).toBe(false);
  });

  it('returns false when every keyframed track is disabled', () => {
    expect(
      timelineHasAnimation(makeTimeline({ tracks: [makeTrack({ enabled: false })] })),
    ).toBe(false);
  });

  it('returns true when an enabled track carries keyframes', () => {
    expect(timelineHasAnimation(makeTimeline({ tracks: [makeTrack()] }))).toBe(true);
  });
});

describe('advanceFrame', () => {
  it('advances one frame in the middle of the timeline', () => {
    expect(advanceFrame(makeTimeline({ currentFrame: 10, duration: 100 }))).toEqual({ frame: 11 });
  });

  it('returns null at the end of a non-looping timeline', () => {
    expect(
      advanceFrame(makeTimeline({ currentFrame: 99, duration: 100, loop: false })),
    ).toEqual({ frame: null });
  });

  it('wraps to frame 0 at the end of a looping timeline', () => {
    expect(
      advanceFrame(makeTimeline({ currentFrame: 99, duration: 100, loop: true })),
    ).toEqual({ frame: 0 });
  });

  it('treats a duration below 1 as a single frame', () => {
    expect(advanceFrame(makeTimeline({ currentFrame: 0, duration: 0, loop: false }))).toEqual({
      frame: null,
    });
    expect(advanceFrame(makeTimeline({ currentFrame: 0, duration: 0, loop: true }))).toEqual({
      frame: 0,
    });
  });

  it('supports playheads past the last frame without runaway values', () => {
    // A stale playhead (duration trimmed while paused) must not exceed itself.
    expect(
      advanceFrame(makeTimeline({ currentFrame: 150, duration: 100, loop: false })),
    ).toEqual({ frame: null });
    expect(
      advanceFrame(makeTimeline({ currentFrame: 150, duration: 100, loop: true })),
    ).toEqual({ frame: 0 });
  });
});

describe('readTrackValue', () => {
  it('reads layer position and opacity', () => {
    const doc = createDocument();
    const layerId = doc.layers[0].id;
    doc.layers[0].x = 12;
    doc.layers[0].y = -3;
    doc.layers[0].opacity = 0.75;
    expect(readTrackValue(doc, layerId, 'x')).toBe(12);
    expect(readTrackValue(doc, layerId, 'y')).toBe(-3);
    expect(readTrackValue(doc, layerId, 'opacity')).toBe(0.75);
  });

  it('reads nested settings paths', () => {
    const doc = createDocument();
    const layerId = doc.layers[0].id;
    expect(readTrackValue(doc, layerId, 'imageSettings.columns')).toBe(
      doc.imageSettings.columns,
    );
    expect(readTrackValue(doc, layerId, 'textSettings.scale')).toBe(doc.textSettings.scale);
    expect(readTrackValue(doc, layerId, 'canvas.width')).toBe(doc.canvas.width);
  });

  it('returns null for an unknown layer', () => {
    const doc = createDocument();
    expect(readTrackValue(doc, 'nope', 'x')).toBeNull();
  });

  it('returns null for non-numeric and unknown paths', () => {
    const doc = createDocument();
    const layerId = doc.layers[0].id;
    expect(readTrackValue(doc, layerId, 'visible')).toBeNull();
    expect(readTrackValue(doc, layerId, 'missingRoot.value')).toBeNull();
    expect(readTrackValue(doc, layerId, 'imageSettings.fit')).toBeNull();
  });
});

describe('ANIMATABLE_PROPERTIES', () => {
  it('offers exactly Position X/Y and Opacity with their property paths', () => {
    expect(ANIMATABLE_PROPERTIES.map((p) => p.path)).toEqual(['x', 'y', 'opacity']);
    expect(ANIMATABLE_PROPERTIES.map((p) => p.label)).toEqual([
      'Position X',
      'Position Y',
      'Opacity',
    ]);
  });
});
