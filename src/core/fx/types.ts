/**
 * Cell-level effect model.
 *
 * The raster effects in `core/effects` operate on pixels *before* ASCII
 * mapping. These operate on the mapped grid — the actual renderable
 * representation — which is what makes glyph animation possible: decrypting a
 * headline, orbiting characters, crumble, rain, and so on.
 *
 * Two rules keep the system honest:
 *
 * 1. An effect only ever writes cells inside its {@link EffectMask}.
 * 2. An effect never allocates per frame; state lives in an object created
 *    once by {@link CellEffect.createState}.
 */

import type { Rng } from '../util';
import type { Plane } from '../canvas/plane';
import type { EffectMask } from './mask';

export type EffectCategory = 'core' | 'motion' | 'energy' | 'destruction' | 'atmosphere' | 'signature';

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Optional unit shown in the UI (e.g. `ms`, `%`, `px`). */
  unit?: string;
}

export type EffectParams = Record<string, number>;

/**
 * Everything an effect may read while applying one frame.
 *
 * `source` is the glyph/colour snapshot captured when the pipeline was fed a
 * new grid; effects that reveal or displace content read from it rather than
 * from the plane, so running them twice in a row is idempotent.
 */
export interface EffectContext {
  readonly plane: Plane;
  readonly width: number;
  readonly height: number;
  /** Milliseconds since the pipeline started this effect. */
  readonly time: number;
  /** Milliseconds since the previous frame. */
  readonly dt: number;
  /** Seeded RNG — identical seeds produce identical frames. */
  readonly rng: Rng;
  /**
   * Seed-derived constant folded into every helper hash.
   *
   * Effects call `cellSalt(ctx, x, y, K)` instead of `cellRand(x, y, K)` so
   * `--seed` changes the *pattern* (positions, thresholds, picks), not just
   * the values that already flow through `rng`.
   */
  readonly salt: number;
  /** Resolved parameter values (defaults merged with user overrides). */
  readonly params: EffectParams;
  /** 0..1 user intensity multiplier applied on top of parameters. */
  readonly intensity: number;
  readonly mask: EffectMask;
  /** Glyph index snapshot of the source grid. */
  readonly sourceGlyph: Uint16Array;
  /** Foreground colour snapshot of the source grid (`-1` = none). */
  readonly sourceFg: Int32Array;
  /** Background colour snapshot of the source grid (`-1` = none). */
  readonly sourceBg: Int32Array;
  /** Per-cell progress of the owning effect, 0..1. */
  readonly progress: number;
  /** Resolve a glyph string through the plane's shared table. */
  intern(glyph: string): number;
  resolve(glyphId: number): string;
  /** Write one cell (marks dirty only when the value actually changed). */
  set(index: number, glyphId: number, fg?: number, bg?: number, alpha?: number): void;
  /** Read the source glyph string at a cell. */
  sourceChar(x: number, y: number): string;
  /**
   * Blank every masked cell (glyph + foreground), keeping background.
   *
   * Displacement effects call this once before scattering the source snapshot,
   * otherwise cells would leave a ghost at their original position.
   */
  blankMasked(): void;
}

export interface CellEffect<S = unknown> {
  readonly id: string;
  readonly label: string;
  readonly category: EffectCategory;
  readonly description: string;
  readonly params: readonly EffectParamDef[];
  /** Default playback length in milliseconds (0 = continuous/ambient). */
  readonly duration: number;
  /** Ambient effects loop instead of settling at `progress = 1`. */
  readonly ambient?: boolean;
  createState(): S;
  apply(ctx: EffectContext, state: S): void;
  reset?(state: S): void;
}

export function defineEffect<S>(
  effect: Omit<CellEffect<S>, 'createState'> & { createState?: () => S },
): CellEffect<S> {
  const { createState, ...rest } = effect;
  return { ...rest, createState: createState ?? (() => ({} as S)) };
}

/** Merge parameter defaults with the user's overrides, clamped to the range. */
export function resolveParams(effect: { params: readonly EffectParamDef[] }, overrides?: EffectParams): EffectParams {
  const out: EffectParams = {};
  for (const def of effect.params) {
    const raw = overrides?.[def.key] ?? def.default;
    const v = Number.isFinite(raw) ? raw : def.default;
    out[def.key] = v < def.min ? def.min : v > def.max ? def.max : v;
  }
  return out;
}
