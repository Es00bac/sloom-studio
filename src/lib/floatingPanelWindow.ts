import type { DockablePanelFloatingRectSpace, DockablePanelMode, PanelRect } from './dockablePanel';

interface FloatingPanelWindowDecision {
  isNative: boolean;
  mode: DockablePanelMode;
  externalWindowsSupported?: boolean;
}

interface OwnerWindowScreenPosition {
  screenX: number;
  screenY: number;
}

interface FloatingPanelWindowFeatureOptions {
  resizable?: boolean;
  floatingRectSpace?: DockablePanelFloatingRectSpace;
}

interface FloatingPanelOwnerRenderDecision {
  shouldUseExternalWindow: boolean;
  externalPanelRootAvailable: boolean;
  externalWindowClosed: boolean;
}

interface ExternalFloatingPanelDragStart {
  pointerScreenX: number;
  pointerScreenY: number;
  windowScreenX: number;
  windowScreenY: number;
}

export interface ExternalFloatingPanelDragAnchor {
  offsetX: number;
  offsetY: number;
}

interface ExternalFloatingPanelDragPosition {
  pointerScreenX: number;
  pointerScreenY: number;
  anchor: ExternalFloatingPanelDragAnchor;
}

interface OwnerRelativeFloatingPanelRectInput {
  ownerScreenX: number;
  ownerScreenY: number;
  windowScreenX: number;
  windowScreenY: number;
  width: number;
  height: number;
}

interface ExternalFloatingPanelMoveEndRectInput {
  ownerScreenX: number;
  ownerScreenY: number;
  windowScreenX: number;
  windowScreenY: number;
  dragStartWidth: number;
  dragStartHeight: number;
  floatingRectSpace?: DockablePanelFloatingRectSpace;
  reportedInnerWidth?: number;
  reportedInnerHeight?: number;
}

interface ExternalFloatingPanelWindowSizeInput {
  innerWidth?: number;
  innerHeight?: number;
  outerWidth?: number;
  outerHeight?: number;
  fallbackWidth: number;
  fallbackHeight: number;
}

interface ExternalFloatingPanelResizeRectInput {
  ownerScreenX: number;
  ownerScreenY: number;
  windowScreenX: number;
  windowScreenY: number;
  width: number;
  height: number;
  floatingRectSpace?: DockablePanelFloatingRectSpace;
}

interface ExternalFloatingPanelResizeSyncInput {
  targetWidth: number;
  targetHeight: number;
  currentWidth?: number;
  currentHeight?: number;
  lastRequestedWidth?: number;
  lastRequestedHeight?: number;
}

interface ExternalFloatingPanelOuterSizeInput {
  targetInnerWidth: number;
  targetInnerHeight: number;
  currentInnerWidth?: number;
  currentInnerHeight?: number;
  currentOuterWidth?: number;
  currentOuterHeight?: number;
}

export function shouldUseExternalFloatingPanelWindow({
  isNative,
  mode,
  externalWindowsSupported,
}: FloatingPanelWindowDecision): boolean {
  return isNative && externalWindowsSupported !== false && mode === 'floating';
}

export function buildFloatingPanelWindowFeatures(
  rect: PanelRect,
  ownerWindow: OwnerWindowScreenPosition,
  options: FloatingPanelWindowFeatureOptions = {},
): string {
  const width = normalizeWindowDimension(rect.width, 1);
  const height = normalizeWindowDimension(rect.height, 1);
  const screenRect = resolveFloatingPanelScreenRect({
    rect,
    ownerScreenX: ownerWindow.screenX,
    ownerScreenY: ownerWindow.screenY,
    floatingRectSpace: options.floatingRectSpace,
  });
  const left = Math.round(screenRect.x);
  const top = Math.round(screenRect.y);
  const features = [
    'popup=yes',
    'frame=false',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
  ];
  if (options.resizable === false) {
    features.push('resizable=no');
  }
  return features.join(',');
}

export function shouldRenderFloatingPanelInOwnerWindow({
  shouldUseExternalWindow,
  externalPanelRootAvailable,
  externalWindowClosed,
}: FloatingPanelOwnerRenderDecision): boolean {
  return !shouldUseExternalWindow || externalWindowClosed || !externalPanelRootAvailable;
}

export function createExternalFloatingPanelDragAnchor({
  pointerScreenX,
  pointerScreenY,
  windowScreenX,
  windowScreenY,
}: ExternalFloatingPanelDragStart): ExternalFloatingPanelDragAnchor {
  return {
    offsetX: Math.round(pointerScreenX - windowScreenX),
    offsetY: Math.round(pointerScreenY - windowScreenY),
  };
}

export function resolveExternalFloatingPanelWindowPosition({
  pointerScreenX,
  pointerScreenY,
  anchor,
}: ExternalFloatingPanelDragPosition): { screenX: number; screenY: number } {
  return {
    screenX: Math.round(pointerScreenX - anchor.offsetX),
    screenY: Math.round(pointerScreenY - anchor.offsetY),
  };
}

export function resolveOwnerRelativeFloatingPanelRect({
  ownerScreenX,
  ownerScreenY,
  windowScreenX,
  windowScreenY,
  width,
  height,
}: OwnerRelativeFloatingPanelRectInput): PanelRect {
  return {
    x: Math.round(windowScreenX - ownerScreenX),
    y: Math.round(windowScreenY - ownerScreenY),
    width: normalizeWindowDimension(width, 1),
    height: normalizeWindowDimension(height, 1),
  };
}

export function resolveFloatingPanelScreenRect({
  rect,
  ownerScreenX,
  ownerScreenY,
  floatingRectSpace,
}: {
  rect: PanelRect;
  ownerScreenX: number;
  ownerScreenY: number;
  floatingRectSpace?: DockablePanelFloatingRectSpace;
}): PanelRect {
  if (floatingRectSpace === 'screen') {
    return {
      x: Math.round(finiteCoordinateOr(rect.x, 0)),
      y: Math.round(finiteCoordinateOr(rect.y, 0)),
      width: normalizeWindowDimension(rect.width, 1),
      height: normalizeWindowDimension(rect.height, 1),
    };
  }

  return {
    x: Math.round(finiteCoordinateOr(ownerScreenX, 0) + finiteCoordinateOr(rect.x, 0)),
    y: Math.round(finiteCoordinateOr(ownerScreenY, 0) + finiteCoordinateOr(rect.y, 0)),
    width: normalizeWindowDimension(rect.width, 1),
    height: normalizeWindowDimension(rect.height, 1),
  };
}

export function resolveFloatingPanelOwnerRect({
  rect,
  ownerScreenX,
  ownerScreenY,
  floatingRectSpace,
}: {
  rect: PanelRect;
  ownerScreenX: number;
  ownerScreenY: number;
  floatingRectSpace?: DockablePanelFloatingRectSpace;
}): PanelRect {
  if (floatingRectSpace === 'screen') {
    return resolveOwnerRelativeFloatingPanelRect({
      ownerScreenX,
      ownerScreenY,
      windowScreenX: rect.x,
      windowScreenY: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  return {
    x: Math.round(finiteOr(rect.x, 0)),
    y: Math.round(finiteOr(rect.y, 0)),
    width: normalizeWindowDimension(rect.width, 1),
    height: normalizeWindowDimension(rect.height, 1),
  };
}

export function resolveExternalFloatingPanelMoveEndRect({
  ownerScreenX,
  ownerScreenY,
  windowScreenX,
  windowScreenY,
  dragStartWidth,
  dragStartHeight,
  floatingRectSpace,
}: ExternalFloatingPanelMoveEndRectInput): PanelRect {
  if (floatingRectSpace === 'screen') {
    return {
      x: Math.round(finiteCoordinateOr(windowScreenX, 0)),
      y: Math.round(finiteCoordinateOr(windowScreenY, 0)),
      width: normalizeWindowDimension(dragStartWidth, 1),
      height: normalizeWindowDimension(dragStartHeight, 1),
    };
  }

  return resolveOwnerRelativeFloatingPanelRect({
    ownerScreenX,
    ownerScreenY,
    windowScreenX,
    windowScreenY,
    width: dragStartWidth,
    height: dragStartHeight,
  });
}

export function resolveExternalFloatingPanelWindowSize({
  innerWidth,
  innerHeight,
  outerWidth,
  outerHeight,
  fallbackWidth,
  fallbackHeight,
}: ExternalFloatingPanelWindowSizeInput): { width: number; height: number } {
  return {
    width: normalizeWindowDimension(innerWidth, finiteOr(outerWidth, fallbackWidth)),
    height: normalizeWindowDimension(innerHeight, finiteOr(outerHeight, fallbackHeight)),
  };
}

export function resolveExternalFloatingPanelResizeRect({
  ownerScreenX,
  ownerScreenY,
  windowScreenX,
  windowScreenY,
  width,
  height,
  floatingRectSpace,
}: ExternalFloatingPanelResizeRectInput): PanelRect {
  if (floatingRectSpace === 'screen') {
    return {
      x: Math.round(finiteCoordinateOr(windowScreenX, 0)),
      y: Math.round(finiteCoordinateOr(windowScreenY, 0)),
      width: normalizeWindowDimension(width, 1),
      height: normalizeWindowDimension(height, 1),
    };
  }

  return resolveOwnerRelativeFloatingPanelRect({
    ownerScreenX,
    ownerScreenY,
    windowScreenX,
    windowScreenY,
    width,
    height,
  });
}

export function shouldResizeExternalFloatingPanelWindow({
  targetWidth,
  targetHeight,
  currentWidth,
  currentHeight,
  lastRequestedWidth,
  lastRequestedHeight,
}: ExternalFloatingPanelResizeSyncInput): boolean {
  const roundedTargetWidth = normalizeWindowDimension(targetWidth, 1);
  const roundedTargetHeight = normalizeWindowDimension(targetHeight, 1);
  const roundedCurrentWidth = roundOptionalPositive(currentWidth);
  const roundedCurrentHeight = roundOptionalPositive(currentHeight);

  if (roundedCurrentWidth !== undefined && roundedCurrentHeight !== undefined) {
    return roundedCurrentWidth !== roundedTargetWidth || roundedCurrentHeight !== roundedTargetHeight;
  }

  return Math.round(finiteOr(lastRequestedWidth, -1)) !== roundedTargetWidth
    || Math.round(finiteOr(lastRequestedHeight, -1)) !== roundedTargetHeight;
}

/**
 * `window.resizeTo()` accepts the decorated outer-window size, while panel
 * layouts intentionally persist the popup's content (`innerWidth` /
 * `innerHeight`) size. Reusing the persisted content size as the `resizeTo`
 * target makes every sync shave off the title-bar/border dimensions and
 * creates the visible grow/shrink feedback loop while dragging.
 */
export function resolveExternalFloatingPanelOuterSize({
  targetInnerWidth,
  targetInnerHeight,
  currentInnerWidth,
  currentInnerHeight,
  currentOuterWidth,
  currentOuterHeight,
}: ExternalFloatingPanelOuterSizeInput): { width: number; height: number } {
  const innerWidth = roundOptionalPositive(currentInnerWidth);
  const innerHeight = roundOptionalPositive(currentInnerHeight);
  const outerWidth = roundOptionalPositive(currentOuterWidth);
  const outerHeight = roundOptionalPositive(currentOuterHeight);
  const horizontalDecoration = innerWidth !== undefined && outerWidth !== undefined
    ? Math.max(0, outerWidth - innerWidth)
    : 0;
  const verticalDecoration = innerHeight !== undefined && outerHeight !== undefined
    ? Math.max(0, outerHeight - innerHeight)
    : 0;

  return {
    width: normalizeWindowDimension(targetInnerWidth, 1) + horizontalDecoration,
    height: normalizeWindowDimension(targetInnerHeight, 1) + verticalDecoration,
  };
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteCoordinateOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeWindowDimension(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(finiteOr(value, fallback)));
}

function roundOptionalPositive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}
