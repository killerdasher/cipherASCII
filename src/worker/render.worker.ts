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
  type CreativeLayer,
  type Size,
} from '../core/types';
import type { GeneratorGraph } from '../core/generators/graph';
import {
  renderImageToGrid,
  prepareSampledRaster,
  rasterToGrid,
  CancelledRender,
} from '../core/renderImage';
import { renderCreativeLayer } from '../core/layer/creative';
import { renderTextToGrid } from '../core/text/render';
import { applyEffectsToRaster } from '../core/effects/pipeline';
import { ANALYSIS_DEFAULT_COLUMNS } from '../core/analysis/sampleSize';
import { type Raster } from '../core/types';
import { dataUrlToRaster } from './raster-decode';
import { runAnalysisJob } from './analysisJob';

type WorkerRequest =
  | (ImageRenderRequest & { generationId?: number })
  | (TextRenderRequest & { generationId?: number })
  | (ProceduralRenderRequest & { generationId?: number })
  | { kind: 'decode'; jobId: number; dataUrl: string; generationId: number }
  | { kind: 'analysis'; jobId: number; dataUrl: string; columns?: number; generationId: number }
  | {
      kind: 'creative';
      jobId: number;
      graph: GeneratorGraph;
      layer: CreativeLayer;
      canvas: Size;
      seed: number;
      generationId: number;
    };

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

  if (msg.kind === 'analysis') {
    // Like `decode`, an analysis runs beside whatever render is current: it
    // must not touch `currentGeneration`, and its replies echo the request's
    // own generation so the client can correlate them.
    try {
      const result = await runAnalysisJob(msg.dataUrl, msg.columns ?? ANALYSIS_DEFAULT_COLUMNS);
      self.postMessage({ kind: 'analysis', jobId, generationId: msg.generationId, result });
    } catch (e) {
      postError(
        jobId,
        'analysis-failed',
        e instanceof Error ? e.message : 'Unknown analysis error',
        msg.generationId,
      );
    }
    return;
  }

  if (msg.kind === 'creative') {
    // Like `decode`/`analysis`, a creative evaluation runs beside the render
    // loop and must not touch `currentGeneration`. Staleness is enforced by
    // the store's refresh epoch when the reply lands.
    try {
      const result = renderCreativeLayer([msg.graph], msg.layer, msg.canvas, msg.seed);
      if (!result.ok) {
        postError(jobId, result.error.code, result.error.message, msg.generationId);
      } else {
        self.postMessage({
          kind: 'creative-result',
          jobId,
          generationId: msg.generationId,
          grid: result.value.grid,
          cacheKey: result.value.cacheKey,
        });
      }
    } catch (e) {
      postError(
        jobId,
        'creative-failed',
        e instanceof Error ? e.message : 'Unknown creative error',
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