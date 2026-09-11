import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import { addFrameToPaperPage, createDefaultPaperDocument, exportPaperDocumentToPrintHtml } from './paperDocument';
import { buildPaperPlacedSourceItemMimeTypeLookup, classifyPaperPlacedPdf } from './paperPlacedPdf';

function placedFrame(overrides: Partial<Pick<PaperFrame, 'kind' | 'label' | 'asset'>> = {}): Pick<PaperFrame, 'kind' | 'label' | 'asset'> {
  return {
    kind: 'image',
    label: 'retained-reference.pdf',
    asset: {
      label: 'retained-reference.pdf',
      kind: 'image',
      mimeType: 'image/png',
      locator: { kind: 'external', url: 'data:image/png;base64,iVBORw0KGgo=' },
    },
    ...overrides,
  };
}

describe('placed Paper asset MIME precedence', () => {
  it.each([
    ['PNG', 'image/png', 'data:image/png;base64,iVBORw0KGgo='],
    ['SVG', 'image/svg+xml', 'data:image/svg+xml,%3Csvg/%3E'],
    ['JPEG', 'image/jpeg', 'data:image/jpeg;base64,/9j/4AAQ'],
  ] as const)('keeps a proven %s replacement on the image path despite a stale .pdf label', (_name, mimeType, url) => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      asset: { label: 'retained-reference.pdf', kind: 'image', mimeType, format: 'pdf', locator: { kind: 'external', url } },
    }));

    expect(classification).toMatchObject({ isPdf: false, isImage: true, blocksRasterization: false, mimeType });
  });

  it('takes a content-addressed image replacement over stale asset MIME, format, and filename metadata', () => {
    const sha256 = 'a'.repeat(64);
    const classification = classifyPaperPlacedPdf(placedFrame({
      asset: {
        label: 'old-placement.pdf', kind: 'image', mimeType: 'application/pdf', format: 'pdf',
        locator: { kind: 'managed', ref: { id: `sha256:${sha256}` as `sha256:${string}`, sha256, mimeType: 'image/png', byteLength: 3 } },
      },
    }));

    expect(classification).toMatchObject({ isPdf: false, isImage: true, blocksRasterization: false, mimeType: 'image/png' });
  });

  it.each([
    ['wrong extension', 'wrong-extension.png', 'application/pdf', 'https://example.test/file'],
    ['data URL', 'no-extension', 'application/x-pdf', 'data:application/x-pdf;base64,JVBERi0='],
    ['object URL', 'thumbnail.jpg', 'application/acrobat', 'blob:https://app.test/placed-pdf'],
  ] as const)('keeps a real PDF on the PDF path for %s', (_name, label, mimeType, url) => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label,
      asset: { label, kind: 'image', mimeType, locator: { kind: 'external', url } },
    }));

    expect(classification).toMatchObject({ isPdf: true, isImage: false, blocksRasterization: true, mimeType, canEmbedForLivePrint: true });
  });

  it('uses a bounded PDF-label fallback for missing MIME and keeps explicit incomplete PDF data definitive', () => {
    const missing = classifyPaperPlacedPdf(placedFrame({ asset: { label: 'missing.pdf', kind: 'image' } }));
    const malformed = classifyPaperPlacedPdf(placedFrame({
      label: 'malformed.pdf',
      asset: { label: 'malformed.pdf', kind: 'image', locator: { kind: 'external', url: 'data:application/pdf;base64' } },
    }));

    expect(missing).toMatchObject({ isPdf: true, blocksRasterization: true, canEmbedForLivePrint: false, mimeType: undefined });
    expect(malformed).toMatchObject({ isPdf: true, blocksRasterization: true, canEmbedForLivePrint: false, mimeType: 'application/pdf' });
  });

  it('does not let uppercase incomplete PDF data text fall through to older image metadata', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label: 'thumbnail.png',
      asset: {
        label: 'thumbnail.png', kind: 'image', mimeType: 'image/png',
        locator: { kind: 'external', url: 'DATA:APPLICATION/PDF;base64' },
      },
    }));

    expect(classification).toMatchObject({
      isPdf: true,
      isImage: false,
      blocksRasterization: true,
      mimeType: 'application/pdf',
      canEmbedForLivePrint: false,
    });
  });

  it('does not invent a PDF classification for an ambiguous non-PDF image URL', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label: 'mystery-image',
      asset: { label: 'mystery-image', kind: 'image', locator: { kind: 'external', url: 'blob:https://app.test/unknown' } },
    }));

    expect(classification).toMatchObject({ isPdf: false, isImage: false, blocksRasterization: false });
  });

  it('classifies an uppercase DATA: scheme PDF exactly like its lowercase form', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label: 'thumbnail.jpg',
      asset: { label: 'thumbnail.jpg', kind: 'image', locator: { kind: 'external', url: 'DATA:APPLICATION/X-PDF;base64,JVBERi0=' } },
    }));

    expect(classification).toMatchObject({ isPdf: true, isImage: false, blocksRasterization: true, mimeType: 'application/x-pdf', canEmbedForLivePrint: true });
  });

  it('keeps a mixed-case data: scheme image on the ordinary image path', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      asset: { label: 'retained-reference.pdf', kind: 'image', format: 'pdf', locator: { kind: 'external', url: 'Data:IMAGE/PNG;base64,iVBORw0KGgo=' } },
    }));

    expect(classification).toMatchObject({ isPdf: false, isImage: true, blocksRasterization: false, mimeType: 'image/png' });
  });

  it('chooses image versus PDF live-print elements by resolved MIME, not the retained filename', () => {
    const base = createDefaultPaperDocument({ title: 'MIME print elements' });
    const png = addFrameToPaperPage(base, base.pages[0].id, {
      id: 'replaced-image', kind: 'document', label: 'old-reference.pdf', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20,
      asset: { label: 'old-reference.pdf', kind: 'image', mimeType: 'image/png', format: 'pdf', locator: { kind: 'external', url: 'data:image/png;base64,iVBORw0KGgo=' } },
    });
    const pdf = addFrameToPaperPage(png.document, png.document.pages[0].id, {
      id: 'real-pdf', kind: 'image', label: 'cover.jpg', xMm: 50, yMm: 10, widthMm: 30, heightMm: 20,
      asset: { label: 'cover.jpg', kind: 'image', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    });
    const html = exportPaperDocumentToPrintHtml(pdf.document);

    expect(html).toContain('<img alt="old-reference.pdf" src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain('<object data="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('<object data="data:application/pdf;base64,JVBERi0=" type="application/pdf"');
  });
});

describe('current linked Source Library item authority', () => {
  const resolveSourceItemMimeType = buildPaperPlacedSourceItemMimeTypeLookup([
    { id: 'replaced-with-pdf', mimeType: 'application/pdf', assetUrl: 'blob:https://app.test/current-pdf' },
    { id: 'replaced-with-image', mimeType: 'image/png', assetUrl: 'blob:https://app.test/current-image' },
    { id: 'uppercase-data', assetUrl: 'DATA:APPLICATION/PDF;base64,JVBERi0=' },
    { id: 'undetermined', mimeType: 'application/octet-stream', assetUrl: 'blob:https://app.test/opaque' },
  ]);

  it('blocks a current PDF source even when persisted frame metadata still claims an image', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label: 'panel-art.png',
      asset: {
        sourceBinItemId: 'replaced-with-pdf', label: 'panel-art.png', kind: 'image', mimeType: 'image/png',
        locator: { kind: 'external', url: 'data:image/png;base64,iVBORw0KGgo=' },
      },
    }), { resolveSourceItemMimeType });

    expect(classification).toMatchObject({ isPdf: true, isImage: false, blocksRasterization: true, mimeType: 'application/pdf' });
  });

  it('keeps a current image source on the image path even when persisted frame metadata claims a PDF', () => {
    const classification = classifyPaperPlacedPdf(placedFrame({
      label: 'reference.pdf',
      asset: {
        sourceBinItemId: 'replaced-with-image', label: 'reference.pdf', kind: 'document', mimeType: 'application/pdf',
        locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' },
      },
    }), { resolveSourceItemMimeType });

    expect(classification).toMatchObject({ isPdf: false, isImage: true, blocksRasterization: false, mimeType: 'image/png' });
  });

  it('resolves the current item media type from an uppercase data-URL payload header', () => {
    expect(resolveSourceItemMimeType('uppercase-data')).toBe('application/pdf');
  });

  it('falls back to persisted metadata when the link is dangling or the current type is undetermined', () => {
    expect(resolveSourceItemMimeType('missing-item')).toBeUndefined();
    expect(resolveSourceItemMimeType('undetermined')).toBeUndefined();

    const classification = classifyPaperPlacedPdf(placedFrame({
      asset: {
        sourceBinItemId: 'missing-item', label: 'kept.pdf', kind: 'document', mimeType: 'application/pdf',
        locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' },
      },
    }), { resolveSourceItemMimeType });

    expect(classification).toMatchObject({ isPdf: true, blocksRasterization: true, mimeType: 'application/pdf' });
  });
});
