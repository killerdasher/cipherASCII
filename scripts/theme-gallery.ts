/**
 * Generates `docs/screenshots/theme-*.png`: one editor preview per theme.
 *
 *   npm run screenshots
 *
 * Every pixel of the artwork is produced by cipherASCII's own pipeline - a
 * synthetic scene goes through `renderImageToGrid` at 104 columns / truecolor
 * / Floyd-Steinberg, and the cells are painted with the same monospace metrics
 * the editor uses. The chrome around it (docks, status bar, chips) is drawn in
 * the active theme's real colours, so the gallery shows what a theme actually
 * does to the app rather than a hand-picked palette.
 *
 * The window itself lives in `scripts/lib/chrome.ts` and is shared with the
 * hero GIF (`npm run hero`).
 *
 * Runs as a vitest script (see `vitest.scripts.config.ts`), which is how the
 * repo's other generators ship.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_PRESETS } from '../src/core/theme/theme';
import { drawEditorFrame, hasThemeColors } from './lib/chrome';

const OUT_DIR = join(process.cwd(), 'docs', 'screenshots');

describe('theme gallery screenshots', () => {
  it('writes one editor preview per theme', () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const written: string[] = [];
    for (const theme of THEME_PRESETS) {
      expect(hasThemeColors(theme), `${theme.id} missing colours`).toBe(true);
      const png = drawEditorFrame(
        theme,
        theme.id.length,
        {
          path: `/ gallery / ${theme.id}.ascii`,
          status: 'Ready · 42 × 1,092 cells · 45 cell effects · 20 raster effects · 82 charsets',
        },
      );
      const file = join(OUT_DIR, `theme-${theme.id}.png`);
      writeFileSync(file, png);
      written.push(file);
    }
    expect(written.length).toBe(THEME_PRESETS.length);
    console.log(`wrote ${written.length} previews to docs/screenshots/`);
    for (const f of written) console.log('  ', f.replace(process.cwd() + '/', ''));
  });
});
