/**
 * Adaptive quality: budget resolution + the controller that walks levels.
 *
 * The controller is pure, so it is tested by replaying synthetic frame traces
 * (perfect machine, struggling machine, noisy machine) and asserting both the
 * level it settles on and that it never mutates the state it was handed.
 */

import { describe, it, expect } from 'vitest';
import {
  QUALITY_BUDGETS,
  QUALITY_LEVEL_MAX,
  QUALITY_LEVEL_MIN,
  budgetForLevel,
  clampLevel,
  isQualityMode,
  resolveBudget,
  tierForLevel,
} from '../../src/core/perf/quality';
import {
  DEFAULT_TUNING,
  adaptiveFps,
  createAdaptive,
  observeFrame,
  type AdaptiveState,
  type AdaptiveTuning,
} from '../../src/core/perf/adaptive';

describe('quality budgets', () => {
  it('maps levels to tiers with 3 as the ceiling', () => {
    expect(tierForLevel(9)).toBe('high');
    expect(tierForLevel(3)).toBe('high');
    expect(tierForLevel(2)).toBe('balanced');
    expect(tierForLevel(1)).toBe('low');
    expect(tierForLevel(0)).toBe('emergency');
    expect(tierForLevel(-4)).toBe('emergency');
  });

  it('clamps levels, including nonsense input', () => {
    expect(clampLevel(99)).toBe(QUALITY_LEVEL_MAX);
    expect(clampLevel(-99)).toBe(QUALITY_LEVEL_MIN);
    expect(clampLevel(2.4)).toBe(2);
    expect(clampLevel(Number.NaN)).toBe(QUALITY_LEVEL_MAX);
  });

  it('gives worse tiers a bigger target and a cheaper budget', () => {
    const order = ['high', 'balanced', 'low', 'emergency'] as const;
    const budgets = order.map((t) => QUALITY_BUDGETS[t]);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i].targetMs).toBeGreaterThan(budgets[i - 1].targetMs);
      expect(budgets[i].effectHz).toBeLessThan(budgets[i - 1].effectHz);
      expect(budgets[i].maxParticles).toBeLessThanOrEqual(budgets[i - 1].maxParticles);
    }
    expect(QUALITY_BUDGETS.high.fullEffects).toBe(true);
    expect(QUALITY_BUDGETS.low.fullEffects).toBe(false);
    expect(budgetForLevel(3).tier).toBe('high');
    expect(budgetForLevel(0).tier).toBe('emergency');
  });

  it('pins fixed modes and lets auto follow the level', () => {
    expect(resolveBudget('high', 0).tier).toBe('high');
    expect(resolveBudget('low', 3).tier).toBe('low');
    expect(resolveBudget('balanced', 1).tier).toBe('balanced');
    expect(resolveBudget('auto', 2).tier).toBe('balanced');
    expect(resolveBudget('auto', 0).tier).toBe('emergency');
  });

  it('validates persisted mode strings', () => {
    expect(isQualityMode('auto')).toBe(true);
    expect(isQualityMode('LOW')).toBe(false);
    expect(isQualityMode(7)).toBe(false);
  });
});

/** Replay `count` frames of `ms` through the controller. */
function run(state: AdaptiveState, count: number, ms: number, targetMs = 16.7, tuning?: AdaptiveTuning): AdaptiveState {
  let s = state;
  for (let i = 0; i < count; i++) s = observeFrame(s, ms, targetMs, tuning);
  return s;
}

describe('adaptive controller', () => {
  it('starts at the top with no samples', () => {
    const s = createAdaptive();
    expect(s.level).toBe(QUALITY_LEVEL_MAX);
    expect(s.emaMs).toBeNull();
    expect(s.samples).toBe(0);
    expect(s.cooldown).toBe(0);
  });

  it('smooths the first samples into an EMA', () => {
    const s = run(createAdaptive(), 1, 20);
    expect(s.emaMs).toBeCloseTo(20, 5);
    expect(s.samples).toBe(1);
    const s2 = observeFrame(s, 40, 16.7);
    expect(s2.emaMs).toBeGreaterThan(20);
    expect(s2.emaMs).toBeLessThan(40);
  });

  it('ignores impossible samples (tab hidden, clock jumps)', () => {
    const base = run(createAdaptive(), 5, 16);
    for (const bad of [Number.NaN, 0, -5, Number.POSITIVE_INFINITY]) {
      expect(observeFrame(base, bad, 16.7)).toEqual(base);
    }
    expect(observeFrame(base, 16, 0)).toEqual(base);
  });

  it('stays at the top on a comfortable machine', () => {
    const s = run(createAdaptive(), 600, 8);
    expect(s.level).toBe(QUALITY_LEVEL_MAX);
    expect(s.overStreak).toBe(0);
    expect(s.underStreak).toBeGreaterThanOrEqual(DEFAULT_TUNING.underStreak);
  });

  it('steps down one level at a time under sustained load, with cooldown', () => {
    const first = run(createAdaptive(), DEFAULT_TUNING.overStreak, 50);
    expect(first.level).toBe(2);
    expect(first.cooldown).toBe(DEFAULT_TUNING.cooldownFrames);

    // During cooldown the level must not move again, however bad it gets.
    const during = run(first, DEFAULT_TUNING.cooldownFrames - 1, 50);
    expect(during.level).toBe(2);

    // The sample that expires the cooldown takes the next step (the streak
    // kept growing while it waited).
    const second = run(during, 1, 50);
    expect(second.level).toBe(1);
    expect(second.cooldown).toBe(DEFAULT_TUNING.cooldownFrames);
  });

  it('eventually floors at level 0, never below', () => {
    const s = run(createAdaptive(), 2000, 200);
    expect(s.level).toBe(QUALITY_LEVEL_MIN);
  });

  it('recovers once the machine is comfortably fast again', () => {
    const slow = run(createAdaptive(), 400, 50);
    expect(slow.level).toBeLessThan(QUALITY_LEVEL_MAX);
    const recovered = run(slow, 4000, 6);
    expect(recovered.level).toBe(QUALITY_LEVEL_MAX);
  });

  it('does not oscillate on noisy frames that sit near the target', () => {
    let s = createAdaptive();
    for (let i = 0; i < 1200; i++) s = observeFrame(s, i % 2 === 0 ? 8 : 30, 16.7);
    expect(s.level).toBe(QUALITY_LEVEL_MAX);
    expect(s.overStreak).toBe(0);
    expect(s.underStreak).toBe(0);
  });

  it('is pure - the input state is never mutated', () => {
    const before = createAdaptive();
    const snapshot = { ...before };
    run(before, 200, 60);
    expect(before).toEqual(snapshot);
  });

  it('reports FPS from the smoothed frame time', () => {
    expect(adaptiveFps(createAdaptive())).toBe(0);
    const s = run(createAdaptive(), 10, 20);
    expect(adaptiveFps(s)).toBeCloseTo(1000 / (s.emaMs ?? 1), 3);
  });
});
