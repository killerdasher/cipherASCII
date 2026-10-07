/**
 * Cell-effect pipeline.
 *
 * Runs an ordered stack of {@link CellEffect}s against a {@link Plane} once per
 * frame. The pipeline owns three things effects never have to:
 *
 * 1. the **source snapshot** (glyph/fg/bg captured when the document changed),
 * 2. per-effect **state and elapsed time**,
 * 3. a **seeded RNG** shared by the stack, so a seed reproduces a frame exactly.
 *
 * Effects are applied sequentially, exactly like the raster pipeline — order is
 * meaningful ("decrypt" then "glitch" is not the same as the reverse).
 */

import type { Plane } from '../canvas/plane';
import { NO_CELL } from '../canvas/cell';
import { EffectMask, ALL_MASK, buildMask, type MaskSpec } from './mask';
import { type CellEffect, type EffectContext, type EffectParams, resolveParams } from './types';
import { Rng } from '../util';

export interface CellEffectEntry {
  /** Registered effect id. */
  effect: string;
  enabled?: boolean;
  /** 0..1 multiplier applied on top of parameter values. */
  intensity?: number;
  params?: EffectParams;
  mask?: MaskSpec;
  /** Delay before this entry starts, in milliseconds. */
  delay?: number;
}

export interface CellPipelineOptions {
  seed?: number;
  entries?: readonly CellEffectEntry[];
}

interface Slot {
  entry: CellEffectEntry;
  effect: CellEffect<unknown>;
  state: unknown;
  params: EffectParams;
  mask: EffectMask;
  elapsed: number;
  /** Set once a one-shot effect has applied its final frame. */
  settled: boolean;
  /** True once `bind` resolved the effect against the registry. */
  bound: boolean;
}

export class CellEffectPipeline {
  private slots: Slot[] = [];
  private sourceGlyph = new Uint16Array(0);
  private sourceFg = new Int32Array(0);
  private sourceBg = new Int32Array(0);
  private rng: Rng;
  private seed: number;
  private salt: number;
  private paper = 0x0c0c10;
  private maskCache = new Map<string, EffectMask>();

  constructor(options: CellPipelineOptions = {}) {
    this.seed = options.seed ?? 0x5eed;
    this.rng = new Rng(this.seed);
    this.salt = this.seed | 0;
    for (const entry of options.entries ?? []) this.push(entry);
  }

  /** Append an entry (resolved later if the effect registry fills in first). */
  push(entry: CellEffectEntry, effect?: CellEffect<unknown>): void {
    if (!effect) {
      this.slots.push({
        entry,
        effect: unresolvedEffect(entry.effect),
        state: {},
        params: {},
        mask: EffectMask.compile(0, 0, ALL_MASK),
        elapsed: 0,
        settled: false,
        bound: false,
      });
      return;
    }
    this.slots.push(this.makeSlot(entry, effect));
  }

  private makeSlot(entry: CellEffectEntry, effect: CellEffect<unknown>): Slot {
    return {
      entry,
      effect,
      state: effect.createState(),
      params: resolveParams(effect, entry.params),
      mask: EffectMask.compile(0, 0, ALL_MASK),
      elapsed: 0,
      settled: false,
      bound: true,
    };
  }

  /**
   * Bind every unresolved entry against `catalog`, then size masks to `plane`.
   * Called once after the registry is available and again on resize.
   */
  bind(catalog: ReadonlyMap<string, CellEffect<unknown>>, plane: Plane): void {
    this.maskCache.clear();
    for (const slot of this.slots) {
      const found = catalog.get(slot.entry.effect);
      if (found) {
        slot.effect = found;
        slot.state = found.createState();
        slot.params = resolveParams(found, slot.entry.params);
        slot.bound = true;
      }
      slot.mask = this.maskFor(plane, slot.entry.mask);
    }
    this.ensureSourceSize(plane);
  }

  private maskFor(plane: Plane, spec?: MaskSpec): EffectMask {
    const key = `${plane.width}x${plane.height}:${JSON.stringify(spec ?? ALL_MASK)}`;
    const cached = this.maskCache.get(key);
    if (cached) return cached;
    const mask = buildMask(plane, spec ?? ALL_MASK);
    this.maskCache.set(key, mask);
    return mask;
  }

  private ensureSourceSize(plane: Plane): void {
    const n = plane.width * plane.height;
    if (this.sourceGlyph.length !== n) {
      this.sourceGlyph = new Uint16Array(n);
      this.sourceFg = new Int32Array(n).fill(NO_CELL);
      this.sourceBg = new Int32Array(n).fill(NO_CELL);
    }
  }

  /**
   * Capture the plane as the source for every reveal/displacement effect.
   *
   * Call this when the document grid changes; calling it every frame would
   * defeat effects that animate *toward* the source.
   */
  setSource(plane: Plane): void {
    this.ensureSourceSize(plane);
    this.sourceGlyph.set(plane.glyph);
    this.sourceFg.set(plane.fg);
    this.sourceBg.set(plane.bg);
  }

  /** True when at least one enabled entry can still change the plane. */
  hasWork(): boolean {
    for (const slot of this.slots) {
      if (slot.entry.enabled === false || !slot.bound) continue;
      if (slot.effect.ambient) return true;
      if (slot.effect.duration > 0 && slot.elapsed < slot.effect.duration) return true;
    }
    return false;
  }

  /** Number of enabled entries. */
  get activeCount(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.bound && slot.entry.enabled !== false) n++;
    return n;
  }

  /** Reset every entry's clock (used when a scene replays). */
  resetClocks(): void {
    for (const slot of this.slots) {
      slot.elapsed = 0;
      slot.settled = false;
      slot.effect.reset?.(slot.state);
    }
    this.rng = new Rng(this.seed);
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.salt = seed | 0;
  }

  /** Paper colour handed to every effect through {@link EffectContext.paper}. */
  setPaper(color: number): void {
    this.paper = color >>> 0;
  }

  get currentSeed(): number {
    return this.seed;
  }

  /**
   * Run every enabled entry once.
   *
   * Returns the number of entries that actually ran.
   */
  apply(plane: Plane, dt: number): number {
    this.ensureSourceSize(plane);
    let ran = 0;
    for (const slot of this.slots) {
      if (slot.entry.enabled === false) continue;
      const delay = slot.entry.delay ?? 0;
      if (slot.elapsed < delay) {
        slot.elapsed += dt;
        continue;
      }
      if (slot.settled) continue;
      const duration = slot.effect.duration;
      const ambient = slot.effect.ambient === true;
      slot.elapsed += dt;
      const localTime = Math.max(0, slot.elapsed - delay);
      const finished = !ambient && duration > 0 && localTime >= duration;
      // A one-shot effect applies exactly one final frame at progress 1, then
      // stops being visited — no per-frame cost for a settled reveal.
      if (finished) slot.settled = true;

      const progress = finished ? 1 : computeProgress(localTime, duration, ambient);
      const ctx: EffectContext = {
        plane,
        width: plane.width,
        height: plane.height,
        time: localTime,
        dt,
        rng: this.rng,
        salt: this.salt,
        params: slot.params,
        intensity: clamp01(slot.entry.intensity ?? 1),
        mask: slot.mask,
        sourceGlyph: this.sourceGlyph,
        sourceFg: this.sourceFg,
        sourceBg: this.sourceBg,
        paper: this.paper,
        progress,
        intern: (g) => plane.glyphTable.intern(g),
        resolve: (id) => plane.glyphTable.resolve(id),
        set: (index, glyphId, fg, bg, alpha) => {
          const x = index % plane.width;
          const y = (index / plane.width) | 0;
          plane.setCell(
            x,
            y,
            glyphId,
            fg ?? this.sourceFg[index] ?? NO_CELL,
            bg ?? this.sourceBg[index] ?? NO_CELL,
            alpha ?? 255,
          );
        },
        sourceChar: (x, y) => {
          if (x < 0 || y < 0 || x >= plane.width || y >= plane.height) return ' ';
          return plane.glyphTable.resolve(this.sourceGlyph[y * plane.width + x]);
        },
        blankMasked: () => {
          slot.mask.forEach((_x, _y, index) => {
            plane.glyph[index] = 0;
            plane.fg[index] = NO_CELL;
          });
          // One dirty mark for the whole mask instead of one per cell.
          const bounds = slot.mask as unknown as { width: number; height: number };
          plane.dirty.mark(0, 0, bounds.width, bounds.height, plane.width, plane.height);
        },
      };
      slot.effect.apply(ctx, slot.state);
      ran++;
    }
    return ran;
  }

  /** Current entries (for the effect browser / preset export). */
  list(): readonly CellEffectEntry[] {
    return this.slots.map((slot) => slot.entry);
  }

  /** Replace the whole stack. */
  setEntries(entries: readonly CellEffectEntry[], catalog: ReadonlyMap<string, CellEffect<unknown>>, plane: Plane): void {
    this.slots = entries.map((entry) => {
      const effect = catalog.get(entry.effect);
      return effect ? this.makeSlot(entry, effect) : this.makeSlot(entry, unresolvedEffect(entry.effect));
    });
    this.bind(catalog, plane);
  }

  /** True when a slot still needs frames (used to skip idle repaints). */
  get needsFrames(): boolean {
    for (const slot of this.slots) {
      if (slot.entry.enabled === false || !slot.bound || slot.settled) continue;
      return true;
    }
    return false;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function computeProgress(localTime: number, duration: number, ambient: boolean): number {
  if (ambient) {
    const loop = duration > 0 ? duration : 1000;
    const t = localTime % loop;
    return t / loop;
  }
  if (duration <= 0) return 1;
  return clamp01(localTime / duration);
}

/** Placeholder used before {@link CellEffectPipeline.bind} resolves a catalog. */
function unresolvedEffect(id: string): CellEffect<unknown> {
  return {
    id,
    label: id,
    category: 'core',
    description: 'Effect not bound to a registry.',
    params: [],
    duration: 0,
    createState: () => ({}),
    apply: () => undefined,
  };
}
