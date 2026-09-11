import {
  TYPE_CMYKA_8,
  TYPE_RGBA_8,
  TYPE_RGBA_16,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsFLAGS_COPY_ALPHA,
  cmsFLAGS_GAMUTCHECK,
  cmsFLAGS_SOFTPROOFING,
  type LcmsModule,
} from 'lcms-wasm';
import { getIccEngine, type IccRenderingIntent } from './paperIccEngine';

/** Image documents deliberately have a much lower profile limit than Paper's package-level import. */
export const IMAGE_CMYK_MAX_PROFILE_BYTES = 2 * 1024 * 1024;
/** Keeps the lcms-wasm allocation for one transform call bounded. */
export const IMAGE_ICC_TRANSFORM_BATCH_PIXELS = 1_048_576;

const ICC_HEADER_BYTES = 128;
const INTENT_CODE: Record<IccRenderingIntent, number> = {
  perceptual: 0,
  relative: 1,
  saturation: 2,
  absolute: 3,
};

export interface ImageCmykProfileInfo {
  name: string;
  colorSpace: 'CMYK';
  declaredByteLength: number;
}

export interface ImageIccTransformOptions {
  intent?: IccRenderingIntent;
  blackPointCompensation?: boolean;
}

export interface ImageCmykBuffer {
  model: 'cmyk';
  depth: 'u8';
  width: number;
  height: number;
  /** Interleaved C, M, Y, K, alpha samples. Ink coverage is 0–255. */
  data: Uint8Array;
}

export interface ImageRgbToCmykaTransform {
  readonly sourceDepth: 'u8' | 'u16';
  readonly profile: ImageCmykProfileInfo;
  transform(input: Uint8Array | Uint16Array, pixelCount: number): Uint8Array;
  transformImage(input: Uint8Array | Uint16Array, width: number, height: number): Uint8Array;
  dispose(): void;
}

export interface ImageCmykaToDisplayTransform {
  readonly profile: ImageCmykProfileInfo;
  transform(input: Uint8Array, pixelCount: number): Uint8Array;
  transformImage(input: Uint8Array, width: number, height: number): Uint8Array;
  dispose(): void;
}

export interface ImageCmykaReseparationTransform {
  readonly sourceProfile: ImageCmykProfileInfo;
  readonly destinationProfile: ImageCmykProfileInfo;
  transform(input: Uint8Array, pixelCount: number): Uint8Array;
  transformImage(input: Uint8Array, width: number, height: number): Uint8Array;
  dispose(): void;
}

export interface ImageGamutCheckTransform {
  readonly profile: ImageCmykProfileInfo;
  /** One fail-closed boolean per pixel; transparent pixels are never reported as paint-gamut warnings. */
  check(input: Uint8Array, pixelCount: number): boolean[];
  checkImage(input: Uint8Array, width: number, height: number): boolean[];
  dispose(): void;
}

function profileSignature(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.byteLength) return '';
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function assertProfileBytes(bytes: Uint8Array): void {
  if (bytes.byteLength < ICC_HEADER_BYTES) throw new Error('The Image CMYK ICC profile header is incomplete.');
  if (bytes.byteLength > IMAGE_CMYK_MAX_PROFILE_BYTES) throw new Error('The Image CMYK ICC profile exceeds the 2 MiB limit.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredByteLength = view.getUint32(0, false);
  if (declaredByteLength < ICC_HEADER_BYTES || declaredByteLength > bytes.byteLength) {
    throw new Error('The Image CMYK ICC profile declares an invalid size.');
  }
  if (profileSignature(bytes, 36) !== 'acsp') throw new Error('The file is not an ICC profile.');
  if (profileSignature(bytes, 12) !== 'prtr') throw new Error('Image CMYK mode requires a printer ICC profile.');
  if (profileSignature(bytes, 16) !== 'CMYK') throw new Error('Image CMYK mode requires a CMYK ICC profile.');
}

function profileInfo(lcms: LcmsModule, handle: number, bytes: Uint8Array): ImageCmykProfileInfo {
  if (lcms.cmsGetColorSpaceASCII(handle) !== 'CMYK') throw new Error('The ICC profile does not expose a CMYK color space.');
  const declaredByteLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
  return {
    name: lcms.cmsGetProfileInfoASCII(handle, 0, 'en', 'US').trim() || 'CMYK profile',
    colorSpace: 'CMYK',
    declaredByteLength,
  };
}

async function openImageCmykProfile(bytes: Uint8Array): Promise<{ lcms: LcmsModule; handle: number; info: ImageCmykProfileInfo }> {
  assertProfileBytes(bytes);
  const lcms = await getIccEngine();
  const handle = lcms.cmsOpenProfileFromMem(bytes, bytes.byteLength);
  if (!handle) throw new Error('Little-CMS could not open the Image CMYK ICC profile.');
  try {
    return { lcms, handle, info: profileInfo(lcms, handle, bytes) };
  } catch (error) {
    lcms.cmsCloseProfile(handle);
    throw error;
  }
}

function assertPixels(pixelCount: number, channels: number, byteLength: number): number {
  if (!Number.isSafeInteger(pixelCount) || pixelCount < 1 || pixelCount > IMAGE_ICC_TRANSFORM_BATCH_PIXELS) {
    throw new Error(`ICC transforms are limited to ${IMAGE_ICC_TRANSFORM_BATCH_PIXELS.toLocaleString()} pixels per batch.`);
  }
  const expected = pixelCount * channels;
  if (!Number.isSafeInteger(expected) || byteLength !== expected) throw new Error('ICC transform samples do not match the requested pixel count.');
  return expected;
}

function assertImagePixels(width: number, height: number, channels: number, sampleLength: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('ICC image dimensions are invalid.');
  }
  const pixelCount = width * height;
  const expectedSamples = pixelCount * channels;
  if (!Number.isSafeInteger(pixelCount) || !Number.isSafeInteger(expectedSamples) || sampleLength !== expectedSamples) {
    throw new Error('ICC image samples do not match the requested dimensions.');
  }
  return pixelCount;
}

function transformImageInBatches<Input extends Uint8Array | Uint16Array>(
  input: Input,
  width: number,
  height: number,
  inputChannels: number,
  outputChannels: number,
  transform: (batch: Input, pixelCount: number) => Uint8Array,
): Uint8Array {
  const pixelCount = assertImagePixels(width, height, inputChannels, input.length);
  const output = new Uint8Array(pixelCount * outputChannels);
  for (let start = 0; start < pixelCount; start += IMAGE_ICC_TRANSFORM_BATCH_PIXELS) {
    const batchPixels = Math.min(IMAGE_ICC_TRANSFORM_BATCH_PIXELS, pixelCount - start);
    const batch = input.subarray(start * inputChannels, (start + batchPixels) * inputChannels) as Input;
    output.set(transform(batch, batchPixels), start * outputChannels);
  }
  return output;
}

function checkImageInBatches(
  input: Uint8Array,
  width: number,
  height: number,
  check: (batch: Uint8Array, pixelCount: number) => boolean[],
): boolean[] {
  const pixelCount = assertImagePixels(width, height, 4, input.length);
  const output = new Array<boolean>(pixelCount);
  for (let start = 0; start < pixelCount; start += IMAGE_ICC_TRANSFORM_BATCH_PIXELS) {
    const batchPixels = Math.min(IMAGE_ICC_TRANSFORM_BATCH_PIXELS, pixelCount - start);
    const batch = input.subarray(start * 4, (start + batchPixels) * 4);
    const result = check(batch, batchPixels);
    for (let offset = 0; offset < batchPixels; offset += 1) output[start + offset] = result[offset]!;
  }
  return output;
}

function transformFlags(options: ImageIccTransformOptions): number {
  return (options.blackPointCompensation === false ? 0 : cmsFLAGS_BLACKPOINTCOMPENSATION) | cmsFLAGS_COPY_ALPHA;
}

/**
 * Parses and opens an Image CMYK printer profile through the shipped Little-CMS runtime, then releases
 * the handle immediately. The return value is safe document metadata, never profile bytes.
 */
export async function validateImageCmykProfile(bytes: Uint8Array): Promise<ImageCmykProfileInfo> {
  const { lcms, handle, info } = await openImageCmykProfile(bytes);
  try {
    return info;
  } finally {
    lcms.cmsCloseProfile(handle);
  }
}

/** Creates the retained RGB(A)→CMYK(A) conversion used by the future native document path. */
export async function createImageRgbToCmykaTransform(
  profileBytes: Uint8Array,
  sourceDepth: 'u8' | 'u16',
  options: ImageIccTransformOptions = {},
): Promise<ImageRgbToCmykaTransform> {
  const { lcms, handle: cmyk, info } = await openImageCmykProfile(profileBytes);
  const rgb = lcms.cmsCreate_sRGBProfile();
  if (!rgb) {
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the sRGB working profile.');
  }
  const transform = lcms.cmsCreateTransform(
    rgb,
    sourceDepth === 'u16' ? TYPE_RGBA_16 : TYPE_RGBA_8,
    cmyk,
    TYPE_CMYKA_8,
    INTENT_CODE[options.intent ?? 'relative'],
    transformFlags(options),
  );
  if (!transform) {
    lcms.cmsCloseProfile(rgb);
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the Image RGB-to-CMYK transform.');
  }
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new Error('This Image ICC transform has been disposed.');
  };
  return {
    sourceDepth,
    profile: info,
    transform: (input, pixelCount) => {
      assertOpen();
      const inputBytes = sourceDepth === 'u16' ? 2 : 1;
      if ((sourceDepth === 'u16') !== (input instanceof Uint16Array)) throw new Error(`Expected ${sourceDepth} RGBA samples.`);
      assertPixels(pixelCount, 4, input.byteLength / inputBytes);
      return sourceDepth === 'u16'
        ? lcms.cmsDoTransform(transform, input as Uint16Array, pixelCount)
        : lcms.cmsDoTransform(transform, input as Uint8Array, pixelCount);
    },
    transformImage: (input, width, height) => {
      assertOpen();
      if ((sourceDepth === 'u16') !== (input instanceof Uint16Array)) throw new Error(`Expected ${sourceDepth} RGBA samples.`);
      return transformImageInBatches(input, width, height, 4, 5, (batch, pixelCount) => sourceDepth === 'u16'
        ? lcms.cmsDoTransform(transform, batch as Uint16Array, pixelCount)
        : lcms.cmsDoTransform(transform, batch as Uint8Array, pixelCount));
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      lcms.cmsDeleteTransform(transform);
      lcms.cmsCloseProfile(rgb);
      lcms.cmsCloseProfile(cmyk);
    },
  };
}

/** Creates the CMYK(A)→display-sRGB path. It is deliberately separate from soft-proof policy. */
export async function createImageCmykaToDisplayTransform(
  profileBytes: Uint8Array,
  options: ImageIccTransformOptions = {},
): Promise<ImageCmykaToDisplayTransform> {
  const { lcms, handle: cmyk, info } = await openImageCmykProfile(profileBytes);
  const rgb = lcms.cmsCreate_sRGBProfile();
  if (!rgb) {
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the display sRGB profile.');
  }
  const transform = lcms.cmsCreateTransform(cmyk, TYPE_CMYKA_8, rgb, TYPE_RGBA_8, INTENT_CODE[options.intent ?? 'perceptual'], transformFlags(options));
  if (!transform) {
    lcms.cmsCloseProfile(rgb);
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the Image CMYK-to-display transform.');
  }
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new Error('This Image ICC transform has been disposed.');
  };
  return {
    profile: info,
    transform: (input, pixelCount) => {
      assertOpen();
      assertPixels(pixelCount, 5, input.byteLength);
      return lcms.cmsDoTransform(transform, input, pixelCount);
    },
    transformImage: (input, width, height) => {
      assertOpen();
      return transformImageInBatches(input, width, height, 5, 4, (batch, pixelCount) => lcms.cmsDoTransform(transform, batch, pixelCount));
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      lcms.cmsDeleteTransform(transform);
      lcms.cmsCloseProfile(rgb);
      lcms.cmsCloseProfile(cmyk);
    },
  };
}

/** Re-separates native CMYK samples through two explicit profiles without detouring through document metadata. */
export async function createImageCmykaReseparationTransform(
  sourceProfileBytes: Uint8Array,
  destinationProfileBytes: Uint8Array,
  options: ImageIccTransformOptions = {},
): Promise<ImageCmykaReseparationTransform> {
  const source = await openImageCmykProfile(sourceProfileBytes);
  let destination: Awaited<ReturnType<typeof openImageCmykProfile>> | undefined;
  try {
    destination = await openImageCmykProfile(destinationProfileBytes);
    const transform = source.lcms.cmsCreateTransform(
      source.handle,
      TYPE_CMYKA_8,
      destination.handle,
      TYPE_CMYKA_8,
      INTENT_CODE[options.intent ?? 'relative'],
      transformFlags(options),
    );
    if (!transform) throw new Error('Little-CMS could not create the Image CMYK re-separation transform.');
    let disposed = false;
    const assertOpen = () => {
      if (disposed) throw new Error('This Image ICC transform has been disposed.');
    };
    return {
      sourceProfile: source.info,
      destinationProfile: destination.info,
      transform: (input, pixelCount) => {
        assertOpen();
        assertPixels(pixelCount, 5, input.byteLength);
        return source.lcms.cmsDoTransform(transform, input, pixelCount);
      },
      transformImage: (input, width, height) => {
        assertOpen();
        return transformImageInBatches(input, width, height, 5, 5, (batch, pixelCount) => source.lcms.cmsDoTransform(transform, batch, pixelCount));
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        source.lcms.cmsDeleteTransform(transform);
        source.lcms.cmsCloseProfile(destination!.handle);
        source.lcms.cmsCloseProfile(source.handle);
      },
    };
  } catch (error) {
    if (destination) source.lcms.cmsCloseProfile(destination.handle);
    source.lcms.cmsCloseProfile(source.handle);
    throw error;
  }
}

/**
 * Uses Little-CMS proofing plus its built-in alarm output to mark source pixels outside the selected
 * CMYK press gamut. The wrapper does not expose reliable Lab-double samples, so this is the supported
 * production gamut route rather than a fabricated Delta-E fallback.
 */
export async function createImageGamutCheckTransform(
  profileBytes: Uint8Array,
  options: ImageIccTransformOptions = {},
): Promise<ImageGamutCheckTransform> {
  const { lcms, handle: cmyk, info } = await openImageCmykProfile(profileBytes);
  const rgb = lcms.cmsCreate_sRGBProfile();
  if (!rgb) {
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the sRGB gamut-check profile.');
  }
  const baseFlags = cmsFLAGS_SOFTPROOFING | transformFlags(options);
  const intent = INTENT_CODE[options.intent ?? 'relative'];
  const normal = lcms.cmsCreateProofingTransform(rgb, TYPE_RGBA_8, rgb, TYPE_RGBA_8, cmyk, intent, intent, baseFlags);
  const checked = lcms.cmsCreateProofingTransform(rgb, TYPE_RGBA_8, rgb, TYPE_RGBA_8, cmyk, intent, intent, baseFlags | cmsFLAGS_GAMUTCHECK);
  if (!normal || !checked) {
    if (normal) lcms.cmsDeleteTransform(normal);
    if (checked) lcms.cmsDeleteTransform(checked);
    lcms.cmsCloseProfile(rgb);
    lcms.cmsCloseProfile(cmyk);
    throw new Error('Little-CMS could not create the Image gamut-check transform.');
  }
  let disposed = false;
  const assertOpen = () => {
    if (disposed) throw new Error('This Image ICC transform has been disposed.');
  };
  return {
    profile: info,
    check: (input, pixelCount) => {
      assertOpen();
      assertPixels(pixelCount, 4, input.byteLength);
      const normalOutput = lcms.cmsDoTransform(normal, input, pixelCount);
      const alarmOutput = lcms.cmsDoTransform(checked, input, pixelCount);
      return Array.from({ length: pixelCount }, (_, pixel) => {
        const offset = pixel * 4;
        if (input[offset + 3] === 0) return false;
        return normalOutput[offset] !== alarmOutput[offset]
          || normalOutput[offset + 1] !== alarmOutput[offset + 1]
          || normalOutput[offset + 2] !== alarmOutput[offset + 2];
      });
    },
    checkImage: (input, width, height) => {
      assertOpen();
      return checkImageInBatches(input, width, height, (batch, pixelCount) => {
        const normalOutput = lcms.cmsDoTransform(normal, batch, pixelCount);
        const alarmOutput = lcms.cmsDoTransform(checked, batch, pixelCount);
        return Array.from({ length: pixelCount }, (_, pixel) => {
          const offset = pixel * 4;
          if (batch[offset + 3] === 0) return false;
          return normalOutput[offset] !== alarmOutput[offset]
            || normalOutput[offset + 1] !== alarmOutput[offset + 1]
            || normalOutput[offset + 2] !== alarmOutput[offset + 2];
        });
      });
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      lcms.cmsDeleteTransform(checked);
      lcms.cmsDeleteTransform(normal);
      lcms.cmsCloseProfile(rgb);
      lcms.cmsCloseProfile(cmyk);
    },
  };
}

/** Establishes the interim native CMYK raster contract before Lane A's shared PixelBuffer lands. */
export function createImageCmykBuffer(width: number, height: number, data: Uint8Array): ImageCmykBuffer {
  const safeWidth = Math.floor(width);
  const safeHeight = Math.floor(height);
  const pixels = safeWidth * safeHeight;
  if (!Number.isSafeInteger(safeWidth) || !Number.isSafeInteger(safeHeight) || safeWidth < 1 || safeHeight < 1 || !Number.isSafeInteger(pixels)) {
    throw new Error('CMYK buffer dimensions are invalid.');
  }
  if (data.byteLength !== pixels * 5) throw new Error('CMYK buffer requires interleaved C, M, Y, K, alpha samples.');
  return { model: 'cmyk', depth: 'u8', width: safeWidth, height: safeHeight, data };
}
