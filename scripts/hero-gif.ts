/**
 * Generates `docs/images/hero.gif` - the README's animated hero.
 *
 *   npm run hero
 *
 * The loop tells the product's story in one sweep: a source photograph wipes
 * into ASCII and back (a cosine ping-pong, so the first and last frames join
 * smoothly), the terminator bands and stars rotate in the scene underneath,
 * a `pulse` cell effect breathes over the grid on an exact 1 s period, and
 * the editor's effect sliders sway. Every frame is a real
 * `renderImageToGrid` pass at 88 columns / truecolor / Floyd-Steinberg,
 * painted inside the same mock editor window the theme gallery uses
 * (`scripts/lib/chrome.ts`) - the GIF is a recording of the actual pipeline,
 * not an artist's impression of it.
 *
 * Looping is exact by construction: `FRAMES` frames at `FPS` cover
 * `FRAMES / FPS` seconds, every animated quantity (scene phase, wipe
 * position, pulse period, slider sway) completes a whole number of cycles in
 * that window, and the runtime clock advances by one frame-step from the last
 * frame back to the first.
 *
 * Encoding: frames go to a temp dir, then system `ffmpeg` (palettegen +
 * paletteuse, 64 colours, bayer dither) writes the looping GIF. If ffmpeg is
 * missing the suite still writes the poster and reports a skip rather than
 * failing the build.
 *
 * Environment:
 *   HERO_FRAMES   frame count (default 36)
 *   HERO_FPS      playback rate (default 12)
 *   HERO_COLUMNS  grid columns (default 88)
 *   HERO_WIDTH    canvas width  (default 1280)
 *   HERO_HEIGHT   canvas height (default 800)
 *   NO_ENCODE=1   write frames only, skip ffmpeg
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEME_PRESETS } from '../src/core/theme/theme';
import { cellFxRuntime } from '../src/core/fx';
import { drawEditorFrame, hasThemeColors, MOCK_EFFECTS, sceneRaster } from './lib/chrome';

const OUT_DIR = join(process.cwd(), 'docs', 'images');
const OUT_GIF = join(OUT_DIR, 'hero.gif');
const OUT_POSTER = join(OUT_DIR, 'hero.png');

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

const FRAMES = Math.max(8, Math.trunc(envNumber('HERO_FRAMES', 36)));
const FPS = Math.max(4, Math.trunc(envNumber('HERO_FPS', 12)));
const COLUMNS = Math.max(24, Math.trunc(envNumber('HERO_COLUMNS', 88)));
const WIDTH = Math.max(640, Math.trunc(envNumber('HERO_WIDTH', 1280)));
const HEIGHT = Math.max(400, Math.trunc(envNumber('HERO_HEIGHT', 800)));

/** Frame step in ms; the cell-fx clock advances by exactly this per frame. */
const DT = 1000 / FPS;

/** Effect sliders breathing on a slow sine, so the dock looks alive. */
function effectsAt(phase: number): ReadonlyArray<readonly [string, number]> {
  return MOCK_EFFECTS.map(([name, base], i) => {
    const amount = base + 0.14 * Math.sin(phase + i * 0.6);
    return [name, Math.max(0.04, Math.min(0.96, amount))] as const;
  });
}

/**
 * Wipe position for a frame: 1 = full ASCII, 0 = full photo. Sweeps
 * 1 -> 0 -> 1 over the loop; `frame / FRAMES` (not `FRAMES - 1`) keeps the
 * wrap from frame N-1 to frame 0 the same size as any other step.
 */
function wipeAt(frame: number): number {
  return 0.5 + 0.5 * Math.cos((Math.PI * 2 * frame) / FRAMES);
}

describe('hero gif', () => {
  it(`renders ${FRAMES} frames and encodes docs/images/hero.gif`, () => {
    const theme = THEME_PRESETS.find((t) => t.id === 'medieval') ?? THEME_PRESETS[0];
    expect(hasThemeColors(theme), `${theme.id} missing colours`).toBe(true);

    mkdirSync(OUT_DIR, { recursive: true });
    const frameDir = mkdtempSync(join(tmpdir(), 'cipherascii-hero-'));
    let keepFrames = false;
    try {
      // Ambient pulse: pure sine of pipeline time with a 1 s period, so
      // FRAMES / FPS seconds land back on phase 0 and the GIF loops exactly.
      const cellFx = [{ effect: 'pulse', intensity: 0.8, params: { depth: 0.6, speed: 1 } }] as const;
      cellFxRuntime.sync(cellFx, 42);

      let poster: Buffer | null = null;
      for (let i = 0; i < FRAMES; i++) {
        const phase = (Math.PI * 2 * i) / FRAMES;
        const position = wipeAt(i);
        const png = drawEditorFrame(
          theme,
          phase,
          {
            path: '/ hero / image-to-ascii.aap',
            chipsRight: [`${FPS} fps`, `frame ${i + 1}/${FRAMES}`, 'seed 42'],
            status:
              `Rendering · ${COLUMNS} × 30 cells · truecolor · floyd-steinberg · ` +
              `${Math.round(position * 100)}% ascii`,
            effects: effectsAt(phase),
            columns: COLUMNS,
            caption: 'cipherASCII · image → ASCII studio',
            split: { raster: sceneRaster(420, 260, phase), position },
            transformGrid: (grid) => cellFxRuntime.frame(grid, DT) ?? grid,
          },
          WIDTH,
          HEIGHT,
        );
        writeFileSync(join(frameDir, `frame-${String(i).padStart(3, '0')}.png`), png);
        if (i === 0) poster = png;
      }
      expect(poster).not.toBeNull();
      writeFileSync(OUT_POSTER, poster as Buffer);

      if (process.env.NO_ENCODE) {
        keepFrames = true;
        console.log(`NO_ENCODE=1 - ${FRAMES} frames kept in ${frameDir}`);
        return;
      }

      let hasFfmpeg = true;
      try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      } catch {
        hasFfmpeg = false;
      }
      if (!hasFfmpeg) {
        console.warn('ffmpeg not found - poster written, GIF skipped');
        return;
      }

      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-framerate', String(FPS),
          '-i', join(frameDir, 'frame-%03d.png'),
          '-filter_complex',
          'split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];' +
            '[b][p]paletteuse=dither=bayer:bayer_scale=3',
          '-loop', '0',
          OUT_GIF,
        ],
        { stdio: 'ignore' },
      );

      expect(existsSync(OUT_GIF)).toBe(true);
      const bytes = statSync(OUT_GIF).size;
      console.log(
        `docs/images/hero.gif - ${Math.round(bytes / 1024)} kB, ` +
          `${FRAMES} frames @ ${FPS} fps, ${WIDTH}x${HEIGHT}`,
      );
      // Keep the README asset honest: a hero that weighs more than the code
      // it documents is a bug, not a feature.
      expect(bytes).toBeGreaterThan(10 * 1024);
      expect(bytes).toBeLessThan(6 * 1024 * 1024);
    } finally {
      if (!keepFrames) rmSync(frameDir, { recursive: true, force: true });
    }
  });
});
