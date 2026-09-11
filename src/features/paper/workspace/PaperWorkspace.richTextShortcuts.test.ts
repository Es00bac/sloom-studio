import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperRichEditableText Ctrl/Cmd+B/I/U keyboard shortcuts', () => {
  it('wires Ctrl/Cmd+B/I/U to the same runCommand the floating toolbar\'s B/I/U buttons already use', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    // The toolbar buttons' own tooltips ("Bold (Ctrl+B)" etc.) already advertised this shortcut — this
    // asserts the keydown handler actually implements it now, not just the tooltip claiming it does.
    expect(source).toContain("event.metaKey || event.ctrlKey");
    expect(source).toContain("runCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline')");
    expect(source).toContain("<PaperContextualToolbarButton onApply={() => runCommand('bold')}");
    expect(source).toContain("<PaperContextualToolbarButton onApply={() => runCommand('italic')}");
    expect(source).toContain('runPaperRichEditorCommand({');
    expect(source).toContain('authenticateFace: ensurePaperImportedFontRegistered');
  });
});

describe('PaperRichEditableText font library', () => {
  it('uses the managed bundled face browser instead of the legacy seven-font dropdown', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<PaperBundledFontFaceBrowser');
    expect(source).toContain('applyBundledFontFace(');
    expect(source).not.toContain('PAPER_RICH_FONT_CHOICES');
  });
});

describe('Paper unified rich typesetting surfaces', () => {
  it('keeps an advanced selection panel and routes the Inspector through the active rich editor bridge', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<PaperRichAdvancedTypePanel');
    expect(source).toContain('Advanced character, paragraph, and Japanese typesetting');
    expect(source).toMatch(/resolvePaperRichEditorTypographyUpdate\(\s*frame\.id,\s*frame\.typography,\s*typography,\s*frame\.richText,\s*operationContext,\s*\)/);
    expect(source).toContain('data-paper-rich-inspector="true"');
    expect(source).toContain("label={t('paper.richType.selectedTextColour')}");
    expect(source).not.toContain('aria-label="Text colour"');
    expect(source).toContain("<option value=\"normal\">{t('paper.richType.kerningMetrics')}</option>");
    expect(source).not.toContain('<option value="normal">Metrics</option>');
  });
});
