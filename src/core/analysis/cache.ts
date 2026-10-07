/**
 * Bounded least-recently-used cache for analysis artefacts.
 *
 * Analysis results are large (one field per channel per image), so the cache
 * enforces both an entry count and a byte budget; whichever limit trips first
 * evicts the least recently used entry. Values are typed `unknown` - the cache
 * only ever stores opaque results and never transforms them - and the byte
 * estimate recognises anything carrying a `data: ArrayBufferView` (an
 * {@link AnalysisField} or a region buffer), everything else counts as free.
 *
 * Hits and misses are counted for tests and for the performance pass: a warm
 * cache must show `misses === 0` on a repeated identical analysis.
 */

/** Default entry cap (a full image analysis fills ~8 entries). */
export const DEFAULT_CACHE_ENTRIES = 64;
/** Default byte budget: 512 MB of typed-array payloads. */
export const DEFAULT_CACHE_BYTES = 512 * 1024 * 1024;

function payloadBytes(value: unknown): number {
  if (value !== null && typeof value === 'object') {
    const data = (value as { data?: { byteLength?: number } }).data;
    if (data && typeof data.byteLength === 'number') return data.byteLength;
  }
  return 0;
}

interface Entry {
  value: unknown;
  bytes: number;
}

export interface CacheStats {
  size: number;
  bytes: number;
  hits: number;
  misses: number;
}

/**
 * LRU cache bounded by entry count and payload bytes.
 *
 * @example
 * const cache = new AnalysisCache(2);
 * cache.getOrCompute('a', () => computeA());
 * cache.getOrCompute('a', () => computeA()); // hit, computes once
 */
export class AnalysisCache {
  private readonly entries = new Map<string, Entry>();
  private totalBytes = 0;
  private hitCount = 0;
  private missCount = 0;

  /**
   * @param maxEntries - entry cap (minimum 1)
   * @param maxBytes - payload byte budget (minimum 1)
   */
  constructor(
    private readonly maxEntries: number = DEFAULT_CACHE_ENTRIES,
    private readonly maxBytes: number = DEFAULT_CACHE_BYTES,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`cache maxEntries must be an integer >= 1, got ${maxEntries}`);
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError(`cache maxBytes must be an integer >= 1, got ${maxBytes}`);
    }
  }

  /** Cached value for `key`, promoted to most-recently used; `undefined` on a miss. */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hitCount++;
    return entry.value as T;
  }

  /** Store `value` under `key`, evicting LRU entries until both budgets fit. */
  set(key: string, value: unknown): void {
    const bytes = payloadBytes(value);
    const previous = this.entries.get(key);
    if (previous) {
      this.totalBytes -= previous.bytes;
      this.entries.delete(key);
    }
    // A single oversized value is still kept: dropping it would guarantee a
    // permanent miss loop for results larger than the whole budget.
    while (
      this.entries.size >= this.maxEntries ||
      (this.totalBytes + bytes > this.maxBytes && this.entries.size > 0)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
  }

  /** Return the cached value, computing and storing it on a miss. */
  getOrCompute<T>(key: string, compute: () => T): T {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = compute();
    this.set(key, value);
    return value;
  }

  /** Drop everything and reset the counters. */
  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
  }

  /** Entry count and counters; used by tests and the performance pass. */
  stats(): CacheStats {
    return {
      size: this.entries.size,
      bytes: this.totalBytes,
      hits: this.hitCount,
      misses: this.missCount,
    };
  }

  /** Keys in least- to most-recently-used order. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalBytes -= entry.bytes;
    this.entries.delete(key);
  }
}
