import type { ImageArtboardMetadata, ImageDocument } from '../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { buildImageArtboardsPrintExportReadiness } from './ImageArtboards';

/**
 * Trim PNG is a local, whole-document flatten followed by an independent
 * raster crop. Keep both the source flatten and each output bounded rather
 * than allocating a hostile artboard-sized canvas in a browser tab.
 */
export const IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS = 32 * 1024 * 1024;

export interface ImageArtboardRasterExportResult {
  artboardId: string;
  filename: string;
  status: 'exported' | 'skipped' | 'failed' | 'cancelled';
  blob?: Blob;
  error?: string;
}

export interface ImageArtboardRasterExportOptions {
  /** Stops future artboards between isolated output attempts. The active browser encoder cannot be interrupted. */
  signal?: AbortSignal;
}

export function isImageArtboardTrimPngResourceBounded(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= Math.floor(IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS / height);
}

/**
 * Copies an artboard rectangle from a flattened document buffer. Pixels beyond
 * the source remain transparent, but normal execution refuses readiness-blocked
 * artboards so clipped/invalid geometry does not silently become an output.
 */
export function cropImageArtboardRgba(
  source: Pick<ImageData, 'width' | 'height' | 'data'>,
  artboard: Pick<ImageArtboardMetadata, 'x' | 'y' | 'width' | 'height'>,
): ImageData {
  const width = Math.max(1, Math.floor(artboard.width));
  const height = Math.max(1, Math.floor(artboard.height));
  const output = new Uint8ClampedArray(width * height * 4);
  const sourceX = Math.floor(artboard.x);
  const sourceY = Math.floor(artboard.y);

  for (let y = 0; y < height; y += 1) {
    const documentY = sourceY + y;
    if (documentY < 0 || documentY >= source.height) continue;
    for (let x = 0; x < width; x += 1) {
      const documentX = sourceX + x;
      if (documentX < 0 || documentX >= source.width) continue;
      const sourceOffset = (documentY * source.width + documentX) * 4;
      const outputOffset = (y * width + x) * 4;
      output.set(source.data.slice(sourceOffset, sourceOffset + 4), outputOffset);
    }
  }

  return typeof ImageData === 'undefined'
    ? ({ width, height, data: output } as ImageData)
    : new ImageData(output, width, height);
}

/**
 * Exports every currently valid artboard as an independent flattened PNG.
 * Each invalid or encoding-failed artboard is reported separately, leaving
 * unrelated ready artboards available for download.
 */
export async function exportImageArtboardsToPng(
  doc: ImageDocument,
  options: ImageArtboardRasterExportOptions = {},
): Promise<ImageArtboardRasterExportResult[]> {
  const readiness = buildImageArtboardsPrintExportReadiness(doc);
  const cancelled = (artboard: typeof readiness.artboards[number]): ImageArtboardRasterExportResult => ({
    artboardId: artboard.id,
    filename: `${artboard.filenamePolicy.resolvedBasename}.png`,
    status: 'cancelled',
    error: 'Trim PNG export was cancelled before this artboard started.',
  });
  if (options.signal?.aborted) return readiness.artboards.map(cancelled);

  const documentWithinResourceLimit = isImageArtboardTrimPngResourceBounded(doc.width, doc.height);
  const resourceErrorFor = (artboard: typeof readiness.artboards[number]): string | undefined => {
    if (!documentWithinResourceLimit) {
      return `Trim PNG export refuses source documents above ${IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS.toLocaleString('en-US')} pixels.`;
    }
    const { width, height } = artboard.bounds.trim;
    if (!isImageArtboardTrimPngResourceBounded(width, height)) {
      return `Trim PNG export refuses artboards above ${IMAGE_ARTBOARD_TRIM_PNG_MAX_PIXELS.toLocaleString('en-US')} output pixels.`;
    }
    return undefined;
  };

  const resourceErrors = readiness.artboards.map(resourceErrorFor);
  if (!readiness.artboards.some((artboard, index) => artboard.blockers.length === 0 && !resourceErrors[index])) {
    return readiness.artboards.map((artboard, index) => ({
      artboardId: artboard.id,
      filename: `${artboard.filenamePolicy.resolvedBasename}.png`,
      status: 'skipped' as const,
      error: resourceErrors[index] ?? artboard.blockers.map((blocker) => blocker.summary).join(' '),
    }));
  }

  let flattened: ImageData;
  try {
    flattened = getBitmapImageData(renderImageDocumentLayersToBitmap(doc));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The visible document could not be flattened.';
    return readiness.artboards.map((artboard) => ({
      artboardId: artboard.id,
      filename: `${artboard.filenamePolicy.resolvedBasename}.png`,
      status: 'failed',
      error: message,
    }));
  }

  const results: ImageArtboardRasterExportResult[] = [];
  for (const [index, entry] of readiness.artboards.entries()) {
    const filename = `${entry.filenamePolicy.resolvedBasename}.png`;
    if (options.signal?.aborted) {
      results.push(cancelled(entry));
      continue;
    }
    if (entry.blockers.length > 0) {
      results.push({
        artboardId: entry.id,
        filename,
        status: 'skipped',
        error: entry.blockers.map((blocker) => blocker.summary).join(' '),
      });
      continue;
    }
    const resourceError = resourceErrors[index];
    if (resourceError) {
      results.push({
        artboardId: entry.id,
        filename,
        status: 'skipped',
        error: resourceError,
      });
      continue;
    }

    try {
      const bitmap = createBitmap(entry.bounds.trim.width, entry.bounds.trim.height);
      putBitmapImageData(bitmap, cropImageArtboardRgba(flattened, entry.bounds.trim));
      results.push({
        artboardId: entry.id,
        filename,
        status: 'exported' as const,
        blob: await bitmap.convertToBlob({ type: 'image/png' }),
      });
    } catch (error) {
      results.push({
        artboardId: entry.id,
        filename,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : 'PNG encoding failed.',
      });
    }
  }
  return results;
}
