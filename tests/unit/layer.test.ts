import { describe, expect, it } from 'vitest';
import { composeDocument, composeActiveLayer } from '../../src/core/layer/compose';
import { LAYER_BLENDS, blendModeFor, resolveLayerBlend } from '../../src/core/layer/blends';
import { createDocument } from '../../src/core/project/schema';
import { linesToGrid } from '../../src/core/grid';
import {
  DEFAULT_CREATIVE_RENDER,
  DEFAULT_SUBTEXTURE,
  NO_COLOR,
  type AsciiGrid,
  type CreativeLayer,
  type Document,
  type Layer,
} from '../../src/core/types';

function canvasDoc(width = 4, height = 2, background: number | null = 0x000000): Document {
  return createDocument({
    canvas: {
      width,
      height,
      background,
      showGrid: false,
      snap: false,
      showGuides: false,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      subtexture: { ...DEFAULT_SUBTEXTURE },
    },
  });
}

/** A one-row grid whose every cell carries `fg` (or no colour when null). */
function fgGrid(chars: string, fg: number | null): AsciiGrid {
  const grid = linesToGrid([chars]);
  grid.fg = new Int32Array(grid.chars.length).fill(NO_COLOR);
  if (fg !== null) grid.fg.fill(fg);
  return grid;
}

describe('layer composition', () => {
  it('composes a single ascii layer', () => {
    const doc = createDocument();
    doc.layers[0].grid = linesToGrid(['abc', 'def']);
    const out = composeDocument(doc);
    expect(out.width).toBe(doc.canvas.width);
    expect(out.height).toBe(doc.canvas.height);
    expect(out.chars.slice(0, 3).join('')).toBe('abc');
  });

  it('respects layer visibility', () => {
    const doc = createDocument();
    doc.layers[0].grid = linesToGrid(['AAAA']);
    doc.layers[0].visible = false;
    const out = composeDocument(doc);
    expect(out.chars.every((c) => c === ' ')).toBe(true);
  });

  it('applies layer offset', () => {
    const doc = createDocument({
      canvas: { width: 10, height: 5, background: 0x000000, showGrid: false, snap: false, showGuides: false, margins: { top: 0, right: 0, bottom: 0, left: 0 }, subtexture: { ...DEFAULT_SUBTEXTURE } },
    });
    doc.layers[0].grid = linesToGrid(['XY']);
    doc.layers[0].x = 2;
    doc.layers[0].y = 1;
    const out = composeDocument(doc);
    // Row 0: all spaces
    expect(out.chars.slice(0, 10).join('')).toBe('          ');
    // Row 1: spaces then XY at x=2
    expect(out.chars.slice(10, 20).join('')).toBe('  XY      ');
  });

  it('composeActiveLayer returns active layer grid', () => {
    const doc = createDocument();
    doc.layers[0].grid = linesToGrid(['ACTIVE']);
    const out = composeActiveLayer(doc);
    expect(out.chars.slice(0, 6).join('')).toBe('ACTIVE');
  });

  it('composes a creative layer from its cached grid and skips an empty one', () => {
    const doc = createDocument();
    const creative: CreativeLayer = {
      id: 'creative-1',
      name: 'Generative',
      kind: 'creative',
      visible: true,
      locked: false,
      opacity: 1,
      blend: 'normal',
      x: 0,
      y: 0,
      graphId: 'graph-1',
      render: DEFAULT_CREATIVE_RENDER,
      grid: linesToGrid(['GEN']),
      cacheKey: '',
    };
    doc.layers = [doc.layers[0], creative];
    expect(composeDocument(doc).chars.slice(0, 3).join('')).toBe('GEN');

    doc.layers = [doc.layers[0], { ...creative, grid: null }];
    expect(composeDocument(doc).chars.slice(0, 3).join('')).toBe('   ');
  });
});

describe('real alpha composition', () => {
  it('blends a half-opacity layer against the layers below instead of dithering', () => {
    const doc = canvasDoc(2, 1, 0x000000);
    const base = doc.layers[0];
    const bottom: Layer = { ...base, grid: fgGrid('AB', 0x000000) } as Layer;
    const top: Layer = { ...base, id: 'top', grid: fgGrid('XY', 0xffffff), opacity: 0.5 } as Layer;
    doc.layers = [bottom, top];

    const out = composeDocument(doc);
    // 0.5 * 255 = 128: white over black lands on exactly mid grey, and the
    // glyph flips over at the half-coverage threshold — no hash noise.
    expect(out.fg![0]).toBe(0x808080);
    expect(out.fg![1]).toBe(0x808080);
    expect(out.chars.slice(0, 2).join('')).toBe('XY');
  });

  it('keeps the bottom glyph below half opacity while its colour still mixes', () => {
    const doc = canvasDoc(1, 1, 0x000000);
    const base = doc.layers[0];
    const bottom: Layer = { ...base, grid: fgGrid('A', 0x000000) } as Layer;
    const top: Layer = { ...base, id: 'top', grid: fgGrid('B', 0xffffff), opacity: 0.4 } as Layer;
    doc.layers = [bottom, top];

    const out = composeDocument(doc);
    expect(out.chars[0]).toBe('A');
    // 0.4 * 255 = 102 → 102/255 of the way from black to white.
    expect(out.fg![0]).toBe(0x666666);
  });

  it('reads opacity as transparency against the document background', () => {
    const doc = canvasDoc(1, 1, 0x000000);
    doc.layers = [{ ...doc.layers[0], grid: fgGrid('X', 0xffffff), opacity: 0.5 } as Layer];
    const out = composeDocument(doc);
    expect(out.fg![0]).toBe(0x808080);
    expect(out.chars[0]).toBe('X');
  });

  it('leaves uncoloured cells uncoloured (exporter default), even mid-blend', () => {
    const doc = canvasDoc(1, 1, 0x000000);
    doc.layers = [{ ...doc.layers[0], grid: fgGrid('X', null), opacity: 0.5 } as Layer];
    expect(composeDocument(doc).fg![0]).toBe(NO_COLOR);
  });
});

describe('blend modes', () => {
  function stacked(top: Layer['blend'], bottomFg: number, topFg: number, topOpacity = 1): number {
    const doc = canvasDoc(1, 1, 0x000000);
    const base = doc.layers[0];
    const bottom: Layer = { ...base, grid: fgGrid('A', bottomFg) } as Layer;
    const overlay: Layer = {
      ...base,
      id: 'top',
      grid: fgGrid('B', topFg),
      blend: top,
      opacity: topOpacity,
    } as Layer;
    doc.layers = [bottom, overlay];
    return composeDocument(doc).fg![0];
  }

  it('multiplies colours across layers', () => {
    expect(stacked('multiply', 0x808080, 0x808080)).toBe(0x404040);
  });

  it('screens colours across layers', () => {
    // 255 - (127 * 127) / 255 = 191.7 → 191
    expect(stacked('screen', 0x808080, 0x808080)).toBe(0xbfbfbf);
  });

  it('adds colours across layers, clamped', () => {
    expect(stacked('add', 0x808080, 0x808080)).toBe(0xffffff);
  });

  it('replace writes the layer colour as-is, ignoring opacity', () => {
    expect(stacked('replace', 0x00ff00, 0xff0000, 0.1)).toBe(0xff0000);
  });

  it('normal blends alpha over the layers below', () => {
    expect(stacked('normal', 0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });

  it('registry and engine mapping cover every documented mode', () => {
    const ids = LAYER_BLENDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['normal', 'multiply', 'screen', 'add', 'replace']);
    expect(blendModeFor('normal')).toBe('over');
    expect(blendModeFor('multiply')).toBe('multiply');
    expect(blendModeFor('screen')).toBe('screen');
    expect(blendModeFor('add')).toBe('add');
    expect(blendModeFor('replace')).toBe('source');
    expect(resolveLayerBlend('multiply')).toBe('multiply');
    expect(resolveLayerBlend('plaid')).toBe('normal');
    expect(resolveLayerBlend(undefined)).toBe('normal');
    for (const option of LAYER_BLENDS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });
});

describe('space transparency and clipping', () => {
  it('never paints the colour or glyph of a space cell', () => {
    const doc = canvasDoc(2, 1, 0x000000);
    const base = doc.layers[0];
    const bottom: Layer = { ...base, grid: fgGrid('AB', 0x0000ff) } as Layer;
    const blank = fgGrid('  ', 0xff0000);
    blank.bg = new Int32Array(2).fill(0x00ff00);
    doc.layers = [bottom, { ...base, id: 'top', grid: blank } as Layer];
    const out = composeDocument(doc);
    expect(out.chars.slice(0, 2).join('')).toBe('AB');
    expect(out.fg![0]).toBe(0x0000ff);
    expect(out.bg![0]).toBe(NO_COLOR);
  });

  it('clips layer content outside the canvas', () => {
    const doc = canvasDoc(3, 1, null);
    doc.layers = [{ ...doc.layers[0], grid: fgGrid('XYZ', 0xffffff), x: 2 } as Layer];
    const out = composeDocument(doc);
    expect(out.chars.slice(0, 3).join('')).toBe('  X');
    expect(out.fg![2]).toBe(0xffffff);
  });

  it('layerLimit composes only the layers below the limit', () => {
    const doc = canvasDoc(2, 1, null);
    const base = doc.layers[0];
    const bottom: Layer = { ...base, grid: fgGrid('AA', 0xffffff) } as Layer;
    doc.layers = [bottom, { ...base, id: 'top', grid: fgGrid('BB', 0xffffff) } as Layer];
    expect(composeDocument(doc, { layerLimit: 1 }).chars.slice(0, 2).join('')).toBe('AA');
    expect(composeDocument(doc, { layerLimit: 2 }).chars.slice(0, 2).join('')).toBe('BB');
  });

  it('paints the background fill character under transparent layers', () => {
    const doc = canvasDoc(2, 1, null);
    doc.layers = [{ ...doc.layers[0], grid: fgGrid('  ', null) } as Layer];
    const out = composeDocument(doc, { background: '.' });
    expect(out.chars.slice(0, 2).join('')).toBe('..');
    expect(out.fg![0]).toBe(NO_COLOR);
  });
});