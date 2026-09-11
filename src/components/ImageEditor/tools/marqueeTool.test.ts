import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SELECTION_TOOL_SETTINGS, type EditorOperation } from '../../../types/imageEditor';
import { createMask, type SelectionMask } from '../SelectionMask';
import { clearAllSelections, getSelection, setSelection } from '../selectionRegistry';
import type { ToolEnv, Modifiers, Point } from './types';

const NO_MODIFIERS: Modifiers = {
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
};

function createExistingSelection(width = 20, height = 20): SelectionMask {
  const mask = createMask(width, height);
  mask.data[2 * width + 2] = 255;
  mask.data[2 * width + 3] = 255;
  mask.data[3 * width + 2] = 255;
  return mask;
}

function createMarqueeEnv(mode: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace') {
  const operations: EditorOperation[] = [];
  const requestRender = vi.fn();
  const bumpSelectionVersion = vi.fn();
  const setHasSelection = vi.fn();
  const doc = {
    id: `marquee-test-${Math.random().toString(36).slice(2)}`,
    width: 20,
    height: 20,
  };
  const env = {
    doc,
    activeLayer: null,
    brushSettings: {},
    cropToolSettings: {},
    selectionToolSettings: {
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      mode: 'replace',
      marqueeShape: 'rectangle',
    },
    screenToDoc: (point: Point): Point => point,
    docToScreen: (point: Point): Point => point,
    pushOperation: (operation: EditorOperation) => operations.push(operation),
    store: {
      bumpSelectionVersion,
      setHasSelection,
    },
    requestRender,
    resolveSelectionMode: () => mode,
  } as unknown as ToolEnv;

  return {
    env,
    operations,
    requestRender,
    bumpSelectionVersion,
    setHasSelection,
  };
}

function alphaAt(mask: SelectionMask, x: number, y: number): number {
  return mask.data[y * mask.width + x];
}

beforeEach(() => {
  clearAllSelections();
});

describe('marqueeTool workflow descriptors', () => {
  it('describes zero-area marquee geometry as invalid for commit', async () => {
    const { describeMarqueeSelectionGeometry } = await import('./marqueeTool');

    const geometry = describeMarqueeSelectionGeometry({
      start: { x: 8, y: 8 },
      current: { x: 8, y: 8 },
      square: true,
      fromCenter: true,
    });

    expect(geometry).toEqual({
      descriptorId: 'marquee-selection-geometry:v1',
      constraint: 'square',
      origin: 'center',
      bounds: { x: 8, y: 8, width: 0, height: 0 },
      areaPx: 0,
      validForCommit: false,
      invalidReason: 'zero-area-marquee',
      signature: 'marquee-selection-geometry:v1:invalid:square:center:8,8,0,0:0',
    });
  });

  it('blocks readiness when a committed marquee geometry is required but empty', async () => {
    const { describeMarqueeSelectionReadiness } = await import('./marqueeTool');

    const readiness = describeMarqueeSelectionReadiness({
      selectionSettings: {
        mode: 'replace',
        marqueeShape: 'rectangle',
        feather: 0,
        antiAlias: true,
      },
      drag: {
        start: { x: 8, y: 8 },
        current: { x: 8, y: 8 },
      },
      requireValidGeometry: true,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.geometry.validForCommit).toBe(false);
    expect(readiness.blockers).toEqual([
      {
        code: 'invalid-marquee-geometry',
        severity: 'error',
        operation: 'marquee-preview',
        message: 'A marquee selection needs non-zero width and height before it can create selection history.',
      },
    ]);
    expect(readiness.previewSignatures.blockers).toBe(
      'marquee-selection-blockers:v1:["invalid-marquee-geometry"]',
    );
  });

  it('describes marquee geometry, edge processing, output target, and limitations', async () => {
    const { describeMarqueeSelectionWorkflow } = await import('./marqueeTool');

    const descriptor = describeMarqueeSelectionWorkflow({
      selectionSettings: {
        mode: 'add',
        marqueeShape: 'ellipse',
        feather: 4,
        antiAlias: true,
      },
      drag: {
        start: { x: 10, y: 20 },
        current: { x: 30, y: 36 },
        square: true,
        fromCenter: true,
      },
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'marquee-selection-workflow:v1',
      tool: 'marquee',
      selectionMode: {
        mode: 'add',
        operation: 'add-to-existing-selection',
      },
      geometry: {
        shape: 'ellipse',
        constraint: 'square',
        origin: 'center',
        bounds: {
          x: -10,
          y: 0,
          width: 40,
          height: 40,
        },
      },
      edgeProcessing: {
        feather: {
          requestedPx: 4,
          applied: true,
        },
        antiAlias: {
          requested: true,
          applied: true,
        },
        smoothing: {
          requested: false,
          applied: false,
        },
      },
      output: {
        target: 'document-selection',
        alpha: 255,
      },
    });
    expect(descriptor.limitations.map((limitation) => limitation.code)).toEqual([
      'smoothing-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe(
      'marquee-selection-workflow:v1:{"mode":"add","shape":"ellipse","bounds":{"x":-10,"y":0,"width":40,"height":40},"constraint":"square","origin":"center","feather":{"requestedPx":4,"applied":true},"antiAlias":{"requested":true,"applied":true},"limitations":["smoothing-unsupported"]}',
    );
  });

  it('summarizes marquee readiness across shapes, combine modes, edge modes, interop, caveats, and signatures', async () => {
    const { describeMarqueeSelectionReadiness } = await import('./marqueeTool');

    const readiness = describeMarqueeSelectionReadiness({
      selectionSettings: {
        mode: 'subtract',
        marqueeShape: 'rectangle',
        feather: 2.25,
        antiAlias: false,
      },
      drag: {
        start: { x: 4, y: 6 },
        current: { x: 14, y: 10 },
      },
      hasActiveSelection: true,
      savedAlphaChannelCount: 2,
      requireSoftFeatherPreview: true,
      requireSmoothing: true,
      requireTransformSelection: true,
      requireSavedSelectionRoundTrip: true,
    });

    expect(readiness).toMatchObject({
      descriptorId: 'marquee-selection-readiness:v1',
      status: 'limited-ready',
      shapes: {
        supported: [
          {
            shape: 'rectangle',
            geometry: 'axis-aligned-rectangle',
            squareConstraint: 'shift-key',
            fromCenter: 'alt-key',
            rasterizer: 'setRect',
          },
          {
            shape: 'ellipse',
            geometry: 'axis-aligned-ellipse',
            squareConstraint: 'shift-key',
            fromCenter: 'alt-key',
            rasterizer: 'setEllipse',
          },
        ],
        active: 'rectangle',
      },
      edgeModes: {
        feather: {
          requestedPx: 2.25,
          settingStored: true,
          preview: 'feathered-mask',
          appliedToSelectionMask: true,
        },
        antiAlias: {
          requested: false,
          preview: 'binary-edge',
          appliedToSelectionMask: false,
        },
        smoothing: {
          requested: true,
          preview: 'unsupported',
          appliedToSelectionMask: false,
        },
      },
      transformInterop: {
        status: 'supported-after-selection-commit',
        owner: 'ImageSelectionTransform',
        supportedHandles: ['move', 'resize', 'rotate', 'skew', 'distort'],
        unsupportedHandles: ['perspective', 'warp'],
        input: 'document-selection-registry',
        output: 'undoable-selection-history',
      },
      saveLoadInterop: {
        currentSelectionPersistence: 'session-selection-registry',
        savedSelectionPersistence: 'document-alpha-channel-metadata',
        status: 'supported-alpha-channel-round-trip',
        savedAlphaChannelCount: 2,
        operations: [
          {
            operation: 'save-selection-as-alpha-channel',
            status: 'ready',
            source: 'document-selection-registry',
            target: 'document-alpha-channel-metadata',
          },
          {
            operation: 'load-selection-replace',
            status: 'ready',
            source: 'document-alpha-channel-metadata',
            target: 'document-selection-registry',
          },
          {
            operation: 'load-selection-add',
            status: 'ready',
            source: 'document-alpha-channel-metadata',
            target: 'document-selection-registry',
          },
          {
            operation: 'load-selection-subtract',
            status: 'ready',
            source: 'document-alpha-channel-metadata',
            target: 'document-selection-registry',
          },
          {
            operation: 'load-selection-intersect',
            status: 'ready',
            source: 'document-alpha-channel-metadata',
            target: 'document-selection-registry',
          },
        ],
      },
    });
    expect(readiness.selectionCombineModes).toEqual([
      {
        mode: 'replace',
        operation: 'replace-existing-selection',
        previewTarget: 'document-selection-registry',
        commitTarget: 'document-selection-history',
      },
      {
        mode: 'add',
        operation: 'add-to-existing-selection',
        previewTarget: 'document-selection-registry',
        commitTarget: 'document-selection-history',
      },
      {
        mode: 'subtract',
        operation: 'remove-from-existing-selection',
        previewTarget: 'document-selection-registry',
        commitTarget: 'document-selection-history',
      },
      {
        mode: 'intersect',
        operation: 'keep-overlap-with-existing-selection',
        previewTarget: 'document-selection-registry',
        commitTarget: 'document-selection-history',
      },
    ]);
    expect(readiness.previewCaveats.map((caveat) => caveat.code)).toEqual([
      'smoothing-unsupported',
    ]);
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'smoothing-pass-unsupported',
    ]);
    expect(readiness.keyboardModifierCaveats).toEqual([
      {
        input: 'shift',
        behavior: 'square-constraint-and-add-mode-when-resolved-by-environment',
        caveat: 'Shift constrains geometry during drag; selection add/subtract semantics come from the shared modifier resolver.',
      },
      {
        input: 'alt',
        behavior: 'draw-from-center-and-subtract-mode-when-resolved-by-environment',
        caveat: 'Alt changes marquee origin during drag; subtract semantics depend on environment resolution.',
      },
      {
        input: 'escape',
        behavior: 'cancel-active-marquee-preview',
        caveat: 'Cancel clears preview state without committing selection history.',
      },
    ]);
    expect(readiness.batchActionSuitability).toEqual({
      status: 'limited-ready',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: 'Marquee geometry can be recorded, but batch playback must revalidate document bounds and active selection combine mode.',
    });
    expect(readiness.previewSignatures.workflow).toBe(
      'marquee-selection-workflow:v1:{"mode":"subtract","shape":"rectangle","bounds":{"x":4,"y":6,"width":10,"height":4},"constraint":"freeform","origin":"corner","feather":{"requestedPx":2.25,"applied":true},"antiAlias":{"requested":false,"applied":false},"limitations":["smoothing-unsupported"]}',
    );
    expect(readiness.previewSignatures.combineModes).toEqual([
      'selection-mode-semantics:v2:{"mode":"replace","operation":"replace-existing-selection","previewTarget":"document-selection-registry","commitTarget":"document-selection-history","transformSelectionHandoff":{"target":"transform-selection","readiness":"requires-committed-selection","source":"document-selection-registry","commitBoundary":"after-selection-commit"}}',
      'selection-mode-semantics:v2:{"mode":"add","operation":"add-to-existing-selection","previewTarget":"document-selection-registry","commitTarget":"document-selection-history","transformSelectionHandoff":{"target":"transform-selection","readiness":"requires-committed-selection","source":"document-selection-registry","commitBoundary":"after-selection-commit"}}',
      'selection-mode-semantics:v2:{"mode":"subtract","operation":"remove-from-existing-selection","previewTarget":"document-selection-registry","commitTarget":"document-selection-history","transformSelectionHandoff":{"target":"transform-selection","readiness":"requires-committed-selection","source":"document-selection-registry","commitBoundary":"after-selection-commit"}}',
      'selection-mode-semantics:v2:{"mode":"intersect","operation":"keep-overlap-with-existing-selection","previewTarget":"document-selection-registry","commitTarget":"document-selection-history","transformSelectionHandoff":{"target":"transform-selection","readiness":"requires-committed-selection","source":"document-selection-registry","commitBoundary":"after-selection-commit"}}',
    ]);
    expect(readiness.previewSignatures.readiness).toBe(
      'marquee-selection-readiness:v1:{"status":"limited-ready","activeShape":"rectangle","feather":{"requestedPx":2.25,"settingStored":true,"preview":"feathered-mask","appliedToSelectionMask":true},"antiAlias":{"requested":false,"preview":"binary-edge","appliedToSelectionMask":false},"smoothing":{"requested":true,"preview":"unsupported","appliedToSelectionMask":false},"combineModes":["replace","add","subtract","intersect"],"transform":"supported-after-selection-commit","saveLoad":"supported-alpha-channel-round-trip","blockers":["smoothing-pass-unsupported"]}',
    );
  });

  it('blocks transform and saved-selection interop when required prerequisites are missing', async () => {
    const { describeMarqueeSelectionReadiness } = await import('./marqueeTool');

    const readiness = describeMarqueeSelectionReadiness({
      selectionSettings: {
        mode: 'replace',
        marqueeShape: 'ellipse',
        feather: 0,
        antiAlias: true,
      },
      hasActiveSelection: false,
      savedAlphaChannelCount: 0,
      requireTransformSelection: true,
      requireSavedSelectionRoundTrip: true,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.edgeModes.feather).toEqual({
      requestedPx: 0,
      settingStored: true,
      preview: 'no-feather-requested',
      appliedToSelectionMask: false,
    });
    expect(readiness.transformInterop.status).toBe('blocked-no-active-selection');
    expect(readiness.saveLoadInterop.status).toBe('blocked-no-saved-alpha-channel');
    expect(readiness.saveLoadInterop.operations).toEqual([
      {
        operation: 'save-selection-as-alpha-channel',
        status: 'ready',
        source: 'document-selection-registry',
        target: 'document-alpha-channel-metadata',
      },
      {
        operation: 'load-selection-replace',
        status: 'blocked-no-saved-alpha-channel',
        source: 'document-alpha-channel-metadata',
        target: 'document-selection-registry',
      },
      {
        operation: 'load-selection-add',
        status: 'blocked-no-saved-alpha-channel',
        source: 'document-alpha-channel-metadata',
        target: 'document-selection-registry',
      },
      {
        operation: 'load-selection-subtract',
        status: 'blocked-no-saved-alpha-channel',
        source: 'document-alpha-channel-metadata',
        target: 'document-selection-registry',
      },
      {
        operation: 'load-selection-intersect',
        status: 'blocked-no-saved-alpha-channel',
        source: 'document-alpha-channel-metadata',
        target: 'document-selection-registry',
      },
    ]);
    expect(readiness.blockers).toEqual([
      {
        code: 'transform-selection-needs-active-selection',
        severity: 'error',
        operation: 'transform-selection',
        message: 'Transform Selection interop requires a committed non-empty selection in the document selection registry.',
      },
      {
        code: 'saved-selection-round-trip-needs-alpha-channel',
        severity: 'error',
        operation: 'save-load-selection',
        message: 'Save/load round-trip validation requires at least one persisted saved alpha channel.',
      },
    ]);
    expect(readiness.previewSignatures.readiness).toBe(
      'marquee-selection-readiness:v1:{"status":"blocked","activeShape":"ellipse","feather":{"requestedPx":0,"settingStored":true,"preview":"no-feather-requested","appliedToSelectionMask":false},"antiAlias":{"requested":true,"preview":"rasterizer-edge-alpha","appliedToSelectionMask":true},"smoothing":{"requested":false,"preview":"unsupported","appliedToSelectionMask":false},"combineModes":["replace","add","subtract","intersect"],"transform":"blocked-no-active-selection","saveLoad":"blocked-no-saved-alpha-channel","blockers":["transform-selection-needs-active-selection","saved-selection-round-trip-needs-alpha-channel"]}',
    );
  });

  it('surfaces modifier readiness, transform handoff signatures, and blocker/action parity metadata', async () => {
    const { describeMarqueeSelectionReadiness } = await import('./marqueeTool');

    const readiness = describeMarqueeSelectionReadiness({
      selectionSettings: {
        mode: 'add',
        marqueeShape: 'ellipse',
        feather: 6,
        antiAlias: true,
      },
      hasActiveSelection: false,
      requireTransformSelection: true,
    });

    expect(readiness.modifierBehavior).toEqual([
      {
        input: 'shift',
        geometryEffect: 'constrain-to-square-or-circle',
        selectionModeOverride: 'add-when-resolved-by-environment',
      },
      {
        input: 'alt',
        geometryEffect: 'draw-from-center',
        selectionModeOverride: 'subtract-when-resolved-by-environment',
      },
      {
        input: 'escape',
        geometryEffect: 'cancel-preview',
        selectionModeOverride: 'none',
      },
    ]);
    expect(readiness.transformSelectionHandoff).toEqual({
      target: 'transform-selection',
      readiness: 'requires-committed-selection',
      source: 'document-selection-registry',
      commitBoundary: 'after-selection-commit',
      invalidBlockerSignature: 'transform-selection-needs-active-selection',
    });
    expect(readiness.batchActionSuitability).toEqual({
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: 'Marquee playback is blocked until required selection transform or saved-selection prerequisites exist.',
    });
    expect(readiness.previewSignatures.blockers).toBe(
      'marquee-selection-blockers:v1:["transform-selection-needs-active-selection"]',
    );
  });

  it('cancels zero-area drags instead of committing unchanged selection history', async () => {
    const { marqueeTool } = await import('./marqueeTool');
    const { env, operations, requestRender } = createMarqueeEnv();
    const existing = createExistingSelection(env.doc.width, env.doc.height);
    setSelection(env.doc.id, existing);

    marqueeTool.onPointerDown?.(env, { x: 8, y: 8 }, NO_MODIFIERS, {} as PointerEvent);
    marqueeTool.onPointerUp?.(env, { x: 8, y: 8 }, NO_MODIFIERS, {} as PointerEvent);

    expect(operations).toEqual([]);
    expect(getSelection(env.doc.id)?.data).toEqual(existing.data);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('applies feathered alpha to committed rectangle selections without softening the captured base', async () => {
    const { marqueeTool } = await import('./marqueeTool');
    const { env, operations, setHasSelection } = createMarqueeEnv('add');
    env.selectionToolSettings.feather = 1;
    env.selectionToolSettings.antiAlias = false;
    const existing = createExistingSelection(env.doc.width, env.doc.height);
    setSelection(env.doc.id, existing);

    marqueeTool.onPointerDown?.(env, { x: 3, y: 3 }, NO_MODIFIERS, {} as PointerEvent);
    marqueeTool.onPointerMove?.(env, { x: 7, y: 7 }, NO_MODIFIERS, {} as PointerEvent);
    marqueeTool.onPointerUp?.(env, { x: 7, y: 7 }, NO_MODIFIERS, {} as PointerEvent);

    const selection = getSelection(env.doc.id);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('Expected a committed selection mask');

    expect(alphaAt(selection, 2, 2)).toBe(255);
    expect(alphaAt(selection, 2, 1)).toBe(0);
    expect(alphaAt(selection, 4, 4)).toBe(255);
    expect(alphaAt(selection, 4, 2)).toBeGreaterThan(0);
    expect(alphaAt(selection, 4, 2)).toBeLessThan(255);
    expect(alphaAt(selection, 3, 3)).toBeGreaterThan(0);
    expect(alphaAt(selection, 3, 3)).toBeLessThan(255);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'selection', docId: env.doc.id });
    expect(setHasSelection).toHaveBeenCalledWith(env.doc.id, true);
  });
});
