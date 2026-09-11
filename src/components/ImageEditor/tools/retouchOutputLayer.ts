import type { ImageLayer } from '../../../types/imageEditor';
import { cloneBitmap } from '../LayerBitmap';

export type RetouchOutputLayerTool = 'dodge' | 'burn' | 'spongeSaturate' | 'spongeDesaturate';

let retouchOutputLayerCounter = 0;

export function createRetouchOutputLayer(sourceLayer: ImageLayer, tool: RetouchOutputLayerTool): ImageLayer {
  retouchOutputLayerCounter += 1;
  const label = retouchOutputToolLabel(tool);
  const bitmap = sourceLayer.bitmap ? cloneBitmap(sourceLayer.bitmap) : null;
  const mask = sourceLayer.mask ? cloneBitmap(sourceLayer.mask) : null;

  return {
    id: `${sourceLayer.id}-${tool}-retouch-${Date.now()}-${retouchOutputLayerCounter}`,
    name: `${sourceLayer.name} ${label} Retouch`,
    type: 'image',
    visible: true,
    locked: false,
    locks: sourceLayer.locks,
    opacity: 1,
    blendMode: 'normal',
    x: sourceLayer.x,
    y: sourceLayer.y,
    rotationDeg: sourceLayer.rotationDeg,
    skewXDeg: sourceLayer.skewXDeg,
    skewYDeg: sourceLayer.skewYDeg,
    perspectiveX: sourceLayer.perspectiveX,
    perspectiveY: sourceLayer.perspectiveY,
    warp: sourceLayer.warp,
    cornerOffsets: sourceLayer.cornerOffsets,
    transformOriginX: sourceLayer.transformOriginX,
    transformOriginY: sourceLayer.transformOriginY,
    bitmap,
    bitmapVersion: 0,
    mask,
    maskDensity: sourceLayer.maskDensity,
    maskFeather: sourceLayer.maskFeather,
    metadata: {
      retouchOutput: {
        sourceLayerId: sourceLayer.id,
        tool,
        outputMode: 'newLayer',
      },
    },
  };
}

export function insertRetouchOutputLayer(
  layers: readonly ImageLayer[],
  sourceLayerId: string,
  outputLayer: ImageLayer,
): ImageLayer[] {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceLayerId);
  const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : layers.length;
  const nextLayers = [...layers];
  nextLayers.splice(insertAt, 0, outputLayer);
  return nextLayers;
}

function retouchOutputToolLabel(tool: RetouchOutputLayerTool): string {
  switch (tool) {
    case 'dodge':
      return 'Dodge';
    case 'burn':
      return 'Burn';
    case 'spongeSaturate':
      return 'Saturate';
    case 'spongeDesaturate':
      return 'Desaturate';
  }
}
