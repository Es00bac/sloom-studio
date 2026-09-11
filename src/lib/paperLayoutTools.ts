import type { PaperFrame, PaperFramePatch, PaperGridSpec, PaperGuide, PaperTextVerticalAlign } from '../types/paper';

export const PAPER_SCREEN_PX_PER_MM = 3.78;

export interface PaperPoint {
  xMm: number;
  yMm: number;
}

export interface PaperRect extends PaperPoint {
  widthMm: number;
  heightMm: number;
}

export interface PaperCreateFrameGeometry extends PaperPoint {
  widthMm?: number;
  heightMm?: number;
}

export type PaperGuideOrientation = 'horizontal' | 'vertical';
export type PaperRulerOrientation = 'horizontal' | 'vertical';
export type PaperResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface PaperImageRenderStyle {
  objectFit: 'contain' | 'cover' | 'fill';
  objectPosition: string;
  position: 'absolute';
  width: string;
  height: string;
  maxWidth: 'none';
  maxHeight: 'none';
  left: string;
  top: string;
  transform: string;
  transformOrigin: 'center';
}

export interface PaperTextBoxLayout {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  rotationDeg: number;
  verticalAlign: PaperTextVerticalAlign;
}

export type PaperPolygonPointClickResult =
  | { kind: 'add'; points: PaperPoint[] }
  | { kind: 'close'; points: PaperPoint[]; closedPointIndex: number };

export const MIN_PAPER_FRAME_WIDTH_MM = 12;
export const MIN_PAPER_FRAME_HEIGHT_MM = 8;
export const DEFAULT_PAPER_POLYGON_CLOSE_THRESHOLD_MM = 2.5;
export const MIN_PAPER_ZOOM = 0.15;
export const MAX_PAPER_ZOOM = 3;

export interface PaperWheelZoomInput {
  currentZoom: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface PaperPointSnapOptions {
  grid?: Pick<PaperGridSpec, 'enabled' | 'sizeMm' | 'subdivisions'>;
  guides?: Array<Pick<PaperGuide, 'orientation' | 'positionMm'>>;
  guideSnapThresholdMm?: number;
  snapToGrid?: boolean;
  snapToGuides?: boolean;
}

export function buildPaperFrameDragGeometry(
  start: PaperPoint,
  end: PaperPoint,
  minWidthMm = MIN_PAPER_FRAME_WIDTH_MM,
  minHeightMm = MIN_PAPER_FRAME_HEIGHT_MM,
): PaperRect {
  const left = Math.min(start.xMm, end.xMm);
  const top = Math.min(start.yMm, end.yMm);
  const width = Math.abs(end.xMm - start.xMm);
  const height = Math.abs(end.yMm - start.yMm);

  return {
    xMm: roundMm(left),
    yMm: roundMm(top),
    widthMm: roundMm(Math.max(minWidthMm, width)),
    heightMm: roundMm(Math.max(minHeightMm, height)),
  };
}

export function buildPaperFrameCreateGeometry(
  start: PaperPoint,
  end: PaperPoint,
  minWidthMm = MIN_PAPER_FRAME_WIDTH_MM,
  minHeightMm = MIN_PAPER_FRAME_HEIGHT_MM,
  clickThresholdMm = 1.5,
): PaperCreateFrameGeometry {
  const deltaMm = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  if (deltaMm <= clickThresholdMm) {
    return {
      xMm: roundMm(start.xMm),
      yMm: roundMm(start.yMm),
    };
  }
  return buildPaperFrameDragGeometry(start, end, minWidthMm, minHeightMm);
}

export function movePaperFrameByDelta(
  frame: PaperFrame,
  delta: { deltaXMm: number; deltaYMm: number },
): PaperRect {
  return {
    xMm: roundMm(frame.xMm + delta.deltaXMm),
    yMm: roundMm(frame.yMm + delta.deltaYMm),
    widthMm: frame.widthMm,
    heightMm: frame.heightMm,
  };
}

export function panPaperFrameImageCropByDelta(
  frame: Pick<PaperFrame, 'widthMm' | 'heightMm' | 'imageOffsetXPercent' | 'imageOffsetYPercent'>,
  delta: { deltaXMm: number; deltaYMm: number },
): Pick<PaperFrame, 'imageOffsetXPercent' | 'imageOffsetYPercent'> {
  const width = Math.max(0.001, frame.widthMm);
  const height = Math.max(0.001, frame.heightMm);
  return {
    imageOffsetXPercent: roundMm((frame.imageOffsetXPercent ?? 0) + (delta.deltaXMm / width) * 100),
    imageOffsetYPercent: roundMm((frame.imageOffsetYPercent ?? 0) + (delta.deltaYMm / height) * 100),
  };
}

export function scalePaperFrameImageTowardPointer(
  frame: Pick<PaperFrame, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'imageScale'>,
  pointer: PaperPoint,
): Pick<PaperFrame, 'imageScale'> {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const baseDistance = Math.max(0.001, Math.hypot(frame.widthMm, frame.heightMm) / 2);
  const pointerDistance = Math.hypot(pointer.xMm - centerX, pointer.yMm - centerY);

  return {
    imageScale: roundMm(Math.max(0.05, (frame.imageScale ?? 1) * (pointerDistance / baseDistance))),
  };
}

export function rotatePaperFrameImageTowardPointer(
  frame: Pick<PaperFrame, 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>,
  pointer: PaperPoint,
): Pick<PaperFrame, 'imageRotationDeg'> {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const radians = Math.atan2(pointer.xMm - centerX, centerY - pointer.yMm);
  const degrees = radians * (180 / Math.PI);

  return {
    imageRotationDeg: roundMm((degrees + 360) % 360),
  };
}

export function resolvePaperWheelZoom(input: PaperWheelZoomInput): number | null {
  if ((!input.ctrlKey && !input.metaKey) || input.deltaY === 0) return null;
  const currentZoom = clamp(input.currentZoom, MIN_PAPER_ZOOM, MAX_PAPER_ZOOM);
  const direction = input.deltaY < 0 ? 1 : -1;
  const wheelUnits = Math.min(4, Math.max(0.25, Math.abs(input.deltaY) / 120));
  const stepRatio = input.shiftKey ? 0.25 : 0.1;
  return roundMm(clamp(currentZoom + currentZoom * stepRatio * wheelUnits * direction, MIN_PAPER_ZOOM, MAX_PAPER_ZOOM));
}

export function resizePaperFrameFromHandle(
  frame: PaperFrame,
  handle: PaperResizeHandle,
  delta: { deltaXMm: number; deltaYMm: number },
  minWidthMm = MIN_PAPER_FRAME_WIDTH_MM,
  minHeightMm = MIN_PAPER_FRAME_HEIGHT_MM,
  options: { lockAspectRatio?: boolean } = {},
): PaperRect {
  let left = frame.xMm;
  let top = frame.yMm;
  let right = frame.xMm + frame.widthMm;
  let bottom = frame.yMm + frame.heightMm;

  if (handle.includes('w')) left += delta.deltaXMm;
  if (handle.includes('e')) right += delta.deltaXMm;
  if (handle.includes('n')) top += delta.deltaYMm;
  if (handle.includes('s')) bottom += delta.deltaYMm;

  if (options.lockAspectRatio) {
    const aspectRatio = frame.widthMm / Math.max(0.001, frame.heightMm);
    const currentWidth = Math.max(minWidthMm, right - left);
    const currentHeight = Math.max(minHeightMm, bottom - top);
    const widthChange = Math.abs(currentWidth - frame.widthMm) / Math.max(0.001, frame.widthMm);
    const heightChange = Math.abs(currentHeight - frame.heightMm) / Math.max(0.001, frame.heightMm);
    let nextWidth = currentWidth;
    let nextHeight = currentHeight;

    if (handle === 'e' || handle === 'w') {
      nextHeight = nextWidth / aspectRatio;
    } else if (handle === 'n' || handle === 's') {
      nextWidth = nextHeight * aspectRatio;
    } else if (widthChange >= heightChange) {
      nextHeight = nextWidth / aspectRatio;
    } else {
      nextWidth = nextHeight * aspectRatio;
    }

    if (nextWidth < minWidthMm) {
      nextWidth = minWidthMm;
      nextHeight = nextWidth / aspectRatio;
    }
    if (nextHeight < minHeightMm) {
      nextHeight = minHeightMm;
      nextWidth = nextHeight * aspectRatio;
    }

    const centerX = frame.xMm + frame.widthMm / 2;
    const centerY = frame.yMm + frame.heightMm / 2;
    const frameRight = frame.xMm + frame.widthMm;
    const frameBottom = frame.yMm + frame.heightMm;

    if (handle.includes('w')) {
      right = frameRight;
      left = right - nextWidth;
    } else if (handle.includes('e')) {
      left = frame.xMm;
      right = left + nextWidth;
    } else {
      left = centerX - nextWidth / 2;
      right = centerX + nextWidth / 2;
    }

    if (handle.includes('n')) {
      bottom = frameBottom;
      top = bottom - nextHeight;
    } else if (handle.includes('s')) {
      top = frame.yMm;
      bottom = top + nextHeight;
    } else {
      top = centerY - nextHeight / 2;
      bottom = centerY + nextHeight / 2;
    }
  }

  if (right - left < minWidthMm) {
    if (handle.includes('w')) {
      left = right - minWidthMm;
    } else {
      right = left + minWidthMm;
    }
  }

  if (bottom - top < minHeightMm) {
    if (handle.includes('n')) {
      top = bottom - minHeightMm;
    } else {
      bottom = top + minHeightMm;
    }
  }

  return {
    xMm: roundMm(left),
    yMm: roundMm(top),
    widthMm: roundMm(Math.max(minWidthMm, right - left)),
    heightMm: roundMm(Math.max(minHeightMm, bottom - top)),
  };
}

export function clientPointToPaperPoint(
  event: { clientX: number; clientY: number },
  pageRect: Pick<DOMRect, 'left' | 'top'>,
  zoom: number,
  pxPerMm = PAPER_SCREEN_PX_PER_MM,
): PaperPoint {
  const scale = Math.max(0.001, pxPerMm * zoom);
  return {
    xMm: roundMm((event.clientX - pageRect.left) / scale),
    yMm: roundMm((event.clientY - pageRect.top) / scale),
  };
}

export function paperGuideOrientationFromRuler(rulerOrientation: PaperRulerOrientation): PaperGuideOrientation {
  return rulerOrientation === 'horizontal' ? 'vertical' : 'horizontal';
}

export function paperGuidePositionFromClientPoint(
  event: { clientX: number; clientY: number },
  guideOrientation: PaperGuideOrientation,
  pageRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  pageSize: { widthMm: number; heightMm: number },
  zoom: number,
  pxPerMm = PAPER_SCREEN_PX_PER_MM,
  options: {
    grid?: Pick<PaperGridSpec, 'enabled' | 'sizeMm' | 'subdivisions'>;
    shiftKey?: boolean;
  } = {},
): number {
  const scale = Math.max(0.001, pxPerMm * zoom);
  const raw = guideOrientation === 'vertical'
    ? (event.clientX - pageRect.left) / scale
    : (event.clientY - pageRect.top) / scale;
  const max = guideOrientation === 'vertical'
    ? pageSize.widthMm
    : pageSize.heightMm;
  return snapPaperGuidePositionToRulerMarker(raw, max, options.grid, Boolean(options.shiftKey));
}

export function snapPaperGuidePositionToRulerMarker(
  positionMm: number,
  pageExtentMm: number,
  grid: Pick<PaperGridSpec, 'enabled' | 'sizeMm' | 'subdivisions'> | undefined,
  shiftKey: boolean,
): number {
  const clamped = clamp(positionMm, 0, Math.max(0, pageExtentMm));
  if (!shiftKey) return roundMm(clamped);
  const spacingMm = paperRulerMarkerSpacingMm(grid);
  return roundMm(clamp(Math.round(clamped / spacingMm) * spacingMm, 0, Math.max(0, pageExtentMm)));
}

export function snapPaperPointToGridAndGuides(point: PaperPoint, options: PaperPointSnapOptions = {}): PaperPoint {
  let xMm = point.xMm;
  let yMm = point.yMm;

  if (options.snapToGrid && options.grid?.enabled !== false) {
    const spacingMm = paperRulerMarkerSpacingMm(options.grid);
    xMm = Math.round(xMm / spacingMm) * spacingMm;
    yMm = Math.round(yMm / spacingMm) * spacingMm;
  }

  if (options.snapToGuides && options.guides?.length) {
    const thresholdMm = Math.max(0, options.guideSnapThresholdMm ?? 2);
    const verticalGuide = closestGuidePosition(xMm, options.guides, 'vertical', thresholdMm);
    const horizontalGuide = closestGuidePosition(yMm, options.guides, 'horizontal', thresholdMm);
    if (verticalGuide !== null) xMm = verticalGuide;
    if (horizontalGuide !== null) yMm = horizontalGuide;
  }

  return {
    xMm: roundMm(xMm),
    yMm: roundMm(yMm),
  };
}

export function rotatePaperFrameTowardPointer(frame: PaperFrame, pointer: PaperPoint): number {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const radians = Math.atan2(pointer.xMm - centerX, centerY - pointer.yMm);
  const degrees = radians * (180 / Math.PI);
  return roundMm((degrees + 360) % 360);
}

export function buildPaperImageRenderStyle(frame: Pick<PaperFrame,
  'fit' | 'widthMm' | 'heightMm' | 'asset' | 'imageScale' | 'imageOffsetXPercent' | 'imageOffsetYPercent' | 'imageRotationDeg' | 'imageFlipX' | 'imageFlipY'
>): PaperImageRenderStyle {
  const x = Number.isFinite(frame.imageOffsetXPercent) ? frame.imageOffsetXPercent : 0;
  const y = Number.isFinite(frame.imageOffsetYPercent) ? frame.imageOffsetYPercent : 0;
  const scale = Number.isFinite(frame.imageScale) ? Math.max(0.05, frame.imageScale) : 1;
  const rotation = Number.isFinite(frame.imageRotationDeg) ? frame.imageRotationDeg : 0;
  const imageCanvas = resolvePaperImageCanvas(frame, scale);
  const flip = [
    frame.imageFlipX ? 'scaleX(-1)' : '',
    frame.imageFlipY ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');
  const objectFit = frame.fit === 'stretch'
    ? 'fill'
    : frame.fit === 'contain'
      ? 'contain'
      : 'cover';

  return {
    objectFit,
    objectPosition: '50% 50%',
    position: 'absolute',
    width: `${roundMm(imageCanvas.widthPercent)}%`,
    height: `${roundMm(imageCanvas.heightPercent)}%`,
    maxWidth: 'none',
    maxHeight: 'none',
    left: `${roundMm(50 + x)}%`,
    top: `${roundMm(50 + y)}%`,
    transform: `translate(-50%, -50%) rotate(${roundMm(rotation)}deg)${flip ? ` ${flip}` : ''}`,
    transformOrigin: 'center',
  };
}

export function resolvePaperImageNaturalSizePatch(
  frame: Pick<PaperFrame, 'asset'>,
  naturalWidth: number,
  naturalHeight: number,
): Pick<PaperFramePatch, 'asset'> | undefined {
  if (!frame.asset || frame.asset.kind !== 'image') return undefined;
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
    return undefined;
  }

  const pixelWidth = Math.round(naturalWidth);
  const pixelHeight = Math.round(naturalHeight);

  if (frame.asset.pixelWidth === pixelWidth && frame.asset.pixelHeight === pixelHeight) {
    return undefined;
  }

  return {
    asset: {
      ...frame.asset,
      pixelWidth,
      pixelHeight,
    },
  };
}

function resolvePaperImageCanvas(
  frame: Pick<PaperFrame, 'fit' | 'widthMm' | 'heightMm' | 'asset'>,
  scale: number,
): { widthPercent: number; heightPercent: number } {
  const frameAspect = positiveFinite(frame.widthMm) / positiveFinite(frame.heightMm);
  const assetWidth = positiveNumber(frame.asset?.pixelWidth);
  const assetHeight = positiveNumber(frame.asset?.pixelHeight);
  const effectiveAssetAspect = assetWidth && assetHeight ? assetWidth / assetHeight : frameAspect;

  if (frame.fit === 'stretch') {
    return {
      widthPercent: 100 * scale,
      heightPercent: 100 * scale,
    };
  }

  if (frame.fit === 'contain') {
    return effectiveAssetAspect >= frameAspect
      ? {
          widthPercent: 100 * scale,
          heightPercent: (frameAspect / effectiveAssetAspect) * 100 * scale,
        }
      : {
          widthPercent: (effectiveAssetAspect / frameAspect) * 100 * scale,
          heightPercent: 100 * scale,
        };
  }

  return effectiveAssetAspect >= frameAspect
    ? {
        widthPercent: (effectiveAssetAspect / frameAspect) * 100 * scale,
        heightPercent: 100 * scale,
      }
    : {
        widthPercent: 100 * scale,
        heightPercent: (frameAspect / effectiveAssetAspect) * 100 * scale,
      };
}

function positiveFinite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function resolvePaperTextBox(frame: Partial<PaperFrame> & Pick<PaperFrame, 'kind'>): PaperTextBoxLayout {
  const defaults = defaultTextBoxForKind(frame.kind);
  const xPercent = clampPercent(frame.textBoxXPercent ?? defaults.xPercent);
  const yPercent = clampPercent(frame.textBoxYPercent ?? defaults.yPercent);
  const widthPercent = clampPercentSize(frame.textBoxWidthPercent ?? defaults.widthPercent, 5, 100 - xPercent);
  const heightPercent = clampPercentSize(frame.textBoxHeightPercent ?? defaults.heightPercent, 5, 100 - yPercent);
  const verticalAlign = isPaperTextVerticalAlign(frame.textVerticalAlign)
    ? frame.textVerticalAlign
    : defaults.verticalAlign;

  return {
    xPercent: roundMm(xPercent),
    yPercent: roundMm(yPercent),
    widthPercent: roundMm(widthPercent),
    heightPercent: roundMm(heightPercent),
    rotationDeg: roundMm(frame.textRotationDeg ?? defaults.rotationDeg),
    verticalAlign,
  };
}

export function paperTextVerticalAlignToJustifyContent(
  align: PaperTextVerticalAlign,
): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'middle') return 'center';
  if (align === 'bottom') return 'flex-end';
  return 'flex-start';
}

export function resolvePaperPolygonPointClick(
  existingPoints: PaperPoint[],
  point: PaperPoint,
  options: {
    closeThresholdMm?: number;
    minClosePointCount?: number;
  } = {},
): PaperPolygonPointClickResult {
  const closeThresholdMm = options.closeThresholdMm ?? DEFAULT_PAPER_POLYGON_CLOSE_THRESHOLD_MM;
  const minClosePointCount = options.minClosePointCount ?? 3;
  const closedPointIndex = existingPoints.findIndex(
    (existingPoint) => distanceMm(existingPoint, point) <= closeThresholdMm,
  );

  if (existingPoints.length >= minClosePointCount && closedPointIndex >= 0) {
    return {
      kind: 'close',
      points: existingPoints,
      closedPointIndex,
    };
  }

  return {
    kind: 'add',
    points: [...existingPoints, point],
  };
}

function distanceMm(a: PaperPoint, b: PaperPoint): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

export function paperRulerMarkerSpacingMm(grid: Pick<PaperGridSpec, 'sizeMm' | 'subdivisions'> | undefined): number {
  const sizeMm = Number.isFinite(grid?.sizeMm) ? Math.max(0.1, grid?.sizeMm ?? 5) : 5;
  const subdivisions = Number.isFinite(grid?.subdivisions) ? Math.max(1, Math.round(grid?.subdivisions ?? 1)) : 1;
  return Math.max(0.1, sizeMm / subdivisions);
}

function closestGuidePosition(
  valueMm: number,
  guides: Array<Pick<PaperGuide, 'orientation' | 'positionMm'>>,
  orientation: PaperGuideOrientation,
  thresholdMm: number,
): number | null {
  let closest: { distanceMm: number; positionMm: number } | null = null;
  for (const guide of guides) {
    if (guide.orientation !== orientation || !Number.isFinite(guide.positionMm)) continue;
    const distance = Math.abs(valueMm - guide.positionMm);
    if (distance > thresholdMm) continue;
    if (!closest || distance < closest.distanceMm) {
      closest = { distanceMm: distance, positionMm: guide.positionMm };
    }
  }
  return closest ? roundMm(closest.positionMm) : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function clampPercent(value: number): number {
  return clamp(value, 0, 100);
}

function clampPercentSize(value: number, min: number, max: number): number {
  const safeMax = Math.max(0, max);
  return clamp(value, Math.min(min, safeMax), safeMax);
}

function defaultTextBoxForKind(kind: PaperFrame['kind']): PaperTextBoxLayout {
  if (kind === 'speechBubble' || kind === 'thoughtBubble') {
    return {
      xPercent: 12,
      yPercent: 18,
      widthPercent: 76,
      heightPercent: 48,
      rotationDeg: 0,
      verticalAlign: 'middle',
    };
  }

  return {
    xPercent: 0,
    yPercent: 0,
    widthPercent: 100,
    heightPercent: 100,
    rotationDeg: 0,
    verticalAlign: 'top',
  };
}

function isPaperTextVerticalAlign(value: unknown): value is PaperTextVerticalAlign {
  return value === 'top' || value === 'middle' || value === 'bottom';
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}
