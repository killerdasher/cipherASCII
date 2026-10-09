import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_CHARS,
  clearAutosave,
  defaultStorage,
  readAutosave,
  writeAutosave,
  type StorageLike,
} from '../../src/core/project/autosave';
import { createDocument } from '../../src/core/project/schema';
import { deserializeProject } from '../../src/core/project/serialize';
import type { Document } from '../../src/core/types';

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('autosave envelope', () => {
  it('round-trips a document through the storage slot', () => {
    const storage = fakeStorage();
    const doc = createDocument({ metadata: { ...createDocument().metadata, name: 'Recover me' } });
    const written = writeAutosave(storage, doc, '2026-10-09T00:00:00.000Z');
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.v).toBe(1);
    expect(written.value.name).toBe('Recover me');
    expect(written.value.savedAt).toBe('2026-10-09T00:00:00.000Z');

    const read = readAutosave(storage);
    expect(read.ok).toBe(true);
    if (!read.ok || !read.value) throw new Error('expected an entry');
    const restored = deserializeProject(read.value.json);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.id).toBe(doc.id);
  });

  it('reads an empty slot as null', () => {
    expect(readAutosave(fakeStorage())).toEqual({ ok: true, value: null });
  });

  it('discards corrupt JSON entries on read', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, '{not json');
    const read = readAutosave(storage);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe('invalid-project');
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('discards structurally malformed envelopes on read', () => {
    const storage = fakeStorage();
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({ v: 2, json: 'x', savedAt: 'now' }));
    const read = readAutosave(storage);
    expect(read.ok).toBe(false);
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('refuses oversized documents and keeps the previous recovery point', () => {
    const storage = fakeStorage();
    const small = createDocument();
    expect(writeAutosave(storage, small).ok).toBe(true);

    const huge = createDocument() as Document & { metadata: { description: string } };
    huge.metadata.description = 'x'.repeat(AUTOSAVE_MAX_CHARS);
    const big = writeAutosave(storage, huge);
    expect(big.ok).toBe(false);
    if (big.ok) return;
    expect(big.error.code).toBe('too-large');
    // The old entry is untouched: a stale snapshot beats none.
    expect(readAutosave(storage).ok).toBe(true);
  });

  it('surfaces io-error instead of throwing without storage', () => {
    const write = writeAutosave(null, createDocument());
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.code).toBe('io-error');
    const read = readAutosave(null);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe('io-error');
    expect(() => clearAutosave(null)).not.toThrow();
  });

  it('clearAutosave removes the slot', () => {
    const storage = fakeStorage();
    writeAutosave(storage, createDocument());
    clearAutosave(storage);
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('defaultStorage is null in Node (no DOM storage)', () => {
    expect(defaultStorage()).toBeNull();
  });
});
