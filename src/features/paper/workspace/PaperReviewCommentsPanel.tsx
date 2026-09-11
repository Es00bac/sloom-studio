import { useMemo, useState } from 'react';
import { Check, MessageSquare, MessageSquarePlus, RotateCcw, Trash2 } from 'lucide-react';
import type { PaperDocument, PaperReviewComment } from '../../../types/paper';
import {
  countOpenPaperReviewComments,
  describePaperReviewAnchorState,
  PAPER_REVIEW_AUTHOR_MAX_LENGTH,
  PAPER_REVIEW_BODY_MAX_LENGTH,
} from '../../../lib/paperReviewComments';
import { useI18n } from '../../../lib/useI18n';

export interface PaperReviewCommentsPanelProps {
  document: PaperDocument;
  selectedPageId: string;
  onAddComment: (draft: { pageId: string; frameId?: string; author: string; body: string }) => string | undefined;
  onAddReply: (commentId: string, draft: { author: string; body: string }) => string | undefined;
  onSetResolved: (commentId: string, resolved: boolean) => void;
  onDeleteComment: (commentId: string) => void;
}

function formatReviewTime(timestamp: number): string {
  const date = new Date(timestamp);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${iso} ${time}`;
}

function pageLabel(document: PaperDocument, pageId: string): string {
  const index = document.pages.findIndex((page) => page.id === pageId);
  if (index >= 0) return `p. ${index + 1}`;
  const parent = document.parentPages.find((candidate) => candidate.id === pageId);
  return parent ? parent.name : pageId;
}

/**
 * Local in-document review comments: threads anchored to a page (optionally one frame), with
 * replies, resolved state, and honest reporting when an anchor's page or frame was deleted.
 * Comments never affect layout and never enter any export path.
 */
export function PaperReviewCommentsPanel({
  document,
  selectedPageId,
  onAddComment,
  onAddReply,
  onSetResolved,
  onDeleteComment,
}: PaperReviewCommentsPanelProps) {
  const { t, tf } = useI18n();
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(true);

  const openCount = countOpenPaperReviewComments(document);
  const visibleComments = useMemo(
    () => (document.reviewComments ?? []).filter((comment) => showResolved || !comment.resolvedAt),
    [document.reviewComments, showResolved],
  );

  const submitComment = () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) return;
    const pageId = document.pages.some((page) => page.id === selectedPageId)
      ? selectedPageId
      : document.pages[0]?.id;
    if (!pageId) return;
    const created = onAddComment({ pageId, author: author.trim(), body: trimmedBody });
    if (created) {
      setBody('');
      return;
    }
    setBody('');
  };

  const submitReply = (commentId: string) => {
    const trimmed = (replyDrafts[commentId] ?? '').trim();
    if (!trimmed) return;
    const created = onAddReply(commentId, { author: author.trim(), body: trimmed });
    setReplyDrafts((current) => ({ ...current, [commentId]: created ? '' : trimmed }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-xs text-cyan-100/75" data-paper-review-comments-panel="true">
      <div className="border-b border-cyan-300/10 px-3 py-2 text-[11px] leading-4 text-cyan-100/45">
        {t('paper.reviewComments.help')}
      </div>

      <div className="space-y-2 border-b border-cyan-300/10 p-2" data-review-composer="true">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">
            {tf('paper.reviewComments.openCount', { count: openCount })}
          </div>
          <button
            className="rounded border border-cyan-300/20 px-2 py-0.5 text-[10px] text-cyan-100/60 hover:bg-cyan-400/10"
            onClick={() => setShowResolved((current) => !current)}
            type="button"
          >
            {showResolved ? t('paper.reviewComments.hideResolved') : t('paper.reviewComments.showResolved')}
          </button>
        </div>
        <input
          aria-label={t('paper.reviewComments.authorLabel')}
          className="w-full rounded border border-cyan-300/15 bg-[#0b1420] px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-300/40"
          maxLength={PAPER_REVIEW_AUTHOR_MAX_LENGTH}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder={t('paper.reviewComments.authorPlaceholder')}
          value={author}
        />
        <textarea
          aria-label={t('paper.reviewComments.bodyLabel')}
          className="min-h-16 w-full resize-y rounded border border-cyan-300/15 bg-[#0b1420] px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-300/40"
          maxLength={PAPER_REVIEW_BODY_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          placeholder={tf('paper.reviewComments.bodyPlaceholder', { page: pageLabel(document, selectedPageId) })}
          rows={3}
          value={body}
        />
        <button
          className="inline-flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1 text-[10px] font-semibold text-cyan-100/70 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!body.trim()}
          onClick={submitComment}
          type="button"
        >
          <MessageSquarePlus size={11} /> {t('paper.reviewComments.add')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {visibleComments.length === 0 ? (
          <div className="px-1 py-6 text-center text-[11px] text-cyan-100/35">
            {t('paper.reviewComments.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleComments.map((comment) => (
              <ReviewCommentThread
                comment={comment}
                confirmDelete={() => setConfirmingDeleteId(comment.id)}
                deleting={confirmingDeleteId === comment.id}
                document={document}
                key={comment.id}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                onReplyChange={(value) => setReplyDrafts((current) => ({ ...current, [comment.id]: value }))}
                onResolve={() => onSetResolved(comment.id, true)}
                onReply={() => submitReply(comment.id)}
                onReopen={() => onSetResolved(comment.id, false)}
                onRequestDelete={() => onDeleteComment(comment.id)}
                replyDraft={replyDrafts[comment.id] ?? ''}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCommentThread({
  comment,
  confirmDelete,
  deleting,
  document,
  onCancelDelete,
  onReopen,
  onReply,
  onReplyChange,
  onRequestDelete,
  onResolve,
  replyDraft,
}: {
  comment: PaperReviewComment;
  confirmDelete: () => void;
  deleting: boolean;
  document: PaperDocument;
  onCancelDelete: () => void;
  onReopen: () => void;
  onReply: () => void;
  onReplyChange: (value: string) => void;
  onRequestDelete: () => void;
  onResolve: () => void;
  replyDraft: string;
}) {
  const { t, tf } = useI18n();
  const anchorState = describePaperReviewAnchorState(document, comment);
  const resolved = Boolean(comment.resolvedAt);

  return (
    <section
      className={`overflow-hidden rounded-md border bg-[#0d1725]/80 ${resolved ? 'border-cyan-300/10 opacity-60' : 'border-cyan-300/15'}`}
      data-paper-review-comment-id={comment.id}
    >
      <div className="flex items-start justify-between gap-2 border-b border-cyan-300/10 px-2 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <MessageSquare aria-hidden="true" className="shrink-0 text-cyan-200/45" size={12} />
            <span className="truncate text-[11px] font-semibold text-cyan-50/85">{comment.author}</span>
            <span className="shrink-0 text-[10px] text-cyan-100/35">{formatReviewTime(comment.createdAt)}</span>
            {resolved
              ? <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-200/90">{t('paper.reviewComments.resolvedBadge')}</span>
              : null}
          </div>
          <div className="mt-0.5 text-[10px] text-cyan-100/40" data-review-anchor-state={anchorState}>
            {anchorState === 'anchored' && tf('paper.reviewComments.anchorPage', { page: pageLabel(document, comment.pageId) })}
            {anchorState === 'page-missing' && t('paper.reviewComments.anchorPageMissing')}
            {anchorState === 'frame-missing' && t('paper.reviewComments.anchorFrameMissing')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {resolved ? (
            <button
              aria-label={t('paper.reviewComments.reopen')}
              className="rounded border border-cyan-300/20 p-1 text-cyan-100/60 hover:bg-cyan-400/10"
              onClick={onReopen}
              title={t('paper.reviewComments.reopen')}
              type="button"
            >
              <RotateCcw size={11} />
            </button>
          ) : (
            <button
              aria-label={t('paper.reviewComments.resolve')}
              className="rounded border border-emerald-300/25 p-1 text-emerald-200/80 hover:bg-emerald-400/10"
              onClick={onResolve}
              title={t('paper.reviewComments.resolve')}
              type="button"
            >
              <Check size={11} />
            </button>
          )}
          {deleting ? (
            <button
              className="rounded border border-rose-300/40 bg-rose-500/15 px-1.5 py-1 text-[10px] font-semibold text-rose-100 hover:bg-rose-500/25"
              data-review-delete-confirm="true"
              onClick={onRequestDelete}
              type="button"
            >
              {t('paper.reviewComments.deleteConfirm')}
            </button>
          ) : (
            <button
              aria-label={t('paper.reviewComments.delete')}
              className="rounded border border-cyan-300/20 p-1 text-cyan-100/60 hover:bg-cyan-400/10"
              onClick={confirmDelete}
              title={t('paper.reviewComments.delete')}
              type="button"
            >
              <Trash2 size={11} />
            </button>
          )}
          {deleting ? (
            <button
              className="rounded border border-cyan-300/20 px-1.5 py-1 text-[10px] text-cyan-100/60 hover:bg-cyan-400/10"
              onClick={onCancelDelete}
              type="button"
            >
              {t('paper.reviewComments.deleteCancel')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-2 py-1.5 text-[11px] leading-5 text-cyan-100/80">{comment.body}</div>

      {comment.replies.length > 0 ? (
        <div className="space-y-1 border-t border-cyan-300/10 px-2 py-1.5">
          {comment.replies.map((reply) => (
            <div className="flex items-start gap-1.5" data-paper-review-reply-id={reply.id} key={reply.id}>
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-cyan-100/55">{reply.author}</span>
              <span className="min-w-0 text-[11px] leading-5 text-cyan-100/70">{reply.body}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-t border-cyan-300/10 p-1.5">
        <input
          aria-label={t('paper.reviewComments.replyLabel')}
          className="min-w-0 flex-1 rounded border border-cyan-300/15 bg-[#0b1420] px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-300/40"
          maxLength={PAPER_REVIEW_BODY_MAX_LENGTH}
          onChange={(event) => onReplyChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onReply();
            }
          }}
          placeholder={t('paper.reviewComments.replyPlaceholder')}
          value={replyDraft}
        />
        <button
          className="shrink-0 rounded border border-cyan-300/20 px-2 py-1 text-[10px] font-semibold text-cyan-100/70 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!replyDraft.trim()}
          onClick={onReply}
          type="button"
        >
          {t('paper.reviewComments.reply')}
        </button>
      </div>
    </section>
  );
}
