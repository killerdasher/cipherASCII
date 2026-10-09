/**
 * Application store (Zustand) - Full featured Script Slayer / Dither Boy clone.
 *
 * Single source of truth for UI state, current document, render pipeline,
 * effects, timeline, palettes, themes, and all professional features.
 */

import { create } from 'zustand';
import { deepEqual } from '../core/util';
import type { QualityMode } from '../core/perf/quality';
import type { PerfStats } from '../core/perf/stats';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type {
  AsciiGrid,
  CreativeLayer,
  Document,
  Layer,
  LayerId,
  ImageRenderSettings,
  TextRenderSettings,
  ExportSettings,
  EditorState,
  ProjectMetadata,
  CanvasSettings,
  Guide,
  Palette,
  EffectsPipeline,
  Timeline,
  RenderPreset,
  ViewportState,
  SelectionState,
  ToolState,
  Theme,
  EffectId,
} from '../core/types';
import { ASPECT_PRESETS, DEFAULT_CREATIVE_RENDER, DEFAULT_FX_SEED } from '../core/types';
import { clearSelection, emptySelection, extractSelection, pasteGrid } from '../core/selection';
import { columnsForImageWidth } from '../core/renderImage';
import { createDocument } from '../core/project/schema';
import { applyCommand, type Command } from '../core/history/commands';
import { History } from '../core/history/history';
import { validateGeneratorGraph, type GeneratorGraph } from '../core/generators/graph';
import { defaultGeneratorGraph } from '../core/generators/edit';
import { creativeGridFresh, renderCreativeLayer } from '../core/layer/creative';
import {
  CANVAS_PRESETS,
  canvasCellsToPixels,
  canvasPresetToCells,
  type CanvasPresetId,
} from '../core/canvasPresets';
import { bumpGeneration, poolSupported, renderCreative, StaleRenderError } from '../worker/client';
import { THEME_PRESETS, getDefaultTheme, applyTheme, createCustomTheme } from '../core/theme/theme';
import { PRESET_PALETTES } from '../core/palette/palette';
import { createEffectsPipeline, DEFAULT_EFFECT_PARAMS, addEffect, removeEffect, reorderEffects, updateEffectParams, setEffectEnabled, setEffectIntensity } from '../core/effects/pipeline';
import type { CellEffectEntry } from '../core/fx/pipeline';
import { appendCellEffect, removeCellEffectAt, moveCellEffect, patchCellEffect, setCellEffectParams } from '../core/fx/entries';
import { getCellEffect as getRegistryEffect, resolveParams } from '../core/fx';
import { createTimeline, addTrack, removeTrack, setKeyframe, removeKeyframe } from '../core/timeline/timeline';
import type { RenderAnalysis } from '../core/analyze';

interface FileHandle {
  name: string;
  data: string;
}

export type LeftPanelId = 'layers' | 'properties' | 'ascii' | 'timeline';
export type RightPanelId =
  | 'export'
  | 'effects'
  | 'palette'
  | 'presets'
  | 'theme'
  | 'generators'
  | 'settings';

export interface AppState {
  // Document
  document: Document;
  history: History<Document>;
  isDirty: boolean;
  fileHandle: FileHandle | null;

  // Render pipeline
  renderGeneration: number;
  pendingRender: boolean;
  lastRenderStats: { durationMs: number; cells: number } | null;

  // Effects pipeline
  effectsPipeline: EffectsPipeline;
  /** Cell-level (glyph) effects played by the live runtime. */
  cellEffects: CellEffectEntry[];
  /** Seed for the cell-effect RNG; the same seed always draws the same frame. */
  fxSeed: number;

  // Timeline / Animation. Authoring data (tracks/keyframes/fps/duration)
  // lives in `document.timeline` as a document/timeline command; this slice
  // mirrors it and adds the transport (playhead, playing, loop, onion skin),
  // which is session view state and never dirties the project.
  timeline: Timeline | null;

  // Palettes
  palettes: Palette[];
  activePaletteId: string | null;

  // Presets
  renderPresets: RenderPreset[];

  // Theme
  theme: Theme;
  availableThemes: Theme[];

  // UI state
  /** Which tab the LEFT dock is showing. */
  activePanel: LeftPanelId;
  /** Which tab the RIGHT dock is showing. Independent of the left dock so
   *  opening e.g. ASCII controls no longer blanks the inspector. */
  activeRightPanel: RightPanelId;
  showGrid: boolean;
  showGuides: boolean;
  /** Display-side CRT bloom on the editor canvas (independent of the effect stack). */
  crtGlow: boolean;
  /**
   * Display-side GPU preview: render the editor canvas through the PixiJS
   * WebGL viewport (CRT shader included). Reverts to 2D automatically when
   * WebGL cannot start. View state only - never marks the document dirty.
   */
  gpuPreview: boolean;
  zoomLevel: number;
  statusMessage: string;
  /**
   * Latest auto glyph/dither analysis (see `src/core/analyze.ts`), shown as
   * suggestion chips the user can apply or dismiss. View state only.
   */
  renderAnalysis: RenderAnalysis | null;

  // Performance
  /**
   * `auto` follows the adaptive quality ladder (see `src/core/perf/`), the
   * other modes pin the budget. Pure view state - never marks the document
   * dirty.
   */
  qualityMode: QualityMode;
  /** Debug overlay: FPS, frame time, quality level, render stats. */
  debugOverlay: boolean;
  /** Latest frame samples for the overlay; null until the first sample. */
  perfStats: PerfStats | null;

  // Viewport & Selection
  viewport: ViewportState;
  selection: SelectionState;
  /** Cut/copied cells awaiting paste — view state, not part of the document. */
  clipboard: AsciiGrid | null;
  tool: ToolState;

  // Terminal preview
  terminalMode: boolean;
  terminalCols: number;
  terminalRows: number;

  // Actions - Document
  newDocument: (overrides?: Partial<Document>) => void;
  setDocument: (doc: Document, handle?: FileHandle) => void;
  applyCommand: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  markDirty: () => void;
  markClean: () => void;

  setActiveLayer: (layerId: LayerId | null) => void;
  addLayer: (layer: Layer, index?: number) => void;
  removeLayer: (layerId: LayerId) => void;
  updateLayer: (layerId: LayerId, patch: Partial<Layer>) => void;
  moveLayer: (layerId: LayerId, toIndex: number) => void;
  duplicateLayer: (layerId: LayerId) => void;

  // Generative layer / generator graphs (Phase 6)
  /** Add a creative layer (creating a starter graph when none exists); returns its id. */
  addCreativeLayer: (name?: string) => string | null;
  /** Edit a creative layer's graph binding or render settings (undoable). */
  updateCreativeLayer: (
    layerId: LayerId,
    patch: Partial<Pick<CreativeLayer, 'graphId' | 'render'>>,
  ) => void;
  /** Insert or replace a generator graph; returns false when invalid. */
  upsertGenerator: (graph: GeneratorGraph) => boolean;
  /** Remove a graph unless a creative layer still points at it. */
  removeGenerator: (graphId: string) => boolean;
  /** Re-evaluate every stale creative layer; returns how many were refreshed. */
  refreshCreativeLayers: () => Promise<number>;

  setImageSettings: (patch: Partial<ImageRenderSettings>) => void;
  /**
   * Size the grid to a source image: 8px cells mean `width / 8` columns and
   * the terminal aspect ratio gives `height / 16` rows, so the ASCII covers
   * the same footprint as the picture it came from.
   */
  fitGridToImage: (source: { width: number; height: number }) => void;
  setTextSettings: (patch: Partial<TextRenderSettings>) => void;
  setExportSettings: (patch: Partial<ExportSettings>) => void;
  setCanvasSettings: (patch: Partial<CanvasSettings>) => void;
  /**
   * Resize the artboard to a named platform preset in one undo step: the
   * canvas cells and the image columns snap together. Unknown ids and the
   * `custom` pseudo-preset are ignored.
   */
  applyCanvasPreset: (presetId: CanvasPresetId) => void;
  setMetadata: (patch: Partial<ProjectMetadata>) => void;
  setEditorState: (patch: Partial<EditorState>) => void;
  setGuides: (guides: Guide[]) => void;

  // Actions - Render pipeline
  triggerRender: () => void;
  setRenderGeneration: (gen: number) => void;
  setPendingRender: (pending: boolean) => void;
  setRenderStats: (stats: { durationMs: number; cells: number } | null) => void;

  // Actions - Effects Pipeline
  addEffect: (effectId: EffectId, params?: Record<string, any>) => void;
  removeEffect: (index: number) => void;
  reorderEffects: (fromIndex: number, toIndex: number) => void;
  updateEffectParams: (index: number, params: Record<string, any>) => void;
  setEffectEnabled: (index: number, enabled: boolean) => void;
  setEffectIntensity: (index: number, intensity: number) => void;
  resetEffectsPipeline: () => void;

  // Actions - Cell effects (glyph-grid animations)
  addCellEffect: (effectId: string, params?: Record<string, number>) => void;
  removeCellEffect: (index: number) => void;
  reorderCellEffect: (fromIndex: number, toIndex: number) => void;
  updateCellEffectParams: (index: number, params: Record<string, number>) => void;
  setCellEffectEnabled: (index: number, enabled: boolean) => void;
  setCellEffectIntensity: (index: number, intensity: number) => void;
  setCellEffectMask: (index: number, mask: CellEffectEntry['mask']) => void;
  setCellEffectDelay: (index: number, delay: number) => void;
  resetCellEffects: () => void;
  setFxSeed: (seed: number) => void;

  // Actions - Timeline
  createTimeline: (name?: string, fps?: number, duration?: number) => void;
  addTimelineTrack: (layerId: string, property: string, name?: string) => void;
  removeTimelineTrack: (trackId: string) => void;
  setTimelineKeyframe: (trackId: string, frame: number, value: any, easing?: string) => void;
  removeTimelineKeyframe: (trackId: string, frame: number) => void;
  setTimelineCurrentFrame: (frame: number) => void;
  setTimelinePlaying: (playing: boolean) => void;
  setTimelineLoop: (loop: boolean) => void;
  setOnionSkin: (enabled: boolean, frames?: number, opacity?: number) => void;

  // Actions - Palettes
  addPalette: (palette: Palette) => void;
  removePalette: (paletteId: string) => void;
  setActivePalette: (paletteId: string | null) => void;
  updatePalette: (paletteId: string, updates: Partial<Palette>) => void;

  // Actions - Presets
  saveRenderPreset: (preset: Omit<RenderPreset, 'id' | 'createdAt' | 'updatedAt'>) => void;
  deleteRenderPreset: (presetId: string) => void;
  applyRenderPreset: (presetId: string) => void;

  // Actions - Theme
  setTheme: (themeId: string) => void;
  createCustomTheme: (overrides: Partial<Theme>) => void;

  // Actions - UI
  setActivePanel: (panel: LeftPanelId) => void;
  setActiveRightPanel: (panel: RightPanelId) => void;
  toggleGrid: () => void;
  toggleGuides: () => void;
  toggleCrtGlow: () => void;
  toggleGpuPreview: () => void;
  /** Force the 2D fallback when the GPU viewport cannot start. */
  disableGpuPreview: (reason: string) => void;
  setZoom: (zoom: number) => void;
  setStatusMessage: (msg: string) => void;
  setRenderAnalysis: (analysis: RenderAnalysis | null) => void;
  setViewport: (viewport: Partial<ViewportState>) => void;
  /** Replace the selection; `null` clears it. */
  setSelection: (selection: SelectionState | null) => void;
  setTool: (tool: Partial<ToolState>) => void;

  // Selection clipboard — cut/copy/paste act on the active layer's grid and
  // commit as one undoable `grid/paint`; copy alone only fills `clipboard`.
  copySelection: () => void;
  cutSelection: () => void;
  pasteClipboard: () => void;
  deleteSelection: () => void;

  setTerminalMode: (enabled: boolean) => void;
  setTerminalSize: (cols: number, rows: number) => void;

  setQualityMode: (mode: QualityMode) => void;
  toggleDebugOverlay: () => void;
  /** Replaced (not merged) by the editor at ~2 Hz while the overlay is up. */
  setPerfStats: (stats: PerfStats | null) => void;
}

/**
 * Commands whose payload is already a finished grid.
 *
 * - `RENDER_OUTPUT_COMMANDS` are produced by the renderer itself, so they are
 *   neither undoable authoring steps nor a reason to render again
 *   (render → grid/replace → render would otherwise spin forever). The
 *   creative layer's derived cache (`layer/derive`) follows the same rules.
 * - `GRID_EDIT_COMMANDS` are direct user edits to the grid: undoable, but a
 *   re-render would wipe them, so they must not schedule one.
 */
const RENDER_OUTPUT_COMMANDS: ReadonlySet<Command['type']> = new Set(['grid/replace', 'layer/derive']);
const GRID_EDIT_COMMANDS: ReadonlySet<Command['type']> = new Set([
  'grid/setCell',
  'grid/writeText',
  'grid/fillRect',
  'grid/resize',
  'grid/transform',
  'grid/paint',
]);

const initialDocument = createDocument();
const defaultTheme = getDefaultTheme();
const defaultEffectsPipeline = createEffectsPipeline();

/**
 * Merge the document's timeline into the transport view.
 *
 * Authoring fields always come from the document (that is the persisted
 * truth); the transport survives authoring edits and undo/redo for the same
 * timeline id and resets when a different timeline is adopted — a fresh
 * timeline or a loaded project starts paused.
 */
const reconcileTimeline = (view: Timeline | null, docTl: Timeline | null): Timeline | null => {
  if (!docTl) return null;
  if (view && view.id === docTl.id) {
    if (view === docTl) return view;
    return {
      ...docTl,
      currentFrame: view.currentFrame,
      playing: view.playing,
      loop: view.loop,
      onionSkinEnabled: view.onionSkinEnabled,
      onionSkinFrames: view.onionSkinFrames,
      onionSkinOpacity: view.onionSkinOpacity,
    };
  }
  return docTl.playing ? { ...docTl, playing: false } : docTl;
};

/**
 * The transport view after adopting a document wholesale (new/load): the
 * document's own timeline wins and the session starts paused.
 */
const adoptTimeline = (docTl: Timeline | null): Timeline | null =>
  docTl && docTl.playing ? { ...docTl, playing: false } : docTl;

/**
 * The transport view after a document swap (command, undo, redo, load).
 *
 * Structural sharing makes timeline identity exact: snapshots that never
 * touched the timeline share the same reference, so the view is left alone.
 */
const timelineAfterDocument = (
  prev: Document,
  next: Document,
  view: Timeline | null,
): Timeline | null => {
  const aligned =
    (view === null && next.timeline === null) ||
    (view !== null && next.timeline !== null && view.id === next.timeline.id);
  return prev.timeline !== next.timeline || !aligned
    ? reconcileTimeline(view, next.timeline)
    : view;
};

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => {
    // Apply initial theme
    applyTheme(defaultTheme);

    // Effects are live preview state: keep the persisted document copy in sync
    // and re-render whenever the pipeline changes, so a tweak shows up at once.
    const commitEffects = (next: EffectsPipeline): void => {
      const doc = get().document;
      set({
        effectsPipeline: next,
        document: { ...doc, effectsPipeline: next },
        isDirty: true,
      });
      get().triggerRender();
    };

    // Cell effects are preview state too: mirror them into the document so the
    // project file round-trips the stack.
    const commitCellEffects = (next: CellEffectEntry[]): void => {
      const doc = get().document;
      set({ cellEffects: next, document: { ...doc, cellEffects: next }, isDirty: true });
    };

    // Staleness token for creative-layer refreshes: every dispatch bumps it,
    // and a reply only derives when its epoch is still current, so pooled
    // evaluations can never land out of order or against a dead layer.
    let creativeEpoch = 0;

    // Does moving between two documents change what the worker should draw?
    const renderSettingsChanged = (a: Document, b: Document): boolean =>
      !deepEqual(a.imageSettings, b.imageSettings) || !deepEqual(a.textSettings, b.textSettings);

    // Active layer grid for clipboard ops. `writable` applies the drawing
    // tools' lock guard — copy is a read and ignores it.
    const clipboardTarget = (writable: boolean): { layer: Layer; grid: AsciiGrid } | null => {
      const st = get();
      const layer = st.document.layers.find((l) => l.id === st.document.activeLayerId);
      if (!layer || !layer.grid) {
        st.setStatusMessage('Select an ASCII layer first');
        return null;
      }
      if (writable && layer.locked) {
        st.setStatusMessage('Layer is locked - unlock it in Layers');
        return null;
      }
      return { layer, grid: layer.grid };
    };

    return {
      document: initialDocument,
      history: new History(initialDocument, { limit: 200, coalesceWindowMs: 800 }),
      isDirty: false,
      fileHandle: null,

      renderGeneration: 0,
      pendingRender: false,
      lastRenderStats: null,

      effectsPipeline: defaultEffectsPipeline,
      cellEffects: [],
      fxSeed: initialDocument.fxSeed,
      timeline: initialDocument.timeline,

      palettes: PRESET_PALETTES,
      activePaletteId: PRESET_PALETTES[0]?.id ?? null,

      renderPresets: [],

      theme: defaultTheme,
      availableThemes: THEME_PRESETS,

      activePanel: 'layers',
      activeRightPanel: 'export',
      showGrid: true,
      showGuides: false,
      crtGlow: false,
      gpuPreview: false,
      zoomLevel: 1,
      statusMessage: 'Ready',
      renderAnalysis: null,

      qualityMode: 'auto',
      debugOverlay: false,
      perfStats: null,

      viewport: { x: 0, y: 0, zoom: 1, rotation: 0 },
      selection: emptySelection(),
      clipboard: null,
      tool: {
        activeTool: 'brush',
        brushSize: 1,
        brushChar: '#',
        foregroundColor: 0xd4a53c,
      },

      terminalMode: false,
      terminalCols: 80,
      terminalRows: 24,

      // Document actions
      newDocument: (overrides) => {
        const doc = createDocument(overrides);
        set({
          document: doc,
          history: new History(doc, { limit: 200, coalesceWindowMs: 800 }),
          isDirty: false,
          fileHandle: null,
          // The selection belongs to the old document; the clipboard does not.
          selection: emptySelection(),
          effectsPipeline: doc.effectsPipeline ?? createEffectsPipeline(),
          cellEffects: doc.cellEffects ?? [],
          fxSeed: doc.fxSeed ?? DEFAULT_FX_SEED,
          timeline: adoptTimeline(doc.timeline),
        });
        get().triggerRender();
      },

      setDocument: (doc, handle) => {
        set({
          document: doc,
          history: new History(doc, { limit: 200, coalesceWindowMs: 800 }),
          isDirty: false,
          fileHandle: handle ?? null,
          selection: emptySelection(),
          // A loaded project carries its own effects stack.
          effectsPipeline: doc.effectsPipeline ?? createEffectsPipeline(),
          cellEffects: doc.cellEffects ?? [],
          fxSeed: doc.fxSeed ?? DEFAULT_FX_SEED,
          // A load adopts the document's timeline; the transport resets.
          timeline: adoptTimeline(doc.timeline),
        });
        get().triggerRender();
      },

      applyCommand: (cmd) => {
        const { document, history, timeline } = get();
        const next = applyCommand(document, cmd);
        if (next === document) return;
        if (RENDER_OUTPUT_COMMANDS.has(cmd.type)) {
          set({ document: next });
          return;
        }
        history.push(next, { key: cmd.type });
        set({ document: next, isDirty: true, timeline: timelineAfterDocument(document, next, timeline) });
        // Authoring the timeline needs no worker pass: the preview recomposes
        // from the document directly.
        if (!GRID_EDIT_COMMANDS.has(cmd.type) && cmd.type !== 'document/timeline') {
          get().triggerRender();
        }
      },

      undo: () => {
        const { history, document, timeline } = get();
        const prev = history.undo();
        if (prev) {
          set({
            document: prev,
            isDirty: true,
            effectsPipeline: prev.effectsPipeline ?? createEffectsPipeline(),
            cellEffects: prev.cellEffects ?? [],
            fxSeed: prev.fxSeed ?? DEFAULT_FX_SEED,
            timeline: timelineAfterDocument(document, prev, timeline),
          });
          // Only re-render when the undo restored render-affecting settings;
          // re-rendering a paint undo would regenerate the layer and wipe it.
          if (renderSettingsChanged(document, prev)) get().triggerRender();
        }
      },

      redo: () => {
        const { history, document, timeline } = get();
        const next = history.redo();
        if (next) {
          set({
            document: next,
            isDirty: true,
            effectsPipeline: next.effectsPipeline ?? createEffectsPipeline(),
            cellEffects: next.cellEffects ?? [],
            fxSeed: next.fxSeed ?? DEFAULT_FX_SEED,
            timeline: timelineAfterDocument(document, next, timeline),
          });
          if (renderSettingsChanged(document, next)) get().triggerRender();
        }
      },

      canUndo: () => get().history.canUndo,
      canRedo: () => get().history.canRedo,

      markDirty: () => set({ isDirty: true }),
      markClean: () => set({ isDirty: false }),

      setActiveLayer: (layerId) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/activeLayer', layerId });
        if (next !== document) {
          history.push(next);
          set({ document: next });
          // The newly active layer may never have been rendered (e.g. an image
          // layer that was just imported).
          get().triggerRender();
        }
      },

      addLayer: (layer, index) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'layer/add', layer, index });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      removeLayer: (layerId) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'layer/remove', layerId });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      updateLayer: (layerId, patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'layer/update', layerId, patch });
        if (next !== document) {
          history.push(next, { key: `layer/update/${layerId}` });
          set({ document: next, isDirty: true });
          // Layer metadata (name/visible/opacity/blend/offset) is resolved at
          // compose time on the main thread. Re-rendering here would run the
          // renderer's grid/replace and silently wipe brush strokes on the
          // active image/text layer (A2) — so only the fields the worker
          // actually renders from schedule a render.
          if ('text' in patch || 'source' in patch) get().triggerRender();
        }
      },

      moveLayer: (layerId, toIndex) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'layer/move', layerId, toIndex });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          // Reordering only changes compose order — same A2 rule as updateLayer.
        }
      },

      duplicateLayer: (layerId) => {
        const { document, history } = get();
        const layer = document.layers.find((l) => l.id === layerId);
        if (!layer) return;
        const clone: Layer = { ...layer, id: `layer_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: `${layer.name} copy` };
        const next = applyCommand(document, { type: 'layer/add', layer: clone, index: document.layers.findIndex((l) => l.id === layerId) + 1 });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      addCreativeLayer: (name) => {
        const { document, history } = get();
        const layerId = `layer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const creativeCount = document.layers.filter((l) => l.kind === 'creative').length;
        let graphId = document.generators[0]?.id ?? null;
        const cmds: Command[] = [];
        if (!graphId) {
          graphId = `gen_${Date.now()}`;
          cmds.push({
            type: 'generator/upsert',
            graph: defaultGeneratorGraph(graphId, document.fxSeed),
          });
        }
        const layer: CreativeLayer = {
          id: layerId,
          name: name ?? `Generative ${creativeCount + 1}`,
          kind: 'creative',
          visible: true,
          locked: false,
          opacity: 1,
          blend: 'normal',
          x: 0,
          y: 0,
          graphId,
          render: structuredClone(DEFAULT_CREATIVE_RENDER),
          grid: null,
          cacheKey: '',
        };
        cmds.push({ type: 'layer/add', layer });
        let next = document;
        for (const cmd of cmds) next = applyCommand(next, cmd);
        if (next === document) return null;
        // One undo step: the starter graph and its layer land together.
        history.push(next);
        set({ document: next, isDirty: true });
        return layerId;
      },

      updateCreativeLayer: (layerId, patch) => {
        get().applyCommand({ type: 'creative/update', layerId, patch });
      },

      upsertGenerator: (graph) => {
        const canonical = validateGeneratorGraph(graph);
        if (!canonical.ok) {
          get().setStatusMessage(`Generator graph invalid: ${canonical.error.message}`);
          return false;
        }
        get().applyCommand({ type: 'generator/upsert', graph: canonical.value });
        return true;
      },

      removeGenerator: (graphId) => {
        const doc = get().document;
        const user = doc.layers.find((l) => l.kind === 'creative' && l.graphId === graphId);
        if (user) {
          get().setStatusMessage(
            `Graph is used by layer "${user.name}" - point that layer at another graph first`,
          );
          return false;
        }
        get().applyCommand({ type: 'generator/remove', graphId });
        return true;
      },

      refreshCreativeLayers: async () => {
        const doc = get().document;
        const canvas = { width: doc.canvas.width, height: doc.canvas.height };
        const stale: CreativeLayer[] = [];
        for (const layer of doc.layers) {
          if (layer.kind !== 'creative') continue;
          if (creativeGridFresh(layer, doc.generators, canvas, doc.fxSeed)) continue;
          stale.push(layer);
        }
        if (stale.length === 0) return 0;

        const epoch = ++creativeEpoch;
        const isCurrent = () => epoch === creativeEpoch;

        const runOne = async (layer: CreativeLayer): Promise<boolean> => {
          const graph = doc.generators.find((g) => g.id === layer.graphId);
          if (!graph) {
            if (isCurrent()) {
              get().setStatusMessage(
                `Generative layer "${layer.name}": generator graph "${layer.graphId}" not found`,
              );
            }
            return false;
          }

          let result: ReturnType<typeof renderCreativeLayer>;
          if (poolSupported()) {
            try {
              const value = await renderCreative(graph, layer, canvas, doc.fxSeed);
              result = { ok: true, value };
            } catch (e) {
              if (e instanceof StaleRenderError) return false;
              // Infrastructural worker failure: fall back to the main thread
              // so the layer still fills.
              result = renderCreativeLayer(doc.generators, layer, canvas, doc.fxSeed);
            }
          } else {
            result = renderCreativeLayer(doc.generators, layer, canvas, doc.fxSeed);
          }

          if (!result.ok) {
            if (isCurrent()) {
              get().setStatusMessage(`Generative layer "${layer.name}": ${result.error.message}`);
            }
            return false;
          }
          if (!isCurrent()) return false;
          const current = get().document.layers.find((l) => l.id === layer.id);
          if (!current || current.kind !== 'creative') return false;
          // Derived cache: `layer/derive` is in RENDER_OUTPUT_COMMANDS, so
          // it never lands in history and never schedules a worker render.
          get().applyCommand({
            type: 'layer/derive',
            layerId: layer.id,
            grid: result.value.grid,
            cacheKey: result.value.cacheKey,
          });
          return true;
        };

        const results = await Promise.all(stale.map(runOne));
        return results.filter(Boolean).length;
      },

      setImageSettings: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/imageSettings', patch });
        if (next !== document) {
          history.push(next, { key: 'imageSettings' });
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      fitGridToImage: (source) => {
        get().setImageSettings({
          columns: columnsForImageWidth(source.width),
          aspect: { preset: 'terminal', ratio: ASPECT_PRESETS.terminal },
        });
      },

      setTextSettings: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/textSettings', patch });
        if (next !== document) {
          history.push(next, { key: 'textSettings' });
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      setExportSettings: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/exportSettings', patch });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
        }
      },

      setCanvasSettings: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/canvas', patch });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          get().triggerRender();
        }
      },

      applyCanvasPreset: (presetId) => {
        const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
        if (!preset || preset.id === 'custom') return;
        const { document, history } = get();
        const cells = canvasPresetToCells(preset);
        // Canvas first, then columns, through the two merge commands; pushed
        // once so a single undo reverts the whole preset.
        const next = applyCommand(
          applyCommand(document, { type: 'document/canvas', patch: { width: cells.columns, height: cells.rows } }),
          { type: 'document/imageSettings', patch: { columns: cells.columns } },
        );
        if (next === document) return;
        history.push(next, { key: 'canvasPreset' });
        set({ document: next, isDirty: true });
        const px = canvasCellsToPixels(cells);
        get().setStatusMessage(
          `Canvas preset ${preset.label}: ${cells.columns} x ${cells.rows} cells (${px.width} x ${px.height} px)`,
        );
        get().triggerRender();
      },

      setMetadata: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/metadata', patch });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
        }
      },

      setEditorState: (patch) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'editor', patch });
        if (next !== document) {
          history.push(next);
          set({ document: next });
        }
      },

      setGuides: (guides) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'document/guides', guides });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
        }
      },

      // Render pipeline
      triggerRender: () => {
        const gen = bumpGeneration();
        set({ renderGeneration: gen, pendingRender: true });
      },

      setRenderGeneration: (gen) => set({ renderGeneration: gen }),
      setPendingRender: (pending) => set({ pendingRender: pending }),
      setRenderStats: (stats) => set({ lastRenderStats: stats, pendingRender: false }),

      // Effects Pipeline
      addEffect: (effectId: EffectId, params) => {
        const { effectsPipeline } = get();
        const defaults = DEFAULT_EFFECT_PARAMS[effectId] || {};
        const mergedParams = { ...defaults, ...params };
        commitEffects(addEffect(effectsPipeline, effectId, mergedParams));
      },

      removeEffect: (index) => {
        commitEffects(removeEffect(get().effectsPipeline, index));
      },

      reorderEffects: (fromIndex, toIndex) => {
        commitEffects(reorderEffects(get().effectsPipeline, fromIndex, toIndex));
      },

      updateEffectParams: (index, params) => {
        commitEffects(updateEffectParams(get().effectsPipeline, index, params));
      },

      setEffectEnabled: (index, enabled) => {
        commitEffects(setEffectEnabled(get().effectsPipeline, index, enabled));
      },

      setEffectIntensity: (index, intensity) => {
        commitEffects(setEffectIntensity(get().effectsPipeline, index, intensity));
      },

      resetEffectsPipeline: () => {
        commitEffects(createEffectsPipeline());
      },

      // Cell effects
      addCellEffect: (effectId, params) => {
        const effect = getRegistryEffect(effectId);
        if (!effect) return;
        commitCellEffects(
          appendCellEffect(get().cellEffects, {
            effect: effectId,
            enabled: true,
            intensity: 1,
            params: resolveParams(effect, params),
          }),
        );
      },

      removeCellEffect: (index) => commitCellEffects(removeCellEffectAt(get().cellEffects, index)),

      reorderCellEffect: (fromIndex, toIndex) =>
        commitCellEffects(moveCellEffect(get().cellEffects, fromIndex, toIndex)),

      updateCellEffectParams: (index, params) =>
        commitCellEffects(setCellEffectParams(get().cellEffects, index, params)),

      setCellEffectEnabled: (index, enabled) =>
        commitCellEffects(patchCellEffect(get().cellEffects, index, { enabled })),

      setCellEffectIntensity: (index, intensity) =>
        commitCellEffects(patchCellEffect(get().cellEffects, index, { intensity })),

      setCellEffectMask: (index, mask) =>
        commitCellEffects(patchCellEffect(get().cellEffects, index, { mask })),

      setCellEffectDelay: (index, delay) =>
        commitCellEffects(patchCellEffect(get().cellEffects, index, { delay })),

      resetCellEffects: () => commitCellEffects([]),

      setFxSeed: (seed) => {
        const doc = get().document;
        const next = seed | 0;
        set({ fxSeed: next, document: { ...doc, fxSeed: next }, isDirty: true });
      },

      // Timeline. Authoring edits dispatch `document/timeline`, so they are
      // undoable, dirty the project and round-trip through .aap; applyCommand
      // reconciles this slice from the document.
      createTimeline: (name = 'New Timeline', fps = 30, duration = 300) => {
        get().applyCommand({
          type: 'document/timeline',
          timeline: createTimeline(name, fps, duration),
        });
      },

      addTimelineTrack: (layerId, property, name) => {
        const { timeline } = get();
        if (!timeline) return;
        get().applyCommand({
          type: 'document/timeline',
          timeline: addTrack(timeline, layerId, property, name),
        });
      },

      removeTimelineTrack: (trackId) => {
        const { timeline } = get();
        if (!timeline) return;
        get().applyCommand({
          type: 'document/timeline',
          timeline: removeTrack(timeline, trackId),
        });
      },

      setTimelineKeyframe: (trackId, frame, value, easing = 'linear') => {
        const { timeline } = get();
        if (!timeline) return;
        get().applyCommand({
          type: 'document/timeline',
          timeline: setKeyframe(timeline, trackId, frame, value, easing as any),
        });
      },

      removeTimelineKeyframe: (trackId, frame) => {
        const { timeline } = get();
        if (!timeline) return;
        get().applyCommand({
          type: 'document/timeline',
          timeline: removeKeyframe(timeline, trackId, frame),
        });
      },

      // Transport: session view state. These never touch the document, so
      // seeking or playing cannot dirty the project.
      setTimelineCurrentFrame: (frame) => {
        const timeline = get().timeline;
        if (!timeline) return;
        set({
          timeline: {
            ...timeline,
            currentFrame: Math.max(0, Math.min(timeline.duration - 1, frame)),
          },
        });
      },

      setTimelinePlaying: (playing) => {
        const timeline = get().timeline;
        if (!timeline) return;
        set({ timeline: { ...timeline, playing } });
      },

      setTimelineLoop: (loop) => {
        const timeline = get().timeline;
        if (!timeline) return;
        set({ timeline: { ...timeline, loop } });
      },

      setOnionSkin: (enabled, frames = 1, opacity = 0.3) => {
        const timeline = get().timeline;
        if (!timeline) return;
        set({
          timeline: {
            ...timeline,
            onionSkinEnabled: enabled,
            onionSkinFrames: frames,
            onionSkinOpacity: opacity,
          },
        });
      },

      // Palettes
      addPalette: (palette) => {
        set((state) => ({ palettes: [...state.palettes, palette] }));
      },

      removePalette: (paletteId) => {
        set((state) => ({
          palettes: state.palettes.filter((p) => p.id !== paletteId),
          activePaletteId: state.activePaletteId === paletteId ? null : state.activePaletteId,
        }));
      },

      setActivePalette: (paletteId) => {
        set({ activePaletteId: paletteId });
      },

      updatePalette: (paletteId, updates) => {
        set((state) => ({
          palettes: state.palettes.map((p) =>
            p.id === paletteId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
          ),
        }));
      },

      // Presets
      saveRenderPreset: (preset) => {
        const newPreset: RenderPreset = {
          ...preset,
          id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ renderPresets: [...state.renderPresets, newPreset] }));
      },

      deleteRenderPreset: (presetId) => {
        set((state) => ({ renderPresets: state.renderPresets.filter((p) => p.id !== presetId) }));
      },

      applyRenderPreset: (presetId) => {
        const { renderPresets, document, history } = get();
        const preset = renderPresets.find((p) => p.id === presetId);
        if (!preset) return;

        let next = document;
        next = applyCommand(next, { type: 'document/imageSettings', patch: preset.imageSettings } as any);
        next = applyCommand(next, { type: 'document/textSettings', patch: preset.textSettings } as any);
        next = applyCommand(next, { type: 'document/exportSettings', patch: preset.exportSettings } as any);
        if (preset.effectsPipeline) {
          next = { ...next, effectsPipeline: preset.effectsPipeline };
        }
        if (preset.paletteId) {
          next = { ...next, paletteId: preset.paletteId };
        }

        history.push(next, { key: 'preset' });
        set({ document: next, isDirty: true, effectsPipeline: preset.effectsPipeline ?? get().effectsPipeline });
        get().triggerRender();
      },

      // Theme
      setTheme: (themeId) => {
        const { availableThemes } = get();
        const theme = availableThemes.find((t) => t.id === themeId);
        if (!theme) return;
        applyTheme(theme);
        set({ theme });
      },

      createCustomTheme: (overrides) => {
        const { theme } = get();
        const custom = createCustomTheme(theme, overrides);
        set((state) => ({
          availableThemes: [...state.availableThemes, custom],
          theme: custom,
        }));
        applyTheme(custom);
      },

      // UI actions
      setActivePanel: (panel) => set({ activePanel: panel }),
      setActiveRightPanel: (panel) => set({ activeRightPanel: panel }),
      toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
      toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
      toggleCrtGlow: () => set((s) => ({ crtGlow: !s.crtGlow })),
      toggleGpuPreview: () => set((s) => ({ gpuPreview: !s.gpuPreview })),
      disableGpuPreview: (reason) => {
        if (!get().gpuPreview) return;
        set({
          gpuPreview: false,
          statusMessage: `GPU preview unavailable - using the 2D canvas (${reason})`,
        });
      },
      setZoom: (zoom) => set({ zoomLevel: Math.max(0.1, Math.min(10, zoom)) }),
      setStatusMessage: (msg) => set({ statusMessage: msg }),
      setRenderAnalysis: (analysis) => set({ renderAnalysis: analysis }),

      setViewport: (viewport) => set((s) => ({ viewport: { ...s.viewport, ...viewport } })),
      setSelection: (selection) => set({ selection: selection ?? emptySelection() }),
      setTool: (tool) => set((s) => ({ tool: { ...s.tool, ...tool } })),

      copySelection: () => {
        const st = get();
        const target = clipboardTarget(false);
        const stamp = target ? extractSelection(target.grid, st.selection) : null;
        if (!stamp) {
          st.setStatusMessage(st.selection.bounds ? 'Nothing to copy' : 'Nothing selected');
          return;
        }
        set({ clipboard: stamp });
        st.setStatusMessage(`Copied ${stamp.width}×${stamp.height} cells`);
      },

      cutSelection: () => {
        const st = get();
        if (!st.selection.bounds) {
          st.setStatusMessage('Nothing selected');
          return;
        }
        const target = clipboardTarget(true);
        if (!target) return;
        const stamp = extractSelection(target.grid, st.selection);
        const cleared = clearSelection(target.grid, st.selection);
        if (stamp) set({ clipboard: stamp });
        if (cleared === target.grid) {
          st.setStatusMessage('Selection is already blank');
          return;
        }
        get().applyCommand({ type: 'grid/paint', layerId: target.layer.id, grid: cleared });
        st.setStatusMessage('Cut to clipboard (Ctrl+V pastes back, Ctrl+Z undoes)');
      },

      pasteClipboard: () => {
        const st = get();
        if (!st.clipboard) {
          st.setStatusMessage('Clipboard is empty');
          return;
        }
        const target = clipboardTarget(true);
        if (!target) return;
        // Paste where the selection is (so cut → paste restores in place),
        // otherwise at the top-left corner.
        const at = st.selection.bounds ?? { x: 0, y: 0 };
        const pasted = pasteGrid(target.grid, st.clipboard, at.x, at.y);
        if (pasted === target.grid) {
          st.setStatusMessage('Paste had no effect');
          return;
        }
        get().applyCommand({ type: 'grid/paint', layerId: target.layer.id, grid: pasted });
        st.setStatusMessage('Pasted (Ctrl+Z to undo)');
      },

      deleteSelection: () => {
        const st = get();
        if (!st.selection.bounds) {
          st.setStatusMessage('Nothing selected');
          return;
        }
        const target = clipboardTarget(true);
        if (!target) return;
        const cleared = clearSelection(target.grid, st.selection);
        if (cleared === target.grid) {
          st.setStatusMessage('Selection is already blank');
          return;
        }
        get().applyCommand({ type: 'grid/paint', layerId: target.layer.id, grid: cleared });
        st.setStatusMessage('Selection cleared (Ctrl+Z to undo)');
      },

      setQualityMode: (mode) => set({ qualityMode: mode }),
      toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),
      setPerfStats: (stats) => set({ perfStats: stats }),

      setTerminalMode: (enabled) => set({ terminalMode: enabled }),
      setTerminalSize: (cols, rows) => set({ terminalCols: cols, terminalRows: rows }),
    };
  })
);

/**
 * Subscribe with a selector that returns a plain object/array of slices.
 * Uses shallow equality so getSnapshot stays referentially stable between
 * identical states (otherwise React 19 throws "getSnapshot should be cached"
 * and loops forever). Use this instead of `useStore((s) => ({ ... }))`.
 */
export function useStoreShallow<T>(selector: (state: AppState) => T): T {
  return useStore(useShallow(selector));
}

// Selectors
export const selectDocument = (state: AppState) => state.document;
export const selectHistory = (state: AppState) => state.history;
export const selectActiveLayer = (state: AppState): Layer | null => state.document.layers.find((l) => l.id === state.document.activeLayerId) ?? null;
export const selectLayers = (state: AppState) => state.document.layers;
export const selectImageSettings = (state: AppState) => state.document.imageSettings;
export const selectTextSettings = (state: AppState) => state.document.textSettings;
export const selectCanvasSettings = (state: AppState) => state.document.canvas;
export const selectIsDirty = (state: AppState) => state.isDirty;
export const selectRenderGeneration = (state: AppState) => state.renderGeneration;
export const selectPendingRender = (state: AppState) => state.pendingRender;
export const selectEffectsPipeline = (state: AppState) => state.effectsPipeline;
export const selectCellEffects = (state: AppState) => state.cellEffects;
export const selectFxSeed = (state: AppState) => state.fxSeed;
export const selectTimeline = (state: AppState) => state.timeline;
export const selectPalettes = (state: AppState) => state.palettes;
export const selectActivePaletteId = (state: AppState) => state.activePaletteId;
export const selectRenderPresets = (state: AppState) => state.renderPresets;
export const selectTheme = (state: AppState) => state.theme;
export const selectAvailableThemes = (state: AppState) => state.availableThemes;
export const selectActivePanel = (state: AppState) => state.activePanel;
export const selectActiveRightPanel = (state: AppState) => state.activeRightPanel;
export const selectShowGrid = (state: AppState) => state.showGrid;
export const selectQualityMode = (state: AppState) => state.qualityMode;
export const selectDebugOverlay = (state: AppState) => state.debugOverlay;
export const selectPerfStats = (state: AppState) => state.perfStats;
export const selectShowGuides = (state: AppState) => state.showGuides;
export const selectCrtGlow = (state: AppState) => state.crtGlow;
export const selectGpuPreview = (state: AppState) => state.gpuPreview;
export const selectZoomLevel = (state: AppState) => state.zoomLevel;
export const selectStatusMessage = (state: AppState) => state.statusMessage;
export const selectViewport = (state: AppState) => state.viewport;
export const selectSelection = (state: AppState) => state.selection;
export const selectTool = (state: AppState) => state.tool;
export const selectTerminalMode = (state: AppState) => state.terminalMode;
export const selectTerminalCols = (state: AppState) => state.terminalCols;
export const selectTerminalRows = (state: AppState) => state.terminalRows;
export const selectEffectsPipeline$ = (state: AppState) => state.effectsPipeline;
export const selectTimeline$ = (state: AppState) => state.timeline;
export const selectPalettes$ = (state: AppState) => state.palettes;
export const selectRenderPresets$ = (state: AppState) => state.renderPresets;