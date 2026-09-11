import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../store/imageEditorStore';
import type { ImageDocument, ImageLayer, SmartSource } from '../types/imageEditor';

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  rerasterize: vi.fn(),
}));

vi.mock('../components/ImageEditor/ImageAdjustmentLayer', () => ({
  renderImageDocumentLayersToBitmap: mocks.render,
}));

vi.mock('../components/ImageEditor/smartObjects/SmartObjectRender', () => ({
  rerasterizeSmartObjectInstances: mocks.rerasterize,
}));

import {
  buildPaperLinkedEditReturnItem,
  describeLinkedEditTarget,
  getLinkedEditTargetWorkspace,
  returnLinkedImageEdit,
} from './imageLinkedEdit';

describe('linked image edits', () => {
  it('maps linked-edit origins to their workspaces and labels', () => {
    const paper = { kind: 'paper-frame', pageId: 'p1', frameId: 'f1', sourceLabel: 'panel.png' } as const;
    const slimg = { kind: 'slimg-node', filePath: '/tmp/x.slimg' } as const;

    expect(getLinkedEditTargetWorkspace(paper)).toBe('paper');
    expect(getLinkedEditTargetWorkspace(slimg)).toBe('flow');
    expect(getLinkedEditTargetWorkspace(undefined)).toBeUndefined();
    expect(describeLinkedEditTarget(paper)).toBe('Paper');
    expect(describeLinkedEditTarget(slimg)).toBe('Flow');
  });

  it('builds the returning Paper asset from the document and its origin frame', () => {
    const item = buildPaperLinkedEditReturnItem(
      { width: 800, height: 600 },
      { kind: 'paper-frame', pageId: 'page-2', frameId: 'frame-7', sourceLabel: 'ENV E02 · Tinaja town.png' },
      'data:image/png;base64,AAAA',
      1234,
    );

    expect(item).toEqual({
      label: 'ENV E02 · Tinaja town (edited).png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      pixelWidth: 800,
      pixelHeight: 600,
      isGenerated: false,
      sourceKey: 'paper-linked-edit:frame-7:1234',
      originNodeId: 'paper-linked-edit',
    });
  });

  it('falls back to a generic label when the source label is empty', () => {
    const item = buildPaperLinkedEditReturnItem(
      { width: 10, height: 10 },
      { kind: 'paper-frame', pageId: 'p', frameId: 'f', sourceLabel: '' },
      'data:image/png;base64,BBBB',
      1,
    );
    expect(item.label).toBe('Paper image (edited).png');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function parentLayer(sourceId: string): ImageLayer {
  return {
    id: 'parent-instance', name: 'Parent instance', type: 'image', visible: true, locked: false,
    opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 1, mask: null,
    smartObject: { sourceId, placement: { width: 2, height: 2 }, renderedVersion: 1 },
  };
}

describe('imageLinkedEdit Smart Object return lifecycle', () => {
  beforeEach(() => {
    useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
    mocks.render.mockReset();
    mocks.rerasterize.mockImplementation((document: ImageDocument) => document);
  });

  it('does not resurrect a parent instance deleted while Save & Return awaits flattening', async () => {
    const sourceId = 'smart-source';
    const source: SmartSource = {
      id: sourceId, kind: 'embedded', mimeType: 'image/png', byteLength: 4,
      sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: 'Plate', version: 1,
      embeddedBytes: new Uint8Array([1, 2, 3, 4]),
    };
    const parent = {
      ...createEmptyImageDocument({ id: 'parent-doc', title: 'Parent', width: 16, height: 16 }),
      layers: [parentLayer(sourceId)], activeLayerId: 'parent-instance',
      metadata: { smartSources: { [sourceId]: source } },
    };
    const child = {
      ...createEmptyImageDocument({ id: 'child-doc', title: 'Child', width: 2, height: 2 }),
      linkedEdit: { kind: 'smart-object' as const, parentDocId: parent.id, sourceId },
    };
    const pendingBlob = deferred<Blob>();
    mocks.render.mockReturnValue({ convertToBlob: vi.fn(() => pendingBlob.promise) });
    useImageEditorStore.getState().openDocument(parent);
    useImageEditorStore.getState().openDocument(child);

    const returning = returnLinkedImageEdit(child);
    expect(mocks.render).toHaveBeenCalledWith(child);
    useImageEditorStore.getState().removeLayer(parent.id, 'parent-instance');
    pendingBlob.resolve(new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/png' }));
    await returning;

    const currentParent = useImageEditorStore.getState().documents.find((document) => document.id === parent.id);
    expect(currentParent?.layers).toEqual([]);
    expect(currentParent?.metadata?.smartSources?.[sourceId]?.version).toBe(2);
    expect(mocks.rerasterize).toHaveBeenCalledWith(expect.objectContaining({ layers: [] }), sourceId, expect.anything());
  });
});
