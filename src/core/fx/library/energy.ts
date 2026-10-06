/**
 * Energy effects — light, scan and signal.
 *
 * These never move cells; they rewrite colour (and sometimes glyph) to read as
 * emitted light. Persistence and falloff are modelled explicitly so a sweep
 * leaves a trail instead of snapping behind the moving edge.
 */

import { defineEffect } from '../types';
import { GLYPH_BLOCKS, GLYPH_SPARK, boost, centre, cellSalt, dim, mix, restore, sat } from './helpers';

/** Beam: a bright bar crosses the canvas, flaring the cells it touches. */
export const beam = defineEffect<void>({
  id: 'beam',
  label: 'Beam',
  category: 'energy',
  description: 'A bright bar travels across the canvas, flaring the cells it crosses.',
  duration: 1500,
  params: [
    { key: 'width', label: 'Width', min: 1, max: 20, step: 1, default: 3, unit: 'cells' },
    { key: 'gain', label: 'Gain', min: 0, max: 1, step: 0.05, default: 0.85 },
    { key: 'vertical', label: 'Vertical', min: 0, max: 1, step: 1, default: 0 },
  ],
  apply(ctx) {
    const width = Math.max(1, ctx.params.width);
    const gain = ctx.params.gain * ctx.intensity;
    const vertical = ctx.params.vertical > 0.5;
    const span = vertical ? ctx.height : ctx.width;
    const head = mix(-width, span + width, ctx.progress);
    const flare = ctx.intern('█');
    ctx.mask.forEach((x, y, index) => {
      const pos = vertical ? y : x;
      const d = Math.abs(pos - head);
      if (d > width) {
        restore(ctx, index);
        return;
      }
      const falloff = 1 - d / width;
      const onEdge = falloff > 0.6;
      ctx.set(
        index,
        onEdge ? flare : ctx.sourceGlyph[index],
        boost(ctx.sourceFg[index], falloff * gain),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/** Scan: a CRT-style scanline sweeps down with decaying persistence. */
export const scan = defineEffect<void>({
  id: 'scan',
  label: 'Scan',
  category: 'energy',
  description: 'A scanline sweeps down the canvas, leaving a decaying glow behind it.',
  duration: 2400,
  ambient: true,
  params: [
    { key: 'width', label: 'Line width', min: 1, max: 8, step: 1, default: 2, unit: 'rows' },
    { key: 'persistence', label: 'Persistence', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'speed', label: 'Speed', min: 0.25, max: 4, step: 0.25, default: 1 },
  ],
  apply(ctx) {
    const width = Math.max(1, ctx.params.width);
    const persistence = ctx.params.persistence * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed;
    const head = (t % 1) * (ctx.height + width * 2) - width;
    ctx.mask.forEach((_x, y, index) => {
      const delta = y - head;
      if (delta >= 0 && delta < width) {
        ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], 0.9), ctx.sourceBg[index], 255);
        return;
      }
      if (delta < 0 && delta > -ctx.height * persistence) {
        const age = -delta / Math.max(1, ctx.height * persistence);
        const falloff = (1 - age) * 0.45;
        ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], falloff), ctx.sourceBg[index], 255);
        return;
      }
      restore(ctx, index);
    });
  },
});

/** Pulse: brightness breathes across the whole masked area. */
export const pulse = defineEffect<void>({
  id: 'pulse',
  label: 'Pulse',
  category: 'energy',
  description: 'Brightness breathes across the masked area on a smooth sine.',
  duration: 2000,
  ambient: true,
  params: [
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'speed', label: 'Speed', min: 0.25, max: 4, step: 0.25, default: 1 },
  ],
  apply(ctx) {
    const depth = ctx.params.depth * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed * Math.PI * 2;
    const amount = (Math.sin(t) * 0.5 + 0.5) * depth;
    ctx.mask.forEach((_x, _y, index) => {
      ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], amount), ctx.sourceBg[index], 255);
    });
  },
});

/** Spark: isolated cells flash on a rotating duty cycle. */
export const spark = defineEffect<void>({
  id: 'spark',
  label: 'Spark',
  category: 'energy',
  description: 'Isolated cells flash on and off in a deterministic rotating duty cycle.',
  duration: 900,
  ambient: true,
  params: [
    { key: 'density', label: 'Density', min: 0.01, max: 0.5, step: 0.01, default: 0.12 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    const density = ctx.params.density * ctx.intensity;
    const glow = ctx.params.glow;
    const cycle = (ctx.time % 1000) / 1000;
    ctx.mask.forEach((x, y, index) => {
      const phase = cellSalt(ctx, x, y, 41);
      const local = (cycle + phase) % 1;
      if (local < density) {
        const falloff = 1 - local / density;
        ctx.set(
          index,
          ctx.intern(GLYPH_SPARK[Math.floor(cellSalt(ctx, x, y, 43) * GLYPH_SPARK.length)]),
          boost(ctx.sourceFg[index], falloff * glow),
          ctx.sourceBg[index],
          255,
        );
        return;
      }
      restore(ctx, index);
    });
  },
});

/** Lightning: a jagged bolt carves across the canvas row by row. */
export const lightning = defineEffect<void>({
  id: 'lightning',
  label: 'Lightning',
  category: 'energy',
  description: 'A jagged bolt traces a path across the canvas, branching as it goes.',
  duration: 1100,
  params: [
    { key: 'jitter', label: 'Jitter', min: 1, max: 12, step: 1, default: 4, unit: 'cells' },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.9 },
    { key: 'horizontal', label: 'Horizontal', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const jitter = Math.max(1, ctx.params.jitter);
    const glow = ctx.params.glow * ctx.intensity;
    const horizontal = ctx.params.horizontal > 0.5;
    const strike = sat(ctx.progress * 1.6);
    const bolt = ctx.intern('█');
    const spark = ctx.intern('▓');

    // The bolt path is a stable function of progress, so a replayed seed draws
    // exactly the same strike.
    ctx.mask.forEach((x, y, index) => {
      const along = horizontal ? x : y;
      const cross = horizontal ? y : x;
      const span = horizontal ? ctx.width : ctx.height;
      const lane = horizontal ? ctx.height : ctx.width;
      if (along / Math.max(1, span) > strike) {
        restore(ctx, index);
        return;
      }
      const seedSalt = Math.floor(along / 3);
      const center = (lane - 1) / 2;
      const path = center + (cellSalt(ctx, seedSalt, 0, 61) - 0.5) * 2 * jitter;
      const d = Math.abs(cross - path);
      if (d < 0.5) {
        ctx.set(index, bolt, boost(0xffffff, 0), ctx.sourceBg[index], 255);
      } else if (d < 2.5) {
        ctx.set(index, spark, boost(ctx.sourceFg[index], (1 - d / 2.5) * glow), ctx.sourceBg[index], 255);
      } else {
        restore(ctx, index);
      }
    });
  },
});

/** Plasma: overlapping sine fields modulate brightness like an old demo effect. */
export const plasma = defineEffect<void>({
  id: 'plasma',
  label: 'Plasma',
  category: 'energy',
  description: 'Overlapping sine fields modulate brightness — a classic demo-scene plasma.',
  duration: 4000,
  ambient: true,
  params: [
    { key: 'scale', label: 'Scale', min: 0.05, max: 1, step: 0.05, default: 0.25 },
    { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.05, default: 0.6 },
    { key: 'speed', label: 'Speed', min: 0.2, max: 3, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const scale = ctx.params.scale;
    const depth = ctx.params.depth * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed;
    ctx.mask.forEach((x, y, index) => {
      const v =
        Math.sin(x * scale + t) + Math.sin(y * scale * 1.3 - t * 0.8) + Math.sin((x + y) * scale * 0.7 + t * 1.7);
      const norm = (v + 3) / 6;
      const amount = (norm - 0.5) * 2 * depth;
      const color = amount >= 0 ? boost(ctx.sourceFg[index], amount) : dim(ctx.sourceFg[index], -amount);
      ctx.set(index, ctx.sourceGlyph[index], color, ctx.sourceBg[index], 255);
    });
  },
});

/** Radar: a rotating sweep lights the sector it just crossed, then lets it fade. */
export const radar = defineEffect<void>({
  id: 'radar',
  label: 'Radar',
  category: 'energy',
  description: 'A rotating sweep lights the sector it has just crossed and lets it fade behind.',
  duration: 3600,
  ambient: true,
  params: [
    { key: 'speed', label: 'Speed', min: 0.25, max: 4, step: 0.25, default: 1 },
    { key: 'trail', label: 'Trail', min: 0.1, max: 1, step: 0.05, default: 0.6 },
    { key: 'gain', label: 'Gain', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    const [cx, cy] = centre(ctx);
    const sweep = ((ctx.time / 1000) * ctx.params.speed) % 1;
    const trail = Math.max(0.05, ctx.params.trail);
    const gain = ctx.params.gain * ctx.intensity;
    const TAU = Math.PI * 2;
    ctx.mask.forEach((x, y, index) => {
      const dx = x - cx;
      const dy = y - cy;
      if (dx === 0 && dy === 0) {
        restore(ctx, index);
        return;
      }
      const cellAngle = ((Math.atan2(dy, dx) / TAU) + 1) % 1;
      let age = sweep - cellAngle;
      if (age < 0) age += 1;
      if (age > trail) {
        restore(ctx, index);
        return;
      }
      const falloff = 1 - age / trail;
      ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], falloff * gain), ctx.sourceBg[index], 255);
    });
  },
});

export const ENERGY_EFFECTS = [beam, scan, pulse, spark, lightning, plasma, radar];

/** Re-exported so effect authors can dim colours without importing helpers. */
export { dim, GLYPH_BLOCKS };
