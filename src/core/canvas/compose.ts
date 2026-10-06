/**
 * Frame buffer + compositor.
 *
 * The compositor walks planes bottom-to-top into a single {@link FrameBuffer},
 * honouring per-cell alpha and per-plane blend modes. The frame buffer is
 * allocated once and reused across frames; compositing itself never allocates
 * — an already-ordered, fully visible plane list is walked in place, and only
 * a list that needs filtering or sorting pays for a temporary copy.
 */

import { Attr, BlendMode, NO_CELL, clampAlpha } from './cell';
import type { Plane } from './plane';

export class FrameBuffer {
  width: number;
  height: number;
  glyph: Uint16Array;
  fg: Int32Array;
  bg: Int32Array;
  alpha: Uint8Array;
  attr: Uint8Array;

  constructor(width: number, height: number) {
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    const n = this.width * this.height;
    this.glyph = new Uint16Array(n);
    this.fg = new Int32Array(n).fill(NO_CELL);
    this.bg = new Int32Array(n).fill(NO_CELL);
    this.alpha = new Uint8Array(n);
    this.attr = new Uint8Array(n);
  }

  resize(width: number, height: number): void {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const n = w * h;
    this.glyph = new Uint16Array(n);
    this.fg = new Int32Array(n).fill(NO_CELL);
    this.bg = new Int32Array(n).fill(NO_CELL);
    this.alpha = new Uint8Array(n);
    this.attr = new Uint8Array(n);
  }

  /** Copy every channel from another buffer of identical size. */
  copyFrom(other: FrameBuffer): void {
    if (other.width !== this.width || other.height !== this.height) {
      this.resize(other.width, other.height);
    }
    this.glyph.set(other.glyph);
    this.fg.set(other.fg);
    this.bg.set(other.bg);
    this.alpha.set(other.alpha);
    this.attr.set(other.attr);
  }
}

function blendChannel(base: number, top: number, mode: BlendMode, a: number): number {
  if (a >= 255 || mode === 'source') return top;
  let mixed: number;
  switch (mode) {
    case 'add':
      mixed = Math.min(255, base + top);
      break;
    case 'multiply':
      mixed = (base * top) / 255;
      break;
    case 'screen':
      mixed = 255 - ((255 - base) * (255 - top)) / 255;
      break;
    default:
      mixed = top;
  }
  return (base * (255 - a) + mixed * a) / 255;
}

function blendColor(base: number, top: number, mode: BlendMode, a: number): number {
  if (top === NO_CELL) return base;
  if (base === NO_CELL) return top;
  const br = (base >> 16) & 0xff;
  const bg = (base >> 8) & 0xff;
  const bb = base & 0xff;
  const tr = (top >> 16) & 0xff;
  const tg = (top >> 8) & 0xff;
  const tb = top & 0xff;
  const r = blendChannel(br, tr, mode, a) | 0;
  const g = blendChannel(bg, tg, mode, a) | 0;
  const b = blendChannel(bb, tb, mode, a) | 0;
  return (r << 16) | (g << 8) | b;
}

export interface CompositorStats {
  /** Cells whose value differed from the previous composite. */
  changed: number;
  /** Cells inspected. */
  visited: number;
}

/**
 * Composite `planes` (any order; sorted internally by `z`) into `target`.
 *
 * `scratch` is the previous frame so the compositor can report how many cells
 * actually moved — the caller uses that to choose diff vs. full redraw.
 */
/** True when the input must be filtered and/or sorted before compositing. */
export function needsOrdering(planes: readonly Plane[]): boolean {
  let prevZ = -Infinity;
  for (const p of planes) {
    if (!p.visible || p.width <= 0 || p.height <= 0) return true;
    if (p.z < prevZ) return true;
    prevZ = p.z;
  }
  return false;
}

export function composite(
  planes: readonly Plane[],
  target: FrameBuffer,
  scratch?: FrameBuffer,
): CompositorStats {
  const ordered: readonly Plane[] = needsOrdering(planes)
    ? planes.filter((p) => p.visible && p.width > 0 && p.height > 0).sort((a, b) => a.z - b.z)
    : planes;

  const n = target.width * target.height;
  target.glyph.fill(0);
  target.fg.fill(NO_CELL);
  target.bg.fill(NO_CELL);
  target.alpha.fill(0);
  target.attr.fill(Attr.None);

  for (const plane of ordered) {
    const opacity = clampAlpha(plane.opacity);
    if (opacity === 0) continue;
    const pw = Math.min(plane.width, target.width);
    const ph = Math.min(plane.height, target.height);
    const blend: BlendMode = plane.blend;

    if (plane.background !== NO_CELL) {
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const i = y * target.width + x;
          const a = opacity;
          target.bg[i] = blendColor(target.bg[i], plane.background, blend, a);
          if (target.alpha[i] < a) target.alpha[i] = a;
        }
      }
    }

    for (let y = 0; y < ph; y++) {
      const row = y * target.width;
      const prow = y * plane.width;
      for (let x = 0; x < pw; x++) {
        const i = row + x;
        const pi = prow + x;
        const fg = plane.fg[pi];
        const bg = plane.bg[pi];
        const cellAlpha = plane.alpha[pi];
        const g = plane.glyph[pi];
        const attr = plane.attr[pi];
        // alpha is standard: 0 = invisible, 255 = fully opaque.
        const a = Math.min(opacity, cellAlpha);
        if (a === 0) continue;
        if (fg !== NO_CELL) {
          target.fg[i] = blendColor(target.fg[i], fg, blend, a);
        }
        if (bg !== NO_CELL) {
          target.bg[i] = blendColor(target.bg[i], bg, blend, a);
        }
        if (g !== 0 || target.glyph[i] === 0) {
          target.glyph[i] = g;
        }
        if (attr !== Attr.None) target.attr[i] = attr;
        if (a > target.alpha[i]) target.alpha[i] = a;
      }
    }
  }

  if (!scratch || scratch.width !== target.width || scratch.height !== target.height) {
    return { changed: n, visited: n };
  }
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (
      scratch.glyph[i] !== target.glyph[i] ||
      scratch.fg[i] !== target.fg[i] ||
      scratch.bg[i] !== target.bg[i] ||
      scratch.alpha[i] !== target.alpha[i] ||
      scratch.attr[i] !== target.attr[i]
    ) {
      changed++;
    }
  }
  return { changed, visited: n };
}
