import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('FlowSourceBinSidebar production dialog wiring', () => {
  it('uses the themed text-input dialog instead of browser prompts for bin naming', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('window.prompt');
    expect(source).toContain('useTextInputDialogStore');
    expect(source).toContain('requestTextInput');
    // Dialog titles are localized via the i18n catalog (bilingual en/ja).
    expect(source).toContain("t('sourceBin.dialog.newBinTitle')");
    expect(source).toContain("t('sourceBin.dialog.renameBinTitle')");
  });

  it('provides both English and Japanese for the bin-naming dialog titles', () => {
    const catalog = readFileSync(new URL('../../lib/i18n.ts', import.meta.url), 'utf8');

    expect(catalog).toContain("'sourceBin.dialog.newBinTitle'");
    expect(catalog).toContain('New Source Bin');
    expect(catalog).toContain('新規ソースビン');
    expect(catalog).toContain("'sourceBin.dialog.renameBinTitle'");
    expect(catalog).toContain('Rename Source Bin');
    expect(catalog).toContain('ソースビンの名前を変更');
  });

  it('uses a virtualized generated-pool list for large project source libraries', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('VirtualizedSourceBinList');
    expect(source).toContain('data-source-library-generated-list');
  });

  it('uses flattened virtualized rows for regular source-library bins too', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('buildSourceLibraryDisplayRows');
    expect(source).toContain('data-source-library-bin-list');
  });

  it('shows degraded Source Library storage state in the saved-assets panel', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');
    const catalog = readFileSync(new URL('../../lib/i18n.ts', import.meta.url), 'utf8');

    expect(source).toContain("durabilityStatus.state === 'degraded'");
    expect(source).toContain("t('sourceBin.durability.warningTitle')");
    expect(catalog).toContain('Source Library storage needs attention');
    expect(catalog).toContain('復旧用コピー');
  });

  it('marks the docked Flow-workspace panel so insertion placement can measure and avoid it (MH-094/MH-097 P2: nodes land hidden under the bin)', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    // The only real caller (SharedWorkspaceDockablePanels) always passes `dockable` — the
    // panel is an absolute-positioned overlay atop the canvas either way, so this must not be
    // gated on `dockable` or the marker never appears in the running app.
    expect(source).toContain("data-flow-source-bin-panel={workspaceView === 'flow' ? 'true' : undefined}");
  });

  it('uses one compact functional header instead of repeating a title and explanatory paragraph', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-source-bin-compact-header="true"');
    expect(source).not.toContain("t('sourceBin.saved.eyebrow')");
    expect(source).not.toContain("t('sourceBin.saved.title')");
    expect(source).not.toContain("t('sourceBin.saved.desc')");
    expect(source).toContain(`aria-label={t('sourceBin.newBin')}`);
    expect(source).toContain(`aria-label={t('sourceBin.collapseAll')}`);
    expect(source).toContain(`aria-label={t('sourceBin.expandAll')}`);
  });

  it('opens the cross-project catalogue dialog from the Source Bin header (MH-085)', () => {
    const source = readFileSync(new URL('./FlowSourceBinSidebar.tsx', import.meta.url), 'utf8');

    expect(source).toContain('SourceCatalogDialog');
    expect(source).toContain('data-source-catalog-open="true"');
    expect(source).toContain("t('sourceCatalog.openAction')");
    expect(source).toContain('setCatalogOpen(true)');
    expect(source).toContain('<SourceCatalogDialog onClose={() => setCatalogOpen(false)} />');
  });

  it('records every canonical project save/open into the cross-project catalogue (MH-085)', () => {
    const actions = readFileSync(new URL('../../lib/projectDocumentActions.ts', import.meta.url), 'utf8');

    // The single save/autosave/export funnel records its Source Library metadata.
    expect(actions).toContain('recordSourceCatalogProjectDocument(finalDocument)');
    // A settled project replacement makes the opened project active and records it.
    expect(actions).toContain('noteActiveSourceCatalogProjectDocument(transaction.document)');
  });
});
