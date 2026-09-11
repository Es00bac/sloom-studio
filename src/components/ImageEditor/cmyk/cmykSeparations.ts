import type { ImageCmykBuffer } from '../../../lib/iccTransforms';
import type { ImageCmykProfileIdentity } from './cmykProfiles';

export const IMAGE_CMYK_MAX_TOTAL_INK_PERCENT = 400;
export const IMAGE_CMYK_DEFAULT_TOTAL_INK_PERCENT = 300;
export const IMAGE_CMYK_PREFLIGHT_SAMPLE_LIMIT = 100;

export type ImageCmykProcessInk = 'cyan' | 'magenta' | 'yellow' | 'black';

export interface ImageCmykProcessSeparation {
  ink: ImageCmykProcessInk;
  width: number;
  height: number;
  /** Final ink coverage after unassociated alpha is applied. */
  inkCoverage: Uint8ClampedArray;
  /** PGM preview/output convention: white is no ink and black is full ink. */
  grayscale: Uint8ClampedArray;
  filename: string;
  mimeType: 'image/x-portable-graymap';
  data: Uint8Array;
}

export interface ImageCmykSeparationPlan {
  profile: ImageCmykProfileIdentity;
  plates: readonly ImageCmykProcessSeparation[];
  manifest: {
    schema: 'image-cmyk-separations/v1';
    width: number;
    height: number;
    profile: ImageCmykProfileIdentity;
    plates: readonly { ink: ImageCmykProcessInk; filename: string; mimeType: string }[];
  };
}

export interface ImageCmykInkLimitViolation {
  x: number;
  y: number;
  totalInkPercent: number;
}

export interface ImageCmykInkPreflight {
  totalInkLimitPercent: number;
  overLimitPixelCount: number;
  maxTotalInkPercent: number;
  violations: readonly ImageCmykInkLimitViolation[];
}

const INK_ORDER: readonly ImageCmykProcessInk[] = ['cyan', 'magenta', 'yellow', 'black'];

function assertCmykBuffer(buffer: ImageCmykBuffer): number {
  if (buffer.model !== 'cmyk' || buffer.depth !== 'u8' || !Number.isSafeInteger(buffer.width) || !Number.isSafeInteger(buffer.height) || buffer.width < 1 || buffer.height < 1) {
    throw new Error('CMYK separations require a valid u8 CMYK buffer.');
  }
  const pixels = buffer.width * buffer.height;
  if (!Number.isSafeInteger(pixels) || buffer.data.byteLength !== pixels * 5) throw new Error('CMYK separation samples do not match dimensions.');
  return pixels;
}

function effectiveInk(ink: number, alpha: number): number {
  return Math.round((ink * alpha) / 255);
}

function pgm(width: number, height: number, grayscale: Uint8ClampedArray): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const data = new Uint8Array(header.length + grayscale.length);
  data.set(header);
  data.set(grayscale, header.length);
  return data;
}

/** Creates inspectable C/M/Y/K plates from the retained CMYKA buffer without changing the source. */
export function buildImageCmykProcessSeparationPlan(
  buffer: ImageCmykBuffer,
  profile: ImageCmykProfileIdentity,
): ImageCmykSeparationPlan {
  const pixels = assertCmykBuffer(buffer);
  const plates = INK_ORDER.map((ink, channel) => {
    const inkCoverage = new Uint8ClampedArray(pixels);
    const grayscale = new Uint8ClampedArray(pixels);
    for (let pixel = 0, source = 0; pixel < pixels; pixel += 1, source += 5) {
      const coverage = effectiveInk(buffer.data[source + channel]!, buffer.data[source + 4]!);
      inkCoverage[pixel] = coverage;
      grayscale[pixel] = 255 - coverage;
    }
    const filename = `process-${ink}-coverage.pgm`;
    return { ink, width: buffer.width, height: buffer.height, inkCoverage, grayscale, filename, mimeType: 'image/x-portable-graymap' as const, data: pgm(buffer.width, buffer.height, grayscale) };
  });
  return {
    profile,
    plates,
    manifest: {
      schema: 'image-cmyk-separations/v1',
      width: buffer.width,
      height: buffer.height,
      profile,
      plates: plates.map((plate) => ({ ink: plate.ink, filename: plate.filename, mimeType: plate.mimeType })),
    },
  };
}

/** Preflights total ink coverage on final alpha-weighted process inks without altering the buffer. */
export function preflightImageCmykInkLimit(
  buffer: ImageCmykBuffer,
  totalInkLimitPercent = IMAGE_CMYK_DEFAULT_TOTAL_INK_PERCENT,
): ImageCmykInkPreflight {
  const pixels = assertCmykBuffer(buffer);
  if (!Number.isFinite(totalInkLimitPercent) || totalInkLimitPercent < 0 || totalInkLimitPercent > IMAGE_CMYK_MAX_TOTAL_INK_PERCENT) {
    throw new Error(`CMYK total ink limit must be between 0 and ${IMAGE_CMYK_MAX_TOTAL_INK_PERCENT} percent.`);
  }
  let overLimitPixelCount = 0;
  let maxTotalInkPercent = 0;
  const violations: ImageCmykInkLimitViolation[] = [];
  for (let pixel = 0, source = 0; pixel < pixels; pixel += 1, source += 5) {
    const alpha = buffer.data[source + 4]!;
    const totalInkPercent = ((effectiveInk(buffer.data[source]!, alpha) + effectiveInk(buffer.data[source + 1]!, alpha) + effectiveInk(buffer.data[source + 2]!, alpha) + effectiveInk(buffer.data[source + 3]!, alpha)) / 255) * 100;
    maxTotalInkPercent = Math.max(maxTotalInkPercent, totalInkPercent);
    if (totalInkPercent <= totalInkLimitPercent) continue;
    overLimitPixelCount += 1;
    if (violations.length < IMAGE_CMYK_PREFLIGHT_SAMPLE_LIMIT) {
      violations.push({ x: pixel % buffer.width, y: Math.floor(pixel / buffer.width), totalInkPercent });
    }
  }
  return { totalInkLimitPercent, overLimitPixelCount, maxTotalInkPercent, violations };
}
