/**
 * Destruction effects — controlled damage.
 *
 * All of these are reversible by default: the content scatters or fractures and
 * then returns, so stacking one on a live document does not destroy the user's
 * grid. Set the `return` parameter to 0 where a permanent break is wanted.
 */

import { defineEffect } from '../types';
import { GLYPH_BLOCKS, GLYPH_CIPHER, boost, cellSalt, dim, mix, moveCell, restore, sat, swing } from './helpers';

/** Crumble: cells detach under gravity, lowest rows first, and fall away. */
export const crumble = defineEffect<void>({
  id: 'crumble',
  label: 'Crumble',
  category: 'destruction',
  description: 'Cells detach and fall in a scattered order, settling back as the effect completes.',
  duration: 1700,
  params: [
    { key: 'fall', label: 'Fall', min: 2, max: 40, step: 1, default: 12, unit: 'cells' },
    { key: 'scatter', label: 'Scatter', min: 0, max: 1, step: 0.05, default: 0.7 },
  ],
  apply(ctx) {
    const fall = ctx.params.fall * ctx.intensity;
    const scatter = ctx.params.scatter;
    ctx.mask.forEach((x, y, index) => {
      const depth = ctx.height > 1 ? 1 - y / (ctx.height - 1) : 0;
      const threshold = depth * scatter * 0.6 + cellSalt(ctx, x, y, 71) * scatter * 0.4;
      const local = sat((ctx.progress - threshold) / Math.max(0.001, 1 - threshold));
      const dy = Math.pow(local, 1.6) * fall * swing(local);
      const dx = (cellSalt(ctx, x, y, 73) - 0.5) * local * 4;
      moveCell(ctx, index, dx, dy);
    });
  },
});

/** Burn: a fire front crosses the canvas, leaving ash behind it. */
export const burn = defineEffect<void>({
  id: 'burn',
  label: 'Burn',
  category: 'destruction',
  description: 'A fire front crosses the canvas: cells flare at the edge and turn to ash behind it.',
  duration: 1600,
  params: [
    { key: 'feather', label: 'Front width', min: 1, max: 30, step: 1, default: 6, unit: 'cells' },
    { key: 'ember', label: 'Ember heat', min: 0, max: 1, step: 0.05, default: 0.85 },
    { key: 'reverse', label: 'Bottom up', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const feather = Math.max(1, ctx.params.feather);
    const ember = ctx.params.ember * ctx.intensity;
    const bottomUp = ctx.params.reverse > 0.5;
    const span = ctx.height + feather;
    const head = ctx.progress * span;
    const ash = ctx.intern('·');
    ctx.mask.forEach((_x, y, index) => {
      const pos = bottomUp ? ctx.height - 1 - y : y;
      const ahead = head - pos;
      if (ahead <= 0) {
        restore(ctx, index);
        return;
      }
      if (ahead >= feather) {
        ctx.set(index, ash, dim(ctx.sourceFg[index], 0.8), -1, 255);
        return;
      }
      const t = ahead / feather;
      const heat = Math.sin(t * Math.PI);
      const emberColor = (0xff << 16) | (Math.round(180 + 60 * heat) << 8) | 40;
      ctx.set(
        index,
        ctx.sourceGlyph[index],
        heat > 0.35 ? emberColor : boost(ctx.sourceFg[index], heat * ember),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/** Glitch: horizontal bands shift, and the shifted cells corrupt. */
export const glitch = defineEffect<void>({
  id: 'glitch',
  label: 'Glitch',
  category: 'destruction',
  description: 'Horizontal bands shift sideways and corrupt their glyphs for the duration of the tear.',
  duration: 900,
  params: [
    { key: 'bands', label: 'Band height', min: 1, max: 12, step: 1, default: 3, unit: 'rows' },
    { key: 'shift', label: 'Max shift', min: 1, max: 40, step: 1, default: 10, unit: 'cells' },
    { key: 'corrupt', label: 'Corruption', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(ctx) {
    const bandH = Math.max(1, ctx.params.bands);
    const shift = ctx.params.shift * ctx.intensity;
    const corrupt = ctx.params.corrupt;
    const tick = Math.floor(ctx.time / 70);
    ctx.blankMasked();
    ctx.mask.forEach((x, y, index) => {
      const band = Math.floor(y / bandH);
      const isActive = cellSalt(ctx, band, tick, 83) < 0.55;
      const offset = isActive ? Math.round((cellSalt(ctx, band, tick, 89) - 0.5) * 2 * shift) : 0;
      const glyph =
        isActive && cellSalt(ctx, band, x + tick, 97) < corrupt
          ? GLYPH_CIPHER[Math.floor(cellSalt(ctx, x, y, tick) * GLYPH_CIPHER.length)]
          : ctx.resolve(ctx.sourceGlyph[index]);
      const target = ctx.intern(glyph);
      if (offset === 0) {
        ctx.set(index, target, ctx.sourceFg[index], ctx.sourceBg[index], 255);
        return;
      }
      const tx = x + offset;
      if (tx < 0 || tx >= ctx.width || !ctx.mask.test(tx, y)) return;
      ctx.set(y * ctx.width + tx, target, ctx.sourceFg[index], ctx.sourceBg[index], 255);
    });
  },
});

/** Fracture: the canvas splits into blocks that shear apart and snap back. */
export const fracture = defineEffect<void>({
  id: 'fracture',
  label: 'Fracture',
  category: 'destruction',
  description: 'The canvas splits into blocks that shear apart along random vectors, then snap back.',
  duration: 1500,
  params: [
    { key: 'block', label: 'Block size', min: 2, max: 24, step: 1, default: 6, unit: 'cells' },
    { key: 'offset', label: 'Shear', min: 1, max: 20, step: 1, default: 6, unit: 'cells' },
  ],
  apply(ctx) {
    const block = Math.max(2, ctx.params.block);
    const offset = ctx.params.offset * ctx.intensity;
    const amount = swing(ctx.progress) * offset;
    ctx.blankMasked();
    ctx.mask.forEach((x, y, index) => {
      const bx = Math.floor(x / block);
      const by = Math.floor(y / block);
      const dx = (cellSalt(ctx, bx, by, 101) - 0.5) * 2 * amount;
      const dy = (cellSalt(ctx, bx, by, 103) - 0.5) * 2 * amount;
      moveCell(ctx, index, dx, dy);
    });
  },
});

/** Corrupt: cells flip to corrupted glyphs and inverted colours. */
export const corrupt = defineEffect<void>({
  id: 'corrupt',
  label: 'Corrupt',
  category: 'destruction',
  description: 'Random cells flip to corrupted glyphs with inverted colours as the damage propagates.',
  duration: 1400,
  params: [
    { key: 'density', label: 'Density', min: 0, max: 1, step: 0.05, default: 0.35 },
    { key: 'invert', label: 'Invert colours', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const density = ctx.params.density * ctx.intensity;
    const invert = ctx.params.invert > 0.5;
    const tick = Math.floor(ctx.time / 80);
    ctx.mask.forEach((x, y, index) => {
      const r = cellSalt(ctx, x, y, 107);
      if (r > density * sat(ctx.progress * 1.5)) {
        restore(ctx, index);
        return;
      }
      const glyph = cellSalt(ctx, x, y, 109 + tick) < 0.5 ? GLYPH_BLOCKS[Math.floor(cellSalt(ctx, x, y, 113) * GLYPH_BLOCKS.length)] : GLYPH_CIPHER[Math.floor(cellSalt(ctx, x, y, 127) * GLYPH_CIPHER.length)];
      const fg = ctx.sourceFg[index];
      const color = invert && fg !== -1 ? (0xffffff ^ (fg & 0xffffff)) & 0xffffff : boost(fg, 0.3);
      ctx.set(index, ctx.intern(glyph), color, ctx.sourceBg[index], 255);
    });
  },
});

/** Collapse: the field is crushed toward the centre line, then rebounds. */
export const collapse = defineEffect<void>({
  id: 'collapse',
  label: 'Collapse',
  category: 'destruction',
  description: 'The field crushes toward its centre and rebounds — a controlled implosion.',
  duration: 1500,
  params: [
    { key: 'strength', label: 'Strength', min: 0.1, max: 1, step: 0.05, default: 0.7 },
    { key: 'vertical', label: 'Axis', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const strength = ctx.params.strength * ctx.intensity;
    const vertical = ctx.params.vertical > 0.5;
    const cx = (ctx.width - 1) / 2;
    const cy = (ctx.height - 1) / 2;
    const amount = swing(ctx.progress) * strength;
    ctx.blankMasked();
    ctx.mask.forEach((x, y, index) => {
      if (vertical) {
        moveCell(ctx, index, (cx - x) * amount, 0);
      } else {
        moveCell(ctx, index, 0, (cy - y) * amount);
      }
    });
  },
});

/** Scatter: cells burst outward in random directions and reassemble. */
export const scatter = defineEffect<void>({
  id: 'scatter',
  label: 'Scatter',
  category: 'destruction',
  description: 'Cells burst outward in random directions and reassemble as the effect completes.',
  duration: 1500,
  params: [
    { key: 'distance', label: 'Distance', min: 1, max: 30, step: 1, default: 8, unit: 'cells' },
    { key: 'spread', label: 'Spread', min: 0.1, max: 2, step: 0.1, default: 0.8 },
  ],
  apply(ctx) {
    const distance = ctx.params.distance * ctx.intensity;
    const spread = ctx.params.spread;
    const amount = swing(ctx.progress) * distance;
    ctx.blankMasked();
    ctx.mask.forEach((x, y, index) => {
      const angle = cellSalt(ctx, x, y, 131) * Math.PI * 2;
      const speed = 0.4 + cellSalt(ctx, x, y, 137) * spread;
      moveCell(ctx, index, Math.cos(angle) * amount * speed, Math.sin(angle) * amount * speed);
    });
  },
});

export const DESTRUCTION_EFFECTS = [crumble, burn, glitch, fracture, corrupt, collapse, scatter];

export { mix };
