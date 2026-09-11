import type { BlendMode, PixelBuffer, PixelDepth } from '../../../types/imageEditor';
import {
  assertPixelBufferShape,
  createPixelBuffer,
  MAX_PIXEL_BUFFER_BYTES,
  pixelDepthBytesPerSample,
} from './PixelBuffer';
import {
  clamp01,
  componentBlend,
  isComponentBlendMode,
  separableBlend,
} from './blendKernels';

/**
 * The native A3 compositor's deliberately small, fully-raster contract.
 *
 * Layers are full-document, topologically ordered bottom-to-top PixelBuffers.
 * Geometry/effects/adjustments remain explicit refusal boundaries until their
 * native implementations land; a caller must never silently substitute the
 * derived 8-bit proxy here.
 */
export interface NativeCompositeLayer {
  pixels: PixelBuffer;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  /** An RGBA u8 mask whose alpha channel is coverage. */
  mask?: PixelBuffer | null;
  /** These are refusal markers supplied by document adapters before mutation. */
  hasTransform?: boolean;
  hasEffects?: boolean;
  hasAdjustment?: boolean;
}

export interface NativeCompositeOptions {
  /** The output allocation budget, including one output PixelBuffer. */
  budgetBytes?: number;
}

/** Runtime boundary for persisted/untyped layer metadata. */
export const NATIVE_BLEND_MODES: readonly BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

export type NativeCompositeRefusalCode =
  | 'no-layers'
  | 'shape-mismatch'
  | 'mixed-depth'
  | 'unsupported-state'
  | 'mask-shape'
  | 'budget-exceeded';

export class NativeCompositeRefusal extends Error {
  readonly code: NativeCompositeRefusalCode;

  constructor(code: NativeCompositeRefusalCode, message: string) {
    super(message);
    this.name = 'NativeCompositeRefusal';
    this.code = code;
  }
}

/** Refuse a native write when authority dimensions do not exactly own the target surface. */
export function assertNativeCompositeTargetDimensions(
  pixels: Pick<PixelBuffer, 'width' | 'height'>,
  targetWidth: number,
  targetHeight: number,
): void {
  if (pixels.width !== targetWidth || pixels.height !== targetHeight) {
    throw new NativeCompositeRefusal(
      'shape-mismatch',
      `Native composite authority ${pixels.width}x${pixels.height} does not match target surface ${targetWidth}x${targetHeight}; refused before putImageData and no pixels were changed.`,
    );
  }
}

function finiteSample(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  return value;
}

function depthMaximum(depth: PixelDepth): number {
  return depth === 'u8' ? 255 : depth === 'u16' ? 65535 : 1;
}

function readSample(buffer: PixelBuffer, index: number): number {
  const value = finiteSample(buffer.data[index] as number);
  return buffer.depth === 'u8' || buffer.depth === 'u16'
    ? value / depthMaximum(buffer.depth)
    : value;
}

function writeSample(buffer: PixelBuffer, index: number, value: number): void {
  const safe = finiteSample(value);
  if (buffer.depth === 'f32') {
    (buffer.data as Float32Array)[index] = safe;
    return;
  }
  const max = depthMaximum(buffer.depth);
  const target = Math.round(clamp01(safe) * max);
  if (buffer.depth === 'u8') (buffer.data as Uint8Array)[index] = target;
  else (buffer.data as Uint16Array)[index] = target;
}

function sourceOverNative(
  mode: BlendMode,
  backdrop: { r: number; g: number; b: number },
  source: { r: number; g: number; b: number },
  backdropAlpha: number,
  sourceAlpha: number,
): { r: number; g: number; b: number; a: number } {
  const ab = clamp01(finiteSample(backdropAlpha));
  const as = clamp01(finiteSample(sourceAlpha));
  const alpha = as + ab * (1 - as);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };

  // Blend kernels are intentionally defined over [0,1]. Preserve finite scene
  // referred f32 highlights in the non-blended source/backdrop terms, while
  // retaining the exact reviewed equation for the kernel contribution.
  const boundedBackdrop = { r: clamp01(backdrop.r), g: clamp01(backdrop.g), b: clamp01(backdrop.b) };
  const boundedSource = { r: clamp01(source.r), g: clamp01(source.g), b: clamp01(source.b) };
  const bounded = isComponentBlendMode(mode)
    ? componentBlend(mode, boundedBackdrop, boundedSource)
    : {
        r: separableBlend(mode, boundedBackdrop.r, boundedSource.r),
        g: separableBlend(mode, boundedBackdrop.g, boundedSource.g),
        b: separableBlend(mode, boundedBackdrop.b, boundedSource.b),
      };
  const kernel = mode === 'normal' ? source : bounded;
  return {
    r: ((1 - as) * ab * backdrop.r + as * (1 - ab) * source.r + as * ab * kernel.r) / alpha,
    g: ((1 - as) * ab * backdrop.g + as * (1 - ab) * source.g + as * ab * kernel.g) / alpha,
    b: ((1 - as) * ab * backdrop.b + as * (1 - ab) * source.b + as * ab * kernel.b) / alpha,
    a: alpha,
  };
}

function validateLayers(
  layers: readonly NativeCompositeLayer[],
  budgetBytes: number,
): { width: number; height: number; depth: PixelDepth } {
  if (layers.length === 0) {
    throw new NativeCompositeRefusal('no-layers', 'Native compositing requires at least one raster layer.');
  }
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1) {
    throw new NativeCompositeRefusal('budget-exceeded', `Native composite budget ${String(budgetBytes)} is invalid.`);
  }
  const first = layers[0]!.pixels;
  try {
    assertPixelBufferShape(first);
  } catch (error) {
    throw new NativeCompositeRefusal('shape-mismatch', error instanceof Error ? error.message : 'Invalid layer shape.');
  }
  for (const layer of layers) {
    if (layer.hasTransform || layer.hasEffects || layer.hasAdjustment) {
      throw new NativeCompositeRefusal(
        'unsupported-state',
        'Native compositing refused before mutation: transforms, effects, and adjustments still require a native implementation; the 8-bit display proxy would lose precision.',
      );
    }
    if (layer.blendMode !== undefined && !(NATIVE_BLEND_MODES as readonly string[]).includes(layer.blendMode)) {
      throw new NativeCompositeRefusal(
        'unsupported-state',
        `Native compositing refused before mutation: blend mode "${String(layer.blendMode)}" is unknown; no kernel was selected and no pixels were changed.`,
      );
    }
    try {
      assertPixelBufferShape(layer.pixels);
    } catch (error) {
      throw new NativeCompositeRefusal('shape-mismatch', error instanceof Error ? error.message : 'Invalid layer shape.');
    }
    if (layer.pixels.width !== first.width || layer.pixels.height !== first.height) {
      throw new NativeCompositeRefusal(
        'shape-mismatch',
        `Native composite layer dimensions ${layer.pixels.width}x${layer.pixels.height} do not match ${first.width}x${first.height}.`,
      );
    }
    if (layer.pixels.depth !== first.depth) {
      throw new NativeCompositeRefusal(
        'mixed-depth',
        `Native composite depth ${layer.pixels.depth} does not match the document depth ${first.depth}; convert authorities before compositing.`,
      );
    }
    if (layer.mask) {
      try {
        assertPixelBufferShape(layer.mask);
      } catch (error) {
        throw new NativeCompositeRefusal('mask-shape', error instanceof Error ? error.message : 'Invalid mask shape.');
      }
      if (layer.mask.depth !== 'u8' || layer.mask.width !== first.width || layer.mask.height !== first.height) {
        throw new NativeCompositeRefusal(
          'mask-shape',
          'Native composite masks must be same-document u8 RGBA coverage buffers.',
        );
      }
    }
  }
  const outputBytes = first.width * first.height * 4 * pixelDepthBytesPerSample(first.depth);
  if (!Number.isSafeInteger(outputBytes) || outputBytes > budgetBytes || outputBytes > MAX_PIXEL_BUFFER_BYTES) {
    throw new NativeCompositeRefusal(
      'budget-exceeded',
      `Native composite output of ${String(outputBytes)} bytes exceeds the ${String(budgetBytes)}-byte resource bound; no output was allocated.`,
    );
  }
  return { width: first.width, height: first.height, depth: first.depth };
}

/**
 * Composite a full-document stack without reading or mutating any Canvas2D
 * proxy. The returned authority has the same depth as its input layers.
 */
export function compositePixelBuffers(
  layers: readonly NativeCompositeLayer[],
  options: NativeCompositeOptions = {},
): PixelBuffer {
  const budgetBytes = options.budgetBytes ?? MAX_PIXEL_BUFFER_BYTES;
  const shape = validateLayers(layers, budgetBytes);
  const output = createPixelBuffer(shape);
  const backdrop = { r: 0, g: 0, b: 0 };
  for (let pixel = 0; pixel < shape.width * shape.height; pixel += 1) {
    let color = backdrop;
    let alpha = 0;
    for (const layer of layers) {
      if (layer.visible === false) continue;
      const offset = pixel * 4;
      const maskAlpha = layer.mask ? readSample(layer.mask, offset + 3) : 1;
      const opacity = clamp01(finiteSample(layer.opacity ?? 1));
      const sourceAlpha = readSample(layer.pixels, offset + 3) * opacity * maskAlpha;
      const source = {
        r: readSample(layer.pixels, offset),
        g: readSample(layer.pixels, offset + 1),
        b: readSample(layer.pixels, offset + 2),
      };
      const composed = sourceOverNative(layer.blendMode ?? 'normal', color, source, alpha, sourceAlpha);
      color = { r: composed.r, g: composed.g, b: composed.b };
      alpha = composed.a;
    }
    writeSample(output, pixel * 4, color.r);
    writeSample(output, pixel * 4 + 1, color.g);
    writeSample(output, pixel * 4 + 2, color.b);
    writeSample(output, pixel * 4 + 3, alpha);
  }
  return output;
}

/**
 * Validate the output surface against every authority before entering the
 * potentially expensive full-document compositor. Both the mounted preview
 * and module-worker route call this wrapper, so a scaled preview refuses in
 * O(layer-count) shape checks rather than after a native composite.
 */
export function compositePixelBuffersForTarget(
  layers: readonly NativeCompositeLayer[],
  targetWidth: number,
  targetHeight: number,
  options: NativeCompositeOptions = {},
  compose: (
    input: readonly NativeCompositeLayer[],
    inputOptions?: NativeCompositeOptions,
  ) => PixelBuffer = compositePixelBuffers,
): PixelBuffer {
  for (const layer of layers) {
    assertNativeCompositeTargetDimensions(layer.pixels, targetWidth, targetHeight);
  }
  return compose(layers, options);
}
