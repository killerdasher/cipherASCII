/**
 * Dirty-rectangle tracking.
 *
 * Regions are stored as a flat `Int32Array` of `x,y,w,h` quadruples so marking
 * thousands of cells never allocates a region object. The set merges
 * overlapping/nearby rectangles on flush and collapses to a single bounding box
 * once the count budget is exceeded — a screen full of changed cells is cheaper
 * to redraw as one run than to walk as 4,000 fragments.
 */

const GROWTH_FACTOR = 2;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class DirtyRegions {
  private data: Int32Array;
  private count = 0;

  constructor(
    capacity = 64,
    /** Maximum fragments kept before collapsing into one bounding box. */
    private readonly maxRegions = 24,
  ) {
    this.data = new Int32Array(capacity * 4);
  }

  /** Number of live rectangles. */
  get size(): number {
    return this.count;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Expand the set to cover `x,y,w,h`. Clamps to the canvas bounds. */
  mark(x: number, y: number, w: number, h: number, boundsW: number, boundsH: number): void {
    const x0 = x < 0 ? 0 : x;
    const y0 = y < 0 ? 0 : y;
    let x1 = x + w;
    let y1 = y + h;
    if (x1 > boundsW) x1 = boundsW;
    if (y1 > boundsH) y1 = boundsH;
    if (x1 <= x0 || y1 <= y0) return;
    this.push(x0, y0, x1 - x0, y1 - y0);
  }

  private push(x: number, y: number, w: number, h: number): void {
    if (this.count >= this.maxRegions) {
      this.collapse();
      if (this.count > 0) {
        // Folding produced exactly one box; merge into it instead of growing.
        const i = 0;
        const x0 = Math.min(this.data[i], x);
        const y0 = Math.min(this.data[i + 1], y);
        const x1 = Math.max(this.data[i] + this.data[i + 2], x + w);
        const y1 = Math.max(this.data[i + 3] + this.data[i + 1], y + h);
        this.data[i] = x0;
        this.data[i + 1] = y0;
        this.data[i + 2] = x1 - x0;
        this.data[i + 3] = y1 - y0;
        return;
      }
    }
    if (this.count * 4 + 4 > this.data.length) {
      const next = new Int32Array(this.data.length * GROWTH_FACTOR);
      next.set(this.data);
      this.data = next;
    }
    const o = this.count * 4;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = w;
    this.data[o + 3] = h;
    this.count++;
  }

  /** Replace the set with its single bounding rectangle. */
  collapse(): void {
    if (this.count <= 1) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      if (this.data[o] < x0) x0 = this.data[o];
      if (this.data[o + 1] < y0) y0 = this.data[o + 1];
      if (this.data[o] + this.data[o + 2] > x1) x1 = this.data[o] + this.data[o + 2];
      if (this.data[o + 1] + this.data[o + 3] > y1) y1 = this.data[o + 1] + this.data[o + 3];
    }
    this.count = 1;
    this.data[0] = x0;
    this.data[1] = y0;
    this.data[2] = x1 - x0;
    this.data[3] = y1 - y0;
  }

  /**
   * Merge rectangles that overlap or touch within `slack` cells of each other.
   * Quadratic in the fragment count but the count is bounded by `maxRegions`.
   */
  merge(slack = 1): void {
    let i = 0;
    while (i < this.count) {
      let j = i + 1;
      while (j < this.count) {
        if (this.intersects(i, j, slack)) {
          this.union(i, j);
          this.remove(j);
        } else {
          j++;
        }
      }
      i++;
    }
  }

  private intersects(i: number, j: number, slack: number): boolean {
    const a = i * 4;
    const b = j * 4;
    return !(
      this.data[a] + this.data[a + 2] + slack < this.data[b] ||
      this.data[b] + this.data[b + 2] + slack < this.data[a] ||
      this.data[a + 1] + this.data[a + 3] + slack < this.data[b + 1] ||
      this.data[b + 1] + this.data[b + 3] + slack < this.data[a + 1]
    );
  }

  private union(i: number, j: number): void {
    const a = i * 4;
    const b = j * 4;
    const x0 = Math.min(this.data[a], this.data[b]);
    const y0 = Math.min(this.data[a + 1], this.data[b + 1]);
    const x1 = Math.max(this.data[a] + this.data[a + 2], this.data[b] + this.data[b + 2]);
    const y1 = Math.max(this.data[a + 1] + this.data[a + 3], this.data[b + 1] + this.data[b + 3]);
    this.data[a] = x0;
    this.data[a + 1] = y0;
    this.data[a + 2] = x1 - x0;
    this.data[a + 3] = y1 - y0;
  }

  private remove(index: number): void {
    this.data.copyWithin(index * 4, (index + 1) * 4, this.count * 4);
    this.count--;
  }

  /** Visit every rectangle. */
  forEach(fn: (x: number, y: number, w: number, h: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      fn(this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]);
    }
  }

  /** Total covered area in cells (overlaps may be counted twice). */
  area(): number {
    let total = 0;
    for (let i = 0; i < this.count; i++) total += this.data[i * 4 + 2] * this.data[i * 4 + 3];
    return total;
  }

  /** Union of every rectangle, or `null` when the set is empty. */
  bounds(): Rect | null {
    if (this.count === 0) return null;
    this.collapse();
    return { x: this.data[0], y: this.data[1], w: this.data[2], h: this.data[3] };
  }

  /** Copy of the live rectangles as objects (diagnostics/export only). */
  toRects(): Rect[] {
    const out: Rect[] = [];
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      out.push({ x: this.data[o], y: this.data[o + 1], w: this.data[o + 2], h: this.data[o + 3] });
    }
    return out;
  }

  reset(): void {
    this.count = 0;
  }
}
