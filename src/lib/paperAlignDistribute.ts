// Pure object alignment & distribution for selected Paper frames. Operates on frame bounding boxes
// (mm) and returns a position patch per frame id — the store maps these onto updateFrame calls.

export type PaperAlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type PaperDistributeAxis = 'horizontal' | 'vertical';

export interface PaperAlignFrame {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PaperFramePositionPatch {
  xMm?: number;
  yMm?: number;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/** Align frames to a shared edge of the selection's bounding box. Needs two or more frames. */
export function alignPaperFrames(frames: PaperAlignFrame[], edge: PaperAlignEdge): Map<string, PaperFramePositionPatch> {
  const patches = new Map<string, PaperFramePositionPatch>();
  if (frames.length < 2) return patches;

  const minX = Math.min(...frames.map((f) => f.xMm));
  const maxRight = Math.max(...frames.map((f) => f.xMm + f.widthMm));
  const minY = Math.min(...frames.map((f) => f.yMm));
  const maxBottom = Math.max(...frames.map((f) => f.yMm + f.heightMm));
  const centerX = (minX + maxRight) / 2;
  const centerY = (minY + maxBottom) / 2;

  for (const frame of frames) {
    switch (edge) {
      case 'left': patches.set(frame.id, { xMm: round(minX) }); break;
      case 'right': patches.set(frame.id, { xMm: round(maxRight - frame.widthMm) }); break;
      case 'centerX': patches.set(frame.id, { xMm: round(centerX - frame.widthMm / 2) }); break;
      case 'top': patches.set(frame.id, { yMm: round(minY) }); break;
      case 'bottom': patches.set(frame.id, { yMm: round(maxBottom - frame.heightMm) }); break;
      case 'centerY': patches.set(frame.id, { yMm: round(centerY - frame.heightMm / 2) }); break;
    }
  }
  return patches;
}

/**
 * Distribute frames so the gaps between them are equal along an axis (InDesign "distribute spacing").
 * The first and last frames stay put. Needs three or more frames.
 */
export function distributePaperFrames(frames: PaperAlignFrame[], axis: PaperDistributeAxis): Map<string, PaperFramePositionPatch> {
  const patches = new Map<string, PaperFramePositionPatch>();
  if (frames.length < 3) return patches;

  const horizontal = axis === 'horizontal';
  const start = (f: PaperAlignFrame) => (horizontal ? f.xMm : f.yMm);
  const size = (f: PaperAlignFrame) => (horizontal ? f.widthMm : f.heightMm);

  const sorted = [...frames].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (start(last) + size(last)) - start(first);
  const totalSize = sorted.reduce((sum, f) => sum + size(f), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  let cursor = start(first);
  for (const frame of sorted) {
    if (frame !== first && frame !== last) {
      patches.set(frame.id, horizontal ? { xMm: round(cursor) } : { yMm: round(cursor) });
    }
    cursor += size(frame) + gap;
  }
  return patches;
}
