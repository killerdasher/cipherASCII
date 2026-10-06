/**
 * A single layer of cells.
 *
 * A {@link Plane} is structure-of-arrays: glyph indices, colours, alpha and
 * attributes live in parallel typed arrays. Planes are the unit the compositor
 * blends, the unit effects mark dirty, and the unit the frame diff compares.
 */

import { Attr, BlendMode, NO_CELL, clampAlpha } from './cell';
import { DirtyRegions } from './dirty';
import { GlyphTable } from './glyphTable';

export interface PlaneOptions {
  glyphTable?: GlyphTable;
  z?: number;
  visible?: boolean;
  opacity?: number;
  blend?: BlendMode;
  /** Background painted under the whole plane; `NO_CELL` keeps it transparent. */
  bg?: number;
}

export class Plane {
  readonly width: number;
  readonly height: number;
  readonly glyphTable: GlyphTable;
  readonly dirty = new DirtyRegions();

  glyph: Uint16Array;
  fg: Int32Array;
  bg: Int32Array;
  alpha: Uint8Array;
  attr: Uint8Array;

  z: number;
  visible: boolean;
  /** 0..255 plane opacity applied at composite time. */
  opacity: number;
  blend: BlendMode;
  background: number;
  /** Free-form tag used by scenes/effects for grouping. */
  name: string;

  constructor(width: number, height: number, options: PlaneOptions = {}) {
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    const n = this.width * this.height;
    this.glyphTable = options.glyphTable ?? new GlyphTable();
    this.glyph = new Uint16Array(n);
    this.fg = new Int32Array(n).fill(NO_CELL);
    this.bg = new Int32Array(n).fill(NO_CELL);
    this.alpha = new Uint8Array(n);
    this.attr = new Uint8Array(n);
    this.z = options.z ?? 0;
    this.visible = options.visible ?? true;
    this.opacity = options.opacity ?? 255;
    this.blend = options.blend ?? 'over';
    this.background = options.bg ?? NO_CELL;
    this.name = '';
    this.dirty.mark(0, 0, this.width, this.height, this.width, this.height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Write one cell, marking the region dirty when something actually changed. */
  setCell(x: number, y: number, glyphId: number, fg: number, bg = NO_CELL, alpha = 255, attr = Attr.None): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    const changed =
      this.glyph[i] !== glyphId ||
      this.fg[i] !== fg ||
      this.bg[i] !== bg ||
      this.alpha[i] !== alpha ||
      this.attr[i] !== attr;
    if (!changed) return;
    this.glyph[i] = glyphId;
    this.fg[i] = fg;
    this.bg[i] = bg;
    this.alpha[i] = alpha;
    this.attr[i] = attr;
    this.dirty.mark(x, y, 1, 1, this.width, this.height);
  }

  /** Write a cell from a glyph string (interns on the shared table). */
  setGlyph(x: number, y: number, ch: string, fg: number, bg = NO_CELL, alpha = 255, attr = Attr.None): void {
    this.setCell(x, y, this.glyphTable.intern(ch), fg, bg, alpha, attr);
  }

  /** Read the glyph string at a cell (space when out of bounds). */
  charAt(x: number, y: number): string {
    if (!this.inBounds(x, y)) return ' ';
    return this.glyphTable.resolve(this.glyph[y * this.width + x]);
  }

  /** Paint the plane's background colour across a rectangle. */
  fillRect(x: number, y: number, w: number, h: number, bg: number, alpha = 255): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * this.width + xx;
        if (this.bg[i] !== bg || this.alpha[i] !== alpha) {
          this.bg[i] = bg;
          this.alpha[i] = alpha;
        }
      }
    }
    this.dirty.mark(x0, y0, x1 - x0, y1 - y0, this.width, this.height);
  }

  /** Clear every cell back to blank and mark the whole plane dirty. */
  clear(): void {
    this.glyph.fill(0);
    this.fg.fill(NO_CELL);
    this.bg.fill(NO_CELL);
    this.alpha.fill(0);
    this.attr.fill(Attr.None);
    this.dirty.mark(0, 0, this.width, this.height, this.width, this.height);
  }

  /** Resize, preserving overlapping content and marking everything dirty. */
  resize(width: number, height: number): void {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    if (w === this.width && h === this.height) return;
    const glyph = new Uint16Array(w * h);
    const fg = new Int32Array(w * h).fill(NO_CELL);
    const bg = new Int32Array(w * h).fill(NO_CELL);
    const alpha = new Uint8Array(w * h);
    const attr = new Uint8Array(w * h);
    const copyW = Math.min(this.width, w);
    const copyH = Math.min(this.height, h);
    for (let y = 0; y < copyH; y++) {
      const src = y * this.width;
      const dst = y * w;
      glyph.set(this.glyph.subarray(src, src + copyW), dst);
      fg.set(this.fg.subarray(src, src + copyW), dst);
      bg.set(this.bg.subarray(src, src + copyW), dst);
      alpha.set(this.alpha.subarray(src, src + copyW), dst);
      attr.set(this.attr.subarray(src, src + copyW), dst);
    }
    this.glyph = glyph;
    this.fg = fg;
    this.bg = bg;
    this.alpha = alpha;
    this.attr = attr;
    (this as { width: number }).width = w;
    (this as { height: number }).height = h;
    this.dirty.reset();
    this.dirty.mark(0, 0, w, h, w, h);
  }

  /** Per-cell opacity accessor that clamps into 0..255. */
  setAlpha(x: number, y: number, alpha: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.width + x;
    const next = clampAlpha(alpha);
    if (this.alpha[i] === next) return;
    this.alpha[i] = next;
    this.dirty.mark(x, y, 1, 1, this.width, this.height);
  }
}
