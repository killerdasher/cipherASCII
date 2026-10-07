/**
 * Glyph index - a charset made measurable.
 *
 * Feature vectors (see `./features`) are sorted by measured ink so a ladder
 * can be built from what the glyphs *are* rather than from their order in a
 * preset: `nearestByInk` finds the glyph matching a target coverage,
 * `ramp` quantiles the ladder evenly across the measured range and
 * `byDensityRange` selects glyphs by how full their own bounding box is.
 *
 * Lookups are deterministic: ties break by code point, so the same features
 * always produce the same ladder on every machine.
 */

import type { GlyphFeatureVector } from './features';

export interface RampOptions {
  /** Drop zero-ink glyphs (space) before quantiling; default `true`. */
  skipEmpty?: boolean;
}

function codePoint(glyph: string): number {
  return glyph.codePointAt(0) ?? 0;
}

export class GlyphIndex {
  /** Sorted by ink ascending, ties by code point ascending. */
  private readonly items: GlyphFeatureVector[];
  /** First vector supplied for each character, in input order. */
  private readonly byGlyph: Map<string, GlyphFeatureVector>;

  private constructor(items: GlyphFeatureVector[], byGlyph: Map<string, GlyphFeatureVector>) {
    this.items = items;
    this.byGlyph = byGlyph;
  }

  /**
   * Build an index from measured feature vectors.
   *
   * Duplicate characters keep the first vector supplied for that character;
   * empty input yields an empty index (every query then answers
   * `undefined` / `[]`).
   *
   * @param features - measured glyphs, in any order
   * @returns a new index; `features` is copied, never aliased
   */
  static from(features: readonly GlyphFeatureVector[]): GlyphIndex {
    const items = [...features].sort((a, b) =>
      a.ink !== b.ink ? a.ink - b.ink : codePoint(a.glyph) - codePoint(b.glyph),
    );
    const byGlyph = new Map<string, GlyphFeatureVector>();
    for (const feature of features) {
      if (!byGlyph.has(feature.glyph)) byGlyph.set(feature.glyph, feature);
    }
    return new GlyphIndex(items, byGlyph);
  }

  /** Number of indexed glyphs. */
  get size(): number {
    return this.items.length;
  }

  /** Indexed characters, lightest ink first. */
  glyphs(): string[] {
    return this.items.map((f) => f.glyph);
  }

  /** Measured vector for a character, or `undefined` when unindexed. */
  featuresOf(glyph: string): GlyphFeatureVector | undefined {
    return this.byGlyph.get(glyph);
  }

  /**
   * Glyph whose measured ink is closest to `ink` (0..1).
   *
   * @param ink - target coverage
   * @returns the nearest vector, or `undefined` for an empty index
   */
  nearestByInk(ink: number): GlyphFeatureVector | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].ink < ink) lo = mid + 1;
      else hi = mid;
    }
    // `lo` is the first item with ink >= target; compare it with its predecessor.
    let best = this.items[lo];
    if (lo > 0) {
      const prev = this.items[lo - 1];
      const prevGap = Math.abs(prev.ink - ink);
      const bestGap = Math.abs(best.ink - ink);
      if (prevGap < bestGap || (prevGap === bestGap && codePoint(prev.glyph) < codePoint(best.glyph))) {
        best = prev;
      }
    }
    return best;
  }

  /**
   * Evenly quantile the measured ladder into a character set.
   *
   * Characters are returned **dark to light** (densest first), matching the
   * ordering every charset preset uses, so the result can be fed straight to
   * `inkToIndex`. Consecutive picks of the same character are dropped, so a
   * small index can legitimately return fewer than `levels` characters.
   *
   * @param levels - requested ladder length
   * @param options - `skipEmpty` (default `true`) drops zero-ink glyphs
   * @returns the de-duplicated ladder; `[]` when nothing qualifies
   */
  ramp(levels: number, options: RampOptions = {}): string[] {
    if (!Number.isInteger(levels) || levels <= 0) return [];
    const skipEmpty = options.skipEmpty !== false;
    const candidates = skipEmpty ? this.items.filter((f) => f.ink > 0) : this.items;
    const n = candidates.length;
    if (n === 0) return [];

    const picks: string[] = [];
    const seen = new Set<string>();
    for (let i = levels - 1; i >= 0; i--) {
      const q = levels === 1 ? n - 1 : Math.round((i * (n - 1)) / (levels - 1));
      const glyph = candidates[q].glyph;
      if (seen.has(glyph)) continue;
      seen.add(glyph);
      picks.push(glyph);
    }
    return picks;
  }

  /**
   * Glyphs whose bounding-box density falls within `[min, max]` (inclusive).
   *
   * @param min - lower density bound, 0..1
   * @param max - upper density bound, 0..1
   * @returns matching vectors, in index (ink) order
   */
  byDensityRange(min: number, max: number): GlyphFeatureVector[] {
    return this.items.filter((f) => f.density >= min && f.density <= max);
  }
}
