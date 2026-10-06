/**
 * Data URL → Raster decoder for the worker.
 * Uses OffscreenCanvas / createImageBitmap for zero-dependency decoding.
 */

import { createRaster } from '../core/image/raster';
import type { Raster } from '../core/types';

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

async function decodeImageBitmap(blob: Blob): Promise<ImageBitmap> {
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

export async function dataUrlToRaster(dataUrl: string): Promise<Raster> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Invalid data URL');
  const blob = new Blob([new Uint8Array(parsed.data.buffer as ArrayBuffer)], { type: parsed.mime });
  const bitmap = await decodeImageBitmap(blob);
  return bitmapToRaster(bitmap);
}