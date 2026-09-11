import { describe, expect, it } from 'vitest';
import {
  buildFrameFixPrompt,
  buildFrameFixReferences,
  canFrameBeAiFixed,
  collectFrameFixSiblingCandidates,
  normalizeFrameFixMarquee,
} from './paperFrameFix';
import type { PaperFrame } from '../types/paper';

function imageFrame(id: string, sourceBinItemId?: string): PaperFrame {
  return {
    id,
    kind: 'image',
    label: `Panel ${id}`,
    xMm: 0,
    yMm: 0,
    widthMm: 60,
    heightMm: 60,
    rotationDeg: 0,
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    ...(sourceBinItemId ? { asset: { sourceBinItemId, label: `Art ${id}`, kind: 'image' as const } } : {}),
  } as PaperFrame;
}

describe('paper AI frame fix core', () => {
  it('collects only sibling frames that carry image art', () => {
    const page = {
      frames: [
        imageFrame('target', 'data:image/png;base64,TARGET'),
        imageFrame('good-1', 'data:image/png;base64,GOOD1'),
        imageFrame('empty'),
        imageFrame('good-2', 'data:image/png;base64,GOOD2'),
      ],
    };

    const sourceItems = [
      { id: 'data:image/png;base64,TARGET', assetUrl: 'data:image/png;base64,TARGET' },
      { id: 'data:image/png;base64,GOOD1', assetUrl: 'data:image/png;base64,GOOD1' },
      { id: 'data:image/png;base64,GOOD2', assetUrl: 'data:image/png;base64,GOOD2' },
    ];
    const candidates = collectFrameFixSiblingCandidates(page, 'target', sourceItems);
    expect(candidates.map((candidate) => candidate.frameId)).toEqual(['good-1', 'good-2']);
    expect(candidates[0]).toMatchObject({ label: 'Panel good-1', imageUrl: 'data:image/png;base64,GOOD1' });
  });

  it('builds a prompt that frames references as correct examples and scopes the fix', () => {
    const prompt = buildFrameFixPrompt({
      correctDescription: 'Wren has a scar over her LEFT eye and copper hair.',
      incorrectDescription: 'The scar is on the wrong eye and the hair is brown.',
      referenceCount: 2,
    });

    expect(prompt).toContain('2 attached reference images show');
    expect(prompt).toContain('Correct appearance: Wren has a scar over her LEFT eye');
    expect(prompt).toContain('Fix this problem: The scar is on the wrong eye');
    expect(prompt).toContain('Preserve everything else');
  });

  it('normalizes marquee drags from any corner and rejects degenerate rects', () => {
    expect(normalizeFrameFixMarquee({ xPercent: 80, yPercent: 70 }, { xPercent: 20, yPercent: 10 }))
      .toEqual({ xPercent: 20, yPercent: 10, widthPercent: 60, heightPercent: 60 });
    expect(normalizeFrameFixMarquee({ xPercent: -20, yPercent: 50 }, { xPercent: 120, yPercent: 60 }))
      .toEqual({ xPercent: 0, yPercent: 50, widthPercent: 100, heightPercent: 10 });
    expect(normalizeFrameFixMarquee({ xPercent: 40, yPercent: 40 }, { xPercent: 40.5, yPercent: 90 })).toBeNull();
  });

  it('maps selected siblings to generative-fill references with correct-example descriptions', () => {
    const references = buildFrameFixReferences([
      { frameId: 'good-1', label: 'Panel 2', imageUrl: 'data:image/png;base64,GOOD1' },
    ]);
    expect(references).toEqual([
      expect.objectContaining({
        id: 'good-1',
        label: 'Panel 2',
        imageUrl: 'data:image/png;base64,GOOD1',
        description: expect.stringContaining('Correct example 1'),
      }),
    ]);
  });

  it('gates the context-menu entry on frames with raster art', () => {
    expect(canFrameBeAiFixed(imageFrame('a', 'source-a'))).toBe(true);
    expect(canFrameBeAiFixed(imageFrame('b'))).toBe(false);
    expect(canFrameBeAiFixed(undefined)).toBe(false);
  });
});
