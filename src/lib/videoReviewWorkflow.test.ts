import { describe, expect, it } from 'vitest';
import {
  createVideoReviewWorkflow,
  evaluateVideoReviewApproval,
  exportVideoReviewPackageCsv,
  exportVideoReviewPackageJson,
  invalidateVideoReviewApproval,
  mergeVideoReviewWorkflows,
  MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS,
  MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION,
  MAX_VIDEO_REVIEW_TOTAL_REPLIES,
  normalizeVideoReviewWorkflow,
  parseVideoReviewPackageJson,
  upsertVideoReviewAnnotation,
  VIDEO_REVIEW_COLLABORATION_BOUNDARY,
  type VideoReviewAnnotation,
} from './videoReviewWorkflow';

const annotation: VideoReviewAnnotation = {
  id: 'note-1',
  target: { kind: 'range', startMs: 1_000, endMs: 2_000 },
  author: 'Editor',
  body: 'Shorten this beat',
  status: 'open',
  priority: 'high',
  createdAt: 10,
  updatedAt: 10,
  replies: [],
};

describe('local professional review workflow', () => {
  it('supports point/range/clip annotations and remains explicitly local-only', () => {
    let workflow = createVideoReviewWorkflow('sequence-1', 'sig-a');
    workflow = upsertVideoReviewAnnotation(workflow, annotation);
    workflow = upsertVideoReviewAnnotation(workflow, {
      ...annotation, id: 'clip-note', target: { kind: 'clip', clipId: 'clip-1', timeMs: 1_500 },
    });
    expect(workflow.collaboration).toBe(VIDEO_REVIEW_COLLABORATION_BOUNDARY);
    expect(workflow.annotations.map((item) => item.target.kind)).toEqual(['range', 'clip']);
  });

  it('merges edits and replies deterministically without duplicates', () => {
    const base = upsertVideoReviewAnnotation(createVideoReviewWorkflow('sequence-1', 'sig-a'), annotation);
    const incoming = upsertVideoReviewAnnotation(createVideoReviewWorkflow('sequence-1', 'sig-a'), {
      ...annotation,
      body: 'Tighten this beat',
      updatedAt: 20,
      replies: [{ id: 'reply-1', author: 'Director', body: 'Agreed', createdAt: 21, updatedAt: 21 }],
    });
    const once = mergeVideoReviewWorkflows(base, incoming, 'sig-a');
    const twice = mergeVideoReviewWorkflows(once, incoming, 'sig-a');
    expect(twice).toEqual(once);
    expect(once.annotations[0]).toMatchObject({ body: 'Tighten this beat', replies: [{ id: 'reply-1' }] });
  });

  it('invalidates approval when the composition signature changes', () => {
    const approved = {
      ...createVideoReviewWorkflow('sequence-1', 'sig-a'),
      approval: { status: 'approved' as const, reviewer: 'Director', decidedAt: 30, compositionSignature: 'sig-a' },
    };
    expect(evaluateVideoReviewApproval(approved.approval, 'sig-a').valid).toBe(true);
    const invalidated = invalidateVideoReviewApproval(approved, 'sig-b');
    expect(invalidated.approval).toMatchObject({ status: 'invalidated', compositionSignature: 'sig-a', invalidatedBySignature: 'sig-b' });
    expect(evaluateVideoReviewApproval(invalidated.approval, 'sig-b')).toMatchObject({ effectiveStatus: 'invalidated', valid: false });
  });

  it('exports bounded JSON and spreadsheet-safe CSV reports', () => {
    const workflow = upsertVideoReviewAnnotation(createVideoReviewWorkflow('sequence-1', 'sig-a'), {
      ...annotation, body: 'Use "alternate", then review', assignee: 'Post',
    });
    const json = exportVideoReviewPackageJson(workflow);
    const csv = exportVideoReviewPackageCsv(workflow);
    expect(JSON.parse(json)).toMatchObject({ collaboration: 'local-file-exchange-only', annotations: [{ id: 'note-1' }] });
    expect(csv).toContain('"Use ""alternate"", then review"');
    expect(csv).toContain('"Post"');
  });

  it('bounds malformed imported packages and drops invalid ranges', () => {
    const workflow = normalizeVideoReviewWorkflow({
      annotations: [annotation, { ...annotation, id: 'bad', target: { kind: 'range', startMs: 20, endMs: 10 } }],
    }, { compositionId: 'sequence-1', compositionSignature: 'sig-a' });
    expect(workflow.annotations).toEqual([annotation]);
  });

  it('parses bounded JSON packages and rejects invalid or oversized input before normalization', () => {
    const fallback = { compositionId: 'sequence-1', compositionSignature: 'sig-a' };
    expect(parseVideoReviewPackageJson(JSON.stringify({ annotations: [annotation] }), fallback).annotations).toHaveLength(1);
    expect(() => parseVideoReviewPackageJson('{broken', fallback)).toThrow('not valid JSON');
    expect(() => parseVideoReviewPackageJson(' '.repeat(MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS + 1), fallback)).toThrow('8 MiB');
  });

  it('caps replies per annotation and across the local exchange document', () => {
    const replies = Array.from({ length: MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION + 10 }, (_, index) => ({
      id: `reply-${index}`,
      author: 'Reviewer',
      body: 'Bounded reply',
      createdAt: index,
      updatedAt: index,
    }));
    const workflow = normalizeVideoReviewWorkflow({
      annotations: Array.from({ length: 21 }, (_, index) => ({
        ...annotation,
        id: `note-${index}`,
        replies,
      })),
    }, { compositionId: 'sequence-1', compositionSignature: 'sig-a' });

    expect(workflow.annotations[0]?.replies).toHaveLength(MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION);
    expect(workflow.annotations.reduce((total, item) => total + item.replies.length, 0)).toBe(MAX_VIDEO_REVIEW_TOTAL_REPLIES);
    expect(workflow.annotations.at(-1)?.replies).toHaveLength(0);
  });
});
