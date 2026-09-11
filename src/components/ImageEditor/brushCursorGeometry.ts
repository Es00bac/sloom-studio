/** Geometry for the Photoshop/GIMP-style brush-preview cursor. Pure + tested so
 * the visual overlay (`BrushCursorOverlay`) stays a thin renderer. */

export interface BrushCursorRing {
  width: number;
  height: number;
}

export interface BrushCursorRings {
  /** Full brush footprint (size × roundness). */
  outer: BrushCursorRing;
  /** Approximate hard-core boundary for soft brushes; absent for hard brushes. */
  inner?: BrushCursorRing;
}

const MIN_DIAMETER = 4;
const MAX_DIAMETER = 2000;
/** Below this the inner/outer rings are too close to tell apart — skip the ring. */
const MIN_VISIBLE_RING_GAP_PX = 3;

/**
 * Resolve the outer footprint and, for soft brushes, a fainter inner ring at the
 * approximate hard-core radius (`diameter × hardness`). The inner ring is only
 * returned when `hardness < 1` and the gap from the outer ring is wide enough to
 * be legible, so hard brushes (and tiny brushes) stay a single clean outline.
 */
export function computeBrushCursorRings(input: {
  sizePx: number;
  roundness: number;
  hardness: number;
}): BrushCursorRings {
  const diameter = Math.max(MIN_DIAMETER, Math.min(MAX_DIAMETER, input.sizePx));
  const roundness = input.roundness > 0 ? input.roundness : 1;
  const height = Math.max(MIN_DIAMETER, diameter * roundness);
  const outer: BrushCursorRing = { width: diameter, height };

  const hardness = Math.min(1, Math.max(0, input.hardness));
  const coreDiameter = diameter * hardness;

  if (hardness < 0.99 && diameter - coreDiameter >= MIN_VISIBLE_RING_GAP_PX) {
    return {
      outer,
      inner: {
        width: Math.max(2, coreDiameter),
        height: Math.max(2, height * hardness),
      },
    };
  }

  return { outer };
}
