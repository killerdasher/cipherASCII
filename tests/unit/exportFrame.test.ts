import { describe, expect, it } from 'vitest';
import { renderExportFrame, createExportFrameSession } from '../../src/core/export/frame';
import { runExport } from '../../src/core/export';
import { composeDocument } from '../../src/core/layer/compose';
import { createDocument } from '../../src/core/project/schema';
import { linesToGrid } from '../../src/core/grid';
import {
  addTrack,
  applyTimelineToDocument,
  createTimeline,
  setKeyframe,
} from '../../src/core/timeline/timeline';
import { timelineHasAnimation } from '../../src/core/timeline/playback';
import { getCellEffect, resolveParams } from '../../src/core/fx';
import type { CellEffectEntry } from '../../src/core/fx/pipeline';
import type { Document, Layer } from '../../src/core/types';
import { DEFAULT_SUBTEXTURE } from '../../src/core/types';

interface TwoLayerDoc {
  doc: Document;
  bottomId: string;
  topId: string;
}

/** A 4x2 document with a bottom grid layer plus a stacked second layer. */
function twoLayerDoc(): TwoLayerDoc {
  const doc = createDocument({
    canvas: {
      width: 4,
      height: 2,
      background: 0x000000,
      showGrid: false,
      snap: false,
      showGuides: false,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      subtexture: { ...DEFAULT_SUBTEXTURE },
    },
  });
  const bottom = doc.layers[0];
  const bottomId = bottom.id;
  bottom.grid = linesToGrid(['AAAA', 'AAAA']);
  bottom.y = 0;
  const top: Layer = {
    ...bottom,
    id: 'L-top',
    grid: linesToGrid(['BB', 'BB']),
    x: 0,
    y: 1,
  };
  doc.layers.push(top);
  return { doc, bottomId, topId: top.id };
}

function glitchEntry(): CellEffectEntry {
  const effect = getCellEffect('glitch');
  if (!effect) throw new Error('registry is missing the glitch effect');
  return { effect: 'glitch', enabled: true, intensity: 1, params: resolveParams(effect) };
}

describe('renderExportFrame', () => {
  it('serializes the full visible stack, not just the active layer', () => {
    const { doc } = twoLayerDoc();
    doc.activeLayerId = doc.layers[0].id;
    const frame = renderExportFrame(doc);
    // Bottom layer fills row 0, the stacked layer sits in row 1.
    expect(frame.chars.slice(0, 4).join('')).toBe('AAAA');
    expect(frame.chars.slice(4, 8).join('')).toBe('BBAA');
    // And the same grid through the text exporter keeps both layers.
    const txt = runExport('txt', { grid: frame, settings: doc.exportSettings, document: doc });
    expect(txt.ok).toBe(true);
    if (txt.ok && typeof txt.value === 'string') {
      expect(txt.value).toContain('AAAA');
      expect(txt.value).toContain('BB');
    }
  });

  it('skips hidden layers', () => {
    const { doc } = twoLayerDoc();
    doc.layers[1].visible = false;
    const frame = renderExportFrame(doc);
    expect(frame.chars.slice(4, 8).join('')).toBe('AAAA');
  });

  it('evaluates the timeline at the requested frame', () => {
    const { doc, bottomId } = twoLayerDoc();
    let tl = createTimeline('anim', 30, 60, 'tl-export');
    tl = addTrack(tl, bottomId, 'x');
    tl = setKeyframe(tl, tl.tracks[0].id, 0, 0, 'linear');
    tl = setKeyframe(tl, tl.tracks[0].id, 10, 3, 'linear');
    expect(timelineHasAnimation(tl)).toBe(true);

    const at0 = renderExportFrame(doc, { timeline: tl, frame: 0 });
    const at10 = renderExportFrame(doc, { timeline: tl, frame: 10 });
    expect(at0.chars.slice(0, 4).join('')).toBe('AAAA');
    expect(at10.chars.slice(0, 4).join('')).toBe('   A');
    // The animated frame matches the preview's own transform.
    expect(at10).toEqual(composeDocument(applyTimelineToDocument(doc, tl, 10)));
  });

  it('treats a timeline without keyframes as a no-op', () => {
    const { doc } = twoLayerDoc();
    const tl = createTimeline('idle', 30, 60, 'tl-idle');
    expect(timelineHasAnimation(tl)).toBe(false);
    const plain = renderExportFrame(doc);
    expect(renderExportFrame(doc, { timeline: tl, frame: 42 })).toEqual(plain);
    expect(renderExportFrame(doc, {})).toEqual(plain);
  });

  it('bakes the cell-effect stack deterministically', () => {
    const { doc } = twoLayerDoc();
    doc.cellEffects = [glitchEntry()];
    doc.fxSeed = 42;
    const composed = composeDocument(doc);
    const once = renderExportFrame(doc);
    const twice = renderExportFrame(doc);
    expect(once).not.toEqual(composed); // the effect changed something
    expect(twice).toEqual(once); // same seed, same output
    // Effects can be switched off per call for raw-composition consumers.
    expect(renderExportFrame(doc, { cellEffects: false })).toEqual(composed);
  });
});

describe('createExportFrameSession', () => {
  it('renders frame 0 identically to the single-frame renderer', () => {
    const { doc } = twoLayerDoc();
    doc.cellEffects = [glitchEntry()];
    doc.fxSeed = 7;
    const session = createExportFrameSession(doc);
    expect(session(0)).toEqual(renderExportFrame(doc));
  });

  it('replays from t = 0 in a fresh session and stays independent per instance', () => {
    const { doc } = twoLayerDoc();
    doc.cellEffects = [glitchEntry()];
    doc.fxSeed = 7;
    const a = createExportFrameSession(doc);
    const b = createExportFrameSession(doc);
    const a0 = a(0);
    a(1);
    a(2);
    expect(b(0)).toEqual(a0);
    expect(b(1)).toEqual(a(1));
  });

  it('advances the document animation per frame index', () => {
    const { doc, bottomId } = twoLayerDoc();
    let tl = createTimeline('anim', 30, 60, 'tl-session');
    tl = addTrack(tl, bottomId, 'x');
    tl = setKeyframe(tl, tl.tracks[0].id, 0, 0, 'linear');
    tl = setKeyframe(tl, tl.tracks[0].id, 10, 3, 'linear');
    const session = createExportFrameSession(doc, { timeline: tl });
    expect(session(0).chars.slice(0, 4).join('')).toBe('AAAA');
    expect(session(10).chars.slice(0, 4).join('')).toBe('   A');
    expect(session(10)).toEqual(renderExportFrame(doc, { timeline: tl, frame: 10 }));
  });
});
