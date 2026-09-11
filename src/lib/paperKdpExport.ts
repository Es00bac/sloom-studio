import { strToU8, zipSync } from 'fflate';
import { applyImageExportProvenance } from './exportProvenance';
import type { PaperDocument, PaperPage } from '../types/paper';
import {
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets,
  imageSourceToDataUrl,
  rasterizeFlattenedPaperPageToPng,
  type FlattenedPaperPageSvgExport,
  type PaperPageFlattenExportOptions,
} from './paperPageFlattenExport';
import { paperPixelsFromMm, updatePaperDocumentSetup } from './paperDocument';
import { assertPaperDocumentSupportsRasterization } from './paperPlacedDocumentRasterization';

export const KDP_BLEED_IN = 0.125;
export const KDP_BLEED_MM = 25.4 * KDP_BLEED_IN;
export const KDP_MIN_INTERIOR_PAGES = 24;
export const KDP_MAX_INTERIOR_PAGES = 828;
export const KDP_MIN_SPINE_TEXT_PAGES = 79;

export type PaperKdpInteriorType = 'black-and-white' | 'standard-color' | 'premium-color';
export type PaperKdpPaperType = 'white' | 'cream';
export type PaperKdpPageRole =
  | 'front-cover'
  | 'back-cover'
  | 'inside-front-cover'
  | 'inside-back-cover'
  | 'story';
export type PaperKdpPageSide = 'left' | 'right';
export type PaperKdpWarningSeverity = 'info' | 'warning' | 'error';

export interface PaperKdpExportOptions extends PaperPageFlattenExportOptions {
  directoryName?: string;
  dpi?: number;
  interiorType?: PaperKdpInteriorType;
  paperType?: PaperKdpPaperType;
  spineWidthMm?: number;
  spineFillColor?: string;
  resolveImageSrc?: (src: string, context: { frameId: string; pageId: string }) => Promise<string | undefined> | string | undefined;
}

export interface PaperKdpDimensionPlan {
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
}

export interface PaperKdpPagePlan extends PaperKdpDimensionPlan {
  pageId: string;
  sourcePageNumber: number;
  role: PaperKdpPageRole;
  fileName: string;
  kdpInteriorPageNumber?: number;
  storyPageNumber?: number;
  outsideEdge?: PaperKdpPageSide;
}

export interface PaperKdpCoverWrapPlan extends PaperKdpDimensionPlan {
  spineWidthMm: number;
  spineWidthPx: number;
  sideWidthMm: number;
  sideWidthPx: number;
  allowSpineText: boolean;
}

export interface PaperKdpWarning {
  code: string;
  severity: PaperKdpWarningSeverity;
  message: string;
}

export interface PaperKdpExportPlan {
  title: string;
  directoryName: string;
  dpi: number;
  trim: PaperKdpDimensionPlan;
  kdpBleedMm: number;
  interiorType: PaperKdpInteriorType;
  paperType: PaperKdpPaperType;
  interiorPageCount: number;
  storyPageCount: number;
  spinePageThicknessMm: number;
  interiorPageDimensions: PaperKdpDimensionPlan;
  coverWrap: PaperKdpCoverWrapPlan;
  roles: {
    frontCover?: PaperKdpPagePlan;
    backCover?: PaperKdpPagePlan;
    insideFrontCover?: PaperKdpPagePlan;
    insideBackCover?: PaperKdpPagePlan;
  };
  interiorPages: PaperKdpPagePlan[];
  warnings: PaperKdpWarning[];
  officialReferences: Array<{ label: string; url: string }>;
}

export interface PaperKdpRasterizeInput extends PaperKdpPagePlan {
  svgExport: FlattenedPaperPageSvgExport;
  sourceWidthPx: number;
  sourceHeightPx: number;
  cropX: number;
  cropY: number;
  cropWidthPx: number;
  cropHeightPx: number;
}

export interface PaperKdpComposeCoverInput {
  plan: PaperKdpExportPlan;
  frontCover: PaperKdpPagePlan;
  backCover: PaperKdpPagePlan;
  frontCoverDataUrl: string;
  backCoverDataUrl: string;
  spineFillColor: string;
}

export interface PaperKdpImageArchiveExport {
  fileName: string;
  mimeType: 'application/zip';
  blob: Blob;
  entries: string[];
  plan: PaperKdpExportPlan;
}

export type PaperKdpRasterizePage = (input: PaperKdpRasterizeInput) => Promise<string> | string;
export type PaperKdpComposeCoverWrap = (input: PaperKdpComposeCoverInput) => Promise<string> | string;

const KDP_OFFICIAL_REFERENCES = [
  {
    label: 'KDP paperback cover calculator and templates',
    url: 'https://kdp.amazon.com/en_US/cover-templates',
  },
  {
    label: 'KDP manuscript bleed and trim sizing',
    url: 'https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6',
  },
  {
    label: 'KDP paperback formatting and image resolution guidance',
    url: 'https://kdp.amazon.com/en_US/help/topic/G201834230',
  },
] as const;

export function buildPaperKdpExportPlan(
  document: PaperDocument,
  options: PaperKdpExportOptions = {},
): PaperKdpExportPlan {
  const dpi = positiveInteger(options.dpi) ?? positiveInteger(options.outputDpi) ?? document.page.dpi;
  const projectName = paperKdpSafePathPart(document.title, 'paper-document');
  const directoryName = paperKdpSafePathPart(options.directoryName, `${projectName}-kdp-assets`);
  const interiorType = options.interiorType ?? 'premium-color';
  const paperType = options.paperType ?? 'white';
  const pages = document.pages.slice().sort((a, b) => a.pageNumber - b.pageNumber);
  const interiorSourcePages = pages.slice(1, -1);
  const storySourcePages = interiorSourcePages.slice(1, -1);
  const interiorPageCount = interiorSourcePages.length;
  const spinePageThicknessMm = getKdpSpinePageThicknessMm(interiorType, paperType);
  const spineWidthMm = positiveNumber(options.spineWidthMm) ?? Number((interiorPageCount * spinePageThicknessMm).toFixed(4));
  const trim = dimensionPlan(document.page.widthMm, document.page.heightMm, dpi);
  const interiorPageDimensions = dimensionPlan(
    document.page.widthMm + KDP_BLEED_MM,
    document.page.heightMm + (KDP_BLEED_MM * 2),
    dpi,
  );
  const coverWrap = buildCoverWrapPlan(document, dpi, spineWidthMm, interiorPageCount);
  const roles = buildKdpRolePlans({
    pages,
    interiorPageDimensions,
  });
  const interiorPages = [
    roles.insideFrontCover,
    ...storySourcePages.map((page, index) => buildKdpInteriorPagePlan({
      page,
      role: 'story',
      dimensions: interiorPageDimensions,
      kdpInteriorPageNumber: index + 2,
      storyPageNumber: index + 1,
    })),
    roles.insideBackCover,
  ].filter((page): page is PaperKdpPagePlan => Boolean(page));
  const warnings = buildKdpWarnings({
    dpi,
    document,
    interiorPageCount,
  });

  return {
    title: document.title,
    directoryName,
    dpi,
    trim,
    kdpBleedMm: KDP_BLEED_MM,
    interiorType,
    paperType,
    interiorPageCount,
    storyPageCount: storySourcePages.length,
    spinePageThicknessMm,
    interiorPageDimensions,
    coverWrap,
    roles,
    interiorPages,
    warnings,
    officialReferences: [...KDP_OFFICIAL_REFERENCES],
  };
}

export async function buildPaperKdpImageArchiveExport(
  document: PaperDocument,
  options: PaperKdpExportOptions & {
    rasterize?: PaperKdpRasterizePage;
    composeCoverWrap?: PaperKdpComposeCoverWrap;
    onPageRasterized?: (progress: { pageNumber: number; pageIndex: number; pageCount: number; role: PaperKdpPageRole }) => void;
  } = {},
): Promise<PaperKdpImageArchiveExport> {
  assertPaperDocumentSupportsRasterization(document);
  const plan = buildPaperKdpExportPlan(document, options);
  const entries: Record<string, Uint8Array> = {};
  const entryNames: string[] = [];
  const rasterize = options.rasterize ?? defaultRasterizeKdpPage;
  const composeCoverWrap = options.composeCoverWrap ?? defaultComposeKdpCoverWrap;
  const kdpDocument = updatePaperDocumentSetup(document, {
    bleedMm: KDP_BLEED_MM,
    dpi: plan.dpi,
  });
  const resolveImageSrc = options.resolveImageSrc ?? ((src: string) => imageSourceToDataUrl(src));
  const coverEntries: Array<{ page: PaperKdpPagePlan; directory: string }> = [];

  if (plan.roles.frontCover) coverEntries.push({ page: plan.roles.frontCover, directory: 'cover' });
  if (plan.roles.backCover) coverEntries.push({ page: plan.roles.backCover, directory: 'cover' });

  const renderedCoverPages = new Map<string, string>();
  const allPages = [...coverEntries.map((entry) => entry.page), ...plan.interiorPages];
  for (let index = 0; index < allPages.length; index += 1) {
    const page = allPages[index];
    const directory = page.role === 'front-cover' || page.role === 'back-cover' ? 'cover' : 'interior';
    const dataUrl = await renderKdpPage(kdpDocument, page, rasterize, resolveImageSrc, options.fontFaceCss);
    const entryName = `${plan.directoryName}/${directory}/${page.fileName}`;
    // Invisible provenance metadata (licensing spec §6) — never drawn on pixels.
    entries[entryName] = applyImageExportProvenance(dataUrlToU8(dataUrl, 'image/png'), 'image/png');
    entryNames.push(entryName);
    if (page.role === 'front-cover' || page.role === 'back-cover') {
      renderedCoverPages.set(page.role, dataUrl);
    }
    options.onPageRasterized?.({
      pageNumber: page.sourcePageNumber,
      pageIndex: index,
      pageCount: allPages.length,
      role: page.role,
    });
  }

  if (plan.roles.frontCover && plan.roles.backCover) {
    const frontCoverDataUrl = renderedCoverPages.get('front-cover');
    const backCoverDataUrl = renderedCoverPages.get('back-cover');
    if (frontCoverDataUrl && backCoverDataUrl) {
      const fullWrapDataUrl = await Promise.resolve(composeCoverWrap({
        plan,
        frontCover: plan.roles.frontCover,
        backCover: plan.roles.backCover,
        frontCoverDataUrl,
        backCoverDataUrl,
        spineFillColor: options.spineFillColor ?? '#ffffff',
      }));
      const entryName = `${plan.directoryName}/cover/full-wrap-cover.png`;
      entries[entryName] = applyImageExportProvenance(dataUrlToU8(fullWrapDataUrl, 'image/png'), 'image/png');
      entryNames.unshift(entryName);
    }
  }

  entries[`${plan.directoryName}/manifest.json`] = strToU8(`${JSON.stringify(buildKdpManifest(plan), null, 2)}\n`);
  entries[`${plan.directoryName}/preflight.json`] = strToU8(`${JSON.stringify({
    title: plan.title,
    warnings: plan.warnings,
    officialReferences: plan.officialReferences,
  }, null, 2)}\n`);
  entryNames.push(`${plan.directoryName}/manifest.json`, `${plan.directoryName}/preflight.json`);

  return {
    fileName: `${plan.directoryName}.zip`,
    mimeType: 'application/zip',
    blob: new Blob([zipSync(entries)], { type: 'application/zip' }),
    entries: entryNames,
    plan,
  };
}

export function paperKdpSafePathPart(value: string | undefined, fallback: string): string {
  return (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

export function getKdpSpinePageThicknessMm(
  interiorType: PaperKdpInteriorType,
  paperType: PaperKdpPaperType,
): number {
  if (interiorType === 'black-and-white' && paperType === 'cream') return 0.0635;
  if (interiorType === 'black-and-white') return 0.0572;
  if (interiorType === 'standard-color') return 0.0572;
  return 0.0596;
}

function buildKdpRolePlans(input: {
  pages: PaperPage[];
  interiorPageDimensions: PaperKdpDimensionPlan;
}): PaperKdpExportPlan['roles'] {
  const { pages, interiorPageDimensions } = input;
  const firstPage = pages[0];
  const secondPage = pages[1];
  const nextToLastPage = pages.at(-2);
  const lastPage = pages.at(-1);

  return {
    frontCover: firstPage ? buildKdpCoverPagePlan({
      page: firstPage,
      role: 'front-cover',
      dimensions: interiorPageDimensions,
      outsideEdge: 'right',
    }) : undefined,
    backCover: lastPage && lastPage.id !== firstPage?.id ? buildKdpCoverPagePlan({
      page: lastPage,
      role: 'back-cover',
      dimensions: interiorPageDimensions,
      outsideEdge: 'left',
    }) : undefined,
    insideFrontCover: secondPage ? buildKdpInteriorPagePlan({
      page: secondPage,
      role: 'inside-front-cover',
      dimensions: interiorPageDimensions,
      kdpInteriorPageNumber: 1,
    }) : undefined,
    insideBackCover: nextToLastPage && nextToLastPage.id !== secondPage?.id ? buildKdpInteriorPagePlan({
      page: nextToLastPage,
      role: 'inside-back-cover',
      dimensions: interiorPageDimensions,
      kdpInteriorPageNumber: Math.max(1, pages.length - 2),
    }) : undefined,
  };
}

function buildKdpCoverPagePlan(input: {
  page: PaperPage;
  role: Extract<PaperKdpPageRole, 'front-cover' | 'back-cover'>;
  dimensions: PaperKdpDimensionPlan;
  outsideEdge: PaperKdpPageSide;
}): PaperKdpPagePlan {
  const prefix = input.role === 'front-cover' ? 'front-cover' : 'back-cover';
  return {
    ...input.dimensions,
    pageId: input.page.id,
    sourcePageNumber: input.page.pageNumber,
    role: input.role,
    outsideEdge: input.outsideEdge,
    fileName: `${prefix}-page-${String(input.page.pageNumber).padStart(3, '0')}.png`,
  };
}

function buildKdpInteriorPagePlan(input: {
  page: PaperPage;
  role: Exclude<PaperKdpPageRole, 'front-cover' | 'back-cover'>;
  dimensions: PaperKdpDimensionPlan;
  kdpInteriorPageNumber: number;
  storyPageNumber?: number;
}): PaperKdpPagePlan {
  const side = input.kdpInteriorPageNumber % 2 === 1 ? 'right' : 'left';
  const roleLabel = input.role === 'story' && input.storyPageNumber
    ? `story-page-${String(input.storyPageNumber).padStart(3, '0')}-source-page-${String(input.page.pageNumber).padStart(3, '0')}`
    : `${input.role}-page-${String(input.page.pageNumber).padStart(3, '0')}`;
  return {
    ...input.dimensions,
    pageId: input.page.id,
    sourcePageNumber: input.page.pageNumber,
    role: input.role,
    kdpInteriorPageNumber: input.kdpInteriorPageNumber,
    storyPageNumber: input.storyPageNumber,
    outsideEdge: side,
    fileName: `${String(input.kdpInteriorPageNumber).padStart(3, '0')}-${roleLabel}.png`,
  };
}

function buildCoverWrapPlan(
  document: PaperDocument,
  dpi: number,
  spineWidthMm: number,
  interiorPageCount: number,
): PaperKdpCoverWrapPlan {
  const sideWidthMm = document.page.widthMm + KDP_BLEED_MM;
  const widthMm = (document.page.widthMm * 2) + spineWidthMm + (KDP_BLEED_MM * 2);
  const heightMm = document.page.heightMm + (KDP_BLEED_MM * 2);
  return {
    ...dimensionPlan(widthMm, heightMm, dpi),
    spineWidthMm,
    spineWidthPx: paperPixelsFromMm(spineWidthMm, dpi),
    sideWidthMm,
    sideWidthPx: paperPixelsFromMm(sideWidthMm, dpi),
    allowSpineText: interiorPageCount >= KDP_MIN_SPINE_TEXT_PAGES,
  };
}

function buildKdpWarnings(input: {
  document: PaperDocument;
  dpi: number;
  interiorPageCount: number;
}): PaperKdpWarning[] {
  const warnings: PaperKdpWarning[] = [];
  if (input.interiorPageCount < KDP_MIN_INTERIOR_PAGES) {
    warnings.push({
      code: 'kdp-interior-page-count-low',
      severity: 'error',
      message: `KDP paperback interiors generally require at least ${KDP_MIN_INTERIOR_PAGES} manuscript pages. This export has ${input.interiorPageCount} interior page assets after using the first and last document pages as exterior cover art.`,
    });
  }
  if (input.interiorPageCount > KDP_MAX_INTERIOR_PAGES) {
    warnings.push({
      code: 'kdp-interior-page-count-high',
      severity: 'error',
      message: `KDP paperback interiors generally top out at ${KDP_MAX_INTERIOR_PAGES} pages. This export has ${input.interiorPageCount} interior page assets.`,
    });
  }
  if (input.dpi < 300) {
    warnings.push({
      code: 'kdp-dpi-low',
      severity: 'error',
      message: `KDP recommends images at 300 DPI or higher. This export is configured for ${input.dpi} DPI.`,
    });
  }
  if (Math.abs(input.document.page.bleedMm - KDP_BLEED_MM) > 0.05) {
    warnings.push({
      code: 'kdp-bleed-overridden',
      severity: 'info',
      message: `KDP export will use ${KDP_BLEED_MM.toFixed(3)} mm bleed even though the document bleed is ${input.document.page.bleedMm.toFixed(3)} mm.`,
    });
  }
  if (input.interiorPageCount < KDP_MIN_SPINE_TEXT_PAGES) {
    warnings.push({
      code: 'kdp-spine-text-disabled',
      severity: 'info',
      message: `KDP does not allow spine text below ${KDP_MIN_SPINE_TEXT_PAGES} pages, so the generated cover wrap keeps the spine blank.`,
    });
  }
  return warnings;
}

async function renderKdpPage(
  document: PaperDocument,
  page: PaperKdpPagePlan,
  rasterize: PaperKdpRasterizePage,
  resolveImageSrc: NonNullable<PaperKdpExportOptions['resolveImageSrc']>,
  fontFaceCss: string | undefined,
): Promise<string> {
  const sourceExport = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, page.pageId, {
    includeBleed: true,
    outputDpi: document.page.dpi,
    resolveImageSrc,
    fontFaceCss,
  });
  const bleedPx = paperPixelsFromMm(KDP_BLEED_MM, document.page.dpi);
  const cropX = page.outsideEdge === 'left' ? 0 : bleedPx;
  return Promise.resolve(rasterize({
    ...page,
    svgExport: sourceExport,
    sourceWidthPx: sourceExport.widthPx,
    sourceHeightPx: sourceExport.heightPx,
    cropX,
    cropY: 0,
    cropWidthPx: page.widthPx,
    cropHeightPx: page.heightPx,
  }));
}

async function defaultRasterizeKdpPage(input: PaperKdpRasterizeInput): Promise<string> {
  const raster = await rasterizeFlattenedPaperPageToPng(input.svgExport);
  if (
    input.cropX === 0
    && input.cropY === 0
    && input.cropWidthPx === raster.widthPx
    && input.cropHeightPx === raster.heightPx
  ) {
    return raster.dataUrl;
  }
  return cropImageDataUrl(raster.dataUrl, {
    cropX: input.cropX,
    cropY: input.cropY,
    cropWidthPx: input.cropWidthPx,
    cropHeightPx: input.cropHeightPx,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
  });
}

async function defaultComposeKdpCoverWrap(input: PaperKdpComposeCoverInput): Promise<string> {
  const front = await loadImage(input.frontCoverDataUrl);
  const back = await loadImage(input.backCoverDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = input.plan.coverWrap.widthPx;
  canvas.height = input.plan.coverWrap.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('KDP cover wrap export could not create a canvas context.');
  context.fillStyle = input.spineFillColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(back, 0, 0, input.plan.coverWrap.sideWidthPx, input.plan.coverWrap.heightPx);
  context.fillStyle = input.spineFillColor;
  context.fillRect(input.plan.coverWrap.sideWidthPx, 0, input.plan.coverWrap.spineWidthPx, input.plan.coverWrap.heightPx);
  context.drawImage(
    front,
    input.plan.coverWrap.sideWidthPx + input.plan.coverWrap.spineWidthPx,
    0,
    input.plan.coverWrap.sideWidthPx,
    input.plan.coverWrap.heightPx,
  );
  return canvas.toDataURL('image/png');
}

async function cropImageDataUrl(
  dataUrl: string,
  crop: {
    cropX: number;
    cropY: number;
    cropWidthPx: number;
    cropHeightPx: number;
    widthPx: number;
    heightPx: number;
  },
): Promise<string> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = crop.widthPx;
  canvas.height = crop.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('KDP page crop could not create a canvas context.');
  context.drawImage(
    image,
    crop.cropX,
    crop.cropY,
    crop.cropWidthPx,
    crop.cropHeightPx,
    0,
    0,
    crop.widthPx,
    crop.heightPx,
  );
  return canvas.toDataURL('image/png');
}

function buildKdpManifest(plan: PaperKdpExportPlan) {
  return {
    app: 'Sloom Studio Paper',
    format: 'signal-loom-paper-kdp-image-assets',
    version: 1,
    title: plan.title,
    directoryName: plan.directoryName,
    exportedAt: new Date().toISOString(),
    dpi: plan.dpi,
    trim: plan.trim,
    kdpBleedMm: plan.kdpBleedMm,
    interiorType: plan.interiorType,
    paperType: plan.paperType,
    interiorPageCount: plan.interiorPageCount,
    storyPageCount: plan.storyPageCount,
    spinePageThicknessMm: plan.spinePageThicknessMm,
    coverWrap: plan.coverWrap,
    roles: plan.roles,
    interiorPages: plan.interiorPages,
    warnings: plan.warnings,
    officialReferences: plan.officialReferences,
  };
}

function dimensionPlan(widthMm: number, heightMm: number, dpi: number): PaperKdpDimensionPlan {
  return {
    widthMm: Number(widthMm.toFixed(3)),
    heightMm: Number(heightMm.toFixed(3)),
    widthPx: paperPixelsFromMm(widthMm, dpi),
    heightPx: paperPixelsFromMm(heightMm, dpi),
  };
}

function dataUrlToU8(dataUrl: string, expectedMimeType: string): Uint8Array {
  const [header, payload = ''] = dataUrl.split(',', 2);
  const isBase64 = /;base64/i.test(header);
  const mimeType = /^data:([^;,]+)/i.exec(header)?.[1] ?? expectedMimeType;
  if (!mimeType.startsWith('image/')) {
    throw new Error(`KDP export expected an image data URL, got ${mimeType}.`);
  }
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  if (typeof image.decode === 'function') {
    return image.decode().then(() => image);
  }
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('KDP image export could not decode a raster image.'));
  });
}

function positiveInteger(value: number | undefined): number | undefined {
  const numericValue = positiveNumber(value);
  return numericValue ? Math.max(1, Math.round(numericValue)) : undefined;
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
