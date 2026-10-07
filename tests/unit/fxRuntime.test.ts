import { describe, expect, it } from 'vitest';
import type { AsciiGrid } from '../../src/core/types';
import { Plane } from '../../src/core/canvas/plane';
import { CellFxRuntime, gridToPlane, planeToGrid } from '../../src/core/fx';

function makeGrid(width = 16, height = 8, seedText = 'cipher'): AsciiGrid {
  const chars: string[] = [];
  const fg = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = seedText[(x + y) % seedText.length];
      chars.push(x % 3 === 0 ? ' ' : c);
      fg[y * width + x] = x % 3 === 0 ? -1 : 0x66ccff;
    }
  }
  return { width, height, chars, fg, bg: null };
}

describe('grid ⇄ plane bridge', () => {
  it('round-trips characters and colours', () => {
    const grid = makeGrid(10, 5);
    const plane = new Plane(1, 1);
    gridToPlane(plane, grid);
    const back = planeToGrid(plane);
    expect(back.width).toBe(10);
    expect(back.height).toBe(5);
    expect(back.chars).toEqual(grid.chars);
    expect(Array.from(back.fg!)).toEqual(Array.from(grid.fg!));
  });

  it('resizes the plane when the grid grows', () => {
    const plane = new Plane(4, 4);
    gridToPlane(plane, makeGrid(20, 12));
    expect(plane.width).toBe(20);
    expect(plane.height).toBe(12);
  });

  it('reuses the target grid when dimensions match', () => {
    const plane = new Plane(6, 6);
    gridToPlane(plane, makeGrid(6, 6));
    const first = planeToGrid(plane);
    plane.setGlyph(0, 0, 'Z', 0xff0000);
    const second = planeToGrid(plane, first);
    expect(second).toBe(first);
    expect(second.chars[0]).toBe('Z');
  });

  it('allocates a new grid when dimensions differ', () => {
    const plane = new Plane(6, 6);
    gridToPlane(plane, makeGrid(6, 6));
    const small = planeToGrid(plane);
    plane.resize(8, 8);
    const grown = planeToGrid(plane, small);
    expect(grown).not.toBe(small);
    expect(grown.width).toBe(8);
  });
});

describe('CellFxRuntime', () => {
  it('returns null with no entries', () => {
    const rt = new CellFxRuntime();
    rt.sync([], 7);
    expect(rt.frame(makeGrid(), 16)).toBeNull();
    expect(rt.needsFrames).toBe(false);
  });

  it('animates a one-shot effect and then goes idle', () => {
    const rt = new CellFxRuntime();
    const grid = makeGrid(20, 10);
    rt.sync([{ effect: 'decrypt' }], 7);
    const first = rt.frame(grid, 16);
    expect(first).not.toBeNull();
    expect(first!.chars).not.toEqual(grid.chars);
    expect(rt.needsFrames).toBe(true);

    let last: AsciiGrid | null = first;
    for (let i = 0; i < 400 && last; i++) last = rt.frame(grid, 16);
    expect(last).toBeNull();
    expect(rt.needsFrames).toBe(false);
    // Idle: later frames stay null so the editor can stop repainting.
    expect(rt.frame(grid, 16)).toBeNull();
  });

  it('reuses one output grid across frames', () => {
    const rt = new CellFxRuntime();
    const grid = makeGrid(20, 10);
    rt.sync([{ effect: 'rain', enabled: true }], 7);
    const a = rt.frame(grid, 16);
    const b = rt.frame(grid, 16);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('never writes into the source document grid', () => {
    const rt = new CellFxRuntime();
    const grid = makeGrid(12, 6);
    const before = grid.chars.slice();
    rt.sync([{ effect: 'glitch' }], 7);
    const out = rt.frame(grid, 16);
    expect(out).not.toBe(grid);
    expect(grid.chars).toEqual(before);
  });

  it('recaptures the source when the document grid changes', () => {
    const rt = new CellFxRuntime();
    const gridA = makeGrid(12, 6, 'aaaa');
    rt.sync([{ effect: 'decrypt' }], 7);
    rt.frame(gridA, 16);
    const gridB = makeGrid(12, 6, 'bbbb');
    const out = rt.frame(gridB, 16);
    expect(out).not.toBeNull();
    // Once the reveal finishes the output shows the *new* document content.
    let cur: AsciiGrid | null = out;
    for (let i = 0; i < 400 && cur; i++) cur = rt.frame(gridB, 16);
    expect(rt.frame(gridB, 16)).toBeNull();
    expect(gridB.chars.includes('b')).toBe(true);
  });

  it('restarts cleanly after a seed change', () => {
    const rt = new CellFxRuntime();
    const grid = makeGrid(20, 10);
    rt.sync([{ effect: 'spark' }], 7);
    rt.frame(grid, 16);
    expect(rt.needsFrames).toBe(true);
    rt.sync([{ effect: 'spark' }], 99);
    expect(rt.needsFrames).toBe(true);
    expect(rt.frame(grid, 16)).not.toBeNull();
  });

  it('survives a canvas resize with masks bound', () => {
    const rt = new CellFxRuntime();
    rt.sync([{ effect: 'rain', mask: { kind: 'band', thickness: 3, origin: 'top' } }], 7);
    expect(rt.frame(makeGrid(20, 10), 16)).not.toBeNull();
    expect(rt.frame(makeGrid(40, 20), 16)).not.toBeNull();
    expect(rt.frame(makeGrid(10, 5), 16)).not.toBeNull();
  });

  it('reset forgets everything', () => {
    const rt = new CellFxRuntime();
    rt.sync([{ effect: 'decrypt' }], 7);
    rt.frame(makeGrid(), 16);
    rt.reset();
    expect(rt.frame(makeGrid(), 16)).toBeNull();
    expect(rt.needsFrames).toBe(false);
  });
});

describe('CellFxRuntime loop mode (editor preview)', () => {
  it('replays a one-shot instead of settling and going null', () => {
    const rt = new CellFxRuntime();
    rt.setLoop(true);
    const grid = makeGrid(20, 10);
    rt.sync([{ effect: 'decrypt' }], 7);
    // decrypt.duration is 1400 ms; 400 frames x 16 ms is nearly a full
    // second past its end, where the non-looping runtime returns null.
    let out: AsciiGrid | null = null;
    for (let i = 0; i < 400; i++) out = rt.frame(grid, 16);
    expect(out).not.toBeNull();
    expect(rt.needsFrames).toBe(true);
    expect(rt.frame(grid, 16)).not.toBeNull();
  });

  it('stays null with no entries even in loop mode', () => {
    const rt = new CellFxRuntime();
    rt.setLoop(true);
    rt.sync([], 7);
    expect(rt.frame(makeGrid(), 16)).toBeNull();
    expect(rt.needsFrames).toBe(false);
  });

  it('fades toward the paper colour supplied by the host', () => {
    const rt = new CellFxRuntime();
    rt.setPaper(0x102030);
    const grid = makeGrid(8, 4);
    rt.sync([{ effect: 'fade' }], 7);
    let last: AsciiGrid | null = null;
    for (let i = 0; i < 200; i++) {
      const frame = rt.frame(grid, 16);
      if (frame) last = frame;
    }
    // fade.duration is 800 ms: by frame ~50 the ramp finishes and every
    // masked foreground has blended all the way into the paper.
    expect(last).not.toBeNull();
    expect(last!.fg![1]).toBe(0x102030);
  });
});
