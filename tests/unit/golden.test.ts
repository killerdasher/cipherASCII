// Visual regression + determinism for the content pipeline.
//
// Three artefacts are pinned to committed fixtures in `tests/golden/`:
// a text banner, an image render whose blue-noise dither is (by design)
// hash-noise rather than `Math.random`, and one frame of each signature cell
// effect at a fixed seed.
//
// Regenerate after an intentional change:  UPDATE_GOLDEN=1 npx vitest run tests/unit/golden.test.ts
// A missing fixture is written and then fails the run, so fixtures cannot be
// silently skipped in CI.
//
// The determinism half of this file needs no fixtures: it runs the same input
// twice and requires byte-identical output, which is the property that makes
// the fixtures trustworthy in the first place.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Plane } from '../../src/core/canvas/plane';
import { CELL_EFFECT_MAP, CellEffectPipeline } from '../../src/core/fx';
import { gridToLines, gridToString } from '../../src/core/grid';
import { createRaster, setPixel } from '../../src/core/image/raster';
import { renderImageToGrid } from '../../src/core/renderImage';
import { renderTextToGrid } from '../../src/core/text/render';
import {
  DEFAULT_IMAGE_RENDER,
  DEFAULT_TEXT_RENDER,
  type AsciiGrid,
  type ImageRenderSettings,
  type TextRenderSettings,
} from '../../src/core/types';

const GOLDEN_DIR = path.join(__dirname, '..', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const SIGNATURE_EFFECTS = ['cipherlock', 'hexfall', 'glyphwave', 'signalburst', 'keyshift'] as const;

function golden(name: string, actual: string): void {
  const file = path.join(GOLDEN_DIR, name);
  if (UPDATE) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual);
    return;
  }
  if (!fs.existsSync(file)) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, actual);
    throw new Error(
      `Golden fixture missing: tests/golden/${name}. It has been written for review - commit it, then re-run.`,
    );
  }
  expect(fs.readFileSync(file, 'utf8'), `golden ${name} (UPDATE_GOLDEN=1 to rewrite)`).toBe(actual);
}

function gradient(width: number, height: number) {
  const raster = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(((x + y) / (width + height - 2)) * 255);
      const b = Math.round((y / Math.max(1, height - 1)) * 255);
      setPixel(raster, x, y, (v << 16) | (v << 8) | b);
    }
  }
  return raster;
}

function textGrid(): AsciiGrid {
  const settings: TextRenderSettings = {
    ...DEFAULT_TEXT_RENDER,
    font: 'block',
    align: 'center',
    letterSpacing: 1,
    lineSpacing: 1,
  };
  return renderTextToGrid('CIPHER\nASCII', settings);
}

function imageGrid(): AsciiGrid {
  const settings: ImageRenderSettings = {
    ...structuredClone(DEFAULT_IMAGE_RENDER),
    columns: 32,
    dither: { ...DEFAULT_IMAGE_RENDER.dither, algorithm: 'blueNoise', strength: 1 },
  };
  return renderImageToGrid(gradient(96, 48), settings).grid;
}

function signaturePlane(effect: string, frames = 24): Plane {
  const plane = new Plane(24, 12);
  const glyphs = ['#', '*', '+', '=', '.', ':'];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 24; x++) {
      plane.setGlyph(x, y, glyphs[(x + y) % glyphs.length], 0x88ccff, 0x101020, 255);
    }
  }
  const pipeline = new CellEffectPipeline({ seed: 42, entries: [{ effect }] });
  pipeline.bind(CELL_EFFECT_MAP, plane);
  pipeline.setSource(plane);
  for (let i = 0; i < frames; i++) pipeline.apply(plane, 16);
  return plane;
}

function planeToText(plane: Plane): string {
  const rows: string[] = [];
  for (let y = 0; y < plane.height; y++) {
    let glyphs = '';
    let colors = '';
    for (let x = 0; x < plane.width; x++) {
      glyphs += plane.charAt(x, y);
      colors += (plane.fg[y * plane.width + x] >>> 0).toString(16).padStart(6, '0') + ' ';
    }
    rows.push(glyphs, colors.trimEnd());
  }
  return rows.join('\n');
}

describe('golden fixtures', () => {
  it('text banner matches its fixture', () => {
    golden('text-banner.txt', gridToLines(textGrid()).join('\n') + '\n');
  });

  it('image render matches its fixture', () => {
    golden('image-gradient.txt', gridToLines(imageGrid()).join('\n') + '\n');
  });

  it('every signature effect matches its fixture frame', () => {
    for (const effect of SIGNATURE_EFFECTS) {
      golden(`fx-${effect}.txt`, planeToText(signaturePlane(effect)) + '\n');
    }
  });
});

describe('determinism', () => {
  it('renders the same text twice, byte for byte', () => {
    expect(gridToString(textGrid())).toBe(gridToString(textGrid()));
  });

  it('renders the same image twice, byte for byte', () => {
    expect(gridToString(imageGrid())).toBe(gridToString(imageGrid()));
  });

  it('applies a cell effect identically for the same seed', () => {
    expect(planeToText(signaturePlane('hexfall'))).toBe(planeToText(signaturePlane('hexfall')));
  });

  it('diverges for a different cell-effect seed', () => {
    const a = planeToText(signaturePlane('cipherlock'));
    const plane = new Plane(24, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 24; x++) plane.setGlyph(x, y, '#', 0x88ccff, 0x101020, 255);
    }
    const pipeline = new CellEffectPipeline({ seed: 43, entries: [{ effect: 'cipherlock' }] });
    pipeline.bind(CELL_EFFECT_MAP, plane);
    pipeline.setSource(plane);
    for (let i = 0; i < 24; i++) pipeline.apply(plane, 16);
    expect(planeToText(plane)).not.toBe(a);
  });
});
