/**
 * Project document construction and structural validation.
 *
 * Pure module: it never touches the DOM, storage or UI code, so it runs in
 * workers, Node tests and the browser alike.
 */

import { createGrid } from '../grid';
import { resolveLayerBlend } from '../layer/blends';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_EXPORT,
  DEFAULT_FX_SEED,
  DEFAULT_IMAGE_RENDER,
  DEFAULT_SUBTEXTURE,
  DEFAULT_TEXT_RENDER,
  type AsciiGrid,
  type CanvasSettings,
  type Document,
  type EditorState,
  type Layer,
  type ProjectMetadata,
  type Result,
  err,
  ok,
} from '../types';
import { createEffectsPipeline } from '../effects/pipeline';
import { isPrintableChar } from '../util';

const DEFAULT_WIDTH = 80;
const DEFAULT_HEIGHT = 24;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detailOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fallbackId(): string {
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `doc_${time}_${random}`;
}

function generateId(): string {
  let id = '';
  try {
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') id = webCrypto.randomUUID();
  } catch {
    id = '';
  }
  return id || fallbackId();
}

function defaultMetadata(now: string): ProjectMetadata {
  return {
    name: 'Untitled',
    createdAt: now,
    updatedAt: now,
    author: '',
    description: '',
    tags: [],
  };
}

function defaultCanvas(): CanvasSettings {
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    background: null,
    showGrid: true,
    snap: true,
    showGuides: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    subtexture: { ...DEFAULT_SUBTEXTURE },
  };
}

function defaultEditor(): EditorState {
  return {
    cursor: { x: 0, y: 0 },
    anchor: null,
    tabSize: 4,
    showWhitespace: false,
    showLineNumbers: false,
  };
}

function toNumberArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    let max = -1;
    const out: unknown[] = [];
    for (const key of keys) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) return null;
      if (index > max) max = index;
      out[index] = value[key];
    }
    if (keys.length !== max + 1) return null;
    out.length = max + 1;
    return out;
  }
  return null;
}

function validatePlane(value: unknown, path: string, length: number): Result<Int32Array | null> {
  if (value === null || value === undefined) return ok(null);
  const source = toNumberArray(value);
  if (source === null) return err('invalid-project', `${path} must be null or a color plane`);
  if (source.length !== length) {
    return err(
      'invalid-project',
      `${path} has ${source.length} entries but the grid holds ${length} cells`,
    );
  }
  const plane = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    const entry = source[i];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return err('invalid-project', `${path}[${i}] must be a finite number`);
    }
    plane[i] = entry;
  }
  return ok(plane);
}

function validateLayer(value: unknown, index: number): Result<Layer> {
  const path = `layers[${index}]`;
  if (!isPlainObject(value)) return err('invalid-project', `${path} must be an object`);
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return err('invalid-project', `${path}.id must be a non-empty string`);
  }
  if (typeof value.name !== 'string') {
    return err('invalid-project', `${path}.name must be a string`);
  }
  if (typeof value.visible !== 'boolean') {
    return err('invalid-project', `${path}.visible must be a boolean`);
  }
  if (
    typeof value.opacity !== 'number' ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 0 ||
    value.opacity > 1
  ) {
    return err('invalid-project', `${path}.opacity must be a number between 0 and 1`);
  }
  if (
    value.kind !== undefined &&
    value.kind !== 'ascii' &&
    value.kind !== 'image' &&
    value.kind !== 'text' &&
    value.kind !== 'creative'
  ) {
    return err('invalid-project', `${path}.kind must be "ascii", "image", "text" or "creative"`);
  }
  // Every layer carries a blend id; projects written before it existed (or
  // carrying a value from the future) normalise to `normal` rather than
  // failing to load.
  const blend = resolveLayerBlend(value.blend);
  // Image/text layers dropped their per-layer `settings`/`cacheKey` (the
  // phantom fields the audit flagged) — strip the tombstones so projects
  // written by older builds load clean. The creative layer keeps its cache key.
  const cleaned = { ...value };
  if (value.kind === 'image' || value.kind === 'text') {
    delete cleaned.settings;
    delete cleaned.cacheKey;
  }
  if (value.grid === null || value.grid === undefined) {
    if (value.kind === 'image' || value.kind === 'text' || value.kind === 'creative') {
      return ok({ ...cleaned, blend } as unknown as Layer);
    }
    return err('invalid-project', `${path}.grid must be an AsciiGrid`);
  }
  const grid = validateAsciiGrid(value.grid, `${path}.grid`);
  if (!grid.ok) return grid;
  return ok({ ...cleaned, blend, grid: grid.value } as unknown as Layer);
}

/**
 * Validate an unknown value as an {@link AsciiGrid}.
 *
 * Checks that width and height are positive integers, that `chars` is an
 * array of exactly `width * height` single printable characters, and that the
 * optional `fg`/`bg` color planes are either null or hold one finite number
 * per cell. Planes are normalized to `Int32Array`.
 *
 * @param g - candidate grid
 * @param path - dotted location used in error messages, e.g. `layers[0].grid`
 * @returns the normalized grid, or the first violation found
 */
export function validateAsciiGrid(g: unknown, path: string): Result<AsciiGrid> {
  try {
    if (!isPlainObject(g)) return err('invalid-project', `${path} must be an object`);
    const width = g.width;
    const height = g.height;
    const chars = g.chars;
    if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
      return err('invalid-project', `${path}.width must be a positive integer`);
    }
    if (typeof height !== 'number' || !Number.isInteger(height) || height <= 0) {
      return err('invalid-project', `${path}.height must be a positive integer`);
    }
    if (!Array.isArray(chars)) {
      return err('invalid-project', `${path}.chars must be an array`);
    }
    const cells = width * height;
    if (chars.length !== cells) {
      return err(
        'invalid-project',
        `${path}.chars has ${chars.length} entries but the grid is ${width}x${height} (${cells} cells)`,
      );
    }
    for (let i = 0; i < chars.length; i++) {
      const cell = chars[i];
      if (typeof cell !== 'string' || Array.from(cell).length !== 1 || !isPrintableChar(cell)) {
        return err('invalid-project', `${path}.chars[${i}] must be a single printable character`);
      }
    }
    const fg = validatePlane(g.fg, `${path}.fg`, cells);
    if (!fg.ok) return fg;
    const bg = validatePlane(g.bg, `${path}.bg`, cells);
    if (!bg.ok) return bg;
    return ok({
      width,
      height,
      chars: chars.slice() as string[],
      fg: fg.value,
      bg: bg.value,
    });
  } catch (e) {
    return err('internal', `Failed to validate grid at ${path}`, detailOf(e));
  }
}

/**
 * Structurally validate an unknown value as a project {@link Document}.
 *
 * The first violation is reported as `err('invalid-project', ...)`; nothing
 * ever throws, internal failures come back as `err('internal', ...)`. Grids
 * are re-validated and color planes normalized, so a successful result is safe
 * to hand to the persistence and rendering layers. `editor` and `guides` are
 * optional here because schema version 1 documents predate them; they are
 * filled in by `migrateDocument`.
 *
 * @param doc - candidate document, typically the result of `JSON.parse`
 * @returns the validated document, or the first violation found
 */
export function validateDocument(doc: unknown): Result<Document> {
  try {
    if (!isPlainObject(doc)) return err('invalid-project', 'project must be an object');
    if (typeof doc.schemaVersion !== 'number' || !Number.isFinite(doc.schemaVersion)) {
      return err('invalid-project', 'schemaVersion must be a number');
    }
    if (typeof doc.id !== 'string') return err('invalid-project', 'id must be a string');
    if (!isPlainObject(doc.metadata)) return err('invalid-project', 'metadata must be an object');
    if (!isPlainObject(doc.canvas)) return err('invalid-project', 'canvas must be an object');
    if (!Array.isArray(doc.layers)) return err('invalid-project', 'layers must be an array');
    if (doc.layers.length === 0) {
      return err('invalid-project', 'layers must contain at least one layer');
    }
    const layers: Layer[] = [];
    for (let i = 0; i < doc.layers.length; i++) {
      const layer = validateLayer(doc.layers[i], i);
      if (!layer.ok) return layer;
      layers.push(layer.value);
    }
    if (!isPlainObject(doc.imageSettings)) {
      return err('invalid-project', 'imageSettings must be an object');
    }
    if (!isPlainObject(doc.textSettings)) {
      return err('invalid-project', 'textSettings must be an object');
    }
    if (!isPlainObject(doc.exportSettings)) {
      return err('invalid-project', 'exportSettings must be an object');
    }
    if (doc.editor !== undefined && !isPlainObject(doc.editor)) {
      return err('invalid-project', 'editor must be an object');
    }
    if (doc.guides !== undefined && !Array.isArray(doc.guides)) {
      return err('invalid-project', 'guides must be an array');
    }
    if (doc.generators !== undefined && !Array.isArray(doc.generators)) {
      return err('invalid-project', 'generators must be an array');
    }
    if (doc.activeLayerId !== undefined && doc.activeLayerId !== null) {
      if (typeof doc.activeLayerId !== 'string') {
        return err('invalid-project', 'activeLayerId must be a string or null');
      }
    }
    if (doc.source !== undefined && doc.source !== null && !isPlainObject(doc.source)) {
      return err('invalid-project', 'source must be an object or null');
    }
    return ok({ ...doc, layers } as unknown as Document);
  } catch (e) {
    return err('internal', 'Failed to validate project', detailOf(e));
  }
}

/**
 * Create a fresh, valid project document.
 *
 * The document carries `CURRENT_SCHEMA_VERSION`, a random id
 * (`crypto.randomUUID` when available, otherwise a time+random fallback),
 * ISO-8601 metadata timestamps, the default image/text/export settings from
 * `types.ts`, an 80x24 `Background` ascii layer of space cells, no source
 * image and no guides. `overrides` is merged shallowly over the defaults.
 *
 * @param overrides - shallow replacements for any document fields
 * @returns a new document, unshared with any previous call
 */
export function createDocument(overrides: Partial<Document> = {}): Document {
  const now = new Date().toISOString();
  const backgroundId = generateId();
  const background: Layer = {
    id: backgroundId,
    name: 'Background',
    kind: 'ascii',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: 0,
    y: 0,
    grid: createGrid(DEFAULT_WIDTH, DEFAULT_HEIGHT),
  };
  const base: Document = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: generateId(),
    metadata: defaultMetadata(now),
    canvas: defaultCanvas(),
    layers: [background],
    activeLayerId: backgroundId,
    source: null,
    imageSettings: structuredClone(DEFAULT_IMAGE_RENDER),
    textSettings: structuredClone(DEFAULT_TEXT_RENDER),
    exportSettings: structuredClone(DEFAULT_EXPORT),
    editor: defaultEditor(),
    guides: [],
    effectsPipeline: createEffectsPipeline(),
    cellEffects: [],
    paletteId: null,
    timeline: null,
    renderPresets: [],
    themeId: 'medieval',
    generators: [],
    fxSeed: DEFAULT_FX_SEED,
  };
  return { ...base, ...overrides };
}
