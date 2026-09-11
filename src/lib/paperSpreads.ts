import type { PaperDocument, PaperPage } from '../types/paper';
import { exportPaperDocumentToPrintHtml } from './paperDocument';

export type PaperSpreadSide = 'left' | 'right';

export interface PaperSpreadSlot {
  side: PaperSpreadSide;
  page: PaperPage | null;
  label: string;
}

export interface PaperSpread {
  id: string;
  slots: PaperSpreadSlot[];
}

export interface LivePaperSpreadSlot extends PaperSpreadSlot {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface LivePaperSpreadLayout {
  id: string;
  widthMm: number;
  heightMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
  pasteboardMm: number;
  slots: LivePaperSpreadSlot[];
}

export interface PaperSpreadExportOptions {
  startOnRight?: boolean;
  rtlBinding?: boolean;
}

export interface PaperBookletSignature {
  sheetNumber: number;
  front: [number | null, number | null];
  back: [number | null, number | null];
}

export function buildPaperSpreads(
  pages: PaperPage[],
  options: { enabled?: boolean; startOnRight?: boolean; rtlBinding?: boolean } = {},
): PaperSpread[] {
  const rtl = options.rtlBinding ?? false;
  if (!options.enabled) {
    return pages.map((page) => ({
      id: page.id,
      slots: [{ side: pageSideLabel(page.pageNumber, options.startOnRight ?? true, rtl).side, page, label: 'Single page' }],
    }));
  }

  const startOnRight = options.startOnRight ?? true;
  const spreads: PaperSpread[] = [];
  let index = 0;

  // A lone cover opens on the right (title-page recto), independent of binding direction.
  if (startOnRight && pages[0]) {
    spreads.push({
      id: `spread-cover-${pages[0].id}`,
      slots: [
        { side: 'left', page: null, label: 'Blank left' },
        { side: 'right', page: pages[0], label: 'Right page' },
      ],
    });
    index = 1;
  }

  for (; index < pages.length; index += 2) {
    const firstPage = pages[index] ?? null; // the lower page number of the pair
    const secondPage = pages[index + 1] ?? null;
    // Right-to-left binding (右綴じ) reads the lower page number on the RIGHT and progresses right→left; the slot
    // ORDER stays [left, right] (so the geometry is unchanged) — only which page lands in which side flips.
    const leftPage = rtl ? secondPage : firstPage;
    const rightPage = rtl ? firstPage : secondPage;
    spreads.push({
      id: `spread-${leftPage?.id ?? 'blank'}-${rightPage?.id ?? 'blank'}`,
      slots: [
        { side: 'left', page: leftPage, label: leftPage ? 'Left page' : 'Blank left' },
        { side: 'right', page: rightPage, label: rightPage ? 'Right page' : 'Blank right' },
      ],
    });
  }

  return spreads;
}

export function buildLivePaperSpreadLayout(
  spread: PaperSpread,
  page: Pick<PaperDocument['page'], 'widthMm' | 'heightMm'>,
  options: { pasteboardMm?: number } = {},
): LivePaperSpreadLayout {
  const pasteboardMm = Math.max(0, options.pasteboardMm ?? 40);
  const slotCount = Math.max(1, spread.slots.length);
  const slots = spread.slots.map<LivePaperSpreadSlot>((slot, index) => ({
    ...slot,
    xMm: Number((pasteboardMm + index * page.widthMm).toFixed(3)),
    yMm: Number(pasteboardMm.toFixed(3)),
    widthMm: page.widthMm,
    heightMm: page.heightMm,
  }));

  return {
    id: spread.id,
    widthMm: Number((page.widthMm * slotCount + pasteboardMm * 2).toFixed(3)),
    heightMm: Number((page.heightMm + pasteboardMm * 2).toFixed(3)),
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    pasteboardMm,
    slots,
  };
}

export function exportPaperDocumentToReaderSpreadHtml(
  document: PaperDocument,
  options: PaperSpreadExportOptions = {},
): string {
  const startOnRight = options.startOnRight ?? document.view.startOnRight;
  const pageHtml = exportPaperDocumentToPrintHtml(document, { mediaBox: 'trim' });
  const pageBodies = extractPaperSheets(pageHtml);
  const spreads = buildPaperSpreads(document.pages, { enabled: true, startOnRight });
  const pageMarkupById = new Map(document.pages.map((page, index) => [page.id, pageBodies[index] ?? '']));
  const spreadsMarkup = spreads.map((spread, spreadIndex) => {
    const slots = spread.slots.map((slot) => {
      const slotClass = slot.page ? 'paper-reader-spread-slot' : 'paper-reader-spread-slot paper-reader-spread-blank';
      const body = slot.page ? pageMarkupById.get(slot.page.id) ?? '' : `<div class="paper-reader-blank-label">${escapeHtml(slot.label)}</div>`;
      const pageNumber = slot.page?.pageNumber ? ` data-page="${slot.page.pageNumber}"` : '';

      return `<div class="${slotClass}" data-side="${slot.side}"${pageNumber}>
  <div class="paper-reader-side-label">${escapeHtml(slot.label)}${slot.page ? ` ${slot.page.pageNumber}` : ''}</div>
  ${body}
</div>`;
    }).join('\n<div class="paper-reader-gutter" aria-label="Spread gutter">Gutter</div>\n');

    return `<section class="paper-reader-spread" data-spread="${spreadIndex + 1}" data-spread-id="${escapeHtml(spread.id)}">
${slots}
</section>`;
  }).join('\n');

  return buildSpreadHtmlDocument(document, `${escapeHtml(document.title)} Reader Spreads`, 'reader-spreads', spreadsMarkup);
}

export function buildPaperBookletImposition(pageCount: number): PaperBookletSignature[] {
  const totalPages = Math.max(4, Math.ceil(Math.max(0, pageCount) / 4) * 4);
  const signatures: PaperBookletSignature[] = [];
  const pageOrBlank = (pageNumber: number): number | null => pageNumber <= pageCount ? pageNumber : null;

  for (let sheet = 0; sheet < totalPages / 4; sheet += 1) {
    const low = sheet * 2 + 1;
    const high = totalPages - sheet * 2;
    signatures.push({
      sheetNumber: sheet + 1,
      front: [pageOrBlank(high), pageOrBlank(low)],
      back: [pageOrBlank(low + 1), pageOrBlank(high - 1)],
    });
  }

  return signatures;
}

export function exportPaperDocumentToBookletProofHtml(document: PaperDocument): string {
  const pageHtml = exportPaperDocumentToPrintHtml(document, { mediaBox: 'trim' });
  const pageBodies = extractPaperSheets(pageHtml);
  const signatures = buildPaperBookletImposition(document.pages.length);
  const renderSlot = (pageNumber: number | null) => {
    if (!pageNumber) return '<div class="paper-reader-spread-slot paper-reader-spread-blank"><div class="paper-reader-blank-label">Blank</div></div>';
    const body = pageBodies[pageNumber - 1] ?? '';
    return `<div class="paper-reader-spread-slot" data-page="${pageNumber}">${body}<div class="paper-reader-side-label">Page ${pageNumber}</div></div>`;
  };
  const sheetMarkup = signatures.map((signature) => `
<section class="paper-reader-spread" data-sheet="${signature.sheetNumber}" data-side="front">
${renderSlot(signature.front[0])}<div class="paper-reader-gutter">Fold</div>${renderSlot(signature.front[1])}
</section>
<section class="paper-reader-spread" data-sheet="${signature.sheetNumber}" data-side="back">
${renderSlot(signature.back[0])}<div class="paper-reader-gutter">Fold</div>${renderSlot(signature.back[1])}
</section>`).join('\n');

  return buildSpreadHtmlDocument(document, `${escapeHtml(document.title)} Booklet Proof`, 'booklet-proof', sheetMarkup);
}

function buildSpreadHtmlDocument(document: PaperDocument, title: string, mode: 'reader-spreads' | 'booklet-proof', bodyMarkup: string): string {
  const spreadWidthMm = document.page.widthMm * 2;
  const spreadHeightMm = document.page.heightMm;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="signal-loom-paper-export" content="${mode}" />
<meta name="signal-loom-paper-dpi" content="${document.page.dpi}" />
<title>${title}</title>
<style>
@page { size: ${formatMm(spreadWidthMm)} ${formatMm(spreadHeightMm)}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #111827; color: #111827; }
body { font-family: Inter, system-ui, sans-serif; }
.paper-reader-spread { position: relative; display: grid; grid-template-columns: ${formatMm(document.page.widthMm)} 0 ${formatMm(document.page.widthMm)}; width: ${formatMm(spreadWidthMm)}; height: ${formatMm(spreadHeightMm)}; margin: 0 auto; page-break-after: always; background: #e5e7eb; overflow: hidden; }
.paper-reader-spread-slot { position: relative; width: ${formatMm(document.page.widthMm)}; height: ${formatMm(document.page.heightMm)}; overflow: hidden; background: white; }
.paper-reader-spread-slot .paper-sheet { margin: 0; page-break-after: auto; }
.paper-reader-spread-slot .paper-page { left: 0; top: 0; }
.paper-reader-spread-blank { display: flex; align-items: center; justify-content: center; background: #f8fafc; color: #64748b; }
.paper-reader-side-label, .paper-reader-blank-label, .paper-reader-gutter { position: absolute; z-index: 999999; border: 1px solid rgba(8, 145, 178, 0.3); background: rgba(15, 23, 42, 0.78); color: white; font-size: 8pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; pointer-events: none; }
.paper-reader-side-label { bottom: 2mm; right: 2mm; padding: 1mm 1.5mm; }
.paper-reader-blank-label { position: static; padding: 2mm 3mm; }
.paper-reader-gutter { left: 50%; top: 0; bottom: 0; width: 0; border-left: 0.25mm dashed rgba(239, 68, 68, 0.85); writing-mode: vertical-rl; text-align: center; padding-top: 2mm; transform: translateX(-50%); }
@media screen { .paper-reader-spread { margin: 12mm auto; box-shadow: 0 12px 40px rgba(0,0,0,0.4); } }
</style>
</head>
<body>
${bodyMarkup}
</body>
</html>`;
}

function extractPaperSheets(html: string): string[] {
  const matches = html.match(/<section class="paper-sheet"[\s\S]*?<\/section>/g);
  return matches ?? [];
}

function pageSideLabel(pageNumber: number, startOnRight: boolean, rtl = false): { side: PaperSpreadSide } {
  // A right-bound book (or a start-on-right document) puts odd pages (recto) on the right.
  const oddOnRight = startOnRight || rtl;
  const odd = pageNumber % 2 === 1;
  return { side: odd === oddOnRight ? 'right' : 'left' };
}

function formatMm(value: number): string {
  return `${Number(value.toFixed(3))}mm`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
