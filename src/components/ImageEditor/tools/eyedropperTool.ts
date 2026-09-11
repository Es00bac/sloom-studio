import type { ToolEnv, ToolHandler, Point, Modifiers } from './types';
import { renderImageDocumentLayersToBitmap } from '../ImageAdjustmentLayer';
import { renderLayerWithEffects } from '../ImageLayerEffects';
import { samplePixelColorFromCanvas } from '../../Paper/PaperWorkspaceUtils';

export const eyedropperTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    sample(env, point, mods);
  },
  onPointerMove(env, point, mods, event) {
    if (event.buttons !== 1) return;
    sample(env, point, mods);
  },
};

function sample(env: ToolEnv, point: Point, mods: Modifiers): void {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= env.doc.width || y >= env.doc.height) return;

  const sampleBitmap = mods.alt && env.activeLayer
    ? renderLayerWithEffects(env.activeLayer)
    : { bitmap: renderImageDocumentLayersToBitmap(env.doc), offsetX: 0, offsetY: 0 };
  if (!sampleBitmap) return;
  const sourceX = mods.alt && env.activeLayer
    ? x - env.activeLayer.x - sampleBitmap.offsetX
    : x;
  const sourceY = mods.alt && env.activeLayer
    ? y - env.activeLayer.y - sampleBitmap.offsetY
    : y;
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX >= sampleBitmap.bitmap.width ||
    sourceY >= sampleBitmap.bitmap.height
  ) {
    return;
  }
  const sampleColor = samplePixelColorFromCanvas({
    bitmap: sampleBitmap.bitmap,
    x: sourceX,
    y: sourceY,
  });
  if ('reason' in sampleColor) return;
  env.store.setBrushSettings({ color: sampleColor.color });
}
