/**
 * Tiny bounded async key cache for the worker pool.
 *
 * Why this exists: the render pipeline re-decodes `activeLayer.source.dataUrl`
 * on every render (P1 in docs/V2_AUDIT.md §5), and the recommendation analysis
 * re-samples and re-scores the same image on every run (P2). Both are pure
 * functions of their inputs, so a one-entry cache turns "decode/scoring per
 * render" into "decode/scoring per distinct image".
 *
 * Properties:
 * - **LRU by re-insertion** — a hit refreshes recency, overflow drops the
 *   oldest key.
 * - **In-flight dedupe** — concurrent `getOrPut` calls for the same key share
 *   one `produce()` promise, so a burst of renders decodes once.
 * - **Failures are not cached** — a rejected `produce()` leaves the key empty;
 *   the next call retries.
 * - Values are trusted to be treated as immutable by every consumer (the
 *   raster cache hands out copies; `postMessage` structured-clones results to
 *   the main thread).
 */

export interface KeyCacheStats {
  hits: number;
  misses: number;
}

export interface KeyCache<T> {
  /** Resolve the value for `key`, producing it at most once per resident key. */
  getOrPut(key: string, produce: () => Promise<T>): Promise<T>;
  /** Drop every resident value and in-flight produce. Stats are cumulative. */
  clear(): void;
  readonly capacity: number;
  readonly size: number;
  readonly stats: KeyCacheStats;
}

export function createKeyCache<T>(capacity: number): KeyCache<T> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(`createKeyCache: capacity must be a positive integer, got ${capacity}`);
  }
  const entries = new Map<string, T>();
  const inFlight = new Map<string, Promise<T>>();
  let hits = 0;
  let misses = 0;
  // Bumped by clear(): a producer that started before the reset must not
  // repopulate the cache afterwards, and must not delete a newer retry's
  // in-flight entry when it settles.
  let epoch = 0;

  const cache: KeyCache<T> = {
    capacity,
    get size() {
      return entries.size;
    },
    get stats() {
      return { hits, misses };
    },
    clear() {
      entries.clear();
      inFlight.clear();
      epoch += 1;
    },
    getOrPut(key, produce) {
      if (entries.has(key)) {
        const value = entries.get(key)!;
        // Refresh recency: delete + re-insert moves the key to the end.
        entries.delete(key);
        entries.set(key, value);
        hits += 1;
        return Promise.resolve(value);
      }
      const pending = inFlight.get(key);
      if (pending) {
        hits += 1;
        return pending;
      }
      misses += 1;
      const startedAt = epoch;
      const promise = (async () => {
        try {
          const value = await produce();
          if (startedAt === epoch) {
            entries.set(key, value);
            while (entries.size > capacity) {
              const oldest = entries.keys().next().value as string | undefined;
              if (oldest === undefined) break;
              entries.delete(oldest);
            }
          }
          return value;
        } finally {
          // After clear() the epoch moved on: the map was already reset (and
          // may hold a newer attempt for this key) - leave it alone.
          if (startedAt === epoch) inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    },
  };
  return cache;
}
