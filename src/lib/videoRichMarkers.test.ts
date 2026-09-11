import { describe, expect, it, vi } from 'vitest';
import {
  exportVideoRichMarkersCsv,
  exportVideoRichMarkersJson,
  importVideoRichMarkersCsv,
  importVideoRichMarkersJson,
  MAX_VIDEO_MARKER_IMPORT_BYTES,
  MAX_VIDEO_RICH_MARKER_ID_CHARACTERS,
  MAX_VIDEO_RICH_MARKER_TIME_MS,
  MAX_VIDEO_RICH_MARKERS,
  MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS,
  navigateVideoRichMarkers,
  normalizeVideoRichMarkers,
  readVideoRichMarkerImportFile,
  reviewVideoRichMarkerImport,
  timelineMarkerToVideoRichMarker,
  upsertVideoRichMarker,
  VIDEO_RICH_MARKERS_VERSION,
  videoRichMarkerToTimelineMarker,
  type VideoRichMarker,
} from './videoRichMarkers';

const marker = (id: string, timeMs: number): VideoRichMarker => ({
  id, name: `Marker ${id}`, notes: '', kind: 'comment', color: '#22d3ee',
  target: { kind: 'point', timeMs }, createdAt: timeMs, updatedAt: timeMs,
});

describe('Video rich markers', () => {
  it('supports point, range, and clip targets with deterministic binary navigation', () => {
    const markers = [
      marker('later', 3_000),
      { ...marker('range', 1_000), target: { kind: 'range' as const, startMs: 1_000, endMs: 2_000 } },
      { ...marker('clip', 2_000), target: { kind: 'clip' as const, clipId: 'clip-a', timeMs: 2_000 } },
    ];
    expect(navigateVideoRichMarkers(markers, 1_500, 'next')?.id).toBe('clip');
    expect(navigateVideoRichMarkers(markers, 2_000, 'previous')?.id).toBe('range');
    expect(navigateVideoRichMarkers(markers, 3_000, 'next', true)?.id).toBe('range');
  });

  it('round-trips bounded JSON and spreadsheet-safe CSV', () => {
    const values = [{
      ...marker('one', 1_000),
      name: '=FORMULA',
      notes: 'Use "alt", then review',
      kind: 'review' as const,
      color: '#aabbcc',
      target: { kind: 'range' as const, startMs: 1_000, endMs: 2_500 },
      createdAt: 123,
      updatedAt: 456,
    }];
    const json = importVideoRichMarkersJson(exportVideoRichMarkersJson('sequence-a', values));
    const csv = exportVideoRichMarkersCsv(values);
    const csvRoundTrip = importVideoRichMarkersCsv(csv);
    expect(json).toMatchObject({ sequenceId: 'sequence-a', markers: values });
    expect(csv).toContain("'=FORMULA");
    expect(csv).toContain('"Use ""alt"", then review"');
    expect(csvRoundTrip.markers).toEqual(values);
  });

  it('preserves every legacy marker kind through JSON and CSV without downgrading review or export', () => {
    const kinds: VideoRichMarker['kind'][] = ['comment', 'chapter', 'review', 'sync', 'export', 'edit', 'qc'];
    const values = kinds.map((kind, index) => ({ ...marker(kind, index * 1_000), kind }));
    expect(importVideoRichMarkersJson(exportVideoRichMarkersJson('sequence-a', values)).markers.map((item) => item.kind)).toEqual(kinds);
    expect(importVideoRichMarkersCsv(exportVideoRichMarkersCsv(values)).markers.map((item) => item.kind)).toEqual(kinds);
  });

  it('drops invalid rows, deduplicates IDs, and enforces the 20k cap', () => {
    const values = [marker('one', 1), marker('one', 2), { ...marker('bad', 3), target: { kind: 'range', startMs: 10, endMs: 5 } }];
    expect(normalizeVideoRichMarkers(values)).toMatchObject({ markers: [{ id: 'one' }], droppedRows: 2, truncatedRows: 0 });
    const many = Array.from({ length: MAX_VIDEO_RICH_MARKERS + 2 }, (_, index) => marker(`m-${index}`, index));
    expect(normalizeVideoRichMarkers(many)).toMatchObject({ truncated: true, truncatedRows: 2 });
    expect(normalizeVideoRichMarkers(many).markers).toHaveLength(MAX_VIDEO_RICH_MARKERS);
    expect(() => upsertVideoRichMarker(many.slice(0, MAX_VIDEO_RICH_MARKERS), marker('overflow', 99))).toThrow('20,000');
  });

  it('rejects missing and unsupported JSON versions before accepting replacement data', () => {
    expect(() => importVideoRichMarkersJson(JSON.stringify({ sequenceId: 'sequence-a', markers: [] }))).toThrow('version missing is unsupported');
    expect(() => importVideoRichMarkersJson(JSON.stringify({ version: 2, sequenceId: 'sequence-a', markers: [] }))).toThrow('version 2 is unsupported');
  });

  it('rejects missing or non-array JSON marker collections instead of returning a clean empty replacement', () => {
    expect(() => importVideoRichMarkersJson(JSON.stringify({ version: 1, sequenceId: 'active' }))).toThrow('markers must be an array');
    expect(() => importVideoRichMarkersJson(JSON.stringify({ version: 1, sequenceId: 'active', markers: {} }))).toThrow('markers must be an array');
  });

  it('bounds sequence IDs to the canonical project identifier length', () => {
    const maximum = 's'.repeat(MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS);
    expect(importVideoRichMarkersJson(JSON.stringify({ version: 1, sequenceId: ` ${maximum} `, markers: [] })).sequenceId).toBe(maximum);
    expect(() => importVideoRichMarkersJson(JSON.stringify({
      version: 1,
      sequenceId: 's'.repeat(MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS + 1),
      markers: [],
    }))).toThrow(`${MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS} characters or fewer`);
    expect(() => exportVideoRichMarkersJson('s'.repeat(MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS + 1), [])).toThrow('characters or fewer');
  });

  it('requires an explicit import decision for sequence mismatch, rejected rows, or truncation', () => {
    const review = reviewVideoRichMarkerImport({
      markers: [marker('accepted', 1_000)],
      droppedRows: 2,
      truncatedRows: 3,
      truncated: true,
    }, {
      importedSequenceId: 'sequence-other',
      expectedSequenceId: 'sequence-active',
    });

    expect(review.requiresConfirmation).toBe(true);
    expect(review.issues).toHaveLength(3);
    expect(review.message).toContain('sequence-other');
    expect(review.message).toContain('2 invalid or duplicate marker rows were rejected');
    expect(review.message).toContain('3 marker rows exceed the 20,000 marker capacity');
    expect(review.message).toContain('replace the active sequence marker set with the 1 accepted marker');
    expect(reviewVideoRichMarkerImport({ markers: [], droppedRows: 0, truncatedRows: 0, truncated: false }).requiresConfirmation).toBe(false);
  });

  it('clamps finite target times to the shared project bound and rejects non-finite targets', () => {
    const normalized = normalizeVideoRichMarkers([
      marker('negative', -5),
      marker('late', MAX_VIDEO_RICH_MARKER_TIME_MS + 1),
      marker('infinite', Number.POSITIVE_INFINITY),
    ]);

    expect(normalized.markers.map((value) => [value.id, value.target])).toEqual([
      ['negative', { kind: 'point', timeMs: 0 }],
      ['late', { kind: 'point', timeMs: MAX_VIDEO_RICH_MARKER_TIME_MS }],
    ]);
    expect(normalized.droppedRows).toBe(1);
  });

  it('reports out-of-project-range JSON and CSV timestamps as rejected import rows', () => {
    const invalid = marker('outside-project', MAX_VIDEO_RICH_MARKER_TIME_MS + 1);
    const json = importVideoRichMarkersJson(JSON.stringify({ version: 1, sequenceId: 'sequence-a', markers: [invalid] }));
    const csv = importVideoRichMarkersCsv([
      'id,name,notes,kind,color,target,start_ms,end_ms,clip_id,created_at,updated_at',
      `outside-project,Outside,,comment,#22d3ee,point,${MAX_VIDEO_RICH_MARKER_TIME_MS + 1},,,1,1`,
    ].join('\n'));

    expect(json).toMatchObject({ markers: [], droppedRows: 1 });
    expect(csv).toMatchObject({ markers: [], droppedRows: 1 });
    expect(reviewVideoRichMarkerImport(json).requiresConfirmation).toBe(true);
    expect(reviewVideoRichMarkerImport(csv).message).toContain('1 invalid or duplicate marker row was rejected');
  });

  it('counts blank required CSV times and unknown target kinds as rejected rows requiring review', () => {
    expect(() => importVideoRichMarkersCsv('')).toThrow('header row');
    const imported = importVideoRichMarkersCsv([
      'id,name,notes,kind,color,target,start_ms,end_ms,clip_id,created_at,updated_at',
      'valid,Valid,,comment,#22d3ee,point,1000,,,1,1',
      'blank-time,Blank,,comment,#22d3ee,point,,,,1,1',
      'unknown-target,Unknown,,comment,#22d3ee,mystery,2000,,,1,1',
    ].join('\n'));

    expect(imported.markers.map((value) => [value.id, value.target])).toEqual([
      ['valid', { kind: 'point', timeMs: 1_000 }],
    ]);
    expect(imported.droppedRows).toBe(2);
    const review = reviewVideoRichMarkerImport(imported);
    expect(review.requiresConfirmation).toBe(true);
    expect(review.message).toContain('2 invalid or duplicate marker rows were rejected');
  });

  it('deduplicates imported IDs after the same 128-character project normalization and bounds clip IDs identically', () => {
    const shared = 'x'.repeat(MAX_VIDEO_RICH_MARKER_ID_CHARACTERS);
    const imported = importVideoRichMarkersJson(JSON.stringify({
      version: 1,
      sequenceId: 'sequence-a',
      markers: [
        marker(`${shared}a`, 1_000),
        marker(`${shared}b`, 2_000),
        {
          ...marker('clip-marker', 3_000),
          target: { kind: 'clip', clipId: `${'c'.repeat(MAX_VIDEO_RICH_MARKER_ID_CHARACTERS)}overflow`, timeMs: 3_000 },
        },
      ],
    }));

    expect(imported.droppedRows).toBe(1);
    expect(imported.markers.find((value) => value.id === shared)).toBeDefined();
    expect(imported.markers.find((value) => value.id === 'clip-marker')?.target).toEqual({
      kind: 'clip',
      clipId: 'c'.repeat(MAX_VIDEO_RICH_MARKER_ID_CHARACTERS),
      timeMs: 3_000,
    });
    expect(reviewVideoRichMarkerImport(imported).requiresConfirmation).toBe(true);
  });

  it('protects and exactly round-trips formula-leading id, name, notes, and clip_id CSV fields', () => {
    const prefixes = ['=', '+', '-', '@'];
    const values: VideoRichMarker[] = prefixes.map((prefix, index) => ({
      ...marker(`${prefix}marker`, index * 1_000),
      name: `${prefix}name`,
      notes: `${prefix}notes`,
      target: { kind: 'clip', clipId: `${prefix}clip`, timeMs: index * 1_000 },
    }));
    const csv = exportVideoRichMarkersCsv(values);

    for (const prefix of prefixes) {
      expect(csv).toContain(`"'${prefix}marker"`);
      expect(csv).toContain(`"'${prefix}name"`);
      expect(csv).toContain(`"'${prefix}notes"`);
      expect(csv).toContain(`"'${prefix}clip"`);
    }
    expect(importVideoRichMarkersCsv(csv).markers).toEqual(values);
  });

  it('rejects oversized marker files before reading their text payload', async () => {
    const text = vi.fn().mockResolvedValue('must not allocate');

    await expect(readVideoRichMarkerImportFile({ size: MAX_VIDEO_MARKER_IMPORT_BYTES + 1, text })).rejects.toThrow('bytes or smaller');
    expect(text).not.toHaveBeenCalled();
    await expect(readVideoRichMarkerImportFile({ size: 2, text })).resolves.toBe('must not allocate');
    expect(text).toHaveBeenCalledOnce();
  });

  it('preserves labels, colors, kinds, notes, ranges, clip ids, and timestamps across the legacy bridge', () => {
    const timelineMarker = {
      id: 'range-review',
      seconds: 1.25,
      endSeconds: 3.75,
      label: 'Client range',
      color: '#aabbcc',
      kind: 'review' as const,
      notes: 'Keep every field',
      createdAt: 101,
      updatedAt: 202,
    };

    expect(videoRichMarkerToTimelineMarker(timelineMarkerToVideoRichMarker(timelineMarker))).toEqual(timelineMarker);

    const clipMarker = {
      ...timelineMarker,
      id: 'clip-sync',
      endSeconds: undefined,
      clipId: 'clip-a',
      kind: 'sync' as const,
    };
    expect(videoRichMarkerToTimelineMarker(timelineMarkerToVideoRichMarker(clipMarker))).toEqual(clipMarker);
  });

  it('round-trips clip-relative offsets through the legacy bridge, JSON, and CSV exchange', () => {
    const clipMarker = {
      id: 'clip-sync',
      seconds: 4.25,
      label: 'Anchored',
      color: '#aabbcc',
      kind: 'sync' as const,
      notes: 'Offset survives exchange',
      clipId: 'clip-a',
      clipOffsetMs: 1_250,
      createdAt: 101,
      updatedAt: 202,
    };

    expect(videoRichMarkerToTimelineMarker(timelineMarkerToVideoRichMarker(clipMarker))).toEqual(clipMarker);

    const exported = exportVideoRichMarkersJson('sequence-1', [timelineMarkerToVideoRichMarker(clipMarker)]);
    expect(importVideoRichMarkersJson(exported).markers[0]).toMatchObject({
      id: 'clip-sync',
      target: { kind: 'clip', clipId: 'clip-a', timeMs: 4_250, offsetMs: 1_250 },
    });

    const csv = exportVideoRichMarkersCsv([timelineMarkerToVideoRichMarker(clipMarker)]);
    expect(csv.split('\n')[0]).toContain('clip_offset_ms');
    expect(importVideoRichMarkersCsv(csv).markers[0]).toMatchObject({
      id: 'clip-sync',
      target: { kind: 'clip', clipId: 'clip-a', timeMs: 4_250, offsetMs: 1_250 },
    });
  });

  it('fails closed on out-of-range or non-finite clip offsets while clamping authored data', () => {
    const base = {
      id: 'clip-sync',
      name: 'Anchored',
      notes: '',
      kind: 'sync' as const,
      color: '#aabbcc',
      createdAt: 1,
      updatedAt: 2,
    };
    // Authored/project data clamps finite offsets to the shared 12-hour ceiling.
    expect(normalizeVideoRichMarkers([{
      ...base,
      target: { kind: 'clip', clipId: 'clip-a', timeMs: 1_000, offsetMs: MAX_VIDEO_RICH_MARKER_TIME_MS + 5 },
    }]).markers[0].target).toMatchObject({ offsetMs: MAX_VIDEO_RICH_MARKER_TIME_MS });

    const json = JSON.stringify({
      version: VIDEO_RICH_MARKERS_VERSION,
      sequenceId: 'sequence-1',
      markers: [
        { ...base, target: { kind: 'clip', clipId: 'clip-a', timeMs: 1_000, offsetMs: -1 } },
        { ...base, id: 'ok', target: { kind: 'clip', clipId: 'clip-a', timeMs: 1_000, offsetMs: 500 } },
      ],
    });
    const imported = importVideoRichMarkersJson(json);
    expect(imported.droppedRows).toBe(1);
    expect(imported.markers).toHaveLength(1);
    expect(imported.markers[0].target).toMatchObject({ offsetMs: 500 });

    const csv = [
      'id,kind,target,start_ms,clip_id,clip_offset_ms',
      'csv-bad,comment,clip,1000,clip-a,not-a-number',
      'csv-range,comment,clip,1000,clip-a,' + String(MAX_VIDEO_RICH_MARKER_TIME_MS + 1),
      'csv-ok,comment,clip,1000,clip-a,250',
    ].join('\n');
    const csvImported = importVideoRichMarkersCsv(csv);
    expect(csvImported.droppedRows).toBe(2);
    expect(csvImported.markers).toHaveLength(1);
    expect(csvImported.markers[0].target).toMatchObject({ offsetMs: 250 });
  });
});
