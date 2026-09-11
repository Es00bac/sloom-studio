import { describe, expect, it } from 'vitest';
import {
  correlateMulticamAudioEnvelopes,
  describeMulticamLiveAnglePolicy,
  flattenMulticamSequence,
  getActiveMulticamAngleId,
  recordMulticamAngleCut,
  synchronizeMulticamAnglesByAudio,
  synchronizeMulticamAnglesByTimecode,
  synchronizeMulticamAnglesManual,
  type MulticamAngle,
  type MulticamSequence,
} from './videoMulticam';

const referenceEnvelope = Array.from({ length: 48 }, (_, index) => ((index * 17 + index * index * 3) % 31) / 31);

function angle(id: string, extra: Partial<MulticamAngle> = {}): MulticamAngle {
  return {
    id,
    label: id.toUpperCase(),
    sourceId: `source-${id}`,
    durationFrames: 300,
    syncOffsetFrames: 0,
    ...extra,
  };
}

function sequence(): MulticamSequence {
  return {
    id: 'concert',
    frameRate: 30,
    durationFrames: 120,
    angles: [angle('a'), angle('b'), angle('c')],
    cuts: [{ id: 'opening', timelineFrame: 0, angleId: 'a' }],
  };
}

describe('video multicam', () => {
  it('audio-envelope sync resolves synthetic offsets to within exactly one frame', () => {
    const oneFrameLate = [0, ...referenceEnvelope.slice(0, -1)];
    const oneFrameEarly = [...referenceEnvelope.slice(1), 0];
    expect(correlateMulticamAudioEnvelopes(referenceEnvelope, oneFrameLate, 4)).toMatchObject({
      lagFrames: 1,
      targetSyncOffsetFrames: -1,
    });
    expect(correlateMulticamAudioEnvelopes(referenceEnvelope, oneFrameEarly, 4)).toMatchObject({
      lagFrames: -1,
      targetSyncOffsetFrames: 1,
    });
    const synced = synchronizeMulticamAnglesByAudio([
      angle('a', { audioEnvelope: referenceEnvelope }),
      angle('b', { audioEnvelope: oneFrameLate }),
    ], 'a', 4);
    expect(synced.angles.map((item) => item.syncOffsetFrames)).toEqual([0, -1]);
    expect(synced.diagnostics[1]?.score).toBeGreaterThan(0.99);
  });

  it('bounds cross-correlation lag and rejects unusable envelopes', () => {
    const delayed = [...Array.from({ length: 8 }, () => 0), ...referenceEnvelope];
    expect(Math.abs(correlateMulticamAudioEnvelopes(referenceEnvelope, delayed, 2).lagFrames)).toBeLessThanOrEqual(2);
    expect(() => correlateMulticamAudioEnvelopes([1, 2], [1, 2], 2)).toThrow('at least three');
  });

  it('supports explicit manual and deterministic timecode synchronization', () => {
    const angles = [
      angle('a', { timecodeStartFrame: 10_000 }),
      angle('b', { timecodeStartFrame: 10_030 }),
    ];
    expect(synchronizeMulticamAnglesByTimecode(angles).angles.map((item) => item.syncOffsetFrames)).toEqual([0, 30]);
    expect(synchronizeMulticamAnglesManual(angles, { a: -7, b: 12 }).angles.map((item) => item.syncOffsetFrames)).toEqual([-7, 12]);
    expect(angles.map((item) => item.syncOffsetFrames)).toEqual([0, 0]);
  });

  it('records/splits angle cuts and finds the active angle at any frame', () => {
    let multicam = sequence();
    multicam = recordMulticamAngleCut(multicam, 30, 'b');
    multicam = recordMulticamAngleCut(multicam, 60, 'c');
    multicam = recordMulticamAngleCut(multicam, 90, 'a');
    expect([0, 29, 30, 59, 60, 119].map((frame) => getActiveMulticamAngleId(multicam, frame)))
      .toEqual(['a', 'a', 'b', 'b', 'c', 'a']);
    const replaced = recordMulticamAngleCut(multicam, 60, 'b');
    expect(replaced.cuts.filter((cut) => cut.timelineFrame === 60)).toEqual([]);
    expect(getActiveMulticamAngleId(replaced, 75)).toBe('b');
  });

  it('flattens angle cuts into deterministic ordinary clips with source alignment', () => {
    const multicam: MulticamSequence = {
      ...sequence(),
      angles: [
        angle('a', { syncOffsetFrames: -5 }),
        angle('b', { syncOffsetFrames: 35 }),
        angle('c', { syncOffsetFrames: 0 }),
      ],
      cuts: [
        { id: 'cut-a', timelineFrame: 0, angleId: 'a' },
        { id: 'cut-b', timelineFrame: 30, angleId: 'b' },
        { id: 'cut-c', timelineFrame: 70, angleId: 'c' },
      ],
    };
    expect(flattenMulticamSequence(multicam, 'v1')).toEqual([
      { id: 'concert:cut-a', sourceId: 'source-a', angleId: 'a', trackId: 'v1', startFrame: 0, durationFrames: 30, sourceInFrame: 5 },
      { id: 'concert:cut-b', sourceId: 'source-b', angleId: 'b', trackId: 'v1', startFrame: 35, durationFrames: 35, sourceInFrame: 0 },
      { id: 'concert:cut-c', sourceId: 'source-c', angleId: 'c', trackId: 'v1', startFrame: 70, durationFrames: 50, sourceInFrame: 70 },
    ]);
  });

  it('describes bounded live-angle decoding policies', () => {
    expect(describeMulticamLiveAnglePolicy(4)).toMatchObject({ mode: 'full-resolution', liveAngleCount: 4, requiresProxies: false });
    expect(describeMulticamLiveAnglePolicy(9)).toMatchObject({ mode: 'proxy-grid', liveAngleCount: 9, requiresProxies: true });
    expect(describeMulticamLiveAnglePolicy(16)).toMatchObject({ mode: 'thumbnail-grid', liveAngleCount: 16 });
    expect(describeMulticamLiveAnglePolicy(48)).toMatchObject({ mode: 'select-live-angles', liveAngleCount: 16 });
  });
});
