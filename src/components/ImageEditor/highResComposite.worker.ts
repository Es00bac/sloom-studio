/**
 * Full-resolution document compositor, off the main thread.
 *
 * This is a real Vite module worker. Its predecessor was a Blob URL assembled from
 * `Function.prototype.toString()` of ~30 helpers — which broke in every minified build:
 * each stringified function's internal calls referenced its own module's minified names
 * (e.g. `_r`), which don't exist inside the blob's scope. The crash left the renderer's
 * cached signature poisoned and the canvas permanently blank on synced documents
 * (docs/notes/820). Bundling the worker as a module lets the imports resolve normally
 * under any minifier.
 *
 * Message contract (unchanged from the blob worker):
 *   in:  { docWidth, docHeight, layers: WorkerLayer[] }  (bitmaps arrive as transferred ImageBitmaps)
 *   out: { result: ImageBitmap }                          (transferred)
 */
import { applyAdjustmentToImageData } from './ImageAdjustmentLayer';
import { drawLayerBitmapTransformed, type TransformLayerLike } from './ImageLayerTransform';
import type { ImageLayer } from '../../types/imageEditor';
import {
  compositePixelBuffersForTarget,
  NativeCompositeRefusal,
  type NativeCompositeLayer,
} from './pixels/compositeBuffers';
import { convertPixelBuffer } from './pixels/PixelBuffer';

/** The flattened layer payload CompositeRenderer sends (subset of ImageLayer + prepared bitmaps). */
interface WorkerLayer {
  visible: boolean;
  type?: ImageLayer['type'];
  adjustment?: ImageLayer['adjustment'];
  opacity?: number;
  blendMode?: ImageLayer['blendMode'];
  maskBitmap?: ImageBitmap | null;
  bitmap?: ImageBitmap | null;
  offsetX?: number;
  offsetY?: number;
}

interface CompositeRequest {
  docWidth: number;
  docHeight: number;
  layers: WorkerLayer[];
  nativeLayers?: NativeCompositeLayer[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

self.onmessage = (event: MessageEvent<CompositeRequest>) => {
  const { docWidth, docHeight, layers } = event.data;
  if (event.data.nativeLayers) {
    try {
      const pixels = compositePixelBuffersForTarget(event.data.nativeLayers, docWidth, docHeight);
      const canvas = new OffscreenCanvas(docWidth, docHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        (self as unknown as Worker).postMessage({ error: 'High-resolution compositor could not acquire a 2D context.' });
        return;
      }
      const proxy = pixels.depth === 'u8' ? pixels : convertPixelBuffer(pixels, 'u8');
      const proxyData = new Uint8ClampedArray(proxy.data as Uint8Array);
      ctx.putImageData(new ImageData(proxyData, proxy.width, proxy.height), 0, 0);
      const outBitmap = canvas.transferToImageBitmap();
      (self as unknown as Worker).postMessage({ result: outBitmap }, [outBitmap]);
    } catch (error) {
      if (!(error instanceof NativeCompositeRefusal)) throw error;
      (self as unknown as Worker).postMessage({
        refusal: { code: error.code, message: error.message },
      });
    }
    return;
  }

  const canvas = new OffscreenCanvas(docWidth, docHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    (self as unknown as Worker).postMessage({ error: 'High-resolution compositor could not acquire a 2D context.' });
    return;
  }

  for (const layer of layers) {
    if (!layer.visible) continue;
    if (layer.type === 'group') continue;

    if (layer.type === 'adjustment' && layer.adjustment) {
      const source = ctx.getImageData(0, 0, docWidth, docHeight);
      let maskData: ImageData | undefined;
      if (layer.maskBitmap) {
        const maskCanvas = new OffscreenCanvas(layer.maskBitmap.width, layer.maskBitmap.height);
        const mCtx = maskCanvas.getContext('2d');
        if (mCtx) {
          mCtx.drawImage(layer.maskBitmap, 0, 0);
          maskData = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        }
      }
      const adjusted = applyAdjustmentToImageData(source, layer.adjustment, {
        opacity: layer.opacity,
        mask: maskData,
      });
      ctx.putImageData(adjusted, 0, 0);
      continue;
    }

    if (layer.bitmap) {
      ctx.save();
      ctx.globalAlpha = clamp01(layer.opacity ?? 1);
      ctx.globalCompositeOperation = layer.blendMode === 'normal' || !layer.blendMode
        ? 'source-over'
        : (layer.blendMode as GlobalCompositeOperation);
      drawLayerBitmapTransformed(
        ctx,
        layer.bitmap,
        layer as unknown as TransformLayerLike,
        layer.offsetX || 0,
        layer.offsetY || 0,
      );
      ctx.restore();
    }
  }

  const outBitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ result: outBitmap }, [outBitmap]);
};
