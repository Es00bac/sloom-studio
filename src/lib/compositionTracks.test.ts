import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import {
  classifyCompositionAudioHandle,
  COMPOSITION_AUDIO_HANDLES,
  formatCompositionAudioMigrationWarningMessage,
  getConnectedCompositionAudioHandles,
  normalizeCompositionAudioTrackCounts,
  resolveCompositionAudioTrackModel,
  sanitizeCompositionAudioMigrationWarnings,
} from './compositionTracks';

function compositionNode(id: string, compositionAudioTrackCount?: unknown): AppNode {
  return {
    id,
    type: 'composition',
    position: { x: 0, y: 0 },
    data: { compositionAudioTrackCount },
  } as AppNode;
}

describe('classifyCompositionAudioHandle', () => {
  it('returns null for handles that are not audio-track-shaped', () => {
    expect(classifyCompositionAudioHandle('composition-video')).toBeNull();
    expect(classifyCompositionAudioHandle(null)).toBeNull();
    expect(classifyCompositionAudioHandle(undefined)).toBeNull();
  });

  it('classifies in-range handles as valid', () => {
    expect(classifyCompositionAudioHandle('composition-audio-1')).toEqual({
      handle: 'composition-audio-1',
      index: 1,
      status: 'valid',
    });
    expect(classifyCompositionAudioHandle('composition-audio-4')).toMatchObject({ index: 4, status: 'valid' });
  });

  it('classifies handles beyond the supported range as overflow', () => {
    expect(classifyCompositionAudioHandle('composition-audio-5')).toEqual({
      handle: 'composition-audio-5',
      index: 5,
      status: 'overflow',
    });
  });

  it('classifies non-positive or non-integer indexes as malformed', () => {
    expect(classifyCompositionAudioHandle('composition-audio-0')).toMatchObject({ status: 'malformed', index: null });
  });

  it('classifies nonnumeric or malformed-suffix audio-shaped handles as malformed instead of returning null (FBL-019 correction)', () => {
    expect(classifyCompositionAudioHandle('composition-audio-x')).toMatchObject({ status: 'malformed', index: null });
    expect(classifyCompositionAudioHandle('composition-audio--1')).toMatchObject({ status: 'malformed', index: null });
    expect(classifyCompositionAudioHandle('composition-audio-1.5')).toMatchObject({ status: 'malformed', index: null });
  });
});

describe('resolveCompositionAudioTrackModel', () => {
  it('shows only the requested track count by default', () => {
    expect(resolveCompositionAudioTrackModel(1, []).handles).toEqual(['composition-audio-1']);
    expect(resolveCompositionAudioTrackModel(3, []).handles).toEqual([
      'composition-audio-1',
      'composition-audio-2',
      'composition-audio-3',
    ]);
  });

  it('keeps a hidden connected audio track visible so its edge stays reachable', () => {
    expect(resolveCompositionAudioTrackModel(1, ['composition-audio-3']).handles).toEqual([
      'composition-audio-1',
      'composition-audio-2',
      'composition-audio-3',
    ]);
  });

  it('clamps invalid requested audio track counts into the supported range', () => {
    expect(resolveCompositionAudioTrackModel(0, []).effectiveCount).toBe(1);
    expect(resolveCompositionAudioTrackModel(12, []).effectiveCount).toBe(4);
    expect(resolveCompositionAudioTrackModel(2.9, []).effectiveCount).toBe(2);
    expect(resolveCompositionAudioTrackModel(Number.NaN, []).effectiveCount).toBe(1);
  });

  it('never shrinks a larger authored count when connections are absent', () => {
    expect(resolveCompositionAudioTrackModel(4, []).effectiveCount).toBe(4);
    expect(resolveCompositionAudioTrackModel(4, ['composition-audio-1']).effectiveCount).toBe(4);
  });

  it('reports overflow/malformed handles instead of silently absorbing them into the count', () => {
    const model = resolveCompositionAudioTrackModel(1, ['composition-audio-7', 'composition-audio-0']);
    expect(model.effectiveCount).toBe(1);
    expect(model.overflowHandles).toEqual(['composition-audio-7', 'composition-audio-0']);
  });

  it('ignores handles unrelated to audio tracks', () => {
    expect(resolveCompositionAudioTrackModel(1, ['composition-video', null, undefined]).effectiveCount).toBe(1);
  });
});

describe('getConnectedCompositionAudioHandles', () => {
  it('collects target handles pointed at the given node only', () => {
    const edges = [
      { target: 'composition-1', targetHandle: 'composition-audio-2' },
      { target: 'composition-1', targetHandle: 'composition-video' },
      { target: 'composition-2', targetHandle: 'composition-audio-1' },
    ];
    expect(getConnectedCompositionAudioHandles('composition-1', edges)).toEqual([
      'composition-audio-2',
      'composition-video',
    ]);
  });
});

describe('normalizeCompositionAudioTrackCounts', () => {
  it('raises a stale saved count to the highest explicitly connected audio track', () => {
    const nodes = [compositionNode('composition-1', 1)];
    const edges = [{ target: 'composition-1', targetHandle: 'composition-audio-3' }];

    const next = normalizeCompositionAudioTrackCounts(nodes, edges);
    expect(next[0]?.data.compositionAudioTrackCount).toBe(3);
  });

  it('normalizes at the track-4 boundary', () => {
    const nodes = [compositionNode('composition-1', 1)];
    const edges = [{ target: 'composition-1', targetHandle: 'composition-audio-4' }];

    const next = normalizeCompositionAudioTrackCounts(nodes, edges);
    expect(next[0]?.data.compositionAudioTrackCount).toBe(4);
  });

  it('clamps invalid, zero, fractional, or oversize saved counts deterministically', () => {
    expect(normalizeCompositionAudioTrackCounts([compositionNode('a', 0)], [])[0]?.data.compositionAudioTrackCount).toBe(1);
    expect(normalizeCompositionAudioTrackCounts([compositionNode('b', 2.7)], [])[0]?.data.compositionAudioTrackCount).toBe(2);
    expect(normalizeCompositionAudioTrackCounts([compositionNode('c', 99)], [])[0]?.data.compositionAudioTrackCount).toBe(4);
    expect(normalizeCompositionAudioTrackCounts([compositionNode('d', Number.NaN)], [])[0]?.data.compositionAudioTrackCount).toBe(1);
  });

  it('preserves a larger authored count after its higher track disconnects', () => {
    const settled = compositionNode('composition-1', 4);
    const next = normalizeCompositionAudioTrackCounts([settled], []);
    expect(next[0]?.data.compositionAudioTrackCount).toBe(4);
    expect(next[0]).toBe(settled);
  });

  it('does not rewrite node data when the canonical value already matches (no update-loop churn)', () => {
    const settled = compositionNode('composition-1', 2);
    const edges = [{ target: 'composition-1', targetHandle: 'composition-audio-1' }];
    const originalNodesArray = [settled];

    const next = normalizeCompositionAudioTrackCounts(originalNodesArray, edges);
    expect(next[0]).toBe(settled);
    expect(next).toBe(originalNodesArray);
  });

  it('leaves non-composition nodes untouched', () => {
    const other: AppNode = { id: 'video-1', type: 'videoGen', position: { x: 0, y: 0 }, data: {} } as AppNode;
    const next = normalizeCompositionAudioTrackCounts([other], []);
    expect(next[0]).toBe(other);
  });

  it('is idempotent across the whole snapshot: normalizing twice yields identical output', () => {
    const nodes = [
      compositionNode('composition-1', 1),
      compositionNode('composition-2', 99),
    ];
    const edges = [
      { target: 'composition-1', targetHandle: 'composition-audio-3' },
      { target: 'composition-2', targetHandle: 'composition-audio-2' },
    ];

    const once = normalizeCompositionAudioTrackCounts(nodes, edges);
    const twice = normalizeCompositionAudioTrackCounts(once, edges);
    expect(twice).toEqual(once);
    expect(twice).toBe(once);
  });
});

describe('COMPOSITION_AUDIO_HANDLES', () => {
  it('is bounded to exactly 4 supported handles', () => {
    expect(COMPOSITION_AUDIO_HANDLES).toEqual([
      'composition-audio-1',
      'composition-audio-2',
      'composition-audio-3',
      'composition-audio-4',
    ]);
  });
});

describe('sanitizeCompositionAudioMigrationWarnings (FBL-019 correction)', () => {
  it('returns undefined for non-array or empty input', () => {
    expect(sanitizeCompositionAudioMigrationWarnings(undefined)).toBeUndefined();
    expect(sanitizeCompositionAudioMigrationWarnings('not-an-array')).toBeUndefined();
    expect(sanitizeCompositionAudioMigrationWarnings([])).toBeUndefined();
  });

  it('drops malformed entries and keeps well-shaped ones', () => {
    expect(sanitizeCompositionAudioMigrationWarnings([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'ok' },
      { handle: 123, reason: 'overflow', message: 'bad handle type' },
      { handle: 'x', reason: 'not-a-real-reason', message: 'bad reason' },
      null,
      'not-an-object',
    ])).toEqual([{ handle: 'composition-audio-9', reason: 'overflow', message: 'ok' }]);
  });

  it('bounds entry count and truncates long handle/message strings', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ handle: `h${i}`, reason: 'overflow', message: 'm' }));
    expect(sanitizeCompositionAudioMigrationWarnings(many)?.length).toBeLessThanOrEqual(8);

    const long = [{ handle: 'h'.repeat(5000), reason: 'malformed', message: 'm'.repeat(5000) }];
    const sanitized = sanitizeCompositionAudioMigrationWarnings(long)!;
    expect(sanitized[0].handle.length).toBeLessThan(100);
    expect(sanitized[0].message.length).toBeLessThan(300);
  });

  it('deduplicates ordinary records by reason and handle while preserving the first message', () => {
    expect(sanitizeCompositionAudioMigrationWarnings([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'First-seen warning.' },
      { handle: 'composition-audio-9', reason: 'overflow', message: 'Later duplicate warning.' },
      { handle: 'composition-audio-9', reason: 'malformed', message: 'Different reason.' },
    ])).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'First-seen warning.' },
      { handle: 'composition-audio-9', reason: 'malformed', message: 'Different reason.' },
    ]);
  });

  it('deduplicates records whose handles become equal only after canonical truncation', () => {
    const sharedPrefix = 'h'.repeat(64);

    expect(sanitizeCompositionAudioMigrationWarnings([
      { handle: `${sharedPrefix}a`, reason: 'malformed', message: 'First canonical record.' },
      { handle: `${sharedPrefix}b`, reason: 'malformed', message: 'Second canonical duplicate.' },
    ])).toEqual([
      { handle: `${sharedPrefix}…`, reason: 'malformed', message: 'First canonical record.' },
    ]);
  });

  it('does not let duplicates consume the bounded unique-entry budget', () => {
    const sanitized = sanitizeCompositionAudioMigrationWarnings([
      { handle: 'duplicate', reason: 'overflow', message: 'First duplicate.' },
      { handle: 'duplicate', reason: 'overflow', message: 'Second duplicate.' },
      ...Array.from({ length: 7 }, (_, index) => ({
        handle: `unique-${index + 1}`,
        reason: 'malformed',
        message: `Unique ${index + 1}.`,
      })),
    ]);

    expect(sanitized).toHaveLength(8);
    expect(sanitized?.map((warning) => warning.handle)).toEqual([
      'duplicate',
      'unique-1',
      'unique-2',
      'unique-3',
      'unique-4',
      'unique-5',
      'unique-6',
      'unique-7',
    ]);
  });
});

describe('formatCompositionAudioMigrationWarningMessage (FBL-019 correction)', () => {
  it('joins multiple warning messages and returns undefined when empty', () => {
    expect(formatCompositionAudioMigrationWarningMessage(undefined)).toBeUndefined();
    expect(formatCompositionAudioMigrationWarningMessage([])).toBeUndefined();
    expect(formatCompositionAudioMigrationWarningMessage([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'A.' },
      { handle: 'composition-audio-0', reason: 'malformed', message: 'B.' },
    ])).toBe('A. B.');
  });
});
