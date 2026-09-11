import { describe, expect, it } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import {
  buildPaperImageQuickEditLabel,
  buildPaperImageQuickEditPrompt,
  preparePaperImageQuickEdit,
  resolvePaperImageQuickEditTarget,
} from './paperImageQuickEdit';

const SOURCE_URL = 'data:image/png;base64,c291cmNl';

function makeSourceItem(): SourceBinLibraryItem {
  return {
    id: 'source-image-1',
    label: 'Panel Shot.png',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: SOURCE_URL,
    pixelWidth: 640,
    pixelHeight: 360,
    createdAt: 1,
  };
}

function makePaperDocumentWithImageFrame() {
  let document = createDefaultPaperDocument({ title: 'Quick Edit Test' });
  const pageId = document.pages[0].id;
  document = addFrameToPaperPage(document, pageId, {
    id: 'image-frame-1',
    kind: 'image',
    label: 'Panel image frame',
    xMm: 12,
    yMm: 18,
    widthMm: 70,
    heightMm: 42,
    zIndex: 1,
    asset: {
      sourceBinItemId: 'source-image-1',
      label: 'Panel Shot.png',
      kind: 'image',
      mimeType: 'image/png',
      pixelWidth: 640,
      pixelHeight: 360,
    },
  }).document;
  return { document, pageId, frameId: 'image-frame-1' };
}

describe('paper image quick edit', () => {
  it('resolves a Paper image-frame edit target from the placed source-library asset', () => {
    const { document, pageId, frameId } = makePaperDocumentWithImageFrame();
    const target = resolvePaperImageQuickEditTarget({
      document,
      frameId,
      pageId,
      sourceItems: [makeSourceItem()],
    });

    expect(target.frame.id).toBe(frameId);
    expect(target.sourceItem.id).toBe('source-image-1');
    expect(target.sourceUrl).toBe(SOURCE_URL);
  });

  it('prepares a full-image provider edit and Source Library item without mutating the original frame', async () => {
    const { document, pageId, frameId } = makePaperDocumentWithImageFrame();
    const sourceBlob = new Blob(['source'], { type: 'image/png' });
    const maskBlob = new Blob(['mask'], { type: 'image/png' });
    const resultBlob = new Blob(['result'], { type: 'image/png' });
    const calls: unknown[] = [];

    const edit = await preparePaperImageQuickEdit({
      document,
      frameId,
      pageId,
      prompt: 'make the sky dusk',
      provider: 'gemini',
      sourceItems: [makeSourceItem()],
    }, {
      blobToDataUrl: async (blob) => {
        calls.push(['dataUrl', blob]);
        return 'data:image/png;base64,cmVzdWx0';
      },
      buildFullImageMaskBlob: async (dimensions) => {
        calls.push(['mask', dimensions]);
        return maskBlob;
      },
      fetchImageBlob: async (url) => {
        calls.push(['fetch', url]);
        return sourceBlob;
      },
      getImageDimensions: async (blob) => {
        calls.push(['dimensions', blob]);
        return blob === resultBlob
          ? { width: 1024, height: 576 }
          : { width: 640, height: 360 };
      },
      now: () => 1234,
      runGenerativeFill: async (request) => {
        calls.push(['run', request]);
        return { png: resultBlob, modelUsed: 'gemini-2.5-flash-image' };
      },
    });

    expect(calls).toEqual(expect.arrayContaining([
      ['fetch', SOURCE_URL],
      ['mask', { width: 640, height: 360 }],
    ]));
    expect(calls.find((call) => Array.isArray(call) && call[0] === 'run')).toEqual([
      'run',
      expect.objectContaining({
        source: sourceBlob,
        mask: maskBlob,
        provider: 'gemini',
        prompt: buildPaperImageQuickEditPrompt('make the sky dusk'),
      }),
    ]);
    expect(edit.sourceItem).toMatchObject({
      label: 'Panel Shot quick edit - make the sky dusk.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,cmVzdWx0',
      pixelWidth: 1024,
      pixelHeight: 576,
      sourceKey: 'paper-quick-edit:image-frame-1:source-image-1:1234',
    });
    expect(edit.modelUsed).toBe('gemini-2.5-flash-image');
    expect(document.pages[0].frames[0].asset?.sourceBinItemId).toBe('source-image-1');
  });

  it('keeps generated quick-edit labels readable and bounded', () => {
    expect(buildPaperImageQuickEditLabel('Panel Shot.png', '  add moonlight!!!  ')).toBe(
      'Panel Shot quick edit - add moonlight.png',
    );
    expect(buildPaperImageQuickEditLabel('Panel Shot.png', 'x'.repeat(120)).length).toBeLessThanOrEqual(84);
  });
});
