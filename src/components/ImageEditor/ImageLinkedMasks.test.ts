import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  findImageLinkedMaskConsumerIds,
  linkImageLayerMask,
  materializeImageLinkedMasks,
  resolveImageLinkedMask,
  unlinkImageLayerMask,
} from './ImageLinkedMasks';

class FakeContext {
  readonly imageData: ImageData;

  constructor(imageData: ImageData) {
    this.imageData = imageData;
  }
  drawImage(source: FakeOffscreenCanvas) {
    this.imageData.data.set(source.context.imageData.data);
  }
  getImageData() { return this.imageData; }
  putImageData(imageData: ImageData) { this.imageData.data.set(imageData.data); }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  readonly context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext({ width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData);
  }
  getContext(kind: string) { return kind === '2d' ? this.context : null; }
}

function layer(patch: Partial<ImageLayer>): ImageLayer {
  return {
    id: patch.id ?? 'layer', name: patch.name ?? 'Layer', type: 'image', visible: true,
    locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null,
    bitmapVersion: patch.bitmapVersion ?? 0, mask: patch.mask ?? null, ...patch,
  };
}

function mask(alpha: number): LayerBitmap {
  const canvas = new FakeOffscreenCanvas(2, 2);
  canvas.context.imageData.data[3] = alpha;
  return canvas as unknown as LayerBitmap;
}

beforeEach(() => {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
});

describe('Image linked masks', () => {
  it('references one live source mask and gives unlinking a detached copy', () => {
    const source = layer({ id: 'source', name: 'Mask source', bitmapVersion: 3, mask: mask(64) });
    const target = layer({ id: 'target', name: 'Masked copy', bitmapVersion: 5, mask: mask(255) });
    const linked = linkImageLayerMask([source, target], target.id, source.id);

    expect(linked[1]).toMatchObject({ id: 'target', mask: null, maskLinkSourceLayerId: 'source' });
    expect(resolveImageLinkedMask(linked, linked[1]!)).toMatchObject({ sourceLayerId: 'source', mask: source.mask });
    expect(materializeImageLinkedMasks(linked)[1]).toMatchObject({ mask: source.mask, bitmapVersion: 8 });

    const unlinked = unlinkImageLayerMask(linked, target.id);
    expect(unlinked[1]?.maskLinkSourceLayerId).toBeUndefined();
    expect(unlinked[1]?.mask).not.toBe(source.mask);
    expect((unlinked[1]?.mask as unknown as FakeOffscreenCanvas).context.imageData.data[3]).toBe(64);
  });

  it('rejects links to an already-linked source and unresolved saved references', () => {
    const root = layer({ id: 'root', mask: mask(255) });
    const middle = layer({ id: 'middle', mask: null, maskLinkSourceLayerId: 'root' });
    const target = layer({ id: 'target', mask: null });
    expect(linkImageLayerMask([root, middle, target], target.id, middle.id)).toEqual([root, middle, target]);
    expect(resolveImageLinkedMask([target], { id: target.id, maskLinkSourceLayerId: 'missing' })).toBeNull();
  });

  it('refuses linking away a source that existing consumers reference, without mutation', () => {
    const other = layer({ id: 'other', mask: mask(255) });
    const demanded = layer({ id: 'demanded', name: 'In-demand source', mask: mask(255) });
    const consumer = layer({ id: 'consumer', mask: null, maskLinkSourceLayerId: 'demanded' });
    const layers = [other, demanded, consumer];

    expect(findImageLinkedMaskConsumerIds(layers, 'demanded')).toEqual(['consumer']);
    expect(findImageLinkedMaskConsumerIds(layers, 'other')).toEqual([]);
    expect(findImageLinkedMaskConsumerIds(layers, 'consumer')).toEqual([]);

    const refused = linkImageLayerMask(layers, 'demanded', 'other');
    expect(refused).toEqual([other, demanded, consumer]);
    expect(refused[1]?.maskLinkSourceLayerId).toBeUndefined();
    expect(refused[1]?.mask).toBe(demanded.mask);
    expect(resolveImageLinkedMask(refused, refused[2]!)).toMatchObject({
      sourceLayerId: 'demanded',
      mask: demanded.mask,
    });

    // The same link stays available once no consumer references the target, and a consumer
    // may still re-link itself to another source.
    expect(linkImageLayerMask([other, demanded], 'demanded', 'other')[1]).toMatchObject({
      mask: null,
      maskLinkSourceLayerId: 'other',
    });
    const relinked = linkImageLayerMask(layers, 'consumer', 'other');
    expect(relinked[2]).toMatchObject({ mask: null, maskLinkSourceLayerId: 'other' });
  });
});
