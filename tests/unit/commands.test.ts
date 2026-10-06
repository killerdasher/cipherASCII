// @vitest-environment jsdom
// The command list closes over the Zustand store, which touches `document`
// at creation time (theme variable injection).
/**
 * Command palette: ranking rules and the command set itself.
 *
 * The ranker is the only part of the palette with real behaviour, so it is
 * tested directly; the command list is checked for uniqueness, registry
 * coverage (all cell effects + themes) and for actually doing what it says.
 */

import { describe, it, expect } from 'vitest';
import {
  COMMAND_GROUP_ORDER,
  groupMatches,
  matchCommands,
  rankCommands,
  queryTokens,
  type CommandDef,
} from '../../src/core/palette/commands';
import { buildPaletteCommands } from '../../src/components/CommandPalette';
import { listCellEffects } from '../../src/core/fx';
import { THEME_PRESETS } from '../../src/core/theme/theme';
import { useStore } from '../../src/store';

const noop = () => undefined;

const cmd = (id: string, title: string, extra: Partial<CommandDef> = {}): CommandDef => ({
  id,
  title,
  group: 'View',
  run: noop,
  ...extra,
});

describe('queryTokens', () => {
  it('lowercases and drops empty pieces', () => {
    expect(queryTokens('  Add   CELL ')).toEqual(['add', 'cell']);
    expect(queryTokens('   ')).toEqual([]);
  });
});

describe('matchCommands', () => {
  const commands = [
    cmd('cell.add.hexfall', 'Add cell effect: Hexfall', { group: 'Effects', keywords: ['fx', 'destruction'] }),
    cmd('cell.clear', 'Clear all cell effects', { group: 'Effects' }),
    cmd('view.toggle.grid', 'Toggle grid overlay', { group: 'View', keywords: ['lines'] }),
    cmd('render.again', 'Re-render from source', { group: 'Render', keywords: ['refresh'] }),
  ];

  it('returns everything, in order, for an empty query', () => {
    expect(matchCommands(commands, '')).toEqual(commands);
    expect(matchCommands(commands, '   ')).toEqual(commands);
  });

  it('matches case-insensitively', () => {
    expect(matchCommands(commands, 'HEXFALL').map((c) => c.id)).toEqual(['cell.add.hexfall']);
    expect(matchCommands(commands, 'toggle GRID').map((c) => c.id)).toEqual(['view.toggle.grid']);
  });

  it('ANDs multiple tokens', () => {
    expect(matchCommands(commands, 'add cell').map((c) => c.id)).toEqual(['cell.add.hexfall']);
    expect(matchCommands(commands, 'add grid')).toEqual([]);
  });

  it('prefers a title prefix over a mid-title substring', () => {
    const list = [cmd('a', 'Clear cache'), cmd('b', 'Something that can clear things')];
    expect(matchCommands(list, 'clear').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('prefers a word prefix over a substring inside a word', () => {
    const list = [cmd('a', 'Toggle grid overlay'), cmd('b', 'Ungridded view')];
    expect(matchCommands(list, 'grid').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('searches keywords and reports them below title matches', () => {
    expect(matchCommands(commands, 'lines').map((c) => c.id)).toEqual(['view.toggle.grid']);
    const list = [cmd('a', 'Render now'), cmd('b', 'Sleep', { keywords: ['render'] })];
    expect(matchCommands(list, 'render').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('falls back to the group name', () => {
    expect(matchCommands(commands, 'effects').length).toBe(2);
    expect(matchCommands(commands, 'render')[0].id).toBe('render.again');
  });

  it('returns nothing when a token matches no field', () => {
    expect(matchCommands(commands, 'quux')).toEqual([]);
    expect(matchCommands(commands, 'grid quux')).toEqual([]);
  });

  it('keeps input order for ties', () => {
    const list = [cmd('a', 'Alpha'), cmd('b', 'Alpine'), cmd('c', 'Almost')];
    expect(matchCommands(list, 'al').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('scores whole-query prefixes above equal token scores', () => {
    // Both score 3 (title prefix) + 2 (word/keyword prefix); only the
    // whole-query bonus separates them, and the tie-break would otherwise
    // keep input order — so the prefixing title must win despite being second.
    const list = [cmd('b', 'Toggle me', { keywords: ['grid'] }), cmd('a', 'Toggle grid lines')];
    const ranked = rankCommands(list, 'toggle grid');
    expect(ranked[0].command.id).toBe('a');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('never mutates the input array', () => {
    const before = [...commands];
    matchCommands(commands, 'cell');
    expect(commands).toEqual(before);
  });
});

describe('groupMatches', () => {
  it('groups ranked commands, preserving rank order', () => {
    const matches = matchCommands(
      [cmd('v1', 'One'), cmd('e1', 'Two', { group: 'Effects' }), cmd('v2', 'Three')],
      '',
    );
    const grouped = groupMatches(matches);
    expect([...grouped.keys()].sort()).toEqual(['Effects', 'View']);
    expect(grouped.get('View')?.map((c) => c.id)).toEqual(['v1', 'v2']);
  });
});

describe('buildPaletteCommands', () => {
  const commands = buildPaletteCommands();

  it('has unique ids', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses declared groups', () => {
    const known = new Set<string>(COMMAND_GROUP_ORDER);
    for (const c of commands) expect(known.has(c.group)).toBe(true);
  });

  it('covers every registered cell effect', () => {
    const adders = commands.filter((c) => c.id.startsWith('cell.add.'));
    expect(adders.length).toBe(listCellEffects().length);
    for (const effect of listCellEffects()) {
      expect(commands.some((c) => c.id === `cell.add.${effect.id}`)).toBe(true);
    }
  });

  it('covers every theme', () => {
    expect(commands.filter((c) => c.id.startsWith('theme.')).length).toBe(THEME_PRESETS.length);
  });

  it('is searchable by effect label, category and by "fx"', () => {
    const hexfall = commands.find((c) => c.id === 'cell.add.hexfall');
    expect(hexfall).toBeDefined();
    const found = matchCommands(commands, 'fx');
    expect(found.some((c) => c.id === 'cell.add.hexfall')).toBe(true);
    const byCategory = matchCommands(commands, 'atmosphere');
    expect(byCategory.length).toBeGreaterThan(0);
  });

  it('runs: picking a tool changes the active tool', () => {
    const before = useStore.getState().tool.activeTool;
    const find = (id: string) => commands.find((c) => c.id === id)!;
    find('tool.eraser').run();
    expect(useStore.getState().tool.activeTool).toBe('eraser');
    find('tool.brush').run();
    expect(useStore.getState().tool.activeTool).toBe(before === 'eraser' ? 'brush' : before);
  });

  it('runs: toggling the grid flips showGrid', () => {
    const before = useStore.getState().showGrid;
    commands.find((c) => c.id === 'view.toggle.grid')!.run();
    expect(useStore.getState().showGrid).toBe(!before);
    commands.find((c) => c.id === 'view.toggle.grid')!.run();
    expect(useStore.getState().showGrid).toBe(before);
  });

  it('has performance commands for every quality mode and the overlay', () => {
    for (const mode of ['auto', 'high', 'balanced', 'low']) {
      expect(commands.some((c) => c.id === `quality.${mode}`)).toBe(true);
    }
    expect(commands.some((c) => c.id === 'view.toggle.debug')).toBe(true);

    const modeBefore = useStore.getState().qualityMode;
    const overlayBefore = useStore.getState().debugOverlay;
    commands.find((c) => c.id === 'quality.low')!.run();
    expect(useStore.getState().qualityMode).toBe('low');
    commands.find((c) => c.id === 'view.toggle.debug')!.run();
    expect(useStore.getState().debugOverlay).toBe(!overlayBefore);
    commands.find((c) => c.id === 'view.toggle.debug')!.run();
    expect(useStore.getState().debugOverlay).toBe(overlayBefore);
    commands.find((c) => c.id === `quality.${modeBefore}`)!.run();
    expect(useStore.getState().qualityMode).toBe(modeBefore);
  });

  it('runs: adding a cell effect appends it to the stack', () => {
    const before = useStore.getState().cellEffects.length;
    commands.find((c) => c.id === 'cell.add.cipherlock')!.run();
    const after = useStore.getState().cellEffects;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].effect).toBe('cipherlock');
    commands.find((c) => c.id === 'cell.clear')!.run();
    expect(useStore.getState().cellEffects).toEqual([]);
  });
});
