import type { PaperDocument } from '../types/paper';
import {
  exportPaperDocumentToPrintHtml,
  effectiveRtlBinding,
  formatMm,
  escapeHtml,
} from './paperDocument';
import { buildPaperPrintProductionMetadata, type PaperPrintProductionMetadata } from './paperPrintProduction';
import { buildPaperPrintSheetPlan, paperPointsToMm, paperPrintMarksEnabled } from './paperPrintMarks';
import {
  buildPaperBookletImposition,
  buildPaperSpreads,
  exportPaperDocumentToBookletProofHtml,
  exportPaperDocumentToReaderSpreadHtml,
} from './paperSpreads';

export interface PaperPdfExportRequest {
  title: string;
  fileName: string;
  html: string;
  page: {
    widthMm: number;
    heightMm: number;
    bleedMm: number;
    dpi: number;
  };
  mode: 'pages' | 'pages-raster' | 'reader-spreads' | 'reader-spreads-raster' | 'booklet-proof' | 'booklet-proof-raster';
  production: PaperPrintProductionMetadata;
  /** Edition provenance for the PDF Producer field (licensing spec §6); set at the export call site. */
  provenanceLabel?: string;
}

export interface PaperRasterPdfPage {
  pageId: string;
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  dataUrl: string;
}

export interface PaperHtmlExportRequest {
  title: string;
  fileName: string;
  html: string;
  mode: 'reader-spreads' | 'booklet-proof';
}

export function buildPaperPdfExportRequest(document: PaperDocument): PaperPdfExportRequest {
  const includeProductionMarks = paperPrintMarksEnabled(document.printProduction.marks);
  const printSheet = includeProductionMarks ? buildPaperPrintSheetPlan(document.page, document.printProduction) : undefined;
  return {
    title: document.title,
    fileName: safePaperPdfFileName(document.title),
    html: exportPaperDocumentToPrintHtml(document, { mediaBox: includeProductionMarks ? 'bleed' : 'trim' }),
    page: {
      widthMm: printSheet ? paperPointsToMm(printSheet.mediaBox.widthPt) : document.page.widthMm,
      heightMm: printSheet ? paperPointsToMm(printSheet.mediaBox.heightPt) : document.page.heightMm,
      bleedMm: document.page.bleedMm,
      dpi: document.page.dpi,
    },
    mode: 'pages',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperRasterPdfExportRequest(
  document: PaperDocument,
  pages: PaperRasterPdfPage[],
  options: { dpi?: number } = {},
): PaperPdfExportRequest {
  const firstPage = pages[0];
  return {
    title: document.title,
    fileName: safePaperPdfFileName(document.title),
    html: exportPaperRasterPagesToPdfHtml(document, pages, { dpi: sanitizePositiveDpi(options.dpi) ?? document.page.dpi }),
    page: {
      widthMm: firstPage?.widthMm ?? document.page.widthMm,
      heightMm: firstPage?.heightMm ?? document.page.heightMm,
      bleedMm: document.page.bleedMm,
      dpi: sanitizePositiveDpi(options.dpi) ?? document.page.dpi,
    },
    mode: 'pages-raster',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperRasterReaderSpreadPdfExportRequest(document: PaperDocument, pages: PaperRasterPdfPage[]): PaperPdfExportRequest {
  return {
    title: `${document.title} Reader Spreads`,
    fileName: safePaperPdfFileName(`${document.title}-reader-spreads`),
    html: exportPaperRasterSpreadsToPdfHtml(document, pages, 'reader-spreads'),
    page: {
      widthMm: document.page.widthMm * 2,
      heightMm: document.page.heightMm,
      bleedMm: 0,
      dpi: document.page.dpi,
    },
    mode: 'reader-spreads-raster',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperRasterBookletProofPdfExportRequest(document: PaperDocument, pages: PaperRasterPdfPage[]): PaperPdfExportRequest {
  return {
    title: `${document.title} Booklet Proof`,
    fileName: safePaperPdfFileName(`${document.title}-booklet-proof`),
    html: exportPaperRasterSpreadsToPdfHtml(document, pages, 'booklet-proof'),
    page: {
      widthMm: document.page.widthMm * 2,
      heightMm: document.page.heightMm,
      bleedMm: 0,
      dpi: document.page.dpi,
    },
    mode: 'booklet-proof-raster',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperReaderSpreadPdfExportRequest(document: PaperDocument): PaperPdfExportRequest {
  return {
    title: `${document.title} Reader Spreads`,
    fileName: safePaperPdfFileName(`${document.title}-reader-spreads`),
    html: exportPaperDocumentToReaderSpreadHtml(document),
    page: {
      widthMm: document.page.widthMm * 2,
      heightMm: document.page.heightMm,
      bleedMm: 0,
      dpi: document.page.dpi,
    },
    mode: 'reader-spreads',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperBookletProofPdfExportRequest(document: PaperDocument): PaperPdfExportRequest {
  return {
    title: `${document.title} Booklet Proof`,
    fileName: safePaperPdfFileName(`${document.title}-booklet-proof`),
    html: exportPaperDocumentToBookletProofHtml(document),
    page: {
      widthMm: document.page.widthMm * 2,
      heightMm: document.page.heightMm,
      bleedMm: 0,
      dpi: document.page.dpi,
    },
    mode: 'booklet-proof',
    production: buildPaperPrintProductionMetadata(document),
  };
}

export function buildPaperReaderSpreadHtmlExportRequest(document: PaperDocument): PaperHtmlExportRequest {
  return {
    title: `${document.title} Reader Spreads`,
    fileName: safePaperHtmlFileName(`${document.title}-reader-spreads`),
    html: exportPaperDocumentToReaderSpreadHtml(document),
    mode: 'reader-spreads',
  };
}

export function buildPaperBookletProofHtmlExportRequest(document: PaperDocument): PaperHtmlExportRequest {
  return {
    title: `${document.title} Booklet Proof`,
    fileName: safePaperHtmlFileName(`${document.title}-booklet-proof`),
    html: exportPaperDocumentToBookletProofHtml(document),
    mode: 'booklet-proof',
  };
}

export function safePaperPdfFileName(value: string | undefined): string {
  const baseName = (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'paper-document';

  return /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;
}

export function safePaperHtmlFileName(value: string | undefined): string {
  const baseName = (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'paper-document';

  return /\.html?$/i.test(baseName) ? baseName : `${baseName}.html`;
}

function sanitizePositiveDpi(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function exportPaperRasterPagesToPdfHtml(
  document: PaperDocument,
  pages: PaperRasterPdfPage[],
  options: { dpi?: number } = {},
): string {
  const rasterPages = pages.length > 0 ? pages : [];
  const pageWidthMm = rasterPages[0]?.widthMm ?? document.page.widthMm;
  const pageHeightMm = rasterPages[0]?.heightMm ?? document.page.heightMm;
  const dpi = sanitizePositiveDpi(options.dpi) ?? document.page.dpi;

  return `<!doctype html>
<html data-signal-loom-paper-raster-pdf="true">
<head>
<meta charset="utf-8" />
<meta name="signal-loom-paper-dpi" content="${dpi}" />
<title>${escapeHtml(document.title)}</title>
<style>
@page {
  size: ${formatMm(pageWidthMm)} ${formatMm(pageHeightMm)};
  margin: 0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: ${formatMm(pageWidthMm)};
  min-height: ${formatMm(pageHeightMm)};
  background: #ffffff;
  font-family: Inter, system-ui, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.paper-raster-page {
  position: relative;
  width: ${formatMm(pageWidthMm)};
  height: ${formatMm(pageHeightMm)};
  margin: 0;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: #ffffff;
}
.paper-raster-page:last-child {
  page-break-after: auto;
  break-after: auto;
}
.paper-raster-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  display: block;
}
</style>
</head>
<body>
${rasterPages.map((page) => {
  return `<section class="paper-raster-page" data-page="${page.pageNumber}" data-page-id="${escapeHtml(page.pageId)}" data-raster-width="${page.widthPx}" data-raster-height="${page.heightPx}">
  <img class="paper-raster-backdrop" alt="${escapeHtml(document.title)} page ${page.pageNumber}" src="${escapeHtml(page.dataUrl)}" width="${page.widthPx}" height="${page.heightPx}" />
</section>`;
}).join('\n')}
</body>
</html>`;
}

function exportPaperRasterSpreadsToPdfHtml(
  document: PaperDocument,
  pages: PaperRasterPdfPage[],
  mode: 'reader-spreads' | 'booklet-proof',
): string {
  const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  const renderPageSlot = (pageNumber: number | null) => {
    if (!pageNumber) return '<div class="paper-raster-spread-slot paper-raster-blank"></div>';
    const page = pageByNumber.get(pageNumber);
    if (!page) return `<div class="paper-raster-spread-slot paper-raster-blank"><span>Missing page ${pageNumber}</span></div>`;
    return `<div class="paper-raster-spread-slot" data-page="${page.pageNumber}" data-page-id="${escapeHtml(page.pageId)}">
  <img class="paper-raster-backdrop" alt="${escapeHtml(document.title)} page ${page.pageNumber}" src="${escapeHtml(page.dataUrl)}" width="${page.widthPx}" height="${page.heightPx}" />
</div>`;
  };
  const spreadsMarkup = mode === 'reader-spreads'
    ? buildPaperSpreads(document.pages, { enabled: true, startOnRight: document.view.startOnRight, rtlBinding: effectiveRtlBinding(document) })
      .map((spread, spreadIndex) => {
        const left = spread.slots[0];
        const right = spread.slots[1];
        return `<section class="paper-raster-spread" data-spread="${spreadIndex + 1}" data-spread-id="${escapeHtml(spread.id)}">
${renderPageSlot(left?.page?.pageNumber ?? null)}
${renderPageSlot(right?.page?.pageNumber ?? null)}
</section>`;
      }).join('\n')
    : buildPaperBookletImposition(document.pages.length)
      .map((signature) => `
<section class="paper-raster-spread" data-sheet="${signature.sheetNumber}" data-side="front">
${renderPageSlot(signature.front[0])}
${renderPageSlot(signature.front[1])}
</section>
<section class="paper-raster-spread" data-sheet="${signature.sheetNumber}" data-side="back">
${renderPageSlot(signature.back[0])}
${renderPageSlot(signature.back[1])}
</section>`).join('\n');

  const spreadWidthMm = document.page.widthMm * 2;
  const spreadHeightMm = document.page.heightMm;
  return `<!doctype html>
<html data-signal-loom-paper-raster-pdf="${mode}">
<head>
<meta charset="utf-8" />
<meta name="signal-loom-paper-dpi" content="${document.page.dpi}" />
<title>${escapeHtml(mode === 'reader-spreads' ? `${document.title} Reader Spreads` : `${document.title} Booklet Proof`)}</title>
<style>
@page {
  size: ${formatMm(spreadWidthMm)} ${formatMm(spreadHeightMm)};
  margin: 0;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: ${formatMm(spreadWidthMm)};
  min-height: ${formatMm(spreadHeightMm)};
  background: #111827;
  font-family: Inter, system-ui, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.paper-raster-spread {
  display: grid;
  grid-template-columns: ${formatMm(document.page.widthMm)} ${formatMm(document.page.widthMm)};
  width: ${formatMm(spreadWidthMm)};
  height: ${formatMm(spreadHeightMm)};
  margin: 0;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  background: #e5e7eb;
}
.paper-raster-spread:last-child {
  page-break-after: auto;
  break-after: auto;
}
.paper-raster-spread-slot {
  position: relative;
  width: ${formatMm(document.page.widthMm)};
  height: ${formatMm(document.page.heightMm)};
  overflow: hidden;
  background: #ffffff;
}
.paper-raster-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  display: block;
}
.paper-raster-blank {
  background: #f8fafc;
}
</style>
</head>
<body>
${spreadsMarkup}
</body>
</html>`;
}
