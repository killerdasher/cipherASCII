/**
 * Virtual canvas — the renderable representation effects write into.
 *
 * Pipeline: planes → compositor → frame buffer → diff → dirty regions.
 *
 * Nothing above this layer touches a real `<canvas>` or a terminal. That keeps
 * every visual effect unit-testable and makes the renderer a pure consumer of
 * a cell buffer.
 *
 * Double buffering is pointer swapping: `composite()` fully rewrites the target
 * each frame, so the buffers can trade places without a copy.
 */

import type { BlendMode } from './cell';
import { FrameBuffer, composite } from './compose';
import { DEFAULT_FULL_THRESHOLD, type DiffResult, diffFrames } from './diff';
import { GlyphTable } from './glyphTable';
import { Plane, type PlaneOptions } from './plane';

export interface VirtualCanvasOptions {
  fullThreshold?: number;
}

export class VirtualCanvas {
  width: number;
  height: number;
  private planes: Plane[] = [];
  /**
   * One glyph table for the whole canvas.
   *
   * Frame buffers store glyph *indices*, so every plane must resolve ids
   * through the same table — otherwise compositing two layers would splice
   * unrelated code points together.
   */
  readonly glyphs = new GlyphTable();
  private front: FrameBuffer;
  private back: FrameBuffer;
  private readonly fullThreshold: number;
  private lastDiff: DiffResult | null = null;
  private frameNumber = 0;

  constructor(width: number, height: number, options: VirtualCanvasOptions = {}) {
    this.width = Math.max(0, width | 0);
    this.height = Math.max(0, height | 0);
    this.front = new FrameBuffer(this.width, this.height);
    this.back = new FrameBuffer(this.width, this.height);
    this.fullThreshold = options.fullThreshold ?? DEFAULT_FULL_THRESHOLD;
  }

  /** Create a plane and return it. Planes are ordered by `z` at composite time. */
  addPlane(options: PlaneOptions = {}): Plane {
    const plane = new Plane(this.width, this.height, { ...options, glyphTable: this.glyphs });
    this.planes.push(plane);
    return plane;
  }

  removePlane(plane: Plane): void {
    const i = this.planes.indexOf(plane);
    if (i >= 0) this.planes.splice(i, 1);
  }

  listPlanes(): readonly Plane[] {
    return this.planes;
  }

  planeByName(name: string): Plane | undefined {
    return this.planes.find((p) => p.name === name);
  }

  resize(width: number, height: number): void {
    const w = Math.max(0, width | 0);
    const h = Math.max(0, height | 0);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    for (const plane of this.planes) plane.resize(w, h);
    this.front.resize(w, h);
    this.back.resize(w, h);
    this.lastDiff = null;
  }

  /** Mark every plane and the frame buffers as fully invalid. */
  invalidate(): void {
    for (const plane of this.planes) {
      plane.dirty.reset();
      plane.dirty.mark(0, 0, plane.width, plane.height, plane.width, plane.height);
    }
    this.lastDiff = null;
  }

  /**
   * Composite all planes and diff against the previous frame.
   *
   * Returns the diff describing what the renderer must repaint, and swaps the
   * double buffer so the next frame composites into the other buffer.
   */
  render(): DiffResult {
    const started = performance.now();
    composite(this.planes, this.back, this.front);
    const diff = diffFrames(this.front, this.back, {
      boundsW: this.width,
      boundsH: this.height,
      fullThreshold: this.fullThreshold,
    });
    diff.ms = performance.now() - started;

    for (const plane of this.planes) plane.dirty.reset();

    const tmp = this.front;
    this.front = this.back;
    this.back = tmp;
    this.lastDiff = diff;
    this.frameNumber++;
    return diff;
  }

  /** The most recently presented frame. */
  get frame(): FrameBuffer {
    return this.front;
  }

  /** Resolve a glyph index from {@link frame} to its string. */
  glyphAt(index: number): string {
    return this.glyphs.resolve(this.front.glyph[index]);
  }

  get previousFrame(): FrameBuffer {
    return this.back;
  }

  get lastDiffResult(): DiffResult | null {
    return this.lastDiff;
  }

  get frames(): number {
    return this.frameNumber;
  }

  /** Fraction of the canvas covered by the last diff (0 when nothing changed). */
  get lastDirtyRatio(): number {
    return this.lastDiff?.ratio ?? 0;
  }

  /** Drop every plane (used when a document swap invalidates the scene). */
  clearPlanes(): void {
    this.planes.length = 0;
    this.lastDiff = null;
  }

  /** Convenience: create a named plane with a blend mode. */
  layer(name: string, z: number, blend: BlendMode = 'over'): Plane {
    const plane = this.addPlane({ z, blend });
    plane.name = name;
    return plane;
  }
}
