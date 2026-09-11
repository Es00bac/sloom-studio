import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperWorkspace OS image drop wiring', () => {
  it('routes OS image file drops through the Page N imports Source Library envelope path', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).toContain('buildPaperPageImageImportPlan');
    expect(source).toContain('hasPaperPageImageFileDrag(event.dataTransfer)');
    expect(source).toContain('handleDropPaperPageImageImportFiles');
    expect(source).toContain('fileToDataUrl(planItem.file)');
    expect(source).toContain('setSourceSidebarOpen(true)');
    expect(source).toContain('Imported ${plan.items.length} image');
  });

  it('disables native HTML image dragging inside Paper image frames so move and resize stay in the app interaction model', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/<img[\s\S]*draggable=\{false\}/);
    expect(source).toMatch(/<img[\s\S]*onDragStart=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*\}\}/);
  });
});
