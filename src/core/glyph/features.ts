/**
 * Glyph feature extraction - what each character actually looks like.
 *
 * A charset knows its characters by position in a ladder; a glyph index knows
 * them by measured coverage. Everything here is computed from a rasterised
 * alpha mask (or an RGBA bitmap), so no measurement is guessed: `ink` is the
 * mean coverage, `density` is the fill of the glyph's own bounding box,
 * `edgeRatio` is the share of inked pixels that touch empty space (1 =
 * hairline, ~0 = solid block) and `symmetryX` is left/right mirror agreement.
 *
 * Pure module: no DOM - callers rasterise however they like (canvas in the
 * app, synthetic masks in tests) and hand the samples over.
 */

export interface GlyphFeatureVector {
  /** The measured character. */
  glyph: string;
  /** Mean coverage over the whole cell, 0..1. */
  ink: number;
  /** Bounding-box width / height in bitmap pixels; 0 when there is no ink. */
  aspect: number;
  /** Bounding box of inked pixels, normalised to 0..1 of the cell. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Mean coverage inside the bounding box, 0..1 (0 when there is no ink). */
  density: number;
  /** Coverage-weighted centre of mass, 0..1 of the cell. */
  centroidX: number;
  centroidY: number;
  /** Share of inked pixels touching a non-inked neighbour, 0..1. */
  edgeRatio: number;
  /** Left/right mirror agreement over the cell, 1 = perfectly symmetric. */
  symmetryX: number;
}

const EMPTY_BBOX = { x: 0, y: 0, w: 0, h: 0 };

function toCoverage(samples: ArrayLike<number>): Float32Array {
  const out = new Float32Array(samples.length);
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (Number.isFinite(v) && v > max) max = v;
  }
  const scale = max > 1 ? 1 / 255 : 1;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * scale;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

function featuresOf(coverage: Float32Array, glyph: string, width: number, height: number): GlyphFeatureVector {
  const n = width * height;
  let inkSum = 0;
  for (let i = 0; i < n; i++) inkSum += coverage[i];
  const ink = inkSum / n;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inked = 0;
  let border = 0;
  let weightSum = 0;
  let cx = 0;
  let cy = 0;
  let mirror = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const v = coverage[i];
      mirror += Math.abs(v - coverage[row + (width - 1 - x)]);
      if (v >= 0.5) {
        inked++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        // Only in-bounds neighbours count: the cell edge is not empty space,
        // so a glyph that fills the whole cell has no internal edges.
        const emptyLeft = x > 0 && coverage[i - 1] < 0.5;
        const emptyRight = x + 1 < width && coverage[i + 1] < 0.5;
        const emptyUp = y > 0 && coverage[i - width] < 0.5;
        const emptyDown = y + 1 < height && coverage[i + width] < 0.5;
        if (emptyLeft || emptyRight || emptyUp || emptyDown) border++;
      }
      weightSum += v;
      cx += v * (x + 0.5);
      cy += v * (y + 0.5);
    }
  }

  const symmetryX = n === 0 ? 1 : 1 - mirror / n;
  const centroidX = weightSum > 0 ? cx / weightSum / width : 0.5;
  const centroidY = weightSum > 0 ? cy / weightSum / height : 0.5;

  if (maxX < 0) {
    return {
      glyph,
      ink,
      aspect: 0,
      bbox: EMPTY_BBOX,
      density: 0,
      centroidX,
      centroidY,
      edgeRatio: 0,
      symmetryX,
    };
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  let boxArea = 0;
  for (let y = minY; y <= maxY; y++) {
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      boxArea += coverage[row + x];
    }
  }

  return {
    glyph,
    ink,
    aspect: boxW / boxH,
    bbox: { x: minX / width, y: minY / height, w: boxW / width, h: boxH / height },
    density: boxArea / (boxW * boxH),
    centroidX,
    centroidY,
    edgeRatio: border / inked,
    symmetryX,
  };
}

/**
 * Measure a glyph from a single-channel alpha mask.
 *
 * Samples may be unit floats (0..1) or bytes (0..255): anything above 1
 * switches the whole mask to byte interpretation. Non-finite samples count as
 * zero. Coordinates are bitmap pixels, row-major, `width * height` samples.
 *
 * @param glyph - the character these samples came from
 * @param alpha - coverage samples
 * @param width - bitmap columns (> 0)
 * @param height - bitmap rows (> 0)
 * @returns the measured feature vector
 * @throws RangeError on non-positive dimensions or a sample count mismatch
 */
export function glyphFeaturesFromAlpha(
  glyph: string,
  alpha: ArrayLike<number>,
  width: number,
  height: number,
): GlyphFeatureVector {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`glyph bitmap width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`glyph bitmap height must be a positive integer, got ${height}`);
  }
  if (alpha.length !== width * height) {
    throw new RangeError(`glyph alpha has ${alpha.length} samples but ${width}x${height} needs ${width * height}`);
  }
  return featuresOf(toCoverage(alpha), glyph, width, height);
}

/**
 * Measure a glyph from an RGBA bitmap (`width * height * 4`, alpha channel
 * used) or, as a convenience, from a single-channel mask of `width * height`
 * samples. Byte and unit samples are both accepted.
 *
 * @param glyph - the character these samples came from
 * @param bitmap - RGBA or single-channel samples
 * @param width - bitmap columns (> 0)
 * @param height - bitmap rows (> 0)
 * @returns the measured feature vector
 * @throws RangeError on non-positive dimensions or an unexpected sample count
 */
export function glyphFeaturesFromBitmap(
  glyph: string,
  bitmap: ArrayLike<number>,
  width: number,
  height: number,
): GlyphFeatureVector {
  const cells = width * height;
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`glyph bitmap width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`glyph bitmap height must be a positive integer, got ${height}`);
  }
  if (bitmap.length === cells) return glyphFeaturesFromAlpha(glyph, bitmap, width, height);
  if (bitmap.length !== cells * 4) {
    throw new RangeError(
      `glyph bitmap has ${bitmap.length} samples; expected ${cells} (single channel) or ${cells * 4} (RGBA)`,
    );
  }
  const alpha = new Float32Array(cells);
  for (let i = 0; i < cells; i++) alpha[i] = bitmap[i * 4 + 3];
  return glyphFeaturesFromAlpha(glyph, alpha, width, height);
}
