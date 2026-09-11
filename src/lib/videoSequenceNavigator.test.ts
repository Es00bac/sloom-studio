import { describe, expect, it } from 'vitest';
import {
  addVideoSequenceNavigatorBin,
  closeVideoSequenceTab,
  createVideoSequenceNavigatorModel,
  deleteVideoSequenceSafely,
  duplicateVideoSequence,
  MAX_VIDEO_NAVIGATOR_SEQUENCES,
  normalizeVideoSequenceNavigatorModel,
  openVideoSequenceTab,
  planVideoSequenceDeletion,
  renameVideoSequence,
  setVideoSequenceViewState,
  validateVideoSequenceDelete,
  type VideoSequenceNavigatorModel,
} from './videoSequenceNavigator';

function model(): VideoSequenceNavigatorModel {
  return normalizeVideoSequenceNavigatorModel({
    sequences: [
      { id: 'main', name: 'Main', durationMs: 60_000, frameRate: 24, createdAt: 1, updatedAt: 1 },
      { id: 'nested', name: 'Nested', durationMs: 10_000, frameRate: 24, createdAt: 2, updatedAt: 2 },
    ],
    tabs: [{ sequenceId: 'main', pinned: false }], activeSequenceId: 'main',
  });
}

describe('Video sequence navigator', () => {
  it('manages bins, tabs, rename and per-sequence view state without clip/media payloads', () => {
    let value = addVideoSequenceNavigatorBin(model(), { id: 'cuts', name: 'Cuts' });
    value = openVideoSequenceTab(value, 'nested', { pinned: true });
    value = closeVideoSequenceTab(value, 'nested');
    expect(value.tabs.some((tab) => tab.sequenceId === 'nested')).toBe(true);
    value = renameVideoSequence(value, 'main', 'Picture Lock', 10);
    value = setVideoSequenceViewState(value, 'main', { playheadMs: 5_000, selectedClipIds: ['a', 'a', 'b'] });
    expect(value.sequences[0]).toMatchObject({ name: 'Picture Lock', updatedAt: 10 });
    expect(value.viewStateBySequenceId.main).toMatchObject({ playheadMs: 5_000, selectedClipIds: ['a', 'b'] });
    expect(JSON.stringify(value)).not.toMatch(/assetUrl|mediaBytes|data:/u);
  });

  it('duplicates sequence metadata with a safe source-reference descriptor', () => {
    const result = duplicateVideoSequence({ model: model(), sourceSequenceId: 'main', destinationSequenceId: 'main-copy', createdAt: 20 });
    expect(result.model.sequences).toHaveLength(3);
    expect(result.model.activeSequenceId).toBe('main-copy');
    expect(result.descriptor).toEqual({
      sourceSequenceId: 'main', destinationSequenceId: 'main-copy', includeMarkers: true,
      includeCaptions: true, includeReviewAnnotations: false, mediaPolicy: 'reuse-project-source-references',
    });
  });

  it('blocks dependent deletion and deletes unreferenced sequences with tab fallback', () => {
    const dependent = normalizeVideoSequenceNavigatorModel({
      ...model(),
      dependencies: [{ id: 'nested-use', consumerSequenceId: 'main', requiredSequenceId: 'nested', kind: 'nested-sequence', label: 'Main nests Nested' }],
    });
    expect(validateVideoSequenceDelete(dependent, 'nested')).toMatchObject({ canDelete: false, blockers: [{ id: 'nested-use' }] });
    expect(deleteVideoSequenceSafely(dependent, 'nested')).toMatchObject({ ok: false, reason: 'dependency-blocked' });
    const deleted = deleteVideoSequenceSafely(model(), 'main');
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.model.sequences.map((sequence) => sequence.id)).toEqual(['nested']);
    expect(deleted.model.activeSequenceId).toBe('nested');
  });

  it('derives nested-composition blockers and chooses a deterministic active replacement', () => {
    const nested = normalizeVideoSequenceNavigatorModel({
      sequences: [
        { id: 'z-active', name: 'Z Active', durationMs: 1, frameRate: 24, createdAt: 1, updatedAt: 1 },
        { id: 'b-consumer', name: 'B Consumer', durationMs: 1, frameRate: 24, createdAt: 1, updatedAt: 1, nestedSequenceIds: ['a-nested'] },
        { id: 'a-nested', name: 'A Nested', durationMs: 1, frameRate: 24, createdAt: 1, updatedAt: 1 },
      ],
      activeSequenceId: 'z-active',
    });
    expect(planVideoSequenceDeletion(nested, 'a-nested')).toMatchObject({
      canDelete: false,
      blockers: [{ kind: 'nested-sequence', consumerSequenceId: 'b-consumer', requiredSequenceId: 'a-nested' }],
    });
    const deletion = deleteVideoSequenceSafely(nested, 'z-active');
    expect(deletion.ok).toBe(true);
    if (!deletion.ok) return;
    expect(deletion.model.activeSequenceId).toBe('a-nested');
  });

  it('caps normalized projects at 128 sequences', () => {
    const value = normalizeVideoSequenceNavigatorModel({
      ...createVideoSequenceNavigatorModel(),
      sequences: Array.from({ length: MAX_VIDEO_NAVIGATOR_SEQUENCES + 10 }, (_, index) => ({
        id: `sequence-${index}`, name: `Sequence ${index}`, durationMs: 0, frameRate: 24, createdAt: index, updatedAt: index,
      })),
    });
    expect(value.sequences).toHaveLength(MAX_VIDEO_NAVIGATOR_SEQUENCES);
  });
});
