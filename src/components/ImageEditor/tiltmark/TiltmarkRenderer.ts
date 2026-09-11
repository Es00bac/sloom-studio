/**
 * Sloom Studio (GPL) — physical-media dab presentation seam. The engine that authors dabs is
 * not included in this build, so these presenters never receive dabs at runtime. They exist so
 * the Image and Paper workspaces compile unchanged and fail closed if reached.
 */
import type { BrushSymmetryMode, ImageLayer } from '../../../types/imageEditor';
import type { TiltmarkBrushDab } from './TiltmarkTypes';
import { TILTMARK_ENGINE_ABSENT_MESSAGE } from './TiltmarkRuntime';

export type TiltmarkCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TiltmarkMixerState {
  color: string | null;
  load: number;
}

export const EMPTY_TILTMARK_MIXER_STATE: TiltmarkMixerState = { color: null, load: 0 };

export interface TiltmarkCoverageRaster {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8ClampedArray;
}

export interface TiltmarkRenderOptions {
  alphaLocked?: boolean;
  forceColor?: string;
  forceCompositeOperation?: GlobalCompositeOperation;
  textureAssets?: ReadonlyMap<string, unknown>;
  ephemeralOverlay?: boolean;
}

function engineAbsent(): never {
  throw new Error(TILTMARK_ENGINE_ABSENT_MESSAGE);
}

export function renderTiltmarkDabs(
  _context: TiltmarkCanvasContext,
  dabs: readonly TiltmarkBrushDab[],
  _options: TiltmarkRenderOptions = {},
): void {
  if (dabs.length === 0) return;
  engineAbsent();
}

export function resolveTiltmarkRasterInteractions(
  _context: TiltmarkCanvasContext,
  dabs: readonly TiltmarkBrushDab[],
  _state: TiltmarkMixerState,
  _layer: Pick<ImageLayer, 'x' | 'y'>,
): TiltmarkBrushDab[] {
  if (dabs.length === 0) return [];
  return engineAbsent();
}

export function buildTiltmarkSymmetryDabs(
  dabs: readonly TiltmarkBrushDab[],
  _mode: BrushSymmetryMode,
  _center: { x: number; y: number; width?: number; height?: number },
): TiltmarkBrushDab[] {
  if (dabs.length === 0) return [];
  return engineAbsent();
}

export function rasterizeTiltmarkDabCoverage(
  _dabs: readonly TiltmarkBrushDab[],
  _documentWidth: number,
  _documentHeight: number,
  _textureAssets?: ReadonlyMap<string, unknown>,
): TiltmarkCoverageRaster | null {
  return null;
}

export function tiltmarkDabsDocumentRect(
  dabs: readonly TiltmarkBrushDab[],
): { x: number; y: number; width: number; height: number } | null {
  if (dabs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const dab of dabs) {
    const half = Math.max(dab.width, dab.height) / 2;
    minX = Math.min(minX, dab.x - half); minY = Math.min(minY, dab.y - half);
    maxX = Math.max(maxX, dab.x + half); maxY = Math.max(maxY, dab.y + half);
  }
  return { x: Math.floor(minX), y: Math.floor(minY), width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}

export function tiltmarkDabsBitmapRect(
  dabs: readonly TiltmarkBrushDab[],
  layer: Pick<ImageLayer, 'x' | 'y'>,
  bitmap: Pick<OffscreenCanvas, 'width' | 'height'>,
): { x: number; y: number; width: number; height: number } | null {
  const rect = tiltmarkDabsDocumentRect(dabs);
  if (!rect) return null;
  const x = Math.max(0, rect.x - layer.x);
  const y = Math.max(0, rect.y - layer.y);
  const width = Math.min(bitmap.width - x, rect.width + (rect.x - layer.x - x));
  const height = Math.min(bitmap.height - y, rect.height + (rect.y - layer.y - y));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
