import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { preflightBoundedZip } from './boundedZip';
import {
  buildPaperEpub,
  buildPaperEpubPlan,
  PAPER_EPUB_MIME_TYPE,
  PaperEpubExportError,
  validatePaperEpub,
  validatePaperEpubPlan,
} from './paperEpubExport';

const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
  0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00,
  0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function frame(kind: 'text' | 'caption' | 'image', id: string, xMm: number, yMm: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    label: `${kind}-${id}`,
    xMm,
    yMm,
    widthMm: 40,
    heightMm: 20,
    ...extra,
  } as Parameters<typeof addFrameToPaperPage>[2];
}

function sourceDocument() {
  let document = createDefaultPaperDocument({ title: 'A <Reflowable> story' });
  const pageId = document.pages[0]!.id;
  document = addFrameToPaperPage(document, pageId, frame('text', 'late', 12, 50, { text: 'Second paragraph' })).document;
  document = addFrameToPaperPage(document, pageId, frame('text', 'right', 90, 10, { text: 'Third in LTR' })).document;
  document = addFrameToPaperPage(document, pageId, frame('caption', 'left', 10, 10, { text: 'First <script>alert(1)</script>' })).document;
  return document;
}

describe('paperEpubExport', () => {
  it('creates a deterministic, reflowable EPUB 3 package with XHTML navigation and escaped Paper text', () => {
    const document = sourceDocument();
    const options = { language: 'fr_CA', createdAt: new Date('2026-08-26T00:00:00Z') };
    const plan = buildPaperEpubPlan(document, options);

    expect(plan.language).toBe('fr-ca');
    expect(plan.chapters[0]!.textBlocks.map((block) => block.frameId)).toEqual(['left', 'right', 'late']);
    expect(plan.chapters[0]!.requiresVisualFallback).toBe(false);

    const bytes = buildPaperEpub(document, options);
    const second = buildPaperEpub(document, options);
    expect([...second]).toEqual([...bytes]);

    const report = validatePaperEpub(bytes);
    expect(report.pass, report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')).toBe(true);
    expect(report).toMatchObject({ chapterCount: 1, language: 'fr-ca' });

    const archive = unzipSync(bytes);
    expect(strFromU8(archive.mimetype!)).toBe(PAPER_EPUB_MIME_TYPE);
    expect(strFromU8(archive['OEBPS/content.opf']!)).toContain('<meta property="rendition:layout">reflowable</meta>');
    const chapter = strFromU8(archive['OEBPS/text/page-001.xhtml']!);
    expect(chapter).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(chapter).not.toContain('<script>');

    const preflight = preflightBoundedZip(bytes, {
      archiveLabel: 'test EPUB', maxEntries: 20, maxEntryUncompressedBytes: 1024 * 1024, maxTotalUncompressedBytes: 4 * 1024 * 1024, maxCompressionRatio: 160,
    });
    expect(preflight.entries[0]).toMatchObject({ path: 'mimetype', compressionMethod: 0 });
  });

  it('requires a matching PNG or JPEG visual fallback instead of silently dropping complex Paper content', () => {
    let document = sourceDocument();
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('image', 'art', 10, 80)).document;
    const plan = buildPaperEpubPlan(document);

    expect(plan.chapters[0]).toMatchObject({ requiresVisualFallback: true, complexFrames: [expect.objectContaining({ frameId: 'art', kind: 'image' })] });
    expect(validatePaperEpubPlan(plan)).toContainEqual(expect.objectContaining({ id: 'missing-visual-fallback', frameId: 'art' }));
    expect(() => buildPaperEpub(document)).toThrow(PaperEpubExportError);

    const bytes = buildPaperEpub(document, {
      createdAt: new Date('2026-08-26T00:00:00Z'),
      visualFallbacks: [{ pageId, mimeType: 'image/png', bytes: PNG_1X1 }],
    });
    const archive = unzipSync(bytes);
    expect(archive['OEBPS/images/page-001.png']).toEqual(PNG_1X1);
    expect(strFromU8(archive['OEBPS/text/page-001.xhtml']!)).toContain('Visual layout fallback for original Paper page');
  });

  it('fails the structural gate when an XHTML visual fallback does not resolve to its packaged manifest asset', () => {
    let document = sourceDocument();
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('image', 'art', 10, 80)).document;
    const bytes = buildPaperEpub(document, {
      createdAt: new Date('2026-08-26T00:00:00Z'),
      visualFallbacks: [{ pageId, mimeType: 'image/png', bytes: PNG_1X1 }],
    });
    const archive = unzipSync(bytes);
    const corrupted = zipSync({
      mimetype: [archive.mimetype!, { level: 0 }],
      'META-INF/container.xml': archive['META-INF/container.xml']!,
      'OEBPS/content.opf': archive['OEBPS/content.opf']!,
      'OEBPS/nav.xhtml': archive['OEBPS/nav.xhtml']!,
      'OEBPS/styles/book.css': archive['OEBPS/styles/book.css']!,
      'OEBPS/text/page-001.xhtml': strToU8(strFromU8(archive['OEBPS/text/page-001.xhtml']!).replace('images/page-001.png', 'images/missing-page.png')),
      'OEBPS/images/page-001.png': archive['OEBPS/images/page-001.png']!,
    });

    const report = validatePaperEpub(corrupted);

    expect(report.pass).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'visual-fallbacks', pass: false }));
  });

  it('fails preflight for an invalid, duplicate, excess, or unneeded visual fallback', () => {
    const document = sourceDocument();
    const pageId = document.pages[0]!.id;
    const plan = buildPaperEpubPlan(document);
    const invalid = [{ pageId, mimeType: 'image/png' as const, bytes: new Uint8Array([1, 2, 3]) }];

    expect(validatePaperEpubPlan(plan, invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'invalid-fallback' }),
    ]));
    expect(() => buildPaperEpub(document, { visualFallbacks: invalid })).toThrow(PaperEpubExportError);
  });

  it('treats styled text geometry as visual-layout content requiring a fallback while retaining its reading text', () => {
    let document = createDefaultPaperDocument({ title: 'Styled text' });
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('text', 'curved', 10, 10, { text: 'Readable prose', textArcPercent: 22 })).document;
    const plan = buildPaperEpubPlan(document);

    expect(plan.chapters[0]!.textBlocks).toEqual([expect.objectContaining({ text: 'Readable prose' })]);
    expect(plan.chapters[0]!.complexFrames).toEqual([expect.objectContaining({ frameId: 'curved' })]);
    expect(validatePaperEpubPlan(plan)).toContainEqual(expect.objectContaining({ id: 'missing-visual-fallback', frameId: 'curved' }));
  });
});
