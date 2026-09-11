import { describe, expect, it } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import * as layerTransformControls from './ImageLayerTransformControls';
import {
  calculateLayerSkewDeg,
  getImageLayerTransformTargetCorners,
  calculateLayerRotationDeg,
  getImageLayerTransformBounds,
  resizeLayerRectFromHandle,
  type ImageLayerTransformMode,
} from './ImageLayerTransformControls';

type DescribeImageLayerTransformControlPlan = (input: {
  layer: ImageLayer;
  viewport: { zoom: number; panX: number; panY: number };
  mode: ImageLayerTransformMode;
}) => unknown;

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
    x: 12,
    y: 24,
    bitmap: bitmap(160, 90),
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

describe('ImageLayerTransformControls', () => {
  it('computes a screen-space transform box from the active bitmap layer', () => {
    expect(getImageLayerTransformBounds(layer(), { zoom: 1.5, panX: 10, panY: -5 })).toEqual({
      x: 28,
      y: 31,
      width: 240,
      height: 135,
      rotationDeg: 0,
    });
  });

  it('rotates the screen transform box corners around the view center under canvas view rotation', () => {
    const view = { width: 800, height: 600 };
    const upright = getImageLayerTransformBounds(layer(), { zoom: 1, panX: 0, panY: 0 }, view);
    const rotated = getImageLayerTransformBounds(
      layer(),
      { zoom: 1, panX: 0, panY: 0, rotationDeg: 90 },
      view,
    );
    expect(upright).toEqual({ x: 12, y: 24, width: 160, height: 90, rotationDeg: 0 });
    // At +90 degrees around the view center (400, 300), each corner maps to
    // (400 - dy, 300 + dx): the extents swap width/height and sit beside/below the center.
    expect(rotated?.x).toBeCloseTo(586, 6);
    expect(rotated?.y).toBeCloseTo(-88, 6);
    expect(rotated?.width).toBeCloseTo(90, 6);
    expect(rotated?.height).toBeCloseTo(160, 6);
    expect(rotated?.rotationDeg).toBe(0);
  });

  it('resizes from a corner while keeping the opposite edge fixed', () => {
    expect(
      resizeLayerRectFromHandle({
        handle: 'nw',
        origin: { x: 12, y: 24, width: 160, height: 90 },
        delta: { x: 20, y: 10 },
        keepAspect: false,
      }),
    ).toEqual({ x: 32, y: 34, width: 140, height: 80 });
  });

  it('can preserve aspect ratio when resizing from a diagonal handle', () => {
    const resized = resizeLayerRectFromHandle({
      handle: 'se',
      origin: { x: 12, y: 24, width: 160, height: 90 },
      delta: { x: 80, y: 4 },
      keepAspect: true,
    });

    expect(resized).toEqual({ x: 12, y: 24, width: 240, height: 135 });
  });

  it('resizes from a side handle without moving the orthogonal edges', () => {
    const resized = resizeLayerRectFromHandle({
      handle: 'e',
      origin: { x: 12, y: 24, width: 160, height: 90 },
      delta: { x: 40, y: 18 },
      keepAspect: false,
    });

    expect(resized).toEqual({ x: 12, y: 24, width: 200, height: 90 });
  });

  it('keeps aspect ratio from a side handle by expanding around the center line', () => {
    const resized = resizeLayerRectFromHandle({
      handle: 'e',
      origin: { x: 12, y: 24, width: 160, height: 90 },
      delta: { x: 80, y: 0 },
      keepAspect: true,
    });

    expect(resized).toEqual({ x: 12, y: 2, width: 240, height: 135 });
  });

  it('calculates signed rotation around the layer center and supports snapping', () => {
    const center = { x: 50, y: 50 };

    expect(calculateLayerRotationDeg(center, { x: 50, y: 0 }, false)).toBe(-90);
    expect(calculateLayerRotationDeg(center, { x: 75, y: 25 }, true)).toBe(-45);
  });

  it('calculates direct skew deltas from pointer movement and supports shift snapping', () => {
    expect(
      calculateLayerSkewDeg({
        axis: 'x',
        origin: { x: 12, y: 24, width: 160, height: 90 },
        delta: { x: 90, y: 0 },
        startSkewDeg: 0,
        snapToFifteenDegrees: false,
      }),
    ).toBe(45);

    expect(
      calculateLayerSkewDeg({
        axis: 'y',
        origin: { x: 12, y: 24, width: 160, height: 90 },
        delta: { x: 0, y: 45 },
        startSkewDeg: 0,
        snapToFifteenDegrees: true,
      }),
    ).toBe(15);
  });

  it('builds transformed target corners for skewed and distorted layer previews', () => {
    expect(
      getImageLayerTransformTargetCorners({
        x: 12,
        y: 24,
        width: 160,
        height: 90,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        skewXDeg: 45,
        skewYDeg: 0,
        perspectiveX: 0,
        perspectiveY: 0,
        cornerOffsets: {
          nw: { x: 0, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: 0 },
          sw: { x: 0, y: 0 },
        },
      }),
    ).toEqual({
      nw: { x: -33, y: 24 },
      ne: { x: 127, y: 24 },
      se: { x: 217, y: 114 },
      sw: { x: 57, y: 114 },
    });

    expect(
      getImageLayerTransformTargetCorners({
        x: 12,
        y: 24,
        width: 160,
        height: 90,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        skewXDeg: 0,
        skewYDeg: 0,
        perspectiveX: 0,
        perspectiveY: 0,
        cornerOffsets: {
          nw: { x: -4, y: -2 },
          ne: { x: 8, y: -1 },
          se: { x: 12, y: 5 },
          sw: { x: -6, y: 4 },
        },
      }),
    ).toEqual({
      nw: { x: 8, y: 22 },
      ne: { x: 180, y: 23 },
      se: { x: 184, y: 119 },
      sw: { x: 6, y: 118 },
    });
  });

  it('builds transformed target corners for perspective layer previews', () => {
    expect(
      getImageLayerTransformTargetCorners({
        x: 12,
        y: 24,
        width: 160,
        height: 90,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        skewXDeg: 0,
        skewYDeg: 0,
        perspectiveX: 0.25,
        perspectiveY: 0,
        cornerOffsets: {
          nw: { x: 0, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: 0 },
          sw: { x: 0, y: 0 },
        },
      }),
    ).toEqual({
      nw: { x: 32, y: 24 },
      ne: { x: 152, y: 24 },
      se: { x: 192, y: 114 },
      sw: { x: -8, y: 114 },
    });
  });

  it('builds deterministic control planning metadata for layer transform handles', () => {
    const describeImageLayerTransformControlPlan = (
      layerTransformControls as unknown as {
        describeImageLayerTransformControlPlan?: DescribeImageLayerTransformControlPlan;
      }
    ).describeImageLayerTransformControlPlan;

    expect(describeImageLayerTransformControlPlan?.({
      layer: layer({
        transformOriginX: 0.25,
        transformOriginY: 0.75,
      } as Partial<ImageLayer>),
      viewport: { zoom: 2, panX: 5, panY: -10 },
      mode: 'warp',
    })).toEqual({
      descriptorId: 'image-layer-transform-controls:v1',
      layerId: 'layer-1',
      mode: 'warp',
      supported: true,
      sourceSize: { width: 160, height: 90 },
      screenBounds: { x: 29, y: 38, width: 320, height: 180 },
      handles: [
        { kind: 'warp', handle: 'n', point: { x: 189, y: 38 }, cursor: 'ns-resize' },
        { kind: 'warp', handle: 'e', point: { x: 349, y: 128 }, cursor: 'ew-resize' },
        { kind: 'warp', handle: 's', point: { x: 189, y: 218 }, cursor: 'ns-resize' },
        { kind: 'warp', handle: 'w', point: { x: 29, y: 128 }, cursor: 'ew-resize' },
      ],
      rotateHandle: { point: { x: 189, y: 10 }, cursor: 'grab' },
      pivotHandle: { point: { x: 109, y: 173 }, cursor: 'move' },
      numericTransform: {
        documentRect: { x: 12, y: 24, width: 160, height: 90, rotationDeg: 0 },
        pivot: { x: 52, y: 91.5, transformOriginX: 0.25, transformOriginY: 0.75 },
        fields: ['x', 'y', 'width', 'height', 'rotationDeg', 'transformOriginX', 'transformOriginY'],
        signature: 'image-layer-numeric-transform:v1:layer-1:12,24,160x90:r0:p52,91.5:o0.25,0.75',
      },
      preview: {
        id: 'image-layer-transform-controls:layer-1:warp',
        signature: 'image-layer-transform-controls:v1:layer-1:warp:29,38,320,180:warp:n:189,38|warp:e:349,128|warp:s:189,218|warp:w:29,128:rotate:189,10:pivot:109,173',
      },
      supportMatrix: {
        pivot: { supported: true, handleCount: 1 },
        resize: { supported: true, handleCount: 8 },
        skew: { supported: true, handleCount: 4 },
        distort: { supported: true, handleCount: 4 },
        perspective: { supported: true, handleCount: 4 },
        warp: { supported: true, handleCount: 4 },
      },
      sourceSafety: {
        linked: false,
        smartSourceSafe: true,
        limitationCodes: [],
      },
      advancedDeformationWorkspace: {
        mode: 'warp',
        fullyInteractive: false,
        actionSuitable: true,
        batchSuitable: true,
        limitation: 'overlay-handles-preview-only-not-live-deformation-workspace',
        unsupportedStates: [
          'interactive-warp-mesh-density',
          'puppet-style-warp-pins',
          'reopenable-deformation-workspace',
        ],
        previewSignature: 'image-layer-transform-controls:v1:layer-1:warp:29,38,320,180:warp:n:189,38|warp:e:349,128|warp:s:189,218|warp:w:29,128:rotate:189,10:pivot:109,173',
        exportSignature: 'image-layer-transform-controls-export:v1:layer-1:warp:flattened-render',
      },
      exportCaveats: [
        {
          code: 'control-preview-rasterized-on-export',
          severity: 'warning',
          message: 'Control overlays are deterministic previews only; flattened export rasterizes the layer transform through the renderer.',
        },
      ],
      warnings: [],
      signature: 'image-layer-transform-controls:v1:layer-1:warp:29,38,320,180:warp:n:189,38|warp:e:349,128|warp:s:189,218|warp:w:29,128:rotate:189,10:pivot:109,173',
    });
  });

  it('describes control support matrix, smart-source safety, and preview identity', () => {
    const describeImageLayerTransformControlPlan = (
      layerTransformControls as unknown as {
        describeImageLayerTransformControlPlan?: DescribeImageLayerTransformControlPlan;
      }
    ).describeImageLayerTransformControlPlan;

    const descriptor = describeImageLayerTransformControlPlan?.({
      layer: layer({
        metadata: {
          sourceLink: {
            id: 'source-1',
            label: 'Linked bitmap',
            status: 'missing',
            relinkHistory: [],
          },
        },
      } as Partial<ImageLayer>),
      viewport: { zoom: 1, panX: 0, panY: 0 },
      mode: 'perspective',
    }) as {
      signature: string;
    };

    expect(descriptor).toMatchObject({
      preview: {
        id: 'image-layer-transform-controls:layer-1:perspective',
        signature: descriptor.signature,
      },
      supportMatrix: {
        pivot: { supported: true, handleCount: 1 },
        resize: { supported: true, handleCount: 8 },
        skew: { supported: true, handleCount: 4 },
        distort: { supported: true, handleCount: 4 },
        perspective: { supported: true, handleCount: 4 },
        warp: { supported: true, handleCount: 4 },
      },
      sourceSafety: {
        linked: true,
        smartSourceSafe: false,
        limitationCodes: ['smart-source-transform-controls-preview-only'],
      },
      exportCaveats: [
        {
          code: 'control-preview-rasterized-on-export',
          severity: 'warning',
          message: 'Control overlays are deterministic previews only; flattened export rasterizes the layer transform through the renderer.',
        },
      ],
    });
  });

  it('adds honest perspective workspace limitations and export signatures to control plans', () => {
    const describeImageLayerTransformControlPlan = (
      layerTransformControls as unknown as {
        describeImageLayerTransformControlPlan?: DescribeImageLayerTransformControlPlan;
      }
    ).describeImageLayerTransformControlPlan;

    const descriptor = describeImageLayerTransformControlPlan?.({
      layer: layer(),
      viewport: { zoom: 1.25, panX: 10, panY: -4 },
      mode: 'perspective',
    });

    expect(descriptor).toMatchObject({
      advancedDeformationWorkspace: {
        mode: 'perspective',
        fullyInteractive: false,
        actionSuitable: true,
        batchSuitable: true,
        limitation: 'overlay-handles-preview-only-not-live-deformation-workspace',
        unsupportedStates: [
          'interactive-perspective-warp-grid',
          'split-plane-perspective-warp',
          'reopenable-deformation-workspace',
        ],
        previewSignature: 'image-layer-transform-controls:v1:layer-1:perspective:25,26,200,112.5:perspective:nw:25,26|perspective:ne:225,26|perspective:se:225,138.5|perspective:sw:25,138.5:rotate:125,-2:pivot:125,82.25',
        exportSignature: 'image-layer-transform-controls-export:v1:layer-1:perspective:flattened-render',
      },
    });
  });
});
