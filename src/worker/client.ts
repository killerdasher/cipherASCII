/**
 * Worker pool client: main-thread API for offloading renders, decodes and
 * analysis to a lazily spawned pool of module workers.
 *
 * Pool policy: spawn on demand up to `min(4, hardwareConcurrency)` workers,
 * dispatch to the least-busy slot, queue on the busiest when the pool is
 * full. The historical `jobId`/`generation` protocol is preserved — every
 * message still carries `jobId` + `generationId`, stale render results settle
 * with {@link StaleRenderError}, and `bumpGeneration()` retires in-flight
 * render jobs. Analysis jobs opt out of generation bumps: they query the
 * source image, so an unrelated edit must not cancel them (they are
 * single-flighted instead: a newer analysis supersedes the previous one).
 */

import type { ImageRenderSettings, TextRenderSettings, RenderResult, Raster, EffectsPipeline, AsciiGrid, CreativeLayer, Size } from '../core/types';
import type { AnalyzeResult } from '../core/analyze';
import type { GeneratorGraph } from '../core/generators/graph';
import { ANALYSIS_DEFAULT_COLUMNS } from '../core/analysis/sampleSize';

/**
 * Raised when a job's generation was superseded before it finished.
 *
 * Callers catch this to skip stale results without treating them as failures;
 * it always settles the awaiting promise, which is what fixes the historic
 * leak where superseded jobs left `await`s hanging forever.
 */
export class StaleRenderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'StaleRenderError';
  }
}

interface WorkerSlot {
  worker: Worker;
  busy: number;
}

export interface RenderJob {
  id: number;
  generation: number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: string, progress: number) => void;
  /** False for side queries (analysis) that survive render generation bumps. */
  staleOnBump: boolean;
  /** True while this job is the active single-flight analysis. */
  analysis: boolean;
  slot: WorkerSlot;
}

const slots: WorkerSlot[] = [];
let nextJobId = 1;
const pending = new Map<number, RenderJob>();
let generation = 0;
let activeAnalysisJob: number | null = null;

/** Pool size: honest hardwareConcurrency, clamped to a sane RAM budget. */
function poolLimit(): number {
  const hc = (globalThis.navigator as Navigator | undefined)?.hardwareConcurrency;
  const cores = typeof hc === 'number' && hc > 0 ? hc : 2;
  return Math.max(1, Math.min(4, cores));
}

function spawnSlot(): WorkerSlot {
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
  const slot: WorkerSlot = { worker, busy: 0 };
  worker.onmessage = (event) => handleMessage(slot, event);
  worker.onerror = (err) => handleSlotError(slot, err);
  slots.push(slot);
  return slot;
}

/** Least-busy dispatch: reuse an idle slot, spawn while busy and under cap. */
function pickSlot(): WorkerSlot {
  let best: WorkerSlot | null = null;
  for (const slot of slots) {
    if (!best || slot.busy < best.busy) best = slot;
  }
  if (best && best.busy === 0) return best;
  if (!best || slots.length < poolLimit()) return spawnSlot();
  return best;
}

/**
 * Remove a job from the pool bookkeeping exactly once, decrementing its
 * slot's busy count. Returns the job, or null if it already settled.
 */
function finishJob(jobId: number): RenderJob | null {
  const job = pending.get(jobId);
  if (!job) return null;
  pending.delete(jobId);
  job.slot.busy = Math.max(0, job.slot.busy - 1);
  if (job.analysis && activeAnalysisJob === jobId) activeAnalysisJob = null;
  return job;
}

function handleMessage(slot: WorkerSlot, event: MessageEvent): void {
  const msg = event.data;
  const job = pending.get(msg.jobId);
  if (!job || job.slot !== slot) return;

  if (msg.generationId !== job.generation) {
    // The reply belongs to a different job generation than we recorded:
    // drop it *and* settle the promise so the caller's `finally` still runs.
    finishJob(msg.jobId)?.reject(new StaleRenderError('Superseded by a newer render'));
    return;
  }

  switch (msg.kind) {
    case 'result':
      finishJob(msg.jobId)?.resolve(msg.result);
      break;
    case 'decoded':
      // decodeImage resolves with `{ raster }`; the worker posts `raster` at
      // the top level of a `decoded` message.
      finishJob(msg.jobId)?.resolve({ raster: msg.raster });
      break;
    case 'analysis':
      finishJob(msg.jobId)?.resolve(msg.result as AnalyzeResult);
      break;
    case 'creative-result':
      finishJob(msg.jobId)?.resolve({
        grid: msg.grid as AsciiGrid,
        cacheKey: msg.cacheKey as string,
      });
      break;
    case 'error': {
      const target = finishJob(msg.jobId);
      target?.reject(new Error(`${msg.code}: ${msg.message}`));
      break;
    }
    case 'progress':
      job.onProgress?.(msg.stage, msg.progress);
      break;
  }
}

function handleSlotError(slot: WorkerSlot, err: ErrorEvent): void {
  // One crashed worker must not take the whole pool down: retire the slot,
  // fail only its jobs, and let the next dispatch respawn.
  const idx = slots.indexOf(slot);
  if (idx >= 0) slots.splice(idx, 1);
  for (const [jobId, job] of [...pending]) {
    if (job.slot === slot) {
      finishJob(jobId)?.reject(new Error(`Worker error: ${err.message}`));
    }
  }
  try {
    slot.worker.terminate();
  } catch {
    /* already dead */
  }
}

export function bumpGeneration(): number {
  generation += 1;
  // Everything in flight now belongs to an older document state; settle those
  // promises immediately instead of waiting for replies that will be dropped.
  // Analysis jobs are exempt: they describe the source image, which an edit
  // did not change.
  for (const [jobId, job] of [...pending]) {
    if (job.staleOnBump && job.generation < generation) {
      finishJob(jobId)?.reject(new StaleRenderError('Superseded by a newer render'));
    }
  }
  return generation;
}

export function getGeneration(): number {
  return generation;
}

/** True when the environment can host the pool at all. */
export function poolSupported(): boolean {
  return typeof Worker !== 'undefined';
}

interface SendOptions {
  onProgress?: (stage: string, progress: number) => void;
  /** Map the resolved payload before it reaches the caller (decode). */
  map?: (value: any) => any;
  /** False for side queries that survive `bumpGeneration()`. */
  staleOnBump?: boolean;
  analysis?: boolean;
  /** Runs with the assigned jobId before the message is posted. */
  onDispatch?: (jobId: number) => void;
}

function send<T>(
  build: (jobId: number, generationId: number) => Record<string, unknown>,
  options: SendOptions = {},
): Promise<T> {
  const jobId = nextJobId++;
  const gen = generation;
  const slot = pickSlot();
  slot.busy += 1;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(jobId, {
      id: jobId,
      generation: gen,
      resolve: options.map ? (value) => resolve(options.map!(value)) : resolve,
      reject,
      onProgress: options.onProgress,
      staleOnBump: options.staleOnBump ?? true,
      analysis: options.analysis ?? false,
      slot,
    });
  });
  options.onDispatch?.(jobId);
  slot.worker.postMessage(build(jobId, gen));
  return promise;
}

export function renderImage(
  source: Raster | string,
  settings: ImageRenderSettings,
  effects?: EffectsPipeline,
  onProgress?: (stage: string, progress: number) => void,
): Promise<RenderResult> {
  return send<RenderResult>(
    (jobId, generationId) => ({
      kind: 'image',
      jobId,
      generationId,
      settings,
      effects,
      raster: typeof source === 'string' ? null : source,
      dataUrl: typeof source === 'string' ? source : undefined,
    }),
    { onProgress },
  );
}

export function renderText(
  text: string,
  settings: TextRenderSettings,
  onProgress?: (stage: string, progress: number) => void,
): Promise<RenderResult> {
  return send<RenderResult>(
    (jobId, generationId) => ({ kind: 'text', jobId, generationId, text, settings }),
    { onProgress },
  );
}

export function decodeImage(dataUrl: string): Promise<Raster> {
  return send<Raster>(
    (jobId, generationId) => ({ kind: 'decode', jobId, generationId, dataUrl }),
    { map: (value) => value.raster as Raster },
  );
}

/**
 * Run the auto glyph/dither analysis off-thread.
 *
 * Single-flighted: dispatching a new analysis rejects the previous one with
 * {@link StaleRenderError} instead of letting two runs race to be latest.
 * Survives `bumpGeneration()` (see pool notes at the top of the file).
 */
export function requestAnalysis(
  dataUrl: string,
  columns: number = ANALYSIS_DEFAULT_COLUMNS,
): Promise<AnalyzeResult> {
  if (activeAnalysisJob !== null) {
    finishJob(activeAnalysisJob)?.reject(new StaleRenderError('Superseded by a newer analysis'));
  }
  const promise = send<AnalyzeResult>(
    (jobId, generationId) => ({ kind: 'analysis', jobId, generationId, dataUrl, columns }),
    {
      staleOnBump: false,
      analysis: true,
      onDispatch: (jobId) => {
        activeAnalysisJob = jobId;
      },
    },
  );
  return promise;
}

/**
 * Evaluate a creative layer's generator graph off-thread.
 *
 * Rejects like every other pool job (crash, cancel); unlike renders it
 * survives `bumpGeneration()` — staleness is the store's refresh epoch, not
 * the render counter. The layer is sent with its derived grid stripped: only
 * `graphId`/`render` feed the evaluation.
 */
export function renderCreative(
  graph: GeneratorGraph,
  layer: CreativeLayer,
  canvas: Size,
  seed: number,
): Promise<{ grid: AsciiGrid; cacheKey: string }> {
  return send<{ grid: AsciiGrid; cacheKey: string }>(
    (jobId, generationId) => ({
      kind: 'creative',
      jobId,
      generationId,
      graph,
      layer: { ...layer, grid: null, cacheKey: '' },
      canvas,
      seed,
    }),
    { staleOnBump: false },
  );
}

export function cancelAll(): void {
  generation += 1;
  for (const jobId of [...pending.keys()]) {
    finishJob(jobId)?.reject(new Error('Cancelled by generation bump'));
  }
}

export function terminateWorker(): void {
  for (const slot of slots) {
    try {
      slot.worker.terminate();
    } catch {
      /* already dead */
    }
  }
  slots.length = 0;
  // A terminated worker will never reply; settle whatever was in flight so
  // callers' awaits do not hang (the same leak StaleRenderError fixed).
  for (const jobId of [...pending.keys()]) {
    finishJob(jobId)?.reject(new Error('Worker terminated'));
  }
}
