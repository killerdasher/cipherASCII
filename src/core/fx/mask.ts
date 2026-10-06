/**
 * Effect masking — the mechanism that lets an effect target a region, line,
 * column, band or glyph class instead of the whole screen.
 *
 * Masks compile to per-row `[x0, x1)` spans in a flat `Int32Array`, so
 * iterating a masked area is a tight integer loop with no predicate call and no
 * allocation per frame.
 */

import type { Plane } from '../canvas/plane';

export type MaskKind =
  | 'all'
  | 'rect'
  | 'rows'
  | 'columns'
  | 'checker'
  | 'band'
  | 'glyphClass'
  | 'foreground'
  | 'background';

export type GlyphClass = 'space' | 'nonspace' | 'punctuation' | 'digit' | 'letter';

export interface MaskSpec {
  kind: MaskKind;
  /** Rectangle for `rect` and the clip every other kind is confined to. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** First/last row (inclusive) for `rows`. */
  rowStart?: number;
  rowEnd?: number;
  /** First/last column (inclusive) for `columns`. */
  colStart?: number;
  colEnd?: number;
  /** Cell size for `checker`. */
  cell?: number;
  /** Band thickness in cells for `band`. */
  thickness?: number;
  /** Which edge the band grows from. */
  origin?: 'top' | 'bottom' | 'left' | 'right';
  /** Restrict to cells whose glyph belongs to a class. */
  glyphClass?: GlyphClass;
  /** Restrict to cells that do / do not carry a foreground or background. */
  hasForeground?: boolean;
  hasBackground?: boolean;
}

export const ALL_MASK: MaskSpec = { kind: 'all' };

export function inGlyphClass(ch: string, cls: GlyphClass): boolean {
  if (cls === 'space') return ch === ' ';
  if (cls === 'nonspace') return ch !== ' ';
  const code = ch.codePointAt(0) ?? 32;
  if (cls === 'digit') return code >= 48 && code <= 57;
  if (cls === 'letter') return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  return (
    (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
  );
}

/**
 * Compiled mask.
 *
 * Layout: `rowOffset[y]` indexes into `spans`, where the first `rowCount[y]`
 * pairs are `[x0, x1)` ranges for that row.
 */
export class EffectMask {
  readonly width: number;
  readonly height: number;
  readonly spec: MaskSpec;

  private spans: Int32Array;
  private rowOffset: Int32Array;
  private rowCount: Int32Array;
  private cellCount: number;

  private constructor(width: number, height: number, spec: MaskSpec, spans: Int32Array, rowOffset: Int32Array, rowCount: Int32Array) {
    this.width = width;
    this.height = height;
    this.spec = spec;
    this.spans = spans;
    this.rowOffset = rowOffset;
    this.rowCount = rowCount;
    this.cellCount = 0;
    for (let i = 0; i < spans.length; i += 2) this.cellCount += spans[i + 1] - spans[i];
  }

  static compile(width: number, height: number, spec: MaskSpec = ALL_MASK): EffectMask {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    const rowOffset = new Int32Array(h);
    const rowCount = new Int32Array(h);
    const flat: number[] = [];
    let cursor = 0;

    for (let y = 0; y < h; y++) {
      const ranges = rowRanges(w, h, y, spec);
      rowOffset[y] = cursor;
      rowCount[y] = ranges.length / 2;
      for (let i = 0; i < ranges.length; i++) flat.push(ranges[i]);
      cursor += ranges.length;
    }
    return new EffectMask(w, h, spec, new Int32Array(flat), rowOffset, rowCount);
  }

  /** Build from a per-cell keep map (used by {@link filter}). */
  private static fromKeep(width: number, height: number, spec: MaskSpec, keep: Uint8Array): EffectMask {
    const w = width;
    const h = height;
    const rowOffset = new Int32Array(h);
    const rowCount = new Int32Array(h);
    const flat: number[] = [];
    let cursor = 0;
    for (let y = 0; y < h; y++) {
      rowOffset[y] = cursor;
      let spans = 0;
      let run = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && keep[y * w + x] === 1;
        if (on && run < 0) run = x;
        if (!on && run >= 0) {
          flat.push(run, x);
          spans++;
          run = -1;
        }
      }
      rowCount[y] = spans;
      cursor += spans * 2;
    }
    return new EffectMask(w, h, spec, new Int32Array(flat), rowOffset, rowCount);
  }

  get isEmpty(): boolean {
    return this.cellCount === 0;
  }

  /** Number of selected cells. */
  get size(): number {
    return this.cellCount;
  }

  get isFull(): boolean {
    return this.spec.kind === 'all';
  }

  /** Number of run-length spans across all rows. */
  get spanCount(): number {
    let total = 0;
    for (let i = 0; i < this.rowCount.length; i++) total += this.rowCount[i];
    return total;
  }

  /** Is `(x, y)` selected? */
  test(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const start = this.rowOffset[y];
    const count = this.rowCount[y];
    for (let i = 0; i < count; i++) {
      const x0 = this.spans[start + i * 2];
      const x1 = this.spans[start + i * 2 + 1];
      if (x >= x0 && x < x1) return true;
    }
    return false;
  }

  /**
   * Visit every selected cell. `fn(x, y, index)` receives the flat plane index
   * so callers can read `sourceGlyph[index]` without recomputing the stride.
   */
  forEach(fn: (x: number, y: number, index: number) => void): void {
    const w = this.width;
    for (let y = 0; y < this.height; y++) {
      const count = this.rowCount[y];
      if (count === 0) continue;
      const start = this.rowOffset[y];
      const rowBase = y * w;
      for (let i = 0; i < count; i++) {
        const x0 = this.spans[start + i * 2];
        const x1 = this.spans[start + i * 2 + 1];
        for (let x = x0; x < x1; x++) fn(x, y, rowBase + x);
      }
    }
  }

  /** Narrow to the cells passing `predicate`. Returns a fully compiled mask. */
  filter(predicate: (x: number, y: number, index: number) => boolean): EffectMask {
    const keep = new Uint8Array(this.width * this.height);
    this.forEach((x, y, index) => {
      if (predicate(x, y, index)) keep[index] = 1;
    });
    return EffectMask.fromKeep(this.width, this.height, this.spec, keep);
  }
}

function rowRanges(w: number, h: number, y: number, s: MaskSpec): number[] {
  switch (s.kind) {
    case 'all':
      return [0, w];

    case 'rect': {
      const rx = s.x ?? 0;
      const ry = s.y ?? 0;
      const x0 = Math.max(0, rx);
      const x1 = Math.min(w, rx + (s.w ?? w));
      const y0 = Math.max(0, ry);
      const y1 = Math.min(h, ry + (s.h ?? h));
      if (y < y0 || y >= y1 || x1 <= x0) return [];
      return [x0, x1];
    }

    case 'rows': {
      const a = s.rowStart ?? 0;
      const b = s.rowEnd ?? h - 1;
      if (y < Math.min(a, b) || y > Math.max(a, b)) return [];
      return [0, w];
    }

    case 'columns': {
      const lo = Math.max(0, Math.min(s.colStart ?? 0, s.colEnd ?? w - 1));
      const hi = Math.min(w, Math.max(s.colStart ?? 0, s.colEnd ?? w - 1) + 1);
      if (hi <= lo) return [];
      return [lo, hi];
    }

    case 'checker': {
      const cell = Math.max(1, Math.floor(s.cell ?? 2));
      const out: number[] = [];
      let run = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        if (on && run < 0) run = x;
        if (!on && run >= 0) {
          out.push(run, x);
          run = -1;
        }
      }
      return out;
    }

    case 'band': {
      const thickness = Math.max(1, Math.abs(Math.floor(s.thickness ?? 3)));
      const origin = s.origin ?? 'top';
      if (origin === 'top') return y < thickness ? [0, w] : [];
      if (origin === 'bottom') return y >= h - thickness ? [0, w] : [];
      const x0 = origin === 'left' ? 0 : Math.max(0, w - thickness);
      const x1 = origin === 'left' ? Math.min(w, thickness) : w;
      return x1 <= x0 ? [] : [x0, x1];
    }

    default:
      return [0, w];
  }
}

/**
 * Build the mask an effect will use for a plane.
 *
 * Class / colour predicates are applied here (once per pipeline run), not
 * inside the per-frame loop.
 */
export function buildMask(plane: Plane, spec: MaskSpec = ALL_MASK): EffectMask {
  const base = EffectMask.compile(plane.width, plane.height, spec);
  const needsFilter =
    spec.glyphClass !== undefined || spec.hasForeground !== undefined || spec.hasBackground !== undefined;
  if (!needsFilter) return base;

  return base.filter((_x, _y, index) => {
    if (spec.glyphClass) {
      const ch = plane.glyphTable.resolve(plane.glyph[index]);
      if (!inGlyphClass(ch, spec.glyphClass)) return false;
    }
    if (spec.hasForeground === true && plane.fg[index] === -1) return false;
    if (spec.hasForeground === false && plane.fg[index] !== -1) return false;
    if (spec.hasBackground === true && plane.bg[index] === -1) return false;
    if (spec.hasBackground === false && plane.bg[index] !== -1) return false;
    return true;
  });
}
