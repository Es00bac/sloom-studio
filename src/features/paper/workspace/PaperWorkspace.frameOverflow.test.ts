import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperWorkspace overset indicator + Fit Frame to Text wiring', () => {
  it('measures the real DOM through frameOverflow.ts instead of only estimating layout, and offers Fit Frame to Text', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    // The pure decision/geometry functions are imported from the dependency-free util and actually called
    // (not just imported unused).
    expect(source).toContain("from './frameOverflow'");
    expect(source).toContain('isFrameContentOverset(');
    expect(source).toContain('computeFitToTextFrameHeightMm(');

    // The live-DOM measurement hook feeds the frame content box's own scrollHeight/clientHeight (not the
    // thread-flow text estimator) into the overset decision.
    expect(source).toContain('el.scrollHeight');
    expect(source).toContain('el.clientHeight');
    expect(source).toContain('data-paper-frame-content-box');

    // The overset badge fires for plain text/caption frames whose content clips, distinct from (and not
    // double-stacked with) the pre-existing thread-overset badge.
    expect(source).toContain("Text doesn't fit this frame — right-click and choose Fit Frame to Text, or resize the frame");
    expect(source).toContain('Overset text — thread another frame to continue the story');

    // Fit Frame to Text is wired end to end: a context-menu prop, a handler that reads the measured content
    // box and routes the result through the same updateFrame store action every other frame edit uses (so
    // undo/history conventions hold), gated to text/caption frames only.
    expect(source).toContain('onFitFrameToText');
    expect(source).toContain('fitFrameToTextAction');
    expect(source).toContain("updateFrame(pageId, frameId, { heightMm: newHeightMm })");
    expect(source).toContain("frame.kind === 'text' || frame.kind === 'caption'");

    // The metric-drift fix: the file no longer hand-rounds the CSS pt->px ratio to a bare 1.333 literal in
    // its font-size/line-height/border-padding math (the exact recurring arithmetic pattern the old code
    // used) — checked narrowly so this doesn't false-positive on prose mentioning the old literal in comments.
    expect(source).toContain('const PT_TO_PX = 96 / 72;');
    expect(source).not.toContain('1.333 * zoom');
  });
});
