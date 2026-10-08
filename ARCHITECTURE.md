# ASCII Art Studio — Architecture

> Internal design document. Describes subsystems, data flow, ownership, threading,
> persistence, error handling and extension points.

## 1. Goals

A professional ASCII-art creation studio: **generate, edit, transform, compose,
preview, export and manage** ASCII art with a modular, testable core.

Hard rules:

- The rendering core is **pure TypeScript with no DOM dependency**, so every
  pipeline stage is unit-testable in Node.
- Character data (grid) is strictly separated from visual presentation
  (colors, fonts, terminal styling).
- Every user-visible action is a **command**; commands are undoable.
- Nothing in the UI is faked: no placeholder buttons, no fake metrics.

## 2. Layered system overview

```
┌───────────────────────────────────────────────────────────────┐
│ UI (React)                                                    │
│   MenuBar · Toolbox · Workspace · Inspector · StatusBar ·     │
│   CommandPalette · Dialogs · Toasts                           │
├───────────────────────────────────────────────────────────────┤
│ Application state (Zustand store)                             │
│   project · view · ui · settings · async status               │
├───────────────────────────────────────────────────────────────┤
│ Command system                                                │
│   registry (id, title, category, shortcut, run)               │
│   history (undo/redo over immutable document snapshots)       │
├───────────────────────────────────────────────────────────────┤
│ Document model (immutable)                                    │
│   canvas · layers[ascii|text|image] · source · settings       │
├───────────────────────────────────────────────────────────────┤
│ Rendering pipeline (pure core)                                │
│   image: decode→crop/resize→preprocess→gray→dither→map→grid   │
│   text:  font → glyphs → layout → styles → grid               │
│   proc:  noise/waves/patterns → grid                          │
├───────────────────────────────────────────────────────────────┤
│ Foundations                                                   │
│   color · image ops · character maps · dither · aspect ·      │
│   grid ops · ansi encoding · exporters · project schema       │
└───────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward. `src/core/**` never imports from
`src/ui/**` or `src/app/**`.

## 3. Core data types (`src/core/types.ts`)

- `Raster` — `{ width, height, data: Uint8ClampedArray }` RGBA.
- `AsciiGrid` — uniform cell grid: `width`, `height`, `chars: string[]`
  (row-major, every row exactly `width` entries), optional `fg`/`bg`
  `Int32Array` (`-1` = unset, else `0xRRGGBB`). Uniform (not ragged) keeps
  canvas rendering, compositing and hit-testing trivial.
- `Layer` — discriminated union:
  - `ascii`: user-editable grid (drawing tools, editor).
  - `text`: typography source + `TextStyle`; grid is a derived cache.
  - `image`: source raster + `ImageRenderSettings`; grid is a derived cache
    keyed by a stable settings hash.
- `Document` (project): metadata, canvas, layers, source, render settings,
  text settings, export settings, editor state, guides, `schemaVersion`.

Derived grids are caches: they are recomputed by the render engine and never
stored as authoritative user data (except for `ascii` layers).

## 4. Rendering pipeline

### 4.1 Image → ASCII

```
Raster
 → crop/fit
 → resize to (cols·subX, rows·subY)        [area/bilinear, supersampling]
 → preprocessing ops (exposure, brightness, contrast, saturation,
    gamma, sharpen, blur, posterize, threshold, invert, grayscale)
 → luminance plane (Float32 0..1)
 → mapping strategy (neighborhood-aware) → value plane
 → dithering (optional, quantises to k levels, k = charset length)
 → character selection (offset, density curve, invert)
 → aspect-ratio correction (char cell w/h presets)
 → color sampling (none / sample / ansi16 / ansi256 / truecolor)
 → AsciiGrid + RenderStats
```

### 4.2 Text → ASCII

Built-in **original bitmap fonts** (hand-authored glyph tables) plus a
**FIGlet `.flf` importer** so users can load any external FIGlet font without
us bundling third-party font files. Styles: shadow, outline, double-strike,
block, banner frames, spacing/scale/alignment/line-spacing.

### 4.3 High-resolution modes

`braille` (2×4 sub-pixels), `halfblocks` (1×2 with fg/bg), `quadrants` (2×2).
These are *render modes*, not charset tricks: sub-sampling geometry changes
together with the output dimensions.

### 4.4 Aspect correction

Characters are not square. `aspect ratio = cellWidth / cellHeight` presets:
`terminal (0.5)`, `square (1)`, `narrow (0.75)`, `wide (0.4)`, `custom`.
Rows are computed as `rows = round(srcH × cols / srcW / ratio)`.

## 5. Character mapping engine

`MappingStrategy` = pure function `(plane, w, h, opts) → value plane`.
Registry pattern; adding a strategy never touches UI code beyond a registry
lookup. Built-ins: `luminance`, `brightness`, `contrast`, `localContrast`,
`edge`, `gradient`, `threshold`, `adaptive`, `detail`, `custom`. Strategies
with `usesFeatures: true` receive the per-cell `CellFeatures` planes
(contrast / edge / texture measured inside each cell) and the renderer
extracts them exactly for those strategies.

`CharacterSet` presets + custom sequences (Character Set Lab) with
dark→light ordering, offset and density curve.

## 6. Dither engine

Registry of algorithms with a stated purpose each:
`none`, `threshold`, `bayer` (ordered, stable, tileable), `floydSteinberg`
(general purpose), `atkinson` (contrast-preserving, classic Mac look),
`jarvisJudiceNinke` / `stucki` / `burkes` (smoother gradients, cheaper than
FS respectively), plus serpentine scanning toggle. All generalised to
quantisation with `k` levels where `k = charset length` so dithering composes
correctly with multi-level character sets.

## 7. Concurrency & stale-render prevention

- All heavy renders run through `RenderService`, which in the browser is a
  Web Worker (`src/worker/`), in Node a direct call (same pure functions).
- Every request carries a monotonically increasing `jobId`; results older than
  the latest dispatched id for the same slot are **discarded** (generation
  check), so rapid slider changes can never show stale output.
- Requests are cancellable cooperatively: pipelines check an
  `AbortSignal`-like `shouldCancel()` between stages.

## 8. History (undo/redo)

Snapshot-based with **structural sharing**: documents are immutable, so a
command stores `{ label, before, after }` referencing unchanged subtrees.
Cost of one entry ≈ cost of the changed layers only. Entries are coalesced
for continuous edits (slider drags) via a `mergeKey`, and the stack is capped
(configurable, default 200) to bound memory. Tested at 1 / 100 / 1000 ops.

## 9. Command system

`CommandRegistry` holds `{ id, title, category, defaultShortcut?, run() }`.
Menus, toolbar buttons, keyboard shortcuts and the command palette all resolve
through it. Shortcuts are expressed as abstract chords (`Mod+S`) and resolved
per platform (Meta on macOS, Ctrl elsewhere).

## 10. Persistence

- **Project format `.aap`**: versioned JSON (`schemaVersion`), embeds the
  source image as a data URL, preserves layers, all settings, guides, editor
  state, the animation timeline (tracks/keyframes) and metadata. `migrations[]` upgrade older versions step-by-step;
  unknown future versions are rejected with a clear error.
- **Autosave**: throttled snapshots in `localStorage` (+ optional File System
  Access when available), with a recovery prompt on startup.
- **Exports**: txt/asc/ansi/html/svg/json/aap/png — every registry exporter is
  a pure string/buffer builder tested in Node. MP4/GIF are produced by
  `src/services/videoExport.ts`: each timeline frame goes through
  `applyTimelineToDocument` → `composeDocument` → `drawGridToContext` (the same
  path as the preview and PNG), then `@ffmpeg/ffmpeg` (ffmpeg.wasm, core
  vendored into `public/ffmpeg/`) encodes H.264 or a palette GIF.

## 11. Error handling

Core functions never throw for *user* input problems; they return
`Result { ok, value?, error? }` or throw typed `StudioError` with a
`code` + user-facing message. The UI maps errors to toasts/dialogs; raw stack
traces are only logged to the console in dev builds.

## 12. Security

Untrusted input: image decode (dimension/pixel-count caps to stop decompression
bombs), project JSON (schema validation, no code execution, no path trust),
export paths (normalised, traversal-checked, overwrite confirmation),
Unicode (invalid sequences replaced, control characters sanitised).

## 13. Extension points (plugin-ready)

Registries exist for: mapping strategies, dither algorithms, charsets,
exporters, fonts, procedural generators, commands, image filters. A future
plugin system only needs a loader that calls `registry.register()`.

## 14. Threading model

| Context        | Work                                              |
| -------------- | ------------------------------------------------- |
| Main thread    | UI, editor, canvas compositing, small grid ops    |
| Render worker  | image pipeline, text raster, procedural, exports  |
| Idle/debounce  | preview refresh (120 ms), autosave (1 s)          |
