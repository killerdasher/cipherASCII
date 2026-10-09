/**
 * Data URL → Raster decoder for the worker.
 * Uses OffscreenCanvas / createImageBitmap for zero-dependency decoding.
 *
 * Decoded rasters are cached by data URL (P1 in docs/V2_AUDIT.md §5): a photo
 * is base64-decoded + bitmap-decoded + copied **once per worker** instead of
 * once per render, and callers still receive their own copy to mutate.
 */

import { createRaster } from '../core/image/raster';
import type { Raster } from '../core/types';
import { createKeyCache } from './decodeCache';

/** One resident raster per worker: the current image, nothing else. */
const rasterCache = createKeyCache<Raster>(1);

function parseDataUrl(dataUrl: string): { mime: string; data: Uint8Array } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, data: bytes };
}

/** Decode a data URL to an `ImageBitmap`; callers must `close()` it. */
export async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Invalid data URL');
  const blob = new Blob([new Uint8Array(parsed.data.buffer as ArrayBuffer)], { type: parsed.mime });
  return createImageBitmap(blob);
}

async function bitmapToRaster(bitmap: ImageBitmap): Promise<Raster> {
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const raster = createRaster(width, height);
  const src = imageData.data;
  const dst = raster.data;
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
  return raster;
}

async function decodeRaster(dataUrl: string): Promise<Raster> {
  const bitmap = await dataUrlToBitmap(dataUrl);
  try {
    return await bitmapToRaster(bitmap);
  } finally {
    bitmap.close();
  }
}

/**
 * Decode a data URL to a `Raster`, memoised on the URL.
 *
 * The cache keeps the pristine decode; every caller gets a fresh copy, so the
 * effect pipeline (which mutates its input frame downstream) can never poison
 * the cache. A copy is one RGBA `slice()` — orders of magnitude cheaper than
 * the `atob` + bitmap decode it replaces on repeat renders.
 */
export async function dataUrlToRaster(dataUrl: string): Promise<Raster> {
  const pristine = await rasterCache.getOrPut(dataUrl, () => decodeRaster(dataUrl));
  return {
    width: pristine.width,
    height: pristine.height,
    data: pristine.data.slice(),
  };
}

/** Drop the resident decode (tests, image swaps that must not keep pixels). */
export function clearRasterDecodeCache(): void {
  rasterCache.clear();
}
