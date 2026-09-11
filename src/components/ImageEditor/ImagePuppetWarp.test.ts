import { describe, expect, it } from 'vitest';
import {
  applyPuppetWarpToImageData,
  buildPuppetWarpPlanningDescriptor,
  buildPuppetWarpPreviewMetadata,
  computePuppetWarpOffset,
  describePuppetWarpReadiness,
  createPuppetWarpPinSession,
  addPuppetWarpPin,
  buildPuppetWarpApplyCancelPlan,
  buildPuppetWarpDeformationReadinessDescriptor,
  buildPuppetWarpMeshPreviewPlan,
  validatePuppetWarpPinSession,
  movePuppetWarpPin,
  removePuppetWarpPin,
  type ImagePuppetWarpPreviewWarning,
  type ImagePuppetWarpPin,
} from './ImagePuppetWarp';

describe('ImagePuppetWarp', () => {
  it('computes deterministic weighted displacement from moved pins', () => {
    const pins: ImagePuppetWarpPin[] = [
      { source: { x: 0, y: 0 }, target: { x: 2, y: 0 }, radius: 4 },
      { source: { x: 4, y: 0 }, target: { x: 4, y: 2 }, radius: 4 },
    ];

    const offset = computePuppetWarpOffset({ x: 1, y: 0 }, pins);

    expect(offset.x).toBeCloseTo(1.6, 5);
    expect(offset.y).toBeCloseTo(0.4, 5);
  });

  it('warps ImageData with inverse sampled pin displacement while preserving dimensions', () => {
    const source = makeImageData(3, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]);

    const warped = applyPuppetWarpToImageData(source, {
      pins: [{ source: { x: 0, y: 0 }, target: { x: 1, y: 0 }, radius: 2 }],
    });

    expect(warped.width).toBe(3);
    expect(warped.height).toBe(1);
    expect(readPixel(warped, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(warped, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(readPixel(warped, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(Array.from(source.data)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
  });

  it('creates a deterministic pin session with clamped radii and invalid-pin warnings', () => {
    const session = createPuppetWarpPinSession(
      [
        { source: { x: 10, y: 20 }, target: { x: 13, y: 24 }, radius: 80 },
        { source: { x: Number.NaN, y: 5 }, target: { x: 1, y: 2 }, radius: 12 },
        { source: { x: 2, y: 3 }, target: { x: 4, y: 5 }, radius: -8 },
      ],
      { defaultRadius: 18, minRadius: 6, maxRadius: 32, preserveSmartObjects: true },
    );

    expect(session.pins).toEqual([
      {
        id: 'pin-1',
        source: { x: 10, y: 20 },
        target: { x: 13, y: 24 },
        radius: 32,
      },
      {
        id: 'pin-2',
        source: { x: 2, y: 3 },
        target: { x: 4, y: 5 },
        radius: 6,
      },
    ]);
    expect(session.warnings).toEqual<ImagePuppetWarpPreviewWarning[]>([
      'unsupported-smart-object-preservation',
      'invalid-pin-ignored',
    ]);
  });

  it('moves and removes pins by id without mutating the previous session list', () => {
    const initialSession = createPuppetWarpPinSession(
      [{ source: { x: 5, y: 5 }, target: { x: 6, y: 7 }, radius: 9 }],
      { defaultRadius: 18 },
    );

    const moved = movePuppetWarpPin(initialSession.pins, 'pin-1', {
      source: { x: 10, y: 11 },
      target: { x: 13, y: 17 },
      radius: 2,
    }, { minRadius: 4, maxRadius: 24 });

    expect(moved).toEqual([
      {
        id: 'pin-1',
        source: { x: 10, y: 11 },
        target: { x: 13, y: 17 },
        radius: 4,
      },
    ]);
    expect(initialSession.pins).toEqual([
      {
        id: 'pin-1',
        source: { x: 5, y: 5 },
        target: { x: 6, y: 7 },
        radius: 9,
      },
    ]);
    expect(removePuppetWarpPin(moved, 'pin-1')).toEqual([]);
    expect(removePuppetWarpPin(moved, 'missing')).toBe(moved);
  });

  it('adds pins deterministically with immutable session helpers', () => {
    const session = createPuppetWarpPinSession([
      { source: { x: 5, y: 5 }, target: { x: 6, y: 7 }, radius: 9 },
      { source: { x: 99, y: 88 }, target: { x: 101, y: 90 }, radius: 11 },
    ]);

    const withAdded = addPuppetWarpPin(session.pins, {
      source: { x: 20, y: 19 },
      target: { x: 24, y: 23 },
      radius: 4,
    });

    expect(withAdded).toEqual([
      {
        id: 'pin-1',
        source: { x: 5, y: 5 },
        target: { x: 6, y: 7 },
        radius: 9,
      },
      {
        id: 'pin-2',
        source: { x: 99, y: 88 },
        target: { x: 101, y: 90 },
        radius: 11,
      },
      {
        id: 'pin-3',
        source: { x: 20, y: 19 },
        target: { x: 24, y: 23 },
        radius: 4,
      },
    ]);

    expect(session.pins).toEqual([
      {
        id: 'pin-1',
        source: { x: 5, y: 5 },
        target: { x: 6, y: 7 },
        radius: 9,
      },
      {
        id: 'pin-2',
        source: { x: 99, y: 88 },
        target: { x: 101, y: 90 },
        radius: 11,
      },
    ]);
    expect(addPuppetWarpPin(withAdded, {
      source: { x: Number.NaN, y: 2 },
      target: { x: 2, y: 2 },
      radius: 7,
    })).toBe(withAdded);
    expect(addPuppetWarpPin(withAdded, {
      source: { x: 1, y: 1 },
      target: { x: 2, y: 2 },
      radius: 7,
    }, { maxPinCount: 3 })).toBe(withAdded);
  });

  it('builds bounded preview metadata and keeps default weighted displacement unchanged unless bounded options are selected', () => {
    const pins: ImagePuppetWarpPin[] = [
      { source: { x: 10, y: 10 }, target: { x: 22, y: 10 }, radius: 40 },
      { source: { x: 30, y: 18 }, target: { x: 30, y: 25 }, radius: 4 },
    ];

    const legacyOffset = computePuppetWarpOffset({ x: 25, y: 10 }, pins);
    const boundedOffset = computePuppetWarpOffset(
      { x: 25, y: 10 },
      pins,
      { maxPinRadius: 10 },
    );

    expect(legacyOffset.x).toBeCloseTo(12, 5);
    expect(legacyOffset.y).toBeCloseTo(0, 5);
    expect(boundedOffset.x).toBeCloseTo(0, 5);
    expect(boundedOffset.y).toBeCloseTo(0, 5);

    expect(buildPuppetWarpPreviewMetadata(pins, {
      minRadius: 4,
      maxRadius: 10,
      preserveSmartObjects: true,
    })).toEqual({
      bounds: { left: 0, top: 0, right: 34, bottom: 29 },
      meshSize: { columns: 3, rows: 2 },
      pinCount: 2,
      warnings: ['unsupported-smart-object-preservation'],
    });
  });

  it('builds deterministic puppet warp planning descriptors with pin, mesh, and unsupported workflow summaries', () => {
    const descriptor = buildPuppetWarpPlanningDescriptor(
      [
        { source: { x: 10.2, y: 10.8 }, target: { x: 22.4, y: 10.8 }, radius: 40 },
        { source: { x: 30, y: 18 }, target: { x: 30, y: 25.5 }, radius: 4 },
      ],
      {
        minRadius: 4,
        maxRadius: 10,
        preserveSmartObjects: true,
        documentId: 'doc-A',
        layerId: 'layer-B',
      },
    );

    expect(descriptor.toolSupport).toEqual({
      pins: true,
      directMeshEditing: false,
      densityModes: false,
      smartObjectPreservation: false,
      onCanvasPinEditor: false,
      nonDestructive: false,
      pinSessionHelpers: {
        add: true,
        move: true,
        remove: true,
      },
    });
    expect(descriptor.pinSummary).toEqual({
      count: 2,
      movedCount: 2,
      averageRadius: 7,
      totalDisplacement: 19.7,
      pins: [
        {
          id: 'pin-1',
          source: { x: 10.2, y: 10.8 },
          target: { x: 22.4, y: 10.8 },
          radius: 10,
          displacement: { x: 12.2, y: 0, distance: 12.2 },
        },
        {
          id: 'pin-2',
          source: { x: 30, y: 18 },
          target: { x: 30, y: 25.5 },
          radius: 4,
          displacement: { x: 0, y: 7.5, distance: 7.5 },
        },
      ],
    });
    expect(descriptor.mesh).toEqual({
      bounds: { left: 0, top: 0, right: 34, bottom: 30 },
      columns: 3,
      rows: 2,
      limitation: 'weighted-pin-field-only',
    });
    expect(descriptor.preview).toEqual({
      id: 'puppet-warp-doc-A-layer-B-2-pins',
      signature: 'puppet:doc-A:layer-B:pin-1@10.2,10.8>22.4,10.8/10|pin-2@30,18>30,25.5/4:3x2:0,0,34,30',
    });
    expect(descriptor.warnings).toEqual<ImagePuppetWarpPreviewWarning[]>([
      'unsupported-smart-object-preservation',
      'unsupported-on-canvas-pin-editor',
      'unsupported-non-destructive-workflow',
    ]);
  });

  it('describes pin deformation readiness, Photoshop-equivalent gaps, and source handoff safety', () => {
    const descriptor = describePuppetWarpReadiness(
      [
        { source: { x: 10, y: 10 }, target: { x: 14, y: 12 }, radius: 20 },
        { source: { x: 30, y: 18 }, target: { x: 30, y: 18 }, radius: 8 },
      ],
      {
        documentId: 'doc-ready',
        layerId: 'layer-ready',
        preserveSmartObjects: true,
        maxPinCount: 4,
      },
    );

    expect(descriptor.supportedLocalDeformations).toEqual(['weighted-pin-displacement']);
    expect(descriptor.sessionState).toEqual({
      type: 'bounded-pin-session',
      pinCount: 2,
      maxPinCount: 4,
      previewBeforeCommit: true,
      destructiveApply: true,
      undoSnapshotRequired: true,
    });
    expect(descriptor.controlState).toEqual({
      addPin: true,
      movePin: true,
      removePin: true,
      pinRadius: true,
      directMeshEditing: false,
      densityModes: false,
      perspectiveWarp: false,
    });
    expect(descriptor.pinSupport).toEqual({
      supported: true,
      maxPinCount: 4,
      movablePins: true,
      fixedPins: true,
      movedPinCount: 1,
      unmovedPinCount: 1,
      limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp',
    });
    expect(descriptor.unsupportedPhotoshopEquivalentStates).toEqual([
      'interactive-on-canvas-pin-editor',
      'direct-triangulated-mesh-editing',
      'mesh-density-modes',
      'perspective-warp',
      'smart-object-puppet-warp-filter',
    ]);
    expect(descriptor.smartSourceCaveats).toEqual([
      'smart-object-preservation-is-metadata-only',
      'source-linked-layer-must-be-exported-as-derived-bitmap',
    ]);
    expect(descriptor.nonDestructiveLimitations).toEqual([
      'puppet-warp-commits-pixels-on-apply',
      'no-reopenable-puppet-mesh-state',
      'callers-need-history-or-duplicate-layer-for-reversal',
    ]);
    expect(descriptor.exportSourceBinHandoffSafety).toEqual({
      safeForFlattenedExport: true,
      safeForSourceBinDerivedBitmap: true,
      preservesOriginalSource: false,
      caveat: 'handoff-should-use-derived-bitmap-or-snapshot-not-original-smart-source',
    });
    expect(descriptor.batchActionSuitability).toEqual({
      deterministic: true,
      suitableForRecordedActions: true,
      caveats: ['requires-fixed-pin-coordinates-radius-and-layer-bounds', 'not-suitable-for-freeform-on-canvas-mesh-edit-recording'],
    });
    expect(descriptor.readinessSignature).toBe(
      'puppet-readiness:doc-ready:layer-ready:2/4:1:smart:pin-1@10,10>14,12/20|pin-2@30,18>30,18/8',
    );
  });

  it('adds pin, mesh, workspace, and preview/export readiness descriptors without claiming a live deformation workspace', () => {
    const descriptor = describePuppetWarpReadiness(
      [
        { source: { x: 8, y: 8 }, target: { x: 12, y: 10 }, radius: 18 },
        { source: { x: 28, y: 16 }, target: { x: 28, y: 16 }, radius: 10 },
      ],
      {
        documentId: 'doc-puppet-advanced',
        layerId: 'layer-puppet-advanced',
        maxPinCount: 6,
      },
    );

    expect(descriptor.pinReadiness).toEqual({
      addPin: true,
      movePin: true,
      removePin: true,
      pinRadius: true,
      movedPinCount: 1,
      unmovedPinCount: 1,
      actionSuitable: true,
      batchSuitable: true,
      previewSignature: 'puppet-pin-preview:v1:doc-puppet-advanced:layer-puppet-advanced:2:1:1',
      exportSignature: 'puppet-pin-export:v1:doc-puppet-advanced:layer-puppet-advanced:derived-bitmap',
    });
    expect(descriptor.meshReadiness).toEqual({
      weightedFieldSupported: true,
      triangulatedMeshEditingSupported: false,
      meshDensityModesSupported: false,
      perspectiveWarpSupported: false,
      limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp',
      unsupportedStates: [
        'direct-triangulated-mesh-editing',
        'mesh-density-modes',
        'perspective-warp',
      ],
    });
    expect(descriptor.previewExportSignatures).toEqual({
      preview: 'puppet-readiness-preview:v1:doc-puppet-advanced:layer-puppet-advanced:2/6:1',
      export: 'puppet-readiness-export:v1:doc-puppet-advanced:layer-puppet-advanced:derived-bitmap',
    });
    expect(descriptor.workspace).toEqual({
      fullyInteractive: false,
      onCanvasPinPlacementPreview: true,
      reopenableMeshWorkspaceSupported: false,
      limitation: 'descriptor-only-pin-session-not-live-deformation-workspace',
      unsupportedFeatures: [
        'interactive-on-canvas-pin-editor',
        'mesh-density-overlays',
        'reopenable-puppet-mesh-workspace',
      ],
    });
  });

  it('validates bounded pin sessions with layer bounds, max-pin issues, and deterministic signatures', () => {
    const validation = validatePuppetWarpPinSession(
      [
        { id: 'anchor', source: { x: 4, y: 5 }, target: { x: 7, y: 9 }, radius: 3 },
        { id: 'anchor', source: { x: 12, y: 4 }, target: { x: 12, y: 4 }, radius: 999 },
        { source: { x: Number.NaN, y: 1 }, target: { x: 1, y: 2 }, radius: 5 },
        { source: { x: -2, y: 2 }, target: { x: 2, y: 2 }, radius: 5 },
        { source: { x: 18, y: 8 }, target: { x: 28, y: 8 }, radius: 6 },
        { source: { x: 1, y: 1 }, target: { x: 2, y: 2 }, radius: 3 },
      ],
      {
        documentId: 'doc-validate',
        layerId: 'layer-validate',
        layerBounds: { left: 0, top: 0, width: 20, height: 10 },
        minRadius: 2,
        maxRadius: 10,
        maxPinCount: 3,
      },
    );

    expect(validation.sanitizedPins).toEqual([
      { id: 'anchor', source: { x: 4, y: 5 }, target: { x: 7, y: 9 }, radius: 3 },
      { id: 'pin-1', source: { x: 12, y: 4 }, target: { x: 12, y: 4 }, radius: 10 },
      { id: 'pin-2', source: { x: 18, y: 8 }, target: { x: 28, y: 8 }, radius: 6 },
    ]);
    expect(validation.valid).toBe(false);
    expect(validation.rejectedCount).toBe(3);
    expect(validation.hasMovedPins).toBe(true);
    expect(validation.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      pinIndex: issue.pinIndex,
      pinId: issue.pinId ?? null,
    }))).toEqual([
      { code: 'duplicate-pin-id', severity: 'warning', pinIndex: 1, pinId: 'anchor' },
      { code: 'pin-radius-clamped', severity: 'warning', pinIndex: 1, pinId: 'pin-1' },
      { code: 'stationary-pin', severity: 'warning', pinIndex: 1, pinId: 'pin-1' },
      { code: 'pin-coordinate-not-finite', severity: 'error', pinIndex: 2, pinId: null },
      { code: 'pin-source-outside-layer-bounds', severity: 'error', pinIndex: 3, pinId: null },
      { code: 'pin-target-outside-layer-bounds', severity: 'warning', pinIndex: 4, pinId: 'pin-2' },
      { code: 'pin-count-exceeds-limit', severity: 'warning', pinIndex: 5, pinId: null },
    ]);
    expect(validation.validationSignature).toBe(
      'puppet-validate:v1:doc-validate:layer-validate:3/3:errors=2:warnings=5:anchor@4,5>7,9/3|pin-1@12,4>12,4/10|pin-2@18,8>28,8/6',
    );
  });

  it('plans deterministic mesh vertices and preview segments for advanced warp overlays', () => {
    const plan = buildPuppetWarpMeshPreviewPlan(
      [
        { source: { x: 0, y: 0 }, target: { x: 2, y: 0 }, radius: 5 },
        { source: { x: 20, y: 10 }, target: { x: 20, y: 10 }, radius: 4 },
      ],
      {
        documentId: 'doc-mesh',
        layerId: 'layer-mesh',
        layerBounds: { left: 0, top: 0, width: 20, height: 10 },
        meshColumns: 3,
        meshRows: 2,
      },
    );

    expect(plan.mesh).toEqual({
      bounds: { left: 0, top: 0, right: 20, bottom: 10 },
      columns: 3,
      rows: 2,
      vertexCount: 6,
      segmentCount: 7,
      activeSegmentCount: 2,
      mode: 'weighted-pin-segment-preview',
    });
    expect(plan.vertices).toEqual([
      { id: 'v-0-0', source: { x: 0, y: 0 }, offset: { x: 2, y: 0 }, target: { x: 2, y: 0 }, influenceCount: 1 },
      { id: 'v-1-0', source: { x: 10, y: 0 }, offset: { x: 0, y: 0 }, target: { x: 10, y: 0 }, influenceCount: 0 },
      { id: 'v-2-0', source: { x: 20, y: 0 }, offset: { x: 0, y: 0 }, target: { x: 20, y: 0 }, influenceCount: 0 },
      { id: 'v-0-1', source: { x: 0, y: 10 }, offset: { x: 0, y: 0 }, target: { x: 0, y: 10 }, influenceCount: 0 },
      { id: 'v-1-1', source: { x: 10, y: 10 }, offset: { x: 0, y: 0 }, target: { x: 10, y: 10 }, influenceCount: 0 },
      { id: 'v-2-1', source: { x: 20, y: 10 }, offset: { x: 0, y: 0 }, target: { x: 20, y: 10 }, influenceCount: 1 },
    ]);
    expect(plan.segments.filter((segment) => segment.maxOffsetDistance > 0)).toEqual([
      { id: 'h-0-0', from: 'v-0-0', to: 'v-1-0', axis: 'horizontal', maxOffsetDistance: 2 },
      { id: 'v-0-0', from: 'v-0-0', to: 'v-0-1', axis: 'vertical', maxOffsetDistance: 2 },
    ]);
    expect(plan.unsupportedCaveats).toEqual([
      'preview-mesh-is-not-editable-triangulated-puppet-mesh',
      'perspective-corner-plane-warp-is-not-supported',
      'grid-warp-handles-are-preview-metadata-only',
    ]);
    expect(plan.previewSignature).toBe(
      'puppet-mesh:v1:doc-mesh:layer-mesh:3x2:0,0,20,10:pin-1@0,0>2,0/5|pin-2@20,10>20,10/4:v-0-0>2,0|v-1-0>10,0|v-2-0>20,0|v-0-1>0,10|v-1-1>10,10|v-2-1>20,10',
    );
  });

  it('builds apply and cancel plans that preserve source safety metadata without claiming smart filters', () => {
    const plan = buildPuppetWarpApplyCancelPlan(
      [
        { source: { x: 4, y: 4 }, target: { x: 8, y: 5 }, radius: 12 },
        { source: { x: 16, y: 10 }, target: { x: 16, y: 10 }, radius: 8 },
      ],
      {
        documentId: 'doc-apply',
        layerId: 'layer-apply',
        sourceKind: 'source-linked-layer',
        sourceId: 'asset-77',
        duplicateLayerBeforeApply: true,
        preserveSmartObjects: true,
        maxPinCount: 4,
      },
    );

    expect(plan.sourceSafety).toEqual({
      sourceKind: 'source-linked-layer',
      sourceId: 'asset-77',
      outputPolicy: 'derived-bitmap-layer',
      preservesOriginalSource: true,
      preservesActiveLayerPixels: true,
      requiresHistorySnapshot: true,
      requiresDuplicateLayerForNonDestructiveEdit: false,
      warnings: [
        'apply-commits-derived-pixels',
        'source-linked-original-is-not-mutated',
        'smart-object-filter-is-not-preserved',
      ],
    });
    expect(plan.apply).toEqual({
      action: 'apply-puppet-warp',
      mutatesPixels: true,
      outputPolicy: 'derived-bitmap-layer',
      signature: 'puppet-apply:v1:doc-apply:layer-apply:2/4:derived-bitmap-layer:duplicate-layer:pin-1@4,4>8,5/12|pin-2@16,10>16,10/8',
    });
    expect(plan.cancel).toEqual({
      action: 'cancel-puppet-warp-preview',
      mutatesPixels: false,
      outputPolicy: 'discard-preview-only',
      signature: 'puppet-cancel:v1:doc-apply:layer-apply:2/4:no-pixel-mutation:pin-1@4,4>8,5/12|pin-2@16,10>16,10/8',
    });
    expect(plan.unsupportedCaveats).toEqual([
      'perspective-warp-plane-handles-unsupported',
      'photoshop-smart-object-puppet-filter-unsupported',
      'gimp-cage-transform-equivalent-unsupported',
      'reopenable-puppet-mesh-state-unsupported',
    ]);
    expect(plan.planSignature).toBe(
      'puppet-plan:v1:doc-apply:layer-apply:source-linked-layer:asset-77:apply=puppet-apply:v1:doc-apply:layer-apply:2/4:derived-bitmap-layer:duplicate-layer:pin-1@4,4>8,5/12|pin-2@16,10>16,10/8:cancel=puppet-cancel:v1:doc-apply:layer-apply:2/4:no-pixel-mutation:pin-1@4,4>8,5/12|pin-2@16,10>16,10/8',
    );
  });

  it('bundles puppet warp readiness into an inspectable lane descriptor with stable pin, mesh, source, and preview signatures', () => {
    const descriptor = buildPuppetWarpDeformationReadinessDescriptor(
      [
        { source: { x: 2, y: 3 }, target: { x: 6, y: 5 }, radius: 12 },
        { source: { x: 18, y: 8 }, target: { x: 18, y: 8 }, radius: 6 },
        { source: { x: 4, y: 4 }, target: { x: 8, y: 4 }, radius: 5 },
      ],
      {
        documentId: 'doc-lane',
        layerId: 'layer-lane',
        sourceKind: 'smart-object',
        sourceId: 'smart-9',
        preserveSmartObjects: true,
        maxPinCount: 2,
        layerBounds: { left: 0, top: 0, width: 20, height: 10 },
        meshColumns: 3,
        meshRows: 2,
      },
    );

    expect(descriptor.lane).toBe('image-deformation-puppet-warp');
    expect(descriptor.pinPlan).toEqual({
      previewId: 'puppet-warp-doc-lane-layer-lane-2-pins',
      pinPlanSignature:
        'puppet-pin-plan:v1:doc-lane:layer-lane:2/2:moved=1:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6',
      validationSignature:
        'puppet-validate:v1:doc-lane:layer-lane:2/2:errors=0:warnings=2:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6',
      bounded: true,
      acceptedPinCount: 2,
      rejectedPinCount: 1,
      movedPinCount: 1,
    });
    expect(descriptor.mesh).toEqual({
      previewId: 'puppet-mesh-doc-lane-layer-lane-3x2',
      previewSignature:
        'puppet-mesh:v1:doc-lane:layer-lane:3x2:0,0,20,10:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6:v-0-0>4,2|v-1-0>14,2|v-2-0>20,0|v-0-1>4,12|v-1-1>14,12|v-2-1>20,10',
      trueTriangulatedMeshSupported: false,
      perspectiveWarpPlanesSupported: false,
      reopenableMeshStateSupported: false,
    });
    expect(descriptor.sourceSafety).toEqual({
      sourceKind: 'smart-object',
      sourceId: 'smart-9',
      outputPolicy: 'derived-bitmap-layer',
      signature: 'puppet-source-safety:v1:doc-lane:layer-lane:smart-object:smart-9:derived-bitmap-layer:smart-filter-unsupported',
    });
    expect(descriptor.previewActions).toEqual({
      applySignature:
        'puppet-apply:v1:doc-lane:layer-lane:2/2:derived-bitmap-layer:active-layer:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6',
      cancelSignature:
        'puppet-cancel:v1:doc-lane:layer-lane:2/2:no-pixel-mutation:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6',
    });
    expect(descriptor.unsupportedStates).toEqual([
      {
        feature: 'interactive-on-canvas-pin-editor',
        supported: false,
        requested: true,
        state: 'interactive-on-canvas-pin-editor',
        fallback: 'bounded-pin-session-descriptors',
        signature: 'puppet-unsupported:v1:doc-lane:layer-lane:interactive-on-canvas-pin-editor',
      },
      {
        feature: 'true-triangulated-mesh',
        supported: false,
        requested: true,
        state: 'direct-triangulated-mesh-editing',
        fallback: 'weighted-pin-segment-preview',
        signature: 'puppet-unsupported:v1:doc-lane:layer-lane:true-triangulated-mesh',
      },
      {
        feature: 'perspective-warp-planes',
        supported: false,
        requested: true,
        state: 'perspective-warp',
        fallback: 'use-transform-or-weighted-puppet-pins',
        signature: 'puppet-unsupported:v1:doc-lane:layer-lane:perspective-warp-planes',
      },
      {
        feature: 'smart-object-preservation',
        supported: false,
        requested: true,
        state: 'smart-object-puppet-warp-filter',
        fallback: 'derived-bitmap-layer',
        signature: 'puppet-unsupported:v1:doc-lane:layer-lane:smart-object-preservation',
      },
      {
        feature: 'reopenable-mesh-state',
        supported: false,
        requested: true,
        state: 'reopenable-puppet-mesh-state',
        fallback: 'history-snapshot-or-cancel-preview',
        signature: 'puppet-unsupported:v1:doc-lane:layer-lane:reopenable-mesh-state',
      },
    ]);
    expect(descriptor.signature).toBe(
      'puppet-lane:v1:doc-lane:layer-lane:puppet-pin-plan:v1:doc-lane:layer-lane:2/2:moved=1:pin-1@2,3>6,5/12|pin-2@18,8>18,8/6:smart-object:derived-bitmap-layer:interactive-on-canvas-pin-editor|true-triangulated-mesh|perspective-warp-planes|smart-object-preservation|reopenable-mesh-state',
    );
  });
});

function makeImageData(width: number, height: number, pixels: Array<[number, number, number, number]>): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(pixels.flat()),
  } as ImageData;
}

function readPixel(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const index = (y * imageData.width + x) * 4;
  return [
    imageData.data[index],
    imageData.data[index + 1],
    imageData.data[index + 2],
    imageData.data[index + 3],
  ];
}
