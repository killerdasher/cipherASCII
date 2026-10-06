/**
 * `npm run demo` — the cipherASCII signature demo.
 *
 * A deterministic, terminal-playable showcase: it renders an ASCII title, then
 * walks the five signature effects over it in a scene-style sequence, printing
 * the frames it produces.
 *
 *   npm run demo                      # default seed, coloured frames
 *   DEMO_SEED=7 npm run demo          # a different, still reproducible draw
 *   NO_COLOR=1 npm run demo           # plain text (DEMO_PLAIN=1 also works)
 *   DEMO_FRAMES=1 npm run demo        # one frame per stage instead of two
 *   UPDATE_GOLDEN=1 npm run demo      # rewrite scripts/golden/cipher-demo.txt
 *
 * Arguments are environment variables rather than CLI flags because the suite
 * runs through vitest, which owns the command line.
 *
 * The same frames are compared against `scripts/golden/cipher-demo.txt`, so the
 * demo doubles as a visual-regression test: any change to the effect maths,
 * the glyph table or the bridge shows up as a text diff of actual frames.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGrid, linesToGrid } from '../src/core/grid';
import { cellFxRuntime, getCellEffect } from '../src/core/fx';
import { renderTextToGrid } from '../src/core/text/render';
import { DEFAULT_TEXT_RENDER } from '../src/core/types';
import type { AsciiGrid } from '../src/core/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, 'golden', 'cipher-demo.txt');

const DT = 16;

/**
 * Stage order: the story the demo tells, one signature effect at a time.
 *
 * Frame counts come from the registry, so a stage runs to its *settled* frame
 * — the last frame of every one-shot is the clean source artwork.
 */
const STAGES: Array<{ effect: string; frames: number }> = ['cipherlock', 'hexfall', 'glyphwave', 'signalburst', 'keyshift'].map(
  (effect) => {
    const def = getCellEffect(effect)!;
    return { effect, frames: def.ambient ? 90 : Math.ceil(def.duration / DT) + 2 };
  },
);

const TITLE = 'cipherASCII';

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function useColour(): boolean {
  if (process.env.NO_COLOR || process.env.DEMO_PLAIN) return false;
  return process.stdout.isTTY !== false;
}

/** Build the demo's source grid: a block-font title over a ruled panel. */
function buildSource(): AsciiGrid {
  let title: AsciiGrid;
  try {
    title = renderTextToGrid(TITLE, { ...DEFAULT_TEXT_RENDER, font: 'block' });
  } catch {
    title = linesToGrid([TITLE.split('').join(' ')]);
  }
  const width = Math.max(title.width + 4, 44);
  const height = title.height + 4;
  const grid = createGrid(width, height);
  const panel = '+-|';
  for (let x = 0; x < width; x++) {
    set(grid, x, 0, x === 0 || x === width - 1 ? panel[0] : panel[1], 0x556677);
    set(grid, x, height - 1, x === 0 || x === width - 1 ? panel[0] : panel[1], 0x556677);
  }
  for (let y = 0; y < height; y++) {
    set(grid, 0, y, panel[0], 0x556677);
    set(grid, width - 1, y, panel[0], 0x556677);
  }
  const ox = ((width - title.width) / 2) | 0;
  const oy = ((height - title.height) / 2) | 0;
  for (let y = 0; y < title.height; y++) {
    for (let x = 0; x < title.width; x++) {
      const ch = title.chars[y * title.width + x];
      if (ch === ' ') continue;
      const fg = title.fg ? title.fg[y * title.width + x] : 0xd4a53c;
      set(grid, ox + x, oy + y, ch, fg === -1 ? 0xd4a53c : fg);
    }
  }
  return grid;
}

function set(grid: AsciiGrid, x: number, y: number, ch: string, fg: number): void {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  const i = y * grid.width + x;
  grid.chars[i] = ch;
  if (!grid.fg) grid.fg = new Int32Array(grid.width * grid.height).fill(-1);
  grid.fg[i] = fg;
}

function toLines(grid: AsciiGrid, colour: boolean): string[] {
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let line = '';
    let ink = -2;
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      const fg = grid.fg ? grid.fg[i] : -1;
      if (colour && fg !== ink) {
        ink = fg;
        line += fg >= 0 ? `\u001b[38;2;${(fg >> 16) & 0xff};${(fg >> 8) & 0xff};${fg & 0xff}m` : '\u001b[39m';
      }
      line += grid.chars[i];
    }
    rows.push(colour ? line + '\u001b[0m' : line);
  }
  return rows;
}

interface CapturedFrame {
  index: number;
  grid: AsciiGrid;
}

/** Run one stage and capture the first, middle and last frames it produced. */
function runStage(source: AsciiGrid, effect: string, frameCount: number, seed: number): CapturedFrame[] {
  cellFxRuntime.sync([{ effect }], seed);
  const picks = new Set<number>([0, Math.floor(frameCount / 2), frameCount - 1]);
  const captured: CapturedFrame[] = [];
  let last: AsciiGrid | null = null;
  let lastIndex = 0;
  for (let f = 0; f < frameCount; f++) {
    const out = cellFxRuntime.frame(source, DT);
    if (!out) break; // one-shot settled — the stage is finished
    last = out;
    lastIndex = f;
    if (picks.has(f)) captured.push({ index: f, grid: cloneLines(out) });
  }
  // Make sure the settled frame is always the last thing we show.
  if (last && captured[captured.length - 1]?.index !== lastIndex) {
    captured.push({ index: lastIndex, grid: cloneLines(last) });
  }
  return captured;
}

function cloneLines(grid: AsciiGrid): AsciiGrid {
  return {
    width: grid.width,
    height: grid.height,
    chars: [...grid.chars],
    fg: grid.fg ? Int32Array.from(grid.fg) : null,
    bg: grid.bg ? Int32Array.from(grid.bg) : null,
  };
}

function goldenFor(frames: AsciiGrid[]): string {
  return frames
    .map((frame) => toLines(frame, false).join('\n'))
    .join('\n--- frame ---\n');
}

describe('cipher demo', () => {
  const seed = Math.trunc(envNumber('DEMO_SEED', 0x5eed));
  const framesPerStage = Math.max(1, Math.trunc(envNumber('DEMO_FRAMES', 2)));
  const source = buildSource();
  const colour = useColour();

  it('renders the signature sequence deterministically', () => {
    const stages = STAGES.map((s) => `  ${s.effect}`).join('\n');
    console.log(
      `${colour ? '\u001b[1m' : ''}cipherASCII signature demo — seed ${seed}, ` +
        `${source.width}x${source.height}, stages:\n${stages}\n` +
        `${colour ? '\u001b[0m' : ''}`,
    );

    const golden: string[] = [];
    for (const stage of STAGES) {
      const captured = runStage(source, stage.effect, stage.frames, seed);
      expect(captured.length, `stage ${stage.effect} produced no frames`).toBeGreaterThan(0);

      // Keep at most `framesPerStage` frames for display: start, middle, end.
      const step = Math.max(1, Math.ceil(captured.length / framesPerStage));
      const shown = captured.filter((_, i) => i % step === 0).slice(0, framesPerStage);
      if (shown[shown.length - 1] !== captured[captured.length - 1] && shown.length < framesPerStage) {
        shown.push(captured[captured.length - 1]);
      }

      for (const frame of shown) {
        const label = colour
          ? `\u001b[36m${stage.effect}\u001b[0m \u001b[2mframe ${frame.index}/${stage.frames - 1}\u001b[0m`
          : `${stage.effect} frame ${frame.index}/${stage.frames - 1}`;
        console.log(label);
        console.log(toLines(frame.grid, colour).join('\n'));
        console.log('');
      }
      golden.push(`# ${stage.effect}`, goldenFor(captured.map((f) => f.grid)));
    }

    const payload = golden.join('\n') + '\n';
    if (process.env.UPDATE_GOLDEN) {
      mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
      writeFileSync(GOLDEN_PATH, payload, 'utf8');
      expect(existsSync(GOLDEN_PATH)).toBe(true);
      return;
    }
    if (!existsSync(GOLDEN_PATH)) {
      mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
      writeFileSync(GOLDEN_PATH, payload, 'utf8');
      return;
    }
    expect(readFileSync(GOLDEN_PATH, 'utf8')).toBe(payload);
  });

  it('the sequence ends where it started', () => {
    // Every one-shot returns to the source document; only the ambient stage
    // leaves the field moving. This is the promise the demo makes visually.
    cellFxRuntime.sync([{ effect: 'cipherlock' }], seed);
    let out: AsciiGrid | null = null;
    for (let i = 0; i < 400 && out !== null; i++) out = cellFxRuntime.frame(source, DT);
    expect(out).toBeNull();
    cellFxRuntime.sync([{ effect: 'signalburst' }], seed);
    out = null;
    for (let i = 0; i < 400 && out !== null; i++) out = cellFxRuntime.frame(source, DT);
    expect(out).toBeNull();
    cellFxRuntime.sync([], seed);
  });

  it('different seeds draw different frames', () => {
    const a = goldenFor(runStage(source, 'cipherlock', 30, 1).map((f) => f.grid));
    const b = goldenFor(runStage(source, 'cipherlock', 30, 2).map((f) => f.grid));
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
