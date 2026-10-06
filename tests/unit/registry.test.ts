import { describe, expect, it } from 'vitest';
import { Registry } from '../../src/core/registry';

describe('registry', () => {
  it('registers and retrieves by id', () => {
    const reg = new Registry<{ id: string; value: number }>('test');
    reg.register({ id: 'a', value: 1 });
    reg.register({ id: 'b', value: 2 });
    expect(reg.get('a')?.value).toBe(1);
    expect(reg.get('b')?.value).toBe(2);
    expect(reg.get('c')).toBeUndefined();
  });

  it('require throws for missing id', () => {
    const reg = new Registry<{ id: string }>('test');
    expect(() => reg.require('missing')).toThrow();
  });

  it('list returns all registered', () => {
    const reg = new Registry<{ id: string }>('test');
    reg.register({ id: 'x' });
    reg.register({ id: 'y' });
    expect(reg.list().map((e) => e.id).sort()).toEqual(['x', 'y']);
  });

  it('registerAll throws on duplicate by default', () => {
    const reg = new Registry<{ id: string; v: number }>('test');
    reg.register({ id: 'a', v: 1 });
    expect(() => reg.registerAll([{ id: 'a', v: 2 }, { id: 'b', v: 3 }])).toThrow();
  });

  it('registerAll with allowOverride replaces existing', () => {
    const reg = new Registry<{ id: string; v: number }>('test', { allowOverride: true });
    reg.register({ id: 'a', v: 1 });
    reg.registerAll([{ id: 'a', v: 2 }, { id: 'b', v: 3 }]);
    expect(reg.get('a')?.v).toBe(2);
    expect(reg.get('b')?.v).toBe(3);
  });

  it('different registry types are independent', () => {
    const a = new Registry<{ id: string }>('type-a');
    const b = new Registry<{ id: string }>('type-b');
    a.register({ id: 'shared' });
    b.register({ id: 'shared' });
    expect(a.list().length).toBe(1);
    expect(b.list().length).toBe(1);
  });
});