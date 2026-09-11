import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperWorkspace plain-frame formatting-bar promotion wiring', () => {
  it('always edits text/caption frames through the rich editor, seeded/committed via the promotion policy', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    // PaperInlineText's isEditing branch no longer special-cases "does this frame already have richText" —
    // it always renders the WYSIWYG rich editor. The only remaining <PaperEditableText> call site is
    // PaperBubbleText's (bubbles are excluded from this feature, same exclusion as the B3 keyboard shortcuts).
    expect((source.match(/<PaperEditableText/g) ?? []).length).toBe(1);

    // A plain frame is lifted into a single-run seed for the editor's initial DOM...
    expect(source).toContain("ensureRichTextForTransform(frame.richText, frame.text ?? '')");
    // ...and the commit path runs the pure promotion policy (richTextTransforms.ts) rather than always
    // persisting richText — this is what makes "entering edit mode alone" a non-migrating no-op.
    expect(source).toContain('resolveRichEditorCommit(richText, frame.richText');
    expect(source).toContain("from './richTextTransforms'");
  });
});
