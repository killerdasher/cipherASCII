/**
 * Layer blend registry.
 *
 * The document stores a {@link LayerBlend} id; this module is the single
 * table that maps ids to labels (UI) and to the engine compositor's
 * `BlendMode` (execution), so adding a mode is one entry here plus the
 * matching branch in `core/canvas/compose.ts`.
 */

import type { BlendMode } from '../canvas/cell';
import type { LayerBlend } from '../types';

export interface LayerBlendOption {
  id: LayerBlend;
  label: string;
  /** One-line description shown next to the blend picker. */
  description: string;
}

export const LAYER_BLENDS: readonly LayerBlendOption[] = [
  { id: 'normal', label: 'Normal', description: 'Alpha-composite over the layers below.' },
  { id: 'multiply', label: 'Multiply', description: 'Channel-wise product — stacked ink, darkens.' },
  { id: 'screen', label: 'Screen', description: 'Inverted product — lightens, glow friendly.' },
  { id: 'add', label: 'Add', description: 'Channel-wise sum, clamped — light on dark.' },
  {
    id: 'replace',
    label: 'Replace',
    description: 'Write the layer as-is, ignoring opacity.',
  },
];

const BLEND_IDS: ReadonlySet<string> = new Set(LAYER_BLENDS.map((b) => b.id));

export const DEFAULT_LAYER_BLEND: LayerBlend = 'normal';

/** Normalise any stored value to a known blend id (`normal` on garbage). */
export function resolveLayerBlend(raw: unknown): LayerBlend {
  return typeof raw === 'string' && BLEND_IDS.has(raw) ? (raw as LayerBlend) : DEFAULT_LAYER_BLEND;
}

/** Map a document blend id onto the compositor's engine mode. */
export function blendModeFor(blend: LayerBlend | undefined): BlendMode {
  switch (blend) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'add':
      return 'add';
    case 'replace':
      return 'source';
    default:
      return 'over';
  }
}
