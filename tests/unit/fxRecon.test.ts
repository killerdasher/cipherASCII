/**
 * Effect recon: every registered cell effect must *visibly change* the canvas
 * while it runs.
 *
 * The older suites proved effects do not throw; a broken effect that silently
 * does nothing passes those. This test drives each effect across its whole
 * duration against two fixtures (a dense field and a mixed content/blank
 * field, both coloured) and fails for any effect whose output never differs
 * from its input - which is exactly what an artist sees as "the effect does
 * nothing".
 */

import { describe, expect, it } from 'vitest';
import { Plane } from '../../src/core/canvas/plane';
import { CELL_EFFECT_MAP, CellEffectPipeline, listCellEffects } from '../../src/core/fx';

const STEP = 16; // ms per simulated frame
const MAX_FRAMES = 240; // 3.84 s of animation - longer than any effect

/** Dense field: every cell filled, coloured (exercises colour-only effects). */
function densePlane(width = 24, height = 12): Plane {
  const plane = new Plane(width, height);
  const glyphs = ['#', '*', '+', '=', '.', ':'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      plane.setGlyph(x, y, glyphs[(x + y) % glyphs.length], 0x88ccff, 0x101020, 255);
    }
  }
  return plane;
}

/** Mixed field: content block surrounded by blank cells (exercises effects
 *  that only write into empty space - rain, snow, sparks, borders). */
function mixedPlane(width = 24, height = 12): Plane {
  const plane = new Plane(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= 4 && x < width - 4 && y >= 3 && y < height - 3;
      if (inside) plane.setGlyph(x, y, '@', 0xffcc88, 0x201030, 255);
      else plane.setGlyph(x, y, ' ', -1, -1, 255);
    }
  }
  return plane;
}

/** Cheap structural fingerprint: glyph + fg + bg per cell. */
function fingerprint(plane: Plane): string {
  const n = plane.width * plane.height;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `${plane.glyph[i]},${plane.fg[i]},${plane.bg[i]};`;
  }
  return out;
}

/** Run `effectId` for its full duration and report cells changed vs source. */
function maxDelta(effectId: string, factory: () => Plane): number {
  const plane = factory();
  const pipeline = new CellEffectPipeline({
    seed: 42,
    entries: [{ effect: effectId, enabled: true, intensity: 1 }],
  });
  pipeline.bind(CELL_EFFECT_MAP, plane);
  pipeline.setSource(plane);
  const before = fingerprint(plane);
  let best = 0;
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    pipeline.apply(plane, STEP);
    const now = fingerprint(plane);
    if (now !== before) {
      // Count differing cells once anything changed.
      let diff = 0;
      const n = plane.width * plane.height;
      const old = before.split(';');
      for (let i = 0; i < n; i++) if (`${plane.glyph[i]},${plane.fg[i]},${plane.bg[i]},` !== `${old[i]},`) diff++;
      return diff;
    }
    if (!pipeline.needsFrames) break;
    best = 0;
  }
  return best;
}

describe('effect recon', () => {
  it('every registered effect visibly changes the canvas on a dense field', () => {
    const blind: string[] = [];
    for (const effect of listCellEffects()) {
      if (maxDelta(effect.id, densePlane) === 0) blind.push(effect.id);
    }
    expect(blind, `effects that do nothing on dense input: ${blind.join(', ')}`).toEqual([]);
  });

  it('every registered effect visibly changes the canvas on a mixed field', () => {
    const blind: string[] = [];
    for (const effect of listCellEffects()) {
      if (maxDelta(effect.id, mixedPlane) === 0) blind.push(effect.id);
    }
    expect(blind, `effects that do nothing on mixed input: ${blind.join(', ')}`).toEqual([]);
  });
});
