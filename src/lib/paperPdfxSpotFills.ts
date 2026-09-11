// Legacy preflight adapter: find the frames on a page whose fill is a real SPOT swatch and turn each into a
// PdfxSpotFill spec for the exporter's /Separation plate, plus the ids of the frames whose fill must be
// knocked out of the flattened raster (so the spot ink lives ONLY on its named plate, not doubled as
// process). Conservative by construction: an un-stroked rectangle (optionally rotated about its centre
// and/or rounded-cornered) OR a closed polygon (≥3 vertices) can become a spot plate — the /Separation
// shape has to line up exactly with the knocked-out region. A partial fill opacity is kept as the spot TINT
// (a screen of the ink). Anything fancier (gradient, a border, or a swatch with no CMYK alternate) stays
// process CMYK and is disclosed in preflight. Framework-free + unit-testable.

import type { PaperDocument, PaperFrame, PaperPage } from '../types/paper';
import type { PaperSwatch } from './paperSwatches';
import type { PdfxSpotFill } from './paperPdfxExport';

const PT_PER_MM = 72 / 25.4;

export interface SpotFillPlan {
  /** Spot rectangles to draw as /Separation plates, in points from the media (bleed) top-left. */
  spotFills: PdfxSpotFill[];
  /** Frames whose fill must be removed from the flatten raster (their spot ink is on the plate instead). */
  knockoutFrameIds: string[];
  /** Spot swatch names that ARE preserved as plates (for honest preflight disclosure). */
  preservedSpotNames: string[];
}

const num = (v: number | undefined): number => (typeof v === 'number' ? v : 0);

export interface PaperSpotAlternateConflict {
  name: string;
  firstSwatchId: string;
  conflictingSwatchId: string;
}

/**
 * A PDF/X Separation name identifies exactly one alternate color recipe. Detect conflicts before output so
 * the native writer never chooses one arbitrary plate definition for two differently-authored swatches.
 */
export function findPaperSpotAlternateConflicts(swatches: readonly PaperSwatch[]): PaperSpotAlternateConflict[] {
  const definitions = new Map<string, { swatchId: string; c: number; m: number; y: number; k: number }>();
  const conflicts: PaperSpotAlternateConflict[] = [];
  for (const swatch of swatches) {
    if (swatch.type !== 'spot' || !swatch.cmyk) continue;
    const name = swatch.spotName?.trim() || swatch.name;
    const alternate = { swatchId: swatch.id, c: swatch.cmyk.c, m: swatch.cmyk.m, y: swatch.cmyk.y, k: swatch.cmyk.k };
    const existing = definitions.get(name);
    if (!existing) {
      definitions.set(name, alternate);
      continue;
    }
    if (existing.c !== alternate.c || existing.m !== alternate.m || existing.y !== alternate.y || existing.k !== alternate.k) {
      conflicts.push({ name, firstSwatchId: existing.swatchId, conflictingSwatchId: swatch.id });
    }
  }
  return conflicts;
}

/** True when a frame is a rectangle we can faithfully replace with a single /Separation rect (optionally
 * rotated about its centre). A partial fill opacity is allowed — it becomes the spot TINT (a screen of the
 * ink), which is exactly what the plate's `scn <tint>` expresses. A fully transparent fill (opacity 0) is
 * nothing to plate. */
function isPlateableRect(frame: PaperFrame): boolean {
  // Rotation, rounded corners, and closed polygons (≥3 vertices) are allowed — the plate draws the matching
  // rotated/rounded/polygon shape. A degenerate 1–2 vertex "polygon" can't form a face → not plateable.
  if (frame.vertices && frame.vertices.length > 0 && frame.vertices.length < 3) return false;
  if (frame.fillGradient) return false;
  if (num(frame.fillOpacity) <= 0) return false; // invisible fill — no plate
  if (frame.bubbleShape) return false;
  // A visible stroke would be overpainted by the spot rect (drawn on top of the raster) — require none.
  const hasStroke = num(frame.strokeWidthMm) > 0 && frame.strokeColor !== 'transparent' && num(frame.strokeOpacity) > 0;
  return !hasStroke;
}

/** The spot tint (0..1) a frame's fill contributes — its fill opacity, so a screened swatch plates at its
 * screen density. Defaults to solid (1) when opacity is unset. */
function spotTint(frame: PaperFrame): number {
  const opacity = frame.fillOpacity;
  return typeof opacity === 'number' ? Math.max(0, Math.min(1, opacity)) : 1;
}

export function collectSpotFills(page: PaperPage, document: PaperDocument): SpotFillPlan {
  const spotById = new Map<string, PaperSwatch>();
  for (const swatch of document.swatches ?? []) {
    if (swatch.type === 'spot') spotById.set(swatch.id, swatch);
  }
  const spotFills: PdfxSpotFill[] = [];
  const knockoutFrameIds: string[] = [];
  const preserved = new Set<string>();
  if (spotById.size === 0) return { spotFills, knockoutFrameIds, preservedSpotNames: [] };

  const bleedMm = document.page.bleedMm;
  for (const frame of page.frames) {
    if (!frame.fillSwatchId) continue;
    const swatch = spotById.get(frame.fillSwatchId);
    if (!swatch || !swatch.cmyk) continue; // no CMYK alternate → can't build a plate
    if (!isPlateableRect(frame)) continue; // not faithfully replaceable → leave as process (disclosed)

    const rot = num(frame.rotationDeg);
    // A polygon frame is a rectangle clipped to vertex percentages of its box (CSS clip-path: polygon) —
    // map those to absolute plate points so the /Separation shape matches the knocked-out clip.
    const verts = frame.vertices;
    const polygon = verts && verts.length >= 3
      ? verts.map((v) => ({
          xPt: (bleedMm + frame.xMm + (v.xPercent / 100) * frame.widthMm) * PT_PER_MM,
          yTopPt: (bleedMm + frame.yMm + (v.yPercent / 100) * frame.heightMm) * PT_PER_MM,
        }))
      : undefined;
    spotFills.push({
      name: swatch.spotName ?? swatch.name,
      cmyk: { c: swatch.cmyk.c / 100, m: swatch.cmyk.m / 100, y: swatch.cmyk.y / 100, k: swatch.cmyk.k / 100 },
      tint: spotTint(frame), // fill opacity → screen density on the plate (1 = solid)
      xPt: (bleedMm + frame.xMm) * PT_PER_MM,
      yTopPt: (bleedMm + frame.yMm) * PT_PER_MM,
      widthPt: frame.widthMm * PT_PER_MM,
      heightPt: frame.heightMm * PT_PER_MM,
      // Rotated plate shape: pivot is the frame centre (matches CSS transform-origin: center + the knockout).
      rotationDeg: rot || undefined,
      centerXPt: rot ? (bleedMm + frame.xMm + frame.widthMm / 2) * PT_PER_MM : undefined,
      centerYTopPt: rot ? (bleedMm + frame.yMm + frame.heightMm / 2) * PT_PER_MM : undefined,
      cornerRadiusPt: !polygon && num(frame.cornerRadiusMm) ? frame.cornerRadiusMm! * PT_PER_MM : undefined,
      polygon,
    });
    knockoutFrameIds.push(frame.id);
    preserved.add(swatch.spotName ?? swatch.name);
  }
  return { spotFills, knockoutFrameIds, preservedSpotNames: [...preserved] };
}

/** True when a frame's BORDER can be faithfully replaced by a single stroked /Separation path. The shape
 * must be a rect / rounded-rect / closed polygon (rotation allowed), and the stroke must be a visible SOLID
 * line — a dashed/dotted/double/groove/ridge border can't be reproduced by one solid stroke, so it stays
 * process (disclosed). The fill is irrelevant: it stays process in the raster; only the stroke is knocked
 * out and re-drawn on the plate. */
function isPlateableStroke(frame: PaperFrame): boolean {
  if (frame.vertices && frame.vertices.length > 0 && frame.vertices.length < 3) return false;
  if (frame.bubbleShape) return false;
  if ((frame.strokeStyle ?? 'solid') !== 'solid') return false;
  const visible = num(frame.strokeWidthMm) > 0 && frame.strokeColor !== 'transparent' && num(frame.strokeOpacity) > 0;
  return visible;
}

/** The spot tint (0..1) a frame's STROKE contributes — its stroke opacity (defaults to solid). */
function strokeTint(frame: PaperFrame): number {
  const opacity = frame.strokeOpacity;
  return typeof opacity === 'number' ? Math.max(0, Math.min(1, opacity)) : 1;
}

/** Find the frames whose BORDER is a real spot swatch and turn each into a stroked PdfxSpotFill spec, plus
 * the ids whose stroke must be knocked out of the flatten raster. Mirrors {@link collectSpotFills} for the
 * stroke; a frame can appear in both (a process fill with a spot border, or a spot fill with a spot border
 * of a different ink). */
export function collectSpotStrokes(page: PaperPage, document: PaperDocument): SpotFillPlan {
  const spotById = new Map<string, PaperSwatch>();
  for (const swatch of document.swatches ?? []) {
    if (swatch.type === 'spot') spotById.set(swatch.id, swatch);
  }
  const spotFills: PdfxSpotFill[] = [];
  const knockoutFrameIds: string[] = [];
  const preserved = new Set<string>();
  if (spotById.size === 0) return { spotFills, knockoutFrameIds, preservedSpotNames: [] };

  const bleedMm = document.page.bleedMm;
  for (const frame of page.frames) {
    if (!frame.strokeSwatchId) continue;
    const swatch = spotById.get(frame.strokeSwatchId);
    if (!swatch || !swatch.cmyk) continue; // no CMYK alternate → can't build a plate
    if (!isPlateableStroke(frame)) continue; // not faithfully replaceable → leave as process (disclosed)

    const rot = num(frame.rotationDeg);
    const verts = frame.vertices;
    const polygon = verts && verts.length >= 3
      ? verts.map((v) => ({
          xPt: (bleedMm + frame.xMm + (v.xPercent / 100) * frame.widthMm) * PT_PER_MM,
          yTopPt: (bleedMm + frame.yMm + (v.yPercent / 100) * frame.heightMm) * PT_PER_MM,
        }))
      : undefined;
    spotFills.push({
      name: swatch.spotName ?? swatch.name,
      cmyk: { c: swatch.cmyk.c / 100, m: swatch.cmyk.m / 100, y: swatch.cmyk.y / 100, k: swatch.cmyk.k / 100 },
      tint: strokeTint(frame),
      xPt: (bleedMm + frame.xMm) * PT_PER_MM,
      yTopPt: (bleedMm + frame.yMm) * PT_PER_MM,
      widthPt: frame.widthMm * PT_PER_MM,
      heightPt: frame.heightMm * PT_PER_MM,
      rotationDeg: rot || undefined,
      centerXPt: rot ? (bleedMm + frame.xMm + frame.widthMm / 2) * PT_PER_MM : undefined,
      centerYTopPt: rot ? (bleedMm + frame.yMm + frame.heightMm / 2) * PT_PER_MM : undefined,
      cornerRadiusPt: !polygon && num(frame.cornerRadiusMm) ? frame.cornerRadiusMm! * PT_PER_MM : undefined,
      polygon,
      stroke: { widthPt: num(frame.strokeWidthMm) * PT_PER_MM },
    });
    knockoutFrameIds.push(frame.id);
    preserved.add(swatch.spotName ?? swatch.name);
  }
  return { spotFills, knockoutFrameIds, preservedSpotNames: [...preserved] };
}
