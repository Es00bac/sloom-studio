import { describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { addFrameToPaperPage, addFrameToPaperParentPage, assignPaperParentPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { addPaperLayer, updatePaperLayer } from '../../../lib/paperLayers';
import { collectReachablePaperAssetIds } from './PaperDocumentAssets';
import { materializePaperDocumentAssetUrls, paperAssetRepository } from './PaperAssetRuntime';

describe('materializePaperDocumentAssetUrls', () => {
  it.each([
    ['hidden', { visible: false, printable: true }],
    ['non-printing', { visible: true, printable: false }],
  ] as const)('does not demand a missing managed asset from a %s layer while project reachability retains it', async (_label, layerState) => {
    const missing = await createBinaryAssetRecord(new Uint8Array([201, 202, 203]), { mimeType: 'image/png' });
    let document = createDefaultPaperDocument({ title: 'Excluded output asset' });
    const addedLayer = addPaperLayer(document, 'Output-excluded');
    document = updatePaperLayer(addedLayer.document, addedLayer.layerId!, layerState);
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image',
      layerId: addedLayer.layerId,
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Unavailable retained art',
        kind: 'image',
        locator: { kind: 'managed', ref: missing.ref },
      },
    }).document;

    const output = await materializePaperDocumentAssetUrls(document);

    expect(output.pages[0].frames[0].asset?.locator).toEqual({ kind: 'managed', ref: missing.ref });
    expect(collectReachablePaperAssetIds(document)).toContain(missing.ref.id);
  });

  it('turns a managed record into an export-only data URL without mutating the Paper document', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });
    await paperAssetRepository.put(record);
    const base = createDefaultPaperDocument({ title: 'Managed export asset' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Managed art',
        kind: 'image',
        locator: { kind: 'managed', ref: record.ref },
      },
    });

    const output = await materializePaperDocumentAssetUrls(document);
    const originalAsset = document.pages[0].frames[0].asset;
    const outputAsset = output.pages[0].frames[0].asset;

    expect(originalAsset?.locator).toEqual({ kind: 'managed', ref: record.ref });
    expect(outputAsset?.locator).toEqual({
      kind: 'external',
      url: 'data:image/png;base64,AQID',
    });

    await paperAssetRepository.delete(record.ref.id);
  });

  it('materializes a source-bin link only in the export copy', async () => {
    const base = createDefaultPaperDocument({ title: 'Source export asset' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: { sourceBinItemId: 'source-1', label: 'Source art', kind: 'image' },
    });

    const output = await materializePaperDocumentAssetUrls(document, [
      { id: 'source-1', assetUrl: 'data:image/png;base64,BAUG' },
    ]);

    expect(document.pages[0].frames[0].asset?.locator).toBeUndefined();
    expect(output.pages[0].frames[0].asset?.locator).toEqual({
      kind: 'external',
      url: 'data:image/png;base64,BAUG',
    });
  });

  it('adopts the current source item media type with its URL when the persisted frame MIME is stale', async () => {
    const base = createDefaultPaperDocument({ title: 'Replaced source media type' });
    const withStaleImage = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30,
      asset: { sourceBinItemId: 'now-pdf', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const { document } = addFrameToPaperPage(withStaleImage, withStaleImage.pages[0].id, {
      kind: 'document', xMm: 60, yMm: 10, widthMm: 40, heightMm: 30,
      asset: { sourceBinItemId: 'now-image', label: 'reference.pdf', kind: 'document', mimeType: 'application/pdf' },
    });

    const output = await materializePaperDocumentAssetUrls(document, [
      { id: 'now-pdf', assetUrl: 'blob:https://app.test/now-pdf', mimeType: 'application/pdf' },
      { id: 'now-image', assetUrl: 'blob:https://app.test/now-image', mimeType: 'image/jpeg' },
    ]);

    const [staleImageFrame, stalePdfFrame] = output.pages[0].frames;
    expect(staleImageFrame.asset).toMatchObject({
      mimeType: 'application/pdf',
      locator: { kind: 'external', url: 'blob:https://app.test/now-pdf' },
    });
    expect(stalePdfFrame.asset).toMatchObject({
      mimeType: 'image/jpeg',
      locator: { kind: 'external', url: 'blob:https://app.test/now-image' },
    });
    expect(document.pages[0].frames[0].asset?.mimeType).toBe('image/png');
    expect(document.pages[0].frames[1].asset?.mimeType).toBe('application/pdf');
  });

  it('materializes managed art on parent pages for inherited output', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([10, 11, 12]), { mimeType: 'image/png' });
    await paperAssetRepository.put(record);
    const base = createDefaultPaperDocument({ title: 'Parent managed export asset' });
    const parentId = base.parentPages[0].id;
    const withParentFrame = addFrameToPaperParentPage(base, parentId, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Parent art',
        kind: 'image',
        locator: { kind: 'managed', ref: record.ref },
      },
    }).document;
    const document = assignPaperParentPage(withParentFrame, withParentFrame.pages[0].id, parentId);

    const output = await materializePaperDocumentAssetUrls(document);

    expect(document.parentPages[0].frames[0].asset?.locator).toEqual({ kind: 'managed', ref: record.ref });
    expect(output.parentPages[0].frames[0].asset?.locator).toEqual({
      kind: 'external',
      url: 'data:image/png;base64,CgsM',
    });
    await paperAssetRepository.delete(record.ref.id);
  });

  it('leaves missing managed art on an unused parent page untouched', async () => {
    const missing = await createBinaryAssetRecord(new Uint8Array([21, 22, 23]), { mimeType: 'image/png' });
    const base = createDefaultPaperDocument({ title: 'Unused parent asset' });
    const parentId = base.parentPages[0].id;
    const document = addFrameToPaperParentPage(base, parentId, {
      kind: 'image', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30,
      asset: {
        label: 'Unused parent art',
        kind: 'image',
        locator: { kind: 'managed', ref: missing.ref },
      },
    }).document;

    const output = await materializePaperDocumentAssetUrls(document);

    expect(output).toBe(document);
    expect(output.parentPages[0].frames[0].asset?.locator).toEqual({ kind: 'managed', ref: missing.ref });
  });

  it('fails closed when a managed record does not match its persisted reference', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([7, 8, 9]), { mimeType: 'image/png' });
    await paperAssetRepository.put(record);
    const base = createDefaultPaperDocument({ title: 'Mismatched managed asset' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Managed art',
        kind: 'image',
        locator: { kind: 'managed', ref: { ...record.ref, byteLength: record.ref.byteLength + 1 } },
      },
    });

    await expect(materializePaperDocumentAssetUrls(document)).rejects.toThrow(/does not match its document reference/i);
    await paperAssetRepository.delete(record.ref.id);
  });

  it('fails closed when managed bytes no longer match their content-addressed hash', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([11, 12, 13]), { mimeType: 'image/png' });
    const base = createDefaultPaperDocument({ title: 'Corrupt managed asset' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Managed art',
        kind: 'image',
        locator: { kind: 'managed', ref: record.ref },
      },
    });
    const get = vi.spyOn(paperAssetRepository, 'get').mockResolvedValue({
      ref: record.ref,
      bytes: new Uint8Array([11, 12, 14]),
    });

    try {
      await expect(materializePaperDocumentAssetUrls(document)).rejects.toThrow(/content hash/i);
    } finally {
      get.mockRestore();
    }
  });
});
