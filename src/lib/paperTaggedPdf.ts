// Semantic, tagged PDF export for Paper. This is deliberately separate from the PDF/X press path:
// the visual page is a raster snapshot while the ordered Paper content is exposed through a real
// StructTreeRoot, marked-content IDs, document language, and authored Figure alternative text.
// The verifier below is an internal structural gate, not a PDF/UA certification claim.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFRef,
  PDFRawStream,
  PDFString,
  StandardFonts,
  beginMarkedContent,
  endMarkedContent,
  type PDFPage,
} from 'pdf-lib';
import { unzlibSync } from 'fflate';
import type { PaperDocument, PaperFrame, PaperPage } from '../types/paper';
import { normalizePaperAccessibility, resolvePaperPageFramesForOutput } from './paperDocument';

const PT_PER_MM = 72 / 25.4;
export const PAPER_TAGGED_PDF_MAX_PAGES = 50;
export const PAPER_TAGGED_PDF_MAX_RASTER_PIXELS = 24_000_000;
export const PAPER_TAGGED_PDF_MAX_RASTER_DPI = 144;
const MAX_TAGGED_TEXT_CHARACTERS = 16_000;

export type PaperTaggedPdfRole = 'P' | 'Figure';

export interface PaperTaggedPdfSemanticItem {
  pageId: string;
  pageNumber: number;
  frameId: string;
  role: PaperTaggedPdfRole;
  /** Present for text paragraphs. */
  text?: string;
  /** Required for visual figures. */
  altText?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PaperTaggedPdfSemanticPage {
  pageId: string;
  pageNumber: number;
  items: PaperTaggedPdfSemanticItem[];
}

export interface PaperTaggedPdfPlan {
  title: string;
  language: string;
  pages: PaperTaggedPdfSemanticPage[];
}

export interface PaperTaggedPdfPlanIssue {
  id: 'page-limit' | 'raster-limit' | 'missing-alt-text' | 'text-limit';
  detail: string;
  pageId?: string;
  frameId?: string;
}

export class PaperTaggedPdfPlanError extends Error {
  readonly issues: PaperTaggedPdfPlanIssue[];

  constructor(issues: PaperTaggedPdfPlanIssue[]) {
    super(issues.map((issue) => issue.detail).join(' '));
    this.name = 'PaperTaggedPdfPlanError';
    this.issues = issues;
  }
}

export interface PaperTaggedPdfRasterPage {
  pageId: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}

export interface BuildPaperTaggedPdfOptions {
  /** Optional visual snapshots; semantics remain useful when callers omit them for structural testing. */
  rasterPages?: readonly PaperTaggedPdfRasterPage[];
  createdAt?: Date;
}

export interface PaperTaggedPdfCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface PaperTaggedPdfValidationReport {
  pass: boolean;
  language?: string;
  pageCount: number;
  semanticItemCount: number;
  checks: PaperTaggedPdfCheck[];
}

function isTextFrame(frame: PaperFrame): boolean {
  return (frame.kind === 'text'
    || frame.kind === 'caption'
    || frame.kind === 'speechBubble'
    || frame.kind === 'thoughtBubble')
    && Boolean(frame.text?.trim());
}

function isVisualFrame(frame: PaperFrame): boolean {
  return frame.kind === 'image' || frame.kind === 'document';
}

function readingOrder(document: PaperDocument, page: PaperPage): PaperFrame[] {
  const rtl = document.view.rtlBinding === true;
  return resolvePaperPageFramesForOutput(document, page)
    .filter((frame) => isTextFrame(frame) || isVisualFrame(frame))
    .sort((left, right) => {
      // Threaded text is authored as one logical story even when its boxes sit on different pages.
      if (left.threadId && left.threadId === right.threadId) {
        const leftOrder = left.threadOrder ?? 0;
        const rightOrder = right.threadOrder ?? 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      const y = left.yMm - right.yMm;
      if (Math.abs(y) > 0.5) return y;
      const x = left.xMm - right.xMm;
      if (Math.abs(x) > 0.5) return rtl ? -x : x;
      return left.id.localeCompare(right.id);
    });
}

function normalizedAltText(frame: PaperFrame): string | undefined {
  const altText = frame.altText?.trim().replace(/\s+/g, ' ');
  return altText ? altText.slice(0, 1000) : undefined;
}

/** Creates a deterministic semantic map from Paper's durable page/frame geometry. */
export function buildPaperTaggedPdfPlan(document: PaperDocument): PaperTaggedPdfPlan {
  return {
    title: document.title.trim() || 'Untitled Paper document',
    language: normalizePaperAccessibility(document.accessibility).language,
    pages: document.pages.map((page) => ({
      pageId: page.id,
      pageNumber: page.pageNumber,
      items: readingOrder(document, page).map((frame) => isTextFrame(frame)
        ? {
            pageId: page.id,
            pageNumber: page.pageNumber,
            frameId: frame.id,
            role: 'P' as const,
            text: frame.text!.trim().slice(0, MAX_TAGGED_TEXT_CHARACTERS),
            xMm: frame.xMm,
            yMm: frame.yMm,
            widthMm: frame.widthMm,
            heightMm: frame.heightMm,
          }
        : {
            pageId: page.id,
            pageNumber: page.pageNumber,
            frameId: frame.id,
            role: 'Figure' as const,
            altText: normalizedAltText(frame),
            xMm: frame.xMm,
            yMm: frame.yMm,
            widthMm: frame.widthMm,
            heightMm: frame.heightMm,
          }),
    })),
  };
}

/** Returns the author-actionable preflight issues that prevent an accessible tagged-PDF export. */
export function validatePaperTaggedPdfPlan(plan: PaperTaggedPdfPlan): PaperTaggedPdfPlanIssue[] {
  const issues: PaperTaggedPdfPlanIssue[] = [];
  if (plan.pages.length > PAPER_TAGGED_PDF_MAX_PAGES) {
    issues.push({
      id: 'page-limit',
      detail: `Accessible PDF export is limited to ${PAPER_TAGGED_PDF_MAX_PAGES} pages; this document has ${plan.pages.length}.`,
    });
  }
  let textCharacters = 0;
  for (const page of plan.pages) {
    for (const item of page.items) {
      textCharacters += item.text?.length ?? 0;
      if (item.role === 'Figure' && !item.altText) {
        issues.push({
          id: 'missing-alt-text',
          pageId: item.pageId,
          frameId: item.frameId,
          detail: `Page ${item.pageNumber} visual frame ${item.frameId} needs authored alternative text before accessible PDF export.`,
        });
      }
    }
  }
  if (textCharacters > MAX_TAGGED_TEXT_CHARACTERS * PAPER_TAGGED_PDF_MAX_PAGES) {
    issues.push({
      id: 'text-limit',
      detail: 'Accessible PDF text exceeds the bounded semantic export limit.',
    });
  }
  return issues;
}

/** Includes the visual-snapshot memory bound used by the browser/native delivery path. */
export function validatePaperTaggedPdfDocument(
  document: PaperDocument,
  outputDpi = Math.min(PAPER_TAGGED_PDF_MAX_RASTER_DPI, Math.max(72, Math.round(document.page.dpi || 300))),
): PaperTaggedPdfPlanIssue[] {
  const issues = validatePaperTaggedPdfPlan(buildPaperTaggedPdfPlan(document));
  const widthPx = Math.ceil(document.page.widthMm / 25.4 * outputDpi);
  const heightPx = Math.ceil(document.page.heightMm / 25.4 * outputDpi);
  const pixels = widthPx * heightPx * document.pages.length;
  if (!Number.isFinite(pixels) || pixels > PAPER_TAGGED_PDF_MAX_RASTER_PIXELS) {
    issues.push({
      id: 'raster-limit',
      detail: `Accessible PDF export is limited to ${PAPER_TAGGED_PDF_MAX_RASTER_PIXELS.toLocaleString()} raster pixels; lower the Paper DPI or split this document.`,
    });
  }
  return issues;
}

function contentOp(name: string, args: unknown[] = []): PDFOperator {
  return PDFOperator.of(name as never, args as never);
}

function beginMarkedContentWithMcid(tag: PaperTaggedPdfRole, mcid: number, document: PDFDocument): PDFOperator {
  // pdf-lib exposes BMC but not BDC's property dictionary. Its operator serializer accepts the same
  // PDFDict object used throughout the library, so the cast is only to bridge its narrow public typing.
  return contentOp('BDC', [PDFName.of(tag), document.context.obj({ MCID: mcid })]);
}

function dictionary(context: PDFDocument['context'], value: unknown): PDFDict | undefined {
  const resolved = context.lookup(value as never);
  return resolved instanceof PDFDict ? resolved : undefined;
}

function array(context: PDFDocument['context'], value: unknown): PDFArray | undefined {
  const resolved = context.lookup(value as never);
  return resolved instanceof PDFArray ? resolved : undefined;
}

function name(value: unknown): string | undefined {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : undefined;
}

function string(value: unknown): string | undefined {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : undefined;
}

function addRasterSnapshot(
  page: PDFPage,
  document: PDFDocument,
  raster: PaperTaggedPdfRasterPage | undefined,
): Promise<void> | undefined {
  if (!raster) return undefined;
  const embed = raster.mimeType === 'image/png'
    ? document.embedPng(raster.bytes)
    : document.embedJpg(raster.bytes);
  return embed.then((image) => {
    page.pushOperators(beginMarkedContent('Artifact'));
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    page.pushOperators(endMarkedContent());
  });
}

function stablePdfId(value: string): string {
  let hash = 0x811c9dc5;
  let output = '';
  for (let round = 0; round < 8; round += 1) {
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ (value.charCodeAt(index) + round), 0x01000193);
    }
    output += (hash >>> 0).toString(16).padStart(8, '0');
    hash = Math.imul(hash ^ round, 0x01000193);
  }
  return output;
}

/**
 * The visual snapshot remains the canonical appearance. Helvetica is used only for a transparent,
 * selectable overlay when its WinAnsi encoder can represent every rendered line. Unicode paragraphs
 * still receive their complete UTF-16 ActualText semantic value when that bounded overlay is unavailable.
 */
function canDrawSemanticTextOverlay(
  text: string,
  font: { encodeText(value: string): PDFHexString },
): boolean {
  try {
    for (const line of text.split(/\r\n?|\n/)) font.encodeText(line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a visually faithful raster-backed Paper PDF with a real semantic structure tree. The generated
 * object graph is intentionally validated before any caller delivers it, but external PDF/UA certification
 * and human assistive-technology review remain outside this local structural export boundary.
 */
export async function buildPaperTaggedPdf(
  document: PaperDocument,
  options: BuildPaperTaggedPdfOptions = {},
): Promise<Uint8Array> {
  const plan = buildPaperTaggedPdfPlan(document);
  const planIssues = validatePaperTaggedPdfDocument(document);
  if (planIssues.length > 0) throw new PaperTaggedPdfPlanError(planIssues);

  const pdf = await PDFDocument.create();
  const ctx = pdf.context;
  const rasterByPageId = new Map((options.rasterPages ?? []).map((page) => [page.pageId, page]));
  const structTreeRoot = ctx.obj({ Type: 'StructTreeRoot' }) as PDFDict;
  const structTreeRootRef = ctx.register(structTreeRoot);
  const documentElement = ctx.obj({
    Type: 'StructElem',
    S: 'Document',
    P: structTreeRootRef,
    Lang: PDFString.of(plan.language),
    K: ctx.obj([]),
  }) as PDFDict;
  const documentElementRef = ctx.register(documentElement);
  const documentKids = documentElement.lookup(PDFName.of('K'), PDFArray);
  const parentTreeNumbers: Array<PDFNumber | PDFArray> = [];

  pdf.setTitle(plan.title);
  pdf.setCreator('Sloom Studio Paper accessibility export');
  pdf.setProducer('Sloom Studio Paper accessibility export');
  pdf.setLanguage(plan.language);
  const documentDate = new Date(document.updatedAt);
  const date = options.createdAt ?? (Number.isNaN(documentDate.getTime()) ? new Date(0) : documentDate);
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  const id = PDFHexString.of(stablePdfId(`${document.id}\u0000${plan.title}\u0000${plan.language}`));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  pdf.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
  pdf.catalog.set(PDFName.of('StructTreeRoot'), structTreeRootRef);
  const semanticOverlayFont = await pdf.embedFont(StandardFonts.Helvetica);

  for (const [pageIndex, semanticPage] of plan.pages.entries()) {
    const page = pdf.addPage([document.page.widthMm * PT_PER_MM, document.page.heightMm * PT_PER_MM]);
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(pageIndex));
    await addRasterSnapshot(page, pdf, rasterByPageId.get(semanticPage.pageId));

    const section = ctx.obj({
      Type: 'StructElem',
      S: 'Sect',
      P: documentElementRef,
      Pg: page.ref,
      K: ctx.obj([]),
    }) as PDFDict;
    const sectionRef = ctx.register(section);
    documentKids.push(sectionRef);
    const sectionKids = section.lookup(PDFName.of('K'), PDFArray);
    const parentEntries: PDFRef[] = [];

    for (const [mcid, item] of semanticPage.items.entries()) {
      const element = ctx.obj({
        Type: 'StructElem',
        S: item.role,
        P: sectionRef,
        Pg: page.ref,
        K: ctx.obj({ Type: 'MCR', Pg: page.ref, MCID: mcid }),
        // PDF literal strings are byte-oriented. Author-facing semantic strings must remain Unicode
        // even when the page's optional Helvetica overlay cannot encode their glyphs.
        ...(item.role === 'Figure' ? { Alt: PDFHexString.fromText(item.altText!) } : {}),
        ...(item.role === 'P' ? { ActualText: PDFHexString.fromText(item.text!) } : {}),
      }) as PDFDict;
      const elementRef = ctx.register(element);
      sectionKids.push(elementRef);
      parentEntries.push(elementRef);

      page.pushOperators(beginMarkedContentWithMcid(item.role, mcid, pdf));
      if (item.role === 'P' && item.text && canDrawSemanticTextOverlay(item.text, semanticOverlayFont)) {
        // Semantic text overlays the raster as invisible text, preserving the exact visual snapshot while
        // giving readers an ordered, selectable text object tied to the structure element's MCID. The
        // UTF-16 ActualText above remains the accessible route when the default font cannot encode a script.
        page.drawText(item.text, {
          x: Math.max(0, item.xMm * PT_PER_MM),
          y: Math.max(0, page.getHeight() - (item.yMm + item.heightMm) * PT_PER_MM),
          font: semanticOverlayFont,
          size: 10,
          maxWidth: Math.max(1, item.widthMm * PT_PER_MM),
          lineHeight: 12,
          opacity: 0,
        });
      }
      page.pushOperators(endMarkedContent());
    }
    parentTreeNumbers.push(PDFNumber.of(pageIndex), ctx.obj(parentEntries));
  }

  const parentTree = ctx.obj({ Nums: ctx.obj(parentTreeNumbers) }) as PDFDict;
  structTreeRoot.set(PDFName.of('K'), ctx.obj([documentElementRef]));
  structTreeRoot.set(PDFName.of('ParentTree'), ctx.register(parentTree));
  structTreeRoot.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(plan.pages.length));
  return pdf.save({ useObjectStreams: false });
}

function structuralItems(
  context: PDFDocument['context'],
  value: unknown,
): Array<{ role?: string; hasAlt: boolean; hasActualText: boolean }> {
  const element = dictionary(context, value);
  if (!element) return [];
  const role = name(element.get(PDFName.of('S')));
  const children = element.get(PDFName.of('K'));
  const output: Array<{ role?: string; hasAlt: boolean; hasActualText: boolean }> = [{
    role,
    hasAlt: Boolean(string(element.get(PDFName.of('Alt')))?.trim()),
    hasActualText: Boolean(string(element.get(PDFName.of('ActualText')))?.trim()),
  }];
  const childArray = array(context, children);
  if (childArray) {
    for (let index = 0; index < childArray.size(); index += 1) {
      output.push(...structuralItems(context, childArray.get(index)));
    }
  }
  return output;
}

function decodedContentStream(stream: PDFRawStream): string {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const filterName = filter?.toString() ?? '';
  try {
    const bytes = filterName.includes('FlateDecode') ? unzlibSync(stream.contents) : stream.contents;
    return new TextDecoder('latin1').decode(bytes);
  } catch {
    return '';
  }
}

function markedContentIdsForPage(document: PDFDocument, page: PDFPage): number[] {
  const contents = page.node.Contents();
  const values = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const text = values.map((value) => {
    const stream = document.context.lookup(value as never);
    return stream instanceof PDFRawStream ? decodedContentStream(stream) : '';
  }).join('\n');
  const ids: number[] = [];
  // The generated BDC property list is deliberately explicit so a screen-reader tag has a page-local MCID.
  const matcher = /\/(?:P|Figure)\s+<<\s*\/MCID\s+(\d+)\s*>>\s+BDC/g;
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) ids.push(Number(match[1]));
  return ids;
}

function parentTreeEntriesForPage(
  context: PDFDocument['context'],
  parentTreeNumbers: PDFArray | undefined,
  structParents: number,
): PDFArray | undefined {
  if (!parentTreeNumbers) return undefined;
  for (let index = 0; index + 1 < parentTreeNumbers.size(); index += 2) {
    const key = parentTreeNumbers.get(index);
    if (key instanceof PDFNumber && key.asNumber() === structParents) {
      return array(context, parentTreeNumbers.get(index + 1));
    }
  }
  return undefined;
}

/** Validates the local semantic PDF structure before export delivery. */
export async function validatePaperTaggedPdf(bytes: Uint8Array): Promise<PaperTaggedPdfValidationReport> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx = pdf.context;
  const checks: PaperTaggedPdfCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail?: string) => checks.push({ id, label, pass, detail });
  const language = string(pdf.catalog.get(PDFName.of('Lang')));
  const markInfo = dictionary(ctx, pdf.catalog.get(PDFName.of('MarkInfo')));
  const marked = markInfo?.get(PDFName.of('Marked'))?.toString() === 'true';
  add('marked', 'Catalog declares marked content', marked);
  add('document-language', 'Catalog declares a BCP 47 document language', Boolean(language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language)), language);

  const root = dictionary(ctx, pdf.catalog.get(PDFName.of('StructTreeRoot')));
  const rootKids = root ? array(ctx, root.get(PDFName.of('K'))) : undefined;
  const items = rootKids
    ? Array.from({ length: rootKids.size() }, (_, index) => structuralItems(ctx, rootKids.get(index))).flat()
    : [];
  add('struct-tree', 'Has a structure tree rooted in Document', Boolean(root && rootKids && items.some((item) => item.role === 'Document')));
  const semanticItems = items.filter((item) => item.role === 'P' || item.role === 'Figure');
  const figuresHaveAlt = items.filter((item) => item.role === 'Figure').every((item) => item.hasAlt);
  add('figure-alt-text', 'Every Figure structure element has alternative text', figuresHaveAlt);
  const paragraphsHaveActualText = items.filter((item) => item.role === 'P').every((item) => item.hasActualText);
  add('paragraph-actual-text', 'Every paragraph structure element has Unicode ActualText', paragraphsHaveActualText);

  const parentTree = root ? dictionary(ctx, root.get(PDFName.of('ParentTree'))) : undefined;
  const nums = parentTree ? array(ctx, parentTree.get(PDFName.of('Nums'))) : undefined;
  const pages = pdf.getPages();
  const pagesHaveStructParents = pages.every((page) => page.node.get(PDFName.of('StructParents')) instanceof PDFNumber);
  const parentTreeMatchesPages = Boolean(nums && nums.size() === pages.length * 2 && pagesHaveStructParents);
  add('parent-tree', 'Every page is mapped through StructParents and ParentTree', parentTreeMatchesPages);
  const markedContentMatchesTree = parentTreeMatchesPages && pages.every((page) => {
    const parentKey = page.node.get(PDFName.of('StructParents')) as PDFNumber;
    const entries = parentTreeEntriesForPage(ctx, nums, parentKey.asNumber());
    if (!entries) return false;
    const expected = Array.from({ length: entries.size() }, (_, index) => index);
    const emitted = markedContentIdsForPage(pdf, page);
    return emitted.length === expected.length && emitted.every((mcid, index) => mcid === expected[index]);
  });
  add('marked-content', 'Page marked-content IDs match the ParentTree reading order', markedContentMatchesTree);
  add('reading-order', 'Structure tree contains ordered semantic paragraphs or figures', semanticItems.length > 0 || pages.length > 0);

  return {
    pass: checks.every((check) => check.pass),
    language,
    pageCount: pages.length,
    semanticItemCount: semanticItems.length,
    checks,
  };
}

export function summarizePaperTaggedPdfReport(report: PaperTaggedPdfValidationReport): string {
  if (report.pass) return `Accessible PDF structural checks passed (${report.pageCount} pages, ${report.semanticItemCount} semantic items, ${report.language ?? 'language missing'}).`;
  return `Accessible PDF structural checks failed: ${report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')}.`;
}
