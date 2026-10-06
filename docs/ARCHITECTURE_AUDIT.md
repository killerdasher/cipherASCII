# Architecture Audit — cipherASCII

> Phase 1 deliverable. Written from a full read of the repository before any
> architectural change. Every claim below carries a `file:line` reference so it
> can be re-verified. Section 9 lists the measurement baseline; section 10 lists
> what was actually changed in response.

---

## 1. Current architecture

| Aspect | Finding |
| --- | --- |
| Language | TypeScript 5.9, `"type": "module"`, strict-ish (`tsconfig.json`) |
| Framework | React 19.3 + Vite 8 + Tailwind CSS 3.4, Electron 44 desktop shell |
| Renderer | Two paths: (a) 2D `<canvas>` painting in `src/components/EditorCanvas.tsx:184-286`, (b) optional PixiJS 8 / WebGL viewport with a CRT shader in `src/components/PixiViewport.tsx` |
| Main loop | **None.** There is no persistent frame loop for the editor. Painting is React-effect driven (`EditorCanvas.tsx:184`, deps at `:286`). The only `requestAnimationFrame` loop is timeline playback, `src/App.tsx:166-188` |
| Input loop | DOM pointer/keyboard events, `EditorCanvas.tsx:306-414`, global shortcuts `src/App.tsx:191-252` |
| Effect system | Raster-space, worker-side, sequential array order: `applyEffectsToRaster` `src/core/effects/pipeline.ts:251-264`, dispatched by two switches (`pipeline.ts:278-365`, `imageEffects.ts:827-892`) |
| Theme system | Plain data array `THEME_PRESETS` `src/core/theme/theme.ts:90-656`, applied by injecting a `<style id="theme-variables">` tag (`theme.ts:749-760`) |
| Configuration | Encoded in the Zustand store + `Document` (`src/store/index.ts:63-220`); persisted through `src/core/project/serialize.ts` |
| Storage | `.cipher` project files via Electron dialog (`electron/main.ts`) + browser download fallbacks (`src/core/export/*`) |
| Startup path | `src/main.tsx` → `App.tsx` → one `useEffect` render kick (`App.tsx:132-159`) → worker `renderImage` |
| Build | Vite (renderer) + `tsc -p electron/tsconfig.json` (main) + `electron-builder` (`package.json:96-125`) |
| Dependencies | Runtime: react, react-dom, zustand, framer-motion, pixi.js, @ffmpeg/\*. Everything else is dev-only. No animation/easing/tween library is present |
| Threading | One module worker (`src/worker/render.worker.ts`) with a generation-based cancellation protocol (`src/worker/client.ts:67-70`) |
| State | Single `zustand` store, `subscribeWithSelector`, ~40 selector helpers (`store/index.ts:802-838`) |

### Data flow (today)

```
UI event
  → store action (mutates document, pushes history)
  → triggerRender()            store/index.ts:548
  → App effect                 App.tsx:132
  → worker postMessage         client.ts:95
  → [decode → effects → renderImageToGrid]   render.worker.ts:60-91
  → postMessage(result)
  → store.setDocument()
  → React re-render → EditorCanvas paint     EditorCanvas.tsx:184
```

---

## 2. Current problems

### High impact

1. **Stale responses leak and strand promises.** `client.ts:37` returns on a
   generation mismatch *without* `pending.delete()`, and `bumpGeneration()`
   (`client.ts:67-70`) never rejects in-flight jobs. Every superseded render
   leaves a permanent `Map` entry and an `await` in `App.tsx:143/147` that never
   settles, so `finally { setPendingRender(false) }` (`App.tsx:154-156`) never
   runs for it. This is a genuine leak that grows with slider use.

2. **Full image re-decode on every render.** `App.tsx:143` posts
   `activeLayer.source.dataUrl` each time → `client.ts:95` structured-clones a
   multi-MB string → `raster-decode.ts:38-44` base64 + `createImageBitmap` +
   `OffscreenCanvas.getImageData`. No decoded-raster cache exists.

3. **No debounce/throttle anywhere** (`grep -r debounce src/` → 0 hits). Every
   `input` event on a slider (`Slider.tsx:64`, `AsciiControlsPanel.tsx:66`,
   `EffectsPanel.tsx:77`) triggers a history push *and* a full worker render.

4. **Effects run at source resolution, before downscale.**
   `render.worker.ts:72` applies the stack to the original raster; only after
   that does `renderImageToGrid` crop/resize (`renderImage.ts:251-252`). A
   4000×3000 photo is blurred/bloomed at full res to produce 100 columns.

5. **Whole-app re-render per store write.** One shallow selector in
   `App.tsx:89-129` subscribes to `document`, `layers`, `theme`, `tool`… and
   `React.memo` appears **nowhere** in `src/` (verified by grep), so no child
   can opt out.

6. **Brush strokes clone the whole grid per touched cell.**
   `EditorCanvas.tsx:67` → `paintCell` → `cloneGrid` (`grid.ts:50-58`:
   `chars.slice()` + `Int32Array.from(fg)` + `Int32Array.from(bg)`). A brush of
   radius N costs N² full-grid clones *per interpolated step* —
   O(cells × gridSize) allocation churn per `pointermove`.

### Medium impact

7. **Canvas repaint is allocation-heavy.** `canvas.width/height` reassigned
   every paint (forces backing-store reset) `EditorCanvas.tsx:210-211`; grid
   lines stroked one path at a time `:224-235`; a `#rrggbb` string built per
   non-space cell with no colour batching `:238-248`; a full-canvas
   `getImageData`/`putImageData` round-trip for subtexture `:266-268`; a full
   self-blur for CRT glow `:275-282`.

8. **Effect pipeline over-allocates.** `pipeline.ts:256` copies the raster up
   front, then `applySingleEffect` copies *again* per effect (`:272`) → N+1 full
   RGBA copies per render; further full-frame temporaries at
   `imageEffects.ts:130,213,224,377,408,463,549,579,614,672,752`.

9. **Per-render allocations in the core pipeline** — fine in a worker, but there
   is no reusable scratch space for repeated frames: `renderImage.ts:340,126,
   262,130,279,292,362,397,417,482`.

10. **`JSON.stringify` comparison** on undo/redo, `store/index.ts:264-266`.

11. **No transfer list** on worker results — the whole `AsciiGrid` is
    structured-cloned (`render.worker.ts:20`, inbound `client.ts:95`).

12. **Wasted progress traffic** — the worker posts `progress` for every render
    (`render.worker.ts:60-91`) but `App.tsx:143` never passes `onProgress`.

### Hygiene

13. `App.tsx:424` allocates a fresh `{x:0,y:0}` literal per render.
14. `EffectsPanel.tsx:14-37` rebuilds `effectsByCategory` on every render.
15. **Duplicated types**: `EffectId`/`EffectMeta`/`EffectSettings`/
    `EffectsPipeline` exist in both `types.ts:650-689` and `pipeline.ts:12-47`;
    `Theme`/`ThemeColors` in both `types.ts:774-840` and `theme.ts:8-88`.
    `pipeline.ts:1` is `@ts-nocheck`.
16. `ProceduralRenderRequest` is in the request union (`types.ts:599-604`) but
    the worker has no `kind:'procedural'` branch — it would silently fall
    through (`render.worker.ts:39,59,79`).

---

## 3. Current visual limitations

| Limitation | Evidence |
| --- | --- |
| Primitive transitions | Panel swaps are a single framer-motion cross-fade (`App.tsx:344-353`, `panelMotion` at `store/index.ts:45-50`) |
| No easing library | Zero easing functions in the repo; framer-motion defaults are the only easing in the product |
| No composition of cell-level effects | The 20 effects operate on **raster pixels**, not on the character grid, so nothing can animate *glyphs* |
| No layers in the visual sense | `Layer` (`types.ts`) is a document layer; the renderer paints a single flat grid — no background/particle/UI separation |
| No depth | One z-plane, no opacity/intensity per cell |
| No motion hierarchy | Nothing moves except timeline keyframes |
| No scene management | Startup is instantaneous; there is no intro/reveal/transition concept |
| No particle system | Not present anywhere |
| Theme personality is colour-only | `Theme` has no glyph set, animation speed, particle density, glitch intensity or default effects (`theme.ts:53-88`) |
| Weak visual feedback | `statusMessage` is plain text (`StatusBar.tsx`); no pulse/shimmer/entrance |
| No command palette | Keyboard shortcuts are a hard-coded `switch` (`App.tsx:191-252`); `ARCHITECTURE.md` names a `CommandPalette` that does not exist |
| No debug metrics | No FPS/frame-time instrumentation exists |

---

## 4. Guiding constraint

This is an **Electron + React + Canvas** application, not a TUI. Ratatui,
Crossterm, TachyonFX and terminal escape-sequence rendering are therefore **not
applicable** and were not adopted. Their engineering principles — cell buffers,
composable effects, deterministic effects, dirty-region output, frame-time
budgets, path/easing/scene processing — were translated into the canvas/domain
equivalents, which sections 5–10 of the implementation record.

## 5. Dependency policy applied

No runtime dependency was added for any of this. Easing, tweening, motion
paths, scenes, particles, gradients, dirty-region tracking, frame diffing and
adaptive quality are all implemented in `src/core/**` as pure TypeScript, which
keeps them unit-testable in plain Node exactly like the rest of the core.
