import type { ImageProvider, ImageTargetHandle } from '../types/flow';
import { getImageModelCapabilities } from './imageProviderCapabilities';

export const IMAGE_REFERENCE_HANDLES: Array<
  Extract<
    ImageTargetHandle,
    | 'image-reference-1'
    | 'image-reference-2'
    | 'image-reference-3'
    | 'image-reference-4'
    | 'image-reference-5'
    | 'image-reference-6'
    | 'image-reference-7'
    | 'image-reference-8'
    | 'image-reference-9'
    | 'image-reference-10'
    | 'image-reference-11'
    | 'image-reference-12'
    | 'image-reference-13'
    | 'image-reference-14'
  >
> = [
  'image-reference-1',
  'image-reference-2',
  'image-reference-3',
  'image-reference-4',
  'image-reference-5',
  'image-reference-6',
  'image-reference-7',
  'image-reference-8',
  'image-reference-9',
  'image-reference-10',
  'image-reference-11',
  'image-reference-12',
  'image-reference-13',
  'image-reference-14',
];

export const IMAGE_MASK_HANDLE: Extract<ImageTargetHandle, 'image-mask'> = 'image-mask';

export function supportsImageEditing(
  provider: ImageProvider,
  modelId: string | undefined,
): boolean {
  const capabilities = getImageModelCapabilities(provider, modelId);
  return capabilities.imageToImage || capabilities.promptEdit || capabilities.maskInpaint;
}

export function supportsImageReferenceGuidance(
  provider: ImageProvider,
  modelId: string | undefined,
): boolean {
  return getImageModelCapabilities(provider, modelId).referenceImages;
}

export function supportsTrueMaskInpaint(
  provider: ImageProvider,
  modelId: string | undefined,
): boolean {
  return getImageModelCapabilities(provider, modelId).maskInpaint;
}

export function supportsImageSearchReplace(
  provider: ImageProvider,
  modelId: string | undefined,
): boolean {
  return getImageModelCapabilities(provider, modelId).searchReplace;
}

export function isImageEditSourceHandle(
  handle: ImageTargetHandle | string | undefined,
): handle is Extract<ImageTargetHandle, 'image-edit-source'> {
  return handle === 'image-edit-source';
}

export function isImageMaskHandle(
  handle: ImageTargetHandle | string | undefined,
): handle is Extract<ImageTargetHandle, 'image-mask'> {
  return handle === IMAGE_MASK_HANDLE;
}

export function isImageReferenceHandle(
  handle: ImageTargetHandle | string | undefined,
): handle is (typeof IMAGE_REFERENCE_HANDLES)[number] {
  return IMAGE_REFERENCE_HANDLES.includes(handle as (typeof IMAGE_REFERENCE_HANDLES)[number]);
}

export function isImageConditioningHandle(
  handle: ImageTargetHandle | string | undefined,
): handle is ImageTargetHandle {
  return isImageEditSourceHandle(handle) || isImageMaskHandle(handle) || isImageReferenceHandle(handle);
}
