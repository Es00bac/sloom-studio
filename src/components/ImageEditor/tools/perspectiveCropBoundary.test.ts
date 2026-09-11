/**
 * MH-044 boundary tests: the user-facing perspective-crop commit is one undoable
 * `docResize` operation, its flattened layer survives the project pixel codec
 * (encode → JSON disk form → decode), and the committed document's flattened
 * export equals the rectification output. Uses a deterministic pixel-backed
 * OffscreenCanvas fake so the whole chain runs in Node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import { buildPerspectiveCroppedImageDocumentState } from './perspectiveCropDocument';
import { clearCropPreview, clearPerspectiveCropPreview } from './cropTool';
import { undo, redo } from '../undoRedoApply';
import {
  decodeImageLayerProjectPixels,
  encodeImageLayerProjectPixels,
} from '../ImageLayerProjectPixels';
import { renderImageDocumentLayersToBitmap } from '../ImageAdjustmentLayer';

type Matrix = [number, number, number, number, number, number];

function multiplyMatrix(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function invertMatrix(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

class PixelContext {
  canvas: PixelCanvas;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  private matrix: Matrix = [1, 0, 0, 1, 0, 0];
  private stack: Matrix[] = [];

  constructor(canvas: PixelCanvas) {
    this.canvas = canvas;
  }

  save(): void {
    this.stack.push([...this.matrix] as Matrix);
  }

  restore(): void {
    const restored = this.stack.pop();
    if (restored) this.matrix = restored;
  }

  translate(x: number, y: number): void {
    this.matrix = multiplyMatrix(this.matrix, [1, 0, 0, 1, x, y]);
  }

  scale(sx: number, sy: number): void {
    this.matrix = multiplyMatrix(this.matrix, [sx, 0, 0, sy, 0, 0]);
  }

  rotate(radians: number): void {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    this.matrix = multiplyMatrix(this.matrix, [cos, sin, -sin, cos, 0, 0]);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = multiplyMatrix(this.matrix, [a, b, c, d, e, f]);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const pixels = this.canvas.pixels;
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(this.canvas.height, Math.ceil(y + height)); py += 1) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.canvas.width, Math.ceil(x + width)); px += 1) {
        const offset = (py * this.canvas.width + px) * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
      }
    }
  }

  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  clip(): void {}
  fill(): void {}
  stroke(): void {}
  setLineDash(): void {}

  /** Nearest-neighbor affine blit — exact for the translation-only test documents. */
  drawImage(source: PixelCanvas, dx = 0, dy = 0, dw?: number, dh?: number): void {
    const inverse = invertMatrix(this.matrix);
    if (!inverse) return;
    const sourceWidth = dw ?? source.width;
    const sourceHeight = dh ?? source.height;
    const corners = [
      applyMatrix(this.matrix, dx, dy),
      applyMatrix(this.matrix, dx + sourceWidth, dy),
      applyMatrix(this.matrix, dx + sourceWidth, dy + sourceHeight),
      applyMatrix(this.matrix, dx, dy + sourceHeight),
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.x))));
    const maxX = Math.min(this.canvas.width - 1, Math.ceil(Math.max(...corners.map((corner) => corner.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.y))));
    const maxY = Math.min(this.canvas.height - 1, Math.ceil(Math.max(...corners.map((corner) => corner.y))));
    const alpha = this.globalAlpha;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const mapped = applyMatrix(inverse, px + 0.5, py + 0.5);
        const sx = Math.floor(mapped.x - dx);
        const sy = Math.floor(mapped.y - dy);
        if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const sourceAlpha = (source.pixels[sourceOffset + 3] / 255) * alpha;
        if (sourceAlpha <= 0) continue;
        const targetOffset = (py * this.canvas.width + px) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const target = this.canvas.pixels[targetOffset + channel];
          const value = channel === 3
            ? source.pixels[sourceOffset + channel]
            : Math.round(
              source.pixels[sourceOffset + channel] * sourceAlpha
                + target * (1 - sourceAlpha) * (target === 0 && channel === 3 ? 0 : 1),
            );
          this.canvas.pixels[targetOffset + channel] = channel === 3
            ? Math.round(target + value * (1 - target / 255))
            : value;
        }
        // Alpha blend for opaque sources simplifies to a copy.
        if (source.pixels[sourceOffset + 3] === 255 && alpha === 1) {
          this.canvas.pixels[targetOffset] = source.pixels[sourceOffset];
          this.canvas.pixels[targetOffset + 1] = source.pixels[sourceOffset + 1];
          this.canvas.pixels[targetOffset + 2] = source.pixels[sourceOffset + 2];
          this.canvas.pixels[targetOffset + 3] = 255;
        }
      }
    }
  }

  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const sourceOffset = ((y + row) * this.canvas.width + (x + column)) * 4;
        const targetOffset = (row * width + column) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          data[targetOffset + channel] = this.canvas.pixels[sourceOffset + channel];
        }
      }
    }
    return { data, width, height };
  }

  putImageData(imageData: { data: ArrayLike<number>; width: number; height: number }, x = 0, y = 0): void {
    for (let row = 0; row < imageData.height; row += 1) {
      for (let column = 0; column < imageData.width; column += 1) {
        const px = x + column;
        const py = y + row;
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue;
        const sourceOffset = (row * imageData.width + column) * 4;
        const targetOffset = (py * this.canvas.width + px) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          this.canvas.pixels[targetOffset + channel] = imageData.data[sourceOffset + channel];
        }
      }
    }
  }

  createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }
}

class PixelCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(): PixelContext {
    return new PixelContext(this);
  }
}

vi.stubGlobal('OffscreenCanvas', PixelCanvas);

function makeGradientBitmap(width: number, height: number): PixelCanvas {
  const canvas = new PixelCanvas(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      canvas.pixels[offset] = (x * 7) % 256;
      canvas.pixels[offset + 1] = (y * 5) % 256;
      canvas.pixels[offset + 2] = ((x + y) * 3) % 256;
      canvas.pixels[offset + 3] = 255;
    }
  }
  return canvas;
}

function pixelLayer(id: string, bitmap: PixelCanvas): ImageLayer {
  return {
    id,
    name: id,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: bitmap as unknown as LayerBitmap,
    bitmapVersion: 1,
    mask: null,
  } as ImageLayer;
}

function gradientDoc(width = 60, height = 40): ImageDocument {
  const bitmap = makeGradientBitmap(width, height);
  const layer = pixelLayer('source-layer', bitmap);
  return {
    id: 'doc-perspective',
    title: 'Perspective',
    width,
    height,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [],
  };
}

const jsonCodec = {
  encode: async (bitmap: LayerBitmap) => {
    const pixel = bitmap as unknown as PixelCanvas;
    return JSON.stringify({ w: pixel.width, h: pixel.height, p: Array.from(pixel.pixels) });
  },
  decode: async (payload: string) => {
    const parsed = JSON.parse(payload) as { w: number; h: number; p: number[] };
    const canvas = new PixelCanvas(parsed.w, parsed.h);
    canvas.pixels.set(parsed.p);
    return canvas as unknown as LayerBitmap;
  },
};

describe('perspective crop — commit boundary', () => {
  beforeEach(() => {
    clearCropPreview();
    clearPerspectiveCropPreview();
  });

  it('commits an axis-aligned quad as an exact pixel copy at the quad size', () => {
    const doc = gradientDoc(60, 40);
    const result = buildPerspectiveCroppedImageDocumentState(doc, [
      { x: 10, y: 5 },
      { x: 50, y: 5 },
      { x: 50, y: 35 },
      { x: 10, y: 35 },
    ]);
    expect(result).not.toBeNull();
    expect(result?.width).toBe(40);
    expect(result?.height).toBe(30);
    expect(result?.layers).toHaveLength(1);
    expect(result?.layers[0].name).toBe('Perspective Crop');
    expect(result?.layers[0].x).toBe(0);
    expect(result?.layers[0].mask).toBeNull();

    const committed = (result?.layers[0].bitmap as unknown as PixelCanvas).pixels;
    const source = (doc.layers[0].bitmap as unknown as PixelCanvas).pixels;
    // Identity homography: output (0,0) samples source (10,5).
    const committedZero = [committed[0], committed[1], committed[2], committed[3]];
    const sourceProbe = [
      source[(5 * 60 + 10) * 4],
      source[(5 * 60 + 10) * 4 + 1],
      source[(5 * 60 + 10) * 4 + 2],
      source[(5 * 60 + 10) * 4 + 3],
    ];
    expect(committedZero).toEqual(sourceProbe);
  });

  it('commits through the store as one docResize operation and survives undo/redo', () => {
    const doc = gradientDoc(60, 40);
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
    });

    const corners = [
      { x: 8, y: 4 },
      { x: 56, y: 6 },
      { x: 54, y: 36 },
      { x: 6, y: 34 },
    ];
    useImageEditorStore.getState().applyPerspectiveCrop(doc.id, corners);

    const afterApply = useImageEditorStore.getState().documents[0];
    expect(afterApply.layers).toHaveLength(1);
    expect(afterApply.width).toBe(Math.round((Math.hypot(48, 2) + Math.hypot(48, 2)) / 2));
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id][0]).toMatchObject({ kind: 'docResize' });

    undo(doc.id);
    const afterUndo = useImageEditorStore.getState().documents[0];
    expect(afterUndo.width).toBe(60);
    expect(afterUndo.height).toBe(40);
    expect(afterUndo.layers[0].id).toBe('source-layer');
    expect((afterUndo.layers[0].bitmap as unknown as PixelCanvas).pixels[0]).toBe(
      (doc.layers[0].bitmap as unknown as PixelCanvas).pixels[0],
    );

    redo(doc.id);
    const afterRedo = useImageEditorStore.getState().documents[0];
    expect(afterRedo.layers).toHaveLength(1);
    expect(afterRedo.layers[0].name).toBe('Perspective Crop');
    expect(afterRedo.width).toBe(afterApply.width);
    expect(afterRedo.height).toBe(afterApply.height);
  });

  it('refuses a Tiltmark-surface document at the store boundary', () => {
    const doc = gradientDoc();
    const tiltmarkDoc: ImageDocument = {
      ...doc,
      layers: [{
        ...doc.layers[0],
        metadata: { tiltmark: { schemaVersion: 1, role: 'surface' } },
      }],
    };
    useImageEditorStore.setState({
      documents: [tiltmarkDoc],
      activeDocId: tiltmarkDoc.id,
      undoStacks: {},
      redoStacks: {},
    });

    useImageEditorStore.getState().applyPerspectiveCrop(tiltmarkDoc.id, [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ]);

    const unchanged = useImageEditorStore.getState().documents[0];
    expect(unchanged.width).toBe(60);
    expect(unchanged.layers[0].id).toBe('source-layer');
    expect(useImageEditorStore.getState().undoStacks[tiltmarkDoc.id]).toBeUndefined();
  });

  it('refuses a high-bit document before flattening, history, or authority mutation', () => {
    const doc = gradientDoc();
    const highBitDoc: ImageDocument = {
      ...doc,
      metadata: { bitDepth: 16, sourceBitDepth: 16 },
    };
    useImageEditorStore.setState({
      documents: [highBitDoc],
      activeDocId: highBitDoc.id,
      undoStacks: {},
      redoStacks: {},
    });

    useImageEditorStore.getState().applyPerspectiveCrop(highBitDoc.id, [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ]);

    const unchanged = useImageEditorStore.getState().documents[0];
    expect(unchanged).toBe(highBitDoc);
    expect(unchanged.width).toBe(60);
    expect(unchanged.height).toBe(40);
    expect(unchanged.layers[0].id).toBe('source-layer');
    expect(useImageEditorStore.getState().undoStacks[highBitDoc.id]).toBeUndefined();
  });

  it('refuses reverse-winding corners at the store boundary without changing the document', () => {
    const doc = gradientDoc(60, 40);
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
    });

    useImageEditorStore.getState().applyPerspectiveCrop(doc.id, [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 60, y: 40 },
      { x: 60, y: 0 },
    ]);

    const unchanged = useImageEditorStore.getState().documents[0];
    expect(unchanged.width).toBe(60);
    expect(unchanged.height).toBe(40);
    expect(unchanged.layers[0].id).toBe('source-layer');
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
  });

  it('refuses an unallocatable finite output before raster work at the store boundary', () => {
    const doc = gradientDoc(60, 40);
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
    });

    expect(() => useImageEditorStore.getState().applyPerspectiveCrop(doc.id, [
      { x: 0, y: 0 },
      { x: 1e100, y: 0 },
      { x: 1e100, y: 1e100 },
      { x: 0, y: 1e100 },
    ])).not.toThrow();

    const unchanged = useImageEditorStore.getState().documents[0];
    expect(unchanged.width).toBe(60);
    expect(unchanged.height).toBe(40);
    expect(unchanged.layers[0].id).toBe('source-layer');
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
  });
});

describe('perspective crop — persistence and export boundary', () => {
  it('round-trips the committed layer through the project pixel codec', async () => {
    const doc = gradientDoc(60, 40);
    const result = buildPerspectiveCroppedImageDocumentState(doc, [
      { x: 10, y: 5 },
      { x: 50, y: 5 },
      { x: 50, y: 35 },
      { x: 10, y: 35 },
    ]);
    if (!result) throw new Error('expected a perspective crop result');

    // Save path: live buffers become serializable payloads, exactly like a project write.
    const encoded = await encodeImageLayerProjectPixels(result.layers[0], jsonCodec);
    expect(encoded.bitmap).toBeNull();
    expect(typeof encoded.bitmapData).toBe('string');
    // The durable form is plain JSON (disk-serializable).
    const diskForm = JSON.parse(JSON.stringify(encoded));
    expect(diskForm.bitmapData).toBe(encoded.bitmapData);

    // Reopen path: decode restores a live bitmap with identical pixels and dimensions.
    const decoded = await decodeImageLayerProjectPixels(
      diskForm as ImageLayer,
      jsonCodec,
      { bitmap: { width: 40, height: 30 } },
    );
    expect(decoded.bitmap?.width).toBe(40);
    expect(decoded.bitmap?.height).toBe(30);
    expect(Array.from((decoded.bitmap as unknown as PixelCanvas).pixels)).toEqual(
      Array.from((result.layers[0].bitmap as unknown as PixelCanvas).pixels),
    );
  });

  it('flattens the committed document to exactly the rectified pixels (export parity)', () => {
    const doc = gradientDoc(60, 40);
    const result = buildPerspectiveCroppedImageDocumentState(doc, [
      { x: 10, y: 5 },
      { x: 50, y: 5 },
      { x: 50, y: 35 },
      { x: 10, y: 35 },
    ]);
    if (!result) throw new Error('expected a perspective crop result');

    const committedDoc: ImageDocument = {
      ...doc,
      width: result.width,
      height: result.height,
      layers: result.layers,
      activeLayerId: result.activeLayerId,
    };
    const flattened = renderImageDocumentLayersToBitmap(committedDoc) as unknown as PixelCanvas;
    expect(flattened.width).toBe(40);
    expect(flattened.height).toBe(30);
    expect(Array.from(flattened.pixels)).toEqual(
      Array.from((result.layers[0].bitmap as unknown as PixelCanvas).pixels),
    );
  });
});
