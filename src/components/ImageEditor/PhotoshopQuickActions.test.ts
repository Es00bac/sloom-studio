import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import {
  PHOTOSHOP_QUICK_ACTIONS,
  adjustLayerBrightness,
  borderSelection,
  centerLayer,
  centerLayerHorizontal,
  centerLayerVertical,
  clearSelectedPixels,
  clearOutsideSelection,
  createPhotoshopQuickActionResult,
  createLayerViaCopy,
  createLayerViaCut,
  desaturateLayer,
  describePhotoshopQuickActionCompatibility,
  duplicateLayerQuickAction,
  cropLayerToSelection,
  featherSelection,
  fillLayerToCanvas,
  fitLayerHeightToCanvas,
  fitLayerInsideCanvas,
  fitLayerToCanvas,
  fitLayerWidthToCanvas,
  flipLayerHorizontal,
  flipLayerVertical,
  getPhotoshopQuickActionCapabilityDescriptor,
  growSelection,
  invertLayerColors,
  listPhotoshopQuickActionCapabilityDescriptors,
  lowerLayerOneStep,
  moveLayerToBack,
  moveLayerToFront,
  nudgeLayer,
  nudgeSelection,
  raiseLayerOneStep,
  rasterizeLayerToCanvas,
  resetLayerPosition,
  rotateLayer180,
  rotateLayer90Clockwise,
  rotateLayer90CounterClockwise,
  scaleLayerByPercent,
  selectBorderRingPercent,
  selectBottomHalf,
  selectCanvas,
  selectCenterSquare,
  selectEdgeStripPercent,
  selectGridCell,
  selectHorizontalCenterBand,
  selectInsetPercent,
  selectLeftHalf,
  selectLayerBounds,
  selectLayerOpaquePixels,
  selectLayerTransparentPixels,
  selectRightHalf,
  selectSelectionBoundingBox,
  selectTopHalf,
  selectVerticalCenterBand,
  shrinkSelection,
  smoothSelection,
  summarizePhotoshopQuickActionCatalog,
  trimCanvasToVisible,
  trimTransparentLayer,
} from './PhotoshopQuickActions';

class FakeContext {
  imageData: ImageData;
  fillStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
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
  translate() {}
  scale() {}
  rotate() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
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

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 8,
    height: 6,
    layers: [],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
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

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  data.set(rgba, (y * bitmap.width + x) * 4);
}

function fillBitmap(bitmap: LayerBitmap, rgba: [number, number, number, number]) {
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      setPixel(bitmap, x, y, rgba);
    }
  }
}

function rgbaAt(bitmap: LayerBitmap, x: number, y: number): number[] {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return Array.from(data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));
}

function alphaAtMask(mask: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return mask.data[y * mask.width + x];
}

describe('PhotoshopQuickActions', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('enumerates the original 70 plus local fill plus 204 more shipped Photoshop-style quick actions', () => {
    const ids = PHOTOSHOP_QUICK_ACTIONS.map((action) => action.id);
    expect(ids.slice(0, 75)).toEqual([
      'selectLayerBounds',
      'selectLayerOpaquePixels',
      'growSelection',
      'shrinkSelection',
      'featherSelection',
      'borderSelection',
      'smoothSelection',
      'nudgeSelectionLeft',
      'nudgeSelectionRight',
      'nudgeSelectionUp',
      'nudgeSelectionDown',
      'clearOutsideSelection',
      'layerViaCopy',
      'layerViaCut',
      'cropLayerToSelection',
      'trimTransparentLayer',
      'flipLayerHorizontal',
      'flipLayerVertical',
      'rotateLayer90Clockwise',
      'rotateLayer90CounterClockwise',
      'centerLayer',
      'fitLayerToCanvas',
      'resetLayerPosition',
      'trimCanvasToVisible',
      'selectCanvas',
      'selectLayerTransparentPixels',
      'selectSelectionBoundingBox',
      'growSelectionLarge',
      'shrinkSelectionLarge',
      'featherSelectionLarge',
      'borderSelectionLarge',
      'clearSelectedPixels',
      'duplicateLayer',
      'moveLayerToFront',
      'moveLayerToBack',
      'nudgeLayerLeft',
      'nudgeLayerRight',
      'nudgeLayerUp',
      'nudgeLayerDown',
      'nudgeLayerLeftLarge',
      'nudgeLayerRightLarge',
      'nudgeLayerUpLarge',
      'nudgeLayerDownLarge',
      'alignLayerLeft',
      'alignLayerRight',
      'alignLayerTop',
      'alignLayerBottom',
      'centerLayerHorizontal',
      'centerLayerVertical',
      'fitLayerWidthToCanvas',
      'fitLayerHeightToCanvas',
      'invertLayerColors',
      'desaturateLayer',
      'resetLayerOpacity',
      'selectTopHalf',
      'selectBottomHalf',
      'selectLeftHalf',
      'selectRightHalf',
      'selectCenterSquare',
      'selectHorizontalCenterBand',
      'selectVerticalCenterBand',
      'setLayerOpacity25',
      'setLayerOpacity50',
      'setLayerOpacity75',
      'setLayerBlendNormal',
      'setLayerBlendMultiply',
      'setLayerBlendScreen',
      'setLayerBlendOverlay',
      'rotateLayer180',
      'raiseLayerOneStep',
      'lowerLayerOneStep',
      'fitLayerInsideCanvas',
      'fillLayerToCanvas',
      'rasterizeLayerToCanvas',
      'localContentAwareFillPatch',
    ]);
    expect(ids).toHaveLength(275);
    expect(new Set(ids).size).toBe(275);
    expect(ids).toEqual(expect.arrayContaining([
      'growSelection16px',
      'selectGrid5x5Cell25',
      'selectEdgeTop20Percent',
      'selectBorderRing30Percent',
      'setLayerOpacity95',
      'setLayerBlendLuminosity',
      'nudgeLayerUpLeft50',
      'scaleLayer200Percent',
      'adjustBrightnessPlus50',
      'setPixelAlpha50',
    ]));
  });

  it('exposes local content-aware fill as a Pixels quick action for the image context menu', () => {
    expect(PHOTOSHOP_QUICK_ACTIONS).toContainEqual({
      id: 'localContentAwareFillPatch',
      label: 'Local Content-Aware Fill / Patch',
      group: 'Pixels',
    });
  });

  it('describes quick-action capabilities by category, input, output, and undoability', () => {
    const descriptors = listPhotoshopQuickActionCapabilityDescriptors();

    expect(descriptors).toHaveLength(PHOTOSHOP_QUICK_ACTIONS.length);
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(
      PHOTOSHOP_QUICK_ACTIONS.map((action) => action.id),
    );
    expect(getPhotoshopQuickActionCapabilityDescriptor('selectLayerBounds')).toEqual({
      id: 'selectLayerBounds',
      label: 'Select Layer Bounds',
      category: 'Selection',
      input: ['document', 'activeLayer'],
      output: 'selection',
      undoable: true,
      mutatesDocument: false,
      implementation: 'local-deterministic',
      warning: null,
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('clearOutsideSelection')).toEqual({
      id: 'clearOutsideSelection',
      label: 'Clear Outside Selection',
      category: 'Pixels',
      input: ['document', 'editablePixels', 'selection'],
      output: 'paint',
      undoable: true,
      mutatesDocument: true,
      implementation: 'local-deterministic',
      warning: null,
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('layerViaCopy')).toEqual({
      id: 'layerViaCopy',
      label: 'Layer via Copy',
      category: 'Layer',
      input: ['document', 'activeLayer', 'selection'],
      output: 'layer',
      undoable: true,
      mutatesDocument: true,
      implementation: 'local-deterministic',
      warning: null,
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('centerLayer')).toEqual({
      id: 'centerLayer',
      label: 'Center Layer',
      category: 'Transform',
      input: ['document', 'movableLayer'],
      output: 'transform',
      undoable: true,
      mutatesDocument: true,
      implementation: 'local-deterministic',
      warning: null,
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('trimCanvasToVisible')).toEqual({
      id: 'trimCanvasToVisible',
      label: 'Trim Canvas to Visible Pixels',
      category: 'Canvas',
      input: ['document'],
      output: 'document',
      undoable: true,
      mutatesDocument: true,
      implementation: 'local-deterministic',
      warning: null,
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('localContentAwareFillPatch')).toEqual({
      id: 'localContentAwareFillPatch',
      label: 'Local Content-Aware Fill / Patch',
      category: 'Pixels',
      input: ['document', 'editablePixels'],
      output: 'paint',
      undoable: true,
      mutatesDocument: true,
      implementation: 'local-approximation',
      warning: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
    });
    expect(getPhotoshopQuickActionCapabilityDescriptor('missingAction')).toBeNull();
  });

  it('warns when a quick action is a local approximation of Photoshop or cloud AI features', () => {
    const localFill = getPhotoshopQuickActionCapabilityDescriptor('localContentAwareFillPatch');
    const warnedActionIds = listPhotoshopQuickActionCapabilityDescriptors()
      .filter((descriptor) => descriptor.warning)
      .map((descriptor) => descriptor.id);

    expect(warnedActionIds).toEqual(['localContentAwareFillPatch']);
    expect(localFill).toMatchObject({
      implementation: 'local-approximation',
      warning: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
    });
  });

  it('describes content-aware quick-action compatibility with retained new-layer output', () => {
    const layer = makeLayer();
    fillBitmap(layer.bitmap as LayerBitmap, [30, 60, 90, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [240, 0, 0, 255]);
    const doc = makeDoc({ layers: [layer], activeLayerId: layer.id });
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 1, 1, 255, false);

    const compatibility = describePhotoshopQuickActionCompatibility({
      actionId: 'localContentAwareFillPatch',
      doc,
      selection,
      operation: 'patch',
      outputTarget: 'new-layer',
    });

    expect(compatibility).toMatchObject({
      descriptorId: 'photoshop-quick-action-compatibility:v1',
      actionId: 'localContentAwareFillPatch',
      documentId: 'doc-1',
      activeLayerId: 'layer-1',
      knownAction: true,
      category: 'Pixels',
      output: 'paint',
      implementation: 'local-approximation',
      compatible: true,
      blockerCodes: [],
      warnings: [
        'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
      ],
      contentAwareRepair: {
        operation: 'patch',
        targetKind: 'selection',
        readinessState: 'ready',
        activeLayerExecutable: true,
        targetPixels: 1,
        sourcePixels: 11,
        blockerCodes: [],
        requestedOutputTarget: 'new-layer',
        appliedOutputTarget: 'new-layer',
        outputCreatesLayer: true,
        nonDestructive: true,
      },
    });
    expect(compatibility.contentAwareRepair?.samplingRegionSignature).toContain('local-content-aware-sampling-region:v1:');
    expect(compatibility.contentAwareRepair?.operationSignature).toBe(
      'local-content-aware-operation:v1:{"operation":"patch","execution":"sample-and-blend-source-pixels","requiresSourcePixels":true,"modifiesRgb":true,"modifiesAlpha":true}',
    );
    expect(compatibility.previewSignature).toContain('"outputPolicySignature":"local-content-aware-output-policy:v1:');
  });

  it('blocks content-aware quick actions when transparent fallback has no target pixels', () => {
    const layer = makeLayer();
    fillBitmap(layer.bitmap as LayerBitmap, [30, 60, 90, 255]);
    const doc = makeDoc({ layers: [layer], activeLayerId: layer.id });

    const compatibility = describePhotoshopQuickActionCompatibility({
      actionId: 'localContentAwareFillPatch',
      doc,
    });

    expect(compatibility).toMatchObject({
      compatible: false,
      blockerCodes: ['empty-transparent-target'],
      contentAwareRepair: {
        operation: 'fill',
        targetKind: 'transparent-pixels',
        readinessState: 'no-target-pixels',
        activeLayerExecutable: false,
        targetPixels: 0,
        sourcePixels: 0,
        blockerCodes: ['empty-transparent-target'],
      },
    });
  });

  it('summarizes the quick-action catalog in stable dashboard-ready buckets', () => {
    expect(summarizePhotoshopQuickActionCatalog()).toEqual({
      total: 275,
      byCategory: {
        Selection: 131,
        Pixels: 13,
        Layer: 48,
        Transform: 82,
        Canvas: 1,
      },
      byInput: {
        document: 229,
        activeLayer: 47,
        editablePixels: 35,
        movableLayer: 64,
        selection: 51,
      },
      byOutput: {
        selection: 131,
        paint: 13,
        layer: 66,
        transform: 64,
        document: 1,
      },
      undoable: {
        undoable: 275,
        notUndoable: 0,
      },
      mutatesDocument: {
        mutating: 144,
        nonMutating: 131,
      },
      warnings: [
        {
          id: 'localContentAwareFillPatch',
          label: 'Local Content-Aware Fill / Patch',
          warning: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
        },
      ],
    });
  });

  it('creates layer selections and selection morphology variants', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [255, 0, 0, 200]);

    const bounds = selectLayerBounds(doc, layer);
    const opaque = selectLayerOpaquePixels(doc, layer);
    const grown = growSelection(opaque, 1);
    const shrunk = shrinkSelection(grown, 1);
    const feathered = featherSelection(opaque, 1);
    const bordered = borderSelection(grown, 1);
    const smoothed = smoothSelection(grown);
    const nudged = nudgeSelection(opaque, 2, 1);

    expect(alphaAtMask(bounds, 2, 1)).toBe(255);
    expect(alphaAtMask(bounds, 5, 3)).toBe(255);
    expect(alphaAtMask(opaque, 3, 2)).toBe(200);
    expect(alphaAtMask(grown, 2, 2)).toBe(200);
    expect(alphaAtMask(shrunk, 3, 2)).toBe(200);
    expect(alphaAtMask(feathered, 3, 2)).toBeLessThan(200);
    expect(alphaAtMask(feathered, 3, 2)).toBeGreaterThan(0);
    expect(alphaAtMask(bordered, 2, 2)).toBe(200);
    expect(alphaAtMask(smoothed, 3, 2)).toBeGreaterThan(0);
    expect(alphaAtMask(nudged, 5, 3)).toBe(200);
    expect(alphaAtMask(nudged, 3, 2)).toBe(0);
  });

  it('supports additional canvas and selection quick actions', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [255, 0, 0, 200]);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 2, 2, 255, false);

    const canvas = selectCanvas(doc);
    const transparent = selectLayerTransparentPixels(doc, layer);
    const selectionBounds = selectSelectionBoundingBox(selection);
    const grownLarge = growSelection(selection, 2);
    const shrunkLarge = shrinkSelection(grownLarge, 2);
    const featheredLarge = featherSelection(selection, 2);
    const borderedLarge = borderSelection(selection, 2);

    expect(alphaAtMask(canvas, 0, 0)).toBe(255);
    expect(alphaAtMask(canvas, doc.width - 1, doc.height - 1)).toBe(255);
    expect(alphaAtMask(transparent, 3, 2)).toBe(0);
    expect(alphaAtMask(transparent, 2, 1)).toBe(255);
    expect(alphaAtMask(selectionBounds, 3, 2)).toBe(255);
    expect(alphaAtMask(selectionBounds, 4, 3)).toBe(255);
    expect(alphaAtMask(grownLarge, 1, 2)).toBe(255);
    expect(alphaAtMask(shrunkLarge, 3, 2)).toBe(255);
    expect(alphaAtMask(featheredLarge, 2, 2)).toBeGreaterThan(0);
    expect(alphaAtMask(borderedLarge, 2, 2)).toBeGreaterThan(0);
  });

  it('supports preset region selection quick actions', () => {
    const doc = makeDoc({ width: 10, height: 8 });

    expect(alphaAtMask(selectTopHalf(doc), 5, 1)).toBe(255);
    expect(alphaAtMask(selectTopHalf(doc), 5, 7)).toBe(0);
    expect(alphaAtMask(selectBottomHalf(doc), 5, 7)).toBe(255);
    expect(alphaAtMask(selectLeftHalf(doc), 1, 4)).toBe(255);
    expect(alphaAtMask(selectRightHalf(doc), 9, 4)).toBe(255);
    expect(alphaAtMask(selectCenterSquare(doc), 5, 4)).toBe(255);
    expect(alphaAtMask(selectCenterSquare(doc), 0, 0)).toBe(0);
    expect(alphaAtMask(selectHorizontalCenterBand(doc), 5, 4)).toBe(255);
    expect(alphaAtMask(selectHorizontalCenterBand(doc), 5, 0)).toBe(0);
    expect(alphaAtMask(selectVerticalCenterBand(doc), 5, 4)).toBe(255);
    expect(alphaAtMask(selectVerticalCenterBand(doc), 0, 4)).toBe(0);
  });

  it('supports generated grid, edge, inset, and border selection presets', () => {
    const doc = makeDoc({ width: 100, height: 80 });

    const grid = selectGridCell(doc, 5, 5, 25);
    const topEdge = selectEdgeStripPercent(doc, 'top', 20);
    const inset = selectInsetPercent(doc, 10);
    const ring = selectBorderRingPercent(doc, 20);

    expect(alphaAtMask(grid, 90, 70)).toBe(255);
    expect(alphaAtMask(grid, 10, 10)).toBe(0);
    expect(alphaAtMask(topEdge, 50, 15)).toBe(255);
    expect(alphaAtMask(topEdge, 50, 20)).toBe(0);
    expect(alphaAtMask(inset, 10, 8)).toBe(255);
    expect(alphaAtMask(inset, 5, 4)).toBe(0);
    expect(alphaAtMask(ring, 5, 5)).toBe(255);
    expect(alphaAtMask(ring, 50, 40)).toBe(0);
  });

  it('supports clear outside selection plus layer via copy/cut', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [255, 0, 0, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [0, 255, 0, 255]);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 1, 1, 255, false);

    const cleared = clearOutsideSelection(doc, layer, selection);
    const copied = createLayerViaCopy(doc, layer, selection, 'copy-1');
    const cut = createLayerViaCut(doc, layer, selection, 'cut-1');

    expect(cleared?.kind).toBe('paint');
    expect(rgbaAt(cleared?.after as LayerBitmap, 0, 0)[3]).toBe(0);
    expect(rgbaAt(cleared?.after as LayerBitmap, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(copied?.id).toBe('copy-1');
    expect(copied?.x).toBe(3);
    expect(copied?.y).toBe(2);
    expect(copied?.bitmap?.width).toBe(1);
    expect(cut?.newLayer.id).toBe('cut-1');
    expect(rgbaAt(cut?.paintOp.after as LayerBitmap, 1, 1)[3]).toBe(0);
  });

  it('supports selected-pixel clear plus color adjustment actions', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [10, 20, 30, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [90, 150, 210, 255]);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 1, 1, 255, false);

    const cleared = clearSelectedPixels(doc, layer, selection);
    const inverted = invertLayerColors(doc, layer);
    const desaturated = desaturateLayer(doc, layer);

    expect(cleared?.kind).toBe('paint');
    expect(rgbaAt(cleared?.after as LayerBitmap, 1, 1)[3]).toBe(0);
    expect(rgbaAt(inverted?.after as LayerBitmap, 0, 0)).toEqual([245, 235, 225, 255]);
    expect(rgbaAt(desaturated?.after as LayerBitmap, 1, 1).slice(0, 3)).toEqual([139, 139, 139]);
  });

  it('supports layer crop, trim, flips, rotations, centering, fit, and reset', () => {
    const doc = makeDoc();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [10, 0, 0, 255]);
    setPixel(layer.bitmap as LayerBitmap, 3, 2, [20, 0, 0, 255]);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 2, 1, 2, 2, 255, false);

    const cropped = cropLayerToSelection(doc, layer, selection);
    const trimmed = trimTransparentLayer(layer);
    const flippedH = flipLayerHorizontal(layer);
    const flippedV = flipLayerVertical(layer);
    const rotatedCw = rotateLayer90Clockwise(layer);
    const rotatedCcw = rotateLayer90CounterClockwise(layer);
    const centered = centerLayer(doc, layer);
    const fitted = fitLayerToCanvas(doc, layer);
    const reset = resetLayerPosition(layer);

    expect(cropped?.x).toBe(2);
    expect(cropped?.y).toBe(1);
    expect(cropped?.bitmap?.width).toBe(2);
    expect(trimmed?.bitmap?.width).toBe(4);
    expect(rgbaAt(flippedH.bitmap as LayerBitmap, 3, 0)).toEqual([10, 0, 0, 255]);
    expect(rgbaAt(flippedV.bitmap as LayerBitmap, 3, 0)).toEqual([20, 0, 0, 255]);
    expect(rotatedCw.bitmap?.width).toBe(3);
    expect(rotatedCw.bitmap?.height).toBe(4);
    expect(rgbaAt(rotatedCw.bitmap as LayerBitmap, 2, 0)).toEqual([10, 0, 0, 255]);
    expect(rgbaAt(rotatedCcw.bitmap as LayerBitmap, 0, 3)).toEqual([10, 0, 0, 255]);
    expect(centered.x).toBe(2);
    expect(centered.y).toBe(1.5);
    expect(fitted.bitmap?.width).toBe(doc.width);
    expect(fitted.bitmap?.height).toBe(doc.height);
    expect(reset.x).toBe(0);
    expect(reset.y).toBe(0);
  });

  it('supports extra layer order, nudge, align, center, fit, and opacity actions', () => {
    const doc = makeDoc({
      layers: [
        makeLayer({ id: 'back', name: 'Back' }),
        makeLayer({ id: 'active', name: 'Active', opacity: 0.25 }),
        makeLayer({ id: 'front', name: 'Front' }),
      ],
      activeLayerId: 'active',
    });
    const layer = doc.layers[1];

    const duplicated = duplicateLayerQuickAction(doc, layer, 'duplicate');
    const movedFront = moveLayerToFront(doc, layer);
    const movedBack = moveLayerToBack(doc, layer);
    const raised = raiseLayerOneStep(doc, layer);
    const lowered = lowerLayerOneStep(doc, layer);
    const nudged = nudgeLayer(layer, -10, 10);
    const alignedLeft = nudgeLayer(layer, -layer.x, 0);
    const alignedRight = nudgeLayer(layer, doc.width - (layer.x + (layer.bitmap?.width ?? 0)), 0);
    const alignedTop = nudgeLayer(layer, 0, -layer.y);
    const alignedBottom = nudgeLayer(layer, 0, doc.height - (layer.y + (layer.bitmap?.height ?? 0)));
    const centeredX = centerLayerHorizontal(doc, layer);
    const centeredY = centerLayerVertical(doc, layer);
    const fitWidth = fitLayerWidthToCanvas(doc, layer);
    const fitHeight = fitLayerHeightToCanvas(doc, layer);
    const fitInside = fitLayerInsideCanvas(doc, layer);
    const filled = fillLayerToCanvas(doc, layer);

    expect(duplicated.map((candidate) => candidate.id)).toEqual(['back', 'active', 'duplicate', 'front']);
    expect(movedFront.map((candidate) => candidate.id)).toEqual(['back', 'front', 'active']);
    expect(movedBack.map((candidate) => candidate.id)).toEqual(['active', 'back', 'front']);
    expect(raised.map((candidate) => candidate.id)).toEqual(['back', 'front', 'active']);
    expect(lowered.map((candidate) => candidate.id)).toEqual(['active', 'back', 'front']);
    expect(nudged.x).toBe(-8);
    expect(nudged.y).toBe(11);
    expect(alignedLeft.x).toBe(0);
    expect(alignedRight.x).toBe(4);
    expect(alignedTop.y).toBe(0);
    expect(alignedBottom.y).toBe(3);
    expect(centeredX.x).toBe(2);
    expect(centeredY.y).toBe(1.5);
    expect(fitWidth.bitmap?.width).toBe(doc.width);
    expect(fitWidth.bitmap?.height).toBe(6);
    expect(fitHeight.bitmap?.width).toBe(8);
    expect(fitHeight.bitmap?.height).toBe(doc.height);
    expect(fitInside.bitmap?.width).toBe(8);
    expect(fitInside.bitmap?.height).toBe(6);
    expect(filled.bitmap?.width).toBe(8);
    expect(filled.bitmap?.height).toBe(6);
  });

  it('supports additional layer rotation, rasterize, opacity, and blend quick action results', () => {
    const layer = makeLayer({ opacity: 0.25, blendMode: 'multiply' });
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [10, 0, 0, 255]);
    const doc = makeDoc({ layers: [layer] });

    const rotated = rotateLayer180(layer);
    const rasterized = rasterizeLayerToCanvas(doc, layer);
    const opacityResult = createPhotoshopQuickActionResult({
      actionId: 'setLayerOpacity50',
      doc,
      layer,
    });
    const blendResult = createPhotoshopQuickActionResult({
      actionId: 'setLayerBlendScreen',
      doc,
      layer,
    });

    expect(rgbaAt(rotated.bitmap as LayerBitmap, 3, 2)).toEqual([10, 0, 0, 255]);
    expect(rasterized.bitmap?.width).toBe(doc.width);
    expect(rasterized.bitmap?.height).toBe(doc.height);
    expect(rasterized.x).toBe(0);
    expect(rasterized.y).toBe(0);
    expect(opacityResult?.kind).toBe('layerOp');
    expect(
      opacityResult?.kind === 'layerOp'
        ? opacityResult.operation.after.find((candidate) => candidate.id === layer.id)?.opacity
        : undefined,
    ).toBe(0.5);
    expect(
      blendResult?.kind === 'layerOp'
        ? blendResult.operation.after.find((candidate) => candidate.id === layer.id)?.blendMode
        : undefined,
    ).toBe('screen');
  });

  it('supports generated opacity, blend, nudge, scale, and pixel adjustment results', () => {
    const layer = makeLayer({ opacity: 0.25, blendMode: 'normal' });
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [100, 120, 140, 200]);
    const doc = makeDoc({ layers: [layer] });

    const opacityResult = createPhotoshopQuickActionResult({
      actionId: 'setLayerOpacity95',
      doc,
      layer,
    });
    const blendResult = createPhotoshopQuickActionResult({
      actionId: 'setLayerBlendLuminosity',
      doc,
      layer,
    });
    const nudgeResult = createPhotoshopQuickActionResult({
      actionId: 'nudgeLayerUpLeft50',
      doc,
      layer,
    });
    const scaleResult = createPhotoshopQuickActionResult({
      actionId: 'scaleLayer200Percent',
      doc,
      layer,
    });
    const brightnessResult = createPhotoshopQuickActionResult({
      actionId: 'adjustBrightnessPlus50',
      doc,
      layer,
    });
    const alphaResult = createPhotoshopQuickActionResult({
      actionId: 'setPixelAlpha50',
      doc,
      layer,
    });

    expect(
      opacityResult?.kind === 'layerOp'
        ? opacityResult.operation.after.find((candidate) => candidate.id === layer.id)?.opacity
        : undefined,
    ).toBe(0.95);
    expect(
      blendResult?.kind === 'layerOp'
        ? blendResult.operation.after.find((candidate) => candidate.id === layer.id)?.blendMode
        : undefined,
    ).toBe('luminosity');
    expect(nudgeResult?.kind).toBe('transform');
    expect(nudgeResult?.kind === 'transform' ? nudgeResult.operation.after : undefined).toEqual({ x: -48, y: -49 });
    expect(scaleResult?.kind).toBe('layerOp');
    expect(scaleLayerByPercent(doc, layer, 200).bitmap?.width).toBe(8);
    expect(rgbaAt(adjustLayerBrightness(doc, layer, 50)?.after as LayerBitmap, 0, 0)).toEqual([150, 170, 190, 200]);
    expect(brightnessResult?.kind).toBe('paint');
    expect(alphaResult?.kind).toBe('paint');
    expect(rgbaAt((alphaResult?.kind === 'paint' ? alphaResult.operation.after : layer.bitmap) as LayerBitmap, 0, 0)[3]).toBe(100);
  });

  it('trims the canvas to visible layer pixels and shifts layers into the new document space', () => {
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [255, 255, 255, 255]);
    const doc = makeDoc({ layers: [layer] });

    const trimmed = trimCanvasToVisible(doc);

    expect(trimmed?.width).toBe(1);
    expect(trimmed?.height).toBe(1);
    expect(trimmed?.layers[0].x).toBe(-1);
    expect(trimmed?.layers[0].y).toBe(-1);
  });

  it('creates executable menu results for selection, layer, paint, transform, and canvas actions', () => {
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [0, 255, 0, 255]);
    const doc = makeDoc({ layers: [layer] });
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 3, 2, 1, 1, 255, false);

    const selectionResult = createPhotoshopQuickActionResult({
      actionId: 'nudgeSelectionRight',
      doc,
      layer,
      selection,
    });
    const paintResult = createPhotoshopQuickActionResult({
      actionId: 'clearOutsideSelection',
      doc,
      layer,
      selection,
    });
    const layerResult = createPhotoshopQuickActionResult({
      actionId: 'layerViaCopy',
      doc,
      layer,
      selection,
      createLayerId: () => 'new-layer',
    });
    const transformResult = createPhotoshopQuickActionResult({
      actionId: 'centerLayer',
      doc,
      layer,
      selection,
    });
    const canvasResult = createPhotoshopQuickActionResult({
      actionId: 'trimCanvasToVisible',
      doc,
      layer,
      selection,
    });
    const opacityResult = createPhotoshopQuickActionResult({
      actionId: 'resetLayerOpacity',
      doc,
      layer: { ...layer, opacity: 0.25 },
      selection,
    });

    expect(selectionResult?.kind).toBe('selection');
    expect(selectionResult?.kind === 'selection' ? alphaAtMask(selectionResult.selection, 4, 2) : 0).toBe(255);
    expect(selectionResult?.kind === 'selection' ? alphaAtMask(selectionResult.selection, 3, 2) : 255).toBe(0);
    expect(paintResult?.kind).toBe('paint');
    expect(layerResult?.kind).toBe('layerOp');
    expect(layerResult?.kind === 'layerOp' ? layerResult.activeLayerId : undefined).toBe('new-layer');
    expect(transformResult?.kind).toBe('transform');
    expect(canvasResult?.kind).toBe('docResize');
    expect(opacityResult?.kind).toBe('layerOp');
  });
});
