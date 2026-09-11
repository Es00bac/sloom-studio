import { describe, expect, it } from 'vitest';
import { createMask, maskBoundingBox, setRect } from './SelectionMask';
import {
  DEFAULT_SELECT_AND_MASK_SETTINGS,
  buildSelectAndMaskPlanningDescriptor,
  buildSelectAndMaskPreviewMask,
  describeSelectAndMaskPreviewModeCoverage,
  describeSelectAndMaskReadinessLane,
  refineSelectionMaskWithBrushStroke,
} from './ImageSelectAndMask';

describe('ImageSelectAndMask', () => {
  it('shifts selection edges inward and outward through the preview mask builder', () => {
    const base = createMask(7, 7);
    setRect(base, 2, 2, 3, 3, 255, false);

    const grown = buildSelectAndMaskPreviewMask(base, {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      shiftEdge: 1,
    });
    const shrunk = buildSelectAndMaskPreviewMask(base, {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      shiftEdge: -1,
    });

    expect(maskBoundingBox(grown)).toEqual({ x: 1, y: 1, width: 5, height: 5 });
    expect(maskBoundingBox(shrunk)).toEqual({ x: 3, y: 3, width: 1, height: 1 });
  });

  it('hardens feathered edges when contrast is raised', () => {
    const base = createMask(7, 7);
    setRect(base, 2, 2, 3, 3, 255, false);

    const feathered = buildSelectAndMaskPreviewMask(base, {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      feather: 1,
      contrast: 0,
    });
    const contrasted = buildSelectAndMaskPreviewMask(base, {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      feather: 1,
      contrast: 100,
    });

    const featheredEdge = feathered.data[2 * feathered.width + 1];
    const contrastedEdge = contrasted.data[2 * contrasted.width + 1];

    expect(featheredEdge).toBeGreaterThan(0);
    expect(Math.abs(contrastedEdge - 128)).toBeGreaterThan(Math.abs(featheredEdge - 128));
    expect(contrastedEdge).toBeLessThanOrEqual(255);
  });

  it('expands and contracts the selection only around the refine stroke path', () => {
    const base = createMask(9, 9);
    setRect(base, 3, 3, 3, 3, 255, false);

    const expanded = refineSelectionMaskWithBrushStroke(base, {
      mode: 'expand',
      radius: 1,
      strength: 1,
      points: [{ x: 5, y: 4 }, { x: 7, y: 4 }],
    });
    const contracted = refineSelectionMaskWithBrushStroke(base, {
      mode: 'contract',
      radius: 1,
      strength: 1,
      points: [{ x: 3, y: 3 }, { x: 3, y: 5 }],
    });

    expect(maskBoundingBox(expanded)).toEqual({ x: 3, y: 3, width: 4, height: 3 });
    expect(expanded.data[4 * expanded.width + 6]).toBe(255);
    expect(expanded.data[4 * expanded.width + 2]).toBe(0);

    expect(maskBoundingBox(contracted)).toEqual({ x: 4, y: 3, width: 2, height: 3 });
    expect(contracted.data[4 * contracted.width + 3]).toBe(0);
    expect(contracted.data[4 * contracted.width + 5]).toBe(255);
  });

  it('softens only the stroked edge instead of feathering the whole selection', () => {
    const base = createMask(9, 9);
    setRect(base, 2, 2, 5, 5, 255, false);

    const softened = refineSelectionMaskWithBrushStroke(base, {
      mode: 'soften',
      radius: 1,
      strength: 1,
      points: [{ x: 6, y: 2 }, { x: 6, y: 6 }],
    });

    expect(softened.data[4 * softened.width + 6]).toBeGreaterThan(0);
    expect(softened.data[4 * softened.width + 6]).toBeLessThan(255);
    expect(softened.data[4 * softened.width + 2]).toBe(255);
    expect(softened.data[4 * softened.width + 1]).toBe(0);
  });

  it('builds deterministic preview, output, brush, and unsupported-control descriptors', () => {
    const base = createMask(9, 7);
    setRect(base, 2, 2, 4, 3, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'onBlack',
        smooth: 0,
        feather: 1,
        contrast: 0,
        shiftEdge: 0,
        outputMode: 'newAlphaChannel',
      },
      brushStrokes: [
        {
          mode: 'expand',
          radius: 2,
          strength: 3,
          points: [{ x: 5, y: 2 }, { x: 7, y: 3 }],
        },
        {
          mode: 'soften',
          points: [],
        },
      ],
      refineRadius: 12,
      decontaminateColors: true,
      targetLayerId: 'subject',
      alphaChannelName: 'Subject Edge',
    });

    expect(plan.preview).toEqual({
      mode: 'onBlack',
      matteMode: 'inverse-overlay',
      bounds: { x: 1, y: 1, width: 6, height: 5 },
      partialPixelCount: expect.any(Number),
      signature: 'select-mask-preview:v1:9x7:onBlack:s0:f1:c0:shift0:bounds1,1,6,5:partial28',
    });
    expect(plan.brushRefinements).toEqual([
      {
        index: 0,
        mode: 'expand',
        pointCount: 2,
        radius: 2,
        strength: 3,
        bounds: { x: 3, y: 0, width: 6, height: 5 },
        signature: 'select-mask-brush:v1:0:expand:r2:s3:p2:b3,0,6,5',
      },
      {
        index: 1,
        mode: 'soften',
        pointCount: 0,
        radius: 1,
        strength: 1,
        bounds: null,
        signature: 'select-mask-brush:v1:1:soften:r1:s1:p0:bnone',
      },
    ]);
    expect(plan.outputTarget).toEqual({
      mode: 'newAlphaChannel',
      label: 'New Alpha Channel',
      destructive: false,
      targetLayerId: null,
      alphaChannelName: 'Subject Edge',
      signature: 'select-mask-output:v1:newAlphaChannel:layer-none:alpha-Subject Edge',
    });
    expect(plan.readiness).toEqual({
      state: 'ready-with-caveats',
      warningCodes: [
        'select-mask-refine-edge-unsupported',
        'select-mask-radius-unsupported',
        'select-mask-decontaminate-unsupported',
      ],
    });
    expect(plan.unsupportedWarnings).toEqual([
      {
        code: 'select-mask-refine-edge-unsupported',
        severity: 'warning',
        message: 'Edge refinement is local-only and lacks full AI/edge-aware refinement parity; refine controls are intentionally planning and preview-limited.',
      },
      {
        code: 'select-mask-radius-unsupported',
        severity: 'warning',
        message: 'Smart Radius / edge detection radius is tracked for planning only and is not applied by the local matte builder.',
      },
      {
        code: 'select-mask-decontaminate-unsupported',
        severity: 'warning',
        message: 'Decontaminate Colors is tracked for planning only and is not applied to pixels by the local matte builder.',
      },
    ]);
    expect(plan.signature).toBe(
      'select-mask-plan:v1:9x7:onBlack:s0:f1:c0:shift0:radius0:decontaminate0:out-newAlphaChannel:handoff-none:brush-select-mask-brush:v1:0:expand:r2:s3:p2:b3,0,6,5|select-mask-brush:v1:1:soften:r1:s1:p0:bnone:w-select-mask-refine-edge-unsupported,select-mask-radius-unsupported,select-mask-decontaminate-unsupported',
    );
  });

  it('treats Smart Radius, Decontaminate Colors, and the mounted workspace UI as first-class settings', () => {
    const base = createMask(5, 5);
    setRect(base, 1, 1, 3, 3, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        refineRadius: 9,
        decontaminateColors: true,
        decontaminateAmount: 0.45,
      },
    });
    const lane = describeSelectAndMaskReadinessLane(plan);
    const coverage = describeSelectAndMaskPreviewModeCoverage(base, plan.settings);

    expect(plan.settings).toMatchObject({
      refineRadius: 9,
      decontaminateColors: true,
      decontaminateAmount: 0.45,
    });
    expect(plan.unsupportedWarnings.map((warning) => warning.code)).toEqual([
      'select-mask-refine-edge-unsupported',
      'select-mask-radius-unsupported',
      'select-mask-decontaminate-unsupported',
    ]);
    expect(plan.edgeRefinementBlockers.map((blocker) => blocker.code)).toEqual([
      'smart-radius-local-only',
      'edge-aware-refine-brush-unsupported',
      'decontaminate-colors-unsupported',
    ]);
    expect(lane.unsupportedStates.map((state) => state.code)).not.toContain('dedicated-refine-workspace-ui-unsupported');
    expect(coverage.dedicatedWorkspaceUi).toBe(true);
    expect(plan.signature).toContain('radius9');
    expect(plan.signature).toContain('decontaminate0.45');
  });

  it('summarizes richer edge-visualization preview modes for the mounted Select and Mask workspace', () => {
    const base = createMask(6, 4);
    setRect(base, 1, 1, 3, 2, 255, false);

    const coverage = describeSelectAndMaskPreviewModeCoverage(base, {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      enabled: true,
      feather: 1,
    });

    expect(coverage).toMatchObject({
      kind: 'select-and-mask-preview-mode-coverage',
      modeCount: 5,
      coversRicherEdgeVisualizationModes: true,
      dedicatedWorkspaceUi: true,
      modes: [
        { mode: 'maskedAreas', displayBackground: 'ruby-overlay', previewRole: 'inverse-overlay' },
        { mode: 'selectedAreas', displayBackground: 'transparent', previewRole: 'selection-alpha' },
        { mode: 'onBlack', displayBackground: 'black', previewRole: 'inverse-overlay' },
        { mode: 'onWhite', displayBackground: 'white', previewRole: 'inverse-overlay' },
        { mode: 'blackWhite', displayBackground: 'black-white', previewRole: 'selection-alpha' },
      ],
    });
    expect(coverage.signature).toBe(
      'select-mask-preview-coverage:v1:6x4:modes-maskedAreas|selectedAreas|onBlack|onWhite|blackWhite:bg-ruby-overlay|transparent|black|white|black-white:workspace1',
    );
  });

  it('reports selection type, edge state, handoff, invalid blockers, and action suitability', () => {
    const empty = createMask(4, 4);

    const plan = buildSelectAndMaskPlanningDescriptor(empty, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'blackWhite',
        feather: 2,
        contrast: 40,
        shiftEdge: -1,
        outputMode: 'layerMask',
      },
    });

    expect(plan.workingSelectionTypes).toEqual([
      'session-selection',
      'pixel-mask-preview',
      'quick-mask-handoff',
      'layer-mask-handoff',
      'alpha-channel-handoff',
    ]);
    expect(plan.refinementState).toEqual({
      smooth: { requested: 0, applied: false },
      feather: { requestedPx: 2, applied: true },
      contrast: { requested: 40, applied: true },
      shiftEdge: { requestedPx: -1, applied: true },
      smartRadius: { requestedPx: 0, applied: false },
      edgeDetection: 'local-mask-operators',
    });
    expect(plan.maskHandoff).toEqual({
      source: 'preview-selection-mask',
      target: 'layer-mask',
      targetLayerId: null,
      alphaChannelName: null,
      preservesSoftEdges: true,
      destructive: false,
    });
    expect(plan.invalidSelectionBlockers.map((blocker) => blocker.code)).toEqual([
      'empty-selection',
      'output-layer-target-missing',
    ]);
    expect(plan.readiness.state).toBe('blocked');
    expect(plan.batchActionSuitability).toEqual({
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      reason: 'Select and Mask needs a non-empty source selection and valid per-document output target before batch playback.',
    });
  });

  it('carries object-selection handoff readiness into select-and-mask planning', () => {
    const base = createMask(7, 5);
    setRect(base, 1, 1, 5, 3, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'onWhite',
        smooth: 1,
        feather: 1,
        contrast: 18,
        shiftEdge: -1,
        outputMode: 'selection',
      },
      objectSelectionHandoff: {
        mode: 'subject',
        foregroundConfidenceSummary: {
          band: 'medium',
          score: 90.91,
          selectedToForegroundRatio: 0.9091,
          selectedToImageRatio: 0.2857,
          summary: 'Selected 10 of 11 foreground pixels across 2 retained components; review edges before mask handoff.',
          reviewRecommended: true,
        },
        selectAndMaskReadiness: {
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
          signature: 'object-select-handoff:v1:subject:ready-with-caveats:s1:f1:c18:shift-1:medium:cleanup1:holes1',
        },
        cleanupPassMetadata: {
          requestedPasses: 1,
          appliedPasses: 1,
          holeFillApplied: true,
          estimatedHolePixelsFilled: 1,
          edgeCleanupEnabled: true,
          signature: 'object-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
        },
        offlineAICaveats: [
          'Selection was generated locally from border-background contrast and component saliency; no cloud or on-device learned semantic AI model ran.',
          'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
        ],
      },
    });

    expect(plan.objectSelectionHandoff).toEqual({
      mode: 'subject',
      readinessState: 'ready-with-caveats',
      recommendationCode: 'subject-fragment-cleanup-review',
      recommendedSettings: {
        smooth: 1,
        feather: 1,
        contrast: 18,
        shiftEdge: -1,
      },
      foregroundConfidenceBand: 'medium',
      foregroundConfidenceSummary: 'Selected 10 of 11 foreground pixels across 2 retained components; review edges before mask handoff.',
      cleanupPassMetadata: {
        requestedPasses: 1,
        appliedPasses: 1,
        holeFillApplied: true,
        estimatedHolePixelsFilled: 1,
        edgeCleanupEnabled: true,
        signature: 'object-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
      },
      offlineAICaveats: [
        'Selection was generated locally from border-background contrast and component saliency; no cloud or on-device learned semantic AI model ran.',
        'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
      ],
      signature: 'select-mask-object-handoff:v1:subject:ready-with-caveats:subject-fragment-cleanup-review:medium:object-select-handoff:v1:subject:ready-with-caveats:s1:f1:c18:shift-1:medium:cleanup1:holes1',
    });
    expect(plan.readiness).toEqual({
      state: 'ready-with-caveats',
      warningCodes: [
        'object-selection-confidence-review',
        'object-selection-offline-ai-caveats',
        'select-mask-refine-edge-unsupported',
      ],
    });
    expect(plan.signature).toContain('handoff-subject-fragment-cleanup-review');
  });

  it('describes output routing for selection, QuickMask, and layer-mask commits', () => {
    const base = createMask(6, 4);
    setRect(base, 1, 1, 3, 2, 255, false);
    const settings = {
      ...DEFAULT_SELECT_AND_MASK_SETTINGS,
      enabled: true,
      previewMode: 'blackWhite' as const,
      feather: 1,
    };

    const selectionPlan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...settings,
        outputMode: 'selection',
      },
    });
    const quickMaskPlan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...settings,
        outputMode: 'quickMask',
      },
    });
    const layerMaskPlan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...settings,
        outputMode: 'layerMask',
      },
      targetLayerId: 'subject-layer',
    });

    expect(selectionPlan.outputRouting).toEqual({
      readiness: 'ready',
      requestedOutput: 'selection',
      route: 'document-selection',
      commitAction: 'replace-active-selection',
      targetLayerId: null,
      alphaChannelName: null,
      selectionRegistryWrite: true,
      quickMaskEnabledAfterCommit: false,
      layerMaskWrite: false,
      alphaChannelWrite: false,
      preservesSoftEdges: true,
      blockerCodes: [],
      signature: 'select-mask-route:v1:selection:ready:document-selection:selection1:quick0:layer0:alpha0:targetnone:alphanone:soft1:blockersnone',
    });
    expect(quickMaskPlan.outputRouting).toEqual({
      readiness: 'ready',
      requestedOutput: 'quickMask',
      route: 'quick-mask-edit-buffer',
      commitAction: 'enable-quick-mask-from-preview',
      targetLayerId: null,
      alphaChannelName: null,
      selectionRegistryWrite: true,
      quickMaskEnabledAfterCommit: true,
      layerMaskWrite: false,
      alphaChannelWrite: false,
      preservesSoftEdges: true,
      blockerCodes: [],
      signature: 'select-mask-route:v1:quickMask:ready:quick-mask-edit-buffer:selection1:quick1:layer0:alpha0:targetnone:alphanone:soft1:blockersnone',
    });
    expect(layerMaskPlan.outputRouting).toEqual({
      readiness: 'ready',
      requestedOutput: 'layerMask',
      route: 'layer-mask-target',
      commitAction: 'apply-preview-to-layer-mask',
      targetLayerId: 'subject-layer',
      alphaChannelName: null,
      selectionRegistryWrite: false,
      quickMaskEnabledAfterCommit: false,
      layerMaskWrite: true,
      alphaChannelWrite: false,
      preservesSoftEdges: true,
      blockerCodes: [],
      signature: 'select-mask-route:v1:layerMask:ready:layer-mask-target:selection0:quick0:layer1:alpha0:targetsubject-layer:alphanone:soft1:blockersnone',
    });
  });

  it('describes local matte preview, edge-refinement blockers, and save/load handoff metadata', () => {
    const base = createMask(6, 4);
    setRect(base, 1, 1, 3, 2, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'onWhite',
        feather: 1,
        outputMode: 'layerMask',
      },
      targetLayerId: 'subject-layer',
      refineRadius: 6,
      decontaminateColors: true,
    });

    expect(plan.mattePreview).toEqual({
      kind: 'local-matte-preview',
      mode: 'onWhite',
      localRenderer: 'selection-mask-alpha',
      previewRole: 'inverse-overlay',
      displayBackground: 'white',
      selectedPixelCount: 20,
      rejectedPixelCount: 4,
      partialPixelCount: 20,
      coverageRatio: 0.8333,
      softEdgeRatio: 1,
      bounds: { x: 0, y: 0, width: 5, height: 4 },
      signature: 'select-mask-matte:v1:6x4:onWhite:inverse-overlay:bg-white:sel20:partial20:coverage0.8333:soft1:bounds0,0,5,4',
    });
    expect(plan.edgeRefinementBlockers).toEqual([
      {
        code: 'smart-radius-local-only',
        severity: 'unsupported',
        blocksLocalPreview: false,
        blocksNativeParity: true,
        message: 'Smart Radius is recorded as requested, but the local matte preview uses deterministic mask operators instead of learned edge detection.',
      },
      {
        code: 'edge-aware-refine-brush-unsupported',
        severity: 'unsupported',
        blocksLocalPreview: false,
        blocksNativeParity: true,
        message: 'Refine Edge Brush parity is unavailable; brush strokes are deterministic expand, contract, or soften masks without edge-aware sampling.',
      },
      {
        code: 'decontaminate-colors-unsupported',
        severity: 'unsupported',
        blocksLocalPreview: false,
        blocksNativeParity: true,
        message: 'Decontaminate Colors is persisted as a caveat only and is not applied to source pixels or matte colors.',
      },
    ]);
    expect(plan.saveLoadHandoff).toEqual({
      schemaVersion: 1,
      source: 'select-and-mask-planning-descriptor',
      roundTripSafe: true,
      maskSnapshotRequired: true,
      serializedFields: [
        'settings',
        'preview-signature',
        'matte-preview',
        'output-routing',
        'refinement-handoff',
        'brush-refinement-descriptors',
        'edge-refinement-blockers',
      ],
      volatileFields: [
        'preview-mask-pixels',
        'edge-aware-brush-samples',
        'ai-subject-model-state',
      ],
      outputRouteSignature: 'select-mask-route:v1:layerMask:ready:layer-mask-target:selection0:quick0:layer1:alpha0:targetsubject-layer:alphanone:soft1:blockersnone',
      mattePreviewSignature: 'select-mask-matte:v1:6x4:onWhite:inverse-overlay:bg-white:sel20:partial20:coverage0.8333:soft1:bounds0,0,5,4',
      signature: 'select-mask-save-load:v1:onWhite:out-layerMask:route-select-mask-route:v1:layerMask:ready:layer-mask-target:selection0:quick0:layer1:alpha0:targetsubject-layer:alphanone:soft1:blockersnone:matte-select-mask-matte:v1:6x4:onWhite:inverse-overlay:bg-white:sel20:partial20:coverage0.8333:soft1:bounds0,0,5,4:blockerssmart-radius-local-only|edge-aware-refine-brush-unsupported|decontaminate-colors-unsupported',
    });
  });

  it('summarizes object-selection refinement handoff without claiming semantic edge refinement', () => {
    const base = createMask(7, 5);
    setRect(base, 1, 1, 5, 3, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'onWhite',
        smooth: 1,
        feather: 1,
        contrast: 18,
        shiftEdge: -1,
        outputMode: 'selection',
      },
      objectSelectionHandoff: {
        mode: 'subject',
        foregroundConfidenceSummary: {
          band: 'medium',
          score: 90.91,
          selectedToForegroundRatio: 0.9091,
          selectedToImageRatio: 0.2857,
          summary: 'Selected 10 of 11 foreground pixels across 2 retained components; review edges before mask handoff.',
          reviewRecommended: true,
        },
        selectAndMaskReadiness: {
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
        },
        cleanupPassMetadata: {
          requestedPasses: 1,
          appliedPasses: 1,
          holeFillApplied: true,
          estimatedHolePixelsFilled: 1,
          edgeCleanupEnabled: true,
          signature: 'object-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
        },
        offlineAICaveats: [
          'Selection was generated locally from alpha/luminance-connected components; no cloud or on-device semantic AI model ran.',
          'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
        ],
      },
    });

    expect(plan.refinementHandoff).toEqual({
      source: 'object-selection-handoff',
      mode: 'subject',
      readinessState: 'ready-with-caveats',
      recommendationCode: 'subject-fragment-cleanup-review',
      reviewRequired: true,
      appliedSettingsMatchRecommendation: true,
      unsupportedFeatures: [
        'semantic-hair-fur-refinement',
        'decontaminate-colors',
        'radius-brush-edge-learning',
      ],
      warningCodes: [
        'object-selection-confidence-review',
        'object-selection-offline-ai-caveats',
      ],
      cleanupSignature: 'object-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
      offlineAICaveats: [
        'Selection was generated locally from alpha/luminance-connected components; no cloud or on-device semantic AI model ran.',
        'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
      ],
      signature: 'select-mask-refinement-handoff:v1:object-selection:subject:ready-with-caveats:subject-fragment-cleanup-review:review1:settings1:unsupportedsemantic-hair-fur-refinement|decontaminate-colors|radius-brush-edge-learning:cleanupobject-select-cleanup:v1:passes1:applied1:fill1:holes1:edge1',
    });
  });

  it('exposes a stable readiness lane for output routing, matte preview, and unsupported refinement states', () => {
    const base = createMask(6, 4);
    setRect(base, 1, 1, 3, 2, 255, false);

    const plan = buildSelectAndMaskPlanningDescriptor(base, {
      settings: {
        ...DEFAULT_SELECT_AND_MASK_SETTINGS,
        enabled: true,
        previewMode: 'onWhite',
        feather: 1,
        outputMode: 'layerMask',
      },
      targetLayerId: 'subject-layer',
      refineRadius: 6,
      decontaminateColors: true,
    });

    expect(describeSelectAndMaskReadinessLane(plan)).toEqual({
      kind: 'select-and-mask-readiness-lane',
      stableHandoffId: 'select-mask-handoff:v1:6x4:layerMask:subject-layer:none',
      state: 'ready-with-caveats',
      outputRoute: plan.outputRouting,
      signatures: {
        refinementPlan: plan.refinementHandoff.signature,
        outputRoute: plan.outputRouting.signature,
        mattePreview: plan.mattePreview.signature,
        saveLoadHandoff: plan.saveLoadHandoff.signature,
      },
      unsupportedStates: [
        {
          code: 'smart-radius-edge-algorithm-unsupported',
          area: 'edge-refinement',
          supported: false,
          blocksLocalPreview: false,
          blocksNativeParity: true,
          fallback: 'local-mask-operators',
        },
        {
          code: 'decontaminate-colors-edge-algorithm-unsupported',
          area: 'edge-refinement',
          supported: false,
          blocksLocalPreview: false,
          blocksNativeParity: true,
          fallback: 'metadata-only-warning',
        },
        {
          code: 'live-edge-brush-parity-unsupported',
          area: 'edge-refinement',
          supported: false,
          blocksLocalPreview: false,
          blocksNativeParity: true,
          fallback: 'deterministic-expand-contract-soften-brush',
        },
        {
          code: 'photoshop-gimp-matte-preview-fidelity-unsupported',
          area: 'matte-preview',
          supported: false,
          blocksLocalPreview: false,
          blocksNativeParity: true,
          fallback: 'selection-mask-alpha-preview',
        },
      ],
      signature: [
        'select-mask-readiness-lane:v1',
        'select-mask-handoff:v1:6x4:layerMask:subject-layer:none',
        'ready-with-caveats',
        plan.outputRouting.signature,
        plan.mattePreview.signature,
        'smart-radius-edge-algorithm-unsupported|decontaminate-colors-edge-algorithm-unsupported|live-edge-brush-parity-unsupported|photoshop-gimp-matte-preview-fidelity-unsupported',
      ].join(':'),
    });
  });
});
