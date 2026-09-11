import type { PaperFrame } from '../types/paper';

// Threaded text: a story's full text lives on the thread's *head* frame; the remaining member frames
// render the flowed continuation (computed by paperTextFlow). Membership mirrors the proven bubble-chain
// model (`paperBubbleChains.ts`): a shared `threadId` plus an optional `threadOrder`.

interface ThreadCandidate {
  frame: PaperFrame;
  sourceIndex: number;
}

export function isPaperTextThreadFrame(frame: PaperFrame): boolean {
  return frame.kind === 'text' && Boolean(frame.threadId);
}

export function getPaperTextThreadFrames(frames: PaperFrame[], threadId: string): PaperFrame[] {
  return frames
    .map((frame, sourceIndex) => ({ frame, sourceIndex }))
    .filter((candidate) => candidate.frame.threadId === threadId && isPaperTextThreadFrame(candidate.frame))
    .sort(compareThreadCandidates)
    .map((candidate) => candidate.frame);
}

export function getPaperTextThreadHeadFrame(frames: PaperFrame[], threadId: string): PaperFrame | undefined {
  return getPaperTextThreadFrames(frames, threadId)[0];
}

/** The whole story text of a thread, stored on its head frame. */
export function getPaperTextThreadStory(frames: PaperFrame[], threadId: string): string {
  return getPaperTextThreadHeadFrame(frames, threadId)?.text ?? '';
}

/** Sequential thread order for a selection, in the order the frames were chosen. */
export function assignPaperTextThreadOrder(frameIds: string[]): Array<{ id: string; threadOrder: number }> {
  return frameIds.map((id, index) => ({ id, threadOrder: index + 1 }));
}

function compareThreadCandidates(a: ThreadCandidate, b: ThreadCandidate): number {
  return (
    compareOrder(a.frame.threadOrder, b.frame.threadOrder)
    || a.frame.yMm - b.frame.yMm
    || a.frame.xMm - b.frame.xMm
    || a.sourceIndex - b.sourceIndex
  );
}

function compareOrder(a: number | undefined, b: number | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return 0;
}
