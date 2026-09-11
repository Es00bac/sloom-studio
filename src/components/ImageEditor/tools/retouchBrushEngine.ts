import { createBitmap, getBitmapImageData } from '../LayerBitmap';
import { buildRetouchSampleSource, type RetouchSampleSource } from '../ImageRetouch';
import { DEFAULT_RETOUCH_TOOL_SETTINGS, type ImageLayer, type LayerBitmap } from '../../../types/imageEditor';
import { BrushStrokeController, detectBrushBackend, type BrushOp } from '../../../lib/brushEngine';
import type { ToolEnv } from './types';

/**
 * Builds a region-bounded brush-engine stroke controller for a retouch tool. The sample source is
 * snapshotted ONCE into layer-local pixels (composite/allLayers modes are aligned to the layer grid
 * here, not re-read per dab), so the stroke never re-reads the whole canvas mid-drag.
 */
export function createRetouchStrokeController(
  env: ToolEnv,
  layer: ImageLayer,
  bitmapBefore: LayerBitmap,
  op: BrushOp,
): BrushStrokeController {
  const retouchSettings = env.retouchToolSettings ?? DEFAULT_RETOUCH_TOOL_SETTINGS;
  const sampleSource = buildRetouchSampleSource({
    doc: env.doc,
    layer,
    layerSnapshot: bitmapBefore,
    sampleMode: retouchSettings.sampleMode,
  });
  // GPU acceleration is on by default (DEFAULT_BRUSH_SETTINGS.gpuBrushEngine === true): 'auto' picks the
  // fastest available backend (WebGL2 GPU when present, region-bounded CPU fallback otherwise). Turning the
  // toggle off forces CPU — a real escape hatch for misbehaving GPU drivers. Both paths are dirty-rect bounded.
  const selection = detectBrushBackend(env.brushSettings.gpuBrushEngine ? 'auto' : 'cpu');
  return new BrushStrokeController(selection.backend, {
    source: getBitmapImageData(bitmapBefore),
    sampleSource: { imageData: buildLayerLocalSampleImageData(sampleSource, bitmapBefore, layer.x, layer.y) },
    width: bitmapBefore.width,
    height: bitmapBefore.height,
    op,
    size: env.brushSettings.size,
    strength: env.brushSettings.opacity,
  });
}

/** A single layer-local snapshot of the sample source (composite modes are aligned once). */
function buildLayerLocalSampleImageData(
  sampleSource: RetouchSampleSource,
  layerBitmap: LayerBitmap,
  layerX: number,
  layerY: number,
): ImageData {
  if (sampleSource.coordinateSpace === 'document') {
    const aligned = createBitmap(layerBitmap.width, layerBitmap.height);
    aligned.getContext('2d')?.drawImage(sampleSource.bitmap, -layerX, -layerY);
    return getBitmapImageData(aligned);
  }
  return getBitmapImageData(sampleSource.bitmap);
}
