import type { AspectRatio } from '../types/flow';

/**
 * Doodle Node helpers — a sketch canvas node that hands an Image node an
 * "asset package": the drawn reference image plus a description (typed in the
 * node, or taken from an attached Text node).
 */

export const DOODLE_PENCIL_COLOR = '#5b8def'; // manga "non-photo" blue pencil
export const DEFAULT_DOODLE_ASPECT_RATIO: AspectRatio = '1:1';

/** The asset package a Doodle Node feeds downstream. */
export interface DoodleAssetPackage {
  /** Sketch image as a data URL, or null when nothing has been drawn yet. */
  image: string | null;
  /** Resolved description: an attached Text node wins, else the typed box. */
  description: string;
}

/**
 * Resolve the package. An attached upstream Text node takes precedence over the
 * node's own typed description (the box is the fallback when nothing is wired).
 */
export function buildDoodleAssetPackage(input: {
  sketch?: string | null;
  ownDescription?: string;
  upstreamText?: string;
}): DoodleAssetPackage {
  const own = (input.ownDescription ?? '').trim();
  const upstream = (input.upstreamText ?? '').trim();
  const sketch = (input.sketch ?? '').trim();
  return {
    image: sketch ? sketch : null,
    description: upstream || own,
  };
}

/**
 * Pixel dimensions for the sketch canvas of a given aspect ratio, fitted within
 * a `baseSize` square (longest side = baseSize), preserving the ratio.
 */
export function doodleCanvasDimensions(
  aspectRatio: AspectRatio,
  baseSize = 1024,
): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map((part) => Number.parseInt(part, 10));
  if (!w || !h || w <= 0 || h <= 0) return { width: baseSize, height: baseSize };
  if (w >= h) {
    return { width: baseSize, height: Math.round((baseSize * h) / w) };
  }
  return { width: Math.round((baseSize * w) / h), height: baseSize };
}
