import type { EditorOperation, LayerBitmap, PixelBuffer, PixelDepth } from '../../../types/imageEditor';
import {
  assertPixelBufferShape,
  clonePixelBuffer,
  createPixelBuffer,
  linearToSrgb,
  pixelBufferSampleCount,
  srgbToLinear,
} from './PixelBuffer';
import { putBitmapImageData } from '../LayerBitmap';
import { rgbaProxyBytesFromPixelBuffer } from './ImageHighBitDocument';

/** A4's converted tool set. These operations write the PixelBuffer authority. */
export type HighBitAuthorityTool =
  | 'brush' | 'pencil' | 'eraser' | 'paintBucket' | 'gradientTool' | 'mask'
  | 'transform' | 'crop' | 'canvasResize' | 'imageResize' | 'copyPaste'
  | 'duplicate' | 'newLayer' | 'fillLayer' | 'adjustment' | 'filter';

/** A4 tools which remain explicitly unavailable until they have a depth-aware implementation. */
export type HighBitProxyTool =
  | 'liquify' | 'puppetWarp' | 'perspectiveWarp' | 'contentAware'
  | 'retouch' | 'dodge' | 'burn' | 'sponge' | 'selectAndMask' | 'generativeFill' | 'tiltmark';

const AUTHORITY_TOOLS = new Set<string>([
  'brush', 'pencil', 'eraser', 'mask', 'transform',
]);

const PROXY_TOOLS = new Set<string>([
  'liquify', 'puppetWarp', 'perspectiveWarp', 'contentAware',
  'retouch', 'dodge', 'burn', 'sponge', 'selectAndMask', 'generativeFill', 'tiltmark',
]);

export type HighBitToolPolicy =
  | {
      supported: true;
      source: 'authority';
      precisionLossy: false;
      disclosure: 'Writes the document-depth PixelBuffer authority.';
    }
  | {
      supported: false;
      source: 'proxy';
      precisionLossy: true;
      disclosure: string;
    };

/** Resolve the executable policy before a tool is allowed to mutate anything. */
export function highBitToolPolicy(tool: string): HighBitToolPolicy {
  if (AUTHORITY_TOOLS.has(tool)) {
    return {
      supported: true,
      source: 'authority',
      precisionLossy: false,
      disclosure: 'Writes the document-depth PixelBuffer authority.',
    };
  }
  const reason = PROXY_TOOLS.has(tool)
    ? `${tool} is not converted to document depth yet.`
    : `${tool} has no declared document-depth implementation.`;
  return {
    supported: false,
    source: 'proxy',
    precisionLossy: true,
    disclosure: `Refused before mutation: ${reason} The 8-bit display proxy would lose precision; no pixels were changed.`,
  };
}

/** Emit the shared refusal event used by mounted tools and direct store actions. */
export function dispatchHighBitToolRefusal(tool: string): void {
  const policy = highBitToolPolicy(tool);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', {
    detail: {
      tool,
      source: policy.source,
      precisionLossy: policy.precisionLossy,
      disclosure: policy.disclosure,
    },
  }));
}

export type HighBitToolExecution<T> =
  | { ok: true; policy: Extract<HighBitToolPolicy, { supported: true }>; value: T }
  | { ok: false; policy: Extract<HighBitToolPolicy, { supported: false }> };

/** Run a converted tool only after policy resolution; refusal never calls the operation. */
export function executeHighBitTool<T>(tool: string, operation: () => T): HighBitToolExecution<T> {
  const policy = highBitToolPolicy(tool);
  if (!policy.supported) return { ok: false, policy };
  return { ok: true, policy, value: operation() };
}

export interface HighBitPaintPoint { x: number; y: number }

export interface HighBitPaintOptions {
  points: readonly HighBitPaintPoint[];
  radius: number;
  /** Normalized RGBA. Integer authorities use sRGB color; f32 uses linear color by default. */
  color: readonly [number, number, number, number];
  colorEncoding?: 'srgb' | 'linear';
  opacity?: number;
  eraser?: boolean;
}

export interface HighBitPaintResult {
  pixels: PixelBuffer;
  changedPixels: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function authorityMax(depth: PixelDepth): number {
  return depth === 'u8' ? 255 : depth === 'u16' ? 65535 : 1;
}

function readNormalized(buffer: PixelBuffer, index: number): number {
  const value = buffer.data[index] as number;
  return buffer.depth === 'u8' ? value / 255 : buffer.depth === 'u16' ? value / 65535 : value;
}

function writeNormalized(buffer: PixelBuffer, index: number, value: number): void {
  const clamped = clamp01(value);
  if (buffer.depth === 'f32') (buffer.data as Float32Array)[index] = clamped;
  else (buffer.data as Uint8Array | Uint16Array)[index] = Math.round(clamped * authorityMax(buffer.depth));
}

function encodedPaintColor(buffer: PixelBuffer, options: HighBitPaintOptions): [number, number, number, number] {
  const encoding = options.colorEncoding ?? (buffer.depth === 'f32' ? 'linear' : 'srgb');
  const rgb = options.color.slice(0, 3).map(clamp01);
  const converted = buffer.depth === 'f32' && encoding === 'srgb'
    ? rgb.map(srgbToLinear)
    : buffer.depth !== 'f32' && encoding === 'linear'
      ? rgb.map(linearToSrgb)
      : rgb;
  return [converted[0]!, converted[1]!, converted[2]!, clamp01(options.color[3] ?? 1)];
}

/** Paint a stroke into a fresh authority buffer; untouched samples are copied bit-exactly. */
export function paintPixelBuffer(buffer: PixelBuffer, options: HighBitPaintOptions): HighBitPaintResult {
  assertPixelBufferShape(buffer);
  if (!options || !Array.isArray(options.points)) throw new Error('Paint points are missing.');
  if (!Number.isFinite(options.radius) || options.radius < 0) throw new Error('Paint radius must be finite and non-negative.');
  const opacity = clamp01(options.opacity ?? 1);
  const output = clonePixelBuffer(buffer);
  const color = encodedPaintColor(buffer, options);
  if (options.points.length === 0 || opacity === 0 || color[3] === 0) return { pixels: output, changedPixels: 0, bounds: null };

  const radius = options.radius;
  const minX = Math.max(0, Math.floor(Math.min(...options.points.map((point) => point.x)) - radius - 1));
  const maxX = Math.min(buffer.width - 1, Math.ceil(Math.max(...options.points.map((point) => point.x)) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(...options.points.map((point) => point.y)) - radius - 1));
  const maxY = Math.min(buffer.height - 1, Math.ceil(Math.max(...options.points.map((point) => point.y)) + radius + 1));
  let changedPixels = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.min(...options.points.map((point) => Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y)));
      const coverage = radius === 0 ? (distance <= 0.71 ? 1 : 0) : clamp01(radius + 0.5 - distance);
      const sourceAlpha = readNormalized(buffer, (y * buffer.width + x) * 4 + 3);
      const paintAlpha = color[3] * opacity * coverage;
      const outAlpha = options.eraser ? sourceAlpha * (1 - paintAlpha) : paintAlpha + sourceAlpha * (1 - paintAlpha);
      const pixelIndex = (y * buffer.width + x) * 4;
      if (!options.eraser && outAlpha > 0) {
        for (let channel = 0; channel < 3; channel += 1) {
          const source = readNormalized(buffer, pixelIndex + channel);
          const out = (color[channel]! * paintAlpha + source * sourceAlpha * (1 - paintAlpha)) / outAlpha;
          writeNormalized(output, pixelIndex + channel, out);
        }
      }
      writeNormalized(output, pixelIndex + 3, outAlpha);
      if (outAlpha !== sourceAlpha || (!options.eraser && coverage > 0)) changedPixels += 1;
    }
  }
  return { pixels: output, changedPixels, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}

export interface MaskCoverage { width: number; height: number; data: Uint8Array }

/** Crop a native authority into a new bounded buffer, filling out-of-bounds areas transparent. */
export function cropPixelBuffer(buffer: PixelBuffer, x: number, y: number, width: number, height: number): PixelBuffer {
  assertPixelBufferShape(buffer);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('High-bit crop origin must be a safe integer.');
  const output = createPixelBuffer({ width, height, depth: buffer.depth, model: buffer.model });
  for (let outputY = 0; outputY < height; outputY += 1) {
    const sourceY = y + outputY;
    if (sourceY < 0 || sourceY >= buffer.height) continue;
    for (let outputX = 0; outputX < width; outputX += 1) {
      const sourceX = x + outputX;
      if (sourceX < 0 || sourceX >= buffer.width) continue;
      const sourceIndex = (sourceY * buffer.width + sourceX) * 4;
      const outputIndex = (outputY * width + outputX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output.data[outputIndex + channel] = buffer.data[sourceIndex + channel] as never;
      }
    }
  }
  return output;
}

/** Apply u8 mask coverage directly to authority alpha without converting RGB samples. */
export function applyMaskCoverage(buffer: PixelBuffer, mask: MaskCoverage): PixelBuffer {
  assertPixelBufferShape(buffer);
  if (!Number.isSafeInteger(mask.width) || !Number.isSafeInteger(mask.height)
    || mask.width !== buffer.width || mask.height !== buffer.height
    || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) {
    throw new Error('High-bit mask coverage must be a matching bounded u8 layer mask.');
  }
  const output = clonePixelBuffer(buffer);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    const alphaIndex = pixel * 4 + 3;
    writeNormalized(output, alphaIndex, readNormalized(buffer, alphaIndex) * (mask.data[pixel]! / 255));
  }
  return output;
}

export type ResampleFilter = 'nearest' | 'bilinear';

/** Resample in the authority's native depth; no intermediate u8 proxy is allocated. */
export function resamplePixelBuffer(buffer: PixelBuffer, width: number, height: number, filter: ResampleFilter = 'bilinear'): PixelBuffer {
  assertPixelBufferShape(buffer);
  const output = createPixelBuffer({ width, height, depth: buffer.depth, model: buffer.model });
  const source = (x: number, y: number, channel: number): number => buffer.data[(y * buffer.width + x) * 4 + channel] as number;
  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * buffer.height / height - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(buffer.height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * buffer.width / width - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(buffer.width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sourceX - x0));
      const outIndex = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = filter === 'nearest'
          ? source(Math.max(0, Math.min(buffer.width - 1, Math.round(sourceX))), Math.max(0, Math.min(buffer.height - 1, Math.round(sourceY))), channel)
          : source(x0, y0, channel) * (1 - fx) * (1 - fy)
            + source(x1, y0, channel) * fx * (1 - fy)
            + source(x0, y1, channel) * (1 - fx) * fy
            + source(x1, y1, channel) * fx * fy;
        if (buffer.depth === 'f32') (output.data as Float32Array)[outIndex + channel] = value;
        else (output.data as Uint8Array | Uint16Array)[outIndex + channel] = Math.round(value);
      }
    }
  }
  return output;
}

/** Ordinary history payload for one authority edit. Both buffers are immutable after retention. */
export type HighBitPaintOperation = Extract<EditorOperation, { kind: 'highBitPaint' }>;

export function createHighBitPaintOperation(docId: string, layerId: string, before: PixelBuffer, after: PixelBuffer, beforeVersion: number | undefined, afterVersion: number | undefined): HighBitPaintOperation {
  assertPixelBufferShape(before);
  assertPixelBufferShape(after);
  if (before.width !== after.width || before.height !== after.height || before.depth !== after.depth) throw new Error('High-bit history requires matching authority shapes and depths.');
  return { kind: 'highBitPaint', docId, layerId, before: clonePixelBuffer(before), after: clonePixelBuffer(after), beforeVersion, afterVersion };
}

export function pixelBufferByteLength(buffer: PixelBuffer | null): number {
  return buffer ? pixelBufferSampleCount(buffer) * (buffer.depth === 'u8' ? 1 : buffer.depth === 'u16' ? 2 : 4) : 0;
}

/** Refresh the visible u8 proxy after an authority edit; the authority remains the source of truth. */
export function syncPixelBufferProxy(buffer: PixelBuffer, bitmap: LayerBitmap | null): boolean {
  if (!bitmap || bitmap.width !== buffer.width || bitmap.height !== buffer.height
    || typeof ImageData === 'undefined') return false;
  const bytes = new Uint8ClampedArray(buffer.width * buffer.height * 4);
  bytes.set(rgbaProxyBytesFromPixelBuffer(buffer));
  putBitmapImageData(bitmap, new ImageData(bytes, buffer.width, buffer.height));
  return true;
}
