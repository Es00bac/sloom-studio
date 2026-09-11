import { describe, expect, it, vi } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { buildPaperPackageExport } from './paperPackageExport';
import {
  createPaperLinkedSourceIdentityGuard,
  createPaperPlacedDocumentRasterizationGuard,
  PaperLinkedSourceRevisionError,
} from './paperPlacedDocumentRasterization';

const PNG_V1_URL = 'data:image/png;base64,djE='; // "v1"
const PNG_V2_URL = 'data:image/png;base64,djI='; // "v2"
const PDF_URL = 'data:application/pdf;base64,JVBERg=='; // "%PDF"

function linkedImageItem(overrides: Partial<SourceBinLibraryItem> = {}): SourceBinLibraryItem {
  return {
    id: 'linked-art',
    label: 'Linked art',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: PNG_V1_URL,
    createdAt: 1,
    ...overrides,
  };
}

function unrelatedItem(overrides: Partial<SourceBinLibraryItem> = {}): SourceBinLibraryItem {
  return {
    id: 'unrelated-item',
    label: 'Unrelated art',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: 'data:image/png;base64,dW4=',
    createdAt: 1,
    ...overrides,
  };
}

function documentWithLinkedImage() {
  const base = createDefaultPaperDocument({ title: 'Package pinning' });
  return addFrameToPaperPage(base, base.pages[0].id, {
    kind: 'image', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
    asset: { sourceBinItemId: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png' },
  }).document;
}

describe('print package linked-source identity pinning', () => {
  it('pins frozen linked items, packages the pinned bytes, and blocks delivery when the linked item is replaced', async () => {
    const document = documentWithLinkedImage();
    const liveLinked = linkedImageItem();
    let items: readonly SourceBinLibraryItem[] = [liveLinked, unrelatedItem()];
    const guard = createPaperLinkedSourceIdentityGuard(document, () => items);

    expect(Object.isFrozen(guard.sourceItems)).toBe(true);
    expect(guard.sourceItems.map((item) => item.id)).toEqual(['linked-art']);
    expect(guard.sourceItems.every((item) => Object.isFrozen(item))).toBe(true);
    // Mutating the live caller object after pinning cannot tear pinned bytes/metadata.
    liveLinked.assetUrl = PNG_V2_URL;
    expect(guard.sourceItems[0].assetUrl).toBe(PNG_V1_URL);

    const pack = await buildPaperPackageExport(document, [...guard.sourceItems]);
    const linkedBinary = pack.manifest.packagedAssets.find((asset) => asset.role === 'linked-source');
    expect(linkedBinary).toMatchObject({ mimeType: 'image/png', byteLength: 2, label: 'Linked art' });
    expect(pack.manifest.unpackagedLinks).toEqual([]);

    // The linked item was replaced while the package was being prepared: assert before delivery.
    items = [linkedImageItem({ assetUrl: PNG_V2_URL, createdAt: 2 }), unrelatedItem()];
    const download = vi.fn();
    expect(() => {
      guard();
      download(pack);
    }).toThrowError(PaperLinkedSourceRevisionError);
    expect(download).not.toHaveBeenCalled();

    let revisionError: unknown;
    try {
      guard();
    } catch (error) {
      revisionError = error;
    }
    expect(revisionError).toMatchObject({
      code: 'paper-linked-source-revision-changed',
      changedSourceItemIds: ['linked-art'],
      message: expect.stringMatching(/changed while this output was being prepared/i),
    });
  });

  it('blocks delivery when a linked item is removed during preparation', async () => {
    const document = documentWithLinkedImage();
    let items: readonly SourceBinLibraryItem[] = [linkedImageItem()];
    const guard = createPaperLinkedSourceIdentityGuard(document, () => items);
    await buildPaperPackageExport(document, [...guard.sourceItems]);

    items = [];
    expect(() => guard()).toThrowError(PaperLinkedSourceRevisionError);
  });

  it('ignores unrelated Source Library changes at delivery time', async () => {
    const document = documentWithLinkedImage();
    let items: readonly SourceBinLibraryItem[] = [linkedImageItem(), unrelatedItem()];
    const guard = createPaperLinkedSourceIdentityGuard(document, () => items);
    const pack = await buildPaperPackageExport(document, [...guard.sourceItems]);

    items = [linkedImageItem(), unrelatedItem({ assetUrl: 'data:image/jpeg;base64,ZGlm', mimeType: 'image/jpeg', createdAt: 7 })];
    const download = vi.fn();
    guard();
    download(pack);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('accepts legitimate placed-PDF package content that the raster guard must reject', async () => {
    const base = createDefaultPaperDocument({ title: 'PDF package' });
    const document = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { sourceBinItemId: 'linked-pdf', label: 'Press insert', kind: 'document', mimeType: 'application/pdf' },
    }).document;
    const items: readonly SourceBinLibraryItem[] = [{
      id: 'linked-pdf',
      label: 'Press insert',
      kind: 'document',
      mimeType: 'application/pdf',
      assetUrl: PDF_URL,
      createdAt: 3,
    }];

    // Raster output must keep rejecting the placed PDF; the package guard must not.
    expect(() => createPaperPlacedDocumentRasterizationGuard(document, () => items))
      .toThrowError(/cannot rasterize/i);
    const guard = createPaperLinkedSourceIdentityGuard(document, () => items);
    const pack = await buildPaperPackageExport(document, [...guard.sourceItems]);
    guard();

    const pdfBinary = pack.manifest.packagedAssets.find((asset) => asset.role === 'linked-source');
    expect(pdfBinary).toMatchObject({ mimeType: 'application/pdf', byteLength: 4, label: 'Press insert' });
    expect(pack.manifest.unpackagedLinks).toEqual([]);
  });
});
