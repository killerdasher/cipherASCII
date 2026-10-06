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

### image → ASCII (columns = 160, best of 5)

| source | ms | grid | cells/s |
| --- | --- | --- | --- |
| 256×256 | 3.53 | 160×80 | 3,624,995 |
| 512×512 | 5.76 | 160×80 | 2,221,912 |
| 1024×1024 | 13.03 | 160×80 | 982,494 |

### text → ASCII (font = block)

| input | ms | grid | cells/s |
| --- | --- | --- | --- |
| 50 chars | 0.37 | 227×15 | 9,150,274 |
| 5000 chars | 24.91 | 227×1183 | 10,780,966 |

### dither (256×256 → 8 levels, best of 20, 52 algorithms)

| algorithm | ms | px/s |
| --- | --- | --- |
| none | 2.526 | 25,945,203 |
| threshold | 2.544 | 25,760,490 |
| bayer2 | 3.600 | 18,205,390 |

Full table: run `npm run bench` (the suite takes ~8.5 s; error-diffusion
kernels are the slow end, ordered/threshold the fast end).

## 3. Measured: the new engines (`npm run bench:engines`)

### Cell effects — ms per frame (best of 20)

| grid | effect | ms | cells/s |
| --- | --- | --- | --- |
| 100×50 | decrypt | 1.082 | 4,620,683 |
| 100×50 | rain | 0.622 | 8,037,435 |
| 100×50 | scatter | 1.128 | 4,431,324 |
| 100×50 | cipherlock | 0.798 | 6,264,895 |
| 200×100 | decrypt | 4.030 | 4,963,023 |
| 200×100 | rain | 2.247 | 8,900,717 |
| 200×100 | scatter | 4.309 | 4,641,239 |
| 200×100 | cipherlock | 3.046 | 6,566,641 |

At 16.6 ms of frame budget, a 200×100 grid spends **3–4 ms** on the heaviest
effect measured — about 20 % of the budget, leaving the paint pass and the
compositor the rest.

### Whole live runtime (bridge + effect + readback)

| grid | effect | ms/frame |
| --- | --- | --- |
| 100×50 | rain | 0.627 |
| 100×50 | cipherlock | 0.817 |
| 200×100 | rain | 2.351 |
| 200×100 | cipherlock | 3.082 |

### Bridge throughput (best of 50)

| grid | →plane ms | cells/s | →grid ms | cells/s |
| --- | --- | --- | --- | --- |
| 100×50 | 0.210 | 23,775,559 | 0.018 | 270,431,067 |
| 200×100 | 0.836 | 23,928,826 | 0.076 | 262,850,083 |

Readback is ~10× cheaper than the write because it reuses a buffer instead of
allocating one — that reuse is what makes the editor's effect loop
allocation-free after the first frame.

### Brush stroke: clone-per-cell vs clone-once (64 touched cells)

| grid | clone/cell (old) | clone/once (now) | speedup | cells touched |
| --- | --- | --- | --- | --- |
| 100×50 | 0.429 ms | 0.018 ms | **24.0×** | 320,000 |
| 200×100 | 4.139 ms | 0.073 ms | **56.8×** | 1,280,000 |

The old path cloned the whole grid once per touched cell per interpolated step
(`chars.slice()` + two `Int32Array.from`). The stroke now clones **once** at
pointer-down and mutates that clone; the undo command still receives a fresh
grid, so history semantics are unchanged.

### Compositor + dirty diff (best of 50)

| grid | composite ms | diff (clean) ms | clean changed cells | dirty strategy |
| --- | --- | --- | --- | --- |
| 100×50 | 0.774 | 0.082 | 0 | `diff` |
| 200×100 | 3.418 | 0.222 | 0 | `diff` |

An unchanged frame diffs to `changed = 0` in well under a millisecond, which
is the condition that lets an idle editor skip the repaint entirely; a
contiguous recoloured band (what an animated band looks like) stays in the
`diff` strategy rather than collapsing to a full-screen redraw.

### Tween update (best of 50)

| tweens | ms | tweens/s |
| --- | --- | --- |
| 1,000 | 0.030 | 33,750,717 |
| 10,000 | 0.132 | 75,983,223 |

Ten thousand simultaneous tweens cost 0.13 ms — the animation core is not a
constraint at any realistic scene size.

## 4. Changes made and verified

| Change | Effect | Evidence |
| --- | --- | --- |
| Worker generation guard (`StaleRenderError`) | Superseded renders settle instead of leaking `Map` entries and hanging `await`s | `tests/unit/worker.test.ts` (4 cases) |
| Result + `pendingRender` generation checks in `App.tsx` | A stale render can no longer clobber a newer grid or clear the pending flag | same |
| 60 ms render debounce | Slider bursts coalesce into one worker render | code + status path; manual verification |
| Clone-once brush stroke | 24–57× faster per 64-cell stroke | `npm run bench:engines` |
| Cached `fillStyle`, single-path grid lines, resize-only backing store | Fewer canvas state resets and string parses per paint | code (DOM paint not measurable in Node) |
| `React.memo` on 11 panels + hoisted cursor literal | Panels skip re-renders caused by unrelated App state | code |
| Interned glyphs, packed colours, SoA planes | Frame storage in indices, not strings | `docs/RENDERING.md` |
| Pooled `ParticleSystem`, reusable frame buffers, shared `GlyphTable` | Zero per-frame allocation in the hot paths | `tests/unit/fx.test.ts`, `fxRuntime.test.ts` |
| Effect slot settling | A finished one-shot is never visited again | `needsFrames` → `null` frame → rAF loop cancels |

## 5. Idle cost

An editor with no cell effects does **no** animation work: the rAF loop is not
running, and `cellFxRuntime.frame()` is never called. With effects active, the
loop stops itself the moment every one-shot settles (`frame()` returns `null`
and `needsFrames` becomes false) — asserted in `tests/unit/fxRuntime.test.ts`
("animates a one-shot effect and then goes idle").

## 6. Known costs / still open

These are real and documented rather than papered over (they come from
`docs/ARCHITECTURE_AUDIT.md`). Three of the five are now closed:

1. **Raster effects run at source resolution by default** (`render.worker.ts`)
   before the downscale to columns — a 4000×3000 photo is blurred at full res
   to produce ~100 columns. `npm run bench:engines` quantifies it: the
   six-effect stack runs at a flat **1.4–1.5 Mpx/s** regardless of size (512²
   ≈ 168 ms, 1024² ≈ 607 ms, 2048² ≈ 2781 ms), so a 12 Mpx photo costs
   **~8 s** per render. `blur` (43 ms) and `bloom` (57 ms) dominate at 512²;
   the rest are single-digit to ~17 ms.

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
   path, skipped only for very large canvases.
4. ~~**Bundle size**~~ — closed. Rolldown `codeSplitting.groups` plus a lazy
   `PixiViewport`: the app chunk went **847 → 247 kB**, pixi ships as a
   511 kB async chunk loaded only when the viewport mounts, and the >500 kB
   build warning is gone.
5. ~~**`JSON.stringify` comparison** of render settings on undo/redo~~ —
   closed: `renderSettingsChanged` uses the structural `deepEqual` in
   `src/core/util.ts`.

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
