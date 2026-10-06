/**
 * Atmospheric effects — weather and ambient matter.
 *
 * Rain, dust, smoke, stars and embers are *additive*: they light cells on top
 * of the source content instead of replacing it, so they can be stacked under
 * an artwork layer without destroying it. `particles` is the one effect that
 * runs a real pooled {@link ParticleSystem}.
 */

import { ParticleSystem } from '../../particles/particles';
import { defineEffect, type EffectContext } from '../types';
import { boost, cellSalt, dim, restore, sat } from './helpers';

/** Rain: per-column falling streams with a bright head and a decaying tail. */
export const rain = defineEffect<void>({
  id: 'rain',
  label: 'Rain',
  category: 'atmosphere',
  description: 'Per-column falling streams with a bright head and a decaying tail.',
  duration: 3000,
  ambient: true,
  params: [
    { key: 'speed', label: 'Speed', min: 5, max: 80, step: 1, default: 28, unit: 'rows/s' },
    { key: 'trail', label: 'Trail', min: 2, max: 30, step: 1, default: 10, unit: 'rows' },
    { key: 'coverage', label: 'Coverage', min: 0.1, max: 1, step: 0.05, default: 0.7 },
  ],
  apply(ctx) {
    const speed = ctx.params.speed * (0.5 + ctx.intensity);
    const trail = Math.max(1, ctx.params.trail);
    const coverage = ctx.params.coverage;
    const span = ctx.height + trail;
    const seconds = ctx.time / 1000;
    const headGlyph = ctx.intern('█');
    ctx.mask.forEach((x, y, index) => {
      if (cellSalt(ctx, x, 0, 149) > coverage) {
        restore(ctx, index);
        return;
      }
      const offset = cellSalt(ctx, x, 0, 151) * span;
      const head = (seconds * speed + offset) % span;
      const d = head - y;
      if (d < 0 || d > trail) {
        restore(ctx, index);
        return;
      }
      const falloff = 1 - d / trail;
      const glyph = d < 1 ? headGlyph : ctx.intern(d < trail * 0.4 ? '▅' : '▁');
      ctx.set(index, glyph, boost(ctx.sourceFg[index], falloff * 0.7), ctx.sourceBg[index], 255);
    });
  },
});

/** Dust: sparse specks drift and shimmer over the content. */
export const dust = defineEffect<void>({
  id: 'dust',
  label: 'Dust',
  category: 'atmosphere',
  description: 'Sparse specks drift and shimmer over the content.',
  duration: 5000,
  ambient: true,
  params: [
    { key: 'density', label: 'Density', min: 0.01, max: 0.4, step: 0.01, default: 0.08 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'drift', label: 'Drift', min: 0.1, max: 3, step: 0.1, default: 1 },
  ],
  apply(ctx) {
    const density = ctx.params.density * ctx.intensity;
    const glow = ctx.params.glow;
    const drift = ctx.params.drift;
    const seconds = (ctx.time / 1000) * drift;
    ctx.mask.forEach((x, y, index) => {
      const seed = cellSalt(ctx, x, y, 157);
      if (seed > density) {
        restore(ctx, index);
        return;
      }
      const phase = (seconds * 0.4 + seed * 7) % 1;
      const shimmer = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
      ctx.set(index, ctx.intern('·'), boost(ctx.sourceFg[index], shimmer * glow), ctx.sourceBg[index], 255);
    });
  },
});

/** Smoke: soft columns rise and thin out as they climb. */
export const smoke = defineEffect<void>({
  id: 'smoke',
  label: 'Smoke',
  category: 'atmosphere',
  description: 'Soft columns rise and thin as they climb, dimming the content beneath.',
  duration: 4200,
  ambient: true,
  params: [
    { key: 'rise', label: 'Rise', min: 1, max: 20, step: 1, default: 6, unit: 'rows/s' },
    { key: 'density', label: 'Density', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'width', label: 'Column width', min: 1, max: 12, step: 1, default: 4, unit: 'cells' },
  ],
  apply(ctx) {
    const rise = ctx.params.rise;
    const density = ctx.params.density * ctx.intensity;
    const width = Math.max(1, ctx.params.width);
    const seconds = ctx.time / 1000;
    ctx.mask.forEach((x, y, index) => {
      const col = Math.floor(x / width);
      const seed = cellSalt(ctx, col, 0, 163);
      if (seed > density) {
        restore(ctx, index);
        return;
      }
      const rising = (y + seconds * rise * (0.6 + seed)) % ctx.height;
      const thin = 1 - rising / Math.max(1, ctx.height);
      const wobble = Math.sin(rising * 0.5 + seconds * 2 + seed * 10) * 0.5 + 0.5;
      const amount = sat(thin * wobble);
      if (amount < 0.12) {
        restore(ctx, index);
        return;
      }
      ctx.set(
        index,
        ctx.intern(amount > 0.6 ? '░' : '·'),
        dim(ctx.sourceFg[index], amount * 0.5),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/** Stars: fixed points twinkle with independent phases. */
export const stars = defineEffect<void>({
  id: 'stars',
  label: 'Stars',
  category: 'atmosphere',
  description: 'Fixed points twinkle with independent phases over the content.',
  duration: 2600,
  ambient: true,
  params: [
    { key: 'density', label: 'Density', min: 0.01, max: 0.3, step: 0.01, default: 0.05 },
    { key: 'rate', label: 'Twinkle rate', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.9 },
  ],
  apply(ctx) {
    const density = ctx.params.density * ctx.intensity;
    const rate = ctx.params.rate;
    const glow = ctx.params.glow;
    const t = (ctx.time / 1000) * rate * Math.PI * 2;
    const star = ctx.intern('✦');
    const dot = ctx.intern('·');
    ctx.mask.forEach((x, y, index) => {
      const seed = cellSalt(ctx, x, y, 167);
      if (seed > density) {
        restore(ctx, index);
        return;
      }
      const phase = seed * Math.PI * 20;
      const twinkle = Math.sin(t + phase) * 0.5 + 0.5;
      const glyph = twinkle > 0.7 ? star : twinkle > 0.35 ? dot : ctx.sourceGlyph[index];
      ctx.set(index, glyph, twinkle > 0.35 ? boost(0xffffff, 0) : boost(ctx.sourceFg[index], twinkle * glow), ctx.sourceBg[index], 255);
    });
  },
});

/** Embers: bright motes rise from the bottom edge and burn out. */
export const embers = defineEffect<void>({
  id: 'embers',
  label: 'Embers',
  category: 'atmosphere',
  description: 'Bright motes rise from the bottom edge, flicker and burn out.',
  duration: 3800,
  ambient: true,
  params: [
    { key: 'rise', label: 'Rise', min: 2, max: 30, step: 1, default: 10, unit: 'rows/s' },
    { key: 'density', label: 'Density', min: 0.01, max: 0.3, step: 0.01, default: 0.06 },
    { key: 'heat', label: 'Heat', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    const rise = ctx.params.rise;
    const density = ctx.params.density * ctx.intensity;
    const heat = ctx.params.heat;
    const seconds = ctx.time / 1000;
    ctx.mask.forEach((x, y, index) => {
      const seed = cellSalt(ctx, x, y, 173);
      if (seed > density) {
        restore(ctx, index);
        return;
      }
      const travel = ctx.height + 4;
      const age = (seconds * rise * (0.5 + seed) + seed * travel) % travel;
      const height = ctx.height - age;
      const dist = Math.abs(y - height);
      if (dist > 1.5) {
        restore(ctx, index);
        return;
      }
      const flicker = Math.sin(seconds * 12 + seed * 40) * 0.5 + 0.5;
      const falloff = 1 - dist / 1.5;
      const color = (0xff << 16) | (Math.round(120 + 100 * flicker) << 8) | 30;
      ctx.set(index, ctx.intern(flicker > 0.6 ? '✶' : '·'), boost(color, falloff * heat), ctx.sourceBg[index], 255);
    });
  },
});

interface ParticleState {
  system: ParticleSystem;
  elapsed: number;
  acc: number;
}

/** Particles: a pooled emitter writing real particle records. */
export const particles = defineEffect<ParticleState>({
  id: 'particles',
  label: 'Particles',
  category: 'atmosphere',
  description: 'A pooled particle field: spawn, drift, expire and recycle — no per-frame allocation.',
  duration: 6000,
  ambient: true,
  params: [
    { key: 'rate', label: 'Spawn rate', min: 1, max: 200, step: 1, default: 40, unit: '/s' },
    { key: 'life', label: 'Lifetime', min: 200, max: 6000, step: 100, default: 2400, unit: 'ms' },
    { key: 'drift', label: 'Drift', min: 0, max: 30, step: 1, default: 6, unit: 'cells/s' },
    { key: 'gravity', label: 'Gravity', min: -20, max: 20, step: 1, default: -2, unit: 'cells/s²' },
  ],
  createState: () => ({
    system: new ParticleSystem({ capacity: 400, gravity: 0, damping: 0.4 }),
    elapsed: 0,
    acc: 0,
  }),
  apply(ctx, state) {
    const rate = ctx.params.rate * ctx.intensity;
    const life = ctx.params.life;
    const drift = ctx.params.drift;
    state.system.gravity = ctx.params.gravity;
    state.elapsed += ctx.dt;
    state.acc += (ctx.dt / 1000) * rate;
    while (state.acc >= 1) {
      state.acc -= 1;
      const x = ctx.rng.next() * ctx.width;
      const y = ctx.height - 1;
      state.system.spawn({
        x,
        y,
        vx: (ctx.rng.next() - 0.5) * drift,
        vy: -drift * (0.4 + ctx.rng.next() * 0.6),
        life,
        glyph: ctx.intern(ctx.rng.next() > 0.5 ? '·' : '*'),
      });
    }
    state.system.update(ctx.dt);

    // Restore the source first, then stamp live particles on top, so a
    // particle that expired this frame cannot leave a ghost behind.
    ctx.mask.forEach((_x, _y, index) => restore(ctx, index));
    const pos = { x: 0, y: 0 };
    const n = state.system.alive;
    for (let i = 0; i < n; i++) {
      state.system.position(i, pos);
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) continue;
      if (!ctx.mask.test(x, y)) continue;
      const index = y * ctx.width + x;
      const lifeFrac = state.system.lifeAt(i);
      ctx.set(index, state.system.glyphAt(i), boost(ctx.sourceFg[index], lifeFrac * 0.6), ctx.sourceBg[index], 255);
    }
  },
  reset(state) {
    state.system.clear();
    state.elapsed = 0;
    state.acc = 0;
  },
});

/** Noise: per-cell brightness grain that re-rolls every few frames. */
export const noise = defineEffect<void>({
  id: 'noise',
  label: 'Noise',
  category: 'atmosphere',
  description: 'Per-cell brightness grain that re-rolls on a fixed cadence.',
  duration: 2000,
  ambient: true,
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.05, default: 0.45 },
    { key: 'cadence', label: 'Cadence', min: 30, max: 400, step: 10, default: 90, unit: 'ms' },
  ],
  apply(ctx) {
    const amount = ctx.params.amount * ctx.intensity;
    const cadence = Math.max(16, ctx.params.cadence);
    const tick = Math.floor(ctx.time / cadence);
    ctx.mask.forEach((x, y, index) => {
      const n = cellSalt(ctx, x, y, tick + 179);
      const signed = (n - 0.5) * 2 * amount;
      const color = signed >= 0 ? boost(ctx.sourceFg[index], signed) : dim(ctx.sourceFg[index], -signed);
      ctx.set(index, ctx.sourceGlyph[index], color, ctx.sourceBg[index], 255);
    });
  },
});

/** Build a context-independent rain/plasma helper for tests. */
export function sampleRain(ctx: EffectContext, column: number, y: number, speed: number, trail: number): number {
  const span = ctx.height + trail;
  const head = ((ctx.time / 1000) * speed + cellSalt(ctx, column, 0, 151) * span) % span;
  const d = head - y;
  return d >= 0 && d <= trail ? 1 - d / trail : 0;
}

export const ATMOSPHERE_EFFECTS = [rain, dust, smoke, stars, embers, particles, noise];
