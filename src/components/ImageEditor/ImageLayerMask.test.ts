import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import type { BrushDab } from './ImageBrushEngine';
import { createHideAllLayerMask } from './LayerMaskOps';
import { createMask, setRect } from './SelectionMask';
import {
  describeImageLayerMaskOverlayPreview,
  getImageLayerMaskWorkflowDescriptor,
  getImageLayerMaskWorkflowDescriptors,
  getImageLayerMaskOperationDescriptor,
  getImageLayerMaskOperationDescriptors,
  getUnsupportedImageLayerMaskWorkflowDescriptors,
  createLayerMaskOverlayMask,
  describeImageLayerMaskReadinessLane,
  getImageLayerMaskUnsupportedCapabilityDescriptors,
  getUnsupportedImageLayerMaskWorkflowWarnings,
  paintLayerMaskDabs,
  planImageLayerMaskOperation,
  planImageLayerMaskWorkflow,
  resolveLayerMaskBrushTargetValue,
  summarizeImageLayerMaskReadiness,
} from './ImageLayerMask';

class FakeContext {
  imageData: ImageData;

  constructor(canvas: FakeOffscreenCanvas) {
    this.imageData = makeImageData(canvas.width, canvas.height);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }

  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }

  drawImage() {}
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(this);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return data[(y * bitmap.width + x) * 4 + 3];
}

function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 1,
    y: 1,
    bitmap: new OffscreenCanvas(4, 4) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDab(overrides: Partial<BrushDab> = {}): BrushDab {
  return {
    x: 2,
    y: 2,
    index: 0,
    size: 3,
    opacity: 1,
    flow: 1,
    spacingPx: 1,
    hardness: 1,
    roundness: 1,
    angleDeg: 0,
    tipShape: 'round',
    textureAlpha: 1,
    wetness: 0,
    ...overrides,
  };
}

describe('ImageLayerMask', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('maps mask brush colors to reveal or conceal alpha values', () => {
    expect(resolveLayerMaskBrushTargetValue('#ffffff', false)).toBe(255);
    expect(resolveLayerMaskBrushTargetValue('#000000', false)).toBe(0);
    expect(resolveLayerMaskBrushTargetValue('#808080', false)).toBe(128);
    expect(resolveLayerMaskBrushTargetValue('#ffffff', true)).toBe(0);
  });

  it('paints directly into the layer mask alpha channel and respects the active selection', () => {
    const doc = { width: 8, height: 8 };
    const layer = makeLayer();
    const mask = createHideAllLayerMask(doc as never, layer);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 3, 1, 1, 255, false);

    paintLayerMaskDabs(mask, layer, [makeDab({ x: 3, y: 3 })], 255, selection);

    expect(alphaAt(mask, 2, 2)).toBeGreaterThan(0);
    expect(alphaAt(mask, 1, 1)).toBe(0);
  });

  it('builds an active-layer mask overlay in document coordinates', () => {
    const layer = makeLayer({
      x: 2,
      y: 1,
      mask: createHideAllLayerMask({ width: 8, height: 8 } as never, makeLayer()),
    });
    const selectionOverlay = createLayerMaskOverlayMask(layer, 8, 8);

    expect(selectionOverlay.width).toBe(8);
    expect(selectionOverlay.height).toBe(8);
    expect(selectionOverlay.data[0]).toBe(0);
    expect(selectionOverlay.data[1 * 8 + 2]).toBe(255);
    expect(selectionOverlay.data[4 * 8 + 5]).toBe(255);
  });

  it('reports the remaining refine and copy-workflow limitations deterministically', () => {
    expect(getUnsupportedImageLayerMaskWorkflowWarnings()).toEqual([]);
    expect(getUnsupportedImageLayerMaskWorkflowWarnings({
      copyLinkWorkflow: true,
      refineWorkspace: true,
    })).toEqual([
      {
        code: 'refine-workspace-unsupported',
        severity: 'warning',
        message: 'Select & Mask style layer-mask refinement is not supported yet; refine the selection before creating the mask or paint the mask directly.',
      },
      {
        code: 'copy-link-workflow-partial',
        severity: 'warning',
        message: 'Layer-mask linking is available; copying remains a separate manual/unlink workflow.',
      },
    ]);
  });

  it('describes unsupported and partial layer-mask workflows deterministically', () => {
    expect(getImageLayerMaskWorkflowDescriptors().map((descriptor) => descriptor.kind)).toEqual([
      'copy-mask',
      'link-mask',
      'apply-mask',
      'refine-workspace-handoff',
    ]);

    expect(getImageLayerMaskWorkflowDescriptor('copy-mask')).toEqual({
      kind: 'copy-mask',
      label: 'Copy Layer Mask',
      support: 'partial',
      source: 'existing-mask',
      output: 'layer-mask',
      descriptorId: 'layer-mask-workflow:copy-mask',
      previewId: 'layer-mask-workflow-preview:copy-mask',
      unsupportedState: 'partial-ui',
      handoffCaveat: null,
      exportCaveat: 'Copied mask pixels can export as a normal alpha mask after they are materialized on the target layer.',
      caveat: 'Mask pixels can be duplicated by helper code, but no UI command or cross-layer target picker is wired yet.',
      previewModes: [],
      unsupportedDescriptor: null,
    });
    expect(getImageLayerMaskWorkflowDescriptor('link-mask')).toMatchObject({
      support: 'supported',
      unsupportedState: 'none',
      handoffCaveat: null,
      exportCaveat: 'Sloom .slimg saves the linked source reference. PSD handoff cannot preserve the shared relationship; retain .slimg for linked editing.',
      caveat: 'A linked consumer follows one direct source mask; unlinking materializes an independent copy.',
    });
    expect(getImageLayerMaskWorkflowDescriptor('refine-workspace-handoff')).toMatchObject({
      unsupportedState: 'workspace-missing',
      handoffCaveat: 'Send selection or mask alpha to Select & Mask style refinement before committing a layer mask.',
      exportCaveat: 'No refine workspace state is exported; only the committed mask alpha can be preserved.',
      previewModes: [
        {
          mode: 'masked-areas',
          ready: false,
          summary: 'Masked Areas preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'selected-areas',
          ready: false,
          summary: 'Selected Areas preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'on-black',
          ready: false,
          summary: 'On Black preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'on-white',
          ready: false,
          summary: 'On White preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'black-white',
          ready: false,
          summary: 'Black & White preview is not available because no dedicated refine-mask workspace exists yet.',
        },
      ],
      unsupportedDescriptor: {
        code: 'refine-workspace-unsupported',
        target: 'select-and-mask-handoff-unsupported',
        summary: 'Refine Mask workspace is not available; hand off selection or mask alpha to a future Select and Mask style workflow instead.',
      },
    });
  });

  it('describes create/edit/apply/delete/invert/density/feather readiness descriptors', () => {
    expect(getImageLayerMaskOperationDescriptors().map((descriptor) => descriptor.kind)).toEqual([
      'create-mask',
      'create-reveal-mask',
      'create-hide-mask',
      'create-mask-from-selection',
      'edit-mask',
      'apply-mask',
      'delete-mask',
      'invert-mask',
      'adjust-density',
      'adjust-feather',
    ]);

    expect(getImageLayerMaskOperationDescriptor('apply-mask')).toMatchObject({
      descriptorId: 'layer-mask-operation:apply-mask',
      support: 'partial',
      mutatesPixels: true,
      removesMask: true,
      caveat: 'Applying a mask is planned as bitmap alpha baking; smart-object and apply-as-selection preservation are not modeled.',
    });
    expect(getImageLayerMaskOperationDescriptor('adjust-density')).toMatchObject({
      support: 'supported',
      mutatesMask: false,
      mutatesPixels: false,
    });
    expect(getImageLayerMaskOperationDescriptor('create-reveal-mask')).toMatchObject({
      descriptorId: 'layer-mask-operation:create-reveal-mask',
      support: 'supported',
      createMode: 'reveal-all',
      requiresSelection: false,
    });
    expect(getImageLayerMaskOperationDescriptor('create-hide-mask')).toMatchObject({
      descriptorId: 'layer-mask-operation:create-hide-mask',
      support: 'supported',
      createMode: 'hide-all',
      requiresSelection: false,
    });
    expect(getImageLayerMaskOperationDescriptor('create-mask-from-selection')).toMatchObject({
      descriptorId: 'layer-mask-operation:create-mask-from-selection',
      support: 'supported',
      createMode: 'from-selection',
      requiresSelection: true,
    });
  });

  it('plans reveal, hide, and from-selection mask creation with selection blockers and signatures', () => {
    const layer = makeLayer({ mask: null });
    const selection = createMask(8, 6);
    setRect(selection, 2, 1, 3, 2, 255, false);

    const revealPlan = planImageLayerMaskOperation('create-reveal-mask', { layer });
    expect(revealPlan).toMatchObject({
      kind: 'create-reveal-mask',
      canRun: true,
      createMode: 'reveal-all',
      selection: {
        present: false,
        width: 0,
        height: 0,
        bounds: null,
        alphaRange: null,
      },
      readiness: {
        state: 'ready',
        unsupportedState: 'none',
        blockingWarningCodes: [],
      },
    });
    expect(revealPlan.preview.signature).toBe(
      'layer-mask-operation:v1:{"kind":"create-reveal-mask","support":"supported","layerId":"layer-1","hasMask":false,"hasBitmap":true,"maskSize":null,"bitmapSize":{"width":4,"height":4},"layerSettings":{"density":1,"feather":0},"requestedSettings":{"density":1,"feather":0},"createMode":"reveal-all","selection":{"present":false,"width":0,"height":0,"bounds":null,"alphaRange":null},"mismatch":null,"warnings":[]}',
    );

    const hidePlan = planImageLayerMaskOperation('create-hide-mask', { layer });
    expect(hidePlan).toMatchObject({
      kind: 'create-hide-mask',
      canRun: true,
      createMode: 'hide-all',
      selection: {
        present: false,
      },
    });

    const blockedFromSelectionPlan = planImageLayerMaskOperation('create-mask-from-selection', { layer });
    expect(blockedFromSelectionPlan.canRun).toBe(false);
    expect(blockedFromSelectionPlan.warnings.map((warning) => warning.code)).toEqual([
      'selection-required',
    ]);
    expect(blockedFromSelectionPlan.readiness).toEqual({
      state: 'blocked',
      unsupportedState: 'missing-selection',
      blockingWarningCodes: ['selection-required'],
    });

    const fromSelectionPlan = planImageLayerMaskOperation('create-mask-from-selection', {
      layer,
      selection,
    });
    expect(fromSelectionPlan).toMatchObject({
      kind: 'create-mask-from-selection',
      canRun: true,
      createMode: 'from-selection',
      selection: {
        present: true,
        width: 8,
        height: 6,
        bounds: { x: 2, y: 1, width: 3, height: 2 },
        alphaRange: { min: 0, max: 255 },
      },
      warnings: [],
      readiness: {
        state: 'ready',
        unsupportedState: 'none',
        blockingWarningCodes: [],
      },
    });
    expect(fromSelectionPlan.preview.signature).toContain(
      '"createMode":"from-selection","selection":{"present":true,"width":8,"height":6,"bounds":{"x":2,"y":1,"width":3,"height":2},"alphaRange":{"min":0,"max":255}}',
    );
  });

  it('plans layer-mask operations with stable readiness and preview signatures', () => {
    const layer = makeLayer({
      mask: createHideAllLayerMask({ width: 4, height: 4 } as never, makeLayer()),
      maskDensity: 0.33339,
      maskFeather: 1.234,
    });

    const densityPlan = planImageLayerMaskOperation('adjust-density', {
      layer,
      requestedDensity: 0.45678,
    });
    expect(densityPlan).toMatchObject({
      kind: 'adjust-density',
      canRun: true,
      readiness: {
        state: 'ready',
        unsupportedState: 'none',
        blockingWarningCodes: [],
      },
      requestedSettings: {
        density: 0.457,
        feather: 1.23,
      },
      preview: {
        id: 'layer-mask-operation-preview:adjust-density:layer-1',
        overlay: {
          status: 'available',
          layerId: 'layer-1',
          documentSize: { width: 4, height: 4 },
          maskSize: { width: 4, height: 4 },
          settings: { density: 0.333, feather: 1.23 },
        },
      },
    });
    expect(densityPlan.preview.signature).toContain('"requestedSettings":{"density":0.457,"feather":1.23}');
    expect(densityPlan.settingsApplication).toEqual({
      density: {
        value: 0.457,
        appliesTo: ['overlay-preview', 'mask-bake', 'export-flattening'],
        nonDestructive: true,
        summary: 'Density metadata updates preview/export immediately and applies during mask baking without rewriting stored mask pixels.',
        previewCaveat: 'Density preview changes the interpreted mask alpha in overlay/export previews; stored mask pixels remain unchanged until baking.',
      },
      feather: {
        value: 1.23,
        appliesTo: ['overlay-preview', 'mask-bake', 'export-flattening'],
        nonDestructive: true,
        summary: 'Feather metadata updates preview/export immediately and applies during mask baking without rewriting stored mask pixels.',
        previewCaveat: 'Feather preview is a local blur approximation in overlay/export previews and may not match a dedicated Select and Mask workspace.',
      },
    });

    const blockedEditPlan = planImageLayerMaskOperation('edit-mask', {
      layer: makeLayer({ mask: null }),
    });
    expect(blockedEditPlan.canRun).toBe(false);
    expect(blockedEditPlan.readiness).toEqual({
      state: 'blocked',
      unsupportedState: 'missing-mask',
      blockingWarningCodes: ['source-mask-required'],
    });
    expect(densityPlan.caveats.settingsPreview).toEqual([
      'Density preview changes interpreted mask coverage without mutating stored mask alpha.',
      'Feather preview uses a local blur approximation and should be reviewed before destructive apply/export.',
    ]);
  });

  it('reports mask-vs-pixel target mismatch and overlay preview caveats', () => {
    const layer = makeLayer({
      bitmap: new OffscreenCanvas(6, 4) as LayerBitmap,
      mask: createHideAllLayerMask({ width: 4, height: 4 } as never, makeLayer()),
    });

    const plan = planImageLayerMaskOperation('apply-mask', { layer });
    expect(plan.canRun).toBe(true);
    expect(plan.readiness).toMatchObject({
      state: 'ready-with-caveats',
      unsupportedState: 'size-mismatch',
      blockingWarningCodes: [],
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual(['mask-pixel-size-mismatch']);
    expect(plan.mismatch).toEqual({
      mask: { width: 4, height: 4 },
      pixels: { width: 6, height: 4 },
      warningCode: 'mask-pixel-size-mismatch',
    });
    expect(plan.preview.overlay).toMatchObject({
      status: 'size-mismatch',
      id: 'layer-mask-overlay-preview:layer-1:6x4',
      mismatch: plan.mismatch,
    });
    expect(plan.caveats.overlayPreview).toBe('Mask overlay can preview, but mask bounds do not match pixel bounds.');
  });

  it('summarizes the remaining unsupported refine and native-parity states without ledger integration', () => {
    const unsupported = getUnsupportedImageLayerMaskWorkflowDescriptors();
    expect(unsupported.map((descriptor) => descriptor.kind)).toEqual([
      'refine-workspace-handoff',
    ]);
    expect(unsupported.map((descriptor) => descriptor.unsupportedState)).toEqual([
      'workspace-missing',
    ]);

    const layer = makeLayer({
      mask: createHideAllLayerMask({ width: 4, height: 4 } as never, makeLayer()),
    });
    const summary = summarizeImageLayerMaskReadiness({ layer, sourceLayer: layer });
    expect(summary.plans.map((plan) => plan.kind)).toEqual([
      'create-mask',
      'create-reveal-mask',
      'create-hide-mask',
      'create-mask-from-selection',
      'edit-mask',
      'apply-mask',
      'delete-mask',
      'invert-mask',
      'adjust-density',
      'adjust-feather',
    ]);
    expect(summary.workflowPlans.map((plan) => plan.kind)).toEqual([
      'copy-mask',
      'link-mask',
      'apply-mask',
      'refine-workspace-handoff',
    ]);
    expect(summary.overlayPreview.status).toBe('available');
    expect(summary.unsupportedCapabilities.map((descriptor) => descriptor.code)).toEqual([
      'dedicated-refine-mask-workspace',
      'advanced-matte-refine-brush',
      'photoshop-linked-mask-parity',
      'native-psd-mask-fidelity',
    ]);
    expect(summary.signature).toContain('layer-mask-readiness:v1:');
  });

  it('describes backed preview modes without claiming refine workspace or linked-mask support', () => {
    const layer = makeLayer({
      mask: createHideAllLayerMask({ width: 4, height: 4 } as never, makeLayer()),
      maskDensity: 0.5,
      maskFeather: 2,
    });

    const summary = summarizeImageLayerMaskReadiness({ layer, sourceLayer: layer }) as ReturnType<
      typeof summarizeImageLayerMaskReadiness
    > & {
      previewModeDescriptors?: Array<{
        mode: string;
        label: string;
        support: string;
        status: string;
        backedBy: string;
        unsupportedState: string;
        dedicatedRefineWorkspace: boolean;
        linkedMaskWorkflow: boolean;
        settings: { density: number; feather: number };
        caveat: string | null;
        signature: string;
      }>;
    };

    expect(summary.previewModeDescriptors?.map((descriptor) => descriptor.mode)).toEqual([
      'mask-overlay',
      'density-preview',
      'feather-preview',
      'refine-handoff-summaries',
    ]);
    expect(summary.previewModeDescriptors?.[0]).toMatchObject({
      mode: 'mask-overlay',
      label: 'Mask Overlay',
      support: 'supported',
      status: 'available',
      backedBy: 'layer-mask-overlay-alpha',
      unsupportedState: 'none',
      settings: { density: 0.5, feather: 2 },
      caveat: null,
    });
    expect(summary.previewModeDescriptors?.[1]).toMatchObject({
      mode: 'density-preview',
      support: 'supported',
      status: 'available',
      backedBy: 'processed-mask-density',
      settings: { density: 0.5, feather: 2 },
      caveat: 'Density preview changes interpreted mask alpha without rewriting stored mask pixels.',
    });
    expect(summary.previewModeDescriptors?.[2]).toMatchObject({
      mode: 'feather-preview',
      support: 'supported',
      status: 'available',
      backedBy: 'processed-mask-feather',
      settings: { density: 0.5, feather: 2 },
      caveat: 'Feather preview uses the local alpha blur approximation; it is not a dedicated Select and Mask workspace.',
    });
    expect(summary.previewModeDescriptors?.[3]).toMatchObject({
      mode: 'refine-handoff-summaries',
      support: 'partial',
      status: 'summary-only',
      backedBy: 'workflow-preview-summary',
      unsupportedState: 'workspace-missing',
      dedicatedRefineWorkspace: false,
      linkedMaskWorkflow: false,
      caveat: 'Descriptor-only refine handoff summaries are available; no dedicated refine-mask workspace renders Select & Mask preview modes.',
    });
    expect(summary.previewModeDescriptors?.map((descriptor) => descriptor.signature)).toEqual([
      expect.stringContaining('image-layer-mask-preview-mode:v1:'),
      expect.stringContaining('image-layer-mask-preview-mode:v1:'),
      expect.stringContaining('image-layer-mask-preview-mode:v1:'),
      expect.stringContaining('image-layer-mask-preview-mode:v1:'),
    ]);
    expect(summary.workflowPlans.find((plan) => plan.kind === 'refine-workspace-handoff')?.support).toBe('unsupported');
    expect(summary.workflowPlans.find((plan) => plan.kind === 'link-mask')?.support).toBe('supported');
    expect(summary.unsupportedCapabilities.find((descriptor) => descriptor.code === 'dedicated-refine-mask-workspace')?.support).toBe('unsupported');
    expect(summary.unsupportedCapabilities.find((descriptor) => descriptor.code === 'photoshop-linked-mask-parity')?.support).toBe('unsupported');
    expect(summary.signature).toContain('previewModeSignatures');
  });

  it('exposes typed unsupported capability descriptors and lane signatures', () => {
    const layer = makeLayer({
      mask: createHideAllLayerMask({ width: 4, height: 4 } as never, makeLayer()),
    });
    const unsupportedCapabilities = getImageLayerMaskUnsupportedCapabilityDescriptors();
    expect(unsupportedCapabilities).toEqual([
      {
        kind: 'image-layer-mask-unsupported-capability',
        code: 'dedicated-refine-mask-workspace',
        area: 'workspace',
        support: 'unsupported',
        blocker: 'workspace-missing',
        caveat: 'There is no dedicated Select and Mask style workspace for layer-mask edge preview or commit.',
        fallback: 'Refine the document selection first, then create a mask from selection or paint the mask directly.',
        signature: 'image-layer-mask-unsupported:v1:dedicated-refine-mask-workspace:workspace-missing',
      },
      {
        kind: 'image-layer-mask-unsupported-capability',
        code: 'advanced-matte-refine-brush',
        area: 'brush-engine',
        support: 'unsupported',
        blocker: 'workspace-missing',
        caveat: 'Advanced matte cleanup and refine-edge brush strokes are not modeled as layer-mask operations.',
        fallback: 'Use normal brush/eraser alpha painting on the mask or hand off to future selection refinement.',
        signature: 'image-layer-mask-unsupported:v1:advanced-matte-refine-brush:workspace-missing',
      },
      {
        kind: 'image-layer-mask-unsupported-capability',
        code: 'photoshop-linked-mask-parity',
        area: 'photoshop-parity',
        support: 'unsupported',
        blocker: 'partial-ui',
        caveat: 'Sloom Studio linked masks are stored in .slimg, but native Photoshop linked-mask parity is not emitted.',
        fallback: 'Keep .slimg for linked editing; PSD handoff materializes or flattens mask behavior.',
        signature: 'image-layer-mask-unsupported:v1:photoshop-linked-mask-parity:partial-ui',
      },
      {
        kind: 'image-layer-mask-unsupported-capability',
        code: 'native-psd-mask-fidelity',
        area: 'native-file-interop',
        support: 'unsupported',
        blocker: 'partial-ui',
        caveat: 'Native PSD layer-mask fidelity is not guaranteed; editable Sloom Studio masks may flatten or degrade outside the app.',
        fallback: 'Preserve Sloom Studio project metadata for editability and export flattened previews when native fidelity is required.',
        signature: 'image-layer-mask-unsupported:v1:native-psd-mask-fidelity:partial-ui',
      },
    ]);

    const lane = describeImageLayerMaskReadinessLane({ layer, sourceLayer: layer });
    expect(lane.kind).toBe('image-layer-mask-readiness-lane');
    expect(lane.operationKinds).toContain('create-mask-from-selection');
    expect(lane.workflowKinds).toEqual([
      'copy-mask',
      'link-mask',
      'apply-mask',
      'refine-workspace-handoff',
    ]);
    expect(lane.stableSignatures.operations).toHaveLength(10);
    expect(lane.stableSignatures.workflows).toHaveLength(4);
    expect(lane.stableSignatures.overlay).toContain('layer-mask-overlay-preview:v1:');
    expect(lane.stableSignatures.unsupportedCapabilities).toEqual(
      unsupportedCapabilities.map((descriptor) => descriptor.signature),
    );
    expect(lane.signature).toContain('image-layer-mask-readiness-lane:v1:');
  });

  it('describes empty layer-mask overlay preview deterministically', () => {
    expect(describeImageLayerMaskOverlayPreview(makeLayer({ mask: null }), 8, 6)).toMatchObject({
      status: 'empty',
      id: 'layer-mask-overlay-preview:layer-1:8x6',
      layerId: 'layer-1',
      documentSize: { width: 8, height: 6 },
      maskSize: null,
      settings: { density: 1, feather: 0 },
      mismatch: null,
    });
  });

  it('plans copy/link/apply/refine workflow caveats without mutating layer state', () => {
    const sourceLayer = makeLayer({
      mask: createHideAllLayerMask({ width: 8, height: 8 } as never, makeLayer()),
    });
    const targetLayer = makeLayer({ id: 'layer-2', mask: null });

    expect(planImageLayerMaskWorkflow('copy-mask', { sourceLayer, targetLayer })).toMatchObject({
      kind: 'copy-mask',
      canRun: true,
      support: 'partial',
      blockers: [],
      warnings: [
        {
          code: 'copy-link-workflow-partial',
          severity: 'warning',
        },
      ],
      preview: {
        id: 'layer-mask-workflow-preview:copy-mask:layer-1:layer-2',
        signature: 'layer-mask-workflow:v1:{"kind":"copy-mask","support":"partial","sourceLayerId":"layer-1","targetLayerId":"layer-2","sourceHasMask":true,"targetHasMask":false,"sourceHasBitmap":true,"targetHasBitmap":true,"warnings":["copy-link-workflow-partial"],"blockers":[],"previewModes":[]}',
      },
      readiness: {
        state: 'ready-with-caveats',
        unsupportedState: 'partial-ui',
        blockingWarningCodes: [],
      },
    });

    expect(planImageLayerMaskWorkflow('link-mask', { sourceLayer, targetLayer })).toMatchObject({
      kind: 'link-mask',
      canRun: true,
      support: 'supported',
      blockers: [],
      warnings: [],
      readiness: {
        state: 'ready',
        unsupportedState: 'none',
        blockingWarningCodes: [],
      },
    });

    const applyPlan = planImageLayerMaskWorkflow('apply-mask', {
      sourceLayer: makeLayer({ bitmap: null, mask: sourceLayer.mask }),
    });
    expect(applyPlan.warnings.map((warning) => warning.code)).toEqual([
      'apply-mask-bitmap-required',
    ]);
    expect(applyPlan.blockers).toEqual([
      {
        code: 'apply-mask-bitmap-required',
        summary: 'Applying a layer mask is blocked until the source layer has editable bitmap pixels.',
      },
    ]);

    expect(planImageLayerMaskWorkflow('refine-workspace-handoff', { sourceLayer })).toMatchObject({
      canRun: false,
      support: 'unsupported',
      blockers: [
        {
          code: 'refine-workspace-unsupported',
          summary: 'Refine Mask workspace is blocked because the dedicated refinement workspace is not implemented.',
        },
      ],
      previewModes: [
        {
          mode: 'masked-areas',
          ready: false,
          summary: 'Masked Areas preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'selected-areas',
          ready: false,
          summary: 'Selected Areas preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'on-black',
          ready: false,
          summary: 'On Black preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'on-white',
          ready: false,
          summary: 'On White preview is not available because no dedicated refine-mask workspace exists yet.',
        },
        {
          mode: 'black-white',
          ready: false,
          summary: 'Black & White preview is not available because no dedicated refine-mask workspace exists yet.',
        },
      ],
      unsupportedDescriptor: {
        code: 'refine-workspace-unsupported',
        target: 'select-and-mask-handoff-unsupported',
        summary: 'Refine Mask workspace is not available; hand off selection or mask alpha to a future Select and Mask style workflow instead.',
      },
      handoff: {
        preferredInput: 'selection-or-mask-alpha',
        expectedReturn: 'updated-layer-mask-alpha',
      },
    });
  });

  it('warns when copy or link mask targets mismatch the source layer geometry', () => {
    const sourceLayer = makeLayer({
      bitmap: new OffscreenCanvas(4, 4) as LayerBitmap,
      mask: createHideAllLayerMask({ width: 8, height: 8 } as never, makeLayer()),
    });
    const targetLayer = makeLayer({
      id: 'wide-target',
      bitmap: new OffscreenCanvas(6, 4) as LayerBitmap,
      mask: null,
    });

    const plan = planImageLayerMaskWorkflow('copy-mask', { sourceLayer, targetLayer });

    expect(plan.canRun).toBe(true);
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'target-mask-size-mismatch',
      'copy-link-workflow-partial',
    ]);
    expect(plan.targetMismatch).toEqual({
      expected: { width: 4, height: 4 },
      actual: { width: 6, height: 4 },
      warningCode: 'target-mask-size-mismatch',
    });
  });
});
