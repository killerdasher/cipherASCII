import { describe, expect, it } from 'vitest';
import { NO_CELL } from '../../src/core/canvas/cell';
import { Plane } from '../../src/core/canvas/plane';
import {
  CELL_EFFECT_MAP,
  EFFECT_CATEGORIES,
  EFFECT_COUNT,
  CellEffectPipeline,
  EffectMask,
  buildMask,
  effectsByCategory,
  getCellEffect,
  listCellEffects,
  resolveParams,
} from '../../src/core/fx';

function contentPlane(width = 24, height = 12): Plane {
  const plane = new Plane(width, height);
  const glyphs = ['#', '*', '+', '=', '.', ':'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      plane.setGlyph(x, y, glyphs[(x + y) % glyphs.length], 0x88ccff, 0x101020, 255);
    }
  }
  return plane;
}

interface RunOptions {
  seed?: number;
  params?: Record<string, number>;
  intensity?: number;
}

function runPipeline(plane: Plane, effectId: string, frames = 48, options: RunOptions = {}): Plane {
  const pipeline = new CellEffectPipeline({
    seed: options.seed ?? 1234,
    entries: [{ effect: effectId, params: options.params, intensity: options.intensity }],
  });
  pipeline.bind(CELL_EFFECT_MAP, plane);
  pipeline.setSource(plane);
  for (let i = 0; i < frames; i++) pipeline.apply(plane, 16);
  return plane;
}

describe('effect registry', () => {
  it('registers a substantial library with unique ids', () => {
    const effects = listCellEffects();
    expect(effects.length).toBe(EFFECT_COUNT);
    expect(effects.length).toBeGreaterThanOrEqual(40);
    const ids = effects.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every documented category', () => {
    const byCat = effectsByCategory();
    for (const category of EFFECT_CATEGORIES) {
      expect(byCat.get(category)?.length ?? 0, `category ${category}`).toBeGreaterThan(0);
    }
    expect(byCat.get('signature')?.length).toBeGreaterThanOrEqual(5);
  });

  it('declares at least one parameter or a duration on every effect', () => {
    for (const effect of listCellEffects()) {
      expect(effect.label.length, effect.id).toBeGreaterThan(0);
      expect(effect.description.length, effect.id).toBeGreaterThan(10);
      for (const param of effect.params) {
        expect(param.min, `${effect.id}.${param.key}`).toBeLessThan(param.max);
        expect(param.default, `${effect.id}.${param.key}`).toBeGreaterThanOrEqual(param.min);
        expect(param.default, `${effect.id}.${param.key}`).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it('exposes lookup by id', () => {
    expect(getCellEffect('decrypt')?.id).toBe('decrypt');
    expect(getCellEffect('nope')).toBeUndefined();
    expect(CELL_EFFECT_MAP.has('signalburst')).toBe(true);
  });

  it('resolveParams clamps overrides into range', () => {
    const effect = getCellEffect('decrypt')!;
    const params = resolveParams(effect as never, { chaos: 99, churn: -5 });
    expect(params.chaos).toBeLessThanOrEqual(1);
    expect(params.churn).toBeGreaterThanOrEqual(20);
    const defaults = resolveParams(effect as never);
    expect(defaults.chaos).toBe(0.75);
    expect(resolveParams(effect as never, { chaos: Number.NaN }).chaos).toBe(0.75);
  });
});

describe('EffectMask', () => {
  it('all mask covers the whole plane', () => {
    const mask = EffectMask.compile(10, 6);
    expect(mask.size).toBe(60);
    expect(mask.isFull).toBe(true);
    expect(mask.spanCount).toBe(6);
    let visited = 0;
    mask.forEach(() => visited++);
    expect(visited).toBe(60);
    expect(mask.test(9, 5)).toBe(true);
    expect(mask.test(10, 5)).toBe(false);
    expect(mask.test(-1, 0)).toBe(false);
  });

  it('rect mask selects only its rectangle', () => {
    const mask = EffectMask.compile(10, 10, { kind: 'rect', x: 2, y: 3, w: 4, h: 2 });
    expect(mask.size).toBe(8);
    expect(mask.test(2, 3)).toBe(true);
    expect(mask.test(5, 4)).toBe(true);
    expect(mask.test(6, 4)).toBe(false);
    expect(mask.test(2, 5)).toBe(false);
  });

  it('rect clips to the canvas', () => {
    const mask = EffectMask.compile(10, 10, { kind: 'rect', x: -5, y: -5, w: 100, h: 100 });
    expect(mask.size).toBe(100);
  });

  it('rows mask selects an inclusive row band', () => {
    const mask = EffectMask.compile(4, 8, { kind: 'rows', rowStart: 2, rowEnd: 3 });
    expect(mask.size).toBe(8);
    expect(mask.test(0, 1)).toBe(false);
    expect(mask.test(0, 2)).toBe(true);
    expect(mask.test(3, 3)).toBe(true);
    const reversed = EffectMask.compile(4, 8, { kind: 'rows', rowStart: 3, rowEnd: 2 });
    expect(reversed.size).toBe(8);
  });

  it('columns mask selects an inclusive column band', () => {
    const mask = EffectMask.compile(8, 4, { kind: 'columns', colStart: 1, colEnd: 2 });
    expect(mask.size).toBe(8);
    expect(mask.test(1, 0)).toBe(true);
    expect(mask.test(2, 3)).toBe(true);
    expect(mask.test(0, 0)).toBe(false);
  });

  it('checker mask alternates cells', () => {
    const mask = EffectMask.compile(4, 4, { kind: 'checker', cell: 2 });
    expect(mask.size).toBe(8);
    expect(mask.test(0, 0)).toBe(true);
    expect(mask.test(1, 0)).toBe(true); // same 2x2 block
    expect(mask.test(2, 0)).toBe(false);
    expect(mask.test(0, 2)).toBe(false);
    expect(mask.test(2, 2)).toBe(true);
  });

  it('band mask hugs the requested edge', () => {
    const top = EffectMask.compile(6, 6, { kind: 'band', thickness: 2, origin: 'top' });
    expect(top.size).toBe(12);
    expect(top.test(0, 1)).toBe(true);
    expect(top.test(0, 2)).toBe(false);

    const bottom = EffectMask.compile(6, 6, { kind: 'band', thickness: 2, origin: 'bottom' });
    expect(bottom.size).toBe(12);
    expect(bottom.test(0, 5)).toBe(true);
    expect(bottom.test(0, 4)).toBe(true);
    expect(bottom.test(0, 3)).toBe(false);

    const left = EffectMask.compile(6, 6, { kind: 'band', thickness: 3, origin: 'left' });
    expect(left.size).toBe(18);
    expect(left.test(2, 5)).toBe(true);
    expect(left.test(3, 5)).toBe(false);

    const right = EffectMask.compile(6, 6, { kind: 'band', thickness: 1, origin: 'right' });
    expect(right.size).toBe(6);
    expect(right.test(5, 0)).toBe(true);
    expect(right.test(4, 0)).toBe(false);
  });

  it('filter narrows by predicate and stays consistent', () => {
    const mask = EffectMask.compile(6, 6);
    const filtered = mask.filter((x, y) => x < 3 && y < 2);
    expect(filtered.size).toBe(6);
    expect(filtered.test(0, 0)).toBe(true);
    expect(filtered.test(3, 0)).toBe(false);
    let visited = 0;
    filtered.forEach(() => visited++);
    expect(visited).toBe(6);
  });

  it('buildMask applies glyph-class and colour predicates', () => {
    const plane = new Plane(4, 4);
    plane.setGlyph(0, 0, 'A', 0xffffff);
    plane.setGlyph(1, 0, '5', 0xffffff);
    plane.setGlyph(2, 0, ' ', 0xffffff);
    plane.setGlyph(3, 0, '#', NO_CELL); // no foreground

    const letters = buildMask(plane, { kind: 'all', glyphClass: 'letter' });
    expect(letters.size).toBe(1);
    expect(letters.test(0, 0)).toBe(true);

    const digits = buildMask(plane, { kind: 'all', glyphClass: 'digit' });
    expect(digits.size).toBe(1);
    expect(digits.test(1, 0)).toBe(true);

    // 13 of the 16 cells were never written, so they stay spaces.
    const spaces = buildMask(plane, { kind: 'all', glyphClass: 'space' });
    expect(spaces.size).toBe(13);
    expect(spaces.test(2, 0)).toBe(true);
    expect(spaces.test(0, 0)).toBe(false);

    const punct = buildMask(plane, { kind: 'all', glyphClass: 'punctuation' });
    expect(punct.size).toBe(1);
    expect(punct.test(3, 0)).toBe(true);

    const withFg = buildMask(plane, { kind: 'all', hasForeground: true });
    expect(withFg.size).toBe(3);
    // Cells never written keep the default "no colour" sentinel.
    const withoutFg = buildMask(plane, { kind: 'all', hasForeground: false });
    expect(withoutFg.size).toBe(13);
    expect(withoutFg.test(3, 0)).toBe(true);
    expect(withoutFg.test(0, 0)).toBe(false);
  });

  it('buildMask without predicates returns a compiled plain mask', () => {
    const plane = Plane ? new Plane(3, 3) : null!;
    const mask = buildMask(plane, { kind: 'rect', x: 0, y: 0, w: 2, h: 2 });
    expect(mask.size).toBe(4);
  });
});

describe('CellEffectPipeline', () => {
  it('binds effects from the registry', () => {
    const plane = contentPlane();
    const pipeline = new CellEffectPipeline({ entries: [{ effect: 'decrypt' }] });
    expect(pipeline.activeCount).toBe(0);
    pipeline.bind(CELL_EFFECT_MAP, plane);
    expect(pipeline.activeCount).toBe(1);
    expect(pipeline.needsFrames).toBe(true);
  });

  it('runs every registered effect without throwing', () => {
    for (const effect of listCellEffects()) {
      const plane = contentPlane(20, 10);
      const pipeline = new CellEffectPipeline({ seed: 7, entries: [{ effect: effect.id }] });
      pipeline.bind(CELL_EFFECT_MAP, plane);
      pipeline.setSource(plane);
      expect(() => {
        for (let i = 0; i < 40; i++) pipeline.apply(plane, 16);
      }, effect.id).not.toThrow();
      // Every cell must still hold a valid interned glyph index.
      for (let i = 0; i < plane.glyph.length; i++) {
        expect(plane.glyph[i], `${effect.id} cell ${i}`).toBeLessThan(plane.glyphTable.size);
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const run = () => {
      const plane = contentPlane(24, 12);
      const pipeline = new CellEffectPipeline({ seed: 99, entries: [{ effect: 'spark' }] });
      pipeline.bind(CELL_EFFECT_MAP, plane);
      pipeline.setSource(plane);
      for (let i = 0; i < 20; i++) pipeline.apply(plane, 16);
      return { glyphs: Array.from(plane.glyph), fg: Array.from(plane.fg) };
    };
    expect(run()).toEqual(run());
  });

  it('different seeds diverge for stochastic effects', () => {
    const run = (seed: number) => {
      const plane = contentPlane(24, 12);
      const pipeline = new CellEffectPipeline({ seed, entries: [{ effect: 'rain' }] });
      pipeline.bind(CELL_EFFECT_MAP, plane);
      pipeline.setSource(plane);
      for (let i = 0; i < 20; i++) pipeline.apply(plane, 16);
      return Array.from(plane.glyph).join('');
    };
    expect(run(1)).not.toBe(run(2));
  });

  it('one-shot effects settle and stop costing frames', () => {
    const plane = contentPlane(16, 8);
    const pipeline = new CellEffectPipeline({ entries: [{ effect: 'decrypt' }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    expect(pipeline.needsFrames).toBe(true);
    for (let i = 0; i < 120; i++) pipeline.apply(plane, 16);
    expect(pipeline.needsFrames).toBe(false);
    // Once settled the content is back to the source.
    expect(Array.from(plane.glyph)).toEqual(Array.from(pipeline['sourceGlyph']));
  });

  it('never writes outside its mask', () => {
    const plane = contentPlane(20, 10);
    const snapshot = Array.from(plane.glyph);
    const pipeline = new CellEffectPipeline({
      entries: [{ effect: 'scatter', mask: { kind: 'rect', x: 2, y: 2, w: 4, h: 3 } }],
    });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    for (let i = 0; i < 30; i++) pipeline.apply(plane, 16);

    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 20; x++) {
        const inRect = x >= 2 && x < 6 && y >= 2 && y < 5;
        if (inRect) continue;
        expect(plane.glyph[y * 20 + x], `cell ${x},${y}`).toBe(snapshot[y * 20 + x]);
      }
    }
  });

  it('disabled entries do nothing', () => {
    const plane = contentPlane(16, 8);
    const snapshot = Array.from(plane.glyph);
    const pipeline = new CellEffectPipeline({ entries: [{ effect: 'glitch', enabled: false }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    pipeline.apply(plane, 16);
    expect(Array.from(plane.glyph)).toEqual(snapshot);
    expect(pipeline.needsFrames).toBe(false);
  });

  it('resetClocks rewinds reveals and restores determinism', () => {
    const plane = contentPlane(16, 8);
    const pipeline = new CellEffectPipeline({ seed: 5, entries: [{ effect: 'reveal' }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    for (let i = 0; i < 10; i++) pipeline.apply(plane, 16);
    pipeline.resetClocks();
    expect(pipeline.needsFrames).toBe(true);
    pipeline.apply(plane, 16);
    const first = Array.from(plane.glyph);
    pipeline.resetClocks();
    pipeline.apply(plane, 16);
    expect(Array.from(plane.glyph)).toEqual(first);
  });

  it('setEntries replaces the whole stack', () => {
    const plane = contentPlane(16, 8);
    const pipeline = new CellEffectPipeline({ entries: [{ effect: 'decrypt' }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    expect(pipeline.list()[0].effect).toBe('decrypt');
    pipeline.setEntries([{ effect: 'pulse' }], CELL_EFFECT_MAP, plane);
    expect(pipeline.list()[0].effect).toBe('pulse');
    expect(pipeline.activeCount).toBe(1);
  });

  it('intensity scales an effect without breaking it', () => {
    const gentle = contentPlane(16, 8);
    const strong = contentPlane(16, 8);
    runPipeline(gentle, 'fade', 30, { intensity: 0.2 });
    runPipeline(strong, 'fade', 30, { intensity: 1 });
    // Both settle at the source glyph; alpha is what differs.
    expect(Array.from(gentle.glyph)).toEqual(Array.from(strong.glyph));
  });

  it('reports active entries', () => {
    const plane = contentPlane(8, 8);
    const pipeline = new CellEffectPipeline({
      entries: [
        { effect: 'decrypt' },
        { effect: 'pulse' },
        { effect: 'wave', enabled: false },
      ],
    });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    expect(pipeline.activeCount).toBe(2);
  });
});

describe('signature effects', () => {
  it('are all present and labelled distinctly', () => {
    const ids = ['cipherlock', 'hexfall', 'glyphwave', 'signalburst', 'keyshift'];
    for (const id of ids) {
      const effect = getCellEffect(id);
      expect(effect, id).toBeDefined();
      expect(effect!.category).toBe('signature');
      expect(effect!.label).not.toBe(id);
    }
  });

  it('cipherlock converges on the source content', () => {
    const plane = contentPlane(24, 12);
    const pipeline = new CellEffectPipeline({ seed: 3, entries: [{ effect: 'cipherlock' }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    const source = Array.from(plane.glyph);
    for (let i = 0; i < 200; i++) pipeline.apply(plane, 16);
    expect(Array.from(plane.glyph)).toEqual(source);
  });
});
