/**
 * Command palette (Ctrl+K).
 *
 * The command list is built once — every entry is a closure over
 * `useStore.getState()` rather than over render-time values, so commands stay
 * valid without re-rendering the palette on every state change. Ranking lives
 * in `src/core/palette/commands.ts` (unit tested); this file is presentation
 * plus keyboard handling.
 *
 * Dynamic sections (all 45 cell effects, all 10 themes) are generated from the
 * registries, so a new effect or theme shows up here automatically.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMAND_GROUP_ORDER,
  matchCommands,
  type CommandDef,
  type CommandGroup,
} from '../core/palette/commands';
import { listCellEffects } from '../core/fx';
import { THEME_PRESETS } from '../core/theme/theme';
import { useStore, type LeftPanelId, type RightPanelId } from '../store';
import { runImageAnalysis } from './imageImport';
import type { ToolState } from '../core/types';

/** All palette commands, built from the store + the effect/theme registries. */
export function buildPaletteCommands(): CommandDef[] {
  const s = () => useStore.getState();
  const cmd: CommandDef[] = [];
  const add = (c: CommandDef) => cmd.push(c);

  // --- Project -------------------------------------------------------------
  add({ id: 'project.new', title: 'New document', group: 'Project', shortcut: 'Ctrl+N', run: () => s().newDocument() });
  add({
    id: 'project.open',
    title: 'Open project…',
    group: 'Project',
    shortcut: 'Ctrl+O',
    keywords: ['load', 'aap'],
    run: () => window.dispatchEvent(new Event('ascii:open')),
  });
  add({
    id: 'project.save',
    title: 'Save project…',
    group: 'Project',
    shortcut: 'Ctrl+S',
    keywords: ['export', 'aap'],
    run: () => window.dispatchEvent(new Event('ascii:save')),
  });

  // --- Edit ----------------------------------------------------------------
  add({ id: 'edit.undo', title: 'Undo', group: 'Edit', shortcut: 'Ctrl+Z', run: () => s().undo() });
  add({ id: 'edit.redo', title: 'Redo', group: 'Edit', shortcut: 'Ctrl+Shift+Z', run: () => s().redo() });

  // --- View: docks ---------------------------------------------------------
  const leftPanels: Array<[LeftPanelId, string, string]> = [
    ['layers', 'Layers', 'left dock layers'],
    ['properties', 'Properties', 'left dock properties'],
    ['ascii', 'ASCII controls', 'left dock ascii characters'],
    ['timeline', 'Timeline', 'left dock animation timeline'],
  ];
  for (const [id, title, keywords] of leftPanels) {
    add({
      id: `view.left.${id}`,
      title: `Show panel: ${title}`,
      group: 'View',
      keywords: ['dock', 'open', keywords],
      run: () => s().setActivePanel(id),
    });
  }
  const rightPanels: Array<[RightPanelId, string, string]> = [
    ['export', 'Export', 'render save'],
    ['effects', 'Effects', 'fx filters raster'],
    ['palette', 'Palette', 'colors'],
    ['presets', 'Presets', 'render presets'],
    ['theme', 'Themes', 'colours appearance'],
    ['settings', 'Settings', 'preferences'],
  ];
  for (const [id, title, keywords] of rightPanels) {
    add({
      id: `view.right.${id}`,
      title: `Show panel: ${title}`,
      group: 'View',
      keywords: ['dock', 'open', keywords],
      run: () => s().setActiveRightPanel(id),
    });
  }

  // --- View: toggles -------------------------------------------------------
  add({ id: 'view.toggle.grid', title: 'Toggle grid overlay', group: 'View', keywords: ['lines'], run: () => s().toggleGrid() });
  add({ id: 'view.toggle.guides', title: 'Toggle guides', group: 'View', keywords: ['rulers'], run: () => s().toggleGuides() });
  add({ id: 'view.toggle.crt', title: 'Toggle CRT glow', group: 'View', keywords: ['bloom phosphor'], run: () => s().toggleCrtGlow() });
  add({ id: 'view.toggle.gpu', title: 'Toggle GPU preview', group: 'View', keywords: ['pixi webgl shader'], run: () => s().toggleGpuPreview() });
  add({ id: 'view.toggle.terminal', title: 'Toggle terminal preview', group: 'View', shortcut: 'Space', keywords: ['ansi preview'], run: () => s().setTerminalMode(!s().terminalMode) });
  add({
    id: 'view.toggle.debug',
    title: 'Toggle debug overlay',
    group: 'View',
    keywords: ['fps', 'perf', 'stats', 'frame time'],
    run: () => s().toggleDebugOverlay(),
  });
  for (const mode of ['auto', 'high', 'balanced', 'low'] as const) {
    add({
      id: `quality.${mode}`,
      title: `Quality mode: ${mode[0].toUpperCase()}${mode.slice(1)}`,
      group: 'View',
      keywords: ['performance', 'adaptive', 'fps', 'budget', mode],
      run: () => s().setQualityMode(mode),
    });
  }

  // --- View: zoom ----------------------------------------------------------
  add({ id: 'view.zoom.in', title: 'Zoom in', group: 'View', keywords: ['larger scale'], run: () => s().setZoom(s().zoomLevel * 1.25) });
  add({ id: 'view.zoom.out', title: 'Zoom out', group: 'View', keywords: ['smaller scale'], run: () => s().setZoom(s().zoomLevel / 1.25) });
  add({ id: 'view.zoom.reset', title: 'Zoom to 100%', group: 'View', keywords: ['fit reset actual'], run: () => s().setZoom(1) });

  // --- Tools ---------------------------------------------------------------
  const tools: Array<[ToolState['activeTool'], string, string]> = [
    ['brush', 'Brush', 'b draw paint'],
    ['eraser', 'Eraser', 'e clear'],
    ['fill', 'Flood fill', 'f bucket'],
    ['text', 'Text', 't type write letter caption headline'],
    ['eyedropper', 'Eyedropper', 'i pick colour color'],
    ['pan', 'Pan', 'h move scroll'],
  ];
  for (const [tool, title, keywords] of tools) {
    add({
      id: `tool.${tool}`,
      title: `Tool: ${title}`,
      group: 'Tools',
      keywords: keywords.split(' '),
      run: () => s().setTool({ activeTool: tool }),
    });
  }

  // --- Render --------------------------------------------------------------
  add({
    id: 'render.again',
    title: 'Re-render from source',
    group: 'Render',
    keywords: ['regenerate ascii image text refresh'],
    run: () => s().triggerRender(),
  });
  add({
    id: 'render.analyze',
    title: 'Recommend charset & dither (auto analysis)',
    group: 'Render',
    keywords: ['auto glyph analyzer suggest best charset dither chips'],
    run: () => {
      const state = s();
      const layer = state.document.layers.find((l) => l.id === state.document.activeLayerId);
      if (!layer || layer.kind !== 'image' || !layer.source) {
        state.setStatusMessage('Auto analysis needs an active image layer.');
        return;
      }
      state.setRenderAnalysis(null);
      state.setStatusMessage('Analyzing image\u2026');
      void runImageAnalysis(layer.source.dataUrl, layer.name)
        .then((analysis) => {
          useStore.getState().setRenderAnalysis(analysis);
          useStore.getState().setStatusMessage('Auto analysis ready - pick a suggestion.');
        })
        .catch(() => useStore.getState().setStatusMessage('Auto analysis failed for this image.'));
    },
  });

  // --- Effects: every registered cell effect -------------------------------
  for (const effect of listCellEffects()) {
    add({
      id: `cell.add.${effect.id}`,
      title: `Add cell effect: ${effect.label}`,
      group: 'Effects',
      keywords: ['fx', 'animation', effect.category, effect.id],
      run: () => {
        s().addCellEffect(effect.id);
        s().setActiveRightPanel('effects');
      },
    });
  }
  add({
    id: 'cell.clear',
    title: 'Clear all cell effects',
    group: 'Effects',
    keywords: ['remove reset fx'],
    run: () => s().resetCellEffects(),
  });
  add({
    id: 'cell.reseed',
    title: 'Reseed cell effects',
    group: 'Effects',
    keywords: ['random seed shuffle fx'],
    run: () => s().setFxSeed(Math.floor(Math.random() * 1e9)),
  });

  // --- Themes --------------------------------------------------------------
  for (const theme of THEME_PRESETS) {
    add({
      id: `theme.${theme.id}`,
      title: `Theme: ${theme.name}`,
      group: 'Theme',
      keywords: ['colour', 'color', 'appearance', theme.id],
      run: () => s().setTheme(theme.id),
    });
  }

  return cmd;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  command: CommandDef;
  /** Index in the flat, rendered order (what the arrow keys walk). */
  flatIndex: number;
  /** First row of its section — used to draw a group header. */
  sectionStart: boolean;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildPaletteCommands(), []);
  const rows: Row[] = useMemo(() => {
    const matches = matchCommands(commands, query);
    const sections = new Map<CommandGroup, CommandDef[]>();
    for (const command of matches) {
      const list = sections.get(command.group);
      if (list) list.push(command);
      else sections.set(command.group, [command]);
    }
    const out: Row[] = [];
    let flatIndex = 0;
    for (const group of COMMAND_GROUP_ORDER) {
      const list = sections.get(group);
      if (!list) continue;
      for (const [i, command] of list.entries()) {
        out.push({ command, flatIndex: flatIndex++, sectionStart: i === 0 });
      }
    }
    return out;
  }, [commands, query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    // Focus after paint so the overlay is already on screen.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`palette-row-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) return null;

  const run = (command: CommandDef) => {
    onClose();
    command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c + 1) % rows.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (rows.length === 0 ? 0 : (c - 1 + rows.length) % rows.length));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(Math.max(0, rows.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[cursor];
      if (row) run(row.command);
    }
  };

  return (
    <div className="modal-overlay palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          placeholder="Type a command…"
          value={query}
          spellCheck={false}
          autoComplete="off"
          aria-label="Command"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list" role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">No commands match “{query}”</div>
          ) : (
            rows.map((row) => (
              <div key={row.command.id}>
                {row.sectionStart && <div className="palette-group">{row.command.group}</div>}
                <button
                  id={`palette-row-${row.flatIndex}`}
                  type="button"
                  role="option"
                  aria-selected={row.flatIndex === cursor}
                  className={row.flatIndex === cursor ? 'palette-row active' : 'palette-row'}
                  onMouseMove={() => setCursor(row.flatIndex)}
                  onClick={() => run(row.command)}
                >
                  <span className="palette-title">{row.command.title}</span>
                  {row.command.shortcut && <kbd className="palette-key">{row.command.shortcut}</kbd>}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="palette-hint">
          <span>↑↓ move</span>
          <span>⏎ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
