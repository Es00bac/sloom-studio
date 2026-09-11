import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PaperWorkspace text-input dialog wiring', () => {
  it('uses the themed async text-input dialog instead of browser prompts', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('window.prompt');
    expect(source).toContain('useTextInputDialogStore');
    expect(source).toContain('New Paper Document');
    expect(source).toContain('Export Paper Pages Envelope');
    expect(source).toContain('New Parent Page');
  });
});
