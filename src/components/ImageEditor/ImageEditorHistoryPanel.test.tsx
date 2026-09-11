// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { EditorOperation, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { buildImageHistoryActionWorkflowDescriptor } from './ImageEditorHistory';
import { ImageEditorHistoryPanel } from './ImageEditorHistoryPanel';
import {
  buildImageDocumentSnapshotIntegrity,
  markImageDocumentSnapshotVerifiedOwned,
} from './ImageSnapshots';
import { runPhotoshopQuickAction } from './PhotoshopQuickActionRunner';

function makeLayer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: patch.id ?? 'layer-1',
    name: patch.name ?? 'Layer 1',
    type: patch.type ?? 'image',
    visible: patch.visible ?? true,
    locked: patch.locked ?? false,
    opacity: patch.opacity ?? 1,
    blendMode: patch.blendMode ?? 'normal',
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    bitmap: patch.bitmap ?? null,
    bitmapVersion: patch.bitmapVersion ?? 0,
    mask: patch.mask ?? null,
    ...patch,
  };
}

class RenderCountingBitmap {
  static reads = 0;
  width = 1;
  height = 1;
  #bytes = new Uint8ClampedArray([1, 2, 3, 255]);

  getContext() {
    return {
      drawImage: (source: LayerBitmap) => {
        const context = source.getContext('2d');
        if (!context) throw new Error('test bitmap source has no readable context');
        this.#bytes = new Uint8ClampedArray(
          context.getImageData(0, 0, source.width, source.height).data,
        );
      },
      getImageData: () => {
        RenderCountingBitmap.reads += 1;
        return { width: 1, height: 1, data: new Uint8ClampedArray(this.#bytes) };
      },
      putImageData: (imageData: ImageData) => {
        this.#bytes = new Uint8ClampedArray(imageData.data);
      },
      clearRect: () => {
        this.#bytes.fill(0);
      },
    };
  }

  async convertToBlob(): Promise<Blob> {
    return new Blob([this.#bytes]);
  }
}

describe('ImageEditorHistoryPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', RenderCountingBitmap);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      quickActionMacros: [],
      activeQuickActionRecording: null,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds deterministic workflow metadata for history, snapshots, recordings, saved actions, and fixed-command limits', () => {
    const snapshotLayers = [makeLayer({ id: 'layer-1', name: 'Paint Layer', x: 10 })];
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-history-metadata',
        title: 'History Metadata',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'layer-1', name: 'Paint Layer', x: 20 })],
      activeLayerId: 'layer-1',
      snapshots: [
        {
          id: 'snapshot-before',
          name: 'Before cleanup',
          createdAt: 100,
          updatedAt: 150,
          width: 320,
          height: 240,
          layers: snapshotLayers,
          activeLayerId: 'layer-1',
          hasSelection: false,
          selectionVersion: 2,
          pixelState: 'complete' as const,
          integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers),
        },
      ],
    };
    const undoStack: Array<EditorOperation & { label?: string }> = [
      {
        kind: 'transform',
        docId: doc.id,
        layerId: 'layer-1',
        label: 'Move to 10',
        before: { x: 0, y: 0, rotationDeg: 0 },
        after: { x: 10, y: 0, rotationDeg: 0 },
      },
      {
        kind: 'documentState',
        docId: doc.id,
        before: { ...doc, snapshots: [] },
        after: doc,
      },
    ];
    const redoStack: EditorOperation[] = [
      {
        kind: 'paint',
        docId: doc.id,
        layerId: 'layer-1',
        paintTarget: 'mask',
        before: null,
        after: null,
      },
    ];

    const descriptor = buildImageHistoryActionWorkflowDescriptor({
      doc,
      undoStack,
      redoStack,
      activeRecording: {
        startedAt: 200,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'unknownQuickCommand' },
        ],
      },
      quickActionMacros: [
        {
          id: 'macro-b',
          name: 'Batch B',
          createdAt: 40,
          updatedAt: 41,
          steps: [{ actionId: 'unknownQuickCommand' }],
        },
        {
          id: 'macro-a',
          name: 'Cleanup A',
          createdAt: 30,
          updatedAt: 31,
          steps: [{ actionId: 'nudgeLayerRightLarge' }],
        },
      ],
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-history-action-workflow:v1',
      document: {
        id: 'doc-history-metadata',
        title: 'History Metadata',
        width: 320,
        height: 240,
        layerCount: 1,
      },
      history: {
        canUndo: true,
        canRedo: true,
        undoCount: 2,
        redoCount: 1,
        currentStateLabel: 'New Snapshot',
      },
      snapshots: {
        count: 1,
        maxRetained: 12,
        canCreate: true,
        items: [
          {
            id: 'snapshot-before',
            name: 'Before cleanup',
            createdAt: 100,
            updatedAt: 150,
            width: 320,
            height: 240,
            layerCount: 1,
            activeLayerId: 'layer-1',
            canRestore: true,
            canDelete: true,
            canRename: true,
          },
        ],
      },
      recording: {
        active: true,
        startedAt: 200,
        stepCount: 2,
        canSave: true,
        steps: [
          {
            id: 'recording-step-1',
            actionId: 'nudgeLayerRightLarge',
            label: 'Transform: Nudge Layer Right 10 px',
            supported: true,
          },
          {
            id: 'recording-step-2',
            actionId: 'unknownQuickCommand',
            label: 'unknownQuickCommand',
            supported: false,
          },
        ],
      },
      savedActions: {
        count: 2,
        canPlay: true,
        canBatchPlay: true,
        macros: [
          {
            id: 'macro-a',
            name: 'Cleanup A',
            stepCount: 1,
            allStepsSupported: true,
          },
          {
            id: 'macro-b',
            name: 'Batch B',
            stepCount: 1,
            allStepsSupported: false,
          },
        ],
      },
      limitations: [
        {
          code: 'arbitrary-command-recording-unsupported',
          severity: 'info',
        },
        {
          code: 'parameterized-action-steps-unsupported',
          severity: 'info',
        },
      ],
    });
    expect(descriptor.snapshotSummary).toEqual({
      identity: 'doc-history-metadata:320x240:1-layers:1-snapshots',
      restoreTargets: ['snapshot-before'],
      deleteTargets: ['snapshot-before'],
      renameTargets: ['snapshot-before'],
      newestSnapshotId: 'snapshot-before',
    });
    expect(descriptor.snapshots.items).toEqual([
      {
        id: 'snapshot-before',
        name: 'Before cleanup',
        createdAt: 100,
        updatedAt: 150,
        width: 320,
        height: 240,
        layerCount: 1,
        activeLayerId: 'layer-1',
        hasSelection: false,
        selectionVersion: 2,
        canRestore: true,
        canDelete: true,
        canRename: true,
        isNewest: true,
        kind: 'named-snapshot',
        identity: 'snapshot-before:Before cleanup:320x240:1-layers:selection-2-complete:pixels-proven',
      },
    ]);
    expect(descriptor.actionSetSummary).toEqual({
      identity: '2-actions:2-steps:1-unsupported',
      playableActionIds: ['macro-a'],
      unavailableActionIds: ['macro-b'],
      unsupportedCommandIds: ['unknownQuickCommand'],
    });
    expect(descriptor.fixedCommandWarnings).toEqual([
      {
        code: 'arbitrary-command-recording-unsupported',
        severity: 'info',
        commandScope: 'recording',
        message: 'History Actions record and replay Sloom Studio quick action ids only; arbitrary Photoshop menu commands are not captured.',
      },
      {
        code: 'parameterized-action-steps-unsupported',
        severity: 'info',
        commandScope: 'playback',
        message: 'Recorded action steps do not store per-command parameters yet, so parameterized action playback remains unsupported.',
      },
    ]);
    expect(descriptor.savedActions.macros).toEqual([
      {
        id: 'macro-a',
        name: 'Cleanup A',
        createdAt: 30,
        updatedAt: 31,
        stepCount: 1,
        allStepsSupported: true,
        unsupportedActionIds: [],
        steps: [
          {
            id: 'macro-a-step-1',
            actionId: 'nudgeLayerRightLarge',
            label: 'Transform: Nudge Layer Right 10 px',
            supported: true,
          },
        ],
        deterministicPlayback: true,
        openDocumentBatchSupported: true,
        fileFolderBatchSupported: false,
        arbitraryCommandRecordingSupported: false,
        playbackSignature: 'image-history-action-macro:v2:{"id":"macro-a","stepIds":["nudgeLayerRightLarge"],"unsupportedActionIds":[],"allStepsSupported":true}',
      },
      {
        id: 'macro-b',
        name: 'Batch B',
        createdAt: 40,
        updatedAt: 41,
        stepCount: 1,
        allStepsSupported: false,
        unsupportedActionIds: ['unknownQuickCommand'],
        steps: [
          {
            id: 'macro-b-step-1',
            actionId: 'unknownQuickCommand',
            label: 'unknownQuickCommand',
            supported: false,
          },
        ],
        deterministicPlayback: true,
        openDocumentBatchSupported: true,
        fileFolderBatchSupported: false,
        arbitraryCommandRecordingSupported: false,
        playbackSignature: 'image-history-action-macro:v2:{"id":"macro-b","stepIds":["unknownQuickCommand"],"unsupportedActionIds":["unknownQuickCommand"],"allStepsSupported":false}',
      },
    ]);
    expect(descriptor.automationBoundary).toEqual({
      separateFromMainFlow: true,
      requiredWorkspace: 'image-automation',
      reason: 'History Actions stay in Image Automation planning/playback surfaces and are not executable from the main Flow graph.',
    });
    expect(descriptor.history.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      status: entry.status,
      targetUndoCount: entry.targetUndoCount,
      operationKind: entry.operationKind,
    }))).toEqual([
      {
        id: 'history-undo-1',
        label: 'New Snapshot',
        status: 'current',
        targetUndoCount: 2,
        operationKind: 'documentState',
      },
      {
        id: 'history-undo-0',
        label: 'Move to 10',
        status: 'past',
        targetUndoCount: 1,
        operationKind: 'transform',
      },
      {
        id: 'history-origin-past',
        label: 'Open Document',
        status: 'past',
        targetUndoCount: 0,
        operationKind: 'origin',
      },
      {
        id: 'history-redo-0',
        label: 'Paint Layer Mask',
        status: 'future',
        targetUndoCount: 3,
        operationKind: 'paint',
      },
    ]);
    expect(descriptor.previewSignature).toBe(
      'image-history-action-workflow:v1:{"document":{"id":"doc-history-metadata","width":320,"height":240,"layerCount":1,"snapshotCount":1},"history":{"undoCount":2,"redoCount":1,"currentStateLabel":"New Snapshot","entries":[{"id":"history-undo-1","status":"current","targetUndoCount":2,"label":"New Snapshot","operationKind":"documentState"},{"id":"history-undo-0","status":"past","targetUndoCount":1,"label":"Move to 10","operationKind":"transform"},{"id":"history-origin-past","status":"past","targetUndoCount":0,"label":"Open Document","operationKind":"origin"},{"id":"history-redo-0","status":"future","targetUndoCount":3,"label":"Paint Layer Mask","operationKind":"paint"}]},"snapshots":[{"id":"snapshot-before","name":"Before cleanup","createdAt":100,"updatedAt":150,"width":320,"height":240,"layerCount":1,"canRename":true,"isNewest":true,"identity":"snapshot-before:Before cleanup:320x240:1-layers:selection-2-complete:pixels-proven"}],"recording":{"active":true,"stepCount":2,"unsupportedActionIds":["unknownQuickCommand"]},"savedActions":[{"id":"macro-a","name":"Cleanup A","stepCount":1,"unsupportedActionIds":[],"playbackSignature":"image-history-action-macro:v2:{\\"id\\":\\"macro-a\\",\\"stepIds\\":[\\"nudgeLayerRightLarge\\"],\\"unsupportedActionIds\\":[],\\"allStepsSupported\\":true}"},{"id":"macro-b","name":"Batch B","stepCount":1,"unsupportedActionIds":["unknownQuickCommand"],"playbackSignature":"image-history-action-macro:v2:{\\"id\\":\\"macro-b\\",\\"stepIds\\":[\\"unknownQuickCommand\\"],\\"unsupportedActionIds\\":[\\"unknownQuickCommand\\"],\\"allStepsSupported\\":false}"}],"automationBoundary":{"separateFromMainFlow":true,"requiredWorkspace":"image-automation","reason":"History Actions stay in Image Automation planning/playback surfaces and are not executable from the main Flow graph."},"limitations":["arbitrary-command-recording-unsupported","parameterized-action-steps-unsupported"]}',
    );
  });

  it('renders history states and jumps backward and forward when a state is clicked', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-history-panel',
        title: 'History Panel',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'layer-1', x: 20, y: 0 })],
      activeLayerId: 'layer-1',
    };
    useImageEditorStore.getState().openDocument(doc);

    const op1 = {
      kind: 'transform',
      docId: doc.id,
      layerId: 'layer-1',
      label: 'Move to 10',
      before: { x: 0, y: 0, rotationDeg: 0 },
      after: { x: 10, y: 0, rotationDeg: 0 },
    } as const;
    const op2 = {
      kind: 'transform',
      docId: doc.id,
      layerId: 'layer-1',
      label: 'Move to 20',
      before: { x: 10, y: 0, rotationDeg: 0 },
      after: { x: 20, y: 0, rotationDeg: 0 },
    } as const;

    useImageEditorStore.setState({
      undoStacks: {
        [doc.id]: [op1, op2],
      },
      redoStacks: {
        [doc.id]: [],
      },
    });

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    expect(container.textContent).toContain('Current State');
    expect(container.textContent).toContain('Move to 20');
    expect(container.textContent).toContain('Move to 10');
    expect(container.textContent).toContain('Open Document');
    expect(container.textContent).toContain('New Snapshot');

    const earlierStateButton = container.querySelector<HTMLButtonElement>('button[aria-label="Restore history state Move to 10"]');
    expect(earlierStateButton).not.toBeNull();

    act(() => {
      earlierStateButton?.click();
    });

    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().redoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.x).toBe(10);

    const futureStateButton = container.querySelector<HTMLButtonElement>('button[aria-label="Restore history state Move to 20"]');
    expect(futureStateButton).not.toBeNull();

    act(() => {
      futureStateButton?.click();
    });

    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(2);
    expect(useImageEditorStore.getState().redoStacks[doc.id]).toHaveLength(0);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.x).toBe(20);
  });

  it('creates snapshots from the history panel as undoable document-state operations', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-history-snapshot',
      title: 'History Snapshot',
      width: 320,
      height: 240,
    });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const newSnapshotButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create document snapshot"]');
    expect(newSnapshotButton).not.toBeNull();

    act(() => {
      newSnapshotButton?.click();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.snapshots).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'documentState',
      docId: doc.id,
    });
  });

  it('labels legacy pixel-less snapshots and disables their restore action', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-history-legacy-snapshot',
        title: 'Legacy Snapshot',
        width: 320,
        height: 240,
      }),
      snapshots: [{
        id: 'legacy-snapshot',
        name: 'Metadata only',
        createdAt: 1,
        width: 320,
        height: 240,
        layers: [],
        activeLayerId: null,
        hasSelection: false,
        selectionVersion: 0,
        pixelState: 'unavailable' as const,
      }],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const restoreButton = container.querySelector<HTMLButtonElement>('button[aria-label="Restore snapshot Metadata only"]');
    expect(restoreButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Pixels unavailable');
  });

  it('keeps Restore disabled while a current snapshot content digest is mismatched', () => {
    const selectionMask = { width: 2, height: 2, data: new Uint8ClampedArray([0, 255, 0, 1]) };
    const layers: ImageLayer[] = [];
    const snapshot = {
      id: 'digest-mismatch-snapshot',
      name: 'Digest mismatch',
      createdAt: 2,
      width: 2,
      height: 2,
      layers,
      activeLayerId: null,
      hasSelection: true,
      selectionVersion: 1,
      selectionMask,
      pixelState: 'complete' as const,
      integrity: buildImageDocumentSnapshotIntegrity(layers, selectionMask),
    };
    selectionMask.data[3] ^= 1;
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-history-digest-mismatch',
        title: 'Digest Mismatch',
        width: 2,
        height: 2,
      }),
      snapshots: [snapshot],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const restoreButton = container.querySelector<HTMLButtonElement>('button[aria-label="Restore snapshot Digest mismatch"]');
    expect(restoreButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Pixels unavailable');
  });

  it('does not reread or hash verified snapshot pixels during React rerenders', () => {
    const bitmap = new RenderCountingBitmap() as unknown as LayerBitmap;
    const layers = [makeLayer({ id: 'cached-layer', bitmap })];
    const snapshot = markImageDocumentSnapshotVerifiedOwned({
      id: 'cached-render-snapshot',
      name: 'Cached render',
      createdAt: 3,
      width: 1,
      height: 1,
      layers,
      activeLayerId: 'cached-layer',
      hasSelection: false,
      selectionVersion: 0,
      pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(layers),
    });
    const doc = {
      ...createEmptyImageDocument({ id: 'cached-render-doc', title: 'Cached render', width: 1, height: 1 }),
      snapshots: [snapshot],
    };
    useImageEditorStore.getState().openDocument(doc);
    RenderCountingBitmap.reads = 0;

    act(() => root.render(<ImageEditorHistoryPanel />));
    act(() => root.render(<ImageEditorHistoryPanel />));

    expect(RenderCountingBitmap.reads).toBe(0);
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Restore snapshot Cached render"]')?.disabled)
      .toBe(false);
  });

  it('creates and renames snapshots with custom names from the history panel', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-history-named-snapshot',
      title: 'History Named Snapshot',
      width: 320,
      height: 240,
    });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const newSnapshotName = container.querySelector<HTMLInputElement>('input[aria-label="New snapshot name"]');
    const newSnapshotButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create document snapshot"]');
    expect(newSnapshotName).not.toBeNull();
    expect(newSnapshotButton).not.toBeNull();

    act(() => {
      if (newSnapshotName) {
        newSnapshotName.value = 'Before lettering cleanup';
        newSnapshotName.dispatchEvent(new Event('input', { bubbles: true }));
      }
      newSnapshotButton?.click();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.snapshots?.[0]?.name).toBe('Before lettering cleanup');
    expect(container.textContent).toContain('Before lettering cleanup');

    const renameButton = container.querySelector<HTMLButtonElement>('button[aria-label="Rename snapshot Before lettering cleanup"]');
    expect(renameButton).not.toBeNull();

    act(() => {
      renameButton?.click();
    });

    const snapshotNameInput = container.querySelector<HTMLInputElement>('input[aria-label="Snapshot name"]');
    expect(snapshotNameInput).not.toBeNull();

    act(() => {
      if (snapshotNameInput) {
        snapshotNameInput.value = 'Named state: final inks';
        snapshotNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const saveButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save snapshot name"]');
    expect(saveButton).not.toBeNull();

    act(() => {
      saveButton?.click();
    });

    const activeDoc = useImageEditorStore.getState().getActiveDocument();
    expect(activeDoc?.snapshots?.[0]).toMatchObject({
      name: 'Named state: final inks',
      updatedAt: expect.any(Number),
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'documentState',
      docId: doc.id,
    });
    expect(container.textContent).toContain('Named state: final inks');
  });

  it('records, saves, replays, and deletes quick action sets from the history panel', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-history-actions',
        title: 'History Actions',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'layer-1', x: 2, y: 1 })],
      activeLayerId: 'layer-1',
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const recordButton = container.querySelector<HTMLButtonElement>('button[aria-label="Start recording quick action set"]');
    expect(recordButton).not.toBeNull();

    act(() => {
      recordButton?.click();
    });

    expect(container.textContent).toContain('Recording');

    act(() => {
      runPhotoshopQuickAction('nudgeLayerRightLarge');
    });

    const saveButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save recorded quick action set"]');
    expect(saveButton).not.toBeNull();

    act(() => {
      saveButton?.click();
    });

    expect(container.textContent).toContain('Action 1');

    const activeDoc = useImageEditorStore.getState().getActiveDocument();
    expect(activeDoc?.layers[0]?.x).toBe(12);

    act(() => {
      useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', { x: 2, y: 1 });
    });

    const playButton = container.querySelector<HTMLButtonElement>('button[aria-label="Play quick action set Action 1"]');
    expect(playButton).not.toBeNull();

    act(() => {
      playButton?.click();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.x).toBe(12);

    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete quick action set Action 1"]');
    expect(deleteButton).not.toBeNull();

    act(() => {
      deleteButton?.click();
    });

    expect(container.textContent).not.toContain('Action 1');
  });

  it('renames a saved quick action set and batch-plays it across open image documents from the history panel', () => {
    const docA = {
      ...createEmptyImageDocument({
        id: 'doc-history-batch-a',
        title: 'History Batch A',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'layer-a', x: 2, y: 1 })],
      activeLayerId: 'layer-a',
    };
    const docB = {
      ...createEmptyImageDocument({
        id: 'doc-history-batch-b',
        title: 'History Batch B',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'layer-b', x: 9, y: 1 })],
      activeLayerId: 'layer-b',
    };
    useImageEditorStore.getState().openDocument(docA);
    useImageEditorStore.getState().openDocument(docB);
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-1',
        name: 'Action 1',
        createdAt: 10,
        updatedAt: 10,
        steps: [{ actionId: 'nudgeLayerRightLarge' }],
      }],
    });

    act(() => {
      root.render(<ImageEditorHistoryPanel />);
    });

    const renameButton = container.querySelector<HTMLButtonElement>('button[aria-label="Rename quick action set Action 1"]');
    expect(renameButton).not.toBeNull();

    act(() => {
      renameButton?.click();
    });

    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Quick action set name"]');
    expect(renameInput).not.toBeNull();

    act(() => {
      if (renameInput) {
        renameInput.value = 'Batch Nudge';
        renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const saveNameButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save quick action set name"]');
    expect(saveNameButton).not.toBeNull();

    act(() => {
      saveNameButton?.click();
    });

    expect(container.textContent).toContain('Batch Nudge');

    const batchPlayButton = container.querySelector<HTMLButtonElement>('button[aria-label="Play quick action set Batch Nudge on all open image documents"]');
    expect(batchPlayButton).not.toBeNull();

    act(() => {
      batchPlayButton?.click();
    });

    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'doc-history-batch-a')?.layers[0]?.x).toBe(12);
    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'doc-history-batch-b')?.layers[0]?.x).toBe(19);
    expect(container.textContent).toContain('Applied to 2 of 2 open images');
    expect(container.textContent).toContain('use Folder batch below for explicit local-folder output');
    expect(container.textContent).toContain('Image Automation, not Flow');
  });

  it('mounts the explicit local Folder batch controls beside saved Image actions', () => {
    const doc = createEmptyImageDocument({ id: 'doc-folder-batch', title: 'Folder batch', width: 32, height: 32 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-folder',
        name: 'Flatten output',
        createdAt: 10,
        updatedAt: 10,
        steps: [{ actionId: 'flattenVisible' }],
      }],
    });

    act(() => { root.render(<ImageEditorHistoryPanel />); });

    expect(container.querySelector('[data-image-folder-batch-runner="ready"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Choose local image folder for batch actions"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Saved action for local folder batch"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Run saved action over local folder"]')).not.toBeNull();
  });
});
