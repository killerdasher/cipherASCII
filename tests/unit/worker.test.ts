import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { bumpGeneration, getGeneration, cancelAll, terminateWorker, renderImage, requestAnalysis, StaleRenderError } from '../../src/worker/client';
import { DEFAULT_IMAGE_RENDER, type EffectsPipeline, type ImageRenderSettings } from '../../src/core/types';

describe('worker client', () => {
  it('bumpGeneration increments', () => {
    const before = getGeneration();
    const after = bumpGeneration();
    expect(after).toBe(before + 1);
  });

  it('cancelAll bumps generation', () => {
    const before = getGeneration();
    cancelAll();
    expect(getGeneration()).toBe(before + 1);
  });

  it('terminateWorker does not throw', () => {
    expect(() => terminateWorker()).not.toThrow();
  });

  it('render functions exist and are callable (mocked)', async () => {
    // These would need a real worker; just check exports exist
    const { renderImage, renderText, decodeImage } = await import('../../src/worker/client');
    expect(typeof renderImage).toBe('function');
    expect(typeof renderText).toBe('function');
    expect(typeof decodeImage).toBe('function');
  });

  it('decodeImage resolves on the worker `decoded` reply', async () => {
    // Regression: the worker answers decodes with `kind: 'decoded'`, which the
    // client used to ignore — leaving the promise pending forever.
    const instances: any[] = [];
    class FakeWorker {
      onmessage: ((e: { data: any }) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      posted: any[] = [];
      constructor() {
        instances.push(this);
      }
      postMessage(msg: any) {
        this.posted.push(msg);
      }
      terminate() {
        /* noop */
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    terminateWorker(); // drop any cached worker so the stub is used

    try {
      const { decodeImage } = await import('../../src/worker/client');
      const promise = decodeImage('data:image/png;base64,AAAA');
      const worker = instances[instances.length - 1];
      expect(worker).toBeDefined();
      expect(worker.posted[0].kind).toBe('decode');

      worker.onmessage!({
        data: {
          kind: 'decoded',
          jobId: worker.posted[0].jobId,
          generationId: worker.posted[0].generationId,
          raster: { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4) },
        },
      });

      await expect(promise).resolves.toMatchObject({ width: 3, height: 2 });
    } finally {
      terminateWorker();
      vi.unstubAllGlobals();
    }
  });

  it('decodeImage rejects when the worker reports decode-failed', async () => {
    const instances: any[] = [];
    class FakeWorker {
      onmessage: ((e: { data: any }) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      posted: any[] = [];
      constructor() {
        instances.push(this);
      }
      postMessage(msg: any) {
        this.posted.push(msg);
      }
      terminate() {
        /* noop */
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    terminateWorker();

    try {
      const { decodeImage } = await import('../../src/worker/client');
      const promise = decodeImage('data:image/png;base64,AAAA');
      const worker = instances[instances.length - 1];

      worker.onmessage!({
        data: {
          kind: 'error',
          jobId: worker.posted[0].jobId,
          generationId: worker.posted[0].generationId,
          code: 'decode-failed',
          message: 'unsupported format',
        },
      });

      await expect(promise).rejects.toThrow(/decode-failed: unsupported format/);
    } finally {
      terminateWorker();
      vi.unstubAllGlobals();
    }
  });

  it('renderImage forwards the effects pipeline to the worker', async () => {
    const instances: any[] = [];
    class FakeWorker {
      onmessage: ((e: { data: any }) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      posted: any[] = [];
      constructor() {
        instances.push(this);
      }
      postMessage(msg: any) {
        this.posted.push(msg);
      }
      terminate() {
        /* noop */
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    terminateWorker();

    try {
      const { renderImage } = await import('../../src/worker/client');
      const { DEFAULT_IMAGE_RENDER } = await import('../../src/core/types');
      const effects: EffectsPipeline = {
        effects: [{ id: 'vignette', enabled: true, intensity: 1, params: { radius: 0.5 } }],
      };
      const promise = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER, effects);
      const worker = instances[instances.length - 1];

      expect(worker.posted[0].kind).toBe('image');
      expect(worker.posted[0].effects).toEqual(effects);

      worker.onmessage!({
        data: {
          kind: 'result',
          jobId: worker.posted[0].jobId,
          generationId: worker.posted[0].generationId,
          result: {
            grid: { width: 1, height: 1, chars: ['@'], fg: null, bg: null },
            stats: { durationMs: 1, cells: 1, sourceWidth: 1, sourceHeight: 1 },
          },
        },
      });

      await expect(promise).resolves.toMatchObject({ stats: { cells: 1 } });
    } finally {
      terminateWorker();
      vi.unstubAllGlobals();
    }
  });
});

describe('stale render settlement', () => {
  class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    posted: any[] = [];
    constructor() {
      FakeWorker.last = this;
    }
    postMessage(msg: any) {
      this.posted.push(msg);
    }
    terminate() {
      FakeWorker.last = null;
    }
  }

  /** Install the fake worker, drop the cached instance, settle leftovers. */
  function installFakeWorker(): void {
    vi.stubGlobal('Worker', FakeWorker);
    terminateWorker();
    cancelAll();
    FakeWorker.last = null;
  }

  /** Start one render and hand back its promise plus the fake worker. */
  function startRender(): { promise: Promise<unknown>; worker: FakeWorker } {
    const promise = renderImage('data:image/png;base64,AAAA', {} as ImageRenderSettings);
    // The rejection is asserted by the caller; swallow here so an unhandled
    // rejection cannot race the test.
    promise.catch(() => undefined);
    const worker = FakeWorker.last;
    if (!worker) throw new Error('worker was not created');
    return { promise, worker };
  }

  it('bumpGeneration settles superseded jobs instead of leaking them', async () => {
    installFakeWorker();
    const { promise, worker } = startRender();
    const jobId = worker.posted[0].jobId;
    const assertion = expect(promise).rejects.toThrow(StaleRenderError);
    bumpGeneration(); // supersede: the awaiting caller must unblock
    await assertion;
    // A late reply for that job is dropped instead of resurrected.
    worker.onmessage?.({
      data: { kind: 'result', jobId, generationId: getGeneration(), result: {} },
    } as never);
  });

  it('a reply from an older generation rejects that job', async () => {
    installFakeWorker();
    const { promise, worker } = startRender();
    const jobId = worker.posted[0].jobId;
    const assertion = expect(promise).rejects.toThrow(/Superseded by a newer render/);
    worker.onmessage?.({
      data: { kind: 'result', jobId, generationId: getGeneration() + 1, result: {} },
    } as never);
    await assertion;
  });

  it('a matching reply still resolves', async () => {
    installFakeWorker();
    const { promise, worker } = startRender();
    const jobId = worker.posted[0].jobId;
    worker.onmessage?.({
      data: { kind: 'result', jobId, generationId: getGeneration(), result: { grid: null } },
    } as never);
    await expect(promise).resolves.toEqual({ grid: null });
  });

  it('cancelAll settles every in-flight job', async () => {
    installFakeWorker();
    const { promise } = startRender();
    const assertion = expect(promise).rejects.toThrow(/Cancelled by generation bump/);
    cancelAll();
    await assertion;
  });
});

describe('worker pool', () => {
  let instances: any[] = [];

  class PoolWorker {
    onmessage: ((e: { data: any }) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    posted: any[] = [];
    terminated = false;
    constructor() {
      instances.push(this);
    }
    postMessage(msg: any) {
      this.posted.push(msg);
    }
    terminate() {
      this.terminated = true;
    }
  }

  /** Reply to the most recent post on `slot` with a constructed message. */
  function reply(slot: any, kind: string, extra: Record<string, unknown> = {}): void {
    const posted = slot.posted[slot.posted.length - 1];
    slot.onmessage?.({
      data: { kind, jobId: posted.jobId, generationId: posted.generationId, ...extra },
    });
  }

  beforeEach(() => {
    instances = [];
    vi.stubGlobal('Worker', PoolWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    terminateWorker();
  });

  afterEach(() => {
    terminateWorker();
    vi.unstubAllGlobals();
  });

  it('reuses an idle slot and only spawns a second worker when the first is busy', async () => {
    const first = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    expect(instances).toHaveLength(1);

    const analysis = requestAnalysis('data:image/png;base64,AAAA');
    expect(instances).toHaveLength(2);

    reply(instances[0], 'result', { result: { grid: {}, stats: {} } });
    reply(instances[1], 'analysis', { result: { recommendations: [], traits: null } });
    await expect(first).resolves.toBeTruthy();
    await expect(analysis).resolves.toMatchObject({ recommendations: [] });

    // Both slots idle again: the next job reuses slot 0 instead of spawning.
    const again = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    expect(instances).toHaveLength(2);
    reply(instances[0], 'result', { result: { grid: {}, stats: {} } });
    await again;
  });

  it('single-flights analysis: a newer run supersedes the previous one', async () => {
    const older = requestAnalysis('data:image/png;base64,AAAA');
    const olderAssertion = expect(older).rejects.toBeInstanceOf(StaleRenderError);

    const newer = requestAnalysis('data:image/png;base64,BBBB');
    await olderAssertion;
    expect(instances).toHaveLength(1); // older settled, slot reused

    reply(instances[0], 'analysis', { result: { recommendations: ['chip'], traits: null } });
    await expect(newer).resolves.toMatchObject({ recommendations: ['chip'] });
  });

  it('analysis survives a render generation bump', async () => {
    const analysis = requestAnalysis('data:image/png;base64,AAAA');
    let settled = false;
    void analysis.catch(() => {
      settled = true;
    });

    bumpGeneration();
    await Promise.resolve();
    expect(settled).toBe(false);

    reply(instances[0], 'analysis', { result: { recommendations: [], traits: null } });
    await expect(analysis).resolves.toBeTruthy();
  });

  it('surfaces analysis-failed errors from the worker', async () => {
    const analysis = requestAnalysis('data:image/png;base64,AAAA');
    reply(instances[0], 'error', { code: 'analysis-failed', message: 'bad data' });
    await expect(analysis).rejects.toThrow(/analysis-failed: bad data/);
  });

  it('terminateWorker retires slots and settles jobs that will never reply', async () => {
    const render = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    terminateWorker();
    expect(instances[0].terminated).toBe(true);
    await expect(render).rejects.toThrow(/Worker terminated/);
    expect(instances).toHaveLength(1);

    // A fresh dispatch after termination spawns a clean slot.
    const next = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    expect(instances).toHaveLength(2);
    reply(instances[1], 'result', { result: { grid: {}, stats: {} } });
    await next;
  });

  it('a crashed slot fails only its own jobs and is replaced on the next dispatch', async () => {
    const render = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    instances[0].onerror?.({ message: 'boom' });
    await expect(render).rejects.toThrow(/Worker error: boom/);

    const next = renderImage('data:image/png;base64,AAAA', DEFAULT_IMAGE_RENDER);
    expect(instances).toHaveLength(2);
    expect(instances[0].terminated).toBe(true);
    reply(instances[1], 'result', { result: { grid: {}, stats: {} } });
    await next;
  });
});
