import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import * as ContentAware from './ImageContentAware';
import * as PixelActions from './photoshopQuickActions/pixelActions';

const {
  applyLocalContentAwareFillToImageData,
  buildTransparentPixelMask,
} = ContentAware;

type ContentAwareBounds = { x: number; y: number; width: number; height: number };

type ContentAwarePatchPlan = {
  kind: 'local-content-aware-fill-patch';
  operation: 'fill' | 'remove' | 'patch';
  imageSize: { width: number; height: number };
  targetKind: 'selection' | 'transparent-pixels';
  requestedOutputTarget: 'active-layer' | 'new-layer';
  outputTarget: 'active-layer';
  targetPolicy: {
    mode: 'selection' | 'transparent-pixels';
    selectionRequired: boolean;
    transparentFallback: boolean;
    description: string;
  };
  outputLimitations: Array<{
    code: 'active-layer-only';
    supported: false;
    description: string;
  }>;
  unsupportedControls: {
    samplingAreaPreview: {
      supported: false;
      reason: string;
    };
    patchSourceControl: {
      supported: false;
      reason: string;
    };
  };
  approximationWarning: {
    code: 'ai-vs-local-approximation';
    severity: 'warning';
    message: string;
  };
  selectionBounds: ContentAwareBounds | null;
  samplingRadius: number;
  targetPixels: number;
  sourcePixels: {
    sampledPixels: number;
    transparentPixels: number;
    excludedTargetPixels: number;
    bounds: ContentAwareBounds | null;
    averageRgba: [number, number, number, number] | null;
    alphaRange: { min: number; max: number } | null;
  };
  sourceDiagnostics: {
    targetHasPixels: boolean;
    sourceHasPixels: boolean;
    sampledPixels: number;
    transparentPixels: number;
    excludedTargetPixels: number;
    samplingBounds: ContentAwareBounds | null;
    blockerCodes: string[];
    summary: string;
  };
  manualPatchSourcePlan: {
    requested: boolean;
    requestedBounds: ContentAwareBounds | null;
    supported: false;
    appliedSource: 'automatic-nearby-layer-pixels';
    blockers: string[];
    description: string;
  };
  outputTargetPlan: {
    requested: 'active-layer' | 'new-layer';
    applied: 'active-layer';
    supported: boolean;
    blockers: string[];
    commitRequiredForSourceBin: true;
    sourceBinHandoff: 'commit-active-layer-result-before-export';
    description: string;
  };
  warnings: Array<{ code: string; severity: 'warning'; message: string }>;
  readiness: {
    readinessId: string;
    state: 'ready' | 'no-target-pixels' | 'no-source-pixels';
    undoable: true;
    blockers: string[];
  };
  previewSignature: string;
  stablePreview: {
    kind: 'local-content-aware-repair-preview';
    version: 1;
    signature: string;
    signatureFields: readonly string[];
  };
  preview: {
    id: string;
    signature: string;
    signatureFields: readonly string[];
  };
  samplingAreaPolicy: {
    mode: 'auto-nearby-non-target';
    editable: false;
    excludesTargetPixels: true;
    excludesTransparentPixels: true;
    maxSampleRadius: number;
    description: string;
  };
  patchSource: {
    mode: 'automatic-nearest-surrounding';
    userControllable: false;
    status: 'ready' | 'empty-target' | 'no-source-pixels';
    sourceBounds: ContentAwareBounds | null;
    sampledPixels: number;
    description: string;
  };
  outputToNewLayer: {
    supported: false;
    defaultEnabled: false;
    reason: string;
  };
  targetSummary: {
    kind: 'selection' | 'transparent-pixels';
    label: string;
    targetPixels: number;
    bounds: ContentAwareBounds | null;
    requiresSelection: boolean;
    usesTransparentFallback: boolean;
  };
  localAiLimitation: {
    localEngine: 'deterministic-pixel-patch';
    aiEquivalent: 'Photoshop Content-Aware Fill / Generative Fill';
    severity: 'warning';
    message: string;
  };
  commandCapability: {
    command: 'content-aware-fill' | 'content-aware-remove' | 'patch';
    engine: 'local-deterministic-pixel-repair';
    supportsSelectionTarget: true;
    supportsTransparentPixelTarget: true;
    supportsOutputToNewLayer: false;
    supportsManualPatchSource: false;
    supportsEditableSamplingArea: false;
    supportsAiSemanticSynthesis: false;
  };
  patchSourceLimits: {
    sourceMode: 'automatic-nearby-layer-pixels';
    maxSampleRadius: number;
    supportsManualSource: false;
    supportsCrossLayerSampling: false;
    description: string;
  };
  outputLimits: {
    outputTarget: 'active-layer';
    supportsNewLayer: false;
    supportsSourceBinDirectWrite: false;
    destructiveToActiveLayerPixels: true;
    description: string;
  };
  unsupportedStates: Array<{
    code:
      | 'ai-semantic-synthesis-unsupported'
      | 'native-photoshop-content-aware-unsupported'
      | 'editable-sampling-area-unsupported'
      | 'manual-patch-source-unsupported'
      | 'output-to-new-layer-unsupported';
    supported: false;
    severity: 'warning';
    message: string;
  }>;
  previewCaveats: Array<{
    code: 'local-preview-not-ai' | 'active-layer-result-only';
    severity: 'warning';
    message: string;
  }>;
  sourceBinHandoff: {
    mode: 'committed-active-layer-result';
    safeForSourceBin: true;
    requiresCommitBeforeHandoff: true;
    writesSourceBinDirectly: false;
    preservesOriginalSource: true;
    caveats: string[];
  };
  automationSuitability: {
    quickAction: {
      suitable: boolean;
      reason: string;
    };
    batch: {
      suitable: boolean;
      requiresPerDocumentTarget: true;
      blockers: string[];
      reason: string;
    };
  };
  invalidSelectionBlockers: Array<{
    code: 'empty-selection' | 'empty-transparent-target' | 'missing-source-pixels' | 'selection-size-mismatch';
    severity: 'blocker';
    message: string;
  }>;
  selectionValidation: {
    imageSize: { width: number; height: number };
    maskSize: { width: number; height: number };
    compatible: boolean;
    blockerCodes: string[];
    summary: string;
  };
  samplingRegionPlan: {
    strategy: 'expand-target-bounds-by-radius';
    targetBounds: ContentAwareBounds | null;
    outerBounds: ContentAwareBounds | null;
    maxRadius: number;
    rings: Array<{
      radius: number;
      bounds: ContentAwareBounds;
      candidatePixels: number;
      opaqueCandidatePixels: number;
      transparentCandidatePixels: number;
      targetPixelsExcluded: number;
    }>;
    nearestOpaqueDistance: number | null;
    usableSourceRatio: number;
    signature: string;
  };
  operationDescriptor: {
    operation: 'fill' | 'remove' | 'patch';
    execution: 'sample-and-blend-source-pixels' | 'clear-target-alpha';
    photoshopEquivalent: 'Content-Aware Fill' | 'Remove Tool' | 'Patch Tool';
    requiresSourcePixels: boolean;
    modifiesRgb: boolean;
    modifiesAlpha: boolean;
    targetEffect: string;
    caveats: string[];
    signature: string;
  };
  outputLayerPolicy: {
    requested: 'active-layer' | 'new-layer';
    applied: 'active-layer';
    createsLayer: false;
    activeLayerMutation: true;
    nonDestructive: false;
    preservesSourceLayerPixels: false;
    blockerCodes: string[];
    caveats: string[];
    signature: string;
  };
};

type DescribeContentAwarePatchPlan = (
  imageData: ImageData,
  options?: {
    selection?: ReturnType<typeof createMask> | null;
    maxSampleRadius?: number;
    outputTarget?: 'active-layer' | 'new-layer';
    manualPatchSource?: ContentAwareBounds | null;
    operation?: 'fill' | 'remove' | 'patch';
  },
) => ContentAwarePatchPlan;

type LayerContentAwarePatchPlan = ContentAwarePatchPlan & {
  layerId: string;
  layerBounds: ContentAwareBounds;
  documentSelectionBounds: ContentAwareBounds | null;
};

type PlanLayerContentAwarePatch = (
  doc: ImageDocument,
  layer: ImageLayer,
  selection?: ReturnType<typeof createMask> | null,
  options?: { maxSampleRadius?: number; operation?: 'fill' | 'remove' | 'patch' },
) => LayerContentAwarePatchPlan | null;

function makeImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(fill, offset);
  }
  return { width, height, data } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  imageData.data.set(rgba, (y * imageData.width + x) * 4);
}

function rgbaAt(imageData: ImageData, x: number, y: number): number[] {
  const offset = (y * imageData.width + x) * 4;
  return Array.from(imageData.data.slice(offset, offset + 4));
}

class FakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height, [10, 20, 30, 255]);
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
}

function makeDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Doc',
    width: 40,
    height: 40,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeLayer(): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 10,
    y: 20,
    bitmap: new FakeOffscreenCanvas(4, 3) as unknown as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

describe('ImageContentAware', () => {
  it('fills selected pixels from surrounding non-selected image content', () => {
    const imageData = makeImageData(3, 3, [100, 120, 140, 255]);
    setPixel(imageData, 1, 1, [250, 0, 0, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const result = applyLocalContentAwareFillToImageData(imageData, { selection });

    expect(rgbaAt(result.imageData, 1, 1)).toEqual([100, 120, 140, 255]);
    expect(rgbaAt(result.imageData, 0, 0)).toEqual([100, 120, 140, 255]);
    expect(result.changedPixels).toBe(1);
  });

  it('uses transparent pixels as the fill target when no active selection is supplied', () => {
    const imageData = makeImageData(3, 3, [30, 90, 150, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    const transparentMask = buildTransparentPixelMask(imageData);
    const result = applyLocalContentAwareFillToImageData(imageData, { selection: transparentMask });

    expect(rgbaAt(result.imageData, 1, 1)).toEqual([30, 90, 150, 255]);
    expect(result.changedPixels).toBe(1);
  });

  it('removes selected pixels by clearing local alpha without invoking generative AI', () => {
    const imageData = makeImageData(3, 3, [100, 120, 140, 255]);
    setPixel(imageData, 1, 1, [250, 80, 20, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const result = applyLocalContentAwareFillToImageData(imageData, { selection, operation: 'remove' });

    expect(rgbaAt(result.imageData, 1, 1)).toEqual([250, 80, 20, 0]);
    expect(result.patchPlan.operation).toBe('remove');
    expect(result.changedPixels).toBe(1);
  });

  it('uses patch as deterministic local-fill behavior', () => {
    const imageData = makeImageData(3, 3, [10, 20, 30, 255]);
    setPixel(imageData, 1, 1, [250, 0, 0, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const result = applyLocalContentAwareFillToImageData(imageData, { selection, operation: 'patch' });

    expect(rgbaAt(result.imageData, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(result.patchPlan.operation).toBe('patch');
    expect(result.changedPixels).toBe(1);
  });

  it('describes deterministic local content-aware patch planning metadata', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(4, 3, [10, 20, 30, 255]);
    setPixel(imageData, 0, 0, [0, 0, 0, 0]);
    setPixel(imageData, 1, 1, [240, 0, 0, 255]);
    setPixel(imageData, 2, 1, [250, 0, 0, 255]);
    const selection = createMask(4, 3);
    setRect(selection, 1, 1, 2, 1, 255, false);

    const plan = describePlan!(imageData, { selection, maxSampleRadius: 2 });

    expect(plan).toMatchObject({
      kind: 'local-content-aware-fill-patch',
      operation: 'fill',
      imageSize: { width: 4, height: 3 },
      targetKind: 'selection',
      outputTarget: 'active-layer',
      targetPolicy: {
        mode: 'selection',
        selectionRequired: true,
        transparentFallback: false,
        description: 'Repairs selected pixels on the active layer using nearby non-selected opaque source pixels.',
      },
      outputLimitations: [
        {
          code: 'local-active-layer-source',
          supported: true,
          description: 'Repair samples the active raster layer only. Output can replace that layer or be emitted as a separate local repair layer.',
        },
      ],
      unsupportedControls: {
        samplingAreaPreview: {
          supported: true,
          reason: 'The bounded sampling source is configurable as active-layer pixel bounds; it is not a Photoshop-native overlay.',
        },
        patchSourceControl: {
          supported: true,
          reason: 'A bounded active-layer source rectangle is applied deterministically; cross-layer source sampling is not available.',
        },
      },
      approximationWarning: {
        code: 'ai-vs-local-approximation',
        severity: 'warning',
        message: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
      },
      selectionBounds: { x: 1, y: 1, width: 2, height: 1 },
      samplingRadius: 2,
      targetPixels: 2,
      sourcePixels: {
        sampledPixels: 9,
        transparentPixels: 1,
        excludedTargetPixels: 2,
        bounds: { x: 0, y: 0, width: 4, height: 3 },
        averageRgba: [10, 20, 30, 255],
        alphaRange: { min: 255, max: 255 },
      },
      warnings: [
        {
          code: 'local-approximation',
          severity: 'warning',
          message: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
        },
      ],
    });
    expect(plan.previewSignature).toBe(
      'local-content-aware-patch:v1:{"targetKind":"selection","outputTarget":"active-layer","selectionBounds":{"x":1,"y":1,"width":2,"height":1},"samplingRadius":2,"targetPixels":2,"sourcePixels":{"sampledPixels":9,"transparentPixels":1,"excludedTargetPixels":2,"bounds":{"x":0,"y":0,"width":4,"height":3},"averageRgba":[10,20,30,255],"alphaRange":{"min":255,"max":255}},"warnings":["local-approximation"]}',
    );
    expect(plan.stablePreview).toMatchObject({
      kind: 'local-content-aware-repair-preview',
      version: 1,
      signatureFields: [
        'operation',
        'targetKind',
        'outputTarget',
        'selectionBounds',
        'samplingRadius',
        'targetPixels',
        'sourcePixels',
        'warnings',
      ],
    });
    expect(plan.stablePreview.signature).not.toBe(plan.previewSignature);
    expect(plan.stablePreview.signature).toContain('"operation":"fill"');
  });

  it('describes remove and patch local repair variants without changing the stable sampling contract', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(3, 3, [80, 90, 100, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const removePlan = describePlan!(imageData, { selection, operation: 'remove', maxSampleRadius: 1 });
    const patchPlan = describePlan!(imageData, { selection, operation: 'patch', maxSampleRadius: 1 });
    const transparentPlan = describePlan!(imageData, { operation: 'fill', maxSampleRadius: 1 });

    expect(removePlan).toMatchObject({
      operation: 'remove',
      targetPolicy: {
        mode: 'selection',
        selectionRequired: true,
        transparentFallback: false,
      },
      sourcePixels: {
        sampledPixels: 8,
        transparentPixels: 0,
        excludedTargetPixels: 1,
      },
    });
    expect(patchPlan).toMatchObject({
      operation: 'patch',
      unsupportedControls: {
        patchSourceControl: {
          supported: true,
        },
      },
    });
    expect(transparentPlan).toMatchObject({
      operation: 'fill',
      targetKind: 'transparent-pixels',
      targetPolicy: {
        mode: 'transparent-pixels',
        selectionRequired: false,
        transparentFallback: true,
        description: 'When no selection is supplied, transparent pixels on the active layer become the repair target.',
      },
    });
    expect(removePlan.previewSignature).toBe(patchPlan.previewSignature);
    expect(removePlan.stablePreview.signature).not.toBe(patchPlan.stablePreview.signature);
    expect(removePlan.stablePreview.signature).toContain('"operation":"remove"');
    expect(patchPlan.stablePreview.signature).toContain('"operation":"patch"');
  });

  it('tracks readiness blockers for missing target and missing source conditions', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const allOpaque = makeImageData(2, 2, [10, 20, 30, 255]);
    const noSelection = createMask(2, 2);
    const emptySelectionPlan = describePlan!(allOpaque, {
      selection: noSelection,
      operation: 'fill',
      maxSampleRadius: 2,
    });
    const transparentDefaultPlan = describePlan!(allOpaque, { operation: 'fill', maxSampleRadius: 2 });
    const allTransparent = makeImageData(2, 2, [10, 20, 30, 0]);
    const fullSelection = createMask(2, 2);
    setRect(fullSelection, 0, 0, 2, 2, 255, false);
    const noSourcePlan = describePlan!(allTransparent, {
      selection: fullSelection,
      operation: 'fill',
      maxSampleRadius: 1,
    });
    const removeWithNoSourcePlan = describePlan!(allTransparent, {
      selection: fullSelection,
      operation: 'remove',
      maxSampleRadius: 1,
    });

    expect(emptySelectionPlan).toMatchObject({
      targetKind: 'selection',
      targetPixels: 0,
      readiness: {
        state: 'no-target-pixels',
        blockers: ['No selection target pixels were found.'],
        undoable: true,
      },
    });
    expect(transparentDefaultPlan).toMatchObject({
      targetKind: 'transparent-pixels',
      targetPixels: 0,
      readiness: {
        state: 'no-target-pixels',
        blockers: ['No transparent-pixels target pixels were found.'],
        undoable: true,
      },
    });
    expect(noSourcePlan).toMatchObject({
      operation: 'fill',
      targetKind: 'selection',
      readiness: {
        state: 'no-source-pixels',
        blockers: ['No opaque non-target source pixels were found inside the sampling radius.'],
        undoable: true,
      },
      patchSource: {
        status: 'no-source-pixels',
      },
    });
    expect(removeWithNoSourcePlan).toMatchObject({
      operation: 'remove',
      targetKind: 'selection',
      readiness: {
        state: 'ready',
        blockers: [],
        undoable: true,
      },
      patchSource: {
        status: 'ready',
      },
    });
  });

  it('surfaces output caveats and local-vs-AI boundaries in all repair operations', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(2, 2, [12, 24, 36, 255]);
    const selection = createMask(2, 2);
    setRect(selection, 0, 0, 1, 1, 255, false);

    const plans = [
      describePlan!(imageData, { selection, operation: 'fill', maxSampleRadius: 2 }),
      describePlan!(imageData, { selection, operation: 'patch', maxSampleRadius: 2 }),
      describePlan!(imageData, { selection, operation: 'remove', maxSampleRadius: 2 }),
    ];

    plans.forEach((plan) => {
      expect(plan.outputToNewLayer).toEqual({
        supported: true,
        defaultEnabled: false,
        reason: 'Local repair can retain the source layer by writing only repaired target pixels to a new raster layer.',
      });
      expect(plan.unsupportedControls).toEqual(
        expect.objectContaining({
          samplingAreaPreview: expect.objectContaining({
            supported: true,
            reason: expect.stringContaining('active-layer'),
          }),
          patchSourceControl: expect.objectContaining({
            supported: true,
            reason: expect.stringContaining('active-layer'),
          }),
        }),
      );
      expect(plan.readiness).toHaveProperty('undoable', true);
      expect(plan.localAiLimitation).toEqual({
        localEngine: 'deterministic-pixel-patch',
        aiEquivalent: 'Photoshop Content-Aware Fill / Generative Fill',
        severity: 'warning',
        message: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
      });
      expect(plan.approximationWarning).toEqual({
        code: 'ai-vs-local-approximation',
        severity: 'warning',
        message: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
      });
      expect(plan.commandCapability).toEqual(
        expect.objectContaining({
          supportsOutputToNewLayer: true,
          supportsManualPatchSource: true,
          supportsEditableSamplingArea: true,
          supportsAiSemanticSynthesis: false,
        }),
      );
    });
  });

  it('exposes richer parity descriptors for sampling, patch source, output, target, preview, and command capability', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(4, 4, [12, 24, 36, 255]);
    setPixel(imageData, 0, 0, [0, 0, 0, 0]);
    const selection = createMask(4, 4);
    setRect(selection, 1, 1, 2, 2, 255, false);

    const plan = describePlan!(imageData, { selection, operation: 'remove', maxSampleRadius: 2 });

    expect(plan.samplingAreaPolicy).toEqual({
      mode: 'auto-nearby-non-target',
      editable: true,
      excludesTargetPixels: true,
      excludesTransparentPixels: true,
      maxSampleRadius: 2,
      description: 'Samples opaque pixels near the target while excluding selected/target pixels and transparent pixels.',
    });
    expect(plan.patchSource).toEqual({
      mode: 'automatic-nearest-surrounding',
      userControllable: true,
      status: 'ready',
      sourceBounds: null,
      sampledPixels: 11,
      description: 'Remove mode clears target alpha locally; it does not consume source-sampling candidates.',
    });
    expect(plan.outputToNewLayer).toEqual({
      supported: true,
      defaultEnabled: false,
      reason: 'Local repair can retain the source layer by writing only repaired target pixels to a new raster layer.',
    });
    expect(plan.targetSummary).toEqual({
      kind: 'selection',
      label: 'Active selection',
      targetPixels: 4,
      bounds: { x: 1, y: 1, width: 2, height: 2 },
      requiresSelection: true,
      usesTransparentFallback: false,
    });
    expect(plan.localAiLimitation).toEqual({
      localEngine: 'deterministic-pixel-patch',
      aiEquivalent: 'Photoshop Content-Aware Fill / Generative Fill',
      severity: 'warning',
      message: 'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.',
    });
    expect(plan.commandCapability).toEqual({
      command: 'content-aware-remove',
      engine: 'local-deterministic-pixel-repair',
      supportsSelectionTarget: true,
      supportsTransparentPixelTarget: true,
      supportsOutputToNewLayer: true,
      supportsManualPatchSource: true,
      supportsEditableSamplingArea: true,
      supportsAiSemanticSynthesis: false,
    });
    expect(plan.preview).toEqual({
      id: 'local-content-aware-remove:selection:4x4:1,1,2,2:r2:t4',
      signature: plan.stablePreview.signature,
      signatureFields: plan.stablePreview.signatureFields,
    });
  });

  it('describes unsupported AI states, output caveats, source-bin handoff safety, and automation suitability', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(3, 3, [64, 96, 128, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const plan = describePlan!(imageData, { selection, operation: 'patch', maxSampleRadius: 5 });

    expect(plan.patchSourceLimits).toEqual({
      sourceMode: 'automatic-nearby-layer-pixels',
      maxSampleRadius: 5,
      supportsManualSource: true,
      supportsCrossLayerSampling: false,
      description: 'Patch sources are limited to nearby opaque pixels on the active layer unless source bounds are configured.',
    });
    expect(plan.outputLimits).toEqual({
      outputTarget: 'active-layer',
      supportsNewLayer: true,
      supportsSourceBinDirectWrite: false,
      destructiveToActiveLayerPixels: true,
      description: 'The committed result updates active-layer pixels; export or Source Bin handoff must use the committed document result.',
    });
    expect(plan.unsupportedStates.map((state) => state.code)).toEqual([
      'ai-semantic-synthesis-unsupported',
      'native-photoshop-content-aware-unsupported',
    ]);
    expect(plan.previewCaveats).toEqual([
      {
        code: 'local-preview-not-ai',
        severity: 'warning',
        message: 'Preview signatures describe deterministic local pixel repair, not Photoshop or cloud AI synthesis.',
      },
      {
        code: 'local-active-layer-source',
        severity: 'warning',
        message: 'The deterministic repair samples only the active raster layer; it is not semantic or cross-layer synthesis.',
      },
    ]);
    expect(plan.sourceBinHandoff).toEqual({
      mode: 'committed-active-layer-result',
      safeForSourceBin: true,
      requiresCommitBeforeHandoff: true,
      writesSourceBinDirectly: false,
      preservesOriginalSource: true,
      caveats: [
        'Source Bin handoff should reference the saved/committed document result, not an uncommitted preview.',
        'The original source asset is not overwritten by local content-aware repair.',
      ],
    });
    expect(plan.automationSuitability).toEqual({
      quickAction: {
        suitable: true,
        reason: 'Deterministic active-layer repair can run as an undoable quick action when target pixels and source pixels are ready.',
      },
      batch: {
        suitable: true,
        requiresPerDocumentTarget: true,
        blockers: [],
        reason: 'Batch use is safe only for documents with a valid per-document selection or transparent-pixel target.',
      },
    });
    expect(plan.invalidSelectionBlockers).toEqual([]);
  });

  it('adds sampling and handoff caveats plus structured selection diagnostics for ready and blocked repair plans', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(3, 3, [64, 96, 128, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const readyPlan = describePlan!(imageData, { selection, operation: 'fill', maxSampleRadius: 3 });
    const blockedPlan = describePlan!(makeImageData(2, 2, [0, 0, 0, 0]), {
      operation: 'fill',
      maxSampleRadius: 4,
    });

    expect(readyPlan.samplingAreaCaveats).toEqual([
      'Sampling defaults to nearby active-layer pixels; a source rectangle can constrain it.',
      'Transparent pixels and target pixels are excluded from local repair sampling.',
      'No native Photoshop sampling-area session or cross-layer sampling is wired.',
    ]);
    expect(readyPlan.outputTargetCaveats).toEqual([
      'Active-layer output replaces target pixels on the source layer.',
      'Export and Source Bin handoff must use the committed document result, not an uncommitted repair preview.',
      'Local repair is a deterministic approximation, not a generated AI layer variant.',
    ]);
    expect(readyPlan.selectionDiagnostics).toEqual({
      selectionPresent: true,
      selectionEmpty: false,
      targetKind: 'selection',
      targetPixels: 1,
      selectionBounds: { x: 1, y: 1, width: 1, height: 1 },
      blockerCodes: [],
      summary: 'Selection target is ready for local repair on the active layer.',
    });
    expect(readyPlan.handoffSignatures).toEqual({
      preview: readyPlan.stablePreview.signature,
      export: 'local-content-aware-export:v1:{"operation":"fill","targetKind":"selection","outputTarget":"active-layer","selectionBounds":{"x":1,"y":1,"width":1,"height":1},"targetPixels":1,"blockers":[],"warningCodes":["local-approximation"]}',
      sourceBin: 'local-content-aware-source-bin:v1:{"operation":"fill","targetKind":"selection","outputTarget":"active-layer","selectionBounds":{"x":1,"y":1,"width":1,"height":1},"targetPixels":1,"blockers":[],"warningCodes":["local-approximation"]}',
    });

    expect(blockedPlan.selectionDiagnostics).toEqual({
      selectionPresent: false,
      selectionEmpty: false,
      targetKind: 'transparent-pixels',
      targetPixels: 4,
      selectionBounds: { x: 0, y: 0, width: 2, height: 2 },
      blockerCodes: ['missing-source-pixels'],
      summary: 'Transparent-pixel fallback target is blocked until nearby opaque source pixels exist.',
    });
    expect(blockedPlan.handoffSignatures.export).toContain('"blockers":["missing-source-pixels"]');
    expect(blockedPlan.handoffSignatures.sourceBin).toContain('"targetKind":"transparent-pixels"');
  });

  it('promotes invalid selection and source blockers into descriptor-ready blocker records', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const opaque = makeImageData(2, 2, [20, 40, 60, 255]);
    const emptySelection = createMask(2, 2);
    const emptySelectionPlan = describePlan!(opaque, { selection: emptySelection, operation: 'fill' });
    const transparentDefaultPlan = describePlan!(opaque, { operation: 'fill' });
    const allTransparent = makeImageData(2, 2, [20, 40, 60, 0]);
    const fullSelection = createMask(2, 2);
    setRect(fullSelection, 0, 0, 2, 2, 255, false);
    const noSourcePlan = describePlan!(allTransparent, { selection: fullSelection, operation: 'patch' });

    expect(emptySelectionPlan.invalidSelectionBlockers).toEqual([
      {
        code: 'empty-selection',
        severity: 'blocker',
        message: 'The active selection does not cover any layer pixels.',
      },
    ]);
    expect(emptySelectionPlan.automationSuitability.batch).toMatchObject({
      suitable: false,
      blockers: ['empty-selection'],
    });
    expect(transparentDefaultPlan.invalidSelectionBlockers).toEqual([
      {
        code: 'empty-transparent-target',
        severity: 'blocker',
        message: 'No transparent active-layer pixels are available as a fallback target.',
      },
    ]);
    expect(noSourcePlan.invalidSelectionBlockers).toEqual([
      {
        code: 'missing-source-pixels',
        severity: 'blocker',
        message: 'No opaque non-target source pixels are available inside the sampling radius.',
      },
    ]);
  });

  it('reports empty patch-source and transparent target summaries deterministically', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(2, 2, [0, 0, 0, 0]);

    const plan = describePlan!(imageData, { operation: 'fill', maxSampleRadius: 4 });

    expect(plan.targetSummary).toEqual({
      kind: 'transparent-pixels',
      label: 'Transparent pixels',
      targetPixels: 4,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      requiresSelection: false,
      usesTransparentFallback: true,
    });
    expect(plan.patchSource).toMatchObject({
      status: 'no-source-pixels',
      sourceBounds: null,
      sampledPixels: 0,
    });
    expect(plan.preview.id).toBe('local-content-aware-fill:transparent-pixels:2x2:0,0,2,2:r4:t4');
  });

  it('includes patch planning metadata with local fill results without changing pixels', () => {
    const imageData = makeImageData(3, 3, [30, 90, 150, 255]);
    setPixel(imageData, 1, 1, [0, 0, 0, 0]);

    const result = applyLocalContentAwareFillToImageData(imageData);
    const plan = (result as typeof result & { patchPlan?: ContentAwarePatchPlan }).patchPlan;

    expect(rgbaAt(result.imageData, 1, 1)).toEqual([30, 90, 150, 255]);
    expect(result.changedPixels).toBe(1);
    expect(plan).toMatchObject({
      targetKind: 'transparent-pixels',
      outputTarget: 'active-layer',
      selectionBounds: { x: 1, y: 1, width: 1, height: 1 },
      samplingRadius: 8,
      targetPixels: 1,
    });
  });

  it('separates requested new-layer and manual patch-source planning from active-layer local execution', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(3, 3, [40, 80, 120, 255]);
    const selection = createMask(3, 3);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const plan = describePlan!(imageData, {
      selection,
      operation: 'patch',
      outputTarget: 'new-layer',
      manualPatchSource: { x: 0, y: 0, width: 1, height: 1 },
      maxSampleRadius: 2,
    });

    expect(plan.requestedOutputTarget).toBe('new-layer');
    expect(plan.outputTarget).toBe('new-layer');
    expect(plan.outputTargetPlan).toEqual({
      requested: 'new-layer',
      applied: 'new-layer',
      supported: true,
      blockers: [],
      commitRequiredForSourceBin: true,
      sourceBinHandoff: 'commit-local-repair-layer-before-export',
      description: 'Local content-aware repair creates an undoable local repair layer before Source Bin handoff.',
    });
    expect(plan.manualPatchSourcePlan).toEqual({
      requested: true,
      requestedBounds: { x: 0, y: 0, width: 1, height: 1 },
      supported: true,
      appliedSource: 'manual-active-layer-bounds',
      blockers: [],
      description: 'Manual Patch source bounds constrain deterministic sampling to opaque non-target pixels in the active layer.',
    });
    expect(plan.sourceDiagnostics).toEqual({
      targetHasPixels: true,
      sourceHasPixels: true,
      sampledPixels: 1,
      transparentPixels: 0,
      excludedTargetPixels: 0,
      samplingBounds: { x: 0, y: 0, width: 1, height: 1 },
      blockerCodes: [],
      summary: 'Automatic local repair can sample 1 opaque non-target pixels inside the sampling area.',
    });
  });

  it('explains blocked source diagnostics for repair plans with no opaque candidates', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(2, 2, [0, 0, 0, 0]);
    const selection = createMask(2, 2);
    setRect(selection, 0, 0, 2, 2, 255, false);

    const plan = describePlan!(imageData, {
      selection,
      operation: 'fill',
      maxSampleRadius: 2,
    });

    expect(plan.sourceDiagnostics).toEqual({
      targetHasPixels: true,
      sourceHasPixels: false,
      sampledPixels: 0,
      transparentPixels: 0,
      excludedTargetPixels: 4,
      samplingBounds: null,
      blockerCodes: ['missing-source-pixels'],
      summary: 'Repair is blocked because no opaque non-target source pixels were found inside the automatic sampling area.',
    });
    expect(plan.outputTargetPlan).toMatchObject({
      requested: 'active-layer',
      applied: 'active-layer',
      supported: true,
      blockers: [],
    });
  });

  it('plans local content-aware fill in layer space from document selections', () => {
    const planLayerPatch = (
      PixelActions as typeof PixelActions & {
        planLocalContentAwareFillPatch?: PlanLayerContentAwarePatch;
      }
    ).planLocalContentAwareFillPatch;
    expect(planLayerPatch).toBeTypeOf('function');

    const layer = makeLayer();
    const doc = makeDoc(layer);
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 11, 21, 2, 1, 255, false);

    const plan = planLayerPatch!(doc, layer, selection, { maxSampleRadius: 3 });

    expect(plan).toMatchObject({
      layerId: 'layer-1',
      layerBounds: { x: 10, y: 20, width: 4, height: 3 },
      documentSelectionBounds: { x: 11, y: 21, width: 2, height: 1 },
      selectionBounds: { x: 1, y: 1, width: 2, height: 1 },
      targetKind: 'selection',
      outputTarget: 'active-layer',
      samplingRadius: 3,
      targetPixels: 2,
    });
    expect(plan?.previewSignature).toBe(
      'local-content-aware-patch:v1:{"layerId":"layer-1","layerBounds":{"x":10,"y":20,"width":4,"height":3},"documentSelectionBounds":{"x":11,"y":21,"width":2,"height":1},"targetKind":"selection","outputTarget":"active-layer","selectionBounds":{"x":1,"y":1,"width":2,"height":1},"samplingRadius":3,"targetPixels":2,"sourcePixels":{"sampledPixels":10,"transparentPixels":0,"excludedTargetPixels":2,"bounds":{"x":0,"y":0,"width":4,"height":3},"averageRgba":[10,20,30,255],"alphaRange":{"min":255,"max":255}},"warnings":["local-approximation"]}',
    );
    expect(plan?.preview.id).toBe('local-content-aware-fill:selection:4x3:1,1,2,1:r3:t2:layer-1');
    expect(plan?.commandCapability).toMatchObject({
      command: 'content-aware-fill',
      supportsOutputToNewLayer: true,
      supportsManualPatchSource: true,
      supportsEditableSamplingArea: true,
    });
  });

  it('builds bounded sampling-region rings plus operation and output-layer policies', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(4, 4, [20, 40, 60, 255]);
    setPixel(imageData, 0, 0, [0, 0, 0, 0]);
    const selection = createMask(4, 4);
    setRect(selection, 1, 1, 1, 1, 255, false);

    const fillPlan = describePlan!(imageData, { selection, operation: 'fill', maxSampleRadius: 2 });
    const patchPlan = describePlan!(imageData, {
      selection,
      operation: 'patch',
      outputTarget: 'new-layer',
      maxSampleRadius: 2,
    });
    const removePlan = describePlan!(imageData, { selection, operation: 'remove', maxSampleRadius: 2 });

    expect(fillPlan.samplingRegionPlan).toEqual({
      strategy: 'expand-target-bounds-by-radius',
      targetBounds: { x: 1, y: 1, width: 1, height: 1 },
      outerBounds: { x: 0, y: 0, width: 4, height: 4 },
      maxRadius: 2,
      rings: [
        {
          radius: 1,
          bounds: { x: 0, y: 0, width: 3, height: 3 },
          candidatePixels: 9,
          opaqueCandidatePixels: 7,
          transparentCandidatePixels: 1,
          targetPixelsExcluded: 1,
        },
        {
          radius: 2,
          bounds: { x: 0, y: 0, width: 4, height: 4 },
          candidatePixels: 16,
          opaqueCandidatePixels: 14,
          transparentCandidatePixels: 1,
          targetPixelsExcluded: 1,
        },
      ],
      nearestOpaqueDistance: 1,
      usableSourceRatio: 0.875,
      signature: 'local-content-aware-sampling-region:v1:{"targetBounds":{"x":1,"y":1,"width":1,"height":1},"outerBounds":{"x":0,"y":0,"width":4,"height":4},"maxRadius":2,"rings":[{"radius":1,"bounds":{"x":0,"y":0,"width":3,"height":3},"candidatePixels":9,"opaqueCandidatePixels":7,"transparentCandidatePixels":1,"targetPixelsExcluded":1},{"radius":2,"bounds":{"x":0,"y":0,"width":4,"height":4},"candidatePixels":16,"opaqueCandidatePixels":14,"transparentCandidatePixels":1,"targetPixelsExcluded":1}],"nearestOpaqueDistance":1,"usableSourceRatio":0.875}',
    });
    expect(fillPlan.operationDescriptor).toEqual({
      operation: 'fill',
      execution: 'sample-and-blend-source-pixels',
      photoshopEquivalent: 'Content-Aware Fill',
      requiresSourcePixels: true,
      modifiesRgb: true,
      modifiesAlpha: true,
      targetEffect: 'Selected or transparent target pixels are blended toward nearby opaque source pixels.',
      caveats: [
        'Deterministic pixel repair does not infer semantic objects or backgrounds.',
        'Sampling is automatic and active-layer only.',
      ],
      signature: 'local-content-aware-operation:v1:{"operation":"fill","execution":"sample-and-blend-source-pixels","requiresSourcePixels":true,"modifiesRgb":true,"modifiesAlpha":true}',
    });
    expect(patchPlan.operationDescriptor).toMatchObject({
      operation: 'patch',
      photoshopEquivalent: 'Patch Tool',
      requiresSourcePixels: true,
    });
    expect(removePlan.operationDescriptor).toEqual({
      operation: 'remove',
      execution: 'clear-target-alpha',
      photoshopEquivalent: 'Remove Tool',
      requiresSourcePixels: false,
      modifiesRgb: false,
      modifiesAlpha: true,
      targetEffect: 'Selected target pixels have alpha cleared locally; RGB bytes are preserved for undo/diff inspection.',
      caveats: [
        'This is not Photoshop semantic Remove Tool synthesis.',
        'No replacement pixels are generated for the removed area.',
      ],
      signature: 'local-content-aware-operation:v1:{"operation":"remove","execution":"clear-target-alpha","requiresSourcePixels":false,"modifiesRgb":false,"modifiesAlpha":true}',
    });
    expect(patchPlan.outputLayerPolicy).toEqual({
      requested: 'new-layer',
      applied: 'new-layer',
      createsLayer: true,
      activeLayerMutation: false,
      nonDestructive: true,
      preservesSourceLayerPixels: true,
      blockerCodes: [],
      caveats: [
        'Local repair output contains only repaired target pixels on a new raster layer.',
        'The source is the active raster layer; cross-layer and semantic AI synthesis are unavailable.',
      ],
      signature: 'local-content-aware-output-policy:v1:{"requested":"new-layer","applied":"new-layer","createsLayer":true,"nonDestructive":true,"blockerCodes":[]}',
    });
    expect(fillPlan.stablePreview.signature).toContain('"samplingRegionSignature":"local-content-aware-sampling-region:v1:');
    expect(patchPlan.stablePreview.signature).toContain('"outputPolicySignature":"local-content-aware-output-policy:v1:');
  });

  it('blocks mismatched selection masks instead of counting off-image target pixels', () => {
    const describePlan = (
      ContentAware as typeof ContentAware & {
        describeLocalContentAwarePatchPlan?: DescribeContentAwarePatchPlan;
      }
    ).describeLocalContentAwarePatchPlan;
    expect(describePlan).toBeTypeOf('function');

    const imageData = makeImageData(2, 2, [20, 40, 60, 255]);
    const mismatchedSelection = createMask(3, 3);
    setRect(mismatchedSelection, 2, 2, 1, 1, 255, false);

    const plan = describePlan!(imageData, { selection: mismatchedSelection, operation: 'fill' });

    expect(plan.selectionValidation).toEqual({
      imageSize: { width: 2, height: 2 },
      maskSize: { width: 3, height: 3 },
      compatible: false,
      blockerCodes: ['selection-size-mismatch'],
      summary: 'Selection mask dimensions do not match the active layer image data.',
    });
    expect(plan.targetPixels).toBe(0);
    expect(plan.invalidSelectionBlockers.map((blocker) => blocker.code)).toEqual([
      'selection-size-mismatch',
      'empty-selection',
    ]);
    expect(plan.readiness.state).toBe('no-target-pixels');
    expect(plan.automationSuitability.quickAction.suitable).toBe(false);
  });
});
