// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runImageAnalysis } from '../../src/components/imageImport';
import { terminateWorker } from '../../src/worker/client';

describe('runImageAnalysis', () => {
  let instances: any[] = [];

  class PoolWorker {
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

  beforeEach(() => {
    instances = [];
    vi.stubGlobal('Worker', PoolWorker);
    terminateWorker();
  });

  afterEach(() => {
    terminateWorker();
    vi.unstubAllGlobals();
  });

  it('runs through the worker pool when one is available and binds the source name', async () => {
    const promise = runImageAnalysis('data:image/png;base64,AAAA', 'photo.png');
    expect(instances).toHaveLength(1);

    const posted = instances[0].posted[0];
    expect(posted.kind).toBe('analysis');
    expect(posted.dataUrl).toBe('data:image/png;base64,AAAA');

    instances[0].onmessage?.({
      data: {
        kind: 'analysis',
        jobId: posted.jobId,
        generationId: posted.generationId,
        result: {
          recommendations: [{ charsetId: 'block' }],
          traits: { contrast: 0.5, detail: 0.4, bandingRisk: 0.1 },
        },
      },
    });

    const out = await promise;
    expect(out.source).toBe('photo.png');
    expect(out.recommendations).toHaveLength(1);
    expect(out.traits.contrast).toBe(0.5);
  });

  it('propagates a superseded analysis instead of racing an older run', async () => {
    const older = runImageAnalysis('data:image/png;base64,AAAA', 'one.png');
    const olderAssertion = expect(older).rejects.toThrow(/Superseded by a newer analysis/);

    const newer = runImageAnalysis('data:image/png;base64,BBBB', 'two.png');
    await olderAssertion;

    const posted = instances[0].posted[instances[0].posted.length - 1];
    instances[0].onmessage?.({
      data: {
        kind: 'analysis',
        jobId: posted.jobId,
        generationId: posted.generationId,
        result: { recommendations: [], traits: null },
      },
    });
    await expect(newer).resolves.toMatchObject({ source: 'two.png', recommendations: [] });
  });
});
