/**
 * Bounded EPUB 3 export for Paper.
 *
 * The package deliberately creates a reflowable reading edition, not a second fixed-layout
 * renderer. Printable text frames become ordered plain-text chapters. Pages containing visual
 * or layout-heavy frames must carry an authored raster fallback supplied by the delivery path,
 * so the exporter never silently drops artwork, panels, shapes, rotation, columns, or rich text
 * styling while claiming layout fidelity.
 */

import { strFromU8, strToU8, zipSync, type Zippable, type ZippableFile } from 'fflate';
import type { PaperDocument, PaperFrame, PaperPage } from '../types/paper';
import { effectiveRtlBinding, resolvePaperPageFramesForOutput } from './paperDocument';
import { preflightBoundedZip, unzipBoundedZipSync } from './boundedZip';

export const PAPER_EPUB_MIME_TYPE = 'application/epub+zip';
export const PAPER_EPUB_MAX_PAGES = 50;
export const PAPER_EPUB_MAX_TEXT_CHARACTERS = 500_000;
export const PAPER_EPUB_MAX_FALLBACK_BYTES = 24 * 1024 * 1024;
export const PAPER_EPUB_MAX_FALLBACK_BYTES_PER_PAGE = 4 * 1024 * 1024;
export const PAPER_EPUB_MAX_FALLBACK_PIXELS = 24_000_000;

const EPUB_ARCHIVE_LIMITS = {
  archiveLabel: 'Paper EPUB',
  maxEntries: 2 + (PAPER_EPUB_MAX_PAGES * 2) + 3,
  maxEntryUncompressedBytes: PAPER_EPUB_MAX_FALLBACK_BYTES_PER_PAGE,
  maxTotalUncompressedBytes: PAPER_EPUB_MAX_FALLBACK_BYTES + (PAPER_EPUB_MAX_TEXT_CHARACTERS * 2),
  maxCompressionRatio: 160,
} as const;

const TEXT_FRAME_KINDS = new Set<PaperFrame['kind']>(['text', 'caption', 'speechBubble', 'thoughtBubble']);

export type PaperEpubBlockKind = 'paragraph' | 'caption' | 'speech' | 'thought';

export interface PaperEpubTextBlock {
  frameId: string;
  kind: PaperEpubBlockKind;
  text: string;
}

export interface PaperEpubComplexFrame {
  frameId: string;
  kind: PaperFrame['kind'];
  label: string;
}

export interface PaperEpubChapterPlan {
  pageId: string;
  pageNumber: number;
  href: string;
  id: string;
  title: string;
  textBlocks: PaperEpubTextBlock[];
  complexFrames: PaperEpubComplexFrame[];
  /** A page image is required precisely when reflow loses visual/layout information. */
  requiresVisualFallback: boolean;
}

export interface PaperEpubPlan {
  title: string;
  language: string;
  identifier: string;
  modifiedAt: string;
  chapters: PaperEpubChapterPlan[];
}

export interface PaperEpubVisualFallback {
  pageId: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}

export interface BuildPaperEpubOptions {
  /** Defaults to English because the pre-MH-098 Paper document model has no durable publication-language field. */
  language?: string;
  /** Makes package bytes reproducible for a fixed Paper snapshot. */
  createdAt?: Date;
  /** Required for every chapter whose printable page contains visual or layout-heavy content. */
  visualFallbacks?: readonly PaperEpubVisualFallback[];
}

export interface PaperEpubPlanIssue {
  id: 'page-limit' | 'text-limit' | 'missing-visual-fallback' | 'fallback-limit' | 'raster-limit' | 'invalid-fallback';
  detail: string;
  pageId?: string;
  frameId?: string;
}

export class PaperEpubExportError extends Error {
  readonly issues: readonly PaperEpubPlanIssue[];

  constructor(issues: readonly PaperEpubPlanIssue[]) {
    super(issues.map((issue) => issue.detail).join(' '));
    this.name = 'PaperEpubExportError';
    this.issues = issues;
  }
}

export interface PaperEpubCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface PaperEpubValidationReport {
  pass: boolean;
  title?: string;
  language?: string;
  chapterCount: number;
  checks: PaperEpubCheck[];
}

function normalizeLanguage(value: string | undefined): string {
  const language = value?.trim().replace(/_/g, '-').toLowerCase() ?? '';
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language) && language.length <= 35 ? language : 'en';
}

function epubDate(document: PaperDocument, value?: Date): Date {
  const candidate = value ?? new Date(document.updatedAt);
  const time = candidate.getTime();
  if (!Number.isFinite(time)) return new Date('1980-01-01T00:00:00Z');
  // ZIP's DOS timestamp cannot encode dates outside this interval. Keep the package deterministic
  // instead of allowing an anomalous clock or imported timestamp to make fflate throw late.
  const floor = Date.UTC(1980, 0, 1);
  const ceiling = Date.UTC(2099, 11, 31, 23, 59, 58);
  return new Date(Math.min(ceiling, Math.max(floor, time)));
}

function formatModifiedAt(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function stableHash(value: string): string {
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

function stableIdentifier(document: PaperDocument, title: string): string {
  const hash = stableHash(`${document.id}\u0000${title}`).slice(0, 32);
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function isTextFrame(frame: PaperFrame): boolean {
  return TEXT_FRAME_KINDS.has(frame.kind) && Boolean(frame.text?.trim());
}

function isLayoutHeavyTextFrame(frame: PaperFrame): boolean {
  return Boolean(
    frame.richText?.length
    || frame.columns > 1
    || Math.abs(frame.rotationDeg) > 0.001
    || Math.abs(frame.textRotationDeg) > 0.001
    || Math.abs(frame.textSkewXDeg ?? 0) > 0.001
    || Math.abs(frame.textSkewYDeg ?? 0) > 0.001
    || Math.abs((frame.textScaleX ?? 1) - 1) > 0.001
    || Math.abs((frame.textScaleY ?? 1) - 1) > 0.001
    || Math.abs(frame.textArcPercent ?? 0) > 0.001,
  );
}

function orderedOutputFrames(document: PaperDocument, page: PaperPage): PaperFrame[] {
  const rtl = effectiveRtlBinding(document);
  return resolvePaperPageFramesForOutput(document, page)
    .sort((left, right) => {
      // Text threads have an authored logical order which is stronger than their page geometry.
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

function blockKind(frame: PaperFrame): PaperEpubBlockKind {
  switch (frame.kind) {
    case 'caption': return 'caption';
    case 'speechBubble': return 'speech';
    case 'thoughtBubble': return 'thought';
    default: return 'paragraph';
  }
}

/** Creates the deterministic reflow plan before a ZIP or browser rasterizer is involved. */
export function buildPaperEpubPlan(document: PaperDocument, options: Pick<BuildPaperEpubOptions, 'language' | 'createdAt'> = {}): PaperEpubPlan {
  const title = document.title.trim() || 'Untitled Paper document';
  const date = epubDate(document, options.createdAt);
  return {
    title,
    language: normalizeLanguage(options.language),
    identifier: stableIdentifier(document, title),
    modifiedAt: formatModifiedAt(date),
    chapters: document.pages.map((page, index) => {
      const textBlocks: PaperEpubTextBlock[] = [];
      const complexFrames: PaperEpubComplexFrame[] = [];
      for (const frame of orderedOutputFrames(document, page)) {
        if (isTextFrame(frame)) {
          textBlocks.push({ frameId: frame.id, kind: blockKind(frame), text: frame.text!.trim() });
          if (isLayoutHeavyTextFrame(frame)) {
            complexFrames.push({ frameId: frame.id, kind: frame.kind, label: frame.label || 'Styled text frame' });
          }
          continue;
        }
        complexFrames.push({ frameId: frame.id, kind: frame.kind, label: frame.label || `${frame.kind} frame` });
      }
      const ordinal = String(index + 1).padStart(3, '0');
      return {
        pageId: page.id,
        pageNumber: page.pageNumber,
        href: `text/page-${ordinal}.xhtml`,
        id: `chapter-${ordinal}`,
        title: `Page ${page.pageNumber}`,
        textBlocks,
        complexFrames,
        requiresVisualFallback: complexFrames.length > 0,
      };
    }),
  };
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}

function fallbackIsValid(fallback: PaperEpubVisualFallback): boolean {
  return fallback.mimeType === 'image/png' ? isPng(fallback.bytes) : isJpeg(fallback.bytes);
}

/** Returns actionable preflight issues; a visual fallback is mandatory when reflow is lossy. */
export function validatePaperEpubPlan(
  plan: PaperEpubPlan,
  visualFallbacks: readonly PaperEpubVisualFallback[] = [],
): PaperEpubPlanIssue[] {
  const issues: PaperEpubPlanIssue[] = [];
  if (plan.chapters.length > PAPER_EPUB_MAX_PAGES) {
    issues.push({
      id: 'page-limit',
      detail: `EPUB export is limited to ${PAPER_EPUB_MAX_PAGES} pages; this document has ${plan.chapters.length}.`,
    });
  }
  const textCharacters = plan.chapters.reduce((total, chapter) => total + chapter.textBlocks.reduce((count, block) => count + block.text.length, 0), 0);
  if (textCharacters > PAPER_EPUB_MAX_TEXT_CHARACTERS) {
    issues.push({ id: 'text-limit', detail: 'EPUB export exceeds the bounded reflowable-text limit.' });
  }

  const fallbacksByPage = new Map<string, PaperEpubVisualFallback>();
  for (const fallback of visualFallbacks) {
    if (fallbacksByPage.has(fallback.pageId)) {
      issues.push({ id: 'invalid-fallback', pageId: fallback.pageId, detail: `EPUB export received more than one visual fallback for page ${fallback.pageId}.` });
    }
    fallbacksByPage.set(fallback.pageId, fallback);
  }
  let fallbackBytes = 0;
  for (const fallback of visualFallbacks) {
    fallbackBytes += fallback.bytes.byteLength;
    if (fallback.bytes.byteLength === 0 || fallback.bytes.byteLength > PAPER_EPUB_MAX_FALLBACK_BYTES_PER_PAGE) {
      issues.push({ id: 'fallback-limit', pageId: fallback.pageId, detail: `EPUB visual fallback for page ${fallback.pageId} exceeds the per-page byte limit.` });
    }
    if (!fallbackIsValid(fallback)) {
      issues.push({ id: 'invalid-fallback', pageId: fallback.pageId, detail: `EPUB visual fallback for page ${fallback.pageId} does not match its declared image type.` });
    }
  }
  if (fallbackBytes > PAPER_EPUB_MAX_FALLBACK_BYTES) {
    issues.push({ id: 'fallback-limit', detail: 'EPUB visual fallbacks exceed the bounded aggregate byte limit.' });
  }
  const chapterByPage = new Map(plan.chapters.map((chapter) => [chapter.pageId, chapter]));
  for (const fallback of visualFallbacks) {
    const chapter = chapterByPage.get(fallback.pageId);
    if (!chapter || !chapter.requiresVisualFallback) {
      issues.push({ id: 'invalid-fallback', pageId: fallback.pageId, detail: `EPUB visual fallback for page ${fallback.pageId} is not required by this reflow plan.` });
    }
  }
  for (const chapter of plan.chapters) {
    if (chapter.requiresVisualFallback && !fallbacksByPage.has(chapter.pageId)) {
      const first = chapter.complexFrames[0];
      issues.push({
        id: 'missing-visual-fallback',
        pageId: chapter.pageId,
        frameId: first?.frameId,
        detail: `Page ${chapter.pageNumber} contains ${first?.kind ?? 'layout'} content and needs a visual fallback before EPUB export.`,
      });
    }
  }
  return issues;
}

/**
 * The browser delivery path performs this check before asking Canvas to rasterize any fallback.
 * Only layout-heavy chapters need a page image, so ordinary text-only books do not pay the raster budget.
 */
export function validatePaperEpubRasterization(
  document: PaperDocument,
  plan: PaperEpubPlan = buildPaperEpubPlan(document),
  outputDpi = 96,
): PaperEpubPlanIssue[] {
  const dpi = Math.max(36, Math.min(144, Math.round(outputDpi)));
  const fallbackPageCount = plan.chapters.filter((chapter) => chapter.requiresVisualFallback).length;
  const widthPx = Math.ceil((document.page.widthMm / 25.4) * dpi);
  const heightPx = Math.ceil((document.page.heightMm / 25.4) * dpi);
  const pixels = widthPx * heightPx * fallbackPageCount;
  if (!Number.isFinite(pixels) || pixels > PAPER_EPUB_MAX_FALLBACK_PIXELS) {
    return [{
      id: 'raster-limit',
      detail: `EPUB visual fallbacks are limited to ${PAPER_EPUB_MAX_FALLBACK_PIXELS.toLocaleString()} raster pixels; lower the document size, simplify visual pages, or split the book.`,
    }];
  }
  return [];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));
}

function textBlockXhtml(block: PaperEpubTextBlock): string {
  const text = escapeXml(block.text).replace(/\r?\n/g, '<br />');
  if (block.kind === 'caption') return `      <p class="caption">${text}</p>`;
  if (block.kind === 'speech') return `      <blockquote class="speech">${text}</blockquote>`;
  if (block.kind === 'thought') return `      <blockquote class="thought">${text}</blockquote>`;
  return `      <p>${text}</p>`;
}

function fallbackPath(chapter: PaperEpubChapterPlan, fallback: PaperEpubVisualFallback): string {
  const ordinal = chapter.id.slice(-3);
  return `images/page-${ordinal}.${fallback.mimeType === 'image/png' ? 'png' : 'jpg'}`;
}

function chapterXhtml(chapter: PaperEpubChapterPlan, language: string, fallback?: PaperEpubVisualFallback): string {
  const body = chapter.textBlocks.length > 0
    ? chapter.textBlocks.map(textBlockXhtml).join('\n')
    : '      <p class="empty-page">This Paper page contains no printable text.</p>';
  const visual = fallback
    ? `\n      <figure class="layout-fallback">\n        <img src="../${fallbackPath(chapter, fallback)}" alt="Visual layout fallback for original page ${chapter.pageNumber}" />\n        <figcaption>Visual layout fallback for original Paper page ${chapter.pageNumber}; the reflowable text above is the reading edition.</figcaption>\n      </figure>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}" lang="${language}" xmlns:epub="http://www.idpf.org/2007/ops">\n  <head>\n    <title>${escapeXml(chapter.title)}</title>\n    <link rel="stylesheet" type="text/css" href="../styles/book.css" />\n  </head>\n  <body>\n    <section epub:type="bodymatter">\n      <h1>${escapeXml(chapter.title)}</h1>\n${body}${visual}\n    </section>\n  </body>\n</html>\n`;
}

function navXhtml(plan: PaperEpubPlan): string {
  const entries = plan.chapters.map((chapter) => `        <li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${plan.language}" lang="${plan.language}" xmlns:epub="http://www.idpf.org/2007/ops">\n  <head><title>${escapeXml(plan.title)} contents</title></head>\n  <body>\n    <nav epub:type="toc" id="toc">\n      <h1>Contents</h1>\n      <ol>\n${entries}\n      </ol>\n    </nav>\n  </body>\n</html>\n`;
}

function contentOpf(plan: PaperEpubPlan, fallbacks: ReadonlyMap<string, PaperEpubVisualFallback>): string {
  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
    '    <item id="style" href="styles/book.css" media-type="text/css" />',
    ...plan.chapters.map((chapter) => `    <item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml" />`),
    ...plan.chapters.flatMap((chapter) => {
      const fallback = fallbacks.get(chapter.pageId);
      return fallback ? [`    <item id="fallback-${chapter.id}" href="${fallbackPath(chapter, fallback)}" media-type="${fallback.mimeType}" />`] : [];
    }),
  ].join('\n');
  const spine = plan.chapters.map((chapter) => `    <itemref idref="${chapter.id}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${plan.language}">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n    <dc:identifier id="pub-id">${escapeXml(plan.identifier)}</dc:identifier>\n    <dc:title>${escapeXml(plan.title)}</dc:title>\n    <dc:language>${plan.language}</dc:language>\n    <meta property="dcterms:modified">${plan.modifiedAt}</meta>\n    <meta property="rendition:layout">reflowable</meta>\n  </metadata>\n  <manifest>\n${manifest}\n  </manifest>\n  <spine>\n${spine}\n  </spine>\n</package>\n`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>\n`;

const BOOK_CSS = `html { color-scheme: light dark; }\nbody { font-family: serif; line-height: 1.55; margin: 5%; }\nh1 { font-size: 1.4em; }\n.caption, figcaption { font-size: .9em; color: #555; }\nblockquote { margin: 1em 1.5em; }\n.thought { font-style: italic; }\n.layout-fallback img { display: block; height: auto; max-width: 100%; }\n.empty-page { font-style: italic; }\n`;

/**
 * Builds and immediately validates a deterministic EPUB 3 archive. The caller must supply
 * fallback images for layout-heavy pages; no delivery can occur after a failed structural gate.
 */
export function buildPaperEpub(document: PaperDocument, options: BuildPaperEpubOptions = {}): Uint8Array {
  const plan = buildPaperEpubPlan(document, options);
  const fallbacks = options.visualFallbacks ?? [];
  const issues = validatePaperEpubPlan(plan, fallbacks);
  if (issues.length > 0) throw new PaperEpubExportError(issues);

  const date = epubDate(document, options.createdAt);
  const perFile = { mtime: date, level: 6 } as const;
  const fallbackByPage = new Map(fallbacks.map((fallback) => [fallback.pageId, fallback]));
  // Insertion order matters: EPUB readers require the uncompressed mimetype member to be first.
  const entries: Zippable = {
    mimetype: [strToU8(PAPER_EPUB_MIME_TYPE), { mtime: date, level: 0 }],
    'META-INF/container.xml': [strToU8(CONTAINER_XML), perFile],
    'OEBPS/content.opf': [strToU8(contentOpf(plan, fallbackByPage)), perFile],
    'OEBPS/nav.xhtml': [strToU8(navXhtml(plan)), perFile],
    'OEBPS/styles/book.css': [strToU8(BOOK_CSS), perFile],
  };
  for (const chapter of plan.chapters) {
    const fallback = fallbackByPage.get(chapter.pageId);
    entries[`OEBPS/${chapter.href}`] = [strToU8(chapterXhtml(chapter, plan.language, fallback)), perFile];
    if (fallback) entries[`OEBPS/${fallbackPath(chapter, fallback)}`] = [fallback.bytes, perFile] satisfies ZippableFile;
  }
  const bytes = zipSync(entries, perFile);
  const report = validatePaperEpub(bytes);
  if (!report.pass) {
    throw new PaperEpubExportError([{ id: 'invalid-fallback', detail: `EPUB structural validation failed: ${report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')}.` }]);
  }
  return bytes;
}

function hasAll(entries: Record<string, Uint8Array>, paths: readonly string[]): boolean {
  return paths.every((path) => entries[path] instanceof Uint8Array);
}

function extractMetadata(opf: string): { title?: string; language?: string } {
  const title = /<dc:title>([^<]*)<\/dc:title>/i.exec(opf)?.[1];
  const language = /<dc:language>([^<]*)<\/dc:language>/i.exec(opf)?.[1];
  return { title, language };
}

interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

function xmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([\w:-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]!] = match[2] ?? match[3] ?? '';
  }
  return attributes;
}

function manifestItems(opf: string): EpubManifestItem[] {
  return [...opf.matchAll(/<item\b[^>]*>/gi)].flatMap((match) => {
    const attributes = xmlAttributes(match[0]);
    if (!attributes.id || !attributes.href || !attributes['media-type']) return [];
    return [{
      id: attributes.id,
      href: attributes.href,
      mediaType: attributes['media-type'],
      properties: attributes.properties ?? '',
    }];
  });
}

function exactlyOnce(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return exactlyOnce(left)
    && exactlyOnce(right)
    && left.length === right.length
    && left.every((value) => right.includes(value));
}

function chapterImageTags(chapter: string): Array<Record<string, string>> {
  return [...chapter.matchAll(/<img\b[^>]*>/gi)].map((match) => xmlAttributes(match[0]));
}

function expectedImageMimeType(path: string): 'image/png' | 'image/jpeg' | undefined {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  return undefined;
}

/** Verifies the EPUB packaging invariants used as the local delivery gate. */
export function validatePaperEpub(bytes: Uint8Array): PaperEpubValidationReport {
  const checks: PaperEpubCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail?: string) => checks.push({ id, label, pass, detail });
  let archive: Record<string, Uint8Array> | undefined;
  let preflight: ReturnType<typeof preflightBoundedZip> | undefined;
  try {
    preflight = preflightBoundedZip(bytes, EPUB_ARCHIVE_LIMITS);
    archive = unzipBoundedZipSync(bytes, EPUB_ARCHIVE_LIMITS);
    add('archive', 'Archive passes bounded ZIP validation', true);
  } catch (error) {
    add('archive', 'Archive passes bounded ZIP validation', false, error instanceof Error ? error.message : 'Unknown ZIP error');
  }
  if (!archive || !preflight) {
    return { pass: false, chapterCount: 0, checks };
  }

  const mimetype = archive.mimetype ? strFromU8(archive.mimetype) : '';
  const firstMember = preflight.entries[0];
  add('mimetype', 'Uncompressed mimetype is the first EPUB member', mimetype === PAPER_EPUB_MIME_TYPE && firstMember?.path === 'mimetype' && firstMember.compressionMethod === 0);
  add('container', 'Container resolves the OEBPS package document', hasAll(archive, ['META-INF/container.xml']) && strFromU8(archive['META-INF/container.xml']!).includes('OEBPS/content.opf'));

  const opf = archive['OEBPS/content.opf'] ? strFromU8(archive['OEBPS/content.opf']!) : '';
  const nav = archive['OEBPS/nav.xhtml'] ? strFromU8(archive['OEBPS/nav.xhtml']!) : '';
  const metadata = extractMetadata(opf);
  const chapterPaths = Object.keys(archive).filter((path) => /^OEBPS\/text\/page-\d{3}\.xhtml$/.test(path)).sort();
  const manifest = manifestItems(opf);
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const chapterManifest = manifest.filter((item) => /^text\/page-\d{3}\.xhtml$/i.test(item.href));
  const manifestHrefs = chapterManifest.map((item) => item.href).sort();
  const spineIds = [...opf.matchAll(/<itemref\b[^>]*\bidref=(?:"([^"]*)"|'([^']*)')[^>]*\/?>(?:<\/itemref>)?/gi)].map((match) => match[1] ?? match[2] ?? '');
  const spineHrefs = spineIds.map((id) => manifestById.get(id)?.href ?? '');
  const navHrefs = [...nav.matchAll(/href="(text\/page-\d{3}\.xhtml)"/g)].map((match) => match[1]!);
  const navManifest = manifest.find((item) => item.href === 'nav.xhtml');
  add('package', 'OPF declares an EPUB 3 reflowable package and metadata', /<package\b[^>]*version="3\.0"/i.test(opf) && /<meta property="rendition:layout">reflowable<\/meta>/i.test(opf) && Boolean(metadata.title) && Boolean(metadata.language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(metadata.language)));
  add('navigation', 'Navigation document has a table of contents for every chapter', Boolean(navManifest && navManifest.mediaType === 'application/xhtml+xml' && /(?:^|\s)nav(?:\s|$)/.test(navManifest.properties)) && /epub:type="toc"/i.test(nav) && sameValues(navHrefs, chapterPaths.map((path) => path.slice('OEBPS/'.length))) && navHrefs.every((href) => archive?.[`OEBPS/${href}`]));
  add('spine', 'OPF manifest and spine reference every chapter exactly once', chapterPaths.length > 0 && chapterManifest.every((item) => item.mediaType === 'application/xhtml+xml') && sameValues(manifestHrefs, chapterPaths.map((path) => path.slice('OEBPS/'.length))) && sameValues(spineHrefs, manifestHrefs));
  add('xhtml', 'Every chapter is XHTML with a reflowable body', chapterPaths.every((path) => {
    const chapter = strFromU8(archive![path]!);
    return /<html\b[^>]*xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/i.test(chapter)
      && /<body>/i.test(chapter)
      && /<section\b/i.test(chapter)
      && new RegExp(`\\b(?:xml:lang|lang)="${metadata.language ?? ''}"`, 'i').test(chapter);
  }));
  const visualPaths = Object.keys(archive).filter((path) => /^OEBPS\/images\/[^/]+\.(?:png|jpe?g)$/i.test(path)).sort();
  const manifestVisualPaths = manifest
    .filter((item) => /^images\/[^/]+\.(?:png|jpe?g)$/i.test(item.href))
    .map((item) => item.href)
    .sort();
  const referencedVisualPaths: string[] = [];
  let allFallbackImagesLabeled = true;
  for (const chapterPath of chapterPaths) {
    for (const image of chapterImageTags(strFromU8(archive[chapterPath]!))) {
      const href = image.src?.replace(/^\.\.\//, '');
      if (href && /^images\/[^/]+\.(?:png|jpe?g)$/i.test(href)) referencedVisualPaths.push(href);
      if (href && /^images\//i.test(href) && !image.alt?.trim()) allFallbackImagesLabeled = false;
    }
  }
  add('visual-fallbacks', 'Visual fallbacks are packaged, manifest-referenced, and labelled', sameValues(visualPaths.map((path) => path.slice('OEBPS/'.length)), manifestVisualPaths) && sameValues(manifestVisualPaths, referencedVisualPaths.sort()) && allFallbackImagesLabeled && manifest.filter((item) => /^images\//i.test(item.href)).every((item) => expectedImageMimeType(item.href) === item.mediaType));

  return {
    pass: checks.every((check) => check.pass),
    title: metadata.title,
    language: metadata.language,
    chapterCount: chapterPaths.length,
    checks,
  };
}

export function summarizePaperEpubReport(report: PaperEpubValidationReport): string {
  return report.pass
    ? `EPUB structural checks passed (${report.chapterCount} reflowable chapters, ${report.language ?? 'language missing'}).`
    : `EPUB structural checks failed: ${report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')}.`;
}
