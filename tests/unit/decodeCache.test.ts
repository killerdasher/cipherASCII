import { describe, expect, it } from 'vitest';
import { createKeyCache } from '../../src/worker/decodeCache';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createKeyCache', () => {
  it('rejects non-positive-integer capacities', () => {
    expect(() => createKeyCache(0)).toThrow(/positive integer/);
    expect(() => createKeyCache(1.5)).toThrow(/positive integer/);
    expect(() => createKeyCache(-1)).toThrow(/positive integer/);
  });

  it('produces once per resident key', async () => {
    const cache = createKeyCache<string>(1);
    let produced = 0;
    const produce = async () => {
      produced += 1;
      return `value-${produced}`;
    };
    expect(await cache.getOrPut('a', produce)).toBe('value-1');
    expect(await cache.getOrPut('a', produce)).toBe('value-1');
    expect(await cache.getOrPut('a', produce)).toBe('value-1');
    expect(produced).toBe(1);
    expect(cache.stats).toEqual({ hits: 2, misses: 1 });
    expect(cache.size).toBe(1);
  });

  it('deduplicates concurrent producers for the same key', async () => {
    const cache = createKeyCache<string>(1);
    const gate = deferred<string>();
    let produced = 0;
    const produce = () => {
      produced += 1;
      return gate.promise;
    };
    const first = cache.getOrPut('a', produce);
    const second = cache.getOrPut('a', produce);
    gate.resolve('shared');
    expect(await first).toBe('shared');
    expect(await second).toBe('shared');
    expect(produced).toBe(1);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
  });

  it('evicts the least recently used key at capacity', async () => {
    const cache = createKeyCache<number>(2);
    let produced = 0;
    const produce = async () => (produced += 1);
    await cache.getOrPut('a', produce); // miss -> 1
    await cache.getOrPut('b', produce); // miss -> 2
    await cache.getOrPut('a', produce); // hit, refreshes a's recency
    await cache.getOrPut('c', produce); // miss -> 3, evicts b (oldest)
    expect(cache.size).toBe(2);

    await cache.getOrPut('a', produce); // still resident
    expect(produced).toBe(3);
    await cache.getOrPut('b', produce); // evicted -> produced again
    expect(produced).toBe(4);
    expect(cache.stats).toEqual({ hits: 2, misses: 4 });
  });

  it('does not cache failures', async () => {
    const cache = createKeyCache<string>(1);
    let attempt = 0;
    const produce = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('decode exploded');
      return 'recovered';
    };
    await expect(cache.getOrPut('a', produce)).rejects.toThrow('decode exploded');
    expect(cache.size).toBe(0);
    expect(await cache.getOrPut('a', produce)).toBe('recovered');
    expect(attempt).toBe(2);
  });

  it('clear() drops resident values and in-flight producers', async () => {
    const cache = createKeyCache<string>(2);
    await cache.getOrPut('a', async () => 'kept');
    const gate = deferred<string>();
    const inFlight = cache.getOrPut('b', () => gate.promise);
    cache.clear();
    expect(cache.size).toBe(0);
    gate.resolve('late');
    expect(await inFlight).toBe('late');
    // The cleared key is absent even though the in-flight call resolved.
    let produced = 0;
    await cache.getOrPut('b', async () => {
      produced += 1;
      return 'fresh';
    });
    expect(produced).toBe(1);
    // Stats are cumulative across clear().
    expect(cache.stats.misses).toBeGreaterThan(0);
  });
});
