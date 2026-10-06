/**
 * Electron main process - ASCII Art Studio Desktop App
 */

import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, sep } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
// ASCII_FORCE_DIST=1 loads the built renderer from dist/ instead of the vite
// dev server, so the production bundle can be exercised without re-packaging.
const forceDist = process.env.ASCII_FORCE_DIST === '1';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Layout inside app.asar: dist-electron/main.js, dist-electron/preload.js, dist/index.html
  const preloadPath = join(__dirname, 'preload.js');
  const distIndexPath = join(__dirname, '..', 'dist', 'index.html');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'cipherASCII',
    // Vite copies `public/` into `dist/`, so the icon ships inside the asar;
    // `public/` itself is not part of the packaged file set.
    icon: join(__dirname, '..', 'dist', 'icon.png'),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // preload is emitted as ESM (package.json has "type": "module"),
      // and sandboxed preloads only support CommonJS.
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  if (isDev && !forceDist) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(distIndexPath);
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] failed to load ${url}: ${code} ${desc}`);
  });

  // Electron ≥30: (event, { level, message, lineNumber, sourceId }); older: (event, level, message, line, sourceId)
  mainWindow.webContents.on('console-message', (...args: unknown[]) => {
    const ev = args[0] as { preventDefault?: () => void };
    const d = args[1] as
      | { level?: number; message?: string; lineNumber?: number; sourceId?: string }
      | undefined;
    let level: number;
    let message: string;
    let line: number;
    let sourceId: string;
    if (d && typeof d === 'object' && 'message' in d) {
      level = d.level ?? 2;
      message = d.message ?? '';
      line = d.lineNumber ?? 0;
      sourceId = d.sourceId ?? '?';
    } else {
      level = Number(args[1] ?? 2);
      message = String(args[2] ?? '');
      line = Number(args[3] ?? 0);
      sourceId = String(args[4] ?? '?');
    }
    const out = `[renderer][${level}] ${message} (${sourceId}:${line})`;
    if (level >= 2) console.error(out);
    else console.log(out);
    ev?.preventDefault?.();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Optional end-to-end check: ASCII_SMOKE=1 imports a generated image and
  // reports the rendered grid, then exits. Used to verify the pipeline.
  if (process.env.ASCII_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          await new Promise((r) => setTimeout(r, 1500));
          // Optional probes: ASCII_THEME=<id> switches theme, ASCII_PANEL=<id>
          // opens the LEFT dock and ASCII_PANEL_R=<id> the RIGHT dock, so a
          // screenshot can confirm colours change and every panel is reachable.
          if (process.env.ASCII_THEME || process.env.ASCII_PANEL || process.env.ASCII_PANEL_R) {
            const themeId = JSON.stringify(process.env.ASCII_THEME ?? '');
            const panelId = JSON.stringify(process.env.ASCII_PANEL ?? '');
            const panelRId = JSON.stringify(process.env.ASCII_PANEL_R ?? '');
            await mainWindow!.webContents
              .executeJavaScript(
                `(() => {
                  const api = window.asciiStudio;
                  if (api) {
                    const st = api.useStore.getState();
                    const themeId = ${themeId};
                    const panelId = ${panelId};
                    const panelRId = ${panelRId};
                    if (themeId) st.setTheme(themeId);
                    if (panelId) st.setActivePanel(panelId);
                    if (panelRId) st.setActiveRightPanel(panelRId);
                  }
                  return undefined;
                })()`,
                true,
              )
              .then(() =>
                console.log(
                  `[smoke] theme=${process.env.ASCII_THEME ?? '-'} panel=${process.env.ASCII_PANEL ?? '-'} panelR=${process.env.ASCII_PANEL_R ?? '-'}`,
                ),
              )
              .catch((e: unknown) =>
                console.error(`[smoke] probe failed: ${String((e as Error)?.message ?? e)}`),
              );
            await new Promise((r) => setTimeout(r, 800));
            await mainWindow!.webContents
              .executeJavaScript(
                `(() => {
                  const cs = getComputedStyle(window.document.documentElement);
                  const pick = (n) => (cs.getPropertyValue(n).trim() || '(unset)');
                  console.log('[smoke] css bg=' + pick('--bg') + ' fg=' + pick('--fg') + ' accent=' + pick('--accent') + ' elevated=' + pick('--bg-elevated'));
                  return undefined;
                })()`,
                true,
              )
              .catch(() => undefined);
          }
          // Report through the page console: the console-message handler above
          // forwards it to our stdout. The snippet returns undefined right away
          // (work continues detached) so executeJavaScript never has to clone a
          // pending Promise or a rich object.
          await mainWindow!.webContents.executeJavaScript(
            `(() => {
              console.log('[smoke] start, hook=' + typeof window.asciiStudio);
              void (async () => {
                try {
                  const api = window.asciiStudio;
                  if (!api) { console.log('[smoke] hook missing'); return; }
                  const c = document.createElement('canvas');
                  c.width = 320; c.height = 200;
                  const g = c.getContext('2d');
                  if (!g) { console.log('[smoke] no 2d context'); return; }
                  const grd = g.createLinearGradient(0, 0, 320, 200);
                  grd.addColorStop(0, '#1a1a2e');
                  grd.addColorStop(0.5, '#d4a53c');
                  grd.addColorStop(1, '#f5f0e8');
                  g.fillStyle = grd;
                  g.fillRect(0, 0, 320, 200);
                  g.fillStyle = '#0c0c10';
                  g.beginPath();
                  g.arc(110, 90, 55, 0, Math.PI * 2);
                  g.fill();
                  g.fillStyle = '#4a4a8c';
                  g.beginPath();
                  g.arc(230, 130, 40, 0, Math.PI * 2);
                  g.fill();
                  const dataUrl = c.toDataURL('image/png');
                  const bin = atob(dataUrl.split(',')[1]);
                  const arr = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                  const file = new File([arr], 'smoke.png', { type: 'image/png' });
                  const source = await api.fileToImageSource(file);
                  const layer = api.createImageLayer(source);
                  api.useStore.getState().addLayer(layer);
                  api.useStore.getState().setActiveLayer(layer.id);
                  console.log('[smoke] imported ' + source.width + 'x' + source.height);
                  // Import auto-size: the grid must cover the picture with
                  // 8px cells (columns = width / 8, terminal aspect ratio).
                  api.useStore.getState().fitGridToImage(source);
                  {
                    const st = api.useStore.getState();
                    console.log('[smoke] AUTOSIZE ' + JSON.stringify({
                      source: source.width + 'x' + source.height,
                      columns: st.document.imageSettings.columns,
                      aspect: st.document.imageSettings.aspect.preset,
                      ratio: st.document.imageSettings.aspect.ratio,
                      expectedColumns: Math.max(1, Math.min(1000, Math.round(source.width / 8))),
                    }));
                  }
                  // Populate the timeline so a screenshot can show tracks,
                  // keyframes and the playhead rather than an empty ruler.
                  {
                    const s = api.useStore.getState();
                    const ls = s.document.layers;
                    if (s.timeline && s.timeline.tracks.length === 0 && ls.length > 0) {
                      s.addTimelineTrack(ls[0].id, 'x', 'Position X');
                      s.addTimelineTrack(ls[0].id, 'opacity', 'Opacity');
                    }
                    const tl = api.useStore.getState().timeline;
                    if (tl) {
                      for (const t of tl.tracks) {
                        s.setTimelineKeyframe(t.id, 0, 0);
                        s.setTimelineKeyframe(t.id, 60, 100);
                        s.setTimelineKeyframe(t.id, 150, 40);
                        s.setTimelineKeyframe(t.id, 240, 90);
                      }
                      s.setTimelineCurrentFrame(150);
                    }
                  }
                  // Exercise PNG export when the Export dock is open: switch
                  // the format picker to png, generate, and read the preview.
                  {
                    const panel = document.querySelector('.export-panel');
                    const sel = panel && panel.querySelector('select');
                    const gen = panel && panel.querySelectorAll('button')[0];
                    if (sel && gen) {
                      const setter = Object.getOwnPropertyDescriptor(
                        window.HTMLSelectElement.prototype,
                        'value',
                      )?.set;
                      if (setter) setter.call(sel, 'png');
                      sel.dispatchEvent(new Event('change', { bubbles: true }));
                      await new Promise((r) => setTimeout(r, 300));
                      gen.click();
                      await new Promise((r) => setTimeout(r, 1500));
                      const ta = panel.querySelector('textarea');
                      console.log(
                        '[smoke] export ' +
                          JSON.stringify({ text: ((ta && ta.value) || '').slice(0, 140) }),
                      );
                    }
                  }
                  // Exercise the auto-palette (5 dominant colours) when the
                  // Palette dock is the open right panel.
                  {
                    const btn = document.querySelector('button[title^="Quantise the active image"]');
                    if (btn) {
                      btn.click();
                      await new Promise((r) => setTimeout(r, 1500));
                      const ps = api.useStore.getState();
                      const list = ps.palettes || [];
                      const last = list.find((p) => p.id === ps.activePaletteId) || list[0];
                      console.log('[smoke] auto-palette ' + JSON.stringify({
                        count: list.length,
                        id: last && last.id,
                        name: last && last.name,
                        colors: last && last.colors.map((c) => c.rgb.toString(16).padStart(6, '0')),
                      }));
                    } else {
                      console.log('[smoke] auto-palette skipped (palette dock closed)');
                    }
                  }
                  await new Promise((r) => setTimeout(r, 3000));
                  const doc = api.useStore.getState().document;
                  const found = doc.layers.find((l) => l.id === layer.id);
                  const grid = found && found.grid;
                  if (!grid) {
                    console.log('[smoke] NO GRID ' + JSON.stringify(
                      doc.layers.map((l) => ({ kind: l.kind, hasGrid: !!l.grid }))));
                    return;
                  }
                  const chars = Array.from(grid.chars).join('');
                  console.log('[smoke] RESULT ' + JSON.stringify({
                    cols: grid.width,
                    rows: grid.height,
                    widthPx: grid.width * 8,
                    heightPx: grid.height * 16,
                    srcW: source.width,
                    srcH: source.height,
                    nonSpace: chars.replace(/ /g, '').length,
                    sample: chars.slice(0, 120),
                  }));

                  // Painting probe: drive a real brush stroke through the
                  // canvas pointer handlers and verify the grid changed.
                  const canvasEl = document.querySelector('.editor-canvas');
                  if (!canvasEl) {
                    console.log('[smoke] PAINT no canvas');
                  } else {
                    const rect = canvasEl.getBoundingClientRect();
                    const evt = (type, x, y, buttons) =>
                      new PointerEvent(type, {
                        bubbles: true, cancelable: true, view: window,
                        button: 0, buttons, clientX: x, clientY: y,
                        pointerId: 7, isPrimary: true, pointerType: 'mouse',
                      });
                    const sx = rect.left + 8;
                    const sy = rect.top + 8;
                    canvasEl.dispatchEvent(evt('pointerdown', sx, sy, 1));
                    canvasEl.dispatchEvent(evt('pointermove', sx + 48, sy + 8, 1));
                    canvasEl.dispatchEvent(evt('pointerup', sx + 48, sy + 8, 0));
                    await new Promise((r) => setTimeout(r, 400));
                    const st = api.useStore.getState();
                    const painted = st.document.layers.find((l) => l.id === layer.id);
                    const after = painted && painted.grid;
                    let changed = 0;
                    let colored = 0;
                    const fgSeen = {};
                    if (after) {
                      for (let i = 0; i < after.chars.length && i < grid.chars.length; i++) {
                        if (after.chars[i] !== grid.chars[i]) changed++;
                      }
                      if (after.fg) {
                        for (let i = 0; i < after.fg.length; i++) {
                          const c = after.fg[i];
                          if (c >= 0) {
                            colored++;
                            const hex = '#' + c.toString(16).padStart(6, '0');
                            fgSeen[hex] = (fgSeen[hex] || 0) + 1;
                          }
                        }
                      }
                    }
                    console.log('[smoke] PAINT ' + JSON.stringify({
                      changed,
                      colored,
                      colors: fgSeen,
                      tool: st.tool && st.tool.activeTool,
                      brushChar: st.tool && st.tool.brushChar,
                      brushColor: st.tool && '#' + (st.tool.foregroundColor & 0xffffff).toString(16).padStart(6, '0'),
                      status: st.statusMessage,
                      undoable: st.canUndo(),
                    }));
                  }

                  // Effects probe: adding an effect must re-render through the
                  // worker, so the ASCII visibly changes.
                  {
                    const beforeGrid = api.useStore.getState().document.layers.find((l) => l.id === layer.id);
                    const beforeChars = beforeGrid && beforeGrid.grid
                      ? Array.from(beforeGrid.grid.chars).join('')
                      : '';
                    const s = api.useStore.getState();
                    s.addEffect('vignette');
                    s.addEffect('crtCurvature');
                    await new Promise((r) => setTimeout(r, 3500));
                    const st = api.useStore.getState();
                    const now = st.document.layers.find((l) => l.id === layer.id);
                    const nowChars = now && now.grid ? Array.from(now.grid.chars).join('') : '';
                    let diff = 0;
                    for (let i = 0; i < Math.min(beforeChars.length, nowChars.length); i++) {
                      if (beforeChars[i] !== nowChars[i]) diff++;
                    }
                    console.log('[smoke] EFFECTS ' + JSON.stringify({
                      changed: diff,
                      pipeline: st.document.effectsPipeline
                        ? st.document.effectsPipeline.effects.map((e) => e.id + (e.enabled ? '' : ':off'))
                        : [],
                      live: st.effectsPipeline ? st.effectsPipeline.effects.length : -1,
                      dirty: st.isDirty,
                      gen: st.renderGeneration,
                    }));
                  }

                  // Display-only CRT bloom: a view flag, so it must never mark
                  // the document dirty or bump the render generation. Left on
                  // so the stay-open screenshot shows the bloom.
                  {
                    const before = api.useStore.getState();
                    const gen = before.renderGeneration;
                    const dirty = before.isDirty;
                    before.toggleCrtGlow();
                    const after = api.useStore.getState();
                    console.log('[smoke] CRTGLOW ' + JSON.stringify({
                      on: after.crtGlow,
                      genUnchanged: gen === after.renderGeneration,
                      dirtyUnchanged: dirty === after.isDirty,
                    }));
                  }

                  // Phase 2 probe: the sampling settings, the subtexture mask
                  // and the diffraction-star effect must all land in the
                  // document and trigger a worker re-render. Left on so the
                  // stay-open screenshot shows the scanline mask.
                  {
                    const before = api.useStore.getState();
                    const gen0 = before.renderGeneration;
                    before.setImageSettings({
                      luminanceStandard: 'rec601',
                      resizeFilter: 'lanczos',
                      supersample: 2,
                    });
                    before.setCanvasSettings({
                      subtexture: { pattern: 'scanlines', scale: 3, opacity: 0.5, interpolation: 'nearest' },
                    });
                    before.addEffect('diffractionStars');
                    await new Promise((r) => setTimeout(r, 3500));
                    const st = api.useStore.getState();
                    const img = st.document.imageSettings || {};
                    const sub = (st.document.canvas && st.document.canvas.subtexture) || {};
                    const pipe = st.document.effectsPipeline && st.document.effectsPipeline.effects;
                    console.log('[smoke] PHASE2 ' + JSON.stringify({
                      lum: img.luminanceStandard,
                      filter: img.resizeFilter,
                      ss: img.supersample,
                      sub: sub.pattern + '@' + sub.scale + 'x' + sub.opacity + '/' + sub.interpolation,
                      fx: (pipe || []).map((e) => e.id + (e.enabled ? '' : ':off')).join(','),
                      genBumped: st.renderGeneration > gen0,
                      dirty: st.isDirty,
                    }));
                    // Bring the Subtexture controls into view so the
                    // stay-open screenshot proves the UI is there too.
                    const tag = Array.from(document.querySelectorAll('label')).find(
                      (n) => String(n.textContent || '').trim().indexOf('Subtexture') === 0,
                    );
                    if (tag && tag.scrollIntoView) tag.scrollIntoView({ block: 'center' });
                  }

                  // Canvas preset probe: one undo step must resize the
                  // artboard and the image columns together. Applied before
                  // the GPU probe so the stay-open screenshot shows the HD
                  // artboard through the CRT shader.
                  {
                    const before = api.useStore.getState();
                    before.applyCanvasPreset('hd');
                    await new Promise((r) => setTimeout(r, 1500));
                    const st = api.useStore.getState();
                    console.log('[smoke] PRESET ' + JSON.stringify({
                      t: Math.round(performance.now()),
                      w: st.document.canvas.width,
                      h: st.document.canvas.height,
                      cols: st.document.imageSettings.columns,
                      dirty: st.isDirty,
                      status: st.statusMessage,
                    }));
                  }

                  // GPU preview probe: view state, so it must never dirty the
                  // document or bump the render generation. The host element
                  // reports whether WebGL started ('on') or the viewport fell
                  // back to 2D ('failed' / gone). Left on so the stay-open
                  // screenshot shows the CRT shader.
                  {
                    const before = api.useStore.getState();
                    const gen = before.renderGeneration;
                    const dirty = before.isDirty;
                    before.toggleGpuPreview();
                    await new Promise((r) => setTimeout(r, 4000));
                    const st = api.useStore.getState();
                    const host = document.querySelector('[data-gpu]');
                    console.log('[smoke] GPU ' + JSON.stringify({
                      t: Math.round(performance.now()),
                      on: st.gpuPreview,
                      host: host ? host.getAttribute('data-gpu') : null,
                      pixiCanvases: document.querySelectorAll('.pixi-host canvas').length,
                      genUnchanged: gen === st.renderGeneration,
                      dirtyUnchanged: dirty === st.isDirty,
                      status: st.statusMessage,
                    }));
                  }
                  // Phase 4 probe: the shared styled slider must drive the
                  // store through the real DOM event path, and both docks
                  // must expose tab semantics with framer-motion wrappers.
                  // Panels left on ASCII / Effects for the stay-open
                  // screenshot.
                  {
                    const st0 = api.useStore.getState();
                    st0.setActivePanel('ascii');
                    st0.setActiveRightPanel('effects');
                    await new Promise((r) => setTimeout(r, 900));
                    const sliders = document.querySelectorAll('.slider input[type="range"]').length;
                    const tablists = document.querySelectorAll('[role="tablist"]').length;
                    const tabs = document.querySelectorAll('[role="tab"][aria-selected]').length;
                    const motionDivs = Array.from(document.querySelectorAll('.panel-content > div')).filter(
                      (d) => d.style.opacity !== '' || d.style.transform !== '',
                    ).length;
                    let driven = null;
                    const range = document.querySelector('.ascii-controls .slider input[type="range"]');
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                      ?.set;
                    if (range && setter) {
                      const st1 = api.useStore.getState();
                      const gen0 = st1.renderGeneration;
                      const prev = st1.document.imageSettings.columns;
                      setter.call(range, '111');
                      range.dispatchEvent(new Event('input', { bubbles: true }));
                      await new Promise((r) => setTimeout(r, 800));
                      const st2 = api.useStore.getState();
                      driven = {
                        cols: st2.document.imageSettings.columns,
                        genBumped: st2.renderGeneration > gen0,
                      };
                      if (st2.document.imageSettings.columns !== prev) {
                        api.useStore.getState().setImageSettings({ columns: prev });
                        await new Promise((r) => setTimeout(r, 800));
                      }
                    }
                    console.log('[smoke] PHASE4 ' + JSON.stringify({
                      t: Math.round(performance.now()),
                      sliders: sliders,
                      tablists: tablists,
                      tabs: tabs,
                      motionDivs: motionDivs,
                      driven: driven,
                    }));
                  }

                  // Phase 5 probe: MP4 + GIF export through ffmpeg.wasm and
                  // live timeline playback. The timeline is shrunk to 8 frames
                  // so the export finishes in seconds; the download is
                  // intercepted to verify the container magic bytes.
                  {
                    const fail = (why, extra) =>
                      console.log('[smoke] PHASE5 ' + JSON.stringify(
                        Object.assign({ t: Math.round(performance.now()), ok: false, why: why },
                          extra || {})));
                    const api2 = api;
                    const st0 = api2.useStore.getState();
                    const tl0 = st0.timeline;
                    if (!tl0) {
                      fail('no timeline');
                    } else {
                      // 8 frames at 30 fps, mirror of the duration input.
                      api2.useStore.setState({
                        timeline: Object.assign({}, tl0, { duration: 8, currentFrame: 0 }),
                      });
                      st0.setActiveRightPanel('export');
                      await new Promise((r) => setTimeout(r, 900));
                      const panel = document.querySelector('.export-panel');
                      const sel = panel && panel.querySelector('select');
                      const btns = panel ? panel.querySelectorAll('button') : [];
                      const ta = panel && panel.querySelector('textarea');
                      const selSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLSelectElement.prototype, 'value',
                      )?.set;
                      if (!panel || !sel || !ta || btns.length < 2 || !selSetter) {
                        fail('export panel incomplete');
                      } else {
                        const results = {};
                        const magics = {};
                        let progressSeen = false;
                        const poll = async (prefix) => {
                          const deadline = Date.now() + 75000;
                          while (Date.now() < deadline) {
                            if (document.querySelector('.export-progress')) progressSeen = true;
                            const v = (ta && ta.value) || '';
                            if (v.indexOf(prefix) === 0 || v.indexOf('Error') === 0) break;
                            await new Promise((r) => setTimeout(r, 250));
                          }
                          return (ta && ta.value) || '';
                        };
                        // Intercept the download to read the container magic
                        // bytes without writing a file to disk.
                        const captureMagic = async () => {
                          let captured = '';
                          const origCreate = URL.createObjectURL;
                          const origClick = window.HTMLAnchorElement.prototype.click;
                          URL.createObjectURL = function (b) {
                            try {
                              if (b && typeof b.slice === 'function') {
                                b.slice(0, 16).arrayBuffer().then((ab) => {
                                  captured = Array.from(new Uint8Array(ab))
                                    .map((c) => String.fromCharCode(c)).join('');
                                });
                              }
                            } catch (e) { captured = 'capture-error'; }
                            return 'blob:probe-capture';
                          };
                          window.HTMLAnchorElement.prototype.click = function () {};
                          try {
                            btns[1].click();
                            await new Promise((r) => setTimeout(r, 600));
                          } finally {
                            window.HTMLAnchorElement.prototype.click = origClick;
                            URL.createObjectURL = origCreate;
                          }
                          return captured;
                        };
                        for (const format of ['mp4', 'gif']) {
                          selSetter.call(sel, format);
                          sel.dispatchEvent(new Event('change', { bubbles: true }));
                          await new Promise((r) => setTimeout(r, 250));
                          btns[0].click();
                          const out = await poll(
                            format === 'mp4' ? 'MP4 rendered' : 'GIF rendered',
                          );
                          results[format] = out.slice(0, 160);
                          if (out.indexOf('Error') === 0) break;
                          magics[format] = await captureMagic();
                        }
                        // Live playback: the rAF loop must advance the frame.
                        api2.useStore.setState({
                          timeline: Object.assign({}, api2.useStore.getState().timeline,
                            { currentFrame: 0, loop: true }),
                        });
                        api2.useStore.getState().setTimelinePlaying(true);
                        await new Promise((r) => setTimeout(r, 550));
                        const frameAfter = api2.useStore.getState().timeline
                          ? api2.useStore.getState().timeline.currentFrame : -1;
                        api2.useStore.getState().setTimelinePlaying(false);
                        // Restore the default duration/playhead for the
                        // stay-open screenshot.
                        api2.useStore.setState({
                          timeline: Object.assign({}, api2.useStore.getState().timeline,
                            { duration: 300, currentFrame: 150 }),
                        });
                        const ok = (results.mp4 || '').indexOf('MP4 rendered') === 0 &&
                          (results.gif || '').indexOf('GIF rendered') === 0 &&
                          (magics.mp4 || '').indexOf('ftyp') >= 0 &&
                          (magics.gif || '').indexOf('GIF8') === 0 && frameAfter > 0;
                        console.log('[smoke] PHASE5 ' + JSON.stringify({
                          t: Math.round(performance.now()),
                          ok: ok,
                          progressSeen: progressSeen,
                          magicMp4: (magics.mp4 || '').slice(0, 12),
                          magicGif: (magics.gif || '').slice(0, 12),
                          frameAfter: frameAfter,
                          mp4: results.mp4,
                          gif: results.gif,
                        }));
                      }
                    }
                  }
                } catch (e) {
                  console.log('[smoke] ERROR ' + String((e && e.stack) || e));
                }
              })();
            })()`,
            true,
          ).then(() => console.log('[smoke] exec ok'))
            .catch((e: unknown) => {
              console.error(`[smoke] exec failed: ${String((e as Error)?.message ?? e)}`);
            });
          // The probe below runs detached for ~45s (import, export, render,
          // paint, effects, phase-2 settings, canvas preset, GPU viewport,
          // phase-4 slider/dock check, phase-5 ffmpeg export + playback);
          // wait it out before the late-ui readout.
          await new Promise((r) => setTimeout(r, 65000));
          await mainWindow!.webContents
            .executeJavaScript(
              `(() => {
                const st = window.asciiStudio && window.asciiStudio.useStore.getState();
                console.log('[smoke] late-ui ' + JSON.stringify({
                  theme: st && st.theme && st.theme.id,
                  left: st && st.activePanel,
                  right: st && st.activeRightPanel,
                  attr: document.documentElement.getAttribute('data-theme'),
                  menuHook: !!window.__menuHooked,
                  bridge: typeof (window.electronAPI && window.electronAPI.onMenuAction),
                  scrollW: document.documentElement.scrollWidth,
                  clientW: document.documentElement.clientWidth,
                  edge: (document.elementsFromPoint(4, 300) || []).slice(0, 4).map((el) => {
                    const e = el;
                    return e.tagName.toLowerCase() + '.' + String(e.className || '').slice(0, 40) + '|' + String(e.textContent || '').trim().slice(0, 40);
                  }),
                }));
                return undefined;
              })()`,
              true,
            )
            .catch(() => undefined);
          console.log('[smoke] done');
        } catch (e) {
          console.error(`[smoke] failed: ${String((e as Error)?.message ?? e)}`);
        } finally {
          // ASCII_SMOKE_STAY=1 keeps the window open for a screenshot.
          if (process.env.ASCII_SMOKE_STAY !== '1') {
            // Give the renderer's console IPC a moment to flush before exiting.
            setTimeout(() => app.exit(0), 800);
          }
        }
      })();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// File operations for native save/load
ipcMain.handle('dialog:openFile', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters,
  });
  return result;
});

ipcMain.handle('dialog:saveFile', async (_event, defaultPath: string, filters: Electron.FileFilter[]) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    filters,
  });
  return result;
});

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  return readFileSync(filePath, 'utf8');
});

    ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
      writeFileSync(filePath, content, 'utf8');
      return true;
    });

    // Binary read of a bundled asset under dist/ (ffmpeg core files). The
    // path is normalised and clamped to dist/ so a renderer cannot reach
    // outside the packaged app directory.
    ipcMain.handle('fs:readAsset', async (_event, relPath: string) => {
      const base = join(app.getAppPath(), 'dist');
      const full = normalize(join(base, String(relPath)));
      if (full !== base && !full.startsWith(base + sep)) {
        throw new Error('asset path escapes the app directory');
      }
      return readFileSync(full);
    });

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPath', (_event, name: 'userData' | 'temp' | 'desktop') => app.getPath(name));

/**
 * Native application menu.
 *
 * Entries forward the same actions the renderer already implements through the
 * `menu-action` channel exposed by the preload script. No accelerators are
 * registered here on purpose: the renderer owns the keyboard so that its
 * "ignore keystrokes typed into inputs" guard keeps working (native undo in a
 * text field, typing space in a name box, ...).
 */
function installMenu(): void {
  const send =
    (action: string) =>
    (_item: Electron.MenuItem, window?: Electron.BaseWindow): void => {
      const target = (window as BrowserWindow | undefined) ?? mainWindow;
      target?.webContents.send('menu-action', action);
    };

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New Document', click: send('new') },
        { label: 'Open Project...', click: send('open') },
        { label: 'Save Project...', click: send('save') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', click: send('undo') },
        { label: 'Redo', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Terminal Preview', click: send('toggle-terminal') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About cipherASCII',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About cipherASCII',
              message: `cipherASCII ${app.getVersion()}`,
              detail:
                'A native desktop studio for creating ASCII art: images and text to character grids, effects, palettes, animation and export.\n\nCreated by killerdasher - https://github.com/killerdasher\n\nLicensed under the MIT License.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Windows taskbar/notification identity: without this the shell groups the
// app under a generic Electron entry in dev builds and in per-user installs.
if (process.platform === 'win32') app.setAppUserModelId('com.cipherascii.app');

app.whenReady().then(() => {
  installMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Security: prevent navigation to external URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'http://localhost:5173' && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
});