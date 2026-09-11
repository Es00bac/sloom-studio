import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from './imageEditorStore';
import { DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER } from '../components/ImageEditor/imageEditorTools';
import { undo, redo } from '../components/ImageEditor/undoRedoApply';
import { getEditorOperationLabel } from '../components/ImageEditor/ImageEditorHistory';
import { editorOperationRetainedBytes } from '../components/ImageEditor/ImageHistoryResources';
import type { EditorOperation, ImageDocument, ImageLayer, LayerBitmap } from '../types/imageEditor';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  bytes: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.bytes = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < this.bytes.length; index += 1) {
      this.bytes[index] = (index * 41 + 7) % 256;
    }
  }

  getContext() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- test fake canvas identity
    const canvas = this;
    return {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(canvas.bytes),
      }),
      putImageData: (imageData: { data: Uint8ClampedArray }) => {
        canvas.bytes = new Uint8ClampedArray(imageData.data);
      },
      drawImage: () => {},
    };
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(4, 4) as unknown as LayerBitmap,
    bitmapVersion: 2,
    mask: null,
    ...overrides,
  };
}

let documentCounter = 0;

function makeDocument(layers?: ImageLayer[]): ImageDocument {
  documentCounter += 1;
  const doc = createEmptyImageDocument({
    id: `depth-doc-${documentCounter}`,
    width: 4,
    height: 4,
    title: 'Depth Test',
  });
  return { ...doc, layers: layers ?? [makeLayer()], activeLayerId: 'layer-1' };
}

function resetStore() {
  useImageEditorStore.setState({
    documents: [],
    activeDocId: null,
    tool: 'move',
    backgroundColor: '#000000',
    brushSettings: { ...(useImageEditorStore.getState().brushSettings) },
    gradientToolSettings: { ...(useImageEditorStore.getState().gradientToolSettings) },
    shapeToolSettings: { ...(useImageEditorStore.getState().shapeToolSettings) },
    selectionToolSettings: { ...(useImageEditorStore.getState().selectionToolSettings) },
    textToolSettings: { ...(useImageEditorStore.getState().textToolSettings) },
    viewportContainerSize: { width: 0, height: 0 },
    undoStacks: {},
    redoStacks: {},
    quickActionMacros: [],
    activeQuickActionRecording: null,
    toolbarFlyoutOrder: [...DEFAULT_IMAGE_EDITOR_TOOL_FLYOUT_ORDER_SAFE],
    generativeFillDismissedByDocId: {},
  });
}

const DEFAULT_IMAGE_EDITOR_TOOL_FLYOUT_ORDER_SAFE = DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER;

function openDoc(layers?: ImageLayer[]): ImageDocument {
  const doc = makeDocument(layers);
  useImageEditorStore.getState().openDocument(doc);
  return doc;
}

function lastUndoOp(): EditorOperation | undefined {
  const stack = useImageEditorStore.getState().undoStacks;
  const only = Object.values(stack)[0];
  return only?.[only.length - 1];
}

beforeEach(resetStore);

describe('convertDocumentDepth store operation', () => {
  it('refuses CMYK-to-high-bit conversion before a divergent RGB PixelBuffer can be created', () => {
    const doc = openDoc([makeLayer({
      cmykPixels: { model: 'cmyk', depth: 'u8', width: 4, height: 4, data: new Uint8Array(4 * 4 * 5) },
    })]);
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((candidate) => candidate.id === doc.id
        ? { ...candidate, metadata: { ...candidate.metadata, colorMode: 'cmyk', cmyk: { profileId: 'fogra39', profileLabel: 'FOGRA39', profileSource: { kind: 'bundled', id: 'fogra39' }, intent: 'relative', blackPointCompensation: true } } }
        : candidate),
    }));
    const result = useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    expect(result).toMatchObject({ ok: false, code: 'cmyk-authority' });
    expect(useImageEditorStore.getState().documents[0]?.metadata?.bitDepth).not.toBe(16);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.pixels).toBeUndefined();
  });
  it('converts 8→16 with an exact u16 authority and one history step', () => {
    const doc = openDoc();
    const before = (doc.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes;
    const result = useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    expect(result).toEqual({ ok: true, convertedLayers: 1, bitDepth: 16 });

    const state = useImageEditorStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(state.metadata?.bitDepth).toBe(16);
    expect(state.dirty).toBe(true);
    const layer = state.layers[0]!;
    expect(layer.pixels!.depth).toBe('u16');
    expect(layer.pixelsVersion).toBe(2);
    const data = layer.pixels!.data as Uint16Array;
    for (let index = 0; index < data.length; index += 1) {
      expect(data[index]).toBe(before[index]! * 257);
    }
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
  });

  it('never changes the display proxy canvas bytes across conversion', () => {
    const doc = openDoc([makeLayer(), makeLayer({ id: 'layer-2' })]);
    const bytesBefore = useImageEditorStore.getState().documents[0]!.layers
      .map((layer) => Array.from((layer.bitmap as unknown as FakeOffscreenCanvas).bytes));
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 32);
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 8);
    const bytesAfter = useImageEditorStore.getState().documents[0]!.layers
      .map((layer) => Array.from((layer.bitmap as unknown as FakeOffscreenCanvas).bytes));
    expect(bytesAfter).toEqual(bytesBefore);
  });

  it('undo/redo of every conversion step is bit-exact including back to 8-bit', () => {
    const doc = openDoc();
    const layerId = doc.layers[0]!.id;
    const originalBytes = Array.from(
      (doc.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes,
    );

    useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 32);
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 8);

    const state = () => useImageEditorStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(state()!.metadata?.bitDepth).toBe(8);
    expect(state()!.layers[0]!.pixels ?? null).toBeNull();
    expect(Array.from((state()!.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes))
      .toEqual(originalBytes);

    // Undo to the 32-bit step: authority restored bit-exactly.
    expect(undo(doc.id)).toBe(true);
    expect(state()!.metadata?.bitDepth).toBe(32);
    expect(state()!.layers[0]!.pixels!.depth).toBe('f32');
    const f32 = Array.from(state()!.layers[0]!.pixels!.data as Float32Array);
    // Undo again to 16-bit, capture, then redo the 32-bit step and undo it
    // back: both directions restore the exact captured bytes.
    expect(undo(doc.id)).toBe(true);
    expect(state()!.layers[0]!.pixels!.depth).toBe('u16');
    const u16 = Array.from(state()!.layers[0]!.pixels!.data as Uint16Array);
    expect(redo(doc.id)).toBe(true);
    expect(state()!.layers[0]!.pixels!.depth).toBe('f32');
    expect(Array.from(state()!.layers[0]!.pixels!.data as Float32Array)).toEqual(f32);
    expect(undo(doc.id)).toBe(true);
    expect(state()!.layers[0]!.pixels!.depth).toBe('u16');
    expect(Array.from(state()!.layers[0]!.pixels!.data as Uint16Array)).toEqual(u16);
    expect(redo(doc.id)).toBe(true);
    expect(state()!.metadata?.bitDepth).toBe(32);
    expect(redo(doc.id)).toBe(true);
    expect(state()!.metadata?.bitDepth).toBe(8);
    expect(state()!.layers[0]!.pixels ?? null).toBeNull();

    // Undo through all three steps returns the pristine 8-bit document. The
    // restored depth is an explicit 8 (identical working surface to absent),
    // and the high-bit authority and version are gone entirely.
    expect(undo(doc.id)).toBe(true);
    expect(undo(doc.id)).toBe(true);
    expect(undo(doc.id)).toBe(true);
    expect(state()!.metadata?.bitDepth).toBe(8);
    expect(state()!.layers[0]!.pixels ?? null).toBeNull();
    expect(state()!.layers[0]!.pixelsVersion ?? undefined).toBeUndefined();
    expect(Array.from((state()!.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes))
      .toEqual(originalBytes);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(0);
    expect(useImageEditorStore.getState().redoStacks[doc.id]).toHaveLength(3);
    expect(layerId).toBe('layer-1');
  });

  it('labels the conversion for history surfaces', () => {
    const doc = openDoc();
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    const op = lastUndoOp();
    expect(op?.kind).toBe('convertDepth');
    expect(getEditorOperationLabel(op!)).toBe('Convert to 16 Bits/Channel');
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 8);
    expect(getEditorOperationLabel(lastUndoOp()!)).toBe('Convert to 8 Bits/Channel');
  });

  it('refuses without mutation or history when the budget is exceeded', () => {
    const doc = openDoc();
    const before = structuredClone(useImageEditorStore.getState().documents[0]!.metadata ?? {});
    const result = useImageEditorStore.getState().convertDocumentDepth(doc.id, 16, {
      budgetBytes: 64,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('budget-exceeded');
    expect(result.message).toContain('refused before allocation');
    const state = useImageEditorStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(state.metadata?.bitDepth ?? undefined).toBe(before.bitDepth ?? undefined);
    expect(state.layers[0]!.pixels ?? null).toBeNull();
    expect(useImageEditorStore.getState().undoStacks[doc.id] ?? []).toHaveLength(0);
  });

  it('refuses no-op, unknown, and raster-less conversions without history', () => {
    const doc = openDoc();
    expect(useImageEditorStore.getState().convertDocumentDepth(doc.id, 16).ok).toBe(true);
    const noop = useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    expect(noop.ok).toBe(false);
    expect((noop as { code: string }).code).toBe('already-at-depth');
    expect(useImageEditorStore.getState().convertDocumentDepth(doc.id, 64).ok).toBe(false);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);

    const empty = openDoc([makeLayer({ id: 'empty', type: 'group', bitmap: null })]);
    const none = useImageEditorStore.getState().convertDocumentDepth(empty.id, 16);
    expect(none.ok).toBe(false);
    expect((none as { code: string }).code).toBe('no-raster-layers');
  });

  it('accounts retained history bytes from pixel authorities and disposes them', () => {
    const doc = openDoc();
    useImageEditorStore.getState().convertDocumentDepth(doc.id, 16);
    const op = lastUndoOp()!;
    const expected = 4 * 4 * 4 * 2; // one 4x4 u16 authority in `after`
    expect(editorOperationRetainedBytes(op)).toBe(expected);

    useImageEditorStore.getState().clearHistory(doc.id);
    const data = (op as Extract<EditorOperation, { kind: 'convertDepth' }>).after.layers['layer-1']!
      .pixels!.data as Uint16Array;
    expect(Array.from(data).every((value) => value === 0)).toBe(true);
  });

  it('leaves ordinary 8-bit documents pixel-identical with no authority state', () => {
    const doc = openDoc();
    const state = useImageEditorStore.getState().documents.find((d) => d.id === doc.id)!;
    expect(state.layers[0]!.pixels ?? null).toBeNull();
    expect(state.metadata?.bitDepth ?? undefined).toBeUndefined();
    expect(state.metadata?.sourceBitDepth ?? undefined).toBeUndefined();
  });
});
