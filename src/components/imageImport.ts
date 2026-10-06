/**
 * Image import: turns a user-supplied image file into an ImageLayer that the
 * render pipeline can map to ASCII. Pure helpers — no React, no store access
 * beyond the actions handed in by the caller.
 */

import { DEFAULT_IMAGE_RENDER } from '../core/types';
import type { ImageLayer, ImageSource, Layer } from '../core/types';

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
