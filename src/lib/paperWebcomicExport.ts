import { zipSync, strToU8 } from 'fflate';
import { applyImageExportProvenance } from './exportProvenance';
import type { PaperDocument, PaperPage } from '../types/paper';
import {
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets,
  imageSourceToDataUrl,
  rasterizeFlattenedPaperPageToPng,
  type FlattenedPaperPageSvgExport,
  type PaperPageFlattenExportOptions,
} from './paperPageFlattenExport';
import { assertPaperDocumentSupportsRasterization } from './paperPlacedDocumentRasterization';
import { buildPaperPrintSheetPlan, paperPointsToMm } from './paperPrintMarks';

export type PaperWebcomicImageFormat = 'png' | 'jpeg';

export interface PaperWebcomicImageExportOptions extends PaperPageFlattenExportOptions {
  format?: PaperWebcomicImageFormat;
  quality?: number;
  directoryName?: string;
  resolveImageSrc?: (src: string, context: { frameId: string; pageId: string }) => Promise<string | undefined> | string | undefined;
}

export interface PaperWebcomicImagePagePlan {
  pageId: string;
  pageNumber: number;
  pageLabel: string;
  fileName: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  scale: number;
  includeBleed: boolean;
  mimeType: PaperWebcomicMimeType;
  quality?: number;
}

export interface PaperWebcomicImageExportPlan {
  title: string;
  directoryName: string;
  format: PaperWebcomicImageFormat;
  mimeType: PaperWebcomicMimeType;
  quality?: number;
  pages: PaperWebcomicImagePagePlan[];
}

export interface PaperWebcomicRasterizeInput extends PaperWebcomicImagePagePlan {
  svgExport: FlattenedPaperPageSvgExport;
}

export interface PaperWebcomicImageArchiveExport {
  fileName: string;
  mimeType: 'application/zip';
  blob: Blob;
  entries: string[];
}

export interface PaperWebcomicImageDataPage extends PaperWebcomicImagePagePlan {
  dataUrl: string;
}

export type PaperWebcomicRasterizePage = (page: PaperWebcomicRasterizeInput) => Promise<string> | string;
type PaperWebcomicMimeType = 'image/png' | 'image/jpeg';

export function buildPaperWebcomicImageExportPlan(
  document: PaperDocument,
  options: PaperWebcomicImageExportOptions = {},
): PaperWebcomicImageExportPlan {
  const format = normalizePaperWebcomicFormat(options.format);
  const mimeType = paperWebcomicMimeType(format);
  const projectName = safePaperWebcomicPathPart(document.title, 'paper-document');
  const directoryName = safePaperWebcomicPathPart(options.directoryName, `${projectName}-webcomic-${format}`);
  const quality = format === 'jpeg' ? clampQuality(options.quality) : undefined;

  return {
    title: document.title,
    directoryName,
    format,
    mimeType,
    quality,
    pages: document.pages.map((page) => {
      const dimensions = getPaperWebcomicPageDimensions(document, options);
      const pageLabel = paperWebcomicPageLabel(page);
      return {
        pageId: page.id,
        pageNumber: page.pageNumber,
        pageLabel,
        fileName: `${projectName}-${pageLabel}.${paperWebcomicFileExtension(format)}`,
        mimeType,
        quality,
        ...dimensions,
      };
    }),
  };
}

export async function buildPaperWebcomicImageArchiveExport(
  document: PaperDocument,
  options: PaperWebcomicImageExportOptions & { rasterize?: PaperWebcomicRasterizePage } = {},
): Promise<PaperWebcomicImageArchiveExport> {
  assertPaperDocumentSupportsRasterization(document);
  const plan = buildPaperWebcomicImageExportPlan(document, options);
  const entries: Record<string, Uint8Array> = {};
  const entryNames: string[] = [];
  const pages = await buildPaperWebcomicImageDataPages(document, {
    ...options,
    plan,
  });

  for (const page of pages) {
    const entryName = `${plan.directoryName}/${page.fileName}`;
    // Invisible provenance metadata (licensing spec §6) — never drawn on pixels.
    entries[entryName] = applyImageExportProvenance(dataUrlToU8(page.dataUrl, page.mimeType), page.mimeType);
    entryNames.push(entryName);
  }

  entries[`${plan.directoryName}/manifest.json`] = strToU8(`${JSON.stringify({
    app: 'Sloom Studio Paper',
    format: 'signal-loom-paper-webcomic-images',
    title: plan.title,
    directoryName: plan.directoryName,
    imageFormat: plan.format,
    mimeType: plan.mimeType,
    quality: plan.quality,
    pageCount: plan.pages.length,
    pages: plan.pages,
    exportedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  return {
    fileName: `${plan.directoryName}.zip`,
    mimeType: 'application/zip',
    blob: new Blob([zipSync(entries)], { type: 'application/zip' }),
    entries: entryNames,
  };
}

export async function buildPaperWebcomicImageDataPages(
  document: PaperDocument,
  options: PaperWebcomicImageExportOptions & {
    plan?: PaperWebcomicImageExportPlan;
    rasterize?: PaperWebcomicRasterizePage;
    onPageRasterized?: (progress: { pageNumber: number; pageIndex: number; pageCount: number }) => void;
  } = {},
): Promise<PaperWebcomicImageDataPage[]> {
  // Check the whole transaction before page 1 so a later placed PDF never leaves partial output.
  assertPaperDocumentSupportsRasterization(document);
  const plan = options.plan ?? buildPaperWebcomicImageExportPlan(document, options);
  const rasterize = options.rasterize ?? defaultRasterizePaperWebcomicPage;
  const resolveImageSrc = options.resolveImageSrc ?? ((src: string) => imageSourceToDataUrl(src));
  const pages: PaperWebcomicImageDataPage[] = [];

  for (let index = 0; index < plan.pages.length; index += 1) {
    const pagePlan = plan.pages[index];
    const svgExport = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, pagePlan.pageId, {
      includeBleed: pagePlan.includeBleed,
      includeProductionMarks: options.includeProductionMarks,
      outputWidthPx: pagePlan.widthPx,
      outputHeightPx: pagePlan.heightPx,
      resolveImageSrc,
      backdropOnly: options.backdropOnly,
      fontFaceCss: options.fontFaceCss,
    });
    pages.push({
      ...pagePlan,
      dataUrl: await Promise.resolve(rasterize({ ...pagePlan, svgExport })),
    });
    options.onPageRasterized?.({
      pageNumber: pagePlan.pageNumber,
      pageIndex: index,
      pageCount: plan.pages.length,
    });
  }

  return pages;
}

export function safePaperWebcomicPathPart(value: string | undefined, fallback: string): string {
  return (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function getPaperWebcomicPageDimensions(
  document: PaperDocument,
  options: PaperWebcomicImageExportOptions,
): Omit<PaperWebcomicImagePagePlan, 'pageId' | 'pageNumber' | 'pageLabel' | 'fileName' | 'mimeType'> {
  const includeBleed = options.includeBleed ?? false;
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
  const outputDpi = positiveNumber(options.outputDpi) ?? document.page.dpi;
  const requestedWidthPx = positiveInteger(options.outputWidthPx);
  const requestedHeightPx = positiveInteger(options.outputHeightPx);
  const widthPx = requestedWidthPx
    ?? (requestedHeightPx ? Math.max(1, Math.round(requestedHeightPx * (widthMm / heightMm))) : Math.max(1, Math.round((widthMm / 25.4) * outputDpi)));
  const heightPx = requestedHeightPx
    ?? (requestedWidthPx ? Math.max(1, Math.round(requestedWidthPx * (heightMm / widthMm))) : Math.max(1, Math.round((heightMm / 25.4) * outputDpi)));
  const cssPxPerMm = 96 / 25.4;
  const scale = Number(((widthPx / widthMm) / cssPxPerMm).toFixed(6));

  return {
    widthMm,
    heightMm,
    widthPx,
    heightPx,
    scale,
    includeBleed,
  };
}

async function defaultRasterizePaperWebcomicPage(page: PaperWebcomicRasterizeInput): Promise<string> {
  const raster = await rasterizeFlattenedPaperPageToPng(page.svgExport);
  if (page.mimeType === 'image/png') return raster.dataUrl;
  return convertImageDataUrl(raster.dataUrl, page.mimeType, page.quality);
}

async function convertImageDataUrl(dataUrl: string, mimeType: PaperWebcomicMimeType, quality?: number): Promise<string> {
  if (mimeType === 'image/png') return dataUrl;
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  await (typeof image.decode === 'function'
    ? image.decode()
    : new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Paper page image could not be converted.'));
      }));
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Paper page image conversion could not create a canvas context.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return canvas.toDataURL(mimeType, quality ?? 0.92);
}

function paperWebcomicPageLabel(page: PaperPage): string {
  return `Page-${String(page.pageNumber).padStart(3, '0')}`;
}

function normalizePaperWebcomicFormat(format: PaperWebcomicImageFormat | undefined): PaperWebcomicImageFormat {
  return format === 'jpeg' ? 'jpeg' : 'png';
}

function paperWebcomicMimeType(format: PaperWebcomicImageFormat): PaperWebcomicMimeType {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png';
}

function paperWebcomicFileExtension(format: PaperWebcomicImageFormat): string {
  return format === 'jpeg' ? 'jpg' : 'png';
}

function clampQuality(quality: number | undefined): number {
  if (typeof quality !== 'number' || !Number.isFinite(quality)) return 0.92;
  return Math.min(1, Math.max(0.05, quality));
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  const numericValue = positiveNumber(value);
  return numericValue ? Math.max(1, Math.round(numericValue)) : undefined;
}

function dataUrlToU8(dataUrl: string, expectedMimeType: PaperWebcomicMimeType): Uint8Array {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Paper webcomic export produced an invalid image data URL.');
  }
  if (match[1].toLowerCase() !== expectedMimeType) {
    throw new Error(`Paper webcomic export produced ${match[1]} instead of ${expectedMimeType}.`);
  }
  if (match[2]) {
    return Uint8Array.from(atob(match[3]), (char) => char.charCodeAt(0));
  }
  return strToU8(decodeURIComponent(match[3]));
}
