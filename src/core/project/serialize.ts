/**
 * Canonical project (de)serialization and schema migration.
 *
 * Pure module: no UI, storage or DOM dependencies. Parsed input is always
 * validated before it becomes a {@link Document}.
 */

import type { CellEffectEntry } from '../fx/pipeline';
import { GLYPH_CLASSES, MASK_KINDS, type GlyphClass } from '../fx/mask';
import { canonicalGeneratorGraph, type GeneratorGraph } from '../generators/graph';
import { PRESET_PALETTES } from '../palette/palette';
import { THEME_PRESETS } from '../theme/theme';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_FX_SEED,
  DEFAULT_SUBTEXTURE,
  type AnimationTrack,
  type CanvasSettings,
  type Document,
  type EditorState,
  type EasingType,
  type Guide,
  type Keyframe,
  type Palette,
  type PaletteColor,
  type ProjectMetadata,
  type Result,
  type Theme,
  type Timeline,
  err,
  ok,
} from '../types';
import { normalizeSubtexture } from '../subtexture';
import { createDocument, validateDocument } from './schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detailOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseJson(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (e) {
    return err('invalid-project', 'Project file is not valid JSON', detailOf(e));
  }
}

function sortValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (seen.has(value)) return null;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => sortValue(entry, seen));
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      return Array.from(value as unknown as ArrayLike<number>);
    }
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = sortValue(source[key], seen);
      if (entry !== undefined) out[key] = entry;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function canonicalMetadata(value: unknown, fallback: ProjectMetadata): ProjectMetadata {
  const src: Record<string, unknown> = isPlainObject(value) ? value : {};
  const text = (key: string, fallbackText: string): string =>
    typeof src[key] === 'string' ? (src[key] as string) : fallbackText;
  const tags = Array.isArray(src.tags)
    ? src.tags.filter((tag): tag is string => typeof tag === 'string')
    : fallback.tags;
  return {
    name: text('name', fallback.name),
    createdAt: text('createdAt', fallback.createdAt),
    updatedAt: text('updatedAt', fallback.updatedAt),
    author: text('author', fallback.author),
    description: text('description', fallback.description),
    tags,
  };
}

function canonicalCanvas(value: unknown, fallback: CanvasSettings): CanvasSettings {
  const src: Record<string, unknown> = isPlainObject(value) ? value : {};
  const margins: Record<string, unknown> = isPlainObject(src.margins) ? src.margins : {};
  const num = (entry: unknown, fallbackNum: number): number =>
    typeof entry === 'number' && Number.isFinite(entry) ? entry : fallbackNum;
  const flag = (entry: unknown, fallbackFlag: boolean): boolean =>
    typeof entry === 'boolean' ? entry : fallbackFlag;
  return {
    width: num(src.width, fallback.width),
    height: num(src.height, fallback.height),
    background: typeof src.background === 'number' ? src.background : null,
    showGrid: flag(src.showGrid, fallback.showGrid),
    snap: flag(src.snap, fallback.snap),
    showGuides: flag(src.showGuides, fallback.showGuides),
    margins: {
      top: num(margins.top, 0),
      right: num(margins.right, 0),
      bottom: num(margins.bottom, 0),
      left: num(margins.left, 0),
    },
    // Projects written before the subtexture overlay existed land on the
    // default (disabled) mask instead of an undefined settings object.
    subtexture: normalizeSubtexture(src.subtexture, fallback.subtexture ?? DEFAULT_SUBTEXTURE),
  };
}

function canonicalEditor(value: unknown, fallback: EditorState): EditorState {
  const src: Record<string, unknown> = isPlainObject(value) ? value : {};
  const cursor: Record<string, unknown> = isPlainObject(src.cursor) ? src.cursor : {};
  const anchor = isPlainObject(src.anchor) ? src.anchor : null;
  const num = (entry: unknown, fallbackNum: number): number =>
    typeof entry === 'number' && Number.isFinite(entry) ? entry : fallbackNum;
  const int = (entry: unknown, fallbackNum: number): number => Math.round(num(entry, fallbackNum));
  const flag = (entry: unknown, fallbackFlag: boolean): boolean =>
    typeof entry === 'boolean' ? entry : fallbackFlag;
  return {
    cursor: { x: int(cursor.x, fallback.cursor.x), y: int(cursor.y, fallback.cursor.y) },
    anchor: anchor ? { x: int(anchor.x, 0), y: int(anchor.y, 0) } : null,
    tabSize: num(src.tabSize, fallback.tabSize),
    showWhitespace: flag(src.showWhitespace, fallback.showWhitespace),
    showLineNumbers: flag(src.showLineNumbers, fallback.showLineNumbers),
  };
}

function canonicalGuides(value: unknown): Guide[] {
  if (!Array.isArray(value)) return [];
  const out: Guide[] = [];
  for (const guide of value) {
    if (
      isPlainObject(guide) &&
      (guide.axis === 'h' || guide.axis === 'v') &&
      typeof guide.pos === 'number' &&
      Number.isFinite(guide.pos)
    ) {
      out.push({ axis: guide.axis, pos: guide.pos });
    }
  }
  return out;
}

/**
 * Serialize a document to canonical project JSON.
 *
 * Object keys are sorted recursively so identical documents always produce
 * byte-identical output (stable diffs, stable hashes). Typed color planes are
 * emitted as plain JSON arrays, cycles and bigints are neutralised, and the
 * result always ends with a single trailing newline. Never throws.
 *
 * @param doc - document to serialize
 * @returns canonical JSON text for the document
 */
export function serializeProject(doc: Document): string {
  const json = JSON.stringify(sortValue(doc, new WeakSet()));
  return `${json}\n`;
}

/**
 * Parse, validate and migrate project JSON into a current {@link Document}.
 *
 * Malformed JSON yields `err('invalid-project', ...)`, structural violations
 * surface the message from `validateDocument`, and documents from the future
 * surface `err('unsupported-version', ...)` via `migrateDocument`. Nothing
 * throws.
 *
 * @param json - project text, as written by {@link serializeProject}
 * @returns the migrated document or the first error encountered
 */
export function deserializeProject(json: string): Result<Document> {
  try {
    if (typeof json !== 'string') return err('invalid-project', 'project input must be a string');
    const parsed = parseJson(json);
    if (!parsed.ok) return parsed;
    const validated = validateDocument(parsed.value);
    if (!validated.ok) return validated;
    return migrateDocument(validated.value);
  } catch (e) {
    return err('internal', 'Failed to deserialize project', detailOf(e));
  }
}

/**
 * Upgrade a document to `CURRENT_SCHEMA_VERSION`.
 *
 * Accepts schema versions 1 through 4: version 1 documents gain the `guides`
 * and `editor` blocks introduced in version 2, every document predating
 * version 3 gains `generators` and `fxSeed`, and every document predating
 * version 4 gains `palettes` (the shipped presets) and `customThemes` (empty).
 * Every missing or malformed default is repaired, and unknown keys are
 * dropped by rebuilding the document from its known fields. Documents newer
 * than `CURRENT_SCHEMA_VERSION` return `err('unsupported-version', ...)`;
 * unusable versions return `err('invalid-project', ...)`. Never throws.
 *
 * @param doc - validated document to migrate
 * @returns the canonical current-version document, or the migration error
 */

const CELL_MASK_KINDS = new Set<string>(MASK_KINDS);

/** Mask fields copied verbatim when they carry a usable type. */
const MASK_NUMERIC_FIELDS = [
  'x',
  'y',
  'w',
  'h',
  'rowStart',
  'rowEnd',
  'colStart',
  'colEnd',
  'cell',
  'thickness',
] as const;

/**
 * Repair a saved cell-effect stack.
 *
 * Entries are validated field by field rather than trusted: a hand-edited
 * project must never be able to feed a malformed mask or a NaN parameter into
 * the render loop. Unknown effect ids are kept — the pipeline simply leaves
 * them unbound.
 */
function canonicalCellEffects(value: unknown): CellEffectEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CellEffectEntry[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const effect = raw.effect;
    if (typeof effect !== 'string' || effect.length === 0) continue;
    const entry: CellEffectEntry = { effect };
    if (raw.enabled === false) entry.enabled = false;
    if (typeof raw.intensity === 'number' && Number.isFinite(raw.intensity)) {
      entry.intensity = Math.min(1, Math.max(0, raw.intensity));
    }
    if (typeof raw.delay === 'number' && Number.isFinite(raw.delay) && raw.delay >= 0) {
      entry.delay = raw.delay;
    }
    if (isPlainObject(raw.params)) {
      const params: Record<string, number> = {};
      for (const [key, v] of Object.entries(raw.params)) {
        if (typeof v === 'number' && Number.isFinite(v)) params[key] = v;
      }
      if (Object.keys(params).length > 0) entry.params = params;
    }
    if (isPlainObject(raw.mask) && typeof raw.mask.kind === 'string' && CELL_MASK_KINDS.has(raw.mask.kind)) {
      const mask: Record<string, unknown> = { kind: raw.mask.kind };
      for (const key of MASK_NUMERIC_FIELDS) {
        const v = raw.mask[key];
        if (typeof v === 'number' && Number.isFinite(v)) mask[key] = v;
      }
      if (typeof raw.mask.origin === 'string') mask.origin = raw.mask.origin;
      if (typeof raw.mask.glyphClass === 'string' && GLYPH_CLASSES.includes(raw.mask.glyphClass as GlyphClass)) {
        mask.glyphClass = raw.mask.glyphClass;
      }
      if (typeof raw.mask.hasForeground === 'boolean') mask.hasForeground = raw.mask.hasForeground;
      if (typeof raw.mask.hasBackground === 'boolean') mask.hasBackground = raw.mask.hasBackground;
      entry.mask = mask as unknown as CellEffectEntry['mask'];
    }
    out.push(entry);
  }
  return out;
}

/** Repair the generator-graph stack: irreparable graphs are dropped. */
function canonicalGenerators(value: unknown): GeneratorGraph[] {
  if (!Array.isArray(value)) return [];
  const out: GeneratorGraph[] = [];
  for (const raw of value) {
    const graph = canonicalGeneratorGraph(raw);
    if (graph) out.push(graph);
  }
  return out;
}

/**
 * Repair the palette list, field by field.
 *
 * A missing/empty list (every project predating schema 4) falls back to the
 * shipped presets so the palette panel is never empty; entries with a bad id,
 * name or colour array drop. Colour entries need a finite `rgb`; optional
 * `name`/`locked` copy through when usable.
 */
function canonicalPalettes(value: unknown): Palette[] {
  if (!Array.isArray(value) || value.length === 0) return PRESET_PALETTES;
  const out: Palette[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== 'string' || raw.id.length === 0 || seen.has(raw.id)) continue;
    if (typeof raw.name !== 'string' || raw.name.length === 0) continue;
    if (!Array.isArray(raw.colors)) continue;
    const colors: PaletteColor[] = [];
    for (const entry of raw.colors) {
      if (!isPlainObject(entry)) continue;
      if (typeof entry.rgb !== 'number' || !Number.isFinite(entry.rgb)) continue;
      const color: PaletteColor = { rgb: Math.trunc(entry.rgb) };
      if (typeof entry.name === 'string') color.name = entry.name;
      if (typeof entry.locked === 'boolean') color.locked = entry.locked;
      colors.push(color);
    }
    seen.add(raw.id);
    const palette: Palette = {
      id: raw.id,
      name: raw.name,
      colors,
      createdAt:
        typeof raw.createdAt === 'string'
          ? raw.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof raw.updatedAt === 'string'
          ? raw.updatedAt
          : new Date(0).toISOString(),
    };
    if (typeof raw.description === 'string') palette.description = raw.description;
    if (raw.source === 'auto' || raw.source === 'manual' || raw.source === 'imported') {
      palette.source = raw.source;
    }
    out.push(palette);
  }
  return out.length > 0 ? out : PRESET_PALETTES;
}

/** Copy only the string-valued entries of a theme sub-record over a fallback. */
function stringRecord<T extends object>(value: unknown, fallback: T): T {
  const source: Record<string, unknown> = isPlainObject(value) ? value : {};
  const out: Record<string, unknown> = { ...(fallback as unknown as Record<string, unknown>) };
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out as T;
}

/**
 * Repair user-authored themes.
 *
 * Each entry is rebuilt on top of the default preset so a hand-edited or
 * truncated theme can never feed `undefined` into `applyTheme`'s CSS
 * variables; only string values survive inside `colors`/`fonts`/etc, ids and
 * names must be non-empty, duplicates drop, and malformed entries are
 * discarded entirely.
 */
function canonicalCustomThemes(value: unknown): Theme[] {
  if (!Array.isArray(value)) return [];
  const base = THEME_PRESETS[0];
  const out: Theme[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== 'string' || raw.id.length === 0 || seen.has(raw.id)) continue;
    if (typeof raw.name !== 'string' || raw.name.length === 0) continue;
    seen.add(raw.id);
    const theme: Theme = {
      ...base,
      ...raw,
      id: raw.id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : base.description,
      colors: stringRecord(raw.colors, base.colors),
      fonts: stringRecord(raw.fonts, base.fonts),
      spacing: stringRecord(raw.spacing, base.spacing),
      borderRadius: stringRecord(raw.borderRadius, base.borderRadius),
      shadows: stringRecord(raw.shadows, base.shadows),
      transitions: stringRecord(raw.transitions, base.transitions),
      isDark: typeof raw.isDark === 'boolean' ? raw.isDark : base.isDark,
    };
    out.push(theme);
  }
  return out;
}

/** Keyframes must be finite, value-bearing and frame-sorted; the rest drops. */
function canonicalKeyframes(value: unknown): Keyframe<unknown>[] {
  if (!Array.isArray(value)) return [];
  const out: Keyframe<unknown>[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.frame !== 'number' || !Number.isFinite(raw.frame)) continue;
    if (!('value' in raw)) continue;
    const kf: Keyframe<unknown> = { frame: Math.max(0, Math.floor(raw.frame)), value: raw.value };
    if (typeof raw.easing === 'string') kf.easing = raw.easing as EasingType;
    out.push(kf);
  }
  out.sort((a, b) => a.frame - b.frame);
  return out;
}

/** Tracks need ids and targets; duplicates and structureless entries drop. */
function canonicalTracks(value: unknown): AnimationTrack[] {
  if (!Array.isArray(value)) return [];
  const out: AnimationTrack[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.id !== 'string' || raw.id.length === 0) continue;
    if (typeof raw.layerId !== 'string' || typeof raw.property !== 'string') continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    out.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : raw.property,
      layerId: raw.layerId,
      property: raw.property,
      keyframes: canonicalKeyframes(raw.keyframes),
      enabled: raw.enabled !== false,
    });
  }
  return out;
}

/**
 * Repair a saved animation timeline, field by field.
 *
 * `null`/missing means "no timeline authored" and stays `null`; everything
 * else is rebuilt from valid pieces: non-finite fps/duration fall back to the
 * defaults, the playhead clamps into range, structureless tracks/keyframes
 * drop, and `playing` always loads `false` — a session starts paused.
 */
function canonicalTimeline(value: unknown): Timeline | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const fps =
    typeof value.fps === 'number' && Number.isFinite(value.fps) && value.fps > 0
      ? value.fps
      : 30;
  const duration =
    typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration >= 1
      ? Math.floor(value.duration)
      : 300;
  const rawFrame =
    typeof value.currentFrame === 'number' && Number.isFinite(value.currentFrame)
      ? Math.floor(value.currentFrame)
      : 0;
  const onionFrames =
    typeof value.onionSkinFrames === 'number' && Number.isFinite(value.onionSkinFrames)
      ? Math.min(10, Math.max(1, Math.floor(value.onionSkinFrames)))
      : 1;
  const onionOpacity =
    typeof value.onionSkinOpacity === 'number' && Number.isFinite(value.onionSkinOpacity)
      ? Math.min(1, Math.max(0, value.onionSkinOpacity))
      : 0.3;
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : 'timeline_main',
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : 'Timeline',
    fps,
    duration,
    currentFrame: Math.min(Math.max(0, rawFrame), duration - 1),
    tracks: canonicalTracks(value.tracks),
    loop: value.loop !== false,
    playing: false,
    onionSkinEnabled: value.onionSkinEnabled === true,
    onionSkinFrames: onionFrames,
    onionSkinOpacity: onionOpacity,
  };
}

export function migrateDocument(doc: Document): Result<Document> {
  try {
    if (!isPlainObject(doc)) return err('invalid-project', 'project must be an object');
    const version = doc.schemaVersion;
    if (typeof version !== 'number' || !Number.isFinite(version)) {
      return err('invalid-project', 'schemaVersion must be a number');
    }
    if (version > CURRENT_SCHEMA_VERSION) {
      return err(
        'unsupported-version',
        `Project schema version ${version} is newer than the supported version ${CURRENT_SCHEMA_VERSION}`,
      );
    }
    if (version < 1) {
      return err('invalid-project', `Unsupported project schema version ${version}`);
    }
    const fallback = createDocument();
    const next: Document = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: typeof doc.id === 'string' && doc.id.length > 0 ? doc.id : fallback.id,
      metadata: canonicalMetadata(doc.metadata, fallback.metadata),
      canvas: canonicalCanvas(doc.canvas, fallback.canvas),
      layers: Array.isArray(doc.layers) && doc.layers.length > 0 ? doc.layers : fallback.layers,
      activeLayerId: typeof doc.activeLayerId === 'string' ? doc.activeLayerId : null,
      source: doc.source ?? null,
      // Merge over the defaults so projects written before a newer setting
      // existed (e.g. `luminanceStandard`) read the default instead of
      // `undefined`; existing fields keep their saved values.
      imageSettings: { ...fallback.imageSettings, ...(doc.imageSettings ?? {}) },
      textSettings: doc.textSettings ?? fallback.textSettings,
      exportSettings: doc.exportSettings ?? fallback.exportSettings,
      editor: canonicalEditor(doc.editor, fallback.editor),
      guides: canonicalGuides(doc.guides),
      effectsPipeline: doc.effectsPipeline ?? fallback.effectsPipeline,
      cellEffects: canonicalCellEffects(doc.cellEffects),
      paletteId: doc.paletteId ?? null,
      palettes: canonicalPalettes(doc.palettes),
      timeline: canonicalTimeline(doc.timeline),
      renderPresets: Array.isArray(doc.renderPresets) ? doc.renderPresets : [],
      themeId: typeof doc.themeId === 'string' ? doc.themeId : 'medieval',
      customThemes: canonicalCustomThemes(doc.customThemes),
      // Schema 3: generator graphs and the procedural/cell-effect seed. Both
      // are repaired rather than rejected - documents from schema 1 and 2 do
      // not carry them, and a hand-edited seed must never poison the RNG.
      generators: canonicalGenerators(doc.generators),
      fxSeed:
        typeof doc.fxSeed === 'number' && Number.isFinite(doc.fxSeed)
          ? Math.trunc(doc.fxSeed)
          : DEFAULT_FX_SEED,
    };
    return ok(next);
  } catch (e) {
    return err('internal', 'Failed to migrate project', detailOf(e));
  }
}

/**
 * Sniff the format of a text payload from its content.
 *
 * Leading whitespace is ignored: a leading `{` or `[` is JSON, an `flf2a`
 * header is a FIGlet font, a leading `@` is box-drawing ASCII art, anything
 * else non-empty is plain text; empty input is `unknown`.
 *
 * @param text - payload to inspect
 * @returns the detected format tag
 */
export function detectFormat(text: string): 'json' | 'txt' | 'asc' | 'flf' | 'unknown' {
  if (typeof text !== 'string') return 'unknown';
  const head = text.trimStart();
  if (head.length === 0) return 'unknown';
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (head.startsWith('flf2a')) return 'flf';
  if (head.startsWith('@')) return 'asc';
  return 'txt';
}
