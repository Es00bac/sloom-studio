import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Video Paper storyboard shipping caller', () => {
  it('materializes Paper, builds the exact payload, rasterizes every page, then publishes', () => {
    const source = readFileSync(new URL('./VideoWorkspace.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const importPaperStoryboardPages = async () =>');
    const end = source.indexOf('const sendSourceItemToFlow', start);
    const caller = source.slice(start, end);

    const materialize = caller.indexOf('materializePaperDocumentAssetUrls');
    const exact = caller.indexOf('buildPaperDocumentExactManagedFontOutput');
    const publish = caller.indexOf('publishPaperStoryboardPageSourcePayloads');
    expect(materialize).toBeGreaterThan(-1);
    expect(exact).toBeGreaterThan(materialize);
    expect(publish).toBeGreaterThan(exact);
    expect(caller).toContain('fontFaceCss: exact.fontFaceCss');
    expect(caller).not.toContain('buildPaperStoryboardPageSourcePayload(');
  });

  it('pins one immutable linked-source snapshot and revalidates it before the first publish', () => {
    const source = readFileSync(new URL('./VideoWorkspace.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const importPaperStoryboardPages = async () =>');
    const end = source.indexOf('const sendSourceItemToFlow', start);
    const caller = source.slice(start, end);

    const guard = caller.indexOf('createPaperPlacedDocumentRasterizationGuard');
    const materialize = caller.indexOf('materializePaperDocumentAssetUrls');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(materialize);
    // Materialization consumes the guard's pinned snapshot, never a live/stale items array.
    expect(caller).toContain('.sourceItems');
    expect(caller).not.toMatch(/materializePaperDocumentAssetUrls\(paperDocument,\s*libraryItems\)/);
    // The guard travels to the prepare-all publisher as its pre-publish assertion.
    expect(caller).toMatch(/publishPaperStoryboardPageSourcePayloads\([\s\S]*?addAssetItem,[\s\S]*?Guard/);
  });
});
