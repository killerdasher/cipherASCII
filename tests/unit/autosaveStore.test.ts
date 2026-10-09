// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '../../src/store';
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_KEY,
  flushAutosave,
  initAutosave,
  resetAutosaveRuntimeForTests,
  restoreAutosave,
} from '../../src/store/autosave';
import { deserializeProject } from '../../src/core/project/serialize';
import type { Document } from '../../src/core/types';

function entryJson(): string | null {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  return (JSON.parse(raw) as { json: string }).json;
}

describe('store autosave', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    resetAutosaveRuntimeForTests();
    localStorage.removeItem(AUTOSAVE_KEY);
    useStore.getState().newDocument();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    resetAutosaveRuntimeForTests();
    localStorage.removeItem(AUTOSAVE_KEY);
  });

  it('snapshots dirty edits and clears the slot on a clean state', () => {
    dispose = initAutosave();
    useStore.getState().addCreativeLayer();
    flushAutosave();
    expect(entryJson()).not.toBeNull();

    const restored = deserializeProject(entryJson()!);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.value.id).toBe(useStore.getState().document.id);
      expect(restored.value.layers).toHaveLength(2);
    }

    // Loading a fresh document is clean: the recovery point goes away.
    useStore.getState().newDocument();
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('debounces writes until the quiet window elapses', () => {
    vi.useFakeTimers();
    try {
      dispose = initAutosave();
      useStore.getState().markDirty();
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
      expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
      vi.advanceTimersByTime(1);
      expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a snapshot, marks it dirty and re-pins the recovery point', () => {
    // Previous session: dirty work snapshotted, then the app closed.
    useStore.getState().addCreativeLayer();
    flushAutosave();
    const snapshotId = useStore.getState().document.id;

    // Fresh session: a clean boot document, then the app wires autosave.
    useStore.getState().newDocument();
    expect(useStore.getState().document.id).not.toBe(snapshotId);
    dispose = initAutosave();

    expect(restoreAutosave()).toBe('restored');
    expect(useStore.getState().document.id).toBe(snapshotId);
    expect(useStore.getState().isDirty).toBe(true);
    expect(useStore.getState().statusMessage).toContain('Recovered unsaved work');
    // setDocument (clean) cleared the slot; restore re-pinned it immediately.
    expect(entryJson()).not.toBeNull();
    expect(restoreAutosave()).toBe('already');
  });

  it('reports an empty slot and never overwrites without a snapshot', () => {
    expect(restoreAutosave()).toBe('empty');
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('flushing a clean project does not create a snapshot', () => {
    dispose = initAutosave();
    useStore.getState().newDocument();
    flushAutosave();
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  it('restored documents hydrate document-owned slices (schema 4)', () => {
    const st = useStore.getState();
    const doc: Document = {
      ...st.document,
      paletteId: 'restored-palette',
      palettes: [
        {
          id: 'restored-palette',
          name: 'Restored',
          colors: [{ rgb: 0x112233 }],
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      themeId: st.document.themeId,
    };
    st.setDocument(doc);
    st.markDirty();
    flushAutosave();

    // Fresh session boots clean, then wires autosave and recovers.
    useStore.getState().newDocument();
    dispose = initAutosave();
    expect(restoreAutosave()).toBe('restored');
    expect(useStore.getState().activePaletteId).toBe('restored-palette');
    expect(useStore.getState().palettes[0].id).toBe('restored-palette');
  });
});
