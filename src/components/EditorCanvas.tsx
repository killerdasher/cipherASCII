import { useRef, useEffect, useMemo, useState } from 'react';
import { CELL_SIZE, type AsciiGrid, type Document, type Layer } from '../core/types';
import { composeDocument } from '../core/layer/compose';
import { cloneGrid, getCell } from '../core/grid';
import { applySubtexture, shouldApplySubtexture } from '../core/subtexture';
import { applyTimelineToDocument, getOnionSkinFrames } from '../core/timeline/timeline';
import { timelineHasAnimation } from '../core/timeline/playback';
import { useStore } from '../store';
import { cellFxRuntime } from '../core/fx';
import { resolveBudget } from '../core/perf/quality';
import { adaptiveFps, createAdaptive, observeFrame } from '../core/perf/adaptive';
import { PixiViewport } from './PixiViewport';

interface EditorCanvasProps {
  document: Document;
  activeLayer: Layer | null;
  showGrid: boolean;
  showGuides: boolean;
  zoomLevel: number;
}

const CELL_W = CELL_SIZE.width;
const CELL_H = CELL_SIZE.height;
const NO_COLOR = -1;

/**
 * Bumped after every raster pass and mirrored onto the canvas as
 * `data-raster-rev`; the GPU viewport re-uploads its texture when it changes.
 */
let rasterRev = 0;

/**
 * Write one cell into a grid the caller already owns.
 *
 * Returns whether anything changed. The stroke path clones the layer grid
 * exactly once when the pointer goes down and then mutates that clone, so a
 * brush costs O(1) allocations per stroke instead of O(cells) per cell.
 */
function paintCellInPlace(grid: AsciiGrid, x: number, y: number, ch: string, color: number): boolean {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
  const c = ch.length === 0 ? ' ' : [...ch][0];
  const i = y * grid.width + x;
  const current = grid.fg ? grid.fg[i] : NO_COLOR;
  if (grid.chars[i] === c && current === color) return false;
  grid.chars[i] = c;
  if (grid.fg) {
    grid.fg[i] = color;
  } else if (color !== NO_COLOR) {
    grid.fg = new Int32Array(grid.width * grid.height).fill(NO_COLOR);
    grid.fg[i] = color;
  }
  return true;
}

/** Stamp a square brush of `size` cells centred on (cx, cy), in place. */
function stampInPlace(
  grid: AsciiGrid,
  cx: number,
  cy: number,
  size: number,
  ch: string,
  color: number,
): boolean {
  const radius = Math.floor((Math.max(1, size) - 1) / 2);
  let changed = false;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (paintCellInPlace(grid, cx + dx, cy + dy, ch, color)) changed = true;
    }
  }
  return changed;
}

/** Bresenham line so fast pointer moves leave no gaps in the stroke. */
function walkLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** 4-connected flood fill by character; returns the input grid when nothing changed. */
function floodFill(
  grid: AsciiGrid,
  startX: number,
  startY: number,
  ch: string,
  color: number,
): AsciiGrid {
  if (startX < 0 || startY < 0 || startX >= grid.width || startY >= grid.height) return grid;
  const i0 = startY * grid.width + startX;
  const target = grid.chars[i0];
  const targetColor = grid.fg ? grid.fg[i0] : NO_COLOR;
  if (target === ch && targetColor === color) return grid;
  const next = cloneGrid(grid);
  if (!next.fg) next.fg = new Int32Array(grid.width * grid.height).fill(NO_COLOR);
  const stack: number[] = [i0];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (next.chars[i] !== target) continue;
    next.chars[i] = ch;
    next.fg[i] = color;
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    if (x > 0) stack.push(i - 1);
    if (x + 1 < grid.width) stack.push(i + 1);
    if (y > 0) stack.push(i - grid.width);
    if (y + 1 < grid.height) stack.push(i + grid.width);
  }
  return next;
}

export function EditorCanvas({ document, activeLayer, showGrid, zoomLevel }: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const previewGridRef = useRef<AsciiGrid | null>(null);
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [previewGrid, setPreviewGrid] = useState<AsciiGrid | null>(null);
  const themeId = useStore((s) => s.theme.id);
  const crtGlow = useStore((s) => s.crtGlow);
  const gpuPreview = useStore((s) => s.gpuPreview);
  const tool = useStore((s) => s.tool);
  const timeline = useStore((s) => s.timeline);
  const cellEffects = useStore((s) => s.cellEffects);
  const fxSeed = useStore((s) => s.fxSeed);
  // Live cell-effect output. `null` means "paint the plain composed document".
  const [fxGrid, setFxGrid] = useState<AsciiGrid | null>(null);

  // Adaptive quality: smoothed frame time drives a 0..3 level (only consulted
  // when qualityMode is `auto`). A ref so the paint/effect paths can record
  // samples without re-rendering the component.
  const qualityMode = useStore((s) => s.qualityMode);
  const debugOverlay = useStore((s) => s.debugOverlay);
  const adaptiveRef = useRef(createAdaptive());

  // Animated documents: while the timeline has keyframes the editor composes
  // the frame under the playhead instead of the raw document. Pure - the
  // store's document is never touched by seeking or playing.
  const baseDocument = useMemo(() => {
    if (!timeline || !timelineHasAnimation(timeline)) return document;
    return applyTimelineToDocument(document, timeline, timeline.currentFrame);
  }, [document, timeline]);

  // Ghost frames for the onion skin (previous/next frames behind the current
  // one), composed the same way as the live frame.
  const onionGrids = useMemo(() => {
    if (!timeline || !timeline.onionSkinEnabled || !timelineHasAnimation(timeline)) return [];
    return getOnionSkinFrames(timeline, timeline.currentFrame, 'both').map((frame) =>
      composeDocument(applyTimelineToDocument(document, timeline, frame)),
    );
  }, [document, timeline]);

  // While a stroke is in progress the edited grid replaces the active layer's
  // content in memory only; the change is committed as a single undoable
  // command when the pointer goes up.
  const previewDocument = useMemo(() => {
    if (!previewGrid) return baseDocument;
    return {
      ...baseDocument,
      layers: baseDocument.layers.map((layer) =>
        layer.id === baseDocument.activeLayerId
          ? ({ ...layer, grid: previewGrid } as Layer)
          : layer,
      ),
    };
  }, [baseDocument, previewGrid]);
  const composedGrid = useMemo(() => composeDocument(previewDocument), [previewDocument]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const paintStart = performance.now();

    // Resolve every canvas colour from the active theme so switching themes
    // restyles the preview along with the rest of the application.
    // NOTE: `document` in this scope is the project document prop, so the DOM
    // document has to be reached through `window`.
    const css = getComputedStyle(window.document.documentElement);
    const readVar = (name: string, fallback: string): string => {
      const value = css.getPropertyValue(name).trim();
      if (!value) return fallback;
      // Canvas needs a serialisable colour; var() references are not resolvable
      // here, so only accept literal values.
      return value.startsWith('var(') ? fallback : value;
    };
    // The artboard sits on `--bg-elevated` (paper) over the `--bg` pasteboard.
    const bg = readVar('--bg-elevated', readVar('--bg', '#0c0c10'));
    const fg = readVar('--fg', '#d4d4d8');
    const border = readVar('--border', '#333333');

    const grid = fxGrid ?? composedGrid;
    const cellW = CELL_W * zoomLevel;
    const cellH = CELL_H * zoomLevel;
    const width = grid.width * cellW;
    const height = grid.height * cellH;
    // Assigning width/height resets the backing store; only pay that when the
    // size actually changed.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${cellH}px monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    if (showGrid) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= grid.width; x++) {
        ctx.moveTo(x * cellW, 0);
        ctx.lineTo(x * cellW, canvas.height);
      }
      for (let y = 0; y <= grid.height; y++) {
        ctx.moveTo(0, y * cellH);
        ctx.lineTo(canvas.width, y * cellH);
      }
      ctx.stroke();
    }

    // fillStyle is a setter that parses the string; assigning it once per
    // colour run instead of once per cell is the difference between a paint
    // and a paint that stutters on dense grids.
    const paintGrid = (target: AsciiGrid): void => {
      let fill = '';
      for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < target.width; x++) {
          const ch = target.chars[y * target.width + x];
          if (ch === ' ') continue;
          const cell = target.fg ? target.fg[y * target.width + x] : -1;
          const next = cell !== -1 && cell >= 0 ? `#${cell.toString(16).padStart(6, '0')}` : fg;
          if (next !== fill) {
            fill = next;
            ctx.fillStyle = next;
          }
          ctx.fillText(ch, x * cellW, y * cellH);
        }
      }
    };

    // Onion skin: ghost frames behind the live frame, faded with the
    // timeline's opacity (same glyph painting as the main pass).
    if (onionGrids.length > 0 && (timeline?.onionSkinOpacity ?? 0) > 0) {
      ctx.save();
      ctx.globalAlpha = timeline ? timeline.onionSkinOpacity : 0.3;
      for (const ghost of onionGrids) paintGrid(ghost);
      ctx.restore();
    }

    paintGrid(grid);

    // Subtexture mask: multiplied over the painted pixels so the ASCII reads
    // as if seen through an LCD/CRT screen. Same math as the PNG export, and
    // skipped on canvases too large for a getImageData round-trip.
    const budget = resolveBudget(qualityMode, adaptiveRef.current.level);
    const subtexture = document.canvas.subtexture;
    if (budget.fullEffects && shouldApplySubtexture(subtexture, canvas.width, canvas.height)) {
      const masked = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applySubtexture(masked.data, masked.width, masked.height, subtexture);
      ctx.putImageData(masked, 0, 0);
    }

    // CRT bloom: one blurred self-composite in "lighter" mode. A single
    // drawImage keeps this cheap regardless of how many glyphs are drawn.
    // Skipped while the GPU viewport is mounted - the CRT shader runs there,
    // and baking the 2D bloom too would double it.
    if (crtGlow && budget.fullEffects && !gpuPreview) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.filter = 'blur(3px)';
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();
    }

    // Hand the finished raster to the GPU viewport (if one is watching).
    canvas.dataset.rasterRev = String(++rasterRev);

    // Paint is the dominant per-frame cost, so it is what the adaptive
    // controller listens to (the effect loop reports its own cost too).
    adaptiveRef.current = observeFrame(adaptiveRef.current, performance.now() - paintStart, budget.targetMs);
  }, [composedGrid, fxGrid, onionGrids, timeline, zoomLevel, showGrid, themeId, document, crtGlow, gpuPreview, qualityMode]);

  // Cell-effect playback: advance the runtime at frame rate and repaint only
  // while it can still change pixels. The loop stops itself once every
  // one-shot has settled, so an idle editor costs zero frames.
  useEffect(() => {
    cellFxRuntime.sync(cellEffects, fxSeed);
    if (cellEffects.length === 0) {
      setFxGrid(null);
      return;
    }
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let accumulated = 0;
    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(64, Math.max(1, now - last));
      last = now;

      const budget = resolveBudget(qualityMode, adaptiveRef.current.level);
      const frameStart = performance.now();
      // The budget caps how *often* effects update; dt is accumulated across
      // skipped ticks, so an animation keeps real-time duration and simply
      // takes fewer, larger steps while the machine is behind.
      accumulated += dt;
      if (accumulated >= 1000 / budget.effectHz) {
        const advance = accumulated;
        accumulated = 0;
        const next = cellFxRuntime.frame(composedGrid, advance);
        if (next) {
          setFxGrid(next);
        } else if (!cellFxRuntime.needsFrames) {
          setFxGrid(null);
          return;
        }
      }
      adaptiveRef.current = observeFrame(adaptiveRef.current, performance.now() - frameStart, budget.targetMs);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [cellEffects, fxSeed, composedGrid, qualityMode]);

  // Debug overlay: publish a snapshot at ~2 Hz (never per animation frame) so
  // watching the numbers costs nothing while they are hidden.
  useEffect(() => {
    if (!debugOverlay) {
      if (useStore.getState().perfStats) useStore.getState().setPerfStats(null);
      return;
    }
    const publish = () => {
      const st = useStore.getState();
      const adaptive = adaptiveRef.current;
      const budget = resolveBudget(st.qualityMode, adaptive.level);
      st.setPerfStats({
        fps: adaptiveFps(adaptive),
        frameMs: adaptive.emaMs ?? 0,
        level: adaptive.level,
        effectHz: budget.effectHz,
        effects: st.cellEffects.length,
        renderMs: st.lastRenderStats?.durationMs ?? null,
        renderCells: st.lastRenderStats?.cells ?? null,
        generation: st.renderGeneration,
        gridWidth: composedGrid.width,
        gridHeight: composedGrid.height,
      });
    };
    publish();
    const id = window.setInterval(publish, 500);
    return () => window.clearInterval(id);
  }, [debugOverlay, composedGrid]);

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / (CELL_W * zoomLevel)),
      y: Math.floor((e.clientY - rect.top) / (CELL_H * zoomLevel)),
    };
  };

  // Real pointers always capture; synthetic ones (automation, tests) may not
  // have an active pointer id, which browsers reject with a DOMException.
  const capture = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no active pointer to capture */
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const store = useStore.getState();
    const activeTool = store.tool.activeTool;

    if (activeTool === 'pan') {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      panRef.current = { x: e.clientX, y: e.clientY, left: wrapper.scrollLeft, top: wrapper.scrollTop };
      capture(e);
      return;
    }

    if (!activeLayer) {
      store.setStatusMessage('No active layer - add one in Layers');
      return;
    }
    if (activeLayer.locked) {
      store.setStatusMessage('Layer is locked - unlock it in Layers');
      return;
    }
    const base = activeLayer.grid;
    if (!base) {
      store.setStatusMessage('Select an ASCII layer to draw on');
      return;
    }

    const cell = cellAt(e);
    capture(e);

    if (activeTool === 'eyedropper') {
      const ch = getCell(base, cell.x, cell.y);
      const inBounds = cell.x >= 0 && cell.y >= 0 && cell.x < base.width && cell.y < base.height;
      const color = inBounds && base.fg ? base.fg[cell.y * base.width + cell.x] : NO_COLOR;
      store.setTool({
        brushChar: ch,
        ...(color !== NO_COLOR ? { foregroundColor: color } : {}),
      });
      store.setStatusMessage(
        `Brush = ${ch === ' ' ? '(space)' : ch}` +
          (color !== NO_COLOR ? ` colour #${color.toString(16).padStart(6, '0')}` : ''),
      );
      return;
    }

    if (activeTool === 'fill') {
      const filled = floodFill(base, cell.x, cell.y, store.tool.brushChar, store.tool.foregroundColor);
      if (filled !== base) {
        store.applyCommand({ type: 'grid/paint', layerId: activeLayer.id, grid: filled });
        store.setStatusMessage('Region filled (Ctrl+Z to undo)');
      }
      return;
    }

    if (activeTool === 'brush' || activeTool === 'eraser') {
      const ch = activeTool === 'eraser' ? ' ' : store.tool.brushChar;
      const color = activeTool === 'eraser' ? NO_COLOR : store.tool.foregroundColor;
      // One clone for the whole stroke; every later cell mutates it in place.
      const start = cloneGrid(base);
      stampInPlace(start, cell.x, cell.y, store.tool.brushSize, ch, color);
      previewGridRef.current = start;
      lastCellRef.current = cell;
      setPreviewGrid(start);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current;
    const wrapper = wrapperRef.current;
    if (pan && wrapper) {
      wrapper.scrollLeft = pan.left - (e.clientX - pan.x);
      wrapper.scrollTop = pan.top - (e.clientY - pan.y);
      return;
    }

    const last = lastCellRef.current;
    const base = previewGridRef.current;
    if (!last || !base) return;

    const store = useStore.getState();
    const activeTool = store.tool.activeTool;
    if (activeTool !== 'brush' && activeTool !== 'eraser') return;

    const cell = cellAt(e);
    if (cell.x === last.x && cell.y === last.y) return;
    const ch = activeTool === 'eraser' ? ' ' : store.tool.brushChar;
    const color = activeTool === 'eraser' ? NO_COLOR : store.tool.foregroundColor;
    walkLine(last.x, last.y, cell.x, cell.y, (x, y) => {
      stampInPlace(base, x, y, store.tool.brushSize, ch, color);
    });
    lastCellRef.current = cell;
    // New object identity so React recomputes the preview; the arrays are
    // shared with `base`, which is the clone created at pointer-down.
    setPreviewGrid({ ...base });
  };

  const finishStroke = () => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const grid = previewGridRef.current;
    const layerId = activeLayer?.id;
    lastCellRef.current = null;
    previewGridRef.current = null;
    setPreviewGrid(null);
    if (!grid || !layerId) return;
    const store = useStore.getState();
    store.applyCommand({ type: 'grid/paint', layerId, grid });
    store.setStatusMessage('Stroke applied (Ctrl+Z to undo)');
  };

  return (
    <div className={`editor-canvas-wrapper tool-${tool.activeTool}`} ref={wrapperRef}>
      <div className="canvas-stack">
        <canvas
          ref={canvasRef}
          className="editor-canvas"
          style={gpuPreview ? { opacity: 0 } : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        {gpuPreview && (
          <PixiViewport
            sourceRef={canvasRef}
            crt={crtGlow}
            onFallback={(reason) => useStore.getState().disableGpuPreview(reason)}
          />
        )}
      </div>
    </div>
  );
}
