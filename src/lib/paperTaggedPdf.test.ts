import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString } from 'pdf-lib';
import { addFrameToPaperPage, createDefaultPaperDocument, parsePaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import {
  buildPaperTaggedPdf,
  buildPaperTaggedPdfPlan,
  PaperTaggedPdfPlanError,
  validatePaperTaggedPdf,
  validatePaperTaggedPdfPlan,
} from './paperTaggedPdf';

function frame(kind: 'text' | 'image' | 'caption', id: string, xMm: number, yMm: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind,
    xMm,
    yMm,
    widthMm: 30,
    heightMm: 16,
    ...extra,
  } as Parameters<typeof addFrameToPaperPage>[2];
}

describe('paperTaggedPdf', () => {
  it('maps Paper frames into deterministic geometric reading order with thread order taking precedence', () => {
    let document = createDefaultPaperDocument({ title: 'Accessible story' });
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('text', 'lower', 10, 50, { text: 'Second visually' })).document;
    document = addFrameToPaperPage(document, pageId, frame('text', 'upper-right', 70, 10, { text: 'Third in LTR' })).document;
    document = addFrameToPaperPage(document, pageId, frame('text', 'upper-left', 10, 10, { text: 'First in LTR' })).document;
    document = addFrameToPaperPage(document, pageId, frame('text', 'thread-late', 120, 100, { text: 'Thread later', threadId: 'story', threadOrder: 2 })).document;
    document = addFrameToPaperPage(document, pageId, frame('text', 'thread-early', 120, 120, { text: 'Thread early', threadId: 'story', threadOrder: 1 })).document;

    expect(buildPaperTaggedPdfPlan(document).pages[0]!.items.map((item) => item.frameId)).toEqual([
      'upper-left', 'upper-right', 'lower', 'thread-early', 'thread-late',
    ]);

    const rtl = updatePaperDocumentSetup(document, {});
    rtl.view = { ...rtl.view, rtlBinding: true };
    expect(buildPaperTaggedPdfPlan(rtl).pages[0]!.items.slice(0, 2).map((item) => item.frameId)).toEqual(['upper-right', 'upper-left']);
  });

  it('requires authored alternative text for visual frames and preserves it through Paper persistence', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('image', 'hero-image', 10, 10, { label: 'Image label is not alt text' })).document;
    const plan = buildPaperTaggedPdfPlan(document);
    expect(validatePaperTaggedPdfPlan(plan)).toContainEqual(expect.objectContaining({
      id: 'missing-alt-text',
      frameId: 'hero-image',
    }));

    // Reparse the actual document so legacy/corrupt language input is normalized and alt text is durable.
    const persisted = parsePaperDocument(JSON.stringify({
      ...document,
      accessibility: { language: 'fr_CA' },
      pages: document.pages.map((page) => ({
        ...page,
        frames: page.frames.map((candidate) => candidate.id === 'hero-image'
          ? { ...candidate, altText: '  A red kite over a river.  ' }
          : candidate),
      })),
    }));
    expect(persisted.accessibility.language).toBe('fr-ca');
    expect(buildPaperTaggedPdfPlan(persisted).pages[0]!.items.find((item) => item.frameId === 'hero-image')).toMatchObject({
      role: 'Figure', altText: 'A red kite over a river.',
    });
  });

  it('does not require alternative text for a non-printing visual layer that is absent from output', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    document = {
      ...document,
      layers: document.layers.map((layer) => ({ ...layer, printable: false })),
    };
    document = addFrameToPaperPage(document, pageId, frame('image', 'notes-only', 10, 10)).document;

    expect(buildPaperTaggedPdfPlan(document).pages[0]!.items).toEqual([]);
    expect(validatePaperTaggedPdfPlan(buildPaperTaggedPdfPlan(document))).toEqual([]);
  });

  it('normalizes programmatic alternative-text patches before persistence', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('image', 'bounded-alt', 10, 10)).document;
    document = updatePaperFrame(document, pageId, 'bounded-alt', { altText: `  ${'kite\n'.repeat(400)} ` });

    const saved = document.pages[0]!.frames.find((candidate) => candidate.id === 'bounded-alt')!;
    expect(saved.altText).toHaveLength(1000);
    expect(saved.altText).not.toContain('\n');
  });

  it('writes and verifies the marked structure tree, language, parent tree, and Figure alt text', async () => {
    let document = createDefaultPaperDocument({ title: 'Tagged PDF sample' });
    const pageId = document.pages[0]!.id;
    document = updatePaperDocumentSetup(document, { accessibility: { language: 'ja-JP' } });
    document = addFrameToPaperPage(document, pageId, frame('text', 'caption', 10, 10, { text: 'A short accessible caption.' })).document;
    document = addFrameToPaperPage(document, pageId, frame('image', 'art', 10, 32, { altText: 'A red kite over a river.' })).document;

    const bytes = await buildPaperTaggedPdf(document, { createdAt: new Date('2026-08-26T00:00:00Z') });
    const report = await validatePaperTaggedPdf(bytes);
    expect(report.pass, report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')).toBe(true);
    expect(report.language).toBe('ja-jp');
    expect(report.pageCount).toBe(1);
    expect(report.semanticItemCount).toBe(2);

    const second = await buildPaperTaggedPdf(document, { createdAt: new Date('2026-08-26T00:00:00Z') });
    expect([...second]).toEqual([...bytes]);
  });

  it('preserves CJK title, paragraph text, and Figure alternatives as UTF-16BE tagged semantics', async () => {
    const title = '赤い凧の物語';
    const paragraph = '赤い凧が川の上を舞う。 한강 위의 红色风筝。';
    const altText = '川の上を飛ぶ赤い凧と、遠くの山。 한강 위의 红色风筝。';
    let document = createDefaultPaperDocument({ title });
    const pageId = document.pages[0]!.id;
    document = updatePaperDocumentSetup(document, { accessibility: { language: 'ja-JP' } });
    document = addFrameToPaperPage(document, pageId, frame('text', 'cjk-caption', 10, 10, { text: paragraph })).document;
    document = addFrameToPaperPage(document, pageId, frame('image', 'cjk-art', 10, 32, { altText })).document;

    const bytes = await buildPaperTaggedPdf(document, { createdAt: new Date('2026-08-26T00:00:00Z') });
    const report = await validatePaperTaggedPdf(bytes);
    expect(report.pass, report.checks.filter((check) => !check.pass).map((check) => check.label).join('; ')).toBe(true);
    expect(report.checks.find((check) => check.id === 'paragraph-actual-text')?.pass).toBe(true);
    expect((await PDFDocument.load(bytes, { updateMetadata: false })).getTitle()).toBe(title);

    const source = new TextDecoder('latin1').decode(bytes);
    expect(source).toContain(`/ActualText ${PDFHexString.fromText(paragraph).toString()}`);
    expect(source).toContain(`/Alt ${PDFHexString.fromText(altText).toString()}`);
  });

  it('fails closed before writing bytes when a Figure lacks alternative text', async () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0]!.id;
    document = addFrameToPaperPage(document, pageId, frame('image', 'missing', 10, 10)).document;

    await expect(buildPaperTaggedPdf(document)).rejects.toBeInstanceOf(PaperTaggedPdfPlanError);
  });
});
