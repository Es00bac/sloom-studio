/** Sloom Studio (GPL) — without the physical-media engine a surface preview is just the base layer. */
import type { TiltmarkLayerSubstrateRaster } from './TiltmarkRuntime';

export function composeTiltmarkSurfacePreview(
  preview: OffscreenCanvas,
  base: OffscreenCanvas | null | undefined,
  _substrate: TiltmarkLayerSubstrateRaster | null,
): void {
  const context = preview.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, preview.width, preview.height);
  if (base) context.drawImage(base, 0, 0);
}
