import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../../../types/paper';
import {
  isPaperTiltmarkPaintFrame,
  PAPER_TILTMARK_PAINT_FORMAT,
} from './PaperTiltmarkCanvasLayer';

describe('Paper Tiltmark paint-frame identity', () => {
  it('recognizes only managed Image frames carrying the Tiltmark paint format', () => {
    const paintFrame = {
      kind: 'image',
      asset: { format: PAPER_TILTMARK_PAINT_FORMAT },
    } as PaperFrame;
    const ordinaryImage = {
      kind: 'image',
      asset: { format: 'png' },
    } as PaperFrame;
    const nonImage = {
      kind: 'shape',
      asset: { format: PAPER_TILTMARK_PAINT_FORMAT },
    } as PaperFrame;

    expect(isPaperTiltmarkPaintFrame(paintFrame)).toBe(true);
    expect(isPaperTiltmarkPaintFrame(ordinaryImage)).toBe(false);
    expect(isPaperTiltmarkPaintFrame(nonImage)).toBe(false);
  });
});
