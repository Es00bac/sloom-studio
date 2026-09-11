import { describe, expect, it } from 'vitest';
import {
  analyzeVideoCaptionQc,
  createVideoCaptionDocument,
  findReplaceVideoCaptions,
  mergeVideoCaptionCues,
  parseVideoCaptionDocument,
  projectVideoCaptionsToTextClips,
  rippleVideoCaptionCues,
  serializeVideoCaptionDocument,
  splitVideoCaptionCue,
  VIDEO_CAPTION_UNAVAILABLE_DELIVERIES,
} from './videoCaptionAuthoring';

const document = createVideoCaptionDocument({
  id: 'captions-1',
  language: 'en-US',
  cues: [
    { id: 'c1', startMs: 0, endMs: 2_000, text: 'Hello brave world', speaker: 'A' },
    { id: 'c2', startMs: 2_100, endMs: 4_000, text: 'Second line', position: { xPercent: 50, yPercent: 85, anchor: 'bottom' } },
  ],
});

describe('semantic video caption authoring', () => {
  it('splits, merges, and ripples cues without changing source media', () => {
    const split = splitVideoCaptionCue(document, 'c1', 1_000, 'c1b', 6);
    expect(split.cues.slice(0, 2)).toMatchObject([
      { id: 'c1', startMs: 0, endMs: 1_000, text: 'Hello' },
      { id: 'c1b', startMs: 1_000, endMs: 2_000, text: 'brave world' },
    ]);
    const merged = mergeVideoCaptionCues(split, 'c1', 'c1b');
    expect(merged.cues[0]).toMatchObject({ id: 'c1', startMs: 0, endMs: 2_000, text: 'Hello brave world' });
    const rippled = rippleVideoCaptionCues(merged, 2_000, 500);
    expect(rippled.cues[1]).toMatchObject({ startMs: 2_600, endMs: 4_500 });
    expect(document.cues[1].startMs).toBe(2_100);
  });

  it('finds and replaces literal caption text with case and word controls', () => {
    const result = findReplaceVideoCaptions(document, 'line', 'caption', { wholeWord: true });
    expect(result.replacementCount).toBe(1);
    expect(result.changedCueIds).toEqual(['c2']);
    expect(result.document.cues[1].text).toBe('Second caption');
  });

  it('reports reading speed, line, overlap, short-gap, and safe-area issues', () => {
    const qcDocument = createVideoCaptionDocument({ id: 'qc', cues: [
      { id: 'a', startMs: 0, endMs: 500, text: 'This line is much too long for the configured reading speed and line length' },
      { id: 'b', startMs: 450, endMs: 1_000, text: 'Overlap', position: { xPercent: 99, yPercent: 99, anchor: 'bottom' } },
      { id: 'c', startMs: 1_050, endMs: 2_000, text: 'Short gap' },
    ] });
    const codes = analyzeVideoCaptionQc(qcDocument, { maxCharactersPerSecond: 20, maxCharactersPerLine: 42, minimumGapMs: 80 }).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['cps', 'line-length', 'overlap', 'gap', 'unsafe-position']));
  });

  it('round-trips the bounded TTML text/style/position subset', () => {
    const ttml = serializeVideoCaptionDocument(document, 'ttml');
    const parsed = parseVideoCaptionDocument(ttml.data, 'ttml', { id: 'roundtrip' });
    expect(ttml.warnings[0]).toMatch(/bounded/);
    expect(parsed.language).toBe('en-US');
    expect(parsed.cues).toMatchObject([
      { id: 'c1', startMs: 0, endMs: 2_000, text: 'Hello brave world', speaker: 'A' },
      { id: 'c2', startMs: 2_100, endMs: 4_000, text: 'Second line', position: { xPercent: 50, yPercent: 85 } },
    ]);
    expect(VIDEO_CAPTION_UNAVAILABLE_DELIVERIES).toContain('cea-708');
    expect(VIDEO_CAPTION_UNAVAILABLE_DELIVERIES).not.toContain('embedded-caption-mux');
  });

  it('retains SRT/VTT support while warning about semantic metadata loss', () => {
    const srt = serializeVideoCaptionDocument(document, 'srt');
    const parsed = parseVideoCaptionDocument(srt.data, 'srt', { id: 'from-srt', language: 'en-US' });
    expect(srt.fileExtension).toBe('.srt');
    expect(srt.warnings).toHaveLength(1);
    expect(parsed.cues.map((cue) => cue.text)).toEqual(['Hello brave world', 'Second line']);
  });

  it('projects semantic cues into deterministic existing editor text clips', () => {
    const first = projectVideoCaptionsToTextClips(document, { trackIndex: 5 });
    const second = projectVideoCaptionsToTextClips(document, { trackIndex: 5 });
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      id: 'caption-c1', sourceKind: 'text', trackIndex: 5, startMs: 0,
      durationSeconds: 2, textContent: 'Hello brave world', textTypography: { fontWeight: 600, textAlign: 'center' },
    });
  });
});
