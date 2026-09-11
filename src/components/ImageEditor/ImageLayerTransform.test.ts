import { describe, expect, it } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  buildImageLayerTransformReadiness,
  describeImageLayerTransformCapabilities,
  getImageLayerBitmapDrawMetrics,
  getImageLayerBitmapTransformedBounds,
} from './ImageLayerTransform';

function bitmap(width: number, height: number): LayerBitmap {
  return { width, height } as LayerBitmap;
}

function layer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 24,
    y: 32,
    bitmap: bitmap(180, 120),
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

describe('ImageLayerTransform', () => {
  it('maps a custom pivot into source-space draw metrics even when effects shift the rendered bitmap', () => {
    expect(
      getImageLayerBitmapDrawMetrics(bitmap(220, 150), layer({
        transformOriginX: 0,
        transformOriginY: 0.5,
      }), -10, 8),
    ).toMatchObject({
      drawLeft: 14,
      drawTop: 40,
      drawWidth: 220,
      drawHeight: 150,
      pivotDocX: 24,
      pivotDocY: 92,
      sourcePivotX: 10,
      sourcePivotY: 52,
      originX: 0,
      originY: 0.5,
      rotationDeg: 0,
    });
  });

  it('expands transformed bounds for skewed bitmap layers', () => {
    expect(
      getImageLayerBitmapTransformedBounds(bitmap(160, 90), layer({
        x: 12,
        y: 24,
        bitmap: bitmap(160, 90),
        skewXDeg: 45,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      })),
    ).toEqual({
      left: -33,
      top: 24,
      width: 250,
      height: 90,
    });
  });

  it('expands transformed bounds for distorted bitmap layers', () => {
    expect(
      getImageLayerBitmapTransformedBounds(bitmap(160, 90), layer({
        x: 12,
        y: 24,
        bitmap: bitmap(160, 90),
        cornerOffsets: {
          nw: { x: -4, y: -2 },
          ne: { x: 8, y: -1 },
          se: { x: 12, y: 5 },
          sw: { x: -6, y: 4 },
        },
      })),
    ).toEqual({
      left: 6,
      top: 22,
      width: 178,
      height: 97,
    });
  });

  it('expands transformed bounds for perspective bitmap layers', () => {
    expect(
      getImageLayerBitmapTransformedBounds(bitmap(160, 90), layer({
        x: 12,
        y: 24,
        bitmap: bitmap(160, 90),
        perspectiveX: 0.25,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      })),
    ).toEqual({
      left: -8,
      top: 24,
      width: 200,
      height: 90,
    });
  });

  it('expands transformed bounds for warped bitmap layers', () => {
    expect(
      getImageLayerBitmapTransformedBounds(bitmap(160, 90), layer({
        x: 12,
        y: 24,
        bitmap: bitmap(160, 90),
        warp: {
          top: 0.25,
          right: 0,
          bottom: 0,
          left: 0,
        },
        transformOriginX: 0.5,
        transformOriginY: 0.5,
      })),
    ).toEqual({
      left: 12,
      top: 12,
      width: 160,
      height: 102,
    });
  });

  it('builds deterministic capability metadata for supported transform helpers', () => {
    const descriptor = describeImageLayerTransformCapabilities(layer({
      rotationDeg: 725,
      skewXDeg: 82,
      skewYDeg: -12.345,
      perspectiveX: 1.5,
      perspectiveY: -0.3333,
      transformOriginX: 1.25,
      transformOriginY: -0.25,
      metadata: {
        sourceLink: {
          id: 'source-1',
          label: 'Linked smart source',
          status: 'linked',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>), {
      requireSmartSourceSafe: true,
      requireNonDestructive: true,
    });

    expect(descriptor.layerId).toBe('layer-1');
    expect(descriptor.sourceKind).toBe('bitmap');
    expect(descriptor.sourceDimensions).toEqual({ width: 180, height: 120 });
    expect(descriptor.capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      nonDestructive: capability.nonDestructive,
      undoOperation: capability.undoOperation,
      previewKind: capability.previewKind,
      handleCount: capability.handleCount,
    }))).toEqual([
      { kind: 'move', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'metadata', handleCount: 0 },
      { kind: 'scale', supported: true, nonDestructive: false, undoOperation: 'layerOp', previewKind: 'raster-resample', handleCount: 8 },
      { kind: 'rotate', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'metadata', handleCount: 1 },
      { kind: 'skew', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'metadata', handleCount: 4 },
      { kind: 'distort', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'metadata', handleCount: 4 },
      { kind: 'perspective', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'metadata', handleCount: 4 },
      { kind: 'warp', supported: true, nonDestructive: true, undoOperation: 'transform', previewKind: 'mesh', handleCount: 4 },
    ]);
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-smart-source-safe-transform',
      'destructive-scale-rasterization',
    ]);
    expect(descriptor.capabilities.find((capability) => capability.kind === 'scale')?.warnings.map((warning) => warning.code))
      .toEqual(['destructive-scale-rasterization']);
    expect(descriptor.previewSignature).toBe(
      'layer-transform-capabilities:v1:{"layerId":"layer-1","layerType":"image","sourceKind":"bitmap","sourceDimensions":{"width":180,"height":120},"transform":{"x":24,"y":32,"rotationDeg":5,"skewXDeg":75,"skewYDeg":-12.34,"perspectiveX":0.95,"perspectiveY":-0.333,"warp":{"top":0,"right":0,"bottom":0,"left":0},"cornerOffsets":{"nw":{"x":0,"y":0},"ne":{"x":0,"y":0},"se":{"x":0,"y":0},"sw":{"x":0,"y":0}},"transformOriginX":1,"transformOriginY":0},"capabilities":[{"kind":"move","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"metadata"},{"kind":"scale","supported":true,"nonDestructive":false,"undoOperation":"layerOp","previewKind":"raster-resample"},{"kind":"rotate","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"metadata"},{"kind":"skew","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"metadata"},{"kind":"distort","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"metadata"},{"kind":"perspective","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"metadata"},{"kind":"warp","supported":true,"nonDestructive":true,"undoOperation":"transform","previewKind":"mesh"}],"warnings":["unsupported-smart-source-safe-transform","destructive-scale-rasterization"]}',
    );
  });

  it('describes smart-source-safe limitations, support matrix, preview ids, and export caveats', () => {
    const descriptor = describeImageLayerTransformCapabilities(layer({
      metadata: {
        smartLinkedSourceId: 'smart-1',
        sourceLabel: 'Catalog source',
        sourceFormat: 'psd',
      },
    } as Partial<ImageLayer>), {
      requireSmartSourceSafe: true,
      requireNonDestructive: true,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-layer-transform-capabilities:v2',
      preview: {
        id: 'image-layer-transform-capabilities:layer-1',
        signature: descriptor.previewSignature,
      },
      sourceLink: {
        linked: true,
        smartSourceLike: true,
        sourceId: 'smart-1',
        label: 'Catalog source',
        status: 'linked',
        smartSourceSafe: false,
      },
      supportMatrix: {
        pivot: { supported: true, commitModel: 'metadata' },
        skew: { supported: true, commitModel: 'metadata' },
        distort: { supported: true, commitModel: 'metadata' },
        perspective: { supported: true, commitModel: 'metadata' },
        warp: { supported: true, commitModel: 'metadata' },
      },
      transformStatus: {
        destructive: false,
        nonDestructive: true,
        destructiveCapabilities: ['scale'],
        metadataOnlyCapabilities: ['move', 'rotate', 'skew', 'distort', 'perspective', 'warp'],
      },
      exportCaveats: [
        {
          code: 'export-rasterizes-transform-preview',
          severity: 'warning',
          message: 'Export and flattened compositing rasterize the current transform preview; retained smart transform instructions are not embedded.',
        },
        {
          code: 'source-link-retained-transform-not-smart-object',
          severity: 'warning',
          message: 'Source-link metadata is retained for relinking context, but transforms are stored on the Sloom Studio layer rather than as editable Smart Object transforms.',
        },
      ],
    });
    expect(descriptor.capabilities.find((capability) => capability.kind === 'scale')).toMatchObject({
      transformStatus: {
        destructive: true,
        nonDestructive: false,
        rasterizesOnApply: true,
        commitModel: 'rasterize-layer-operation',
      },
      sourceSafety: {
        smartSourceSafe: false,
        limitationCodes: [
          'smart-source-transform-not-retained',
          'scale-commits-raster-resample',
        ],
      },
    });
  });

  it('builds deterministic free-transform readiness with numeric controls and apply preview state', () => {
    const descriptor = buildImageLayerTransformReadiness(layer({
      rotationDeg: 47.125,
      skewXDeg: 8.333,
      skewYDeg: -4.444,
      perspectiveX: 0.1255,
      perspectiveY: -0.2222,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
      cornerOffsets: {
        nw: { x: -2.234, y: 1.111 },
        ne: { x: 3.556, y: -1.333 },
        se: { x: 4.444, y: 2.222 },
        sw: { x: -3.333, y: 1.777 },
      },
      warp: {
        top: 0.12345,
        right: -0.23456,
        bottom: 0.34567,
        left: -0.45678,
      },
    }));

    expect(descriptor.descriptorId).toBe('image-layer-transform-readiness:v1');
    expect(descriptor.modeSummary).toEqual([
      { mode: 'move', ready: true, previewKind: 'metadata', numericControls: ['x', 'y'] },
      { mode: 'resize', ready: true, previewKind: 'raster-resample', numericControls: ['width', 'height'] },
      { mode: 'rotate', ready: true, previewKind: 'metadata', numericControls: ['rotationDeg', 'transformOriginX', 'transformOriginY'] },
      { mode: 'pivot', ready: true, previewKind: 'metadata', numericControls: ['transformOriginX', 'transformOriginY'] },
      { mode: 'skew', ready: true, previewKind: 'metadata', numericControls: ['skewXDeg', 'skewYDeg'] },
      { mode: 'distort', ready: true, previewKind: 'metadata', numericControls: ['cornerOffsets'] },
      { mode: 'perspective', ready: true, previewKind: 'metadata', numericControls: ['perspectiveX', 'perspectiveY'] },
      { mode: 'warp', ready: true, previewKind: 'mesh', numericControls: ['warp.top', 'warp.right', 'warp.bottom', 'warp.left'] },
    ]);
    expect(descriptor.previewState).toMatchObject({
      active: true,
      applyReady: true,
      cancelReady: true,
      commitModel: 'mixed-metadata-and-rasterize',
      previewSignature: descriptor.preview.signature,
    });
    expect(descriptor.normalizedTransform).toMatchObject({
      x: 24,
      y: 32,
      rotationDeg: 47.13,
      skewXDeg: 8.33,
      skewYDeg: -4.44,
      perspectiveX: 0.126,
      perspectiveY: -0.222,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
    });
    expect(descriptor.numericControls.find((control) => control.id === 'warp.top')).toMatchObject({
      available: true,
      value: 0.123,
      min: -1,
      max: 1,
      step: 0.001,
    });
    expect(descriptor.blockers).toEqual([]);
    expect(descriptor.preview.signature).toContain('"rotationDeg":47.13');
  });

  it('adds FT1 geometry, pivot, handle, support, and source-safety readiness metadata', () => {
    const descriptor = buildImageLayerTransformReadiness(layer({
      rotationDeg: 15,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
      metadata: {
        sourceLink: {
          id: 'source-1',
          label: 'Linked source',
          status: 'linked',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>));

    expect(descriptor.geometry).toEqual({
      x: 24,
      y: 32,
      width: 180,
      height: 120,
      centerX: 114,
      centerY: 92,
      pivotX: 69,
      pivotY: 122,
    });
    expect(descriptor.pivot).toEqual({
      originX: 0.25,
      originY: 0.75,
      sourceX: 45,
      sourceY: 90,
      docX: 69,
      docY: 122,
      signature: 'layer-transform-pivot:v1|layer-1|origin=0.25,0.75|source=45,90|doc=69,122',
    });
    expect(descriptor.previewSession).toEqual({
      sessionType: 'layer-transform',
      active: true,
      applyReady: true,
      cancelReady: true,
      applyCommand: 'Enter',
      cancelCommand: 'Escape',
    });
    expect(descriptor.handles).toEqual([
      {
        id: 'rotate-handle',
        kind: 'rotate',
        mode: 'rotate',
        anchor: 'top-center-outside',
        visible: true,
        point: { x: 114, y: 8 },
        numericControls: ['rotationDeg', 'transformOriginX', 'transformOriginY'],
      },
      {
        id: 'pivot-handle',
        kind: 'pivot',
        mode: 'pivot',
        anchor: 'pivot-origin',
        visible: true,
        point: { x: 69, y: 122 },
        numericControls: ['transformOriginX', 'transformOriginY'],
      },
    ]);
    expect(descriptor.supportMatrix).toEqual({
      skew: { supported: true, previewKind: 'metadata', commitModel: 'metadata', numericControls: ['skewXDeg', 'skewYDeg'] },
      distort: { supported: true, previewKind: 'metadata', commitModel: 'metadata', numericControls: ['cornerOffsets'] },
      perspective: { supported: true, previewKind: 'metadata', commitModel: 'metadata', numericControls: ['perspectiveX', 'perspectiveY'] },
      warp: { supported: true, previewKind: 'mesh', commitModel: 'metadata', numericControls: ['warp.top', 'warp.right', 'warp.bottom', 'warp.left'] },
    });
    expect(descriptor.sourceSafety).toEqual({
      smartSourceSafe: false,
      caveats: [
        'smart-source-transform-not-retained',
        'scale-commits-raster-resample',
      ],
      smartObjectPreservation: 'metadata-only-not-native-smart-object',
      signature: 'layer-transform-source-safety:v1|smart=false|caveats=smart-source-transform-not-retained,scale-commits-raster-resample|smart-object=metadata-only-not-native-smart-object',
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-smart-source-safe-transform',
      'destructive-scale-rasterization',
      'export-rasterizes-transform-preview',
      'source-link-retained-transform-not-smart-object',
    ]);
    expect(descriptor.preview.signature).toBe(buildImageLayerTransformReadiness(layer({
      rotationDeg: 15,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
      metadata: {
        sourceLink: {
          id: 'source-1',
          label: 'Linked source',
          status: 'linked',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>)).preview.signature);
    expect(descriptor.preview.signature).toContain('"handles":["rotate-handle:114,8","pivot-handle:69,122"]');
  });

  it('summarizes source-linked smart-object and export caveats without claiming native parity', () => {
    const descriptor = buildImageLayerTransformReadiness(layer({
      metadata: {
        smartLinkedSourceId: 'smart-1',
        sourceLabel: 'Catalog panel',
        sourceFormat: 'psd',
        sourceLink: {
          id: 'smart-1',
          label: 'Catalog panel',
          width: 640,
          height: 480,
          status: 'missing',
          relinkHistory: [],
        },
      },
    }));

    expect(descriptor.sourceLinkedSummary).toEqual({
      linked: true,
      smartObjectParity: 'metadata-only',
      sourceId: 'smart-1',
      label: 'Catalog panel',
      status: 'missing',
      caveats: [
        'source-link-missing',
        'smart-object-transform-not-native',
        'smart-filters-not-retained',
      ],
    });
    expect(descriptor.exportCaveats.map((caveat) => caveat.code)).toEqual([
      'export-rasterizes-transform-preview',
      'source-link-retained-transform-not-smart-object',
    ]);
    expect(descriptor.blockers).toEqual(['source-link-missing']);
    expect(descriptor.previewState.applyReady).toBe(false);
  });

  it('blocks transform readiness for locked or empty layers with stable preview signatures', () => {
    const emptyLockedLayer = layer({
      bitmap: undefined,
      locked: true,
      locks: { position: true },
    });

    const descriptor = buildImageLayerTransformReadiness(emptyLockedLayer);

    expect(descriptor.modeSummary.every((mode) => mode.ready === false)).toBe(true);
    expect(descriptor.blockers).toEqual([
      'layer-locked',
      'position-locked',
      'missing-transform-source',
    ]);
    expect(descriptor.previewState).toMatchObject({
      active: false,
      applyReady: false,
      cancelReady: true,
    });
    expect(descriptor.preview.signature).toBe(buildImageLayerTransformReadiness(emptyLockedLayer).preview.signature);
  });

  it('adds advanced deformation readiness for perspective and warp with unsupported workspace states and stable signatures', () => {
    const descriptor = buildImageLayerTransformReadiness(layer({
      perspectiveX: 0.2,
      perspectiveY: -0.1,
      warp: {
        top: 0.15,
        right: -0.1,
        bottom: 0.05,
        left: 0,
      },
    }));

    expect(descriptor.advancedDeformation).toEqual({
      perspective: {
        supported: true,
        actionSuitable: true,
        batchSuitable: true,
        previewSignature: 'layer-transform-advanced-preview:v1:layer-1:perspective',
        exportSignature: 'layer-transform-advanced-export:v1:layer-1:perspective:flattened-render',
        unsupportedStates: ['split-plane-perspective-warp'],
      },
      warp: {
        supported: true,
        actionSuitable: true,
        batchSuitable: true,
        previewSignature: 'layer-transform-advanced-preview:v1:layer-1:warp',
        exportSignature: 'layer-transform-advanced-export:v1:layer-1:warp:flattened-render',
        unsupportedStates: ['photoshop-weighted-puppet-mesh'],
      },
      workspace: {
        fullyInteractive: true,
        limitation: 'single-plane-and-regular-cage-deformation-workspace',
        unsupportedStates: [
          'split-plane-perspective-warp',
          'photoshop-weighted-puppet-mesh',
        ],
      },
      previewExportSignatures: {
        preview: 'layer-transform-advanced-readiness-preview:v1:layer-1:perspective|warp',
        export: 'layer-transform-advanced-readiness-export:v1:layer-1:flattened-render',
      },
    });
  });

  it('exposes transform parity blockers and stable source/handle signatures', () => {
    const descriptor = buildImageLayerTransformReadiness(layer({
      rotationDeg: -18.5,
      transformOriginX: 0.2,
      transformOriginY: 0.4,
      metadata: {
        sourceLink: {
          id: 'source-1',
          label: 'Linked source',
          status: 'linked',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>));

    expect(descriptor.previewState).toMatchObject({
      active: true,
      applyReady: true,
      cancelReady: true,
      applySignature: 'layer-transform-apply:v1|layer-1|ready=true|commit=mixed-metadata-and-rasterize',
      cancelSignature: 'layer-transform-cancel:v1|layer-1|ready=true',
    });
    expect(descriptor.handleSignature).toBe(
      'layer-transform-handles:v1|layer-1|rotate-handle:114,8:visible=true|pivot-handle:60,80:visible=true',
    );
    expect(descriptor.pivot.signature).toBe(
      'layer-transform-pivot:v1|layer-1|origin=0.2,0.4|source=36,48|doc=60,80',
    );
    expect(descriptor.sourceSafety).toEqual({
      smartSourceSafe: false,
      caveats: [
        'smart-source-transform-not-retained',
        'scale-commits-raster-resample',
      ],
      smartObjectPreservation: 'metadata-only-not-native-smart-object',
      signature: 'layer-transform-source-safety:v1|smart=false|caveats=smart-source-transform-not-retained,scale-commits-raster-resample|smart-object=metadata-only-not-native-smart-object',
    });
    expect(descriptor.unsupportedModes).toEqual([
      {
        mode: 'skew',
        supported: true,
        parity: 'bounded-numeric-metadata',
        unsupportedStates: ['photoshop-free-transform-skew-drag-handles'],
        blockerCode: 'photoshop-skew-handle-parity-unavailable',
        signature: 'layer-transform-unsupported:v1|skew|supported=true|parity=bounded-numeric-metadata|states=photoshop-free-transform-skew-drag-handles',
      },
      {
        mode: 'distort',
        supported: true,
        parity: 'bounded-corner-offset-metadata',
        unsupportedStates: ['photoshop-free-transform-distort-drag-handles'],
        blockerCode: 'photoshop-distort-handle-parity-unavailable',
        signature: 'layer-transform-unsupported:v1|distort|supported=true|parity=bounded-corner-offset-metadata|states=photoshop-free-transform-distort-drag-handles',
      },
      {
        mode: 'perspective',
        supported: true,
        parity: 'bounded-numeric-metadata',
        unsupportedStates: ['split-plane-perspective-warp'],
        blockerCode: 'photoshop-perspective-warp-parity-unavailable',
        signature: 'layer-transform-unsupported:v1|perspective|supported=true|parity=bounded-numeric-metadata|states=split-plane-perspective-warp',
      },
      {
        mode: 'warp',
        supported: true,
        parity: 'bounded-mesh-preview',
        unsupportedStates: ['photoshop-weighted-puppet-mesh'],
        blockerCode: 'photoshop-warp-cage-parity-unavailable',
        signature: 'layer-transform-unsupported:v1|warp|supported=true|parity=bounded-mesh-preview|states=photoshop-weighted-puppet-mesh',
      },
    ]);
    expect(descriptor.preview.signature).toContain('"sourceSafetySignature":"layer-transform-source-safety:v1|smart=false|caveats=smart-source-transform-not-retained,scale-commits-raster-resample|smart-object=metadata-only-not-native-smart-object"');
    expect(descriptor.preview.signature).toContain('"unsupportedModeSignatures":["layer-transform-unsupported:v1|skew|supported=true|parity=bounded-numeric-metadata|states=photoshop-free-transform-skew-drag-handles"');
  });
});
