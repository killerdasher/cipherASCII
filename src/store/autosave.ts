/**
 * Autosave orchestration on top of the store.
 *
 * Policy (test-enforced in `tests/unit/autosaveStore.test.ts`):
 *
 * - while the project is dirty, document changes schedule a debounced
 *   ({@link AUTOSAVE_DEBOUNCE_MS}) snapshot; an oversized document is
 *   skipped with one status message and its previous recovery point stays;
 * - reaching a clean state (explicit save/load/new) clears the snapshot;
 * - {@link restoreAutosave} runs once at boot: a valid snapshot is loaded
 *   through the normal `setDocument` path, marked dirty, and re-pinned
 *   immediately so the recovery point is never left missing.
 *
 * Nothing here runs implicitly — the app wires {@link initAutosave} and
 * {@link restoreAutosave} from an effect, so tests stay timer-free unless
 * they opt in.
 */

import { useStore } from './index';
import type { Document } from '../core/types';
import {
  AUTOSAVE_KEY,
  AUTOSAVE_MAX_CHARS,
  clearAutosave,
  defaultStorage,
  readAutosave,
  writeAutosave,
} from '../core/project/autosave';
import { deserializeProject } from '../core/project/serialize';

/** Debounce between the last document change and the snapshot write. */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | null = null;
let warnedTooLarge = false;
let restoreAttempted = false;

function writeNow(): void {
  const storage = defaultStorage();
  if (!storage) return;
  if (!useStore.getState().isDirty) return;
  const result = writeAutosave(storage, useStore.getState().document);
  if (result.ok) {
    if (warnedTooLarge) {
      warnedTooLarge = false;
      useStore.getState().setStatusMessage('Autosave resumed');
    }
  } else if (result.error.code === 'too-large' && !warnedTooLarge) {
    warnedTooLarge = true;
    useStore.getState().setStatusMessage(
      `Autosave skipped: project exceeds ${AUTOSAVE_MAX_CHARS.toLocaleString()} characters; the previous recovery point is kept`,
    );
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeNow();
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Write any pending snapshot immediately (explicit save, test hook).
 */
export function flushAutosave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  writeNow();
}

/**
 * Start watching the store: dirty documents snapshot on a debounce, clean
 * ones clear the recovery point.
 *
 * @returns disposer — unsubscribes and flushes any pending snapshot
 */
export function initAutosave(): () => void {
  type Snapshot = readonly [Document, boolean];
  const selector = (s: ReturnType<typeof useStore.getState>): Snapshot => [
    s.document,
    s.isDirty,
  ];
  const unsubscribe = useStore.subscribe(
    selector,
    ([, dirty]) => {
      if (dirty) {
        schedule();
      } else {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        clearAutosave(defaultStorage());
      }
    },
    {
      equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1],
    },
  );
  return () => {
    unsubscribe();
    flushAutosave();
  };
}

export type RestoreResult = 'restored' | 'empty' | 'invalid' | 'failed' | 'unsupported' | 'already';

/**
 * Load the recovery snapshot once, if there is a valid one.
 *
 * The restored document goes through `setDocument` (so hydration stays
 * identical to File > Open), is marked dirty (it is unsaved work), and the
 * snapshot is rewritten synchronously — `setDocument` clears it as a clean
 * state, so the immediate write closes the window before any crash could
 * lose it again.
 *
 * @returns what happened, for the caller's status line and for tests
 */
export function restoreAutosave(): RestoreResult {
  if (restoreAttempted) return 'already';
  restoreAttempted = true;
  const storage = defaultStorage();
  if (!storage) return 'unsupported';
  const entry = readAutosave(storage);
  if (!entry.ok) return entry.error.code === 'invalid-project' ? 'invalid' : 'failed';
  if (!entry.value) return 'empty';
  const doc = deserializeProject(entry.value.json);
  if (!doc.ok) return 'invalid';
  const store = useStore.getState();
  store.setDocument(doc.value, { name: entry.value.name, data: entry.value.json });
  store.markDirty();
  writeNow();
  store.setStatusMessage(
    `Recovered unsaved work "${entry.value.name}" from ${entry.value.savedAt}`,
  );
  return 'restored';
}

/** Test hook: allow `restoreAutosave` and warnings to run again. */
export function resetAutosaveRuntimeForTests(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  warnedTooLarge = false;
  restoreAttempted = false;
}

export { AUTOSAVE_KEY, AUTOSAVE_MAX_CHARS };
