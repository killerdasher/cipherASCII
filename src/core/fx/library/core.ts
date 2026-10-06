/**
 * Core reveal / transform effects.
 *
 * These are the effects a title sequence is built from: they all read the
 * source snapshot and animate *toward* it (or away from it), which is why they
 * settle instead of running forever.
 */

import { defineEffect, type EffectContext } from '../types';
import { GLYPH_CIPHER, GLYPH_MIXED, boost, cellSalt, dim, mix, pick, restore, sat } from './helpers';

function scrambleGlyph(ctx: EffectContext, x: number, y: number, salt: number, pool: string): number {
  return ctx.intern(pick(ctx, pool, x, y, salt));
}

/** Decrypt: cells churn through cipher glyphs, then lock onto the source. */
export const decrypt = defineEffect<void>({
  id: 'decrypt',
  label: 'Decrypt',
  category: 'core',
  description: 'Cells cycle through cipher glyphs and lock onto the source as the reveal progresses.',
  duration: 1400,
  params: [
    { key: 'chaos', label: 'Chaos', min: 0, max: 1, step: 0.05, default: 0.75 },
    { key: 'churn', label: 'Churn rate', min: 20, max: 400, step: 10, default: 90, unit: 'ms' },
  ],
  apply(ctx) {
    const chaos = ctx.params.chaos;
    const churnMs = Math.max(16, ctx.params.churn);
    const salt = Math.floor(ctx.time / churnMs);
    const intensity = ctx.intensity;
    ctx.mask.forEach((x, y, index) => {
      const threshold = cellSalt(ctx, x, y, 11) * chaos;
      if (ctx.progress >= sat(threshold + 0.02)) {
        restore(ctx, index);
        return;
      }
      const t = sat(ctx.progress / Math.max(0.001, threshold + 0.02));
      const fg = ctx.sourceFg[index];
      ctx.set(
        index,
        scrambleGlyph(ctx, x, y, salt + index, GLYPH_CIPHER),
        boost(fg, (1 - t) * 0.35 * intensity),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/** Scramble: a standing field of mutating cipher glyphs (ambient). */
export const scramble = defineEffect<void>({
  id: 'scramble',
  label: 'Scramble',
  category: 'core',
  description: 'A continuous field of mutating cipher glyphs over the masked cells.',
  duration: 1200,
  ambient: true,
  params: [
    { key: 'density', label: 'Density', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'churn', label: 'Churn rate', min: 30, max: 600, step: 10, default: 120, unit: 'ms' },
  ],
  apply(ctx) {
    const density = ctx.params.density * ctx.intensity;
    const churn = Math.max(16, ctx.params.churn);
    const salt = Math.floor(ctx.time / churn);
    ctx.mask.forEach((x, y, index) => {
      const r = cellSalt(ctx, x, y, 3);
      if (r > density) {
        restore(ctx, index);
        return;
      }
      ctx.set(index, scrambleGlyph(ctx, x, y, salt, GLYPH_MIXED), boost(ctx.sourceFg[index], 0.2), ctx.sourceBg[index], 255);
    });
  },
});

/** Typewriter: reveals the source cell by cell along reading order. */
export const typewriter = defineEffect<void>({
  id: 'typewriter',
  label: 'Typewriter',
  category: 'core',
  description: 'Reveals cells in reading order with a cursor riding the wavefront.',
  duration: 1600,
  params: [
    { key: 'cursor', label: 'Cursor', min: 0, max: 1, step: 1, default: 1 },
    { key: 'feather', label: 'Feather', min: 1, max: 40, step: 1, default: 6, unit: 'cells' },
  ],
  apply(ctx) {
    const feather = Math.max(1, ctx.params.feather);
    const total = Math.max(1, ctx.width * ctx.height);
    const head = ctx.progress * (total + feather);
    const cursorGlyph = ctx.intern('█');
    ctx.mask.forEach((x, y, index) => {
      const pos = y * ctx.width + x;
      const ahead = head - pos;
      if (ahead >= feather) {
        restore(ctx, index);
        return;
      }
      if (ahead <= 0) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      if (ctx.params.cursor > 0 && ahead < 2) {
        ctx.set(index, cursorGlyph, boost(ctx.sourceFg[index], 0.6), ctx.sourceBg[index], 255);
        return;
      }
      const t = ahead / feather;
      ctx.set(index, ctx.sourceGlyph[index], dim(ctx.sourceFg[index], 1 - t), ctx.sourceBg[index], 255);
    });
  },
});

/** Dissolve: cells decay to nothing in a scattered order. */
export const dissolve = defineEffect<void>({
  id: 'dissolve',
  label: 'Dissolve',
  category: 'core',
  description: 'Cells fade and blank out in a stable scattered order.',
  duration: 1200,
  params: [{ key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.05, default: 0.8 }],
  apply(ctx) {
    const scatter = ctx.params.scatter;
    ctx.mask.forEach((x, y, index) => {
      const threshold = cellSalt(ctx, x, y, 17) * scatter;
      const local = sat((ctx.progress - threshold) / Math.max(0.001, 1 - threshold));
      if (local <= 0) {
        restore(ctx, index);
        return;
      }
      if (local >= 1) {
        ctx.set(index, ctx.intern(' '), -1, ctx.sourceBg[index], 255);
        return;
      }
      ctx.set(index, ctx.sourceGlyph[index], dim(ctx.sourceFg[index], local), ctx.sourceBg[index], Math.round(255 * (1 - local)));
    });
  },
});

/** Assemble: cells appear from nothing in a scattered order. */
export const assemble = defineEffect<void>({
  id: 'assemble',
  label: 'Assemble',
  category: 'core',
  description: 'Cells materialise from nothing in a stable scattered order.',
  duration: 1300,
  params: [
    { key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: 'spark', label: 'Arrival flash', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  apply(ctx) {
    const scatter = ctx.params.scatter;
    const spark = ctx.params.spark * ctx.intensity;
    ctx.mask.forEach((x, y, index) => {
      const threshold = cellSalt(ctx, x, y, 23) * scatter;
      const local = sat((ctx.progress - threshold) / Math.max(0.001, 1 - threshold));
      if (local <= 0) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      const arriving = local > 0.85 ? (local - 0.85) / 0.15 : 0;
      ctx.set(
        index,
        ctx.sourceGlyph[index],
        boost(ctx.sourceFg[index], arriving * spark),
        ctx.sourceBg[index],
        Math.max(1, Math.round(255 * local)),
      );
    });
  },
});

/** Disassemble: the mirror of assemble — cells leave in scattered order. */
export const disassemble = defineEffect<void>({
  id: 'disassemble',
  label: 'Disassemble',
  category: 'core',
  description: 'Cells vanish in a scattered order, flashing as each one departs.',
  duration: 1300,
  params: [
    { key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.05, default: 0.7 },
    { key: 'spark', label: 'Departure flash', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(ctx) {
    const scatter = ctx.params.scatter;
    const spark = ctx.params.spark * ctx.intensity;
    ctx.mask.forEach((x, y, index) => {
      const threshold = cellSalt(ctx, x, y, 29) * scatter;
      const local = sat((ctx.progress - threshold) / Math.max(0.001, 1 - threshold));
      if (local <= 0) {
        restore(ctx, index);
        return;
      }
      if (local >= 1) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      const leaving = local < 0.15 ? 1 - local / 0.15 : 0;
      ctx.set(
        index,
        ctx.sourceGlyph[index],
        boost(ctx.sourceFg[index], leaving * spark),
        ctx.sourceBg[index],
        Math.max(1, Math.round(255 * (1 - local))),
      );
    });
  },
});

/** Fade: a straight opacity ramp over the masked cells. */
export const fade = defineEffect<void>({
  id: 'fade',
  label: 'Fade',
  category: 'core',
  description: 'Opacity ramp over the masked cells — the quietest transition in the library.',
  duration: 800,
  params: [
    { key: 'floor', label: 'Floor opacity', min: 0, max: 1, step: 0.05, default: 0 },
    { key: 'fadeTo', label: 'Direction', min: 0, max: 1, step: 1, default: 0 },
  ],
  apply(ctx) {
    const floor = ctx.params.floor;
    const fadeIn = ctx.params.fadeTo > 0.5;
    const t = fadeIn ? 1 - ctx.progress : ctx.progress;
    const opacity = mix(1, floor, t);
    const alpha = Math.max(1, Math.round(255 * opacity));
    ctx.mask.forEach((_x, _y, index) => {
      ctx.set(index, ctx.sourceGlyph[index], ctx.sourceFg[index], ctx.sourceBg[index], alpha);
    });
  },
});

/** Reveal: source appears behind a soft moving edge. */
export const reveal = defineEffect<void>({
  id: 'reveal',
  label: 'Reveal',
  category: 'core',
  description: 'A soft edge sweeps across, leaving the source revealed behind it.',
  duration: 1000,
  params: [
    { key: 'feather', label: 'Feather', min: 1, max: 60, step: 1, default: 10, unit: 'cells' },
    { key: 'angle', label: 'Diagonal', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const feather = Math.max(1, ctx.params.feather);
    const diagonal = ctx.params.angle > 0.5;
    const span = diagonal ? ctx.width + ctx.height : ctx.width;
    const head = ctx.progress * (span + feather);
    ctx.mask.forEach((x, y, index) => {
      const pos = diagonal ? x + y : x;
      const ahead = head - pos;
      if (ahead >= feather) {
        restore(ctx, index);
        return;
      }
      if (ahead <= 0) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      const t = ahead / feather;
      ctx.set(
        index,
        ctx.sourceGlyph[index],
        boost(ctx.sourceFg[index], (1 - t) * 0.5),
        ctx.sourceBg[index],
        Math.max(1, Math.round(255 * t)),
      );
    });
  },
});

/** Wipe: a moving edge erases everything it has passed. */
export const wipe = defineEffect<void>({
  id: 'wipe',
  label: 'Wipe',
  category: 'core',
  description: 'A moving edge erases cells behind it, leaving clean space.',
  duration: 1000,
  params: [
    { key: 'feather', label: 'Feather', min: 1, max: 40, step: 1, default: 6, unit: 'cells' },
    { key: 'ember', label: 'Edge heat', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(ctx) {
    const feather = Math.max(1, ctx.params.feather);
    const ember = ctx.params.ember * ctx.intensity;
    const head = ctx.progress * (ctx.width + feather);
    ctx.mask.forEach((x, _y, index) => {
      const ahead = head - x;
      if (ahead <= 0) {
        restore(ctx, index);
        return;
      }
      if (ahead >= feather) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      const t = ahead / feather;
      ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], t * ember), ctx.sourceBg[index], 255);
    });
  },
});

/** Sweep: a highlight band crosses the canvas, lifting brightness as it passes. */
export const sweep = defineEffect<void>({
  id: 'sweep',
  label: 'Sweep',
  category: 'core',
  description: 'A highlight band crosses the canvas and leaves the source untouched behind it.',
  duration: 1400,
  params: [
    { key: 'width', label: 'Band width', min: 2, max: 80, step: 1, default: 18, unit: 'cells' },
    { key: 'gain', label: 'Highlight', min: 0, max: 1, step: 0.05, default: 0.75 },
  ],
  apply(ctx) {
    const band = Math.max(2, ctx.params.width);
    const gain = ctx.params.gain * ctx.intensity;
    const head = mix(-band, ctx.width + band, ctx.progress);
    ctx.mask.forEach((x, _y, index) => {
      const d = Math.abs(x - head);
      if (d > band) {
        restore(ctx, index);
        return;
      }
      const falloff = 1 - d / band;
      ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], falloff * gain), ctx.sourceBg[index], 255);
    });
  },
});

export const CORE_EFFECTS = [decrypt, scramble, typewriter, dissolve, assemble, disassemble, fade, reveal, wipe, sweep];
