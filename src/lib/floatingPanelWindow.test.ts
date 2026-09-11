import { describe, expect, it } from 'vitest';
import {
  buildFloatingPanelWindowFeatures,
  createExternalFloatingPanelDragAnchor,
  resolveExternalFloatingPanelWindowPosition,
  resolveExternalFloatingPanelWindowSize,
  resolveExternalFloatingPanelOuterSize,
  resolveExternalFloatingPanelMoveEndRect,
  resolveExternalFloatingPanelResizeRect,
  resolveOwnerRelativeFloatingPanelRect,
  shouldResizeExternalFloatingPanelWindow,
  shouldRenderFloatingPanelInOwnerWindow,
  shouldUseExternalFloatingPanelWindow,
} from './floatingPanelWindow';

describe('floating panel window helpers', () => {
  it('uses external windows only for native floating panel layouts', () => {
    expect(shouldUseExternalFloatingPanelWindow({ isNative: true, mode: 'floating' })).toBe(true);
    expect(shouldUseExternalFloatingPanelWindow({ isNative: true, mode: 'docked' })).toBe(false);
    expect(shouldUseExternalFloatingPanelWindow({ isNative: false, mode: 'floating' })).toBe(false);
    expect(shouldUseExternalFloatingPanelWindow({
      isNative: true,
      mode: 'floating',
      externalWindowsSupported: false,
    } as Parameters<typeof shouldUseExternalFloatingPanelWindow>[0])).toBe(false);
  });

  it('converts owner-window-relative panel rects to screen window features', () => {
    expect(
      buildFloatingPanelWindowFeatures(
        { x: 120, y: 88, width: 640, height: 420 },
        { screenX: 2000, screenY: 80 },
      ),
    ).toBe('popup=yes,frame=false,width=640,height=420,left=2120,top=168');
  });

  it('converts desktop-screen panel rects to popup features without adding the owner offset again', () => {
    expect(
      buildFloatingPanelWindowFeatures(
        { x: -1720, y: 140, width: 640, height: 420 },
        { screenX: 2000, screenY: 80 },
        { floatingRectSpace: 'screen' },
      ),
    ).toBe('popup=yes,frame=false,width=640,height=420,left=-1720,top=140');
  });

  it('does not inflate compact Image tools palette window features to a generic floating-panel size', () => {
    expect(
      buildFloatingPanelWindowFeatures(
        { x: 368, y: 112, width: 66, height: 456 },
        { screenX: 2000, screenY: 80 },
      ),
    ).toBe('popup=yes,frame=false,width=66,height=456,left=2368,top=192');
  });

  it('marks fixed compact floating palettes as non-resizable native windows', () => {
    expect(
      (buildFloatingPanelWindowFeatures as (
        rect: Parameters<typeof buildFloatingPanelWindowFeatures>[0],
        ownerWindow: Parameters<typeof buildFloatingPanelWindowFeatures>[1],
        options: { resizable: false },
      ) => string)(
        { x: 368, y: 112, width: 66, height: 456 },
        { screenX: 2000, screenY: 80 },
        { resizable: false },
      ),
    ).toContain('resizable=no');
  });

  it('keeps floating panels visible in the owner window when the external popup is unavailable', () => {
    expect(shouldRenderFloatingPanelInOwnerWindow({
      shouldUseExternalWindow: false,
      externalPanelRootAvailable: false,
      externalWindowClosed: false,
    })).toBe(true);
    expect(shouldRenderFloatingPanelInOwnerWindow({
      shouldUseExternalWindow: true,
      externalPanelRootAvailable: true,
      externalWindowClosed: false,
    })).toBe(false);
    expect(shouldRenderFloatingPanelInOwnerWindow({
      shouldUseExternalWindow: true,
      externalPanelRootAvailable: false,
      externalWindowClosed: false,
    })).toBe(true);
    expect(shouldRenderFloatingPanelInOwnerWindow({
      shouldUseExternalWindow: true,
      externalPanelRootAvailable: true,
      externalWindowClosed: true,
    })).toBe(true);
  });

  it('keeps an external floating panel window anchored under the pointer while dragging', () => {
    const anchor = createExternalFloatingPanelDragAnchor({
      pointerScreenX: 2168,
      pointerScreenY: 132,
      windowScreenX: 2120,
      windowScreenY: 88,
    });

    expect(resolveExternalFloatingPanelWindowPosition({
      pointerScreenX: 2300,
      pointerScreenY: 190,
      anchor,
    })).toEqual({ screenX: 2252, screenY: 146 });
  });

  it('stores external popup placement back as owner-window-relative panel rects', () => {
    expect(resolveOwnerRelativeFloatingPanelRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 2252,
      windowScreenY: 146,
      width: 640,
      height: 420,
    })).toEqual({ x: 252, y: 66, width: 640, height: 420 });
  });

  it('stores compact Image tools popup placement without widening it to a standard panel', () => {
    expect(resolveOwnerRelativeFloatingPanelRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 2368,
      windowScreenY: 192,
      width: 66,
      height: 456,
    })).toEqual({ x: 368, y: 112, width: 66, height: 456 });
  });

  it('persists external popup content size instead of chrome-inclusive outer size', () => {
    expect(resolveExternalFloatingPanelWindowSize({
      innerWidth: 640,
      innerHeight: 420,
      outerWidth: 656,
      outerHeight: 456,
      fallbackWidth: 600,
      fallbackHeight: 400,
    })).toEqual({ width: 640, height: 420 });
  });

  it('adds native window decoration back before synchronizing a persisted content size', () => {
    expect(resolveExternalFloatingPanelOuterSize({
      targetInnerWidth: 300,
      targetInnerHeight: 560,
      currentInnerWidth: 480,
      currentInnerHeight: 620,
      currentOuterWidth: 496,
      currentOuterHeight: 656,
    })).toEqual({ width: 316, height: 596 });
  });

  it('falls back to content dimensions when a popup does not report outer geometry', () => {
    expect(resolveExternalFloatingPanelOuterSize({
      targetInnerWidth: 300,
      targetInnerHeight: 560,
    })).toEqual({ width: 300, height: 560 });
  });

  it('reads compact Image tools popup size without applying generic floating-panel minimums', () => {
    expect(resolveExternalFloatingPanelWindowSize({
      innerWidth: 66,
      innerHeight: 456,
      outerWidth: 82,
      outerHeight: 492,
      fallbackWidth: 66,
      fallbackHeight: 456,
    })).toEqual({ width: 66, height: 456 });
  });

  it('stores native popup resize geometry in the same coordinate space as its layout', () => {
    expect(resolveExternalFloatingPanelResizeRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 3120,
      windowScreenY: 176,
      width: 480,
      height: 620,
    })).toEqual({ x: 1120, y: 96, width: 480, height: 620 });

    expect(resolveExternalFloatingPanelResizeRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: -1720,
      windowScreenY: 140,
      width: 480,
      height: 620,
      floatingRectSpace: 'screen',
    })).toEqual({ x: -1720, y: 140, width: 480, height: 620 });
  });

  it('preserves the drag-start panel size when storing an external popup move', () => {
    expect(resolveExternalFloatingPanelMoveEndRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 2252,
      windowScreenY: 146,
      dragStartWidth: 640,
      dragStartHeight: 420,
      reportedInnerWidth: 652,
      reportedInnerHeight: 431,
    })).toEqual({ x: 252, y: 66, width: 640, height: 420 });
  });

  it('stores moved external popups as desktop-screen rects when requested', () => {
    expect(resolveExternalFloatingPanelMoveEndRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: -1720,
      windowScreenY: 140,
      dragStartWidth: 640,
      dragStartHeight: 420,
      floatingRectSpace: 'screen',
    })).toEqual({ x: -1720, y: 140, width: 640, height: 420 });
  });

  it('preserves off-window owner-relative popup coordinates for multi-monitor placement metadata', () => {
    expect(resolveExternalFloatingPanelMoveEndRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 4800,
      windowScreenY: -240,
      dragStartWidth: 640,
      dragStartHeight: 420,
    })).toEqual({ x: 2800, y: -320, width: 640, height: 420 });
  });

  it('preserves screen-space popup coordinates outside the owner viewport without changing size', () => {
    expect(resolveExternalFloatingPanelMoveEndRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: -3200,
      windowScreenY: 1200,
      dragStartWidth: 352,
      dragStartHeight: 640,
      floatingRectSpace: 'screen',
      reportedInnerWidth: 388,
      reportedInnerHeight: 684,
    })).toEqual({ x: -3200, y: 1200, width: 352, height: 640 });
  });

  it('preserves compact Image tools drag-start size when storing an external popup move', () => {
    expect(resolveExternalFloatingPanelMoveEndRect({
      ownerScreenX: 2000,
      ownerScreenY: 80,
      windowScreenX: 2368,
      windowScreenY: 192,
      dragStartWidth: 66,
      dragStartHeight: 456,
      reportedInnerWidth: 160,
      reportedInnerHeight: 456,
    })).toEqual({ x: 368, y: 112, width: 66, height: 456 });
  });

  it('does not reapply the same external popup size during move-only layout sync', () => {
    expect(shouldResizeExternalFloatingPanelWindow({
      targetWidth: 640,
      targetHeight: 420,
      lastRequestedWidth: 640,
      lastRequestedHeight: 420,
    })).toBe(false);

    expect(shouldResizeExternalFloatingPanelWindow({
      targetWidth: 720,
      targetHeight: 420,
      lastRequestedWidth: 640,
      lastRequestedHeight: 420,
    })).toBe(true);
  });

  it('repairs external popup size drift even when the requested target size did not change', () => {
    expect(shouldResizeExternalFloatingPanelWindow({
      targetWidth: 352,
      targetHeight: 640,
      currentWidth: 388,
      currentHeight: 684,
      lastRequestedWidth: 352,
      lastRequestedHeight: 640,
    })).toBe(true);
  });
});
