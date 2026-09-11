import { describe, expect, it } from 'vitest';
import {
  analyzeVideoStructuralQc,
  MAX_VIDEO_QC_SOURCES,
  VIDEO_STRUCTURAL_QC_DISCLAIMER,
  type VideoStructuralQcInput,
} from './videoStructuralQc';

function validProject(overrides: Partial<VideoStructuralQcInput> = {}): VideoStructuralQcInput {
  return {
    project: {
      durationFrames: 250,
      framesPerSecond: 25,
      workingColorSpace: 'rec709',
      deliveryColorSpace: 'rec709',
      compositionSignature: 'composition-v1',
      renderCacheSignature: 'composition-v1',
    },
    sources: [{
      id: 'source-a',
      onlineState: 'online',
      linkState: 'linked',
      durationFrames: 250,
      colorSpace: 'rec709',
      colorTransformState: 'configured',
    }],
    tracks: [{ id: 'v1', kind: 'video', continuity: 'continuous' }],
    clips: [{
      id: 'clip-a',
      trackId: 'v1',
      kind: 'video',
      startFrame: 0,
      durationFrames: 250,
      sourceId: 'source-a',
      sourceInFrame: 0,
      sourceOutFrame: 250,
    }],
    captions: [],
    features: [],
    ...overrides,
  };
}

describe('video structural QC', () => {
  it('reports a clean structural project without making decoded-signal claims', () => {
    const report = analyzeVideoStructuralQc(validProject());
    expect(report.scope).toBe('structural-only');
    expect(report.disclaimer).toBe(VIDEO_STRUCTURAL_QC_DISCLAIMER);
    expect(report.disclaimer).toContain('media was not decoded');
    expect(report.issues).toEqual([]);
    expect(report.summary).toEqual({ errors: 0, warnings: 0, info: 0, blocking: false });
  });

  it('finds offline, stale, unlinked, and absent media with navigable targets', () => {
    const report = analyzeVideoStructuralQc(validProject({
      sources: [
        { id: 'offline', onlineState: 'offline', linkState: 'linked' },
        { id: 'stale', onlineState: 'stale', linkState: 'unlinked' },
      ],
      tracks: [],
      clips: [
        { id: 'clip-offline', trackId: 'v1', kind: 'video', startFrame: 0, durationFrames: 25, sourceId: 'offline' },
        { id: 'clip-absent', trackId: 'v2', kind: 'audio', startFrame: 0, durationFrames: 25, sourceId: 'absent' },
        { id: 'clip-unlinked', trackId: 'v3', kind: 'video', startFrame: 0, durationFrames: 25 },
      ],
    }));

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'offline-source',
      'stale-source',
      'unlinked-source',
      'missing-clip-source',
      'missing-clip-source-id',
    ]));
    expect(report.issues.find((issue) => issue.code === 'missing-clip-source')?.navigation)
      .toMatchObject({ clipId: 'clip-absent', sourceId: 'absent', trackId: 'v2', frame: 0 });
    expect(report.summary.blocking).toBe(true);
  });

  it('checks invalid trims, track overlaps, and continuity gaps deterministically', () => {
    const input = validProject({
      project: { durationFrames: 100, framesPerSecond: 25 },
      sources: [{ id: 'source-a', onlineState: 'online', durationFrames: 80 }],
      tracks: [{ id: 'v1', kind: 'video', continuity: 'continuous' }],
      clips: [
        { id: 'clip-b', trackId: 'v1', kind: 'video', startFrame: 40, durationFrames: 20, sourceId: 'source-a', sourceInFrame: 70, sourceOutFrame: 90 },
        { id: 'clip-a', trackId: 'v1', kind: 'video', startFrame: 10, durationFrames: 40, sourceId: 'source-a', sourceInFrame: 0 },
      ],
    });
    const first = analyzeVideoStructuralQc(input);
    const second = analyzeVideoStructuralQc(input);

    expect(first).toEqual(second);
    expect(first.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid-source-trim',
      'source-trim-exceeds-media',
      'track-gap',
      'track-overlap',
    ]));
    expect(first.issues.find((issue) => issue.code === 'track-overlap')?.navigation)
      .toMatchObject({ clipId: 'clip-b', trackId: 'v1', frame: 40 });
  });

  it('reports unsupported/setup-only paths, stale cache, and unconfigured color transforms', () => {
    const report = analyzeVideoStructuralQc(validProject({
      project: {
        durationFrames: 250,
        framesPerSecond: 25,
        workingColorSpace: 'rec709',
        deliveryColorSpace: 'rec2020-pq',
        deliveryColorTransformState: 'setup-only',
        compositionSignature: 'current',
        renderCacheSignature: 'old',
      },
      sources: [{
        id: 'source-a',
        onlineState: 'online',
        colorSpace: 's-log3',
        colorTransformState: 'missing',
      }],
      clips: [{
        id: 'clip-a',
        trackId: 'v1',
        kind: 'video',
        startFrame: 0,
        durationFrames: 250,
        sourceId: 'source-a',
        unsupportedFeatures: ['Optical flow'],
        setupOnlyFeatures: ['Stabilization'],
      }],
      features: [{ id: 'nesting', label: 'Nested playback', status: 'setup-only', frame: 100 }],
    }));

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'stale-render-cache',
      'source-color-transform-missing',
      'delivery-color-mismatch',
      'unsupported-feature',
      'setup-only-feature',
    ]));
    expect(report.issues.find((issue) => issue.detail.includes('Optical flow'))?.severity).toBe('error');
    expect(report.issues.find((issue) => issue.detail.includes('Stabilization'))?.severity).toBe('warning');
  });

  it('checks caption overlap, line count, line length, reading speed, and ranges', () => {
    const report = analyzeVideoStructuralQc(validProject({
      captions: [
        { id: 'caption-a', trackId: 'cc1', startFrame: 0, endFrame: 25, text: 'This is a deliberately long caption line' },
        { id: 'caption-b', trackId: 'cc1', startFrame: 20, endFrame: 30, text: 'one\ntwo\nthree' },
        { id: 'caption-empty', trackId: 'cc1', startFrame: 40, endFrame: 50, text: '   ' },
        { id: 'caption-invalid', trackId: 'cc1', startFrame: 60, endFrame: 60, text: 'Invalid' },
      ],
      captionPolicy: { maxLines: 2, maxCharactersPerLine: 12, maxCharactersPerSecond: 10 },
    }));

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'caption-overlap',
      'caption-too-many-lines',
      'caption-line-too-long',
      'caption-reading-speed',
      'empty-caption',
      'invalid-caption-range',
    ]));
    expect(report.issues.find((issue) => issue.code === 'caption-overlap')?.navigation?.captionId).toBe('caption-b');
  });

  it('bounds oversized descriptor collections and makes truncation explicit', () => {
    const sources = Array.from({ length: MAX_VIDEO_QC_SOURCES + 1 }, (_, index) => ({
      id: `source-${String(index).padStart(5, '0')}`,
      onlineState: 'online' as const,
    }));
    const report = analyzeVideoStructuralQc(validProject({ sources }));
    expect(report.truncated).toBe(true);
    expect(report.inspected.sources).toBe(MAX_VIDEO_QC_SOURCES);
    expect(report.issues[0]).toMatchObject({ code: 'input-truncated', severity: 'error' });
  });
});
