/**
 * Procedural ASCII generators.
 *
 * Every generator is a pure function from options to `AsciiGrid`, registered
 * in `generatorRegistry` so the UI (and future plugins) can enumerate them.
 * Generators draw from a deterministic PRNG when a seed is supplied, which
 * makes them reproducible for tests and golden files.
 */

import { Registry } from '../registry';
import { linesToGrid } from '../grid';
import { Rng, clamp, isPrintableChar } from '../util';
import type { AsciiGrid } from '../types';

export interface GeneratorContext {
  width: number;
  height: number;
  /** Deterministic seed (string or number). */
  seed: string | number;
  charset: string;
}

export interface GeneratorOption {
  id: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  default: number | boolean | string;
  choices?: Array<{ value: string; label: string }>;
}

export interface ProceduralGenerator {
  id: string;
  label: string;
  category: 'noise' | 'gradient' | 'pattern' | 'wave' | 'border' | 'text';
  description: string;
  options: GeneratorOption[];
  generate(ctx: GeneratorContext, options: Record<string, unknown>): AsciiGrid;
}

function charsetOf(ctx: GeneratorContext): string[] {
  const chars = [...ctx.charset];
  return chars.length > 0 ? chars : [...' .:-=+*#%@'];
}

/** Value noise with smooth interpolation; deterministic per seed. */
function makeNoise(rng: Rng, size = 64): Float32Array {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  return grid;
}

function sampleNoise(grid: Float32Array, size: number, x: number, y: number): number {
  const x0 = Math.floor(x) % size;
  const y0 = Math.floor(y) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = grid[y0 * size + x0];
  const v10 = grid[y0 * size + x1];
  const v01 = grid[y1 * size + x0];
  const v11 = grid[y1 * size + x1];
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

function valueFromRamp(value: number, ramp: string[]): string {
  const idx = clamp(Math.round(value * (ramp.length - 1)), 0, ramp.length - 1);
  return ramp[idx];
}

const noise: ProceduralGenerator = {
  id: 'noise',
  label: 'Noise',
  category: 'noise',
  description: 'Fractal value noise (fBm) with configurable octaves and persistence.',
  options: [
    { id: 'scale', label: 'Scale', type: 'number', min: 1, max: 64, step: 1, default: 12 },
    { id: 'octaves', label: 'Octaves', type: 'number', min: 1, max: 6, step: 1, default: 4 },
    { id: 'persistence', label: 'Persistence', type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.5 },
  ],
  generate(ctx, options) {
    const rng = new Rng(ctx.seed);
    const grid = makeNoise(rng, 64);
    const scale = clamp(Number(options.scale ?? 12), 1, 64);
    const octaves = clamp(Math.round(Number(options.octaves ?? 4)), 1, 6);
    const persistence = clamp(Number(options.persistence ?? 0.5), 0.1, 0.9);
    const ramp = charsetOf(ctx);
    const lines: string[] = [];
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        let amplitude = 1;
        let frequency = 1;
        let sum = 0;
        let norm = 0;
        for (let o = 0; o < octaves; o++) {
          const nx = (x / ctx.width) * scale * frequency;
          const ny = (y / ctx.height) * scale * frequency * 0.5;
          sum += sampleNoise(grid, 64, nx, ny) * amplitude;
          norm += amplitude;
          amplitude *= persistence;
          frequency *= 2;
        }
        line += valueFromRamp(norm > 0 ? sum / norm : 0, ramp);
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

const gradient: ProceduralGenerator = {
  id: 'gradient',
  label: 'Gradient',
  category: 'gradient',
  description: 'Linear, radial or angular gradient across the character ramp.',
  options: [
    {
      id: 'direction',
      label: 'Direction',
      type: 'select',
      default: 'horizontal',
      choices: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'radial', label: 'Radial' },
        { value: 'angular', label: 'Angular' },
      ],
    },
    { id: 'invert', label: 'Invert', type: 'boolean', default: false },
  ],
  generate(ctx, options) {
    const ramp = charsetOf(ctx);
    const direction = String(options.direction ?? 'horizontal');
    const invert = Boolean(options.invert);
    const lines: string[] = [];
    const cx = (ctx.width - 1) / 2;
    const cy = (ctx.height - 1) / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy) || 1;
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        let t: number;
        switch (direction) {
          case 'vertical':
            t = ctx.height > 1 ? y / (ctx.height - 1) : 0;
            break;
          case 'radial': {
            const dx = x - cx;
            const dy = y - cy;
            t = Math.sqrt(dx * dx + dy * dy) / maxR;
            break;
          }
          case 'angular': {
            const angle = Math.atan2(y - cy, x - cx);
            t = (angle + Math.PI) / (2 * Math.PI);
            break;
          }
          default:
            t = ctx.width > 1 ? x / (ctx.width - 1) : 0;
        }
        if (invert) t = 1 - t;
        line += valueFromRamp(clamp(t, 0, 1), ramp);
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

const checker: ProceduralGenerator = {
  id: 'checker',
  label: 'Checkerboard',
  category: 'pattern',
  description: 'Checkerboard or stripe pattern with adjustable cell size.',
  options: [
    { id: 'cellSize', label: 'Cell size', type: 'number', min: 1, max: 32, step: 1, default: 4 },
    {
      id: 'pattern',
      label: 'Pattern',
      type: 'select',
      default: 'checker',
      choices: [
        { value: 'checker', label: 'Checker' },
        { value: 'stripesH', label: 'Stripes (horizontal)' },
        { value: 'stripesV', label: 'Stripes (vertical)' },
        { value: 'diagonal', label: 'Diagonal' },
      ],
    },
  ],
  generate(ctx, options) {
    const ramp = charsetOf(ctx);
    const cell = clamp(Math.round(Number(options.cellSize ?? 4)), 1, 32);
    const pattern = String(options.pattern ?? 'checker');
    const lines: string[] = [];
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        let on: boolean;
        switch (pattern) {
          case 'stripesH':
            on = Math.floor(y / cell) % 2 === 0;
            break;
          case 'stripesV':
            on = Math.floor(x / cell) % 2 === 0;
            break;
          case 'diagonal':
            on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
            break;
          default:
            on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        }
        line += valueFromRamp(on ? 1 : 0, ramp);
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

const waves: ProceduralGenerator = {
  id: 'waves',
  label: 'Waves',
  category: 'wave',
  description: 'Interfering sine waves — a classic terminal background.',
  options: [
    { id: 'frequency', label: 'Frequency', type: 'number', min: 1, max: 40, step: 1, default: 8 },
    { id: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 },
    { id: 'layers', label: 'Layers', type: 'number', min: 1, max: 5, step: 1, default: 2 },
  ],
  generate(ctx, options) {
    const rng = new Rng(ctx.seed);
    const ramp = charsetOf(ctx);
    const freq = clamp(Number(options.frequency ?? 8), 1, 40);
    const amp = clamp(Number(options.amplitude ?? 0.5), 0, 1);
    const layers = clamp(Math.round(Number(options.layers ?? 2)), 1, 5);
    const phases: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < layers; i++) {
      phases.push(rng.next() * Math.PI * 2);
      offsets.push(rng.next() * 0.5);
    }
    const lines: string[] = [];
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        let v = 0;
        for (let i = 0; i < layers; i++) {
          const t = (x / Math.max(1, ctx.width - 1)) * Math.PI * 2 * ((freq + i) / 2);
          v += Math.sin(t + phases[i]) * amp + offsets[i];
        }
        v = v / layers;
        line += valueFromRamp(clamp(v, 0, 1), ramp);
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

const border: ProceduralGenerator = {
  id: 'border',
  label: 'Frame',
  category: 'border',
  description: 'Decorative frame or divider elements sized to the canvas.',
  options: [
    {
      id: 'style',
      label: 'Style',
      type: 'select',
      default: 'single',
      choices: [
        { value: 'single', label: 'Single line' },
        { value: 'double', label: 'Double line' },
        { value: 'heavy', label: 'Heavy' },
        { value: 'dashed', label: 'Dashed' },
      ],
    },
    { id: 'fill', label: 'Fill inside', type: 'boolean', default: false },
  ],
  generate(ctx, options) {
    const style = String(options.style ?? 'single');
    const fill = Boolean(options.fill);
    const sets: Record<string, [string, string, string, string, string, string]> = {
      single: ['─', '│', '┌', '┐', '└', '┘'],
      double: ['═', '║', '╔', '╗', '╚', '╝'],
      heavy: ['━', '┃', '┏', '┓', '┗', '┛'],
      dashed: ['┄', '┆', '┌', '┐', '└', '┘'],
    };
    const [h, v, tl, tr, bl, br] = sets[style] ?? sets.single;
    const lines: string[] = [];
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        const top = y === 0;
        const bottom = y === ctx.height - 1;
        const left = x === 0;
        const right = x === ctx.width - 1;
        if (top && left) line += tl;
        else if (top && right) line += tr;
        else if (bottom && left) line += bl;
        else if (bottom && right) line += br;
        else if (top || bottom) line += h;
        else if (left || right) line += v;
        else line += fill ? '·' : ' ';
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

const spectrum: ProceduralGenerator = {
  id: 'spectrum',
  label: 'Spectrum',
  category: 'pattern',
  description: 'Per-column pseudo-random bars, like an equalizer display.',
  options: [
    { id: 'smoothness', label: 'Smoothing', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4 },
  ],
  generate(ctx, options) {
    const rng = new Rng(ctx.seed);
    const ramp = charsetOf(ctx);
    const smooth = clamp(Number(options.smoothness ?? 0.4), 0, 1);
    const heights: number[] = [];
    let prev = 0.5;
    for (let x = 0; x < ctx.width; x++) {
      const target = rng.next();
      prev = prev * smooth + target * (1 - smooth);
      heights.push(prev);
    }
    const lines: string[] = [];
    for (let y = 0; y < ctx.height; y++) {
      let line = '';
      for (let x = 0; x < ctx.width; x++) {
        const level = heights[x];
        const filled = 1 - y / Math.max(1, ctx.height - 1) <= level;
        line += filled ? valueFromRamp(level, ramp) : ' ';
      }
      lines.push(line);
    }
    return linesToGrid(lines);
  },
};

export const generatorRegistry = new Registry<ProceduralGenerator>('generator');
generatorRegistry.registerAll([noise, gradient, checker, waves, border, spectrum]);

export function listGenerators(): ProceduralGenerator[] {
  return generatorRegistry.list();
}

export function runGenerator(
  id: string,
  ctx: GeneratorContext,
  options: Record<string, unknown> = {},
): AsciiGrid {
  const generator = generatorRegistry.require(id);
  const merged: Record<string, unknown> = {};
  for (const opt of generator.options) merged[opt.id] = opt.default;
  Object.assign(merged, options);
  const grid = generator.generate(ctx, merged);
  // Sanitize: procedural output must never emit control characters.
  for (let i = 0; i < grid.chars.length; i++) {
    const ch = grid.chars[i];
    if (!isPrintableChar(ch)) grid.chars[i] = ' ';
  }
  return grid;
}
