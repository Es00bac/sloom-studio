// Pure text-wrap / runaround core for the Paper workspace. Turns an obstacle frame's `textWrap`
// setting into an outline polygon (in document mm) and then into frame-local exclusions that
// `paperTextFlow` uses to narrow line boxes around the obstacle. Framework-free and fully testable;
// the renderer reuses the same polygons for the on-canvas standoff and the CSS `shape-outside` path.

import type { PaperFrame } from '../types/paper';
import type { PaperTextFlowExclusion, PaperTextFlowPoint } from './paperTextFlow';

/** Segment count used to approximate an elliptical / round obstacle as a polygon. */
const ELLIPSE_SEGMENTS = 28;

type WrapFrame = Pick<
  PaperFrame,
  'id' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'shapeKind' | 'vertices' | 'textWrap'
>;

function boundingBox(frame: WrapFrame): PaperTextFlowPoint[] {
  const { xMm, yMm, widthMm, heightMm } = frame;
  return [
    { xMm, yMm },
    { xMm: xMm + widthMm, yMm },
    { xMm: xMm + widthMm, yMm: yMm + heightMm },
    { xMm, yMm: yMm + heightMm },
  ];
}

function ellipseOutline(frame: WrapFrame): PaperTextFlowPoint[] {
  const cx = frame.xMm + frame.widthMm / 2;
  const cy = frame.yMm + frame.heightMm / 2;
  const rx = frame.widthMm / 2;
  const ry = frame.heightMm / 2;
  return Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
    const theta = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { xMm: cx + Math.cos(theta) * rx, yMm: cy + Math.sin(theta) * ry };
  });
}

function verticesOutline(frame: WrapFrame): PaperTextFlowPoint[] | null {
  const verts = frame.vertices;
  if (!verts || verts.length < 3) return null;
  return verts.map((v) => ({
    xMm: frame.xMm + (v.xPercent / 100) * frame.widthMm,
    yMm: frame.yMm + (v.yPercent / 100) * frame.heightMm,
  }));
}

/**
 * The obstacle outline for `frame` in document mm, or null when the frame does not wrap text.
 * boundingBox / jumpObject use the frame rectangle; contour traces the frame's own shape —
 * free-form / SVG / polygon vertices, an elliptical outline for round shapes, else the rectangle.
 */
export function resolveFrameWrapPolygon(frame: WrapFrame): PaperTextFlowPoint[] | null {
  const wrap = frame.textWrap;
  if (!wrap || wrap.mode === 'none') return null;
  if (frame.widthMm <= 0 || frame.heightMm <= 0) return null;

  if (wrap.mode === 'boundingBox' || wrap.mode === 'jumpObject') {
    return boundingBox(frame);
  }

  // contour
  if (wrap.contourSource === 'vertices') {
    return verticesOutline(frame) ?? boundingBox(frame);
  }
  // frameShape: prefer real vertices, then an ellipse for round shapes, else the rectangle.
  const fromVertices = verticesOutline(frame);
  if (fromVertices) return fromVertices;
  if (frame.shapeKind === 'ellipse') return ellipseOutline(frame);
  return boundingBox(frame);
}

/** Translate a document-mm polygon into an exclusion in `textFrame`'s local mm space. */
export function toFrameLocalExclusion(
  polygon: PaperTextFlowPoint[],
  textFrame: Pick<PaperFrame, 'xMm' | 'yMm'>,
  standoffMm: number,
): PaperTextFlowExclusion {
  return {
    points: polygon.map((p) => ({ xMm: p.xMm - textFrame.xMm, yMm: p.yMm - textFrame.yMm })),
    standoffMm,
  };
}

/**
 * Every wrap exclusion that applies to `textFrame`, gathered from the other frames on the page.
 * The text-flow core ignores exclusions that fall outside the frame's columns, so a simple sweep
 * over all wrapping frames is correct (and cheap for typical page frame counts).
 */
export function resolveExclusionsForTextFrame(
  textFrame: Pick<PaperFrame, 'id' | 'xMm' | 'yMm'>,
  frames: WrapFrame[],
): PaperTextFlowExclusion[] {
  const exclusions: PaperTextFlowExclusion[] = [];
  for (const frame of frames) {
    if (frame.id === textFrame.id) continue;
    const polygon = resolveFrameWrapPolygon(frame);
    if (!polygon) continue;
    exclusions.push(toFrameLocalExclusion(polygon, textFrame, Math.max(0, frame.textWrap?.standoffMm ?? 0)));
  }
  return exclusions;
}

/**
 * A CSS `shape-outside` float spacer (geometry in the text frame's local mm, zoom-independent) that
 * makes the browser flow a text frame's copy around an overlapping obstacle. The renderer prepends
 * these floats before the text and scales mm → px at the current zoom.
 */
export interface PaperWrapSpacer {
  id: string;
  side: 'left' | 'right';
  topMm: number;
  widthMm: number;
  heightMm: number;
  shapeMarginMm: number;
  /** CSS `shape-outside` value (percentages of the float box) for contour wrap, else undefined (rect). */
  shapeOutside?: string;
}

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function contourShapeOutside(
  polygonDocMm: PaperTextFlowPoint[],
  textFrame: Pick<PaperFrame, 'xMm' | 'yMm'>,
  box: { x0: number; y0: number; w: number; h: number },
): string {
  const pts = polygonDocMm.map((p) => {
    const localX = p.xMm - textFrame.xMm;
    const localY = p.yMm - textFrame.yMm;
    const fx = clampNumber(((localX - box.x0) / box.w) * 100, 0, 100);
    const fy = clampNumber(((localY - box.y0) / box.h) * 100, 0, 100);
    return `${fx.toFixed(2)}% ${fy.toFixed(2)}%`;
  });
  return `polygon(${pts.join(', ')})`;
}

/**
 * Float spacers that wrap `textFrame`'s copy around every overlapping obstacle on the page. An
 * obstacle on the left half of the frame floats left (text to its right) and vice-versa; contour
 * wrap carries a `shape-outside` polygon so the text hugs round / free-form / SVG shapes.
 */
export function resolveFrameWrapSpacers(
  textFrame: Pick<PaperFrame, 'id' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>,
  frames: WrapFrame[],
): PaperWrapSpacer[] {
  const textW = textFrame.widthMm;
  const textH = textFrame.heightMm;
  if (textW <= 0 || textH <= 0) return [];

  const spacers: PaperWrapSpacer[] = [];
  for (const frame of frames) {
    if (frame.id === textFrame.id) continue;
    const wrap = frame.textWrap;
    if (!wrap || wrap.mode === 'none') continue;

    // Obstacle bounding box in the text frame's local mm, clipped to the frame.
    const oxL = frame.xMm - textFrame.xMm;
    const oyT = frame.yMm - textFrame.yMm;
    const oxR = oxL + frame.widthMm;
    const oyB = oyT + frame.heightMm;
    const clipL = clampNumber(oxL, 0, textW);
    const clipR = clampNumber(oxR, 0, textW);
    const clipT = clampNumber(oyT, 0, textH);
    const clipB = clampNumber(oyB, 0, textH);
    if (clipR - clipL <= 0 || clipB - clipT <= 0) continue; // no overlap

    const onLeft = (oxL + oxR) / 2 < textW / 2;
    const box = onLeft
      ? { x0: 0, y0: clipT, w: Math.max(1, clipR), h: Math.max(1, clipB - clipT) }
      : { x0: clipL, y0: clipT, w: Math.max(1, textW - clipL), h: Math.max(1, clipB - clipT) };

    const polygon = wrap.mode === 'contour' ? resolveFrameWrapPolygon(frame) : null;
    spacers.push({
      id: frame.id,
      side: onLeft ? 'left' : 'right',
      topMm: box.y0,
      widthMm: box.w,
      heightMm: box.h,
      shapeMarginMm: Math.max(0, wrap.standoffMm),
      shapeOutside: polygon ? contourShapeOutside(polygon, textFrame, box) : undefined,
    });
  }
  return spacers;
}
