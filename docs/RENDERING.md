# Rendering

How a picture becomes characters, and how characters reach the screen.

There are two pipelines that meet at one data structure — the `AsciiGrid`.

```
 import / drag-drop
        │
        ▼
  ┌──────────────┐   worker (render.worker.ts)   ┌──────────────┐
  │  Raster /    │ ────────────────────────────► │  AsciiGrid   │
  │  text + set. │   decode → preprocess →       │  (document)  │
  └──────────────┘   effects → map → dither      └──────┬───────┘
                                                        │
                       layers / timeline / guides       │
                       composeDocument()                │
                                                        ▼
                                              ┌──────────────────┐
                                              │ editor paint pass│
                                              │ Canvas2D or Pixi │
                                              └──────────────────┘
```

Both paths are pure where it matters: everything under `src/core/**` has no DOM
dependency and runs in Node under `vitest` — see `tests/unit/renderImage.test.ts`,
`tests/unit/canvas.test.ts` and `tests/unit/fx.test.ts`.

## 1. The document model

`Document` (`src/core/types.ts`) owns layers, canvas settings, the effect
pipelines, timeline and theme. Each `Layer` holds an `AsciiGrid`:

```ts
interface AsciiGrid {
  width: number;
  height: number;
  chars: string[];      // width * height single-character strings
  fg: Int32Array | null; // 0xRRGGBB, -1 = unset
  bg: Int32Array | null;
}
```

`composeDocument()` flattens visible layers into the grid the editor paints.
Every layer is converted to a `Plane` (opacity 0..1 → alpha 0..255, per-layer
`blend` mode) and run through the **same `composite()` used by the Pixi/FX
engine** — one compositor for documents, live previews and effects. Space
cells are fully transparent, cells outside the canvas are clipped, and a
coloured cell composites against the document background when nothing below it
touched that cell — while cells no coloured plane touched keep the exporter's
"unset" (`-1`) default.
Edits go through `applyCommand()`, so every mutation is undoable and the grid
identity changes only when content actually changes — the renderer and the
cell-effect runtime both key off that identity.

## 2. Offscreen render (worker)

`renderImage()` / `renderText()` in `src/worker/client.ts` post a job to
`render.worker.ts`:

1. **Decode** — `data:` URL → RGBA raster (`image/raster.ts`), base64 + `createImageBitmap`.
2. **Preprocess** — resize, crop, orientation, `image/preprocess.ts`.
3. **Raster effects** — the ordered image-effect stack (`core/effects/pipeline.ts`):
   bloom, glitch, scanlines, curvature … applied at source resolution *before*
   downsampling (see `docs/PERFORMANCE.md` for why that matters).
4. **Map** — `renderImage.ts` samples luminance through a tone-mapping strategy
   (feature-aware strategies additionally receive per-cell contrast / edge /
   texture planes measured from the sampled raster) and picks a character
   from the active character set, optionally re-ordered by each glyph's
   calibrated ink (`output.inkOrder: 'measured'`).
5. **Colour** — truecolor / ANSI-256 / ANSI-16 quantisation, palette binding.
6. **Dither** — one of 52 algorithms (`core/dither.ts`) when dithering is on.

The result is an `AsciiGrid` plus `{ stats: { durationMs, cells } }`.

### Generation guard

Every job carries the generation it was issued under. `bumpGeneration()`
invalidates in-flight jobs and **rejects them with `StaleRenderError`** — a
superseded render must never leave an `await` hanging (that was a real leak:
the promise kept a `Map` entry forever and `finally` never ran). The App side
additionally checks the generation before applying a result and before clearing
`pendingRender`, and debounces dispatch by 60 ms so slider drags coalesce.

## 3. The layered engine (`src/core/canvas/`)

The screen side has a structure-of-arrays model built for animation:

| Module | Responsibility |
| --- | --- |
| `glyphTable.ts` | Interns glyph strings; index `0` is always `' '`. A 200×100 frame is 20k indices, not 20k strings. |
| `cell.ts` | Packed `0xRRGGBB`, `NO_CELL`, `Attr`, blend modes, luminance. |
| `plane.ts` | SoA grid with dirty-marking writes (`setCell`/`setGlyph`/`fillRect`), `resize`, `clear`. |
| `dirty.ts` | `DirtyRegions` — flat `Int32Array` of run rectangles, mergeable, with a collapse budget. |
| `compose.ts` | `FrameBuffer` + `composite(planes, target, scratch?, backdrop?)` — z-ordered, per-plane opacity/blend, standard alpha (0 = transparent). `backdrop` is the base colour for cells nothing has painted yet (the document background); glyphs flip over at `GLYPH_COVERAGE_ALPHA` (half coverage) — a faint glyph over an empty frame still shows. |
| `diff.ts` | `diffFrames(prev, next, bounds)` → `none \| diff \| full` plus changed-cell ratio. |

The compositor resets the target once, then paints each plane in `z` order; the
previous frame is handed in as `scratch` so the caller learns how many cells
actually moved and can choose a diff repaint or a full repaint.

```ts
const stats = composite([background, text, fx], target, scratch);
const diff = diffFrames(prev, target, { boundsW, boundsH });
// diff.strategy: 'none' (idle) | 'diff' (rectangles) | 'full' (collapse)
```

`diffFrames` grows runs horizontally and extends a run into the next row when
the same rectangle continues, so a moving band costs one rectangle rather than
one rectangle per cell. If runs exceed 16 or the changed ratio crosses 55 % it
collapses to a single full-screen rectangle — cheaper than 500 tiny ones.

## 4. Editor paint path

`EditorCanvas.tsx` paints the composed grid to a 2D canvas each time its inputs
change (`composedGrid`, the cell-effect grid, zoom, grid overlay, theme,
onion-skin, CRT toggle, selection):

* the backing store is resized **only when the dimensions change**;
* grid lines are stroked in a **single path**;
* `fillStyle` is assigned per colour **run**, not per cell;
* the active selection is a dashed outline drawn **after** the effects so a
  tinted preview never hides it (rectangles stroke their bounds, regions
  stroke the mask contour); the same selection clips the brush and fill
  tools through `core/draw.ts` / `core/selection.ts`;
* subtexture and CRT bloom run last (the GPU viewport skips the CPU bloom
  because the Pixi shader already does it).

`gpuPreview` mounts `PixiViewport`, which re-uploads the same raster whenever
`data-raster-rev` changes — so both viewports share one paint pass.

## 5. Cell-effect stage

Glyph-level animation runs after composition, in `core/fx`:

```
composedGrid ──gridToPlane──► Plane ──setSource──► source snapshot
                                │
                       CellEffectPipeline.apply(dt)
                                │
                     planeToGrid (reused buffer)
                                ▼
                          painted frame
```

`CellFxRuntime` owns the plane and the output grid, recaptures the source only
when the document grid identity changes, rebinds masks when the canvas resizes,
and returns `null` once every one-shot effect has settled so the editor stops
repainting. Full detail in `docs/EFFECTS.md`.

## 6. Invariants

1. A grid handed to the store is never mutated in place by the renderer —
   strokes clone once at pointer-down, then mutate only that clone.
2. An effect only writes inside its mask.
3. Glyph index `0` is a space; `resolve()` falls back to a space for unknown
   indices, so a blank plane is always safe to paint.
4. Alpha is standard: `0` invisible, `255` opaque.
5. Stale worker results are dropped *and* settle their promise.

## 7. Glyph and colour engine review

Findings from a focused pass over `glyphTable.ts`, `compose.ts` and
`color.ts`, each with a regression test:

1. **Glyph interning overflow aliased unrelated glyphs.** Cells store
   `Uint16Array` indices into an append-only table (space is always `0`). When
   the table hit its 65,535-entry ceiling, `intern` returned *the last
   interned glyph*, so a new character silently rendered as some other
   character. It now resolves to space — a blank cell is honest, a wrong
   glyph is a bug — and `tests/unit/canvas.test.ts` fills the table to prove
   it (existing entries stay intact).
2. **`composite()` allocated a filtered + sorted copy every frame** while its
   header claimed "compositing never allocates". `needsOrdering()` now scans
   the input first: an already-ordered, fully visible plane list (the normal
   case — one or two layers) is walked in place, and only a list that really
   needs filtering or sorting pays for the temporary array. The equivalence
   test composites shuffled input (including a hidden plane) and compares
   every channel against the sorted path.
3. **xterm-256 mapping produced out-of-range cube indices.** The 6-level cube
   is indexed 0..5, but `Math.round((255 - 35) / 40)` is `6`, so any channel
   at exactly 255 indexed past the cube. Pure red (`0xff0000`) fell through to
   the grey-ramp comparison and exported as a **grey** ANSI code instead of
   `38;5;196`. The index is clamped to 5; primaries now land on their exact
   cube slots (`196`, `46`, `21`, `226`, `201`, `51`) and every sample resolves
   inside `ANSI256`. This affected the ANSI exporter and the 256-colour image
   mapping in `renderImage.ts`.

Colour science itself was left alone: luminance standards, `rgbToAnsi16`,
HSL round-trips and the sRGB-linear path all behaved as documented and are
covered by `tests/unit/color.test.ts`.

## 8. Tests


| Concern | Test |
| --- | --- |
| plane / dirty / compose / diff / virtual canvas | `tests/unit/canvas.test.ts` |
| image & text → grid | `tests/unit/renderImage.test.ts`, `text.test.ts` |
| bridge + live runtime | `tests/unit/fxRuntime.test.ts` |
| effect pipeline, masks, registry | `tests/unit/fx.test.ts` |
| worker generation guard | `tests/unit/worker.test.ts` |
