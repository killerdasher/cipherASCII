# Performance

Every number on this page was produced by a command in this repository on the
machine that wrote the doc. Nothing here is an estimate, and nothing here
claims a comparison that was not measured.

## 1. Running the measurements

```bash
npm run bench           # core throughput: image/text → ASCII, 52 dither algorithms
npm run bench:engines   # the animation/layered-rendering/effect engines
npm run simulations     # procedural/pipeline simulations
npm test                # 707 tests / 34 files, ~6 s
npm run lint && npm run typecheck
```

Both bench suites run through vitest (`vitest.scripts.config.ts`) so they
import `src/**` with exactly the resolution the app uses. Each case reports the
**best of N** runs.

`scripts/engines.bench.ts` also contains *reference* implementations of the old
behaviour (a grid clone per touched cell) — the point of those rows is the
ratio, not the absolute time.

## 2. Measured: core pipeline (`npm run bench`)

_Refreshed for the V2 close-out (Phase 12); best-of-N methodology unchanged._

### image → ASCII (columns = 160, best of 5)

| source | ms | grid | cells/s |
| --- | --- | --- | --- |
| 256×256 | 3.10 | 160×80 | 4,131,753 |
| 512×512 | 5.29 | 160×80 | 2,421,702 |
| 1024×1024 | 12.30 | 160×80 | 1,040,472 |

### text → ASCII (font = block)

| input | ms | grid | cells/s |
| --- | --- | --- | --- |
| 50 chars | 0.35 | 227×15 | 9,765,905 |
| 5000 chars | 23.90 | 227×1183 | 11,236,729 |

### dither (256×256 → 8 levels, best of 20, 52 algorithms)

| algorithm | ms | px/s |
| --- | --- | --- |
| none | 2.572 | 25,484,533 |
| threshold | 2.612 | 25,092,648 |
| bayer2 | 3.739 | 17,528,033 |

Full table: run `npm run bench` (the suite takes ~8.5 s; error-diffusion
kernels are the slow end, ordered/threshold the fast end).

## 3. Measured: the new engines (`npm run bench:engines`)

_Refreshed for the V2 close-out (Phase 12); best-of-N methodology unchanged._

### Cell effects — ms per frame (best of 20)

| grid | effect | ms | cells/s |
| --- | --- | --- | --- |
| 100×50 | decrypt | 1.237 | 4,042,717 |
| 100×50 | rain | 0.695 | 7,192,216 |
| 100×50 | scatter | 1.282 | 3,901,501 |
| 100×50 | cipherlock | 0.908 | 5,505,504 |
| 200×100 | decrypt | 4.319 | 4,630,434 |
| 200×100 | rain | 2.565 | 7,796,602 |
| 200×100 | scatter | 4.716 | 4,240,542 |
| 200×100 | cipherlock | 3.478 | 5,750,360 |

At 16.6 ms of frame budget, a 200×100 grid spends **3–5 ms** on the heaviest
effect measured — about 20 % of the budget, leaving the paint pass and the
compositor the rest.

### Whole live runtime (bridge + effect + readback)

| grid | effect | ms/frame |
| --- | --- | --- |
| 100×50 | rain | 0.691 |
| 100×50 | cipherlock | 0.885 |
| 200×100 | rain | 2.661 |
| 200×100 | cipherlock | 3.494 |

### Bridge throughput (best of 50)

| grid | →plane ms | cells/s | →grid ms | cells/s |
| --- | --- | --- | --- | --- |
| 100×50 | 0.247 | 20,278,053 | 0.020 | 245,134,088 |
| 200×100 | 0.992 | 20,164,136 | 0.083 | 240,717,338 |

Readback is ~12× cheaper than the write because it reuses a buffer instead of
allocating one — that reuse is what makes the editor's effect loop
allocation-free after the first frame.

### Brush stroke: clone-per-cell vs clone-once (64 touched cells)

| grid | clone/cell (old) | clone/once (now) | speedup | cells touched |
| --- | --- | --- | --- | --- |
| 100×50 | 0.334 ms | 0.011 ms | **30.4×** | 320,000 |
| 200×100 | 6.019 ms | 0.074 ms | **81.7×** | 1,280,000 |

The old path cloned the whole grid once per touched cell per interpolated step
(`chars.slice()` + two `Int32Array.from`). The stroke now clones **once** at
pointer-down and mutates that clone; the undo command still receives a fresh
grid, so history semantics are unchanged.

### Compositor + dirty diff (best of 50)

| grid | composite ms | diff (clean) ms | clean changed cells | dirty strategy |
| --- | --- | --- | --- | --- |
| 100×50 | 1.121 | 0.061 | 0 | `diff` |
| 200×100 | 4.289 | 0.289 | 0 | `diff` |

An unchanged frame diffs to `changed = 0` in well under a millisecond, which
is the condition that lets an idle editor skip the repaint entirely; a
contiguous recoloured band (what an animated band looks like) stays in the
`diff` strategy rather than collapsing to a full-screen redraw.

### Tween update (best of 50)

| tweens | ms | tweens/s |
| --- | --- | --- |
| 1,000 | 0.030 | 32,846,116 |
| 10,000 | 0.183 | 54,535,737 |

Ten thousand simultaneous tweens cost 0.18 ms — the animation core is not a
constraint at any realistic scene size.

## 4. Changes made and verified

| Change | Effect | Evidence |
| --- | --- | --- |
| Worker generation guard (`StaleRenderError`) | Superseded renders settle instead of leaking `Map` entries and hanging `await`s | `tests/unit/worker.test.ts` (4 cases) |
| Worker pool (lazy spawn, up to 4 slots) for render/analysis/creative | Image analysis and creative-layer graph evaluation (measured 18.5 ms at 480×200) run off-thread; analysis single-flights and survives generation bumps; creative replies are epoch-guarded so out-of-order results never land | `worker.test.ts` pool describe (6), `store.test.ts` pool (2), `imageImport.test.ts` (2), `imageAnalysis.test.ts` (3) |
| Result + `pendingRender` generation checks in `App.tsx` | A stale render can no longer clobber a newer grid or clear the pending flag | same |
| 60 ms render debounce | Slider bursts coalesce into one worker render | code + status path; manual verification |
| Clone-once brush stroke | 30–82× faster per 64-cell stroke | `npm run bench:engines` |
| Cached `fillStyle`, single-path grid lines, resize-only backing store | Fewer canvas state resets and string parses per paint | code (DOM paint not measurable in Node) |
| `React.memo` on 12 panels + hoisted cursor literal; narrow store selectors (Phase 11) | Panels skip re-renders caused by unrelated App state; the five former whole-state subscriptions no longer wake on status/perf/view writes | `tests/unit/panelStoreSubscriptions.test.tsx` (4 cases) |
| Interned glyphs, packed colours, SoA planes | Frame storage in indices, not strings | `docs/RENDERING.md` |
| Pooled `ParticleSystem`, reusable frame buffers, shared `GlyphTable` | Zero per-frame allocation in the hot paths | `tests/unit/fx.test.ts`, `fxRuntime.test.ts` |
| Effect slot settling | A finished one-shot is never visited again | `needsFrames` → `null` frame → rAF loop cancels |
| Worker raster decode cache (P1) | A source image is `atob` + bitmap-decoded **once per worker** instead of once per render; callers receive a private copy so downstream effects can never poison the cache | `tests/unit/decodeCache.test.ts` (6 cases), `src/worker/raster-decode.ts` |
| Memoised recommendation analysis (P2) | Sample + dither/ladder scoring keyed on (dataUrl, columns) - repeated runs on the same image are cache hits (2 entries, concurrent runs deduped) | `tests/unit/analysisJob.test.ts` (6 cases) |
| Narrow panel subscriptions (P5) | StatusBar / LayerPanel / ExportPanel / SettingsPanel / PropertyPanel take narrow selectors instead of whole-state snapshots; document and prop changes still land | `tests/unit/panelStoreSubscriptions.test.tsx` (4 cases) |
| One canvas per video export (P4) | Frame rasterisation reuses a single backing store instead of allocating a canvas per frame (PNG encode per frame remains - see section 6 item 6) | `src/services/videoExport.ts` (DOM not measurable in Node) |
| Allocation-free brush cells (P6) | First-code-point extraction without array spread + a shared default clip per stamped cell | `tests/unit/draw.test.ts` |

## 5. Idle cost

An editor with no cell effects does **no** animation work: the rAF loop is not
running, and `cellFxRuntime.frame()` is never called. With effects active, the
loop stops itself the moment every one-shot settles (`frame()` returns `null`
and `needsFrames` becomes false) — asserted in `tests/unit/fxRuntime.test.ts`
("animates a one-shot effect and then goes idle").

## 6. Known costs / still open

These are real and documented rather than papered over (they come from
`docs/ARCHITECTURE_AUDIT.md`). Three of the six are now closed:

1. **Raster effects run at source resolution by default** (`render.worker.ts`)
   before the downscale to columns — a 4000×3000 photo is blurred at full res
   to produce ~100 columns. `npm run bench:engines` quantifies it: the
   six-effect stack runs at a flat **1.9–2.3 Mpx/s** regardless of size (512²
   ≈ 116 ms, 1024² ≈ 460 ms, 2048² ≈ 2217 ms), so a 12 Mpx photo costs
   **~6 s** per render. `bloom` (44 ms) and `blur` (40 ms) dominate at 512²;
   the rest are single-digit to ~15 ms.

   **Escape hatch (Settings → Image Settings → Effects):** `effectSpace:
   'grid'` runs the same stack between resize and preprocessing, on the
   downscaled raster the rest of the pipeline already works on. That takes the
   effect cost from source pixels to grid pixels (a 100-column render samples
   ~10⁴ pixels instead of 10⁷) and lets high-frequency effects (scanlines,
   grain) land on cell boundaries instead of being averaged away by the
   downscale. Spatial effects read stronger at grid scale because their radii
   are now measured in cells, not source pixels — so `'source'` stays the
   default and presets keep their current look. Both paths are covered in
   `tests/unit/effectSpace.test.ts`.
2. ~~**N+1 RGBA copies in the raster effect pipeline**~~ — closed. The stack
   now ping-pongs between two pre-allocated frames (`applyEffectsToRaster`),
   so N effects cost two allocations instead of N+1 while keeping the copy
   each effect needs as its input. The bench case fell **194.9 → 117.9 ms
   (−39%)** for the same six-effect 512² stack (the rest of the gain is the
   gaussian rewrite in `imageEffects.ts` — see `docs/EFFECTS.md` §8).
3. **Subtexture `getImageData`/`putImageData` round-trip** on the editor paint
   path, skipped only for very large canvases (>16 Mpx) and whenever the
   quality ladder drops `fullEffects`. The per-pixel mask maths that used to
   ride along with it - a function call plus `Math.cos`/`Math.hypot` for every
   pixel of every frame - is now memoised to one period
   (`maskTable` in `subtexture.ts`), which is bit-identical to the naive loop
   (`tests/unit/subtexture.test.ts`) but no longer does trig per pixel. What
   is left is the readback itself: the two canvas round-trips, unavoidable in
   a 2D context without moving the mask to a `multiply` composite.
4. ~~**Bundle size**~~ — closed. Rolldown `codeSplitting.groups` plus a lazy
   `PixiViewport`: the app chunk went **847 → 247 kB**, pixi ships as a
   511 kB async chunk loaded only when the viewport mounts, and the >500 kB
   build warning is gone.
5. ~~**`JSON.stringify` comparison** of render settings on undo/redo~~ —
   closed: `renderSettingsChanged` uses the structural `deepEqual` in
   `src/core/util.ts`.
6. **Video export PNG-encodes every frame on the main thread**
   (`src/services/videoExport.ts`): the perf pass reused one canvas for the
   whole timeline, but each frame still pays `drawGridToContext` + optional
   subtexture round-trip + `canvas.toBlob` + `writeFile`. No per-frame
   diffing or transferables; the loop reports `render` progress per frame so
   the cost stays visible in the export bar. Moving the encode off-thread
   needs an `OffscreenCanvas` worker job with font parity - deliberately out
   of scope for this pass.

## 7. Quality modes, adaptive control and the debug overlay

Not every machine holds 60 fps, and a fixed "performance mode" punishes fast
machines. `src/core/perf/` adds a budget ladder plus a controller that walks it:

| Tier | Target | Cell-effect updates | Particles | CRT / subtexture |
| --- | --- | --- | --- | --- |
| `high` | 16.7 ms (60 fps) | 60 Hz | 4,000 | on |
| `balanced` | 33.4 ms (30 fps) | 30 Hz | 2,000 | on |
| `low` | 50 ms | 20 Hz | 800 | off |
| `emergency` | 100 ms | 10 Hz | 200 | off |

- **Mode** is a user choice in *Settings → Performance* (or Ctrl+K →
  `Quality mode: …`): `auto`, `high`, `balanced`, `low`. Fixed modes pin a
  tier; `auto` follows the controller.
- **Controller** (`adaptive.ts`) keeps an EMA of frame time (α = 0.15) and
  steps **down** after 15 consecutive frames above `target × 1.35`, steps
  **up** only after 120 consecutive frames below `target × 0.7`, and waits a
  90-frame cooldown after any step — fast reaction down, slow proof up, no
  oscillation. Levels are clamped to 0..3.
- **What the budget actually gates**: the editor's effect loop caps how *often*
  effects update while still passing the accumulated dt, so an animation keeps
  its real duration and simply takes fewer, bigger steps when the machine is
  behind; and the two expensive display extras (CRT self-composite, subtexture
  `getImageData` round-trip) are skipped below `balanced`.
- **Debug overlay** (Ctrl+K → *Toggle debug overlay*, or Settings): FPS,
  smoothed frame time, active tier/level, effect Hz and count, last worker
  render (ms + cells), render generation and grid size — published at 2 Hz,
  never per animation frame.

Purity: `quality.ts`, `adaptive.ts` and `stats.ts` are DOM-free, so the ladder
and the controller are covered by `tests/unit/perf.test.ts` (step down,
cooldown, recovery, noise rejection, no mutation).

## 8. Reproducing


```bash
npm ci
npm test && npm run lint && npm run typecheck
npm run bench
npm run bench:engines
npm run demo
# rewrite visual-golden fixtures after an intentional change:
UPDATE_GOLDEN=1 npx vitest run tests/unit/golden.test.ts
```

Absolute numbers vary by machine; the ratios (clone-per-cell vs clone-once,
clean-diff vs full redraw, effect ms against a 16.6 ms budget) are the figures
that transfer.
