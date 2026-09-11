import type { PaperFrame } from '../types/paper';
import {
  buildPaperBubbleConnectorSegments,
  buildPaperCompoundBubbleShapes,
  type PaperCompoundBubbleShape,
  type PaperBubbleConnectorSegment,
} from './paperBubbleChains';

export const PAPER_CANVAS_FRAME_Z_START = 100;
export const PAPER_CANVAS_GUIDE_Z = 10_000;
export const PAPER_CANVAS_BLEED_Z = 10_010;
export const PAPER_CANVAS_CUT_Z = 10_020;

export interface PaperCanvasFrameLayer {
  frame: PaperFrame;
  stackIndex: number;
  canvasZIndex: number;
}

export interface PaperCanvasBubbleConnectorLayer {
  canvasZIndex: number;
  segments: PaperBubbleConnectorSegment[];
  compoundShapes: PaperCompoundBubbleShape[];
}

export function buildPaperCanvasFrameLayers(frames: PaperFrame[]): PaperCanvasFrameLayer[] {
  // The document resolver supplies the canonical back-to-front order (layer order, then frame z-index).
  // Re-sorting globally by z-index here would let a low-z frame in a front layer fall behind a high-z frame
  // in a back layer, so this final CSS projection deliberately preserves its input order.
  return frames.map((frame, stackIndex) => ({
    frame,
    stackIndex,
    canvasZIndex: PAPER_CANVAS_FRAME_Z_START + stackIndex,
  }));
}

/**
 * Places each connector above earlier page artwork but below both linked bubbles.
 *
 * The connector SVGs are emitted before the frame elements in the canvas DOM. Sharing the lower
 * linked bubble's z-index therefore lets that bubble paint over the connector seam, while frames
 * earlier in the canonical stack (normally panel art) stay underneath the connector. A single
 * global layer below every frame makes connectors disappear behind ordinary full-page artwork.
 */
export function buildPaperCanvasBubbleConnectorLayers(frames: PaperFrame[]): PaperCanvasBubbleConnectorLayer[] {
  const frameLayers = buildPaperCanvasFrameLayers(frames);
  const frameZIndexes = new Map(frameLayers.map(({ frame, canvasZIndex }) => [frame.id, canvasZIndex]));
  const grouped = new Map<number, Omit<PaperCanvasBubbleConnectorLayer, 'canvasZIndex'>>();
  const compoundShapes = buildPaperCompoundBubbleShapes(frames);
  const compoundedSegmentIds = new Set(compoundShapes.flatMap((shape) => shape.segmentIds));

  for (const compoundShape of compoundShapes) {
    const canvasZIndex = Math.min(...compoundShape.memberFrameIds.map(
      (frameId) => frameZIndexes.get(frameId) ?? PAPER_CANVAS_FRAME_Z_START,
    ));
    const layer = grouped.get(canvasZIndex) ?? { segments: [], compoundShapes: [] };
    layer.compoundShapes.push(compoundShape);
    grouped.set(canvasZIndex, layer);
  }

  for (const segment of buildPaperBubbleConnectorSegments(frames)) {
    if (compoundedSegmentIds.has(segment.id)) continue;
    const fromZIndex = frameZIndexes.get(segment.fromFrameId) ?? PAPER_CANVAS_FRAME_Z_START;
    const toZIndex = frameZIndexes.get(segment.toFrameId) ?? PAPER_CANVAS_FRAME_Z_START;
    const canvasZIndex = Math.min(fromZIndex, toZIndex);
    const layer = grouped.get(canvasZIndex) ?? { segments: [], compoundShapes: [] };
    layer.segments.push(segment);
    grouped.set(canvasZIndex, layer);
  }

  return [...grouped.entries()]
    .sort(([leftZIndex], [rightZIndex]) => leftZIndex - rightZIndex)
    .map(([canvasZIndex, layer]) => ({ canvasZIndex, ...layer }));
}

/** Keep the editing canvas visually faithful to output; parent-page ownership is shown by controls/badges. */
export function resolvePaperCanvasFrameOpacity(frame: Pick<PaperFrame, 'opacity'>): number {
  const opacity = Number.isFinite(frame.opacity) ? frame.opacity : 1;
  return Math.max(0, Math.min(1, opacity));
}
