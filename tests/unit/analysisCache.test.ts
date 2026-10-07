import { describe, it, expect } from 'vitest';
import { AnalysisCache, DEFAULT_CACHE_ENTRIES, DEFAULT_CACHE_BYTES } from '../../src/core/analysis/cache';

function payload(bytes: number) {
  return { data: { byteLength: bytes } };
}

describe('AnalysisCache', () => {
  it('exposes documented defaults', () => {
    expect(DEFAULT_CACHE_ENTRIES).toBe(64);
    expect(DEFAULT_CACHE_BYTES).toBe(512 * 1024 * 1024);
  });

  it('computes a key once and counts hits and misses', () => {
    const cache = new AnalysisCache(8);
    let computes = 0;
    const compute = () => {
      computes++;
      return 'value';
    };
    expect(cache.getOrCompute('a', compute)).toBe('value');
    expect(cache.getOrCompute('a', compute)).toBe('value');
    expect(cache.getOrCompute('a', compute)).toBe('value');
    expect(computes).toBe(1);
    expect(cache.stats()).toMatchObject({ size: 1, hits: 2, misses: 1 });
  });

  it('evicts the least recently used entry when the entry cap trips', () => {
    const cache = new AnalysisCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // 'a' becomes most recent
    cache.set('c', 3);
    expect(cache.keys()).toEqual(['a', 'c']);
    expect(cache.get('b')).toBeUndefined();
  });

  it('evicts by byte budget before the entry cap', () => {
    const cache = new AnalysisCache(8, 100);
    cache.set('a', payload(60));
    cache.set('b', payload(60)); // 120 > 100: 'a' goes
    expect(cache.keys()).toEqual(['b']);
    expect(cache.stats().bytes).toBe(60);
  });

  it('keeps a single value that exceeds the whole budget', () => {
    const cache = new AnalysisCache(8, 10);
    cache.set('huge', payload(1000));
    expect(cache.keys()).toEqual(['huge']);
    expect(cache.stats().bytes).toBe(1000);
  });

  it('counts non-payload values as free', () => {
    const cache = new AnalysisCache(8, 10);
    cache.set('plain', { anything: true });
    expect(cache.stats().bytes).toBe(0);
    cache.set('payload', payload(4));
    expect(cache.keys()).toEqual(['plain', 'payload']);
  });

  it('replaces a value without double counting its bytes', () => {
    const cache = new AnalysisCache(8, 1000);
    cache.set('a', payload(100));
    cache.set('a', payload(300));
    expect(cache.keys()).toEqual(['a']);
    expect(cache.stats().bytes).toBe(300);
    expect(cache.stats().size).toBe(1);
  });

  it('clears entries and counters', () => {
    const cache = new AnalysisCache(4);
    cache.get('missing');
    cache.set('a', payload(8));
    cache.clear();
    expect(cache.stats()).toMatchObject({ size: 0, bytes: 0, hits: 0, misses: 0 });
    expect(cache.keys()).toEqual([]);
  });

  it('rejects invalid bounds', () => {
    expect(() => new AnalysisCache(0)).toThrow(RangeError);
    expect(() => new AnalysisCache(1.5)).toThrow(RangeError);
    expect(() => new AnalysisCache(1, 0)).toThrow(RangeError);
    expect(() => new AnalysisCache(1, -10)).toThrow(RangeError);
  });
});
