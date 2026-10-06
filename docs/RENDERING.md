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
   and picks a character from the active character set.
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
| `compose.ts` | `FrameBuffer` + `composite(planes, target, scratch)` — z-ordered, per-plane opacity/blend, standard alpha (0 = transparent). |
| `diff.ts` | `diffFrames(prev, next, bounds)` → `none \| diff \| full` plus changed-cell ratio. |
| `virtualCanvas.ts` | Double-buffered `VirtualCanvas`: pointer swap between two `FrameBuffer`s, `layer()`, `render()`, `lastDirtyRatio`. |

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
onion-skin, CRT toggle):

* the backing store is resized **only when the dimensions change**;
* grid lines are stroked in a **single path**;
* `fillStyle` is assigned per colour **run**, not per cell;
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

## 7. Tests

| Concern | Test |
| --- | --- |
| plane / dirty / compose / diff / virtual canvas | `tests/unit/canvas.test.ts` |
| image & text → grid | `tests/unit/renderImage.test.ts`, `text.test.ts` |
| bridge + live runtime | `tests/unit/fxRuntime.test.ts` |
| effect pipeline, masks, registry | `tests/unit/fx.test.ts` |
| worker generation guard | `tests/unit/worker.test.ts` |
