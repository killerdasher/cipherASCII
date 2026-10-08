/**
 * The one ramp sorter.
 *
 * Phase 3 replaced the two contradictory sort buttons (a hand-tuned coverage
 * table and a DOM-only canvas measurement, both quietly emitting light ->
 * dark while their labels promised dark -> light) with a single
 * calibration-backed sorter: characters are ordered by the ink actually
 * measured for them in `calibrationTable.ts`, falling back to the coverage
 * table only for characters nobody has calibrated yet - and the caller is
 * told how many fell back, so the UI can stay honest.
 *
 * Pure module: no DOM; measurements come from the committed table.
 */

import { characterDensity } from '../charsets/unicodeCharsets';
import { calibratedGlyph } from './calibration';

export type RampOrder = 'dark-to-light' | 'light-to-dark';

export interface RampSortResult {
  /** The characters, ordered by `order`; a permutation of the input. */
  sorted: string;
  /** `heuristic` when no input character had a measurement. */
  source: 'calibrated' | 'heuristic';
  /** Characters that had to fall back to the coverage table. */
  uncalibrated: number;
}

/**
 * Sort a ramp by ink coverage.
 *
 * `dark-to-light` (the default) puts the densest glyph first, matching the
 * ramp convention `inkToIndex` and every preset use. Ties keep the input
 * order, so sorting is stable and deterministic.
 *
 * @param chars - characters to order; order and duplicates are preserved
 * @param order - which end of the ramp starts
 * @returns the permutation, its measurement source and the fallback count
 */
export function sortRampByInk(chars: string, order: RampOrder = 'dark-to-light'): RampSortResult {
  let uncalibrated = 0;
  const entries = Array.from(chars).map((ch, index) => {
    const measured = calibratedGlyph(ch);
    if (!measured) uncalibrated++;
    return { ch, index, ink: measured ? measured.ink : characterDensity(ch) };
  });
  const direction = order === 'dark-to-light' ? -1 : 1;
  entries.sort((a, b) => direction * (a.ink - b.ink) || a.index - b.index);
  const all = entries.length;
  return {
    sorted: entries.map((entry) => entry.ch).join(''),
    source: uncalibrated === all ? 'heuristic' : 'calibrated',
    uncalibrated,
  };
}
