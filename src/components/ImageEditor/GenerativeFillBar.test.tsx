// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { createMask } from './SelectionMask';
import { MovePanel, SelectionPanel } from './ImageEditorSelectionMoveProperties';
import { describeGenerativeFillBarReferenceSlots, GenerativeFillBar } from './GenerativeFillBar';
import { setSelection } from './selectionRegistry';
import * as SourceSnapshotControls from './ImageEditorSourceSnapshotControls';

vi.mock('../../lib/imageEditorAi', () => ({
  buildGenerativeFillPrompt: ({ prompt }: { prompt: string }) => prompt,
  runGenerativeFill: vi.fn(),
}));

vi.mock('../../lib/imageEditorOperations', () => {
  const inpaintOp = {
    id: 'inpaint',
    label: 'Inpaint',
    description: 'Fill the selected area.',
    localOnly: false,
    supportsReferenceImages: false,
    supportsPrompt: true,
    supportsSearchPrompt: false,
  };
  return {
    canRunImageEditorOperation: () => ({ ok: true }),
    estimateImageEditorOperationCostUsd: () => ({ unitLabel: 'provider-defined' }),
    getImageEditorOperationsForModel: () => [inpaintOp],
    listImageEditorOperationDefinitions: () => [inpaintOp],
  };
});

vi.mock('../../lib/imageProviderCapabilities', () => ({
  listImageModelDefinitions: (providerId: string) => providerId === 'atlas'
    ? [
        {
          modelId: 'atlascloud/qwen-image/edit',
          label: 'Atlas Qwen Image Edit',
        },
      ]
    : [
        {
          modelId: 'test-inpaint-model',
          label: 'Test Inpaint Model',
        },
      ],
  getImageModelCapabilities: () => ({ referenceImages: true, maxReferenceImages: 3 }),
}));

vi.mock('../../lib/providerCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/providerCatalog')>()),
  // Treat Atlas as a configured provider so the cross-provider model list includes its models.
  getConfiguredProviders: () => ['atlas'],
}));

describe('GenerativeFillBar reference slot descriptors', () => {
  it('labels reference chips by slot and source type without exposing raw URLs', () => {
    expect(describeGenerativeFillBarReferenceSlots([
      {
        id: 'ref-url',
        label: 'Style board',
        imageUrl: 'https://cdn.example.test/private/style-board.png?token=secret',
      },
      {
        id: 'ref-copy',
        description: 'matte red nylon with black trim',
      },
      {
        id: 'ref-file',
        label: 'local-reference.png',
        imageUrl: 'data:image/png;base64,abc123',
      },
    ])).toEqual([
      {
        slotIndex: 1,
        id: 'ref-url',
        label: 'Style board',
        sourceSummary: 'image URL',
        chipLabel: 'Ref 1: Style board',
        removeTitle: 'Remove reference slot 1 (image URL)',
      },
      {
        slotIndex: 2,
        id: 'ref-copy',
        label: 'matte red nylon with black trim',
        sourceSummary: 'description',
        chipLabel: 'Ref 2: matte red nylon with black trim',
        removeTitle: 'Remove reference slot 2 (description)',
      },
      {
        slotIndex: 3,
        id: 'ref-file',
        label: 'local-reference.png',
        sourceSummary: 'embedded image',
        chipLabel: 'Ref 3: local-reference.png',
        removeTitle: 'Remove reference slot 3 (embedded image)',
      },
    ]);
    expect(JSON.stringify(describeGenerativeFillBarReferenceSlots([
      {
        id: 'ref-url',
        label: 'Style board',
        imageUrl: 'https://cdn.example.test/private/style-board.png?token=secret',
      },
    ]))).not.toContain('token=secret');
  });
});

describe('GenerativeFillBar dismissal behavior', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      tool: 'move',
      viewportContainerSize: { width: 1280, height: 800 },
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function openSelectedDocument(docId: string) {
    const doc = createEmptyImageDocument({
      id: docId,
      title: `${docId}.png`,
      width: 32,
      height: 32,
    });
    useImageEditorStore.getState().openDocument(doc);
    const selection = createMask(32, 32);
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        selection.data[y * selection.width + x] = 255;
      }
    }
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    return doc;
  }

  it('dismisses without clearing selection and stays hidden through later selection updates', async () => {
    const doc = openSelectedDocument('doc-generative-dismiss');

    act(() => {
      root.render(
        <>
          <MovePanel />
          <GenerativeFillBar />
        </>,
      );
    });

    expect(container.querySelector('button[aria-label="Dismiss generative edit"]')).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss generative edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.hasSelection).toBe(true);
    expect(container.querySelector('button[aria-label="Dismiss generative edit"]')).toBeNull();

    await act(async () => {
      useImageEditorStore.getState().setHasSelection(doc.id, true);
      useImageEditorStore.getState().bumpSelectionVersion(doc.id);
      await Promise.resolve();
    });

    expect(container.querySelector('button[aria-label="Dismiss generative edit"]')).toBeNull();
  });

  it('reopens from the Move panel after dismissal', async () => {
    openSelectedDocument('doc-generative-reopen');

    act(() => {
      root.render(
        <>
          <MovePanel />
          <GenerativeFillBar />
        </>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss generative edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const reopenButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show Generative Edit'),
    );
    expect(reopenButton).not.toBeUndefined();

    await act(async () => {
      reopenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('button[aria-label="Dismiss generative edit"]')).not.toBeNull();
  });

  it('exposes the same non-canvas reopen control from selection tools after dismissal', async () => {
    openSelectedDocument('doc-generative-selection-tool');
    useImageEditorStore.getState().setTool('magicWand');

    act(() => {
      root.render(
        <>
          <SelectionPanel showTolerance />
          <GenerativeFillBar />
        </>,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Dismiss generative edit"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const reopenButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show Generative Edit'),
    );
    expect(reopenButton).not.toBeUndefined();
  });

  it('lists models capability-first across configured providers, labelled by provider', async () => {
    openSelectedDocument('doc-generative-atlas-picker');

    act(() => {
      root.render(<GenerativeFillBar />);
    });

    // The panel opens collapsed (a pill); expand it to reveal the controls.
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Generative Edit'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    // No provider chooser: selectors are operation → model, and the model list spans configured
    // providers with each option labelled by its provider.
    const selects = Array.from(container.querySelectorAll('select'));
    const operationSelect = selects[0];
    const modelSelect = selects[1];
    expect(Array.from(operationSelect.options).map((option) => option.textContent)).toContain('Inpaint');
    const modelLabels = Array.from(modelSelect.options).map((option) => option.textContent ?? '');
    expect(modelLabels.some((label) => label.includes('Atlas Qwen Image Edit') && label.includes('Atlas Cloud'))).toBe(true);
  });

  it('keeps the quick edit panel inside a portrait phone viewport', () => {
    openSelectedDocument('doc-generative-phone-fit');
    useImageEditorStore.setState({
      viewportContainerSize: { width: 390, height: 844 },
    });

    act(() => {
      root.render(<GenerativeFillBar />);
    });

    // Expand the collapsed pill into the full panel (which carries the width/maxHeight layout).
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Generative Edit'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dismissButton = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss generative edit"]');
    const panel = dismissButton?.closest<HTMLDivElement>('div[style*="width"]');
    expect(panel).toBeTruthy();

    const left = Number.parseFloat(panel?.style.left ?? '');
    const top = Number.parseFloat(panel?.style.top ?? '');
    const width = Number.parseFloat(panel?.style.width ?? '');
    const maxHeight = Number.parseFloat(panel?.style.maxHeight ?? '');

    expect(left + width).toBeLessThanOrEqual(390);
    expect(maxHeight).toBeLessThanOrEqual(844 - top - 8);
    expect(panel?.style.overflowY).toBe('auto');
  });
});

describe('Image Source Library handoff descriptors', () => {
  function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
    return {
      id: 'layer-source',
      name: 'Linked paintover',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      ...overrides,
    };
  }

  function makeSourceItem(overrides: Partial<SourceBinLibraryItem> = {}): SourceBinLibraryItem {
    return {
      id: 'source-generated',
      label: 'Generated panel.png',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: 'blob:generated-panel',
      createdAt: 12,
      isGenerated: true,
      ...overrides,
    };
  }

  it('builds deterministic source-linked asset descriptors and warns on blob-only handoff URLs', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-handoff',
      title: 'Panel edit',
      width: 320,
      height: 180,
      sourceBinItemId: 'source-generated',
    });
    const layer = makeLayer({
      metadata: {
        smartLinkedSourceId: 'source-generated',
        sourceLabel: 'Generated panel.png',
        sourceMimeType: 'image/png',
        sourceLink: {
          id: 'source-generated',
          label: 'Generated panel.png',
          width: 320,
          height: 180,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const sourceItem = makeSourceItem();
    const describeImageSourceLibraryHandoff = (
      SourceSnapshotControls as typeof SourceSnapshotControls & {
        describeImageSourceLibraryHandoff?: (input: {
          doc: ImageDocument;
          layer: ImageLayer;
          sourceItem?: SourceBinLibraryItem;
        }) => unknown;
      }
    ).describeImageSourceLibraryHandoff;

    expect(describeImageSourceLibraryHandoff).toBeTypeOf('function');
    expect(describeImageSourceLibraryHandoff?.({ doc, layer, sourceItem })).toEqual({
      descriptorId: 'image-source-library-handoff:v1',
      documentId: 'doc-handoff',
      layerId: 'layer-source',
      label: 'Generated panel.png',
      mimeType: 'image/png',
      sourceId: 'source-generated',
      sourceKind: 'source-linked-layer',
      sourceDimensions: { width: 320, height: 180 },
      asset: {
        assetUrlKind: 'blob',
        blobOnly: true,
        durableAsset: false,
        hasAssetUrl: true,
      },
      sendTo: {
        flow: {
          ready: false,
          reason: 'Persist blob-only Source Library asset "source-generated" before sending it to Flow.',
          target: 'flow',
        },
        video: {
          ready: false,
          reason: 'Persist blob-only Source Library asset "source-generated" before sending it to Video.',
          target: 'video',
        },
        paper: {
          ready: false,
          reason: 'Persist blob-only Source Library asset "source-generated" before placing it in Paper.',
          target: 'paper',
        },
      },
      warnings: [
        {
          code: 'blob-only-asset',
          message: 'Source Library item "source-generated" only has a browser blob URL; persist it before cross-workspace handoff.',
        },
      ],
      previewSignature: 'image-source-library-handoff:v1:{"documentId":"doc-handoff","layerId":"layer-source","sourceId":"source-generated","assetUrlKind":"blob","blobOnly":true,"warnings":["blob-only-asset"]}',
    });
  });

  it('summarizes reference snapshots with durable source ids for handoff checks', () => {
    const snapshotLayer = makeLayer({
      id: 'snapshot-layer',
      name: 'Snapshot linked layer',
      metadata: {
        smartLinkedSourceId: 'source-1',
        sourceLabel: 'Panel source',
        sourceLink: {
          id: 'source-1',
          label: 'Panel source',
          width: 64,
          height: 48,
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-snapshots',
        title: 'Snapshot refs',
        width: 128,
        height: 96,
      }),
      snapshots: [
        {
          id: 'snapshot-before',
          name: 'Before paint',
          createdAt: 42,
          width: 128,
          height: 96,
          layers: [snapshotLayer],
          activeLayerId: 'snapshot-layer',
          hasSelection: true,
          selectionVersion: 3,
        },
      ],
    };
    const describeImageReferenceSnapshotsHandoff = (
      SourceSnapshotControls as typeof SourceSnapshotControls & {
        describeImageReferenceSnapshotsHandoff?: (doc: ImageDocument) => unknown;
      }
    ).describeImageReferenceSnapshotsHandoff;

    expect(describeImageReferenceSnapshotsHandoff).toBeTypeOf('function');
    expect(describeImageReferenceSnapshotsHandoff?.(doc)).toEqual({
      descriptorId: 'image-reference-snapshots-handoff:v1',
      documentId: 'doc-snapshots',
      snapshotCount: 1,
      snapshots: [
        {
          activeLayerId: 'snapshot-layer',
          createdAt: 42,
          hasSelection: true,
          height: 96,
          layerCount: 1,
          missingSourceLayerIds: [],
          name: 'Before paint',
          selectionVersion: 3,
          snapshotId: 'snapshot-before',
          sourceIds: ['source-1'],
          width: 128,
        },
      ],
      warnings: [],
      previewSignature: 'image-reference-snapshots-handoff:v1:{"documentId":"doc-snapshots","snapshots":[{"snapshotId":"snapshot-before","sourceIds":["source-1"],"missingSourceLayerIds":[]}]}',
    });
  });
});
