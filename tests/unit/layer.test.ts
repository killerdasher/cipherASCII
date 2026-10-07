import { describe, expect, it } from 'vitest';
import { composeDocument, composeActiveLayer } from '../../src/core/layer/compose';
import { createDocument } from '../../src/core/project/schema';
import { linesToGrid } from '../../src/core/grid';
import { DEFAULT_CREATIVE_RENDER, DEFAULT_SUBTEXTURE, type CreativeLayer } from '../../src/core/types';

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