import { describe, expect, it } from 'vitest';
import {
  conformMixedRateFrames,
  convertFramesBetweenTimebases,
  createVideoTimebase,
  createVideoTimecodeContext,
  formatVideoTimecode,
  framesToSeconds,
  getKnownVideoTimebase,
  mapRecordFrameToSourceFrame,
  mapSourceFrameToRecordFrame,
  parseVideoTimecode,
  projectLegacyFrameRateToVideoTimebase,
  projectVideoTimebaseToLegacyFrameRate,
  recordTimecodeToTimelineFrame,
  secondsToFrames,
  timelineFrameToRecordTimecode,
  videoTimebaseEquals,
} from './videoTimebase';

describe('video rational timebase', () => {
  it('retains exact NTSC rationals while projecting legacy numeric rates', () => {
    const film = getKnownVideoTimebase('23.976');
    const ntsc = getKnownVideoTimebase('29.97-df');
    const high = getKnownVideoTimebase('59.94-df');

    expect(film).toMatchObject({ numerator: 24_000, denominator: 1_001, nominalFps: 24 });
    expect(ntsc).toMatchObject({ numerator: 30_000, denominator: 1_001, nominalFps: 30, dropFrame: true });
    expect(high).toMatchObject({ numerator: 60_000, denominator: 1_001, nominalFps: 60, dropFrame: true });
    expect(projectVideoTimebaseToLegacyFrameRate(film)).toBe(23.976);
    expect(projectVideoTimebaseToLegacyFrameRate(ntsc)).toBe(29.97);
    expect(videoTimebaseEquals(projectLegacyFrameRateToVideoTimebase(59.94, { dropFrame: true }), high)).toBe(true);
  });

  it('normalizes rational components and rejects invalid drop-frame rates', () => {
    expect(createVideoTimebase({ numerator: 48_000, denominator: 2_002, nominalFps: 24, dropFrame: false }))
      .toEqual(getKnownVideoTimebase('23.976'));
    expect(() => createVideoTimebase({ numerator: 24_000, denominator: 1_001, nominalFps: 24, dropFrame: true }))
      .toThrow(/supported only/);
    expect(() => projectLegacyFrameRateToVideoTimebase(24, { dropFrame: true })).toThrow(/requires 29.97 or 59.94/);
  });

  it('converts frame durations without replacing rational math with decimal rates', () => {
    const source = getKnownVideoTimebase('23.976');
    const record = getKnownVideoTimebase('24');
    expect(framesToSeconds(24_000, source)).toBe(1_001);
    expect(secondsToFrames(1_001, source)).toBe(24_000);
    expect(convertFramesBetweenTimebases(24_000, source, record)).toBe(24_024);
  });
});

describe('video timecode', () => {
  it('formats and parses 29.97 drop-frame minute and ten-minute boundaries', () => {
    const timebase = getKnownVideoTimebase('29.97-df');
    expect(formatVideoTimecode(0, timebase)).toBe('00:00:00;00');
    expect(formatVideoTimecode(1_800, timebase)).toBe('00:01:00;02');
    expect(formatVideoTimecode(17_982, timebase)).toBe('00:10:00;00');
    expect(parseVideoTimecode('00:01:00;02', timebase)).toBe(1_800);
    expect(parseVideoTimecode('00:10:00;00', timebase)).toBe(17_982);
    expect(() => parseVideoTimecode('00:01:00;00', timebase)).toThrow(/omitted/);
    expect(() => parseVideoTimecode('00:01:00:02', timebase)).toThrow(/semicolon/);
  });

  it('formats and parses 59.94 drop-frame boundaries', () => {
    const timebase = getKnownVideoTimebase('59.94-df');
    expect(formatVideoTimecode(3_600, timebase)).toBe('00:01:00;04');
    expect(formatVideoTimecode(35_964, timebase)).toBe('00:10:00;00');
    expect(parseVideoTimecode('00:01:00;04', timebase)).toBe(3_600);
    expect(() => parseVideoTimecode('00:01:00;03', timebase)).toThrow(/omitted/);
  });

  it('supports sequence start timecode and record/timeline conversion', () => {
    const context = createVideoTimecodeContext({
      timebase: getKnownVideoTimebase('24'),
      startTimecode: '01:00:00:00',
    });
    expect(timelineFrameToRecordTimecode(240, context)).toBe('01:00:10:00');
    expect(recordTimecodeToTimelineFrame('01:00:10:00', context)).toBe(240);
  });

  it('round-trips a representative bounded day at both drop-frame rates', () => {
    for (const id of ['29.97-df', '59.94-df'] as const) {
      const timebase = getKnownVideoTimebase(id);
      for (const frame of [0, 1, 1_797, 1_798, 17_981, 17_982, 107_891, 1_000_000]) {
        expect(parseVideoTimecode(formatVideoTimecode(frame, timebase), timebase)).toBe(frame);
      }
    }
  });
});

describe('mixed-rate source and record mapping', () => {
  it('preserves elapsed time by default and provides an inverse mapping', () => {
    const mapping = {
      sourceTimebase: getKnownVideoTimebase('23.976'),
      recordTimebase: getKnownVideoTimebase('24'),
      sourceStartFrame: 100,
      recordStartFrame: 86_400,
    };
    const recordFrame = mapSourceFrameToRecordFrame(24_100, mapping);
    expect(recordFrame).toBe(110_424);
    expect(mapRecordFrameToSourceFrame(recordFrame, mapping)).toBe(24_100);
  });

  it('supports explicit frame-number preservation and mixed-rate rejection', () => {
    const source = getKnownVideoTimebase('25');
    const record = getKnownVideoTimebase('30');
    expect(conformMixedRateFrames({
      sourceFrames: 250,
      sourceTimebase: source,
      recordTimebase: record,
      policy: 'preserve-time',
    })).toMatchObject({ recordFrames: 300, rateChanged: true });
    expect(conformMixedRateFrames({
      sourceFrames: 250,
      sourceTimebase: source,
      recordTimebase: record,
      policy: 'preserve-frame-number',
    }).recordFrames).toBe(250);
    expect(() => conformMixedRateFrames({
      sourceFrames: 250,
      sourceTimebase: source,
      recordTimebase: record,
      policy: 'reject',
    })).toThrow(/rejected/);
  });
});
