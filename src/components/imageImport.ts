/**
 * Image import: turns a user-supplied image file into an ImageLayer that the
 * render pipeline can map to ASCII. Pure helpers — no React, no store access
 * beyond the actions handed in by the caller.
 */

import type { ImageLayer, ImageSource, Layer, Raster } from '../core/types';
import { lumaPlane } from '../core/image/raster';
import { analyzeLumaChunked, type RenderAnalysis } from '../core/analyze';
import { analysisSampleSize, ANALYSIS_DEFAULT_COLUMNS } from '../core/analysis/sampleSize';
import { poolSupported, requestAnalysis, StaleRenderError } from '../worker/client';

const IMAGE_MIME_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];

function loadImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = dataUrl;
  });
}

/** Read a File into a self-contained ImageSource (data URL + dimensions). */
export async function fileToImageSource(file: File): Promise<ImageSource> {
  if (!IMAGE_MIME_OK.includes(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP or BMP.`);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

  const { width, height } = await loadImage(dataUrl);
  return { name: file.name, dataUrl, width, height, mime: file.type };
}

/** Build an image layer seeded with default ASCII render settings. */
export function createImageLayer(source: ImageSource): ImageLayer {
  return {
    id: `layer_img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: source.name.replace(/\.[^.]+$/, '') || 'Image',
    kind: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    x: 0,
    y: 0,
    source,
    grid: null,
  };
}

/** `true` when the file is an image we can turn into ASCII art. */
export function isImageFile(file: { type: string; name?: string }): boolean {
  if (IMAGE_MIME_OK.includes(file.type)) return true;
  // Some Windows installs report an empty MIME type — fall back to extension.
  if (!file.type && file.name) return /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name);
  return false;
}

export interface ImportTarget {
  addLayer: (layer: Layer, index?: number) => void;
  setActiveLayer: (id: string) => void;
}

/**
 * Downsample an image to an analysis grid and return a Rec.709 luminance
 * plane (0..1) for {@link analyzeLuma}. Height is scaled for 8x16 cells so
 * the plane's aspect matches what the renderer would see.
 */
export async function sampleImageLuminance(
  dataUrl: string,
  columns = ANALYSIS_DEFAULT_COLUMNS,
): Promise<{ luma: Float32Array; width: number; height: number }> {
  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width: w, height: h } = analysisSampleSize(bitmap.width, bitmap.height, columns);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable for image analysis.');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    const raster: Raster = { width: w, height: h, data: image.data };
    return { luma: lumaPlane(raster, 'rec709'), width: w, height: h };
  } finally {
    bitmap.close();
  }
}

/**
 * Sample an image and run the chunked auto glyph/dither analysis.
 *
 * Runs in the worker pool when one is available (analysis shares the main
 * thread with rendering otherwise) and falls back to the main-thread path
 * when the worker fails for infrastructural reasons; a superseded analysis
 * propagates as {@link StaleRenderError} so a newer run is never raced by an
 * older one. Callers decide what to do with the result; throws only on decode
 * failures (the analysis itself is best-effort and never throws for odd
 * content).
 */
export async function runImageAnalysis(
  dataUrl: string,
  source: string,
): Promise<RenderAnalysis> {
  if (poolSupported()) {
    try {
      const result = await requestAnalysis(dataUrl);
      return { ...result, source };
    } catch (e) {
      if (e instanceof StaleRenderError) throw e;
      // Worker infrastructural failure (no OffscreenCanvas, crashed slot):
      // fall through to the main-thread path so suggestions still appear.
    }
  }
  const { luma, width, height } = await sampleImageLuminance(dataUrl);
  const result = await analyzeLumaChunked(
    luma,
    width,
    height,
    {},
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  );
  return { ...result, source };
}
