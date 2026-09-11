import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import { applyImageArtboardsMetadata, createImageArtboardFromDocument, pixelsToMm } from './ImageArtboards';
import {
  exportImageArtboardsToPng,
  cropImageArtboardRgba,
  IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS,
  isImageArtboardTrimPngResourceBounded,
} from './ImageArtboardRasterExport';

class RasterExportTestContext {
  imageData: ImageData;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';

  constructor(width: number, height: number) {
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }

  drawImage(source: unknown, dx = 0, dy = 0) {
    const data = (source as { context?: RasterExportTestContext }).context?.imageData;
    if (!data) return;
    for (let y = 0; y < data.height; y += 1) {
      for (let x = 0; x < data.width; x += 1) {
        const targetX = Math.round(dx + x);
        const targetY = Math.round(dy + y);
        if (targetX < 0 || targetY < 0 || targetX >= this.imageData.width || targetY >= this.imageData.height) continue;
        const from = (y * data.width + x) * 4;
        const to = (targetY * this.imageData.width + targetX) * 4;
        this.imageData.data.set(data.data.slice(from, from + 4), to);
      }
    }
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  save() {}
  restore() {}
}

class RasterExportTestCanvas {
  readonly width: number;
  readonly height: number;
  readonly context: RasterExportTestContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new RasterExportTestContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob(options?: { type?: string }) {
    return new Blob([`trim-png:${this.width}x${this.height}`], { type: options?.type ?? 'image/png' });
  }
}

describe('ImageArtboardRasterExport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies only the selected artboard rectangle into a transparent PNG-ready buffer', () => {
    const source = {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray([
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
        4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
      ]),
    } as ImageData;

    const crop = cropImageArtboardRgba(source, { x: 1, y: 0, width: 2, height: 2 });

    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
    expect(Array.from(crop.data)).toEqual([
      2, 0, 0, 255, 3, 0, 0, 255,
      5, 0, 0, 255, 6, 0, 0, 255,
    ]);
  });

  it('leaves out-of-document pixels transparent instead of sampling unrelated content', () => {
    const source = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    } as ImageData;

    const crop = cropImageArtboardRgba(source, { x: -1, y: 0, width: 2, height: 1 });

    expect(Array.from(crop.data)).toEqual([0, 0, 0, 0, 10, 20, 30, 255]);
  });

  it('cancels before flattening without mutating the document or attempting an output', async () => {
    const controller = new AbortController();
    controller.abort();
    const document = createEmptyImageDocument({ id: 'doc-cancelled-artboards', title: 'Cancelled', width: 16, height: 16 });
    const originalDirty = document.dirty;
    const originalLayerCount = document.layers.length;

    await expect(exportImageArtboardsToPng(document, { signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ status: 'cancelled', error: expect.stringContaining('cancelled') }),
    ]);
    expect(document.dirty).toBe(originalDirty);
    expect(document.layers).toHaveLength(originalLayerCount);
  });

  it('refuses a hostile source artboard before flattening or mutating the document', async () => {
    const document = createEmptyImageDocument({ id: 'doc-hostile-artboard', title: 'Hostile artboard', width: 1, height: 1 });
    const oversizedWidth = IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS + 1;
    const oversized = {
      ...document,
      width: oversizedWidth,
      metadata: {
        ...document.metadata,
        artboards: {
          activeArtboardId: 'artboard-1',
          artboards: [createImageArtboardFromDocument({ width: oversizedWidth, height: 1 }, 0)],
        },
      },
    };

    expect(isImageArtboardTrimPngResourceBounded(IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS, 1)).toBe(true);
    expect(isImageArtboardTrimPngResourceBounded(oversizedWidth, 1)).toBe(false);
    await expect(exportImageArtboardsToPng(oversized)).resolves.toEqual([
      expect.objectContaining({
        status: 'skipped',
        error: expect.stringContaining('refuses source documents'),
      }),
    ]);
    expect(oversized.dirty).toBe(document.dirty);
    expect(oversized.layers).toBe(document.layers);
  });

  it('emits a separately inspectable PNG blob for each ready artboard in persisted order', async () => {
    vi.stubGlobal('OffscreenCanvas', RasterExportTestCanvas);
    const document = applyImageArtboardsMetadata(createEmptyImageDocument({
      id: 'doc-artboard-output',
      title: 'Spread',
      width: 4,
      height: 2,
    }), {
      activeArtboardId: 'left',
      artboards: [
        {
          id: 'left',
          name: 'Left',
          x: 0,
          y: 0,
          width: 2,
          height: 2,
          proofLabel: 'Trim proof',
          page: { preset: 'custom', widthMm: pixelsToMm(2, 300), heightMm: pixelsToMm(2, 300), bleedMm: 0, dpi: 300 },
        },
        {
          id: 'right',
          name: 'Right',
          x: 2,
          y: 0,
          width: 2,
          height: 2,
          proofLabel: 'Trim proof',
          page: { preset: 'custom', widthMm: pixelsToMm(2, 300), heightMm: pixelsToMm(2, 300), bleedMm: 0, dpi: 300 },
        },
      ],
    });
    const original = structuredClone(document);

    const results = await exportImageArtboardsToPng(document);

    expect(results.map(({ artboardId, filename, status }) => ({ artboardId, filename, status }))).toEqual([
      expect.objectContaining({ artboardId: 'left', filename: expect.stringMatching(/^01-left-custom-300dpi-0mm-bleed\.png$/), status: 'exported' }),
      expect.objectContaining({ artboardId: 'right', filename: expect.stringMatching(/^02-right-custom-300dpi-0mm-bleed\.png$/), status: 'exported' }),
    ]);
    await expect(results[0]?.blob?.text()).resolves.toBe('trim-png:2x2');
    await expect(results[1]?.blob?.text()).resolves.toBe('trim-png:2x2');
    expect(results.every((result) => result.blob?.type === 'image/png')).toBe(true);
    expect(document).toEqual(original);
  });
});
