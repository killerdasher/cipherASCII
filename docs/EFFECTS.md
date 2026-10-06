# Effects

cipherASCII has two effect systems that run at different stages. They are not
interchangeable: one works on pixels *before* characters exist, the other works
on characters *after* they exist.

| | Raster effects | Cell effects |
| --- | --- | --- |
| Location | `src/core/effects/` | `src/core/fx/` |
| Input | RGBA raster | `AsciiGrid` / `Plane` |
| Runs | worker, before ASCII mapping | editor, after composition |
| Count | 20 | **45** |
| Persists as | `document.effectsPipeline` | `document.cellEffects` |

This document is about **cell effects** — the glyph animation engine.

## 1. The model

```ts
interface CellEffect<S> {
  id: string;            // registry key, stable, used in project files
  label: string;          // UI name
  category: 'signature' | 'core' | 'motion' | 'energy' | 'destruction' | 'atmosphere';
  description: string;    // one line, shown in tooltips
  params: EffectParamDef[];  // key, label, min, max, step, default, unit
  duration: number;        // ms; 0 = continuous
  ambient?: boolean;       // loops instead of settling at progress 1
  createState(): S;        // called once per entry, never per frame
  apply(ctx: EffectContext, state: S): void;
  reset?(state: S): void;
}
```

`defineEffect({...})` fills in `createState` when the effect has no per-entry
state.

### EffectContext

Everything an effect may read in one frame — no globals, no DOM:

| Field | Meaning |
| --- | --- |
| `plane`, `width`, `height` | target grid |
| `time`, `dt` | ms since this entry started / since last frame |
| `progress` | 0..1 for one-shots, looping 0..1 for ambient |
| `params`, `intensity` | resolved parameter values; `intensity` is the 0..1 UI multiplier |
| `mask` | `forEach`/`test` over the cells it is allowed to touch |
| `sourceGlyph/Fg/Bg` | the snapshot taken before any effect ran |
| `rng`, `salt` | seeded randomness; `salt` folds in `--seed` |
| `intern/resolve` | glyph string ⇄ index through the shared table |
| `set(index, glyphId, fg?, bg?, alpha?)` | write one cell (dirty-marked only on change) |
| `sourceChar(x,y)` | read the snapshot |
| `blankMasked()` | clear masked cells once — displacement effects call this first so cells do not leave ghosts |

## 2. Lifecycle

```
entries ──bind(CELL_EFFECT_MAP, plane)──► slots (state created, params resolved)
   │
setSource(plane)     ← called only when the *document* grid identity changes
   │
apply(plane, dt)     ← per frame while needsFrames
   │      progress = elapsed / duration
   │      final frame applies at progress = 1, then the slot settles
   ▼
settled ⇒ skipped entirely (no per-frame cost)
```

* **One-shot** effects run for `duration` ms and settle; after that
  `needsFrames` is false and the editor's rAF loop stops itself.
* **Ambient** effects (`ambient: true`) loop forever and keep the loop alive.
* `delay` on an entry defers its start; `enabled: false` skips it entirely.
* Stacking is compositional: entries apply in list order, each one reading the
  same source snapshot, so a mask-scoped `rain` under a full-canvas `pulse`
  composes the way the list reads.

## 3. Masks

Every effect may only write inside its mask (rule 1 of the system).

| `kind` | Parameters | Selects |
| --- | --- | --- |
| `all` | — | whole canvas (plus optional `glyphClass`, `hasForeground`, `hasBackground` predicates) |
| `rect` | `x, y, w, h` | rectangle, clipped to the canvas |
| `rows` | `rowStart, rowEnd` | inclusive row band (order-independent) |
| `columns` | `colStart, colEnd` | inclusive column band |
| `checker` | `cell` | alternating blocks |
| `band` | `thickness`, `origin: top\|bottom\|left\|right` | edge band in cells |

`buildMask(plane, spec)` compiles a plain spec or narrows it with colour/glyph
predicates; compiled masks are cached per `(size, spec)` in the pipeline, so a
stack of masked effects costs one compile, not one per frame.

## 4. Determinism

* The pipeline owns a seeded `Rng` (`seed` from `--seed`, default `0x5eed`).
* Per-cell hashes go through `cellSalt(ctx, x, y, K)` = `cellRand(x, y, K + ctx.salt)`.
  Two seeds therefore produce two different-but-reproducible patterns.
* `resetClocks()` rewinds every slot and reseeds — used when a scene replays.
* Pooled state (`ParticleSystem`) uses contiguous live ranges with swap-remove,
  so no allocation happens per frame and recycling order is stable.

## 5. The registry

45 effects, registered at module load in `src/core/fx/registry.ts`:

```ts
import { listCellEffects, getCellEffect, effectsByCategory, resolveParams } from 'core/fx';

for (const e of listCellEffects()) console.log(e.id, e.category, e.duration);
const params = resolveParams(getCellEffect('cipherlock')!, { scroll: 40 }); // clamped
```

### Signature (original to cipherASCII)

| id | label | ms | description |
| --- | --- | --- | --- |
| `cipherlock` | Cipherlock | 2200 | A scrolling hex field locks onto the artwork cell by cell, like a combination dial seating. |
| `hexfall` | Hexfall | 1900 | Columns of hex digits fall and resolve into the artwork as they reach their landing row. |
| `glyphwave` | Glyphwave | 1700 | A travelling wave churns the characters it touches through the density ramp, then lets them settle. |
| `signalburst` | Signalburst | 1500 | A radial shockwave throws the field outward; elastic easing snaps it back into place. |
| `keyshift` | Keyshift | 3400 | A diagonal key band re-encrypts the cells it crosses and leaves them decrypted behind. |

### Core

| id | label | ms | description |
| --- | --- | --- | --- |
| `decrypt` | Decrypt | 1400 | Cells cycle through cipher glyphs and lock onto the source as the reveal progresses. |
| `scramble` | Scramble | 1200 | A continuous field of mutating cipher glyphs over the masked cells. |
| `typewriter` | Typewriter | 1600 | Reveals cells in reading order with a cursor riding the wavefront. |
| `dissolve` | Dissolve | 1200 | Cells fade and blank out in a stable scattered order. |
| `assemble` | Assemble | 1300 | Cells materialise from nothing in a stable scattered order. |
| `disassemble` | Disassemble | 1300 | Cells vanish in a scattered order, flashing as each one departs. |
| `fade` | Fade | 800 | Opacity ramp over the masked cells — the quietest transition in the library. |
| `reveal` | Reveal | 1000 | A soft edge sweeps across, leaving the source revealed behind it. |
| `wipe` | Wipe | 1000 | A moving edge erases cells behind it, leaving clean space. |
| `sweep` | Sweep | 1400 | A highlight band crosses the canvas and leaves the source untouched behind it. |

### Motion

| id | label | ms | description |
| --- | --- | --- | --- |
| `orbit` | Orbit | 4000 | Cells circle their home positions with a phase that sweeps across the canvas. |
| `spiral` | Spiral | 5000 | Cells swirl around the centre, pulled inward and released on a loop. |
| `swarm` | Swarm | 6000 | Cells wander on independent deterministic noise — a stirred field. |
| `attract` | Attract | 3200 | Cells are drawn toward the centre and released, breathing the shape inward. |
| `repel` | Repel | 3200 | Cells are pushed away from the centre and drawn back on a loop. |
| `gravity` | Gravity | 1800 | Rows sag downward in sequence under gravity and recover — a drop-and-settle. |
| `magnetic` | Magnetic | 1600 | Cells are pulled onto a coarse lattice and released — a snap-and-return. |
| `wave` | Wave | 3000 | A sinusoidal shear travels across the canvas, lifting and dropping rows. |
| `ripple` | Ripple | 3600 | Concentric rings radiate from the centre, displacing cells as they pass. |

### Energy

| id | label | ms | description |
| --- | --- | --- | --- |
| `beam` | Beam | 1500 | A bright bar travels across the canvas, flaring the cells it crosses. |
| `scan` | Scan | 2400 | A scanline sweeps down the canvas, leaving a decaying glow behind it. |
| `pulse` | Pulse | 2000 | Brightness breathes across the masked area on a smooth sine. |
| `spark` | Spark | 900 | Isolated cells flash on and off in a deterministic rotating duty cycle. |
| `lightning` | Lightning | 1100 | A jagged bolt traces a path across the canvas, branching as it goes. |
| `plasma` | Plasma | 4000 | Overlapping sine fields modulate brightness — a classic demo-scene plasma. |
| `radar` | Radar | 3600 | A rotating sweep lights the sector it has just crossed and lets it fade behind. |

### Destruction

| id | label | ms | description |
| --- | --- | --- | --- |
| `crumble` | Crumble | 1700 | Cells detach and fall in a scattered order, settling back as the effect completes. |
| `burn` | Burn | 1600 | A fire front crosses the canvas: cells flare at the edge and turn to ash behind it. |
| `glitch` | Glitch | 900 | Horizontal bands shift sideways and corrupt their glyphs for the duration of the tear. |
| `fracture` | Fracture | 1500 | The canvas splits into blocks that shear apart along random vectors, then snap back. |
| `corrupt` | Corrupt | 1400 | Random cells flip to corrupted glyphs with inverted colours as the damage propagates. |
| `collapse` | Collapse | 1500 | The field crushes toward its centre and rebounds — a controlled implosion. |
| `scatter` | Scatter | 1500 | Cells burst outward in random directions and reassemble as the effect completes. |

### Atmosphere

| id | label | ms | description |
| --- | --- | --- | --- |
| `rain` | Rain | 3000 | Per-column falling streams with a bright head and a decaying tail. |
| `dust` | Dust | 5000 | Sparse specks drift and shimmer over the content. |
| `smoke` | Smoke | 4200 | Soft columns rise and thin as they climb, dimming the content beneath. |
| `stars` | Stars | 2600 | Fixed points twinkle with independent phases over the content. |
| `embers` | Embers | 3800 | Bright motes rise from the bottom edge, flicker and burn out. |
| `particles` | Particles | 6000 | A pooled particle field: spawn, drift, expire and recycle — no per-frame allocation. |
| `noise` | Noise | 2000 | Per-cell brightness grain that re-rolls on a fixed cadence. |

## 6. Runtime integration

```
store.cellEffects (serialisable entries)  +  store.fxSeed
        │  sync(entries, seed)  — identity compared, no work if unchanged
        ▼
cellFxRuntime (module singleton, not in the store)
        │  gridToPlane → setSource → setEntries/bind → apply(dt) → planeToGrid
        ▼
EditorCanvas rAF loop  →  repaint  →  stops when every one-shot settles
```

Editing a stack from the UI (`EffectsPanel` → *Cell Effects*):

* add from the category-grouped library (defaults resolved from the registry),
* toggle / reorder / remove (list order = paint order),
* per-parameter sliders (min/max/step/unit come from the registry),
* intensity slider (multiplier on top of parameters),
* seed field + randomise (persisted, reproducible).

Entries persist in the project file: `canonicalCellEffects()` in
`core/project/serialize.ts` validates ids, clamps intensity, drops non-numeric
parameters and rejects unknown mask kinds — a hand-edited project can never
feed a malformed mask into the render loop. Unknown effect ids are kept and
simply stay unbound.


### Effect space

`ImageRenderSettings.effectSpace` decides *where* the stack runs (see
`src/worker/render.worker.ts`):

| value | stage | cost |
| --- | --- | --- |
| `'source'` (default) | full-resolution image, before the downscale | proportional to source pixels (~8 s for a 12 Mpx photo) |
| `'grid'` | after `resizeRaster`, before `applyPreprocess` | proportional to grid samples (~10⁴ pixels at 100 columns) |

The grid path is assembled from `prepareSampledRaster` + `rasterToGrid` in
`src/core/renderImage.ts`; `renderImageToGrid` is the two composed and stays
byte-identical to them. Behaviour and coverage: `tests/unit/effectSpace.test.ts`.

## 7. Adding an effect

```ts
// src/core/fx/library/motion.ts
export const drift = defineEffect<{ phase: number }>({
  id: 'drift',
  label: 'Drift',
  category: 'motion',
  description: 'The field floats sideways on a slow sine.',
  duration: 4000,
  params: [
    { key: 'amp', label: 'Amplitude', min: 0, max: 20, step: 1, default: 6, unit: 'cells' },
    { key: 'cycles', label: 'Cycles', min: 1, max: 6, step: 1, default: 2 },
  ],
  apply(ctx, state) {
    if (state.phase === 0) state.phase = ctx.rng.next();   // seeded, stable
    const dx = Math.sin((ctx.progress + state.phase) * Math.PI * 2 * ctx.params.cycles) * ctx.params.amp;
    ctx.blankMasked();
    ctx.mask.forEach((_x, _y, index) => moveCell(ctx, index, dx, 0));
  },
});
```

Add it to the `MOTION_EFFECTS` array in the same file — `registry.ts` collects
the arrays, and the effect appears in the UI, the docs table and the tests
automatically (the test suite iterates *every* registered effect).

Checklist: allocation-free `apply`, writes only inside `ctx.mask`, reads source
content from `ctx.source*`, seeds randomness through `ctx.rng`/`cellSalt`, and
returns to the source on a one-shot so the final frame equals the document.
## 8. Tests

`tests/unit/fx.test.ts` (registry integrity, masks, pipeline lifecycle,
determinism, mask isolation, every effect applies without throwing) and
`tests/unit/fxRuntime.test.ts` (bridge round-trip, source recapture, resize
rebinding, idle stop). `scripts/engines.bench.ts` measures per-effect frame
cost — see `docs/PERFORMANCE.md`.

The raster primitives carry equivalence tests (`tests/unit/blur.test.ts`):
`gaussianRGBA` — shared by blur, bloom, sharpen, motionBlur and epsilonGlow —
is pinned to a naive per-channel reference, and `boxBlurCopy` (diffraction
stars, epsilon glow) to a naive sliding-window reference. Writing those
references is what surfaced two addressing bugs that are now fixed: the
gaussian vertical pass wrote to `y * 4 + x * w * 4` (a transpose, so blur
scrambled the frame), and `boxPass`'s destination step was swapped relative to
its source step. Both effects now match the naive references exactly at every
tested size and radius.
