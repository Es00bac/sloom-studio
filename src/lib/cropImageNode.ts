import type { NodeData } from '../types/flow';

export interface CropImageNodeSettings {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export interface CropSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropImageResult {
  dataUrl: string;
  height: number;
  mimeType: string;
  rect: CropSourceRect;
  width: number;
}

export interface CropPreviewOverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_CROP_SETTINGS: CropImageNodeSettings = {
  xPercent: 10,
  yPercent: 10,
  widthPercent: 80,
  heightPercent: 80,
};

export function normalizeCropPercent(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, numeric));
}

export function resolveCropImageNodeSettings(data: Partial<NodeData>): CropImageNodeSettings {
  const xPercent = normalizeCropPercent(data.cropXPercent, DEFAULT_CROP_SETTINGS.xPercent);
  const yPercent = normalizeCropPercent(data.cropYPercent, DEFAULT_CROP_SETTINGS.yPercent);
  const maxWidth = Math.max(1, 100 - xPercent);
  const maxHeight = Math.max(1, 100 - yPercent);

  return {
    xPercent,
    yPercent,
    widthPercent: Math.max(1, Math.min(maxWidth, normalizeCropPercent(data.cropWidthPercent, DEFAULT_CROP_SETTINGS.widthPercent))),
    heightPercent: Math.max(1, Math.min(maxHeight, normalizeCropPercent(data.cropHeightPercent, DEFAULT_CROP_SETTINGS.heightPercent))),
  };
}

export function buildCropSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  settings: CropImageNodeSettings,
): CropSourceRect {
  const imageWidth = Math.max(1, Math.round(sourceWidth));
  const imageHeight = Math.max(1, Math.round(sourceHeight));
  const x = Math.max(0, Math.min(imageWidth - 1, Math.round((settings.xPercent / 100) * imageWidth)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.round((settings.yPercent / 100) * imageHeight)));
  const availableWidth = Math.max(1, imageWidth - x);
  const availableHeight = Math.max(1, imageHeight - y);
  const width = Math.max(1, Math.min(availableWidth, Math.round((settings.widthPercent / 100) * imageWidth)));
  const height = Math.max(1, Math.min(availableHeight, Math.round((settings.heightPercent / 100) * imageHeight)));

  return { x, y, width, height };
}

export function buildCropPreviewOverlayRect(
  sourceWidth: number,
  sourceHeight: number,
  renderedWidth: number,
  renderedHeight: number,
  settings: CropImageNodeSettings,
): CropPreviewOverlayRect {
  const imageWidth = Math.max(1, Math.round(sourceWidth));
  const imageHeight = Math.max(1, Math.round(sourceHeight));
  const previewWidth = Math.max(1, renderedWidth);
  const previewHeight = Math.max(1, renderedHeight);
  const rect = buildCropSourceRect(imageWidth, imageHeight, settings);

  return {
    left: (rect.x / imageWidth) * previewWidth,
    top: (rect.y / imageHeight) * previewHeight,
    width: (rect.width / imageWidth) * previewWidth,
    height: (rect.height / imageHeight) * previewHeight,
  };
}

export async function cropImageDataUrl(
  sourceImageUrl: string,
  settings: CropImageNodeSettings,
  options: { mimeType?: string; signal?: AbortSignal } = {},
): Promise<CropImageResult> {
  if (!sourceImageUrl.trim()) {
    throw new Error('Connect an image source before running the crop node.');
  }

  const image = await loadCropSourceImage(sourceImageUrl, options.signal);
  throwIfAborted(options.signal);

  const rect = buildCropSourceRect(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    settings,
  );
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('The browser could not create a canvas for image cropping.');
  }

  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );

  const mimeType = options.mimeType ?? 'image/png';
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL(mimeType);
  } catch (error) {
    throw new Error(error instanceof Error
      ? `The cropped image could not be exported: ${error.message}`
      : 'The cropped image could not be exported.');
  }

  return {
    dataUrl,
    height: rect.height,
    mimeType,
    rect,
    width: rect.width,
  };
}

function loadCropSourceImage(sourceImageUrl: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);

    const image = new Image();
    if (/^https?:\/\//i.test(sourceImageUrl)) {
      image.crossOrigin = 'anonymous';
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('The crop run was cancelled.', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('Unable to load the connected source image for cropping.'));
    };
    image.src = sourceImageUrl;
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The crop run was cancelled.', 'AbortError');
  }
}
