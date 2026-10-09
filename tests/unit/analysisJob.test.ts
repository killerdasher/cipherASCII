import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearAnalysisCache,
  runAnalysisJob,
  type AnalysisSample,
} from '../../src/worker/analysisJob';

/** Tiny synthetic luminance field: cheap for `analyzeLumaChunked`. */
function sampleFor(tag: string): AnalysisSample {
  const width = 32;
  const height = 32;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = ((i * 37 + tag.charCodeAt(tag.length - 1)) % 255) / 255;
  }
  return { luma, width, height };
}

function countingSampler() {
  const calls: Array<{ dataUrl: string; columns: number }> = [];
  const sample = async (dataUrl: string, columns: number): Promise<AnalysisSample> => {
    calls.push({ dataUrl, columns });
    return sampleFor(dataUrl);
  };
  return { calls, sample };
}

describe('runAnalysisJob (memoised recommendation analysis, P2)', () => {
  beforeEach(() => {
    clearAnalysisCache();
  });

  it('samples once for a repeated (dataUrl, columns) pair', async () => {
    const { calls, sample } = countingSampler();
    const first = await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    const second = await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    expect(calls).toHaveLength(1);
    expect(second).toBe(first);
    expect(first.recommendations.length).toBeGreaterThan(0);
  });

  it('re-samples when the column count changes', async () => {
    const { calls, sample } = countingSampler();
    await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    await runAnalysisJob('data:image/png;base64,AAAA', 160, sample);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.columns)).toEqual([80, 160]);
  });

  it('re-samples when the image changes', async () => {
    const { calls, sample } = countingSampler();
    await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    await runAnalysisJob('data:image/png;base64,BBBB', 80, sample);
    expect(calls).toHaveLength(2);
  });

  it('keeps two images warm at once (capacity 2)', async () => {
    const { calls, sample } = countingSampler();
    await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    await runAnalysisJob('data:image/png;base64,BBBB', 80, sample);
    await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    await runAnalysisJob('data:image/png;base64,BBBB', 80, sample);
    expect(calls).toHaveLength(2);
  });

  it('does not cache a failed sample', async () => {
    let attempt = 0;
    const sample = async (): Promise<AnalysisSample> => {
      attempt += 1;
      if (attempt === 1) throw new Error('bitmap unavailable');
      return sampleFor('retry');
    };
    await expect(runAnalysisJob('data:image/png;base64,AAAA', 80, sample)).rejects.toThrow(
      'bitmap unavailable',
    );
    await runAnalysisJob('data:image/png;base64,AAAA', 80, sample);
    expect(attempt).toBe(2);
  });

  it('deduplicates concurrent runs for the same key', async () => {
    const { calls, sample } = countingSampler();
    const [a, b] = await Promise.all([
      runAnalysisJob('data:image/png;base64,AAAA', 80, sample),
      runAnalysisJob('data:image/png;base64,AAAA', 80, sample),
    ]);
    expect(calls).toHaveLength(1);
    expect(b).toBe(a);
  });
});
