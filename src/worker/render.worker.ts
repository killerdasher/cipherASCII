/**
 * Off-main-thread render worker.
 *
 * Handles image→ASCII and text→ASCII rendering to keep the UI responsive.
 * Uses generation IDs to discard stale results when settings change mid-flight.
 */

import {
  type RenderResult,
  type ImageRenderRequest,
  type TextRenderRequest,
  type ProceduralRenderRequest,
} from '../core/types';
import {
  renderImageToGrid,
  prepareSampledRaster,
  rasterToGrid,
  CancelledRender,
} from '../core/renderImage';
import { renderTextToGrid } from '../core/text/render';
import { applyEffectsToRaster } from '../core/effects/pipeline';
import { type Raster } from '../core/types';
import { dataUrlToRaster } from './raster-decode';

type WorkerRequest =
  | (ImageRenderRequest & { generationId?: number })
  | (TextRenderRequest & { generationId?: number })
  | (ProceduralRenderRequest & { generationId?: number })
  | { kind: 'decode'; jobId: number; dataUrl: string; generationId: number };

let currentGeneration = 0;

function postResult(jobId: number, result: RenderResult): void {
  self.postMessage({ kind: 'result', jobId, generationId: currentGeneration, result });
}

function postError(jobId: number, code: string, message: string, generationId: number = currentGeneration): void {
  self.postMessage({ kind: 'error', jobId, generationId, code, message });
}

function postProgress(jobId: number, stage: string, progress: number): void {
  self.postMessage({ kind: 'progress', jobId, generationId: currentGeneration, stage, progress });
}

function shouldCancel(gen: number): boolean {
  return gen !== currentGeneration;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const jobId = msg.jobId;

  if (msg.kind === 'decode') {
    try {
      const raster = await dataUrlToRaster(msg.dataUrl);
      self.postMessage({ kind: 'decoded', jobId, generationId: msg.generationId, raster });
    } catch (e) {
      // Echo the decode request's own generation: `currentGeneration` belongs
      // to the last render job and would make the client drop this error.
      postError(
        jobId,
        'decode-failed',
        e instanceof Error ? e.message : 'Unknown decode error',
        msg.generationId,
      );
    }
    return;
  }

  currentGeneration = msg.generationId ?? 0;

  try {
    if (msg.kind === 'image') {
      postProgress(jobId, 'decode', 0);
      let raster: Raster | null = msg.raster;
      if (!raster && msg.dataUrl) {
        postProgress(jobId, 'decode', 0.1);
        raster = await dataUrlToRaster(msg.dataUrl);
      }
      if (!raster) {
        postError(jobId, 'invalid-input', 'No source image provided');
        return;
      }
      const opts = { shouldCancel: () => shouldCancel(currentGeneration) };
      const effects = msg.effects && msg.effects.effects.length > 0 ? msg.effects : null;
      let result: RenderResult;
      if (effects && (msg.settings.effectSpace ?? 'source') === 'grid') {
        // Effects between resize and preprocessing: the stack runs on the
        // downscaled raster instead of the full-resolution source (see
        // docs/PERFORMANCE.md §6 - this is orders of magnitude cheaper and
        // puts scanlines/grain on cell boundaries).
        postProgress(jobId, 'effects', 0.2);
        const stage = prepareSampledRaster(raster, msg.settings, opts);
        const effected = await applyEffectsToRaster(stage.sampled, effects);
        if (shouldCancel(currentGeneration)) return;
        postProgress(jobId, 'render', 0.3);
        result = rasterToGrid(effected, { ...stage, sampled: effected }, msg.settings, opts);
      } else {
        if (effects) {
          postProgress(jobId, 'effects', 0.2);
          raster = await applyEffectsToRaster(raster, effects);
          if (shouldCancel(currentGeneration)) return;
        }
        postProgress(jobId, 'render', 0.3);
        result = renderImageToGrid(raster, msg.settings, opts);
      }
      postProgress(jobId, 'done', 1);
      postResult(jobId, result);
    } else if (msg.kind === 'procedural') {
      // The request type exists, but no client sends it yet: answer instead of
      // letting the caller's promise hang (the fate of `decode` before it got
      // its own branch).
      postError(
        jobId,
        'unsupported',
        'Procedural render requests are not handled by the worker',
      );
    } else if (msg.kind === 'text') {
      postProgress(jobId, 'render', 0.2);
      const grid = renderTextToGrid(msg.text, msg.settings);
      const result: RenderResult = {
        grid,
        stats: {
          durationMs: 0,
          cells: grid.width * grid.height,
          sourceWidth: 0,
          sourceHeight: 0,
        },
      };
      postProgress(jobId, 'done', 1);
      postResult(jobId, result);
    }
  } catch (e) {
    if (e instanceof CancelledRender) return;
    postError(jobId, 'internal', e instanceof Error ? e.message : 'Unknown error');
  }
};