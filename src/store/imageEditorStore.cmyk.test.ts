// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createImageCmykPixelBuffer } from '../components/ImageEditor/cmyk/ImageCmykDocument';
import { createEmptyImageDocument, useImageEditorStore } from './imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../types/imageEditor';

const profile = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const profileBytesData = btoa(String.fromCharCode(...profile));

class FakeCanvas {
  width: number;
  height: number;
  bytes: Uint8ClampedArray;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bytes = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      drawImage: (source: FakeCanvas) => { this.bytes = new Uint8ClampedArray(source.bytes); },
      getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.bytes) }),
      putImageData: (image: ImageData) => { this.bytes = new Uint8ClampedArray(image.data); },
      clearRect: () => this.bytes.fill(0),
    };
  }
}

function layer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'ink', name: 'Ink', type: 'image', visible: true, locked: false, opacity: 1,
    blendMode: 'normal', x: 0, y: 0, bitmap: new FakeCanvas(1, 1) as unknown as LayerBitmap,
    bitmapVersion: 0, mask: null, ...overrides,
  };
}

function cmykDocument(): ImageDocument {
  const doc = createEmptyImageDocument({ id: 'native-cmyk', title: 'Ink', width: 1, height: 1 });
  const ink = layer({ cmykPixels: createImageCmykPixelBuffer(1, 1, new Uint8Array([12, 34, 56, 78, 255])) });
  return {
    ...doc, activeLayerId: ink.id, layers: [ink], metadata: {
      colorMode: 'cmyk',
      cmyk: {
        profileId: 'embedded-cmyk', profileLabel: 'FOGRA39',
        profileSource: { kind: 'imported', assetId: 'embedded-cmyk', sha256: 'a'.repeat(64) },
        profileBytesData, intent: 'relative', blackPointCompensation: true,
      },
    },
  };
}

beforeEach(() => {
  globalThis.OffscreenCanvas = FakeCanvas as unknown as typeof OffscreenCanvas;
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as unknown as typeof ImageData;
  useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
});

describe('MH-010 store CMYK authority boundary', () => {
  it('refreshes the ICC display proxy and history when a CMYK plate edit commits', async () => {
    const doc = cmykDocument();
    useImageEditorStore.getState().openDocument(doc);
    const result = await useImageEditorStore.getState().commitCmykPlateEdit(doc.id, 'ink', 'k', () => 200);
    const after = useImageEditorStore.getState().documents[0]!;
    expect(result).toEqual({ ok: true });
    expect(after.layers[0]?.cmykPixels?.data[3]).toBe(200);
    expect(after.layers[0]?.bitmapVersion).toBeGreaterThan(doc.layers[0]!.bitmapVersion);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
  });

  it('refuses a direct RGB proxy replacement for a native CMYK layer', () => {
    const doc = cmykDocument();
    useImageEditorStore.getState().openDocument(doc);
    const original = useImageEditorStore.getState().documents[0]!.layers[0]!.bitmap;
    useImageEditorStore.getState().updateLayer(doc.id, 'ink', { bitmap: new FakeCanvas(1, 1) as unknown as LayerBitmap });
    expect(useImageEditorStore.getState().documents[0]!.layers[0]!.bitmap).toBe(original);
  });

  it('refuses CMYK crop, pixel resize, and canvas resize without touching ink authority or geometry', () => {
    const doc = cmykDocument();
    useImageEditorStore.getState().openDocument(doc);
    const before = new Uint8Array(doc.layers[0]!.cmykPixels!.data);
    const store = useImageEditorStore.getState();
    store.applyPerspectiveCrop(doc.id, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
    store.resizeDocumentPixels(doc.id, 2, 2);
    store.resizeDocumentCanvas(doc.id, 2, 2);
    const after = useImageEditorStore.getState().documents[0]!;
    expect([after.width, after.height]).toEqual([1, 1]);
    expect(after.layers[0]?.cmykPixels?.data).toEqual(before);
  });

  it('discards an ICC conversion that finishes after another edit changed the document', async () => {
    const doc = createEmptyImageDocument({ id: 'rgb-race', title: 'Race', width: 1, height: 1 });
    const rgb = { ...doc, activeLayerId: 'ink', layers: [layer()] };
    useImageEditorStore.getState().openDocument(rgb);
    const pending = useImageEditorStore.getState().convertImageColorMode(rgb.id, 'cmyk', {
      profileBytes: profile,
      metadata: { profileId: 'fogra39', profileLabel: 'FOGRA39', profileSource: { kind: 'bundled', id: 'fogra39' }, intent: 'relative', blackPointCompensation: true },
    });
    useImageEditorStore.getState().updateLayer(rgb.id, 'ink', { x: 4 });
    await expect(pending).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/changed while ICC conversion/i) });
    expect(useImageEditorStore.getState().documents[0]?.metadata?.colorMode).not.toBe('cmyk');
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.x).toBe(4);
  });
});
