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
import { ASPECT_PRESETS } from '../core/types';
import { columnsForImageWidth } from '../core/renderImage';
import { createDocument } from '../core/project/schema';
import { applyCommand, type Command } from '../core/history/commands';
import { History } from '../core/history/history';
import {
  CANVAS_PRESETS,
  canvasCellsToPixels,
  canvasPresetToCells,
  type CanvasPresetId,
} from '../core/canvasPresets';
import { bumpGeneration } from '../worker/client';
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

  // Timeline / Animation
  timeline: Timeline | null;
  timelines: Timeline[];
  activeTimelineId: string | null;

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
  setActiveTimeline: (timelineId: string | null) => void;
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
  setSelection: (selection: Partial<SelectionState>) => void;
  setTool: (tool: Partial<ToolState>) => void;

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
 *   (render → grid/replace → render would otherwise spin forever).
 * - `GRID_EDIT_COMMANDS` are direct user edits to the grid: undoable, but a
 *   re-render would wipe them, so they must not schedule one.
 */
const RENDER_OUTPUT_COMMANDS: ReadonlySet<Command['type']> = new Set(['grid/replace']);
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
const defaultTimeline = createTimeline('Main Timeline', 30, 300);

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

    // Does moving between two documents change what the worker should draw?
    const renderSettingsChanged = (a: Document, b: Document): boolean =>
      !deepEqual(a.imageSettings, b.imageSettings) || !deepEqual(a.textSettings, b.textSettings);

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
      fxSeed: 0x5eed,
      timeline: defaultTimeline,
      timelines: [defaultTimeline],
      activeTimelineId: defaultTimeline.id,

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
      selection: { type: 'rectangle', bounds: null, layerIds: [] },
      tool: {
        activeTool: 'brush',
        brushSize: 1,
        brushChar: '#',
        brushOpacity: 1,
        brushHardness: 1,
        foregroundColor: 0xd4a53c,
        backgroundColor: 0xffffff,
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
          effectsPipeline: doc.effectsPipeline ?? createEffectsPipeline(),
          cellEffects: doc.cellEffects ?? [],
        });
        get().triggerRender();
      },

      setDocument: (doc, handle) => {
        set({
          document: doc,
          history: new History(doc, { limit: 200, coalesceWindowMs: 800 }),
          isDirty: false,
          fileHandle: handle ?? null,
          // A loaded project carries its own effects stack.
          effectsPipeline: doc.effectsPipeline ?? createEffectsPipeline(),
          cellEffects: doc.cellEffects ?? [],
        });
        get().triggerRender();
      },

      applyCommand: (cmd) => {
        const { document, history } = get();
        const next = applyCommand(document, cmd);
        if (next === document) return;
        if (RENDER_OUTPUT_COMMANDS.has(cmd.type)) {
          set({ document: next });
          return;
        }
        history.push(next, { key: cmd.type });
        set({ document: next, isDirty: true });
        if (!GRID_EDIT_COMMANDS.has(cmd.type)) get().triggerRender();
      },

      undo: () => {
        const { history, document } = get();
        const prev = history.undo();
        if (prev) {
          set({
            document: prev,
            isDirty: true,
            effectsPipeline: prev.effectsPipeline ?? createEffectsPipeline(),
            cellEffects: prev.cellEffects ?? [],
          });
          // Only re-render when the undo restored render-affecting settings;
          // re-rendering a paint undo would regenerate the layer and wipe it.
          if (renderSettingsChanged(document, prev)) get().triggerRender();
        }
      },

      redo: () => {
        const { history, document } = get();
        const next = history.redo();
        if (next) {
          set({
            document: next,
            isDirty: true,
            effectsPipeline: next.effectsPipeline ?? createEffectsPipeline(),
            cellEffects: next.cellEffects ?? [],
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
          get().triggerRender();
        }
      },

      moveLayer: (layerId, toIndex) => {
        const { document, history } = get();
        const next = applyCommand(document, { type: 'layer/move', layerId, toIndex });
        if (next !== document) {
          history.push(next);
          set({ document: next, isDirty: true });
          get().triggerRender();
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
        set({ fxSeed: seed | 0, document: { ...doc }, isDirty: true });
      },

      // Timeline
      createTimeline: (name = 'New Timeline', fps = 30, duration = 300) => {
        const timeline = createTimeline(name, fps, duration);
        set((state) => ({
          timelines: [...state.timelines, timeline],
          timeline,
          activeTimelineId: timeline.id,
        }));
      },

      setActiveTimeline: (timelineId) => {
        const { timelines } = get();
        const timeline = timelines.find((t) => t.id === timelineId) ?? null;
        set({ activeTimelineId: timelineId, timeline });
      },

      addTimelineTrack: (layerId, property, name) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = addTrack(timeline, layerId, property, name);
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      removeTimelineTrack: (trackId) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = removeTrack(timeline, trackId);
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      setTimelineKeyframe: (trackId, frame, value, easing = 'linear') => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = setKeyframe(timeline, trackId, frame, value, easing as any);
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      removeTimelineKeyframe: (trackId, frame) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = removeKeyframe(timeline, trackId, frame);
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      setTimelineCurrentFrame: (frame) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = { ...timeline, currentFrame: Math.max(0, Math.min(timeline.duration - 1, frame)) };
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      setTimelinePlaying: (playing) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = { ...timeline, playing };
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      setTimelineLoop: (loop) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = { ...timeline, loop };
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
        });
      },

      setOnionSkin: (enabled, frames = 1, opacity = 0.3) => {
        const { timeline, timelines, activeTimelineId } = get();
        if (!timeline) return;
        const updated = { ...timeline, onionSkinEnabled: enabled, onionSkinFrames: frames, onionSkinOpacity: opacity };
        set({
          timeline: updated,
          timelines: timelines.map((t) => (t.id === activeTimelineId ? updated : t)),
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
      setSelection: (selection) => set((s) => ({ selection: { ...s.selection, ...selection } })),
      setTool: (tool) => set((s) => ({ tool: { ...s.tool, ...tool } })),

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
export const selectTimelines = (state: AppState) => state.timelines;
export const selectActiveTimelineId = (state: AppState) => state.activeTimelineId;
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