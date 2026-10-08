import { Suspense, lazy, useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { CELL_SIZE, type AsciiGrid, type Document, type Layer } from '../core/types';
import { composeDocument } from '../core/layer/compose';
import { cloneGrid, getCell, overlayGrid } from '../core/grid';
import { floodFill, stampInPlace, walkLine } from '../core/draw';
import { rectFromPoints, rectSelection, regionSelectionFromSeed, selectionClip } from '../core/selection';
import { renderTextToGrid } from '../core/text';
import { applySubtexture, shouldApplySubtexture } from '../core/subtexture';
import { applyTimelineToDocument, getOnionSkinFrames } from '../core/timeline/timeline';
import { timelineHasAnimation } from '../core/timeline/playback';
import { useStore, selectTextSettings } from '../store';
import { cellFxRuntime } from '../core/fx';
import { resolveBudget } from '../core/perf/quality';
import { adaptiveFps, createAdaptive, observeFrame } from '../core/perf/adaptive';
// Loaded only when the GPU preview is switched on: pixi.js is a ~510 kB
// vendor chunk, and 2D editing must not pay for it up front.
const PixiViewport = lazy(() => import('./PixiViewport').then((m) => ({ default: m.PixiViewport })));

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

export function EditorCanvas({ document, activeLayer, showGrid, zoomLevel }: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const previewGridRef = useRef<AsciiGrid | null>(null);
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // Select tool: drag state for the rectangle marquee. A ref (not store
  // state) so hovering costs no re-render — the rect is drawn straight from
  // `paint()` and the finished selection is committed once on pointer-up.
  const marqueeRef = useRef<{ anchor: { x: number; y: number }; current: { x: number; y: number } } | null>(
    null,
  );
  const [previewGrid, setPreviewGrid] = useState<AsciiGrid | null>(null);
  // Text tool: anchor cell + raw input. The rendered stamp flows through the
  // same previewGrid the brush uses, so the canvas shows the real thing while
  // typing and the commit is one ordinary undoable grid/paint command.
  const [textAnchor, setTextAnchor] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState('');
  const textSettings = useStore(selectTextSettings);
  const brushChar = useStore((s) => s.tool.brushChar);
  const foregroundColor = useStore((s) => s.tool.foregroundColor);
  const themeId = useStore((s) => s.theme.id);
  const crtGlow = useStore((s) => s.crtGlow);
  const gpuPreview = useStore((s) => s.gpuPreview);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const timeline = useStore((s) => s.timeline);
  const cellEffects = useStore((s) => s.cellEffects);
  const fxSeed = useStore((s) => s.fxSeed);
  // Live cell-effect output. `null` means "paint the plain composed document".
  // A ref (not state): the rAF effect loop mutates this buffer in place and
  // repaints directly — routing 60 fps frames through React state would both
  // bail out on identity equality and re-render the component per frame.
  const fxGridRef = useRef<AsciiGrid | null>(null);

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

  // --- Text tool ------------------------------------------------------------
  // Commit/cancel close the overlay and flush the stamped preview as one
  // undoable command, mirroring how a brush stroke commits on pointer-up.
  const commitText = (): void => {
    const grid = previewGridRef.current;
    const layerId = activeLayer?.id;
    previewGridRef.current = null;
    setPreviewGrid(null);
    setTextAnchor(null);
    setTextValue('');
    if (!grid || !layerId) return;
    const store = useStore.getState();
    store.applyCommand({ type: 'grid/paint', layerId, grid });
    store.setStatusMessage('Text placed (Ctrl+Z to undo)');
  };

  const cancelText = (): void => {
    previewGridRef.current = null;
    setPreviewGrid(null);
    setTextAnchor(null);
    setTextValue('');
  };

  // Live stamp: render the typed text into a clone of the active layer on
  // every keystroke / colour / font change, so the canvas shows exactly what
  // will be committed. Spaces in the stamp stay transparent - text composes
  // over the artwork instead of wiping a rectangle of it.
  useEffect(() => {
    if (!textAnchor || !activeLayer?.grid) return;
    if (textValue.length === 0) {
      if (previewGridRef.current) {
        previewGridRef.current = null;
        setPreviewGrid(null);
      }
      return;
    }
    const state = useStore.getState();
    const ink = state.tool.brushChar.trim() ? state.tool.brushChar : '#';
    const stamp = renderTextToGrid(textValue, textSettings, { fg: foregroundColor, inkChar: ink });
    const next = overlayGrid(activeLayer.grid, stamp, textAnchor.x, textAnchor.y, {
      spaceIsTransparent: true,
    });
    previewGridRef.current = next;
    setPreviewGrid(next);
  }, [textAnchor, textValue, textSettings, activeLayer, foregroundColor, brushChar]);

  const paint = useCallback(() => {
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

    // Effects that fade out blend toward the actual paper colour, so a light
    // theme fades to light instead of to black.
    cellFxRuntime.setPaper(Number.parseInt(bg.replace('#', ''), 16) || 0x0c0c10);

    const grid = fxGridRef.current ?? composedGrid;
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

    // Paint is what the exporters see: backgrounds first, then glyphs. The
    // PNG/HTML/ANSI exporters fill a cell's bg before its glyph — the editor
    // used to skip it, which hid every bg-writing effect from the preview.
    // Runs are collapsed into one fillRect per colour span, like the glyph
    // pass collapses its fillStyle changes.
    const paintGrid = (target: AsciiGrid): void => {
      if (target.bg) {
        for (let y = 0; y < target.height; y++) {
          const rowBase = y * target.width;
          let x = 0;
          while (x < target.width) {
            const colour = target.bg[rowBase + x];
            if (colour < 0) {
              x++;
              continue;
            }
            let run = x + 1;
            while (run < target.width && target.bg[rowBase + run] === colour) run++;
            ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
            ctx.fillRect(x * cellW, y * cellH, (run - x) * cellW, cellH);
            x = run;
          }
        }
      }
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

    // Selection outline — drawn after the effects so a tinted preview or the
    // CRT bloom never hides it. Static dashes (no idle rAF just to animate
    // marching ants): a rectangle strokes its bounds, a region strokes the
    // mask contour — every edge between a selected and an unselected cell.
    // While a marquee drag is in progress it replaces the committed outline.
    const marquee = marqueeRef.current;
    const outline = marquee
      ? rectFromPoints(marquee.anchor.x, marquee.anchor.y, marquee.current.x, marquee.current.y)
      : selection.bounds;
    if (outline) {
      ctx.save();
      ctx.strokeStyle = readVar('--accent', '#3b82f6');
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      if (marquee || selection.type === 'rectangle' || !selection.mask) {
        ctx.strokeRect(
          outline.x * cellW + 0.5,
          outline.y * cellH + 0.5,
          outline.width * cellW - 1,
          outline.height * cellH - 1,
        );
      } else {
        const mask = selection.mask;
        const inside = (mx: number, my: number, ox: number, oy: number): boolean => {
          const nx = mx + ox;
          const ny = my + oy;
          if (nx < 0 || ny < 0 || nx >= outline.width || ny >= outline.height) return false;
          return mask[ny * outline.width + nx] === 1;
        };
        ctx.beginPath();
        for (let my = 0; my < outline.height; my++) {
          for (let mx = 0; mx < outline.width; mx++) {
            if (mask[my * outline.width + mx] !== 1) continue;
            const x0 = (outline.x + mx) * cellW;
            const y0 = (outline.y + my) * cellH;
            if (!inside(mx, my, 0, -1)) {
              ctx.moveTo(x0, y0);
              ctx.lineTo(x0 + cellW, y0);
            }
            if (!inside(mx, my, 1, 0)) {
              ctx.moveTo(x0 + cellW, y0);
              ctx.lineTo(x0 + cellW, y0 + cellH);
            }
            if (!inside(mx, my, 0, 1)) {
              ctx.moveTo(x0, y0 + cellH);
              ctx.lineTo(x0 + cellW, y0 + cellH);
            }
            if (!inside(mx, my, -1, 0)) {
              ctx.moveTo(x0, y0);
              ctx.lineTo(x0, y0 + cellH);
            }
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Hand the finished raster to the GPU viewport (if one is watching).
    canvas.dataset.rasterRev = String(++rasterRev);

    // Paint is the dominant per-frame cost, so it is what the adaptive
    // controller listens to (the effect loop reports its own cost too).
    adaptiveRef.current = observeFrame(adaptiveRef.current, performance.now() - paintStart, budget.targetMs);
  }, [composedGrid, onionGrids, timeline, zoomLevel, showGrid, themeId, document, crtGlow, gpuPreview, qualityMode, selection]);

  // React-driven paints: document edits, zoom, theme switches, tool changes.
  // The effect loop below calls `paint` directly, because pushing 60 fps
  // frames through state would bail out on buffer identity and never repaint.
  useEffect(() => {
    paint();
  }, [paint]);

  // Switching away from the text tool abandons an unplaced box; switching
  // away from the select tool abandons a half-dragged marquee. (Lives below
  // `paint` because the marquee branch repaints from it.)
  useEffect(() => {
    if (textAnchor && tool.activeTool !== 'text') cancelText();
    if (marqueeRef.current && tool.activeTool !== 'select') {
      marqueeRef.current = null;
      paint();
    }
  }, [tool.activeTool]);

  // Cell-effect playback: advance the runtime at frame rate and repaint
  // straight from the frame callback. The runtime runs in *loop* mode, so a
  // one-shot effect replays instead of settling and vanishing — the artist
  // keeps seeing it until they remove it. The loop still stops itself the
  // moment the stack is empty, so an idle editor costs zero frames.
  useEffect(() => {
    cellFxRuntime.setLoop(true);
    cellFxRuntime.sync(cellEffects, fxSeed);
    if (cellEffects.length === 0) {
      fxGridRef.current = null;
      paint();
      return;
    }
    // Prime synchronously: the paint effect for this same commit may already
    // have run with a stale (or empty) fx buffer, and a document change means
    // the runtime's source snapshot must be recaptured before anything shows.
    const prime = cellFxRuntime.frame(composedGrid, 1);
    if (prime) fxGridRef.current = prime;
    paint();

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
          fxGridRef.current = next;
          paint();
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
  }, [cellEffects, fxSeed, composedGrid, qualityMode, paint]);

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

    if (activeTool === 'select') {
      const cell = cellAt(e);
      capture(e);
      marqueeRef.current = { anchor: cell, current: cell };
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

    if (activeTool === 'text') {
      // Place whatever is typed at the old anchor first, then open a fresh
      // box at the clicked cell (the same "click away to commit" Canva has).
      commitText();
      setTextAnchor(cell);
      setTextValue('');
      return;
    }

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
      const filled = floodFill(
        base,
        cell.x,
        cell.y,
        store.tool.brushChar,
        store.tool.foregroundColor,
        selectionClip(store.selection),
      );
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
      stampInPlace(start, cell.x, cell.y, store.tool.brushSize, ch, color, selectionClip(store.selection));
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

    // Live marquee: track the pointer and repaint straight from the event —
    // the ref never touches React state, so a drag costs no re-renders.
    const marquee = marqueeRef.current;
    if (marquee) {
      const cell = cellAt(e);
      if (cell.x !== marquee.current.x || cell.y !== marquee.current.y) {
        marquee.current = cell;
        paint();
      }
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
    const clip = selectionClip(store.selection);
    walkLine(last.x, last.y, cell.x, cell.y, (x, y) => {
      stampInPlace(base, x, y, store.tool.brushSize, ch, color, clip);
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
    const marquee = marqueeRef.current;
    if (marquee) {
      marqueeRef.current = null;
      const store = useStore.getState();
      const { anchor, current } = marquee;
      if (anchor.x === current.x && anchor.y === current.y) {
        // Click without drag: select the region this cell's flood would fill
        // (magic-wand). Needs a grid to measure; rectangles do not.
        const grid = activeLayer?.grid;
        if (!grid) {
          store.setStatusMessage('Select an ASCII layer to pick a region');
        } else {
          const region = regionSelectionFromSeed(grid, current.x, current.y);
          store.setSelection(region);
          store.setStatusMessage(
            region.bounds
              ? `Region selected ${region.bounds.width}×${region.bounds.height} (Esc clears)`
              : 'Nothing to select',
          );
        }
      } else {
        store.setSelection(
          rectSelection(
            rectFromPoints(anchor.x, anchor.y, current.x, current.y),
            document.canvas.width,
            document.canvas.height,
          ),
        );
        store.setStatusMessage('Selection set (Esc clears)');
      }
      paint();
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
          <Suspense fallback={null}>
            <PixiViewport
              sourceRef={canvasRef}
              crt={crtGlow}
              onFallback={(reason) => useStore.getState().disableGpuPreview(reason)}
            />
          </Suspense>
        )}
        {textAnchor && (
          <div
            className="text-tool-overlay"
            style={{ left: textAnchor.x * CELL_W * zoomLevel, top: textAnchor.y * CELL_H * zoomLevel }}
          >
            <textarea
              autoFocus
              value={textValue}
              rows={2}
              spellCheck={false}
              placeholder="Type… Enter places · Esc cancels · Shift+Enter new line"
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelText();
                }
              }}
            />
            <div className="text-tool-actions">
              <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={commitText}>
                Place
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancelText}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
