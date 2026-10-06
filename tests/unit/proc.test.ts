import {
  listGenerators,
  runGenerator,
  type GeneratorContext,
} from '../../src/core/proc/procedural';
import { isPrintableChar } from '../../src/core/util';

const WIDTH = 24;
const HEIGHT = 10;
const RAMP = '@%#*+=-:. ';
const SEED = 'unit-test-seed';

function ctx(over: Partial<GeneratorContext> = {}): GeneratorContext {
  return { width: WIDTH, height: HEIGHT, seed: SEED, charset: RAMP, ...over };
}

function at(grid: { width: number; chars: string[] }, x: number, y: number): string {
  return grid.chars[y * grid.width + x];
}

describe('listGenerators', () => {
  it('exposes at least six generators with unique ids', () => {
    const generators = listGenerators();
    expect(generators.length).toBeGreaterThanOrEqual(6);
    const ids = generators.map((generator) => generator.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
    for (const generator of generators) {
      expect(generator.label.trim().length).toBeGreaterThan(0);
      expect(generator.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('runGenerator', () => {
  for (const generator of listGenerators()) {
    it(`${generator.id}: deterministic ${WIDTH}x${HEIGHT} grid of printable characters`, () => {
      const first = runGenerator(generator.id, ctx(), {});
      const second = runGenerator(generator.id, ctx(), {});

      expect(first.width).toBe(WIDTH);
      expect(first.height).toBe(HEIGHT);
      expect(first.chars).toHaveLength(WIDTH * HEIGHT);

      const nonPrintable = first.chars.filter((ch) => !isPrintableChar(ch));
      expect(nonPrintable).toEqual([]);
      const control = first.chars.filter((ch) => (ch.codePointAt(0) ?? 0) < 32);
      expect(control).toEqual([]);

      expect(second.width).toBe(WIDTH);
      expect(second.height).toBe(HEIGHT);
      expect(second.chars).toEqual(first.chars);
    });
  }

  it('noise changes when the seed changes', () => {
    const a = runGenerator('noise', ctx({ seed: 'seed-a' }), {});
    const b = runGenerator('noise', ctx({ seed: 'seed-b' }), {});
    expect(a.chars).not.toEqual(b.chars);
  });
});

describe('gradient generator', () => {
  it('advances monotonically left to right for direction horizontal', () => {
    const grid = runGenerator('gradient', ctx(), { direction: 'horizontal' });
    const ramp = [...RAMP];
    for (let y = 0; y < grid.height; y++) {
      let previous = -1;
      for (let x = 0; x < grid.width; x++) {
        const position = ramp.indexOf(at(grid, x, y));
        expect(position).toBeGreaterThanOrEqual(0);
        expect(position).toBeGreaterThanOrEqual(previous);
        previous = position;
      }
      expect(previous).toBe(ramp.length - 1);
    }
  });

  it('advances monotonically top to bottom for direction vertical', () => {
    const grid = runGenerator('gradient', ctx(), { direction: 'vertical' });
    const ramp = [...RAMP];
    for (let x = 0; x < grid.width; x++) {
      let previous = -1;
      for (let y = 0; y < grid.height; y++) {
        const position = ramp.indexOf(at(grid, x, y));
        expect(position).toBeGreaterThanOrEqual(previous);
        previous = position;
      }
      expect(previous).toBe(ramp.length - 1);
    }
  });
});

describe('checker generator', () => {
  it('alternates 2x2 blocks with cellSize 2', () => {
    const grid = runGenerator('checker', ctx(), { cellSize: 2 });
    expect(grid.width).toBe(WIDTH);
    expect(grid.height).toBe(HEIGHT);

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x + 1 < grid.width; x++) {
        if (x % 2 === 0) expect(at(grid, x + 1, y)).toBe(at(grid, x, y));
        else expect(at(grid, x + 1, y)).not.toBe(at(grid, x, y));
      }
    }
    for (let x = 0; x < grid.width; x++) {
      for (let y = 0; y + 1 < grid.height; y++) {
        if (y % 2 === 0) expect(at(grid, x, y + 1)).toBe(at(grid, x, y));
        else expect(at(grid, x, y + 1)).not.toBe(at(grid, x, y));
      }
    }
    expect(new Set(grid.chars).size).toBe(2);
  });
});

describe('border generator', () => {
  it('draws box-drawing corners with a space interior by default', () => {
    const grid = runGenerator('border', ctx(), {});
    expect(grid.width).toBe(WIDTH);
    expect(grid.height).toBe(HEIGHT);

    expect(at(grid, 0, 0)).toBe('┌');
    expect(at(grid, WIDTH - 1, 0)).toBe('┐');
    expect(at(grid, 0, HEIGHT - 1)).toBe('└');
    expect(at(grid, WIDTH - 1, HEIGHT - 1)).toBe('┘');

    for (let x = 1; x < WIDTH - 1; x++) {
      expect(at(grid, x, 0)).toBe('─');
      expect(at(grid, x, HEIGHT - 1)).toBe('─');
    }
    for (let y = 1; y < HEIGHT - 1; y++) {
      expect(at(grid, 0, y)).toBe('│');
      expect(at(grid, WIDTH - 1, y)).toBe('│');
    }
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) expect(at(grid, x, y)).toBe(' ');
    }
  });

  it('fills the interior when fill is true', () => {
    const grid = runGenerator('border', ctx(), { fill: true });
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < WIDTH - 1; x++) expect(at(grid, x, y)).toBe('·');
    }
    expect(at(grid, 0, 0)).toBe('┌');
    expect(at(grid, WIDTH - 1, 0)).toBe('┐');
    expect(at(grid, 0, HEIGHT - 1)).toBe('└');
    expect(at(grid, WIDTH - 1, HEIGHT - 1)).toBe('┘');
  });
});

describe('unknown generator id', () => {
  it('throws a plain Error from Registry.require, not a StudioError', () => {
    expect(() => runGenerator('does-not-exist', ctx(), {})).toThrow(
      /^Unknown generator: 'does-not-exist'/,
    );

    let thrown: unknown = null;
    try {
      runGenerator('does-not-exist', ctx(), {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error;
    expect(err.name).toBe('Error');
    expect('code' in err).toBe(false);
    expect(err.message).toContain('noise');
  });
});
