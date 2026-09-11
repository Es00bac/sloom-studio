import type { ToolEnv, ToolHandler, Point } from './types';
import {
  buildTextLayerName,
  normalizeImageTextStyle,
  rasterizeImageTextStyle,
} from '../ImageTextLayer';
import type { ImageLayer } from '../../../types/imageEditor';

export const textTool: ToolHandler = {
  // Photoshop-style "click and type": dropping the Type tool creates an empty
  // text layer at the click point and immediately opens the on-canvas text
  // editor (the canvas consumes pendingTextEditLayerId). No modal dialog.
  onPointerDown(env, point) {
    const style = normalizeImageTextStyle({ ...env.store.textToolSettings, content: '' });
    addTextLayer(env, point, style);
  },
};

function addTextLayer(
  env: ToolEnv,
  point: Point,
  style: ReturnType<typeof normalizeImageTextStyle>,
): void {
  const bitmap = rasterizeImageTextStyle(style);

  const layer: ImageLayer = {
    id: `layer-text-${Date.now()}`,
    name: buildTextLayerName(style.content),
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: Math.round(point.x),
    y: Math.round(point.y - style.fontSize),
    bitmap,
    bitmapVersion: 0,
    mask: null,
    text: style,
    // freshlyPlaced marks a brand-new empty layer so the canvas can discard it
    // if the user dismisses the editor without typing anything.
    metadata: { editableText: true, freshlyPlaced: true },
  };
  env.store.addLayer(env.doc.id, layer);
  env.store.setPendingTextEditLayerId(layer.id);
  env.requestRender();
}
