/**
 * Shared drawing helpers for the generator scripts (`npm run screenshots`,
 * `npm run hero`).
 *
 * The gallery and the hero GIF both paint the same thing: cipherASCII's own
 * render output inside a mock editor window, with the chrome coloured from the
 * active theme. Keeping the primitives here means both previews stay in step
 * - and that every pixel of both is still produced by the real pipeline
 * (`renderImageToGrid`), never hand-drawn ASCII.
 *
 * Not a vitest suite: `vitest.scripts.config.ts` excludes `scripts/lib/**`.
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Theme, ThemeColors } from '../../src/core/theme/theme';
import { renderImageToGrid } from '../../src/core/renderImage';
import {
  DEFAULT_IMAGE_RENDER,
  type AsciiGrid,
  type ImageRenderSettings,
  type Raster,
} from '../../src/core/types';

export const CELL_FONT = '14px "DejaVu Sans Mono", "Liberation Mono", monospace';
export const MONO_11 = '11px "DejaVu Sans Mono", monospace';
export const MONO_12 = '12px "DejaVu Sans Mono", monospace';
export const MONO_13 = '13px "DejaVu Sans Mono", monospace';
export const MONO_14 = '14px "DejaVu Sans Mono", monospace';
export const MONO_15 = '15px "DejaVu Sans Mono", monospace';

/** #rgb / #rrggbb -> channel triple. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
}

export function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Synthetic scene: a lambert-lit sphere over a graded sky with deterministic
 * stars and a horizon glow. Gradients and specular falloff are what make
 * dithering and the density ramp legible in a still.
 *
 * `phase` rotates the terminator bands around the sphere; callers that want a
 * seamless loop sweep it 0 -> 2*pi across their frames.
 */
export function sceneRaster(w = 420, h = 260, phase = 0): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = w * 0.5;
  const cy = h * 0.44;
  const r = Math.min(w, h) * 0.36;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = (x - cx) / r;
      const v = (y - cy) / r;
      const d2 = u * u + v * v;
      let cr: number;
      let cg: number;
      let cb: number;
      if (d2 <= 1) {
        const nz = Math.sqrt(1 - d2);
        const lam = Math.max(0, u * -0.45 + v * -0.55 + nz * 0.7);
        const spec = Math.pow(Math.max(0, lam), 8) * 0.5;
        const t = 0.1 + 0.9 * Math.pow(lam, 1.15) + spec;
        const band = 1 + 0.08 * Math.sin(Math.atan2(v, u) * 6 + phase) * (1 - d2);
        const k = t * band;
        cr = 40 + 210 * k;
        cg = 34 + 178 * k;
        cb = 26 + 96 * k;
      } else {
        const g = 1 - y / h;
        const ring = Math.abs(Math.sqrt(d2) - 1.42);
        const glow = ring < 0.06 ? (1 - ring / 0.06) * 0.85 : 0;
        const twinkle = 0.55 + 0.45 * Math.sin(phase * 2 + ((x * 31) ^ (y * 17)) * 0.7);
        // `>>> 0` keeps the hash unsigned: `^` returns int32, and a signed
        // `% 1021 < 2` counted every negative remainder as a star (54k "stars"
        // instead of ~214), whose density varied by column and banded the sky.
        const hash = ((x * 73856093) ^ (y * 19349663) ^ 0x5f37) >>> 0;
        const star = hash % 1021 < 2 ? 0.75 * twinkle : 0;
        cr = 16 + 34 * g + 150 * glow + 70 * star;
        cg = 18 + 38 * g + 128 * glow + 70 * star;
        cb = 26 + 52 * g + 74 * glow + 70 * star;
      }
      data[i] = Math.max(0, Math.min(255, cr));
      data[i + 1] = Math.max(0, Math.min(255, cg));
      data[i + 2] = Math.max(0, Math.min(255, cb));
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** `columns` columns, truecolor, Floyd-Steinberg: the gallery/hero recipe. */
export function renderSettings(columns = 104): ImageRenderSettings {
  const s = structuredClone(DEFAULT_IMAGE_RENDER);
  s.columns = columns;
  s.colorMode = 'truecolor';
  s.dither = { ...s.dither, algorithm: 'floydSteinberg' };
  s.output = { ...s.output, charset: '@%#*+=-:. ' };
  return s;
}

/** Render a raster through the real pipeline and return the character grid. */
export function renderScene(phase: number, columns = 104): AsciiGrid {
  return renderImageToGrid(sceneRaster(420, 260, phase), renderSettings(columns)).grid;
}

/**
 * Paint an ASCII grid cell by cell with the editor's monospace metrics. Cells
 * with no foreground fall back to the theme's code colour; spaces are skipped
 * so the caller's stage background shows through.
 */
export function paintGrid(
  ctx: SKRSContext2D,
  grid: AsciiGrid,
  theme: Theme,
  x0: number,
  y0: number,
  cellW: number,
  cellH: number,
): void {
  ctx.font = CELL_FONT;
  ctx.textBaseline = 'alphabetic';
  const baseline = Math.round(cellH * 0.78);
  let fill = '';
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const ch = grid.chars[i];
      if (ch === ' ' || ch === undefined) continue;
      const packed = grid.fg ? grid.fg[i] : -1;
      const next =
        packed >= 0
          ? `rgb(${(packed >> 16) & 0xff},${(packed >> 8) & 0xff},${packed & 0xff})`
          : theme.colors.codeFg;
      if (next !== fill) {
        fill = next;
        ctx.fillStyle = next;
      }
      ctx.fillText(ch, x0 + x * cellW, y0 + y * cellH + baseline);
    }
  }
}

/** Rounded chip; returns its width so callers can lay a row of them out. */
export function pill(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  fg: string,
  bg: string,
  border: string,
): number {
  ctx.font = MONO_11;
  const w = Math.ceil(ctx.measureText(label).width) + 18;
  roundRect(ctx, x, y, w, 22, 11);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.fillText(label, x + 9, y + 15);
  return w;
}

/** Cell metrics for `CELL_FONT` on the current context. */
export function cellMetrics(ctx: SKRSContext2D): { cellW: number; cellH: number } {
  ctx.font = CELL_FONT;
  const probe = ctx.measureText('M').width;
  return { cellW: Math.max(probe, 7.4), cellH: 15.6 };
}

/** Scale a raster into the current clip via an offscreen canvas. */
export function drawRasterScaled(
  ctx: SKRSContext2D,
  raster: Raster,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const off = createCanvas(raster.width, raster.height);
  const octx = off.getContext('2d');
  const img = octx.createImageData(raster.width, raster.height);
  img.data.set(raster.data);
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, x, y, w, h);
}

/** Guard: every theme must expose the colours the chrome draws with. */
export function hasThemeColors(theme: Theme): boolean {
  const need: (keyof ThemeColors)[] = [
    'bg',
    'bgElevated',
    'bgHover',
    'bgActive',
    'fg',
    'fgMuted',
    'accent',
    'accentMuted',
    'border',
    'borderLight',
    'codeBg',
    'codeFg',
    'danger',
    'warning',
    'success',
  ];
  return need.every((k) => typeof theme.colors[k] === 'string');
}

/** Default effect stack shown in the mock right dock. */
export const MOCK_EFFECTS: ReadonlyArray<readonly [string, number]> = [
  ['bloom', 0.82],
  ['chromaticAberration', 0.44],
  ['scanlines', 0.61],
  ['filmGrain', 0.27],
  ['vignette', 0.7],
  ['signalburst', 0.35],
];

export interface EditorFrameOptions {
  /** Path label in the title bar, e.g. `/ gallery / medieval.ascii`. */
  path: string;
  /** Right-aligned title-bar chips. */
  chipsRight?: readonly string[];
  /** Status bar text. */
  status: string;
  /** Effect stack in the right dock; defaults to {@link MOCK_EFFECTS}. */
  effects?: ReadonlyArray<readonly [string, number]>;
  /** Caption drawn inside the stage. */
  caption?: string;
  /** Column count for the stage render (default 104, the gallery's recipe). */
  columns?: number;
  /**
   * Hook applied to the freshly rendered grid before painting - the hero uses
   * it to run the live cell-effect runtime (`cellFxRuntime.frame`) over the
   * stage.
   */
  transformGrid?: (grid: AsciiGrid) => AsciiGrid;
  /**
   * Photo/ASCII split wipe: the source raster fills the art box and the ASCII
   * grid is painted over everything left of `position` (0..1 of the art box),
   * with an accent divider on the seam. Omit for a plain ASCII stage.
   */
  split?: { raster: Raster; position: number };
}

/**
 * One editor-window frame: title bar, both docks, the ASCII stage and the
 * status bar, all coloured from `theme`. The artwork is `renderScene(phase)`,
 * i.e. real pipeline output — callers pass an animated `phase` to make the
 * preview move (sweeping 0 -> 2*pi loops seamlessly).
 */
export function drawEditorFrame(
  theme: Theme,
  phase: number,
  opts: EditorFrameOptions,
  width = 1440,
  height = 900,
): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const cols: ThemeColors = theme.colors;

  // --- page ---------------------------------------------------------------
  ctx.fillStyle = cols.bg;
  ctx.fillRect(0, 0, width, height);

  // window plate
  const winX = 24;
  const winY = 22;
  const winW = width - 48;
  const winH = height - 44;
  roundRect(ctx, winX, winY, winW, winH, 14);
  ctx.fillStyle = cols.bgElevated;
  ctx.fill();
  ctx.strokeStyle = cols.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // --- title bar ----------------------------------------------------------
  const barH = 52;
  roundRect(ctx, winX, winY, winW, barH, 14);
  ctx.fillStyle = mix(cols.bgElevated, cols.bg, 0.35);
  ctx.fill();
  ctx.strokeStyle = cols.borderLight;
  ctx.beginPath();
  ctx.moveTo(winX, winY + barH);
  ctx.lineTo(winX + winW, winY + barH);
  ctx.stroke();

  const dots = [cols.danger, cols.warning, cols.success];
  dots.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(winX + 26 + i * 20, winY + barH / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = d;
    ctx.fill();
  });
  ctx.font = MONO_15;
  ctx.fillStyle = cols.fg;
  ctx.fillText('cipherASCII', winX + 96, winY + barH / 2 + 5);
  ctx.fillStyle = cols.fgMuted;
  ctx.font = MONO_13;
  ctx.fillText(opts.path, winX + 232, winY + barH / 2 + 5);

  // title-bar chips (right group)
  let chipX = winX + winW - 30;
  const right = [...(opts.chipsRight ?? ['60 fps', 'seed 42'])].reverse();
  for (const label of right) {
    ctx.font = MONO_11;
    const w = Math.ceil(ctx.measureText(label).width) + 18;
    chipX -= w + 10;
    pill(ctx, chipX, winY + (barH - 22) / 2, label, cols.fgMuted, cols.bg, cols.borderLight);
  }
  const columns = opts.columns ?? 104;
  const chipsLeft = ['truecolor', `${columns} cols`, 'floyd-steinberg'];
  let lx = winX + 470;
  for (const label of chipsLeft) {
    lx += pill(ctx, lx, winY + (barH - 22) / 2, label, cols.accent, cols.bg, cols.accentMuted) + 10;
  }

  // --- docks --------------------------------------------------------------
  const dockW = 196;
  const statusH = 34;
  const bodyY = winY + barH;
  const bodyH = winH - barH - statusH;
  const mainX = winX + dockW;
  const mainW = winW - dockW * 2;

  // left dock
  ctx.fillStyle = cols.bgElevated;
  ctx.fillRect(winX, bodyY, dockW, bodyH);
  ctx.strokeStyle = cols.borderLight;
  ctx.strokeRect(winX, bodyY, dockW, bodyH);
  const nav = [
    ['▚', 'Gallery'],
    ['✦', 'Effects'],
    ['◈', 'Presets'],
    ['◐', 'Timeline'],
    ['⇩', 'Export'],
  ];
  ctx.font = MONO_14;
  nav.forEach(([glyph, label], i) => {
    const y = bodyY + 26 + i * 44;
    const active = i === 0;
    if (active) {
      roundRect(ctx, winX + 12, y - 16, dockW - 24, 34, 8);
      ctx.fillStyle = cols.bgActive;
      ctx.fill();
      ctx.fillStyle = cols.accent;
      ctx.fillRect(winX + 12, y - 16, 3, 34);
    }
    ctx.fillStyle = active ? cols.accent : cols.fgMuted;
    ctx.fillText(glyph, winX + 26, y + 5);
    ctx.fillStyle = active ? cols.fg : cols.fgMuted;
    ctx.fillText(label, winX + 54, y + 5);
  });

  // right dock: effect stack
  const rDockX = winX + winW - dockW;
  ctx.fillStyle = cols.bgElevated;
  ctx.fillRect(rDockX, bodyY, dockW, bodyH);
  ctx.strokeStyle = cols.borderLight;
  ctx.strokeRect(rDockX, bodyY, dockW, bodyH);
  ctx.fillStyle = cols.fg;
  ctx.font = MONO_13;
  ctx.fillText('EFFECTS PIPELINE', rDockX + 16, bodyY + 28);
  const fx = opts.effects ?? MOCK_EFFECTS;
  fx.forEach(([name, amount], i) => {
    const y = bodyY + 58 + i * 52;
    ctx.fillStyle = cols.fg;
    ctx.font = MONO_12;
    ctx.fillText(name, rDockX + 16, y + 12);
    const trackW = dockW - 32;
    roundRect(ctx, rDockX + 16, y + 22, trackW, 6, 3);
    ctx.fillStyle = cols.bgHover;
    ctx.fill();
    roundRect(ctx, rDockX + 16, y + 22, Math.max(12, trackW * amount), 6, 3);
    ctx.fillStyle = cols.accent;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rDockX + 16 + trackW * amount, y + 25, 5, 0, Math.PI * 2);
    ctx.fillStyle = cols.fg;
    ctx.fill();
  });

  // --- main stage ---------------------------------------------------------
  roundRect(ctx, mainX + 16, bodyY + 16, mainW - 32, bodyH - 32, 10);
  ctx.fillStyle = cols.codeBg;
  ctx.fill();
  ctx.strokeStyle = cols.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();

  let grid = renderScene(phase, columns);
  if (opts.transformGrid) grid = opts.transformGrid(grid);
  const { cellW, cellH } = cellMetrics(ctx);
  const artW = grid.width * cellW;
  const artH = grid.height * cellH;
  const stageX = mainX + 16 + (mainW - 32 - artW) / 2;
  const stageY = bodyY + 16 + (bodyH - 32 - artH) / 2;
  const ax = Math.round(stageX);
  const ay = Math.round(stageY);
  if (opts.split) {
    // Source photo on the right of the seam, ASCII on the left: the wipe that
    // shows an image becoming characters.
    const pos = Math.max(0, Math.min(1, opts.split.position));
    drawRasterScaled(ctx, opts.split.raster, ax, ay, artW, artH);
    const cut = ax + artW * pos;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, cut - ax, artH);
    ctx.clip();
    ctx.fillStyle = cols.codeBg;
    ctx.fillRect(ax, ay, artW, artH);
    paintGrid(ctx, grid, theme, ax, ay, cellW, cellH);
    ctx.restore();
    if (pos > 0 && pos < 1) {
      ctx.fillStyle = cols.accent;
      ctx.fillRect(Math.round(cut) - 1, ay, 2, artH);
      ctx.font = MONO_11;
      ctx.fillStyle = cols.bg;
      roundRect(ctx, Math.round(cut) - 34, ay + 8, 68, 20, 10);
      ctx.fillStyle = cols.accent;
      ctx.fill();
      ctx.fillStyle = cols.bg;
      ctx.textAlign = 'center';
      ctx.fillText('source', Math.round(cut), ay + 22);
      ctx.textAlign = 'left';
    }
  } else {
    paintGrid(ctx, grid, theme, ax, ay, cellW, cellH);
  }

  // caption inside the stage
  const caption = opts.caption ?? `${theme.name} · ${theme.description}`;
  ctx.font = MONO_12;
  ctx.fillStyle = cols.fgMuted;
  ctx.fillText(caption, mainX + 32, bodyY + bodyH - 34);
  ctx.restore();

  // --- status bar ---------------------------------------------------------
  ctx.fillStyle = mix(cols.bgElevated, cols.bg, 0.5);
  ctx.fillRect(winX, winY + winH - statusH, winW, statusH);
  ctx.strokeStyle = cols.borderLight;
  ctx.beginPath();
  ctx.moveTo(winX, winY + winH - statusH);
  ctx.lineTo(winX + winW, winY + winH - statusH);
  ctx.stroke();
  ctx.font = MONO_12;
  ctx.fillStyle = cols.fgMuted;
  ctx.fillText(opts.status, winX + 24, winY + winH - 12);
  const pillLabel = `theme: ${theme.id}`;
  ctx.font = MONO_11;
  const pw = Math.ceil(ctx.measureText(pillLabel).width) + 18;
  pill(
    ctx,
    winX + winW - pw - 24,
    winY + winH - statusH + 6,
    pillLabel,
    cols.bg,
    cols.accent,
    cols.accent,
  );

  return canvas.toBuffer('image/png');
}
