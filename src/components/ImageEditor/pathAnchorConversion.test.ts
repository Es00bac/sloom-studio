import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import { buildVectorPathLayer, getVectorPathDocumentPoints } from './ImageVectorShape';
import { DEFAULT_SHAPE_TOOL_SETTINGS } from '../../types/imageEditor';
import {
  convertVectorPathAnchor,
  isSmoothVectorPathAnchor,
  toggleVectorPathAnchorConversion,
} from './pathAnchorConversion';

class FakeOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return {
      clearRect() {},
      drawImage() {},
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      bezierCurveTo() {},
      closePath() {},
      fill() {},
      stroke() {},
    };
  }
}

function pathLayer(points: Array<{ x: number; y: number; inHandle?: { x: number; y: number }; outHandle?: { x: number; y: number } }>, closed = false): ImageLayer {
  return buildVectorPathLayer({
    doc: null,
    points,
    closed,
    settings: { ...DEFAULT_SHAPE_TOOL_SETTINGS, strokeWidth: 2 },
  });
}

describe('pathAnchorConversion', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('retracts both handles when converting a smooth anchor to corner', () => {
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 50, y: 0, inHandle: { x: 30, y: 0 }, outHandle: { x: 70, y: 0 } },
      { x: 100, y: 40 },
    ]);
    const converted = convertVectorPathAnchor(layer, 1, 'corner');
    const points = getVectorPathDocumentPoints(converted);
    expect(points[1]).toEqual({ x: 50, y: 0 });
    expect(isSmoothVectorPathAnchor(points[1])).toBe(false);
    // Neighbour anchors are untouched.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[2]).toEqual({ x: 100, y: 40 });
  });

  it('rebuilds mirrored in/out handles along the averaged tangent when converting to smooth', () => {
    // Right-angle corner at (50,0): averaged tangent points up-right at 45 degrees.
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    const converted = convertVectorPathAnchor(layer, 1, 'smooth');
    const point = getVectorPathDocumentPoints(converted)[1];
    expect(point.x).toBe(50);
    expect(point.y).toBe(0);
    expect(point.inHandle).toBeDefined();
    expect(point.outHandle).toBeDefined();
    // Handles are mirrored about the anchor along one direction.
    const inHandle = point.inHandle!;
    const outHandle = point.outHandle!;
    expect(inHandle.x + outHandle.x).toBe(2 * point.x);
    expect(inHandle.y + outHandle.y).toBe(2 * point.y);
    // The direction bisects the incoming (-1,0) and outgoing (0,1) segment tangents:
    // averaged tangent = (0-(-1), 1-0) normalized = (1,1)/√2 — pointing up-right in
    // document space means outHandle moves toward increasing x and y.
    expect(outHandle.x).toBeGreaterThan(point.x);
    expect(outHandle.y).toBeGreaterThan(point.y);
    // Handle length = ((50 + 50)/2) × 1/3, rounded.
    expect(outHandle.x - point.x).toBeCloseTo(50 / 3 / Math.SQRT2, 0);
  });

  it('converts an open-path end anchor with a single handle continuing the segment', () => {
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
    ]);
    const firstSmooth = convertVectorPathAnchor(layer, 0, 'smooth');
    const first = getVectorPathDocumentPoints(firstSmooth)[0];
    expect(first.inHandle).toBeUndefined();
    expect(first.outHandle).toEqual({ x: 20, y: 0 });

    const lastSmooth = convertVectorPathAnchor(layer, 1, 'smooth');
    const last = getVectorPathDocumentPoints(lastSmooth)[1];
    expect(last.outHandle).toBeUndefined();
    expect(last.inHandle).toEqual({ x: 40, y: 0 });
  });

  it('toggles between smooth and corner and round-trips exactly', () => {
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 50, y: 0, inHandle: { x: 30, y: 0 }, outHandle: { x: 70, y: 0 } },
      { x: 100, y: 40 },
    ]);
    const toCorner = toggleVectorPathAnchorConversion(layer, 1);
    expect(getVectorPathDocumentPoints(toCorner)[1]).toEqual({ x: 50, y: 0 });

    const backToSmooth = toggleVectorPathAnchorConversion(toCorner, 1);
    const point = getVectorPathDocumentPoints(backToSmooth)[1];
    expect(isSmoothVectorPathAnchor(point)).toBe(true);
  });

  it('leaves the layer untouched for invalid indices and non-path layers', () => {
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(convertVectorPathAnchor(layer, -1, 'corner')).toBe(layer);
    expect(convertVectorPathAnchor(layer, 9, 'smooth')).toBe(layer);

    const rasterLayer = { ...layer, vectorRecipe: undefined, metadata: {} } as ImageLayer;
    expect(convertVectorPathAnchor(rasterLayer, 0, 'smooth')).toBe(rasterLayer);
  });

  it('keeps the retained vector path layer editable after conversion', () => {
    const layer = pathLayer([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 40 },
    ]);
    const converted = convertVectorPathAnchor(layer, 1, 'smooth');
    // The rebuilt layer still exposes retained path points (document-space).
    expect(getVectorPathDocumentPoints(converted)).toHaveLength(3);
    expect(converted.id).toBe(layer.id);
  });
});
