/**
 * Autosave envelope: a versioned, size-capped recovery snapshot of the
 * current document.
 *
 * Pure module — the storage is injected ({@link StorageLike}), so it runs in
 * Node tests, the browser (`localStorage`) and Electron alike. The envelope
 * keeps the canonical project JSON from `serializeProject`, so recovery is a
 * plain `deserializeProject` away.
 *
 * Policy:
 *
 * - entries larger than {@link AUTOSAVE_MAX_CHARS} are refused and the
 *   previous recovery point (if any) stays — a stale snapshot beats none;
 * - corrupt or malformed entries are discarded on read (the next write
 *   replaces them), so a bad entry can never brick startup;
 * - storage failures (quota, private mode, no DOM) surface as `io-error`
 *   results and never throw.
 */

import type { Document, Result } from '../types';
import { err, ok } from '../types';
import { serializeProject } from './serialize';

/** localStorage key for the recovery snapshot. */
export const AUTOSAVE_KEY = 'cipherascii.autosave.v1';

/** Refuse snapshots above this many characters (~2 MB of UTF-16 storage). */
export const AUTOSAVE_MAX_CHARS = 2_000_000;

/** What gets written: canonical project JSON plus recovery metadata. */
export interface AutosaveEnvelope {
  v: 1;
  /** ISO-8601 timestamp of the snapshot. */
  savedAt: string;
  /** Project name at snapshot time (for the recovery message). */
  name: string;
  /** Canonical project JSON, exactly as `serializeProject` produces it. */
  json: string;
}

/** The subset of `Storage` autosave needs (matches `localStorage`). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The ambient `localStorage`, or `null` when it is missing or unreadable
 * (Node, workers, hardened browsers).
 *
 * @returns the storage object or `null`
 */
export function defaultStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/**
 * Serialize `doc` into the storage slot.
 *
 * @param storage - target storage, or `null` to no-op with `io-error`
 * @param doc - document to snapshot
 * @param savedAt - ISO timestamp override (tests)
 * @returns the written envelope, or `too-large`/`io-error` (entry untouched)
 */
export function writeAutosave(
  storage: StorageLike | null,
  doc: Document,
  savedAt: string = new Date().toISOString(),
): Result<AutosaveEnvelope> {
  if (!storage) return err('io-error', 'No local storage is available for autosave');
  try {
    const json = serializeProject(doc);
    if (json.length > AUTOSAVE_MAX_CHARS) {
      return err(
        'too-large',
        `Autosave snapshot is ${json.length} characters (limit ${AUTOSAVE_MAX_CHARS})`,
      );
    }
    const envelope: AutosaveEnvelope = {
      v: 1,
      savedAt,
      name: doc.metadata.name || 'Untitled',
      json,
    };
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(envelope));
    return ok(envelope);
  } catch (e) {
    return err('io-error', 'Autosave write failed', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Read the recovery snapshot.
 *
 * @param storage - source storage, or `null` to no-op with `io-error`
 * @returns the envelope, `null` when nothing was ever saved, or
 * `invalid-project` (entry discarded) / `io-error` on failure
 */
export function readAutosave(storage: StorageLike | null): Result<AutosaveEnvelope | null> {
  if (!storage) return err('io-error', 'No local storage is available for autosave');
  try {
    const raw = storage.getItem(AUTOSAVE_KEY);
    if (raw === null) return ok(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      storage.removeItem(AUTOSAVE_KEY);
      return err('invalid-project', 'Autosave entry was corrupt JSON and has been discarded');
    }
    const entry = parsed as Record<string, unknown>;
    if (
      entry === null ||
      typeof entry !== 'object' ||
      entry.v !== 1 ||
      typeof entry.json !== 'string' ||
      typeof entry.savedAt !== 'string'
    ) {
      storage.removeItem(AUTOSAVE_KEY);
      return err('invalid-project', 'Autosave entry was malformed and has been discarded');
    }
    return ok({
      v: 1,
      savedAt: entry.savedAt,
      name: typeof entry.name === 'string' ? entry.name : 'Untitled',
      json: entry.json,
    });
  } catch (e) {
    return err('io-error', 'Autosave read failed', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Drop the recovery snapshot (explicit save/load reached a clean state).
 *
 * Never throws; a missing storage is a no-op.
 *
 * @param storage - target storage, or `null`
 */
export function clearAutosave(storage: StorageLike | null): void {
  try {
    storage?.removeItem(AUTOSAVE_KEY);
  } catch {
    /* quota/permission failures on delete are not worth surfacing */
  }
}
