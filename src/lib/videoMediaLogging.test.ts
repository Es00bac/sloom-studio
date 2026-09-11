import { describe, expect, it } from 'vitest';
import {
  addVideoLoggedSubclip,
  batchPatchVideoMediaLogs,
  createVideoLoggedSubclip,
  createVideoMediaLogRecord,
  filterVideoMediaLogsBySmartBin,
  MAX_VIDEO_MEDIA_LOG_ITEMS,
  MAX_VIDEO_SUBCLIPS_PER_ITEM,
  MAX_VIDEO_TOTAL_SUBCLIPS,
  normalizeVideoMediaLoggingState,
  parseVideoSmartBinQuery,
  suggestVideoMediaDuplicates,
  type VideoSmartBin,
} from './videoMediaLogging';

describe('professional video media logging', () => {
  it('keeps subclips as non-destructive bounded source ranges', () => {
    const record = createVideoMediaLogRecord('camera-a', { durationMs: 20_000 });
    const subclip = createVideoLoggedSubclip({
      id: 'sub-1', name: 'Best line', sourceInMs: 5_000, sourceOutMs: 8_000, sourceDurationMs: 20_000,
    });
    const next = addVideoLoggedSubclip(record, subclip);
    expect(next.subclips).toEqual([{ id: 'sub-1', name: 'Best line', sourceInMs: 5_000, sourceOutMs: 8_000, tags: [] }]);
    expect(record.subclips).toEqual([]);
    expect(() => createVideoLoggedSubclip({ id: 'bad', name: 'Bad', sourceInMs: 5_000, sourceOutMs: 5_000 })).toThrow(/positive duration/);
  });

  it('applies one metadata patch to selected records without touching missing items', () => {
    const records = [createVideoMediaLogRecord('a', { tags: ['wide'] }), createVideoMediaLogRecord('b')];
    const result = batchPatchVideoMediaLogs(records, ['a', 'missing'], {
      scene: '12', rating: 5, status: 'select', addTags: ['Hero'], removeTags: ['wide'],
    });
    expect(result.records[0]).toMatchObject({ sourceItemId: 'a', scene: '12', rating: 5, status: 'select', tags: ['Hero'] });
    expect(result.records[1]).toEqual(records[1]);
    expect(result.updatedSourceItemIds).toEqual(['a']);
    expect(result.missingSourceItemIds).toEqual(['missing']);
  });

  it('evaluates saved all/any smart-bin predicates', () => {
    const records = [
      createVideoMediaLogRecord('a', { camera: 'A Cam', rating: 5, status: 'select', tags: ['night'] }),
      createVideoMediaLogRecord('b', { camera: 'B Cam', rating: 3, status: 'hold', tags: ['day'] }),
    ];
    const bin: VideoSmartBin = {
      id: 'selects', name: 'Night selects', match: 'all', predicates: [
        { field: 'rating', operator: 'at-least', value: 4 },
        { field: 'tag', operator: 'includes', value: 'NIGHT' },
      ],
    };
    expect(filterVideoMediaLogsBySmartBin(records, bin).map((record) => record.sourceItemId)).toEqual(['a']);
    const parsed = parseVideoSmartBinQuery('parsed', 'Parsed selects', 'rating >= 4 and tag:night and camera:"A Cam"');
    expect(filterVideoMediaLogsBySmartBin(records, parsed).map((record) => record.sourceItemId)).toEqual(['a']);
  });

  it('suggests duplicates by evidence without deleting or merging records', () => {
    const records = [
      createVideoMediaLogRecord('a', { sourceFingerprint: 'hash', fileName: 'A001.mov', durationMs: 1_000 }),
      createVideoMediaLogRecord('b', { sourceFingerprint: 'hash', fileName: 'copy.mov', durationMs: 1_000 }),
      createVideoMediaLogRecord('c', { fileName: 'A001.mov', durationMs: 1_000 }),
    ];
    expect(suggestVideoMediaDuplicates(records)).toEqual([
      { sourceItemIds: ['a', 'b'], confidence: 'exact', reason: 'matching-fingerprint' },
      { sourceItemIds: ['a', 'c'], confidence: 'probable', reason: 'matching-file-and-duration' },
    ]);
    expect(records).toHaveLength(3);
  });

  it('bounds restored libraries and smart-bin definitions', () => {
    const subclips = Array.from({ length: MAX_VIDEO_SUBCLIPS_PER_ITEM + 10 }, (_, index) => ({
      id: `subclip-${index}`,
      name: `Subclip ${index}`,
      sourceInMs: index * 2,
      sourceOutMs: index * 2 + 1,
    }));
    const state = normalizeVideoMediaLoggingState({
      records: Array.from({ length: MAX_VIDEO_MEDIA_LOG_ITEMS + 10 }, (_, index) => ({
        sourceItemId: `item-${index}`,
        subclips: index < 41 ? subclips : [],
      })),
      smartBins: Array.from({ length: 120 }, (_, index) => ({ id: `bin-${index}`, name: `Bin ${index}`, predicates: [] })),
    });
    expect(state.records).toHaveLength(MAX_VIDEO_MEDIA_LOG_ITEMS);
    expect(state.smartBins).toHaveLength(100);
    expect(state.records[0]?.subclips).toHaveLength(MAX_VIDEO_SUBCLIPS_PER_ITEM);
    expect(state.records.reduce((total, record) => total + record.subclips.length, 0)).toBe(MAX_VIDEO_TOTAL_SUBCLIPS);
    expect(state.records[40]?.subclips).toHaveLength(0);
  });
});
