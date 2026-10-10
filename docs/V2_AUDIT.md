# V2 Audit — Phase 0

Audit of the current cipherASCII codebase in preparation for the V2 "computational-art
studio" transformation. Read-only: nothing here is implemented yet. Every claim cites
`file:line` from HEAD at the time of the audit.

Companion docs: [`ARCHITECTURE_AUDIT.md`](ARCHITECTURE_AUDIT.md) (earlier, partially
resolved), [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`RENDERING.md`](RENDERING.md),
[`EFFECTS.md`](EFFECTS.md), [`ANIMATION.md`](ANIMATION.md),
[`PERFORMANCE.md`](PERFORMANCE.md), [`THEMES.md`](THEMES.md).

---

## 1. Existing systems (what we have)

### 1.1 Rendering

- Pipeline: `prepareSampledRaster` → `rasterToGrid` split in `src/core/renderImage.ts`
  (the split exists specifically for the worker boundary).
- **9 mapping strategies**, **52 dither algorithms** (`src/core/dither.ts`), 82 charset
  presets.
- Worker: **single** module worker with `jobId`/generation protocol
  (`src/worker/client.ts:35,87-99`, `render.worker.ts`); stale responses rejected via
  `StaleRenderError`.
- Luminance: `lumaPlane` BT.709/601 selectable (`renderImage.ts`); per-cell feature
  information **collapses to a single luminance** at `averageToCells` — the pipeline
  discards contrast/edge/texture per cell before mapping.
- Quality: exact-fit auto-levels (`src/core/image/autoLevels.ts`), preprocess chain
  (`src/core/image/preprocess.ts`).

### 1.2 Analysis

- `src/core/analyze.ts`: perceptual-capped RMSE + `deflat` banding relief + ladder
  entropy + `legibility = clamp01(16/len)`; score = 0.30·soft + 0.20·sharp + 0.20·deflat
  + 0.10·tone + 0.20·legibility; `ANALYZER_DITHERS` 12-shortlist; explicit total-order
  sort so chunked ≡ sync; metrics keyed by (dither, ladder length).
- `sampleImageLuminance(dataUrl, columns=100)` canvas2d luma plane; `runImageAnalysis`;
  import auto-runs analysis; `renderAnalysis` in store with `RenderSuggestions` chips.
- **This is scoring/selection only** — no content-aware structure analysis (edges,
  texture, frequency, regions, saliency). That is Phase 2's job.

### 1.3 Layers / compositing

- 3 layer kinds: `ascii | image | text` (`src/core/types.ts:338-369`), base fields
  `visible/locked/opacity/x/y` (`types.ts:326-336`). **No `blendMode`**.
- Compositor `src/core/layer/compose.ts`: bottom-to-top walk (`:80-106`), space =
  transparent (`:98-100`), `layerLimit` unused (`:17-22`).
- Opacity is a **position-hash cell swap**, not alpha (`compose.ts:53-68`) — partial
  opacity looks like noise.
- A **richer compositor already exists but is orphaned**: `src/core/canvas/compose.ts:119-198`
  has per-cell alpha, z-order, `source|over|add|multiply|screen` blends
  (`canvas/cell.ts:25`); only consumer is `VirtualCanvas` (`canvas/virtualCanvas.ts`),
  which **nothing in `src/` imports**.

### 1.4 Effects & animation

- 20 raster effects (`core/effects`, baked into `layer.grid` via `grid/replace` at
  `App.tsx:199,205`), 45 cell effects / 21 ambient (`core/fx`), 20 effect presets.
- Masks: 9 `MaskKind`s with compiled row-spans (`core/fx/mask.ts:12-21,70-196`),
  per-entry masks on `CellEffectEntry`, but only 6/9 kinds persist
  (`project/serialize.ts:194,226-234`) — `glyphClass|foreground|background` are silently
  dropped on save.
- Animation: 26 easings, 35 timeline easings, 11 `PathSpec` kinds, tween/scene systems
  (`core/timeline`, `core/anim`). `Document.timeline` exists (`types.ts:534`) but the
  store's timeline slice (`store:90-92,694-787`) **never writes it**.
- **Exports never touch cell effects** (0 hits in services/export/project) and
  `ExportPanel.tsx:49` uses only the active layer's grid.

### 1.5 Glyphs / charsets

- `ALL_CHARSET_PRESETS` = **82 presets** (43 extended + 39 unicode), **3,011 distinct
  characters** (extended) + 2,885 (unicode); 48 presets with ≥16 levels; 16 categories.
- **No density/feature metadata** on `CharsetDescription`.
- Legacy `src/utils/characterSets.js`: `ASCII_STANDARD`, `CJK_ULTRA_DENSE` (~5,000
  chars), canvas-measured `sortCharactersByDensity` — DOM-dependent, parallel to a
  hand-tuned table sort at `core/charsets/unicodeCharsets.ts:632`, **both wired to the
  same panel** (`AsciiControlsPanel.tsx:243,254`).
- `validateCustomCharset` has **zero callers**.
- Gap vs. V2 target: no per-glyph feature vectors, no calibrated ink/aspect/bearing data,
  no way to hit a truthful "7,000+ calibrated glyphs" claim.

### 1.6 Store / history / project

- One store, one file: `src/store/index.ts` (951 lines, ~82 actions).
- Undo: `History<Document>` snapshot stack, limit 200, 800 ms coalesce
  (`store:322`, `core/history/history.ts:27-123`); every `applyCommand` pushes with
  `key: cmd.type` (`store:410`) → long paint bursts collapse into one undo step.
- **`grid/replace` bypasses history entirely** (`store:277,406-409`) and is dispatched
  from `App.tsx:199,205`; `triggerRender()` fires from ~10 unrelated actions
  (`store:459,469,479,489,499,512,522,539,558,580,646`) — painting on an image/text
  layer is silently erased on the next re-render.
- Duplicated state: `effectsPipeline`/`cellEffects` exist in both store and document,
  synced by `commitEffects` (`store:299-314`). Store-only slices with **document fields
  that are never written**: `timeline`, `palettes`/`activePaletteId`,
  `renderPresets`, `theme`, `fxSeed` (no field at all).
- Project format: `CURRENT_SCHEMA_VERSION = 2` (`types.ts:542`); byte-stable `.aap`
  serializer (`project/serialize.ts:151-154`); `migrateDocument` single-step rebuild
  (`serialize.ts:240-284`) rejects `>2`.
- **Persistence gaps:** animations, custom palettes, render presets, theme, fxSeed are
  not saved; **no autosave/recovery anywhere** (0 hits for localStorage/indexedDB);
  Electron native `saveFile`/`readFile` bridge (`electron/preload.ts:9-17`,
  `main.ts:682-705`) has **no renderer callers** — packaged app still uses blob
  downloads.
- Dead layer fields: `ImageLayer.settings`/`TextLayer.settings`/`cacheKey`
  (`types.ts:355-366`) never read (render reads `document.imageSettings`).

### 1.7 Export

- Registry `core/export/index.ts:39-75`: `txt, asc, ansi, json, html, svg, aap` + PNG
  stub (`unsupported-format`); UI adds `png, mp4, gif` (`ExportPanel.tsx:43-46`).
- **Fidelity split:** TXT/ANSI/HTML/SVG/JSON/PNG export the **active layer only, raw**
  (`ExportPanel.tsx:42,84-141`); MP4/GIF export **`composeDocument` full stack**
  (`services/videoExport.ts:96`). PNG ≠ MP4 for the same project.
- PNG rasterizes at hard-coded 9×18/scale2 + Cascadia, colors from **theme CSS vars**
  (`ExportPanel.tsx:11-12,107-108`) — `document.canvas.background` is persisted but
  never read.
- ffmpeg.wasm: lazy load + retry + `mpeg4` fallback (`videoExport.ts:65-189`);
  args in `core/export/videoArgs.ts:34-57`. `webm`/`png-sequence` declared
  (`types.ts:781-788`) but unimplemented.

### 1.8 Selection / masks / text tool

- **No user selection**: `SelectionState` (`types.ts:904-908`) and `selection` slice
  (`store:143`) have **zero readers**; `select|line|rect|ellipse` tools declared
  (`types.ts:911`) but unimplemented in `EditorCanvas.tsx:509-582`.
- Effect masks are mature (see 1.4). Crop exists only as pre-render `CropSettings`
  (`types.ts:114-121`). `extractRegion`/`trimGrid` exist (`core/grid.ts:108-165`) with
  no UI.
- Text tool overlay is **component-local React state** (`EditorCanvas.tsx:148-149`),
  commits as one `grid/paint` (`:209-220`); never persisted.

### 1.9 Tests / docs / CI

- **820 tests / 43 files** in `tests/{unit,fuzz}` (no tests under `src/`); coverage
  config includes **only `src/core/**`** (`vitest.config.ts:13`).
- Well covered: analyze, effects, fx registries, charsets, project schema, golden
  fixtures (7), fuzz (9).
- **Untested:** `store` beyond view-state/cell-effects (9 tests for 951 lines),
  `App.tsx` render effect, `EditorCanvas.tsx` paint path, `render.worker.ts` body,
  `services/videoExport.ts`, all of `src/utils`, `electron/main.ts` (manual smoke only).
- Benchmarks with **semantic assertions**: `bench:engines` (speedup > 1×, diff = 0),
  `simulations` (staleDelivered === dropped, charset inventory), `demo` golden diff.
- CI (`ci.yml`): typecheck → lint → test → demo → bench:engines → build →
  build:electron. `release.yml`: 3-OS matrix on tags.
- Hygiene markers (TODO/FIXME/@ts-ignore) = **0 hits**; debt is duplication and casts
  (`as any` 16, `: any` 17, `as unknown as` 15) concentrated in timeline/undo/schema
  plumbing; `no-explicit-any` is globally off (`eslint.config.js:32`).

---

## 2. Reuse candidates (build on, do not replace)

| System | Reuse as |
|---|---|
| `prepareSampledRaster` / `rasterToGrid` split | V2 analysis+mapping stage boundary |
| `analyze.ts` scoring + chunked≡sync pattern | Framework for Phase 2 content analysis (same determinism discipline) |
| `core/canvas/compose.ts` alpha/blend compositor | Real layer compositing (already written, currently orphaned) |
| `core/fx/mask.ts` compiled masks | Mask system for V2 regions/selections |
| `core/history/commands.ts` pure command vocabulary | Keep; extend with transactional policy |
| `project/schema.ts` + `migrateDocument` | Versioned format starting point (v2 → v3) |
| Worker `jobId`/generation protocol | Base of the Phase 8 worker pool |
| 52 dithers, 20 raster + 45 cell effects, 26 easings, 11 path kinds | Feature surface; extend registries |
| 82 charset presets + legacy `characterSets.js` generators | Raw material for glyph calibration (Phase 3) |
| Export registry + `videoArgs` + ffmpeg loader | Keep; unify frame rendering behind it |
| Golden fixtures + `bench:engines`/`simulations` assertions | The safety net for every V2 phase |
| Auto-levels `computeAutoLevels` | Tone fitting inside Phase 2 regional analysis |

---

## 3. Missing systems (V2 must add)

1. **Per-cell feature fields** — contrast/edge/texture/structure discarded at
   `averageToCells`; nothing downstream can do content-aware mapping.
2. **Glyph intelligence** — no `GlyphFeatureVector`, no density/ink/bearing metadata,
   no `GlyphIndex`; 3k chars uncalibrated; no honest path to a large calibrated set.
3. **Content-aware image analysis** — luminance/contrast/edges/texture/frequency/
   structure/saliency/regional maps with caching.
4. **Generative layer** — no node/graph system for procedural generation (only
   imperative presets).
5. **Project graph core** — layer graph exists but render output is destructive; no
   non-destructive `CreativeLayer` graph, no `AnalysisField`/`Mask` as first-class
   document data.
6. **Selection & regions** — declared but unimplemented; no marquee/move/copy/paste.
7. **Layer blend modes / true alpha** — opacity is dither-noise; blend modes exist only
   in the orphaned compositor.
8. **Unified export frame renderer** — PNG vs MP4 mismatch; cell effects in no file.
9. **Persistence completeness + autosave** — timeline/palettes/presets/theme/fxSeed
   unsaved; no recovery; native dialogs unused.
10. **Worker pool** — single worker; no staged parallelism for analysis/generation.
11. **Timeline ↔ document wiring** — `Document.timeline` never written; animations are
    ephemeral.

---

## 4. Architectural risks

| # | Risk | Evidence | Mitigation for V2 |
|---|---|---|---|
| A1 | **Store ↔ document ownership is split** — half the state lives in store slices with dead document fields | `store:90-103` vs `types.ts:533-539`; hydration gap `store:389-400` | Single ownership rule: `Document` is source of truth; store slices are derived or explicitly view-state |
| A2 | **Destructive non-undoable render** (`grid/replace`) | `store:277,406-409`; `App.tsx:199,205` | Separate authoring grid from derived grid; render becomes an explicit, cache-keyed, undoable or side-effect-free operation |
| A3 | **Three composition paths** (layer/compose, canvas/compose, ad-hoc overlayGrid) | `layer/compose.ts`, `canvas/compose.ts`, `grid.ts:173` | One compositor; retire or integrate `VirtualCanvas` |
| A4 | **Duplicated type pairs** must change in lockstep | `types.ts:670,693,700,707,794,825` vs `effects/pipeline.ts:16,39,46,200`, `theme/theme.ts:8,53` | Consolidate during Phase 1 schema work |
| A5 | **Dual density sorters** with different semantics in one UI | `utils/characterSets.js:19-39` vs `unicodeCharsets.ts:632`; call sites `AsciiControlsPanel.tsx:243,254` | One calibration-backed sorter (Phase 3) |
| A6 | **Undo policy is incoherent** — coalesce key = command type; effects/timeline/palettes outside history | `store:410`, `history.ts:72-93`; `store:299-314,694-866` | Explicit transactional policy per slice in Phase 1 |
| A7 | **Phantom API surface** — selection, 4 tools, `DocumentExtensions`, per-layer settings declared but dead | `types.ts:904-935`, `EditorCanvas.tsx:509-582`, `types.ts:355-366` | Implement (selection/tools in Phase 5) or delete the rest |
| A8 | **Export policy is inconsistent** and undocumented | `ExportPanel.tsx:42` vs `videoExport.ts:96` | One frame-render function with explicit layer/effect policy (Phase 9) |
| A9 | **Coverage blind spot** — store/components/worker outside coverage; only manual Electron smoke | `vitest.config.ts:13`, `electron/main.ts:92` | Add tests in lockstep with each phase; widen coverage include when store is reworked |

---

## 5. Performance risks

| # | Risk | Evidence |
|---|---|---|
| P1 | **Full image re-decode per render** — `activeLayer.source.dataUrl` posted every time, no raster cache | **closed (Phase 11):** `worker/raster-decode.ts` memoises data URL → Raster per worker (capacity 1, copy-out for callers); the URL is still posted per render but that is a string clone, not a decode — `tests/unit/decodeCache.test.ts` |
| P2 | **Analysis cost grows with feature fields** — per-cell multi-channel features at full canvas resolution | **closed:** field analysis is served by the shared 64-entry `AnalysisCache` (`src/core/analysis/cache.ts`, all-hit warm repeat asserted in `imageAnalysis.test.ts`); recommendation scoring memoised per (dataUrl, columns) in Phase 11 — `worker/analysisJob.ts`, `tests/unit/analysisJob.test.ts` |
| P3 | **Single worker** — analysis, render, generation, export frames contend on one thread | **closed (Phase 8):** pool of up to 4 slots in `worker/client.ts` (least-busy dispatch, crash isolation, single-flight analysis) — `tests/unit/worker.test.ts` pool describe; export frame loop still main-thread (see P4) |
| P4 | **Video export: full-resolution `canvas.toBlob` + structured clone per frame**, no diffing/transferables | **partial (Phase 11):** one canvas reused for the whole timeline (`services/videoExport.ts`); PNG encode + `writeFile` per frame remain on the main thread — documented as `PERFORMANCE.md` §6 item 6 |
| P5 | **Whole-app re-render** on store changes (partially mitigated by `React.memo` on 11 panels) | **partial (Phase 11):** 12 panels memoized; the 5 bare `useStore()` subscriptions narrowed to selectors (StatusBar/LayerPanel/ExportPanel/SettingsPanel/PropertyPanel) — render-count assertions in `tests/unit/panelStoreSubscriptions.test.tsx`; App's own selector still re-renders the tree |
| P6 | **Brush/clone and allocation-heavy canvas paint** — improved (clone-once `EditorCanvas.tsx:120,576`) but DOM paint still unmeasurable in Node | **partial (Phase 11):** clone-once stroke kept; cell writes are allocation-free (no per-cell array spread, shared default clip — `core/draw.ts`, `draw.test.ts`); per-stroke recompose/repaint remains and frame times are published in the debug overlay — DOM paint unmeasurable in Node (`docs/PERFORMANCE.md` §4) |
| P7 | **Effects run at source resolution** unless `effectSpace: 'grid'` | **open by design:** default stays `'source'` (presets keep their look); the documented escape hatch `effectSpace: 'grid'` has measured numbers in `docs/PERFORMANCE.md` §6 item 1 and both paths are tested (`tests/unit/effectSpace.test.ts`) |
| P8 | **Glyph index build cost** — calibrating thousands of glyphs must be cached/seeded, never per-session | **closed (Phase 3):** offline `npm run calibrate` table, per-ramp `indexCache`, hot path uses `sortRampByInk` — `tests/unit/calibration.test.ts` |
| P9 | **JSON-based undo compare** was replaced by `deepEqual`, but snapshot stack still copies document references at 200 deep | **partial:** compare is `deepEqual` (`PERFORMANCE.md` §6 item 5); snapshots are reference-shared (`core/history/history.ts` — structural sharing, only replaced grids cloned) under a 200-step cap that drops the oldest; a byte budget is not implemented |

---

## 6. Proposed architecture (target for V2)

Layers of the target system, in dependency order (mirrors Phases 1–12):

```
┌─ UI (React panels, editor canvas, suggestions, generator graph editor)
├─ Store (Zustand — view state + derived slices; Document is sole source of truth)
├─ Project (versioned schema v4: CreativeLayer graph, AnalysisField, Mask, GlyphIndex
│           refs, GeneratorGraph, timeline, palettes, presets — everything persisted,
│           autosave + native dialogs)
├─ Engine (pure src/core, DOM-free, deterministic, seeded)
│   ├─ analysis   — luminance/contrast/edges/texture/frequency/structure/saliency
│   │               + regional maps, cached, worker-pooled      (Phase 2)
│   ├─ glyphs     — GlyphFeatureVector + GlyphIndex + calibration  (Phase 3)
│   ├─ mapping    — 9 strategies + 52 dithers consuming CellFeatures (Phase 4)
│   ├─ generators — GeneratorGraph (nodes = pure ops, seeded)    (Phase 6)
│   ├─ effects    — 20 raster + 45 cell, masks, unified spaces    (Phase 7)
│   ├─ anim       — timeline wired to Document, easings, paths   (Phase 7)
│   ├─ compose    — single alpha/blend compositor                (Phase 5)
│   └─ export     — one frame-render fn feeding txt/png/gif/mp4   (Phase 9)
└─ Execution — worker pool (render/analysis/generation), job generations preserved
```

Design rules carried into every phase:

- **No blind rewrites**; no migrations (Rust/WebGPU/WASM) without profiling first.
- **Real algorithms only** — never fake intelligence, never fake glyph counts; every
  number in UI/docs must be measurable (`charsets.test.ts`, `simulations.bench.ts`
  style assertions).
- **Deterministic seeds everywhere**; cached analysis keyed like `analyze.ts`.
- **Worker pool, not ad-hoc workers**; keep `jobId`/generation staleness protocol.
- **Core stays pure TS, DOM-free**; tests in Node; golden fixtures updated with
  `UPDATE_GOLDEN=1` only when a change is intentional.
- **CI gate must stay green:** typecheck, lint, all tests (1187 / 69 files at the
  V2 close-out), `demo`, `bench:engines` (semantic assertions), `build`,
  `build:electron`.
- **Zero new runtime deps** without justification.

---

## 7. Phase plan (reference)

| Phase | Deliverable | Depends on | Status |
|---|---|---|---|
| 0 | This audit (`docs/V2_AUDIT.md`) | — | done |
| 1 | Core data model: `CellFeatures`, `GlyphFeatureVector`, `GlyphIndex`, `AnalysisField`, `GeneratorGraph`, `CreativeLayer`, `Mask`, ProjectSchema v3 | 0 | done |
| 2 | Image analysis: luminance/contrast/edges/texture/frequency/structure/saliency/regional + cache | 1 | done |
| 3 | Glyph intelligence: calibration pipeline + index + honest counts | 1 | done |
| 4 | Content-aware mapping consuming features | 2, 3 | done |
| 5 | Selection, regions, blend modes, unified compositor | 1 | done |
| 6 | Generative layer / node graph | 1, 2 | done |
| 7 | Effects + animation integration (non-destructive, exportable) | 1, 5 | done |
| 8 | Worker pool | 2, 4, 6 | done |
| 9 | Unified export (one frame renderer, all formats, cell effects included) | 5, 7 | done |
| 10 | Persistence completeness + autosave + native dialogs | 1 | done |
| 11 | Performance pass vs `PERFORMANCE.md` baselines (P1–P9) | 8 | done |
| 12 | Docs, README, benchmarks, screenshots refresh | all | done |

Phase exit rule: typecheck + lint + all tests + demo + bench:engines green, golden
fixtures regenerated only with intent, README/docs updated in the same commit as the
behavior change.

**Status (V2 close-out):** phases 0–12 are all done and CI-green on `main`
(1187 tests / 69 files). Remaining gaps are recorded, not hidden: the per-frame
PNG encode in video export (`PERFORMANCE.md` §6 item 6), the deliberate
`effectSpace: 'source'` default (P7, with the measured `'grid'` escape hatch),
the missing byte budget on the undo stack (P9), and packaged-Electron smoke
testing, which still needs a human (A9 — no display in this environment).
