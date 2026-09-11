import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import {
  clearImageClipboard,
  copyLayerPixelsToClipboard,
  createPastedLayerFromClipboard,
  deleteSelectedLayerPixels,
  hasImageClipboard,
} from './ImageEditorClipboard';

class FakeContext {
  drawImageCalls: unknown[][] = [];
  globalCompositeOperation = 'source-over';
  globalAlpha = 1;
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';

  drawImage(...args: unknown[]) {
    this.drawImageCalls.push(args);
  }

  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  putImageData() {}
  save() {}
  restore() {}
  translate() {}
  clearRect() {}
  fillRect() {}
  beginPath() {}
  rect() {}
  clip() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fillText() {}
  measureText() {
    return {
      width: 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    };
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 100,
    height: 80,
    layers: [],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 5,
    y: 6,
    bitmap: new OffscreenCanvas(40, 30) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('ImageEditorClipboard', () => {
  beforeEach(() => {
    installCanvasStub();
    clearImageClipboard();
  });

  it('copies a whole active layer and creates a paste layer at the same document position', () => {
    const doc = makeDoc();
    const layer = makeLayer();

    const copied = copyLayerPixelsToClipboard(doc, layer, null);
    const pasted = createPastedLayerFromClipboard('paste-1');

    expect(copied).toBe(true);
    expect(hasImageClipboard()).toBe(true);
    expect(pasted).toMatchObject({
      id: 'paste-1',
      name: 'Background copy',
      type: 'image',
      x: 5,
      y: 6,
      bitmapVersion: 0,
    });
    expect(pasted?.bitmap?.width).toBe(40);
    expect(pasted?.bitmap?.height).toBe(30);
  });

  it('copies only the selection bounding box when a selection exists', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);

    const copied = copyLayerPixelsToClipboard(doc, layer, selection);
    const pasted = createPastedLayerFromClipboard('paste-selection');

    expect(copied).toBe(true);
    expect(pasted).toMatchObject({
      id: 'paste-selection',
      x: 10,
      y: 12,
    });
    expect(pasted?.bitmap?.width).toBe(4);
    expect(pasted?.bitmap?.height).toBe(3);
  });

  it('clears selected pixels and returns a paint operation for undo', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);

    const op = deleteSelectedLayerPixels(doc, layer, selection);

    expect(op).toMatchObject({
      kind: 'paint',
      docId: 'doc-1',
      layerId: 'layer-1',
    });
    expect(op?.before?.width).toBe(40);
    expect(op?.after?.height).toBe(30);
  });
});
