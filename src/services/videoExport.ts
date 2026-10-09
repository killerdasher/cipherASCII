/**
 * Timeline video export: renders every timeline frame to a PNG inside the
 * ffmpeg.wasm virtual FS and encodes it to MP4 (H.264) or GIF.
 *
 * Frame rendering goes through the unified export frame renderer
 * (`createExportFrameSession` in `core/export/frame.ts`): the same composed
 * stack, timeline evaluation and cell-effect bake that the PNG and text
 * exports serialize, advanced one frame per timeline frame — so every format
 * shows the same frame at the same frame index. Rasterization reuses the PNG
 * export's cell metrics + subtexture mask, so the clip matches what is on
 * screen.
 *
 * The ffmpeg core is loaded from `public/ffmpeg/` (vendored by
 * scripts/prepare-ffmpeg-core.mjs): via fetch when the page runs over http,
 * or through the Electron `fs:readAsset` bridge when it runs from file://.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { AsciiGrid, Document } from '../core/types';
import type { Timeline } from '../core/timeline/timeline';
import { createExportFrameSession } from '../core/export/frame';
import { drawGridToContext, type CanvasLike } from '../core/export/png';
import { applySubtexture, shouldApplySubtexture } from '../core/subtexture';
import {
  buildVideoArgs,
  frameFileName,
  videoFrameNumbers,
  videoOutputName,
  type VideoFormatId,
} from '../core/export/videoArgs';
import { themeColor } from '../utils/themeColor';

/** Raster cell metrics per frame - identical to the PNG export (2x crisp text). */
const VIDEO_CELL = { width: 9, height: 18, scale: 2 };
const VIDEO_FONT = "'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace";

export type ExportPhase = 'load' | 'render' | 'encode' | 'done';

export interface ExportProgress {
  phase: ExportPhase;
  /** 0..1 within the phase. */
  value: number;
}

interface RendererBridge {
  electronAPI?: { readAsset?: (relPath: string) => Promise<Uint8Array<ArrayBuffer>> };
}

/** Turn a bundled core file into a URL the worker can import/fetch. */
async function coreFileUrl(name: string, mime: string): Promise<string> {
  // http (dev server): the vendored copy in public/ is served directly.
  try {
    const res = await fetch(`ffmpeg/${name}`);
    if (res.ok) {
      return URL.createObjectURL(await res.blob());
    }
  } catch {
    // file:// in the packaged app cannot fetch local files - use the bridge.
  }
  const api = (window as unknown as RendererBridge).electronAPI;
  if (api?.readAsset) {
    const bytes = await api.readAsset(`ffmpeg/${name}`);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }
  throw new Error(`ffmpeg core not found (public/ffmpeg/${name} could not be loaded)`);
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

/** Shared, lazily loaded ffmpeg instance (WASM compile happens once). */
function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [coreURL, wasmURL] = await Promise.all([
        coreFileUrl('ffmpeg-core.js', 'text/javascript'),
        coreFileUrl('ffmpeg-core.wasm', 'application/wasm'),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((e) => {
      // Allow a later retry (e.g. the assets arrive after a rebuild).
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

/** Rasterise one composed export frame to PNG bytes (PNG-export cell metrics). */
async function rasterizeFramePng(
  grid: AsciiGrid,
  background: number,
  foreground: number,
  subtexture: Document['canvas']['subtexture'],
): Promise<Uint8Array> {
  const canvas = window.document.createElement('canvas');
  canvas.width = grid.width * VIDEO_CELL.width * VIDEO_CELL.scale;
  canvas.height = grid.height * VIDEO_CELL.height * VIDEO_CELL.scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('a 2D canvas is unavailable, cannot rasterize frames');
  drawGridToContext(ctx as unknown as CanvasLike, grid, {
    cellWidth: VIDEO_CELL.width,
    cellHeight: VIDEO_CELL.height,
    scale: VIDEO_CELL.scale,
    fontFamily: VIDEO_FONT,
    background,
    foreground,
  });
  if (shouldApplySubtexture(subtexture, canvas.width, canvas.height)) {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applySubtexture(pixels.data, pixels.width, pixels.height, subtexture);
    ctx.putImageData(pixels, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('the browser could not encode a frame as PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ExportVideoOptions {
  document: Document;
  timeline: Timeline;
  format: VideoFormatId;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Export the whole timeline (`duration` frames at `fps`) and resolve with the
 * encoded file bytes. `onProgress` reports load/render/encode phases so the
 * UI can show a real bar instead of a spinner.
 */
export async function exportVideo({
  document,
  timeline,
  format,
  onProgress,
}: ExportVideoOptions): Promise<Uint8Array<ArrayBuffer>> {
  const frames = videoFrameNumbers(timeline.duration);
  const fps = Math.max(1, Math.round(timeline.fps));
  const report = (phase: ExportPhase, value: number) => onProgress?.({ phase, value });

  report('load', 0);
  const ffmpeg = await getFFmpeg();
  report('load', 1);

  const background = themeColor('--bg', 0x0c0c10);
  const foreground = themeColor('--fg', 0xd4d4d8);
  // Same paper the PNG path hands the cell effects, so fades blend toward the
  // colour the still export shows.
  const paper = themeColor('--bg-elevated', background);
  const renderFrame = createExportFrameSession(document, { timeline, paper });
  const subtexture = document.canvas.subtexture;
  const output = videoOutputName(format);
  const written = [...frames.map((f) => frameFileName(f)), output];
  const onEncode = ({ progress }: { progress: number }) =>
    report('encode', Math.min(1, Math.max(0, progress)));
  ffmpeg.on('progress', onEncode);

  try {
    for (let i = 0; i < frames.length; i++) {
      const png = await rasterizeFramePng(
        renderFrame(frames[i]),
        background,
        foreground,
        subtexture,
      );
      // writeFile transfers the underlying ArrayBuffer to the worker, so each
      // frame must own its buffer (rasterizeFramePng guarantees that).
      await ffmpeg.writeFile(frameFileName(frames[i]), png);
      report('render', (i + 1) / frames.length);
    }

    let code = await ffmpeg.exec(buildVideoArgs(format, fps));
    if (code !== 0 && format === 'mp4') {
      // Some core builds ship without libx264 - mpeg4 is always present.
      code = await ffmpeg.exec(buildVideoArgs(format, fps, 'mpeg4'));
    }
    if (code !== 0) {
      throw new Error(`ffmpeg failed with exit code ${code}`);
    }

    const data = await ffmpeg.readFile(output);
    if (typeof data === 'string') {
      throw new Error('ffmpeg returned text where video bytes were expected');
    }
    report('done', 1);
    return data as Uint8Array<ArrayBuffer>;
  } finally {
    ffmpeg.off('progress', onEncode);
    // Keep the virtual FS small; leftovers would accumulate across exports.
    for (const name of written) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        /* never written (failed run) */
      }
    }
  }
}
