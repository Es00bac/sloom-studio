import type { PaperDocument, PaperTrackChange } from '../types/paper';

export const PAPER_TRACK_CHANGE_LIMITS = { maxChanges: 512, maxTextLength: 100_000, maxAuthorLength: 96 } as const;

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

export function normalizePaperTrackChanges(value: unknown): PaperTrackChange[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, PAPER_TRACK_CHANGE_LIMITS.maxChanges).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const id = cleanText(raw.id, 96).trim();
    const pageId = cleanText(raw.pageId, 96).trim();
    const frameId = cleanText(raw.frameId, 96).trim();
    const kind = raw.kind === 'delete' ? 'delete' : raw.kind === 'insert' ? 'insert' : undefined;
    const status = raw.status === 'accepted' || raw.status === 'rejected' ? raw.status : 'pending';
    if (!id || ids.has(id) || !pageId || !frameId || !kind) return [];
    ids.add(id);
    return [{ id, pageId, frameId, kind, beforeText: cleanText(raw.beforeText, PAPER_TRACK_CHANGE_LIMITS.maxTextLength), afterText: cleanText(raw.afterText, PAPER_TRACK_CHANGE_LIMITS.maxTextLength), author: cleanText(raw.author, PAPER_TRACK_CHANGE_LIMITS.maxAuthorLength).trim() || 'Anonymous', createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0, status }];
  });
}

export function applyPaperTrackChange(document: PaperDocument, change: PaperTrackChange, decision: 'accept' | 'reject'): PaperDocument {
  const page = document.pages.find((candidate) => candidate.id === change.pageId);
  const frame = page?.frames.find((candidate) => candidate.id === change.frameId);
  if (!page || !frame) return document;
  const text = decision === 'accept' ? change.afterText : change.beforeText;
  const changes = (document.trackChanges ?? []).map((candidate) => candidate.id === change.id ? { ...candidate, status: decision === 'accept' ? 'accepted' as const : 'rejected' as const } : candidate);
  return {
    ...document,
    pages: document.pages.map((candidate) => candidate.id === page.id
      ? { ...candidate, frames: candidate.frames.map((item) => item.id === frame.id ? { ...item, text, richText: undefined } : item) }
      : candidate),
    trackChanges: changes,
    updatedAt: Date.now(),
  };
}
