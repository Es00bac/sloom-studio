import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { maskBoundingBox } from './SelectionMask';
import {
  buildLocalObjectSelectionPlan,
  buildLocalObjectSelectionMask,
  describeLocalObjectSelectionDiagnosticSignatures,
  describeObjectSelectionFallbackRoutes,
  selectOfflineSubject,
  selectLargestForegroundComponent,
} from './ImageObjectSelection';

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function setPixel(imageData: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  imageData.data.set(rgba, (y * imageData.width + x) * 4);
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-object-selection',
    title: 'object.png',
    width: 8,
    height: 6,
    layers: [],
    activeLayerId: null,
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
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('ImageObjectSelection', () => {
  it('describes cloud/local subject-object selection fallback routing honestly', () => {
    const descriptor = describeObjectSelectionFallbackRoutes({
      hasEditableLayerBitmap: true,
      cloudProviderConfigured: false,
      allowCloudFallback: true,
    });

    expect(descriptor).toEqual({
      descriptorId: 'image-object-selection-fallback-routes:v1',
      local: {
        route: 'local-alpha-luminance-components',
        state: 'ready',
        output: 'document-selection',
        refinementTarget: 'select-and-mask',
      },
      cloud: {
        route: 'cloud-ai-subject-object-provider',
        state: 'blocked',
        blocker: 'cloud-provider-not-configured',
        fallback: 'local-alpha-luminance-components',
      },
      routingOrder: ['local-alpha-luminance-components', 'cloud-ai-subject-object-provider'],
      signature: 'object-selection-fallbacks:v1:local=ready:cloud=blocked-cloud-provider-not-configured:order=local-alpha-luminance-components>cloud-ai-subject-object-provider',
    });
  });

  it('selects the largest connected foreground component from alpha and luminance', () => {
    const source = makeImageData(6, 4);
    setPixel(source, 0, 0, [255, 255, 255, 255]);
    setPixel(source, 4, 1, [180, 180, 180, 255]);
    setPixel(source, 5, 1, [180, 180, 180, 255]);
    setPixel(source, 4, 2, [180, 180, 180, 255]);
    setPixel(source, 5, 2, [180, 180, 180, 255]);
    setPixel(source, 2, 3, [10, 10, 10, 255]);

    const mask = selectLargestForegroundComponent(source, {
      alphaThreshold: 8,
      luminanceThreshold: 32,
    });

    expect(maskBoundingBox(mask)).toEqual({ x: 4, y: 1, width: 2, height: 2 });
    expect(Array.from(mask.data)).toEqual([
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 255, 255,
      0, 0, 0, 0, 255, 255,
      0, 0, 0, 0, 0, 0,
    ]);
  });

  it('selects a dark central subject against an opaque bright background without a downloaded model', () => {
    const source = makeImageData(9, 7);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        setPixel(source, x, y, [232, 228, 220, 255]);
      }
    }
    for (const [x, y] of [
      [3, 2], [4, 2], [5, 2],
      [3, 3], [4, 3], [5, 3],
      [3, 4], [4, 4], [5, 4],
    ] as const) {
      setPixel(source, x, y, [32, 64, 96, 255]);
    }

    const mask = selectOfflineSubject(source);

    expect(maskBoundingBox(mask)).toEqual({ x: 3, y: 2, width: 3, height: 3 });
    expect(mask.data[0]).toBe(0);
    expect(mask.data[3 * mask.width + 4]).toBe(255);
  });

  it('uses the subject route in a document while preserving the normal selection history operation', () => {
    const source = makeImageData(7, 5);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) setPixel(source, x, y, [225, 225, 225, 255]);
    }
    for (const [x, y] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]] as const) {
      setPixel(source, x, y, [35, 75, 110, 255]);
    }
    const bitmap = { width: source.width, height: source.height } as LayerBitmap;
    const doc = makeDoc({
      activeLayerId: 'active',
      layers: [makeLayer({ id: 'active', bitmap })],
    });

    const mask = buildLocalObjectSelectionMask(doc, {
      selectionMode: 'subject',
      readLayerImageData: () => source,
    });

    expect(maskBoundingBox(mask!)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });

  it('can include additional islands, fill holes, and drop tiny components when requested', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1],
      [1, 2],         [3, 2],
      [1, 3], [2, 3], [3, 3],
      [5, 2], [5, 3],
      [6, 0],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const mask = selectLargestForegroundComponent(source, {
      alphaThreshold: 8,
      luminanceThreshold: 32,
      includeDisconnectedIslands: true,
      fillHoles: true,
      minComponentArea: 2,
    });

    expect(maskBoundingBox(mask)).toEqual({ x: 1, y: 1, width: 5, height: 3 });
    expect(mask.data[2 * mask.width + 2]).toBe(255);
    expect(mask.data[2 * mask.width + 5]).toBe(255);
    expect(mask.data[0 * mask.width + 6]).toBe(0);
  });

  it('can clean up narrow edge protrusions when requested', () => {
    const source = makeImageData(6, 5);
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1],
      [1, 2], [2, 2], [3, 2], [4, 2],
      [1, 3], [2, 3], [3, 3],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const mask = selectLargestForegroundComponent(source, {
      alphaThreshold: 8,
      luminanceThreshold: 32,
      cleanupPasses: 1,
    });

    expect(maskBoundingBox(mask)).toEqual({ x: 1, y: 1, width: 3, height: 3 });
    expect(mask.data[2 * mask.width + 4]).toBe(0);
  });

  it('builds a document-space object selection from the active visible layer', () => {
    const layerImage = makeImageData(3, 2);
    setPixel(layerImage, 0, 0, [0, 0, 0, 0]);
    setPixel(layerImage, 1, 0, [220, 220, 220, 255]);
    setPixel(layerImage, 2, 0, [220, 220, 220, 255]);
    setPixel(layerImage, 1, 1, [220, 220, 220, 255]);
    const bitmap = { width: 3, height: 2 } as LayerBitmap;
    const doc = makeDoc({
      activeLayerId: 'active',
      layers: [
        makeLayer({ id: 'hidden', visible: false, x: 0, y: 0, bitmap }),
        makeLayer({ id: 'active', x: 2, y: 3, bitmap }),
      ],
    });

    const mask = buildLocalObjectSelectionMask(doc, {
      readLayerImageData: (layer) => (layer.id === 'active' ? layerImage : makeImageData(3, 2)),
    });

    expect(mask).not.toBeNull();
    expect(maskBoundingBox(mask!)).toEqual({ x: 3, y: 3, width: 2, height: 2 });
  });

  it('describes component filtering and cleanup without mutating selection behavior', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1],
      [1, 2],         [3, 2],
      [1, 3], [2, 3], [3, 3],
      [5, 2], [5, 3],
      [6, 0],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      alphaThreshold: 8,
      luminanceThreshold: 32,
      includeDisconnectedIslands: true,
      fillHoles: true,
      minComponentArea: 2,
      cleanupPasses: 1,
    });

    expect(plan.componentSummary).toEqual({
      componentCount: 3,
      selectedComponentCount: 2,
      selectedArea: 10,
      rejectedArea: 1,
      largestComponentArea: 8,
    });
    expect(plan.components.map((component) => ({
      id: component.id,
      area: component.area,
      selected: component.selected,
      rejectedReason: component.rejectedReason,
      bounds: component.bounds,
    }))).toEqual([
      {
        id: 'component-1',
        area: 1,
        selected: false,
        rejectedReason: 'below-min-area',
        bounds: { x: 6, y: 0, width: 1, height: 1 },
      },
      {
        id: 'component-2',
        area: 8,
        selected: true,
        rejectedReason: null,
        bounds: { x: 1, y: 1, width: 3, height: 3 },
      },
      {
        id: 'component-3',
        area: 2,
        selected: true,
        rejectedReason: null,
        bounds: { x: 5, y: 2, width: 1, height: 2 },
      },
    ]);
    expect(plan.cleanup).toEqual({
      includeDisconnectedIslands: true,
      minComponentArea: 2,
      fillHoles: true,
      cleanupPasses: 1,
      estimatedHolePixelsFilled: 1,
      edgeCleanupEnabled: true,
    });
    expect(plan.selectionBounds).toEqual({ x: 1, y: 1, width: 5, height: 3 });
    expect(plan.foregroundScore).toEqual({
      sourcePixelCount: 35,
      foregroundPixelCount: 11,
      selectedArea: 10,
      rejectedArea: 1,
      selectedToForegroundRatio: 0.9091,
      selectedToImageRatio: 0.2857,
      score: 90.91,
    });
    expect(plan.readiness).toEqual({
      mode: 'object',
      state: 'ready',
      warningCodes: [],
    });
    expect(plan.refineHandoff).toMatchObject({
      target: 'select-and-mask',
      required: true,
      reason: 'Multiple retained foreground components need Select and Mask review before destructive output.',
      caveat: 'Select and Mask is local-only and is used for edge refinement; cloud AI subject detection is not available.',
    });
    expect(plan.previewSignature).toBe(
      'object-select:v1:7x5:a8:l32:min2:islands1:fill1:cleanup1:selected:component-2,component-3:area10:components2:rejected1:holes1:bounds1,1,5,3:score90.91:ready-object-ready:warningsnone:refine-select-and-mask-required',
    );
  });

  it('reports readiness caveats for subject mode when AI selection is requested', () => {
    const source = makeImageData(4, 3);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [1, 1],
    ] as const) {
      setPixel(source, x, y, [255, 255, 255, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'subject',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      minComponentArea: 1,
    });

    expect(plan.readiness).toEqual({
      mode: 'subject',
      state: 'ready-with-caveats',
      warningCodes: ['ai-subject-detection-unsupported'],
    });
    expect(plan.refineHandoff.required).toBe(true);
    expect(plan.refineHandoff.reason).toBe(
      'Foreground candidates were reduced by local component heuristics; refine before downstream edge-critical use.',
    );
    expect(plan.previewSignature).toContain('ready-subject-ready-with-caveats');
    expect(plan.previewSignature).toContain('warningsai-subject-detection-unsupported');
    expect(plan.foregroundScore.selectedToForegroundRatio).toBeGreaterThan(0.6);
    expect(plan.objectSelectionMetadata).toEqual({
      detector: 'local-border-contrast-subject-heuristic',
      source: 'layer-bitmap-image-data',
      confidenceModel: 'heuristic-foreground-score',
      photoshopEquivalent: 'select-subject',
      retainedObjectIds: ['component-1'],
    });
    expect(plan.maskHandoff).toEqual({
      source: 'local-component-mask',
      target: 'document-selection',
      refineTarget: 'select-and-mask',
      hasSelection: true,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    });
    expect(plan.unsupportedPhotoshopEquivalents.map((state) => state.code)).toEqual([
      'ai-subject-detection-unsupported',
      'cloud-object-finder-unsupported',
    ]);
    expect(plan.invalidSelectionBlockers).toEqual([]);
    expect(plan.batchActionSuitability).toEqual({
      status: 'limited-ready',
      actionRecordable: true,
      batchSafe: false,
      reason: 'Object/subject selection is deterministic for a loaded layer bitmap, but batch playback must validate each document foreground before committing.',
    });
  });

  it('blocks object selection descriptors when foreground filtering leaves no valid selection', () => {
    const source = makeImageData(3, 2);
    setPixel(source, 1, 1, [255, 255, 255, 255]);

    const plan = buildLocalObjectSelectionPlan(source, {
      alphaThreshold: 8,
      luminanceThreshold: 32,
      minComponentArea: 3,
    });

    expect(plan.readiness.state).toBe('blocked');
    expect(plan.invalidSelectionBlockers.map((blocker) => blocker.code)).toEqual([
      'all-foreground-filtered',
    ]);
    expect(plan.maskHandoff.hasSelection).toBe(false);
    expect(plan.batchActionSuitability.status).toBe('blocked');
  });

  it('builds deterministic select-and-mask handoff guidance with confidence, cleanup, and offline caveats', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1],
      [1, 2],         [3, 2],
      [1, 3], [2, 3], [3, 3],
      [5, 2], [5, 3],
      [6, 0],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'subject',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      includeDisconnectedIslands: true,
      fillHoles: true,
      minComponentArea: 2,
      cleanupPasses: 1,
    });

    expect(plan.foregroundConfidenceSummary).toEqual({
      band: 'medium',
      score: 90.91,
      selectedToForegroundRatio: 0.9091,
      selectedToImageRatio: 0.2857,
      summary: 'Selected 10 of 11 foreground pixels across 2 retained components; review edges before mask handoff.',
      reviewRecommended: true,
    });
    expect(plan.refineHandoff.selectAndMaskReadiness).toEqual({
      state: 'ready-with-caveats',
      recommendationCode: 'subject-fragment-cleanup-review',
      unsupportedFeatures: [
        'semantic-hair-fur-refinement',
        'decontaminate-colors',
        'radius-brush-edge-learning',
      ],
      retainedForegroundLimits: {
        retainedComponentCount: 2,
        rejectedComponentCount: 1,
        disconnectedForeground: true,
        edgeReviewRequired: true,
        maximumComponentsBeforeManualCleanup: 4,
      },
      recommendedSettings: {
        smooth: 1,
        feather: 1,
        contrast: 18,
        shiftEdge: -1,
      },
      reasons: [
        'Subject mode is using offline foreground heuristics instead of AI subject detection.',
        'Multiple retained components and rejected foreground islands need explicit edge review.',
        'Hole fill and edge cleanup metadata should be reviewed before committing a mask output.',
      ],
      warnings: [
        {
          code: 'select-mask-multi-component-review',
          severity: 'warning',
          message: 'Multiple retained foreground components need manual review before mask output.',
        },
        {
          code: 'select-mask-local-edge-refine-only',
          severity: 'warning',
          message: 'Select and Mask readiness is limited to local edge cleanup metadata; semantic refine features are not available.',
        },
      ],
      signature: 'object-select-handoff:v2:subject:ready-with-caveats:s1:f1:c18:shift-1:medium:cleanup1:holes1:components2:rejected1:limitslocal-edge-only',
    });
    expect(plan.refineHandoff.cleanupPassMetadata).toEqual({
      requestedPasses: 1,
      appliedPasses: 1,
      holeFillApplied: true,
      estimatedHolePixelsFilled: 1,
      edgeCleanupEnabled: true,
      signature: 'object-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
    });
    expect(plan.refineHandoff.offlineAICaveats).toEqual([
      'Selection was generated locally from border-background contrast and component saliency; no cloud or on-device learned semantic AI model ran.',
      'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
    ]);
  });

  it('describes bounded select-and-mask readiness limits and deterministic handoff warnings', () => {
    const source = makeImageData(9, 5);
    for (const [x, y] of [
      [0, 1], [1, 1],
      [3, 1], [3, 2],
      [5, 1], [6, 1], [5, 2], [6, 2],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'object',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      includeDisconnectedIslands: true,
      minComponentArea: 1,
    });

    expect(plan.refineHandoff.selectAndMaskReadiness).toMatchObject({
      state: 'ready-with-caveats',
      recommendationCode: 'component-edge-review',
      unsupportedFeatures: [
        'semantic-hair-fur-refinement',
        'decontaminate-colors',
        'radius-brush-edge-learning',
      ],
      retainedForegroundLimits: {
        retainedComponentCount: 3,
        rejectedComponentCount: 0,
        disconnectedForeground: true,
        edgeReviewRequired: true,
        maximumComponentsBeforeManualCleanup: 4,
      },
      warnings: [
        {
          code: 'select-mask-multi-component-review',
          severity: 'warning',
          message: 'Multiple retained foreground components need manual review before mask output.',
        },
        {
          code: 'select-mask-local-edge-refine-only',
          severity: 'warning',
          message: 'Select and Mask readiness is limited to local edge cleanup metadata; semantic refine features are not available.',
        },
      ],
      signature:
        'object-select-handoff:v2:object:ready-with-caveats:s0:f1:c12:shift0:medium:cleanup0:holes0:components3:rejected0:limitslocal-edge-only',
    });
    expect(plan.refineHandoff.reason).toBe(
      'Multiple retained foreground components need Select and Mask review before destructive output.',
    );
    expect(plan.previewSignature).toContain('refine-select-and-mask-required');
    expect(plan.previewSignature).toContain('components3');
  });

  it('describes local handoff metadata, foreground diagnostics, and subject fallback without AI claims', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [0, 0], [1, 0],
      [3, 1], [4, 1], [5, 1],
      [3, 2], [4, 2], [5, 2],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'subject',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      minComponentArea: 1,
    });

    expect(plan.subjectDetection).toEqual({
      requested: true,
      state: 'local-heuristic',
      implementation: 'local-border-contrast-saliency',
      model: null,
      fallbackDetector: 'local-border-contrast-subject-heuristic',
      confidenceSource: 'heuristic-foreground-score',
      warningCodes: ['ai-subject-detection-unsupported'],
      message: 'Offline Select Subject uses a local border-contrast visual heuristic; no learned AI subject model is executed.',
    });
    expect(plan.handoffMetadata).toEqual({
      localOnly: true,
      source: 'layer-bitmap-image-data',
      selectionSpace: 'source-image-pixels',
      outputSpace: 'document-selection',
      writesDocumentSelection: true,
      retainedObjectIds: ['component-2'],
      selectedArea: 6,
      selectionBounds: { x: 3, y: 1, width: 3, height: 2 },
      refineTarget: 'select-and-mask',
      requiresSelectAndMaskReview: true,
      confidenceBand: 'medium',
      signature: 'object-select-local-handoff:v1:subject:local1:out-document-selection:objectscomponent-2:area6:bounds3,1,3,2:refine1:confmedium',
    });
    expect(plan.foregroundDiagnostics).toEqual({
      sourcePixelCount: 35,
      foregroundPixelCount: 8,
      componentCount: 2,
      selectedComponentIds: ['component-2'],
      rejectedComponentIds: ['component-1'],
      edgeTouchingComponentIds: ['component-1'],
      foregroundCoverageRatio: 0.2286,
      selectedForegroundRatio: 0.75,
      selectedBoundsArea: 6,
      selectedDensity: 1,
      signature: 'object-select-foreground:v1:35px:fg8:components2:selectedcomponent-2:rejectedcomponent-1:edgecomponent-1:coverage0.2286:selected0.75:density1',
    });
    expect(plan.components.map((component) => ({
      id: component.id,
      selected: component.selected,
      diagnostics: component.diagnostics,
    }))).toEqual([
      {
        id: 'component-1',
        selected: false,
        diagnostics: {
          boundsArea: 2,
          density: 1,
          touchesCanvasEdge: true,
          selectionRole: 'rejected-not-largest',
        },
      },
      {
        id: 'component-2',
        selected: true,
        diagnostics: {
          boundsArea: 6,
          density: 1,
          touchesCanvasEdge: false,
          selectionRole: 'retained',
        },
      },
    ]);
  });

  it('adds confidence coverage diagnostics, unsupported refinement states, and save/load handoff metadata', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [0, 0], [1, 0],
      [3, 1], [4, 1], [5, 1],
      [3, 2], [4, 2], [5, 2],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'subject',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      minComponentArea: 1,
    });

    expect(plan.confidenceDiagnostics).toEqual({
      band: 'medium',
      coverageBand: 'sparse',
      foregroundCoverageRatio: 0.2286,
      selectedForegroundRatio: 0.75,
      selectedToImageRatio: 0.1714,
      selectedDensity: 1,
      edgeTouchingRetainedComponentCount: 0,
      edgeTouchingRejectedComponentCount: 1,
      edgeRisk: 'medium',
      reviewRecommended: true,
      reviewCodes: [
        'subject-ai-fallback',
        'rejected-edge-foreground',
        'filtered-foreground',
      ],
      signature: 'object-select-confidence:v1:medium:sparse:fg0.2286:selected0.75:image0.1714:density1:edge-retained0:edge-rejected1:riskmedium:reviewsubject-ai-fallback|rejected-edge-foreground|filtered-foreground',
    });
    expect(plan.unsupportedRefinementStates).toEqual([
      {
        code: 'ai-subject-detection-unsupported',
        stage: 'subject-detection',
        severity: 'unsupported',
        recoverableWith: 'local-border-contrast-subject-heuristic',
        message: 'A learned AI subject model is not executed; Offline Select Subject uses local border-contrast foreground analysis and records confidence diagnostics for review.',
      },
      {
        code: 'edge-aware-object-brush-unsupported',
        stage: 'select-and-mask-refinement',
        severity: 'unsupported',
        recoverableWith: 'select-and-mask-local-brush',
        message: 'Edge-aware object refinement brushes are not available; downstream Select and Mask can only expand, contract, or soften deterministic mask regions.',
      },
    ]);
    expect(plan.saveLoadHandoffMetadata).toEqual({
      schemaVersion: 1,
      source: 'local-object-selection-plan',
      localOnly: true,
      stableForSaveLoad: true,
      maskSnapshotRecommended: true,
      selectionSpace: 'source-image-pixels',
      outputSpace: 'document-selection',
      serializedFields: [
        'mode',
        'thresholds',
        'component-summary',
        'component-diagnostics',
        'confidence-diagnostics',
        'cleanup-pass-metadata',
        'select-and-mask-readiness',
      ],
      volatileFields: [
        'source-image-data',
        'document-selection-registry',
        'ai-subject-model-result',
      ],
      handoffSignature: 'object-select-local-handoff:v1:subject:local1:out-document-selection:objectscomponent-2:area6:bounds3,1,3,2:refine1:confmedium',
      confidenceSignature: 'object-select-confidence:v1:medium:sparse:fg0.2286:selected0.75:image0.1714:density1:edge-retained0:edge-rejected1:riskmedium:reviewsubject-ai-fallback|rejected-edge-foreground|filtered-foreground',
      signature: 'object-select-save-load:v1:subject:objectscomponent-2:bounds3,1,3,2:confmedium:coverage-sparse:review1',
    });
  });

  it('exposes stable diagnostic signatures and explicit local object-selection caveats', () => {
    const source = makeImageData(7, 5);
    for (const [x, y] of [
      [0, 0], [1, 0],
      [3, 1], [4, 1], [5, 1],
      [3, 2], [4, 2], [5, 2],
    ] as const) {
      setPixel(source, x, y, [240, 240, 240, 255]);
    }

    const plan = buildLocalObjectSelectionPlan(source, {
      selectionMode: 'subject',
      alphaThreshold: 8,
      luminanceThreshold: 32,
      minComponentArea: 1,
    });

    expect(describeLocalObjectSelectionDiagnosticSignatures(plan)).toEqual({
      kind: 'local-object-selection-diagnostic-signatures',
      stableHandoffId: 'object-select-handoff:v1:subject:7x5:component-2',
      localOnly: true,
      signatures: {
        preview: plan.previewSignature,
        foregroundDiagnostics: plan.foregroundDiagnostics.signature,
        confidenceDiagnostics: plan.confidenceDiagnostics.signature,
        cleanup: plan.refineHandoff.cleanupPassMetadata.signature,
        selectAndMaskReadiness: plan.refineHandoff.selectAndMaskReadiness.signature,
        handoff: plan.handoffMetadata.signature,
        saveLoadHandoff: plan.saveLoadHandoffMetadata.signature,
      },
      unsupportedStates: [
        'ai-subject-detection-unsupported',
        'cloud-object-finder-unsupported',
        'edge-aware-object-brush-unsupported',
      ],
      blockerCodes: [],
      signature: [
        'object-select-diagnostics:v1',
        'object-select-handoff:v1:subject:7x5:component-2',
        plan.foregroundDiagnostics.signature,
        plan.confidenceDiagnostics.signature,
        plan.refineHandoff.selectAndMaskReadiness.signature,
        'unsupported-ai-subject-detection-unsupported|cloud-object-finder-unsupported|edge-aware-object-brush-unsupported',
        'blockers-none',
      ].join(':'),
    });
  });
});
