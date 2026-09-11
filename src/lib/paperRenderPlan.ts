// One deterministic Paper scene graph for managed preview and production export. Native paint/text/image
// nodes stay inspectable; only expressly unsupported visual effects enter a flatten group.

import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperDocument, PaperFrame, PaperPage } from '../types/paper';
import { buildPaperBubblePath } from './paperBubblePaths';
import type { PaperBubbleConnectorSegment, PaperCompoundBubbleShape } from './paperBubbleChains';
import {
  PAPER_CANVAS_FRAME_Z_START,
  buildPaperCanvasBubbleConnectorLayers,
} from './paperCanvasStacking';
import { resolvePaperPageFramesForOutput } from './paperDocument';
import { buildPaperBarcodeGeometry, PAPER_EAN13_NOMINAL } from './paperBarcode';
import { resolvePaperFramesTextTemplates } from './paperTextVariables';
import {
  composePaperTextFrame,
  type PaperComposedEmphasisMark,
  type PaperComposedParagraphBox,
  type PaperComposedTextFrame,
  type PaperManagedFontResolver,
  type PaperPositionedGlyphRun,
} from './paperTextComposition';
import {
  resolvePaperPrintPaint,
  type PaperPrintPaint,
  type PaperPrintPaintInput,
} from './paperPrintPaint';
import { buildPaperPrintSheetPlan, type PaperPrintSheetPlan } from './paperPrintMarks';
import { createPaperCanvasMeasurer } from './paperCanvasMeasurer';
import { resolvePaperThreadedFrames } from './paperThreadFlow';

const PT_PER_MM = 72 / 25.4;

export type PaperAffineTransform = readonly [number, number, number, number, number, number];

export interface PaperRenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaperRenderPathNode {
  kind: 'path';
  objectId: string;
  sourceFrameId?: string;
  /** SVG-compatible path data in local coordinates, transformed by `transform` when present. */
  path: string;
  fill?: PaperPrintPaint;
  stroke?: PaperPrintPaint;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidthPt: number;
  strokeStyle: PaperFrame['strokeStyle'];
  overprint: boolean;
  transform?: PaperAffineTransform;
  boundsPt: PaperRenderBounds;
}

export interface PaperRenderTextRunPaint {
  lineIndex: number;
  runIndex: number;
  fill: PaperPrintPaint;
  highlight?: PaperPrintPaint;
}

export interface PaperRenderParagraphPaint {
  paragraphIndex: number;
  fill?: PaperPrintPaint;
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', PaperPrintPaint>>;
}

export interface PaperRenderTextPaints {
  runs: PaperRenderTextRunPaint[];
  paragraphBoxes: PaperRenderParagraphPaint[];
  emphasisMarks: PaperPrintPaint[];
}

export interface PaperRenderTextNode {
  kind: 'text';
  objectId: string;
  sourceFrameId: string;
  composed: PaperComposedTextFrame;
  paints: PaperRenderTextPaints;
  opacity: number;
  overprint: boolean;
  transform?: PaperAffineTransform;
  boundsPt: PaperRenderBounds;
}

export interface PaperRenderImageNode {
  kind: 'image';
  objectId: string;
  sourceFrameId: string;
  asset: BinaryAssetRef;
  /** SVG-compatible local frame clip, paired with `clipTransform` when it is not absolute. */
  clipPath?: string;
  clipTransform?: PaperAffineTransform;
  /** Maps normalized image coordinates (0..1) into page-top-left point space. */
  transform: PaperAffineTransform;
  opacity: number;
  boundsPt: PaperRenderBounds;
}

export interface PaperFlattenGroup {
  kind: 'flatten-group';
  objectId: string;
  sourceFrameIds: string[];
  reasonCodes: string[];
  boundsPt: PaperRenderBounds;
  children: PaperRenderNode[];
}

export type PaperRenderNode = PaperRenderPathNode | PaperRenderTextNode | PaperRenderImageNode | PaperFlattenGroup;

export interface PaperRenderPlanPage {
  pageId: string;
  pageNumber: number;
  trimWidthPt: number;
  trimHeightPt: number;
  bleedPt: number;
  /** Physical production sheet; always present on compiled plans, optional only for legacy test adapters. */
  printSheet?: PaperPrintSheetPlan;
  /** Explicit native crop marks in final sheet coordinates, separate from translated authored content. */
  productionMarks?: PaperRenderPathNode[];
  /** Page background is separate so object stacking begins with the first authored/inherited frame. */
  background?: PaperRenderNode;
  nodes: PaperRenderNode[];
}

export interface PaperRenderPlan {
  documentId: string;
  /** Immutable document revision compiled into this plan. Strict exports reject mismatched evidence. */
  revision: number;
  pages: PaperRenderPlanPage[];
}

export interface PaperRenderPlanOptions {
  /** Exact managed-font resolver shared by the editor preview and export adapters. */
  managedFontResolver?: PaperManagedFontResolver;
  /** Test/host hook for custom paint provenance; defaults to the document swatch library. */
  resolvePaint?: (source: PaperPrintPaintInput) => PaperPrintPaint | undefined;
}

interface CompileContext {
  document: PaperDocument;
  resolvePaint: (source: PaperPrintPaintInput) => PaperPrintPaint | undefined;
  managedFontResolver: PaperManagedFontResolver;
  bleedPt: number;
  overprint: boolean;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function mmToPt(value: number): number {
  return round(value * PT_PER_MM);
}

/** Compile canonical sheet controls independently so flattened and native PDF/X routes share them. */
export function compilePaperProductionMarks(sheet: PaperPrintSheetPlan): PaperRenderPathNode[] {
  const cropMarks: PaperRenderPathNode[] = sheet.cropMarks.map((mark) => ({
    kind: 'path',
    objectId: `production:${mark.id}`,
    path: `M ${mark.x1Pt} ${mark.y1TopPt} L ${mark.x2Pt} ${mark.y2TopPt}`,
    stroke: { kind: 'process-cmyk', c: 0, m: 0, y: 0, k: 1, tint: 1 },
    opacity: 1,
    fillOpacity: 0,
    strokeOpacity: 1,
    strokeWidthPt: mark.strokeWidthPt,
    strokeStyle: 'solid',
    overprint: false,
    boundsPt: boundsFromPoints([
      { x: mark.x1Pt, y: mark.y1TopPt },
      { x: mark.x2Pt, y: mark.y2TopPt },
    ]),
  }));
  const registrationPaint: PaperPrintPaint = {
    kind: 'process-cmyk', c: 1, m: 1, y: 1, k: 1, tint: 1,
  };
  const registrationMarks = sheet.registrationMarks.flatMap((mark): PaperRenderPathNode[] => {
    const common = {
      kind: 'path' as const,
      opacity: 1,
      fillOpacity: 0,
      strokeOpacity: 1,
      strokeWidthPt: mark.strokeWidthPt,
      strokeStyle: 'solid' as const,
      overprint: true,
    };
    return [
      {
        ...common,
        objectId: `production:${mark.id}:circle`,
        path: circlePath(mark.centerXPt, mark.centerYTopPt, mark.radiusPt),
        stroke: registrationPaint,
        boundsPt: {
          x: mark.centerXPt - mark.radiusPt,
          y: mark.centerYTopPt - mark.radiusPt,
          width: mark.radiusPt * 2,
          height: mark.radiusPt * 2,
        },
      },
      {
        ...common,
        objectId: `production:${mark.id}:horizontal`,
        path: `M ${round(mark.centerXPt - mark.crossArmPt)} ${mark.centerYTopPt} L ${round(mark.centerXPt + mark.crossArmPt)} ${mark.centerYTopPt}`,
        stroke: registrationPaint,
        boundsPt: {
          x: mark.centerXPt - mark.crossArmPt,
          y: mark.centerYTopPt,
          width: mark.crossArmPt * 2,
          height: 0,
        },
      },
      {
        ...common,
        objectId: `production:${mark.id}:vertical`,
        path: `M ${mark.centerXPt} ${round(mark.centerYTopPt - mark.crossArmPt)} L ${mark.centerXPt} ${round(mark.centerYTopPt + mark.crossArmPt)}`,
        stroke: registrationPaint,
        boundsPt: {
          x: mark.centerXPt,
          y: mark.centerYTopPt - mark.crossArmPt,
          width: 0,
          height: mark.crossArmPt * 2,
        },
      },
    ];
  });
  const colorBars: PaperRenderPathNode[] = sheet.colorBars.map((patch) => ({
    kind: 'path',
    objectId: `production:${patch.id}`,
    path: rectanglePath(patch.rect.xPt, patch.rect.yTopPt, patch.rect.widthPt, patch.rect.heightPt),
    fill: { kind: 'process-cmyk', ...patch.cmyk, tint: 1 },
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 0,
    strokeWidthPt: 0,
    strokeStyle: 'solid',
    overprint: false,
    boundsPt: {
      x: patch.rect.xPt,
      y: patch.rect.yTopPt,
      width: patch.rect.widthPt,
      height: patch.rect.heightPt,
    },
  }));
  return [...cropMarks, ...registrationMarks, ...colorBars];
}

function circlePath(centerX: number, centerY: number, radius: number): string {
  const k = 0.5522847498307936;
  return [
    `M ${round(centerX + radius)} ${centerY}`,
    `C ${round(centerX + radius)} ${round(centerY + radius * k)} ${round(centerX + radius * k)} ${round(centerY + radius)} ${centerX} ${round(centerY + radius)}`,
    `C ${round(centerX - radius * k)} ${round(centerY + radius)} ${round(centerX - radius)} ${round(centerY + radius * k)} ${round(centerX - radius)} ${centerY}`,
    `C ${round(centerX - radius)} ${round(centerY - radius * k)} ${round(centerX - radius * k)} ${round(centerY - radius)} ${centerX} ${round(centerY - radius)}`,
    `C ${round(centerX + radius * k)} ${round(centerY - radius)} ${round(centerX + radius)} ${round(centerY - radius * k)} ${round(centerX + radius)} ${centerY} Z`,
  ].join(' ');
}

function rectanglePath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y} L ${round(x + width)} ${y} L ${round(x + width)} ${round(y + height)} L ${x} ${round(y + height)} Z`;
}

function clampUnit(value: number | undefined, fallback = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteNumber(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasVisibleColor(color: string | undefined, opacity: number | undefined): boolean {
  return Boolean(color && color.trim() && color.trim().toLowerCase() !== 'transparent' && clampUnit(opacity) > 0);
}

function framePercentTransform(frame: PaperFrame, bleedPt: number): PaperAffineTransform {
  const widthPt = mmToPt(frame.widthMm);
  const heightPt = mmToPt(frame.heightMm);
  const radians = (finiteNumber(frame.rotationDeg) % 360) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const a = round(cos * widthPt / 100);
  const b = round(sin * widthPt / 100);
  const c = round(-sin * heightPt / 100);
  const d = round(cos * heightPt / 100);
  const centerX = bleedPt + mmToPt(frame.xMm + frame.widthMm / 2);
  const centerY = bleedPt + mmToPt(frame.yMm + frame.heightMm / 2);
  return [a, b, c, d, round(centerX - (a + c) * 50), round(centerY - (b + d) * 50)];
}

function rotationAbout(x: number, y: number, degrees: number): PaperAffineTransform | undefined {
  if (!degrees) return undefined;
  const radians = degrees * Math.PI / 180;
  const a = round(Math.cos(radians));
  const b = round(Math.sin(radians));
  const c = round(-Math.sin(radians));
  const d = round(Math.cos(radians));
  return [a, b, c, d, round(x - a * x - c * y), round(y - b * x - d * y)];
}

function applyTransform(transform: PaperAffineTransform | undefined, x: number, y: number): { x: number; y: number } {
  if (!transform) return { x, y };
  const [a, b, c, d, e, f] = transform;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function boundsFromPoints(points: readonly { x: number; y: number }[]): PaperRenderBounds {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: round(x), y: round(y), width: round(Math.max(...xs) - x), height: round(Math.max(...ys) - y) };
}

function pathCoordinatePoints(path: string): Array<{ x: number; y: number }> {
  const values = path.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] });
  }
  return points;
}

function frameBounds(frame: PaperFrame, bleedPt: number): PaperRenderBounds {
  const transform = framePercentTransform(frame, bleedPt);
  const points = pathCoordinatePoints(framePath(frame));
  if (points.length) return boundsFromPoints(points.map((point) => applyTransform(transform, point.x, point.y)));
  return boundsFromPoints([applyTransform(transform, 0, 0), applyTransform(transform, 100, 100)]);
}

function defaultShapeVertices(shape: PaperFrame['shapeKind']): Array<{ xPercent: number; yPercent: number }> {
  switch (shape) {
    case 'triangle': return [{ xPercent: 50, yPercent: 2 }, { xPercent: 98, yPercent: 98 }, { xPercent: 2, yPercent: 98 }];
    case 'pentagon': return [{ xPercent: 50, yPercent: 2 }, { xPercent: 97, yPercent: 37 }, { xPercent: 79, yPercent: 98 }, { xPercent: 21, yPercent: 98 }, { xPercent: 3, yPercent: 37 }];
    case 'hexagon': return [{ xPercent: 25, yPercent: 2 }, { xPercent: 75, yPercent: 2 }, { xPercent: 98, yPercent: 50 }, { xPercent: 75, yPercent: 98 }, { xPercent: 25, yPercent: 98 }, { xPercent: 2, yPercent: 50 }];
    default: return [];
  }
}

function polygonPath(vertices: readonly { xPercent: number; yPercent: number }[]): string | undefined {
  if (vertices.length < 3) return undefined;
  return `${vertices.map((vertex, index) => `${index === 0 ? 'M' : 'L'} ${round(vertex.xPercent)} ${round(vertex.yPercent)}`).join(' ')} Z`;
}

function roundedRectPath(radiusPercent: number): string {
  const radius = Math.max(0, Math.min(50, radiusPercent));
  if (radius < 0.01) return 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
  const k = 0.5522847498307936;
  const left = 0;
  const top = 0;
  const right = 100;
  const bottom = 100;
  return [
    `M ${round(left + radius)} ${top}`,
    `L ${round(right - radius)} ${top}`,
    `C ${round(right - radius + radius * k)} ${top} ${right} ${round(top + radius - radius * k)} ${right} ${round(top + radius)}`,
    `L ${right} ${round(bottom - radius)}`,
    `C ${right} ${round(bottom - radius + radius * k)} ${round(right - radius + radius * k)} ${bottom} ${round(right - radius)} ${bottom}`,
    `L ${round(left + radius)} ${bottom}`,
    `C ${round(left + radius - radius * k)} ${bottom} ${left} ${round(bottom - radius + radius * k)} ${left} ${round(bottom - radius)}`,
    `L ${left} ${round(top + radius)}`,
    `C ${left} ${round(top + radius - radius * k)} ${round(left + radius - radius * k)} ${top} ${round(left + radius)} ${top} Z`,
  ].join(' ');
}

function ellipsePath(): string {
  const k = 0.5522847498307936;
  const rx = 48;
  const ry = 48;
  const cx = 50;
  const cy = 50;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${round(cy + ry * k)} ${round(cx + rx * k)} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${round(cx - rx * k)} ${cy + ry} ${cx - rx} ${round(cy + ry * k)} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${round(cy - ry * k)} ${round(cx - rx * k)} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${round(cx + rx * k)} ${cy - ry} ${cx + rx} ${round(cy - ry * k)} ${cx + rx} ${cy} Z`,
  ].join(' ');
}

function framePath(frame: PaperFrame): string {
  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') return buildPaperBubblePath(frame);
  if (frame.kind === 'shape') {
    if (frame.shapeKind === 'ellipse') return ellipsePath();
    if (frame.shapeKind === 'line') return 'M 0 50 L 100 50';
    const polygon = polygonPath(frame.vertices?.length ? frame.vertices : defaultShapeVertices(frame.shapeKind));
    if (polygon) return polygon;
  }
  const polygon = frame.vertices?.length ? polygonPath(frame.vertices) : undefined;
  if (polygon) return polygon;
  const smallerSide = Math.max(0.0001, Math.min(frame.widthMm, frame.heightMm));
  return roundedRectPath(frame.cornerRadiusMm / smallerSide * 100);
}

function isTextBearingFrame(frame: PaperFrame): boolean {
  return frame.kind === 'text' || frame.kind === 'caption' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
}

function frameHasText(frame: PaperFrame): boolean {
  return Boolean(frame.text?.length || frame.richText?.some((paragraph) => paragraph.runs.some((run) => run.text.length)));
}

function flattenReasons(frame: PaperFrame): string[] {
  const reasons: string[] = [];
  if (frame.fillGradient) reasons.push('gradient');
  if (frame.textShadowColor && nonNegative(frame.textShadowBlurMm) > 0) reasons.push('blurred-text-shadow');
  else if (frame.textShadowColor) reasons.push('text-shadow');
  if (finiteNumber(frame.textArcPercent) !== 0) reasons.push('text-arc');
  if (finiteNumber(frame.textSkewXDeg) !== 0 || finiteNumber(frame.textSkewYDeg) !== 0) reasons.push('text-skew');
  if ((frame.textScaleX !== undefined && frame.textScaleX !== 1) || (frame.textScaleY !== undefined && frame.textScaleY !== 1)) reasons.push('text-scale');
  if (nonNegative(frame.textStrokeWidthMm) > 0) reasons.push('text-stroke');
  if (frame.comicSfxDesign) reasons.push('comic-sfx-effect');
  if (frame.kind === 'document') reasons.push('document-frame');
  if (frame.kind === 'image' && frame.asset?.locator?.kind !== 'managed') reasons.push('unmanaged-image-asset');
  return reasons;
}

function paintFor(
  context: CompileContext,
  source: PaperPrintPaintInput,
  required: boolean,
  reasons: string[],
  reasonCode: string,
): PaperPrintPaint | undefined {
  const paint = context.resolvePaint(source);
  if (!paint && required) reasons.push(reasonCode);
  return paint;
}

function sourceForFrame(color: string, swatchId: string | undefined, tintPercent?: number): PaperPrintPaintInput {
  return {
    color,
    ...(swatchId ? { swatchId } : {}),
    ...(tintPercent === undefined ? {} : { tint: clampUnit(tintPercent / 100) }),
  };
}

function translateBounds(bounds: PaperRenderBounds, x: number, y: number): PaperRenderBounds {
  return { x: round(bounds.x + x), y: round(bounds.y + y), width: bounds.width, height: bounds.height };
}

function translateComposition(composition: PaperComposedTextFrame, x: number, y: number): PaperComposedTextFrame {
  const translateBox = <T extends { xPt: number; yPt: number }>(box: T): T => ({ ...box, xPt: round(box.xPt + x), yPt: round(box.yPt + y) });
  const translateRun = (run: PaperPositionedGlyphRun): PaperPositionedGlyphRun => ({
    ...run,
    glyphs: run.glyphs.map((glyph) => ({ ...glyph, xPt: round(glyph.xPt + x), yPt: round(glyph.yPt + y) })),
  });
  const translateParagraph = (box: PaperComposedParagraphBox): PaperComposedParagraphBox => translateBox(box);
  const translateEmphasis = (mark: PaperComposedEmphasisMark): PaperComposedEmphasisMark => translateBox(mark);
  return {
    ...composition,
    bounds: translateBox(composition.bounds),
    lines: composition.lines.map((line) => ({
      ...line,
      originXPt: round(line.originXPt + x),
      originYPt: round(line.originYPt + y),
      ...(line.layoutBounds ? { layoutBounds: translateBox(line.layoutBounds) } : {}),
      runs: line.runs.map(translateRun),
    })),
    caretMap: composition.caretMap.map((caret) => ({ ...caret, xPt: round(caret.xPt + x), yPt: round(caret.yPt + y) })),
    ...(composition.paragraphBoxes ? { paragraphBoxes: composition.paragraphBoxes.map(translateParagraph) } : {}),
    ...(composition.emphasisMarks ? { emphasisMarks: composition.emphasisMarks.map(translateEmphasis) } : {}),
  };
}

function textPaints(composed: PaperComposedTextFrame, context: CompileContext, reasons: string[]): PaperRenderTextPaints {
  const runs: PaperRenderTextRunPaint[] = [];
  for (const [lineIndex, line] of composed.lines.entries()) {
    for (const [runIndex, run] of line.runs.entries()) {
      const fill = paintFor(context, run.color, true, reasons, 'unsupported-text-paint');
      if (!fill) continue;
      const highlight = run.decorations?.highlight
        ? paintFor(context, { color: run.decorations.highlight }, true, reasons, 'unsupported-text-highlight')
        : undefined;
      runs.push({ lineIndex, runIndex, fill, ...(highlight ? { highlight } : {}) });
    }
  }
  const paragraphBoxes: PaperRenderParagraphPaint[] = (composed.paragraphBoxes ?? []).map((box, paragraphIndex) => {
    const borders: Partial<Record<'top' | 'right' | 'bottom' | 'left', PaperPrintPaint>> = {};
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const source = box.borders?.[edge];
      if (!source) continue;
      const paint = paintFor(context, { color: source.color }, true, reasons, 'unsupported-paragraph-border');
      if (paint) borders[edge] = paint;
    }
    const fill = box.fill ? paintFor(context, box.fill, true, reasons, 'unsupported-paragraph-fill') : undefined;
    return {
      paragraphIndex,
      ...(fill ? { fill } : {}),
      ...(Object.keys(borders).length ? { borders } : {}),
    };
  });
  const emphasisMarks = (composed.emphasisMarks ?? []).flatMap((mark) => {
    const paint = paintFor(context, mark.color, true, reasons, 'unsupported-emphasis-paint');
    return paint ? [paint] : [];
  });
  return { runs, paragraphBoxes, emphasisMarks };
}

function frameTextOrigin(frame: PaperFrame, bleedPt: number): { x: number; y: number } {
  // `composePaperTextFrame` already starts at the local content box (padding or bubble text-box offset).
  // The render plan adds only the frame's page origin, otherwise every text frame drifts by its inset twice.
  return { x: bleedPt + mmToPt(frame.xMm), y: bleedPt + mmToPt(frame.yMm) };
}

function imageTransform(frame: PaperFrame, bleedPt: number): PaperAffineTransform {
  const frameWidthPt = mmToPt(frame.widthMm);
  const frameHeightPt = mmToPt(frame.heightMm);
  const frameAspect = frame.widthMm / Math.max(0.0001, frame.heightMm);
  const assetWidth = frame.asset?.pixelWidth && frame.asset.pixelWidth > 0 ? frame.asset.pixelWidth : undefined;
  const assetHeight = frame.asset?.pixelHeight && frame.asset.pixelHeight > 0 ? frame.asset.pixelHeight : undefined;
  const assetAspect = assetWidth && assetHeight ? assetWidth / assetHeight : frameAspect;
  const scale = Math.max(0.05, Number.isFinite(frame.imageScale) ? frame.imageScale : 1);
  const widthPercent = frame.fit === 'stretch'
    ? 100 * scale
    : frame.fit === 'contain'
      ? assetAspect >= frameAspect ? 100 * scale : assetAspect / frameAspect * 100 * scale
      : assetAspect >= frameAspect ? assetAspect / frameAspect * 100 * scale : 100 * scale;
  const heightPercent = frame.fit === 'stretch'
    ? 100 * scale
    : frame.fit === 'contain'
      ? assetAspect >= frameAspect ? frameAspect / assetAspect * 100 * scale : 100 * scale
      : assetAspect >= frameAspect ? 100 * scale : frameAspect / assetAspect * 100 * scale;
  const widthPt = frameWidthPt * widthPercent / 100;
  const heightPt = frameHeightPt * heightPercent / 100;
  const offsetX = Number.isFinite(frame.imageOffsetXPercent) ? frame.imageOffsetXPercent : 0;
  const offsetY = Number.isFinite(frame.imageOffsetYPercent) ? frame.imageOffsetYPercent : 0;
  const centerX = bleedPt + mmToPt(frame.xMm) + frameWidthPt * (0.5 + offsetX / 100);
  const centerY = bleedPt + mmToPt(frame.yMm) + frameHeightPt * (0.5 + offsetY / 100);
  const radians = (Number.isFinite(frame.imageRotationDeg) ? frame.imageRotationDeg : 0) * Math.PI / 180;
  const signX = frame.imageFlipX ? -1 : 1;
  const signY = frame.imageFlipY ? -1 : 1;
  const a = round(Math.cos(radians) * widthPt * signX);
  const b = round(Math.sin(radians) * widthPt * signX);
  const c = round(-Math.sin(radians) * heightPt * signY);
  const d = round(Math.cos(radians) * heightPt * signY);
  return [a, b, c, d, round(centerX - (a + c) / 2), round(centerY - (b + d) / 2)];
}

function imageBounds(transform: PaperAffineTransform): PaperRenderBounds {
  return boundsFromPoints([
    applyTransform(transform, 0, 0),
    applyTransform(transform, 1, 0),
    applyTransform(transform, 1, 1),
    applyTransform(transform, 0, 1),
  ]);
}

async function compileNativeFrame(
  frame: PaperFrame,
  context: CompileContext,
  allowText = true,
  suppressShape = false,
): Promise<{ nodes: PaperRenderNode[]; reasons: string[] }> {
  const reasons: string[] = [];
  const transform = framePercentTransform(frame, context.bleedPt);
  const boundsPt = frameBounds(frame, context.bleedPt);
  const fillRequired = hasVisibleColor(frame.fillColor, frame.fillOpacity) && frame.kind !== 'shape' || (frame.kind === 'shape' && frame.shapeKind !== 'line' && hasVisibleColor(frame.fillColor, frame.fillOpacity));
  const strokeRequired = hasVisibleColor(frame.strokeColor, frame.strokeOpacity) && nonNegative(frame.strokeWidthMm) > 0;
  const fill = !suppressShape && fillRequired
    ? paintFor(context, sourceForFrame(frame.fillColor, frame.fillSwatchId, frame.fillTintPercent), true, reasons, 'unsupported-fill-paint')
    : undefined;
  const stroke = !suppressShape && strokeRequired
    ? paintFor(context, sourceForFrame(frame.strokeColor, frame.strokeSwatchId, frame.strokeTintPercent), true, reasons, 'unsupported-stroke-paint')
    : undefined;
  const nodes: PaperRenderNode[] = [];
  if (fill || stroke) {
    nodes.push({
      kind: 'path',
      objectId: frame.id,
      sourceFrameId: frame.id,
      path: framePath(frame),
      fill,
      stroke,
      opacity: clampUnit(frame.opacity),
      fillOpacity: clampUnit(frame.fillOpacity),
      strokeOpacity: clampUnit(frame.strokeOpacity),
      strokeWidthPt: mmToPt(nonNegative(frame.strokeWidthMm)),
      strokeStyle: frame.strokeStyle,
      overprint: context.overprint,
      transform,
      boundsPt,
    });
  }

  if (frame.kind === 'image') {
    if (frame.asset?.locator?.kind === 'managed') {
      const imageNode: PaperRenderImageNode = {
        kind: 'image',
        objectId: frame.id,
        sourceFrameId: frame.id,
        asset: frame.asset.locator.ref,
        clipPath: framePath(frame),
        clipTransform: transform,
        transform: imageTransform(frame, context.bleedPt),
        opacity: clampUnit(frame.opacity),
        boundsPt: imageBounds(imageTransform(frame, context.bleedPt)),
      };
      nodes.push(imageNode);
    } else if (frame.asset) {
      reasons.push('unmanaged-image-asset');
    }
  }

  if (frame.kind === 'barcode') {
    await appendBarcodeNodes(frame, context, allowText, reasons, nodes, boundsPt);
  }

  if (allowText && isTextBearingFrame(frame) && frameHasText(frame)) {
    const composed = translateComposition(
      await composePaperTextFrame(frame, context.document, context.managedFontResolver),
      frameTextOrigin(frame, context.bleedPt).x,
      frameTextOrigin(frame, context.bleedPt).y,
    );
    const paints = textPaints(composed, context, reasons);
    const centerX = context.bleedPt + mmToPt(frame.xMm + frame.widthMm / 2);
    const centerY = context.bleedPt + mmToPt(frame.yMm + frame.heightMm / 2);
    nodes.push({
      kind: 'text',
      objectId: frame.id,
      sourceFrameId: frame.id,
      composed,
      paints,
      opacity: clampUnit(frame.opacity),
      overprint: context.overprint,
      transform: rotationAbout(centerX, centerY, frame.rotationDeg),
      boundsPt: translateBounds({
        x: composed.bounds.xPt,
        y: composed.bounds.yPt,
        width: composed.bounds.widthPt,
        height: composed.bounds.heightPt,
      }, 0, 0),
    });
  }
  return { nodes, reasons };
}

/** Native EAN-13 bar and optional human-readable text nodes from shared deterministic geometry. */
async function appendBarcodeNodes(
  frame: PaperFrame,
  context: CompileContext,
  allowText: boolean,
  reasons: string[],
  nodes: PaperRenderNode[],
  frameBoundsPt: PaperRenderBounds,
): Promise<void> {
  const geometry = buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm);
  const barPaint = hasVisibleColor(frame.strokeColor, frame.strokeOpacity)
    ? paintFor(context, sourceForFrame(frame.strokeColor, frame.strokeSwatchId, frame.strokeTintPercent), true, reasons, 'unsupported-barcode-paint')
    : undefined;
  const widthMm = frame.widthMm > 0 ? frame.widthMm : 1;
  const heightMm = frame.heightMm > 0 ? frame.heightMm : 1;
  if (barPaint && geometry.bars.length > 0) {
    const path = geometry.bars
      .map((bar) => rectanglePath(
        bar.xMm / widthMm * 100,
        bar.yMm / heightMm * 100,
        bar.widthMm / widthMm * 100,
        bar.heightMm / heightMm * 100,
      ))
      .join(' ');
    nodes.push({
      kind: 'path',
      objectId: `${frame.id}:barcode`,
      sourceFrameId: frame.id,
      path,
      fill: barPaint,
      opacity: clampUnit(frame.opacity),
      fillOpacity: 1,
      strokeOpacity: 0,
      strokeWidthPt: 0,
      strokeStyle: 'solid',
      overprint: context.overprint,
      transform: framePercentTransform(frame, context.bleedPt),
      boundsPt: frameBoundsPt,
    });
  }

  if (!allowText || geometry.humanReadableGroups.length === 0 || geometry.humanReadableZoneMm <= 0) return;

  const centerX = context.bleedPt + mmToPt(frame.xMm + frame.widthMm / 2);
  const centerY = context.bleedPt + mmToPt(frame.yMm + frame.heightMm / 2);
  const rotation = rotationAbout(centerX, centerY, frame.rotationDeg);
  const groupSpanMm: Record<number, number> = {
    0: PAPER_EAN13_NOMINAL.leftQuietZoneModules,
    1: 42,
    2: 42,
  };
  for (const [groupIndex, group] of geometry.humanReadableGroups.entries()) {
    const groupWidthMm = groupSpanMm[groupIndex] * geometry.moduleWidthMm;
    if (groupWidthMm <= 0) continue;
    const hriFrame: PaperFrame = {
      ...frame,
      kind: 'shape',
      id: frame.id,
      text: group.text,
      richText: undefined,
      columns: 1,
      xMm: frame.xMm + group.centerMm - groupWidthMm / 2,
      yMm: frame.yMm + geometry.barHeightMm,
      widthMm: groupWidthMm,
      heightMm: geometry.humanReadableZoneMm,
      rotationDeg: 0,
      textBoxXPercent: 0,
      textBoxYPercent: 0,
      textBoxWidthPercent: 100,
      textBoxHeightPercent: 100,
      textRotationDeg: 0,
      textVerticalAlign: 'top',
      typography: {
        ...frame.typography,
        fontSizePt: geometry.humanReadableFontPt,
        leadingPt: geometry.humanReadableFontPt * 1.2,
        align: 'center',
        alignLast: 'auto',
        hyphenate: false,
        color: frame.strokeColor,
        colorSwatchId: frame.strokeSwatchId,
        firstLineIndentMm: 0,
        tracking: 0,
      },
    };
    const composed = translateComposition(
      await composePaperTextFrame(hriFrame, context.document, context.managedFontResolver),
      frameTextOrigin(hriFrame, context.bleedPt).x,
      frameTextOrigin(hriFrame, context.bleedPt).y,
    );
    const paints = textPaints(composed, context, reasons);
    nodes.push({
      kind: 'text',
      objectId: `${frame.id}:barcode-hri-${groupIndex}`,
      sourceFrameId: frame.id,
      composed,
      paints,
      opacity: clampUnit(frame.opacity),
      overprint: context.overprint,
      transform: rotation,
      boundsPt: {
        x: composed.bounds.xPt,
        y: composed.bounds.yPt,
        width: composed.bounds.widthPt,
        height: composed.bounds.heightPt,
      },
    });
  }
}

function appendCompoundBubbleShapes(
  shapes: PaperCompoundBubbleShape[],
  frames: PaperFrame[],
  context: CompileContext,
  nodes: PaperRenderNode[],
): void {
  for (const shape of shapes) {
    const frame = frames.find((candidate) => candidate.id === shape.sourceFrameId);
    if (!frame || shape.outline.length < 3) continue;
    const reasons: string[] = [];
    const fill = hasVisibleColor(frame.fillColor, frame.fillOpacity)
      ? paintFor(context, sourceForFrame(frame.fillColor, frame.fillSwatchId, frame.fillTintPercent), true, reasons, 'unsupported-compound-bubble-fill')
      : undefined;
    const stroke = hasVisibleColor(frame.strokeColor, frame.strokeOpacity) && nonNegative(frame.strokeWidthMm) > 0
      ? paintFor(context, sourceForFrame(frame.strokeColor, frame.strokeSwatchId, frame.strokeTintPercent), true, reasons, 'unsupported-compound-bubble-stroke')
      : undefined;
    if (reasons.length || (!fill && !stroke)) continue;
    const points = shape.outline.map((value) => ({
      x: context.bleedPt + mmToPt(value.xMm),
      y: context.bleedPt + mmToPt(value.yMm),
    }));
    nodes.push({
      kind: 'path',
      objectId: `bubble-compound:${shape.id}`,
      sourceFrameId: frame.id,
      path: `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`,
      fill,
      stroke,
      opacity: clampUnit(frame.opacity),
      fillOpacity: clampUnit(frame.fillOpacity),
      strokeOpacity: clampUnit(frame.strokeOpacity),
      strokeWidthPt: mmToPt(nonNegative(frame.strokeWidthMm)),
      strokeStyle: frame.strokeStyle,
      overprint: context.overprint,
      boundsPt: boundsFromPoints(points),
    });
  }
}

function appendBubbleConnectorSegments(
  segments: PaperBubbleConnectorSegment[],
  frames: PaperFrame[],
  context: CompileContext,
  nodes: PaperRenderNode[],
): void {
  for (const segment of segments) {
    const frame = frames.find((candidate) => candidate.id === segment.fromFrameId);
    if (!frame) continue;
    const reasons: string[] = [];
    const stroke = paintFor(context, sourceForFrame(frame.strokeColor, frame.strokeSwatchId, frame.strokeTintPercent), true, reasons, 'unsupported-connector-paint');
    if (!stroke || reasons.length) continue;
    const point = (value: { xMm: number; yMm: number }) => ({ x: context.bleedPt + mmToPt(value.xMm), y: context.bleedPt + mmToPt(value.yMm) });
    if (segment.style === 'bridge') {
      const fill = paintFor(context, sourceForFrame(frame.fillColor, frame.fillSwatchId, frame.fillTintPercent), true, reasons, 'unsupported-bridge-paint');
      const polygon = segment.bridgePolygon.map(point);
      if (!fill || reasons.length || polygon.length < 3) continue;
      nodes.push({
        kind: 'path',
        objectId: `connector:${segment.fromFrameId}:${segment.toFrameId}`,
        sourceFrameId: frame.id,
        path: `${polygon.map((vertex, index) => `${index === 0 ? 'M' : 'L'} ${vertex.x} ${vertex.y}`).join(' ')} Z`,
        fill,
        stroke,
        opacity: clampUnit(frame.opacity),
        fillOpacity: clampUnit(frame.fillOpacity),
        strokeOpacity: clampUnit(frame.strokeOpacity),
        strokeWidthPt: mmToPt(Math.max(0.25, nonNegative(frame.strokeWidthMm) || 0.35)),
        strokeStyle: 'solid',
        overprint: context.overprint,
        boundsPt: boundsFromPoints(polygon),
      });
      continue;
    }
    if (segment.style === 'thought-dots') {
      const circles = segment.dots.map((dot, index) => {
        const center = point(dot);
        const radius = mmToPt(Math.max(0.8, nonNegative(frame.strokeWidthMm) * (2.6 - index * 0.18)));
        const k = 0.5522847498307936;
        return `M ${round(center.x + radius)} ${center.y} C ${round(center.x + radius)} ${round(center.y + radius * k)} ${round(center.x + radius * k)} ${round(center.y + radius)} ${center.x} ${round(center.y + radius)} C ${round(center.x - radius * k)} ${round(center.y + radius)} ${round(center.x - radius)} ${round(center.y + radius * k)} ${round(center.x - radius)} ${center.y} C ${round(center.x - radius)} ${round(center.y - radius * k)} ${round(center.x - radius * k)} ${round(center.y - radius)} ${center.x} ${round(center.y - radius)} C ${round(center.x + radius * k)} ${round(center.y - radius)} ${round(center.x + radius)} ${round(center.y - radius * k)} ${round(center.x + radius)} ${center.y} Z`;
      }).join(' ');
      nodes.push({ kind: 'path', objectId: `connector:${segment.fromFrameId}:${segment.toFrameId}`, sourceFrameId: frame.id, path: circles, fill: stroke, opacity: clampUnit(frame.opacity), fillOpacity: 0.88, strokeOpacity: 0, strokeWidthPt: 0, strokeStyle: 'solid', overprint: context.overprint, boundsPt: frameBounds(frame, context.bleedPt) });
      continue;
    }
    const from = point(segment.from);
    const to = point(segment.to);
    const path = segment.style === 'tail'
      ? (() => {
          const control = point(segment.control);
          const controlOne = { x: round(from.x + (2 / 3) * (control.x - from.x)), y: round(from.y + (2 / 3) * (control.y - from.y)) };
          const controlTwo = { x: round(to.x + (2 / 3) * (control.x - to.x)), y: round(to.y + (2 / 3) * (control.y - to.y)) };
          return `M ${from.x} ${from.y} C ${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${to.x} ${to.y}`;
        })()
      : `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    nodes.push({ kind: 'path', objectId: `connector:${segment.fromFrameId}:${segment.toFrameId}`, sourceFrameId: frame.id, path, stroke, opacity: clampUnit(frame.opacity), fillOpacity: 0, strokeOpacity: clampUnit(frame.strokeOpacity), strokeWidthPt: mmToPt(Math.max(0.25, nonNegative(frame.strokeWidthMm) || 0.35)), strokeStyle: 'solid', overprint: context.overprint, boundsPt: frameBounds(frame, context.bleedPt) });
  }
}

async function compilePageBackground(page: PaperPage, context: CompileContext, widthPt: number, heightPt: number): Promise<PaperRenderNode | undefined> {
  const background = context.document.background;
  if (background.type !== 'solid') {
    const child: PaperRenderPathNode = {
      kind: 'path',
      objectId: `page:${page.id}:background`,
      path: `M 0 0 L ${widthPt} 0 L ${widthPt} ${heightPt} L 0 ${heightPt} Z`,
      fill: context.resolvePaint({ color: background.color }),
      opacity: 1,
      fillOpacity: 1,
      strokeOpacity: 0,
      strokeWidthPt: 0,
      strokeStyle: 'solid',
      overprint: false,
      boundsPt: { x: 0, y: 0, width: widthPt, height: heightPt },
    };
    return {
      kind: 'flatten-group',
      objectId: `page:${page.id}:background`,
      sourceFrameIds: [],
      reasonCodes: ['background-gradient'],
      boundsPt: child.boundsPt,
      children: [child],
    };
  }
  const paint = context.resolvePaint({ color: background.color });
  if (!paint) return undefined;
  return {
    kind: 'path',
    objectId: `page:${page.id}:background`,
    path: `M 0 0 L ${widthPt} 0 L ${widthPt} ${heightPt} L 0 ${heightPt} Z`,
    fill: paint,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 0,
    strokeWidthPt: 0,
    strokeStyle: 'solid',
    overprint: false,
    boundsPt: { x: 0, y: 0, width: widthPt, height: heightPt },
  };
}

/** Compile the document once; preview, PDF/X, and preflight consume this immutable semantic scene graph. */
export async function compilePaperRenderPlan(
  document: PaperDocument,
  options: PaperRenderPlanOptions = {},
): Promise<PaperRenderPlan> {
  const resolvePaint = options.resolvePaint ?? ((source: PaperPrintPaintInput) => resolvePaperPrintPaint(source, document.swatches));
  const managedFontResolver = options.managedFontResolver ?? (async () => undefined);
  const bleedPt = mmToPt(document.page.bleedMm);
  const trimWidthPt = mmToPt(document.page.widthMm);
  const trimHeightPt = mmToPt(document.page.heightMm);
  const mediaWidthPt = round(trimWidthPt + bleedPt * 2);
  const mediaHeightPt = round(trimHeightPt + bleedPt * 2);
  const printSheet = buildPaperPrintSheetPlan(document.page, document.printProduction);
  const context: CompileContext = {
    document,
    resolvePaint,
    managedFontResolver,
    bleedPt,
    overprint: document.printProduction.overprintPreview,
  };
  const pages: PaperRenderPlanPage[] = [];
  for (const page of document.pages) {
    const nodes: PaperRenderNode[] = [];
    const outputFrames = resolvePaperThreadedFrames(
      resolvePaperFramesTextTemplates(resolvePaperPageFramesForOutput(document, page), document, page.pageNumber),
      createPaperCanvasMeasurer(),
    );
    const connectorLayersByZIndex = new Map(
      buildPaperCanvasBubbleConnectorLayers(outputFrames)
        .map((layer) => [layer.canvasZIndex, layer] as const),
    );
    const compoundBubbleFrameIds = new Set(
      [...connectorLayersByZIndex.values()].flatMap((layer) => (
        layer.compoundShapes.flatMap((shape) => shape.memberFrameIds)
      )),
    );
    for (const [frameIndex, frame] of outputFrames.entries()) {
      const connectorLayer = connectorLayersByZIndex.get(PAPER_CANVAS_FRAME_Z_START + frameIndex);
      if (connectorLayer) {
        appendCompoundBubbleShapes(connectorLayer.compoundShapes, outputFrames, context, nodes);
        appendBubbleConnectorSegments(connectorLayer.segments, outputFrames, context, nodes);
      }
      const hardReasons = flattenReasons(frame);
      const compiled = await compileNativeFrame(
        frame,
        context,
        hardReasons.length === 0,
        compoundBubbleFrameIds.has(frame.id),
      );
      const reasons = [...new Set([...hardReasons, ...compiled.reasons])];
      if (reasons.length) {
        nodes.push({
          kind: 'flatten-group',
          objectId: frame.id,
          sourceFrameIds: [frame.id],
          reasonCodes: reasons,
          boundsPt: frameBounds(frame, bleedPt),
          children: compiled.nodes,
        });
      } else {
        nodes.push(...compiled.nodes);
      }
    }
    pages.push({
      pageId: page.id,
      pageNumber: page.pageNumber,
      trimWidthPt,
      trimHeightPt,
      bleedPt,
      printSheet,
      productionMarks: compilePaperProductionMarks(printSheet),
      background: await compilePageBackground(page, context, mediaWidthPt, mediaHeightPt),
      nodes,
    });
  }
  return {
    documentId: document.id,
    revision: Number.isFinite(document.updatedAt) ? document.updatedAt : 0,
    pages,
  };
}
