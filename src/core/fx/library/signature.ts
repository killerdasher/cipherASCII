/**
 * Signature effects — original to cipherASCII.
 *
 * These five are the visual identity: they are not ports of any existing
 * terminal effect. Between them they exercise every capability of the engine —
 * glyph interning, per-cell ordering, displacement with elastic envelopes,
 * scroll fields and diagonal keys — and they are what the `cipher demo`
 * showcase is built around.
 */

import { defineEffect } from '../types';
import { GLYPH_CIPHER, boost, cellSalt, mix, moveCell, restore, sat, swing } from './helpers';

/** Density ramp used when a glyph morphs through tones. */
const DENSITY_RAMP = ' .`^:;,Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

/**
 * Cipherlock: a scrolling field of hex digits locks onto the source one cell
 * at a time — the emblem effect of the application.
 */
export const cipherlock = defineEffect<void>({
  id: 'cipherlock',
  label: 'Cipherlock',
  category: 'signature',
  description: 'A scrolling hex field locks onto the artwork cell by cell, like a combination dial seating.',
  duration: 2200,
  params: [
    { key: 'scroll', label: 'Scroll', min: 5, max: 80, step: 1, default: 26, unit: 'rows/s' },
    { key: 'lockSpread', label: 'Lock spread', min: 0, max: 1, step: 0.05, default: 0.85 },
    { key: 'glow', label: 'Lock glow', min: 0, max: 1, step: 0.05, default: 0.7 },
  ],
  apply(ctx) {
    const scroll = ctx.params.scroll;
    const spread = ctx.params.lockSpread;
    const glow = ctx.params.glow * ctx.intensity;
    const seconds = ctx.time / 1000;
    ctx.mask.forEach((x, y, index) => {
      const threshold = cellSalt(ctx, x, y, 191) * spread;
      if (ctx.progress >= sat(threshold + 0.01)) {
        restore(ctx, index);
        return;
      }
      // Hex field scrolls upward; a cell's digits churn until it seats.
      const row = Math.floor(y - seconds * scroll);
      const digit = GLYPH_CIPHER[(Math.imul(row + 1, 31) + Math.imul(x + 1, 17)) % GLYPH_CIPHER.length];
      const seating = ctx.progress > threshold ? (ctx.progress - threshold) / Math.max(0.001, 1 - threshold) : 0;
      ctx.set(
        index,
        ctx.intern(digit),
        boost(ctx.sourceFg[index], seating * glow),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/**
 * Hexfall: columns of hex digits rain down and *resolve* into the artwork at
 * their landing row — rain that becomes content instead of falling off-screen.
 */
export const hexfall = defineEffect<void>({
  id: 'hexfall',
  label: 'Hexfall',
  category: 'signature',
  description: 'Columns of hex digits fall and resolve into the artwork as they reach their landing row.',
  duration: 1900,
  params: [
    { key: 'speed', label: 'Speed', min: 5, max: 60, step: 1, default: 24, unit: 'rows/s' },
    { key: 'coverage', label: 'Coverage', min: 0.1, max: 1, step: 0.05, default: 0.85 },
    { key: 'glow', label: 'Landing glow', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    // `speed` scales how far the fall travels inside the fixed duration, so a
    // faster setting lands every column sooner instead of merely re-timing it.
    const speed = (ctx.params.speed / 24) * (0.5 + ctx.intensity);
    const coverage = ctx.params.coverage;
    const glow = ctx.params.glow;
    ctx.mask.forEach((x, y, index) => {
      if (cellSalt(ctx, x, 0, 193) > coverage) {
        restore(ctx, index);
        return;
      }
      // Each column starts at a different height; the head lands at
      // `progress`, and everything behind it has already resolved.
      const offset = cellSalt(ctx, x, 0, 197) * ctx.height;
      const head = ctx.progress * (ctx.height + 6) * speed - 3;
      const landing = (offset + head) % (ctx.height + 6);
      const row = Math.floor(landing);
      if (y < row - 3 || y > row) {
        ctx.set(index, ctx.intern(' '), -1, -1, 255);
        return;
      }
      if (y === row) {
        ctx.set(index, ctx.sourceGlyph[index], boost(ctx.sourceFg[index], glow), ctx.sourceBg[index], 255);
        return;
      }
      const dist = row - y;
      const digit = GLYPH_CIPHER[(Math.imul(x + 1, 17) + Math.imul(y + 1, 23)) % GLYPH_CIPHER.length];
      ctx.set(index, ctx.intern(digit), boost(ctx.sourceFg[index], (1 - dist / 3) * 0.4), ctx.sourceBg[index], 255);
    });
  },
});

/** Glyphwave: a wave passes and every cell it touches churns through tones. */
export const glyphwave = defineEffect<void>({
  id: 'glyphwave',
  label: 'Glyphwave',
  category: 'signature',
  description: 'A travelling wave churns the characters it touches through the density ramp, then lets them settle.',
  duration: 1700,
  params: [
    { key: 'width', label: 'Wave width', min: 2, max: 60, step: 1, default: 22, unit: 'cells' },
    { key: 'cycles', label: 'Tone cycles', min: 1, max: 6, step: 1, default: 2 },
    { key: 'diagonal', label: 'Diagonal', min: 0, max: 1, step: 1, default: 1 },
  ],
  apply(ctx) {
    const width = Math.max(2, ctx.params.width);
    const cycles = ctx.params.cycles;
    const diagonal = ctx.params.diagonal > 0.5;
    const span = diagonal ? ctx.width + ctx.height : ctx.width;
    const head = mix(-width, span + width, ctx.progress);
    ctx.mask.forEach((x, y, index) => {
      const pos = diagonal ? x + y : x;
      const d = Math.abs(pos - head);
      if (d > width) {
        restore(ctx, index);
        return;
      }
      const falloff = 1 - d / width;
      const tone = Math.floor(
        ((pos * 0.35 + ctx.progress * cycles * DENSITY_RAMP.length) % DENSITY_RAMP.length + DENSITY_RAMP.length) %
          DENSITY_RAMP.length,
      );
      ctx.set(
        index,
        ctx.intern(DENSITY_RAMP[tone] === ' ' ? ctx.resolve(ctx.sourceGlyph[index]) : DENSITY_RAMP[tone]),
        boost(ctx.sourceFg[index], falloff * 0.6),
        ctx.sourceBg[index],
        255,
      );
    });
  },
});

/** Signalburst: a radial shockwave throws the field out and elastically snaps it back. */
export const signalburst = defineEffect<void>({
  id: 'signalburst',
  label: 'Signalburst',
  category: 'signature',
  description: 'A radial shockwave throws the field outward; elastic easing snaps it back into place.',
  duration: 1500,
  params: [
    { key: 'force', label: 'Force', min: 1, max: 24, step: 1, default: 7, unit: 'cells' },
    { key: 'ring', label: 'Ring width', min: 1, max: 30, step: 1, default: 12, unit: 'cells' },
    { key: 'glow', label: 'Ring glow', min: 0, max: 1, step: 0.05, default: 0.75 },
  ],
  apply(ctx) {
    const force = ctx.params.force * ctx.intensity;
    const ring = Math.max(1, ctx.params.ring);
    const glow = ctx.params.glow;
    const cx = (ctx.width - 1) / 2;
    const cy = (ctx.height - 1) / 2;
    const maxDist = Math.hypot(cx, cy) || 1;
    // Elastic-out: the displacement overshoots and oscillates as it settles.
    const elastic = elasticOut(sat(ctx.progress));
    const wavefront = ctx.progress * (maxDist + ring);
    ctx.blankMasked();
    ctx.mask.forEach((x, y, index) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy) || 0.001;
      const push = elastic * force * (0.35 + dist / maxDist);
      moveCell(ctx, index, (dx / dist) * push, (dy / dist) * push);
      const nearRing = Math.abs(dist - wavefront);
      if (nearRing < ring) {
        const falloff = 1 - nearRing / ring;
        const i = index;
        ctx.set(
          i,
          ctx.plane.glyph[i] === 0 ? ctx.sourceGlyph[i] : ctx.plane.glyph[i],
          boost(ctx.sourceFg[i], falloff * glow),
          ctx.sourceBg[i],
          255,
        );
      }
    });
  },
});

/**
 * Keyshift: a diagonal key band travels the canvas. Cells it touches are
 * re-encrypted, and the band leaves them decrypted behind it — an endless
 * encrypt/decrypt sweep.
 */
export const keyshift = defineEffect<void>({
  id: 'keyshift',
  label: 'Keyshift',
  category: 'signature',
  description: 'A diagonal key band re-encrypts the cells it crosses and leaves them decrypted behind.',
  duration: 3400,
  ambient: true,
  params: [
    { key: 'width', label: 'Key width', min: 2, max: 40, step: 1, default: 10, unit: 'cells' },
    { key: 'churn', label: 'Churn rate', min: 30, max: 300, step: 10, default: 70, unit: 'ms' },
    { key: 'glow', label: 'Key glow', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  apply(ctx) {
    const width = Math.max(2, ctx.params.width);
    const churn = Math.max(16, ctx.params.churn);
    const glow = ctx.params.glow * ctx.intensity;
    const tick = Math.floor(ctx.time / churn);
    const span = ctx.width + ctx.height;
    const head = ctx.progress * (span + width * 2) - width;
    ctx.mask.forEach((x, y, index) => {
      const pos = x + y;
      const d = pos - head;
      if (d < 0 || d > width) {
        restore(ctx, index);
        return;
      }
      const local = d / width;
      const churnSalt = tick + index;
      const glyph =
        local > 0.75
          ? ctx.resolve(ctx.sourceGlyph[index])
          : GLYPH_CIPHER[(Math.imul(pos + 1, 17) + churnSalt * 13) % GLYPH_CIPHER.length];
      const heat = Math.sin(local * Math.PI);
      ctx.set(index, ctx.intern(glyph), boost(ctx.sourceFg[index], heat * glow), ctx.sourceBg[index], 255);
    });
  },
});

/** Elastic-out easing (Penner), inlined so effects stay dependency-free. */
function elasticOut(t: number): number {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

export const SIGNATURE_EFFECTS = [cipherlock, hexfall, glyphwave, signalburst, keyshift];

export { swing };
