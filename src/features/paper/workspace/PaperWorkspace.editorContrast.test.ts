import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperWorkspace in-canvas text editor contrast wiring', () => {
  it('resolves the editing surface backdrop from editorContrast instead of a hardcoded white box', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    // The bug: the editor overlay used to hardcode a near-opaque white box behind the caret regardless of the
    // frame's own colours, so light typography (e.g. white sidebar text) went invisible — white on white. That
    // literal class must be gone from the workspace source.
    expect(source).not.toContain('bg-white/95');

    // The fix routes the backdrop decision through the pure contrast util, and actually consumes its result
    // (not just imports it unused).
    expect(source).toContain("from './editorContrast'");
    expect(source).toContain('resolveEditorBackdrop(');
    expect(source).toContain('backdrop.needsBackdrop');
    expect(source).toContain('backdrop.backdropColor');

    // The frame's effective background (fill over the page/document background) has to reach the decision —
    // wired down from the document background through PaperFrameView to the editing components.
    expect(source).toContain('pageBackgroundCss');
    expect(source).toContain('paperDocumentBackgroundCss(doc.background)');
  });
});
