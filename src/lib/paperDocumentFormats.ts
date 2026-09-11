import { strFromU8, strToU8, zipSync } from 'fflate';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument, PaperFrame, PaperGuide, PaperMarginSpec, PaperPage, PaperParagraphBorders, PaperRichParagraph, PaperTextRun } from '../types/paper';
import { normalizePaperTable } from './paperTables';
import { addFrameToPaperPage, addPaperPage, createDefaultPaperDocument, effectiveRtlBinding, parsePaperDocument } from './paperDocument';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import { storePaperBinaryAsset } from '../features/paper/assets/PaperDocumentAssets';
import { buildPaperFrameAssetFromSourceItem } from './paperAssetReferences';
import { flattenPaperRichText } from './paperRichText';
import { tokenizePaperInlineText } from './paperJapaneseText';
import {
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets,
  imageSourceToDataUrl,
  rasterizeFlattenedPaperPageToPng,
  type FlattenedPaperPageRasterExport,
  type FlattenedPaperPageSvgExport,
} from './paperPageFlattenExport';
import { assertPaperDocumentSupportsRasterization } from './paperPlacedDocumentRasterization';
import { unzipBoundedZipSync } from './boundedZip';
import { resolvePaperFramesTextTemplates } from './paperTextVariables';
import { importPaperIdmlPackage } from './paperIdmlImport';

export type PaperDocumentImportFormat = 'txt' | 'markdown' | 'rtf' | 'html' | 'docx' | 'pdf' | 'sloom-paper-json' | 'sloom-idml-json' | 'idml-package';
export type PaperStoryExportFormat = 'txt' | 'html' | 'rtf' | 'docx';

export const PAPER_DOCX_ARCHIVE_LIMITS = {
  maxEntries: 2_048,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
} as const;

export interface ImportedPaperTableData {
  rows: number;
  cols: number;
  /** Row-major cell text; the importer approximates merged cells (gridSpan → blank continuation columns). */
  cells: string[][];
  headerRow: boolean;
  /** Row-major per-cell background colour (from `<w:shd w:fill>`), preserving header/alternating-row shading. */
  cellFills?: string[][];
  /** Table border colour from `<w:tblBorders>`. */
  borderColor?: string;
}

export interface ImportedPaperImageData {
  /** Image bytes lifted straight out of the .docx; persisted Paper state gets only the resulting asset ref. */
  bytes: Uint8Array;
  mimeType: string;
  /** Intrinsic size from the drawing's <wp:extent> (EMU → mm), when present. */
  widthMm?: number;
  heightMm?: number;
}

export interface ImportedPaperTextBlock {
  /** A block is a paragraph/heading of uniform text, an editable table, or an embedded image — NOT everything
   * collapsed to a wall of text. `text` is always a string so text-only consumers keep working. */
  role: 'heading' | 'paragraph' | 'table' | 'image';
  text: string;
  level?: number;
  /** Paragraph alignment, when the source specifies one. Paper text frames are uniform per frame, so this
   * is a paragraph-level attribute (sub-paragraph runs can't be represented). */
  align?: 'left' | 'center' | 'right' | 'justify';
  /** The whole paragraph is bold / italic (every run carries it) — mapped to the frame's typography. */
  bold?: boolean;
  italic?: boolean;
  /** Dominant run font size in points (from <w:sz> half-points), when the source sets one explicitly. */
  fontSizePt?: number;
  /** Dominant run colour as #rrggbb, when the source sets a non-default (non-black/auto) colour. */
  color?: string;
  /** External hyperlink target, when the paragraph is (or wraps) a link. */
  hyperlink?: string;
  /** Present when role === 'table'. */
  table?: ImportedPaperTableData;
  /** Present when role === 'image'. */
  image?: ImportedPaperImageData;
  /** Inline-rich content for a heading/paragraph: the paragraph's runs with per-run styling preserved
   * (bold/italic/underline/strike/font/size/colour/super-sub/link). When set, the block is NOT flattened to a
   * single style — Paper renders it as a real mixed-style paragraph. */
  richText?: PaperRichParagraph[];
  /** Index into `ImportedPaperTextDocument.sections` — which page-geometry section this block belongs to
   * (a `<w:sectPr>` boundary). Drives per-section page size / landscape orientation at layout time. */
  sectionIndex?: number;
  /** Display numbers of any footnotes this paragraph references (superscript markers are woven into its runs).
   * Layout collects these per page and draws the footnote texts at that page's bottom. */
  footnoteRefs?: number[];
  /** The source forces a page break before this block (`<w:br w:type="page"/>` or `<w:pageBreakBefore/>`), so
   * layout starts it on a fresh page — matching where the document actually paginates. */
  pageBreakBefore?: boolean;
}

/** One header/footer paragraph, with its alignment and `{PAGE}`/`{NUMPAGES}` field tokens left in the text
 * for the layout step to substitute per page. */
export interface DocxHeaderFooterParagraph {
  text: string;
  align?: 'left' | 'center' | 'right';
}
export interface DocxHeaderFooterContent {
  paragraphs: DocxHeaderFooterParagraph[];
}

/** Page geometry for one document section (`<w:sectPr>`): a landscape section becomes a rotated page so a wide
 * table fits, matching what printing the section would do; multi-column sections flow into N columns; running
 * headers/footers repeat on every page of the section. */
export interface DocxSectionGeometry {
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  marginsMm: PaperMarginSpec;
  columns: number;
  /** Gutter between columns (`<w:cols w:space>`, twips → mm). */
  columnGutterMm: number;
  /** Running header/footer content (resolved from the section's headerReference/footerReference, inheriting
   * from the previous section when this one doesn't redefine it). `first*` apply to a section's first page when
   * it declares a title page (`<w:titlePg>`); an undefined `first*` means that page shows no header/footer. */
  header?: DocxHeaderFooterContent;
  footer?: DocxHeaderFooterContent;
  firstHeader?: DocxHeaderFooterContent;
  firstFooter?: DocxHeaderFooterContent;
  titlePage: boolean;
  /** Distance of the header from the top edge / footer from the bottom edge (`<w:pgMar w:header/w:footer>`, mm). */
  headerDistanceMm: number;
  footerDistanceMm: number;
  /** The section is set 縦書き (vertical writing) — `<w:sectPr><w:textDirection w:val="tbRl"/>`. Its text frames
   * are imported with `writingMode: 'vertical-rl'` so Japanese vertical documents keep their direction. */
  vertical: boolean;
}

/** A footnote's assigned display number and its (small-print) content, placed at the bottom of the page that
 * carries its reference marker. */
export interface DocxFootnoteEntry {
  number: number;
  content: PaperRichParagraph;
}

export interface ImportedPaperTextDocument {
  title: string;
  format: PaperDocumentImportFormat;
  blocks: ImportedPaperTextBlock[];
  /** Plain-language notes about anything the source held that Paper's model can't reproduce 1:1 (inline run
   * styling, merged-cell geometry, footnotes…). Surfaced to the user so the import is honest, not silent. */
  limitations?: string[];
  /** Page margins from the source section (`<w:pgMar>`), in mm — applied to the doc + drawn as guides. */
  pageMarginsMm?: PaperMarginSpec;
  /** Per-section page geometry (`<w:sectPr>`), in document order. A landscape section is laid out rotated. */
  sections?: DocxSectionGeometry[];
  /** Footnotes in reference order, drawn at the bottom of the page that carries each reference marker. */
  footnotes?: DocxFootnoteEntry[];
}

export interface PaperIdmlInterchange {
  app: 'Sloom Studio Paper';
  format: 'sloom-idml-json';
  version: 1;
  manifest: {
    title: string;
    documentId: string;
    pageCount: number;
    frameCount: number;
    linkCount: number;
    exportedAt: string;
  };
  document: Pick<PaperDocument, 'id' | 'title' | 'page' | 'layout' | 'background' | 'printProduction' | 'view' | 'parentPages' | 'styles' | 'pages' | 'createdAt' | 'updatedAt'>;
  spreads: Array<{ id: string; pageIds: string[] }>;
  links: Array<{ sourceBinItemId?: string; label: string; mimeType?: string; pageNumber: number; frameId: string }>;
  guides: Array<{ ownerId: string; ownerType: 'page' | 'parentPage'; id: string; orientation: string; positionMm: number; label?: string }>;
}

export interface PaperZipExport {
  fileName: string;
  mimeType: 'application/zip' | 'application/vnd.comicbook+zip' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  blob: Blob;
  entries: string[];
}

export interface PaperCbzRasterExportOptions {
  includeBleed?: boolean;
  /** Required exact alias payload when a document contains managed Paper text. */
  fontFaceCss?: string;
  resolveImageSrc?: (src: string, context: { frameId: string; pageId: string }) => Promise<string | undefined> | string | undefined;
  rasterize?: (exported: FlattenedPaperPageSvgExport) => Promise<FlattenedPaperPageRasterExport> | FlattenedPaperPageRasterExport;
  onPageRasterized?: (progress: { pageNumber: number; pageIndex: number; pageCount: number }) => void;
}

export async function parsePaperDocumentImportFile(file: File): Promise<ImportedPaperTextDocument | PaperDocument> {
  const format = inferPaperDocumentImportFormat(file.name, file.type);
  if (format === 'sloom-paper-json') return parsePaperDocument(await file.text());
  if (format === 'sloom-idml-json') return importPaperIdmlInterchange(await file.text());
  if (format === 'idml-package') {
    return importPaperIdmlPackage(new Uint8Array(await file.arrayBuffer()), stripExtension(file.name));
  }
  if (format === 'pdf') throw new Error('Use Place PDF/document from the Source Library to place PDFs as linked document frames; editable PDF import is not implemented.');
  if (format === 'docx') return parseDocxTextDocument(await file.arrayBuffer(), file.name);
  const text = await file.text();

  switch (format) {
    case 'markdown':
      return { title: stripExtension(file.name), format, blocks: parseMarkdownBlocks(text) };
    case 'rtf':
      return { title: stripExtension(file.name), format, blocks: parsePlainTextBlocks(rtfToText(text)) };
    case 'html':
      return { title: stripExtension(file.name), format, blocks: parseHtmlBlocks(text) };
    case 'txt':
    default:
      return { title: stripExtension(file.name), format: 'txt', blocks: parsePlainTextBlocks(text) };
  }
}

export async function importTextDocumentIntoPaper(imported: ImportedPaperTextDocument): Promise<PaperDocument> {
  let doc = createDefaultPaperDocument({ title: imported.title || 'Imported Document' });
  // Adopt the source's page margins (`<w:pgMar>`) so the text area matches Word, and remember the margin
  // guide positions to drop onto every page — the owner wants imported docs to show their margins by default.
  let marginGuides: PaperGuide[] = [];
  if (imported.pageMarginsMm) {
    const m = imported.pageMarginsMm;
    const clampV = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const marginsMm: PaperMarginSpec = {
      top: clampV(m.top, doc.page.heightMm / 2),
      right: clampV(m.right, doc.page.widthMm / 2),
      bottom: clampV(m.bottom, doc.page.heightMm / 2),
      left: clampV(m.left, doc.page.widthMm / 2),
    };
    marginGuides = [
      { id: 'guide-margin-left', orientation: 'vertical', positionMm: marginsMm.left, label: 'Margin' },
      { id: 'guide-margin-right', orientation: 'vertical', positionMm: doc.page.widthMm - marginsMm.right, label: 'Margin' },
      { id: 'guide-margin-top', orientation: 'horizontal', positionMm: marginsMm.top, label: 'Margin' },
      { id: 'guide-margin-bottom', orientation: 'horizontal', positionMm: doc.page.heightMm - marginsMm.bottom, label: 'Margin' },
    ];
    doc = { ...doc, layout: { ...doc.layout, marginsMm }, view: { ...doc.view, showGuides: true } };
  }
  doc = { ...doc, pages: [{ ...doc.pages[0], frames: [], guides: marginGuides }], updatedAt: Date.now() };
  let pageId = doc.pages[0].id;
  const sections = imported.sections ?? [];
  const footnoteContentByNumber = new Map(imported.footnotes?.map((f) => [f.number, f.content]) ?? []);
  const blocks = imported.blocks.length ? imported.blocks : [{ role: 'paragraph' as const, text: '' }];

  // Per-page bookkeeping consumed by the decoration pass (running headers/footers + page-bottom footnotes),
  // which runs AFTER the main flow so it never perturbs pagination.
  const pageMeta = new Map<string, PaperImportPageMeta>();
  const landscapePageIds = new Set<string>();
  const addFrame = (spec: Parameters<typeof addFrameToPaperPage>[2]): void => {
    doc = addFrameToPaperPage(doc, pageId, spec).document;
  };

  // Split the blocks into contiguous per-section runs (sectionIndex was stamped in document order).
  const groups: { sectionIndex: number; blocks: ImportedPaperTextBlock[] }[] = [];
  for (const block of blocks) {
    const si = block.sectionIndex ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.sectionIndex === si) last.blocks.push(block);
    else groups.push({ sectionIndex: si, blocks: [block] });
  }

  let firstGroup = true;
  for (const group of groups) {
    // Merge consecutive same-border/shading callout paragraphs into single frames (continuous shaded box, like
    // the source) before laying the section out.
    const groupBlocks = mergeConsecutiveCallouts(group.blocks);
    const geom = sections[group.sectionIndex];
    const landscape = geom?.landscape === true;
    const columnCount = Math.max(1, Math.min(12, geom?.columns ?? 1));
    const columnGutterMm = geom?.columnGutterMm ?? 7.5;
    const margins = geom?.marginsMm ?? doc.layout.marginsMm;
    // A landscape section becomes a rotated page (Paper has one document-wide page size), so its content axis
    // is the page's LONG side — exactly what printing a mixed-orientation document does.
    const pageWidthMm = landscape ? doc.page.heightMm : doc.page.widthMm;
    const pageHeightMm = landscape ? doc.page.widthMm : doc.page.heightMm;
    const contentLeftMm = margins.left;
    const contentTopMm = margins.top;
    const contentWidthMm = Math.max(40, pageWidthMm - margins.left - margins.right);
    const contentBottomMm = pageHeightMm - margins.bottom;

    // Word sections default to nextPage — every section after the first opens a fresh page.
    if (!firstGroup) {
      doc = addPaperPage(doc);
      pageId = doc.pages[doc.pages.length - 1].id;
    }
    firstGroup = false;
    let sectionFirstPage = true;

    // Rotate a laid-out rect (top-left = topMm/leftMm, size lw×lh) onto the portrait page for a landscape
    // section (identity for portrait). CSS rotates about the frame centre, so we place that centre.
    const place = (lw: number, lh: number, topMm: number, leftMm: number): { xMm: number; yMm: number; rotationDeg: number } => {
      if (!landscape) return { xMm: leftMm, yMm: topMm, rotationDeg: 0 };
      const centreX = doc.page.widthMm - (topMm + lh / 2);
      const centreY = leftMm + lw / 2;
      return { xMm: centreX - lw / 2, yMm: centreY - lh / 2, rotationDeg: 90 };
    };
    const registerPage = (): void => {
      if (!pageMeta.has(pageId)) {
        pageMeta.set(pageId, { sectionIndex: group.sectionIndex, isSectionFirst: sectionFirstPage, landscape, contentLeftMm, contentWidthMm, contentTopMm, contentBottomMm, footnotes: [] });
      }
      if (landscape) landscapePageIds.add(pageId);
    };
    const newPage = (): void => {
      doc = addPaperPage(doc);
      pageId = doc.pages[doc.pages.length - 1].id;
      sectionFirstPage = false;
    };
    const noteFootnotes = (block: ImportedPaperTextBlock): void => {
      if (block.footnoteRefs?.length) pageMeta.get(pageId)?.footnotes.push(...block.footnoteRefs);
    };

    // Place one block (table / image / heading / paragraph) with its top-left at topMm/contentLeftMm, spanning
    // `widthMm`. Returns the vertical space consumed (including the gap after it).
    const placeBlock = async (block: ImportedPaperTextBlock, topMm: number, widthMm: number): Promise<number> => {
      const heightMm = estimateBlockHeightMm(block, widthMm);
      if (block.role === 'table' && block.table) {
        const at = place(widthMm, heightMm, topMm, contentLeftMm);
        addFrame({ kind: 'text', label: 'Imported Table', xMm: at.xMm, yMm: at.yMm, widthMm, heightMm, rotationDeg: at.rotationDeg, text: '', columns: 1, table: normalizePaperTable(block.table), fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0, paragraphStyleId: undefined });
        return heightMm + 2;
      }
      if (block.role === 'image' && block.image) {
        const intrinsicW = block.image.widthMm && block.image.widthMm > 1 ? block.image.widthMm : widthMm;
        const intrinsicH = block.image.heightMm && block.image.heightMm > 1 ? block.image.heightMm : widthMm * 0.6;
        const drawW = Math.min(widthMm, intrinsicW);
        const drawH = intrinsicW > 0 ? (drawW / intrinsicW) * intrinsicH : intrinsicH;
        const frameH = Math.max(8, drawH);
        const at = place(drawW, frameH, topMm, contentLeftMm);
        // Imported pictures flow like Word/LibreOffice inline images — no frame border.
        const ref = await storePaperBinaryAsset(paperAssetRepository, block.image.bytes, {
          mimeType: block.image.mimeType,
          fileName: 'imported-image',
        });
        addFrame({ kind: 'image', label: 'Imported Image', xMm: at.xMm, yMm: at.yMm, widthMm: drawW, heightMm: frameH, rotationDeg: at.rotationDeg, fit: 'contain', strokeColor: 'transparent', strokeWidthMm: 0, asset: { label: block.text || 'Embedded image', kind: 'image', locator: { kind: 'managed', ref }, mimeType: block.image.mimeType, embeddedAt: Date.now() } });
        return frameH + 2.5;
      }
      const headingTypography = block.role === 'heading'
        ? { fontSizePt: block.level && block.level > 2 ? 13 : 16, leadingPt: block.level && block.level > 2 ? 16 : 19, fontWeight: '700', hyphenate: false }
        : {};
      const typography = {
        ...headingTypography,
        ...(block.fontSizePt ? { fontSizePt: block.fontSizePt, leadingPt: Math.round(block.fontSizePt * 1.3) } : {}),
        ...(block.color ? { color: block.color } : {}),
        ...(block.align ? { align: block.align } : {}),
        ...(block.bold ? { fontWeight: '700' } : {}),
        ...(block.italic ? { fontStyle: 'italic' as const } : {}),
        // A 縦書き section imports its text frames vertical so a Japanese vertical document keeps its direction
        // (kinsoku defaults on in vertical; the ruby/emphasis notation from the runs renders as usual).
        ...(geom?.vertical ? { writingMode: 'vertical-rl' as const, textOrientation: 'mixed' as const } : {}),
      };
      // The frame is sized to SHOW all its text (frameMm), but the cursor advances by the tighter advanceMm so
      // adjacent frames' empty padding zones overlap and the page density matches a word processor.
      const { frameMm, advanceMm } = measureImportedTextBlock(block, widthMm);
      const at = place(widthMm, frameMm, topMm, contentLeftMm);
      // A Word paragraph is just text flowing on the page — no fill, no border (the default white fill + dark
      // stroke read as a black box around every paragraph). Each paragraph stays a separate, freely-placeable
      // frame (the DTP workflow the owner wants), just without the box.
      addFrame({
        kind: 'text', label: block.role === 'heading' ? 'Imported Heading' : 'Imported Text',
        xMm: at.xMm, yMm: at.yMm, widthMm, heightMm: frameMm, rotationDeg: at.rotationDeg, text: block.text,
        fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0,
        ...(block.richText ? { richText: block.richText } : {}),
        columns: 1,
        ...(block.hyperlink ? { hyperlink: block.hyperlink } : {}),
        typography: Object.keys(typography).length ? typography : undefined,
        paragraphStyleId: undefined,
      });
      return advanceMm;
    };

    if (columnCount > 1 && !landscape) {
      // MULTI-COLUMN section: merge its consecutive text/heading paragraphs into ONE full-width frame whose
      // native CSS columns (columnFill:auto) flow the text column-by-column — exactly how a word processor
      // lays out a multi-column section. Paginate at paragraph boundaries so a paragraph never splits pages.
      const colWidthMm = Math.max(20, (contentWidthMm - columnGutterMm * (columnCount - 1)) / columnCount);
      const availHeightMm = contentBottomMm - contentTopMm;
      const pageCapacityMm = availHeightMm * columnCount;
      let acc: ImportedPaperTextBlock[] = [];
      let accHeightMm = 0;
      let pageDirty = false; // current page already carries a columns/figure frame → next flush needs a new page
      const flushColumns = (): void => {
        if (!acc.length) return;
        if (pageDirty) { newPage(); pageDirty = false; }
        registerPage();
        const richText = mergeBlocksToColumnParagraphs(acc);
        const frameHeightMm = Math.min(availHeightMm, Math.ceil(accHeightMm / columnCount) + 8);
        addFrame({ kind: 'text', label: `Imported Columns (${columnCount})`, xMm: contentLeftMm, yMm: contentTopMm, widthMm: contentWidthMm, heightMm: frameHeightMm, text: flattenPaperRichText(richText), richText, columns: columnCount, columnGutterMm, fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0, paragraphStyleId: undefined });
        for (const b of acc) noteFootnotes(b);
        pageDirty = true;
        acc = [];
        accHeightMm = 0;
      };
      for (const block of groupBlocks) {
        if (block.role === 'table' || block.role === 'image') {
          // A wide table/figure inside a multi-column section spans all columns on its own band.
          flushColumns();
          if (pageDirty) { newPage(); pageDirty = false; }
          registerPage();
          await placeBlock(block, contentTopMm, contentWidthMm);
          noteFootnotes(block);
          pageDirty = true;
          continue;
        }
        if (block.pageBreakBefore && (acc.length || pageDirty)) { flushColumns(); if (pageDirty) { newPage(); pageDirty = false; } }
        // Column text flows continuously (one frame padding for the whole box), so pack by the per-paragraph
        // advance, not each paragraph's full padded frame height. (Tables/images already handled + continued above.)
        const hMm = measureImportedTextBlock(block, colWidthMm).advanceMm;
        if (acc.length && accHeightMm + hMm > pageCapacityMm) flushColumns();
        acc.push(block);
        accHeightMm += hMm;
      }
      flushColumns();
    } else {
      // SINGLE COLUMN (portrait, or a rotated landscape section): one frame per block, flowing down the page.
      let yMm = contentTopMm;
      let footnoteReserveMm = 0; // keep the bottom clear for footnotes registered on this page
      let prevContentBottomMm = contentTopMm; // visible bottom of the last placed frame (text, not empty padding)
      for (const block of groupBlocks) {
        // Decide the break by how much the block CONSUMES in the flow (its cursor advance, with padding overlap),
        // not the full padded frame height — otherwise the border-padding a bordered frame reserves to avoid
        // clipping would double-count against pagination and break pages early (10-page source → 11).
        const heightMm = estimateBlockAdvanceMm(block, contentWidthMm);
        // Honor the document's own page breaks (`<w:br type=page>` / pageBreakBefore), then fall back to
        // flowing to a new page when the block won't fit. A small tolerance lets the last paragraph pack down
        // toward the margin edge (as a word processor does) instead of breaking early and wasting a page.
        const fitBottomMm = contentBottomMm - footnoteReserveMm + 2;
        if ((block.pageBreakBefore && yMm > contentTopMm) || (yMm > contentTopMm && yMm + heightMm > fitBottomMm)) {
          newPage();
          yMm = contentTopMm;
          footnoteReserveMm = 0;
          prevContentBottomMm = contentTopMm;
        }
        registerPage();
        // An opaque box (bordered/shaded) hugs its frame with no top padding, so the padding-overlap must not push
        // it up over the previous frame's last line — start it at or below that frame's visible content bottom.
        const opaque = blockIsOpaque(block);
        const placeY = opaque ? Math.max(yMm, prevContentBottomMm) : yMm;
        const frameHMm = estimateBlockHeightMm(block, contentWidthMm);
        const advance = await placeBlock(block, placeY, contentWidthMm);
        // Clear the previous frame's full box bottom before dropping an opaque box below it. For a padded (non-
        // opaque) frame the 2mm bottom padding doubles as slack for any height under-estimate, so the next opaque
        // box never lands on real text.
        prevContentBottomMm = placeY + frameHMm;
        yMm = placeY + advance;
        noteFootnotes(block);
        if (block.footnoteRefs?.length && !landscape) {
          footnoteReserveMm = Math.max(footnoteReserveMm, estimateFootnoteZoneHeightMm(pageMeta.get(pageId)!.footnotes, footnoteContentByNumber, contentWidthMm));
        }
      }
    }
  }

  // Drop any spurious frameless page a multi-column figure break may have opened, before decoration adds the
  // running header/footer that would otherwise keep an empty page alive.
  if (doc.pages.length > 1) {
    const kept = doc.pages.filter((page) => page.frames.length > 0);
    if (kept.length && kept.length < doc.pages.length) doc = { ...doc, pages: kept };
  }

  // ---- Decoration pass: running headers/footers + page-bottom footnotes ----
  // Draw a header/footer paragraph into the top/bottom margin band, substituting the live page number for the
  // `{PAGE}`/`{NUMPAGES}` field placeholders. Muted 8.5pt so it reads as document furniture, not body copy.
  const addHeaderFooter = (content: DocxHeaderFooterContent, isHeader: boolean, meta: PaperImportPageMeta, geom: DocxSectionGeometry | undefined, substitute: (t: string) => string): void => {
    const paras: PaperRichParagraph[] = content.paragraphs
      .map((p) => ({ text: substitute(p.text), align: p.align }))
      .filter((p) => p.text.trim())
      .map((p) => ({ runs: [{ text: p.text, fontSizePt: 8.5, color: '#4b5563' }], align: p.align ?? (isHeader ? 'left' : 'center') }));
    if (!paras.length) return;
    const distance = isHeader ? (geom?.headerDistanceMm ?? 12.7) : (geom?.footerDistanceMm ?? 12.7);
    const heightMm = Math.max(6, paras.length * 5 + 2);
    const yMm = isHeader
      ? Math.max(3, distance)
      : Math.max(meta.contentBottomMm + 2, doc.page.heightMm - distance - heightMm + 2);
    addFrame({ kind: 'text', label: isHeader ? 'Header' : 'Footer', xMm: meta.contentLeftMm, yMm, widthMm: meta.contentWidthMm, heightMm, text: flattenPaperRichText(paras), richText: paras, columns: 1, fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0, paragraphStyleId: undefined });
  };
  const addFootnotes = (meta: PaperImportPageMeta): void => {
    const body: PaperRichParagraph[] = [];
    for (const num of meta.footnotes) {
      const content = footnoteContentByNumber.get(num);
      if (!content) continue;
      body.push({ runs: [{ text: `${num} `, vertAlign: 'super', fontSizePt: 7 }, ...content.runs.map((r) => ({ ...r, fontSizePt: r.fontSizePt ?? 8.5 }))] });
    }
    if (!body.length) return;
    // A short separator rule above the notes (a thin top border on a blank lead paragraph).
    const paras: PaperRichParagraph[] = [{ runs: [{ text: '' }], borders: { top: { color: '#9ca3af', widthPt: 0.75 } }, spaceBeforeMm: 1, spaceAfterMm: 1 }, ...body];
    const heightMm = estimateFootnoteZoneHeightMm(meta.footnotes, footnoteContentByNumber, meta.contentWidthMm);
    const yMm = Math.max(meta.contentTopMm, meta.contentBottomMm - heightMm);
    addFrame({ kind: 'text', label: 'Footnotes', xMm: meta.contentLeftMm, yMm, widthMm: meta.contentWidthMm, heightMm, text: flattenPaperRichText(paras), richText: paras, columns: 1, fillColor: 'transparent', strokeColor: 'transparent', strokeWidthMm: 0, paragraphStyleId: undefined });
  };
  const totalPages = doc.pages.length;
  for (const [index, page] of doc.pages.entries()) {
    const meta = pageMeta.get(page.id);
    if (!meta || meta.landscape) continue; // skip un-laid-out and rotated landscape pages (furniture would need rotating too)
    const geom = sections[meta.sectionIndex];
    pageId = page.id;
    const substitute = (t: string) => t.replace(new RegExp(DOCX_FIELD_PAGE, 'g'), String(index + 1)).replace(new RegExp(DOCX_FIELD_NUMPAGES, 'g'), String(totalPages));
    const useFirst = meta.isSectionFirst && geom?.titlePage === true;
    const header = useFirst ? geom?.firstHeader : geom?.header;
    const footer = useFirst ? geom?.firstFooter : geom?.footer;
    if (header) addHeaderFooter(header, true, meta, geom, substitute);
    if (footer) addHeaderFooter(footer, false, meta, geom, substitute);
    if (meta.footnotes.length) addFootnotes(meta);
  }

  // Give EVERY page the document margin guides, replacing the default centre-cross that `addPaperPage` seeds on
  // pages after the first (the owner: that cross "gets in the way"). Rotated landscape pages get no guides — the
  // portrait margin box wouldn't line up with their rotated content.
  if (marginGuides.length) {
    doc = { ...doc, pages: doc.pages.map((page) => ({ ...page, guides: landscapePageIds.has(page.id) ? [] : marginGuides })) };
  }

  return doc;
}

/** Per-page state gathered during layout and consumed by the header/footer/footnote decoration pass. */
interface PaperImportPageMeta {
  sectionIndex: number;
  isSectionFirst: boolean;
  landscape: boolean;
  contentLeftMm: number;
  contentWidthMm: number;
  contentTopMm: number;
  contentBottomMm: number;
  footnotes: number[];
}

/** Flatten a run of imported blocks into one paragraph list for a multi-column frame — baking each heading's
 * size/weight into its runs (since the merged frame has no per-paragraph heading typography). */
function mergeBlocksToColumnParagraphs(blocks: ImportedPaperTextBlock[]): PaperRichParagraph[] {
  const out: PaperRichParagraph[] = [];
  for (const b of blocks) {
    const src = b.richText && b.richText.length ? b.richText : [{ runs: [{ text: b.text }] }];
    for (const p of src) {
      if (b.role === 'heading') {
        const size = b.fontSizePt ?? (b.level && b.level > 2 ? 13 : 16);
        const runs = p.runs.map((r) => ({ ...r, fontSizePt: r.fontSizePt ?? size, fontWeight: r.fontWeight ?? '700' }));
        out.push({ ...p, runs, spaceBeforeMm: p.spaceBeforeMm ?? 3, spaceAfterMm: p.spaceAfterMm ?? 1.5 });
      } else {
        out.push(p);
      }
    }
  }
  return out.length ? out : [{ runs: [{ text: '' }] }];
}

/** Height (mm) a page-bottom footnote zone needs: the frame padding + a separator gap plus each note wrapped
 * at the text width. */
function estimateFootnoteZoneHeightMm(numbers: number[], contentByNumber: Map<number, PaperRichParagraph>, widthMm: number): number {
  let h = PAPER_FRAME_PAD_MM + 4;
  for (const num of numbers) {
    const content = contentByNumber.get(num);
    const text = `${num} ` + (content ? content.runs.map((r) => r.text).join('') : '');
    h += estimateTextFrameHeightMm(text, false, 8.5, widthMm - PAPER_FRAME_PAD_MM);
  }
  return h;
}

// Every Paper text frame insets its content by 2mm on each edge (paperFrameContentPaddingPx), and a paragraph
// border/shading adds a little more — so a frame must be TALLER than its raw text or the last line (and the
// bottom border) get clipped. This is the size a frame needs to actually SHOW everything it holds.
const PAPER_FRAME_PAD_MM = 4; // 2mm top + 2mm bottom content padding

/** Size a text/heading block two ways: `frameMm` is how tall the frame must be to show all its text without
 * clipping (text + frame padding + border inset + paragraph spacing); `advanceMm` is how far the layout cursor
 * should move to the next block — tighter than `frameMm`, letting the empty padding zones overlap so the page
 * density matches a word processor instead of ballooning one box's padding into the gap. */
const PT_TO_MM = 25.4 / 72;
const PX_PER_MM_96 = 96 / 25.4; // screen scale the renderer draws at (PAPER_SCREEN_PX_PER_MM), zoom = 1
const PT_TO_PX_96 = 96 / 72; // pt → px at 96dpi, matching the renderer's `fontSizePt * 1.333`
const DEFAULT_IMPORT_FONT = 'Inter, system-ui, sans-serif'; // imported frames inherit the default paper face

interface ImportBaseFont { basePt: number; leadingMm: number; family: string; weight: string; style: string }

// A shared canvas 2D context for real glyph measurement; null in node/tests (no `document`) → callers fall back.
let sharedImportMeasureCtx: CanvasRenderingContext2D | null | undefined;
function importMeasureCtx(): CanvasRenderingContext2D | null {
  if (sharedImportMeasureCtx !== undefined) return sharedImportMeasureCtx;
  sharedImportMeasureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return sharedImportMeasureCtx;
}

/** Real wrapped height (mm) of ONE paragraph, measured with the actual font via canvas `measureText`: exact glyph
 * widths give the true line COUNT, and each line's height grows to its largest run (an 18pt run makes its line
 * taller, exactly as the browser does). Returns null when no canvas is available (node/tests) so the caller can
 * fall back to the average-glyph estimate. This is the auto-fit measurement — frames sized from it neither clip
 * nor leave slack. */
function measureParagraphHeightMm(p: PaperRichParagraph, base: ImportBaseFont, usableMm: number): number | null {
  const ctx = importMeasureCtx();
  if (!ctx) return null;
  const usablePx = Math.max(20, usableMm) * PX_PER_MM_96;
  const runs = p.runs && p.runs.length ? p.runs : [{ text: '' }];
  let heightMm = 0;
  let lineWidthPx = 0;
  let lineMaxPt = base.basePt;
  let lineStarted = false;
  const endLine = () => {
    // Line box height = the frame's leading, unless a larger run on this line grows it (~1.2em content box).
    heightMm += Math.max(base.leadingMm, lineMaxPt * PT_TO_MM * 1.2);
    lineWidthPx = 0;
    lineMaxPt = base.basePt;
    lineStarted = false;
  };
  for (const r of runs) {
    const isScript = r.vertAlign === 'super' || r.vertAlign === 'sub';
    const sizePt = isScript ? (r.fontSizePt ?? base.basePt * 0.7) : (r.fontSizePt ?? base.basePt);
    const family = r.fontFamily ?? base.family;
    const weight = r.fontWeight ?? base.weight;
    const style = r.fontStyle ?? base.style;
    const sizePx = sizePt * PT_TO_PX_96;
    ctx.font = `${style && style !== 'normal' ? `${style} ` : ''}${weight} ${sizePx}px ${family}`;
    const trackPerChar = ((r.tracking ?? 0) / 1000) * sizePx;
    (r.text ?? '').split('\n').forEach((chunk, ci) => {
      if (ci > 0) endLine(); // explicit hard line break
      for (const tok of chunk.split(/(\s+)/)) {
        if (!tok) continue;
        const isSpace = /^\s+$/.test(tok);
        if (!lineStarted && isSpace) continue; // don't open a line with leading whitespace
        const w = ctx.measureText(tok).width + tok.length * trackPerChar;
        if (lineStarted && !isSpace && lineWidthPx + w > usablePx) endLine();
        lineWidthPx += w;
        lineMaxPt = Math.max(lineMaxPt, sizePt);
        lineStarted = true;
      }
    });
  }
  if (lineStarted || heightMm === 0) endLine(); // final (or sole, for an empty paragraph) line
  return heightMm;
}

/** Average-glyph fallback for one paragraph when no canvas is available (node/tests). */
function fallbackParagraphHeightMm(p: PaperRichParagraph, base: ImportBaseFont, usableMm: number): number {
  const runs = p.runs && p.runs.length ? p.runs : [{ text: '' }];
  let hardLines = 1;
  let advanceMm = 0;
  for (const r of runs) {
    const sizePt = r.fontSizePt ?? base.basePt;
    const emMm = sizePt * PT_TO_MM;
    const trackMul = 1 + Math.max(0, r.tracking ?? 0) / 1000;
    (r.text ?? '').split('\n').forEach((seg, j) => {
      if (j > 0) hardLines += 1;
      advanceMm += seg.length * emMm * 0.5 * trackMul;
    });
  }
  const wrapLines = Math.max(1, Math.ceil(advanceMm / Math.max(10, usableMm)));
  return Math.max(hardLines, wrapLines) * base.leadingMm;
}

/** Height (mm) of a block's wrapped text. Uses the real canvas line-breaker (auto-fit) when a browser canvas is
 * available, else the average-glyph estimate. Adds inter-paragraph gaps for merged frames and the border box's
 * padding once (continuous-box model). Falls back to the plain estimate for blocks with no rich runs. */
function estimateBlockTextHeightMm(block: ImportedPaperTextBlock, usableWidthMm: number): number {
  const paras = block.richText;
  if (!paras || !paras.length) {
    return estimateTextFrameHeightMm(block.text, block.role === 'heading', block.fontSizePt, usableWidthMm);
  }
  const basePt = block.fontSizePt ?? (block.role === 'heading' ? 16 : 10);
  const base: ImportBaseFont = {
    basePt,
    leadingMm: basePt * PT_TO_MM * 1.3,
    family: DEFAULT_IMPORT_FONT,
    weight: block.role === 'heading' || block.bold ? '700' : '400',
    style: block.italic ? 'italic' : 'normal',
  };
  const usable = Math.max(10, usableWidthMm);
  let totalMm = 0;
  paras.forEach((p, i) => {
    totalMm += measureParagraphHeightMm(p, base, usable) ?? fallbackParagraphHeightMm(p, base, usable);
    // Inter-paragraph gap for a multi-paragraph (merged) frame — matches the render's per-paragraph top margin.
    if (i > 0) totalMm += Math.max(p.spaceBeforeMm ?? 0, 0.6);
  });
  // Border box padding, counted ONCE for the whole frame (the render draws a merged callout as a continuous box:
  // border spacing + top/bottom stroke only at the outer edges, not around every paragraph).
  const rep = paras.find((p) => p.borders)?.borders;
  if (rep) {
    const pad = (rep.paddingPt != null ? rep.paddingPt : 2) * PT_TO_MM;
    const vb = ((rep.top?.widthPt ?? 0) + (rep.bottom?.widthPt ?? 0)) * PT_TO_MM;
    totalMm += 2 * pad + vb;
  }
  return totalMm;
}

function measureImportedTextBlock(block: ImportedPaperTextBlock, columnWidthMm: number): { frameMm: number; advanceMm: number } {
  const para = block.richText?.[0];
  const paras = block.richText;
  const b = para?.borders;
  // A frame whose paragraphs ALL carry a border/shading hugs the frame edge (zero frame content padding) so the
  // box's stroke sits on the selection bounds — one bordered paragraph OR a merged callout of several. It renders
  // with no 2mm frame inset, so its size comes from the border insets (added per-paragraph in the height estimate
  // above), not the frame padding.
  const bordered = Boolean(paras && paras.length && paras.every((p) => p.borders || p.shading));
  const spacingMm = (para?.spaceBeforeMm ?? 0) + (para?.spaceAfterMm ?? 0);
  const edgePadMm = b ? (b.paddingPt != null ? b.paddingPt * PT_TO_MM : 0.6) : 0;
  const hBorderMm = b ? (((b.left?.widthPt ?? 0) + (b.right?.widthPt ?? 0)) * PT_TO_MM) : 0;
  const framePadMm = bordered ? 0 : PAPER_FRAME_PAD_MM;
  const innerPadMm = bordered ? 2 * edgePadMm + hBorderMm : PAPER_FRAME_PAD_MM; // horizontal inset text wraps within
  const indentMm = (para?.leftIndentMm ?? 0) + (para?.rightIndentMm ?? 0);
  const wrapMm = Math.max(20, columnWidthMm - innerPadMm - indentMm);
  const textMm = estimateBlockTextHeightMm(block, wrapMm); // text + inter-paragraph gaps + border chrome (once)
  const frameMm = textMm + framePadMm + spacingMm + (bordered ? 0.8 : 1);
  const gapMm = block.role === 'heading' ? 1.6 : 0.6;
  // The cursor advances LESS than the frame is tall so adjacent frames' empty padding zones overlap and the
  // text flows tightly (the owner's point: "there's some overlap that needs to happen"). A word processor also
  // collapses adjacent paragraph spacing, so only count half of it toward the step.
  const advanceMm = textMm + spacingMm * 0.5 + gapMm;
  return { frameMm, advanceMm };
}

/** Vertical space (mm) a laid-out block's FRAME needs: tables scale with rows, images with their fitted height,
 * text with its wrapped-line count plus the frame's own padding/border/spacing (so nothing clips). */
function estimateBlockHeightMm(block: ImportedPaperTextBlock, columnWidthMm: number): number {
  if (block.role === 'table' && block.table) {
    return Math.max(14, block.table.rows * 8 + 4);
  }
  if (block.role === 'image' && block.image) {
    const intrinsicW = block.image.widthMm && block.image.widthMm > 1 ? block.image.widthMm : columnWidthMm;
    const intrinsicH = block.image.heightMm && block.image.heightMm > 1 ? block.image.heightMm : columnWidthMm * 0.6;
    const drawW = Math.min(columnWidthMm, intrinsicW);
    return Math.max(8, intrinsicW > 0 ? (drawW / intrinsicW) * intrinsicH : intrinsicH) + 3;
  }
  return measureImportedTextBlock(block, columnWidthMm).frameMm;
}

/** Vertical space (mm) a block CONSUMES in the flow — the layout cursor's step. For text this is the tighter
 * `advanceMm` (adjacent frames' empty padding overlaps), NOT the full frame height, so the page-break decision
 * paginates at word-processor density instead of breaking a page early on padding that visually overlaps. Tables
 * and images don't overlap, so their consumption is their full height. */
function estimateBlockAdvanceMm(block: ImportedPaperTextBlock, columnWidthMm: number): number {
  if (block.role === 'table' || block.role === 'image') return estimateBlockHeightMm(block, columnWidthMm);
  return measureImportedTextBlock(block, columnWidthMm).advanceMm;
}

/** True when a block renders as an opaque box (every paragraph carries a border/shading). Such a frame hugs the
 * frame edge with no top padding, so the flow's designed padding-overlap would let its box cover the previous
 * frame's last line — placement must clear the previous frame's visible content before dropping one in. */
function blockIsOpaque(block: ImportedPaperTextBlock): boolean {
  const paras = block.richText;
  return Boolean(paras && paras.length && paras.every((p) => p.borders || p.shading));
}

/** Signature identifying a mergeable callout paragraph — a simple single-paragraph block that carries the same
 * paragraph border + shading + left-indent as its neighbour. Word renders a multi-paragraph callout (e.g. an
 * "IMPLEMENTATION NOTE" box) as ONE continuous shaded box with one border; importing each paragraph as its own
 * padded frame breaks that into disconnected chunks and wastes vertical space. */
function calloutSignature(block: ImportedPaperTextBlock): string | null {
  if (block.role !== 'paragraph') return null;
  const paras = block.richText;
  if (!paras || paras.length !== 1) return null;
  const p = paras[0];
  if (!p.borders && !p.shading) return null;
  return JSON.stringify({ b: p.borders ?? null, s: p.shading ?? null, li: p.leftIndentMm ?? 0, ri: p.rightIndentMm ?? 0 });
}

/** Merge runs of consecutive same-signature callout paragraphs into one frame (multi-paragraph richText) so the
 * shaded box renders continuously — one border, one fill — exactly as the source word processor draws it. */
function mergeConsecutiveCallouts(blocks: ImportedPaperTextBlock[]): ImportedPaperTextBlock[] {
  const out: ImportedPaperTextBlock[] = [];
  let lastSig: string | null = null;
  for (const block of blocks) {
    const sig = block.pageBreakBefore ? null : calloutSignature(block);
    if (sig && sig === lastSig && out.length) {
      const prev = out[out.length - 1];
      prev.richText = [...(prev.richText ?? []), ...(block.richText ?? [])];
      prev.text = [prev.text, block.text].filter(Boolean).join('\n');
      if (block.footnoteRefs?.length) prev.footnoteRefs = [...(prev.footnoteRefs ?? []), ...block.footnoteRefs];
      continue; // keep lastSig so a third matching paragraph also merges
    }
    out.push({ ...block, richText: block.richText ? block.richText.map((p) => ({ ...p })) : block.richText });
    lastSig = sig;
  }
  return out;
}

export function placeDocumentSourceOnPaperPage(
  doc: PaperDocument,
  pageId: string,
  item: SourceBinLibraryItem,
  point = { xMm: doc.layout.marginsMm.left, yMm: doc.layout.marginsMm.top },
): { document: PaperDocument; frameId: string } {
  return addFrameToPaperPage(doc, pageId, {
    kind: 'document',
    label: item.label,
    xMm: point.xMm,
    yMm: point.yMm,
    widthMm: Math.min(120, Math.max(70, doc.page.widthMm - point.xMm - doc.layout.marginsMm.right)),
    heightMm: Math.min(150, Math.max(80, doc.page.heightMm - point.yMm - doc.layout.marginsMm.bottom)),
    asset: {
      ...buildPaperFrameAssetFromSourceItem(item),
      text: item.text,
      format: inferPaperDocumentImportFormat(item.label, item.mimeType),
    },
    fillColor: '#f8fafc',
    strokeColor: '#64748b',
    strokeWidthMm: 0.25,
  });
}

export function exportPaperIdmlInterchange(document: PaperDocument): string {
  const links = collectDocumentLinks(document);
  const interchange: PaperIdmlInterchange = {
    app: 'Sloom Studio Paper',
    format: 'sloom-idml-json',
    version: 1,
    manifest: {
      title: document.title,
      documentId: document.id,
      pageCount: document.pages.length,
      frameCount: document.pages.reduce((sum, page) => sum + page.frames.length, 0),
      linkCount: links.length,
      exportedAt: new Date().toISOString(),
    },
    document,
    spreads: document.pages.map((page) => ({ id: `spread-${page.pageNumber}`, pageIds: [page.id] })),
    links,
    guides: [
      ...document.parentPages.flatMap((parent) => parent.guides.map((guide) => ({ ownerId: parent.id, ownerType: 'parentPage' as const, ...guide }))),
      ...document.pages.flatMap((page) => page.guides.map((guide) => ({ ownerId: page.id, ownerType: 'page' as const, ...guide }))),
    ],
  };
  return `${JSON.stringify(interchange, null, 2)}\n`;
}

export function importPaperIdmlInterchange(json: string): PaperDocument {
  const parsed = JSON.parse(json) as Partial<PaperIdmlInterchange>;
  if (parsed.format !== 'sloom-idml-json' || !parsed.document) {
    throw new Error('The selected file is not a Sloom Studio Paper IDML-like interchange document.');
  }
  return parsePaperDocument(JSON.stringify(parsed.document));
}

export function exportPaperStoryText(document: PaperDocument, format: PaperStoryExportFormat): { fileName: string; mimeType: string; text: string; blob: Blob } | PaperZipExport {
  const baseName = safePathPart(document.title || 'paper-stories');
  const stories = extractPaperStoryText(document);
  if (format === 'html') {
    const text = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title></head><body>\n${stories.map((story) => {
      const body = escapeHtml(story.text).replaceAll('\n', '<br>');
      const paragraph = story.hyperlink ? `<p><a href="${escapeHtml(story.hyperlink)}">${body}</a></p>` : `<p>${body}</p>`;
      return `<section data-page="${story.pageNumber}" data-frame="${escapeHtml(story.frameId)}"><h2>Page ${story.pageNumber}: ${escapeHtml(story.label)}</h2>${paragraph}</section>`;
    }).join('\n')}\n</body></html>\n`;
    return { fileName: `${baseName}.html`, mimeType: 'text/html', text, blob: new Blob([text], { type: 'text/html' }) };
  }
  if (format === 'rtf') {
    const text = `{\\rtf1\\ansi\n${stories.map((story) => `\\b Page ${story.pageNumber}: ${escapeRtf(story.label)}\\b0\\par\n${escapeRtf(story.text)}\\par`).join('\n')}}`;
    return { fileName: `${baseName}.rtf`, mimeType: 'application/rtf', text, blob: new Blob([text], { type: 'application/rtf' }) };
  }
  if (format === 'docx') {
    return buildDocxStoryExport(document, stories);
  }
  const text = stories.map((story) => `Page ${story.pageNumber}: ${story.label}\n${story.text}`).join('\n\n');
  return { fileName: `${baseName}.txt`, mimeType: 'text/plain', text: `${text}\n`, blob: new Blob([`${text}\n`], { type: 'text/plain' }) };
}

export async function buildPaperCbzRasterExport(
  document: PaperDocument,
  options: PaperCbzRasterExportOptions = {},
): Promise<PaperZipExport> {
  assertPaperDocumentSupportsRasterization(document);
  const pageCount = document.pages.length;
  const padLength = Math.max(3, String(pageCount).length);
  const entries: Record<string, Uint8Array> = {};
  const pages: Array<{ pageNumber: number; path: string; widthPx: number; heightPx: number; widthMm: number; heightMm: number; frameCount: number }> = [];
  const rasterize = options.rasterize ?? ((exported: FlattenedPaperPageSvgExport) => rasterizeFlattenedPaperPageToPng(exported));
  const resolveImageSrc = options.resolveImageSrc ?? ((src: string) => imageSourceToDataUrl(src));

  for (let index = 0; index < document.pages.length; index += 1) {
    const page = document.pages[index];
    const svgExport = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, page.id, {
      includeBleed: options.includeBleed,
      resolveImageSrc,
      fontFaceCss: options.fontFaceCss,
    });
    const rasterExport = await Promise.resolve(rasterize(svgExport));
    const path = `pages/page-${String(index + 1).padStart(padLength, '0')}.png`;
    entries[path] = dataUrlToU8(rasterExport.dataUrl, 'image/png');
    pages.push({
      pageNumber: page.pageNumber,
      path,
      widthPx: rasterExport.widthPx,
      heightPx: rasterExport.heightPx,
      widthMm: rasterExport.widthMm,
      heightMm: rasterExport.heightMm,
      frameCount: page.frames.length,
    });
    options.onPageRasterized?.({ pageNumber: page.pageNumber, pageIndex: index, pageCount });
  }

  const manifest = {
    app: 'Sloom Studio Paper',
    format: 'sloom-cbz-raster',
    title: document.title,
    pageCount,
    pages,
    exportedAt: new Date().toISOString(),
  };
  entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries['ComicInfo.xml'] = strToU8(buildComicInfoXml(document, pageCount));

  const zipped = zipSync(entries);
  return {
    fileName: `${safePathPart(document.title || 'paper-pages')}.cbz`,
    mimeType: 'application/vnd.comicbook+zip',
    blob: new Blob([zipped], { type: 'application/vnd.comicbook+zip' }),
    entries: Object.keys(entries),
  };
}

export function buildPaperCbzManifestExport(document: PaperDocument): PaperZipExport {
  const manifest = {
    app: 'Sloom Studio Paper',
    format: 'sloom-cbz-manifest',
    title: document.title,
    pageCount: document.pages.length,
    pages: document.pages.map((page) => ({ pageNumber: page.pageNumber, path: `pages/page-${String(page.pageNumber).padStart(3, '0')}.svg`, frameCount: page.frames.length })),
  };
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  for (const page of document.pages) {
    entries[`pages/page-${String(page.pageNumber).padStart(3, '0')}.svg`] = strToU8(renderPageManifestSvg(document, page));
  }
  const zipped = zipSync(entries);
  return {
    fileName: `${safePathPart(document.title || 'paper-pages')}.cbz`,
    mimeType: 'application/vnd.comicbook+zip',
    blob: new Blob([zipped], { type: 'application/vnd.comicbook+zip' }),
    entries: Object.keys(entries),
  };
}

function buildComicInfoXml(document: PaperDocument, pageCount: number): string {
  // <Manga> is the ComicInfo standard reading-direction field: `YesAndRightToLeft` tells manga readers (Tachiyomi,
  // Panels, YACReader, Komga…) to page right-to-left; a left-bound book emits `No`. Auto-derives for vertical docs.
  const manga = effectiveRtlBinding(document) ? 'YesAndRightToLeft' : 'No';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ComicInfo>\n  <Title>${escapeXml(document.title || 'Paper Pages')}</Title>\n  <PageCount>${pageCount}</PageCount>\n  <Manga>${manga}</Manga>\n  <Format>Sloom Studio Paper raster CBZ</Format>\n</ComicInfo>\n`;
}

function dataUrlToU8(dataUrl: string, expectedMimeType: string): Uint8Array {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Paper CBZ rasterizer returned an invalid PNG data URL.');
  }
  if (match[1].toLowerCase() !== expectedMimeType) {
    throw new Error(`Paper CBZ rasterizer returned ${match[1]} instead of ${expectedMimeType}.`);
  }
  if (match[2]) {
    return Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0));
  }
  return strToU8(decodeURIComponent(match[3]));
}

export function inferPaperDocumentImportFormat(fileNameOrPath: string | undefined, mimeType?: string): PaperDocumentImportFormat {
  const lower = (fileNameOrPath ?? '').toLowerCase();
  const normalizedMime = mimeType?.split(';', 1)[0]?.toLowerCase();
  if (lower.endsWith('.sloom-paper.json')) return 'sloom-paper-json';
  if (lower.endsWith('.sloom-idml.json')) return 'sloom-idml-json';
  // A REAL Adobe .idml package (ZIP), distinct from our .sloom-idml.json interchange — so it can be given
  // an honest "not supported yet" message instead of being silently mis-parsed as plain text.
  if (lower.endsWith('.idml') || normalizedMime === 'application/vnd.adobe.indesign-idml-package') return 'idml-package';
  if (lower.endsWith('.docx') || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (lower.endsWith('.pdf') || normalizedMime === 'application/pdf') return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || normalizedMime === 'text/markdown') return 'markdown';
  if (lower.endsWith('.rtf') || normalizedMime === 'application/rtf' || normalizedMime === 'text/rtf') return 'rtf';
  if (lower.endsWith('.html') || lower.endsWith('.htm') || normalizedMime === 'text/html' || normalizedMime === 'application/xhtml+xml') return 'html';
  return 'txt';
}

/** A run property toggle (`<w:b/>`, `<w:i/>`, `<w:u>`, `<w:strike/>`, `<w:smallCaps/>`) is ON unless it
 * carries an explicit off value. Works for underline too (its off value is `none`). */
function docxRunToggleOn(rPr: string, tag: 'b' | 'i' | 'u' | 'strike' | 'dstrike' | 'smallCaps' | 'caps'): boolean {
  const match = new RegExp(`<w:${tag}\\b([^>]*)>`).exec(rPr);
  if (!match) return false;
  const val = /w:val="([^"]*)"/.exec(match[1])?.[1];
  return val == null || !['false', '0', 'off', 'none'].includes(val);
}

/** Map a Word run font name to a CSS family with a sensible generic fallback (so a missing embedded font
 * degrades to the right kind of face rather than a random default). */
function docxFontFamilyToCss(name: string): string {
  const lower = name.toLowerCase();
  const generic = /(courier|mono|consol)/.test(lower)
    ? 'monospace'
    : /(times|georgia|garamond|serif|roman|ming|song|mincho|sung|antiqua|palatino|cambria|minion)/.test(lower)
      ? 'serif'
      : 'sans-serif';
  return `"${name.replace(/["\\]/g, '')}", ${generic}`;
}

/** Build one inline run (text + only the styles it actually carries) from a `<w:r>` element. */
function docxRunToRun(runXml: string, link: string | undefined): PaperTextRun | null {
  const rPr = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0] ?? '';
  const text = docxRunContentToText(runXml);
  if (text === '') return null;
  const run: PaperTextRun = { text };
  if (docxRunToggleOn(rPr, 'b')) run.fontWeight = '700';
  if (docxRunToggleOn(rPr, 'i')) run.fontStyle = 'italic';
  // Single OR double underline (the model carries a boolean; `w:val="none"` really means off).
  const underlineVal = /<w:u\b[^>]*w:val="([^"]+)"/.exec(rPr)?.[1];
  if (underlineVal && underlineVal !== 'none') run.underline = true;
  else if (docxRunToggleOn(rPr, 'u')) run.underline = true;
  // Single or double strikethrough both map to a struck run (the model has one strike flag).
  if (docxRunToggleOn(rPr, 'strike') || docxRunToggleOn(rPr, 'dstrike')) run.strike = true;
  if (docxRunToggleOn(rPr, 'smallCaps')) run.smallCaps = true;
  const sizeHalfPt = Number(/<w:sz\b[^>]*w:val="(\d+)"/.exec(rPr)?.[1] ?? '');
  if (Number.isFinite(sizeHalfPt) && sizeHalfPt > 0) run.fontSizePt = Math.min(300, Math.max(4, sizeHalfPt / 2));
  // ALL CAPS (`<w:caps>`) has no dedicated run field, so fold it into the text (faithful on render; smallCaps
  // stays a real CSS variant above).
  if (docxRunToggleOn(rPr, 'caps') && !run.smallCaps) run.text = run.text.toUpperCase();
  // Expanded/condensed character spacing (`<w:spacing w:val>`, twentieths of a pt) → tracking (per-mille em).
  const spacingTwips = Number(/<w:spacing\b[^>]*w:val="(-?\d+)"/.exec(rPr)?.[1] ?? '');
  if (Number.isFinite(spacingTwips) && spacingTwips !== 0) {
    run.tracking = Math.round(((spacingTwips / 20) / (run.fontSizePt ?? 10)) * 1000);
  }
  const colorRaw = /<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(rPr)?.[1];
  if (colorRaw && colorRaw.toLowerCase() !== '000000') run.color = `#${colorRaw.toLowerCase()}`;
  // Highlight (named) or run shading (hex fill) → a background colour behind the run.
  const highlightName = /<w:highlight\b[^>]*w:val="([a-zA-Z]+)"/.exec(rPr)?.[1];
  const shdFill = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(rPr)?.[1];
  const highlight = highlightName ? DOCX_HIGHLIGHT_COLORS[highlightName.toLowerCase()] : shdFill && shdFill.toLowerCase() !== 'auto' && shdFill.toUpperCase() !== 'FFFFFF' ? `#${shdFill.toLowerCase()}` : undefined;
  if (highlight) run.highlight = highlight;
  const font = /<w:rFonts\b[^>]*w:(?:ascii|hAnsi|cs)="([^"]+)"/.exec(rPr)?.[1];
  if (font) run.fontFamily = docxFontFamilyToCss(font);
  const vertAlign = /<w:vertAlign\b[^>]*w:val="(superscript|subscript)"/.exec(rPr)?.[1];
  if (vertAlign === 'superscript') run.vertAlign = 'super';
  else if (vertAlign === 'subscript') run.vertAlign = 'sub';
  // 圏点 (emphasis marks, `<w:em w:val="dot|comma|circle|underDot">`) → Paper's inline `《《…》》` notation (always
  // sesame at render). Folded into the run text so it survives flattening and round-trips, like ruby.
  const emVal = /<w:em\b[^>]*w:val="([a-zA-Z]+)"/.exec(rPr)?.[1];
  if (emVal && emVal !== 'none' && /\S/.test(run.text) && !run.text.includes('《《')) {
    run.text = `《《${run.text}》》`;
  }
  if (link) run.link = link;
  return run;
}

/** Concatenate a run's visible content in order: `<w:t>` text, `<w:tab/>` → tab, `<w:br/>`/`<w:cr/>` → newline. */
function docxRunContentToText(runXml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(runXml)) !== null) {
    if (match[1] !== undefined) out += decodeXml(match[1]);
    else if (match[2] === 'tab') out += '\t';
    else out += '\n';
  }
  return out;
}

/** Concatenate every `<w:t>` inside an XML fragment (used to pull a ruby's base + reading out of its nested runs). */
function docxCollectText(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) out += decodeXml(m[1]);
  return out;
}

/** Convert Word furigana (`<w:ruby>`) to Paper's inline notation `｜base《reading》` (the explicit ｜ delimiter so
 * any base — kana-led or mixed — round-trips), run on the paragraph body BEFORE the run tokenizer so the notation
 * flows in as ordinary run text and renders as real ruby. Ruby sits inside a `<w:r>`, so emitting a bare `<w:t>`
 * keeps that run intact (and preserves its `<w:rPr>` styling). */
function docxRubyToNotation(body: string): string {
  return body.replace(/<w:ruby>[\s\S]*?<\/w:ruby>/g, (ruby) => {
    const base = docxCollectText(/<w:rubyBase>([\s\S]*?)<\/w:rubyBase>/.exec(ruby)?.[1] ?? '');
    const reading = docxCollectText(/<w:rt>([\s\S]*?)<\/w:rt>/.exec(ruby)?.[1] ?? '');
    if (!base) return '';
    // The notation delimiters can't appear inside the base/reading; if they do (or there is no reading), fall back
    // to the plain base text so nothing is corrupted.
    if (!reading || /[《》｜\n]/.test(base) || /[《》｜\n]/.test(reading)) {
      return `<w:t xml:space="preserve">${escapeXml(base)}</w:t>`;
    }
    return `<w:t xml:space="preserve">｜${escapeXml(base)}《${escapeXml(reading)}》</w:t>`;
  });
}

const DOCX_ALIGN: Record<string, ImportedPaperTextBlock['align']> = {
  center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify', left: 'left', start: 'left',
};

/** Word's 16 named highlight colours → hex, for `<w:highlight w:val="…">`. */
const DOCX_HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkblue: '#000080', darkcyan: '#008080', darkgreen: '#008000', darkmagenta: '#800080', darkred: '#800000',
  darkyellow: '#808000', darkgray: '#808080', lightgray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

/** Relationship map from `word/_rels/document.xml.rels`: rId → { target, external-link mode }. */
function parseDocxRelationships(files: Record<string, Uint8Array>): Record<string, { target: string; external: boolean }> {
  const rels = files['word/_rels/document.xml.rels'];
  const map: Record<string, { target: string; external: boolean }> = {};
  if (!rels) return map;
  for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) map[id] = { target, external: /TargetMode="External"/.test(m[0]) };
  }
  return map;
}

function docxMediaMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', webp: 'image/webp' } as Record<string, string>)[ext] ?? 'image/png';
}

/** Slice a balanced `<w:tbl>…</w:tbl>` starting at `openIdx`, counting nested tables so we consume the whole one. */
function sliceBalancedTable(s: string, openIdx: number): { xml: string; end: number } {
  const re = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
  re.lastIndex = openIdx;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return { xml: s.slice(openIdx, m.index + m[0].length), end: m.index + m[0].length };
    } else {
      depth += 1;
    }
  }
  return { xml: s.slice(openIdx), end: s.length };
}

/** Remove any table nested inside this one (depth ≥ 2) so row/cell scanning sees only the outer grid. */
function removeNestedTables(tblXml: string): { xml: string; hadNested: boolean } {
  const re = /<w:tbl(?=[\s>])|<\/w:tbl>/g;
  let depth = 0;
  let cutStart = -1;
  let last = 0;
  let out = '';
  let hadNested = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tblXml)) !== null) {
    if (m[0].startsWith('</')) {
      if (depth === 2 && cutStart >= 0) {
        out += tblXml.slice(last, cutStart);
        last = m.index + m[0].length;
        cutStart = -1;
        hadNested = true;
      }
      depth -= 1;
    } else {
      depth += 1;
      if (depth === 2 && cutStart < 0) cutStart = m.index;
    }
  }
  out += tblXml.slice(last);
  return { xml: out, hadNested };
}

/** The visible text of a single `<w:p>` (runs → text, tabs, breaks), with no formatting — used for table cells. */
function docxParagraphPlainText(paraXml: string): string {
  const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(paraXml)?.[0] ?? '';
  const body = pPr ? paraXml.replace(pPr, '') : paraXml;
  let text = '';
  for (const runMatch of body.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) text += docxRunContentToText(runMatch[0]);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n+/g, ' ').trim();
}

// Private-use placeholders for the page-number fields a header/footer can carry; the layout step substitutes
// them per page (PAGE → the page's 1-based index, NUMPAGES → the document's total page count).
const DOCX_FIELD_PAGE = '';
const DOCX_FIELD_NUMPAGES = '';

/** Map a field instruction (`PAGE`, `NUMPAGES`, …) to its placeholder; unknown fields collapse to nothing. */
function docxFieldToken(instr: string): string {
  const up = instr.toUpperCase();
  if (/\bNUMPAGES\b/.test(up)) return DOCX_FIELD_NUMPAGES;
  if (/\bPAGE\b/.test(up)) return DOCX_FIELD_PAGE;
  return '';
}

/** Header/footer paragraph text with Word fields resolved to placeholders: `<w:fldSimple>` and complex fields
 * (`fldChar begin … instrText … end`, which span several runs) both become a single token run so the cached
 * result digits don't leak through and the layout can substitute the live page number. */
function docxHeaderFooterParagraphText(paraXml: string): string {
  const withSimple = paraXml.replace(
    /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>[\s\S]*?<\/w:fldSimple>/g,
    (_, instr: string) => `<w:r><w:t xml:space="preserve">${docxFieldToken(instr)}</w:t></w:r>`,
  );
  // A complex field spans several runs: `<w:r>…fldChar begin…</w:r> <w:r>…instrText…</w:r> … <w:r>…fldChar
  // end…</w:r>`. Anchor the match on the run that CONTAINS `begin` (no `</w:r>` between the run open and the
  // begin char) so preceding literal-text runs like "Page " and " of " are NOT swallowed into the token.
  const withComplex = withSimple.replace(
    /<w:r\b(?:(?!<\/w:r>)[\s\S])*?<w:fldChar[^>]*w:fldCharType="begin"[\s\S]*?<w:fldChar[^>]*w:fldCharType="end"[^>]*\/?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g,
    (frag: string) => {
      const instr = /<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/.exec(frag)?.[1] ?? '';
      return `<w:r><w:t xml:space="preserve">${docxFieldToken(instr)}</w:t></w:r>`;
    },
  );
  return docxParagraphPlainText(withComplex);
}

/** Parse a header/footer part (`word/header1.xml`, `word/footer1.xml`, …) into aligned paragraphs, or undefined
 * when it holds no visible text (an empty first-page header on a title page, say). */
function parseDocxHeaderFooterPart(files: Record<string, Uint8Array>, target: string | undefined): DocxHeaderFooterContent | undefined {
  if (!target) return undefined;
  const part = files[`word/${target.replace(/^\/?word\//, '').replace(/^\.\//, '')}`];
  if (!part) return undefined;
  const xml = strFromU8(part);
  const paragraphs: DocxHeaderFooterParagraph[] = [];
  for (const pm of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(pm[0])?.[0] ?? '';
    const alignRaw = DOCX_ALIGN[/<w:jc\b[^>]*w:val="([^"]+)"/.exec(pPr)?.[1] ?? ''];
    const align = alignRaw === 'center' || alignRaw === 'right' ? alignRaw : undefined;
    const text = docxHeaderFooterParagraphText(pm[0]);
    paragraphs.push({ text, ...(align ? { align } : {}) });
  }
  while (paragraphs.length && !paragraphs[paragraphs.length - 1].text.trim()) paragraphs.pop();
  return paragraphs.some((p) => p.text.trim()) ? { paragraphs } : undefined;
}

/** Parse `word/footnotes.xml` into id → content (each footnote's runs, with the auto footnote-number mark run
 * dropped — the importer assigns its own display numbers). Separator/continuation pseudo-footnotes are skipped. */
function parseDocxFootnotes(files: Record<string, Uint8Array>): Map<string, PaperRichParagraph> {
  const map = new Map<string, PaperRichParagraph>();
  const part = files['word/footnotes.xml'];
  if (!part) return map;
  const xml = strFromU8(part);
  for (const m of xml.matchAll(/<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g)) {
    const id = /w:id="(-?\d+)"/.exec(m[1])?.[1];
    const type = /w:type="([^"]+)"/.exec(m[1])?.[1];
    if (!id || type === 'separator' || type === 'continuationSeparator') continue;
    const runs: PaperTextRun[] = [];
    for (const rm of m[2].matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)) {
      if (/<w:footnoteRef\b|<w:footnoteReference\b/.test(rm[0])) continue; // drop the auto number mark
      const run = docxRunToRun(rm[0], undefined);
      if (run) runs.push(run);
    }
    if (runs.length) {
      runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') };
      map.set(id, { runs });
    }
  }
  return map;
}

/** Sequential footnote display numbering: the first reference to a footnote id gets 1, the next new id 2, … so
 * markers read in document order regardless of the ids Word assigned. */
interface DocxFootnoteState {
  order: string[];
  numById: Map<string, number>;
}
function docxFootnoteNumber(state: DocxFootnoteState, id: string): number {
  const existing = state.numById.get(id);
  if (existing != null) return existing;
  const num = state.order.length + 1;
  state.numById.set(id, num);
  state.order.push(id);
  return num;
}

/** Resolved formatting a Word table style contributes (shading + border colour). Word tables get most of
 * their look from a referenced style (`<w:tblStyle w:val>`) plus conditional parts (`<w:tblStylePr>` for
 * firstRow/lastRow/bands), NOT inline cell shading — so importing a real document needs this resolution. */
interface DocxTableStyleDef {
  borderColor?: string;
  wholeFill?: string;
  firstRow?: string;
  lastRow?: string;
  firstCol?: string;
  lastCol?: string;
  band1Horz?: string;
  band2Horz?: string;
  rowBandSize: number;
  basedOn?: string;
}

/** `<w:shd w:fill="rrggbb">` → `#rrggbb`, treating auto/white as "no fill" (white paper needs no paint). */
function docxShdFill(xml: string): string | undefined {
  const fill = /<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(xml)?.[1];
  return fill && fill.toLowerCase() !== 'auto' && fill.toUpperCase() !== 'FFFFFF' ? `#${fill.toLowerCase()}` : undefined;
}

/** Parse a `<w:pBdr>` (paragraph borders) into per-edge weights/colours. `auto`/missing colour → text colour
 * (`currentColor`); `w:sz` is eighths of a point; `w:space` is the padding in points. */
function docxParagraphBorders(pPr: string): PaperParagraphBorders | undefined {
  const pBdr = /<w:pBdr\b[\s\S]*?<\/w:pBdr>/.exec(pPr)?.[0];
  if (!pBdr) return undefined;
  const borders: PaperParagraphBorders = {};
  let paddingPt = 0;
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const tag = new RegExp(`<w:${edge}\\b[^>]*/?>`).exec(pBdr)?.[0];
    if (!tag) continue;
    const val = /w:val="([^"]+)"/.exec(tag)?.[1];
    if (val === 'none' || val === 'nil') continue;
    const sz = Number(/w:sz="(\d+)"/.exec(tag)?.[1] ?? '4');
    const widthPt = Math.max(0.25, (Number.isFinite(sz) ? sz : 4) / 8);
    const colorHex = /w:color="([0-9A-Fa-f]{6})"/.exec(tag)?.[1];
    borders[edge] = { color: colorHex ? `#${colorHex.toLowerCase()}` : 'currentColor', widthPt };
    const space = Number(/w:space="(\d+)"/.exec(tag)?.[1] ?? '');
    if (Number.isFinite(space)) paddingPt = Math.max(paddingPt, space);
  }
  if (!borders.top && !borders.left && !borders.bottom && !borders.right) return undefined;
  if (paddingPt > 0) borders.paddingPt = paddingPt;
  return borders;
}

/** First real border colour in a `<w:tblBorders>` block → `#rrggbb`. */
function docxBorderColor(xml: string): string | undefined {
  const borders = /<w:tblBorders\b[\s\S]*?<\/w:tblBorders>/.exec(xml)?.[0];
  const color = /w:color="([0-9A-Fa-f]{6})"/.exec(borders ?? '')?.[1];
  return color && color.toLowerCase() !== 'auto' ? `#${color.toLowerCase()}` : undefined;
}

/** Parse `word/styles.xml` into a map of table-style-id → resolved shading/border definition. */
function parseDocxTableStyles(files: Record<string, Uint8Array>): Map<string, DocxTableStyleDef> {
  const map = new Map<string, DocxTableStyleDef>();
  const raw = files['word/styles.xml'];
  if (!raw) return map;
  const xml = strFromU8(raw);
  for (const block of xml.match(/<w:style\b[^>]*w:type="table"[\s\S]*?<\/w:style>/g) ?? []) {
    const id = /w:styleId="([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    // The base formatting lives before the first conditional `<w:tblStylePr>`.
    const firstCond = block.indexOf('<w:tblStylePr');
    const base = firstCond >= 0 ? block.slice(0, firstCond) : block;
    const def: DocxTableStyleDef = {
      rowBandSize: Number(/<w:tblStyleRowBandSize\b[^>]*w:val="(\d+)"/.exec(base)?.[1] ?? '1') || 1,
    };
    const basedOn = /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(block)?.[1];
    if (basedOn) def.basedOn = basedOn;
    const borderColor = docxBorderColor(base);
    if (borderColor) def.borderColor = borderColor;
    const wholeFill = docxShdFill(/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(base)?.[0] ?? '');
    if (wholeFill) def.wholeFill = wholeFill;
    for (const type of ['firstRow', 'lastRow', 'firstCol', 'lastCol', 'band1Horz', 'band2Horz'] as const) {
      const cond = new RegExp(`<w:tblStylePr w:type="${type}">[\\s\\S]*?</w:tblStylePr>`).exec(block)?.[0];
      const fill = cond ? docxShdFill(cond) : undefined;
      if (fill) def[type] = fill;
    }
    map.set(id, def);
  }
  return map;
}

/** Flatten a style's `<w:basedOn>` chain so inherited borders/shading apply (shallow-recursive, cycle-safe). */
function resolveDocxTableStyle(map: Map<string, DocxTableStyleDef>, id: string, seen = new Set<string>()): DocxTableStyleDef | undefined {
  const def = map.get(id);
  if (!def || seen.has(id)) return def;
  if (!def.basedOn) return def;
  seen.add(id);
  const parent = resolveDocxTableStyle(map, def.basedOn, seen);
  return parent ? { ...parent, ...def, rowBandSize: def.rowBandSize } : def;
}

/** A resolved paragraph style: the typography + paragraph-layout a `<w:pStyle>` contributes. Every field is
 * optional so a `<w:pPr>`/run's DIRECT formatting can override it (most-specific-wins, per OOXML §5). */
interface DocxParaStyleDef {
  basedOn?: string;
  fontSizePt?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  align?: ImportedPaperTextBlock['align'];
  spaceBeforeMm?: number;
  spaceAfterMm?: number;
  leftIndentMm?: number;
  rightIndentMm?: number;
  firstLineIndentMm?: number;
  hangingIndentMm?: number;
  shading?: string;
  borders?: PaperParagraphBorders;
}

/** Parse `word/styles.xml` paragraph styles into a map so a paragraph's `<w:pStyle>` resolves to real
 * typography/shading/borders/indent. Without this, Title/Subtitle/Caption/PullQuote/ImplementationNote (which
 * carry their formatting in the STYLE, not on the runs) all imported as plain body text. */
function parseDocxParagraphStyles(files: Record<string, Uint8Array>): Map<string, DocxParaStyleDef> {
  const map = new Map<string, DocxParaStyleDef>();
  const raw = files['word/styles.xml'];
  if (!raw) return map;
  const xml = strFromU8(raw);
  const twip = (v: string | undefined): number | undefined => {
    const n = Number(v ?? '');
    return Number.isFinite(n) && n > 0 ? (n / 1440) * 25.4 : undefined;
  };
  for (const block of xml.match(/<w:style\b[^>]*w:type="paragraph"[\s\S]*?<\/w:style>/g) ?? []) {
    const id = /w:styleId="([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    const rPr = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(block)?.[0] ?? '';
    const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(block)?.[0] ?? '';
    const def: DocxParaStyleDef = {};
    const basedOn = /<w:basedOn\b[^>]*w:val="([^"]+)"/.exec(block)?.[1];
    if (basedOn) def.basedOn = basedOn;
    const sizeHalfPt = Number(/<w:sz\b[^>]*w:val="(\d+)"/.exec(rPr)?.[1] ?? '');
    if (Number.isFinite(sizeHalfPt) && sizeHalfPt > 0) def.fontSizePt = Math.min(300, Math.max(4, sizeHalfPt / 2));
    const color = /<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(rPr)?.[1];
    if (color && color.toLowerCase() !== '000000') def.color = `#${color.toLowerCase()}`;
    if (docxRunToggleOn(rPr, 'b')) def.bold = true;
    if (docxRunToggleOn(rPr, 'i')) def.italic = true;
    const font = /<w:rFonts\b[^>]*w:(?:ascii|hAnsi)="([^"]+)"/.exec(rPr)?.[1];
    if (font) def.fontFamily = docxFontFamilyToCss(font);
    const jc = /<w:jc\b[^>]*w:val="([^"]+)"/.exec(pPr)?.[1];
    if (jc && DOCX_ALIGN[jc]) def.align = DOCX_ALIGN[jc];
    const before = Number(/<w:spacing\b[^>]*w:before="(\d+)"/.exec(pPr)?.[1] ?? '');
    if (before > 0) def.spaceBeforeMm = (before / 20) * 0.35278;
    const after = Number(/<w:spacing\b[^>]*w:after="(\d+)"/.exec(pPr)?.[1] ?? '');
    if (after > 0) def.spaceAfterMm = (after / 20) * 0.35278;
    const ind = /<w:ind\b[^>]*\/?>/.exec(pPr)?.[0] ?? '';
    const left = twip(/w:(?:left|start)="(\d+)"/.exec(ind)?.[1]);
    if (left != null) def.leftIndentMm = left;
    const right = twip(/w:(?:right|end)="(\d+)"/.exec(ind)?.[1]);
    if (right != null) def.rightIndentMm = right;
    const first = twip(/w:firstLine="(\d+)"/.exec(ind)?.[1]);
    if (first != null) def.firstLineIndentMm = first;
    const hang = twip(/w:hanging="(\d+)"/.exec(ind)?.[1]);
    if (hang != null) def.hangingIndentMm = hang;
    const shd = docxShdFill(pPr);
    if (shd) def.shading = shd;
    const borders = docxParagraphBorders(pPr);
    if (borders) def.borders = borders;
    map.set(id, def);
  }
  return map;
}

/** Flatten a paragraph style's `<w:basedOn>` chain (parent first, child overrides) — cycle-safe. */
function resolveDocxParagraphStyle(map: Map<string, DocxParaStyleDef>, id: string, seen = new Set<string>()): DocxParaStyleDef | undefined {
  const def = map.get(id);
  if (!def || seen.has(id) || !def.basedOn) return def;
  seen.add(id);
  const parent = resolveDocxParagraphStyle(map, def.basedOn, seen);
  return parent ? { ...parent, ...def } : def;
}

/** Convert one `<w:tbl>` into an editable Paper table (uniform-text cells; merged cells approximated). Table
 * styles from `styles.xml` supply header/band shading and border colour the way Word actually renders them. */
function docxTableToBlock(tblXml: string, tableStyles: Map<string, DocxTableStyleDef>): { block: ImportedPaperTextBlock; hadMerged: boolean; hadNested: boolean } {
  const { xml, hadNested } = removeNestedTables(tblXml);
  const gridColCount = (xml.match(/<w:gridCol\b/g) ?? []).length;
  const rowXmls = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  const grid: string[][] = [];
  const fillGrid: string[][] = [];
  let hadMerged = false;
  let maxCols = gridColCount;
  for (const rowXml of rowXmls) {
    const row: string[] = [];
    const fillRow: string[] = [];
    for (const cellMatch of rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)) {
      const cellXml = cellMatch[0];
      const tcPr = /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(cellXml)?.[0] ?? '';
      const span = Math.max(1, Number(/<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(tcPr)?.[1] ?? '1') || 1);
      if (span > 1 || /<w:vMerge\b/.test(tcPr)) hadMerged = true;
      const fill = docxShdFill(tcPr) ?? '';
      const cellText = (cellXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [])
        .map((p) => docxParagraphPlainText(p))
        .filter(Boolean)
        .join('\n');
      row.push(cellText);
      fillRow.push(fill);
      for (let k = 1; k < span; k += 1) { row.push(''); fillRow.push(fill); } // spanned columns share the fill
    }
    maxCols = Math.max(maxCols, row.length);
    grid.push(row);
    fillGrid.push(fillRow);
  }
  const cols = Math.max(1, maxCols);
  const pad = (row: string[]) => {
    const trimmed = row.slice(0, cols);
    while (trimmed.length < cols) trimmed.push('');
    return trimmed;
  };
  const cells = grid.map(pad);
  const rowsN = cells.length;

  // Resolve the referenced table style (`<w:tblStyle>`) + which conditional parts are active (`<w:tblLook>`,
  // a legacy hex bitmask or explicit boolean attrs). This is how Word paints header/band shading + borders.
  const tblPr = /<w:tblPr\b[\s\S]*?<\/w:tblPr>/.exec(xml)?.[0] ?? '';
  const styleId = /<w:tblStyle\b[^>]*w:val="([^"]+)"/.exec(tblPr)?.[1];
  const style = styleId ? resolveDocxTableStyle(tableStyles, styleId) : undefined;
  const lookHex = /<w:tblLook\b[^>]*w:val="([0-9A-Fa-f]+)"/.exec(tblPr)?.[1];
  const lookBits = lookHex ? parseInt(lookHex, 16) : 0;
  const lookAttr = (name: string) => new RegExp(`<w:tblLook\\b[^>]*\\bw:${name}="(?:1|true|on)"`).test(tblPr);
  const wantFirstRow = (lookBits & 0x0020) !== 0 || lookAttr('firstRow');
  const wantLastRow = (lookBits & 0x0040) !== 0 || lookAttr('lastRow');
  const wantFirstCol = (lookBits & 0x0080) !== 0 || lookAttr('firstColumn');
  const wantLastCol = (lookBits & 0x0100) !== 0 || lookAttr('lastColumn');
  const noHBand = (lookBits & 0x0200) !== 0 || lookAttr('noHBand');
  const noVBand = (lookBits & 0x0400) !== 0 || lookAttr('noVBand');

  // Per-cell fill = style layer (whole-table → horizontal band → first/last col → first/last row) with any
  // inline `<w:shd>` on the cell winning outright. Empty string = no paint.
  const bodyStart = wantFirstRow ? 1 : 0;
  const bodyEnd = wantLastRow ? rowsN - 1 : rowsN; // exclusive
  const bandSize = Math.max(1, style?.rowBandSize ?? 1);
  const inlineFills = fillGrid.map(pad);
  const mergedFills = cells.map((row, r) =>
    row.map((_, c) => {
      const inline = inlineFills[r]?.[c];
      if (inline) return inline;
      if (!style) return '';
      let fill = style.wholeFill ?? '';
      if (!noHBand && r >= bodyStart && r < bodyEnd && (style.band1Horz || style.band2Horz)) {
        const band = Math.floor((r - bodyStart) / bandSize) % 2; // 0 → band1 (first body row), 1 → band2
        const bandFill = band === 0 ? style.band1Horz : style.band2Horz;
        if (bandFill) fill = bandFill;
      }
      if (!noVBand && wantFirstCol && c === 0 && style.firstCol) fill = style.firstCol;
      if (!noVBand && wantLastCol && c === cols - 1 && style.lastCol) fill = style.lastCol;
      if (wantFirstRow && r === 0 && style.firstRow) fill = style.firstRow;
      if (wantLastRow && r === rowsN - 1 && style.lastRow) fill = style.lastRow;
      return fill;
    }),
  );
  const anyFill = mergedFills.some((row) => row.some(Boolean));

  const firstRow = rowXmls[0] ?? '';
  const headerRow =
    /<w:tblHeader\b/.test(firstRow) ||
    (wantFirstRow && Boolean(style?.firstRow) && rowsN > 1) ||
    (/<w:b\/>|<w:b w:val="(?!false|0|off|none)/.test(firstRow) && rowsN > 1);
  // Border colour: inline table borders win, else the referenced style's border colour.
  const borderColor = docxBorderColor(xml) ?? style?.borderColor;
  return {
    block: {
      role: 'table',
      text: '',
      table: {
        rows: Math.max(1, rowsN),
        cols,
        cells,
        headerRow,
        ...(anyFill ? { cellFills: mergedFills } : {}),
        ...(borderColor ? { borderColor } : {}),
      },
    },
    hadMerged,
    hadNested,
  };
}

/** Extract one embedded picture (`<w:drawing>`) as a self-contained data-URL image block. */
function docxDrawingToImage(
  drawingXml: string,
  files: Record<string, Uint8Array>,
  rels: Record<string, { target: string; external: boolean }>,
): ImportedPaperImageData | null {
  const rid = /r:embed="([^"]+)"/.exec(drawingXml)?.[1] ?? /r:link="([^"]+)"/.exec(drawingXml)?.[1];
  if (!rid) return null;
  const rel = rels[rid];
  if (!rel || rel.external) return null; // linked-external images have no bytes to embed
  const path = `word/${rel.target.replace(/^\.\//, '').replace(/^\/+/, '')}`;
  const bytes = files[path] ?? files[rel.target.replace(/^\/+/, '')];
  if (!bytes) return null;
  const mimeType = docxMediaMime(path);
  const extent = /<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(drawingXml);
  return {
    bytes: new Uint8Array(bytes),
    mimeType,
    widthMm: extent ? Number(extent[1]) / 36000 : undefined, // EMU → mm (914400 EMU/in ÷ 25.4)
    heightMm: extent ? Number(extent[2]) / 36000 : undefined,
  };
}

/** One resolved list level: its number format + label template + start value (from `word/numbering.xml`). */
interface DocxNumLevel {
  numFmt: string; // decimal | bullet | lowerLetter | upperLetter | lowerRoman | upperRoman | …
  lvlText: string; // template e.g. "%1." or "%1.%2" or a literal bullet glyph
  start: number;
}

/** Resolves a paragraph's (numId, ilvl) to its level definition via Word's two-tier num→abstractNum indirection. */
interface DocxNumbering {
  level(numId: string, ilvl: number): DocxNumLevel | undefined;
}

/** Running list counters, one array of per-level counts per `w:num` instance (each numId counts independently). */
interface DocxListState {
  counts: Map<string, number[]>;
}

/** Parse `word/numbering.xml` into a numId→abstractNum→level resolver (OOXML §6, two-tier indirection). */
function parseDocxNumbering(files: Record<string, Uint8Array>): DocxNumbering {
  const raw = files['word/numbering.xml'];
  const numToAbstract = new Map<string, string>();
  const abstractLevels = new Map<string, Map<number, DocxNumLevel>>();
  if (raw) {
    const xml = strFromU8(raw);
    for (const abstract of xml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []) {
      const abstractId = /w:abstractNumId="(\d+)"/.exec(abstract)?.[1];
      if (!abstractId) continue;
      const levels = new Map<number, DocxNumLevel>();
      for (const lvl of abstract.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) ?? []) {
        const ilvl = Number(/w:ilvl="(\d+)"/.exec(lvl)?.[1] ?? '');
        if (!Number.isFinite(ilvl)) continue;
        levels.set(ilvl, {
          numFmt: /<w:numFmt\b[^>]*w:val="([^"]+)"/.exec(lvl)?.[1] ?? 'decimal',
          lvlText: decodeXml(/<w:lvlText\b[^>]*w:val="([^"]*)"/.exec(lvl)?.[1] ?? '%1.'),
          start: Number(/<w:start\b[^>]*w:val="(\d+)"/.exec(lvl)?.[1] ?? '1') || 1,
        });
      }
      abstractLevels.set(abstractId, levels);
    }
    for (const num of xml.match(/<w:num\b(?![a-zA-Z])[\s\S]*?<\/w:num>/g) ?? []) {
      const numId = /w:numId="(\d+)"/.exec(num)?.[1];
      const abstractId = /<w:abstractNumId\b[^>]*w:val="(\d+)"/.exec(num)?.[1];
      if (numId && abstractId) numToAbstract.set(numId, abstractId);
    }
  }
  return {
    level(numId, ilvl) {
      const abstractId = numToAbstract.get(numId);
      if (!abstractId) return undefined;
      return abstractLevels.get(abstractId)?.get(ilvl);
    },
  };
}

const DOCX_BULLET_GLYPHS = ['•', '◦', '▪', '‣', '·', '◦', '▪', '‣', '·'];

/** Format a 1-based counter value per a Word numFmt (decimal / lower|upperLetter / lower|upperRoman). */
function formatDocxCounter(value: number, numFmt: string): string {
  const n = Math.max(1, value);
  switch (numFmt) {
    case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case 'lowerRoman': return toRoman(n).toLowerCase();
    case 'upperRoman': return toRoman(n);
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    default: return String(n); // decimal + anything unrecognised
  }
}

function toRoman(value: number): string {
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let n = value; let out = '';
  for (const [v, sym] of table) while (n >= v) { out += sym; n -= v; }
  return out || 'I';
}

/**
 * Resolve the visible marker for a list paragraph, advancing the running counters. Bullets come back as the
 * level's glyph (Symbol/Wingdings glyphs fall back to a per-depth bullet); numbered levels increment their
 * counter (resetting deeper levels) and expand the `w:lvlText` template (`%1.%2`) with each level's format.
 */
function resolveDocxListMarker(numbering: DocxNumbering, state: DocxListState, numId: string, ilvl: number): string {
  const def = numbering.level(numId, ilvl);
  if (!def) return DOCX_BULLET_GLYPHS[Math.min(ilvl, DOCX_BULLET_GLYPHS.length - 1)];
  if (def.numFmt === 'bullet') {
    // lvlText is usually a single glyph; if it's a plain ASCII/printable char keep it, else fall back by depth.
    const glyph = def.lvlText.trim();
    if (glyph && /^[•◦▪‣·○●■–\-*]$/.test(glyph)) return glyph;
    return DOCX_BULLET_GLYPHS[Math.min(ilvl, DOCX_BULLET_GLYPHS.length - 1)];
  }
  // Numbered: advance this level's counter, reset all deeper levels.
  const counts = state.counts.get(numId) ?? [];
  const startAt = def.start;
  counts[ilvl] = counts[ilvl] === undefined ? startAt : counts[ilvl] + 1;
  for (let k = ilvl + 1; k < counts.length; k += 1) counts[k] = undefined as unknown as number;
  state.counts.set(numId, counts);
  // Expand the label template: each %N → the count at level N-1 formatted with THAT level's numFmt.
  const label = def.lvlText.replace(/%(\d)/g, (_, d: string) => {
    const idx = Number(d) - 1;
    const value = counts[idx];
    if (!Number.isFinite(value)) return '';
    const levelFmt = numbering.level(numId, idx)?.numFmt ?? def.numFmt;
    return formatDocxCounter(value, levelFmt);
  });
  return label.trim() || `${formatDocxCounter(counts[ilvl] ?? startAt, def.numFmt)}.`;
}

/** Convert one top-level `<w:p>` into blocks: any embedded images first, then a rich text block (if it has text). */
function docxParagraphToBlocks(
  paragraph: string,
  files: Record<string, Uint8Array>,
  rels: Record<string, { target: string; external: boolean }>,
  numbering: DocxNumbering,
  listState: DocxListState,
  paraStyles: Map<string, DocxParaStyleDef>,
  footnoteState?: DocxFootnoteState,
): ImportedPaperTextBlock[] {
  const result: ImportedPaperTextBlock[] = [];
  for (const drawing of paragraph.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g) ?? []) {
    const image = docxDrawingToImage(drawing, files, rels);
    if (image) result.push({ role: 'image', text: '', image });
  }

  // Paragraph properties (style, alignment, list membership) — kept apart from runs so the paragraph-mark
  // run properties inside <w:pPr> don't pollute the run checks.
  const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? '';
  // Collapse Word furigana (`<w:ruby>`) to inline notation before the run walk, so the reading isn't mistaken for
  // body text by the (non-greedy) run tokenizer.
  const body = docxRubyToNotation(pPr ? paragraph.replace(pPr, '') : paragraph);

  // Walk the paragraph in order, tracking the enclosing hyperlink, and build inline runs that PRESERVE each
  // run's styling. Also derive fallback values (dominant run size/colour, whole-line bold/italic) that seed
  // the frame's default typography for the flattened plaintext.
  const runs: PaperTextRun[] = [];
  let text = '';
  let allBold = true;
  let allItalic = true;
  let dominantChars = -1;
  let dominantSizePt: number | undefined;
  let dominantColor: string | undefined;
  let firstExternalLink: string | undefined;
  let currentLink: string | undefined;
  const footnoteRefs: number[] = [];
  const tokenRe = /<w:hyperlink\b[^>]*>|<\/w:hyperlink>|<w:r\b[\s\S]*?<\/w:r>/g;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(body)) !== null) {
    const tok = token[0];
    if (tok.startsWith('<w:hyperlink')) {
      const rid = /r:id="([^"]+)"/.exec(tok)?.[1];
      currentLink = rid && rels[rid]?.external ? rels[rid].target : undefined;
      if (currentLink && !firstExternalLink) firstExternalLink = currentLink;
      continue;
    }
    if (tok.startsWith('</w:hyperlink')) {
      currentLink = undefined;
      continue;
    }
    // A footnote reference run carries no text (`<w:footnoteReference w:id>`); weave in a superscript marker
    // with the footnote's display number so the reference is visible, and record it for page-bottom placement.
    const fnId = footnoteState ? /<w:footnoteReference\b[^>]*w:id="(-?\d+)"/.exec(tok)?.[1] : undefined;
    if (fnId) {
      const num = docxFootnoteNumber(footnoteState!, fnId);
      runs.push({ text: String(num), vertAlign: 'super' });
      text += String(num);
      footnoteRefs.push(num);
      continue;
    }
    const run = docxRunToRun(tok, currentLink);
    if (!run) continue;
    runs.push(run);
    text += run.text;
    if (/\S/.test(run.text)) {
      if (run.fontWeight !== '700') allBold = false;
      if (run.fontStyle !== 'italic') allItalic = false;
      const chars = run.text.replace(/\s/g, '').length;
      if (chars > dominantChars) {
        dominantChars = chars;
        dominantSizePt = run.fontSizePt;
        dominantColor = run.color;
      }
    }
  }
  const flatText = text.replace(/[ \t]+\n/g, '\n').trim();
  if (!flatText) return result; // no text (e.g. an image-only paragraph handled above)

  const hasStyledRun = dominantChars >= 0;
  // Heading role (structure) = Heading1-6 or Title. Subtitle is NOT a heading — it's a regular italic line, and
  // routing it through the heading path would force it bold; it becomes a normal paragraph with its style type.
  const headingStyle = /<w:pStyle\b[^>]*w:val="(?:Heading([1-6])|(Title))"/.exec(pPr);
  const isHeading = Boolean(headingStyle);
  const level = headingStyle ? (headingStyle[1] ? Number(headingStyle[1]) : 1) : undefined;
  // Resolve the paragraph's named style (`<w:pStyle>`) from styles.xml so its typography/shading/borders/indent
  // apply. Word puts a style's formatting in the STYLE, not the runs — without this, Title/Subtitle/Caption/
  // PullQuote/ImplementationNote all imported as plain body text. Direct pPr/run formatting overrides it below.
  const pStyleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(pPr)?.[1];
  const styleDef = pStyleId ? resolveDocxParagraphStyle(paraStyles, pStyleId) : undefined;
  const align = DOCX_ALIGN[/<w:jc\b[^>]*w:val="([^"]+)"/.exec(pPr)?.[1] ?? ''] ?? styleDef?.align;
  // A list item is a numbered paragraph (<w:numPr>) OR one using a List* paragraph style (ListBullet /
  // ListNumber / ListParagraph) — Word templates frequently bullet via the style, not numPr.
  // A list item is a paragraph carrying `<w:numPr>` (numId + ilvl) — the real OOXML signal. The generic
  // `ListParagraph` style is NOT reliable (Word applies it to list intros/interruptions with no numPr too),
  // so we don't treat it as a list on its own; only the explicit ListBullet/ListNumber styles fall back.
  const numPr = /<w:numPr\b[\s\S]*?<\/w:numPr>/.exec(pPr)?.[0] ?? '';
  const numId = /<w:numId\b[^>]*w:val="(\d+)"/.exec(numPr)?.[1];
  const ilvl = Math.max(0, Number(/<w:ilvl\b[^>]*w:val="(\d+)"/.exec(numPr)?.[1] ?? '0') || 0);
  const explicitListStyle = /<w:pStyle\b[^>]*w:val="List(Bullet|Number)/i.exec(pPr)?.[1];

  // The rich paragraph: runs plus paragraph-level layout pulled from pPr (alignment, list marker, drop cap,
  // paragraph spacing, first-line indent).
  const richParagraph: PaperRichParagraph = { runs: runs.length ? runs : [{ text: flatText }] };
  if (align && align !== 'left') richParagraph.align = align;
  if (numId) {
    richParagraph.listMarker = resolveDocxListMarker(numbering, listState, numId, ilvl);
    // Nesting: indent deeper levels so a multi-level list reads as one (Word's per-level indent). Only when
    // the paragraph doesn't already carry an explicit left indent (parsed below).
    if (ilvl > 0 && !/w:(?:left|start)="/.test(pPr)) richParagraph.leftIndentMm = ilvl * 7;
  } else if (explicitListStyle) {
    richParagraph.listMarker = /Number/i.test(explicitListStyle) ? '1.' : '•';
  }
  if (/<w:framePr\b[^>]*w:dropCap="(?:drop|margin)"/.test(pPr)) {
    const lines = Number(/<w:framePr\b[^>]*w:lines="(\d+)"/.exec(pPr)?.[1] ?? '3');
    richParagraph.dropCapLines = Math.min(8, Math.max(2, Number.isFinite(lines) ? lines : 3));
  }
  const beforeTwentieths = Number(/<w:spacing\b[^>]*w:before="(\d+)"/.exec(pPr)?.[1] ?? '');
  if (beforeTwentieths > 0) richParagraph.spaceBeforeMm = (beforeTwentieths / 20) * 0.35278; // 20ths of a pt → pt → mm
  const afterTwentieths = Number(/<w:spacing\b[^>]*w:after="(\d+)"/.exec(pPr)?.[1] ?? '');
  if (afterTwentieths > 0) richParagraph.spaceAfterMm = (afterTwentieths / 20) * 0.35278;
  const ind = /<w:ind\b[^>]*\/?>/.exec(pPr)?.[0] ?? '';
  const firstLineTwips = Number(/w:firstLine="(\d+)"/.exec(ind)?.[1] ?? '');
  if (firstLineTwips > 0) richParagraph.firstLineIndentMm = (firstLineTwips / 1440) * 25.4; // twips → in → mm
  const leftTwips = Number(/w:(?:left|start)="(\d+)"/.exec(ind)?.[1] ?? '');
  if (leftTwips > 0) richParagraph.leftIndentMm = (leftTwips / 1440) * 25.4;
  const hangingTwips = Number(/w:hanging="(\d+)"/.exec(ind)?.[1] ?? '');
  if (hangingTwips > 0) richParagraph.hangingIndentMm = (hangingTwips / 1440) * 25.4;
  // Paragraph shading (`<w:pPr><w:shd w:fill>`) — the pPr's own shd, not the paragraph-mark's `<w:rPr><w:shd>`.
  const paraShd = docxShdFill(pPr.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>/g, ''));
  if (paraShd) richParagraph.shading = paraShd;
  const paraBorders = docxParagraphBorders(pPr);
  if (paraBorders) richParagraph.borders = paraBorders;
  // Style fallbacks: apply the resolved paragraph style's layout wherever the paragraph didn't set it directly
  // (direct pPr / list nesting already ran above and wins). This is what makes a PullQuote get its colored left
  // border + indent, and an ImplementationNote its shaded, bordered, inset callout box — all from the style.
  if (styleDef) {
    if (richParagraph.spaceBeforeMm == null && styleDef.spaceBeforeMm) richParagraph.spaceBeforeMm = styleDef.spaceBeforeMm;
    if (richParagraph.spaceAfterMm == null && styleDef.spaceAfterMm) richParagraph.spaceAfterMm = styleDef.spaceAfterMm;
    if (richParagraph.firstLineIndentMm == null && styleDef.firstLineIndentMm) richParagraph.firstLineIndentMm = styleDef.firstLineIndentMm;
    if (richParagraph.leftIndentMm == null && styleDef.leftIndentMm) richParagraph.leftIndentMm = styleDef.leftIndentMm;
    if (richParagraph.rightIndentMm == null && styleDef.rightIndentMm) richParagraph.rightIndentMm = styleDef.rightIndentMm;
    if (richParagraph.hangingIndentMm == null && styleDef.hangingIndentMm) richParagraph.hangingIndentMm = styleDef.hangingIndentMm;
    if (richParagraph.shading == null && styleDef.shading) richParagraph.shading = styleDef.shading;
    if (richParagraph.borders == null && styleDef.borders) richParagraph.borders = styleDef.borders;
  }

  // Frame typography: the run's own value wins, else the paragraph style's. (Headings additionally get a size/
  // weight floor from the layout step, which these values then override — so heading COLOUR now comes through.)
  const effFontSizePt = dominantSizePt ?? styleDef?.fontSizePt;
  const effColor = dominantColor ?? styleDef?.color;
  const effBold = (hasStyledRun && allBold) || styleDef?.bold || false;
  const effItalic = (hasStyledRun && allItalic) || styleDef?.italic || false;
  result.push({
    role: isHeading ? 'heading' : 'paragraph',
    level,
    text: richParagraph.listMarker ? `${richParagraph.listMarker}\t${flatText}` : flatText,
    richText: [richParagraph],
    ...(align && align !== 'left' ? { align } : {}),
    ...(effBold && !isHeading ? { bold: true } : {}),
    ...(effItalic ? { italic: true } : {}),
    ...(effFontSizePt ? { fontSizePt: effFontSizePt } : {}),
    ...(effColor ? { color: effColor } : {}),
    ...(firstExternalLink ? { hyperlink: firstExternalLink } : {}),
    ...(footnoteRefs.length ? { footnoteRefs } : {}),
  });
  return result;
}

/** Parse every `<w:sectPr>` (in document order) into page geometry. In OOXML each section's sectPr lives in the
 * LAST paragraph of that section, except the final section whose sectPr is a direct child of `<w:body>` — so the
 * count and order here line up with the section index assigned to blocks during the body walk. `orient` is
 * authoritative even when the generator left `w:w`/`w:h` un-swapped, so we derive width/height from long/short. */
function parseDocxSections(
  documentXml: string,
  files: Record<string, Uint8Array>,
  rels: Record<string, { target: string; external: boolean }>,
): DocxSectionGeometry[] {
  const twip = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw ?? '');
    return Number.isFinite(n) ? (n / 1440) * 25.4 : fallback;
  };
  const refContent = (sectXml: string, kind: 'header' | 'footer', type: 'default' | 'first'): DocxHeaderFooterContent | undefined => {
    const re = new RegExp(`<w:${kind}Reference\\b[^>]*w:type="${type}"[^>]*r:id="([^"]+)"`);
    const rid = re.exec(sectXml)?.[1];
    return rid ? parseDocxHeaderFooterPart(files, rels[rid]?.target) : undefined;
  };
  // Word links a section's header/footer to the previous one when it doesn't redefine it — carry forward.
  let prev: Pick<DocxSectionGeometry, 'header' | 'footer' | 'firstHeader' | 'firstFooter'> = {};
  return [...documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map((match) => {
    const s = match[0];
    const pgSz = /<w:pgSz\b[^>]*\/?>/.exec(s)?.[0] ?? '';
    const w = twip(/w:w="(\d+)"/.exec(pgSz)?.[1], 215.9);
    const h = twip(/w:h="(\d+)"/.exec(pgSz)?.[1], 279.4);
    const landscape = /w:orient="landscape"/.test(pgSz);
    const longer = Math.max(w, h);
    const shorter = Math.min(w, h);
    const pgMar = /<w:pgMar\b[^>]*\/?>/.exec(s)?.[0] ?? '';
    const marginsMm: PaperMarginSpec = {
      top: twip(/w:top="(-?\d+)"/.exec(pgMar)?.[1], 25.4),
      right: twip(/w:right="(\d+)"/.exec(pgMar)?.[1], 25.4),
      bottom: twip(/w:bottom="(-?\d+)"/.exec(pgMar)?.[1], 25.4),
      left: twip(/w:left="(\d+)"/.exec(pgMar)?.[1], 25.4),
    };
    const columns = Math.max(1, Number(/<w:cols\b[^>]*w:num="(\d+)"/.exec(s)?.[1] ?? '1') || 1);
    const colSpace = Number(/<w:cols\b[^>]*w:space="(\d+)"/.exec(s)?.[1] ?? '');
    const columnGutterMm = Number.isFinite(colSpace) && colSpace > 0 ? (colSpace / 1440) * 25.4 : 7.5;
    const headerDistanceMm = twip(/w:header="(\d+)"/.exec(pgMar)?.[1], 12.7);
    const footerDistanceMm = twip(/w:footer="(\d+)"/.exec(pgMar)?.[1], 12.7);
    const titlePage = /<w:titlePg\b/.test(s);
    // 縦書き: `<w:textDirection w:val="tbRl"/>` (or tbRlV/tbLrV) sets the section top-to-bottom → vertical writing.
    const vertical = /<w:textDirection\b[^>]*w:val="tb/.test(s);
    const header = refContent(s, 'header', 'default') ?? prev.header;
    const footer = refContent(s, 'footer', 'default') ?? prev.footer;
    const firstHeader = refContent(s, 'header', 'first') ?? prev.firstHeader;
    const firstFooter = refContent(s, 'footer', 'first') ?? prev.firstFooter;
    prev = { header, footer, firstHeader, firstFooter };
    return {
      widthMm: landscape ? longer : shorter,
      heightMm: landscape ? shorter : longer,
      landscape,
      marginsMm,
      columns,
      columnGutterMm,
      titlePage,
      headerDistanceMm,
      footerDistanceMm,
      vertical,
      ...(header ? { header } : {}),
      ...(footer ? { footer } : {}),
      ...(firstHeader ? { firstHeader } : {}),
      ...(firstFooter ? { firstFooter } : {}),
    };
  });
}

/**
 * Parse a .docx into ordered Paper blocks, preserving STRUCTURE rather than flattening it: top-level
 * paragraphs (with heading level, alignment, list marker, whole-paragraph bold/italic, dominant font
 * size/colour, hyperlink), tables (as editable Paper tables), and embedded images (as data-URL image
 * frames). What Paper's uniform-per-frame text model genuinely can't hold — sub-paragraph run styling,
 * exact merged-cell geometry, footnotes — is reported in `limitations`, not silently dropped or faked.
 */
function parseDocxTextDocument(buffer: ArrayBuffer, fileName: string): ImportedPaperTextDocument {
  const files = unzipBoundedZipSync(new Uint8Array(buffer), {
    archiveLabel: 'DOCX',
    ...PAPER_DOCX_ARCHIVE_LIMITS,
  });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('DOCX import could not find word/document.xml.');
  const documentXml = strFromU8(xml);
  const rels = parseDocxRelationships(files);
  const tableStyles = parseDocxTableStyles(files);
  const paraStyles = parseDocxParagraphStyles(files);
  const numbering = parseDocxNumbering(files);
  const listState: DocxListState = { counts: new Map() };
  const sections = parseDocxSections(documentXml, files, rels);
  const footnoteContents = parseDocxFootnotes(files);
  const footnoteState: DocxFootnoteState = { order: [], numById: new Map() };
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml;

  const blocks: ImportedPaperTextBlock[] = [];
  // Block index where each new section begins (a paragraph carrying `<w:sectPr>` ends its section, so the NEXT
  // block starts the next one). Used after the walk to stamp every block with its sectionIndex, at one place.
  const sectionBoundaries: number[] = [];
  let tableCount = 0;
  let imageCount = 0;
  let mergedCells = false;
  let nestedTables = false;
  // A `<w:br w:type="page"/>` usually lives in its own empty paragraph, so remember it and stamp the NEXT real
  // block with `pageBreakBefore` — that's where the document actually starts a new page.
  let pendingPageBreak = false;

  // Word draws a drop cap as a SEPARATE `<w:framePr w:dropCap>` paragraph holding just the drop letter, with
  // the body text (minus that letter) in the FOLLOWING paragraph. Merge them so the letter becomes a real
  // first-letter drop cap on the body paragraph instead of a giant floating character in its own box.
  let pendingDropCap: { run: PaperTextRun; lines: number } | null = null;
  const firstTextBlock = (produced: ImportedPaperTextBlock[]) => produced.find((b) => b.role !== 'image' && b.richText?.[0]);
  const flushDropCap = () => {
    if (!pendingDropCap) return;
    blocks.push({ role: 'paragraph', text: pendingDropCap.run.text, richText: [{ runs: [pendingDropCap.run], dropCapLines: pendingDropCap.lines }] });
    pendingDropCap = null;
  };

  // Walk the body's top-level children in order. A `<w:tbl>` is sliced whole (nesting-aware) so its inner
  // paragraphs are NOT re-emitted as top-level text — that flattening is exactly the bug being fixed.
  const tokenRe = /<w:tbl(?=[\s>])|<w:p(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(body)) !== null) {
    if (m[0].startsWith('<w:tbl')) {
      flushDropCap(); // a table can't host a drop cap — emit the pending letter as its own paragraph
      const { xml: tblXml, end } = sliceBalancedTable(body, m.index);
      const { block, hadMerged, hadNested } = docxTableToBlock(tblXml, tableStyles);
      if (pendingPageBreak) { block.pageBreakBefore = true; pendingPageBreak = false; }
      blocks.push(block);
      tableCount += 1;
      mergedCells = mergedCells || hadMerged;
      nestedTables = nestedTables || hadNested;
      tokenRe.lastIndex = end;
    } else {
      const close = body.indexOf('</w:p>', m.index);
      const paraXml = body.slice(m.index, close >= 0 ? close + 6 : body.length);
      const produced = docxParagraphToBlocks(paraXml, files, rels, numbering, listState, paraStyles, footnoteState);
      // A run-level `<w:br w:type="page"/>` or a `<w:pageBreakBefore/>` in this paragraph's pPr forces a new
      // page. If this paragraph has visible content, the break attaches to it; if it's a bare break paragraph
      // (the common Word idiom), it defers to the next real block.
      const paraPageBreak = /<w:br\b[^>]*w:type="page"/.test(paraXml) || /<w:pageBreakBefore(?:\s|\/|>)/.test(paraXml);
      const isDropCapPara = /<w:framePr\b[^>]*w:dropCap="(?:drop|margin)"/.test(paraXml);
      if (isDropCapPara) {
        // Emit any embedded images; stash the drop letter (plain — the ::first-letter CSS does the enlarging).
        for (const b of produced) if (b.role === 'image') { blocks.push(b); imageCount += 1; }
        const textBlock = firstTextBlock(produced);
        const dropText = textBlock?.richText?.[0].runs.map((r) => r.text).join('') || textBlock?.text || '';
        if (dropText) pendingDropCap = { run: { text: dropText }, lines: textBlock?.richText?.[0].dropCapLines ?? 3 };
        else flushDropCap();
      } else {
        if (pendingDropCap) {
          const textBlock = firstTextBlock(produced);
          const para = textBlock?.richText?.[0];
          if (textBlock && para) {
            para.runs = [pendingDropCap.run, ...para.runs];
            para.dropCapLines = pendingDropCap.lines;
            textBlock.text = pendingDropCap.run.text + textBlock.text;
            pendingDropCap = null;
          } else {
            flushDropCap();
          }
        }
        const firstNew = blocks.length;
        for (const produced2 of produced) {
          blocks.push(produced2);
          if (produced2.role === 'image') imageCount += 1;
        }
        // Apply a pending/own page break to the first block this paragraph produced; if it produced nothing
        // (a bare page-break paragraph), remember the break for the next real block.
        if ((pendingPageBreak || paraPageBreak) && blocks.length > firstNew) {
          blocks[firstNew].pageBreakBefore = true;
          pendingPageBreak = false;
        } else if (paraPageBreak) {
          pendingPageBreak = true;
        }
      }
      // A `<w:sectPr>` in this paragraph's pPr ends the current section — the next block opens the next one.
      if (/<w:sectPr\b/.test(paraXml)) sectionBoundaries.push(blocks.length);
      tokenRe.lastIndex = close >= 0 ? close + 6 : body.length;
    }
  }
  flushDropCap();

  // Stamp every block with its section index (0-based, in document order) from the recorded boundaries.
  if (sectionBoundaries.length) {
    let sec = 0;
    let bi = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      while (bi < sectionBoundaries.length && i >= sectionBoundaries[bi]) { sec += 1; bi += 1; }
      blocks[i].sectionIndex = sec;
    }
  }

  // Footnotes: assign display numbers in reference order and pair each with its (formatted) content, dropping
  // any reference whose content couldn't be resolved. Endnotes stay a disclosed gap.
  const footnotes: DocxFootnoteEntry[] = footnoteState.order
    .map((id, i) => ({ number: i + 1, content: footnoteContents.get(id) }))
    .filter((e): e is DocxFootnoteEntry => Boolean(e.content));

  const limitations: string[] = [];
  if (tableCount) limitations.push(`${tableCount} table${tableCount > 1 ? 's' : ''} imported as editable tables${mergedCells ? ' (merged cells approximated — text kept in the first cell of each span)' : ''}.`);
  if (nestedTables) limitations.push('A table nested inside another table was flattened to its outer grid.');
  if (imageCount) limitations.push(`${imageCount} image${imageCount > 1 ? 's' : ''} embedded from the document.`);
  if (footnotes.length) limitations.push(`${footnotes.length} footnote${footnotes.length > 1 ? 's' : ''} imported at the bottom of ${footnotes.length > 1 ? 'their' : 'its'} page.`);
  if (/<w:endnoteReference\b/.test(documentXml)) limitations.push('Endnotes are not imported.');
  // Japanese typesetting brought in from the source (shown so the 《》 notation in the editor isn't a surprise).
  if (/<w:ruby>/.test(documentXml)) limitations.push('Furigana (ルビ) imported as inline 《》 notation on the base word — it renders as ruby.');
  if (/<w:em\b[^>]*w:val="(?!none")/.test(documentXml)) limitations.push('Emphasis marks (圏点) imported as inline 《《…》》 notation.');
  if (sections.some((s) => s.vertical)) limitations.push('Vertical writing (縦書き) preserved — those text frames are set vertical-rl.');

  // Section page margins (`<w:pgMar>`, twips) → mm, so the imported doc matches the source's text area and
  // can draw margin guides. Take the last section's margins (the body-level sectPr for single-section docs).
  const pgMar = [...documentXml.matchAll(/<w:pgMar\b[^>]*\/?>/g)].pop()?.[0];
  const twipToMm = (raw: string | undefined): number | undefined => {
    const v = Number(raw ?? '');
    return Number.isFinite(v) && v >= 0 ? (v / 1440) * 25.4 : undefined;
  };
  const pageMarginsMm = pgMar
    ? (() => {
        const top = twipToMm(/w:top="(-?\d+)"/.exec(pgMar)?.[1]);
        const right = twipToMm(/w:right="(\d+)"/.exec(pgMar)?.[1]);
        const bottom = twipToMm(/w:bottom="(-?\d+)"/.exec(pgMar)?.[1]);
        const left = twipToMm(/w:left="(\d+)"/.exec(pgMar)?.[1]);
        return top != null && right != null && bottom != null && left != null ? { top, right, bottom, left } : undefined;
      })()
    : undefined;

  return {
    title: stripExtension(fileName),
    format: 'docx',
    blocks,
    ...(limitations.length ? { limitations } : {}),
    ...(pageMarginsMm ? { pageMarginsMm } : {}),
    ...(sections.length ? { sections } : {}),
    ...(footnotes.length ? { footnotes } : {}),
  };
}

function parseMarkdownBlocks(text: string): ImportedPaperTextBlock[] {
  return text.split(/\n{2,}/).flatMap<ImportedPaperTextBlock>((chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) return [];
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) return [{ role: 'heading', level: heading[1].length, text: heading[2].trim() }];
    return [{ role: 'paragraph', text: trimmed.replace(/^[-*+]\s+/gm, '• ') }];
  });
}

function parsePlainTextBlocks(text: string): ImportedPaperTextBlock[] {
  return text.split(/\n{2,}/).flatMap<ImportedPaperTextBlock>((chunk) => {
    const trimmed = chunk.trim();
    return trimmed ? [{ role: 'paragraph', text: trimmed }] : [];
  });
}

function parseHtmlBlocks(html: string): ImportedPaperTextBlock[] {
  const normalized = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag: string, inner: string) => `\n\n${'#'.repeat(Number(tag[1]))} ${htmlToText(inner)}\n\n`)
    .replace(/<(p|li|div|section|article)[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return parseMarkdownBlocks(decodeHtml(normalized));
}

function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractPaperStoryText(document: PaperDocument): Array<{ pageNumber: number; frameId: string; label: string; text: string; hyperlink?: string }> {
  return document.pages.flatMap((page) => resolvePaperFramesTextTemplates(page.frames, document, page.pageNumber).flatMap((frame) => {
    if (!['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind)) return [];
    const text = (frame.text ?? frame.asset?.text ?? '').trim();
    return text ? [{ pageNumber: page.pageNumber, frameId: frame.id, label: frame.label, text, hyperlink: frame.hyperlink }] : [];
  }));
}

/** One `<w:r>` carrying Word furigana (`<w:ruby>`) — the native round-trip of Paper's `base《reading》` notation. */
function docxRubyRun(base: string, reading: string): string {
  return `<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace"/><w:hps w:val="10"/><w:hpsRaise w:val="18"/><w:hpsBaseText w:val="21"/><w:lid w:val="ja-JP"/></w:rubyPr>`
    + `<w:rt><w:r><w:rPr><w:sz w:val="10"/></w:rPr><w:t xml:space="preserve">${escapeXml(reading)}</w:t></w:r></w:rt>`
    + `<w:rubyBase><w:r><w:t xml:space="preserve">${escapeXml(base)}</w:t></w:r></w:rubyBase></w:ruby></w:r>`;
}

/** Serialize one line's inline notation to Word runs: furigana → `<w:ruby>`, 圏点 → `<w:em>` (sesame≈comma), plain
 * text → a normal run. So Paper's inline Japanese notation opens in Word as its NATIVE ruby / emphasis features. */
function docxLineToRunsXml(line: string): string {
  const runs = tokenizePaperInlineText(line, false)
    .map((tok) => {
      if (tok.type === 'ruby') return docxRubyRun(tok.base, tok.reading);
      if (tok.type === 'emphasis') return `<w:r><w:rPr><w:em w:val="comma"/></w:rPr><w:t xml:space="preserve">${escapeXml(tok.text)}</w:t></w:r>`;
      if (tok.type === 'tcy') return `<w:r><w:t xml:space="preserve">${escapeXml(tok.digits)}</w:t></w:r>`;
      return `<w:r><w:t xml:space="preserve">${escapeXml(tok.text)}</w:t></w:r>`;
    })
    .join('');
  return runs || '<w:r><w:t xml:space="preserve"></w:t></w:r>';
}

/** True when every text frame with content is 縦書き — the exported Word section is then set vertical (`tbRl`). */
function documentTextIsAllVertical(document: PaperDocument): boolean {
  const frames = document.pages.flatMap((page) =>
    page.frames.filter(
      (f) => ['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(f.kind) && (f.text ?? f.asset?.text ?? '').trim(),
    ),
  );
  return frames.length > 0 && frames.every((f) => f.typography.writingMode === 'vertical-rl');
}

function buildDocxStoryExport(document: PaperDocument, stories: ReturnType<typeof extractPaperStoryText>): PaperZipExport {
  const paragraphs = stories.flatMap((story) => [
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(`Page ${story.pageNumber}: ${story.label}`)}</w:t></w:r></w:p>`,
    ...story.text.split(/\n+/).map((line) => `<w:p>${docxLineToRunsXml(line)}</w:p>`),
  ]).join('');
  // A wholly-vertical document exports its section 縦書き so Word opens it top-to-bottom, right-to-left.
  const sectPr = `<w:sectPr>${documentTextIsAllVertical(document) ? '<w:textDirection w:val="tbRl"/>' : ''}</w:sectPr>`;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}${sectPr}</w:body></w:document>`),
  };
  const zipped = zipSync(entries);
  return {
    fileName: `${safePathPart(document.title || 'paper-stories')}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    blob: new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    entries: Object.keys(entries),
  };
}

function collectDocumentLinks(document: PaperDocument): PaperIdmlInterchange['links'] {
  return document.pages.flatMap((page) => page.frames.flatMap((frame) => frame.asset ? [{ sourceBinItemId: frame.asset.sourceBinItemId, label: frame.asset.label, mimeType: frame.asset.mimeType, pageNumber: page.pageNumber, frameId: frame.id }] : []));
}

function renderPageManifestSvg(document: PaperDocument, page: PaperPage): string {
  const width = document.page.widthMm;
  const height = document.page.heightMm;
  const frames = page.frames.map((frame) => renderFrameSvg(frame)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${frames}</svg>`;
}

function renderFrameSvg(frame: PaperFrame): string {
  const fill = frame.fillColor === 'transparent' ? 'none' : frame.fillColor;
  const text = escapeXml((frame.text ?? frame.asset?.label ?? frame.label).slice(0, 500));
  return `<g transform="translate(${frame.xMm} ${frame.yMm}) rotate(${frame.rotationDeg})"><rect width="${frame.widthMm}" height="${frame.heightMm}" fill="${fill}" stroke="${frame.strokeColor}" stroke-width="${Math.max(0.1, frame.strokeWidthMm)}"/><text x="2" y="6" font-size="4" fill="${frame.typography.color}">${text}</text></g>`;
}

/** Height (mm) of just the wrapped TEXT (no frame padding — the caller adds that). `usableWidthMm` is the real
 * text-column width the text wraps against. Line height matches the render's leading (13pt for 10pt body). */
function estimateTextFrameHeightMm(text: string, heading: boolean, fontSizePt?: number, usableWidthMm?: number): number {
  // Scale the wrap width + line height with the actual point size when we know it (a 20pt name needs far
  // more room than 10pt body), otherwise fall back to the old heading/body defaults.
  const sizePt = fontSizePt ?? (heading ? 16 : 10);
  const lineHeightMm = (sizePt / 72) * 25.4 * 1.3; // pt → mm at ~1.3 leading (≈ Word single spacing / 13pt @ 10pt)
  const avgCharMm = (sizePt / 72) * 25.4 * 0.5; // conservative average glyph advance (~0.5em → never under-count lines)
  // Wrap against the ACTUAL text-column width the caller passes (already net of frame padding / indents), so
  // the wrapped-line count matches what the renderer draws.
  const usableMm = usableWidthMm && usableWidthMm > 10 ? usableWidthMm : heading ? 165 : 182;
  const charsPerLine = Math.max(8, Math.floor(usableMm / avgCharMm));
  // Count wrapped lines per hard line (an explicit \n forces a new line), so multi-line paragraphs and list
  // items don't under-count and clip.
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(1, lines) * lineHeightMm;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/\.sloom-idml$/, '') || 'Imported Document';
}

function safePathPart(value: string): string {
  return value.trim().replace(/[/\\?%*:|"<>]+/g, '-').replace(/\s+/g, '-').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'paper-document';
}

function htmlToText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    // Numeric character references (decimal `&#39;` and hex `&#x2019;`) — Word emits `&apos;` and numeric refs
    // for punctuation; without this the literal entity text leaked into imported paragraphs.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // `&amp;` last so a double-encoded `&amp;#39;` doesn't get mangled before its numeric ref is read.
    .replace(/&amp;/g, '&');
}

/** Guard `String.fromCodePoint` against invalid/out-of-range references so a malformed entity can't throw. */
function safeFromCodePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function decodeXml(value: string): string {
  return decodeHtml(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function escapeRtf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\n/g, '\\par\n');
}
