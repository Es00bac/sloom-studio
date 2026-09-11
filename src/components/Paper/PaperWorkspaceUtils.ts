import { exportPaperDocumentToPrintHtml, updatePaperDocumentSetup } from '../../lib/paperDocument';
import {
  buildPaperPdfExportRequest,
  buildPaperRasterPdfExportRequest,
  safePaperPdfFileName,
  type PaperPdfExportRequest,
} from '../../lib/paperPdfExport';
import {
  buildPaperWebcomicImageArchiveExport,
  buildPaperWebcomicImageDataPages,
  buildPaperWebcomicImageExportPlan,
  type PaperWebcomicImageExportOptions,
} from '../../lib/paperWebcomicExport';
import {
  buildPaperEpub,
  buildPaperEpubPlan,
  summarizePaperEpubReport,
  validatePaperEpub,
  validatePaperEpubPlan,
  validatePaperEpubRasterization,
} from '../../lib/paperEpubExport';
import { resolveBubbleTailCurvePercent } from '../../lib/paperBubblePaths';
import { getSignalLoomNativeBridge, type NativePaperEpubExportResult, type NativePaperPdfExportResult } from '../../lib/nativeApp';
import { buildProvenanceLabel } from '../../lib/exportProvenance';
import {
  downloadBlob as downloadSharedBlob,
  downloadTextFile,
  downloadTextFileWithOutcome,
} from '../../lib/downloadAsset';
import { exportPaperDocumentToPdfxInBrowser } from '../../lib/paperPdfxBrowser';
import {
  createPaperPlacedDocumentRasterizationGuard,
  type PaperPlacedDocumentRasterizationGuard,
} from '../../lib/paperPlacedDocumentRasterization';
import { validatePaperPdfx } from '../../lib/paperPdfxValidate';
import {
  buildPaperTaggedPdf,
  summarizePaperTaggedPdfReport,
  validatePaperTaggedPdf,
  validatePaperTaggedPdfDocument,
} from '../../lib/paperTaggedPdf';
import { exportValidatedPaperPdfx, type PaperProductionPreflightOptions } from '../../lib/paperProductionPreflight';
import { formatProductionValidationStatus } from '../../lib/paperProductionReport';
import { normalizePaperPrintProductionSpec } from '../../lib/paperPrintProduction';
import { paperPrintMarksEnabled } from '../../lib/paperPrintMarks';
import {
  buildPaperDocumentExactManagedFontOutput,
  materializePaperDocumentAssetUrls,
  paperAssetRepository,
} from '../../features/paper/assets/PaperAssetRuntime';
import { verifyExactPaperManagedFontReadiness } from '../../lib/paperExactManagedFonts';
import { verifyBinaryAssetRecord, type BinaryAssetRef } from '../../shared/assets/contentAddressedAsset';
import { usePaperStore } from '../../store/paperStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import {
  clientPointToPaperPoint,
  MIN_PAPER_FRAME_HEIGHT_MM,
  MIN_PAPER_FRAME_WIDTH_MM,
  PAPER_SCREEN_PX_PER_MM as PX_PER_MM,
  paperGuidePositionFromClientPoint,
  paperTextVerticalAlignToJustifyContent,
  resolvePaperTextBox,
  type PaperGuideOrientation,
  type PaperPoint,
  type PaperResizeHandle,
} from '../../lib/paperLayoutTools';
import type {
  PaperPdfRasterPreset,
} from '../../types/flow';
import type {
  PaperDocument,
  PaperFrame,
  PaperFrameKind,
  PaperFramePatch,
  PaperPagePreset,
  PaperTool,
} from '../../types/paper';

export type PaperBubbleHandle = 'tail' | 'curve' | 'pinch' | 'left' | 'right' | 'top' | 'bottom';
type PaperVertexEditOptions = {
  snapToBorder?: boolean;
  borderSnapThresholdMm?: number;
};

export interface EyedropperPixelSource {
  bitmap: (CanvasImageSource & { width: number; height: number });
  x: number;
  y: number;
}

export interface EyedropperPixelColorResult {
  color: string;
}

export interface EyedropperPixelUnsupportedReason {
  reason: string;
}

export type EyedropperPixelResult = EyedropperPixelColorResult | EyedropperPixelUnsupportedReason;

export interface PaperEyedropperPixelSource extends EyedropperPixelSource {
  kind: 'image' | 'page';
  sourceLabel?: string;
}

export interface PaperEyedropperPixelResult {
  color: string;
  sourceKind: 'image' | 'page';
  sourceLabel: string;
}

export type PaperEyedropperPixelColorResult = PaperEyedropperPixelResult | EyedropperPixelUnsupportedReason;

const PAPER_EYEDROPPER_DEFAULT_SOURCE_LABEL: Record<PaperEyedropperPixelSource['kind'], string> = {
  image: 'Paper image',
  page: 'Paper page',
};

export function samplePixelColorFromCanvas(source: EyedropperPixelSource): EyedropperPixelResult {
  const x = Math.floor(source.x);
  const y = Math.floor(source.y);
  if (x < 0 || y < 0 || x >= source.bitmap.width || y >= source.bitmap.height) {
    return { reason: 'Sample point is outside the available pixel source.' };
  }

  const tmp = new OffscreenCanvas(1, 1);
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { reason: 'Unable to read pixel data because no 2D canvas context is available.' };
  }

  ctx.drawImage(source.bitmap, x, y, 1, 1, 0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  if (data[3] === 0) {
    return { reason: 'Sampled pixel is fully transparent.' };
  }

  const color = `#${[data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  return { color };
}

export function resolvePaperEyedropperPixelColor(source?: PaperEyedropperPixelSource | null): PaperEyedropperPixelColorResult {
  if (!source) {
    return { reason: 'No image/page pixel source is available for Paper eyedropper sampling.' };
  }

  const sample = samplePixelColorFromCanvas(source);
  if ('reason' in sample) {
    return sample;
  }

  return {
    color: sample.color,
    sourceKind: source.kind,
    sourceLabel: source.sourceLabel ?? PAPER_EYEDROPPER_DEFAULT_SOURCE_LABEL[source.kind],
  };
}

export function frameKindForTool(tool: PaperTool): PaperFrameKind | null {
  switch (tool) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'speech':
      return 'speechBubble';
    case 'thought':
      return 'thoughtBubble';
    case 'caption':
      return 'caption';
    case 'panel':
      return 'panel';
    case 'barcode':
      return 'barcode';
    case 'line':
    case 'ellipse':
    case 'triangle':
    case 'pentagon':
    case 'hexagon':
      return 'shape';
    case 'shape':
      return 'shape';
    case 'hand':
    case 'select':
    case 'eyedropper':
    case 'gutterKnife':
    case 'tiltmark':
      return null;
    default:
      return null;
  }
}

export function shapeKindForTool(tool: PaperTool): PaperFrame['shapeKind'] | undefined {
  switch (tool) {
    case 'line':
      return 'line';
    case 'ellipse':
      return 'ellipse';
    case 'triangle':
      return 'triangle';
    case 'pentagon':
      return 'pentagon';
    case 'hexagon':
      return 'hexagon';
    default:
      return undefined;
  }
}

export function toolLabel(tool: PaperTool): string {
  if (tool === 'hand') return 'Hand';
  if (tool === 'eyedropper') return 'Eyedropper';
  if (tool === 'gutterKnife') return 'Gutter knife';
  if (tool === 'tiltmark') return 'Tiltmark paint';
  const kind = frameKindForTool(tool);
  return kind ? frameKindLabel(kind) : 'Select';
}

export function resolvePaperEyedropperFrameColor(frame: PaperFrame): string {
  if ((frame.kind === 'text' || frame.kind === 'caption') && isOpaqueColor(frame.typography.color)) {
    return frame.typography.color;
  }

  if (frame.shapeKind === 'line' && isOpaqueColor(frame.strokeColor)) {
    return frame.strokeColor;
  }

  if (frame.fillOpacity > 0 && isOpaqueColor(frame.fillColor)) {
    return frame.fillColor;
  }

  if (frame.strokeOpacity > 0 && frame.strokeWidthMm > 0 && isOpaqueColor(frame.strokeColor)) {
    return frame.strokeColor;
  }

  if (isOpaqueColor(frame.typography.color)) {
    return frame.typography.color;
  }

  return '#000000';
}

export function buildPaperEyedropperFrameColorPatch(frame: PaperFrame, color: string): PaperFramePatch {
  if (frame.kind === 'text' || frame.kind === 'caption') {
    return { typography: { color } };
  }

  if (frame.shapeKind === 'line') {
    return { strokeColor: color };
  }

  return { fillColor: color };
}

function isOpaqueColor(color: string | undefined): color is string {
  if (!color) return false;
  const normalized = color.trim().toLowerCase();
  if (!normalized || normalized === 'transparent') return false;
  if (/^#[0-9a-f]{6}00$/.test(normalized)) return false;
  return true;
}

export function frameKindLabel(kind: PaperFrameKind): string {
  switch (kind) {
    case 'text':
      return 'text frame';
    case 'image':
      return 'image frame';
    case 'document':
      return 'document frame';
    case 'panel':
      return 'comic panel';
    case 'speechBubble':
      return 'speech bubble';
    case 'thoughtBubble':
      return 'thought bubble';
    case 'caption':
      return 'caption box';
    case 'shape':
      return 'shape frame';
    case 'barcode':
      return 'ISBN barcode';
  }
}

export function shapeLabel(shapeKind: PaperFrame['shapeKind']): string | null {
  switch (shapeKind) {
    case 'line':
      return 'Line';
    case 'ellipse':
      return 'Ellipse Frame';
    case 'triangle':
      return 'Triangle Frame';
    case 'pentagon':
      return 'Pentagon Frame';
    case 'hexagon':
      return 'Hexagon Frame';
    case 'polygon':
      return 'Polygon Frame';
    case undefined:
      return null;
  }
}

export function pagePresetLabel(preset: PaperPagePreset): string {
  switch (preset) {
    case 'custom':
      return 'Custom';
    case 'us-letter':
      return 'US Letter';
    case 'us-legal':
      return 'US Legal';
    case 'tabloid':
      return 'Tabloid';
    case 'a4':
      return 'A4';
    case 'a5':
      return 'A5';
    case 'square-8':
      return 'Square 8 in';
    case 'comic-book':
      return 'Comic Book';
    case 'manga-digest':
      return 'Manga Digest';
    case 'webtoon-panel':
      return 'Webtoon Panel';
  }
}

export function clientPointToPageMm(
  event: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>, 'clientX' | 'clientY'>,
  pageElement: HTMLElement,
  _doc: PaperDocument,
  zoom: number,
): PaperPoint {
  return clientPointToPaperPoint(event, pageElement.getBoundingClientRect(), zoom);
}

export function beginGuideDragFromRuler({
  event,
  orientation,
  page,
  pageEl,
  pageId,
  zoom,
  grid,
  onAddGuideToPage,
  onUpdateGuide,
}: {
  event: React.PointerEvent<HTMLDivElement>;
  orientation: PaperGuideOrientation;
  page: Pick<PaperDocument['page'], 'widthMm' | 'heightMm'>;
  pageEl: HTMLElement;
  pageId: string;
  zoom: number;
  grid?: PaperDocument['layout']['grid'];
  onAddGuideToPage: ReturnType<typeof usePaperStore.getState>['addGuideToPage'];
  onUpdateGuide: ReturnType<typeof usePaperStore.getState>['updateGuide'];
}) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const guideId = onAddGuideToPage(pageId, {
    orientation,
    positionMm: paperGuidePositionFromClientPoint(
      event,
      orientation,
      pageEl.getBoundingClientRect(),
      page,
      zoom,
      undefined,
      {
        grid,
        shiftKey: event.shiftKey,
      },
    ),
    label: orientation === 'vertical' ? 'Custom vertical' : 'Custom horizontal',
  });
  if (!guideId) return;

  const handleMove = (moveEvent: PointerEvent) => {
    onUpdateGuide(pageId, guideId, {
      positionMm: paperGuidePositionFromClientPoint(
        moveEvent,
        orientation,
        pageEl.getBoundingClientRect(),
        page,
        zoom,
        undefined,
        {
          grid,
          shiftKey: moveEvent.shiftKey,
        },
      ),
    });
  };
  const handleUp = () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
  };

  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp, { once: true });
}

export function verticesForShapeKind(shapeKind: PaperFrame['shapeKind']): PaperFrame['vertices'] {
  switch (shapeKind) {
    case 'line':
      return [
        { xPercent: 0, yPercent: 50 },
        { xPercent: 100, yPercent: 50 },
      ];
    case 'triangle':
    case 'polygon':
    case undefined:
      return [
        { xPercent: 50, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ];
    case 'pentagon':
      return [
        { xPercent: 50, yPercent: 0 },
        { xPercent: 98, yPercent: 36 },
        { xPercent: 80, yPercent: 100 },
        { xPercent: 20, yPercent: 100 },
        { xPercent: 2, yPercent: 36 },
      ];
    case 'hexagon':
      return [
        { xPercent: 25, yPercent: 0 },
        { xPercent: 75, yPercent: 0 },
        { xPercent: 100, yPercent: 50 },
        { xPercent: 75, yPercent: 100 },
        { xPercent: 25, yPercent: 100 },
        { xPercent: 0, yPercent: 50 },
      ];
    case 'ellipse':
      return undefined;
  }
}

export function verticesForEditableFrame(frame: PaperFrame): PaperFrame['vertices'] {
  if (frame.kind === 'shape') {
    if (frame.vertices?.length) return frame.vertices;
    if (frame.shapeKind === 'ellipse') return undefined;
    return verticesForShapeKind(frame.shapeKind);
  }

  if (frame.kind === 'panel' || frame.kind === 'image') {
    return frame.vertices && frame.vertices.length >= 3 ? frame.vertices : rectangleVertices();
  }

  if (frame.kind === 'caption') {
    return frame.vertices && frame.vertices.length >= 3 && !isDefaultShapeTriangleVertices(frame.vertices)
      ? frame.vertices
      : rectangleVertices();
  }

  return undefined;
}

export function frameFillCss(frame: PaperFrame): string {
  if (frame.fillGradient) {
    return `linear-gradient(${frame.fillGradient.angleDeg}deg, ${frame.fillGradient.fromColor}, ${frame.fillGradient.toColor})`;
  }
  return colorWithOpacity(frame.fillColor, frame.fillOpacity);
}

export function paperTextBoxReactStyle(frame: PaperFrame): React.CSSProperties {
  const textBox = resolvePaperTextBox(frame);
  const vertical = frame.typography.writingMode === 'vertical-rl';
  const verticalAlignFlex = paperTextVerticalAlignToJustifyContent(textBox.verticalAlign);

  return {
    left: `${textBox.xPercent}%`,
    top: `${textBox.yPercent}%`,
    width: `${textBox.widthPercent}%`,
    height: `${textBox.heightPercent}%`,
    transform: `rotate(${textBox.rotationDeg}deg)`,
    transformOrigin: 'center',
    display: 'flex',
    flexDirection: 'column',
    // Horizontal text: the flex column's main axis is vertical, so the text-box vertical-align maps to
    // justify-content and horizontal placement comes from text-align. Japanese 縦書き (writing-mode: vertical-rl)
    // rotates the flex axes — the block/main axis is now horizontal — so columns are centered horizontally (the
    // manga norm) and vertical-align maps to align-items (the now-vertical cross axis) instead. Without this a
    // vertical bubble's text would jam to one side instead of centering like an English bubble.
    justifyContent: vertical ? 'center' : verticalAlignFlex,
    alignItems: vertical ? verticalAlignFlex : undefined,
    overflow: 'hidden',
    textAlign: frame.typography.align,
  };
}

export function svgFillForFrame(frame: PaperFrame): string {
  if (frame.fillGradient) return `url(#${svgGradientId(frame.id)})`;
  return colorWithOpacity(frame.fillColor, frame.fillOpacity);
}

export function svgGradientId(id: string): string {
  return `paper-gradient-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

export function gradientVector(angleDeg: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  return {
    x1: Number((50 - x * 50).toFixed(3)),
    y1: Number((50 - y * 50).toFixed(3)),
    x2: Number((50 + x * 50).toFixed(3)),
    y2: Number((50 + y * 50).toFixed(3)),
  };
}

export function colorWithOpacity(color: string, opacity: number): string {
  if (color === 'transparent') return color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const alpha = clamp(opacity, 0, 1);
  if (alpha >= 1) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function shapeStrokeWidthPx(frame: PaperFrame, zoom: number): number {
  return Math.max(1, frame.strokeWidthMm * PX_PER_MM * zoom);
}

export function paperFrameContentPaddingPx(frame: PaperFrame, zoom: number): number {
  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' || frame.kind === 'shape') return 0;
  // A frame whose paragraphs ALL carry a box border/shading hugs the frame edge: the box's border sits on the
  // frame bounds so the selection/resize rectangle lands on the visible box corners (each paragraph's own
  // border-padding still keeps text off the line). Covers one bordered paragraph AND a merged callout of several.
  // Without this, the 2mm content inset floats the box inside the frame and the handles miss the corners.
  if (frame.richText?.length && frame.richText.every((p) => p.borders || p.shading)) return 0;
  return 2 * PX_PER_MM * zoom;
}

export function clipPathForFrame(frame: PaperFrame): string | undefined {
  if (frame.kind === 'shape' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') return undefined;
  const vertices = verticesForEditableFrame(frame);
  if (vertices && vertices.length >= 3) {
    return `polygon(${vertices.map((vertex) => `${roundPercent(vertex.xPercent)}% ${roundPercent(vertex.yPercent)}%`).join(', ')})`;
  }
  if (frame.shapeKind === 'ellipse') return 'ellipse(50% 50% at 50% 50%)';
  if (frame.shapeKind === 'triangle') return 'polygon(50% 0%, 100% 100%, 0% 100%)';
  if (frame.shapeKind === 'pentagon') return 'polygon(50% 0%, 98% 36%, 80% 100%, 20% 100%, 2% 36%)';
  if (frame.shapeKind === 'hexagon') return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
  return undefined;
}

export function movePaperFrameVertexPatch(
  frame: PaperFrame,
  vertexIndex: number,
  point: PaperPoint,
  options: PaperVertexEditOptions = {},
): PaperFramePatch {
  const vertices = verticesForEditableFrame(frame);
  if (!vertices?.length || vertexIndex < 0 || vertexIndex >= vertices.length) return {};
  const resolvedPoint = resolvePaperFrameVertexPoint(frame, point, options);

  return normalizePaperFrameVerticesToBounds(
    frame,
    vertices.map((vertex, index) => index === vertexIndex
      ? {
          xPercent: roundPercent(((resolvedPoint.xMm - frame.xMm) / Math.max(1, frame.widthMm)) * 100),
          yPercent: roundPercent(((resolvedPoint.yMm - frame.yMm) / Math.max(1, frame.heightMm)) * 100),
        }
      : vertex),
  );
}

export function insertPaperFrameVertexPatch(
  frame: PaperFrame,
  edgeIndex: number,
  point?: PaperPoint,
  options: PaperVertexEditOptions = {},
): PaperFramePatch {
  const vertices = verticesForEditableFrame(frame);
  if (!vertices?.length || vertices.length < 2) return {};

  const normalizedEdgeIndex = ((edgeIndex % vertices.length) + vertices.length) % vertices.length;
  const nextIndex = (normalizedEdgeIndex + 1) % vertices.length;
  const start = vertices[normalizedEdgeIndex];
  const end = vertices[nextIndex];
  const resolvedPoint = point ? resolvePaperFrameVertexPoint(frame, point, options) : undefined;
  const inserted = point
    ? {
        xPercent: roundPercent(((resolvedPoint!.xMm - frame.xMm) / Math.max(1, frame.widthMm)) * 100),
        yPercent: roundPercent(((resolvedPoint!.yMm - frame.yMm) / Math.max(1, frame.heightMm)) * 100),
      }
    : {
        xPercent: roundPercent((start.xPercent + end.xPercent) / 2),
        yPercent: roundPercent((start.yPercent + end.yPercent) / 2),
      };

  return normalizePaperFrameVerticesToBounds(frame, [
    ...vertices.slice(0, normalizedEdgeIndex + 1),
    inserted,
    ...vertices.slice(normalizedEdgeIndex + 1),
  ]);
}

export function deletePaperFrameVertexPatch(
  frame: PaperFrame,
  vertexIndex: number,
): PaperFramePatch {
  const vertices = verticesForEditableFrame(frame);
  if (!vertices?.length || vertexIndex < 0 || vertexIndex >= vertices.length) return {};
  const minVertices = frame.shapeKind === 'line' ? 2 : 3;
  if (vertices.length <= minVertices) return {};

  return normalizePaperFrameVerticesToBounds(frame, vertices.filter((_, index) => index !== vertexIndex));
}

export function shouldShowPaperVertexHandles(
  frame: PaperFrame,
  options: {
    isSelected: boolean;
    modifierActive: boolean;
    vertexInteractionActive: boolean;
  },
): boolean {
  if (!options.isSelected || frame.inherited) return false;
  if (!options.modifierActive && !options.vertexInteractionActive) return false;
  const vertices = verticesForEditableFrame(frame);
  return Boolean(vertices?.length);
}

export function bubbleHandlePatch(frame: PaperFrame, handle: PaperBubbleHandle, point: PaperPoint): PaperFramePatch {
  const rawXPercent = roundPercent(((point.xMm - frame.xMm) / Math.max(1, frame.widthMm)) * 100);
  const rawYPercent = roundPercent(((point.yMm - frame.yMm) / Math.max(1, frame.heightMm)) * 100);
  if (handle === 'tail') return { tailXPercent: rawXPercent, tailYPercent: rawYPercent };
  if (handle === 'curve') {
    return {
      bubbleTailCurvePercent: resolveBubbleTailCurvePercent(frame, {
        x: rawXPercent,
        y: rawYPercent,
      }),
    };
  }
  const xPercent = clamp(rawXPercent, 0, 100);
  const yPercent = clamp(rawYPercent, 0, 100);
  if (handle === 'pinch') return { bubblePinchXPercent: xPercent, bubblePinchYPercent: yPercent };
  // Each side handle shapes ONLY its own edge now (independent bulge/pinch), instead of every handle
  // writing the one shared bubbleWarp. The maths mirror resolveBubbleRadii in paperBubblePaths.ts:
  // radius = base + warp * mult (base 45 / 38, mult 4 / 5), so dragging a handle to a screen % maps
  // back to that side's warp. Clamp matches the path's -0.8..0.9 per-side range.
  if (handle === 'left') return { bubbleWarpLeft: clamp((5 - xPercent) / 4, -0.8, 0.9) };
  if (handle === 'right') return { bubbleWarpRight: clamp((xPercent - 95) / 4, -0.8, 0.9) };
  if (handle === 'top') return { bubbleWarpTop: clamp((12 - yPercent) / 5, -0.8, 0.9) };
  if (handle === 'bottom') return { bubbleWarpBottom: clamp((yPercent - 88) / 5, -0.8, 0.9) };
  return {};
}

function rectangleVertices(): NonNullable<PaperFrame['vertices']> {
  return [
    { xPercent: 0, yPercent: 0 },
    { xPercent: 100, yPercent: 0 },
    { xPercent: 100, yPercent: 100 },
    { xPercent: 0, yPercent: 100 },
  ];
}

function resolvePaperFrameVertexPoint(
  frame: PaperFrame,
  point: PaperPoint,
  options: PaperVertexEditOptions,
): PaperPoint {
  if (!options.snapToBorder) return point;
  const threshold = options.borderSnapThresholdMm ?? 2.5;
  return {
    xMm: snapValueToNearestWithinThreshold(
      point.xMm,
      [frame.xMm, frame.xMm + frame.widthMm],
      threshold,
    ),
    yMm: snapValueToNearestWithinThreshold(
      point.yMm,
      [frame.yMm, frame.yMm + frame.heightMm],
      threshold,
    ),
  };
}

function snapValueToNearestWithinThreshold(value: number, candidates: number[], threshold: number): number {
  let best = value;
  let bestDistance = threshold;
  candidates.forEach((candidate) => {
    const distance = Math.abs(value - candidate);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return best;
}

function normalizePaperFrameVerticesToBounds(
  frame: PaperFrame,
  vertices: NonNullable<PaperFrame['vertices']>,
): PaperFramePatch {
  if (frame.shapeKind === 'line' || vertices.length < 3) return { vertices };
  const absoluteVertices = vertices.map((vertex) => ({
    xMm: frame.xMm + (vertex.xPercent / 100) * frame.widthMm,
    yMm: frame.yMm + (vertex.yPercent / 100) * frame.heightMm,
  }));
  let left = Math.min(...absoluteVertices.map((vertex) => vertex.xMm));
  let right = Math.max(...absoluteVertices.map((vertex) => vertex.xMm));
  let top = Math.min(...absoluteVertices.map((vertex) => vertex.yMm));
  let bottom = Math.max(...absoluteVertices.map((vertex) => vertex.yMm));
  const widthPaddingMm = Math.max(0, MIN_PAPER_FRAME_WIDTH_MM - (right - left)) / 2;
  const heightPaddingMm = Math.max(0, MIN_PAPER_FRAME_HEIGHT_MM - (bottom - top)) / 2;
  left -= widthPaddingMm;
  right += widthPaddingMm;
  top -= heightPaddingMm;
  bottom += heightPaddingMm;
  const widthMm = Math.max(MIN_PAPER_FRAME_WIDTH_MM, right - left);
  const heightMm = Math.max(MIN_PAPER_FRAME_HEIGHT_MM, bottom - top);

  const nextGeometry = {
    xMm: roundPercent(left),
    yMm: roundPercent(top),
    widthMm: roundPercent(widthMm),
    heightMm: roundPercent(heightMm),
  };
  const patch: PaperFramePatch = {
    vertices: absoluteVertices.map((vertex) => ({
      xPercent: roundPercent(((vertex.xMm - left) / widthMm) * 100),
      yPercent: roundPercent(((vertex.yMm - top) / heightMm) * 100),
    })),
  };
  if (
    nextGeometry.xMm !== roundPercent(frame.xMm)
    || nextGeometry.yMm !== roundPercent(frame.yMm)
    || nextGeometry.widthMm !== roundPercent(frame.widthMm)
    || nextGeometry.heightMm !== roundPercent(frame.heightMm)
  ) {
    patch.xMm = nextGeometry.xMm;
    patch.yMm = nextGeometry.yMm;
    patch.widthMm = nextGeometry.widthMm;
    patch.heightMm = nextGeometry.heightMm;
  }
  return patch;
}

function isDefaultShapeTriangleVertices(vertices: NonNullable<PaperFrame['vertices']>): boolean {
  return vertices.length === 3
    && vertices[0].xPercent === 50
    && vertices[0].yPercent === 0
    && vertices[1].xPercent === 100
    && vertices[1].yPercent === 100
    && vertices[2].xPercent === 0
    && vertices[2].yPercent === 100;
}

export function movePaperTextBoxPatch(
  frame: PaperFrame,
  start: PaperPoint,
  point: PaperPoint,
): PaperFramePatch {
  const textBox = resolvePaperTextBox(frame);
  const deltaXPercent = ((point.xMm - start.xMm) / Math.max(1, frame.widthMm)) * 100;
  const deltaYPercent = ((point.yMm - start.yMm) / Math.max(1, frame.heightMm)) * 100;

  return {
    textBoxXPercent: roundPercent(clamp(textBox.xPercent + deltaXPercent, 0, 100 - textBox.widthPercent)),
    textBoxYPercent: roundPercent(clamp(textBox.yPercent + deltaYPercent, 0, 100 - textBox.heightPercent)),
  };
}

export function resizePaperTextBoxPatch(
  frame: PaperFrame,
  handle: PaperResizeHandle,
  start: PaperPoint,
  point: PaperPoint,
): PaperFramePatch {
  const textBox = resolvePaperTextBox(frame);
  const deltaXPercent = ((point.xMm - start.xMm) / Math.max(1, frame.widthMm)) * 100;
  const deltaYPercent = ((point.yMm - start.yMm) / Math.max(1, frame.heightMm)) * 100;
  const minSize = 8;
  let left = textBox.xPercent;
  let top = textBox.yPercent;
  let right = textBox.xPercent + textBox.widthPercent;
  let bottom = textBox.yPercent + textBox.heightPercent;

  if (handle.includes('w')) left += deltaXPercent;
  if (handle.includes('e')) right += deltaXPercent;
  if (handle.includes('n')) top += deltaYPercent;
  if (handle.includes('s')) bottom += deltaYPercent;

  left = clamp(left, 0, 100 - minSize);
  top = clamp(top, 0, 100 - minSize);
  right = clamp(right, minSize, 100);
  bottom = clamp(bottom, minSize, 100);

  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize;
    else right = left + minSize;
  }

  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize;
    else bottom = top + minSize;
  }

  return {
    textBoxXPercent: roundPercent(left),
    textBoxYPercent: roundPercent(top),
    textBoxWidthPercent: roundPercent(right - left),
    textBoxHeightPercent: roundPercent(bottom - top),
  };
}

export function rotatePaperTextBoxTowardPointer(frame: PaperFrame, point: PaperPoint): PaperFramePatch {
  const textBox = resolvePaperTextBox(frame);
  const centerX = frame.xMm + ((textBox.xPercent + textBox.widthPercent / 2) / 100) * frame.widthMm;
  const centerY = frame.yMm + ((textBox.yPercent + textBox.heightPercent / 2) / 100) * frame.heightMm;
  const degrees = Math.atan2(point.yMm - centerY, point.xMm - centerX) * (180 / Math.PI);

  return {
    textRotationDeg: roundPercent(degrees),
  };
}

export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getDraggedSourceItemId(dataTransfer: DataTransfer): string | undefined {
  const rawPayload = dataTransfer.getData('application/x-flow-source-bin-item');
  if (!rawPayload) return undefined;
  try {
    return (JSON.parse(rawPayload) as { itemId?: string }).itemId;
  } catch {
    return undefined;
  }
}

export interface PaperPrintPreviewOutcome {
  state: 'printed' | 'html-fallback' | 'failed';
  message: string;
}

function printPreviewFailure(error: unknown): PaperPrintPreviewOutcome {
  const detail = error instanceof Error ? error.message : String(error);
  return { state: 'failed', message: `Print preview failed: ${detail}` };
}

export async function openPrintPreview(
  document: ReturnType<typeof usePaperStore.getState>['document'],
): Promise<PaperPrintPreviewOutcome> {
  // Chromium returns null for noopener/noreferrer feature strings even when it creates the tab. Get
  // the usable about:blank handle first, while transient user activation is freshest, then isolate it.
  let printWindow: Window | null = null;
  try {
    printWindow = window.open('', '_blank');
  } catch {
    // A throwing popup implementation is equivalent to a blocked popup; use the HTML fallback.
  }
  if (printWindow) {
    try {
      printWindow.opener = null;
    } catch (error) {
      try { printWindow.close(); } catch { /* ignore close failure */ }
      return printPreviewFailure(error);
    }
  }

  let html: string;
  let fontFaceCss: string | undefined;
  try {
    const exact = await buildPaperDocumentExactManagedFontOutput(document);
    fontFaceCss = exact.fontFaceCss;
    html = exportPaperDocumentToPrintHtml(exact.document, {
      includeScreenGuides: true,
      fontFaceCss,
    });
  } catch (error) {
    try { printWindow?.close(); } catch { /* ignore close failure */ }
    return printPreviewFailure(error);
  }

  if (!printWindow) {
    let fallback: Awaited<ReturnType<typeof downloadTextFileWithOutcome>>;
    try {
      fallback = await downloadTextFileWithOutcome(
        `${safeFileName(document.title)}-print.html`,
        html,
        'text/html',
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        state: 'failed',
        message: `Browser popup was blocked, and the print HTML fallback failed: ${detail}`,
      };
    }
    if (fallback.status === 'failed') {
      return {
        state: 'failed',
        message: `Browser popup was blocked, and the print HTML fallback failed: ${fallback.error}`,
      };
    }
    if (fallback.status === 'saved') {
      return {
        state: 'html-fallback',
        message: `Browser popup was blocked; saved print HTML to ${fallback.location}.`,
      };
    }
    return {
      state: 'html-fallback',
      message: 'Browser popup was blocked; started the print HTML download.',
    };
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    await verifyExactPaperManagedFontReadiness(printWindow.document, fontFaceCss);
    printWindow.print();
    return { state: 'printed', message: 'Opened browser print dialog after exact managed-face verification.' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Managed face readiness failed.';
    try {
      const note = printWindow.document.createElement?.('p');
      if (note) {
        note.textContent = `Print preview blocked: ${message}`;
        printWindow.document.body?.prepend(note);
      }
    } catch {
      // The typed failure below remains authoritative when the popup DOM itself is unavailable.
    }
    return printPreviewFailure(error);
  }
}

export interface PaperExportOutcome {
  state: 'success' | 'canceled' | 'error';
  message: string;
  path?: string;
  targetKind: 'file' | 'directory';
}

function finishPaperExport(
  setStatus: (status: string) => void,
  outcome: PaperExportOutcome,
): PaperExportOutcome {
  setStatus(outcome.message);
  return outcome;
}

/**
 * Whole-document placed-PDF assertion bound to the CURRENT Source Library state. A frame linked by
 * `sourceBinItemId` is classified by what materialization will actually resolve — the live item's
 * media type — not by persisted frame metadata that predates an in-place source replacement.
 */
export function assertPaperDocumentSupportsRasterizationWithCurrentSources(
  document: PaperDocument,
  pageIds?: readonly string[],
): void {
  createPaperDocumentRasterizationGuardWithCurrentSources(document, pageIds);
}

export function createPaperDocumentRasterizationGuardWithCurrentSources(
  document: PaperDocument,
  pageIds?: readonly string[],
): PaperPlacedDocumentRasterizationGuard {
  return createPaperPlacedDocumentRasterizationGuard(
    document,
    () => useSourceBinStore.getState().getAllItems(),
    pageIds,
  );
}

/** Materialize exactly the linked revisions captured by the guard, then prove they stayed current. */
export async function materializePaperRasterOutputDocument(
  document: PaperDocument,
  guard: PaperPlacedDocumentRasterizationGuard,
): Promise<PaperDocument> {
  guard();
  const outputDocument = await materializePaperDocumentAssetUrls(document, guard.sourceItems);
  guard();
  return outputDocument;
}

export async function exportPaperPdfDocument(
  document: PaperDocument,
  setStatus: (status: string) => void,
  request?: PaperPdfExportRequest,
  options: PaperPdfDocumentExportOptions = {},
): Promise<PaperExportOutcome> {
  const nativeBridge = getSignalLoomNativeBridge();

  if (!nativeBridge?.exportPaperPdf) {
    const preview = await openPrintPreview(document);
    return finishPaperExport(setStatus, {
      state: preview.state === 'printed' ? 'success' : 'error',
      message: preview.state === 'printed' ? 'Opened browser print dialog. In the desktop app this exports directly to PDF.' : preview.message,
      targetKind: 'file',
    });
  }

  // The default native PDF route first builds page rasters. Do not open a destination chooser or
  // report progress until the complete document has passed the PDF-placement capability boundary.
  const assertCurrentSources = request
    ? undefined
    : options.rasterizationGuard ?? createPaperDocumentRasterizationGuardWithCurrentSources(document);
  const recheckCurrentSources = (): void => assertCurrentSources?.();

  let result: NativePaperPdfExportResult;
  try {
    recheckCurrentSources();
    let filePath: string | undefined;
    if (nativeBridge.choosePaperPdfExportPath) {
      setStatus('Choose where to save the PDF...');
      const destination = await nativeBridge.choosePaperPdfExportPath({
        title: request?.title ?? document.title,
        fileName: request?.fileName ?? safePaperPdfFileName(document.title),
      });
      if (destination.canceled) {
        return finishPaperExport(setStatus, {
          state: 'canceled',
          message: 'PDF export canceled.',
          targetKind: 'file',
        });
      }
      if (destination.error || !destination.filePath) {
        return finishPaperExport(setStatus, {
          state: 'error',
          message: `PDF export failed: ${destination.error ?? 'No PDF destination was selected.'}`,
          targetKind: 'file',
        });
      }
      filePath = destination.filePath;
      setStatus(`Preparing PDF export for ${filePath}...`);
      recheckCurrentSources();
    }
    // Every native route resolves and validates the exact payload before it hands HTML to Electron.
    // A caller-provided vector request is rebuilt from the alias-bearing document; raster requests
    // have already passed the same payload through the shared flatten path below.
    const pdfRequest = request
      ? await (async () => {
        if (request.mode !== 'pages') return request;
        const exact = await buildPaperDocumentExactManagedFontOutput(document);
        const baseRequest = buildPaperPdfExportRequest(exact.document);
        return {
          ...baseRequest,
          html: exportPaperDocumentToPrintHtml(exact.document, {
            mediaBox: paperPrintMarksEnabled(exact.document.printProduction.marks) ? 'bleed' : 'trim',
            fontFaceCss: exact.fontFaceCss,
          }),
        };
      })()
      : await buildDefaultRasterPaperPdfRequest(
        document,
        setStatus,
        options,
        recheckCurrentSources,
      );
    if (request) {
      setStatus('Preparing print-quality PDF...');
    }
    recheckCurrentSources();
    result = await nativeBridge.exportPaperPdf({
      ...pdfRequest,
      ...(filePath ? { filePath } : {}),
      provenanceLabel: buildProvenanceLabel(),
    });
  } catch (error) {
    return finishPaperExport(setStatus, {
      state: 'error',
      message: error instanceof Error ? `PDF export failed: ${error.message}` : 'PDF export failed.',
      targetKind: 'file',
    });
  }

  if (result.canceled) {
    return finishPaperExport(setStatus, {
      state: 'canceled',
      message: 'PDF export canceled.',
      targetKind: 'file',
    });
  }

  if (result.error) {
    return finishPaperExport(setStatus, {
      state: 'error',
      message: `PDF export failed: ${result.error}`,
      targetKind: 'file',
    });
  }

  const sizeLabel = result.bytes ? ` (${Math.round(result.bytes / 1024)} KB)` : '';
  return finishPaperExport(setStatus, {
    state: 'success',
    message: result.filePath ? `Saved PDF to ${result.filePath}${sizeLabel}.` : `Saved PDF${sizeLabel}.`,
    path: result.filePath,
    targetKind: 'file',
  });
}

export interface PaperPdfxSaveDependencies {
  exportPdfx?: typeof exportPaperDocumentToPdfxInBrowser;
  validatePdfx?: typeof validatePaperPdfx;
  /** Browser download adapter. Called only after every strict check has passed. */
  downloadPdf?: (bytes: Uint8Array, fileName: string) => void | Promise<void>;
  assetExists?: PaperProductionPreflightOptions['assetExists'];
}

export interface PaperTaggedPdfSaveDependencies {
  buildTaggedPdf?: typeof buildPaperTaggedPdf;
  validateTaggedPdf?: typeof validatePaperTaggedPdf;
  /** Browser download adapter. Called only after the semantic structure checks have passed. */
  downloadPdf?: (bytes: Uint8Array, fileName: string) => void | Promise<void>;
}

function taggedPdfRasterBytes(dataUrl: string, mimeType: 'image/png' | 'image/jpeg'): Uint8Array {
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) throw new Error('Paper page raster did not produce a supported PNG or JPEG data URL.');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Builds a visual Paper snapshot plus a semantic tagged-PDF overlay. Unlike the print-only PDF/X path,
 * this is fail-closed on missing author-provided Figure alternative text and never claims certification.
 */
export async function exportPaperTaggedPdfAndSave(
  document: PaperDocument,
  setStatus: (status: string) => void,
  dependencies: PaperTaggedPdfSaveDependencies = {},
): Promise<void> {
  let delivery: NativePaperPdfExportResult | undefined;
  try {
    const guard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    guard();
    const materialized = await materializePaperDocumentAssetUrls(document, guard.sourceItems);
    guard();
    const exact = await buildPaperDocumentExactManagedFontOutput(materialized);
    const outputDpi = Math.min(144, Math.max(72, Math.round(exact.document.page.dpi || 300)));
    const planIssues = validatePaperTaggedPdfDocument(exact.document, outputDpi);
    if (planIssues.length > 0) {
      setStatus(`Accessible PDF export blocked: ${planIssues.slice(0, 3).map((issue) => issue.detail).join(' ')}`);
      return;
    }

    setStatus(`Rasterizing ${exact.document.pages.length} Paper page${exact.document.pages.length === 1 ? '' : 's'} for accessible tagged PDF...`);
    const pages = await buildPaperWebcomicImageDataPages(exact.document, {
      format: 'png',
      includeBleed: false,
      outputDpi,
      fontFaceCss: exact.fontFaceCss,
      onPageRasterized: ({ pageNumber, pageIndex, pageCount }) => {
        setStatus(`Rasterized page ${pageNumber} (${pageIndex + 1}/${pageCount}) for accessible PDF export...`);
      },
    });
    guard();
    const bytes = await (dependencies.buildTaggedPdf ?? buildPaperTaggedPdf)(exact.document, {
      rasterPages: pages.map((page) => ({
        pageId: page.pageId,
        mimeType: page.mimeType,
        bytes: taggedPdfRasterBytes(page.dataUrl, page.mimeType),
      })),
    });
    guard();
    const report = await (dependencies.validateTaggedPdf ?? validatePaperTaggedPdf)(bytes);
    if (!report.pass) {
      setStatus(`Accessible PDF export blocked: ${summarizePaperTaggedPdfReport(report)}`);
      return;
    }
    delivery = await deliverValidatedPaperPdf(
      bytes,
      `${safeFileName(document.title)}-accessible.pdf`,
      document.title,
      dependencies.downloadPdf,
    );
    const kb = Math.round(bytes.length / 1024);
    const path = delivery?.filePath ? ` to ${delivery.filePath}` : '';
    setStatus(`${summarizePaperTaggedPdfReport(report)} Saved accessible tagged PDF${path} (${kb} KB).`);
  } catch (error) {
    if (error instanceof PaperPdfxSaveCanceledError) {
      setStatus('Accessible PDF export canceled.');
      return;
    }
    setStatus(`Accessible PDF export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

async function paperManagedAssetExists(reference: BinaryAssetRef): Promise<boolean> {
  const record = await paperAssetRepository.get(reference.id);
  if (!record
    || record.ref.id !== reference.id
    || record.ref.sha256 !== reference.sha256
    || record.ref.byteLength !== reference.byteLength
    || record.ref.mimeType !== reference.mimeType) return false;
  return verifyBinaryAssetRecord(record);
}

class PaperPdfxSaveCanceledError extends Error {
  constructor() {
    super('The native PDF destination was canceled.');
    this.name = 'PaperPdfxSaveCanceledError';
  }
}

async function defaultPdfxDownload(
  bytes: Uint8Array,
  fileName: string,
  title: string,
): Promise<NativePaperPdfExportResult> {
  const nativeBridge = getSignalLoomNativeBridge();
  if (nativeBridge?.savePaperPdfBytes) {
    return nativeBridge.savePaperPdfBytes({
      title,
      fileName,
      bytes: new Uint8Array(bytes),
    });
  }
  downloadSharedBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName);
  return { canceled: false, bytes: bytes.byteLength };
}

async function deliverValidatedPaperPdf(
  bytes: Uint8Array,
  fileName: string,
  title: string,
  downloadPdf?: PaperPdfxSaveDependencies['downloadPdf'],
): Promise<NativePaperPdfExportResult | undefined> {
  if (downloadPdf) {
    await downloadPdf(bytes, fileName);
    return undefined;
  }
  const result = await defaultPdfxDownload(bytes, fileName, title);
  if (result.canceled) throw new PaperPdfxSaveCanceledError();
  if (result.error) throw new Error(result.error);
  return result;
}

export interface PaperEpubSaveDependencies {
  buildEpub?: typeof buildPaperEpub;
  validateEpub?: typeof validatePaperEpub;
  /** Browser/test delivery adapter. Invoked only after the EPUB structural gate passes. */
  downloadEpub?: (bytes: Uint8Array, fileName: string) => void | Promise<void>;
}

function epubRasterBytes(dataUrl: string): Uint8Array {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('EPUB visual fallback raster did not produce a PNG data URL.');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

class PaperEpubSaveCanceledError extends Error {
  constructor() {
    super('The native EPUB destination was canceled.');
    this.name = 'PaperEpubSaveCanceledError';
  }
}

async function deliverValidatedPaperEpub(
  bytes: Uint8Array,
  fileName: string,
  title: string,
  downloadEpub?: PaperEpubSaveDependencies['downloadEpub'],
): Promise<NativePaperEpubExportResult | undefined> {
  if (downloadEpub) {
    await downloadEpub(bytes, fileName);
    return undefined;
  }
  const nativeBridge = getSignalLoomNativeBridge();
  if (nativeBridge?.savePaperEpubBytes) {
    const result = await nativeBridge.savePaperEpubBytes({ title, fileName, bytes: new Uint8Array(bytes) });
    if (result.canceled) throw new PaperEpubSaveCanceledError();
    if (result.error) throw new Error(result.error);
    return result;
  }
  downloadSharedBlob(new Blob([new Uint8Array(bytes)], { type: 'application/epub+zip' }), fileName);
  return { canceled: false, bytes: bytes.byteLength };
}

/**
 * Builds a reflowable EPUB 3 reading edition. Printable visual or layout-heavy Paper pages are
 * rasterized only when needed and embedded as labelled fallbacks; the semantic text remains the
 * primary reading flow. A failed plan, raster, package, or structural report never reaches delivery.
 */
export async function exportPaperEpubAndSave(
  document: PaperDocument,
  setStatus: (status: string) => void,
  dependencies: PaperEpubSaveDependencies = {},
): Promise<void> {
  try {
    const guard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    const materialized = await materializePaperRasterOutputDocument(document, guard);
    const exact = await buildPaperDocumentExactManagedFontOutput(materialized);
    guard();
    const plan = buildPaperEpubPlan(exact.document);
    // Validate low-cost text/page/fallback shape limits before Canvas work. Missing fallbacks are
    // expected at this point and are satisfied below by rasterizing only the affected pages.
    const preflightIssues = validatePaperEpubPlan(plan).filter((issue) => issue.id !== 'missing-visual-fallback');
    const rasterIssues = validatePaperEpubRasterization(exact.document, plan, 96);
    if (preflightIssues.length > 0 || rasterIssues.length > 0) {
      const issues = [...preflightIssues, ...rasterIssues];
      setStatus(`EPUB export blocked: ${issues.slice(0, 3).map((issue) => issue.detail).join(' ')}`);
      return;
    }

    const visualPageIds = new Set(plan.chapters.filter((chapter) => chapter.requiresVisualFallback).map((chapter) => chapter.pageId));
    let visualFallbacks: Array<{ pageId: string; mimeType: 'image/png'; bytes: Uint8Array }> = [];
    if (visualPageIds.size > 0) {
      setStatus(`Rasterizing ${visualPageIds.size} visual Paper page${visualPageIds.size === 1 ? '' : 's'} for EPUB fallback...`);
      // The webcomic renderer is already the retained, capability-guarded flattening path. Filter
      // to only lossy pages before rendering so a long ordinary-text book stays reflow-only.
      const visualDocument: PaperDocument = {
        ...exact.document,
        pages: exact.document.pages.filter((page) => visualPageIds.has(page.id)),
      };
      const pages = await buildPaperWebcomicImageDataPages(visualDocument, {
        format: 'png',
        includeBleed: false,
        outputDpi: 96,
        fontFaceCss: exact.fontFaceCss,
        onPageRasterized: ({ pageNumber, pageIndex, pageCount }) => {
          setStatus(`Rasterized visual page ${pageNumber} (${pageIndex + 1}/${pageCount}) for EPUB fallback...`);
        },
      });
      guard();
      visualFallbacks = pages.map((page) => ({ pageId: page.pageId, mimeType: 'image/png' as const, bytes: epubRasterBytes(page.dataUrl) }));
    }

    const planIssues = validatePaperEpubPlan(plan, visualFallbacks);
    if (planIssues.length > 0) {
      setStatus(`EPUB export blocked: ${planIssues.slice(0, 3).map((issue) => issue.detail).join(' ')}`);
      return;
    }
    setStatus(`Building ${plan.chapters.length} reflowable EPUB chapter${plan.chapters.length === 1 ? '' : 's'}...`);
    const bytes = (dependencies.buildEpub ?? buildPaperEpub)(exact.document, { visualFallbacks });
    guard();
    const report = (dependencies.validateEpub ?? validatePaperEpub)(bytes);
    if (!report.pass) {
      setStatus(`EPUB export blocked: ${summarizePaperEpubReport(report)}`);
      return;
    }
    const delivery = await deliverValidatedPaperEpub(
      bytes,
      `${safeFileName(document.title)}.epub`,
      document.title,
      dependencies.downloadEpub,
    );
    const path = delivery?.filePath ? ` to ${delivery.filePath}` : '';
    setStatus(`${summarizePaperEpubReport(report)} Saved reflowable EPUB${path} (${Math.round(bytes.byteLength / 1024)} KB).`);
  } catch (error) {
    if (error instanceof PaperEpubSaveCanceledError) {
      setStatus('EPUB export canceled.');
      return;
    }
    setStatus(`EPUB export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Strict PDF/X-1a / PDF/X-4 export path (docs/notes/836): renders through the selected managed ICC
 * output profile, validates generated bytes/evidence in memory, and downloads only a passing internal
 * structural report. It is separate from the RGB browser-PDF proof path.
 */
export async function exportPaperPdfxAndSave(
  document: PaperDocument,
  setStatus: (status: string) => void,
  dependencies: PaperPdfxSaveDependencies = {},
): Promise<void> {
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  const standard = production.pdfStandard === 'pdf-x-1a' ? 'pdf-x-1a' : 'pdf-x-4';
  const standardLabel = standard === 'pdf-x-1a' ? 'PDF/X-1a' : 'PDF/X-4';
  const profile = document.managedIccProfiles?.find((candidate) => candidate.id === production.outputIntentProfileAssetId);
  const profileLabel = profile?.description ?? 'managed CMYK profile';
  let delivery: NativePaperPdfExportResult | undefined;
  try {
    // Strict production preflight may inspect managed assets. The raster capability boundary comes
    // first so a placed PDF cannot trigger those reads or an overridable generic preflight path.
    const assertCurrentSources = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    setStatus(`Checking managed assets and production constraints for ${standardLabel} (${profileLabel})…`);
    const transaction = await exportValidatedPaperPdfx(document, {
      standard,
      generate: (frozenDocument) => {
        assertCurrentSources();
        return (dependencies.exportPdfx ?? exportPaperDocumentToPdfxInBrowser)(frozenDocument, {
          standard,
          title: frozenDocument.title,
        });
      },
      validate: dependencies.validatePdfx ?? validatePaperPdfx,
      download: async (bytes) => {
        assertCurrentSources();
        delivery = await deliverValidatedPaperPdf(
          bytes,
          `${safeFileName(document.title)}-${standard}.pdf`,
          document.title,
          dependencies.downloadPdf,
        );
      },
      assetExists: dependencies.assetExists ?? paperManagedAssetExists,
    });
    if (transaction.status === 'blocked') {
      const summary = transaction.report
        ? formatProductionValidationStatus(transaction.report)
        : `${standardLabel} export blocked: ${transaction.issues.slice(0, 3).map((issue) => issue.message).join('; ')}`;
      setStatus(summary);
      return;
    }
    if (transaction.status === 'cancelled') {
      setStatus(`${standardLabel} export canceled.`);
      return;
    }
    const kb = Math.round(transaction.bytes.length / 1024);
    const pathLabel = delivery?.filePath ? ` to ${delivery.filePath}` : '';
    setStatus(`${formatProductionValidationStatus(transaction.report)} Saved ${standardLabel}${pathLabel} with ${profileLabel} ICC (${kb} KB).`);
  } catch (error) {
    if (error instanceof PaperPdfxSaveCanceledError) {
      setStatus(`${standardLabel} export canceled.`);
      return;
    }
    const message = error instanceof Error ? error.message : `${standardLabel} export failed.`;
    setStatus(`${standardLabel} export failed: ${message}`);
  }
}

/** 0.125 inch KDP interior bleed, in millimetres. */
const KDP_BLEED_MM = 3.175;

/**
 * Export a KDP-targeted PDF/X-1a interior at ≥300 DPI with the required 0.125" bleed. The same strict
 * transaction blocks invalid bytes before download; KDP's own upload checks remain external to this app.
 */
export async function exportPaperKdpPdfAndSave(
  document: PaperDocument,
  setStatus: (status: string) => void,
  dependencies: PaperPdfxSaveDependencies = {},
): Promise<void> {
  const dpi = Math.max(300, Math.round(document.page.dpi || 300));
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  const profile = document.managedIccProfiles?.find((candidate) => candidate.id === production.outputIntentProfileAssetId);
  const profileLabel = profile?.description ?? 'managed CMYK profile';
  let delivery: NativePaperPdfExportResult | undefined;
  try {
    const assertCurrentSources = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    setStatus(`Checking managed assets and production constraints for a ${dpi} DPI KDP PDF/X-1a…`);
    const kdpDocument = updatePaperDocumentSetup(document, {
      bleedMm: KDP_BLEED_MM,
      printProduction: { spotColorPolicy: 'convert-process' },
    });
    const transaction = await exportValidatedPaperPdfx(kdpDocument, {
      standard: 'pdf-x-1a',
      requiredPpi: dpi,
      allowFullPageFlatten: true,
      generate: (frozenDocument) => {
        assertCurrentSources();
        return (dependencies.exportPdfx ?? exportPaperDocumentToPdfxInBrowser)(frozenDocument, {
          standard: 'pdf-x-1a',
          outputDpi: dpi,
          flattenAllPages: true,
          title: frozenDocument.title,
        });
      },
      validate: dependencies.validatePdfx ?? validatePaperPdfx,
      download: async (bytes) => {
        assertCurrentSources();
        delivery = await deliverValidatedPaperPdf(
          bytes,
          `${safeFileName(document.title)}-KDP-interior.pdf`,
          document.title,
          dependencies.downloadPdf,
        );
      },
      assetExists: dependencies.assetExists ?? paperManagedAssetExists,
    });
    if (transaction.status === 'blocked') {
      const summary = transaction.report
        ? formatProductionValidationStatus(transaction.report)
        : `PDF/X-1a export blocked: ${transaction.issues.slice(0, 3).map((issue) => issue.message).join('; ')}`;
      setStatus(summary);
      return;
    }
    if (transaction.status === 'cancelled') {
      setStatus('KDP PDF/X-1a export canceled.');
      return;
    }
    const kb = Math.round(transaction.bytes.length / 1024);
    const pathLabel = delivery?.filePath ? ` to ${delivery.filePath}` : '';
    setStatus(`${formatProductionValidationStatus(transaction.report)} Saved KDP-targeted PDF/X-1a${pathLabel} at ${dpi} DPI with 0.125" bleed and ${profileLabel} ICC (${kb} KB).`);
  } catch (error) {
    if (error instanceof PaperPdfxSaveCanceledError) {
      setStatus('KDP PDF/X-1a export canceled.');
      return;
    }
    const message = error instanceof Error ? error.message : 'KDP PDF export failed.';
    setStatus(`KDP PDF export failed: ${message}`);
  }
}

export interface PaperPdfDocumentExportOptions {
  rasterPreset?: PaperPdfRasterPreset;
  /** Reuse the caller's pre-materialization transaction through the native output handoff. */
  rasterizationGuard?: PaperPlacedDocumentRasterizationGuard;
}

export interface PaperPdfRasterExportSettings {
  preset: PaperPdfRasterPreset;
  label: string;
  format: 'png' | 'jpeg';
  quality?: number;
  outputDpi: number;
}

export function buildPaperPdfRasterExportSettings(
  document: PaperDocument,
  options: PaperPdfDocumentExportOptions = {},
): PaperPdfRasterExportSettings {
  const documentDpi = Math.max(1, Math.round(document.page.dpi || 300));
  switch (options.rasterPreset) {
    case 'balanced-jpeg':
      return {
        preset: 'balanced-jpeg',
        label: 'Balanced JPEG',
        format: 'jpeg',
        quality: 0.9,
        outputDpi: Math.min(documentDpi, 240),
      };
    case 'proof-jpeg':
      return {
        preset: 'proof-jpeg',
        label: 'Proof JPEG',
        format: 'jpeg',
        quality: 0.82,
        outputDpi: Math.min(documentDpi, 150),
      };
    case 'print-png':
    default:
      return {
        preset: 'print-png',
        label: 'Print PNG',
        format: 'png',
        quality: undefined,
        outputDpi: documentDpi,
      };
  }
}

async function buildDefaultRasterPaperPdfRequest(
  document: PaperDocument,
  setStatus: (status: string) => void,
  options: PaperPdfDocumentExportOptions,
  assertCurrentSources: () => void,
): Promise<PaperPdfExportRequest> {
  assertCurrentSources();
  const exact = await buildPaperDocumentExactManagedFontOutput(document);
  assertCurrentSources();
  const rasterSettings = buildPaperPdfRasterExportSettings(document, options);
  const includeProductionMarks = paperPrintMarksEnabled(exact.document.printProduction.marks);
  const pageCount = document.pages.length;
  setStatus(`Rasterizing ${pageCount} Paper page${pageCount === 1 ? '' : 's'} as ${rasterSettings.label} PDF (${rasterSettings.outputDpi} DPI)...`);
  const pages = await buildPaperWebcomicImageDataPages(exact.document, {
    format: rasterSettings.format,
    quality: rasterSettings.quality,
    includeBleed: includeProductionMarks,
    includeProductionMarks,
    outputDpi: rasterSettings.outputDpi,
    // AUD-020: the ordinary flattened PDF is honestly fully raster. Capture every authored frame —
    // shapes, text, and placed content — into the page image exactly once. No `backdropOnly`: the
    // raster PDF HTML no longer re-draws any live vector frame on top of this snapshot.
    fontFaceCss: exact.fontFaceCss,
    onPageRasterized: ({ pageNumber, pageIndex, pageCount }) => {
      setStatus(`Rasterized page ${pageNumber} (${pageIndex + 1}/${pageCount}) for PDF export...`);
    },
  });

  setStatus(`Preparing ${rasterSettings.label} PDF from flattened page snapshots...`);
  return buildPaperRasterPdfExportRequest(document, pages.map((page) => ({
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    widthPx: page.widthPx,
    heightPx: page.heightPx,
    dataUrl: page.dataUrl,
  })), { dpi: rasterSettings.outputDpi });
}

export async function exportPaperWebcomicImages(
  document: PaperDocument,
  setStatus: (status: string) => void,
  options: PaperWebcomicImageExportOptions & {
    /** Reuse the caller's pre-materialization transaction through the final file handoff. */
    rasterizationGuard?: PaperPlacedDocumentRasterizationGuard;
  } = {},
): Promise<PaperExportOutcome> {
  const {
    rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document),
    ...imageOptions
  } = options;
  const assertCurrentSources = rasterizationGuard;
  const nativeBridge = getSignalLoomNativeBridge();

  try {
    // Keep exact-font preparation inside the export transaction. The supplied guard still owns
    // the immutable, pre-materialization Source Library snapshot; rebuilding the materialized
    // document for managed fonts must neither replace that baseline nor let its typed failure
    // escape the normal Paper export outcome contract.
    assertCurrentSources();
    const exact = await buildPaperDocumentExactManagedFontOutput(document);
    assertCurrentSources();
    const outputDocument = exact.document;
    const exactOptions = { ...imageOptions, fontFaceCss: exact.fontFaceCss };
    const plan = buildPaperWebcomicImageExportPlan(outputDocument, exactOptions);
    assertCurrentSources();
    if (nativeBridge?.exportPaperImages) {
      let directoryPath: string | undefined;
      if (nativeBridge.choosePaperImageExportDirectory) {
        setStatus(`Choose where to save the ${plan.format.toUpperCase()} page images...`);
        const destination = await nativeBridge.choosePaperImageExportDirectory({
          title: plan.title,
          directoryName: plan.directoryName,
          format: plan.format,
        });
        if (destination.canceled) {
          return finishPaperExport(setStatus, {
            state: 'canceled',
            message: 'Page image export canceled.',
            targetKind: 'directory',
          });
        }
        if (destination.error || !destination.directoryPath) {
          return finishPaperExport(setStatus, {
            state: 'error',
            message: `Page image export failed: ${destination.error ?? 'No image export directory was selected.'}`,
            targetKind: 'directory',
          });
        }
        directoryPath = destination.directoryPath;
        setStatus(`Preparing ${plan.format.toUpperCase()} page images for ${directoryPath}...`);
        assertCurrentSources();
      }
      setStatus(`Rasterizing ${plan.pages.length} Paper page${plan.pages.length === 1 ? '' : 's'} for ${plan.format.toUpperCase()} export...`);
      const pages = await buildPaperWebcomicImageDataPages(outputDocument, {
        ...exactOptions,
        plan,
        onPageRasterized: ({ pageNumber, pageIndex, pageCount }) => {
          setStatus(`Rasterized page ${pageNumber} (${pageIndex + 1}/${pageCount}) for ${plan.format.toUpperCase()} export...`);
        },
      });
      assertCurrentSources();
      const result = await nativeBridge.exportPaperImages({
        title: plan.title,
        directoryName: plan.directoryName,
        format: plan.format,
        mimeType: plan.mimeType,
        quality: plan.quality,
        ...(directoryPath ? { directoryPath } : {}),
        pages: pages.map((page) => ({
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          fileName: page.fileName,
          mimeType: page.mimeType,
          dataUrl: page.dataUrl,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
        })),
      });

      if (result.canceled) {
        return finishPaperExport(setStatus, {
          state: 'canceled',
          message: 'Page image export canceled.',
          targetKind: 'directory',
        });
      }
      if (result.error) {
        return finishPaperExport(setStatus, {
          state: 'error',
          message: `Page image export failed: ${result.error}`,
          targetKind: 'directory',
        });
      }

      const fileCount = result.files?.length ?? pages.length;
      const sizeLabel = result.bytes ? ` (${Math.round(result.bytes / 1024)} KB)` : '';
      return finishPaperExport(setStatus, {
        state: 'success',
        message: result.directoryPath
          ? `Saved ${fileCount} page image${fileCount === 1 ? '' : 's'} to ${result.directoryPath}${sizeLabel}.`
          : `Saved ${fileCount} page image${fileCount === 1 ? '' : 's'}${sizeLabel}.`,
        path: result.directoryPath,
        targetKind: 'directory',
      });
    }

    setStatus(`Building browser ZIP fallback for ${plan.pages.length} Paper page image${plan.pages.length === 1 ? '' : 's'}...`);
    const archive = await buildPaperWebcomicImageArchiveExport(outputDocument, exactOptions);
    assertCurrentSources();
    downloadSharedBlob(archive.blob, archive.fileName);
    return finishPaperExport(setStatus, {
      state: 'success',
      message: `Downloaded ${archive.fileName} with ${archive.entries.length} page image${archive.entries.length === 1 ? '' : 's'} inside ${plan.directoryName}.`,
      targetKind: 'file',
    });
  } catch (error) {
    return finishPaperExport(setStatus, {
      state: 'error',
      message: error instanceof Error ? `Page image export failed: ${error.message}` : 'Page image export failed.',
      targetKind: 'directory',
    });
  }
}

export function downloadBlob(fileName: string, blob: Blob): void {
  downloadSharedBlob(blob, fileName);
}

export function downloadText(fileName: string, contents: string, mimeType: string): void {
  downloadTextFile(fileName, contents, mimeType);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The selected document could not be read.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('The selected document could not be converted for placement.'));
      }
    };
    reader.readAsDataURL(file);
  });
}

export function safeFileName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'paper-document';
}

export function cssColorToPickerValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
}
