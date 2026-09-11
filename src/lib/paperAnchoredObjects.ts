import type {
  PaperAnchoredObject,
  PaperDocument,
  PaperFrame,
  PaperPage,
} from '../types/paper';

/** Hard limits keep authored anchor relationships cheap to resolve on every canvas/export pass. */
export const PAPER_ANCHORED_OBJECT_LIMITS = {
  maxObjects: 512,
  maxIdLength: 96,
  maxTextOffset: 1_000_000,
  maxOffsetMm: 10_000,
} as const;

export interface PaperAnchoredObjectPlacement {
  objectFrameId: string;
  anchorFrameId: string;
  resolved: boolean;
  xMm?: number;
  yMm?: number;
  line: number;
  column: number;
  reason?: 'missing-object' | 'missing-anchor' | 'invalid-anchor';
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > PAPER_ANCHORED_OBJECT_LIMITS.maxIdLength) return undefined;
  const id = value.trim();
  return /^[a-zA-Z0-9:_-]+$/.test(id) ? id : undefined;
}

function finiteBounded(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-PAPER_ANCHORED_OBJECT_LIMITS.maxOffsetMm, Math.min(PAPER_ANCHORED_OBJECT_LIMITS.maxOffsetMm, value))
    : fallback;
}

/** Normalize persisted relationships; malformed entries are dropped instead of becoming floating objects. */
export function normalizePaperAnchoredObjects(value: unknown): PaperAnchoredObject[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const objects: PaperAnchoredObject[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (objects.length >= PAPER_ANCHORED_OBJECT_LIMITS.maxObjects || !entry || typeof entry !== 'object' || Array.isArray(entry)) break;
    const raw = entry as Record<string, unknown>;
    const id = cleanId(raw.id);
    const objectFrameId = cleanId(raw.objectFrameId);
    const anchorFrameId = cleanId(raw.anchorFrameId);
    if (!id || ids.has(id) || !objectFrameId || !anchorFrameId || objectFrameId === anchorFrameId) continue;
    const offset = Number.isFinite(raw.textOffset) ? Math.max(0, Math.min(PAPER_ANCHORED_OBJECT_LIMITS.maxTextOffset, Math.floor(raw.textOffset as number))) : 0;
    const rawOffset = raw.offsetMm && typeof raw.offsetMm === 'object' && !Array.isArray(raw.offsetMm)
      ? raw.offsetMm as Record<string, unknown>
      : undefined;
    const offsetMm = rawOffset
      ? { x: finiteBounded(rawOffset.x, 0), y: finiteBounded(rawOffset.y, 0) }
      : undefined;
    objects.push({
      id,
      objectFrameId,
      anchorFrameId,
      textOffset: offset,
      ...(offsetMm && (offsetMm.x !== 0 || offsetMm.y !== 0) ? { offsetMm } : {}),
      missingAnchorPolicy: raw.missingAnchorPolicy === 'retain' ? 'retain' : 'hide',
    });
    ids.add(id);
  }
  return objects;
}

function frameTextLength(frame: PaperFrame): number {
  if (frame.richText?.length) return frame.richText.reduce((total, paragraph) => total + paragraph.runs.reduce((sum, run) => sum + run.text.length, 0) + 1, 0);
  return frame.text?.length ?? 0;
}

function frameTextMetrics(frame: PaperFrame): { charsPerLine: number; charWidthMm: number; leadingMm: number } {
  const columns = Math.max(1, Math.round(frame.columns || 1));
  const columnWidthMm = Math.max(1, (frame.widthMm - Math.max(0, columns - 1) * (frame.columnGutterMm ?? 0)) / columns);
  const fontSizeMm = Math.max(0.5, (frame.typography.fontSizePt || 12) * 0.352777778);
  const charWidthMm = Math.max(0.25, fontSizeMm * 0.5);
  return {
    charsPerLine: Math.max(1, Math.floor(columnWidthMm / charWidthMm)),
    charWidthMm,
    leadingMm: Math.max(fontSizeMm, (frame.typography.leadingPt || frame.typography.fontSizePt || 12) * 0.352777778),
  };
}

/** Resolve anchor offsets from current text geometry. The authored relationship is never mutated. */
export function resolvePaperAnchoredObjectPlacements(
  document: PaperDocument,
  page: PaperPage,
  frames: PaperFrame[] = page.frames,
): PaperAnchoredObjectPlacement[] {
  const configured = document.anchoredObjects ?? [];
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  return configured.map((anchor) => {
    const objectFrame = byId.get(anchor.objectFrameId);
    const anchorFrame = byId.get(anchor.anchorFrameId);
    if (!objectFrame) return { objectFrameId: anchor.objectFrameId, anchorFrameId: anchor.anchorFrameId, resolved: false, line: 0, column: 0, reason: 'missing-object' };
    if (!anchorFrame) {
      return anchor.missingAnchorPolicy === 'retain'
        ? { objectFrameId: anchor.objectFrameId, anchorFrameId: anchor.anchorFrameId, resolved: true, xMm: objectFrame.xMm, yMm: objectFrame.yMm, line: 0, column: 0, reason: 'missing-anchor' }
        : { objectFrameId: anchor.objectFrameId, anchorFrameId: anchor.anchorFrameId, resolved: false, line: 0, column: 0, reason: 'missing-anchor' };
    }
    if (!['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(anchorFrame.kind)) {
      return { objectFrameId: anchor.objectFrameId, anchorFrameId: anchor.anchorFrameId, resolved: false, line: 0, column: 0, reason: 'invalid-anchor' };
    }
    const metrics = frameTextMetrics(anchorFrame);
    const offset = Math.min(anchor.textOffset, frameTextLength(anchorFrame));
    const line = Math.floor(offset / metrics.charsPerLine);
    const column = offset % metrics.charsPerLine;
    const offsetMm = anchor.offsetMm ?? { x: 0, y: 0 };
    return {
      objectFrameId: anchor.objectFrameId,
      anchorFrameId: anchor.anchorFrameId,
      resolved: true,
      xMm: anchorFrame.xMm + column * metrics.charWidthMm + offsetMm.x,
      yMm: anchorFrame.yMm + line * metrics.leadingMm + offsetMm.y,
      line,
      column,
    };
  });
}

/** Apply resolved positions and omit hidden/missing anchored objects for canvas and print parity. */
export function resolvePaperAnchoredObjectFrames(
  document: PaperDocument,
  page: PaperPage,
  frames: PaperFrame[],
): PaperFrame[] {
  const placements = resolvePaperAnchoredObjectPlacements(document, page, frames);
  const byObject = new Map(placements.map((placement) => [placement.objectFrameId, placement]));
  return frames.flatMap((frame) => {
    const placement = byObject.get(frame.id);
    if (!placement) return [frame];
    if (!placement.resolved || placement.xMm === undefined || placement.yMm === undefined) return [];
    return [{ ...frame, xMm: placement.xMm, yMm: placement.yMm }];
  });
}

/** Deleting an anchor or its object removes only the relationship, leaving unrelated relationships intact. */
export function removePaperAnchoredObjectsForFrames(
  document: PaperDocument,
  frameIds: ReadonlySet<string>,
): PaperDocument {
  if (!document.anchoredObjects?.length) return document;
  const anchoredObjects = document.anchoredObjects.filter((anchor) => !frameIds.has(anchor.objectFrameId) && !frameIds.has(anchor.anchorFrameId));
  return anchoredObjects.length === document.anchoredObjects.length ? document : {
    ...document,
    anchoredObjects,
    updatedAt: Date.now(),
  };
}
