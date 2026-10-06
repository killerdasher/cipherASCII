/**
 * Pooled particle engine.
 *
 * Particles live in one `Float32Array` split into fixed-size records — no
 * object per particle, no per-frame allocation, no GC pauses during animation.
 *
 * Invariant: live records always occupy the contiguous prefix `[0, liveCount)`
 * of the buffer. Expired records are removed by swapping the tail record down
 * into the hole, so `spawn` is simply `liveCount++` and there is no free list
 * to keep consistent.
 *
 * Layout per record (7 floats): `x, y, vx, vy, life, maxLife, glyph`.
 */

const STRIDE = 7;
const IDX_X = 0;
const IDX_Y = 1;
const IDX_VX = 2;
const IDX_VY = 3;
const IDX_LIFE = 4;
const IDX_MAX = 5;
const IDX_GLYPH = 6;

export interface ParticleSpawn {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Lifetime in milliseconds. */
  life: number;
  /** Glyph index resolved through the owning canvas glyph table. */
  glyph: number;
}

export interface ParticleSystemOptions {
  capacity?: number;
  /** Gravity in cells/second². */
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  damping?: number;
}

export interface ParticleSnapshot {
  alive: number;
  capacity: number;
  spawned: number;
  expired: number;
  /** True when the last spawn was refused because the pool was full. */
  saturated: boolean;
}

export class ParticleSystem {
  private readonly data: Float32Array;
  private liveCount = 0;
  private spawnedTotal = 0;
  private expiredTotal = 0;
  private saturated = false;

  gravity: number;
  damping: number;

  constructor(options: ParticleSystemOptions = {}) {
    const capacity = Math.max(1, Math.floor(options.capacity ?? 512));
    this.data = new Float32Array(capacity * STRIDE);
    this.gravity = options.gravity ?? 0;
    this.damping = options.damping ?? 0;
  }

  get capacity(): number {
    return this.data.length / STRIDE;
  }

  get alive(): number {
    return this.liveCount;
  }

  get isFull(): boolean {
    return this.liveCount >= this.capacity;
  }

  /** Recycle every particle without reallocating the buffer. */
  clear(): void {
    this.liveCount = 0;
    this.saturated = false;
  }

  /**
   * Spawn one particle. Returns `false` when the pool is exhausted — callers
   * drop the particle; that is expected behaviour, not an error.
   */
  spawn(p: ParticleSpawn): boolean {
    if (this.liveCount >= this.capacity) {
      this.saturated = true;
      return false;
    }
    const o = this.liveCount * STRIDE;
    this.data[o + IDX_X] = p.x;
    this.data[o + IDX_Y] = p.y;
    this.data[o + IDX_VX] = p.vx ?? 0;
    this.data[o + IDX_VY] = p.vy ?? 0;
    this.data[o + IDX_LIFE] = p.life;
    this.data[o + IDX_MAX] = p.life > 0 ? p.life : 1;
    this.data[o + IDX_GLYPH] = p.glyph;
    this.liveCount++;
    this.spawnedTotal++;
    return true;
  }

  /** Advance every particle by `dt` milliseconds. */
  update(dt: number): void {
    if (this.liveCount === 0 || dt <= 0) return;
    const seconds = dt / 1000;
    const damping = this.damping > 0 ? Math.max(0, 1 - this.damping * seconds) : 1;
    let slot = 0;
    let scanned = this.liveCount;
    while (slot < scanned) {
      const o = slot * STRIDE;
      const life = this.data[o + IDX_LIFE] - dt;
      if (life <= 0) {
        this.removeAt(slot);
        scanned = this.liveCount;
        this.expiredTotal++;
        continue; // the tail record moved into `slot`; re-examine it
      }
      this.data[o + IDX_LIFE] = life;
      this.data[o + IDX_VY] += this.gravity * seconds;
      if (damping !== 1) {
        this.data[o + IDX_VX] *= damping;
        this.data[o + IDX_VY] *= damping;
      }
      this.data[o + IDX_X] += this.data[o + IDX_VX] * seconds;
      this.data[o + IDX_Y] += this.data[o + IDX_VY] * seconds;
      slot++;
    }
  }

  /** Swap the tail record into `slot` and shrink the live prefix. */
  private removeAt(slot: number): void {
    const last = this.liveCount - 1;
    if (slot !== last) {
      const src = last * STRIDE;
      const dst = slot * STRIDE;
      for (let i = 0; i < STRIDE; i++) this.data[dst + i] = this.data[src + i];
    }
    this.liveCount = last;
  }

  /** Position of live particle `i` (0..alive-1) written into `out`. */
  position(i: number, out: { x: number; y: number }): { x: number; y: number } {
    const o = i * STRIDE;
    out.x = this.data[o + IDX_X];
    out.y = this.data[o + IDX_Y];
    return out;
  }

  velocity(i: number, out: { x: number; y: number }): { x: number; y: number } {
    const o = i * STRIDE;
    out.x = this.data[o + IDX_VX];
    out.y = this.data[o + IDX_VY];
    return out;
  }

  /** Glyph index of live particle `i`. */
  glyphAt(i: number): number {
    return this.data[i * STRIDE + IDX_GLYPH];
  }

  /** Normalised remaining life of live particle `i`, 1 → 0. */
  lifeAt(i: number): number {
    const o = i * STRIDE;
    return Math.max(0, Math.min(1, this.data[o + IDX_LIFE] / this.data[o + IDX_MAX]));
  }

  /** Read-only view of the raw records (rendering and diagnostics). */
  get buffer(): Float32Array {
    return this.data;
  }

  get stride(): number {
    return STRIDE;
  }

  snapshot(): ParticleSnapshot {
    return {
      alive: this.liveCount,
      capacity: this.capacity,
      spawned: this.spawnedTotal,
      expired: this.expiredTotal,
      saturated: this.saturated,
    };
  }
}
