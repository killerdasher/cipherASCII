import { describe, it, expect } from 'vitest';
import {
  buildRegionMap,
  regionAt,
  DEFAULT_REGION_SIZE,
  type RegionFields,
} from '../../src/core/analysis/regions';
import { fieldFromData, type AnalysisField } from '../../src/core/analysis/field';

const PI = Math.PI;

function field(
  name: string,
  width: number,
  height: number,
  fn: (x: number, y: number) => number,
  sourceKey = `test:${name}`,
): AnalysisField {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y);
  }
  return fieldFromData(name, width, height, data, sourceKey);
}

function mean(field: AnalysisField, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) sum += field.data[y * field.width + x];
  }
  return sum / ((x1 - x0) * (y1 - y0));
}

describe('buildRegionMap', () => {
  it('covers the image with one block per region', () => {
    const luma = field('luma', 48, 32, () => 0.5);
    const map = buildRegionMap({ luma }, 16);
    expect(map.cols).toBe(3);
    expect(map.rows).toBe(2);
    expect(map.stats).toHaveLength(6);
    expect(map.width).toBe(48);
    expect(map.height).toBe(32);
    let covered = 0;
    for (const stat of map.stats) {
      expect(stat.width).toBeGreaterThan(0);
      expect(stat.height).toBeGreaterThan(0);
      covered += stat.width * stat.height;
    }
    expect(covered).toBe(48 * 32);
  });

  it('keeps partial blocks at the right edge', () => {
    const luma = field('luma', 40, 40, (x) => x / 39);
    const map = buildRegionMap({ luma }, 16);
    expect(map.cols).toBe(3);
    expect(map.rows).toBe(3);
    expect(map.stats[2].width).toBe(8); // 40 - 32
    expect(map.stats[2 * map.cols].height).toBe(8);
    expect(map.stats[8].x).toBe(32);
    expect(map.stats[8].y).toBe(32);
  });

  it('averages every supplied channel and reads 0 for missing ones', () => {
    const luma = field('luma', 16, 16, (x) => x / 15);
    const contrast = field('contrast', 16, 16, () => 0.5);
    const map = buildRegionMap({ luma, contrast }, 8);
    expect(map.stats[0].luma).toBeCloseTo(mean(luma, 0, 0, 8, 8), 5);
    expect(map.stats[1].luma).toBeCloseTo(mean(luma, 8, 0, 16, 8), 5);
    expect(map.stats[0].contrast).toBeCloseTo(0.5, 6);
    expect(map.stats[0].edge).toBe(0);
    expect(map.stats[0].texture).toBe(0);
    expect(map.stats[0].frequency).toBe(0);
    expect(map.stats[0].structure).toBe(0);
    expect(map.stats[0].saliency).toBe(0);
  });

  it('combines vertical stripes to an orientation of 0 and horizontal to pi/2', () => {
    const lumaV = field('luma', 32, 32, (x) => (x % 4 < 2 ? 0 : 1));
    const coherence = field('coherence', 32, 32, () => 1);
    const orientationV = field('orientation', 32, 32, () => 0);
    const mapV = buildRegionMap({ luma: lumaV, coherence, orientation: orientationV }, 16);
    for (const stat of mapV.stats) expect(stat.orientation).toBeCloseTo(0, 6);

    const lumaH = field('luma', 32, 32, (_x, y) => (y % 4 < 2 ? 0 : 1));
    const orientationH = field('orientation', 32, 32, () => PI / 2);
    const mapH = buildRegionMap({ luma: lumaH, coherence, orientation: orientationH }, 16);
    for (const stat of mapH.stats) expect(stat.orientation).toBeCloseTo(PI / 2, 6);
  });

  it('averages angles circularly instead of arithmetically', () => {
    // Directions just either side of the wrap (pi - 0.1 and 0.1) are both
    // near-horizontal; an arithmetic mean would call the block vertical
    // (pi/2). The doubled-angle mean resolves onto the horizontal line, so
    // cos(2 * orientation) reads 1 (0 and pi are the same line).
    const luma = field('luma', 16, 16, () => 0.5);
    const coherence = field('coherence', 16, 16, () => 1);
    const orientation = field('orientation', 16, 16, (x) => (x < 8 ? PI - 0.1 : 0.1));
    const map = buildRegionMap({ luma, coherence, orientation }, 16);
    const angle = map.stats[0].orientation;
    expect(Math.cos(2 * angle)).toBeCloseTo(1, 3);
    expect(Math.sin(2 * angle)).toBeCloseTo(0, 3);
    expect(angle).not.toBeCloseTo(PI / 2, 3); // what a plain mean would report
  });

  it('fits tone percentiles with the auto-levels fitter', () => {
    // Left half black, right half white inside one block.
    const luma = field('luma', 16, 16, (x) => (x < 8 ? 0 : 1));
    const map = buildRegionMap({ luma }, 16);
    expect(map.stats[0].toneLow).toBeCloseTo(0, 6);
    expect(map.stats[0].toneHigh).toBeCloseTo(1, 6);

    const flat = field('luma', 16, 16, () => 0.4);
    const flatMap = buildRegionMap({ luma: flat }, 16);
    expect(flatMap.stats[0].toneLow).toBeCloseTo(0.4, 6);
    expect(flatMap.stats[0].toneHigh).toBeCloseTo(0.4, 6);
    expect(flatMap.stats[0].toneStretch).toBe(1);
  });

  it('rejects invalid region sizes and mismatched channels', () => {
    const luma = field('luma', 16, 16, () => 0.5);
    for (const size of [0, -1, 2.5]) {
      expect(() => buildRegionMap({ luma }, size)).toThrow(RangeError);
    }
    const mismatched: RegionFields = { luma, contrast: field('contrast', 8, 8, () => 0.5) };
    expect(() => buildRegionMap(mismatched, 8)).toThrow(RangeError);
    expect(() =>
      buildRegionMap({ luma, orientation: field('orientation', 8, 8, () => 0) }, 8),
    ).toThrow(RangeError);
  });

  it('defaults to the documented block size', () => {
    expect(DEFAULT_REGION_SIZE).toBe(32);
    const map = buildRegionMap({ luma: field('luma', 64, 64, () => 0.5) });
    expect(map.regionWidth).toBe(32);
    expect(map.regionHeight).toBe(32);
    expect(map.stats).toHaveLength(4);
  });
});

describe('regionAt', () => {
  const luma = field('luma', 48, 32, (x, y) => (y * 48 + x) / (48 * 32));
  const map = buildRegionMap({ luma }, 16);

  it('resolves the block a pixel falls into', () => {
    expect(regionAt(map, 0, 0)).toBe(map.stats[0]);
    expect(regionAt(map, 17, 0)).toBe(map.stats[1]);
    expect(regionAt(map, 0, 17)).toBe(map.stats[3]);
    expect(regionAt(map, 47, 31)).toBe(map.stats[5]);
  });

  it('clamps coordinates outside the image', () => {
    expect(regionAt(map, -10, -10)).toBe(map.stats[0]);
    expect(regionAt(map, 999, 999)).toBe(map.stats[5]);
  });
});
