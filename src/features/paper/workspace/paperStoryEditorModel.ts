import type { PaperDocument, PaperFrame } from '../../../types/paper';
import { flattenPaperRichText } from '../../../lib/paperRichText';
import { paperFrameLayerIsLocked } from '../../../lib/paperLayers';

const STORY_FRAME_KINDS = new Set<PaperFrame['kind']>([
  'text',
  'caption',
  'speechBubble',
  'thoughtBubble',
]);

export interface PaperStoryFrameRef {
  frame: PaperFrame;
  pageId: string;
  pageNumber: number;
}

export interface PaperStoryEditorEntry {
  id: string;
  label: string;
  head: PaperStoryFrameRef;
  frames: PaperStoryFrameRef[];
  text: string;
  hasRichText: boolean;
  editable: boolean;
}

export function collectPaperStoryEditorEntries(document: PaperDocument): PaperStoryEditorEntry[] {
  const candidates = document.pages.flatMap((page) => page.frames
    .filter((frame) => STORY_FRAME_KINDS.has(frame.kind))
    .map((frame) => ({ frame, pageId: page.id, pageNumber: page.pageNumber })));
  const threaded = new Map<string, PaperStoryFrameRef[]>();
  const unthreaded: PaperStoryFrameRef[] = [];
  for (const candidate of candidates) {
    if (candidate.frame.kind === 'text' && candidate.frame.threadId) {
      const group = threaded.get(candidate.frame.threadId) ?? [];
      group.push(candidate);
      threaded.set(candidate.frame.threadId, group);
    } else {
      unthreaded.push(candidate);
    }
  }

  const toEntry = (id: string, frames: PaperStoryFrameRef[]): PaperStoryEditorEntry => {
    const ordered = [...frames].sort((a, b) => (
      (a.frame.threadOrder ?? Number.MAX_SAFE_INTEGER) - (b.frame.threadOrder ?? Number.MAX_SAFE_INTEGER)
      || a.pageNumber - b.pageNumber
      || a.frame.yMm - b.frame.yMm
      || a.frame.xMm - b.frame.xMm
    ));
    const head = ordered[0];
    const hasRichText = Boolean(head.frame.richText?.length);
    const text = hasRichText ? flattenPaperRichText(head.frame.richText!) : (head.frame.text ?? '');
    const editable = !head.frame.locked && !head.frame.inherited && !paperFrameLayerIsLocked(document, head.frame);
    return {
      id,
      label: head.frame.label || `Page ${head.pageNumber} ${head.frame.kind}`,
      head,
      frames: ordered,
      text,
      hasRichText,
      editable,
    };
  };

  return [
    ...[...threaded.entries()].map(([threadId, frames]) => toEntry(`thread:${threadId}`, frames)),
    ...unthreaded.map((frame) => toEntry(`frame:${frame.frame.id}`, [frame])),
  ].sort((a, b) => (
    a.head.pageNumber - b.head.pageNumber
    || a.head.frame.yMm - b.head.frame.yMm
    || a.head.frame.xMm - b.head.frame.xMm
  ));
}

export function paperStoryEntryForFrame(
  entries: readonly PaperStoryEditorEntry[],
  frameId: string | null | undefined,
): PaperStoryEditorEntry | undefined {
  return frameId ? entries.find((entry) => entry.frames.some((item) => item.frame.id === frameId)) : undefined;
}
