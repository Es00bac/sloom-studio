import { describe, expect, it } from 'vitest';
import {
  resolveFlowViewportCenterScreenPoint,
  resolveSourceBinAwareSetCenterTarget,
  type FlowViewportRect,
} from './flowViewportPlacement';

const VIEWPORT: FlowViewportRect = { left: 0, top: 40, right: 1000, bottom: 640 };

describe('resolveFlowViewportCenterScreenPoint', () => {
  it('returns the plain geometric center when there is no Source Bin panel', () => {
    expect(resolveFlowViewportCenterScreenPoint(VIEWPORT, null)).toEqual({ x: 500, y: 340 });
  });

  it('returns the plain center when the panel does not overlap the viewport vertically', () => {
    const panelAbove: FlowViewportRect = { left: 0, top: -400, right: 350, bottom: -10 };
    expect(resolveFlowViewportCenterScreenPoint(VIEWPORT, panelAbove)).toEqual({ x: 500, y: 340 });
  });

  it('shifts the horizontal center past a docked, vertically-overlapping Source Bin panel', () => {
    // Reproduces the MH-094 real-browser finding: the docked panel covers x 0..350 of the
    // viewport, so the plain center (x=500) is fine, but a template anchored near the left
    // edge would land under it. A panel that itself extends past the plain center pulls the
    // clear-left point (and therefore the returned center) to its right edge.
    const dockedPanel: FlowViewportRect = { left: 0, top: 80, right: 620, bottom: 600 };
    const point = resolveFlowViewportCenterScreenPoint(VIEWPORT, dockedPanel);
    expect(point.x).toBe((620 + 1000) / 2);
    expect(point.y).toBe(340);
  });

  it('clamps the clear-left point to the viewport bounds when the panel covers the entire canvas', () => {
    const fullCoverPanel: FlowViewportRect = { left: -50, top: 0, right: 5000, bottom: 900 };
    const point = resolveFlowViewportCenterScreenPoint(VIEWPORT, fullCoverPanel);
    expect(point.x).toBe(VIEWPORT.right);
  });

  it('ignores a panel collapsed to a rail that no longer meaningfully overlaps', () => {
    const collapsedRail: FlowViewportRect = { left: 0, top: 80, right: 56, bottom: 600 };
    const point = resolveFlowViewportCenterScreenPoint(VIEWPORT, collapsedRail);
    expect(point.x).toBe((56 + 1000) / 2);
  });
});

describe('resolveSourceBinAwareSetCenterTarget', () => {
  it('returns the target point unchanged when there is no overlapping panel', () => {
    const target = resolveSourceBinAwareSetCenterTarget({
      viewport: VIEWPORT,
      sourceBinPanel: null,
      targetFlowPoint: { x: 200, y: 300 },
      zoom: 1,
    });
    expect(target).toEqual({ x: 200, y: 300 });
  });

  it('shifts the setCenter flow target left by the clear-center screen delta divided by zoom, so the actual node lands clear of the panel after the pan (App.tsx MH-094/MH-097 finding: `setCenter` alone re-covers the node with the panel)', () => {
    // Viewport is 1000 wide (center screen x = 500). Panel covers x 0..350, so the clear
    // center is (350+1000)/2 = 675 — 175px right of the true center.
    const dockedPanel: FlowViewportRect = { left: 0, top: 80, right: 350, bottom: 600 };
    const target = resolveSourceBinAwareSetCenterTarget({
      viewport: VIEWPORT,
      sourceBinPanel: dockedPanel,
      targetFlowPoint: { x: 1000, y: 400 },
      zoom: 2,
    });
    // deltaScreenX = 675 - 500 = 175; flow delta = 175 / zoom(2) = 87.5
    expect(target.x).toBeCloseTo(1000 - 87.5, 5);
    expect(target.y).toBe(400);
  });

  it('falls back to zoom 1 when given a non-positive zoom so the result stays finite', () => {
    const dockedPanel: FlowViewportRect = { left: 0, top: 80, right: 350, bottom: 600 };
    const target = resolveSourceBinAwareSetCenterTarget({
      viewport: VIEWPORT,
      sourceBinPanel: dockedPanel,
      targetFlowPoint: { x: 1000, y: 400 },
      zoom: 0,
    });
    expect(Number.isFinite(target.x)).toBe(true);
  });
});
