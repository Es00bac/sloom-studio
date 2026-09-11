import { describe, expect, it } from 'vitest';
import {
  MAX_DECODED_SIGNAL_QC_SOURCES,
  VIDEO_DECODED_SIGNAL_QC_DISCLAIMER,
  analyzeVideoDecodedSignalQc,
  sanitizeVideoDecodedSignalQcReport,
  summarizeDecodedVideoFrame,
} from './videoDecodedSignalQc';

describe('decoded-signal QC analysis', () => {
  it('reports sampled black, frozen, silent, and clipped intervals with source navigation', () => {
    const report = analyzeVideoDecodedSignalQc({
      compositionSignature: 'sequence-a',
      createdAt: 123,
      sources: [{
        id: 'camera-a', label: 'Camera A', kind: 'video', durationMs: 3_000,
        frameSamples: [
          { timeMs: 0, luma: 0, signature: [0, 0] },
          { timeMs: 600, luma: 0, signature: [0, 0] },
          { timeMs: 1_200, luma: 0.5, signature: [0.5, 0.5] },
          { timeMs: 1_800, luma: 0.5, signature: [0.5, 0.5] },
          { timeMs: 3_000, luma: 0.5, signature: [0.5, 0.5] },
        ],
        audioWindows: [
          { startMs: 0, endMs: 500, rms: 0, peak: 0 },
          { startMs: 500, endMs: 1_000, rms: 0, peak: 0 },
          { startMs: 1_000, endMs: 1_500, rms: 0.1, peak: 1 },
        ],
      }],
    });

    expect(report.scope).toBe('decoded-sampled');
    expect(report.disclaimer).toBe(VIDEO_DECODED_SIGNAL_QC_DISCLAIMER);
    expect(report.compositionSignature).toBe('sequence-a');
    expect(report.createdAt).toBe(123);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'black-frame-run', 'frozen-frame-run', 'silent-audio-run', 'audio-clipping',
    ]));
    expect(report.issues.every((issue) => issue.navigation.sourceId === 'camera-a')).toBe(true);
    expect(report.summary).toMatchObject({ errors: 1, warnings: 3, blocking: true, analyzedSources: 1, unavailableSources: 0 });
  });

  it('makes unavailable decoder inputs and source-count truncation visible errors', () => {
    const report = analyzeVideoDecodedSignalQc({
      sources: Array.from({ length: MAX_DECODED_SIGNAL_QC_SOURCES + 1 }, (_, index) => ({
        id: `source-${index}`, label: `Source ${index}`, kind: 'audio' as const,
        unavailableReason: index === 0 ? 'CORS prevented browser decoding.' : undefined,
      })),
    });
    expect(report.truncated).toBe(true);
    expect(report.sourceResults).toHaveLength(MAX_DECODED_SIGNAL_QC_SOURCES);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['input-truncated', 'source-unavailable']));
    expect(report.summary.unavailableSources).toBe(MAX_DECODED_SIGNAL_QC_SOURCES);
  });

  it('persists a failed frame or PCM side as a partial source instead of calling it analyzed', () => {
    const report = analyzeVideoDecodedSignalQc({
      sources: [{
        id: 'camera-a', label: 'Camera A', kind: 'video',
        frameSamples: [{ timeMs: 0, luma: 0.5, signature: [0.5] }],
        audioUnavailableReason: 'Media exceeds the 256 MiB browser QC limit.',
      }],
    });

    expect(report.sourceResults).toEqual([expect.objectContaining({
      sourceId: 'camera-a', status: 'partial', decodedFrameSamples: 1, decodedAudioWindows: 0,
      message: expect.stringContaining('PCM audio unavailable'),
    })]);
    expect(report.summary).toMatchObject({ analyzedSources: 0, partialSources: 1, unavailableSources: 0, blocking: true });
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'source-unavailable', title: 'Source was only partially decoded for QC',
    })]));
  });

  it('derives deterministic compact luma signatures from decoded pixel data', () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const summary = summarizeDecodedVideoFrame(pixels, 2, 2);
    expect(summary.luma).toBeCloseTo((0 + 1 + 0.2126 + 0.7152) / 4, 5);
    expect(summary.signature).toHaveLength(64);
    expect(summary.signature?.some((value) => value > 0)).toBe(true);
  });

  it('sanitizes persisted reports, recomputes summaries, and refuses malformed reports', () => {
    const sanitized = sanitizeVideoDecodedSignalQcReport({
      scope: 'decoded-sampled',
      sourceResults: [{
        sourceId: 'camera-a', label: ' Camera A ', kind: 'video', status: 'analyzed',
        decodedFrameSamples: 999, decodedAudioWindows: 999,
      }],
      issues: [{
        id: 'issue-a', code: 'audio-clipping', severity: 'error', title: 'Clipped', detail: 'Peak',
        navigation: { sourceId: 'camera-a', timeMs: 42 },
      }],
      summary: { errors: 0 },
      createdAt: 7,
    });
    expect(sanitized).toMatchObject({
      createdAt: 7,
      sourceResults: [{ decodedFrameSamples: 120, decodedAudioWindows: 256 }],
      summary: { errors: 1, blocking: true },
    });
    expect(sanitizeVideoDecodedSignalQcReport({ scope: 'structural-only' })).toBeUndefined();
  });

  it('retains the durable partial status and bounded source reason when reopening a report', () => {
    const sanitized = sanitizeVideoDecodedSignalQcReport({
      scope: 'decoded-sampled', createdAt: 8,
      sourceResults: [{
        sourceId: 'camera-a', label: 'Camera A', kind: 'video', status: 'partial',
        decodedFrameSamples: 1, decodedAudioWindows: 0,
        message: 'PCM audio unavailable: Media exceeds the 256 MiB browser QC limit.',
      }],
      issues: [{
        id: 'partial-audio', code: 'source-unavailable', severity: 'error', title: 'Partial', detail: 'PCM audio unavailable',
        navigation: { sourceId: 'camera-a' },
      }],
    });
    expect(sanitized?.sourceResults).toEqual([expect.objectContaining({ status: 'partial', message: expect.stringContaining('PCM audio unavailable') })]);
    expect(sanitized?.summary).toMatchObject({ partialSources: 1, analyzedSources: 0, unavailableSources: 0, blocking: true });
  });
});
