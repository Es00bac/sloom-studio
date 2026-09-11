import { describe, expect, it } from 'vitest';
import {
  mergeTimelinePreviewResults,
  pruneTimelinePreviewMap,
  takePendingTimelinePreviewRequests,
} from './editorTimelinePreview';

describe('takePendingTimelinePreviewRequests', () => {
  it('marks signatures before async preview work starts so rerenders do not duplicate requests', () => {
    const signaturesByClipId: Record<string, string> = {};

    const first = takePendingTimelinePreviewRequests(
      [
        {
          clipId: 'clip-1',
          signature: 'source-a:0:10',
          payload: { sourceNodeId: 'video-1' },
        },
      ],
      signaturesByClipId,
    );
    const second = takePendingTimelinePreviewRequests(
      [
        {
          clipId: 'clip-1',
          signature: 'source-a:0:10',
          payload: { sourceNodeId: 'video-1' },
        },
      ],
      signaturesByClipId,
    );

    expect(first).toEqual([
      {
        clipId: 'clip-1',
        signature: 'source-a:0:10',
        payload: { sourceNodeId: 'video-1' },
      },
    ]);
    expect(second).toEqual([]);
    expect(signaturesByClipId).toEqual({ 'clip-1': 'source-a:0:10' });
  });

  it('ignores requests without a usable signature', () => {
    const signaturesByClipId: Record<string, string> = {};

    expect(
      takePendingTimelinePreviewRequests(
        [
          {
            clipId: 'clip-1',
            payload: { sourceNodeId: 'video-1' },
          },
        ],
        signaturesByClipId,
      ),
    ).toEqual([]);
    expect(signaturesByClipId).toEqual({});
  });
});

describe('timeline preview retention', () => {
  it('prunes previews for removed clips and caps retained previews', () => {
    expect(
      pruneTimelinePreviewMap(
        {
          removed: { start: 'removed' },
          clipA: { start: 'a' },
          clipB: { start: 'b' },
          clipC: { start: 'c' },
        },
        ['clipA', 'clipB', 'clipC'],
        2,
      ),
    ).toEqual({
      clipB: { start: 'b' },
      clipC: { start: 'c' },
    });
  });

  it('merges completed previews without retaining stale clip previews', () => {
    expect(
      mergeTimelinePreviewResults(
        {
          removed: { start: 'removed' },
          clipA: { start: 'old-a' },
        },
        [
          {
            clipId: 'clipB',
            preview: { start: 'new-b' },
          },
          {
            clipId: 'removed',
            preview: { start: 'new-removed' },
          },
        ],
        ['clipA', 'clipB'],
        8,
      ),
    ).toEqual({
      clipA: { start: 'old-a' },
      clipB: { start: 'new-b' },
    });
  });
});
