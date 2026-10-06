/**
 * Quality modes and frame budgets.
 *
 * A *mode* is what the user picks (Auto / High / Balanced / Low); a *budget*
 * is what the renderer actually gets: how often cell effects may update, how
 * many particles are allowed, and whether the expensive display extras (CRT
 * self-composite, subtexture sampling) run at all.
 *
 * `Auto` is driven by the adaptive controller in `./adaptive.ts`, which walks
 * the 0..3 level ladder; fixed modes pin a level regardless of measurements.
 *
 * Everything here is pure so the ladder, the clamping and the resolution of
 * `auto` can be unit tested without a canvas.
 */

export type QualityMode = 'auto' | 'high' | 'balanced' | 'low';

export type QualityTier = 'high' | 'balanced' | 'low' | 'emergency';

export interface QualityBudget {
  readonly tier: QualityTier;
  /** Target frame time in ms — the number the adaptive controller aims for. */
  readonly targetMs: number;
  /** Cell-effect update rate in Hz. Animation time still advances in real
   *  time (dt is accumulated), so a lower rate costs steps, not duration. */
  readonly effectHz: number;
  /** Particle ceiling for effect and ambient particle systems. */
  readonly maxParticles: number;
  /** Expensive display extras: CRT self-composite, subtexture sampling. */
  readonly fullEffects: boolean;
}

/** Adaptive ladder, worst (0) to best (3). */
export const QUALITY_LEVEL_MIN = 0;
export const QUALITY_LEVEL_MAX = 3;

export const QUALITY_BUDGETS: Record<QualityTier, QualityBudget> = {
  high: { tier: 'high', targetMs: 16.7, effectHz: 60, maxParticles: 4000, fullEffects: true },
  balanced: { tier: 'balanced', targetMs: 33.4, effectHz: 30, maxParticles: 2000, fullEffects: true },
  low: { tier: 'low', targetMs: 50, effectHz: 20, maxParticles: 800, fullEffects: false },
  emergency: { tier: 'emergency', targetMs: 100, effectHz: 10, maxParticles: 200, fullEffects: false },
};

/** Level -> tier: 3 high, 2 balanced, 1 low, 0 emergency. */
export function tierForLevel(level: number): QualityTier {
  if (level >= 3) return 'high';
  if (level === 2) return 'balanced';
  if (level === 1) return 'low';
  return 'emergency';
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return QUALITY_LEVEL_MAX;
  return Math.min(QUALITY_LEVEL_MAX, Math.max(QUALITY_LEVEL_MIN, Math.round(level)));
}

/** Budget for an adaptive level (used by `auto` mode). */
export function budgetForLevel(level: number): QualityBudget {
  return QUALITY_BUDGETS[tierForLevel(clampLevel(level))];
}

const FIXED: Record<Exclude<QualityMode, 'auto'>, QualityBudget> = {
  high: QUALITY_BUDGETS.high,
  balanced: QUALITY_BUDGETS.balanced,
  low: QUALITY_BUDGETS.low,
};

/**
 * Resolve what should run right now: fixed modes ignore the adaptive level,
 * `auto` follows it.
 */
export function resolveBudget(mode: QualityMode, level: number): QualityBudget {
  return mode === 'auto' ? budgetForLevel(level) : FIXED[mode];
}

/** Is this a valid mode string (e.g. for loading a persisted setting)? */
export function isQualityMode(value: unknown): value is QualityMode {
  return value === 'auto' || value === 'high' || value === 'balanced' || value === 'low';
}
