import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Paper Source Library shipping caller', () => {
  it('publishes only the rasterized exact-font payload and has no raw-SVG fallback', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const exportPaperPageToSourceLibrary = useCallback');
    const end = source.indexOf('const sendPaperPageToSourceLibraryById', start);
    const caller = source.slice(start, end);

    expect(caller).toContain('buildPaperDocumentExactManagedFontOutput');
    expect(caller).toContain('publishRasterizedPaperPageSourcePayload');
    expect(caller).toContain('fontFaceCss: exact.fontFaceCss');
    expect(caller).not.toContain('svgExport.dataUrl');
    expect(caller).not.toMatch(/catch\s*\{/);
  });

  it('routes all-pages envelopes through the prepare-all transaction before Source Library publication', () => {
    const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const exportAllPagesToSourceEnvelope = useCallback');
    const end = source.indexOf('const runWebcomicImageExport', start);
    const caller = source.slice(start, end);

    expect(caller).toContain('buildPaperDocumentExactManagedFontOutput');
    expect(caller).toContain('publishRasterizedPaperPagesSourcePayloads');
    expect(caller).not.toContain('await exportPaperPageToSourceLibrary(');
  });
});
