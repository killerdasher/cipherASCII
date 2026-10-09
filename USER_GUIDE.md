# cipherASCII - User Guide

How to drive the app, from a first image to an exported file. (cipherASCII was
formerly published as ASCII Art Studio; created by
[killerdasher](https://github.com/killerdasher).)

## 1. Starting the app

```powershell
npm install
npm run electron:dev    # desktop app, reloads on code changes
npm run electron:build  # builds release/cipherASCII Setup .exe
```

After `npm run electron:build` the unpacked executable is at
`release\win-unpacked\cipherASCII.exe`, and the installer registers a
desktop shortcut named **cipherASCII**.

`npm run dev` runs the same renderer in a browser tab if you prefer that.

## 2. Interface

```
+----------------------------------------------------------------------+
| Toolbar: New | Undo/Redo | Import | **Brush Eraser Fill Pick Pan** | Char Colour Size | CRT | Zoom | Terminal |
+----------------+------------------------------------+----------------+
| LEFT DOCK      |  CANVAS                            | RIGHT DOCK      |
| Layers         |  (the ASCII grid, live preview)    | Export          |
| Properties     |                                    | Effects         |
| ASCII          |  drop an image anywhere here       | Palette         |
| Timeline       |                                    | Presets         |
|                |                                    | Theme           |
|                |                                    | Settings        |
+----------------+------------------------------------+----------------+
| Status bar: dirty flag, render generation, zoom      |
+----------------------------------------------------------------------+
```

- The **left dock** and the **right dock** are switched independently, so you
  can watch Effects while the Timeline is open.
- Switching a dock tab plays a short fade/slide (skipped when the system asks
  for reduced motion); every numeric control is the same filled slider -
  drag it, or focus it and use the arrow keys / Home / End.
- **Space** toggles a full terminal preview at the bottom of the window.
- **Theme** changes every surface - panels, canvas background, terminal,
  scrollbars, buttons - not only the font.

### Left dock

| Tab | What it does |
| --- | --- |
| **Layers** | List of layers; show/hide, lock, duplicate, delete, add an 80x24 ASCII layer or a **Generative** layer |
| **Properties** | Name, visibility, lock, opacity, X/Y offset; for text layers the text itself; for generative layers the graph, mapping strategy, dither, invert, density and glyph offset |
| **ASCII** | The render controls: columns, render mode, character ramp (click a glyph to add it), custom ramp string, **Sort ramp dark → light** (heuristic ink coverage) and **Sort by measured ink** (rasterises each glyph on a canvas - best for injected CJK/emoji), offset, density, invert, dither algorithm + strength, brightness/contrast/gamma |
| **Timeline** | Animation: transport (play/stop with looping), time display, ruler with click-to-seek, tracks with keyframes (◆ adds a keyframe at the playhead, click a diamond to remove it), onion skin. Tracks and keyframes save with the project; **+ New Timeline** replaces the current one as a single undo step |

### Right dock

| Tab | What it does |
| --- | --- |
| **Export** | Pick a format (TXT, ASC, ANSI, JSON, HTML, SVG, AAP, PNG, MP4, GIF), preview the output, download it. MP4/GIF render the whole timeline with a progress bar |
| **Effects** | Ordered effect stack: add, remove, reorder, tune each parameter. 19 effects are available |
| **Palette** | Palettes list, create/import, edit colours, sort by luminance/hue/saturation, and **Auto Palette - 5 Colors** |
| **Presets** | Save the current render settings as a named preset and re-apply it later |
| **Theme** | 10 built-in themes (Medieval, Dither Boy, Terminal Green, Terminal Amber, Light, High Contrast, Gothic Medieval, Cyber Y2K, Cozy Cafe French, Zelda / RPG) plus a "Create Custom Theme" dialog |
| **Gen** | The generator node graph: pick a graph, add/remove nodes, wire inputs (drop-downs only offer nodes earlier in the dependency order, so cycles are impossible), tune parameters and choose which node becomes the field |
| **Settings** | **Canvas presets** (TikTok / Reels, square, wide banner, HD - snapped to the 8 x 16 cell grid), image settings (columns, mode, fit, dither, invert), text settings (font, style, scale), canvas size and the **subtexture mask** |

## 3. Typical workflows

### Image to ASCII

1. Drag a PNG/JPEG/WEBP/BMP/GIF onto the canvas (or use **Import** in the
   toolbar). The image becomes the source of the active layer and is rendered
   immediately, with the grid **auto-sized to the picture**: cells are 8px wide
   and 16px tall, so `columns = width / 8` and the rows follow from the
   terminal aspect ratio - the ASCII covers the same footprint as the source.
2. Open **ASCII** (left) and adjust **Columns** if you want it denser or
   coarser - the row count follows from the aspect ratio automatically.
3. Choose a **render mode** (`chars`, `braille`, `halfblocks`, `quadrants`) and
   a **character ramp**. Click any glyph in the ramp browser to push it into
   your custom ramp; you can also type the ramp directly.
4. Pick a **dither** and dial its **strength**; adjust brightness/contrast/gamma
   until the shapes read well. **Color Mode** defaults to *Original source
   color*; switch to Monotone or one of the palettes for a restricted look.
5. The **Sampling** section controls how the picture becomes cells: the
   **Resize filter** (area, nearest, bilinear, bicubic, Lanczos 3),
   **Supersample** (1-8 samples per cell) and the **Luminance** standard
   (BT.709 by default; BT.601 reads reds brighter, sRGB linear is the
   perceptual one). The grid re-renders as you switch.
6. Add **effects** (right) such as bloom, diffraction stars, scanlines or
   chromatic aberration - they run in the render worker before the characters
   are picked, so the grid updates as you tune them.
7. **Export** as PNG (a real raster rendering of the grid), as text formats
   (TXT/ANSI/HTML/SVG/JSON/AAP) for pasting into a terminal or editor, or as
   **MP4** / **GIF** of the whole timeline.

### Text banner

1. Add a layer (or select an existing one) and enter the text in
   **Properties**.
2. In **Settings > Text Settings** choose the font, style (plain, shadow,
   outline, double, banner, frame) and scale.
3. Export when happy.

### Generate

A **generative layer** turns seeded math into characters instead of an image:

1. Click **✦ Generative** in the Layers tab (or run *Add generative layer*
   from the command palette). The first click also creates a starter graph -
   value noise cut by a soft threshold - and the layer shows up immediately.
2. Open the **Gen** tab in the right dock to edit the graph: add nodes
   (Constant, Gradient, Value noise, Threshold, Combine), wire inputs with the
   drop-downs and pick which node becomes the output.
3. Shape the characters in **Properties → Generative**: mapping strategy,
   dither, invert, density and glyph offset. Every change re-evaluates
   instantly; resizing the canvas or changing the seed re-evaluates too.

Graphs are non-destructive: the layer caches its output, undo treats only your
edits as steps, and two layers can share one graph.

### Canvas presets

1. Open **Settings** (right dock) and choose a **Preset** under *Canvas*:
   TikTok / Reels (1080 x 1920), square post (1080 x 1080), wide banner
   (1080 x 440) or HD 16:9 (1920 x 1080).
2. The artboard and the image columns resize together in **one undo step**.
   Sizes snap to the fixed 8 x 16 cell grid, so the effective footprint is
   shown next to the size (square becomes 1080 x 1088, for example).
3. The same presets are offered when creating a new project.

### Auto Palette (5 dominant colours)

1. Select the image layer you want to sample.
2. Open **Palette** (right) and press **Auto Palette - 5 Colors**.
3. The image is decoded in the worker, quantised to its five dominant colours,
   and stored as a new palette (named `extracted_...`) which becomes active and
   scrolls into view.

### Draw on the grid

The toolbar carries a **tool group** between the file buttons and the zoom
control:

| Tool | Shortcut | What it does |
| --- | --- | --- |
| **Select** (dashed box) | `S` | Drag a rectangle, or click a cell to grab the whole region a fill would cover. The selection clips the brush and fill; **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste, `Delete` clears it, `Esc` dismisses it |
| **Brush** (pen) | `B` | Paints the **Char** in the selected **Colour** with the selected **Size** (1, 3 or 5 cells) |
| **Eraser** | `E` | Paints spaces and clears their colour |
| **Fill** (droplet) | `F` | Flood-fills the contiguous region of the cell you click |
| **Pick** (pipette) | `I` | Reads the character *and* its colour into **Char** / **Colour** |
| **Pan** (arrows) | `H` | Drag the artboard around without painting |

- **Char** is the literal character the brush and fill write - type any single
  character (`#`, `@`, `█`, `▓`, ...) and it is used immediately.
- **Colour** is the colour those characters are painted in (a colour swatch
  next to Char). The eyedropper loads it from the cell you sample, and cells
  with no colour of their own fall back to the theme foreground.
- **Size** is the brush footprint in cells.
- A whole stroke (or fill) is **one undo step**: `Ctrl+Z` removes it entirely.
- The status bar confirms the action, and the layer becomes *Modified*.
- Locked layers refuse painting ("Layer is locked"), and non-ASCII layers show
  "Select an ASCII layer to draw on".

### View the preview

- **CRT** (right end of the toolbar, next to Zoom) adds a bloom to the editor
  canvas. It is **display only**: it never changes the art, the document stays
  clean, and the export/PNG output is unaffected.
- **Subtexture** (Settings > Canvas) multiplies a screen mask over the art:
  *scanlines*, *RGB stripes* (aperture grille), *RGB rosettes* (phosphor
  triads) or *grid*, with **Mask scale** (1-16 px per element), **Mask opacity**
  and a choice of smooth or hard edges. Unlike the CRT bloom this one **does
  reach the PNG export**, so the file matches the preview. Masks are skipped
  automatically on canvases too large to process.
- **GPU** (next to CRT) renders the preview through PixiJS/WebGL with a real
  CRT shader: barrel curvature, scanlines, glow and vignette. It is display
  only like the CRT bloom, and if WebGL cannot start the app switches back to
  the 2D canvas by itself (the status bar says so).
- **Zoom** scales the canvas (25%-400%); the grid overlay and the CRT bloom
  follow the zoom.
- The stacked **bloom** / **CRT curvature** effects in the Effects dock are
  different: those are image effects applied by the render worker, so they do
  change the ASCII.

### Animate

1. Open **Timeline** (left).
2. Pick a property (Position X, Position Y, Opacity) in the track row's
   property menu and press **Add Track**.
3. Move the playhead (click the ruler or a track body) and press the track's
   **◆** button to keyframe the property's current value; click an existing
   diamond to remove that keyframe.
4. Use the transport controls (play/stop, looping) and the time display
   (`mm:ss.cc / mm:ss.cc`) to preview; the canvas plays the animation live,
   optionally with onion skin ghosts.
5. **Export** -> MP4 or GIF to write the clip to disk (the Export panel shows
   render/encode progress).

Track and keyframe edits are normal undoable steps (Ctrl+Z) and are saved
with the project in `.aap`; the playhead position and transport are session
view state and never mark the project dirty. **+ New Timeline** in the panel
header swaps in a fresh timeline — one undo brings the old one back.

### Save and reopen

- **Ctrl+S** opens Save Project when there are unsaved changes; save as
  `.aap` (project format) or plain `.json`.
- **Open** in the toolbar reloads a saved project.

## 4. Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New document |
| `Ctrl+S` | Save project (when dirty) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+T` | Left dock -> Timeline |
| `Ctrl+P` | Right dock -> Palette |
| `Ctrl+E` | Right dock -> Effects |
| `Space` | Toggle terminal preview |
| `S` / `B` / `E` / `F` / `I` / `H` | Select / Brush / Eraser / Fill / Pick / Pan (unmodified letters) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste the selection |
| `Delete` | Clear the selection (keeps the clipboard) |
| `Esc` | Dismiss the selection |

## 5. Export formats

| Format | Use |
| --- | --- |
| TXT | Plain characters, no colour |
| ASC | ASCII art file variant |
| ANSI | Terminal colour escape codes |
| JSON | Grid plus metadata |
| HTML | Standalone page rendering the grid |
| SVG | Vector text rendering |
| AAP | Native project format |
| PNG | Raster image of the grid, drawn with the current theme colours and the active subtexture mask |
| MP4 | Every timeline frame encoded as H.264 (ffmpeg.wasm) at the timeline fps - press Generate and watch the progress bar, then Download |
| GIF | The timeline as an animated, dithered, looping GIF (ffmpeg.wasm palette pipeline) |

## 6. Troubleshooting

- **A panel looks empty** - every panel needs an active document; create one
  with `Ctrl+N` or import an image.
- **The grid renders black and white** - set **Color Mode** (ASCII dock) to
  *Original source color*, or pick a palette; painted strokes keep the colour
  you chose in the toolbar.
- **An effect seems to do nothing** - make sure it is ticked in the Effects
  stack and its intensity slider is above 0%; the grid re-renders as you tune.
- **Changes do not appear** - the status bar shows a pending render and a
  generation number; rendering happens in a worker and newer requests cancel
  older ones, so a brief delay is normal.
- **The preview looks flat** - press **CRT** in the toolbar for a display
  bloom, or add a *bloom* / *scanlines* effect for one that is baked into the
  art.

## 7. Known limitations

See the "Not implemented yet" section of [README.md](README.md). In short: no
video **import** (MP4/GIF export is included), no WebGL text-glyph renderer;
Tailwind utilities and Framer Motion panel transitions are wired.
