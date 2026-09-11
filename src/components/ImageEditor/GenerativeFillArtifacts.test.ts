import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import { buildGenerativeFillRequestArtifacts } from './GenerativeFillArtifacts';

class FakeContext {
  drawImageCalls: unknown[][] = [];
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';

  drawImage(...args: unknown[]) {
    this.drawImageCalls.push(args);
  }

  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  save() {}
  restore() {}
  clearRect() {}
  putImageData() {}
}

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];

  width: number;
  height: number;
  context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    FakeOffscreenCanvas.instances.push(this);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function installCanvasStub() {
  FakeOffscreenCanvas.instances = [];
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeDoc(): ImageDocument {
  const layer: ImageLayer = {
    id: 'layer-1',
    name: 'Image 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(300, 220) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
  };

  return {
    id: 'doc-1',
    title: 'doc',
    width: 300,
    height: 220,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: true,
    selectionVersion: 1,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

describe('GenerativeFillArtifacts', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('builds source and mask artifacts in the same local coordinate space as the new generated layer', async () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 150, 100, 10, 8, 255, false);

    const artifacts = await buildGenerativeFillRequestArtifacts(doc, selection);

    expect(artifacts.placementBounds).toEqual({
      x: 54,
      y: 4,
      width: 202,
      height: 200,
    });

    const sourceCanvas = FakeOffscreenCanvas.instances.find((canvas) => canvas.width === 202 && canvas.height === 200 && canvas.context.drawImageCalls.length > 0);
    expect(sourceCanvas?.context.drawImageCalls.at(-1)?.slice(1)).toEqual([
      54,
      4,
      202,
      200,
      0,
      0,
      202,
      200,
    ]);
    expect(artifacts.manifest).toEqual({
      descriptorId: 'generative-fill-request-artifacts:v1',
      documentId: 'doc-1',
      documentSize: { width: 300, height: 220 },
      placementBounds: { x: 54, y: 4, width: 202, height: 200 },
      selectionBounds: { x: 150, y: 100, width: 10, height: 8 },
      localSelectionBounds: { x: 96, y: 96, width: 10, height: 8 },
      selectedPixels: 80,
      source: { mimeType: 'image/png', width: 202, height: 200 },
      mask: { mimeType: 'image/png', width: 202, height: 200 },
      previewSignature: 'generative-fill-request-artifacts:v1:{"documentId":"doc-1","placementBounds":{"x":54,"y":4,"width":202,"height":200},"selectionBounds":{"x":150,"y":100,"width":10,"height":8},"selectedPixels":80,"source":{"width":202,"height":200},"mask":{"width":202,"height":200}}',
    });
  });
});
