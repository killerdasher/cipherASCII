/**
 * Adaptive quality controller.
 *
 * Keeps an exponential moving average of frame time and walks a 0..3 quality
 * level up or down with hysteresis:
 *
 * - **Step down** after a short streak of frames above `target * overFactor`
 *   (the machine is clearly struggling — react quickly).
 * - **Step up** after a much longer streak comfortably under
 *   `target * underFactor` (prove you can hold it — recover slowly).
 * - A **cooldown** after every step prevents the classic oscillation
 *   (down, up, down, up…) that makes an app feel unstable.
 *
 * Pure by design: `observeFrame` returns a new state and never mutates the
 * old one, so the controller can be unit tested and replayed from a recorded
 * frame trace.
 */

import { clampLevel, QUALITY_LEVEL_MAX, QUALITY_LEVEL_MIN } from './quality';

export interface AdaptiveState {
  /** Smoothed frame time in ms; `null` until the first sample. */
  readonly emaMs: number | null;
  /** Current quality level, 0 (worst) .. 3 (best). */
  readonly level: number;
  /** Total samples observed (useful for the debug overlay). */
  readonly samples: number;
  /** Frames remaining before another step is allowed (0 = free to move). */
  readonly cooldown: number;
  /** Consecutive over-budget samples. */
  readonly overStreak: number;
  /** Consecutive comfortable samples. */
  readonly underStreak: number;
}

export interface AdaptiveTuning {
  /** EMA weight per sample, 0..1 (higher = reacts faster, noisier). */
  readonly alpha: number;
  /** Frame time above `target * this` counts as struggling. */
  readonly overFactor: number;
  /** Frame time below `target * this` counts as comfortable. */
  readonly underFactor: number;
  /** Consecutive over-budget samples needed to step down. */
  readonly overStreak: number;
  /** Consecutive comfortable samples needed to step up. */
  readonly underStreak: number;
  /** Frames to wait after any step before stepping again. */
  readonly cooldownFrames: number;
}

export const DEFAULT_TUNING: AdaptiveTuning = {
  alpha: 0.15,
  overFactor: 1.35,
  underFactor: 0.7,
  overStreak: 15,
  underStreak: 120,
  cooldownFrames: 90,
};

export function createAdaptive(level = QUALITY_LEVEL_MAX): AdaptiveState {
  return {
    emaMs: null,
    level: clampLevel(level),
    samples: 0,
    cooldown: 0,
    overStreak: 0,
    underStreak: 0,
  };
}

/** Feed one measured frame. Non-finite/non-positive samples are ignored. */
export function observeFrame(
  state: AdaptiveState,
  frameMs: number,
  targetMs: number,
  tuning: AdaptiveTuning = DEFAULT_TUNING,
): AdaptiveState {
  if (!Number.isFinite(frameMs) || frameMs <= 0 || !Number.isFinite(targetMs) || targetMs <= 0) return state;

  const emaMs = state.emaMs === null ? frameMs : state.emaMs + tuning.alpha * (frameMs - state.emaMs);
  const samples = state.samples + 1;
  const cooldown = Math.max(0, state.cooldown - 1);

  const over = emaMs > targetMs * tuning.overFactor;
  const under = emaMs < targetMs * tuning.underFactor;
  const overStreak = over ? state.overStreak + 1 : 0;
  const underStreak = under ? state.underStreak + 1 : 0;

  let level = state.level;
  let cooldownOut = cooldown;
  if (cooldownOut === 0) {
    if (overStreak >= tuning.overStreak && level > QUALITY_LEVEL_MIN) {
      level -= 1;
      cooldownOut = tuning.cooldownFrames;
      return { emaMs, level, samples, cooldown: cooldownOut, overStreak: 0, underStreak: 0 };
    }
    if (underStreak >= tuning.underStreak && level < QUALITY_LEVEL_MAX) {
      level += 1;
      cooldownOut = tuning.cooldownFrames;
      return { emaMs, level, samples, cooldown: cooldownOut, overStreak: 0, underStreak: 0 };
    }
  }

  return { emaMs, level, samples, cooldown: cooldownOut, overStreak, underStreak };
}

/** Smoothed frames-per-second (0 until the first sample). */
export function adaptiveFps(state: AdaptiveState): number {
  return state.emaMs && state.emaMs > 0 ? 1000 / state.emaMs : 0;
}
