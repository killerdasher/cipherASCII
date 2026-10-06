/**
 * Worker client: main-thread API for offloading renders to the worker.
 *
 * Handles generation IDs for stale-render prevention, request/response
 * correlation, and cleanup. Browser-focused; Node tests mock the worker.
 */

import type { ImageRenderSettings, TextRenderSettings, RenderResult, Raster, EffectsPipeline } from '../core/types';

export interface RenderJob {
  id: number;
  generation: number;
  resolve: (value: RenderResult) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: string, progress: number) => void;
}

let worker: Worker | null = null;
let nextJobId = 1;
const pending = new Map<number, RenderJob>();
let generation = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = handleError;
  }
  return worker;
}

function handleMessage(event: MessageEvent): void {
  const msg = event.data;
  const job = pending.get(msg.jobId);
  if (!job) return;

  if (msg.generationId !== job.generation) return;

  switch (msg.kind) {
    case 'result':
      job.resolve(msg.result);
      pending.delete(msg.jobId);
      break;
    case 'decoded':
      // decodeImage resolves with `{ raster }`; the worker posts `raster` at
      // the top level of a `decoded` message.
      job.resolve({ raster: msg.raster } as unknown as RenderResult);
      pending.delete(msg.jobId);
      break;
    case 'error':
      job.reject(new Error(`${msg.code}: ${msg.message}`));
      pending.delete(msg.jobId);
      break;
    case 'progress':
      job.onProgress?.(msg.stage, msg.progress);
      break;
  }
}

function handleError(err: ErrorEvent): void {
  for (const job of pending.values()) {
    job.reject(new Error(`Worker error: ${err.message}`));
  }
  pending.clear();
}

export function bumpGeneration(): number {
  generation += 1;
  return generation;
}

export function getGeneration(): number {
  return generation;
}

export function renderImage(
  source: Raster | string,
  settings: ImageRenderSettings,
  effects?: EffectsPipeline,
  onProgress?: (stage: string, progress: number) => void,
): Promise<RenderResult> {
  const jobId = nextJobId++;
  const gen = generation;

  const msg = {
    kind: 'image',
    jobId,
    generationId: gen,
    settings,
    effects,
    raster: typeof source === 'string' ? null : source,
    dataUrl: typeof source === 'string' ? source : undefined,
  };

  getWorker().postMessage(msg);

  return new Promise((resolve, reject) => {
    pending.set(jobId, { id: jobId, generation: gen, resolve, reject, onProgress });
  });
}

export function renderText(
  text: string,
  settings: TextRenderSettings,
  onProgress?: (stage: string, progress: number) => void,
): Promise<RenderResult> {
  const jobId = nextJobId++;
  const gen = generation;

  const msg = { kind: 'text', jobId, generationId: gen, text, settings };

  getWorker().postMessage(msg);

  return new Promise((resolve, reject) => {
    pending.set(jobId, { id: jobId, generation: gen, resolve, reject, onProgress });
  });
}

export function decodeImage(dataUrl: string): Promise<Raster> {
  const jobId = nextJobId++;
  const gen = generation;

  getWorker().postMessage({ kind: 'decode', jobId, generationId: gen, dataUrl });

  return new Promise((resolve, reject) => {
    pending.set(jobId, {
      id: jobId,
      generation: gen,
      resolve: (r) => resolve((r as any).raster),
      reject,
    });
  });
}

export function cancelAll(): void {
  generation += 1;
  for (const job of pending.values()) {
    job.reject(new Error('Cancelled by generation bump'));
  }
  pending.clear();
}

export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}