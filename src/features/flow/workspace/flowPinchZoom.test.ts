import { describe, expect, it } from 'vitest';
import { computePinchViewport, pinchSampleFromPoints, type FlowViewport } from './flowPinchZoom';

const bounds = { minZoom: 0.25, maxZoom: 4 };

describe('flowPinchZoom', () => {
  it('spreading fingers zooms in', () => {
    const current: FlowViewport = { x: 0, y: 0, zoom: 1 };
    const prev = pinchSampleFromPoints(180, 100, 220, 100); // dist 40, mid (200,100)
    const next = pinchSampleFromPoints(140, 100, 260, 100); // dist 120, same mid -> 3x
    const result = computePinchViewport(current, prev, next, bounds);
    expect(result.zoom).toBeCloseTo(3, 5);
  });

  it('pinching fingers together zooms out', () => {
    const current: FlowViewport = { x: 0, y: 0, zoom: 2 };
    const prev = pinchSampleFromPoints(100, 100, 300, 100); // dist 200
    const next = pinchSampleFromPoints(150, 100, 250, 100); // dist 100 -> 0.5x
    const result = computePinchViewport(current, prev, next, bounds);
    expect(result.zoom).toBeCloseTo(1, 5);
  });

  it('keeps the point under the pinch midpoint fixed while zooming', () => {
    const current: FlowViewport = { x: 0, y: 0, zoom: 1 };
    const mid = { x: 200, y: 150 };
    const prev = pinchSampleFromPoints(mid.x - 20, mid.y, mid.x + 20, mid.y); // dist 40
    const next = pinchSampleFromPoints(mid.x - 40, mid.y, mid.x + 40, mid.y); // dist 80 -> 2x, same mid
    const result = computePinchViewport(current, prev, next, bounds);
    // Flow point under the midpoint before and after must be identical.
    const flowBefore = { x: (mid.x - current.x) / current.zoom, y: (mid.y - current.y) / current.zoom };
    const flowAfter = { x: (mid.x - result.x) / result.zoom, y: (mid.y - result.y) / result.zoom };
    expect(flowAfter.x).toBeCloseTo(flowBefore.x, 4);
    expect(flowAfter.y).toBeCloseTo(flowBefore.y, 4);
  });

  it('clamps zoom to the provided bounds', () => {
    const current: FlowViewport = { x: 0, y: 0, zoom: 3.5 };
    const prev = pinchSampleFromPoints(100, 100, 200, 100); // dist 100
    const next = pinchSampleFromPoints(50, 100, 250, 100); // dist 200 -> 2x -> 7, clamps to 4
    const result = computePinchViewport(current, prev, next, bounds);
    expect(result.zoom).toBe(4);
  });

  it('translates the viewport when the midpoint moves (two-finger pan)', () => {
    const current: FlowViewport = { x: 10, y: 20, zoom: 1 };
    // Same distance (no zoom), midpoint shifts right 30 / down 15.
    const prev = pinchSampleFromPoints(100, 100, 200, 100); // dist 100, mid (150,100)
    const next = pinchSampleFromPoints(130, 115, 230, 115); // dist 100, mid (180,115)
    const result = computePinchViewport(current, prev, next, bounds);
    expect(result.zoom).toBeCloseTo(1, 5);
    expect(result.x).toBeCloseTo(40, 5); // 10 + 30
    expect(result.y).toBeCloseTo(35, 5); // 20 + 15
  });
});
