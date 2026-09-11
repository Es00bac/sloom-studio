import type { Modifiers, Point } from './types';

/**
 * Photoshop-style Shift straight-lines for the brush-family tools (brush, eraser, clone stamp, spot
 * heal, blur/sharpen/smudge, dodge/burn, sponge). After every stroke the tool records its end point;
 * a subsequent Shift+pointer-down then paints one straight segment from that stored point to the new
 * one. Because each stroke re-records its end, Shift+clicking repeatedly chains connected segments —
 * exactly like Photoshop's "click, then Shift+click" line drawing.
 *
 * Anchors are keyed per tool and tagged with the document id, so switching documents (or tools) never
 * draws a stray line clear across the canvas: a Shift+click whose anchor belongs to another document
 * just lays a single dab, the same as an un-modified click.
 */
interface BrushStrokeAnchor {
  docId: string;
  point: Point;
}

const anchors = new Map<string, BrushStrokeAnchor>();

/** Record where a stroke ended so a later Shift+pointer-down can connect a straight line to it. */
export function recordBrushStrokeAnchor(toolKey: string, docId: string, point: Point): void {
  anchors.set(toolKey, { docId, point: { x: point.x, y: point.y } });
}

/**
 * The straight-line start for a Shift+pointer-down, or null when there's no line to draw — Shift not
 * held, no prior stroke for this tool, or the stored anchor belongs to a different document. Callers
 * fall back to a single dab in the null case, which preserves the original click behaviour exactly.
 */
export function brushStraightLineStart(
  toolKey: string,
  docId: string,
  mods: Pick<Modifiers, 'shift'>,
): Point | null {
  if (!mods.shift) return null;
  const anchor = anchors.get(toolKey);
  if (!anchor || anchor.docId !== docId) return null;
  return { x: anchor.point.x, y: anchor.point.y };
}

/** Forget a tool's anchor (used by tests; live strokes simply overwrite it). Pass no key to clear all. */
export function clearBrushStrokeAnchor(toolKey?: string): void {
  if (toolKey === undefined) anchors.clear();
  else anchors.delete(toolKey);
}
