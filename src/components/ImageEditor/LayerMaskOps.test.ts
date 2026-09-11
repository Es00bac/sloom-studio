import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import {
  applyLayerMaskToLayer,
  buildLayerMaskOperationSignature,
  createHideAllLayerMask,
  createLayerMaskFromSelection,
  createRevealAllLayerMask,
  getLayerMaskOperationDescriptor,
  getLayerMaskOperationSignatures,
  invertLayerMask,
  LAYER_MASK_OPERATION_DESCRIPTORS,
  planLayerMaskOperation,
  type LayerMaskOperationKind,
} from './LayerMaskOps';

const EXPECTED_LAYER_MASK_OPERATION_ORDER: LayerMaskOperationKind[] = [
  'reveal-all',
  'hide-all',
  'from-selection',
  'invert',
  'apply',
  'delete',
  'density',
  'feather',
];

class FakeContext {
  imageData: ImageData;
  fillStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';

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

function makeDoc(): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 10,
    height: 8,
    layers: [],
    activeLayerId: 'layer-1',
    hasSelection: true,
    selectionVersion: 1,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
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
    x: 2,
    y: 1,
    bitmap: new OffscreenCanvas(4, 3) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return data[(y * bitmap.width + x) * 4 + 3];
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  const offset = (y * bitmap.width + x) * 4;
  data.set(rgba, offset);
}

describe('LayerMaskOps', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('creates a layer-local reveal mask from a document-space selection', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 2, 1, 255, false);

    const mask = createLayerMaskFromSelection(doc, layer, selection, 'reveal-selection');

    expect(mask.width).toBe(4);
    expect(mask.height).toBe(3);
    expect(alphaAt(mask, 0, 0)).toBe(0);
    expect(alphaAt(mask, 1, 1)).toBe(255);
    expect(alphaAt(mask, 2, 1)).toBe(255);
    expect(alphaAt(mask, 3, 1)).toBe(0);
  });

  it('can create reveal-all, hide-all, and inverted masks', () => {
    const doc = makeDoc();
    const layer = makeLayer();

    const reveal = createRevealAllLayerMask(doc, layer);
    const hide = createHideAllLayerMask(doc, layer);
    const inverted = invertLayerMask(reveal);

    expect(alphaAt(reveal, 0, 0)).toBe(255);
    expect(alphaAt(hide, 0, 0)).toBe(0);
    expect(alphaAt(inverted, 0, 0)).toBe(0);
  });

  it('applies a layer mask into bitmap alpha and clears the mask', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const mask = createHideAllLayerMask(doc, layer);
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [200, 100, 50, 200]);
    setPixel(mask, 0, 0, [255, 255, 255, 128]);

    const applied = applyLayerMaskToLayer({ ...layer, mask });

    expect(applied.mask).toBeNull();
    expect(applied.bitmapVersion).toBe(1);
    expect(alphaAt(applied.bitmap as LayerBitmap, 0, 0)).toBe(100);
  });

  it('applies mask density when baking a layer mask into bitmap alpha', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const mask = createHideAllLayerMask(doc, layer);
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [200, 100, 50, 200]);

    const applied = applyLayerMaskToLayer({
      ...layer,
      mask,
      maskDensity: 0.5,
    } as ImageLayer);

    expect(alphaAt(applied.bitmap as LayerBitmap, 0, 0)).toBe(100);
  });

  it('applies mask feather when baking a layer mask into bitmap alpha', () => {
    const layer = makeLayer({
      bitmap: new OffscreenCanvas(3, 1) as LayerBitmap,
    });
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [200, 100, 50, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 0, [200, 100, 50, 255]);
    setPixel(layer.bitmap as LayerBitmap, 2, 0, [200, 100, 50, 255]);

    const mask = new OffscreenCanvas(3, 1) as LayerBitmap;
    setPixel(mask, 0, 0, [255, 255, 255, 255]);
    setPixel(mask, 1, 0, [255, 255, 255, 0]);
    setPixel(mask, 2, 0, [255, 255, 255, 0]);

    const applied = applyLayerMaskToLayer({
      ...layer,
      mask,
      maskFeather: 1,
    } as ImageLayer);

    expect(alphaAt(applied.bitmap as LayerBitmap, 0, 0)).toBeLessThan(255);
    expect(alphaAt(applied.bitmap as LayerBitmap, 1, 0)).toBeGreaterThan(0);
    expect(alphaAt(applied.bitmap as LayerBitmap, 1, 0)).toBeLessThan(255);
    expect(alphaAt(applied.bitmap as LayerBitmap, 2, 0)).toBe(0);
  });

  it('describes supported layer-mask operations in deterministic order', () => {
    expect(LAYER_MASK_OPERATION_DESCRIPTORS.map((descriptor) => descriptor.kind)).toEqual(
      EXPECTED_LAYER_MASK_OPERATION_ORDER,
    );
    expect(new Set(LAYER_MASK_OPERATION_DESCRIPTORS.map((descriptor) => descriptor.kind)).size)
      .toBe(EXPECTED_LAYER_MASK_OPERATION_ORDER.length);

    expect(getLayerMaskOperationDescriptor('apply')).toMatchObject({
      kind: 'apply',
      label: 'Apply Layer Mask',
      source: 'existing-mask',
      output: 'layer-bitmap',
      mutation: 'bake-mask',
      requiresMask: true,
      destructive: true,
      undoable: true,
    });
    expect(getLayerMaskOperationDescriptor('density')).toMatchObject({
      kind: 'density',
      label: 'Mask Density',
      source: 'mask-settings',
      output: 'mask-settings',
      mutation: 'update-mask-settings',
      requiresMask: true,
      destructive: false,
      undoable: true,
    });
  });

  it('exposes deterministic operation signatures for future planning surfaces', () => {
    expect(getLayerMaskOperationSignatures().map((signature) => signature.kind)).toEqual(
      EXPECTED_LAYER_MASK_OPERATION_ORDER,
    );

    expect(buildLayerMaskOperationSignature(getLayerMaskOperationDescriptor('apply'))).toEqual({
      kind: 'apply',
      label: 'Apply Layer Mask',
      source: 'existing-mask',
      output: 'layer-bitmap',
      mutation: 'bake-mask',
      requirements: {
        selection: false,
        mask: true,
        bitmap: true,
      },
      behavior: {
        destructive: true,
        undoable: true,
        supportsPreview: true,
      },
      readiness: {
        readinessId: 'layer-mask-op-readiness:apply',
        action: 'apply',
        stateWhenRequirementsMet: 'ready-destructive',
        requiresRasterTarget: true,
        exportCaveat: 'Applied layer masks bake alpha into bitmap pixels; the editable mask is removed after commit.',
      },
      previewMetadata: {
        target: 'pixel-alpha',
        changesPixels: true,
        changesMaskPixels: false,
        changesMaskSettings: false,
      },
    });
    expect(buildLayerMaskOperationSignature(getLayerMaskOperationDescriptor('density'))).toMatchObject({
      kind: 'density',
      previewMetadata: {
        target: 'mask-settings',
        changesPixels: false,
        changesMaskPixels: false,
        changesMaskSettings: true,
      },
    });
  });

  it('plans a from-selection layer-mask operation with normalized settings and workflow warnings', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 2, 1, 255, false);

    const plan = planLayerMaskOperation(doc, layer, 'from-selection', {
      density: 1.4,
      feather: 2.345,
      selection,
      selectionMode: 'hide-selection',
      workflows: {
        copyLinkWorkflow: true,
        refineWorkspace: true,
      },
    });

    expect(plan).toMatchObject({
      kind: 'from-selection',
      layerId: 'layer-1',
      canRun: true,
      hasBitmap: true,
      hasMask: false,
      maskSize: { width: 4, height: 3 },
      selection: {
        present: true,
        width: 10,
        height: 8,
        bounds: { x: 3, y: 2, width: 2, height: 1 },
        alphaRange: { min: 0, max: 255 },
      },
      settings: {
        density: 1,
        feather: 2.35,
        selectionMode: 'hide-selection',
      },
      warnings: [
        {
          code: 'refine-workspace-unsupported',
          severity: 'warning',
        },
        {
          code: 'copy-link-workflow-partial',
          severity: 'warning',
        },
      ],
    });
    expect(plan.previewSignature).toBe(
      'layer-mask-op:v1:{"kind":"from-selection","layerId":"layer-1","maskSize":{"width":4,"height":3},"hasBitmap":true,"hasMask":false,"settings":{"density":1,"feather":2.35,"selectionMode":"hide-selection"},"selection":{"present":true,"width":10,"height":8,"bounds":{"x":3,"y":2,"width":2,"height":1},"alphaRange":{"min":0,"max":255}},"warnings":["refine-workspace-unsupported","copy-link-workflow-partial"]}',
    );
    expect(plan.preview.summary).toBe(
      'Mask From Selection previews a hide-selection mask with density 1 and feather 2.35 metadata; density and feather remain preview-time metadata until baking.',
    );
    expect(plan.settingsApplication).toEqual({
      density: {
        value: 1,
        appliesTo: ['mask-preview', 'mask-bake', 'export-flattening'],
        nonDestructive: true,
        previewCaveat: 'Density preview changes interpreted mask coverage without rewriting stored mask alpha.',
      },
      feather: {
        value: 2.35,
        appliesTo: ['mask-preview', 'mask-bake', 'export-flattening'],
        nonDestructive: true,
        previewCaveat: 'Feather preview uses a local blur approximation before any destructive mask bake.',
      },
    });
    expect(plan.preview.summary).toBe(
      'Mask From Selection previews a hide-selection mask with density 1 and feather 2.35 metadata; density and feather remain preview-time metadata until baking.',
    );
  });

  it('warns when mask operations cannot run against the current layer state', () => {
    const doc = makeDoc();
    const layer = makeLayer({ bitmap: null, mask: null });

    const applyPlan = planLayerMaskOperation(doc, layer, 'apply');
    expect(applyPlan.canRun).toBe(false);
    expect(applyPlan.warnings.map((warning) => warning.code)).toEqual([
      'mask-required',
      'bitmap-required',
    ]);

    const featherPlan = planLayerMaskOperation(doc, layer, 'feather', { feather: -3 });
    expect(featherPlan.canRun).toBe(false);
    expect(featherPlan.settings.feather).toBe(0);
    expect(featherPlan.warnings.map((warning) => warning.code)).toEqual(['mask-required']);
  });

  it('adds deterministic preview metadata and target warnings to operation plans', () => {
    const doc = makeDoc();
    const layer = makeLayer({
      mask: createRevealAllLayerMask(makeDoc(), makeLayer()),
    });

    const applyPlan = planLayerMaskOperation(doc, layer, 'apply', {
      editTarget: 'mask',
    });
    expect(applyPlan.preview).toEqual({
      id: 'layer-mask-op-preview:apply:layer-1',
      signature: applyPlan.previewSignature,
      summary: 'Apply Layer Mask previews bitmap alpha baking with current density/feather mask metadata.',
      target: 'pixel-alpha',
      changesPixels: true,
      changesMaskPixels: false,
      changesMaskSettings: false,
      reversiblePreview: true,
    });
    expect(applyPlan.readiness).toEqual({
      readinessId: 'layer-mask-op-readiness:apply:layer-1',
      state: 'ready-destructive',
      action: 'apply',
      blockingWarningCodes: [],
      requiresRasterTarget: true,
      exportCaveat: 'Applied layer masks bake alpha into bitmap pixels; the editable mask is removed after commit.',
    });
    expect(applyPlan.warnings.map((warning) => warning.code)).toEqual([
      'mask-target-ignored-for-pixel-operation',
    ]);

    const deletePlan = planLayerMaskOperation(doc, layer, 'delete');
    expect(deletePlan.readiness).toEqual({
      readinessId: 'layer-mask-op-readiness:delete:layer-1',
      state: 'ready-destructive',
      action: 'delete',
      blockingWarningCodes: [],
      requiresRasterTarget: false,
      exportCaveat: 'Deleted layer masks are omitted from handoff/export and cannot round-trip as editable masks.',
    });

    const invertPlan = planLayerMaskOperation(doc, layer, 'invert', {
      editTarget: 'pixels',
    });
    expect(invertPlan.preview).toMatchObject({
      id: 'layer-mask-op-preview:invert:layer-1',
      target: 'mask-alpha',
      changesPixels: false,
      changesMaskPixels: true,
    });
    expect(invertPlan.warnings.map((warning) => warning.code)).toEqual([
      'pixel-target-ignored-for-mask-operation',
    ]);
  });
});
