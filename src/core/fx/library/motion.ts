/**
 * Motion effects.
 *
 * Every effect here displaces the source snapshot: the masked cells are blanked
 * once, then each source cell is written at an offset position. Ambient effects
 * use continuous time (they never settle); one-shot effects ride a `swing`
 * envelope so the content ends up exactly where it started.
 */

import { defineEffect } from '../types';
import { cellSalt, centre, mix, moveCell, radial, sat, swing } from './helpers';

interface Offset {
  dx: number;
  dy: number;
}

/** Orbit: every cell circles its own home position with a coherent phase. */
export const orbit = defineEffect<void>({
  id: 'orbit',
  label: 'Orbit',
  category: 'motion',
  description: 'Cells circle their home positions with a phase that sweeps across the canvas.',
  duration: 4000,
  ambient: true,
  params: [
    { key: 'radius', label: 'Radius', min: 0.5, max: 8, step: 0.5, default: 1.5, unit: 'cells' },
    { key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const radius = ctx.params.radius * ctx.intensity;
    const phase = (ctx.time / 1000) * ctx.params.speed * Math.PI * 2;
    ctx.mask.forEach((x, y, index) => {
      const a = phase + (x + y) * 0.35;
      moveCell(ctx, index, Math.cos(a) * radius, Math.sin(a) * radius);
    });
  },
});

/** Spiral: cells drift around the centre while spiralling inward and back. */
export const spiral = defineEffect<void>({
  id: 'spiral',
  label: 'Spiral',
  category: 'motion',
  description: 'Cells swirl around the centre, pulled inward and released on a loop.',
  duration: 5000,
  ambient: true,
  params: [
    { key: 'strength', label: 'Strength', min: 0, max: 4, step: 0.1, default: 1.2, unit: 'cells' },
    { key: 'turns', label: 'Turns', min: 0.1, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const [cx, cy] = centre(ctx);
    const strength = ctx.params.strength * ctx.intensity;
    const turns = ctx.params.turns;
    const t = ctx.time / 1000;
    ctx.mask.forEach((x, y, index) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const pull = Math.sin(t * Math.PI + dist * 0.4) * strength;
      const spin = (t * turns * Math.PI * 2) / Math.max(1, dist);
      const cos = Math.cos(spin);
      const sin = Math.sin(spin);
      const ux = dx / dist;
      const uy = dy / dist;
      moveCell(ctx, index, dx * (cos - 1) - dy * sin + ux * pull, dx * sin + dy * (cos - 1) + uy * pull);
    });
  },
});

/** Swarm: cells drift on independent noise, as if stirred. */
export const swarm = defineEffect<void>({
  id: 'swarm',
  label: 'Swarm',
  category: 'motion',
  description: 'Cells wander on independent deterministic noise — a stirred field.',
  duration: 6000,
  ambient: true,
  params: [
    { key: 'amplitude', label: 'Amplitude', min: 0.5, max: 10, step: 0.5, default: 2, unit: 'cells' },
    { key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const amp = ctx.params.amplitude * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed;
    ctx.mask.forEach((x, y, index) => {
      const p = cellSalt(ctx, x, y, 5) * Math.PI * 2;
      const q = cellSalt(ctx, x, y, 9) * Math.PI * 2;
      const dx = Math.sin(t * 1.7 + p) * amp * (0.5 + cellSalt(ctx, x, y, 13));
      const dy = Math.cos(t * 1.3 + q) * amp * (0.5 + cellSalt(ctx, x, y, 19));
      moveCell(ctx, index, dx, dy);
    });
  },
});

/** Attract: the field breathes inward toward the centre. */
export const attract = defineEffect<void>({
  id: 'attract',
  label: 'Attract',
  category: 'motion',
  description: 'Cells are drawn toward the centre and released, breathing the shape inward.',
  duration: 3200,
  ambient: true,
  params: [
    { key: 'pull', label: 'Pull', min: 0, max: 8, step: 0.25, default: 2, unit: 'cells' },
    { key: 'speed', label: 'Speed', min: 0.2, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const [cx, cy] = centre(ctx);
    const pull = ctx.params.pull * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed;
    const amount = (Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * pull;
    ctx.mask.forEach((x, y, index) => {
      const dx = cx - x;
      const dy = cy - y;
      const dist = Math.hypot(dx, dy) || 1;
      const k = amount * sat(dist / Math.max(cx, cy));
      moveCell(ctx, index, (dx / dist) * k, (dy / dist) * k);
    });
  },
});

/** Repel: the field pushes outward from the centre. */
export const repel = defineEffect<void>({
  id: 'repel',
  label: 'Repel',
  category: 'motion',
  description: 'Cells are pushed away from the centre and drawn back on a loop.',
  duration: 3200,
  ambient: true,
  params: [
    { key: 'push', label: 'Push', min: 0, max: 8, step: 0.25, default: 2, unit: 'cells' },
    { key: 'speed', label: 'Speed', min: 0.2, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const [cx, cy] = centre(ctx);
    const push = ctx.params.push * ctx.intensity;
    const t = (ctx.time / 1000) * ctx.params.speed;
    const amount = (Math.sin(t * Math.PI * 2) * 0.5 + 0.5) * push;
    ctx.mask.forEach((x, y, index) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const k = amount * sat(dist / Math.max(cx, cy));
      moveCell(ctx, index, (dx / dist) * k, (dy / dist) * k);
    });
  },
});

/** Gravity: the field sags downward row by row, then recovers. */
export const gravity = defineEffect<void>({
  id: 'gravity',
  label: 'Gravity',
  category: 'motion',
  description: 'Rows sag downward in sequence under gravity and recover — a drop-and-settle.',
  duration: 1800,
  params: [
    { key: 'fall', label: 'Fall', min: 1, max: 30, step: 1, default: 8, unit: 'cells' },
    { key: 'stagger', label: 'Row stagger', min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  apply(ctx) {
    const fall = ctx.params.fall * ctx.intensity;
    const stagger = ctx.params.stagger;
    const rows = Math.max(1, ctx.height - 1);
    ctx.mask.forEach((_x, y, index) => {
      const rowDelay = (y / rows) * stagger;
      const local = sat((ctx.progress - rowDelay) / Math.max(0.001, 1 - rowDelay));
      const dy = Math.pow(local, 2) * fall * swing(local);
      moveCell(ctx, index, 0, dy);
    });
  },
});

/** Magnetic: cells snap toward a coarse lattice, then relax. */
export const magnetic = defineEffect<void>({
  id: 'magnetic',
  label: 'Magnetic',
  category: 'motion',
  description: 'Cells are pulled onto a coarse lattice and released — a snap-and-return.',
  duration: 1600,
  params: [
    { key: 'pitch', label: 'Lattice pitch', min: 2, max: 16, step: 1, default: 4, unit: 'cells' },
    { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    const pitch = Math.max(2, ctx.params.pitch);
    const strength = ctx.params.strength * ctx.intensity;
    const amount = swing(ctx.progress) * strength;
    ctx.mask.forEach((x, y, index) => {
      const sx = Math.round(x / pitch) * pitch;
      const sy = Math.round(y / pitch) * pitch;
      moveCell(ctx, index, (sx - x) * amount, (sy - y) * amount);
    });
  },
});

/** Wave: a sinusoidal shear travels across the canvas. */
export const wave = defineEffect<void>({
  id: 'wave',
  label: 'Wave',
  category: 'motion',
  description: 'A sinusoidal shear travels across the canvas, lifting and dropping rows.',
  duration: 3000,
  ambient: true,
  params: [
    { key: 'amplitude', label: 'Amplitude', min: 0.5, max: 12, step: 0.5, default: 2, unit: 'cells' },
    { key: 'frequency', label: 'Frequency', min: 0.1, max: 3, step: 0.1, default: 0.5 },
    { key: 'speed', label: 'Speed', min: 0.2, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const amp = ctx.params.amplitude * ctx.intensity;
    const freq = ctx.params.frequency;
    const t = (ctx.time / 1000) * ctx.params.speed * Math.PI * 2;
    ctx.mask.forEach((x, _y, index) => {
      const dy = Math.sin(x * freq * 0.5 + t) * amp;
      moveCell(ctx, index, 0, dy);
    });
  },
});

/** Ripple: concentric rings push cells radially outward and back. */
export const ripple = defineEffect<void>({
  id: 'ripple',
  label: 'Ripple',
  category: 'motion',
  description: 'Concentric rings radiate from the centre, displacing cells as they pass.',
  duration: 3600,
  ambient: true,
  params: [
    { key: 'amplitude', label: 'Amplitude', min: 0.5, max: 10, step: 0.5, default: 2, unit: 'cells' },
    { key: 'frequency', label: 'Frequency', min: 0.1, max: 4, step: 0.1, default: 1 },
    { key: 'speed', label: 'Speed', min: 0.2, max: 4, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const [cx, cy] = centre(ctx);
    const amp = ctx.params.amplitude * ctx.intensity;
    const freq = ctx.params.frequency;
    const t = (ctx.time / 1000) * ctx.params.speed * Math.PI * 2;
    ctx.mask.forEach((x, y, index) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const offset = Math.sin(dist * freq * 0.6 - t) * amp;
      moveCell(ctx, index, (dx / dist) * offset, (dy / dist) * offset);
    });
  },
});

/** Radial helper re-exported for effects that need normalised distance. */
export { radial, mix, type Offset };

export const MOTION_EFFECTS = [orbit, spiral, swarm, attract, repel, gravity, magnetic, wave, ripple];
