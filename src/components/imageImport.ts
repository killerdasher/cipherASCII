/**
 * Image import: turns a user-supplied image file into an ImageLayer that the
 * render pipeline can map to ASCII. Pure helpers — no React, no store access
 * beyond the actions handed in by the caller.
 */

import { DEFAULT_IMAGE_RENDER } from '../core/types';
import type { ImageLayer, ImageSource, Layer, Raster } from '../core/types';
import { lumaPlane } from '../core/image/raster';
import { analyzeLumaChunked, type RenderAnalysis } from '../core/analyze';

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
    x: 0,
    y: 0,
    source,
    settings: { ...DEFAULT_IMAGE_RENDER },
    grid: null,
    cacheKey: '',
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
  columns = 120,
): Promise<{ luma: Float32Array; width: number; height: number }> {
  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const w = Math.max(8, Math.min(240, Math.min(columns, bitmap.width)));
    const h = Math.max(
      8,
      Math.min(240, Math.round((w * bitmap.height * 0.5) / bitmap.width)),
    );
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
 * Callers decide what to do with the result; throws only on decode failures
 * (the analysis itself is best-effort and never throws for odd content).
 */
export async function runImageAnalysis(
  dataUrl: string,
  source: string,
): Promise<RenderAnalysis> {
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
