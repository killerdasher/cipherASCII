import { History } from '../../src/core/history/history';
import { applyCommand, applyCommands, type Command } from '../../src/core/history/commands';
import { createDocument } from '../../src/core/project/schema';
import { createGrid, gridToLines, linesToGrid } from '../../src/core/grid';
import type { AsciiGrid, AsciiLayer, Document } from '../../src/core/types';

function layer(id: string, grid: AsciiGrid, name = id): AsciiLayer {
  return {
    id,
    name,
    kind: 'ascii',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: 0,
    y: 0,
    grid,
  };
}

function makeDoc(...layers: AsciiLayer[]): Document {
  return createDocument({ layers, activeLayerId: layers[0]?.id ?? null });
}

function gridOf(target: Document, layerId: string): AsciiGrid {
  const found = target.layers.find((l) => l.id === layerId);
  if (!found) throw new Error(`layer ${layerId} not found`);
  if (found.kind !== 'ascii') throw new Error(`layer ${layerId} is not ascii`);
  return found.grid;
}

function cellAt(target: Document, layerId: string, x: number, y: number): string {
  const grid = gridOf(target, layerId);
  return grid.chars[y * grid.width + x];
}

function rowLines(target: Document, layerId: string): string[] {
  return gridToLines(gridOf(target, layerId));
}

function ids(target: Document): string[] {
  return target.layers.map((l) => l.id);
}

describe('History', () => {
  it('walks a push/undo/redo sequence with an injected clock', () => {
    const history = new History<string>('a');
    history.push('b', { now: 10 });
    history.push('c', { now: 20 });
    expect(history.value).toBe('c');
    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.redo()).toBe('b');
    expect(history.redo()).toBe('c');
    expect(history.value).toBe('c');
  });

  it('reports canUndo and canRedo flags', () => {
    const history = new History<number>(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    history.push(1, { now: 1 });
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    history.redo();
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('returns null from undo on an empty past without changing the value', () => {
    const history = new History('solo');
    expect(history.undo()).toBeNull();
    expect(history.value).toBe('solo');
    expect(history.redo()).toBeNull();
    expect(history.value).toBe('solo');
  });

  it('clears the redo stack when a new state is pushed', () => {
    const history = new History('a');
    history.push('b', { now: 1 });
    history.push('c', { now: 2 });
    history.undo();
    expect(history.canRedo).toBe(true);
    history.push('d', { now: 3 });
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
    expect(history.undo()).toBe('b');
  });

  it('keeps at most limit undo steps', () => {
    const history = new History('0', { limit: 3 });
    for (let i = 1; i <= 5; i++) history.push(String(i), { now: i });
    expect(history.undoDepth).toBe(3);
    expect(history.undo()).toBe('4');
    expect(history.undo()).toBe('3');
    expect(history.undo()).toBe('2');
    expect(history.undo()).toBeNull();
    expect(history.value).toBe('2');
  });

  it('coalesces same-key pushes inside the window into one undo step', () => {
    const history = new History('a');
    history.push('b', { key: 'type', now: 0 });
    history.push('c', { key: 'type', now: 200 });
    history.push('d', { key: 'type', now: 400 });
    expect(history.undoDepth).toBe(1);
    expect(history.value).toBe('d');
    expect(history.undo()).toBe('a');
    expect(history.redo()).toBe('d');
  });

  it('does not coalesce pushes with different keys', () => {
    const history = new History('a');
    history.push('b', { key: 'left', now: 0 });
    history.push('c', { key: 'right', now: 10 });
    expect(history.undoDepth).toBe(2);
    expect(history.undo()).toBe('b');
  });

  it('does not coalesce when the window has elapsed', () => {
    const history = new History('a', { coalesceWindowMs: 500 });
    history.push('b', { key: 'type', now: 0 });
    history.push('c', { key: 'type', now: 501 });
    expect(history.undoDepth).toBe(2);
    expect(history.undo()).toBe('b');
  });

  it('resets the coalescing key after an undo', () => {
    const history = new History('a', { coalesceWindowMs: 1000 });
    history.push('b', { key: 'type', now: 0 });
    history.push('c', { key: 'type', now: 100 });
    expect(history.undoDepth).toBe(1);
    expect(history.undo()).toBe('a');
    expect(history.undoDepth).toBe(0);
    history.push('d', { key: 'type', now: 200 });
    expect(history.undoDepth).toBe(1);
    expect(history.undo()).toBe('a');
  });
});

describe('applyCommand: grid operations', () => {
  it('grid/setCell writes a single character and leaves the input untouched', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const before = structuredClone(base);
    const next = applyCommand(base, {
      type: 'grid/setCell',
      layerId: 'L1',
      x: 1,
      y: 2,
      char: '#',
    });
    expect(next).not.toBe(base);
    expect(cellAt(next, 'L1', 1, 2)).toBe('#');
    expect(cellAt(base, 'L1', 1, 2)).toBe(' ');
    expect(base).toEqual(before);

    const truncated = applyCommand(base, {
      type: 'grid/setCell',
      layerId: 'L1',
      x: 0,
      y: 0,
      char: 'XY',
    });
    expect(cellAt(truncated, 'L1', 0, 0)).toBe('X');
  });

  it('grid/writeText writes multiple lines and grows the grid when needed', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const multiline = applyCommand(base, {
      type: 'grid/writeText',
      layerId: 'L1',
      x: 1,
      y: 0,
      text: 'AB\nCD',
    });
    expect(rowLines(multiline, 'L1')).toEqual([' AB ', ' CD ', '    ']);
    expect(gridOf(base, 'L1').chars.join('')).toBe(' '.repeat(12));

    const grown = applyCommand(base, {
      type: 'grid/writeText',
      layerId: 'L1',
      x: 3,
      y: 2,
      text: 'XYZ',
    });
    expect(gridOf(grown, 'L1').width).toBe(6);
    expect(gridOf(grown, 'L1').height).toBe(3);
    expect(rowLines(grown, 'L1')[2]).toBe('   XYZ');
  });

  it('grid/fillRect grows the grid to cover the rectangle', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const next = applyCommand(base, {
      type: 'grid/fillRect',
      layerId: 'L1',
      x: 2,
      y: 1,
      width: 4,
      height: 3,
      char: '#',
    });
    expect(gridOf(next, 'L1').width).toBe(6);
    expect(gridOf(next, 'L1').height).toBe(4);
    expect(rowLines(next, 'L1')).toEqual(['      ', '  ####', '  ####', '  ####']);
    expect(rowLines(base, 'L1')).toEqual(['    ', '    ', '    ']);
  });

  it('grid/replace swaps in a clone of the given grid', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const replacement = linesToGrid(['ab', 'cde']);
    const next = applyCommand(base, { type: 'grid/replace', layerId: 'L1', grid: replacement });
    expect(next).not.toBe(base);
    expect(rowLines(next, 'L1')).toEqual(['ab ', 'cde']);
    expect(replacement.chars).toEqual(['a', 'b', ' ', 'c', 'd', 'e']);
    expect(gridOf(base, 'L1').width).toBe(4);
  });

  it('grid/paint swaps in a clone, no-ops on identical grids and unknown layers', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const same = gridOf(base, 'L1');
    expect(applyCommand(base, { type: 'grid/paint', layerId: 'L1', grid: same })).toBe(base);
    expect(applyCommand(base, { type: 'grid/paint', layerId: 'ghost', grid: same })).toBe(base);

    const draft = linesToGrid(['xy']);
    const next = applyCommand(base, { type: 'grid/paint', layerId: 'L1', grid: draft });
    expect(next).not.toBe(base);
    expect(rowLines(next, 'L1')).toEqual(['xy']);

    // The document must own its copy: later edits to the caller's grid are
    // invisible to the document (a brush stroke must not alias its source).
    draft.chars[0] = '!';
    expect(cellAt(next, 'L1', 0, 0)).toBe('x');
  });

  it('grid/resize grows while preserving content and never shrinks', () => {
    const seeded = applyCommand(makeDoc(layer('L1', createGrid(4, 3))), {
      type: 'grid/setCell',
      layerId: 'L1',
      x: 1,
      y: 1,
      char: 'Z',
    });
    const grown = applyCommand(seeded, {
      type: 'grid/resize',
      layerId: 'L1',
      width: 6,
      height: 5,
    });
    expect(gridOf(grown, 'L1').width).toBe(6);
    expect(gridOf(grown, 'L1').height).toBe(5);
    expect(cellAt(grown, 'L1', 1, 1)).toBe('Z');
    expect(cellAt(grown, 'L1', 5, 4)).toBe(' ');

    const shrunk = applyCommand(seeded, {
      type: 'grid/resize',
      layerId: 'L1',
      width: 2,
      height: 2,
    });
    expect(shrunk).toBe(seeded);
    expect(gridOf(shrunk, 'L1').width).toBe(4);
  });

  it('grid/transform clear blanks every cell', () => {
    const seeded = applyCommand(makeDoc(layer('L1', createGrid(4, 3))), {
      type: 'grid/setCell',
      layerId: 'L1',
      x: 2,
      y: 1,
      char: '@',
    });
    const cleared = applyCommand(seeded, { type: 'grid/transform', layerId: 'L1', op: 'clear' });
    expect(cleared).not.toBe(seeded);
    expect(rowLines(cleared, 'L1')).toEqual(['    ', '    ', '    ']);
    expect(cellAt(seeded, 'L1', 2, 1)).toBe('@');
  });

  it('grid/transform rotate90 rotates clockwise and swaps width and height', () => {
    const base = makeDoc(layer('L1', linesToGrid(['ABC', 'DEF'])));
    expect(gridOf(base, 'L1').width).toBe(3);
    expect(gridOf(base, 'L1').height).toBe(2);
    const rotated = applyCommand(base, { type: 'grid/transform', layerId: 'L1', op: 'rotate90' });
    expect(gridOf(rotated, 'L1').width).toBe(2);
    expect(gridOf(rotated, 'L1').height).toBe(3);
    expect(rowLines(rotated, 'L1')).toEqual(['DA', 'EB', 'FC']);
  });
});

describe('applyCommand: layers', () => {
  it('layer/add appends or inserts a layer and makes it active', () => {
    const base = makeDoc(layer('L1', createGrid(2, 2)));
    const extra = layer('L2', createGrid(2, 2), 'Second');
    const appended = applyCommand(base, { type: 'layer/add', layer: extra });
    expect(ids(appended)).toEqual(['L1', 'L2']);
    expect(appended.activeLayerId).toBe('L2');

    const inserted = applyCommand(base, { type: 'layer/add', layer: extra, index: 0 });
    expect(ids(inserted)).toEqual(['L2', 'L1']);
    expect(inserted.activeLayerId).toBe('L2');
    expect(ids(base)).toEqual(['L1']);
    expect(base.activeLayerId).toBe('L1');
  });

  it('layer/remove falls back to the last remaining layer when the active one goes', () => {
    const two = applyCommand(makeDoc(layer('L1', createGrid(2, 2))), {
      type: 'layer/add',
      layer: layer('L2', createGrid(2, 2)),
    });
    expect(two.activeLayerId).toBe('L2');

    const removed = applyCommand(two, { type: 'layer/remove', layerId: 'L2' });
    expect(ids(removed)).toEqual(['L1']);
    expect(removed.activeLayerId).toBe('L1');
    expect(two.layers).toHaveLength(2);

    const solo = applyCommand(makeDoc(layer('L1', createGrid(2, 2))), {
      type: 'layer/remove',
      layerId: 'L1',
    });
    expect(solo.layers).toHaveLength(0);
    expect(solo.activeLayerId).toBeNull();
  });

  it('layer/update patches layer fields and leaves other layers alone', () => {
    const base = makeDoc(layer('L1', createGrid(2, 2)), layer('L2', createGrid(2, 2)));
    const next = applyCommand(base, {
      type: 'layer/update',
      layerId: 'L1',
      patch: { name: 'Renamed', visible: false, opacity: 0.4 },
    });
    expect(next.layers[0].name).toBe('Renamed');
    expect(next.layers[0].visible).toBe(false);
    expect(next.layers[0].opacity).toBe(0.4);
    expect(next.layers[1]).toBe(base.layers[1]);
    expect(base.layers[0].name).toBe('L1');
  });

  it('layer/move reorders layers', () => {
    const base = makeDoc(
      layer('A', createGrid(1, 1)),
      layer('B', createGrid(1, 1)),
      layer('C', createGrid(1, 1)),
    );
    expect(ids(applyCommand(base, { type: 'layer/move', layerId: 'A', toIndex: 2 }))).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(ids(applyCommand(base, { type: 'layer/move', layerId: 'C', toIndex: 0 }))).toEqual([
      'C',
      'A',
      'B',
    ]);
    expect(applyCommand(base, { type: 'layer/move', layerId: 'A', toIndex: 0 })).toBe(base);
  });

  it('returns the same document reference for operations on an unknown layer id', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const commands: Command[] = [
      { type: 'grid/setCell', layerId: 'ghost', x: 0, y: 0, char: 'x' },
      { type: 'grid/writeText', layerId: 'ghost', x: 0, y: 0, text: 'hi' },
      { type: 'grid/fillRect', layerId: 'ghost', x: 0, y: 0, width: 2, height: 2, char: '#' },
      { type: 'grid/replace', layerId: 'ghost', grid: createGrid(2, 2) },
      { type: 'grid/resize', layerId: 'ghost', width: 9, height: 9 },
      { type: 'grid/transform', layerId: 'ghost', op: 'clear' },
      { type: 'layer/update', layerId: 'ghost', patch: { name: 'nope' } },
      { type: 'layer/move', layerId: 'ghost', toIndex: 0 },
      { type: 'layer/remove', layerId: 'ghost' },
    ];
    for (const cmd of commands) expect(applyCommand(base, cmd)).toBe(base);
  });
});

describe('applyCommand: document and editor', () => {
  it('document/metadata patches metadata without touching the input', () => {
    const base = makeDoc(layer('L1', createGrid(2, 2)));
    const before = structuredClone(base);
    const next = applyCommand(base, {
      type: 'document/metadata',
      patch: { name: 'Renamed', tags: ['tag'] },
    });
    expect(next).not.toBe(base);
    expect(next.metadata.name).toBe('Renamed');
    expect(next.metadata.tags).toEqual(['tag']);
    expect(next.metadata.createdAt).toBe(base.metadata.createdAt);
    expect(base).toEqual(before);
  });

  it('editor patches editor state', () => {
    const base = makeDoc(layer('L1', createGrid(2, 2)));
    const next = applyCommand(base, {
      type: 'editor',
      patch: { tabSize: 8, showLineNumbers: true },
    });
    expect(next.editor.tabSize).toBe(8);
    expect(next.editor.showLineNumbers).toBe(true);
    expect(next.editor.cursor).toEqual({ x: 0, y: 0 });
    expect(base.editor.tabSize).toBe(4);
  });

  it('document/activeLayer accepts known ids and null but no-op on an unknown id', () => {
    const base = makeDoc(layer('L1', createGrid(2, 2)), layer('L2', createGrid(2, 2)));
    expect(applyCommand(base, { type: 'document/activeLayer', layerId: 'L2' }).activeLayerId).toBe(
      'L2',
    );
    expect(applyCommand(base, { type: 'document/activeLayer', layerId: null }).activeLayerId).toBe(
      null,
    );
    expect(applyCommand(base, { type: 'document/activeLayer', layerId: 'ghost' })).toBe(base);
  });
});

describe('applyCommands', () => {
  it('applies commands from left to right', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)));
    const out = applyCommands(base, [
      { type: 'grid/setCell', layerId: 'L1', x: 0, y: 0, char: 'A' },
      { type: 'grid/setCell', layerId: 'L1', x: 0, y: 0, char: 'B' },
      { type: 'document/metadata', patch: { name: 'Ordered' } },
      { type: 'layer/add', layer: layer('L2', createGrid(1, 1)) },
    ]);
    expect(cellAt(out, 'L1', 0, 0)).toBe('B');
    expect(out.metadata.name).toBe('Ordered');
    expect(ids(out)).toEqual(['L1', 'L2']);
    expect(out.activeLayerId).toBe('L2');
    expect(ids(base)).toEqual(['L1']);

    const clearedLast = applyCommands(base, [
      { type: 'grid/writeText', layerId: 'L1', x: 0, y: 0, text: 'X' },
      { type: 'grid/transform', layerId: 'L1', op: 'clear' },
    ]);
    expect(cellAt(clearedLast, 'L1', 0, 0)).toBe(' ');

    const clearedFirst = applyCommands(base, [
      { type: 'grid/transform', layerId: 'L1', op: 'clear' },
      { type: 'grid/writeText', layerId: 'L1', x: 0, y: 0, text: 'X' },
    ]);
    expect(cellAt(clearedFirst, 'L1', 0, 0)).toBe('X');
  });
});

describe('immutability', () => {
  it('leaves the input document deep-equal to a clone taken before each command', () => {
    const base = makeDoc(layer('L1', createGrid(4, 3)), layer('L2', createGrid(2, 2)));
    const commands: Command[] = [
      { type: 'grid/setCell', layerId: 'L1', x: 0, y: 0, char: '#' },
      { type: 'grid/writeText', layerId: 'L1', x: 1, y: 1, text: 'hi\nthere' },
      { type: 'grid/fillRect', layerId: 'L1', x: 3, y: 2, width: 3, height: 3, char: '.' },
      { type: 'grid/replace', layerId: 'L1', grid: linesToGrid(['xy']) },
      { type: 'grid/resize', layerId: 'L1', width: 10, height: 6 },
      { type: 'grid/transform', layerId: 'L1', op: 'clear' },
      { type: 'grid/transform', layerId: 'L1', op: 'trim' },
      { type: 'grid/transform', layerId: 'L1', op: 'flipH' },
      { type: 'grid/transform', layerId: 'L1', op: 'flipV' },
      { type: 'grid/transform', layerId: 'L1', op: 'rotate90' },
      { type: 'layer/add', layer: layer('L3', createGrid(1, 1)) },
      { type: 'layer/remove', layerId: 'L2' },
      { type: 'layer/update', layerId: 'L1', patch: { name: 'Changed', opacity: 0.5 } },
      { type: 'layer/move', layerId: 'L1', toIndex: 1 },
      { type: 'layer/remove', layerId: 'ghost' },
      { type: 'document/metadata', patch: { name: 'Immutable' } },
      { type: 'document/canvas', patch: { width: 40 } },
      { type: 'document/guides', guides: [{ axis: 'h', pos: 3 }] },
      { type: 'document/activeLayer', layerId: 'L2' },
      { type: 'editor', patch: { cursor: { x: 2, y: 3 } } },
    ];
    for (const cmd of commands) {
      const before = structuredClone(base);
      applyCommand(base, cmd);
      expect(base).toEqual(before);
    }

    const before = structuredClone(base);
    applyCommands(base, commands);
    expect(base).toEqual(before);
  });
});
