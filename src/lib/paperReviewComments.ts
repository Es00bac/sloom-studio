import type { PaperDocument, PaperReviewComment, PaperReviewReply } from '../types/paper';

/** Bounded review-comment contract: nothing about the thread list can grow without limit. */
export const PAPER_REVIEW_COMMENT_MAX_THREADS = 200;
export const PAPER_REVIEW_COMMENT_MAX_REPLIES = 50;
export const PAPER_REVIEW_BODY_MAX_LENGTH = 2000;
export const PAPER_REVIEW_AUTHOR_MAX_LENGTH = 80;

export type PaperReviewAnchorState = 'anchored' | 'page-missing' | 'frame-missing';

export interface PaperReviewCommentDraft {
  pageId: string;
  frameId?: string;
  author: string;
  body: string;
}

export interface PaperReviewReplyDraft {
  author: string;
  body: string;
}

function boundTrimmed(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}

function isPositiveTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function createReviewId(kind: 'comment' | 'reply'): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `paper-review-${kind}-${suffix}`;
}

/** Add one open comment thread; the newest thread is first and the list is hard-bounded. */
export function addPaperReviewComment(
  document: PaperDocument,
  draft: PaperReviewCommentDraft,
  now: number = Date.now(),
): { document: PaperDocument; comment?: PaperReviewComment } {
  const body = boundTrimmed(draft.body, PAPER_REVIEW_BODY_MAX_LENGTH);
  const author = boundTrimmed(draft.author, PAPER_REVIEW_AUTHOR_MAX_LENGTH) ?? 'Anonymous';
  const pageId = typeof draft.pageId === 'string' && draft.pageId ? draft.pageId : undefined;
  if (!body || !pageId || !isPositiveTimestamp(now)) return { document };

  const comment: PaperReviewComment = {
    id: createReviewId('comment'),
    pageId,
    ...(typeof draft.frameId === 'string' && draft.frameId ? { frameId: draft.frameId } : {}),
    author,
    body,
    createdAt: now,
    replies: [],
  };

  const existing = document.reviewComments ?? [];
  const next = [comment, ...existing].slice(0, PAPER_REVIEW_COMMENT_MAX_THREADS);
  return { document: { ...document, reviewComments: next }, comment };
}

/** Append one reply to a thread, bounded per thread. */
export function addPaperReviewReply(
  document: PaperDocument,
  commentId: string,
  draft: PaperReviewReplyDraft,
  now: number = Date.now(),
): { document: PaperDocument; reply?: PaperReviewReply } {
  const body = boundTrimmed(draft.body, PAPER_REVIEW_BODY_MAX_LENGTH);
  const author = boundTrimmed(draft.author, PAPER_REVIEW_AUTHOR_MAX_LENGTH) ?? 'Anonymous';
  if (!body || !isPositiveTimestamp(now)) return { document };

  let reply: PaperReviewReply | undefined;
  const comments = document.reviewComments ?? [];
  const next = comments.map((comment) => {
    if (comment.id !== commentId) return comment;
    if (comment.replies.length >= PAPER_REVIEW_COMMENT_MAX_REPLIES) return comment;
    reply = {
      id: createReviewId('reply'),
      author,
      body,
      createdAt: now,
    };
    return { ...comment, replies: [...comment.replies, reply] };
  });

  if (!reply) return { document };
  return { document: { ...document, reviewComments: next }, reply };
}

/** Resolve (stamp) or reopen (unstamp) one thread. */
export function setPaperReviewCommentResolved(
  document: PaperDocument,
  commentId: string,
  resolved: boolean,
  now: number = Date.now(),
): PaperDocument {
  const comments = document.reviewComments;
  if (!comments) return document;
  let changed = false;
  const next = comments.map((comment) => {
    if (comment.id !== commentId) return comment;
    if (resolved === Boolean(comment.resolvedAt)) return comment;
    changed = true;
    if (!resolved) {
      const { resolvedAt: _dropped, ...rest } = comment;
      return rest as PaperReviewComment;
    }
    return { ...comment, resolvedAt: isPositiveTimestamp(now) ? now : Date.now() };
  });
  if (!changed) return document;
  return { ...document, reviewComments: next };
}

/** Remove one thread entirely. */
export function deletePaperReviewComment(document: PaperDocument, commentId: string): PaperDocument {
  const comments = document.reviewComments;
  if (!comments?.some((comment) => comment.id === commentId)) return document;
  return { ...document, reviewComments: comments.filter((comment) => comment.id !== commentId) };
}

/**
 * Honest anchor state: a comment whose page (or optional frame) no longer exists is reported as
 * such instead of being silently dropped or re-anchored.
 */
export function describePaperReviewAnchorState(
  document: Pick<PaperDocument, 'pages' | 'parentPages'>,
  comment: Pick<PaperReviewComment, 'pageId' | 'frameId'>,
): PaperReviewAnchorState {
  const pageExists = document.pages.some((page) => page.id === comment.pageId)
    || document.parentPages.some((parent) => parent.id === comment.pageId);
  if (!pageExists) return 'page-missing';
  if (comment.frameId) {
    const page = document.pages.find((candidate) => candidate.id === comment.pageId);
    const frames = page
      ? page.frames
      : document.parentPages.find((candidate) => candidate.id === comment.pageId)?.frames ?? [];
    if (!frames.some((frame) => frame.id === comment.frameId)) return 'frame-missing';
  }
  return 'anchored';
}

/**
 * Parse-time sanitization for untrusted document JSON: keeps only structurally valid threads,
 * repairs reply arrays, enforces every bound, and drops comments whose identifiers are invalid.
 * Comments anchored to pages/frames that do not exist in THIS document are kept and reported
 * through `describePaperReviewAnchorState` rather than deleted.
 */
export function sanitizePaperReviewComments(value: unknown): PaperReviewComment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const sanitized = value.flatMap((entry): PaperReviewComment[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id) return [];
    if (typeof candidate.pageId !== 'string' || !candidate.pageId) return [];
    if (candidate.frameId !== undefined && (typeof candidate.frameId !== 'string' || !candidate.frameId)) return [];

    const body = boundTrimmed(candidate.body, PAPER_REVIEW_BODY_MAX_LENGTH);
    if (!body) return [];
    const author = boundTrimmed(candidate.author, PAPER_REVIEW_AUTHOR_MAX_LENGTH) ?? 'Anonymous';
    if (!isPositiveTimestamp(candidate.createdAt)) return [];

    const replies = Array.isArray(candidate.replies)
      ? candidate.replies.flatMap((replyEntry): PaperReviewReply[] => {
        if (!replyEntry || typeof replyEntry !== 'object' || Array.isArray(replyEntry)) return [];
        const reply = replyEntry as Record<string, unknown>;
        if (typeof reply.id !== 'string' || !reply.id) return [];
        const replyBody = boundTrimmed(reply.body, PAPER_REVIEW_BODY_MAX_LENGTH);
        if (!replyBody || !isPositiveTimestamp(reply.createdAt)) return [];
        return [{
          id: reply.id,
          author: boundTrimmed(reply.author, PAPER_REVIEW_AUTHOR_MAX_LENGTH) ?? 'Anonymous',
          body: replyBody,
          createdAt: reply.createdAt,
        }];
      }).slice(0, PAPER_REVIEW_COMMENT_MAX_REPLIES)
      : [];

    return [{
      id: candidate.id,
      pageId: candidate.pageId,
      ...(typeof candidate.frameId === 'string' && candidate.frameId ? { frameId: candidate.frameId } : {}),
      author,
      body,
      createdAt: candidate.createdAt,
      ...(isPositiveTimestamp(candidate.resolvedAt) ? { resolvedAt: candidate.resolvedAt } : {}),
      replies,
    }];
  }).slice(0, PAPER_REVIEW_COMMENT_MAX_THREADS);

  return sanitized;
}

/** Count open (unresolved) threads for badges and honest empty states. */
export function countOpenPaperReviewComments(document: Pick<PaperDocument, 'reviewComments'>): number {
  return (document.reviewComments ?? []).filter((comment) => !comment.resolvedAt).length;
}
