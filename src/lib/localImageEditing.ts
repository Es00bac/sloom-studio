import { normalizeClipCrop, type ClipCropSettings } from './editorClipEffects';

export interface ImageCropRegionInput extends Pick<
  ClipCropSettings,
  'cropLeftPercent' | 'cropRightPercent' | 'cropTopPercent' | 'cropBottomPercent'
> {
  sourceWidth: number;
  sourceHeight: number;
}

export interface ImageCropRegion {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface CropImageDataUrlInput extends Pick<
  ClipCropSettings,
  'cropLeftPercent' | 'cropRightPercent' | 'cropTopPercent' | 'cropBottomPercent'
> {
  dataUrl: string;
  mimeType?: string;
  quality?: number;
}

export interface CompositeImageRegionInput {
  baseDataUrl: string;
  patchDataUrl: string;
  region: ImageCropRegion;
  mimeType?: string;
  quality?: number;
}

export function normalizeImageCropRegion(input: ImageCropRegionInput): ImageCropRegion {
  const crop = normalizeClipCrop({
    cropLeftPercent: input.cropLeftPercent,
    cropRightPercent: input.cropRightPercent,
    cropTopPercent: input.cropTopPercent,
    cropBottomPercent: input.cropBottomPercent,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
  });
  const width = Math.max(1, Math.round(input.sourceWidth));
  const height = Math.max(1, Math.round(input.sourceHeight));
  const sourceX = Math.round(width * (crop.cropLeftPercent / 100));
  const sourceY = Math.round(height * (crop.cropTopPercent / 100));
  const sourceWidth = Math.max(1, Math.round(width * ((100 - crop.cropLeftPercent - crop.cropRightPercent) / 100)));
  const sourceHeight = Math.max(1, Math.round(height * ((100 - crop.cropTopPercent - crop.cropBottomPercent) / 100)));

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
  };
}

export async function cropImageDataUrl(input: CropImageDataUrlInput): Promise<string> {
  const image = await loadImage(input.dataUrl);
  const region = normalizeImageCropRegion({
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    cropLeftPercent: input.cropLeftPercent,
    cropRightPercent: input.cropRightPercent,
    cropTopPercent: input.cropTopPercent,
    cropBottomPercent: input.cropBottomPercent,
  });
  const canvas = document.createElement('canvas');
  canvas.width = region.sourceWidth;
  canvas.height = region.sourceHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create a canvas context for the image crop.');
  }

  context.drawImage(
    image,
    region.sourceX,
    region.sourceY,
    region.sourceWidth,
    region.sourceHeight,
    0,
    0,
    region.sourceWidth,
    region.sourceHeight,
  );

  return canvas.toDataURL(input.mimeType ?? 'image/png', input.quality ?? 0.92);
}

export async function compositeImageRegion(input: CompositeImageRegionInput): Promise<string> {
  const [baseImage, patchImage] = await Promise.all([
    loadImage(input.baseDataUrl),
    loadImage(input.patchDataUrl),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = baseImage.naturalWidth;
  canvas.height = baseImage.naturalHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create a canvas context for the image edit.');
  }

  context.drawImage(baseImage, 0, 0);
  context.drawImage(
    patchImage,
    0,
    0,
    patchImage.naturalWidth,
    patchImage.naturalHeight,
    input.region.sourceX,
    input.region.sourceY,
    input.region.sourceWidth,
    input.region.sourceHeight,
  );

  return canvas.toDataURL(input.mimeType ?? 'image/png', input.quality ?? 0.92);
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be loaded for local editing.'));
    image.src = dataUrl;
  });
}
