import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS, type ImageLayer, type LayerBitmap } from '../../../types/imageEditor';
import { getVectorPathDocumentPoints } from '../ImageVectorShape';
import type { ToolEnv } from './types';

class FakeCanvasContext {
  beginPath() {}
  rect() {}
  ellipse() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  bezierCurveTo() {}
  fill() {}
  stroke() {}
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
  drawImage() {}
  getImageData() {
    return {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    } as ImageData;
  }
  putImageData() {}
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(64, 64) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeEnv(docId: string): ToolEnv {
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((candidate) => candidate.id === docId)!;
  return {
    doc,
    activeLayer: doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null,
    backgroundColor: '#000000',
    brushSettings: store.brushSettings,
    cropToolSettings: store.cropToolSettings,
    gradientToolSettings: store.gradientToolSettings,
    selectionToolSettings: store.selectionToolSettings,
    shapeToolSettings: {
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#22cc88',
      fillOpacity: 0.8,
      strokeColor: '#1144ff',
      strokeOpacity: 0.6,
      strokeWidth: 6,
    },
    screenToDoc: (point: { x: number; y: number }) => point,
    docToScreen: (point: { x: number; y: number }) => point,
    pushOperation: vi.fn((operation) => store.pushOperation(operation)),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store,
  } as unknown as ToolEnv;
}

function pointerEvent(buttons = 1): PointerEvent {
  return {
    buttons,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

describe('penTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('commits a retained vector path layer from sequential anchor clicks when Enter confirms the path', async () => {
    const { penTool } = await import('./penTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-pen-path',
        title: 'Pen Path',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-pen-path');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    penTool.onPointerDown?.(env, { x: 24, y: 28 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 84, y: 28 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 84, y: 76 }, mods, {} as PointerEvent);
    penTool.onKeyDown?.(env, 'Enter', mods, {} as KeyboardEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-pen-path');
    const created = doc?.layers.find((layer) => layer.id !== 'background') as
      | (ImageLayer & {
          metadata?: {
            vectorShape?: {
              kind?: string;
              closed?: boolean;
              points?: Array<{ x: number; y: number }>;
            };
          };
        })
      | undefined;

    expect(doc?.layers).toHaveLength(2);
    expect(created?.type).toBe('vector');
    expect(created?.x).toBe(24);
    expect(created?.y).toBe(28);
    expect(created?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 48 },
      ],
    });
    expect(useImageEditorStore.getState().undoStacks['doc-pen-path']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-pen-path',
    });
  });

  it('reports an active creation session and commits the path on double-click', async () => {
    const { penTool, isPenSessionActive, commitActivePenPath } = await import('./penTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-pen-dbl', title: 'Pen Dbl', width: 320, height: 240 }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });
    const env = makeEnv('doc-pen-dbl');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    expect(isPenSessionActive('doc-pen-dbl')).toBe(false);
    penTool.onPointerDown?.(env, { x: 20, y: 20 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 90, y: 20 }, mods, {} as PointerEvent);
    // A session is active during creation — the canvas uses this to suppress the editing overlay
    // so its handles can't swallow the clicks that add the next anchor.
    expect(isPenSessionActive('doc-pen-dbl')).toBe(true);
    expect(isPenSessionActive('other-doc')).toBe(false);

    // Double-click finishes the path.
    expect(commitActivePenPath(env)).toBe(true);
    expect(isPenSessionActive('doc-pen-dbl')).toBe(false);
    const doc = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-pen-dbl');
    expect(doc?.layers.some((l) => l.type === 'vector')).toBe(true);
  });

  it('cancels an in-progress path session without leaving preview vector layers behind', async () => {
    const { penTool } = await import('./penTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-pen-cancel',
        title: 'Pen Cancel',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-pen-cancel');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    penTool.onPointerDown?.(env, { x: 32, y: 40 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 96, y: 40 }, mods, {} as PointerEvent);
    penTool.onKeyDown?.(env, 'Escape', mods, {} as KeyboardEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-pen-cancel');
    expect(doc?.layers.map((layer) => layer.id)).toEqual(['background']);
    expect(useImageEditorStore.getState().undoStacks['doc-pen-cancel'] ?? []).toHaveLength(0);
  });

  it('closes a retained path by clicking back on the first anchor without duplicating that anchor', async () => {
    const { penTool } = await import('./penTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-pen-closed-path',
        title: 'Pen Closed Path',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-pen-closed-path');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    penTool.onPointerDown?.(env, { x: 24, y: 28 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 84, y: 28 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 84, y: 76 }, mods, {} as PointerEvent);
    penTool.onPointerDown?.(env, { x: 24, y: 28 }, mods, {} as PointerEvent);
    penTool.onKeyDown?.(env, 'Enter', mods, {} as KeyboardEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-pen-closed-path');
    const created = doc?.layers.find((layer) => layer.id !== 'background') as
      | (ImageLayer & {
          metadata?: {
            vectorShape?: {
              kind?: string;
              closed?: boolean;
              points?: Array<{ x: number; y: number }>;
            };
          };
        })
      | undefined;

    expect(doc?.layers).toHaveLength(2);
    expect(created?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 48 },
      ],
    });
  });

  it('creates retained Bezier in/out handles when Pen anchors are click-dragged before commit', async () => {
    const { penTool } = await import('./penTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-pen-bezier-path',
        title: 'Pen Bezier Path',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-pen-bezier-path');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    penTool.onPointerDown?.(env, { x: 24, y: 28 }, mods, pointerEvent());
    penTool.onPointerMove?.(env, { x: 44, y: 28 }, mods, pointerEvent());
    penTool.onPointerUp?.(env, { x: 44, y: 28 }, mods, pointerEvent(0));
    penTool.onPointerDown?.(env, { x: 104, y: 76 }, mods, pointerEvent());
    penTool.onPointerMove?.(env, { x: 84, y: 96 }, mods, pointerEvent());
    penTool.onPointerUp?.(env, { x: 84, y: 96 }, mods, pointerEvent(0));
    penTool.onKeyDown?.(env, 'Enter', mods, {} as KeyboardEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-pen-bezier-path');
    const created = doc?.layers.find((layer) => layer.id !== 'background');

    expect(created?.type).toBe('vector');
    expect(created ? getVectorPathDocumentPoints(created) : []).toEqual([
      { x: 24, y: 28, inHandle: { x: 4, y: 28 }, outHandle: { x: 44, y: 28 } },
      { x: 104, y: 76, inHandle: { x: 124, y: 56 }, outHandle: { x: 84, y: 96 } },
    ]);
    expect(created?.vectorRecipe).toContain('C 40 0 120 28 100 48');
  });

  it('describes the Pen tool as a retained cubic workflow with practical curvature and selection interactions', async () => {
    const { describePenToolWorkflow } = await import('./penTool');

    const descriptor = describePenToolWorkflow({
      requireBezierHandles: true,
      requireCurvatureMode: true,
    });

    expect(descriptor).toMatchObject({
      pathStorage: 'vector-layer',
      segmentGeometry: 'straight-or-cubic-bezier',
      commitKeys: ['Enter'],
      cancelKeys: ['Escape'],
      creationSession: {
        kind: 'path-creation',
        storage: 'preview-vector-layer',
        commitAction: 'commit-retained-vector-path-layer',
        cancelAction: 'restore-pre-session-layer-stack',
        previewId: 'pen-tool:path-creation',
      },
      editSession: {
        kind: 'path-anchor-editing',
        supported: true,
        owner: 'paths-panel-anchor-controls',
        availability: 'after-commit',
        selection: 'single-or-multi-anchor-descriptor',
        moveOperation: 'delegated-retained-path-anchor-move',
        limitation: 'Curvature creation, Corner/Smooth conversion, and direct anchor editing are retained; text on path and live boolean stacks remain unavailable.',
      },
      pathClassification: {
        savedPath: 'layer-backed-vector-path',
        workPath: 'pen-preview-vector-layer',
        independentSavedPaths: false,
      },
      supportStatus: {
        bezierHandles: 'supported',
        curvatureMode: 'supported',
        anchorConversion: 'supported',
      },
      selectionSemantics: {
        independentDirectSelection: true,
        independentPathSelection: true,
      },
    });
    expect(descriptor.capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      gesture: capability.gesture,
      result: capability.result,
    }))).toEqual([
      {
        kind: 'add-straight-anchor',
        supported: true,
        gesture: 'click',
        result: 'straight-segment-anchor',
      },
      {
        kind: 'close-straight-path',
        supported: true,
        gesture: 'click-first-anchor',
        result: 'closed-straight-segment-path',
      },
      {
        kind: 'live-preview-vector-layer',
        supported: true,
        gesture: 'move',
        result: 'preview-vector-path-layer',
      },
      {
        kind: 'commit-retained-path',
        supported: true,
        gesture: 'Enter',
        result: 'undoable-vector-path-layer',
      },
      {
        kind: 'cancel-preview-path',
        supported: true,
        gesture: 'Escape',
        result: 'restore-pre-session-layers',
      },
      {
        kind: 'bezier-handles',
        supported: true,
        gesture: 'click-drag-anchor-or-drag-retained-handle',
        result: 'retained-cubic-bezier-handles',
      },
      {
        kind: 'curvature-mode',
        supported: true,
        gesture: 'click-drag-anchor',
        result: 'retained-cubic-bezier-anchor',
      },
      {
        kind: 'anchor-conversion',
        supported: true,
        gesture: 'paths-panel-corner-or-smooth',
        result: 'undoable-retained-anchor-conversion',
      },
      {
        kind: 'independent-direct-selection',
        supported: true,
        gesture: 'paths-panel-direct-edit-selected-anchor',
        result: 'canvas-retained-anchor-overlay',
      },
      {
        kind: 'independent-path-selection',
        supported: true,
        gesture: 'paths-panel-select-path',
        result: 'active-retained-path-layer',
      },
    ]);
    expect(descriptor.warnings).toEqual([]);
    expect(descriptor).toMatchObject({
      booleanReadiness: {
        mode: 'separate-layer-boolean-actions-only',
        supportsLiveBooleanStack: false,
        supportsBezierOperands: false,
        supportsOverlapResolution: false,
      },
      handoffCaveats: {
        svg: [
          'svg-export-flattens-retained-cubic-bezier-path-data',
          'svg-export-does-not-preserve-live-boolean-stack',
        ],
        psd: [
          'psd-export-keeps-layer-backed-path-only',
          'native-psd-pen-path-roundtrip-not-guaranteed',
        ],
      },
    });
    expect(descriptor.previewId).toBe('pen-tool-workflow:v2');
    expect(descriptor.previewSignature).toContain('"segmentGeometry":"straight-or-cubic-bezier"');
    expect(descriptor.previewSignature).toContain('"supportStatus":{"bezierHandles":"supported"');
    expect(descriptor.previewSignature).toContain('"kind":"bezier-handles","supported":true,"result":"retained-cubic-bezier-handles"');
    expect(descriptor.previewSignature).not.toContain('unsupported-bezier-handles');
  });

  it('reports the Pen first-anchor close gesture as supported workflow capability', async () => {
    const { describePenToolWorkflow } = await import('./penTool');

    const closeCapability = describePenToolWorkflow().capabilities.find((capability) => (
      capability.kind === 'close-straight-path'
    ));

    expect(closeCapability).toMatchObject({
      kind: 'close-straight-path',
      supported: true,
      gesture: 'click-first-anchor',
      result: 'closed-straight-segment-path',
    });
  });

  it('summarizes Pen readiness across path output, interop, caveats, preview signatures, and blockers', async () => {
    const { describePenToolReadiness } = await import('./penTool');

    const readiness = describePenToolReadiness({
      points: [
        { x: 10, y: 12 },
        { x: 80, y: 12 },
        { x: 80, y: 64 },
      ],
      requireBezierHandles: true,
      requireCurvatureMode: true,
      requireTextOnPath: true,
      requireOneStepVectorMask: true,
      targetLayerId: 'portrait',
      selectedPathLayerId: 'pen-path-1',
      fillEnabled: true,
      strokeEnabled: true,
    });

    expect(readiness).toMatchObject({
      status: 'limited-ready',
      pointCreationState: {
        mode: 'adding-straight-anchors',
        pointCount: 3,
        previewPoint: 'not-tracked-by-descriptor',
        canPreviewPath: true,
        canCommitPath: true,
      },
      straightSegmentPathSupport: {
        status: 'supported',
        geometry: 'straight-segment',
        minimumCommitPoints: 2,
        pointCount: 3,
        canCommit: true,
      },
      liveSession: {
        preview: 'supported',
        commit: 'supported',
        cancel: 'supported',
        previewLayerPersistence: 'temporary-until-commit',
        commitKeys: ['Enter'],
        cancelKeys: ['Escape'],
      },
      pathLayerOutput: {
        status: 'supported',
        outputKind: 'retained-vector-path-layer',
        shapeKind: 'path',
        layerBackedPath: true,
        editableAfterCommit: true,
      },
      interop: {
        selectionFromPath: 'supported',
        fillPath: 'supported',
        strokePath: 'supported',
        vectorMaskFromPath: 'supported-two-step',
        oneStepVectorMaskFromPen: 'unsupported',
      },
      missingStates: {
        bezierHandles: 'supported',
        curvatureMode: 'supported',
        textOnPath: 'unsupported',
      },
      unsupportedEditingStates: {
        bezierHandleEditing: 'supported',
        anchorConversion: 'supported',
        directSelectionTool: 'supported',
        pathSelectionTool: 'supported',
      },
      actionSuitability: {
        panelCommands: 'suitable-after-commit',
        batchActions: 'suitable-after-commit',
        macroPlayback: 'suitable-deterministic-after-commit',
        liveBezierEditing: 'suitable-after-commit',
      },
      oneStepVectorMaskCaveat: {
        status: 'two-step-required',
        message: 'Create or select a retained path layer first, then convert it to a vector mask from the Paths workflow.',
      },
    });
    expect(readiness.previewSignatures.workflow).toContain('pen-tool-workflow:v2:');
    expect(readiness.previewSignatures.readiness).toContain(
      'pen-tool-readiness:v1:{"status":"limited-ready","pointCount":3,"canCommit":true,"targetLayerId":"portrait","selectedPathLayerId":"pen-path-1"',
    );
    expect(readiness.previewSignatures.readiness).toContain('"blockers":["one-step-vector-mask-unsupported"]');
    expect(readiness.previewSignatures.readiness).toContain('"bezier":"pen-bezier-handles:v1:');
    expect(readiness.previewSignatures.readiness).toContain('"textOnPath":"pen-text-on-path:v1:');
    expect(readiness.operationBlockers).toEqual([
      {
        code: 'one-step-vector-mask-unsupported',
        severity: 'warning',
        operation: 'create-vector-mask-directly-from-active-pen-session',
        message: 'Pen paths can become vector masks after they are committed as retained path layers; direct one-step Pen-to-mask creation is not available.',
      },
    ]);
    expect(readiness.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-text-on-path',
      'one-step-vector-mask-unsupported',
    ]);
  });

  it('blocks Pen commit readiness when fewer than two straight anchors are available', async () => {
    const { describePenToolReadiness } = await import('./penTool');

    const readiness = describePenToolReadiness({
      points: [{ x: 10, y: 12 }],
      fillEnabled: false,
      strokeEnabled: false,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.pointCreationState).toEqual({
      mode: 'adding-straight-anchors',
      pointCount: 1,
      previewPoint: 'not-tracked-by-descriptor',
      canPreviewPath: true,
      canCommitPath: false,
    });
    expect(readiness.straightSegmentPathSupport).toMatchObject({
      pointCount: 1,
      canCommit: false,
    });
    expect(readiness.interop).toMatchObject({
      fillPath: 'blocked-no-style',
      strokePath: 'blocked-no-style',
      vectorMaskFromPath: 'blocked-no-committed-path',
    });
    expect(readiness.operationBlockers).toEqual([
      {
        code: 'insufficient-anchors',
        severity: 'error',
        operation: 'commit-retained-path',
        message: 'A retained Pen path requires at least two clicked anchors before commit.',
      },
      {
        code: 'missing-committed-path-layer',
        severity: 'error',
        operation: 'convert-path-to-vector-mask',
        message: 'Vector-mask conversion requires a committed retained path layer selection.',
      },
    ]);
    expect(readiness.actionSuitability).toEqual({
      panelCommands: 'blocked-until-commit',
      batchActions: 'blocked',
      macroPlayback: 'blocked',
      liveBezierEditing: 'blocked-until-commit',
    });
    expect(readiness.previewSignatures.readiness).toContain(
      'pen-tool-readiness:v1:{"status":"blocked","pointCount":1,"canCommit":false,"targetLayerId":null,"selectedPathLayerId":null',
    );
    expect(readiness.previewSignatures.readiness).toContain('"blockers":["insufficient-anchors","missing-committed-path-layer"]');
    expect(readiness.previewSignatures.readiness).toContain('"bezier":"pen-bezier-handles:v1:');
  });

  it('exposes typed Bezier handle readiness as implemented while keeping text-on-path unsupported', async () => {
    const { describePenToolReadiness } = await import('./penTool');

    const readiness = describePenToolReadiness({
      points: [
        { x: 10, y: 12 },
        { x: 80, y: 12 },
        { x: 80, y: 64 },
      ],
      selectedPathLayerId: 'path-typed-1',
      requireBezierHandles: true,
      requireCurvatureMode: true,
      requireTextOnPath: true,
    });

    expect(readiness.bezierHandleReadiness).toEqual({
      state: 'ready',
      inputGesture: 'click-drag-anchor-or-drag-retained-handle',
      storedHandleModel: 'retained-in-out-handles',
      canCreateSmoothAnchors: true,
      canEditInOutHandles: true,
      blockerCodes: [],
      signature: 'pen-bezier-handles:v1:{"state":"ready","inputGesture":"click-drag-anchor-or-drag-retained-handle","storedHandleModel":"retained-in-out-handles","canCreateSmoothAnchors":true,"canEditInOutHandles":true,"blockerCodes":[]}',
    });
    expect(readiness.textOnPathReadiness).toEqual({
      state: 'unsupported',
      canAttachTextLayer: false,
      canEditBaselineOffset: false,
      canEditBezierTextFlow: false,
      caveats: ['bezier-text-on-path-editing-unsupported', 'text-on-path-layout-engine-missing'],
      signature: 'pen-text-on-path:v1:{"state":"unsupported","canAttachTextLayer":false,"canEditBaselineOffset":false,"canEditBezierTextFlow":false,"caveats":["bezier-text-on-path-editing-unsupported","text-on-path-layout-engine-missing"]}',
    });
    expect(readiness.previewSignatures.readiness).toContain('"bezier":"pen-bezier-handles:v1:');
    expect(readiness.previewSignatures.readiness).toContain('"textOnPath":"pen-text-on-path:v1:');
  });
});
