import CommandPalette from './components/CommandPalette';
import { DebugOverlay } from './components/DebugOverlay';
import { RenderSuggestions } from './components/RenderSuggestions';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore, useStoreShallow, selectDocument, selectActiveLayer, selectLayers, selectCanvasSettings, selectIsDirty, selectRenderGeneration, selectPendingRender, selectActivePanel, selectActiveRightPanel, selectShowGrid, selectShowGuides, selectCrtGlow, selectGpuPreview, selectZoomLevel, selectTheme, selectTool } from './store';
import { initAutosave, restoreAutosave } from './store/autosave';
import type { LeftPanelId, RightPanelId } from './store';
import type { ToolState } from './core/types';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { PropertyPanel } from './components/PropertyPanel';
import { ExportPanel } from './components/ExportPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { EditorCanvas } from './components/EditorCanvas';
import { TerminalPreview } from './components/TerminalPreview';
import { StatusBar } from './components/StatusBar';
import { NewProjectModal } from './components/NewProjectModal';
import { OpenProjectModal } from './components/OpenProjectModal';
import { SaveProjectModal } from './components/SaveProjectModal';
import { EffectsPanel } from './components/EffectsPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { PalettePanel } from './components/PalettePanel';
import { PresetPanel } from './components/PresetPanel';
import { ThemePanel } from './components/ThemePanel';
import { AsciiControlsPanel } from './components/AsciiControlsPanel';
import { GeneratorPanel } from './components/GeneratorPanel';
import { ImportImageButton, ImageDropZone } from './components/ImportImage';
import { renderImage, renderText, StaleRenderError } from './worker/client';
import { advanceFrame } from './core/timeline/playback';

const LEFT_TABS: Array<{ id: LeftPanelId; label: string }> = [
  { id: 'layers', label: 'Layers' },
  { id: 'properties', label: 'Properties' },
  { id: 'ascii', label: 'ASCII' },
  { id: 'timeline', label: 'Timeline' },
];

const RIGHT_TABS: Array<{ id: RightPanelId; label: string }> = [
  { id: 'export', label: 'Export' },
  { id: 'effects', label: 'Effects' },
  { id: 'palette', label: 'Palette' },
  { id: 'presets', label: 'Presets' },
  { id: 'theme', label: 'Theme' },
  { id: 'generators', label: 'Gen' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Quiet time required before a render is dispatched.
 *
 * Slider drags emit far more events than frames; coalescing them means one
 * worker render per pause instead of one per input event.
 */
const RENDER_DEBOUNCE_MS = 60;

/**
 * Worker progress -> status bar. The worker already posts stage/progress for
 * every image render; the app used to drop it (ARCHITECTURE_AUDIT item 12).
 * Messages carry the prefix so a completed render only clears its own text
 * instead of stomping on a save/import message that landed in between.
 */
const RENDER_STATUS_PREFIX = 'Rendering';
const RENDER_STAGE_LABELS: Record<string, string> = {
  decode: 'decoding',
  effects: 'effects',
  render: 'rasterising',
  done: 'finishing',
};

function renderProgress(stage: string, progress: number): void {
  const label = RENDER_STAGE_LABELS[stage] ?? stage;
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  useStore.getState().setStatusMessage(`${RENDER_STATUS_PREFIX}: ${label} ${pct}%`);
}

function clearRenderProgress(): void {
  const { statusMessage, setStatusMessage } = useStore.getState();
  if (statusMessage.startsWith(RENDER_STATUS_PREFIX)) setStatusMessage('Ready');
}

/** Stable value for the status bar's cursor readout (a fresh literal per render defeats memo). */
const ORIGIN_CURSOR = { x: 0, y: 0 };

function App() {
  const reduceMotion = useReducedMotion();
  const panelMotion = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduceMotion ? 0 : -6 },
    transition: { duration: 0.16, ease: 'easeOut' as const },
  };
const {
    document,
    activeLayer,
    layers,
    canvasSettings,
    isDirty,
    renderGeneration,
    pendingRender,
    terminalMode,
    terminalCols,
    terminalRows,
    newDocument,
    setDocument,
    applyCommand,
    undo,
    redo,
    canUndo,
    canRedo,
    setRenderStats,
    setPendingRender,
    setStatusMessage,
    setActivePanel,
    activePanel,
    setActiveRightPanel,
    activeRightPanel,
    showGrid,
    showGuides,
    crtGlow,
    toggleCrtGlow,
    gpuPreview,
    toggleGpuPreview,
    zoomLevel,
    setZoom,
    setTerminalMode,
    setTerminalSize,
    theme,
    tool,
    setTool,
  } = useStoreShallow(
    (s) => ({
      document: selectDocument(s),
      activeLayer: selectActiveLayer(s),
      layers: selectLayers(s),
      canvasSettings: selectCanvasSettings(s),
      isDirty: selectIsDirty(s),
      renderGeneration: selectRenderGeneration(s),
      pendingRender: selectPendingRender(s),
      terminalMode: s.terminalMode,
      terminalCols: s.terminalCols,
      terminalRows: s.terminalRows,
      theme: selectTheme(s),
      tool: selectTool(s),
      setTool: s.setTool,
      newDocument: s.newDocument,
      setDocument: s.setDocument,
      applyCommand: s.applyCommand,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      setRenderStats: s.setRenderStats,
      setPendingRender: s.setPendingRender,
      setStatusMessage: s.setStatusMessage,
      setActivePanel: s.setActivePanel,
      activePanel: selectActivePanel(s),
      setActiveRightPanel: s.setActiveRightPanel,
      activeRightPanel: selectActiveRightPanel(s),
      showGrid: selectShowGrid(s),
      showGuides: selectShowGuides(s),
      crtGlow: selectCrtGlow(s),
      toggleCrtGlow: s.toggleCrtGlow,
      gpuPreview: selectGpuPreview(s),
      toggleGpuPreview: s.toggleGpuPreview,
      zoomLevel: selectZoomLevel(s),
      setZoom: s.setZoom,
      setTerminalMode: s.setTerminalMode,
      setTerminalSize: s.setTerminalSize,
    })
  );

  // Auto-render when generation changes.
  //
  // Two guards keep this cheap under heavy input: the start is debounced so a
  // burst of slider events coalesces into one worker render, and every result
  // is checked against the generation it was requested for so a superseded
  // render can neither overwrite newer content nor clear the pending flag.
  useEffect(() => {
    if (!pendingRender) return;
    const doc = useStore.getState().document;
    const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
    if (!activeLayer) return;
    const generationAtStart = renderGeneration;
    const isCurrent = () => useStore.getState().renderGeneration === generationAtStart;
    const onProgress = (stage: string, progress: number) => {
      if (isCurrent()) renderProgress(stage, progress);
    };

    const doRender = async () => {
      const { imageSettings, textSettings } = doc;
      const effectsPipeline = useStore.getState().effectsPipeline;
      try {
        if (activeLayer.kind === 'image' && activeLayer.source) {
          const result = await renderImage(
            activeLayer.source.dataUrl,
            imageSettings,
            effectsPipeline,
            onProgress,
          );
          if (!isCurrent()) return;
          applyCommand({ type: 'grid/replace', layerId: activeLayer.id, grid: result.grid });
          setRenderStats({ durationMs: result.stats.durationMs, cells: result.stats.cells });
          clearRenderProgress();
        } else if (activeLayer.kind === 'text') {
          const result = await renderText(activeLayer.text, textSettings, onProgress);
          if (!isCurrent()) return;
          applyCommand({ type: 'grid/replace', layerId: activeLayer.id, grid: result.grid });
          setRenderStats({ durationMs: result.stats.durationMs, cells: result.stats.cells });
          clearRenderProgress();
        }
      } catch (e) {
        // Superseded renders are expected during fast input, not failures.
        if (e instanceof StaleRenderError) return;
        console.error('Render failed:', e);
        setStatusMessage(`Render error: ${e instanceof Error ? e.message : 'unknown'}`);
      } finally {
        if (isCurrent()) {
          setPendingRender(false);
          clearRenderProgress();
        }
      }
    };

    const timer = window.setTimeout(doRender, RENDER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [renderGeneration, pendingRender]);

  // Creative layers re-evaluate whenever any input changes (graph content,
  // render settings, canvas size, seed). The cache-key check is a couple of
  // string compares for a fresh layer; a stale one recomputes and writes a
  // non-undoable `layer/derive` (RENDER_OUTPUT_COMMANDS), which lands a new
  // document and brings us back here with a matching key - no loop.
  useEffect(() => {
    void useStore.getState().refreshCreativeLayers();
  }, [document]);

  // Timeline playback: a rAF loop advancing the playhead at the timeline's
  // fps. Only the timeline slice changes - the document and the render
  // generation are untouched (seeking is pure view state).
  // Command palette (Ctrl+K). Kept as local UI state — it never touches the
  // document, so opening it does not dirty the project.
  const [paletteOpen, setPaletteOpen] = useState(false);

  const timelinePlaying = useStore((s) => s.timeline?.playing ?? false);
  const timelineFps = useStore((s) => s.timeline?.fps ?? 30);
  useEffect(() => {
    if (!timelinePlaying) return;
    const frameBudget = 1000 / Math.max(1, timelineFps);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      acc += now - last;
      last = now;
      if (acc < frameBudget) return;
      // If the machine stalled, drop the backlog instead of fast-forwarding.
      acc = acc > frameBudget * 4 ? frameBudget : acc - frameBudget;
      const st = useStore.getState();
      const tl = st.timeline;
      if (!tl || !tl.playing) return;
      const next = advanceFrame(tl);
      if (next.frame === null) st.setTimelinePlaying(false);
      else st.setTimelineCurrentFrame(next.frame);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timelinePlaying, timelineFps]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Never steal keys from a focused input/select/textarea (typing, native
      // undo, Enter to submit, ...).
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      // Unmodified letters select the drawing tool.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const toolByKey: Record<string, ToolState['activeTool']> = {
          s: 'select',
          b: 'brush',
          e: 'eraser',
          f: 'fill',
          t: 'text',
          i: 'eyedropper',
          h: 'pan',
        };
        const next = toolByKey[e.key.toLowerCase()];
        if (next) {
          e.preventDefault();
          useStore.getState().setTool({ activeTool: next });
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      // `!shiftKey` keeps the devtools element picker (Ctrl+Shift+C) alive.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().copySelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        useStore.getState().cutSelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        useStore.getState().pasteClipboard();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const st = useStore.getState();
        if (st.selection.bounds) {
          e.preventDefault();
          st.deleteSelection();
        }
      }
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.selection.bounds) {
          st.setSelection(null);
          st.setStatusMessage('Selection cleared');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new Event('ascii:save'));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newDocument();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        window.dispatchEvent(new Event('ascii:open'));
      }
      if (e.key === ' ') {
        e.preventDefault();
        setTerminalMode(!terminalMode);
      }
      if (e.key === 't' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        useStore.getState().setActivePanel('timeline');
      }
      if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        useStore.getState().setActiveRightPanel('palette');
      }
      if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        useStore.getState().setActiveRightPanel('effects');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [terminalMode]);

  // The palette shortcut lives outside `handleKeyDown` on purpose: it must
  // open even while an input is focused (that is where users reach for it).
  useEffect(() => {
    const openPalette = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) return;
      e.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', openPalette);
    return () => window.removeEventListener('keydown', openPalette);
  }, []);

  // Autosave: while dirty, snapshot the document on a debounce; at boot,
  // recover a snapshot left behind by a crash or closed tab (see
  // src/store/autosave.ts for the full policy).
  useEffect(() => {
    const dispose = initAutosave();
    restoreAutosave();
    return dispose;
  }, []);

  // Native File/Edit/View menu (see electron/main.ts) -> the same actions the
  // toolbar exposes. `electronAPI` only exists inside the packaged app.
  useEffect(() => {
    const api = (
      window as unknown as {
        electronAPI?: { onMenuAction: (callback: (action: string) => void) => () => void };
      }
    ).electronAPI;
    if (!api?.onMenuAction) return;
    const unsubscribe = api.onMenuAction((action) => {
      const store = useStore.getState();
      switch (action) {
        case 'new':
          store.newDocument();
          break;
        case 'open':
          window.dispatchEvent(new Event('ascii:open'));
          break;
        case 'save':
          window.dispatchEvent(new Event('ascii:save'));
          break;
        case 'undo':
          store.undo();
          break;
        case 'redo':
          store.redo();
          break;
        case 'toggle-terminal':
          store.setTerminalMode(!store.terminalMode);
          break;
        default:
          break;
      }
    });
    // Marker for automation: the native menu bridge is hooked up.
    (window as unknown as Record<string, unknown>).__menuHooked = true;
    return unsubscribe;
  }, []);

  return (
    <div className="app" data-theme={theme.id}>
      <Toolbar
        onNew={newDocument}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onToggleTerminal={() => setTerminalMode(!terminalMode)}
        terminalMode={terminalMode}
        zoomLevel={zoomLevel}
        onZoomChange={setZoom}
        crtGlow={crtGlow}
        onToggleCrtGlow={toggleCrtGlow}
        gpuPreview={gpuPreview}
        onToggleGpuPreview={toggleGpuPreview}
        tool={tool}
        onToolChange={setTool}
        modals={
          <>
            <ImportImageButton />
            <NewProjectModal onCreate={newDocument} />
            <OpenProjectModal onOpen={setDocument} />
            <SaveProjectModal document={document} isDirty={isDirty} />
            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            <DebugOverlay />
            <RenderSuggestions />
          </>
        }
      />

      <div className="main-layout">
        <aside className="left-panel">
          <div className="panel-tabs" role="tablist" aria-label="Document panels">
            {LEFT_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                id={`tab-left-${tab.id}`}
                aria-selected={activePanel === tab.id}
                aria-controls="panel-left"
                className={activePanel === tab.id ? 'active' : ''}
                onClick={() => setActivePanel(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="panel-content"
            id="panel-left"
            role="tabpanel"
            aria-labelledby={`tab-left-${activePanel}`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={activePanel} {...panelMotion}>
                {activePanel === 'layers' && (
                  <LayerPanel layers={layers} activeLayerId={document.activeLayerId} />
                )}
                {activePanel === 'properties' && <PropertyPanel layer={activeLayer ?? null} />}
                {activePanel === 'ascii' && <AsciiControlsPanel />}
                {activePanel === 'timeline' && <TimelinePanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>

        <main className="editor-area">
          <ImageDropZone>
            <EditorCanvas
              document={document}
              activeLayer={activeLayer}
              showGrid={showGrid}
              showGuides={showGuides}
              zoomLevel={zoomLevel}
            />
          </ImageDropZone>
        </main>

        <aside className="right-panel">
          <div className="panel-tabs" role="tablist" aria-label="Tool panels">
            {RIGHT_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                id={`tab-right-${tab.id}`}
                aria-selected={activeRightPanel === tab.id}
                aria-controls="panel-right"
                className={activeRightPanel === tab.id ? 'active' : ''}
                onClick={() => setActiveRightPanel(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            className="panel-content"
            id="panel-right"
            role="tabpanel"
            aria-labelledby={`tab-right-${activeRightPanel}`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={activeRightPanel} {...panelMotion}>
                {activeRightPanel === 'export' && <ExportPanel />}
                {activeRightPanel === 'effects' && <EffectsPanel />}
                {activeRightPanel === 'palette' && <PalettePanel />}
                {activeRightPanel === 'presets' && <PresetPanel />}
                {activeRightPanel === 'theme' && <ThemePanel />}
                {activeRightPanel === 'generators' && <GeneratorPanel />}
                {activeRightPanel === 'settings' && (
                  <SettingsPanel
                    imageSettings={document.imageSettings}
                    textSettings={document.textSettings}
                    canvasSettings={canvasSettings}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>
      </div>

      {terminalMode && (
        <TerminalPreview
          document={document}
          cols={terminalCols}
          rows={terminalRows}
          onResize={setTerminalSize}
        />
      )}

      <StatusBar
        isDirty={isDirty}
        renderGeneration={renderGeneration}
        pendingRender={pendingRender}
        cursor={activeLayer ? ORIGIN_CURSOR : null}
        zoomLevel={zoomLevel}
      />
    </div>
  );
}

export default App;