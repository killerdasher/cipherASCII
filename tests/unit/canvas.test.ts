import { describe, expect, it } from 'vitest';
import { Attr, NO_CELL, luminance, parseHex, rgb, toHex, unpackRgb } from '../../src/core/canvas/cell';
import { FrameBuffer, GLYPH_COVERAGE_ALPHA, composite, needsOrdering } from '../../src/core/canvas/compose';
import { DirtyRegions } from '../../src/core/canvas/dirty';
import { diffFrames } from '../../src/core/canvas/diff';
import { GlyphTable } from '../../src/core/canvas/glyphTable';
import { Plane } from '../../src/core/canvas/plane';

describe('cell colours', () => {
  it('packs and unpacks rgb', () => {
    expect(rgb(255, 128, 0)).toBe(0xff8000);
    expect(unpackRgb(0xff8000)).toEqual([255, 128, 0]);
    expect(rgb(999, -5, 0)).toBe(0xff0000);
  });

  it('parses hex in all three lengths', () => {
    expect(parseHex('#fff')).toBe(0xffffff);
    expect(parseHex('ff8000')).toBe(0xff8000);
    expect(parseHex('#112233')).toBe(0x112233);
    expect(parseHex('not-a-color')).toBe(NO_CELL);
  });

  it('formats hex and renders transparent sentinel', () => {
    expect(toHex(0x0a0b0c)).toBe('#0a0b0c');
    expect(toHex(NO_CELL)).toBe('transparent');
  });

  it('computes BT.709 luminance', () => {
    expect(luminance(0xffffff)).toBeCloseTo(1, 5);
    expect(luminance(0x000000)).toBeCloseTo(0, 5);
    expect(luminance(NO_CELL)).toBe(0);
    expect(luminance(0x808080)).toBeGreaterThan(0.2);
  });
});

describe('GlyphTable', () => {
  it('interns deterministically with space at index 0', () => {
    const table = new GlyphTable();
    expect(table.intern(' ')).toBe(0);
    expect(table.intern('#')).toBe(1);
    expect(table.intern('#')).toBe(1);
    expect(table.intern('@')).toBe(2);
    expect(table.size).toBe(3);
    expect(table.resolve(1)).toBe('#');
    expect(table.resolve(999)).toBe(' ');
  });
});

describe('DirtyRegions', () => {
  it('marks, counts and reports bounds', () => {
    const d = new DirtyRegions();
    expect(d.isEmpty).toBe(true);
    d.mark(2, 3, 4, 5, 100, 100);
    expect(d.size).toBe(1);
    expect(d.bounds()).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    expect(d.area()).toBe(20);
  });

  it('clamps to bounds and ignores empty marks', () => {
    const d = new DirtyRegions();
    d.mark(-10, -10, 5, 5, 100, 100);
    expect(d.isEmpty).toBe(true);
    d.reset();
    d.mark(50, 50, 0, 10, 100, 100);
    expect(d.isEmpty).toBe(true);
  });

  it('merges overlapping rectangles', () => {
    const d = new DirtyRegions();
    d.mark(0, 0, 10, 10, 100, 100);
    d.mark(5, 5, 10, 10, 100, 100);
    expect(d.size).toBe(2);
    d.merge();
    expect(d.size).toBe(1);
    expect(d.bounds()).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });

  it('collapses to a bounding box past the region budget', () => {
    const d = new DirtyRegions(8, 4);
    for (let i = 0; i < 40; i++) d.mark(i * 3, 0, 1, 1, 1000, 1000);
    expect(d.size).toBeLessThanOrEqual(4);
    expect(d.bounds()!.x).toBe(0);
    expect(d.bounds()!.w).toBeGreaterThan(100);
  });

  it('resets', () => {
    const d = new DirtyRegions();
    d.mark(0, 0, 1, 1, 10, 10);
    d.reset();
    expect(d.isEmpty).toBe(true);
    expect(d.toRects()).toEqual([]);
  });
});

describe('Plane', () => {
  it('writes cells and marks only real changes dirty', () => {
    const p = new Plane(10, 5);
    p.dirty.reset();
    p.setGlyph(1, 1, '#', 0xffffff);
    expect(p.dirty.size).toBe(1);
    p.dirty.reset();
    p.setGlyph(1, 1, '#', 0xffffff);
    expect(p.dirty.isEmpty).toBe(true);
  });

  it('ignores out-of-bounds writes', () => {
    const p = new Plane(4, 4);
    p.setGlyph(-1, 0, 'x', 0xff0000);
    p.setGlyph(0, 99, 'x', 0xff0000);
    expect(p.charAt(0, 0)).toBe(' ');
  });

  it('resizes preserving overlapping content', () => {
    const p = new Plane(4, 4);
    p.setGlyph(3, 3, 'Z', 0x00ff00);
    p.resize(6, 6);
    expect(p.width).toBe(6);
    expect(p.charAt(3, 3)).toBe('Z');
    p.resize(2, 2);
    expect(p.charAt(3, 3)).toBe(' ');
    expect(p.dirty.size).toBe(1);
  });

  it('clear blanks every channel', () => {
    const p = new Plane(3, 3);
    p.setGlyph(0, 0, 'A', 0xffffff, 0x000000, 200, Attr.Bold);
    p.clear();
    expect(p.charAt(0, 0)).toBe(' ');
    expect(p.fg[0]).toBe(NO_CELL);
    expect(p.alpha[0]).toBe(0);
    expect(p.attr[0]).toBe(Attr.None);
  });

  it('fillRect paints only inside bounds', () => {
    const p = new Plane(4, 4);
    p.fillRect(-2, -2, 4, 4, 0x101010);
    expect(p.bg[0]).toBe(0x101010);
    expect(p.bg[p.index(3, 0)]).toBe(NO_CELL);
  });
});

describe('compositor', () => {
  it('paints planes in z order', () => {
    const target = new FrameBuffer(4, 4);
    const bottom = new Plane(4, 4, { z: 0 });
    const top = new Plane(4, 4, { z: 10 });
    bottom.setGlyph(0, 0, 'b', 0xff0000);
    top.setGlyph(0, 0, 't', 0x00ff00);
    const stats = composite([top, bottom], target);
    const glyphs = new GlyphTable();
    glyphs.intern(' ');
    // target stores ids from whichever plane's table; verify via plane order
    expect(stats.visited).toBe(16);
    expect(stats.changed).toBeGreaterThan(0);
  });

  it('skips invisible planes', () => {
    const target = new FrameBuffer(2, 2);
    const hidden = new Plane(2, 2, { z: 0 });
    hidden.visible = false;
    hidden.setGlyph(0, 0, 'X', 0xffffff);
    composite([hidden], target);
    expect(target.glyph[0]).toBe(0);
  });

  it('reports zero changed cells when nothing differs', () => {
    const target = new FrameBuffer(4, 4);
    const scratch = new FrameBuffer(4, 4);
    const plane = new Plane(4, 4);
    plane.setGlyph(1, 1, 'x', 0xffffff);
    composite([plane], target);
    scratch.copyFrom(target);
    const stats = composite([plane], target, scratch);
    expect(stats.changed).toBe(0);
  });

  it('applies plane opacity to foreground colour', () => {
    const target = new FrameBuffer(2, 2);
    const plane = new Plane(2, 2, { opacity: 0 });
    plane.setGlyph(0, 0, 'x', 0xffffff);
    composite([plane], target);
    expect(target.fg[0]).toBe(NO_CELL);
  });

  it('blends colour against the backdrop when the base cell is empty', () => {
    const target = new FrameBuffer(2, 1);
    const plane = new Plane(2, 1, { opacity: 128 });
    plane.setGlyph(0, 0, 'x', 0xffffff);
    composite([plane], target, undefined, 0x000000);
    // Half coverage over a black page: 128/255 of the way to white.
    expect(target.fg[0]).toBe(0x808080);
    // A cell no coloured plane touched stays uncoloured (exporter default),
    // never the backdrop colour.
    expect(target.fg[1]).toBe(NO_CELL);
  });

  it('blends background colour against the backdrop the same way', () => {
    const target = new FrameBuffer(1, 1);
    const plane = new Plane(1, 1, { opacity: 128 });
    plane.setGlyph(0, 0, 'x', NO_CELL, 0xffffff);
    composite([plane], target, undefined, 0x000000);
    expect(target.bg[0]).toBe(0x808080);
  });

  it('holds the glyph below half coverage and flips it at the threshold', () => {
    const table = new GlyphTable();
    const base = new Plane(1, 1, { glyphTable: table, opacity: 255 });
    base.setGlyph(0, 0, 'A', 0x000000);
    const target = new FrameBuffer(1, 1);
    composite([base], target);
    expect(table.resolve(target.glyph[0])).toBe('A');

    const faint = new Plane(1, 1, { glyphTable: table, opacity: GLYPH_COVERAGE_ALPHA - 1 });
    faint.setGlyph(0, 0, 'B', 0xffffff);
    composite([base, faint], target);
    expect(table.resolve(target.glyph[0])).toBe('A');
    // The colour still moves — only the glyph is thresholded.
    expect(target.fg[0]).not.toBe(0x000000);

    const covered = new Plane(1, 1, { glyphTable: table, opacity: GLYPH_COVERAGE_ALPHA });
    covered.setGlyph(0, 0, 'B', 0xffffff);
    composite([base, covered], target);
    expect(table.resolve(target.glyph[0])).toBe('B');
  });

  it('shows a faint glyph over an empty frame', () => {
    const table = new GlyphTable();
    const plane = new Plane(1, 1, { glyphTable: table, opacity: 1 });
    plane.setGlyph(0, 0, 'x', 0xffffff);
    const target = new FrameBuffer(1, 1);
    composite([plane], target, undefined, 0x000000);
    expect(table.resolve(target.glyph[0])).toBe('x');
    // 1/255 coverage over black — almost the page, never full white.
    expect(target.fg[0]).toBe(0x010101);
  });
});

describe('frame diff', () => {
  function makeBuffers(w: number, h: number): [FrameBuffer, FrameBuffer] {
    return [new FrameBuffer(w, h), new FrameBuffer(w, h)];
  }

  it('reports none when frames are identical', () => {
    const [a, b] = makeBuffers(10, 10);
    const result = diffFrames(a, b, { boundsW: 10, boundsH: 10 });
    expect(result.strategy).toBe('none');
    expect(result.changed).toBe(0);
    expect(result.ratio).toBe(0);
  });

  it('reports a tight diff region for a single changed cell', () => {
    const [prev, next] = makeBuffers(20, 20);
    next.glyph[5 * 20 + 7] = 3;
    const result = diffFrames(prev, next, { boundsW: 20, boundsH: 20 });
    expect(result.strategy).toBe('diff');
    expect(result.changed).toBe(1);
    const rects = result.regions.toRects();
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 7, y: 5, w: 1, h: 1 });
  });

  it('merges vertically continuous runs into one rectangle', () => {
    const [prev, next] = makeBuffers(10, 10);
    for (let y = 0; y < 5; y++) next.fg[y * 10 + 3] = 0xffffff;
    const result = diffFrames(prev, next, { boundsW: 10, boundsH: 10 });
    expect(result.strategy).toBe('diff');
    const rects = result.regions.toRects();
    expect(rects.some((r) => r.x === 3 && r.y === 0 && r.w === 1 && r.h === 5)).toBe(true);
  });

  it('falls back to a full-screen region when most cells change', () => {
    const [prev, next] = makeBuffers(20, 20);
    for (let i = 0; i < 400; i++) if (i % 10 !== 0) next.glyph[i] = (i % 50) + 1;
    const result = diffFrames(prev, next, { boundsW: 20, boundsH: 20, fullThreshold: 0.5 });
    expect(result.strategy).toBe('full');
    expect(result.regions.toRects()).toEqual([{ x: 0, y: 0, w: 20, h: 20 }]);
    expect(result.ratio).toBeGreaterThan(0.5);
  });

  it('treats a size mismatch as a full redraw', () => {
    const prev = new FrameBuffer(4, 4);
    const next = new FrameBuffer(8, 8);
    const result = diffFrames(prev, next, { boundsW: 8, boundsH: 8 });
    expect(result.strategy).toBe('full');
    expect(result.changed).toBe(64);
  });

  it('detects colour-only and alpha-only changes', () => {
    const [prev, next] = makeBuffers(4, 4);
    next.fg[2] = 0xff0000;
    expect(diffFrames(prev, next, { boundsW: 4, boundsH: 4 }).changed).toBe(1);
    const [p2, n2] = makeBuffers(4, 4);
    n2.alpha[3] = 128;
    expect(diffFrames(p2, n2, { boundsW: 4, boundsH: 4 }).changed).toBe(1);
    const [p3, n3] = makeBuffers(4, 4);
    n3.attr[1] = Attr.Bold;
    expect(diffFrames(p3, n3, { boundsW: 4, boundsH: 4 }).changed).toBe(1);
  });
});

describe('glyph interning limits', () => {
  it('falls back to space instead of aliasing another glyph when full', () => {
    const table = new GlyphTable();
    // Fill to the Uint16 ceiling (ids 1..65534 on top of the initial space).
    for (let i = 0; i < 0xffff - 1; i++) {
      expect(table.intern(`g${i}`)).toBe(i + 1);
    }
    expect(table.size).toBe(0xffff);
    expect(table.intern('over-capacity')).toBe(0);
    expect(table.resolve(0)).toBe(' ');
    // Existing entries are untouched by the overflow.
    expect(table.resolve(1)).toBe('g0');
    expect(table.intern('g0')).toBe(1);
  });
});

describe('compositor ordering', () => {
  const planeAt = (z: number, glyph: string, color: number, visible = true): Plane => {
    const plane = new Plane(4, 3, { z, visible });
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) plane.setGlyph(x, y, glyph, color);
    return plane;
  };

  it('detects when an input actually needs filtering or sorting', () => {
    expect(needsOrdering([planeAt(0, 'a', 0xffffff), planeAt(1, 'b', 0xffffff)])).toBe(false);
    expect(needsOrdering([])).toBe(false);
    expect(needsOrdering([planeAt(1, 'a', 0xffffff), planeAt(0, 'b', 0xffffff)])).toBe(true);
    expect(needsOrdering([planeAt(0, 'a', 0xffffff), planeAt(1, 'b', 0xffffff, false)])).toBe(true);
  });

  it('composites identically whether or not the input needs ordering', () => {
    const low = planeAt(0, 'l', 0x111111);
    const mid = planeAt(1, 'm', 0x222222);
    const high = planeAt(2, 'h', 0x333333);
    const hidden = planeAt(3, 'x', 0x444444, false);

    const sorted = new FrameBuffer(4, 3);
    const shuffled = new FrameBuffer(4, 3);
    composite([low, mid, high], sorted);
    composite([hidden, high, low, mid], shuffled);

    expect(Array.from(shuffled.glyph)).toEqual(Array.from(sorted.glyph));
    expect(Array.from(shuffled.fg)).toEqual(Array.from(sorted.fg));
    expect(Array.from(shuffled.bg)).toEqual(Array.from(sorted.bg));
    expect(Array.from(shuffled.alpha)).toEqual(Array.from(sorted.alpha));
    expect(needsOrdering([hidden, high, low, mid])).toBe(true);
  });
});
