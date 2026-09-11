import { describe, expect, it } from 'vitest';
import * as selectionTransformControls from './ImageSelectionTransformControls';
import {
  calculateSelectionSkewDeg,
  calculateSelectionRotationDeg,
  getSelectionTransformTargetCorners,
  getSelectionTransformScreenBounds,
  moveSelectionBounds,
  resizeSelectionBoundsFromHandle,
} from './ImageSelectionTransformControls';
import type { SelectionTransformMode, SelectionTransformShape } from './ImageSelectionTransform';

type DescribeSelectionTransformControlPlan = (input: {
  shape: SelectionTransformShape;
  viewport: { zoom: number; panX: number; panY: number };
  mode: SelectionTransformMode;
  requestedSemantics?: Array<'perspective' | 'warp'>;
}) => unknown;

describe('ImageSelectionTransformControls', () => {
  it('computes screen-space bounds from document-space selection bounds', () => {
    expect(
      getSelectionTransformScreenBounds(
        { x: 10, y: 20, width: 80, height: 40 },
        { zoom: 1.5, panX: 12, panY: -6 },
      ),
    ).toEqual({
      x: 27,
      y: 24,
      width: 120,
      height: 60,
    });
  });

  it('rotates screen-space bounds around the view center under canvas view rotation', () => {
    const view = { width: 800, height: 600 };
    const rotated = getSelectionTransformScreenBounds(
      { x: 10, y: 20, width: 80, height: 40 },
      { zoom: 1, panX: 0, panY: 0, rotationDeg: 90 },
      view,
    );
    // At +90 degrees around the view center (400, 300), each corner maps to (400 - dy, 300 + dx):
    // corner (10, 20) -> (680, -90) and corner (90, 60) -> (640, -10); extents swap width/height
    // and stay a true axis-aligned box (never negative) at any angle.
    expect(rotated.x).toBeCloseTo(640, 6);
    expect(rotated.y).toBeCloseTo(-90, 6);
    expect(rotated.width).toBeCloseTo(40, 6);
    expect(rotated.height).toBeCloseTo(80, 6);
  });

  it('moves selection bounds by a document-space drag delta', () => {
    expect(
      moveSelectionBounds(
        { x: 10, y: 20, width: 80, height: 40 },
        { x: 15.4, y: -6.2 },
      ),
    ).toEqual({
      x: 25,
      y: 14,
      width: 80,
      height: 40,
    });
  });

  it('resizes selection bounds from a side handle without moving the orthogonal edges', () => {
    expect(
      resizeSelectionBoundsFromHandle({
        handle: 'e',
        origin: { x: 10, y: 20, width: 80, height: 40 },
        delta: { x: 30, y: 18 },
        keepAspect: false,
      }),
    ).toEqual({
      x: 10,
      y: 20,
      width: 110,
      height: 40,
    });
  });

  it('can preserve aspect ratio when resizing from a corner handle', () => {
    expect(
      resizeSelectionBoundsFromHandle({
        handle: 'se',
        origin: { x: 10, y: 20, width: 80, height: 40 },
        delta: { x: 40, y: 4 },
        keepAspect: true,
      }),
    ).toEqual({
      x: 10,
      y: 20,
      width: 120,
      height: 60,
    });
  });

  it('calculates drag-based selection rotation relative to the drag start and supports shift snapping', () => {
    expect(
      calculateSelectionRotationDeg({
        center: { x: 0, y: 0 },
        startPoint: { x: 1, y: 0 },
        point: { x: 0, y: 1 },
        startRotationDeg: 10,
        snapToFifteenDegrees: false,
      }),
    ).toBe(100);

    expect(
      calculateSelectionRotationDeg({
        center: { x: 0, y: 0 },
        startPoint: { x: 1, y: 0 },
        point: { x: 0, y: 1 },
        startRotationDeg: 10,
        snapToFifteenDegrees: true,
      }),
    ).toBe(105);
  });

  it('calculates direct skew deltas from pointer movement and supports shift snapping', () => {
    expect(
      calculateSelectionSkewDeg({
        axis: 'x',
        origin: { x: 10, y: 20, width: 80, height: 40 },
        delta: { x: 40, y: 0 },
        startSkewDeg: 0,
        snapToFifteenDegrees: false,
      }),
    ).toBe(45);

    expect(
      calculateSelectionSkewDeg({
        axis: 'y',
        origin: { x: 10, y: 20, width: 80, height: 40 },
        delta: { x: 0, y: 20 },
        startSkewDeg: 0,
        snapToFifteenDegrees: true,
      }),
    ).toBe(15);
  });

  it('builds transformed target corners for skewed and distorted selection previews', () => {
    expect(
      getSelectionTransformTargetCorners({
        bounds: { x: 10, y: 20, width: 80, height: 40 },
        rotationDeg: 0,
        skewXDeg: 45,
        skewYDeg: 0,
        cornerOffsets: {
          nw: { x: 0, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: 0 },
          sw: { x: 0, y: 0 },
        },
      }),
    ).toEqual({
      nw: { x: -10, y: 20 },
      ne: { x: 70, y: 20 },
      se: { x: 110, y: 60 },
      sw: { x: 30, y: 60 },
    });

    expect(
      getSelectionTransformTargetCorners({
        bounds: { x: 10, y: 20, width: 80, height: 40 },
        rotationDeg: 0,
        skewXDeg: 0,
        skewYDeg: 0,
        cornerOffsets: {
          nw: { x: -4, y: -2 },
          ne: { x: 8, y: -1 },
          se: { x: 12, y: 5 },
          sw: { x: -6, y: 4 },
        },
      }),
    ).toEqual({
      nw: { x: 6, y: 18 },
      ne: { x: 98, y: 19 },
      se: { x: 102, y: 65 },
      sw: { x: 4, y: 64 },
    });
  });

  it('builds deterministic control planning metadata for transform selection handles', () => {
    const describeSelectionTransformControlPlan = (
      selectionTransformControls as unknown as { describeSelectionTransformControlPlan?: DescribeSelectionTransformControlPlan }
    ).describeSelectionTransformControlPlan;
    const shape: SelectionTransformShape = {
      bounds: { x: 10, y: 20, width: 80, height: 40 },
      rotationDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    };

    expect(describeSelectionTransformControlPlan?.({
      shape,
      viewport: { zoom: 2, panX: 5, panY: -10 },
      mode: 'skew',
      requestedSemantics: ['perspective'],
    })).toEqual({
      mode: 'skew',
      screenBounds: { x: 25, y: 30, width: 160, height: 80 },
      pivot: {
        anchor: 'selection-center',
        editable: false,
        docPoint: { x: 50, y: 40 },
        screenPoint: { x: 105, y: 70 },
        signature: 'selection-transform-control-pivot:v1:selection-center:50,40:105,70',
      },
      handles: [
        { kind: 'skew', handle: 'n', point: { x: 105, y: 30 }, cursor: 'ew-resize' },
        { kind: 'skew', handle: 'e', point: { x: 185, y: 70 }, cursor: 'ns-resize' },
        { kind: 'skew', handle: 's', point: { x: 105, y: 110 }, cursor: 'ew-resize' },
        { kind: 'skew', handle: 'w', point: { x: 25, y: 70 }, cursor: 'ns-resize' },
      ],
      rotateHandle: { point: { x: 105, y: 2 }, cursor: 'grab' },
      warnings: [
        {
          code: 'unsupported-perspective-selection-semantics',
          severity: 'warning',
          message: 'Perspective selection transforms are not supported for pixel selections; distort corner offsets are tracked as a bounded quad preview only.',
        },
      ],
      modeCaveats: [
        {
          code: 'skew-affine-edge-controls',
          mode: 'skew',
          support: 'supported',
          active: true,
          message: 'Skew controls expose affine edge handles for selection-mask preview only; applied selections do not retain editable skew handles.',
        },
        {
          code: 'distort-corner-offset-controls',
          mode: 'distort',
          support: 'limited',
          active: false,
          message: 'Distort controls expose four bounded corner offsets; perspective and mesh warp controls remain unsupported for selections.',
        },
      ],
      overlayStates: [
        {
          code: 'marching-ants-control-preview-unsupported',
          supported: false,
          fallback: 'transform-outline-and-handles',
          message: 'Control planning does not generate animated marching ants; the deterministic outline, handles, and pivot describe the preview affordance.',
        },
        {
          code: 'photoshop-overlay-control-preview-unsupported',
          supported: false,
          fallback: 'selection-transform-preview-overlay',
          message: 'Control planning does not synthesize Photoshop-style overlay blending; callers render the existing transform preview overlay.',
        },
      ],
      signature: 'selection-transform-controls:skew:25,30,160,80:skew:n:105,30|skew:e:185,70|skew:s:105,110|skew:w:25,70:rotate:105,2:pivot:105,70',
    });
  });

  it('keeps transform selection handle order stable across resize, skew, and distort modes', () => {
    const describeSelectionTransformControlPlan = (
      selectionTransformControls as unknown as { describeSelectionTransformControlPlan?: DescribeSelectionTransformControlPlan }
    ).describeSelectionTransformControlPlan;
    const shape: SelectionTransformShape = {
      bounds: { x: 10, y: 20, width: 80, height: 40 },
      rotationDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    };

    expect((['resize', 'skew', 'distort'] as SelectionTransformMode[]).map((mode) => {
      const descriptor = describeSelectionTransformControlPlan?.({
        shape,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        mode,
      }) as { handles: Array<{ kind: string; handle: string }> } | undefined;
      return descriptor?.handles.map((handle) => `${handle.kind}:${handle.handle}`);
    })).toEqual([
      ['resize:nw', 'resize:n', 'resize:ne', 'resize:e', 'resize:se', 'resize:s', 'resize:sw', 'resize:w'],
      ['skew:n', 'skew:e', 'skew:s', 'skew:w'],
      ['distort:nw', 'distort:ne', 'distort:se', 'distort:sw'],
    ]);
  });
});
