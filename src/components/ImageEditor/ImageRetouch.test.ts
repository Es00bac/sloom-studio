import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBlurBrushToImageData,
  applyCloneStampToImageData,
  applySpongeBrushToImageData,
  applyToneBrushToImageData,
  applySharpenBrushToImageData,
  applySmudgeBrushToImageData,
  applySpotHealToImageData,
  buildCloneStampOverlayDescriptor,
  describeCloneStampToolWorkflow,
  describeRetouchContentAwareRepairParity,
  describeRetouchLocalOutputReadiness,
  describeRetouchOutputPolicy,
  describeRetouchParityChecks,
  describeRetouchPreviewIds,
  describeRetouchSampleSourceState,
  describeRetouchWorkflowReadiness,
  describeRetouchBrushToolPlan,
  describeRetouchBrushRouteSupport,
  describeRetouchToolReadiness,
  describeTonalSaturationBrushReadiness,
  buildSpotHealPatchPlan,
  describeSpotHealToolWorkflow,
  resolveCloneStampSourcePoint,
  resolveRetouchStrokeDensityStep,
} from './ImageRetouch';
import { blurBrushCapabilityDescriptor } from './tools/blurBrushTool';
import { sharpenBrushCapabilityDescriptor } from './tools/sharpenBrushTool';
import { smudgeBrushCapabilityDescriptor } from './tools/smudgeBrushTool';
import { spongeBrushCapabilityDescriptor } from './tools/spongeBrushTool';
import { toneBrushCapabilityDescriptors } from './tools/toneBrushTool';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * imageData.width + x) * 4;
  imageData.data[offset] = rgba[0];
  imageData.data[offset + 1] = rgba[1];
  imageData.data[offset + 2] = rgba[2];
  imageData.data[offset + 3] = rgba[3];
}

function getPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const offset = (y * imageData.width + x) * 4;
  return [
    imageData.data[offset],
    imageData.data[offset + 1],
    imageData.data[offset + 2],
    imageData.data[offset + 3],
  ];
}

function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer',
    name: 'Layer',
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

function makeDoc(layers: ImageLayer[], activeLayerId: string | null = layers[0]?.id ?? null): ImageDocument {
  return {
    id: 'doc',
    title: 'Doc',
    width: 100,
    height: 100,
    layers,
    activeLayerId,
    activeLayerEditTarget: 'layer',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeSampleBitmap(): LayerBitmap {
  return {} as LayerBitmap;
}

class NativeLikeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(data: Uint8ClampedArray, width: number, height?: number) {
    this.data = data;
    this.width = width;
    this.height = height ?? Math.max(1, Math.floor(data.length / Math.max(1, width * 4)));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageRetouch', () => {
  it('scales tone stroke spacing when airbrush is enabled', () => {
    expect(resolveRetouchStrokeDensityStep({ size: 10, airbrush: false, rate: 0.5 })).toBe(3);
    expect(resolveRetouchStrokeDensityStep({ size: 10, airbrush: true, rate: 0.5 })).toBe(2);
    expect(resolveRetouchStrokeDensityStep({ size: 10, airbrush: true, rate: 1 })).toBe(1);
  });

  it('bounds stroke rate to [0, 1] before applying airbrush spacing', () => {
    expect(resolveRetouchStrokeDensityStep({ size: 10, airbrush: true, rate: -1 })).toBe(3);
    expect(resolveRetouchStrokeDensityStep({ size: 10, airbrush: true, rate: 2 })).toBe(1);
  });

  it('resolves clone stamp source from the original sample offset', () => {
    expect(resolveCloneStampSourcePoint({
      samplePoint: { x: 10, y: 12 },
      strokeStart: { x: 30, y: 40 },
      targetPoint: { x: 35, y: 44 },
    })).toEqual({ x: 15, y: 16 });
  });

  it('returns platform ImageData from retouch kernels when the browser provides ImageData', () => {
    vi.stubGlobal('ImageData', NativeLikeImageData);
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 0, 255, 255]);
    setPixel(imageData, 2, 0, [255, 0, 0, 255]);

    const blurred = applyBlurBrushToImageData(imageData, {
      targetPoint: { x: 1, y: 0 },
      size: 3,
      strength: 1,
    });

    expect(blurred).toBeInstanceOf(NativeLikeImageData);
  });

  it('copies sampled pixels into a circular target brush region', () => {
    const imageData = makeImageData(5, 3);
    setPixel(imageData, 0, 1, [255, 0, 0, 255]);
    setPixel(imageData, 1, 1, [0, 255, 0, 255]);
    setPixel(imageData, 2, 1, [0, 0, 255, 255]);

    const cloned = applyCloneStampToImageData(imageData, {
      sourcePoint: { x: 0, y: 1 },
      targetPoint: { x: 3, y: 1 },
      size: 3,
      opacity: 1,
    });

    expect(getPixel(cloned, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(cloned, 4, 1)).toEqual([0, 255, 0, 255]);
    expect(getPixel(cloned, 2, 1)).toEqual([0, 0, 255, 255]);
  });

  it('can clone from a separate source image data buffer', () => {
    const target = makeImageData(3, 1);
    const source = makeImageData(5, 1);
    setPixel(target, 1, 0, [10, 20, 30, 255]);
    setPixel(source, 4, 0, [240, 120, 60, 255]);

    const cloned = applyCloneStampToImageData(target, {
      sourceImageData: source,
      sourcePoint: { x: 4, y: 0 },
      targetPoint: { x: 1, y: 0 },
      size: 1,
      opacity: 1,
    });

    expect(getPixel(cloned, 1, 0)).toEqual([240, 120, 60, 255]);
  });

  it('blends clone stamp pixels by opacity', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [200, 100, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 100, 255]);

    const cloned = applyCloneStampToImageData(imageData, {
      sourcePoint: { x: 0, y: 0 },
      targetPoint: { x: 2, y: 0 },
      size: 1,
      opacity: 0.5,
    });

    expect(getPixel(cloned, 2, 0)).toEqual([100, 50, 50, 255]);
  });

  it('spot heals a blemish from nearby surrounding pixels', () => {
    const imageData = makeImageData(5, 5);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        setPixel(imageData, x, y, [80, 120, 160, 255]);
      }
    }
    setPixel(imageData, 2, 2, [255, 0, 0, 255]);

    const healed = applySpotHealToImageData(imageData, {
      targetPoint: { x: 2, y: 2 },
      size: 3,
      opacity: 1,
    });

    expect(getPixel(healed, 2, 2)).toEqual([80, 120, 160, 255]);
  });

  it('can spot heal from a separate source point and source image data buffer', () => {
    const target = makeImageData(5, 5);
    const source = makeImageData(5, 5);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        setPixel(target, x, y, [200, 0, 0, 255]);
        setPixel(source, x, y, [40, 140, 220, 255]);
      }
    }
    setPixel(source, 1, 1, [255, 255, 255, 255]);

    const healed = applySpotHealToImageData(target, {
      sourceImageData: source,
      sourcePoint: { x: 1, y: 1 },
      targetPoint: { x: 3, y: 3 },
      size: 1,
      opacity: 1,
    });

    expect(getPixel(healed, 3, 3)).toEqual([40, 140, 220, 255]);
  });

  it('spot heal respects opacity when blending the repair color', () => {
    const imageData = makeImageData(3, 3);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        setPixel(imageData, x, y, [20, 100, 180, 255]);
      }
    }
    setPixel(imageData, 1, 1, [220, 0, 0, 255]);

    const healed = applySpotHealToImageData(imageData, {
      targetPoint: { x: 1, y: 1 },
      size: 1,
      opacity: 0.5,
    });

    expect(getPixel(healed, 1, 1)).toEqual([120, 50, 90, 255]);
  });

  it('builds a clone-source overlay descriptor for current-layer sampling in layer space', () => {
    const layer = makeLayer({ x: 12, y: 18 });

    expect(buildCloneStampOverlayDescriptor({
      layer,
      sampleSource: {
        bitmap: makeSampleBitmap(),
        coordinateSpace: 'layer',
      },
      sourceDocumentPoint: { x: 20, y: 25 },
      targetDocumentPoint: { x: 33, y: 41 },
      size: 9,
    })).toEqual({
      brushRadius: 4,
      coordinateSpace: 'layer',
      diameter: 9,
      sourceBitmapCenter: { x: 8, y: 7 },
      sourceDocumentCenter: { x: 20, y: 25 },
      targetBitmapCenter: { x: 21, y: 23 },
      targetDocumentCenter: { x: 33, y: 41 },
      translation: { x: 13, y: 16 },
    });
  });

  it('builds a clone-source overlay descriptor for composite sampling in document space', () => {
    const layer = makeLayer({ x: 12, y: 18 });
    const doc = makeDoc([makeLayer({ id: 'lower' }), layer], layer.id);

    expect(buildCloneStampOverlayDescriptor({
      layer,
      sampleSource: {
        bitmap: makeSampleBitmap(),
        coordinateSpace: 'document',
      },
      sourceDocumentPoint: { x: 20, y: 25 },
      targetDocumentPoint: { x: 33, y: 41 },
      size: 9,
      doc,
    })).toEqual({
      brushRadius: 4,
      coordinateSpace: 'document',
      diameter: 9,
      sourceBitmapCenter: { x: 20, y: 25 },
      sourceDocumentCenter: { x: 20, y: 25 },
      targetBitmapCenter: { x: 21, y: 23 },
      targetDocumentCenter: { x: 33, y: 41 },
      translation: { x: 13, y: 16 },
    });
  });

  it('builds a spot-heal patch plan with default source center and sampling radius', () => {
    const layer = makeLayer({ x: 12, y: 18 });

    expect(buildSpotHealPatchPlan({
      layer,
      sampleSource: {
        bitmap: makeSampleBitmap(),
        coordinateSpace: 'layer',
      },
      targetDocumentPoint: { x: 33, y: 41 },
      size: 5,
    })).toEqual({
      brushRadius: 2,
      coordinateSpace: 'layer',
      sampleRadius: 5,
      sourceBitmapCenter: { x: 21, y: 23 },
      sourceDocumentCenter: { x: 33, y: 41 },
      targetBitmapCenter: { x: 21, y: 23 },
      targetDocumentCenter: { x: 33, y: 41 },
    });
  });

  it('describes clone stamp workflow parity gaps with deterministic preview metadata', () => {
    expect(describeCloneStampToolWorkflow({
      sampleMode: 'currentAndBelow',
      aligned: false,
      hasSamplePoint: false,
      size: 12.2,
      opacity: 0.75,
      output: 'newLayer',
    })).toEqual({
      descriptorId: 'image-clone-stamp-workflow:v1',
      tool: 'cloneStamp',
      preview: {
        id: 'clone-stamp:currentAndBelow:restart:no-sample:12:0.75:newLayer',
        signature: 'image-clone-stamp-workflow:v1:{"sampleMode":"currentAndBelow","aligned":false,"sampleReady":false,"size":12,"opacity":0.75,"output":"newLayer","warnings":["sample-source-required","live-clone-source-overlay-unsupported","clone-source-transform-unsupported","new-layer-output-unsupported","destructive-active-layer-pixels"]}',
      },
      brush: {
        size: 12,
        radius: 5.5,
        opacity: 0.75,
      },
      sampleSource: {
        requested: 'currentAndBelow',
        readiness: 'needs-sample-point',
        coordinateSpaceWhenReady: 'document',
        sourceBitmapWhenReady: 'visible-current-and-below-composite-at-stroke-start',
      },
      behavior: {
        aligned: false,
        strokeSourceBehavior: 'restart-from-sample-point-each-stroke',
      },
      liveCloneSourceOverlay: {
        status: 'unsupported',
        fallback: 'target-brush-cursor-only',
        warning: 'Live source crosshair/ghost overlay is not rendered while cloning.',
      },
      cloneSourceTransform: {
        status: 'unsupported',
        supportedTransforms: [],
        warning: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
      },
      outputTarget: {
        requested: 'newLayer',
        applied: 'activeLayer',
        supportsNewLayer: false,
        caveat: 'Clone Stamp strokes mutate the active pixel layer; empty retouch output layers are not generated.',
      },
      nonDestructive: {
        supported: false,
        undoable: true,
        warning: 'Clone Stamp edits are destructive pixel mutations with undo snapshots, not editable non-destructive retouch layers.',
      },
      warnings: [
        {
          code: 'sample-source-required',
          message: 'Clone Stamp requires an Alt/Option sample point before painting.',
        },
        {
          code: 'live-clone-source-overlay-unsupported',
          message: 'Live source crosshair/ghost overlay is not rendered while cloning.',
        },
        {
          code: 'clone-source-transform-unsupported',
          message: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
        },
        {
          code: 'new-layer-output-unsupported',
          message: 'Clone Stamp strokes mutate the active pixel layer; empty retouch output layers are not generated.',
        },
        {
          code: 'destructive-active-layer-pixels',
          message: 'Clone Stamp edits are destructive pixel mutations with undo snapshots, not editable non-destructive retouch layers.',
        },
      ],
    });
  });

  it('describes spot heal patch/remove limitations and active-layer output caveats', () => {
    expect(describeSpotHealToolWorkflow({
      sampleMode: 'allLayers',
      size: 9,
      opacity: 1.4,
      output: 'activeLayer',
    })).toEqual({
      descriptorId: 'image-spot-heal-workflow:v1',
      tool: 'spotHeal',
      preview: {
        id: 'spot-heal:allLayers:9:1:activeLayer',
        signature: 'image-spot-heal-workflow:v1:{"sampleMode":"allLayers","size":9,"opacity":1,"output":"activeLayer","warnings":["patch-workflow-unsupported","content-aware-remove-unsupported","destructive-active-layer-pixels"]}',
      },
      brush: {
        size: 9,
        radius: 4,
        opacity: 1,
      },
      sampleSource: {
        requested: 'allLayers',
        readiness: 'ready-on-stroke',
        coordinateSpaceWhenReady: 'document',
        sourceBitmapWhenReady: 'visible-all-layers-composite-at-stroke-start',
      },
      patchWorkflow: {
        status: 'unsupported',
        supportedSteps: ['paint-local-repair'],
        unsupportedSteps: ['lasso-patch-source-drag', 'patch-transform', 'destination-mode', 'transparent-mode'],
        warning: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
      },
      removeWorkflow: {
        status: 'unsupported',
        warning: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
      },
      outputTarget: {
        requested: 'activeLayer',
        applied: 'activeLayer',
        supportsNewLayer: false,
        caveat: 'Spot Heal writes repaired pixels into the active layer; sample-all-layers does not create a separate retouch layer.',
      },
      nonDestructive: {
        supported: false,
        undoable: true,
        warning: 'Spot Heal repairs are destructive pixel mutations with undo snapshots, not editable non-destructive patch layers.',
      },
      warnings: [
        {
          code: 'patch-workflow-unsupported',
          message: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
        },
        {
          code: 'content-aware-remove-unsupported',
          message: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
        },
        {
          code: 'destructive-active-layer-pixels',
          message: 'Spot Heal repairs are destructive pixel mutations with undo snapshots, not editable non-destructive patch layers.',
        },
      ],
    });
  });

  it('summarizes clone, heal, and smudge retouch readiness blockers deterministically', () => {
    expect(describeRetouchWorkflowReadiness({
      cloneSampleMode: 'currentAndBelow',
      cloneAligned: true,
      cloneHasSamplePoint: true,
      healSampleMode: 'allLayers',
      smudgeSampleMode: 'allLayers',
      output: 'newLayer',
    })).toEqual({
      descriptorId: 'image-retouch-workflow-readiness:v1',
      readiness: 'blocked',
      sampleModes: [
        {
          mode: 'currentLayer',
          coordinateSpace: 'layer',
          cloneSource: 'active-layer-snapshot-at-stroke-start',
          healSource: 'active-layer-snapshot-at-stroke-start',
        },
        {
          mode: 'currentAndBelow',
          coordinateSpace: 'document',
          cloneSource: 'visible-current-and-below-composite-at-stroke-start',
          healSource: 'visible-current-and-below-composite-at-stroke-start',
        },
        {
          mode: 'allLayers',
          coordinateSpace: 'document',
          cloneSource: 'visible-all-layers-composite-at-stroke-start',
          healSource: 'visible-all-layers-composite-at-stroke-start',
        },
      ],
      clone: {
        sampleMode: 'currentAndBelow',
        readiness: 'ready',
        aligned: true,
        strokeSourceBehavior: 'maintain-first-stroke-offset-across-strokes',
        overlayStatus: 'unsupported',
        transformStatus: 'unsupported',
        previewSignature: 'image-clone-stamp-workflow:v1:{"sampleMode":"currentAndBelow","aligned":true,"sampleReady":true,"size":16,"opacity":1,"output":"newLayer","warnings":["live-clone-source-overlay-unsupported","clone-source-transform-unsupported","new-layer-output-unsupported","destructive-active-layer-pixels"]}',
      },
      heal: {
        sampleMode: 'allLayers',
        readiness: 'ready-on-stroke',
        patchWorkflowStatus: 'unsupported',
        removeWorkflowStatus: 'unsupported',
        previewSignature: 'image-spot-heal-workflow:v1:{"sampleMode":"allLayers","size":16,"opacity":1,"output":"newLayer","warnings":["patch-workflow-unsupported","content-aware-remove-unsupported","new-layer-output-unsupported","destructive-active-layer-pixels"]}',
      },
      output: {
        requested: 'newLayer',
        applied: 'activeLayer',
        nonDestructiveSupported: false,
      },
      smudge: {
        requestedSampleMode: 'allLayers',
        appliedSampleMode: 'allLayers',
        compositeSamplingSupported: true,
        caveat: 'Smudge supports bounded current-and-below and all-layers sampling by resampling the visible composite between drag dabs.',
        previewSignature: 'image-retouch-brush-plan:v1:{"tool":"smudge","operation":"drag-current-layer-pixels","size":16,"strength":0.5,"softness":0.5,"sampleMode":"allLayers","appliedSampleMode":"allLayers","blendMode":"normal","channel":"rgb","output":"newLayer","warnings":["new-layer-output-unsupported"]}',
      },
      blockers: [
        {
          code: 'clone-source-overlay-unsupported',
          message: 'Live source crosshair/ghost overlay is not rendered while cloning.',
        },
        {
          code: 'clone-source-transform-unsupported',
          message: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
        },
        {
          code: 'patch-workflow-unsupported',
          message: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
        },
        {
          code: 'content-aware-remove-unsupported',
          message: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
        },
        {
          code: 'non-destructive-retouch-output-unsupported',
          message: 'Retouch workflows write undoable destructive pixels to the active layer; editable non-destructive retouch output layers are not supported.',
        },
      ],
      previewSignature: 'image-retouch-workflow-readiness:v1:{"clone":"image-clone-stamp-workflow:v1:{\\"sampleMode\\":\\"currentAndBelow\\",\\"aligned\\":true,\\"sampleReady\\":true,\\"size\\":16,\\"opacity\\":1,\\"output\\":\\"newLayer\\",\\"warnings\\":[\\"live-clone-source-overlay-unsupported\\",\\"clone-source-transform-unsupported\\",\\"new-layer-output-unsupported\\",\\"destructive-active-layer-pixels\\"]}","heal":"image-spot-heal-workflow:v1:{\\"sampleMode\\":\\"allLayers\\",\\"size\\":16,\\"opacity\\":1,\\"output\\":\\"newLayer\\",\\"warnings\\":[\\"patch-workflow-unsupported\\",\\"content-aware-remove-unsupported\\",\\"new-layer-output-unsupported\\",\\"destructive-active-layer-pixels\\"]}","smudge":"image-retouch-brush-plan:v1:{\\"tool\\":\\"smudge\\",\\"operation\\":\\"drag-current-layer-pixels\\",\\"size\\":16,\\"strength\\":0.5,\\"softness\\":0.5,\\"sampleMode\\":\\"allLayers\\",\\"appliedSampleMode\\":\\"allLayers\\",\\"blendMode\\":\\"normal\\",\\"channel\\":\\"rgb\\",\\"output\\":\\"newLayer\\",\\"warnings\\":[\\"new-layer-output-unsupported\\"]}","blockers":["clone-source-overlay-unsupported","clone-source-transform-unsupported","patch-workflow-unsupported","content-aware-remove-unsupported","non-destructive-retouch-output-unsupported"]}',
    });
  });

  it('describes retouch content-aware repair parity without native AI or new-layer claims', () => {
    expect(describeRetouchContentAwareRepairParity({
      requestedTool: 'patch',
      sampleMode: 'allLayers',
      output: 'newLayer',
    })).toEqual({
      descriptorId: 'image-retouch-content-aware-repair-parity:v1',
      requestedTool: 'patch',
      sampleMode: 'allLayers',
      localRepairRoute: {
        available: true,
        engine: 'local-deterministic-pixel-repair',
        handoff: 'use ImageContentAware local patch plan for selection/remove/patch quick actions',
      },
      patchSource: {
        requested: 'manual-source-drag',
        supported: false,
        fallback: 'automatic-nearby-active-layer-pixels',
        blocker: 'manual-patch-source-unsupported',
        caveat: 'Retouch Patch parity records manual source intent, but local repair still uses automatic content-aware sampling.',
      },
      removeRoute: {
        nativeObjectRemovalSupported: false,
        localAlphaRemoveAvailable: true,
        blocker: 'content-aware-remove-native-ai-unsupported',
        caveat: 'Remove-style local repair can clear selected pixels, but Photoshop semantic object removal is not wired.',
      },
      output: {
        requested: 'newLayer',
        applied: 'activeLayer',
        supportsNewLayer: false,
        blockers: ['new-layer-output-unsupported'],
        sourceBinSafety: 'commit-flattened-active-layer-result-before-handoff',
      },
      aiBoundary: {
        nativePhotoshopAiSupported: false,
        cloudExecutionWired: false,
        warning: 'This retouch descriptor routes to local pixel repair metadata only; it does not dispatch Photoshop AI, Firefly, or provider cloud generation.',
      },
      blockers: [
        {
          code: 'manual-patch-source-unsupported',
          message: 'Manual Patch source dragging is not implemented for retouch repair planning.',
        },
        {
          code: 'content-aware-remove-native-ai-unsupported',
          message: 'Photoshop semantic Remove Tool execution is not implemented; local remove only clears selected alpha.',
        },
        {
          code: 'new-layer-output-unsupported',
          message: 'Retouch content-aware repair commits undoable pixels to the active layer instead of creating a new retouch layer.',
        },
      ],
      previewSignature: 'image-retouch-content-aware-repair-parity:v1:{"requestedTool":"patch","sampleMode":"allLayers","output":"newLayer","blockers":["manual-patch-source-unsupported","content-aware-remove-native-ai-unsupported","new-layer-output-unsupported"]}',
    });
  });

  it('reports smudge composite sampling as bounded support instead of a blocker', () => {
    const readiness = describeRetouchWorkflowReadiness({
      cloneHasSamplePoint: true,
      smudgeSampleMode: 'allLayers',
      output: 'activeLayer',
    });
    const checks = describeRetouchParityChecks({
      cloneHasSamplePoint: true,
      smudgeSampleMode: 'allLayers',
      output: 'activeLayer',
    });

    expect(readiness.smudge).toMatchObject({
      requestedSampleMode: 'allLayers',
      appliedSampleMode: 'allLayers',
      compositeSamplingSupported: true,
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).not.toContain('smudge-composite-sampling-unsupported');
    expect(checks.sampleRouting.map((route) => route.smudge.status)).toEqual([
      'supported',
      'supported',
      'supported',
    ]);
    expect(checks.smudgeCompositeSampling).toMatchObject({
      requested: 'allLayers',
      applied: 'allLayers',
      compositeSamplingSupported: true,
      blocker: null,
    });
    expect(checks.stableSignatures.smudgeCompositeSampling).toContain('"compositeSamplingSupported":true');
  });

  it('builds explicit retouch parity checks for routing, unsupported states, output planning, and stable signatures', () => {
    const checks = describeRetouchParityChecks({
      cloneSampleMode: 'currentAndBelow',
      cloneAligned: false,
      cloneHasSamplePoint: false,
      healSampleMode: 'allLayers',
      smudgeSampleMode: 'allLayers',
      output: 'newLayer',
    });

    expect(checks.descriptorId).toBe('image-retouch-parity-checks:v1');
    expect(checks.readiness).toBe('blocked');
    expect(checks.sampleRouting).toEqual([
      {
        mode: 'currentLayer',
        coordinateSpace: 'layer',
        cloneStamp: {
          status: 'supported',
          source: 'active-layer-snapshot-at-stroke-start',
          requiresSamplePoint: true,
          signature: 'retouch-sample-routing:v1:{"mode":"currentLayer","tool":"cloneStamp","source":"active-layer-snapshot-at-stroke-start","coordinateSpace":"layer","requiresSamplePoint":true}',
        },
        spotHeal: {
          status: 'supported',
          source: 'active-layer-snapshot-at-stroke-start',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"currentLayer","tool":"spotHeal","source":"active-layer-snapshot-at-stroke-start","coordinateSpace":"layer","requiresSamplePoint":false}',
        },
        blurSharpenBrush: {
          status: 'supported',
          tools: ['blur', 'sharpen'],
          source: 'current-layer-stroke-snapshot',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"currentLayer","tool":"blurSharpenBrush","source":"current-layer-stroke-snapshot","coordinateSpace":"layer","requiresSamplePoint":false}',
        },
        smudge: {
          status: 'supported',
          requested: 'currentLayer',
          applied: 'currentLayer',
          source: 'previous-stroke-point-current-layer',
          blocker: null,
          signature: 'retouch-smudge-sample-routing:v1:{"mode":"currentLayer","applied":"currentLayer","status":"supported","source":"previous-stroke-point-current-layer","blocker":null}',
        },
      },
      {
        mode: 'currentAndBelow',
        coordinateSpace: 'document',
        cloneStamp: {
          status: 'supported',
          source: 'visible-current-and-below-composite-at-stroke-start',
          requiresSamplePoint: true,
          signature: 'retouch-sample-routing:v1:{"mode":"currentAndBelow","tool":"cloneStamp","source":"visible-current-and-below-composite-at-stroke-start","coordinateSpace":"document","requiresSamplePoint":true}',
        },
        spotHeal: {
          status: 'supported',
          source: 'visible-current-and-below-composite-at-stroke-start',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"currentAndBelow","tool":"spotHeal","source":"visible-current-and-below-composite-at-stroke-start","coordinateSpace":"document","requiresSamplePoint":false}',
        },
        blurSharpenBrush: {
          status: 'supported',
          tools: ['blur', 'sharpen'],
          source: 'visible-current-and-below-stroke-snapshot',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"currentAndBelow","tool":"blurSharpenBrush","source":"visible-current-and-below-stroke-snapshot","coordinateSpace":"document","requiresSamplePoint":false}',
        },
        smudge: {
          status: 'supported',
          requested: 'currentAndBelow',
          applied: 'currentAndBelow',
          source: 'previous-stroke-point-live-composite',
          blocker: null,
          signature: 'retouch-smudge-sample-routing:v1:{"mode":"currentAndBelow","applied":"currentAndBelow","status":"supported","source":"previous-stroke-point-live-composite","blocker":null}',
        },
      },
      {
        mode: 'allLayers',
        coordinateSpace: 'document',
        cloneStamp: {
          status: 'supported',
          source: 'visible-all-layers-composite-at-stroke-start',
          requiresSamplePoint: true,
          signature: 'retouch-sample-routing:v1:{"mode":"allLayers","tool":"cloneStamp","source":"visible-all-layers-composite-at-stroke-start","coordinateSpace":"document","requiresSamplePoint":true}',
        },
        spotHeal: {
          status: 'supported',
          source: 'visible-all-layers-composite-at-stroke-start',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"allLayers","tool":"spotHeal","source":"visible-all-layers-composite-at-stroke-start","coordinateSpace":"document","requiresSamplePoint":false}',
        },
        blurSharpenBrush: {
          status: 'supported',
          tools: ['blur', 'sharpen'],
          source: 'visible-all-layers-stroke-snapshot',
          requiresSamplePoint: false,
          signature: 'retouch-sample-routing:v1:{"mode":"allLayers","tool":"blurSharpenBrush","source":"visible-all-layers-stroke-snapshot","coordinateSpace":"document","requiresSamplePoint":false}',
        },
        smudge: {
          status: 'supported',
          requested: 'allLayers',
          applied: 'allLayers',
          source: 'previous-stroke-point-live-composite',
          blocker: null,
          signature: 'retouch-smudge-sample-routing:v1:{"mode":"allLayers","applied":"allLayers","status":"supported","source":"previous-stroke-point-live-composite","blocker":null}',
        },
      },
    ]);
    expect(checks.cloneSource).toEqual({
      overlay: {
        checkId: 'clone-source-overlay',
        status: 'unsupported',
        fallback: 'target-brush-cursor-only',
        blocker: 'clone-source-overlay-unsupported',
        caveat: 'Live source crosshair/ghost overlay is not rendered while cloning.',
        signature: 'retouch-clone-source-check:v1:{"checkId":"clone-source-overlay","status":"unsupported","fallback":"target-brush-cursor-only","blocker":"clone-source-overlay-unsupported"}',
      },
      transform: {
        checkId: 'clone-source-transform',
        status: 'unsupported',
        requestedTransforms: ['scale', 'rotation', 'flip', 'offset'],
        supportedTransforms: [],
        blocker: 'clone-source-transform-unsupported',
        caveat: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
        signature: 'retouch-clone-source-check:v1:{"checkId":"clone-source-transform","status":"unsupported","requestedTransforms":["scale","rotation","flip","offset"],"supportedTransforms":[],"blocker":"clone-source-transform-unsupported"}',
      },
    });
    expect(checks.repairOutput).toEqual({
      patch: {
        checkId: 'patch-source-workflow',
        status: 'unsupported',
        supportedRoute: 'paint-local-repair',
        unsupportedSteps: ['lasso-patch-source-drag', 'patch-transform', 'destination-mode', 'transparent-mode'],
        blocker: 'patch-workflow-unsupported',
        caveat: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"patch-source-workflow","status":"unsupported","blocker":"patch-workflow-unsupported","unsupportedSteps":["lasso-patch-source-drag","patch-transform","destination-mode","transparent-mode"]}',
      },
      remove: {
        checkId: 'remove-tool-workflow',
        status: 'unsupported',
        localFallback: 'local-alpha-remove-from-content-aware-plan',
        blocker: 'content-aware-remove-unsupported',
        caveat: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"remove-tool-workflow","status":"unsupported","blocker":"content-aware-remove-unsupported","localFallback":"local-alpha-remove-from-content-aware-plan"}',
      },
      newLayerOutput: {
        checkId: 'retouch-new-layer-output',
        requested: true,
        status: 'unsupported',
        applied: 'activeLayer',
        blocker: 'new-layer-output-unsupported',
        caveat: 'Retouch tools commit undoable pixels to the active layer; new clone/heal/repair output layers are not generated.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"retouch-new-layer-output","requested":true,"status":"unsupported","applied":"activeLayer","blocker":"new-layer-output-unsupported"}',
      },
    });
    expect(checks.nonDestructiveOutput).toEqual({
      checkId: 'non-destructive-retouch-output-plan',
      requested: 'newLayer',
      supported: false,
      applied: 'activeLayer',
      plan: 'undo-snapshot-active-layer-mutation',
      editableRetouchLayer: false,
      requiredForParity: ['clone-stamp-empty-retouch-layer', 'heal-sample-all-layers-on-new-layer', 'editable-retouch-replay'],
      sourceBinResult: 'flattened-active-layer-retouch',
      blocker: 'non-destructive-retouch-output-unsupported',
      caveats: [
        'Undo snapshots preserve rollback, but retouch strokes are not editable after commit.',
        'Sample-all/current-and-below sources are local document snapshots and are not replayable from Source Bin assets.',
        'A parity-complete plan needs editable retouch output layers before downstream handoff can preserve clone/heal state.',
      ],
      signature: 'retouch-non-destructive-output-plan:v1:{"requested":"newLayer","supported":false,"applied":"activeLayer","plan":"undo-snapshot-active-layer-mutation","editableRetouchLayer":false,"sourceBinResult":"flattened-active-layer-retouch","blocker":"non-destructive-retouch-output-unsupported"}',
    });
    expect(checks.smudgeCompositeSampling).toEqual({
      checkId: 'smudge-composite-sampling',
      requested: 'allLayers',
      applied: 'allLayers',
      compositeSamplingSupported: true,
      blockedModes: [],
      blocker: null,
      caveat: 'Smudge composite sampling uses bounded live composite resampling between drag dabs.',
      signature: 'retouch-smudge-composite-sampling:v1:{"requested":"allLayers","applied":"allLayers","compositeSamplingSupported":true,"blockedModes":[],"blocker":null}',
    });
    expect(checks.stableSignatures).toEqual({
      sampleRouting: 'retouch-sample-routing-matrix:v1:{"modes":["currentLayer","currentAndBelow","allLayers"],"cloneStamp":["active-layer-snapshot-at-stroke-start","visible-current-and-below-composite-at-stroke-start","visible-all-layers-composite-at-stroke-start"],"spotHeal":["active-layer-snapshot-at-stroke-start","visible-current-and-below-composite-at-stroke-start","visible-all-layers-composite-at-stroke-start"],"blurSharpen":["current-layer-stroke-snapshot","visible-current-and-below-stroke-snapshot","visible-all-layers-stroke-snapshot"],"smudge":["supported","supported","supported"]}',
      cloneSource: 'retouch-clone-source-checks:v1:{"overlay":"retouch-clone-source-check:v1:{\\"checkId\\":\\"clone-source-overlay\\",\\"status\\":\\"unsupported\\",\\"fallback\\":\\"target-brush-cursor-only\\",\\"blocker\\":\\"clone-source-overlay-unsupported\\"}","transform":"retouch-clone-source-check:v1:{\\"checkId\\":\\"clone-source-transform\\",\\"status\\":\\"unsupported\\",\\"requestedTransforms\\":[\\"scale\\",\\"rotation\\",\\"flip\\",\\"offset\\"],\\"supportedTransforms\\":[],\\"blocker\\":\\"clone-source-transform-unsupported\\"}"}',
      repairOutput: 'retouch-repair-output-checks:v1:{"patch":"retouch-repair-output-check:v1:{\\"checkId\\":\\"patch-source-workflow\\",\\"status\\":\\"unsupported\\",\\"blocker\\":\\"patch-workflow-unsupported\\",\\"unsupportedSteps\\":[\\"lasso-patch-source-drag\\",\\"patch-transform\\",\\"destination-mode\\",\\"transparent-mode\\"]}","remove":"retouch-repair-output-check:v1:{\\"checkId\\":\\"remove-tool-workflow\\",\\"status\\":\\"unsupported\\",\\"blocker\\":\\"content-aware-remove-unsupported\\",\\"localFallback\\":\\"local-alpha-remove-from-content-aware-plan\\"}","newLayerOutput":"retouch-repair-output-check:v1:{\\"checkId\\":\\"retouch-new-layer-output\\",\\"requested\\":true,\\"status\\":\\"unsupported\\",\\"applied\\":\\"activeLayer\\",\\"blocker\\":\\"new-layer-output-unsupported\\"}"}',
      nonDestructiveOutput: 'retouch-non-destructive-output-plan:v1:{"requested":"newLayer","supported":false,"applied":"activeLayer","plan":"undo-snapshot-active-layer-mutation","editableRetouchLayer":false,"sourceBinResult":"flattened-active-layer-retouch","blocker":"non-destructive-retouch-output-unsupported"}',
      smudgeCompositeSampling: 'retouch-smudge-composite-sampling:v1:{"requested":"allLayers","applied":"allLayers","compositeSamplingSupported":true,"blockedModes":[],"blocker":null}',
      aggregate: checks.previewSignature,
    });
    expect(checks.previewSignature).toContain('\\"smudge\\":[\\"supported\\",\\"supported\\",\\"supported\\"]');
    expect(checks.previewSignature).toContain('\\"compositeSamplingSupported\\":true');
    expect(checks.previewSignature).not.toContain('smudge-composite-sampling-unsupported');
  });

  it('describes deterministic retouch brush plans with brush, sampling, and preview metadata', () => {
    expect(describeRetouchBrushToolPlan({
      tool: 'blur',
      size: 17.6,
      strength: 0.42,
      softness: 0.8,
      sampleMode: 'currentAndBelow',
      blendMode: 'luminosity',
      channel: 'red',
      output: 'newLayer',
    })).toEqual({
      descriptorId: 'image-retouch-brush-plan:v1',
      tool: 'blur',
      label: 'Blur brush',
      operation: 'soften-local-detail',
      adjustment: {
        parameter: 'strength',
        value: 0.42,
        behavior: 'Mixes the current-layer starting pixels toward a local average inside the brush footprint.',
      },
      brush: {
        size: 18,
        radius: 8.5,
        softness: 0.8,
        spacingHint: 6,
        falloff: 'soft-edge-preview-only',
      },
      sampling: {
        requested: 'currentAndBelow',
        applied: 'currentAndBelow',
        source: 'visible-current-and-below-stroke-snapshot',
      },
      limits: {
        supportsSampleAllLayers: true,
        supportsBlendMode: false,
        supportsChannelTarget: false,
        supportsOutputToNewLayer: false,
      },
      dynamics: {
        supportsPressure: false,
        supportsTilt: false,
        supportsFlow: false,
        supportsAirbrushAccumulation: false,
        spacingPx: 6,
        hardnessControl: 'softness-only',
        signature: 'retouch-brush-dynamics:v1:{"tool":"blur","size":18,"softness":0.8,"spacingPx":6,"pressure":false,"tilt":false,"flow":false,"airbrushAccumulation":false}',
      },
      presetRouting: {
        recommendedCategories: ['soft-round', 'airbrush', 'smudge-retouch'],
        recommendedPresetIds: ['softRound', 'airbrush', 'textureStipple', 'watercolorWash'],
        incompatiblePresetCategories: ['eraser'],
        signature: 'retouch-brush-preset-routing:v1:{"tool":"blur","categories":["soft-round","airbrush","smudge-retouch"],"presetIds":["softRound","airbrush","textureStipple","watercolorWash"],"incompatible":["eraser"]}',
      },
      warnings: [
        {
          code: 'blend-mode-unsupported',
          message: 'Retouch brush blend modes are metadata only; strokes are applied with normal pixel replacement math.',
        },
        {
          code: 'channel-target-unsupported',
          message: 'Retouch brush channel targeting is not implemented; RGB channels are edited together.',
        },
        {
          code: 'new-layer-output-unsupported',
          message: 'Retouch brush output to a new layer is not implemented for this brush; strokes mutate the active layer.',
        },
      ],
      previewSignature: 'image-retouch-brush-plan:v1:{"tool":"blur","operation":"soften-local-detail","size":18,"strength":0.42,"softness":0.8,"sampleMode":"currentAndBelow","appliedSampleMode":"currentAndBelow","blendMode":"luminosity","channel":"red","output":"newLayer","warnings":["blend-mode-unsupported","channel-target-unsupported","new-layer-output-unsupported"]}',
    });
  });

  it('describes retouch tool readiness with route safety input caveats and batch suitability', () => {
    expect(describeRetouchToolReadiness({
      tool: 'cloneStamp',
      sampleMode: 'allLayers',
      hasSamplePoint: false,
      aligned: false,
      output: 'newLayer',
      activeLayerEditable: false,
      activeTarget: 'mask',
      requestedChannel: 'alpha',
    })).toMatchObject({
      descriptorId: 'image-retouch-tool-readiness:v1',
      tool: 'cloneStamp',
      readiness: 'blocked',
      implemented: [
        'undoable-active-pixel-layer-strokes',
        'brush-size-opacity-controls',
        'current-layer-sampling',
        'current-and-below-composite-sampling',
        'all-layers-composite-sampling',
        'aligned-or-restart-source-offset',
      ],
      unsupported: [
        'editable-non-destructive-retouch-layer',
        'layer-mask-retouch-routing',
        'single-channel-retouch-routing',
        'batch-retouch-without-recorded-inputs',
        'clone-source-overlay',
        'clone-source-transform',
      ],
      routeSafety: {
        activeLayerEditable: false,
        activeTarget: 'mask',
        canPaint: false,
        blockers: [
          {
            code: 'active-layer-not-editable',
            message: 'Retouch tools require an unlocked editable image layer with a bitmap.',
          },
          {
            code: 'layer-mask-target-unsupported',
            message: 'Retouch tools do not route clone/heal/blur/sharpen strokes into layer masks.',
          },
          {
            code: 'channel-target-unsupported',
            message: 'Retouch tools apply RGB pixel edits together; alpha and spot-channel retouch routing are not implemented.',
          },
          {
            code: 'sample-source-required',
            message: 'Clone Stamp requires an Alt/Option sample point before painting.',
          },
        ],
      },
      brushInput: {
        supportsPointer: true,
        supportsPressure: false,
        supportsTilt: false,
        supportsKeyboardSamplingShortcut: true,
        controls: ['size', 'opacity', 'sampleMode', 'aligned'],
      },
      sourceSampling: {
        requested: 'allLayers',
        coordinateSpace: 'document',
        source: 'visible-all-layers-composite-at-stroke-start',
        requiresExplicitSamplePoint: true,
        alignedBehavior: 'restart-from-sample-point-each-stroke',
      },
      layerMaskChannelCaveats: [
        'Layer masks can constrain visible output, but retouch strokes are written to active layer pixels.',
        'Alpha and spot-channel retouch edits are unsupported; convert/load channel selections before painting RGB pixels.',
      ],
      batchActions: {
        suitable: false,
        requiresRecordedPointerPath: true,
        requiresRecordedSamplePoint: true,
        reason: 'Clone Stamp batch playback is unsafe without a recorded sample point and pointer path.',
      },
    });
    expect(describeRetouchToolReadiness({
      tool: 'cloneStamp',
      sampleMode: 'allLayers',
      hasSamplePoint: false,
      aligned: false,
      output: 'newLayer',
      activeLayerEditable: false,
      activeTarget: 'mask',
      requestedChannel: 'alpha',
    }).previewSignature).toBe('image-retouch-tool-readiness:v1:{"tool":"cloneStamp","sampleMode":"allLayers","activeTarget":"mask","requestedChannel":"alpha","activeLayerEditable":false,"output":"newLayer","blockers":["active-layer-not-editable","layer-mask-target-unsupported","channel-target-unsupported","sample-source-required"],"unsupported":["editable-non-destructive-retouch-layer","layer-mask-retouch-routing","single-channel-retouch-routing","batch-retouch-without-recorded-inputs","clone-source-overlay","clone-source-transform"]}');
  });

  it('describes blur and sharpen sample-all-layers support without current-layer warnings', () => {
    const blur = describeRetouchBrushToolPlan({
      tool: 'blur',
      size: 9,
      strength: 0.5,
      sampleMode: 'allLayers',
    });
    const sharpen = describeRetouchBrushToolPlan({
      tool: 'sharpen',
      size: 9,
      strength: 0.5,
      sampleMode: 'currentAndBelow',
    });

    expect(blur.sampling).toMatchObject({
      requested: 'allLayers',
      applied: 'allLayers',
      source: 'visible-all-layers-stroke-snapshot',
    });
    expect(sharpen.sampling).toMatchObject({
      requested: 'currentAndBelow',
      applied: 'currentAndBelow',
      source: 'visible-current-and-below-stroke-snapshot',
    });
    expect(blur.limits.supportsSampleAllLayers).toBe(true);
    expect(sharpen.limits.supportsSampleAllLayers).toBe(true);
    expect(blur.warnings.map((warning) => warning.code)).not.toContain('sample-mode-current-layer-only');
    expect(sharpen.warnings.map((warning) => warning.code)).not.toContain('sample-mode-current-layer-only');
    expect(blur.previewSignature).toContain('"appliedSampleMode":"allLayers"');
    expect(sharpen.previewSignature).toContain('"appliedSampleMode":"currentAndBelow"');
  });

  it('adds deterministic retouch handoff signatures plus brush dynamics and preset routing metadata', () => {
    const plan = describeRetouchBrushToolPlan({
      tool: 'blur',
      size: 21,
      strength: 0.6,
      sampleMode: 'allLayers',
      output: 'newLayer',
    });
    const readiness = describeRetouchToolReadiness({
      tool: 'cloneStamp',
      sampleMode: 'currentAndBelow',
      hasSamplePoint: true,
      aligned: true,
      output: 'newLayer',
    });

    expect(plan.dynamics).toEqual({
      supportsPressure: false,
      supportsTilt: false,
      supportsFlow: false,
      supportsAirbrushAccumulation: false,
      spacingPx: 7,
      hardnessControl: 'softness-only',
      signature: 'retouch-brush-dynamics:v1:{"tool":"blur","size":21,"softness":0.5,"spacingPx":7,"pressure":false,"tilt":false,"flow":false,"airbrushAccumulation":false}',
    });
    expect(plan.presetRouting).toEqual({
      recommendedCategories: ['soft-round', 'airbrush', 'smudge-retouch'],
      recommendedPresetIds: ['softRound', 'airbrush', 'textureStipple', 'watercolorWash'],
      incompatiblePresetCategories: ['eraser'],
      signature: 'retouch-brush-preset-routing:v1:{"tool":"blur","categories":["soft-round","airbrush","smudge-retouch"],"presetIds":["softRound","airbrush","textureStipple","watercolorWash"],"incompatible":["eraser"]}',
    });
    expect(readiness.actionReadiness).toEqual({
      label: 'Clone Stamp stroke',
      deterministic: true,
      recordable: true,
      requiresSamplePoint: true,
      signature: 'image-retouch-action-readiness:v1:{"tool":"cloneStamp","sampleMode":"currentAndBelow","aligned":true,"output":"newLayer","recordable":true,"requiresSamplePoint":true}',
    });
    expect(readiness.batchActions).toEqual({
      suitable: false,
      requiresRecordedPointerPath: true,
      requiresRecordedSamplePoint: true,
      reason: 'Clone Stamp batch playback is unsafe without a recorded sample point and pointer path.',
      signature: 'image-retouch-batch-readiness:v1:{"tool":"cloneStamp","sampleMode":"currentAndBelow","aligned":true,"requiresPointerPath":true,"requiresSamplePoint":true,"suitable":false}',
    });
    expect(readiness.sourceBinHandoff).toEqual({
      supported: false,
      target: 'source-bin',
      result: 'flattened-active-layer-retouch',
      warnings: [
        'Source Bin handoff can only package flattened retouched pixels; editable clone/heal state is not preserved.',
        'Sample-all/current-and-below retouch sources stay local to the Image document snapshot and are not replayable from Source Bin assets.',
        'Non-destructive retouch output layers are unavailable, so reopen/edit handoff depends on the mutated source layer pixels.',
      ],
      signature: 'image-retouch-source-bin-handoff:v1:{"tool":"cloneStamp","sampleMode":"currentAndBelow","output":"newLayer","supported":false,"result":"flattened-active-layer-retouch","warnings":["flattened-retouch-only","snapshot-sampling-not-replayable","non-destructive-output-unavailable"]}',
    });
  });

  it('describes tone and sponge exposure/saturation behavior with professional options', () => {
    const dodge = describeRetouchBrushToolPlan({
      tool: 'dodge',
      size: 9,
      strength: 1.4,
      softness: -1,
      toneRange: 'midtones',
      protectTones: true,
    });
    const burn = describeRetouchBrushToolPlan({
      tool: 'burn',
      size: 9,
      strength: 0.25,
      toneRange: 'shadows',
      protectTones: false,
    });
    const sponge = describeRetouchBrushToolPlan({
      tool: 'sponge',
      mode: 'desaturate',
      size: 9,
      strength: 0.5,
      spongeVibrance: 0.75,
      spongePreserveLuminosity: true,
    });
    const dodgeNewLayer = describeRetouchBrushToolPlan({
      tool: 'dodge',
      size: 9,
      strength: 0.5,
      output: 'newLayer',
      toneRange: 'highlights',
      protectTones: true,
    });
    const spongeNewLayer = describeRetouchBrushToolPlan({
      tool: 'sponge',
      mode: 'saturate',
      size: 9,
      strength: 0.5,
      output: 'newLayer',
      spongeVibrance: 0.65,
      spongePreserveLuminosity: true,
    });

    expect(dodge.adjustment).toEqual({
      parameter: 'exposure',
      value: 1,
      behavior: 'Dodge raises luminance inside the selected tonal range, with optional protected-tone scaling to limit color clipping.',
    });
    expect(dodge.tonal).toEqual({
      range: 'midtones',
      protectTones: true,
      supportsRangeTargeting: true,
    });
    expect(dodge.brush.softness).toBe(0);
    expect(dodge.warnings.map((warning) => warning.code)).not.toContain('tone-range-unsupported');
    expect(burn.adjustment).toEqual({
      parameter: 'exposure',
      value: 0.25,
      behavior: 'Burn lowers luminance inside the selected tonal range, with optional protected-tone scaling to limit color clipping.',
    });
    expect(burn.tonal).toMatchObject({
      range: 'shadows',
      protectTones: false,
    });
    expect(sponge.adjustment).toEqual({
      parameter: 'saturation',
      value: 0.5,
      behavior: 'Sponge desaturate reduces channel separation, with optional vibrance weighting and luminance preservation.',
    });
    expect(sponge.saturation).toEqual({
      vibrance: 0.75,
      preserveLuminosity: true,
      supportsVibranceWeighting: true,
    });
    expect(sponge.previewSignature).toContain('"mode":"desaturate"');
    expect(sponge.previewSignature).toContain('"spongeVibrance":0.75');
    expect(sponge.previewSignature).toContain('"spongePreserveLuminosity":true');
    expect(dodgeNewLayer.limits.supportsOutputToNewLayer).toBe(true);
    expect(dodgeNewLayer.warnings.map((warning) => warning.code)).not.toContain('new-layer-output-unsupported');
    expect(dodgeNewLayer.previewSignature).toContain('"output":"newLayer"');
    expect(dodgeNewLayer.previewSignature).toContain('"warnings":[]');
    expect(spongeNewLayer.limits.supportsOutputToNewLayer).toBe(true);
    expect(spongeNewLayer.warnings.map((warning) => warning.code)).not.toContain('new-layer-output-unsupported');
    expect(spongeNewLayer.previewSignature).toContain('"output":"newLayer"');
    expect(spongeNewLayer.previewSignature).toContain('"warnings":[]');
  });

  it('summarizes dodge burn and sponge readiness with deterministic caveats and signatures', () => {
    const readiness = describeTonalSaturationBrushReadiness({
      dodgeRange: 'highlights',
      burnRange: 'shadows',
      protectTones: true,
      exposure: 1.25,
      spongeMode: 'desaturate',
      saturation: 0.35,
      spongeVibrance: 0.8,
      spongePreserveLuminosity: true,
      size: 13.2,
      softness: 0.25,
    });

    expect(readiness.readiness).toBe('ready');
    expect(readiness.tonalRanges).toEqual([
      {
        range: 'all',
        label: 'All tones',
        luminanceGate: 'full-luminance-pass',
      },
      {
        range: 'shadows',
        label: 'Shadows',
        luminanceGate: 'weighted-below-120-luma',
      },
      {
        range: 'midtones',
        label: 'Midtones',
        luminanceGate: 'weighted-48-to-208-luma',
      },
      {
        range: 'highlights',
        label: 'Highlights',
        luminanceGate: 'weighted-above-176-luma',
      },
    ]);
    expect(readiness.dodge).toMatchObject({
      range: 'highlights',
      exposure: 1,
      protectTones: true,
      rangeTargetingSupported: true,
      exposureCaveat: 'Exposure is a clamped per-dab strength value, not Photoshop airbrush accumulation over time.',
    });
    expect(readiness.burn).toMatchObject({
      range: 'shadows',
      exposure: 1,
      protectTones: true,
      rangeTargetingSupported: true,
    });
    expect(readiness.sponge).toMatchObject({
      mode: 'desaturate',
      modes: ['saturate', 'desaturate'],
      saturation: 0.35,
      vibrance: 0.8,
      preserveLuminosity: true,
      luminancePreservation: 'Enabled: corrected RGB output is shifted back toward the source luminance after saturation math.',
    });
    expect(readiness.output).toEqual({
      requested: 'activeLayer',
      applied: 'activeLayer',
      nonDestructiveSupported: true,
      caveat: 'Dodge, Burn, and Sponge mutate undoable pixels on the active layer unless New Retouch Layer output is selected.',
    });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.dodge.previewSignature).toContain('"toneRange":"highlights"');
    expect(readiness.burn.previewSignature).toContain('"toneRange":"shadows"');
    expect(readiness.sponge.previewSignature).toContain('"mode":"desaturate"');
    expect(readiness.previewSignature).toContain('"blockers":[]');
  });

  it('supports requested airbrush rate when output is active-layer', () => {
    const readiness = describeTonalSaturationBrushReadiness({
      airbrush: true,
      rate: 2,
      spongePreserveLuminosity: true,
    });

    expect(readiness.readiness).toBe('ready');
    expect(readiness.airbrushRate).toEqual({
      requestedAirbrush: true,
      requestedRate: 1,
      status: 'supported',
      applied: 'rate-adjusted',
      caveat: 'Airbrush and rate adjust local brush stroke spacing; rate is bounded to [0, 1].',
    });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.previewSignature).toContain('"rate":1');
    expect(readiness.previewSignature).toContain('"output":"activeLayer"');
    expect(readiness.previewSignature).not.toContain('"airbrush-rate-unsupported"');
  });

  it('describes retouch sample source state with stable routing signatures', () => {
    const state = describeRetouchSampleSourceState({
      cloneSampleMode: 'currentAndBelow',
      cloneAligned: false,
      cloneHasSamplePoint: true,
      healSampleMode: 'allLayers',
      smudgeSampleMode: 'allLayers',
    });

    expect(state).toEqual({
      descriptorId: 'image-retouch-sample-source-state:v1',
      cloneStamp: {
        requested: 'currentAndBelow',
        readiness: 'ready',
        coordinateSpace: 'document',
        source: 'visible-current-and-below-composite-at-stroke-start',
        requiresExplicitSamplePoint: true,
        aligned: false,
        strokeSourceBehavior: 'restart-from-sample-point-each-stroke',
        previewId: 'clone-stamp:currentAndBelow:restart:sample-ready:16:1:activeLayer',
        signature: 'image-retouch-sample-source-state:v1:{"tool":"cloneStamp","sampleMode":"currentAndBelow","coordinateSpace":"document","source":"visible-current-and-below-composite-at-stroke-start","sampleReady":true,"aligned":false,"strokeSourceBehavior":"restart-from-sample-point-each-stroke"}',
      },
      spotHeal: {
        requested: 'allLayers',
        readiness: 'ready-on-stroke',
        coordinateSpace: 'document',
        source: 'visible-all-layers-composite-at-stroke-start',
        requiresExplicitSamplePoint: false,
        previewId: 'spot-heal:allLayers:16:1:activeLayer',
        signature: 'image-retouch-sample-source-state:v1:{"tool":"spotHeal","sampleMode":"allLayers","coordinateSpace":"document","source":"visible-all-layers-composite-at-stroke-start","readiness":"ready-on-stroke"}',
      },
      smudge: {
        requested: 'allLayers',
        applied: 'allLayers',
        coordinateSpace: 'document',
        compositeSampling: 'bounded-live-composite-resampling',
        supportedModes: ['currentLayer', 'currentAndBelow', 'allLayers'],
        caveat: 'Composite smudge sampling resamples the bounded visible composite between drag dabs.',
        signature: 'image-retouch-sample-source-state:v1:{"tool":"smudge","sampleMode":"allLayers","applied":"allLayers","coordinateSpace":"document","compositeSampling":"bounded-live-composite-resampling"}',
      },
      stableSignature: 'image-retouch-sample-source-state:v1:{"cloneStamp":"image-retouch-sample-source-state:v1:{\\"tool\\":\\"cloneStamp\\",\\"sampleMode\\":\\"currentAndBelow\\",\\"coordinateSpace\\":\\"document\\",\\"source\\":\\"visible-current-and-below-composite-at-stroke-start\\",\\"sampleReady\\":true,\\"aligned\\":false,\\"strokeSourceBehavior\\":\\"restart-from-sample-point-each-stroke\\"}","spotHeal":"image-retouch-sample-source-state:v1:{\\"tool\\":\\"spotHeal\\",\\"sampleMode\\":\\"allLayers\\",\\"coordinateSpace\\":\\"document\\",\\"source\\":\\"visible-all-layers-composite-at-stroke-start\\",\\"readiness\\":\\"ready-on-stroke\\"}","smudge":"image-retouch-sample-source-state:v1:{\\"tool\\":\\"smudge\\",\\"sampleMode\\":\\"allLayers\\",\\"applied\\":\\"allLayers\\",\\"coordinateSpace\\":\\"document\\",\\"compositeSampling\\":\\"bounded-live-composite-resampling\\"}"}',
    });
  });

  it('describes retouch output policy and route blockers without prose parsing', () => {
    expect(describeRetouchOutputPolicy({ output: 'newLayer' })).toEqual({
      descriptorId: 'image-retouch-output-policy:v1',
      requested: 'newLayer',
      applied: 'activeLayer',
      undoable: true,
      destructivePixels: true,
      nonDestructiveLayer: {
        supported: false,
        blocker: 'non-destructive-retouch-output-unsupported',
        unsupportedState: 'editable-retouch-output-layer',
      },
      sourceBinHandoff: 'flattened-active-layer-retouch',
      blockers: [
        {
          code: 'non-destructive-retouch-output-unsupported',
          message: 'Retouch workflows write undoable destructive pixels to the active layer; editable non-destructive retouch output layers are not supported.',
        },
      ],
      signature: 'image-retouch-output-policy:v1:{"requested":"newLayer","applied":"activeLayer","undoable":true,"destructivePixels":true,"nonDestructiveSupported":false,"sourceBinHandoff":"flattened-active-layer-retouch","blockers":["non-destructive-retouch-output-unsupported"]}',
    });

    expect(describeRetouchBrushRouteSupport({
      tool: 'cloneStamp',
      sampleMode: 'allLayers',
      hasSamplePoint: false,
      activeTarget: 'mask',
      requestedChannel: 'alpha',
      activeLayerEditable: false,
    })).toEqual({
      descriptorId: 'image-retouch-brush-route-support:v1',
      tool: 'cloneStamp',
      readiness: 'blocked',
      route: {
        activeLayerEditable: false,
        activeTarget: 'mask',
        requestedChannel: 'alpha',
        sampleMode: 'allLayers',
        canPaint: false,
      },
      supported: [
        'pointer-brush-strokes',
        'undoable-active-layer-pixel-output',
        'current-layer-sampling',
        'current-and-below-composite-sampling',
        'all-layers-composite-sampling',
        'aligned-or-restart-source-offset',
      ],
      unsupported: [
        'editable-non-destructive-retouch-layer',
        'layer-mask-retouch-routing',
        'single-channel-retouch-routing',
        'clone-source-overlay',
        'clone-source-transform',
        'perspective-clone',
        'advanced-healing-ai',
        'patch-remove-dedicated-ui',
      ],
      blockers: [
        'active-layer-not-editable',
        'layer-mask-target-unsupported',
        'channel-target-unsupported',
        'sample-source-required',
      ],
      signature: 'image-retouch-brush-route-support:v1:{"tool":"cloneStamp","sampleMode":"allLayers","activeTarget":"mask","requestedChannel":"alpha","activeLayerEditable":false,"canPaint":false,"blockers":["active-layer-not-editable","layer-mask-target-unsupported","channel-target-unsupported","sample-source-required"],"unsupported":["editable-non-destructive-retouch-layer","layer-mask-retouch-routing","single-channel-retouch-routing","clone-source-overlay","clone-source-transform","perspective-clone","advanced-healing-ai","patch-remove-dedicated-ui"]}',
    });
  });

  it('publishes local output readiness with preview IDs and explicit unsupported states', () => {
    const readiness = describeRetouchLocalOutputReadiness({
      cloneSampleMode: 'currentAndBelow',
      cloneAligned: true,
      cloneHasSamplePoint: false,
      healSampleMode: 'allLayers',
      smudgeSampleMode: 'allLayers',
      output: 'newLayer',
    });

    expect(readiness.descriptorId).toBe('image-retouch-local-output-readiness:v1');
    expect(readiness.readiness).toBe('blocked');
    expect(readiness.previewIds).toEqual(describeRetouchPreviewIds({
      cloneSampleMode: 'currentAndBelow',
      cloneAligned: true,
      cloneHasSamplePoint: false,
      healSampleMode: 'allLayers',
      smudgeSampleMode: 'allLayers',
      output: 'newLayer',
    }));
    expect(readiness.outputPolicy.blockers.map((blocker) => blocker.code)).toEqual([
      'non-destructive-retouch-output-unsupported',
    ]);
    expect(readiness.sampleSource.smudge.compositeSampling).toBe('bounded-live-composite-resampling');
    expect(readiness.unsupportedStates).toEqual([
      'editable-non-destructive-retouch-layer',
      'clone-source-overlay',
      'clone-source-transform',
      'perspective-clone',
      'advanced-healing-ai',
      'patch-remove-dedicated-ui',
    ]);
    expect(readiness.routeSupport.map((route) => route.signature)).toHaveLength(5);
    expect(readiness.stableSignatures).toMatchObject({
      sampleSource: readiness.sampleSource.stableSignature,
      outputPolicy: readiness.outputPolicy.signature,
      previewIds: readiness.previewIds.signature,
    });
    expect(readiness.previewSignature).toContain('image-retouch-local-output-readiness:v1');
  });

  it('supports non-destructive output while still reporting implemented airbrush/rate behavior', () => {
    const readiness = describeTonalSaturationBrushReadiness({
      output: 'newLayer',
      airbrush: true,
      rate: 2,
      spongePreserveLuminosity: false,
    });

    expect(readiness.readiness).toBe('ready');
    expect(readiness.airbrushRate).toEqual({
      requestedAirbrush: true,
      requestedRate: 1,
      status: 'supported',
      applied: 'rate-adjusted',
      caveat: 'Airbrush and rate adjust local brush stroke spacing; rate is bounded to [0, 1].',
    });
    expect(readiness.sponge.luminancePreservation).toBe('Disabled: saturation math may shift perceived luminance.');
    expect(readiness.output).toEqual({
      requested: 'newLayer',
      applied: 'newLayer',
      nonDestructiveSupported: true,
      caveat: 'Dodge, Burn, and Sponge can write an undoable generated retouch layer while preserving the source layer pixels.',
    });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.previewSignature).toContain('"rate":1');
    expect(readiness.previewSignature).toContain('"output":"newLayer"');
    expect(readiness.previewSignature).toContain('"blockers":[]');
    expect(readiness.previewSignature).not.toContain('"non-destructive-retouch-output-unsupported"');
  });

  it('publishes stable capability descriptors from the concrete retouch brush tool modules', () => {
    expect([
      blurBrushCapabilityDescriptor.tool,
      sharpenBrushCapabilityDescriptor.tool,
      smudgeBrushCapabilityDescriptor.tool,
      toneBrushCapabilityDescriptors.dodge.tool,
      toneBrushCapabilityDescriptors.burn.tool,
      spongeBrushCapabilityDescriptor.tool,
    ]).toEqual(['blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge']);

    expect(new Set([
      blurBrushCapabilityDescriptor.previewSignature,
      sharpenBrushCapabilityDescriptor.previewSignature,
      smudgeBrushCapabilityDescriptor.previewSignature,
      toneBrushCapabilityDescriptors.dodge.previewSignature,
      toneBrushCapabilityDescriptors.burn.previewSignature,
      spongeBrushCapabilityDescriptor.previewSignature,
    ]).size).toBe(6);

    expect(spongeBrushCapabilityDescriptor.modes).toEqual(['saturate', 'desaturate']);
    expect(smudgeBrushCapabilityDescriptor.sampling.source).toBe('previous-stroke-point-current-layer');
    expect(toneBrushCapabilityDescriptors.dodge.tonal).toMatchObject({
      range: 'midtones',
      protectTones: true,
      supportsRangeTargeting: true,
    });
    expect(toneBrushCapabilityDescriptors.dodge.warnings.map((warning) => warning.code)).not.toContain('tone-range-unsupported');
  });

  it('blur brush softens only the brushed target region', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 255, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 255, 255]);

    const blurred = applyBlurBrushToImageData(imageData, {
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 1,
    });

    expect(getPixel(blurred, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(blurred, 1, 0)).toEqual([85, 85, 85, 255]);
    expect(getPixel(blurred, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('blur brush strength controls the amount of local softening', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 255, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 255, 255]);

    const blurred = applyBlurBrushToImageData(imageData, {
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(blurred, 1, 0)).toEqual([43, 170, 43, 255]);
  });

  it('blur brush can sample from a source point in a separate source image', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [0, 0, 0, 0]);
    const source = makeImageData(5, 1);
    setPixel(source, 0, 0, [0, 0, 0, 0]);
    setPixel(source, 1, 0, [0, 0, 0, 0]);
    setPixel(source, 2, 0, [200, 20, 40, 255]);
    setPixel(source, 3, 0, [200, 20, 40, 255]);
    setPixel(source, 4, 0, [200, 20, 40, 255]);

    const blurred = applyBlurBrushToImageData(imageData, {
      targetPoint: { x: 0, y: 0 },
      sourcePoint: { x: 3, y: 0 },
      size: 1,
      strength: 1,
      sourceImageData: source,
    });

    expect(getPixel(blurred, 0, 0)).toEqual([200, 20, 40, 255]);
  });

  it('sharpen brush increases local contrast only in the brushed target region', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [80, 80, 80, 255]);
    setPixel(imageData, 1, 0, [100, 120, 100, 255]);
    setPixel(imageData, 2, 0, [80, 80, 80, 255]);

    const sharpened = applySharpenBrushToImageData(imageData, {
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 1,
    });

    expect(getPixel(sharpened, 0, 0)).toEqual([80, 80, 80, 255]);
    expect(getPixel(sharpened, 1, 0)).toEqual([113, 147, 113, 255]);
    expect(getPixel(sharpened, 2, 0)).toEqual([80, 80, 80, 255]);
  });

  it('sharpen brush strength controls the amount of local contrast added', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [80, 80, 80, 255]);
    setPixel(imageData, 1, 0, [100, 120, 100, 255]);
    setPixel(imageData, 2, 0, [80, 80, 80, 255]);

    const sharpened = applySharpenBrushToImageData(imageData, {
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(sharpened, 1, 0)).toEqual([107, 134, 107, 255]);
  });

  it('sharpen brush can sample from a source point in a separate source image', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 100, 100, 255]);
    const source = makeImageData(5, 1);
    setPixel(source, 0, 0, [100, 100, 100, 255]);
    setPixel(source, 1, 0, [100, 100, 100, 255]);
    setPixel(source, 2, 0, [60, 60, 60, 255]);
    setPixel(source, 3, 0, [60, 60, 60, 255]);
    setPixel(source, 4, 0, [60, 60, 60, 255]);

    const sharpened = applySharpenBrushToImageData(imageData, {
      targetPoint: { x: 0, y: 0 },
      sourcePoint: { x: 3, y: 0 },
      size: 1,
      strength: 1,
      sourceImageData: source,
    });

    expect(getPixel(sharpened, 0, 0)).toEqual([140, 140, 140, 255]);
  });

  it('smudge brush drags sampled pixels into the target region', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 255, 0, 255]);
    setPixel(imageData, 2, 0, [0, 0, 255, 255]);

    const smudged = applySmudgeBrushToImageData(imageData, {
      sourcePoint: { x: 0, y: 0 },
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 1,
    });

    expect(getPixel(smudged, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(smudged, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(smudged, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('smudge brush strength controls the dragged-pixel mix', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [255, 0, 0, 255]);
    setPixel(imageData, 1, 0, [0, 255, 0, 255]);

    const smudged = applySmudgeBrushToImageData(imageData, {
      sourcePoint: { x: 0, y: 0 },
      targetPoint: { x: 1, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(smudged, 1, 0)).toEqual([128, 128, 0, 255]);
  });

  it('dodge brush brightens the brushed region toward white', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);
    setPixel(imageData, 1, 0, [10, 20, 30, 255]);

    const dodged = applyToneBrushToImageData(imageData, {
      mode: 'dodge',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(dodged, 0, 0)).toEqual([178, 203, 228, 255]);
    expect(getPixel(dodged, 1, 0)).toEqual([10, 20, 30, 255]);
  });

  it('burn brush darkens the brushed region toward black', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);
    setPixel(imageData, 1, 0, [10, 20, 30, 255]);

    const burned = applyToneBrushToImageData(imageData, {
      mode: 'burn',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(burned, 0, 0)).toEqual([50, 75, 100, 255]);
    expect(getPixel(burned, 1, 0)).toEqual([10, 20, 30, 255]);
  });

  it('dodge and burn brushes can target tonal ranges', () => {
    const imageData = makeImageData(3, 1);
    setPixel(imageData, 0, 0, [35, 40, 45, 255]);
    setPixel(imageData, 1, 0, [125, 130, 135, 255]);
    setPixel(imageData, 2, 0, [225, 230, 235, 255]);

    const shadowDodge = applyToneBrushToImageData(imageData, {
      mode: 'dodge',
      targetPoint: { x: 1, y: 0 },
      size: 3,
      strength: 0.5,
      toneRange: 'shadows',
    });
    expect(getPixel(shadowDodge, 0, 0)[0]).toBeGreaterThan(35);
    expect(getPixel(shadowDodge, 1, 0)).toEqual([125, 130, 135, 255]);
    expect(getPixel(shadowDodge, 2, 0)).toEqual([225, 230, 235, 255]);

    const highlightBurn = applyToneBrushToImageData(imageData, {
      mode: 'burn',
      targetPoint: { x: 1, y: 0 },
      size: 3,
      strength: 0.5,
      toneRange: 'highlights',
    });
    expect(getPixel(highlightBurn, 0, 0)).toEqual([35, 40, 45, 255]);
    expect(getPixel(highlightBurn, 1, 0)).toEqual([125, 130, 135, 255]);
    expect(getPixel(highlightBurn, 2, 0)[0]).toBeLessThan(225);
  });

  it('protect tones keeps dodge and burn closer to the original channel balance', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [220, 90, 30, 255]);

    const unprotected = applyToneBrushToImageData(imageData, {
      mode: 'dodge',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
      protectTones: false,
    });
    const protectedTone = applyToneBrushToImageData(imageData, {
      mode: 'dodge',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
      protectTones: true,
    });

    expect(getPixel(protectedTone, 0, 0)[0]).toBeGreaterThan(220);
    expect(getPixel(protectedTone, 0, 0)[1]).toBeLessThan(getPixel(unprotected, 0, 0)[1]);
    expect(getPixel(protectedTone, 0, 0)[2]).toBeLessThan(getPixel(unprotected, 0, 0)[2]);
  });

  it('sponge saturate brush increases brushed color separation', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);
    setPixel(imageData, 1, 0, [20, 30, 40, 255]);

    const saturated = applySpongeBrushToImageData(imageData, {
      mode: 'saturate',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(saturated, 0, 0)).toEqual([75, 150, 225, 255]);
    expect(getPixel(saturated, 1, 0)).toEqual([20, 30, 40, 255]);
  });

  it('sponge desaturate brush reduces brushed color separation', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);
    setPixel(imageData, 1, 0, [20, 30, 40, 255]);

    const desaturated = applySpongeBrushToImageData(imageData, {
      mode: 'desaturate',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
    });

    expect(getPixel(desaturated, 0, 0)).toEqual([125, 150, 175, 255]);
    expect(getPixel(desaturated, 1, 0)).toEqual([20, 30, 40, 255]);
  });

  it('sponge vibrance weighting affects muted colors more than saturated colors', () => {
    const imageData = makeImageData(2, 1);
    setPixel(imageData, 0, 0, [130, 140, 150, 255]);
    setPixel(imageData, 1, 0, [20, 120, 240, 255]);

    const saturated = applySpongeBrushToImageData(imageData, {
      mode: 'saturate',
      targetPoint: { x: 0, y: 0 },
      size: 3,
      strength: 0.5,
      vibrance: 1,
      preserveLuminosity: false,
    });

    const mutedDelta = Math.abs(getPixel(saturated, 0, 0)[2] - getPixel(imageData, 0, 0)[2]);
    const saturatedDelta = Math.abs(getPixel(saturated, 1, 0)[2] - getPixel(imageData, 1, 0)[2]);
    expect(mutedDelta).toBeGreaterThan(saturatedDelta);
  });

  it('sponge can preserve brushed pixel luminance while changing saturation', () => {
    const imageData = makeImageData(1, 1);
    setPixel(imageData, 0, 0, [100, 150, 200, 255]);

    const saturated = applySpongeBrushToImageData(imageData, {
      mode: 'saturate',
      targetPoint: { x: 0, y: 0 },
      size: 1,
      strength: 0.5,
      vibrance: 0,
      preserveLuminosity: true,
    });

    const beforeLum = 100 * 0.2126 + 150 * 0.7152 + 200 * 0.0722;
    const [red, green, blue] = getPixel(saturated, 0, 0);
    const afterLum = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    expect(Math.abs(afterLum - beforeLum)).toBeLessThanOrEqual(1);
    expect(blue - red).toBeGreaterThan(100);
  });
});
