import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PaperTopStrip } from './PaperWorkspace';

const noop = vi.fn();

describe('PaperTopStrip titlebar placement', () => {
  it('keeps export progress and the exact result path visible outside the Inspector', () => {
    const source = readFileSync(join(process.cwd(), 'src/features/paper/workspace/PaperWorkspace.tsx'), 'utf8');

    expect(source).toContain('function PaperExportStatusNotice');
    expect(source).toContain('data-paper-export-status="true"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('notice.path');
    expect(source).toContain('nativeBridge.openPath(notice.path)');
  });

  it('routes the top-strip EPUB action through the guarded Paper export command', () => {
    const source = readFileSync(join(process.cwd(), 'src/features/paper/workspace/PaperWorkspace.tsx'), 'utf8');

    expect(source).toContain("case 'paper:export-epub':");
    expect(source).toContain("confirmPreflightBeforeExport('reflowable EPUB export', { rasterTarget: true })");
    expect(source).toContain('void exportPaperEpubAndSave(document, setStatus);');
    expect(source).toContain("onExportEpub={() => runPaperTopStripCommand('paper:export-epub')}");
    expect(source).toContain("description={t('paper.export.desc.epub')}");
  });

  it('renders the Paper document/export controls for the app titlebar slot', () => {
    const html = renderToStaticMarkup(
      <PaperTopStrip
        docTitle="Chronicle"
        onAddPage={noop}
        onDuplicatePage={noop}
        onExportCbz={noop}
        onExportIdml={noop}
        onExportJson={noop}
        onExportKdpAssets={noop}
        onExportPageToImage={noop}
        onExportPageToSource={noop}
        onExportPagesToEnvelope={noop}
        onExportPdf={noop}
        onExportAccessiblePdf={noop}
        onExportEpub={noop}
        onExportReaderSpreadsPdf={noop}
        onExportBookletProofPdf={noop}
        onExportStoriesDocx={noop}
        onExportStoriesHtml={noop}
        onExportStoriesRtf={noop}
        onExportStoriesTxt={noop}
        onExportWebcomicImages={noop}
        onFinalizePrintUpscale={noop}
        onImportJson={noop}
        onNew={noop}
        onPackagePrint={noop}
        onShowPreflight={noop}
        showPreflight={false}
        onShowFindChange={noop}
        showFindChange={false}
        onToggleGrid={noop}
        onToggleGuides={noop}
        onToggleTextBaselines={noop}
        onToggleFrameEdges={noop}
        onToggleSnapToGrid={noop}
        onToggleSnapToGuides={noop}
        onToggleInspector={noop}
        onToggleRulers={noop}
        onToggleSpreads={noop}
        onToggleStartOnRight={noop}
        onToggleRtlBinding={noop}
        onToggleToolbar={noop}
        onZoomIn={noop}
        onZoomOut={noop}
        placement="titlebar"
        preflightStatus={{
          tone: 'warning',
          label: '3 warnings',
          countsLabel: '3 warnings, 1 info',
          detail: 'Preflight found 3 warnings. First: No bleed configured',
        }}
        showGrid={false}
        showFrameEdges={false}
        showGuides
        showTextBaselines={false}
        showInspector
        showRulers
        showSpreads
        showToolbar
        snapToGrid={false}
        snapToGuides
        startOnRight={false}
        rtlBinding={false}
        zoom={1.59}
      />,
    );

    expect(html).toContain('data-paper-topbar-controls="true"');
    expect(html).toContain('data-paper-topbar-placement="titlebar"');
    expect(html).toContain('data-paper-document-title="Chronicle"');
    expect(html).not.toContain('Paper layout and print export');
    expect(html).toContain('aria-label="Export Document"');
    expect(html).toContain('data-paper-preflight-status="true"');
    expect(html).toContain('data-paper-preflight-tone="warning"');
    expect(html).toContain('3 warnings');
    expect(html).toContain('Preflight found 3 warnings');
    expect(html).toContain('data-compact-toolbar-menu="View"');
    expect(html).toContain('data-compact-toolbar-menu="Panels"');
    expect(html).toContain('data-compact-toolbar-menu="159%"');
    expect(html).toContain('data-paper-topbar-grouped-controls="true"');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('overflow-x-auto');
    expect(html).toContain('min-w-0');
    expect(html).toContain('shrink-0');
  });

  it('marks the preflight button when the panel is visible', () => {
    const html = renderToStaticMarkup(
      <PaperTopStrip
        docTitle="Chronicle"
        onAddPage={noop}
        onDuplicatePage={noop}
        onExportCbz={noop}
        onExportIdml={noop}
        onExportJson={noop}
        onExportKdpAssets={noop}
        onExportPageToImage={noop}
        onExportPageToSource={noop}
        onExportPagesToEnvelope={noop}
        onExportPdf={noop}
        onExportAccessiblePdf={noop}
        onExportEpub={noop}
        onExportReaderSpreadsPdf={noop}
        onExportBookletProofPdf={noop}
        onExportStoriesDocx={noop}
        onExportStoriesHtml={noop}
        onExportStoriesRtf={noop}
        onExportStoriesTxt={noop}
        onExportWebcomicImages={noop}
        onFinalizePrintUpscale={noop}
        onImportJson={noop}
        onNew={noop}
        onPackagePrint={noop}
        onShowPreflight={noop}
        showPreflight
        onShowFindChange={noop}
        showFindChange={false}
        onToggleGrid={noop}
        onToggleGuides={noop}
        onToggleTextBaselines={noop}
        onToggleFrameEdges={noop}
        onToggleSnapToGrid={noop}
        onToggleSnapToGuides={noop}
        onToggleInspector={noop}
        onToggleRulers={noop}
        onToggleSpreads={noop}
        onToggleStartOnRight={noop}
        onToggleRtlBinding={noop}
        onToggleToolbar={noop}
        onZoomIn={noop}
        onZoomOut={noop}
        placement="titlebar"
        preflightStatus={{
          tone: 'ready',
          label: 'Ready',
          countsLabel: 'No issues',
          detail: 'No Paper preflight issues detected.',
        }}
        showGrid={false}
        showFrameEdges={false}
        showGuides
        showTextBaselines
        showInspector
        showRulers
        showSpreads
        showToolbar
        snapToGrid={false}
        snapToGuides
        startOnRight={false}
        rtlBinding={false}
        zoom={1}
      />,
    );

    expect(html).toContain('data-paper-preflight-visible="true"');
  });
});
