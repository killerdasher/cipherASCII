/**
 * Document commands — the single, auditable way the editor mutates a
 * `Document`.
 *
 * Commands are plain data (serializable, loggable, replayable) and
 * `applyCommand` is pure: it returns a new document and never mutates the
 * input. Undo/redo is snapshot-based (`History<Document>`), so commands only
 * need a forward interpretation; structural sharing keeps snapshots cheap.
 *
 * Operations that reference an unknown layer id are no-ops (returning the
 * input document unchanged) rather than errors — a stale command from a
 * replayed log must not corrupt the document.
 */

import type {
  AsciiGrid,
  CanvasSettings,
  Document,
  EditorState,
  ExportSettings,
  Guide,
  ImageRenderSettings,
  Layer,
  LayerId,
  ProjectMetadata,
  TextRenderSettings,
} from '../types';
import {
  cloneGrid,
  ensureSize,
  flipHorizontal,
  flipVertical,
  gridsEqual,
  gridToString,
  linesToGrid,
  rotate90,
  setCell,
  toMutable,
  fromMutable,
  trimGrid,
} from '../grid';
import { sanitizeText } from '../util';

export type GridTransform = 'clear' | 'trim' | 'flipH' | 'flipV' | 'rotate90';

export type Command =
  | { type: 'grid/setCell'; layerId: LayerId; x: number; y: number; char: string }
  | { type: 'grid/writeText'; layerId: LayerId; x: number; y: number; text: string }
  | {
      type: 'grid/fillRect';
      layerId: LayerId;
      x: number;
      y: number;
      width: number;
      height: number;
      char: string;
    }
  | { type: 'grid/replace'; layerId: LayerId; grid: AsciiGrid }
  | { type: 'grid/paint'; layerId: LayerId; grid: AsciiGrid }
  | { type: 'grid/resize'; layerId: LayerId; width: number; height: number }
  | { type: 'grid/transform'; layerId: LayerId; op: GridTransform }
  | { type: 'layer/add'; layer: Layer; index?: number }
  | { type: 'layer/remove'; layerId: LayerId }
  | {
      type: 'layer/update';
      layerId: LayerId;
      patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity' | 'x' | 'y'>>;
    }
  | { type: 'layer/move'; layerId: LayerId; toIndex: number }
  | { type: 'document/metadata'; patch: Partial<ProjectMetadata> }
  | { type: 'document/canvas'; patch: Partial<CanvasSettings> }
  | { type: 'document/imageSettings'; patch: Partial<ImageRenderSettings> }
  | { type: 'document/textSettings'; patch: Partial<TextRenderSettings> }
  | { type: 'document/exportSettings'; patch: Partial<ExportSettings> }
  | { type: 'document/guides'; guides: Guide[] }
  | { type: 'document/activeLayer'; layerId: LayerId | null }
  | { type: 'editor'; patch: Partial<EditorState> };

function withLayer(
  doc: Document,
  layerId: LayerId,
  fn: (layer: Layer) => Layer,
): Document {
  const index = doc.layers.findIndex((l) => l.id === layerId);
  if (index < 0) return doc;
  const next = fn(doc.layers[index]);
  if (next === doc.layers[index]) return doc;
  const layers = doc.layers.slice();
  layers[index] = next;
  return { ...doc, layers };
}

function asciiGridOf(layer: Layer): AsciiGrid | null {
  return layer.grid ?? null;
}

function applyGridOp(
  doc: Document,
  layerId: LayerId,
  op: (grid: AsciiGrid) => AsciiGrid,
): Document {
  return withLayer(doc, layerId, (layer) => {
    const grid = asciiGridOf(layer);
    if (!grid) return layer;
    const next = op(grid);
    return next === grid ? layer : { ...layer, grid: next } as Layer;
  });
}

/** Apply a single command. Pure; returns the input document on no-ops. */
export function applyCommand(doc: Document, cmd: Command): Document {
  switch (cmd.type) {
    case 'grid/setCell': {
      const ch = cmd.char.slice(0, 1) || ' ';
      return applyGridOp(doc, cmd.layerId, (g) => setCell(g, cmd.x, cmd.y, ch));
    }
    case 'grid/writeText': {
      const text = sanitizeText(cmd.text);
      return applyGridOp(doc, cmd.layerId, (grid) => {
        const lines = text.split('\n');
        const needW = cmd.x + Math.max(0, ...lines.map((l) => l.length));
        const needH = cmd.y + lines.length;
        const next = ensureSize(grid, Math.max(grid.width, needW), Math.max(grid.height, needH));
        const m = toMutable(next);
        for (let row = 0; row < lines.length; row++) {
          const line = lines[row];
          for (let col = 0; col < line.length; col++) {
            const ch = line[col];
            if (ch === '\n' || ch === '\r') continue;
            m.chars[(cmd.y + row) * m.width + (cmd.x + col)] = ch;
          }
        }
        return fromMutable(m);
      });
    }
    case 'grid/fillRect': {
      const ch = cmd.char.slice(0, 1) || ' ';
      return withLayer(doc, cmd.layerId, (layer) => {
        const grid = asciiGridOf(layer);
        if (!grid) return layer;
        const grown = ensureSize(
          grid,
          Math.max(grid.width, cmd.x + cmd.width),
          Math.max(grid.height, cmd.y + cmd.height),
        );
        const m = toMutable(grown);
        const x0 = Math.max(0, cmd.x);
        const y0 = Math.max(0, cmd.y);
        const x1 = Math.min(m.width, cmd.x + cmd.width);
        const y1 = Math.min(m.height, cmd.y + cmd.height);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) m.chars[y * m.width + x] = ch;
        }
        return { ...layer, grid: fromMutable(m) } as Layer;
      });
    }
    case 'grid/replace':
      return withLayer(doc, cmd.layerId, (layer) =>
        layer.grid === cmd.grid
          ? layer
          : ({ ...layer, grid: cloneGrid(cmd.grid) } as Layer),
      );
    // User-authored replacement of a whole layer grid (brush strokes, flood
    // fill). Unlike `grid/replace` - which the renderer produces - this is an
    // undoable editing step.
    case 'grid/paint':
      return withLayer(doc, cmd.layerId, (layer) => {
        const grid = asciiGridOf(layer);
        if (grid && gridsEqual(grid, cmd.grid)) return layer;
        return { ...layer, grid: cloneGrid(cmd.grid) } as Layer;
      });
    case 'grid/resize':
      return applyGridOp(doc, cmd.layerId, (g) =>
        ensureSize(g, Math.max(1, Math.floor(cmd.width)), Math.max(1, Math.floor(cmd.height))),
      );
    case 'grid/transform':
      return applyGridOp(doc, cmd.layerId, (g) => {
        switch (cmd.op) {
          case 'clear': {
            const cleared = cloneGrid(g);
            cleared.chars.fill(' ');
            return cleared;
          }
          case 'trim':
            return trimGrid(g);
          case 'flipH':
            return flipHorizontal(g);
          case 'flipV':
            return flipVertical(g);
          case 'rotate90':
            return rotate90(g);
          default:
            return g;
        }
      });
    case 'layer/add': {
      const layers = doc.layers.slice();
      const index =
        cmd.index === undefined ? layers.length : Math.max(0, Math.min(layers.length, cmd.index));
      layers.splice(index, 0, cmd.layer);
      return { ...doc, layers, activeLayerId: cmd.layer.id };
    }
    case 'layer/remove': {
      const layers = doc.layers.filter((l) => l.id !== cmd.layerId);
      if (layers.length === doc.layers.length) return doc;
      const activeLayerId =
        doc.activeLayerId === cmd.layerId
          ? (layers[layers.length - 1]?.id ?? null)
          : doc.activeLayerId;
      return { ...doc, layers, activeLayerId };
    }
    case 'layer/update':
      return withLayer(doc, cmd.layerId, (layer) => ({ ...layer, ...cmd.patch }) as Layer);
    case 'layer/move': {
      const from = doc.layers.findIndex((l) => l.id === cmd.layerId);
      if (from < 0) return doc;
      const to = Math.max(0, Math.min(doc.layers.length - 1, Math.floor(cmd.toIndex)));
      if (to === from) return doc;
      const layers = doc.layers.slice();
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved);
      return { ...doc, layers };
    }
    case 'document/metadata':
      return { ...doc, metadata: { ...doc.metadata, ...cmd.patch } };
    case 'document/canvas':
      return { ...doc, canvas: { ...doc.canvas, ...cmd.patch } };
    case 'document/imageSettings':
      return { ...doc, imageSettings: { ...doc.imageSettings, ...cmd.patch } };
    case 'document/textSettings':
      return { ...doc, textSettings: { ...doc.textSettings, ...cmd.patch } };
    case 'document/exportSettings':
      return { ...doc, exportSettings: { ...doc.exportSettings, ...cmd.patch } };
    case 'document/guides':
      return { ...doc, guides: cmd.guides.map((g) => ({ ...g })) };
    case 'document/activeLayer':
      return cmd.layerId === null || doc.layers.some((l) => l.id === cmd.layerId)
        ? { ...doc, activeLayerId: cmd.layerId }
        : doc;
    case 'editor':
      return { ...doc, editor: { ...doc.editor, ...cmd.patch } };
    default:
      return doc;
  }
}

/** Apply commands left to right (no-op safe). */
export function applyCommands(doc: Document, cmds: readonly Command[]): Document {
  let out = doc;
  for (const cmd of cmds) out = applyCommand(out, cmd);
  return out;
}

/** Render a layer's grid back to plain text (convenience for previews/logs). */
export function documentToString(doc: Document): string {
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId) ?? doc.layers[0];
  const grid = layer ? asciiGridOf(layer) : null;
  return grid ? gridToString(grid) : '';
}

/** Create a fresh grid the size of a line of text (helper for write flows). */
export function gridFromText(text: string): AsciiGrid {
  return linesToGrid(sanitizeText(text).split('\n'));
}
