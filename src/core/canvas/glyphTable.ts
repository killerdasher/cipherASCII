/**
 * Glyph interning table.
 *
 * Cells store a `Uint16Array` index rather than a string, so a frame of 20k
 * cells costs 40 kB instead of 20k heap strings. The table is append-only and
 * stable for the lifetime of the canvas that owns it.
 */
const MAX_GLYPHS = 0xffff;

export class GlyphTable {
  private readonly list: string[] = [' '];
  private readonly index = new Map<string, number>([[' ', 0]]);

  /** Intern `glyph`, returning its stable index (0 is always the space). */
  intern(glyph: string): number {
    const existing = this.index.get(glyph);
    if (existing !== undefined) return existing;
    // Table full: the glyph cannot be stored, so resolve to space (0) rather
    // than silently aliasing it onto whatever glyph happens to be last.
    if (this.list.length >= MAX_GLYPHS) return 0;
    const id = this.list.length;
    this.list.push(glyph);
    this.index.set(glyph, id);
    return id;
  }

  /** Glyph string for an index; unknown indices resolve to a space. */
  resolve(id: number): string {
    return this.list[id] ?? ' ';
  }

  /** Number of distinct glyphs interned so far. */
  get size(): number {
    return this.list.length;
  }

  /** Snapshot of every interned glyph (index order). */
  all(): readonly string[] {
    return this.list;
  }
}
