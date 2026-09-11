import { describe, expect, it } from 'vitest';
import {
  addPaperReviewComment,
  addPaperReviewReply,
  countOpenPaperReviewComments,
  deletePaperReviewComment,
  describePaperReviewAnchorState,
  PAPER_REVIEW_COMMENT_MAX_REPLIES,
  PAPER_REVIEW_COMMENT_MAX_THREADS,
  PAPER_REVIEW_BODY_MAX_LENGTH,
  sanitizePaperReviewComments,
  setPaperReviewCommentResolved,
} from './paperReviewComments';
import { createDefaultPaperDocument, parsePaperDocument, serializePaperDocument } from './paperDocument';

function documentWithPage() {
  const document = createDefaultPaperDocument({ title: 'Review doc' });
  return document;
}

describe('paperReviewComments — add', () => {
  it('adds one open thread anchored to a page, newest first', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;

    const first = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Check the gutter.' }, 1);
    const second = addPaperReviewComment(first.document, {
      pageId,
      author: 'Sol',
      body: 'Widow on page 2.',
      frameId: 'frame-1',
    }, 1_000);

    expect(first.comment).toMatchObject({ pageId, author: 'Vera', body: 'Check the gutter.', createdAt: 1 });
    expect(first.comment?.frameId).toBeUndefined();
    expect(first.comment?.replies).toEqual([]);
    expect(second.document.reviewComments?.map((comment) => comment.author)).toEqual(['Sol', 'Vera']);
    expect(second.comment?.frameId).toBe('frame-1');
  });

  it('rejects empty bodies, blank authors default honestly, and bounds long text', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;

    expect(addPaperReviewComment(document, { pageId, author: 'A', body: '   ' }, 1).comment).toBeUndefined();
    expect(addPaperReviewComment(document, { pageId: '', author: 'A', body: 'Hi' }, 1).comment).toBeUndefined();

    const anonymous = addPaperReviewComment(document, { pageId, author: '  ', body: 'Anon note' }, 1);
    expect(anonymous.comment?.author).toBe('Anonymous');

    const long = addPaperReviewComment(
      document,
      { pageId, author: 'A', body: 'x'.repeat(PAPER_REVIEW_BODY_MAX_LENGTH + 500) },
      1,
    );
    expect(long.comment?.body.length).toBe(PAPER_REVIEW_BODY_MAX_LENGTH);
    expect(long.comment?.body.endsWith('…')).toBe(true);
  });

  it('hard-bounds the thread list', () => {
    let document = documentWithPage();
    const pageId = document.pages[0]!.id;
    for (let index = 0; index < PAPER_REVIEW_COMMENT_MAX_THREADS + 10; index += 1) {
      document = addPaperReviewComment(document, { pageId, author: 'A', body: `Note ${index}` }, index + 1).document;
    }
    expect(document.reviewComments).toHaveLength(PAPER_REVIEW_COMMENT_MAX_THREADS);
    expect(document.reviewComments?.[0]?.body).toBe(`Note ${PAPER_REVIEW_COMMENT_MAX_THREADS + 9}`);
  });
});

describe('paperReviewComments — replies, resolve, delete', () => {
  it('appends bounded replies to an existing thread only', () => {
    const base = documentWithPage();
    const pageId = base.pages[0]!.id;
    const { document: addedReplyBase, comment } = addPaperReviewComment(base, { pageId, author: 'Vera', body: 'Headline tone?' }, 1);
    if (!comment) throw new Error('comment missing');

    const replied = addPaperReviewReply(addedReplyBase, comment.id, { author: 'Sol', body: 'Keep it punnier.' }, 2);
    expect(replied.reply?.body).toBe('Keep it punnier.');
    expect(replied.document.reviewComments?.[0]?.replies).toHaveLength(1);

    expect(addPaperReviewReply(addedReplyBase, 'missing-id', { author: 'Sol', body: 'Nope' }, 3).reply).toBeUndefined();
    expect(addPaperReviewReply(addedReplyBase, comment.id, { author: 'Sol', body: '  ' }, 3).reply).toBeUndefined();

    let threaded = replied.document;
    for (let index = 0; index < PAPER_REVIEW_COMMENT_MAX_REPLIES + 5; index += 1) {
      threaded = addPaperReviewReply(threaded, comment.id, { author: 'Sol', body: `Reply ${index}` }, index + 10).document;
    }
    expect(threaded.reviewComments?.[0]?.replies).toHaveLength(PAPER_REVIEW_COMMENT_MAX_REPLIES);
  });

  it('resolves with a timestamp, reopens by dropping it, and never mutates when nothing changes', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Fix kerning.' }, 1);

    const resolved = setPaperReviewCommentResolved(added.document, added.comment!.id, true, 5_000);
    expect(resolved.reviewComments?.[0]?.resolvedAt).toBe(5_000);
    expect(setPaperReviewCommentResolved(resolved, added.comment!.id, true, 6_000)).toBe(resolved);

    const reopened = setPaperReviewCommentResolved(resolved, added.comment!.id, false);
    expect(reopened.reviewComments?.[0]?.resolvedAt).toBeUndefined();
    expect('resolvedAt' in (reopened.reviewComments?.[0] ?? {})).toBe(false);

    expect(setPaperReviewCommentResolved(added.document, 'missing-id', true)).toBe(added.document);
    expect(countOpenPaperReviewComments(reopened)).toBe(1);
    expect(countOpenPaperReviewComments(resolved)).toBe(0);
  });

  it('deletes exactly one thread and keeps identity when absent', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;
    const a = addPaperReviewComment(document, { pageId, author: 'A', body: 'One' }, 1);
    const b = addPaperReviewComment(a.document, { pageId, author: 'B', body: 'Two' }, 2);

    const deleted = deletePaperReviewComment(b.document, a.comment!.id);
    expect(deleted.reviewComments?.map((comment) => comment.body)).toEqual(['Two']);
    expect(deletePaperReviewComment(deleted, a.comment!.id)).toBe(deleted);
  });
});

describe('paperReviewComments — honest anchors', () => {
  it('reports anchored, page-missing, and frame-missing states', () => {
    const document = documentWithPage();
    const page = document.pages[0]!;
    const parentId = document.parentPages[0]?.id ?? page.id;

    expect(describePaperReviewAnchorState(document, { pageId: page.id })).toBe('anchored');
    expect(describePaperReviewAnchorState(document, { pageId: parentId })).toBe('anchored');
    expect(describePaperReviewAnchorState(document, { pageId: 'gone-page' })).toBe('page-missing');
    expect(describePaperReviewAnchorState(document, { pageId: page.id, frameId: 'gone-frame' })).toBe('frame-missing');
    if (parentId) {
      expect(describePaperReviewAnchorState(document, { pageId: parentId, frameId: 'gone-frame' })).toBe('frame-missing');
    }
  });

  it('keeps comments whose anchor was deleted after saving and reopening', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'On a page that will vanish.' }, 1);

    const reopened = parsePaperDocument(serializePaperDocument(added.document));
    expect(reopened.reviewComments).toHaveLength(1);
    expect(describePaperReviewAnchorState(
      { pages: [], parentPages: reopened.parentPages },
      reopened.reviewComments![0]!,
    )).toBe('page-missing');
  });
});

describe('paperReviewComments — sanitize untrusted input', () => {
  it('keeps only structurally valid threads and repairs reply arrays and bounds', () => {
    const now = 1_000;
    const sanitized = sanitizePaperReviewComments([
      { id: 'ok', pageId: 'p1', author: 'Vera', body: 'Fine.', createdAt: now, replies: 'not-an-array' },
      { pageId: 'p1', author: 'X', body: 'Dropped: no id.', createdAt: now },
      { id: 'no-page', author: 'X', body: 'Dropped.', createdAt: now },
      { id: 'no-body', pageId: 'p1', author: 'X', createdAt: now },
      { id: 'bad-time', pageId: 'p1', author: 'X', body: 'Dropped.', createdAt: 'yesterday' },
      {
        id: 'with-replies',
        pageId: 'p1',
        author: 'Sol',
        body: 'Thread.',
        createdAt: now,
        resolvedAt: now + 5,
        replies: [
          { id: 'r1', author: 'Vera', body: 'One', createdAt: now + 1 },
          { id: 'r2', body: 'No author is fine', createdAt: now + 2 },
          { id: 'r3', author: 'Vera', body: '   ', createdAt: now + 3 },
          'garbage',
        ],
      },
      'not-an-object',
    ]);

    expect(sanitized).toHaveLength(2);
    expect(sanitized?.[0]?.replies).toEqual([]);
    expect(sanitized?.[1]?.replies).toEqual([
      { id: 'r1', author: 'Vera', body: 'One', createdAt: now + 1 },
      { id: 'r2', author: 'Anonymous', body: 'No author is fine', createdAt: now + 2 },
    ]);
    expect(sanitized?.[1]?.resolvedAt).toBe(now + 5);
    expect(sanitizePaperReviewComments(undefined)).toBeUndefined();
    expect(sanitizePaperReviewComments('nope')).toBeUndefined();
  });

  it('round-trips through parsePaperDocument and drops nothing valid', () => {
    const document = documentWithPage();
    const pageId = document.pages[0]!.id;
    const added = addPaperReviewComment(document, { pageId, author: 'Vera', body: 'Round trip.' }, 1);
    const withReply = addPaperReviewReply(added.document, added.comment!.id, { author: 'Sol', body: 'Agreed.' }, 2).document;
    const resolved = setPaperReviewCommentResolved(withReply, added.comment!.id, true, 3);

    const reopened = parsePaperDocument(serializePaperDocument(resolved));
    expect(reopened.reviewComments).toEqual(resolved.reviewComments);
    expect(countOpenPaperReviewComments(reopened)).toBe(0);
  });
});
