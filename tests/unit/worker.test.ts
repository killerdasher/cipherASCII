import { describe, expect, it, vi } from 'vitest';
import { bumpGeneration, getGeneration, cancelAll, terminateWorker } from '../../src/worker/client';
import type { EffectsPipeline } from '../../src/core/types';

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