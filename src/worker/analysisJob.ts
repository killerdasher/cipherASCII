/**
 * The recommendation analysis job (command palette / import): downscale-sample
 * the source image, then score every dither x ladder combination
 * (`analyzeLumaChunked`).
 *
 * Memoised per (dataUrl, columns) (P2 in docs/V2_AUDIT.md section 5):
 * re-running the recommendation on the same image and width is a cache hit -
 * no bitmap decode, no downscale, no scoring. Results are handed to
 * `postMessage`, which structured-clones them to the main thread, so the
 * shared value never leaks back into the cache.
 */

import { analyzeLumaChunked, type AnalyzeResult } from '../core/analyze';
import { analysisSampleSize } from '../core/analysis/sampleSize';
import { lumaPlane } from '../core/image/raster';
import { dataUrlToBitmap } from './raster-decode';
import { createKeyCache } from './decodeCache';

/** Small results, occasionally interleaved across images: two entries. */
const analysisCache = createKeyCache<AnalyzeResult>(2);

export interface AnalysisSample {
  luma: Float32Array;
  width: number;
  height: number;
}

export type AnalysisSampler = (dataUrl: string, columns: number) => Promise<AnalysisSample>;

/**
 * Downscale a data URL to the analysis sample box and return its Rec.709
 * luminance plane. Mirrors `sampleImageLuminance` on the main thread - same
 * `analysisSampleSize` geometry, same `drawImage` downscale - so both paths
 * measure the same plane.
 */
export async function sampleAnalysisLuma(
  dataUrl: string,
  columns: number,
): Promise<AnalysisSample> {
  const bitmap = await dataUrlToBitmap(dataUrl);
  try {
    const { width, height } = analysisSampleSize(bitmap.width, bitmap.height, columns);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D unavailable for image analysis.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const raster = { width, height, data: image.data };
    return { luma: lumaPlane(raster, 'rec709'), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Sample + score the image for the recommendation engine.
 *
 * `sample` is injectable so tests can prove memoisation without a DOM canvas;
 * the worker uses {@link sampleAnalysisLuma}.
 */
export async function runAnalysisJob(
  dataUrl: string,
  columns: number,
  sample: AnalysisSampler = sampleAnalysisLuma,
): Promise<AnalyzeResult> {
  const key = `${columns}:${dataUrl}`;
  return analysisCache.getOrPut(key, async () => {
    const { luma, width, height } = await sample(dataUrl, columns);
    return analyzeLumaChunked(luma, width, height, {}, () =>
      new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
  });
}

/** Drop memoised analysis results (tests). */
export function clearAnalysisCache(): void {
  analysisCache.clear();
}
