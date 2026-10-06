/**
 * Pure helpers for editing a cell-effect stack.
 *
 * The store keeps `CellEffectEntry[]` as immutable state, so every edit
 * returns a new array with identity-stable untouched entries — the runtime
 * compares by identity to decide whether anything actually changed.
 */

import type { CellEffectEntry } from './pipeline';

/** Append an entry (parameters come pre-merged from the registry defaults). */
export function appendCellEffect(list: readonly CellEffectEntry[], entry: CellEffectEntry): CellEffectEntry[] {
  return [...list, entry];
}

/** Drop the entry at `index`; returns the input array when the index is bad. */
export function removeCellEffectAt(list: readonly CellEffectEntry[], index: number): CellEffectEntry[] {
  if (index < 0 || index >= list.length) return list as CellEffectEntry[];
  return list.filter((_, i) => i !== index);
}

/** Move an entry within the stack (paint order: last entry renders on top). */
export function moveCellEffect(
  list: readonly CellEffectEntry[],
  from: number,
  to: number,
): CellEffectEntry[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) {
    return list as CellEffectEntry[];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Shallow-merge `patch` into one entry. */
export function patchCellEffect(
  list: readonly CellEffectEntry[],
  index: number,
  patch: Partial<Omit<CellEffectEntry, 'effect'>>,
): CellEffectEntry[] {
  if (index < 0 || index >= list.length) return list as CellEffectEntry[];
  return list.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
}

/** Merge `params` into one entry's parameter map. */
export function setCellEffectParams(
  list: readonly CellEffectEntry[],
  index: number,
  params: Record<string, number>,
): CellEffectEntry[] {
  if (index < 0 || index >= list.length) return list as CellEffectEntry[];
  return list.map((entry, i) => (i === index ? { ...entry, params: { ...entry.params, ...params } } : entry));
}
