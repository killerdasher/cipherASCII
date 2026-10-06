import type { CellEffectEntry } from './fx/pipeline';

/**
 * Core data contracts for ASCII Art Studio.
 *
 * This module is the single source of truth shared by the rendering core,
 * the document model, the persistence layer and the UI. It must never import
 * from UI or application code.
 */

// ---------------------------------------------------------------------------
// Basic primitives
// ---------------------------------------------------------------------------

/** RGB color packed as 0xRRGGBB. */
export type Rgb = number;

/** Sentinel for "no color assigned" in Int32Array color planes. */
export const NO_COLOR = -1;

/**
 * Editor cell metrics in CSS pixels. The canvas paints every glyph in an
 * 8x16 box, so a grid of `width / 8` columns covers an image pixel for pixel -
 * the basis for auto-sizing an imported picture's grid.
 */
export const CELL_SIZE = { width: 8, height: 16 } as const;

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// AsciiGrid — the canonical character document
// ---------------------------------------------------------------------------

/**
 * A uniform (never ragged) grid of characters.
 *
 * `chars.length === width * height`, row-major. Every row holds exactly
 * `width` single-character strings (space-padded). Colors are optional
 * per-cell planes; `-1` means "inherit / unset".
 */
export interface AsciiGrid {
  width: number;
  height: number;
  chars: string[];
  fg: Int32Array | null;
  bg: Int32Array | null;
}

export type ColorMode = 'none' | 'sample' | 'ansi16' | 'ansi256' | 'truecolor';

// ---------------------------------------------------------------------------
// Image pipeline settings
// ---------------------------------------------------------------------------

export type AspectPreset = 'terminal' | 'square' | 'narrow' | 'wide' | 'custom';

export interface AspectSettings {
  preset: AspectPreset;
  /** cellWidth / cellHeight. `terminal` = 0.5 (chars are ~2x taller than wide). */
  ratio: number;
}

export const ASPECT_PRESETS: Record<AspectPreset, number> = {
  terminal: 0.5,
  square: 1,
  narrow: 0.75,
  wide: 0.4,
  custom: 0.5,
};

export type FitMode = 'contain' | 'cover' | 'stretch';
export type ResizeFilter = 'area' | 'bilinear' | 'nearest' | 'bicubic' | 'lanczos';

/**
 * Luminance weights used to turn RGB into a 0..1 brightness plane.
 *
 * - `rec601` (BT.601): 0.299/0.587/0.114 in gamma space - the classic
 *   video-space luma used by most legacy ASCII converters.
 * - `rec709` (BT.709): 0.2126/0.7152/0.0722 in gamma space - HDTV weights.
 * - `average`: naive (R+G+B)/3.
 * - `luma`: the NTSC 0.299/0.587/0.114 weights, kept distinct from `rec601`
 *   so projects record which convention produced them.
 * - `srgb-linear`: true relative luminance after sRGB linearization.
 */
export type LuminanceStandard =
  | 'rec601'
  | 'rec709'
  | 'average'
  | 'luma'
  | 'srgb-linear';

export interface CropSettings {
  enabled: boolean;
  /** Normalized 0..1 crop rect applied before resize. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreprocessSettings {
  exposure: number; // -1..1 (multiplicative stops-like)
  brightness: number; // -1..1
  contrast: number; // -1..1 (0 = neutral)
  saturation: number; // -1..1 (-1 = grayscale)
  gamma: number; // 0.1..4 (1 = neutral)
  sharpness: number; // 0..1
  blur: number; // 0..N pixels (gaussian sigma-ish)
  posterize: number; // 0 = off, else levels (2..32)
  threshold: number; // -1 = off, else 0..1 cut
  invert: boolean;
  grayscale: boolean;
  edgeEnhance: number; // 0..1
}

export const DEFAULT_PREPROCESS: PreprocessSettings = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 1,
  sharpness: 0,
  blur: 0,
  posterize: 0,
  threshold: -1,
  invert: false,
  grayscale: false,
  edgeEnhance: 0,
};

export type DitherId =
  | 'none'
  | 'threshold'
  | 'bayer'
  | 'bayer2' | 'bayer4' | 'bayer8' | 'bayer16' | 'bayer32'
  | 'voidCluster' | 'voidClusterFast'
  | 'floydSteinberg' | 'floydSteinbergSerpentine' | 'falseFloydSteinberg'
  | 'jarvisJudiceNinke' | 'stucki' | 'burkes'
  | 'sierra' | 'sierraLite' | 'sierra3' | 'sierra2'
  | 'stevensonArce' | 'stevensonArceLite'
  | 'atkinson'
  | 'frankie' | 'shiauFan' | 'curve' | 'omar' | 'richardson' | 'stuckiLite'
  | 'halftoneAM' | 'halftoneAM45' | 'halftoneAMRotated' | 'halftoneCircular' | 'halftoneElliptical' | 'halftoneSquare' | 'halftoneLine' | 'halftoneCross'
  | 'halftoneFM' | 'halftoneFMMixed'
  | 'blueNoise' | 'blueNoiseAnimated' | 'voidClusterDither'
  | 'patternDots' | 'patternLines' | 'patternCrossHatch' | 'patternMezzotint' | 'patternStipple'
  | 'dotDiffusion' | 'dotDiffusionShuffled'
  | 'roberts' | 'sobel' | 'prewitt' | 'laplacian';

export interface DitherSettings {
  algorithm: DitherId;
  /** 0..1 mix between original and dithered result. */
  strength: number;
  serpentine: boolean;
  /** Ordered-dither matrix size for `bayer`. */
  matrixSize: 4 | 8;
}

export type MappingId =
  | 'luminance'
  | 'brightness'
  | 'contrast'
  | 'localContrast'
  | 'edge'
  | 'gradient'
  | 'threshold'
  | 'adaptive'
  | 'custom';

export interface MappingSettings {
  strategy: MappingId;
  /** Radius (cells) used by neighbourhood strategies. */
  radius: number;
  /** Threshold cut for `threshold` strategy, 0..1. */
  threshold: number;
  /** Local-contrast/adaptive strength, 0..2. */
  strength: number;
  /** Custom curve control points (input → output), sorted by input. */
  curve: Array<{ x: number; y: number }>;
}

export type RenderMode = 'chars' | 'braille' | 'halfblocks' | 'quadrants';

export interface MappingOutputSettings {
  /** Character sequence ordered dark → light (or light → dark when inverted). */
  charset: string;
  /** Shift applied to the luminance→glyph mapping, in glyph steps. */
  offset: number;
  /** Density curve exponent; >1 keeps more highlights, <1 lifts shadows. */
  density: number;
  invert: boolean;
}

export interface ImageRenderSettings {
  /** Output width in cells (columns). */
  columns: number;
  aspect: AspectSettings;
  fit: FitMode;
  resizeFilter: ResizeFilter;
  crop: CropSettings;
  /** Supersampling per cell (1 = one sample per sub-pixel grid point). */
  supersample: number;
  mode: RenderMode;
  /** Luminance weights used for the brightness plane (see {@link LuminanceStandard}). */
  luminanceStandard: LuminanceStandard;
  preprocess: PreprocessSettings;
  mapping: MappingSettings;
  dither: DitherSettings;
  output: MappingOutputSettings;
  colorMode: ColorMode;
}

export const DEFAULT_IMAGE_RENDER: ImageRenderSettings = {
  columns: 100,
  aspect: { preset: 'terminal', ratio: ASPECT_PRESETS.terminal },
  fit: 'contain',
  resizeFilter: 'area',
  crop: { enabled: false, x: 0, y: 0, width: 1, height: 1 },
  supersample: 1,
  mode: 'chars',
  luminanceStandard: 'rec709',
  preprocess: { ...DEFAULT_PREPROCESS },
  mapping: {
    strategy: 'luminance',
    radius: 3,
    threshold: 0.5,
    strength: 1,
    curve: [],
  },
  dither: { algorithm: 'none', strength: 1, serpentine: false, matrixSize: 8 },
  output: { charset: '@%#*+=-:. ', offset: 0, density: 1, invert: false },
  colorMode: 'sample',
};

// ---------------------------------------------------------------------------
// Text / typography settings
// ---------------------------------------------------------------------------

export type FontId = string;

export type TextAlign = 'left' | 'center' | 'right';

export type TextStyleId =
  | 'plain'
  | 'shadow'
  | 'outline'
  | 'double'
  | 'banner'
  | 'frame';

export interface TextRenderSettings {
  font: FontId;
  /** Integer scale: glyphs are repeated this many times per pixel row/col. */
  scale: number;
  letterSpacing: number;
  lineSpacing: number;
  align: TextAlign;
  style: TextStyleId;
  /** Shadow style: character used for the shadow and its offset. */
  shadowChar: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** Banner/frame style characters (corner, horizontal, vertical). */
  frameChars: string;
  upperCaseOnly: boolean;
}

export const DEFAULT_TEXT_RENDER: TextRenderSettings = {
  font: 'block',
  scale: 1,
  letterSpacing: 1,
  lineSpacing: 1,
  align: 'left',
  style: 'plain',
  shadowChar: '#',
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  frameChars: '─│┌┐└┘',
  upperCaseOnly: false,
};

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export type LayerId = string;

interface LayerBase {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 — only meaningful for layers that composite over others. */
  opacity: number;
  /** Cell-space offset of the layer content inside the canvas. */
  x: number;
  y: number;
}

export interface AsciiLayer extends LayerBase {
  kind: 'ascii';
  grid: AsciiGrid;
}

export interface ImageSource {
  name: string;
  /** Data URL (`data:image/png;base64,...`) — self-contained, no path trust. */
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  source: ImageSource | null;
  settings: ImageRenderSettings;
  /** Derived cache. Keyed by `cacheKey`. */
  grid: AsciiGrid | null;
  cacheKey: string;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  settings: TextRenderSettings;
  grid: AsciiGrid | null;
  cacheKey: string;
}

export type Layer = AsciiLayer | ImageLayer | TextLayer;

export interface Guide {
  axis: 'h' | 'v';
  /** Cell coordinate. */
  pos: number;
}

/**
 * Subtexture overlay: a mask multiplied over the rendered output so the ASCII
 * reads as pixels behind an LCD/CRT screen.
 *
 * - `scale`: size of one mask element in device pixels (>= 1).
 * - `opacity`: blend strength, 0 = untouched, 1 = full mask.
 * - `interpolation`: `nearest` draws hard-edged mask elements, `linear`
 *   uses a smooth cosine falloff between them.
 */
export type SubtexturePattern = 'none' | 'scanlines' | 'rgbStripes' | 'rgbRosette' | 'grid';

export interface SubtextureSettings {
  pattern: SubtexturePattern;
  scale: number;
  opacity: number;
  interpolation: 'nearest' | 'linear';
}

export const DEFAULT_SUBTEXTURE: SubtextureSettings = {
  pattern: 'none',
  scale: 2,
  opacity: 0.55,
  interpolation: 'linear',
};

export interface CanvasSettings {
  width: number;
  height: number;
  background: Rgb | null;
  /** Show faint background grid in canvas view. */
  showGrid: boolean;
  /** Snap drawing and movement to cell boundaries. */
  snap: boolean;
  showGuides: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
  /** Sub-pixel mask drawn over the editor preview and PNG export. */
  subtexture: SubtextureSettings;
}

// ---------------------------------------------------------------------------
// Export settings
// ---------------------------------------------------------------------------

export type ExportFormat = 'txt' | 'asc' | 'ansi' | 'html' | 'svg' | 'png' | 'json' | 'aap';

export interface ExportSettings {
  format: ExportFormat;
  /** Text encoding fallback for txt/asc: replace non-ASCII with ASCII look-alikes. */
  asciiOnly: boolean;
  /** Include per-cell colors where the format supports them. */
  includeColors: boolean;
  ansiLevel: '16' | '256' | 'truecolor';
  html: {
    title: string;
    background: Rgb | null;
    foreground: Rgb | null;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    includeSource: boolean;
  };
  svg: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    background: Rgb | null;
  };
  png: {
    cellWidth: number;
    cellHeight: number;
    fontFamily: string;
    background: Rgb | null;
    foreground: Rgb | null;
    scale: number;
  };
  /** Suggested base filename (without extension). */
  baseName: string;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'txt',
  asciiOnly: false,
  includeColors: true,
  ansiLevel: 'truecolor',
  html: {
    title: 'ASCII Art',
    background: 0x0c0c10,
    foreground: 0xd4d4d8,
    fontFamily: "'Cascadia Mono','Consolas','DejaVu Sans Mono',monospace",
    fontSize: 12,
    lineHeight: 1.15,
    includeSource: false,
  },
  svg: {
    fontFamily: "'Cascadia Mono','Consolas','DejaVu Sans Mono',monospace",
    fontSize: 12,
    lineHeight: 1.15,
    background: 0x0c0c10,
  },
  png: {
    cellWidth: CELL_SIZE.width,
    cellHeight: CELL_SIZE.height,
    fontFamily: 'monospace',
    background: 0x0c0c10,
    foreground: 0xd4d4d8,
    scale: 1,
  },
  baseName: 'ascii-art',
};

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

export interface EditorState {
  cursor: Point;
  /** Selection anchor; `null` when there is no selection. */
  anchor: Point | null;
  /** Cell size of one tab stop. */
  tabSize: number;
  showWhitespace: boolean;
  showLineNumbers: boolean;
}

// ---------------------------------------------------------------------------
// Document (project)
// ---------------------------------------------------------------------------

export interface ProjectMetadata {
  name: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  description: string;
  tags: string[];
}

export interface Document {
  schemaVersion: number;
  id: string;
  metadata: ProjectMetadata;
  canvas: CanvasSettings;
  layers: Layer[];
  activeLayerId: LayerId | null;
  /** Original imported image; also the source of image layers. */
  source: ImageSource | null;
  imageSettings: ImageRenderSettings;
  textSettings: TextRenderSettings;
  exportSettings: ExportSettings;
  editor: EditorState;
  guides: Guide[];
  /** Effects pipeline for post-processing. */
  effectsPipeline: EffectsPipeline;
  /** Cell-level animation effects (glyph grid), played by the live runtime. */
  cellEffects: CellEffectEntry[];
  /** Active palette ID. */
  paletteId: string | null;
  /** Animation timeline. */
  timeline: Timeline | null;
  /** Saved render presets. */
  renderPresets: RenderPreset[];
  /** Active theme ID. */
  themeId: string;
}

export const CURRENT_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Results / errors
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'invalid-input'
  | 'unsupported-format'
  | 'decode-failed'
  | 'too-large'
  | 'cancelled'
  | 'export-failed'
  | 'io-error'
  | 'invalid-project'
  | 'unsupported-version'
  | 'internal';

export class StudioError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.detail = detail;
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: StudioError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: ErrorCode, message: string, detail?: string): Result<T> {
  return { ok: false, error: new StudioError(code, message, detail) };
}

// ---------------------------------------------------------------------------
// Render jobs (worker protocol)
// ---------------------------------------------------------------------------

export interface RenderStats {
  /** Wall-clock milliseconds for the pipeline. */
  durationMs: number;
  /** Cell count of the produced grid. */
  cells: number;
  /** Source pixel dimensions processed. */
  sourceWidth: number;
  sourceHeight: number;
}

export interface RenderResult {
  grid: AsciiGrid;
  stats: RenderStats;
}

export interface ImageRenderRequest {
  kind: 'image';
  jobId: number;
  /** Decoded source; the worker also accepts a data URL and decodes itself. */
  raster: Raster | null;
  dataUrl?: string;
  settings: ImageRenderSettings;
  /** Post-processing stack applied to the raster before ASCII mapping. */
  effects?: EffectsPipeline;
}

export interface TextRenderRequest {
  kind: 'text';
  jobId: number;
  text: string;
  settings: TextRenderSettings;
}

export interface ProceduralRenderRequest {
  kind: 'procedural';
  jobId: number;
  generator: string;
  options: Record<string, unknown>;
}

export type RenderRequest =
  | ImageRenderRequest
  | TextRenderRequest
  | ProceduralRenderRequest;

export interface RenderResponse {
  jobId: number;
  ok: boolean;
  result?: RenderResult;
  error?: { code: ErrorCode; message: string };
}

// ============================================================================
// Palette Types
// ============================================================================

export interface PaletteColor {
  rgb: number;
  name?: string;
  locked?: boolean;
}

export interface Palette {
  id: string;
  name: string;
  colors: PaletteColor[];
  description?: string;
  source?: 'auto' | 'manual' | 'imported';
  createdAt: string;
  updatedAt: string;
}

export interface PaletteExtractionOptions {
  maxColors?: number;
  quality?: number;
  includeLocked?: boolean;
  colorSpace?: 'rgb' | 'lab' | 'oklab';
  dithering?: boolean;
}

// ============================================================================
// Effects Pipeline Types
// ============================================================================

export type EffectId =
  | 'none'
  | 'epsilonGlow'
  | 'jpegGlitch'
  | 'chromaticAberration'
  | 'scanlines'
  | 'vignette'
  | 'filmGrain'
  | 'bloom'
  | 'diffractionStars'
  | 'crtCurvature'
  | 'colorShift'
  | 'paletteShift'
  | 'ditherOverlay'
  | 'edgeEnhance'
  | 'sharpen'
  | 'blur'
  | 'noise'
  | 'halftoneOverlay'
  | 'medianFilter'
  | 'motionBlur'
  | 'lensDistortion';

export interface EffectMeta {
  id: EffectId;
  label: string;
  description: string;
  category: 'glow' | 'glitch' | 'color' | 'texture' | 'blur' | 'distortion' | 'style';
}

export interface EffectSettings {
  id: EffectId;
  enabled: boolean;
  intensity: number;
  params: Record<string, number | boolean | string>;
}

export interface EffectsPipeline {
  effects: EffectSettings[];
}

// ============================================================================
// Timeline / Animation Types
// ============================================================================

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeInQuart'
  | 'easeOutQuart'
  | 'easeInOutQuart'
  | 'easeInQuint'
  | 'easeOutQuint'
  | 'easeInOutQuint'
  | 'easeInSine'
  | 'easeOutSine'
  | 'easeInOutSine'
  | 'easeInExpo'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeInCirc'
  | 'easeOutCirc'
  | 'easeInOutCirc'
  | 'easeInBack'
  | 'easeOutBack'
  | 'easeInOutBack'
  | 'easeInElastic'
  | 'easeOutElastic'
  | 'easeInOutElastic'
  | 'easeInBounce'
  | 'easeOutBounce'
  | 'easeInOutBounce'
  | 'steps';

export interface Keyframe<T> {
  frame: number;
  value: T;
  easing?: EasingType;
}

export interface AnimationTrack {
  id: string;
  name: string;
  layerId: string;
  property: string;
  keyframes: Keyframe<any>[];
  enabled: boolean;
}

export interface Timeline {
  id: string;
  name: string;
  fps: number;
  duration: number;
  currentFrame: number;
  tracks: AnimationTrack[];
  loop: boolean;
  playing: boolean;
  onionSkinEnabled: boolean;
  onionSkinFrames: number;
  onionSkinOpacity: number;
}

export interface ExportAnimationOptions {
  format: 'gif' | 'webm' | 'mp4' | 'png-sequence' | 'json';
  fps?: number;
  quality?: number;
  width?: number;
  height?: number;
  loop?: number;
}

// ============================================================================
// Theme Types
// ============================================================================

export interface ThemeColors {
  bg: string;
  bgElevated: string;
  bgHover: string;
  bgActive: string;
  fg: string;
  fgMuted: string;
  fgDisabled: string;
  fgInverse: string;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentMuted: string;
  border: string;
  borderLight: string;
  borderFocus: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  codeBg: string;
  codeFg: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  glow: string;
  selection: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  fonts: {
    mono: string;
    sans: string;
    display?: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  transitions: {
    fast: string;
    normal: string;
    slow: string;
  };
  isDark: boolean;
}

// ============================================================================
// Preset / Project Template Types
// ============================================================================

export interface RenderPreset {
  id: string;
  name: string;
  description: string;
  imageSettings: ImageRenderSettings;
  textSettings: TextRenderSettings;
  exportSettings: ExportSettings;
  effectsPipeline: EffectsPipeline;
  paletteId?: string;
  thumbnail?: string; // data URL
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  document: Document;
  thumbnail?: string;
  category: 'text' | 'image' | 'animation' | 'effects' | 'general';
  tags: string[];
  author?: string;
  version: number;
}

// ============================================================================
// UI State Extensions
// ============================================================================

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface SelectionState {
  type: 'rectangle' | 'lasso' | 'magicWand';
  bounds: { x: number; y: number; width: number; height: number } | null;
  layerIds: string[];
}

export interface ToolState {
  activeTool: 'select' | 'brush' | 'eraser' | 'fill' | 'text' | 'line' | 'rect' | 'ellipse' | 'eyedropper' | 'pan' | 'zoom';
  brushSize: number;
  /** Single character written by the brush/fill tools (first code point). */
  brushChar: string;
  brushOpacity: number;
  brushHardness: number;
  foregroundColor: number;
  backgroundColor: number;
}

// ============================================================================
// Extended Document with new features
// ============================================================================

export interface DocumentExtensions {
  paletteId?: string;
  effectsPipeline: EffectsPipeline;
  cellEffects?: CellEffectEntry[];
  timeline?: Timeline;
  renderPresets: RenderPreset[];
  viewport: ViewportState;
  selection: SelectionState;
  tool: ToolState;
  themeId: string;
}
