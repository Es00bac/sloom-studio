import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { LayerBitmap } from '../../types/imageEditor';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import {
  buildSourceItemImageLayer,
  computeContainScale,
  insertSourceItemAsImageLayer,
} from './imageLayerInsert';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return { drawImage() {} };
  }
}

function imageItem(): SourceBinLibraryItem {
  return {
    id: 'src-1',
    label: 'Reference',
    kind: 'image',
    assetUrl: 'blob:reference',
    createdAt: 1,
    sourceKey: 'media/reference.png',
  } as SourceBinLibraryItem;
}

const fakeBitmapLoader = (w: number, h: number) => async (): Promise<LayerBitmap> =>
  ({ width: w, height: h }) as unknown as LayerBitmap;

describe('computeContainScale', () => {
  it('keeps native size when the source fits inside the canvas', () => {
    expect(computeContainScale(100, 100, 200, 200)).toBe(1);
    expect(computeContainScale(200, 200, 200, 200)).toBe(1);
  });

  it('shrinks to contain (aspect-preserving) when larger in either dimension', () => {
    // 2000x1000 into 1000x1000 -> width-bound, scale 0.5
    expect(computeContainScale(2000, 1000, 1000, 1000)).toBeCloseTo(0.5);
    // 400x1200 into 1000x600 -> height-bound, scale 0.5
    expect(computeContainScale(400, 1200, 1000, 600)).toBeCloseTo(0.5);
  });

  it('returns 1 for degenerate dimensions', () => {
    expect(computeContainScale(0, 100, 200, 200)).toBe(1);
    expect(computeContainScale(100, 100, 0, 200)).toBe(1);
  });
});

describe('buildSourceItemImageLayer', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('scales an oversized source down to fit and centres it on the canvas', async () => {
    const layer = await buildSourceItemImageLayer(imageItem(), 1000, 1000, fakeBitmapLoader(2000, 1000));
    expect(layer.type).toBe('image');
    expect(layer.bitmap?.width).toBe(1000);
    expect(layer.bitmap?.height).toBe(500);
    // centred: x = (1000-1000)/2 = 0, y = (1000-500)/2 = 250
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(250);
  });

  it('keeps a smaller source at native size, centred', async () => {
    const layer = await buildSourceItemImageLayer(imageItem(), 1000, 800, fakeBitmapLoader(400, 200));
    expect(layer.bitmap?.width).toBe(400);
    expect(layer.bitmap?.height).toBe(200);
    expect(layer.x).toBe(300);
    expect(layer.y).toBe(300);
  });
});

describe('insertSourceItemAsImageLayer', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
  });

  it('adds the fitted source image as an undoable layer in the active document', async () => {
    useImageEditorStore.getState().openDocument(
      createEmptyImageDocument({ id: 'doc-insert', title: 'Insert', width: 640, height: 480 }),
    );
    const layersBefore = useImageEditorStore.getState().getActiveDocument()?.layers.length ?? 0;
    const undoBefore = useImageEditorStore.getState().undoStacks['doc-insert']?.length ?? 0;

    const doc = useImageEditorStore.getState().getActiveDocument()!;
    const layer = await insertSourceItemAsImageLayer(imageItem(), doc, fakeBitmapLoader(320, 240));

    expect(layer).not.toBeNull();
    const after = useImageEditorStore.getState().getActiveDocument();
    expect(after?.layers.length).toBe(layersBefore + 1);
    expect(after?.layers.some((entry) => entry.id === layer?.id)).toBe(true);
    expect(useImageEditorStore.getState().undoStacks['doc-insert']?.length ?? 0).toBe(undoBefore + 1);
  });
});
