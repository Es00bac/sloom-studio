import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument, PaperPage } from '../types/paper';
import {
  exportPaperDocumentToPrintHtml,
  paperPixelsFromMm,
  resolvePaperDocumentEffectiveTypography,
  resolvePaperPageFramesForOutput,
  updatePaperDocumentSetup,
} from './paperDocument';
import { resolvePaperFrameAssetUrl } from './paperAssetReferences';
import {
  collectExactPaperManagedFaces,
  PaperExactManagedFontError,
  readPaperManagedFontManifest,
  verifyExactPaperManagedFontReadiness,
} from './paperExactManagedFonts';
import {
  assertPaperDocumentSupportsRasterization,
  isPaperPlacedDocumentRasterizationError,
} from './paperPlacedDocumentRasterization';
import { buildPaperPrintSheetPlan, paperPointsToMm } from './paperPrintMarks';
import { paperFrameLayerIsPrintable } from './paperLayers';

export interface PaperPageExportDimensions {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  scale: number;
  includeBleed: boolean;
}

export interface FlattenedPaperPageSvgExport extends PaperPageExportDimensions {
  pageId: string;
  pageNumber: number;
  label: string;
  mimeType: 'image/svg+xml';
  svg: string;
  dataUrl: string;
  /** The exact alias payload embedded in this isolated SVG; required before any raster decode. */
  exactManagedFontCss?: string;
}

export interface FlattenedPaperPageRasterExport extends Omit<FlattenedPaperPageSvgExport, 'mimeType' | 'svg' | 'dataUrl'> {
  mimeType: 'image/png';
  dataUrl: string;
}

export interface PaperPageFlattenExportOptions {
  /** Exact managed-font payload created once for every browser/Electron raster output. */
  fontFaceCss?: string;
  includeBleed?: boolean;
  /** Include the document's explicit crop marks and reserved slug sheet. Intended for print PDF only. */
  includeProductionMarks?: boolean;
  outputDpi?: number;
  outputWidthPx?: number;
  outputHeightPx?: number;
  /** Drop ALL text-kind frames (they're drawn as vector on top of this raster). */
  backdropOnly?: boolean;
  /**
   * Drop only these specific text-kind frames (the ones drawn as vector on top). Other text frames —
   * e.g. display-font SFX with no faithful vector substitute — stay baked into the raster. Takes
   * precedence over `backdropOnly` when both are set.
   */
  excludeTextFrameIds?: string[];
  /**
   * Knock the FILL out of these frames (render them fill-less / paper) — their spot ink is drawn on a real
   * /Separation plate on top instead, so it must not also appear as process in the raster. Stroke + text
   * still render. Composes with `excludeTextFrameIds` (a frame can have both a spot fill and vector text).
   */
  excludeFrameFillIds?: string[];
  /**
   * Knock the STROKE/border out of these frames (render them stroke-less) — their spot ink is drawn on a
   * real /Separation plate on top instead, so it must not also appear as process in the raster. Fill + text
   * still render. Composes with the fill/text knockouts (a frame can have a process fill and a spot border).
   */
  excludeFrameStrokeIds?: string[];
  /**
   * Render only these output-frame ids. This is the bridge from the typed render plan's `flatten-group`
   * nodes to the legacy HTML/SVG rasterizer, so native siblings never get painted into the backdrop.
   */
  renderFrameIds?: readonly string[];
  /** Omit the page background for a group raster so it can composite beneath native print objects. */
  includePageBackground?: boolean;
}

export interface PaperPageEmbeddedAssetExportOptions extends PaperPageFlattenExportOptions {
  resolveImageSrc?: (src: string, context: { frameId: string; pageId: string }) => Promise<string | undefined> | string | undefined;
}

export interface PaperPageSourcePayloadOptions extends PaperPageFlattenExportOptions {
  dataUrl?: string;
  mimeType?: string;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
}

export interface FlattenedPaperPageSourcePayload {
  id?: string;
  label: string;
  kind: Exclude<SourceBinLibraryItem['kind'], 'text'>;
  mimeType: string;
  dataUrl: string;
  sourceKey?: string;
  originNodeId?: string;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
}

/** A raster/decode failure that is safe for a shipping caller to show directly to the user. */
export class PaperPageOutputError extends Error {
  readonly code = 'PAPER_PAGE_OUTPUT_FAILED';
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PaperPageOutputError';
    this.cause = cause;
  }
}

export interface RasterizedPaperPageSourcePayloadOptions extends PaperPageEmbeddedAssetExportOptions {
  /** Explicit browser document for isolated tests/renderers; production uses the current global document. */
  browserDocument?: Document;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
}

export function getPaperPageExportDimensions(
  document: Pick<PaperDocument, 'page' | 'printProduction'>,
  options: PaperPageFlattenExportOptions = {},
): PaperPageExportDimensions {
  const includeBleed = options.includeBleed ?? true;
  const bleedMm = includeBleed ? document.page.bleedMm : 0;
  const printSheet = includeBleed && options.includeProductionMarks
    ? buildPaperPrintSheetPlan(document.page, document.printProduction)
    : undefined;
  const widthMm = printSheet
    ? paperPointsToMm(printSheet.mediaBox.widthPt)
    : Number((document.page.widthMm + bleedMm * 2).toFixed(3));
  const heightMm = printSheet
    ? paperPointsToMm(printSheet.mediaBox.heightPt)
    : Number((document.page.heightMm + bleedMm * 2).toFixed(3));
  const requestedWidthPx = positiveInteger(options.outputWidthPx);
  const requestedHeightPx = positiveInteger(options.outputHeightPx);
  const outputDpi = positiveNumber(options.outputDpi) ?? document.page.dpi;
  const widthPx = requestedWidthPx
    ?? (requestedHeightPx ? Math.max(1, Math.round(requestedHeightPx * (widthMm / heightMm))) : paperPixelsFromMm(widthMm, outputDpi));
  const heightPx = requestedHeightPx
    ?? (requestedWidthPx ? Math.max(1, Math.round(requestedWidthPx * (heightMm / widthMm))) : paperPixelsFromMm(heightMm, outputDpi));
  const cssPxPerMm = 96 / 25.4;
  const exportPxPerMm = widthPx / widthMm;

  return {
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    scale: Number((exportPxPerMm / cssPxPerMm).toFixed(6)),
    includeBleed,
  };
}

export function buildFlattenedPaperPageSvgExport(
  document: PaperDocument,
  pageId: string,
  options: PaperPageFlattenExportOptions = {},
): FlattenedPaperPageSvgExport {
  // Keep the synchronous SVG entrypoint behind the same boundary as its embedded-asset sibling;
  // callers may otherwise hand this SVG straight to the raster canvas adapter.
  assertPaperDocumentSupportsRasterization(document, [pageId]);
  const page = findPaperPage(document, pageId);
  // Collect from the effective-style projection: a paragraph/character style can supply the face
  // this raster will paint, and a bypassing caller must be blocked on exactly that face set.
  const effectiveDocument = resolvePaperDocumentEffectiveTypography(document);
  const managedFaces = collectExactPaperManagedFaces(
    [...effectiveDocument.pages, ...effectiveDocument.parentPages]
      .flatMap((candidate) => candidate.frames)
      .filter((frame) => paperFrameLayerIsPrintable(effectiveDocument, frame)),
    document.importedFonts,
  );
  if (managedFaces.length > 0 && !readPaperManagedFontManifest(options.fontFaceCss)) {
    throw new Error('Flattened Paper output is blocked because its exact managed-font alias payload is missing.');
  }
  const dimensions = getPaperPageExportDimensions(document, options);
  const onePageDocument = buildOnePageExportDocument(document, page, options);
  const html = exportPaperDocumentToPrintHtml(onePageDocument, {
    mediaBox: dimensions.includeBleed ? 'bleed' : 'trim',
    includeScreenGuides: false,
    // Isolated content rasters retain the historical trim/bleed media. Strict PDF/X draws the
    // canonical marks as native paths on the expanded sheet after placing this raster.
    includeProductionMarks: options.includeProductionMarks ?? false,
    fontFaceCss: options.fontFaceCss,
  });
  const body = extractHtmlSection(html, 'body');
  const style = extractHtmlSection(html, 'style');
  const label = `${document.title || 'Paper Layout'} - Page ${page.pageNumber}`;
  const sheetCssWidthPx = dimensions.widthPx / dimensions.scale;
  const sheetCssHeightPx = dimensions.heightPx / dimensions.scale;
  const wrapperBackground = options.includePageBackground === false ? 'transparent' : '#d1d5db';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.widthPx}" height="${dimensions.heightPx}" viewBox="0 0 ${dimensions.widthPx} ${dimensions.heightPx}">
  <foreignObject width="${dimensions.widthPx}" height="${dimensions.heightPx}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${formatPx(sheetCssWidthPx)};height:${formatPx(sheetCssHeightPx)};overflow:hidden;transform:scale(${dimensions.scale});transform-origin:top left;background:${wrapperBackground};">
      <style>${escapeCdata(style)}</style>
      ${body}
    </div>
  </foreignObject>
</svg>`;

  return {
    ...dimensions,
    pageId: page.id,
    pageNumber: page.pageNumber,
    label,
    mimeType: 'image/svg+xml',
    svg,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    ...(options.fontFaceCss ? { exactManagedFontCss: options.fontFaceCss } : {}),
  };
}

export async function buildFlattenedPaperPageSvgExportWithEmbeddedAssets(
  document: PaperDocument,
  pageId: string,
  options: PaperPageEmbeddedAssetExportOptions = {},
): Promise<FlattenedPaperPageSvgExport> {
  // This must precede resolver/fetch/decode work. A placed PDF is valid live-print content but is
  // not an HTMLImageElement source in this build.
  const page = findPaperPage(document, pageId);
  assertPaperDocumentSupportsRasterization(document, [pageId]);
  if (!options.resolveImageSrc) {
    return buildFlattenedPaperPageSvgExport(document, pageId, options);
  }

  const frames = await Promise.all(page.frames.map(async (frame) => {
    const sourceUrl = resolvePaperFrameAssetUrl(frame.asset);
    if (!frame.asset) return frame;
    if (!sourceUrl) {
      if (frame.kind === 'image' || frame.kind === 'document') {
        throw new Error(`Paper artwork ${frame.label} must be materialized before page ${page.pageNumber} is flattened.`);
      }
      return frame;
    }
    const resolvedSrc = await Promise.resolve(options.resolveImageSrc?.(sourceUrl, {
      frameId: frame.id,
      pageId: page.id,
    }));
    if (!resolvedSrc) {
      throw new Error(`Paper artwork ${frame.label} could not be embedded for page ${page.pageNumber}.`);
    }
    // Document frames are already rejected above. Only image frames need Image.decode(); a linked
    // non-PDF document renders as its print placeholder and must not be probed as artwork.
    if (frame.kind === 'image') await predecodeEmbeddedImage(resolvedSrc, frame.label, page.pageNumber);
    if (resolvedSrc === sourceUrl) return frame;
    return {
      ...frame,
      asset: {
        ...frame.asset,
        locator: { kind: 'external' as const, url: resolvedSrc },
      },
    };
  }));
  const embeddedDocument: PaperDocument = {
    ...document,
    pages: document.pages.map((candidate) => candidate.id === page.id
      ? { ...candidate, frames }
      : candidate),
  };

  return buildFlattenedPaperPageSvgExport(embeddedDocument, page.id, options);
}

async function predecodeEmbeddedImage(src: string, frameLabel: string, pageNumber: number): Promise<void> {
  if (typeof globalThis.Image !== 'function') return;
  const image = new globalThis.Image();
  image.decoding = 'async';
  image.src = src;
  try {
    await decodeImage(image);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Paper artwork ${frameLabel} on page ${pageNumber} could not be decoded${detail}`);
  }
}

export function buildFlattenedPaperPageSourcePayload(
  document: PaperDocument,
  pageId: string,
  options: PaperPageSourcePayloadOptions = {},
): FlattenedPaperPageSourcePayload {
  const exported = buildFlattenedPaperPageSvgExport(document, pageId, options);

  return {
    label: exported.label,
    kind: 'image',
    mimeType: options.mimeType ?? exported.mimeType,
    dataUrl: options.dataUrl ?? exported.dataUrl,
    sourceKey: `paper-page:${document.id}:${pageId}:${exported.widthPx}x${exported.heightPx}:${exported.includeBleed ? 'bleed' : 'trim'}`,
    envelopeId: options.envelopeId,
    envelopeLabel: options.envelopeLabel,
    envelopeIndex: options.envelopeIndex,
  };
}

/**
 * Build the only Source/Storyboard payload that may be published: a successfully decoded and rasterized PNG.
 * Exact-font readiness errors retain their typed identity; all other raster/decode failures become a typed,
 * actionable output error. No raw SVG fallback is returned.
 */
export async function buildRasterizedPaperPageSourcePayload(
  document: PaperDocument,
  pageId: string,
  options: RasterizedPaperPageSourcePayloadOptions = {},
): Promise<FlattenedPaperPageSourcePayload> {
  try {
    const { browserDocument, ...exportOptions } = options;
    const svgExport = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, pageId, exportOptions);
    const rasterExport = await rasterizeFlattenedPaperPageToPng(svgExport, browserDocument);
    return buildFlattenedPaperPageSourcePayload(document, pageId, {
      ...exportOptions,
      dataUrl: rasterExport.dataUrl,
      mimeType: rasterExport.mimeType,
    });
  } catch (error) {
    if (error instanceof PaperExactManagedFontError) throw error;
    // Placed-document failures carry their own typed code and structured per-frame issues;
    // wrapping them generically would strip the contract consumers act on.
    if (isPaperPlacedDocumentRasterizationError(error)) throw error;
    const page = document.pages.find((candidate) => candidate.id === pageId);
    const label = page ? `page ${page.pageNumber}` : 'the requested page';
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new PaperPageOutputError(`Paper ${label} could not be decoded and rasterized, so no Source Library or Video asset was published.${detail}`, error);
  }
}

/** Publish only after the complete PNG payload exists, keeping readiness/raster failures side-effect free. */
export async function publishRasterizedPaperPageSourcePayload<T>(
  document: PaperDocument,
  pageId: string,
  options: RasterizedPaperPageSourcePayloadOptions,
  publish: (payload: FlattenedPaperPageSourcePayload) => Promise<T>,
  assertBeforePublish?: () => void,
): Promise<T> {
  const payload = await buildRasterizedPaperPageSourcePayload(document, pageId, options);
  assertBeforePublish?.();
  return publish(payload);
}

export interface RasterizedPaperPageSourcePayloadRequest {
  pageId: string;
  options: RasterizedPaperPageSourcePayloadOptions;
}

/**
 * Prepare and validate a complete multi-page batch before publishing its first item. A failure in any page's
 * asset embedding, exact-font readiness, SVG decode, or PNG rasterization therefore leaves the Source Library
 * unchanged instead of publishing a truncated envelope.
 */
export async function publishRasterizedPaperPagesSourcePayloads<T>(
  document: PaperDocument,
  requests: readonly RasterizedPaperPageSourcePayloadRequest[],
  publish: (payload: FlattenedPaperPageSourcePayload) => Promise<T>,
  assertBeforePublish?: () => void,
): Promise<T[]> {
  const payloads: FlattenedPaperPageSourcePayload[] = [];
  for (const { pageId, options } of requests) {
    payloads.push(await buildRasterizedPaperPageSourcePayload(document, pageId, options));
  }
  assertBeforePublish?.();
  const published: T[] = [];
  for (const payload of payloads) published.push(await publish(payload));
  return published;
}

export async function rasterizeFlattenedPaperPageToPng(
  exported: FlattenedPaperPageSvgExport,
  browserDocument: Document = globalThis.document,
): Promise<FlattenedPaperPageRasterExport> {
  if (!browserDocument) {
    throw new Error('Paper page raster export needs a browser document.');
  }
  await verifyFlattenedPaperPageExactManagedFonts(exported, browserDocument);
  const decoded = await decodeFlattenedPaperPageSvg(exported);
  try {
    const canvas = browserDocument.createElement('canvas');
    canvas.width = exported.widthPx;
    canvas.height = exported.heightPx;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Paper page raster export could not create a canvas context.');
    }
    context.drawImage(decoded.image, 0, 0, exported.widthPx, exported.heightPx);

    return {
      pageId: exported.pageId,
      pageNumber: exported.pageNumber,
      label: exported.label,
      widthMm: exported.widthMm,
      heightMm: exported.heightMm,
      widthPx: exported.widthPx,
      heightPx: exported.heightPx,
      scale: exported.scale,
      includeBleed: exported.includeBleed,
      mimeType: 'image/png',
      dataUrl: canvas.toDataURL('image/png'),
    };
  } finally {
    decoded.dispose();
  }
}

export interface FlattenedPaperPageRgbaExport extends PaperPageExportDimensions {
  pageId: string;
  pageNumber: number;
  label: string;
  /** Interleaved RGBA, row-major top-to-bottom (canvas order). Length = widthPx*heightPx*4. */
  rgba: Uint8ClampedArray;
}

/**
 * Rasterize a flattened page SVG to raw RGBA pixels (for the real PDF/X exporter, which converts them
 * to CMYK through an ICC profile). Same canvas path as the PNG raster, minus the PNG encode.
 */
export async function rasterizeFlattenedPaperPageToRgba(
  exported: FlattenedPaperPageSvgExport,
  browserDocument: Document = globalThis.document,
): Promise<FlattenedPaperPageRgbaExport> {
  if (!browserDocument) {
    throw new Error('Paper page raster export needs a browser document.');
  }
  await verifyFlattenedPaperPageExactManagedFonts(exported, browserDocument);
  const decoded = await decodeFlattenedPaperPageSvg(exported);
  try {
    const canvas = browserDocument.createElement('canvas');
    canvas.width = exported.widthPx;
    canvas.height = exported.heightPx;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Paper page raster export could not create a canvas context.');
    }
    context.drawImage(decoded.image, 0, 0, exported.widthPx, exported.heightPx);
    const { data } = context.getImageData(0, 0, exported.widthPx, exported.heightPx);

    return {
      pageId: exported.pageId,
      pageNumber: exported.pageNumber,
      label: exported.label,
      widthMm: exported.widthMm,
      heightMm: exported.heightMm,
      widthPx: exported.widthPx,
      heightPx: exported.heightPx,
      scale: exported.scale,
      includeBleed: exported.includeBleed,
      rgba: data,
    };
  } finally {
    decoded.dispose();
  }
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  const numericValue = positiveNumber(value);
  return numericValue ? Math.max(1, Math.round(numericValue)) : undefined;
}

export async function imageSourceToDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Could not embed Paper image asset (${response.status}).`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function buildOnePageExportDocument(
  document: PaperDocument,
  page: PaperPage,
  options: PaperPageFlattenExportOptions,
): PaperDocument {
  const includeBleed = options.includeBleed ?? true;
  const selectedFrameIds = options.renderFrameIds ? new Set(options.renderFrameIds) : undefined;
  // `resolvePaperPageFramesForOutput` includes inherited frames and effective styles. Once selected, copy
  // those resolved frames onto a standalone page and clear parent linkage so the print HTML cannot re-add
  // every master item underneath a flatten group.
  const sourceDocument = selectedFrameIds ? { ...document, parentPages: [] } : document;
  let exportPage: PaperPage = selectedFrameIds
    ? {
        ...page,
        parentPageId: undefined,
        frames: resolvePaperPageFramesForOutput(document, page)
          .filter((frame) => selectedFrameIds.has(frame.id)),
      }
    : page;
  const excluded = options.excludeTextFrameIds ? new Set(options.excludeTextFrameIds) : undefined;
  const knockoutFills = options.excludeFrameFillIds ? new Set(options.excludeFrameFillIds) : undefined;
  const knockoutStrokes = options.excludeFrameStrokeIds ? new Set(options.excludeFrameStrokeIds) : undefined;
  if (excluded || knockoutFills || knockoutStrokes) {
    // Frame-level: keep every frame (so a caption's border/box still renders) but BLANK the text of the
    // text-excluded frames (drawn as vector on top), REMOVE the fill of spot-fill-knockout frames, and REMOVE
    // the stroke of spot-stroke-knockout frames (each drawn as a /Separation plate on top). All three compose.
    exportPage = {
      ...page,
      frames: page.frames.map((frame) => {
        let next = frame;
        if (excluded?.has(frame.id)) next = { ...next, text: '' };
        if (knockoutFills?.has(frame.id)) next = { ...next, fillColor: 'transparent', fillGradient: undefined, fillOpacity: 0 };
        if (knockoutStrokes?.has(frame.id)) next = { ...next, strokeColor: 'transparent', strokeWidthMm: 0, strokeOpacity: 0 };
        return next;
      }),
    };
  } else if (options.backdropOnly) {
    exportPage = {
      ...page,
      frames: page.frames.filter((frame) => {
        return frame.kind === 'panel' || frame.kind === 'image' || frame.kind === 'shape' || frame.kind === 'document';
      }),
    };
  }
  const exportDocument: PaperDocument = {
    ...sourceDocument,
    ...(options.includePageBackground === false
      ? {
          background: {
            ...document.background,
            type: 'solid' as const,
            color: 'transparent',
            fromColor: 'transparent',
            toColor: 'transparent',
          },
        }
      : {}),
    pages: [exportPage],
  };

  if (includeBleed) return exportDocument;

  return updatePaperDocumentSetup(exportDocument, { bleedMm: 0 });
}

function findPaperPage(document: PaperDocument, pageId: string): PaperPage {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (page) return page;
  throw new Error(`Unknown Paper page id "${pageId}" requested for export.`);
}

function extractHtmlSection(html: string, tagName: 'style' | 'body'): string {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*)<\\/${tagName}>`, 'i');
  return pattern.exec(html)?.[1]?.trim() ?? '';
}

function escapeCdata(value: string): string {
  return value.replaceAll('</style>', '<\\/style>');
}

function formatPx(value: number): string {
  return `${Number(value.toFixed(3))}px`;
}

function decodeImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === 'function') {
    return image.decode();
  }
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Paper page SVG could not be loaded for raster export.'));
  });
}

async function decodeFlattenedPaperPageSvg(
  exported: FlattenedPaperPageSvgExport,
): Promise<{ image: HTMLImageElement; dispose: () => void }> {
  const image = new Image();
  image.decoding = 'async';
  // Keep the SVG on a data: URL. Chromium treats a Blob-backed SVG containing foreignObject HTML as a
  // cross-origin source and taints the destination canvas, even when every nested image is embedded.
  image.src = exported.dataUrl;

  try {
    await decodeImage(image);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new Error(`Paper page ${exported.pageNumber} SVG could not be decoded for raster export${detail}`);
  }

  return {
    image,
    dispose: () => undefined,
  };
}

/**
 * The SVG is an isolated document: verify its own embedded payload before Image.decode() can turn
 * a missing alias into fallback pixels. The host FontFaceSet check is deliberately descriptor- and
 * alias-specific, while the containment check proves those same aliases were embedded in this SVG.
 */
async function verifyFlattenedPaperPageExactManagedFonts(
  exported: FlattenedPaperPageSvgExport,
  browserDocument: Document,
): Promise<void> {
  const css = exported.exactManagedFontCss;
  if (!css?.includes('@font-face')) return;
  const manifest = readPaperManagedFontManifest(css);
  if (!manifest) throw new Error('Flattened Paper SVG has managed font rules without an exact identity manifest.');
  if (!exported.svg.includes(css)) {
    throw new Error('Flattened Paper SVG is missing its exact managed-font payload; raster paint is blocked.');
  }
  // The payload is built once for the complete Paper document, so a one-page SVG can legitimately
  // embed faces that page does not use. @font-face aliases are deliberately hex-escaped in `css`,
  // which also means a raw `svg.includes(face.familyAlias)` check confuses an unused face with a
  // missing one. Prove the inverse instead: every managed alias the page body actually requests must
  // be declared by the embedded manifest. The exact payload containment check above then proves its
  // rule and bytes travelled into this isolated SVG.
  const declaredAliases = new Set(manifest.faces.map((face) => face.familyAlias));
  for (const alias of referencedManagedAliases(exported.svg)) {
    if (!declaredAliases.has(alias)) {
      throw new Error(`Flattened Paper SVG requests undeclared managed alias ${alias}; raster paint is blocked.`);
    }
  }
  await verifyExactPaperManagedFontReadiness(browserDocument, css);
}

function referencedManagedAliases(svg: string): Set<string> {
  // The embedded @font-face payload hex-escapes aliases, so literal managed aliases occur in the
  // rendered body's inline font-family declarations. Limit matching to those declarations so user
  // text that merely mentions an alias-shaped string cannot become an export preflight failure.
  const aliases = new Set<string>();
  const pattern = /font-family\s*:\s*(?:(?:&quot;|&#34;|["'])\s*)?(sloom-managed-[A-Za-z0-9_-]+)/g;
  for (const match of svg.matchAll(pattern)) aliases.add(match[1]);
  return aliases;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Paper image asset could not be embedded as a data URL.'));
      }
    };
    reader.onerror = () => reject(new Error('Paper image asset could not be read for embedding.'));
    reader.readAsDataURL(blob);
  });
}
