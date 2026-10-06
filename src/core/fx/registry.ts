/**
 * Cell-effect registry.
 *
 * Effects are registered once at module load. The registry is the single
 * source of truth for the effect browser, the command palette, preset export
 * and the pipeline binder — nothing looks effects up by hard-coded id.
 */

import { Registry } from '../registry';
import type { CellEffect } from './types';
import { CORE_EFFECTS } from './library/core';
import { MOTION_EFFECTS } from './library/motion';
import { ENERGY_EFFECTS } from './library/energy';
import { DESTRUCTION_EFFECTS } from './library/destruction';
import { ATMOSPHERE_EFFECTS } from './library/atmosphere';
import { SIGNATURE_EFFECTS } from './library/signature';

export type AnyCellEffect = CellEffect<unknown>;

export const cellEffectRegistry = new Registry<AnyCellEffect>('cell effect');

const ALL: readonly AnyCellEffect[] = [
  ...SIGNATURE_EFFECTS,
  ...CORE_EFFECTS,
  ...MOTION_EFFECTS,
  ...ENERGY_EFFECTS,
  ...DESTRUCTION_EFFECTS,
  ...ATMOSPHERE_EFFECTS,
] as readonly AnyCellEffect[];

cellEffectRegistry.registerAll(ALL);

const BY_ID = new Map<string, AnyCellEffect>(ALL.map((e) => [e.id, e]));

export function getCellEffect(id: string): AnyCellEffect | undefined {
  return BY_ID.get(id);
}

export function listCellEffects(): readonly AnyCellEffect[] {
  return cellEffectRegistry.list();
}

/** Read-only map used by {@link import('./pipeline').CellEffectPipeline.bind}. */
export const CELL_EFFECT_MAP: ReadonlyMap<string, AnyCellEffect> = BY_ID;

/** Effects grouped by category, in registration order. */
export function effectsByCategory(): Map<string, AnyCellEffect[]> {
  const out = new Map<string, AnyCellEffect[]>();
  for (const effect of ALL) {
    const list = out.get(effect.category);
    if (list) list.push(effect);
    else out.set(effect.category, [effect]);
  }
  return out;
}

export const EFFECT_CATEGORIES = ['signature', 'core', 'motion', 'energy', 'destruction', 'atmosphere'] as const;

export const EFFECT_COUNT = ALL.length;
