import { describe, expect, it } from 'vitest';
import { MAX_DECODED_SIGNAL_QC_SOURCES } from './videoDecodedSignalQc';
import { runVideoDecodedSignalQc } from './videoDecodedSignalRuntime';

describe('decoded-signal QC runtime orchestration', () => {
  it('runs sources sequentially and turns a decoder failure into a persisted unavailable result', async () => {
    const calls: string[] = [];
    const result = await runVideoDecodedSignalQc({
      sources: [
        { id: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' },
        { id: 'mic-a', label: 'Mic A', kind: 'audio', assetUrl: 'blob:mic-a' },
      ],
      compositionSignature: 'sequence-a',
      now: () => 44,
      decoder: async (source) => {
        calls.push(source.id);
        if (source.id === 'mic-a') throw new Error('The audio decoder failed.');
        return {
          id: source.id, label: source.label, kind: source.kind, durationMs: 2_000,
          frameSamples: [{ timeMs: 0, luma: 0.5, signature: [0.5] }, { timeMs: 1_000, luma: 0.6, signature: [0.6] }],
          audioWindows: [{ startMs: 0, endMs: 1_000, rms: 0.1, peak: 0.2 }],
        };
      },
    });
    expect(calls).toEqual(['camera-a', 'mic-a']);
    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.report.createdAt).toBe(44);
    expect(result.report.summary).toMatchObject({ analyzedSources: 1, unavailableSources: 1, errors: 1 });
    expect(result.report.sourceResults.find((source) => source.sourceId === 'mic-a')?.message).toContain('audio decoder failed');
  });

  it('keeps a successful decoded side and the other side\'s bounded failure in the saved report', async () => {
    const result = await runVideoDecodedSignalQc({
      sources: [{ id: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' }],
      decoder: async (source) => ({
        id: source.id, label: source.label, kind: source.kind,
        frameSamples: [{ timeMs: 0, luma: 0.5, signature: [0.5] }],
        audioUnavailableReason: 'Media exceeds the 256 MiB browser QC limit.',
      }),
    });
    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.report.sourceResults[0]).toMatchObject({
      status: 'partial', decodedFrameSamples: 1, decodedAudioWindows: 0,
      message: expect.stringContaining('PCM audio unavailable'),
    });
    expect(result.report.summary).toMatchObject({ partialSources: 1, analyzedSources: 0, unavailableSources: 0 });
  });

  it('stops before persisting a partial report when cancellation occurs', async () => {
    const controller = new AbortController();
    const result = await runVideoDecodedSignalQc({
      sources: [{ id: 'camera-a', label: 'Camera A', kind: 'video' }],
      signal: controller.signal,
      decoder: async () => {
        controller.abort();
        return { id: 'camera-a', label: 'Camera A', kind: 'video', frameSamples: [{ timeMs: 0, luma: 0.5 }] };
      },
    });
    expect(result).toEqual({ cancelled: true });
  });

  it('does not decode over the source budget and retains a visible truncation finding', async () => {
    const result = await runVideoDecodedSignalQc({
      sources: Array.from({ length: MAX_DECODED_SIGNAL_QC_SOURCES + 1 }, (_, index) => ({ id: `source-${index}`, label: `Source ${index}`, kind: 'audio' as const })),
      decoder: async (source) => ({ id: source.id, label: source.label, kind: source.kind, audioWindows: [{ startMs: 0, endMs: 1_000, rms: 0.1, peak: 0.1 }] }),
    });
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.report.sourceResults).toHaveLength(MAX_DECODED_SIGNAL_QC_SOURCES);
      expect(result.report.issues.some((issue) => issue.code === 'input-truncated')).toBe(true);
    }
  });

  it('does not call duplicate source records a truncation', async () => {
    const result = await runVideoDecodedSignalQc({
      sources: [
        ...Array.from({ length: MAX_DECODED_SIGNAL_QC_SOURCES }, (_, index) => ({ id: `source-${index}`, label: `Source ${index}`, kind: 'audio' as const })),
        { id: 'source-0', label: 'Duplicate', kind: 'audio' },
      ],
      decoder: async (source) => ({ id: source.id, label: source.label, kind: source.kind, audioWindows: [{ startMs: 0, endMs: 1_000, rms: 0.1, peak: 0.1 }] }),
    });
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.report.truncated).toBe(false);
  });
});
