import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pixelTransport = vi.hoisted(() => ({
  decodeLayer: vi.fn(),
  encodeLayer: vi.fn(),
}));

vi.mock('../components/ImageEditor/ImageLayerProjectPixels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ImageEditor/ImageLayerProjectPixels')>();
  return {
    ...actual,
    decodeImageLayerProjectPixels: (...args: Parameters<typeof actual.decodeImageLayerProjectPixels>) => (
      pixelTransport.decodeLayer(...args)
    ),
    encodeImageLayerProjectPixels: (...args: Parameters<typeof actual.encodeImageLayerProjectPixels>) => (
      pixelTransport.encodeLayer(...args)
    ),
  };
});

import { useImageEditorStore, type ImageDiscardedDocumentRecovery } from './imageEditorStore';
import type {
  EditorOperation,
  ImageDocument,
  ImageLayer,
  LayerBitmap,
} from '../types/imageEditor';

class RecoveryCanvas {
  static instances: RecoveryCanvas[] = [];
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    RecoveryCanvas.instances.push(this);
  }

  getContext() {
    return { drawImage: vi.fn() };
  }
}

function layer(id: string, bitmap: LayerBitmap | null = null): ImageLayer {
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
    bitmap,
    bitmapVersion: 1,
    mask: null,
  };
}

function document(id: string, layers: ImageLayer[]): ImageDocument {
  return {
    id,
    title: id,
    width: 8,
    height: 6,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    activeLayerEditTarget: 'layer',
    selectedLayerIds: [],
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: true,
  };
}

function recovery(snapshot: ImageDocument): ImageDiscardedDocumentRecovery {
  return {
    id: `recovery-${snapshot.id}`,
    batchId: 'recovery-batch',
    reason: 'crash-recovery',
    capturedAt: 1,
    originalIndex: 0,
    wasActive: true,
    snapshot,
  };
}

beforeEach(() => {
  RecoveryCanvas.instances = [];
  globalThis.OffscreenCanvas = RecoveryCanvas as unknown as typeof OffscreenCanvas;
  pixelTransport.decodeLayer.mockReset();
  pixelTransport.encodeLayer.mockReset();
  useImageEditorStore.setState({
    documents: [],
    activeDocId: null,
    undoStacks: {},
    redoStacks: {},
    discardedDocumentRecoveries: [],
  });
});

afterEach(() => {
  useImageEditorStore.setState({
    documents: [],
    activeDocId: null,
    undoStacks: {},
    redoStacks: {},
    discardedDocumentRecoveries: [],
  });
});

describe('Image discarded-document recovery resource ownership', () => {
  it('disposes every completed retained history clone when another encode branch rejects', async () => {
    const historyBitmap = new RecoveryCanvas(8, 6) as unknown as LayerBitmap;
    const first = document('encode-success', [layer('success-layer')]);
    const second = document('encode-failure', [layer('failure-layer')]);
    const operation: EditorOperation = {
      kind: 'paint',
      docId: first.id,
      layerId: 'success-layer',
      before: historyBitmap,
      after: historyBitmap,
    };
    useImageEditorStore.setState({
      documents: [first, second],
      activeDocId: first.id,
      undoStacks: { [first.id]: [operation] },
      redoStacks: {},
    });
    pixelTransport.encodeLayer.mockImplementation(async (candidate: ImageLayer) => {
      if (candidate.id === 'failure-layer') throw new Error('encode failed');
      return { ...candidate, bitmap: null, mask: null };
    });

    await expect(useImageEditorStore.getState().prepareDocumentRecovery(
      [first.id, second.id],
      'crash-recovery',
    )).rejects.toThrow('encode failed');

    const retainedClones = RecoveryCanvas.instances.filter(
      (canvas) => canvas !== historyBitmap as unknown as RecoveryCanvas,
    );
    expect(retainedClones).toHaveLength(1);
    expect(retainedClones[0]).toMatchObject({ width: 0, height: 0 });
    expect(historyBitmap).toMatchObject({ width: 8, height: 6 });
  });

  it('disposes decoded live layer bitmaps when a later layer decode rejects', async () => {
    const decoded = new RecoveryCanvas(8, 6) as unknown as LayerBitmap;
    const entry = recovery(document('decode-failure', [layer('first'), layer('second')]));
    useImageEditorStore.setState({ discardedDocumentRecoveries: [entry] });
    pixelTransport.decodeLayer.mockImplementation(async (candidate: ImageLayer) => {
      if (candidate.id === 'second') throw new Error('decode failed');
      return { ...candidate, bitmap: decoded };
    });

    await expect(useImageEditorStore.getState().restoreDiscardedDocument(entry.id))
      .rejects.toThrow('decode failed');

    expect(decoded).toMatchObject({ width: 0, height: 0 });
    expect(useImageEditorStore.getState().documents).toEqual([]);
  });

  it('disposes decoded live layer bitmaps when the recovery is removed during decode', async () => {
    const decoded = new RecoveryCanvas(8, 6) as unknown as LayerBitmap;
    const entry = recovery(document('stale-recovery', [layer('only')]));
    useImageEditorStore.setState({ discardedDocumentRecoveries: [entry] });
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    pixelTransport.decodeLayer.mockImplementation(async (candidate: ImageLayer) => {
      entered();
      await blocked;
      return { ...candidate, bitmap: decoded };
    });

    const restoring = useImageEditorStore.getState().restoreDiscardedDocument(entry.id);
    await started;
    useImageEditorStore.setState({ discardedDocumentRecoveries: [] });
    release();

    await expect(restoring).resolves.toBeUndefined();
    expect(decoded).toMatchObject({ width: 0, height: 0 });
    expect(useImageEditorStore.getState().documents).toEqual([]);
  });
});
