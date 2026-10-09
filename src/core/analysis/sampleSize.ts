/**
 * Shared analysis sampling geometry.
 *
 * Pure module: the downscale box both the main thread (`sampleImageLuminance`)
 * and the render worker use, so the two analysis paths measure identical
 * planes. No DOM, no raster maths — only the target size.
 */

export const ANALYSIS_MIN_SIZE = 8;
export const ANALYSIS_MAX_SIZE = 240;
export const ANALYSIS_DEFAULT_COLUMNS = 100;

export interface AnalysisSampleSize {
  width: number;
  height: number;
}

/**
 * Downscale box for an analysis sample.
 *
 * Width follows the requested column count (clamped to `[8, 240]` and to the
 * source); height keeps a 2× cell aspect (`w × h_source × 0.5 / w_source`) so
 * the plane matches what an 8×16-cell render would see, clamped the same way.
 *
 * @param bitmapWidth - source width in pixels, must be > 0
 * @param bitmapHeight - source height in pixels, must be > 0
 * @param columns - requested analysis columns
 * @returns integer sample dimensions, at least 8×8
 */
export function analysisSampleSize(
  bitmapWidth: number,
  bitmapHeight: number,
  columns = ANALYSIS_DEFAULT_COLUMNS,
): AnalysisSampleSize {
  const w = Math.max(
    ANALYSIS_MIN_SIZE,
    Math.min(ANALYSIS_MAX_SIZE, Math.min(columns, bitmapWidth)),
  );
  const h = Math.max(
    ANALYSIS_MIN_SIZE,
    Math.min(ANALYSIS_MAX_SIZE, Math.round((w * bitmapHeight * 0.5) / bitmapWidth)),
  );
  return { width: w, height: h };
}
