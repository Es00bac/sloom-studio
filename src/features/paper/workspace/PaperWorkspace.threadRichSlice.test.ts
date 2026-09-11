import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// FBL-023 render-seam wiring guard. PaperFrameView / PaperInlineText / PaperRichTextView are not exported, so
// (as with the plain-frame promotion guard) we pin the production seam by reading the source. Each assertion
// would FAIL against the pre-fix code, which rendered the whole stored `frame.richText` on the head and dropped
// rich formatting on continuations.
describe('PaperWorkspace threaded rich-slice render wiring', () => {
  const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

  it('resolves derived catalog/condition content before feeding each frame its thread-computed rich slice', () => {
    expect(source).toContain("import { resolvePaperFramesTextTemplates } from '../../../lib/paperTextVariables'");
    expect(source).toMatch(/const displayFrames = resolvePaperFramesTextTemplates\(outputFrames, doc, slot\.page\.pageNumber\)/);
    expect(source).toMatch(/const threadSlices = computePaperThreadSlices\(displayFrames, paperThreadTextMeasurer\)/);
  });

  it('renders the EFFECTIVE (sliced) rich text, not always the stored head richText', () => {
    // Head shows only its own slice; a continuation (no stored richText of its own) shows the slice it was handed.
    expect(source).toContain('displayRichText ?? frame.richText');
    expect(source).toMatch(/paragraphs=\{effectiveRichText\}/);
  });

  it('passes explicit paragraphs into PaperRichTextView instead of reading frame.richText internally', () => {
    expect(source).toMatch(/function PaperRichTextView\([\s\S]*?paragraphs,/);
  });

  it('keeps continuation frames non-editable while routing rich ones through the read-only rich renderer', () => {
    // Editability still excludes thread continuations and tables...
    expect(source).toContain('isPaperInlineTextFrame(frame) && !isThreadContinuation && !frame.table');
    // ...and a rich continuation reaches the rich renderer without ever becoming editable.
    expect(source).toContain('richThreadContinuation');
  });

  it('suppresses rich paragraph start/end paint unless the computed fragment owns that boundary', () => {
    expect(source).toContain('paragraph.ownsParagraphStart');
    expect(source).toContain('paragraph.ownsParagraphEnd');
    expect(source).toMatch(/const dropCapLines = ownsParagraphStart/);
    expect(source).toMatch(/const spaceAfter = ownsParagraphEnd/);
  });

  it('keeps the stored editable frame outside the derived display transform', () => {
    expect(source).toContain('const displayFrame = displayFrameById.get(frame.id) ?? frame');
    expect(source).toContain('displayRichText={threadSlice?.richText ?? displayFrame.richText}');
    expect(source).toContain('frame={frame}');
  });
});
