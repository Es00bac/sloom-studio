import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SELECTION_TOOL_SETTINGS, type EditorOperation } from '../../../types/imageEditor';
import { createMask, type SelectionMask } from '../SelectionMask';
import { clearAllSelections, getSelection, setSelection } from '../selectionRegistry';
import type { ToolEnv, Modifiers, Point } from './types';

const magneticComposite = vi.hoisted(() => ({
  bitmap: null as { pixels: Uint8ClampedArray } | null,
  renderCalls: 0,
}));

vi.mock('../ImageAdjustmentLayer', () => ({
  renderImageDocumentLayersToBitmap: () => {
    magneticComposite.renderCalls += 1;
    return magneticComposite.bitmap;
  },
}));

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

function createLassoEnv(
  mode: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace',
  width = 20,
  height = 20,
) {
  const operations: EditorOperation[] = [];
  const requestRender = vi.fn();
  const bumpSelectionVersion = vi.fn();
  const setHasSelection = vi.fn();
  const doc = {
    id: `lasso-test-${Math.random().toString(36).slice(2)}`,
    width,
    height,
  };
  const env = {
    doc,
    activeLayer: null,
    brushSettings: {},
    cropToolSettings: {},
    selectionToolSettings: {
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      mode: 'replace',
      lassoShape: 'freehand',
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

class FakeMagneticCanvas {
  static drawImageCalls = 0;

  private readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      drawImage: (source: unknown) => {
        const sourcePixels = (source as { pixels?: Uint8ClampedArray }).pixels;
        if (sourcePixels) this.pixels.set(sourcePixels);
        FakeMagneticCanvas.drawImageCalls += 1;
      },
      getImageData: () => ({ data: this.pixels }),
    };
  }
}

function buildNonSymmetricComposite(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = x >= 11 || (y >= 12 && x >= 5) ? 230 : 18;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

beforeEach(() => {
  clearAllSelections();
  magneticComposite.bitmap = null;
  magneticComposite.renderCalls = 0;
  FakeMagneticCanvas.drawImageCalls = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lassoTool workflow descriptors', () => {
  it('describes invalid polygonal commit paths separately from cursor preview geometry', async () => {
    const { describeLassoSelectionPath } = await import('./lassoTool');

    const path = describeLassoSelectionPath({
      workflow: 'polygonal',
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
      ],
      cursor: { x: 5, y: 4 },
    });

    expect(path).toEqual({
      descriptorId: 'lasso-selection-path:v1',
      workflow: 'polygonal',
      minimumCommitPointCount: 3,
      committedPointCount: 2,
      previewPointCount: 3,
      commit: {
        validForCommit: false,
        invalidReason: 'needs-at-least-three-points',
        bounds: { x: 1, y: 1, width: 4, height: 0 },
        areaPx: 0,
        pathLengthPx: 4,
        signature: 'lasso-selection-path-commit:v1:polygonal:invalid:2:1,1,4,0:0:4',
      },
      preview: {
        validForRasterization: true,
        bounds: { x: 1, y: 1, width: 4, height: 3 },
        areaPx: 6,
        pathLengthPx: 12,
        signature: 'lasso-selection-path-preview:v1:polygonal:ready:3:1,1,4,3:6:12',
      },
      signature: 'lasso-selection-path:v1:polygonal:commit=lasso-selection-path-commit:v1:polygonal:invalid:2:1,1,4,0:0:4:preview=lasso-selection-path-preview:v1:polygonal:ready:3:1,1,4,3:6:12',
    });
  });

  it('blocks readiness when a committed lasso path is requested but invalid', async () => {
    const { describeLassoSelectionReadiness } = await import('./lassoTool');

    const readiness = describeLassoSelectionReadiness({
      selectionSettings: {
        mode: 'replace',
        lassoShape: 'polygonal',
        feather: 0,
        antiAlias: true,
      },
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
      ],
      cursor: { x: 5, y: 4 },
      requireValidPath: true,
      magnetic: {
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
        ],
        cursor: { x: 5, y: 4 },
        pixelSource: { width: 20, height: 20 },
      },
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.path.commit.validForCommit).toBe(false);
    expect(readiness.blockers).toContainEqual({
      code: 'invalid-lasso-path',
      severity: 'error',
      operation: 'selection-commit',
      message: 'A committed lasso selection needs at least three non-collinear points before it can create selection history.',
    });
    expect(readiness.previewSignatures.blockers).toBe(
      'lasso-selection-blockers:v1:["invalid-lasso-path"]',
    );
  });

  it('describes closed freehand lasso output, smoothing status, and unsupported limitations', async () => {
    const { describeLassoSelectionWorkflow } = await import('./lassoTool');

    const descriptor = describeLassoSelectionWorkflow({
      selectionSettings: {
        mode: 'subtract',
        lassoShape: 'freehand',
        feather: 0,
        antiAlias: false,
      },
      points: [
        { x: 4, y: 4 },
        { x: 18, y: 6 },
        { x: 12, y: 20 },
      ],
      closed: true,
      smoothingRequested: 2,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'lasso-selection-workflow:v1',
      tool: 'lasso',
      selectionMode: {
        mode: 'subtract',
        operation: 'remove-from-existing-selection',
      },
      geometry: {
        workflow: 'freehand',
        pointCount: 3,
        closed: true,
        closure: 'auto-closes-on-pointer-up',
        bounds: {
          x: 4,
          y: 4,
          width: 14,
          height: 16,
        },
      },
      edgeProcessing: {
        feather: {
          requestedPx: 0,
          applied: false,
        },
        antiAlias: {
          requested: false,
          applied: false,
        },
        smoothing: {
          requestedPx: 2,
          applied: false,
        },
      },
      output: {
        target: 'document-selection',
        alpha: 255,
      },
    });
    expect(descriptor.limitations.map((limitation) => limitation.code)).toEqual([
      'freehand-smoothing-unsupported',
      'subpixel-edge-anti-alias-unsupported',
    ]);
    expect(descriptor.keyboardModifierCaveats).toEqual([
      {
        input: 'shift',
        behavior: 'selection-mode-add-when-resolved-by-environment',
        caveat: 'Modifier selection modes depend on the shared selection interaction resolver.',
      },
      {
        input: 'alt',
        behavior: 'selection-mode-subtract-or-polygonal-finalize',
        caveat: 'Alt finalizes polygonal lasso on pointer up in this local tool path.',
      },
      {
        input: 'enter',
        behavior: 'finalize-polygonal-lasso',
        caveat: 'Enter only commits polygonal paths with at least three anchor points.',
      },
      {
        input: 'escape',
        behavior: 'cancel-active-lasso',
        caveat: 'Escape cancels preview state without committing selection history.',
      },
    ]);
    expect(descriptor.batchActionSuitability).toEqual({
      status: 'limited-ready',
      actionRecordable: true,
      batchSafe: false,
      reason: 'Lasso actions depend on document-specific pointer geometry and active selection combine mode.',
    });
    expect(descriptor.previewSignature).toBe(
      'lasso-selection-workflow:v1:{"mode":"subtract","workflow":"freehand","pointCount":3,"closed":true,"closure":"auto-closes-on-pointer-up","bounds":{"x":4,"y":4,"width":14,"height":16},"feather":{"requestedPx":0,"applied":false},"antiAlias":{"requested":false,"applied":false},"smoothing":{"requestedPx":2,"applied":false},"limitations":["freehand-smoothing-unsupported","subpixel-edge-anti-alias-unsupported"]}',
    );
  });

  it('describes open polygonal lasso preview before finalize', async () => {
    const { describeLassoSelectionWorkflow } = await import('./lassoTool');

    const descriptor = describeLassoSelectionWorkflow({
      selectionSettings: {
        mode: 'replace',
        lassoShape: 'polygonal',
        feather: 3,
        antiAlias: true,
      },
      points: [
        { x: 1, y: 2 },
        { x: 9, y: 4 },
      ],
      cursor: { x: 7, y: 12 },
      closed: false,
    });

    expect(descriptor.geometry).toMatchObject({
      workflow: 'polygonal',
      pointCount: 3,
      committedPointCount: 2,
      closed: false,
      closure: 'open-preview-closes-only-on-enter-alt-or-double-click',
      bounds: {
        x: 1,
        y: 2,
        width: 8,
        height: 10,
      },
    });
    expect(descriptor.limitations.map((limitation) => limitation.code)).toEqual([]);
  });

  it('plans magnetic lasso snapping deterministically without a pixel source', async () => {
    const { describeMagneticLassoPlan } = await import('./lassoTool');

    const descriptor = describeMagneticLassoPlan({
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 12 },
      ],
      cursor: { x: 25, y: 18 },
      settings: {
        snapRadius: 16.4321,
        contrastThreshold: 0.3752,
        frequency: 7.8,
        refineEdgeRequested: true,
      },
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'magnetic-lasso-plan:v1',
      tool: 'magnetic-lasso',
      readiness: 'descriptor-only-no-pixel-source',
      geometry: {
        anchorCount: 2,
        previewPointCount: 3,
        candidateSegmentCount: 2,
        bounds: {
          x: 10,
          y: 10,
          width: 15,
          height: 8,
        },
      },
      snapping: {
        ready: false,
        snapRadiusPx: 16.432,
        contrastThreshold: 0.375,
        frequency: 8,
        candidateAnchorCount: 3,
        cursorDistanceFromLastAnchor: 7.81,
        cursorWithinSnapRadius: true,
      },
    });
    expect(descriptor.unsupported.map((state) => state.code)).toEqual([
      'pixel-source-required-for-edge-detection',
      'true-image-edge-detection-unsupported',
      'refine-edge-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe(
      'magnetic-lasso-plan:v1:{"readiness":"descriptor-only-no-pixel-source","anchorCount":2,"previewPointCount":3,"candidateSegmentCount":2,"bounds":{"x":10,"y":10,"width":15,"height":8},"snapping":{"ready":false,"snapRadiusPx":16.432,"contrastThreshold":0.375,"frequency":8,"candidateAnchorCount":3,"cursorWithinSnapRadius":true},"unsupported":["pixel-source-required-for-edge-detection","true-image-edge-detection-unsupported","refine-edge-unsupported"]}',
    );
  });

  it('reports magnetic lasso waiting state with clamped settings', async () => {
    const { describeMagneticLassoPlan } = await import('./lassoTool');

    const descriptor = describeMagneticLassoPlan({
      settings: {
        snapRadius: -4,
        contrastThreshold: 8,
        frequency: 0,
      },
    });

    expect(descriptor.readiness).toBe('waiting-for-anchor-points');
    expect(descriptor.geometry).toMatchObject({
      anchorCount: 0,
      previewPointCount: 0,
      candidateSegmentCount: 0,
      bounds: null,
    });
    expect(descriptor.snapping).toMatchObject({
      ready: false,
      snapRadiusPx: 0,
      contrastThreshold: 1,
      frequency: 1,
      candidateAnchorCount: 0,
      cursorDistanceFromLastAnchor: null,
      cursorWithinSnapRadius: false,
    });
    expect(descriptor.unsupported.map((state) => state.code)).toEqual([
      'pixel-source-required-for-edge-detection',
      'true-image-edge-detection-unsupported',
    ]);
  });

  it('describes lasso readiness with modifier parity, magnetic limitations, and action suitability', async () => {
    const { describeLassoSelectionReadiness } = await import('./lassoTool');

    const readiness = describeLassoSelectionReadiness({
      selectionSettings: {
        mode: 'intersect',
        lassoShape: 'polygonal',
        feather: 2,
        antiAlias: false,
      },
      points: [
        { x: 2, y: 3 },
        { x: 18, y: 5 },
      ],
      cursor: { x: 14, y: 17 },
      closed: false,
      requireTransformSelection: true,
      hasActiveSelection: false,
      magnetic: {
        points: [
          { x: 2, y: 3 },
          { x: 18, y: 5 },
        ],
        cursor: { x: 14, y: 17 },
        settings: {
          snapRadius: 9,
          contrastThreshold: 0.42,
          frequency: 5,
          refineEdgeRequested: true,
        },
      },
    });

    expect(readiness.modifierBehavior).toEqual([
      {
        input: 'shift',
        geometryEffect: 'none',
        selectionModeOverride: 'add-when-resolved-by-environment',
      },
      {
        input: 'alt',
        geometryEffect: 'finalize-polygonal-segment',
        selectionModeOverride: 'subtract-when-resolved-by-environment',
      },
      {
        input: 'enter',
        geometryEffect: 'commit-open-polygon',
        selectionModeOverride: 'none',
      },
      {
        input: 'escape',
        geometryEffect: 'cancel-preview',
        selectionModeOverride: 'none',
      },
    ]);
    expect(readiness.transformSelectionHandoff.invalidBlockerSignature).toBe(
      'transform-selection-needs-active-selection',
    );
    expect(readiness.magneticLasso).toMatchObject({
      readiness: 'descriptor-only-no-pixel-source',
      unsupportedCodes: [
        'pixel-source-required-for-edge-detection',
        'true-image-edge-detection-unsupported',
        'refine-edge-unsupported',
      ],
    });
    expect(readiness.batchActionSuitability).toEqual({
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: 'Lasso playback is blocked until required transform-selection prerequisites exist.',
    });
    expect(readiness.previewSignatures.blockers).toBe(
      'lasso-selection-blockers:v1:["transform-selection-needs-active-selection","magnetic-lasso-no-pixel-source"]',
    );
  });

  it('cancels underspecified freehand strokes instead of committing unchanged selection history', async () => {
    const { lassoTool } = await import('./lassoTool');
    const { env, operations, requestRender } = createLassoEnv();
    const existing = createExistingSelection(env.doc.width, env.doc.height);
    setSelection(env.doc.id, existing);

    lassoTool.onPointerDown?.(env, { x: 4, y: 4 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 5, y: 5 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerUp?.(env, { x: 5, y: 5 }, NO_MODIFIERS, {} as PointerEvent);

    expect(operations).toEqual([]);
    expect(getSelection(env.doc.id)?.data).toEqual(existing.data);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('cancels underspecified magnetic strokes without changing the existing selection', async () => {
    const { lassoTool } = await import('./lassoTool');
    const { env, operations, requestRender } = createLassoEnv();
    env.selectionToolSettings.lassoShape = 'magnetic';
    const existing = createExistingSelection(env.doc.width, env.doc.height);
    setSelection(env.doc.id, existing);

    lassoTool.onPointerDown?.(env, { x: 4, y: 4 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 5, y: 5 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerUp?.(env, { x: 5, y: 5 }, NO_MODIFIERS, {} as PointerEvent);

    expect(operations).toEqual([]);
    expect(getSelection(env.doc.id)?.data).toEqual(existing.data);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('applies feathered alpha to committed freehand selections without softening the captured base', async () => {
    const { lassoTool } = await import('./lassoTool');
    const { env, operations, setHasSelection } = createLassoEnv('add');
    env.selectionToolSettings.feather = 1;
    env.selectionToolSettings.antiAlias = false;
    const existing = createExistingSelection(env.doc.width, env.doc.height);
    setSelection(env.doc.id, existing);

    lassoTool.onPointerDown?.(env, { x: 6, y: 6 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 12, y: 6 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 6, y: 12 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerUp?.(env, { x: 6, y: 12 }, NO_MODIFIERS, {} as PointerEvent);

    const selection = getSelection(env.doc.id);
    expect(selection).not.toBeNull();
    if (!selection) throw new Error('Expected a committed selection mask');

    expect(alphaAt(selection, 2, 2)).toBe(255);
    expect(alphaAt(selection, 2, 1)).toBe(0);
    expect(alphaAt(selection, 6, 6)).toBeGreaterThan(0);
    expect(alphaAt(selection, 6, 6)).toBeLessThan(255);
    expect(alphaAt(selection, 7, 7)).toBe(255);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'selection', docId: env.doc.id });
    expect(setHasSelection).toHaveBeenCalledWith(env.doc.id, true);
  });

  it('commits a magnetic-lasso selection, degrading to freehand when no edge field is available', async () => {
    const { lassoTool } = await import('./lassoTool');
    const { env, operations, setHasSelection } = createLassoEnv('replace');
    env.selectionToolSettings.lassoShape = 'magnetic';

    lassoTool.onPointerDown?.(env, { x: 4, y: 4 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 14, y: 4 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 4, y: 14 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerUp?.(env, { x: 4, y: 14 }, NO_MODIFIERS, {} as PointerEvent);

    const selection = getSelection(env.doc.id);
    expect(selection).not.toBeNull();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ kind: 'selection', docId: env.doc.id });
    expect(setHasSelection).toHaveBeenCalledWith(env.doc.id, true);
  });

  it('samples a non-symmetric document composite for a magnetic stroke before committing', async () => {
    const { lassoTool } = await import('./lassoTool');
    const { env, operations } = createLassoEnv('replace');
    env.selectionToolSettings.lassoShape = 'magnetic';
    magneticComposite.bitmap = { pixels: buildNonSymmetricComposite(env.doc.width, env.doc.height) };
    vi.stubGlobal('OffscreenCanvas', FakeMagneticCanvas);

    lassoTool.onPointerDown?.(env, { x: 3, y: 3 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 16, y: 4 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerMove?.(env, { x: 16, y: 17 }, NO_MODIFIERS, {} as PointerEvent);
    lassoTool.onPointerUp?.(env, { x: 16, y: 17 }, NO_MODIFIERS, {} as PointerEvent);

    expect(FakeMagneticCanvas.drawImageCalls).toBe(1);
    expect(operations).toHaveLength(1);
    expect(getSelection(env.doc.id)).not.toBeNull();
  });

  it('falls back before compositing when the document exceeds the magnetic field budget', async () => {
    const { lassoTool, MAGNETIC_MAX_FIELD_PIXELS } = await import('./lassoTool');
    const side = Math.ceil(Math.sqrt(MAGNETIC_MAX_FIELD_PIXELS + 1));
    const { env } = createLassoEnv('replace', side, side);
    env.selectionToolSettings.lassoShape = 'magnetic';
    magneticComposite.bitmap = { pixels: new Uint8ClampedArray(4) };
    vi.stubGlobal('OffscreenCanvas', FakeMagneticCanvas);

    lassoTool.onPointerDown?.(env, { x: 4, y: 4 }, NO_MODIFIERS, {} as PointerEvent);

    expect(magneticComposite.renderCalls).toBe(0);
    expect(FakeMagneticCanvas.drawImageCalls).toBe(0);
  });
});
