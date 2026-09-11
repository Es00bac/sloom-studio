import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  assignPaperTextThreadOrder,
  getPaperTextThreadFrames,
  getPaperTextThreadStory,
  isPaperTextThreadFrame,
} from './paperTextThreads';

const frame = (patch: Partial<PaperFrame>): PaperFrame => ({
  id: 'f', kind: 'text', xMm: 0, yMm: 0, widthMm: 50, heightMm: 30, text: '', ...patch,
} as PaperFrame);

describe('paper text threads', () => {
  it('recognises a text frame that belongs to a thread', () => {
    expect(isPaperTextThreadFrame(frame({ threadId: 't1' }))).toBe(true);
    expect(isPaperTextThreadFrame(frame({}))).toBe(false);
    expect(isPaperTextThreadFrame(frame({ kind: 'speechBubble', threadId: 't1' }))).toBe(false);
  });

  it('orders thread members by threadOrder, then position, then source order', () => {
    const frames = [
      frame({ id: 'b', threadId: 't1', threadOrder: 2 }),
      frame({ id: 'a', threadId: 't1', threadOrder: 1 }),
      frame({ id: 'other', threadId: 't2', threadOrder: 1 }),
      frame({ id: 'c', threadId: 't1', threadOrder: 3 }),
    ];
    expect(getPaperTextThreadFrames(frames, 't1').map((member) => member.id)).toEqual(['a', 'b', 'c']);
  });

  it('reads the whole story from the thread head frame', () => {
    const frames = [
      frame({ id: 'head', threadId: 't1', threadOrder: 1, text: 'the whole story' }),
      frame({ id: 'tail', threadId: 't1', threadOrder: 2, text: 'ignored continuation' }),
    ];
    expect(getPaperTextThreadStory(frames, 't1')).toBe('the whole story');
  });

  it('assigns sequential thread order to a selection', () => {
    expect(assignPaperTextThreadOrder(['x', 'y', 'z'])).toEqual([
      { id: 'x', threadOrder: 1 },
      { id: 'y', threadOrder: 2 },
      { id: 'z', threadOrder: 3 },
    ]);
  });
});
