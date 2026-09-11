import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { redo, undo } from './undoRedoApply';
import { openImageMultiShotResult, type ImageMultiShotResult } from './ImageMultiShotStacking';
import { deserializeSlimgAnyVersion, serializeSlimgV2 } from './ImageSlimgV2Format';
import type { SlimgCodec } from './ImageSlimgFormat';

class MemoryCanvas {
  readonly width: number;
  readonly height: number;
  private bytes: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bytes = new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      drawImage: (source: MemoryCanvas) => {
        this.bytes = new Uint8ClampedArray(source.getContext().getImageData(0, 0, source.width, source.height).data);
      },
      getImageData: (_x?: number, _y?: number, _width?: number, _height?: number) => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.bytes) }),
      putImageData: (image: ImageData) => { this.bytes = new Uint8ClampedArray(image.data); },
      clearRect: () => this.bytes.fill(0),
      save: () => undefined,
      restore: () => undefined,
      fillRect: () => undefined,
    };
  }
}

const codec: SlimgCodec = {
  encode: async (source) => new Uint8Array((source as unknown as MemoryCanvas).getContext().getImageData().data),
  decode: async (bytes, width, height) => {
    const canvas = new MemoryCanvas(width, height);
    canvas.getContext().putImageData({ data: new Uint8ClampedArray(bytes), width, height } as ImageData);
    return canvas as unknown as OffscreenCanvas;
  },
};

describe('MH-063 generated image document lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
    useImageEditorStore.setState({
      documents: [createEmptyImageDocument({ id: 'source-a', title: 'Source A', width: 3, height: 2 })],
      activeDocId: 'source-a',
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('opens an editable generated document without mutating sources and exposes ordinary undo/redo', () => {
    const result: ImageMultiShotResult = {
      mode: 'focus',
      sourceIds: ['source-a', 'source-b'],
      description: 'Local sharpness focus stack from 2 sources with one-pixel seam cleanup.',
      pixels: { width: 3, height: 2, data: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
        11, 21, 31, 255, 41, 51, 61, 255, 71, 81, 91, 255,
      ]) },
    };
    const sourceBefore = useImageEditorStore.getState().documents[0];
    const created = openImageMultiShotResult(result);
    let state = useImageEditorStore.getState();
    const opened = state.documents.find((document) => document.id === created.id);
    expect(state.documents.find((document) => document.id === 'source-a')).toBe(sourceBefore);
    expect(opened).toMatchObject({
      title: 'Focus Stack',
      dirty: true,
      metadata: expect.objectContaining({ sourceFormat: 'signal-loom-multishot-v1', sourceBitDepth: 8 }),
    });
    expect(opened?.layers).toHaveLength(1);
    expect(state.undoStacks[created.id]?.at(-1)).toMatchObject({ kind: 'layerOp', docId: created.id });

    expect(undo(created.id)).toBe(true);
    state = useImageEditorStore.getState();
    expect(state.documents.find((document) => document.id === created.id)?.layers).toHaveLength(0);
    expect(redo(created.id)).toBe(true);
    expect(useImageEditorStore.getState().documents.find((document) => document.id === created.id)?.layers).toHaveLength(1);
  });

  it('persists the generated result through the normal .slimg v2 envelope', async () => {
    const created = openImageMultiShotResult({
      mode: 'hdr',
      sourceIds: ['source-a', 'source-b'],
      description: 'Exposure fusion from 2 sources, weighted toward locally usable exposure values.',
      pixels: { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(180) },
    });
    const live = useImageEditorStore.getState().documents.find((document) => document.id === created.id);
    if (!live) throw new Error('Expected generated document to be open.');
    const reopened = await deserializeSlimgAnyVersion(await serializeSlimgV2(live, codec), codec);
    expect(reopened).toMatchObject({
      title: 'HDR Merge',
      // The ordinary v2 loader correctly identifies its persisted container as slimg while
      // retaining the generated-workflow description and the 8-bit raster contract.
      metadata: expect.objectContaining({
        sourceFormat: 'slimg',
        sourceBitDepth: 8,
        warnings: ['Exposure fusion from 2 sources, weighted toward locally usable exposure values.'],
      }),
      layers: [expect.objectContaining({ name: 'HDR exposure fusion', type: 'image' })],
    });
  });
});
