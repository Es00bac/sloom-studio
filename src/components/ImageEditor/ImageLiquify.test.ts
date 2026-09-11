import { describe, expect, it } from 'vitest';
import type { LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import {
  applyLiquifyToBitmap,
  applyLiquifyToImageData,
  describeLiquifyReadiness,
  buildLiquifyApplyCancelPlan,
  buildLiquifyDeformationReadinessDescriptor,
  buildLiquifyModeSupportMatrix,
  buildLiquifyPlanningDescriptor,
  buildLiquifySessionDescriptor,
  buildLiquifySessionMetadata,
  buildLiquifyWorkspaceUiDescriptor,
  getLiquifyBrushFalloff,
  getLiquifyBrushStrength,
  type ImageLiquifyPlanningWarning,
} from './ImageLiquify';

function makeStrip(values: number[]): ImageData {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  });
  return { width: values.length, height: 1, data } as ImageData;
}

function redAt(imageData: ImageData, x: number, y = 0): number {
  return imageData.data[(y * imageData.width + x) * 4] ?? 0;
}

function makeTestBitmap(values: number[]): LayerBitmap {
  let imageData = makeStrip(values);
  return {
    width: values.length,
    height: 1,
    getContext: () => ({
      getImageData: () => ({
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data),
      }) as ImageData,
      putImageData: (next: ImageData) => {
        imageData = {
          width: next.width,
          height: next.height,
          data: new Uint8ClampedArray(next.data),
        } as ImageData;
      },
    }),
  } as unknown as LayerBitmap;
}

describe('ImageLiquify', () => {
  it('exposes explicit falloff and effective-strength helpers without changing the legacy quadratic default', () => {
    expect(getLiquifyBrushFalloff(1, 2)).toBeCloseTo(0.25);
    expect(getLiquifyBrushFalloff(1, 2, 'linear')).toBeCloseTo(0.5);
    expect(getLiquifyBrushFalloff(1, 2, 'constant')).toBe(1);
    expect(getLiquifyBrushStrength(0.8, 0.25)).toBeCloseTo(0.2);
  });

  it('pushes pixels along a bounded brush vector without mutating the source image data', () => {
    const source = makeStrip([10, 50, 90, 130, 170]);

    const liquified = applyLiquifyToImageData(source, {
      mode: 'push',
      center: { x: 2, y: 0 },
      radius: 2,
      strength: 1,
      direction: { x: 1, y: 0 },
    });

    expect(redAt(liquified, 0)).toBe(10);
    expect(redAt(liquified, 2)).toBe(50);
    expect(redAt(liquified, 4)).toBe(170);
    expect(redAt(source, 2)).toBe(90);
  });

  it('keeps pucker and bloat deterministic but distinct around the same brush center', () => {
    const source = makeStrip([10, 50, 90, 130, 170]);

    const puckered = applyLiquifyToImageData(source, {
      mode: 'pucker',
      center: { x: 2, y: 0 },
      radius: 3,
      strength: 1,
    });
    const bloated = applyLiquifyToImageData(source, {
      mode: 'bloat',
      center: { x: 2, y: 0 },
      radius: 3,
      strength: 1,
    });

    expect(redAt(puckered, 1)).toBeGreaterThan(redAt(source, 1));
    expect(redAt(bloated, 1)).toBeLessThan(redAt(source, 1));
    expect(redAt(puckered, 2)).toBe(redAt(source, 2));
    expect(redAt(bloated, 2)).toBe(redAt(source, 2));
  });

  it('supports freeze and thaw mask data when applying deformation', () => {
    const source = makeStrip([10, 50, 90, 130, 170]);

    const frozen = applyLiquifyToImageData(source, {
      mode: 'push',
      center: { x: 2, y: 0 },
      radius: 2,
      strength: 1,
      direction: { x: 1, y: 0 },
      mask: {
        width: 5,
        height: 1,
        freeze: new Uint8ClampedArray([0, 255, 255, 0, 0]),
      },
    });

    expect(redAt(frozen, 1)).toBe(redAt(source, 1));
    expect(redAt(frozen, 2)).toBe(redAt(source, 2));
    expect(redAt(frozen, 3)).toBe(130);

    const thawed = applyLiquifyToImageData(source, {
      mode: 'push',
      center: { x: 2, y: 0 },
      radius: 2,
      strength: 1,
      direction: { x: 1, y: 0 },
      mask: {
        width: 5,
        height: 1,
        freeze: new Uint8ClampedArray([0, 255, 255, 0, 0]),
        thaw: new Uint8ClampedArray([0, 0, 255, 0, 0]),
      },
    });

    expect(redAt(thawed, 1)).toBe(redAt(source, 1));
    expect(redAt(thawed, 2)).toBe(50);
  });

  it('applies the same deformation to a layer bitmap in place for undoable callers to snapshot around', () => {
    const bitmap = makeTestBitmap([10, 50, 90, 130, 170]);

    applyLiquifyToBitmap(bitmap, {
      mode: 'push',
      center: { x: 2, y: 0 },
      radius: 2,
      strength: 1,
      direction: { x: 1, y: 0 },
    });

    const result = getBitmapImageData(bitmap);
    expect(redAt(result, 2)).toBe(50);
  });

  it('builds structured session metadata for preview-oriented callers', () => {
    expect(
      buildLiquifySessionMetadata({
        mode: 'twirl',
        center: { x: 12, y: 8 },
        radius: 24,
        strength: 0.5,
        falloff: 'linear',
        previewScale: 0.75,
        mask: {
          width: 4,
          height: 3,
          freeze: new Uint8ClampedArray(12).fill(255, 0, 4),
          thaw: new Uint8ClampedArray(12).fill(255, 6, 8),
        },
      }),
    ).toMatchObject({
      brush: {
        mode: 'twirl',
        radius: 24,
        strength: 0.5,
        falloff: 'linear',
        previewScale: 0.75,
      },
      previewBounds: {
        x: -12,
        y: -16,
        width: 48,
        height: 48,
      },
      mask: {
        width: 4,
        height: 3,
        frozenPixelCount: 4,
        thawedPixelCount: 2,
      },
    });
  });

  it('builds deterministic planning descriptors for advanced liquify parity gaps', () => {
    const descriptor = buildLiquifyPlanningDescriptor({
      mode: 'twirl',
      center: { x: 12.25, y: 8.75 },
      radius: 24.5,
      strength: 1.4,
      falloff: 'linear',
      previewScale: 0.75,
      mask: {
        width: 4,
        height: 3,
        freeze: new Uint8ClampedArray(12).fill(255, 0, 4),
        thaw: new Uint8ClampedArray(12).fill(255, 6, 8),
      },
    }, {
      documentId: 'doc-A',
      layerId: 'layer-B',
      preserveSmartObjects: true,
      requestedFaceAware: true,
    });

    expect(descriptor.toolSupport).toEqual([
      { mode: 'push', supported: true, parity: 'basic' },
      { mode: 'twirl', supported: true, parity: 'basic' },
      { mode: 'pucker', supported: true, parity: 'basic' },
      { mode: 'bloat', supported: true, parity: 'basic' },
      { mode: 'reconstruct', supported: false, parity: 'unsupported' },
      { mode: 'smooth', supported: false, parity: 'unsupported' },
    ]);
    expect(descriptor.maskSummary).toEqual({
      width: 4,
      height: 3,
      frozenPixelCount: 4,
      thawedPixelCount: 2,
      effectiveFrozenPixelCount: 4,
      hasFreezeMask: true,
      hasThawMask: true,
    });
    expect(descriptor.falloff).toEqual({
      mode: 'linear',
      supportedModes: ['quadratic', 'linear', 'constant'],
      limitation: 'brush-local-falloff-only',
    });
    expect(descriptor.preview).toEqual({
      id: 'liquify-doc-A-layer-B-twirl',
      signature: 'liquify:doc-A:layer-B:twirl:12.25,8.75:24.5:1:linear:0.75:4x3:4:2',
      bounds: { x: -12.25, y: -15.75, width: 49, height: 49 },
      scale: 0.75,
    });
    expect(descriptor.warnings).toEqual<ImageLiquifyPlanningWarning[]>([
      'unsupported-face-aware-liquify',
      'unsupported-smart-object-preservation',
    ]);
    expect(descriptor.session.preview.signature).toBe(
      'liquify:doc-A:layer-B:twirl:12.25,8.75:24.5:1:linear:0.75:4x3:4:2',
    );
    expect(descriptor.session.controls.modes).toEqual([
      { mode: 'push', supported: true, parity: 'basic', requested: false },
      { mode: 'twirl', supported: true, parity: 'basic', requested: true },
      { mode: 'pucker', supported: true, parity: 'basic', requested: false },
      { mode: 'bloat', supported: true, parity: 'basic', requested: false },
      { mode: 'reconstruct', supported: false, parity: 'unsupported', requested: false },
      { mode: 'smooth', supported: false, parity: 'unsupported', requested: false },
    ]);
    expect(descriptor.session.controls.faceAware).toEqual({
      supported: false,
      parity: 'unsupported',
      requested: true,
    });
    expect(descriptor.session.controls.nonDestructiveMesh).toEqual({
      supported: false,
      parity: 'unsupported',
      requested: false,
    });
  });

  it('builds discoverable control metadata for unsupported liquify modes and mesh flags', () => {
    const descriptor = buildLiquifySessionDescriptor({
      mode: 'pucker',
      center: { x: 5, y: 10 },
      radius: 18,
      strength: 1.2,
      falloff: 'quadratic',
      previewScale: 0.5,
      mask: {
        width: 2,
        height: 1,
        freeze: new Uint8ClampedArray([255, 0]),
      },
    }, {
      documentId: 'doc-discover',
      layerId: 'layer-discover',
      requestedModes: ['reconstruct', 'smooth'],
      requestedFaceAware: true,
      requestedNonDestructiveMesh: true,
    });

    expect(descriptor.id).toBe('liquify-session-doc-discover-layer-discover-pucker');
    expect(descriptor.warnings).toEqual<ImageLiquifyPlanningWarning[]>([
      'unsupported-face-aware-liquify',
      'unsupported-reconstruct-liquify',
      'unsupported-smooth-liquify',
      'unsupported-non-destructive-mesh',
    ]);
    expect(descriptor.controls).toEqual({
      modes: [
        { mode: 'push', supported: true, parity: 'basic', requested: false },
        { mode: 'twirl', supported: true, parity: 'basic', requested: false },
        { mode: 'pucker', supported: true, parity: 'basic', requested: true },
        { mode: 'bloat', supported: true, parity: 'basic', requested: false },
        { mode: 'reconstruct', supported: false, parity: 'unsupported', requested: true },
        { mode: 'smooth', supported: false, parity: 'unsupported', requested: true },
      ],
      faceAware: {
        supported: false,
        parity: 'unsupported',
        requested: true,
      },
      nonDestructiveMesh: {
        supported: false,
        parity: 'unsupported',
        requested: true,
      },
      freezeThaw: {
        freezeMaskReady: true,
        thawMaskReady: false,
        frozenPixelCount: 1,
        thawedPixelCount: 0,
        effectiveFrozenPixelCount: 1,
        overlayPreviewSupported: true,
        limitation: 'freeze-thaw-mask-controls-are-descriptor-backed',
      },
      sourcePreservation: {
        preserveSmartObjectsRequested: false,
        smartObjectFilterSupported: false,
        sourceLinkedOriginalPreserved: true,
        outputRequiresDerivedBitmap: true,
        limitation: 'smart-source-warning-only-no-live-smart-filter',
      },
    });
    expect(descriptor.preview).toEqual({
      id: 'liquify-doc-discover-layer-discover-pucker',
      signature: 'liquify:doc-discover:layer-discover:pucker:5,10:18:1:quadratic:0.5:2x1:1:0',
      bounds: { x: -13, y: -8, width: 36, height: 36 },
      scale: 0.5,
    });
  });

  it('describes local deformation readiness, Photoshop gaps, and handoff safety without claiming nondestructive mesh parity', () => {
    const descriptor = describeLiquifyReadiness({
      documentId: 'doc-ready',
      layerId: 'layer-ready',
      preserveSmartObjects: true,
      requestedModes: ['push', 'reconstruct', 'smooth'],
      requestedFaceAware: true,
      requestedNonDestructiveMesh: true,
      mask: {
        width: 3,
        height: 1,
        freeze: new Uint8ClampedArray([255, 0, 255]),
        thaw: new Uint8ClampedArray([0, 255, 0]),
      },
    });

    expect(descriptor.supportedLocalDeformations).toEqual(['push', 'twirl', 'pucker', 'bloat']);
    expect(descriptor.sessionState).toEqual({
      type: 'bitmap-preview-session',
      destructiveApply: true,
      previewBeforeCommit: true,
      undoSnapshotRequired: true,
    });
    expect(descriptor.controlState).toMatchObject({
      brushRadius: true,
      strength: true,
      falloff: ['quadratic', 'linear', 'constant'],
      faceAware: false,
      reconstruct: false,
      smooth: false,
    });
    expect(descriptor.freezeThaw).toEqual({
      supported: true,
      freezeMaskSupported: true,
      thawMaskSupported: true,
      frozenPixelCount: 2,
      thawedPixelCount: 1,
      limitation: 'mask-guided-local-brush-protection-only',
    });
    expect(descriptor.unsupportedPhotoshopEquivalentStates).toEqual([
      'face-aware-liquify',
      'reconstruct-tool',
      'smooth-tool',
      'editable-liquify-mesh',
      'smart-object-liquify-filter',
    ]);
    expect(descriptor.smartSourceCaveats).toEqual([
      'smart-object-preservation-is-metadata-only',
      'source-linked-layer-must-be-exported-as-derived-bitmap',
    ]);
    expect(descriptor.nonDestructiveLimitations).toEqual([
      'liquify-commits-pixels-on-apply',
      'no-reopenable-liquify-mesh-state',
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
      caveats: ['requires-fixed-brush-center-radius-strength-and-mask', 'not-suitable-for-face-aware-automatic-batch-liquify'],
    });
    expect(descriptor.readinessSignature).toBe(
      'liquify-readiness:doc-ready:layer-ready:push|reconstruct|smooth:face-aware:mesh:smart:3x1:2:1',
    );
  });

  it('adds per-mode, freeze-thaw, and workspace readiness descriptors with deterministic preview/export signatures', () => {
    const descriptor = describeLiquifyReadiness({
      documentId: 'doc-liquify-advanced',
      layerId: 'layer-liquify-advanced',
      requestedModes: ['push', 'twirl', 'pucker', 'bloat'],
      mask: {
        width: 4,
        height: 2,
        freeze: new Uint8ClampedArray([255, 255, 0, 0, 0, 0, 255, 0]),
        thaw: new Uint8ClampedArray([0, 255, 0, 0, 255, 0, 0, 0]),
      },
    });

    expect(descriptor.modeReadiness).toEqual([
      {
        mode: 'push',
        ready: true,
        actionSuitable: true,
        batchSuitable: true,
        exportSafe: true,
        limitation: 'brush-local-bitmap-deformation-only',
        previewSignature: 'liquify-mode-preview:v1:doc-liquify-advanced:layer-liquify-advanced:push',
      },
      {
        mode: 'twirl',
        ready: true,
        actionSuitable: true,
        batchSuitable: true,
        exportSafe: true,
        limitation: 'brush-local-bitmap-deformation-only',
        previewSignature: 'liquify-mode-preview:v1:doc-liquify-advanced:layer-liquify-advanced:twirl',
      },
      {
        mode: 'pucker',
        ready: true,
        actionSuitable: true,
        batchSuitable: true,
        exportSafe: true,
        limitation: 'brush-local-bitmap-deformation-only',
        previewSignature: 'liquify-mode-preview:v1:doc-liquify-advanced:layer-liquify-advanced:pucker',
      },
      {
        mode: 'bloat',
        ready: true,
        actionSuitable: true,
        batchSuitable: true,
        exportSafe: true,
        limitation: 'brush-local-bitmap-deformation-only',
        previewSignature: 'liquify-mode-preview:v1:doc-liquify-advanced:layer-liquify-advanced:bloat',
      },
    ]);
    expect(descriptor.freezeThawReadiness).toEqual({
      ready: true,
      frozenPixelCount: 3,
      thawedPixelCount: 2,
      actionSuitable: true,
      batchSuitable: true,
      exportSafe: true,
      previewSignature: 'liquify-freeze-thaw-preview:v1:doc-liquify-advanced:layer-liquify-advanced:4x2:3:2',
      exportSignature: 'liquify-freeze-thaw-export:v1:doc-liquify-advanced:layer-liquify-advanced:derived-bitmap',
      limitation: 'mask-guided-local-brush-protection-only',
    });
    expect(descriptor.previewExportSignatures).toEqual({
      preview: 'liquify-readiness-preview:v1:doc-liquify-advanced:layer-liquify-advanced:push|twirl|pucker|bloat:4x2:3:2',
      export: 'liquify-readiness-export:v1:doc-liquify-advanced:layer-liquify-advanced:derived-bitmap',
    });
    expect(descriptor.workspace).toEqual({
      fullyInteractive: false,
      brushPreviewSupported: true,
      beforeAfterSplitViewSupported: false,
      reopenableMeshWorkspaceSupported: false,
      limitation: 'descriptor-only-session-not-live-deformation-workspace',
      unsupportedFeatures: [
        'interactive-deformation-mesh',
        'reopenable-before-after-workspace',
        'face-aware-overlay-controls',
      ],
    });
  });

  it('builds a mounted Liquify workspace UI descriptor with real controls and apply/cancel commands', () => {
    const descriptor = buildLiquifyWorkspaceUiDescriptor({
      mode: 'bloat',
      center: { x: 14, y: 10 },
      radius: 18,
      strength: 0.7,
      falloff: 'linear',
      previewScale: 0.5,
      mask: {
        width: 3,
        height: 2,
        freeze: new Uint8ClampedArray([255, 0, 0, 0, 255, 0]),
      },
    }, {
      documentId: 'doc-ui',
      layerId: 'layer-ui',
      sourceKind: 'bitmap-layer',
      hasActivePixelLayer: true,
      hasPreviewSession: true,
      requestedModes: ['bloat', 'reconstruct'],
      requestedFaceAware: true,
      preserveSmartObjects: true,
    });

    expect(descriptor).toMatchObject({
      mounted: true,
      workspaceKind: 'dockable-liquify-panel',
      modeControls: [
        { mode: 'push', supported: true, visible: true },
        { mode: 'twirl', supported: true, visible: true },
        { mode: 'pucker', supported: true, visible: true },
        { mode: 'bloat', supported: true, visible: true },
      ],
      brushControls: {
        radius: { value: 18, min: 1, max: 400 },
        strength: { value: 0.7, min: -1, max: 1 },
        falloff: { value: 'linear', options: ['quadratic', 'linear', 'constant'] },
      },
      freezeThawControls: {
        freezeMaskReady: true,
        thawMaskReady: false,
        effectiveFrozenPixelCount: 2,
      },
      commands: {
        preview: { enabled: true },
        apply: { enabled: true, destructiveCommit: true },
        cancel: { enabled: true },
      },
      unsupportedControls: [
        { feature: 'face-aware', supported: false },
        { feature: 'reconstruct', supported: false },
        { feature: 'smart-filter', supported: false },
      ],
    });
    expect(descriptor.preview.signature).toBe('liquify:doc-ui:layer-ui:bloat:14,10:18:0.7:linear:0.5:3x2:2:0');
    expect(descriptor.signature).toBe(
      'liquify-workspace-ui:v1:doc-ui:layer-ui:bloat:14,10:18:0.7:linear:bitmap-layer:preview-ready:apply-ready:freeze=2:unsupported=face-aware|reconstruct|smart-filter',
    );
  });

  it('surfaces control, mask, unsupported-state, source, and on-canvas readiness details without claiming a full workspace', () => {
    const mask = {
      width: 4,
      height: 1,
      freeze: new Uint8ClampedArray([255, 255, 0, 0]),
      thaw: new Uint8ClampedArray([0, 255, 255, 0]),
    };
    const session = buildLiquifySessionDescriptor({
      mode: 'push',
      center: { x: 8, y: 6 },
      radius: 12,
      strength: 0.6,
      mask,
    }, {
      documentId: 'doc-readiness-detail',
      layerId: 'layer-readiness-detail',
      preserveSmartObjects: true,
      requestedModes: ['reconstruct', 'smooth'],
      requestedNonDestructiveMesh: true,
    });

    expect(session.controls).toMatchObject({
      freezeThaw: {
        freezeMaskReady: true,
        thawMaskReady: true,
        frozenPixelCount: 2,
        thawedPixelCount: 2,
        effectiveFrozenPixelCount: 1,
        overlayPreviewSupported: true,
        limitation: 'freeze-thaw-mask-controls-are-descriptor-backed',
      },
      sourcePreservation: {
        preserveSmartObjectsRequested: true,
        smartObjectFilterSupported: false,
        sourceLinkedOriginalPreserved: true,
        outputRequiresDerivedBitmap: true,
        limitation: 'smart-source-warning-only-no-live-smart-filter',
      },
    });

    const descriptor = describeLiquifyReadiness({
      documentId: 'doc-readiness-detail',
      layerId: 'layer-readiness-detail',
      mask,
      preserveSmartObjects: true,
      requestedModes: ['reconstruct', 'smooth'],
      requestedNonDestructiveMesh: true,
    });

    expect(descriptor).toMatchObject({
      freezeThawMaskReadiness: {
        ready: true,
        maskDimensions: '4x1',
        freezeMaskReady: true,
        thawMaskReady: true,
        frozenPixelCount: 2,
        thawedPixelCount: 2,
        effectiveFrozenPixelCount: 1,
        overlayPreviewReady: true,
        limitation: 'freeze-thaw-overlay-preview-with-bitmap-commit-only',
      },
      unsupportedControlReadiness: [
        {
          mode: 'reconstruct',
          requested: true,
          supported: false,
          ready: false,
          warning: 'unsupported-reconstruct-liquify',
          fallback: 'history-snapshot-or-duplicate-layer-before-apply',
          previewSignature: 'liquify-unsupported-control:v1:doc-readiness-detail:layer-readiness-detail:reconstruct',
        },
        {
          mode: 'smooth',
          requested: true,
          supported: false,
          ready: false,
          warning: 'unsupported-smooth-liquify',
          fallback: 'history-snapshot-or-duplicate-layer-before-apply',
          previewSignature: 'liquify-unsupported-control:v1:doc-readiness-detail:layer-readiness-detail:smooth',
        },
      ],
      sourcePreservationReadiness: {
        preserveSmartObjectsRequested: true,
        smartObjectFilterSupported: false,
        sourceLinkedOriginalPreserved: true,
        outputRequiresDerivedBitmap: true,
        warnings: [
          'unsupported-smart-object-preservation',
          'source-linked-layer-must-be-exported-as-derived-bitmap',
        ],
        caveat: 'smart-source-is-not-mutated-but-liquify-output-is-a-derived-bitmap',
      },
      onCanvasWorkspaceReadiness: {
        ready: false,
        descriptorOnly: true,
        brushBoundsReady: true,
        freezeOverlayReady: true,
        thawOverlayReady: true,
        interactiveMeshReady: false,
        beforeAfterPreviewReady: false,
        limitation: 'on-canvas-descriptors-only-no-mounted-liquify-workspace',
        signature:
          'liquify-canvas-readiness:v1:doc-readiness-detail:layer-readiness-detail:4x1:1:2:reconstruct|smooth:smart',
      },
    });
  });

  it('builds a detailed mode support matrix that separates supported brush, mask, recovery, face, and smart-filter states', () => {
    const matrix = buildLiquifyModeSupportMatrix({
      documentId: 'doc-matrix',
      layerId: 'layer-matrix',
      requestedModes: ['push', 'reconstruct', 'smooth'],
      requestedFaceAware: true,
      requestedNonDestructiveMesh: true,
      preserveSmartObjects: true,
      mask: {
        width: 3,
        height: 2,
        freeze: new Uint8ClampedArray([255, 0, 255, 0, 0, 0]),
        thaw: new Uint8ClampedArray([0, 255, 0, 0, 0, 255]),
      },
    });

    expect(matrix.mask).toEqual({
      dimensions: '3x2',
      freezeMaskReady: true,
      thawMaskReady: true,
      frozenPixelCount: 2,
      thawedPixelCount: 2,
      effectiveFrozenPixelCount: 2,
    });
    expect(matrix.entries).toEqual([
      {
        mode: 'push',
        category: 'deformation',
        supported: true,
        ready: true,
        requested: true,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'bitmap-deformation-preview',
        outputKind: 'derived-bitmap',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:push:supported:requested',
      },
      {
        mode: 'twirl',
        category: 'deformation',
        supported: true,
        ready: true,
        requested: false,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'bitmap-deformation-preview',
        outputKind: 'derived-bitmap',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:twirl:supported:available',
      },
      {
        mode: 'pucker',
        category: 'deformation',
        supported: true,
        ready: true,
        requested: false,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'bitmap-deformation-preview',
        outputKind: 'derived-bitmap',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:pucker:supported:available',
      },
      {
        mode: 'bloat',
        category: 'deformation',
        supported: true,
        ready: true,
        requested: false,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'bitmap-deformation-preview',
        outputKind: 'derived-bitmap',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:bloat:supported:available',
      },
      {
        mode: 'freeze-mask',
        category: 'mask',
        supported: true,
        ready: true,
        requested: true,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'freeze-thaw-overlay',
        outputKind: 'mask-overlay',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:freeze-mask:supported:requested',
      },
      {
        mode: 'thaw-mask',
        category: 'mask',
        supported: true,
        ready: true,
        requested: true,
        actionSuitable: true,
        batchSuitable: true,
        previewKind: 'freeze-thaw-overlay',
        outputKind: 'mask-overlay',
        blocker: null,
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:thaw-mask:supported:requested',
      },
      {
        mode: 'reconstruct',
        category: 'recovery',
        supported: false,
        ready: false,
        requested: true,
        actionSuitable: false,
        batchSuitable: false,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: {
          code: 'unsupported-reconstruct-liquify',
          fallback: 'history-snapshot-or-cancel-preview',
          signature: 'liquify-blocker:v1:doc-matrix:layer-matrix:reconstruct:unsupported-reconstruct-liquify',
        },
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:reconstruct:blocked:requested',
      },
      {
        mode: 'smooth',
        category: 'recovery',
        supported: false,
        ready: false,
        requested: true,
        actionSuitable: false,
        batchSuitable: false,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: {
          code: 'unsupported-smooth-liquify',
          fallback: 'history-snapshot-or-cancel-preview',
          signature: 'liquify-blocker:v1:doc-matrix:layer-matrix:smooth:unsupported-smooth-liquify',
        },
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:smooth:blocked:requested',
      },
      {
        mode: 'face-aware',
        category: 'face',
        supported: false,
        ready: false,
        requested: true,
        actionSuitable: false,
        batchSuitable: false,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: {
          code: 'unsupported-face-aware-liquify',
          fallback: 'manual-brush-liquify',
          signature: 'liquify-blocker:v1:doc-matrix:layer-matrix:face-aware:unsupported-face-aware-liquify',
        },
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:face-aware:blocked:requested',
      },
      {
        mode: 'smart-filter',
        category: 'non-destructive',
        supported: false,
        ready: false,
        requested: true,
        actionSuitable: false,
        batchSuitable: false,
        previewKind: 'unsupported-control',
        outputKind: 'unsupported',
        blocker: {
          code: 'unsupported-smart-filter-liquify',
          fallback: 'duplicate-layer-or-source-linked-derived-bitmap',
          signature: 'liquify-blocker:v1:doc-matrix:layer-matrix:smart-filter:unsupported-smart-filter-liquify',
        },
        signature: 'liquify-support:v1:doc-matrix:layer-matrix:smart-filter:blocked:requested',
      },
    ]);
    expect(matrix.unsupportedRequestedModes).toEqual(['reconstruct', 'smooth']);
    expect(matrix.unsupportedRequestedStates).toEqual([
      'reconstruct-tool',
      'smooth-tool',
      'face-aware-liquify',
      'editable-liquify-mesh',
      'smart-object-liquify-filter',
    ]);
    expect(matrix.signature).toBe(
      'liquify-support-matrix:v1:doc-matrix:layer-matrix:push|reconstruct|smooth:face-aware:mesh:smart:3x2:2:2:2',
    );
  });

  it('builds deterministic apply and cancel plans with source-linked safety metadata and unsupported-control blockers', () => {
    const mask = {
      width: 2,
      height: 2,
      freeze: new Uint8ClampedArray([255, 0, 0, 0]),
      thaw: new Uint8ClampedArray([0, 0, 255, 0]),
    };
    const plan = buildLiquifyApplyCancelPlan({
      mode: 'bloat',
      center: { x: 40, y: 30 },
      radius: 16,
      strength: 0.7,
      falloff: 'constant',
      previewScale: 0.5,
      mask,
    }, {
      documentId: 'doc-plan',
      layerId: 'layer-plan',
      sourceKind: 'smart-object-layer',
      preserveSmartObjects: true,
      requestedModes: ['reconstruct'],
      requestedFaceAware: true,
      requestedNonDestructiveMesh: true,
      hasActivePixelLayer: true,
      hasPreviewSession: true,
    });

    expect(plan).toMatchObject({
      sessionId: 'liquify-session-doc-plan-layer-plan-bloat',
      previewSignature: 'liquify:doc-plan:layer-plan:bloat:40,30:16:0.7:constant:0.5:2x2:1:1',
      apply: {
        allowed: true,
        destructiveCommit: true,
        commandId: 'apply-liquify-doc-plan-layer-plan-bloat',
        signature: 'liquify-apply:v1:doc-plan:layer-plan:bloat:40,30:16:0.7:constant:2x2:1:1:smart-object-layer:derived-bitmap',
        undoSnapshotLabel: 'Before Liquify layer-plan',
        blockedBy: [],
      },
      cancel: {
        allowed: true,
        discardsPreview: true,
        restoresSourcePixels: true,
        signature: 'liquify-cancel:v1:doc-plan:layer-plan:bloat:40,30:16:0.7:constant:2x2:1:1',
      },
      sourceSafety: {
        sourceKind: 'smart-object-layer',
        originalMutation: 'preserve-source-reference',
        commitTarget: 'derived-bitmap-layer',
        nonDestructive: false,
        smartFilterSupported: false,
        sourceLinkedOriginalPreserved: true,
        warnings: [
          'unsupported-smart-object-preservation',
          'smart-object-preservation-is-metadata-only',
          'source-linked-layer-must-be-exported-as-derived-bitmap',
        ],
        signature: 'liquify-source-safety:v1:doc-plan:layer-plan:smart-object-layer:derived-bitmap:smart-filter-unsupported',
      },
    });
    expect(plan.unsupportedRequests).toEqual([
      {
        feature: 'reconstruct',
        code: 'unsupported-reconstruct-liquify',
        fallback: 'history-snapshot-or-cancel-preview',
        signature: 'liquify-blocker:v1:doc-plan:layer-plan:reconstruct:unsupported-reconstruct-liquify',
      },
      {
        feature: 'face-aware',
        code: 'unsupported-face-aware-liquify',
        fallback: 'manual-brush-liquify',
        signature: 'liquify-blocker:v1:doc-plan:layer-plan:face-aware:unsupported-face-aware-liquify',
      },
      {
        feature: 'non-destructive-mesh',
        code: 'unsupported-non-destructive-mesh',
        fallback: 'snapshot-or-derived-bitmap-apply',
        signature: 'liquify-blocker:v1:doc-plan:layer-plan:non-destructive-mesh:unsupported-non-destructive-mesh',
      },
      {
        feature: 'smart-filter',
        code: 'unsupported-smart-filter-liquify',
        fallback: 'duplicate-layer-or-source-linked-derived-bitmap',
        signature: 'liquify-blocker:v1:doc-plan:layer-plan:smart-filter:unsupported-smart-filter-liquify',
      },
    ]);

    const blockedPlan = buildLiquifyApplyCancelPlan({
      mode: 'push',
      center: { x: 4, y: 5 },
      radius: 8,
      strength: 1,
    }, {
      documentId: 'doc-blocked',
      layerId: 'layer-blocked',
      hasActivePixelLayer: false,
      hasPreviewSession: false,
    });

    expect(blockedPlan.apply).toMatchObject({
      allowed: false,
      blockedBy: [
        {
          code: 'missing-active-pixel-layer',
          fallback: 'select-a-pixel-layer-or-duplicate-visible',
          signature: 'liquify-blocker:v1:doc-blocked:layer-blocked:apply:missing-active-pixel-layer',
        },
        {
          code: 'missing-liquify-preview-session',
          fallback: 'build-preview-session-before-apply',
          signature: 'liquify-blocker:v1:doc-blocked:layer-blocked:apply:missing-liquify-preview-session',
        },
      ],
    });
  });

  it('bundles liquify readiness into an inspectable lane descriptor with stable session, source, and preview signatures', () => {
    const descriptor = buildLiquifyDeformationReadinessDescriptor({
      mode: 'push',
      center: { x: 6, y: 8 },
      radius: 10,
      strength: 0.5,
      mask: {
        width: 3,
        height: 1,
        freeze: new Uint8ClampedArray([255, 0, 0]),
      },
    }, {
      documentId: 'doc-lane',
      layerId: 'layer-lane',
      sourceKind: 'source-linked-layer',
      requestedModes: ['reconstruct', 'smooth'],
      requestedFaceAware: true,
      requestedNonDestructiveMesh: true,
      preserveSmartObjects: true,
      hasActivePixelLayer: true,
      hasPreviewSession: true,
    });

    expect(descriptor.lane).toBe('image-deformation-liquify');
    expect(descriptor.session).toEqual({
      id: 'liquify-session-doc-lane-layer-lane-push',
      previewId: 'liquify-doc-lane-layer-lane-push',
      previewSignature: 'liquify:doc-lane:layer-lane:push:6,8:10:0.5:quadratic:1:3x1:1:0',
      applySignature: 'liquify-apply:v1:doc-lane:layer-lane:push:6,8:10:0.5:quadratic:3x1:1:0:source-linked-layer:derived-bitmap',
      cancelSignature: 'liquify-cancel:v1:doc-lane:layer-lane:push:6,8:10:0.5:quadratic:3x1:1:0',
    });
    expect(descriptor.sourceSafety).toMatchObject({
      sourceKind: 'source-linked-layer',
      commitTarget: 'derived-bitmap-layer',
      signature: 'liquify-source-safety:v1:doc-lane:layer-lane:source-linked-layer:derived-bitmap:smart-filter-unsupported',
    });
    expect(descriptor.unsupportedStates).toEqual([
      {
        feature: 'face-aware',
        supported: false,
        requested: true,
        state: 'face-aware-liquify',
        fallback: 'manual-brush-liquify',
        signature: 'liquify-unsupported:v1:doc-lane:layer-lane:face-aware',
      },
      {
        feature: 'reconstruct',
        supported: false,
        requested: true,
        state: 'reconstruct-tool',
        fallback: 'history-snapshot-or-cancel-preview',
        signature: 'liquify-unsupported:v1:doc-lane:layer-lane:reconstruct',
      },
      {
        feature: 'smooth',
        supported: false,
        requested: true,
        state: 'smooth-tool',
        fallback: 'history-snapshot-or-cancel-preview',
        signature: 'liquify-unsupported:v1:doc-lane:layer-lane:smooth',
      },
      {
        feature: 'non-destructive-mesh',
        supported: false,
        requested: true,
        state: 'editable-liquify-mesh',
        fallback: 'snapshot-or-derived-bitmap-apply',
        signature: 'liquify-unsupported:v1:doc-lane:layer-lane:non-destructive-mesh',
      },
      {
        feature: 'smart-filter',
        supported: false,
        requested: true,
        state: 'smart-object-liquify-filter',
        fallback: 'duplicate-layer-or-source-linked-derived-bitmap',
        signature: 'liquify-unsupported:v1:doc-lane:layer-lane:smart-filter',
      },
    ]);
    expect(descriptor.signature).toBe(
      'liquify-lane:v1:doc-lane:layer-lane:liquify:doc-lane:layer-lane:push:6,8:10:0.5:quadratic:1:3x1:1:0:source-linked-layer:derived-bitmap-layer:face-aware|reconstruct|smooth|non-destructive-mesh|smart-filter',
    );
  });
});
