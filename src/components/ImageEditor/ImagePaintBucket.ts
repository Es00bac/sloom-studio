import type { BlendMode, ImageColorChannel, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import type { Point } from './tools/types';

export type PaintBucketFillTargetChannel = ImageColorChannel | 'alpha' | 'spot';

export type PaintBucketFillWarningCode =
  | 'gap-close-unsupported'
  | 'channel-specific-fill-unsupported';

export type MagicWandReadinessCaveatCode =
  | 'anti-alias-selection-edge-unsupported'
  | 'channel-specific-selection-unsupported'
  | PaintBucketFillWarningCode;

export type PaintBucketReadinessBlockerCode = 'missing-pixel-source' | 'missing-writable-layer';

export type PaintBucketActionBlockerCode = PaintBucketReadinessBlockerCode | 'invalid-tolerance' | 'zero-opacity-fill';

export type PaintBucketTargetBlockerCode =
  | 'layer-mask-runtime-route-unsupported'
  | 'quick-mask-runtime-route-unsupported'
  | 'channel-specific-runtime-route-unsupported';

export type PaintBucketUnsupportedFeature =
  | 'gap-close'
  | 'pattern-fill'
  | 'content-aware-fill'
  | 'channel-specific-fill';

export type PaintBucketActionTarget = 'active-layer' | 'layer-mask' | 'quick-mask';
export type PaintBucketActionWritePath = 'active-layer-rgba' | 'active-layer-mask-alpha' | 'quick-mask-alpha';
export type ImagePaintReadinessCheckStatus = 'ready' | 'unsupported' | 'blocked';
export type ImagePaintReadinessCheckCode =
  | 'tolerance'
  | 'sample-all-layers'
  | 'contiguous'
  | 'anti-alias'
  | 'gap-close'
  | 'blend-mode'
  | 'preserve-transparency'
  | 'target-routing'
  | 'channel-routing';
export type ImagePaintReadinessCheckBlockerCode =
  | PaintBucketActionBlockerCode
  | PaintBucketTargetBlockerCode
  | 'channel-specific-selection-unsupported';

export interface PaintBucketFillWorkflowWarning {
  code: PaintBucketFillWarningCode;
  severity: 'warning';
  message: string;
}

export interface MagicWandReadinessCaveat {
  code: MagicWandReadinessCaveatCode;
  severity: 'warning';
  message: string;
}

export interface ImagePaintToolReadinessState {
  status: 'ready' | 'blocked';
  blockerCodes: PaintBucketReadinessBlockerCode[];
}

export interface PaintBucketActionBlocker {
  code: PaintBucketActionBlockerCode;
  severity: 'blocker';
  message: string;
}

export interface PaintBucketTargetBlocker {
  code: PaintBucketTargetBlockerCode;
  severity: 'blocker';
  target: PaintBucketActionTarget;
  message: string;
}

export interface ImagePaintReadinessCheck {
  code: ImagePaintReadinessCheckCode;
  status: ImagePaintReadinessCheckStatus;
  message: string;
  caveatCodes: MagicWandReadinessCaveatCode[];
  blockerCodes: ImagePaintReadinessCheckBlockerCode[];
  signature: string;
}

export interface PaintBucketUnsupportedDescriptor {
  feature: PaintBucketUnsupportedFeature;
  status: 'unsupported';
  caveat: string;
}

export interface PaintBucketRoutingDescriptor {
  fill: {
    route: 'active-layer-rgba-compositor';
    blendMode: BlendMode;
    preserveTransparency: boolean;
    opacity: number;
    signature: string;
  };
  target: {
    requested: PaintBucketActionTarget;
    requestedChannel: PaintBucketFillTargetChannel;
    writePath: PaintBucketActionWritePath;
    runtimeStatus: 'ready' | 'blocked';
    blockers: PaintBucketTargetBlocker[];
    signature: string;
  };
}

export interface PaintBucketFillOperationDescriptorOptions {
  seed: Point;
  color: string;
  opacity: number;
  blendMode?: BlendMode;
  preserveTransparency?: boolean;
  tolerance: number;
  contiguous?: boolean;
  sampleAllLayers?: boolean;
  targetChannel?: PaintBucketFillTargetChannel;
  requestedAntiAlias?: boolean;
  requestedGapClose?: number | boolean;
  hasPixelSource?: boolean;
  hasWritableLayer?: boolean;
}

export interface PaintBucketFillOperationDescriptor {
  descriptorId: 'paint-bucket-fill-operation:v1';
  seed: { x: number; y: number };
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
  };
  matching: {
    scope: 'contiguous' | 'global';
    connectivity: 4 | 'document-wide';
    gapClosePixels: number;
    gapCloseSupported: false;
  };
  edge: {
    antiAlias: {
      requested: boolean;
      supported: true;
      fringePixels: 1;
      coverageModel: 'one-pixel-neighbor-coverage';
    };
  };
  sampling: {
    sampleAllLayers: boolean;
    source: 'active-layer-bitmap' | 'visible-document-composite';
  };
  fill: {
    color: string;
    opacity: number;
    blendMode: BlendMode;
    preserveTransparency: boolean;
    output: 'active-layer-rgba';
  };
  target: {
    requestedChannel: PaintBucketFillTargetChannel;
    writtenComponents: ['red', 'green', 'blue', 'alpha'];
    channelRouting: 'composite-rgba' | 'composite-rgba-channel-request-unsupported';
  };
  warnings: PaintBucketFillWorkflowWarning[];
  readiness: ImagePaintToolReadinessState;
  previewSignature: string;
}

export interface PaintBucketActionReadinessOptions extends PaintBucketFillOperationDescriptorOptions {
  target?: PaintBucketActionTarget;
  requestedPatternFill?: boolean;
  requestedContentAwareFill?: boolean;
  batch?: boolean;
  actionRecording?: boolean;
}

export interface PaintBucketActionReadinessDescriptor {
  descriptorId: 'paint-bucket-action-readiness:v1';
  version: 1;
  operation: PaintBucketFillOperationDescriptor;
  tolerance: {
    value: number;
    valid: boolean;
    metric: 'rgb-euclidean-distance';
    caveat: string;
  };
  matching: {
    scope: 'contiguous' | 'global';
    contiguous: boolean;
    connectivity: 4 | 'document-wide';
    caveat: string;
  };
  alpha: {
    opacity: number;
    preservesTransparency: boolean;
    writesTransparentPixels: boolean;
    transparentFill: boolean;
    caveat: string;
  };
  edgeControls: {
    antiAlias: {
      requested: boolean;
      supported: true;
      maxPixels: 1;
      caveat: string;
    };
    gapClose: {
      requestedPixels: number;
      supported: false;
      maxPixels: 0;
      caveat: string;
    };
  };
  target: {
    requested: PaintBucketActionTarget;
    requestedChannel: PaintBucketFillTargetChannel;
    writePath: PaintBucketActionWritePath;
    channelRouting: PaintBucketFillOperationDescriptor['target']['channelRouting'];
    caveats: string[];
  };
  blockers: PaintBucketActionBlocker[];
  unsupported: PaintBucketUnsupportedDescriptor[];
  checks: ImagePaintReadinessCheck[];
  routing: PaintBucketRoutingDescriptor;
  batch: {
    suitable: boolean;
    actionRecordable: boolean;
    exportSignature: string;
    caveats: string[];
  };
  preview: {
    signature: string;
  };
  stableSignatures: {
    operation: string;
    checks: string;
    routing: string;
    preview: string;
  };
}

export interface MagicWandReadinessOptions {
  seed: Point;
  tolerance: number;
  contiguous?: boolean;
  sampleAllLayers?: boolean;
  targetChannel?: PaintBucketFillTargetChannel;
  requestedAntiAlias?: boolean;
  requestedGapClose?: number | boolean;
  hasPixelSource?: boolean;
}

export interface MagicWandReadinessDescriptor {
  descriptorId: 'magic-wand-readiness:v1';
  tool: 'magic-wand';
  seed: { x: number; y: number };
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
  };
  selection: {
    output: 'selection-mask';
    scope: 'contiguous' | 'global';
    connectivity: 4 | 'document-wide';
    gapClosePixels: number;
    gapCloseSupported: false;
  };
  sampling: {
    sampleAllLayers: boolean;
    source: 'active-layer-bitmap' | 'visible-document-composite';
  };
  target: {
    requestedChannel: PaintBucketFillTargetChannel;
    channelSensitivity: 'composite-rgba' | 'composite-rgba-channel-request-unsupported';
  };
  caveats: MagicWandReadinessCaveat[];
  readiness: ImagePaintToolReadinessState;
  checks: ImagePaintReadinessCheck[];
  stableSignatures: {
    readiness: string;
    checks: string;
  };
  previewSignature: string;
}

export function describePaintBucketFillOperation(
  options: PaintBucketFillOperationDescriptorOptions,
): PaintBucketFillOperationDescriptor {
  const requestedChannel = options.targetChannel ?? 'rgb';
  const gapClosePixels = normalizeGapClosePixels(options.requestedGapClose);
  const readiness = getPaintToolReadiness({
    hasPixelSource: options.hasPixelSource,
    hasWritableLayer: options.hasWritableLayer,
  });
  const descriptor = {
    descriptorId: 'paint-bucket-fill-operation:v1' as const,
    seed: {
      x: normalizeSeedCoordinate(options.seed.x),
      y: normalizeSeedCoordinate(options.seed.y),
    },
    tolerance: {
      value: normalizeTolerance(options.tolerance),
      metric: 'rgb-euclidean-distance' as const,
    },
    matching: {
      scope: options.contiguous === false ? 'global' as const : 'contiguous' as const,
      connectivity: options.contiguous === false ? 'document-wide' as const : 4 as const,
      gapClosePixels,
      gapCloseSupported: false as const,
    },
    edge: {
      antiAlias: {
        requested: options.requestedAntiAlias === true,
        supported: true as const,
        fringePixels: 1 as const,
        coverageModel: 'one-pixel-neighbor-coverage' as const,
      },
    },
    sampling: {
      sampleAllLayers: options.sampleAllLayers === true,
      source: options.sampleAllLayers === true ? 'visible-document-composite' as const : 'active-layer-bitmap' as const,
    },
    fill: {
      color: normalizeHexColor(options.color),
      opacity: roundNumber(clamp01(options.opacity), 3),
      blendMode: normalizeBlendMode(options.blendMode),
      preserveTransparency: options.preserveTransparency === true,
      output: 'active-layer-rgba' as const,
    },
    target: {
      requestedChannel,
      writtenComponents: ['red', 'green', 'blue', 'alpha'] as ['red', 'green', 'blue', 'alpha'],
      channelRouting: requestedChannel === 'rgb'
        ? 'composite-rgba' as const
        : 'composite-rgba-channel-request-unsupported' as const,
    },
    warnings: getPaintBucketFillWorkflowWarnings({
      requestedAntiAlias: options.requestedAntiAlias === true,
      gapClosePixels,
      requestedChannel,
    }),
    readiness,
  };

  return {
    ...descriptor,
    previewSignature: buildPaintBucketFillOperationPreviewSignature(descriptor),
  };
}

export function describePaintBucketActionReadiness(
  options: PaintBucketActionReadinessOptions,
): PaintBucketActionReadinessDescriptor {
  const operation = describePaintBucketFillOperation(options);
  const target = options.target ?? 'active-layer';
  const requestedChannel = options.targetChannel ?? 'rgb';
  const toleranceValid = Number.isFinite(options.tolerance) && options.tolerance >= 0 && options.tolerance <= 255;
  const opacity = roundNumber(clamp01(options.opacity), 3);
  const requestedAntiAlias = options.requestedAntiAlias === true;
  const gapClosePixels = operation.matching.gapClosePixels;
  const blockers = getPaintBucketActionBlockers(options, toleranceValid, opacity);
  const unsupported = getPaintBucketUnsupportedDescriptors({
    requestedGapClose: gapClosePixels > 0,
    requestedPatternFill: options.requestedPatternFill === true,
    requestedContentAwareFill: options.requestedContentAwareFill === true,
    requestedChannel,
  });
  const targetBlockers = getPaintBucketTargetBlockers(target, requestedChannel);
  const checks = buildPaintBucketReadinessChecks({
    operation,
    toleranceValid,
    requestedAntiAlias,
    gapClosePixels,
    target,
    requestedChannel,
    targetBlockers,
  });
  const routing = buildPaintBucketRoutingDescriptor({
    operation,
    target,
    requestedChannel,
    targetBlockers,
  });
  const batchSuitable = options.batch === true && blockers.length === 0;
  const descriptor = {
    descriptorId: 'paint-bucket-action-readiness:v1' as const,
    version: 1 as const,
    operation,
    tolerance: {
      value: operation.tolerance.value,
      valid: toleranceValid,
      metric: 'rgb-euclidean-distance' as const,
      caveat: toleranceValid
        ? 'Tolerance is finite and ready for deterministic RGB Euclidean matching.'
        : 'Invalid tolerance values are clamped for descriptors and block execution until corrected.',
    },
    matching: {
      scope: operation.matching.scope,
      contiguous: operation.matching.scope === 'contiguous',
      connectivity: operation.matching.connectivity,
      caveat: operation.matching.scope === 'contiguous'
        ? 'Contiguous matching flood-fills the 4-connected region whose sampled RGB color is within tolerance of the seed color.'
        : 'Global matching fills every document pixel whose sampled RGB color is within tolerance of the seed color.',
    },
    alpha: {
      opacity,
      preservesTransparency: operation.fill.preserveTransparency,
      writesTransparentPixels: opacity > 0 && !operation.fill.preserveTransparency,
      transparentFill: opacity <= 0,
      caveat: opacity <= 0
        ? 'Opacity 0 produces a transparent no-op style fill descriptor; preserve transparency prevents alpha expansion on fully transparent pixels.'
        : 'Paint Bucket opacity controls RGBA fill compositing; preserve transparency keeps existing transparent pixels from gaining alpha.',
    },
    edgeControls: {
      antiAlias: {
        requested: requestedAntiAlias,
        supported: true as const,
        maxPixels: 1 as const,
        caveat: requestedAntiAlias
          ? 'Paint Bucket applies a one-pixel neighbor-coverage fringe to soften the fill edge.'
          : 'Anti-aliased Paint Bucket edge weighting is available but not requested.',
      },
      gapClose: {
        requestedPixels: gapClosePixels,
        supported: false as const,
        maxPixels: 0 as const,
        caveat: 'Gap close is unavailable for Paint Bucket fills; non-zero requests stay descriptor-only and do not bridge narrow openings.',
      },
    },
    target: {
      requested: target,
      requestedChannel,
      writePath: getPaintBucketActionWritePath(target),
      channelRouting: operation.target.channelRouting,
      caveats: getPaintBucketActionTargetCaveats(target, requestedChannel),
    },
    blockers,
    unsupported,
    checks,
    routing,
    batch: {
      suitable: batchSuitable,
      actionRecordable: options.actionRecording === true,
      exportSignature: [
        'paint-bucket-action-batch:v1',
        operation.previewSignature,
        `target:${target}`,
        `route:${getPaintBucketActionWritePath(target)}`,
      ].join('|'),
      caveats: [
        'Batch Paint Bucket actions require a valid seed, finite tolerance, pixel source, and writable layer for every document.',
        'Recorded actions can replay seed, tolerance, contiguous/global matching, sample-all-layers, opacity, blend mode, transparency preservation, and target metadata.',
      ],
    },
  };
  const previewSignature = [
    'paint-bucket-action-readiness:v1',
    operation.previewSignature,
    `target:${target}`,
    `blockers:${blockers.map((blocker) => blocker.code).join(',')}`,
    `batch:${batchSuitable}`,
  ].join('|');

  return {
    ...descriptor,
    preview: {
      signature: previewSignature,
    },
    stableSignatures: {
      operation: operation.previewSignature,
      checks: buildImagePaintReadinessChecksSignature(checks),
      routing: buildPaintBucketRoutingSignature(routing),
      preview: previewSignature,
    },
  };
}

export function describeMagicWandReadiness(options: MagicWandReadinessOptions): MagicWandReadinessDescriptor {
  const requestedChannel = options.targetChannel ?? 'rgb';
  const gapClosePixels = normalizeGapClosePixels(options.requestedGapClose);
  const descriptor = {
    descriptorId: 'magic-wand-readiness:v1' as const,
    tool: 'magic-wand' as const,
    seed: {
      x: normalizeSeedCoordinate(options.seed.x),
      y: normalizeSeedCoordinate(options.seed.y),
    },
    tolerance: {
      value: normalizeTolerance(options.tolerance),
      metric: 'rgb-euclidean-distance' as const,
    },
    selection: {
      output: 'selection-mask' as const,
      scope: options.contiguous === false ? 'global' as const : 'contiguous' as const,
      connectivity: options.contiguous === false ? 'document-wide' as const : 4 as const,
      gapClosePixels,
      gapCloseSupported: false as const,
    },
    sampling: {
      sampleAllLayers: options.sampleAllLayers === true,
      source: options.sampleAllLayers === true ? 'visible-document-composite' as const : 'active-layer-bitmap' as const,
    },
    target: {
      requestedChannel,
      channelSensitivity: requestedChannel === 'rgb'
        ? 'composite-rgba' as const
        : 'composite-rgba-channel-request-unsupported' as const,
    },
    caveats: getMagicWandReadinessCaveats({
      requestedAntiAlias: options.requestedAntiAlias === true,
      gapClosePixels,
      requestedChannel,
    }),
    readiness: getPaintToolReadiness({
      hasPixelSource: options.hasPixelSource,
      hasWritableLayer: true,
    }),
  };
  const checks = buildMagicWandPlannerChecks(descriptor);
  const previewSignature = buildMagicWandReadinessPreviewSignature(descriptor);

  return {
    ...descriptor,
    checks,
    stableSignatures: {
      readiness: previewSignature,
      checks: buildImagePaintReadinessChecksSignature(checks),
    },
    previewSignature,
  };
}

export function fillContiguousColorRegion(
  imageData: ImageData,
  options: {
    seed: Point;
    color: string;
    opacity: number;
    blendMode?: BlendMode;
    preserveTransparency?: boolean;
    tolerance: number;
    contiguous?: boolean;
    matchSource?: ImageData;
    antiAlias?: boolean;
  },
): ImageData {
  const output = cloneImageData(imageData);
  const matchSource = options.matchSource ?? imageData;
  const seedX = Math.floor(options.seed.x);
  const seedY = Math.floor(options.seed.y);
  if (!contains(matchSource, seedX, seedY)) return output;

  const fill = parseHexColor(options.color);
  const opacity = clamp01(options.opacity);
  const blendMode = normalizeBlendMode(options.blendMode);
  const preserveTransparency = options.preserveTransparency === true;
  const width = matchSource.width;
  const height = matchSource.height;
  const seedOffset = (seedY * width + seedX) * 4;
  const seed = [
    matchSource.data[seedOffset],
    matchSource.data[seedOffset + 1],
    matchSource.data[seedOffset + 2],
  ] as const;
  const toleranceSquared = Math.max(0, options.tolerance) ** 2;
  const selected = new Uint8Array(width * height);
  if (options.contiguous === false) {
    for (let index = 0; index < width * height; index += 1) {
      if (!matchesSeed(matchSource, index, seed, toleranceSquared)) continue;
      selected[index] = 1;
    }
    applyPaintBucketFillMask(output, imageData, selected, fill, opacity, blendMode, preserveTransparency, options.antiAlias === true);
    return output;
  }

  const visited = new Uint8Array(width * height);
  const stack: Array<[number, number]> = [[seedX, seedY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (!contains(matchSource, x, y)) continue;
    const index = y * width + x;
    if (visited[index]) continue;
    visited[index] = 1;
    if (!matchesSeed(matchSource, index, seed, toleranceSquared)) continue;
    selected[index] = 1;

    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }

  applyPaintBucketFillMask(output, imageData, selected, fill, opacity, blendMode, preserveTransparency, options.antiAlias === true);
  return output;
}

export function fillContiguousColorRegionInBitmap(
  bitmap: LayerBitmap,
  options: {
    seed: Point;
    color: string;
    opacity: number;
    blendMode?: BlendMode;
    preserveTransparency?: boolean;
    tolerance: number;
    contiguous?: boolean;
    matchSource?: ImageData;
    antiAlias?: boolean;
  },
): void {
  putBitmapImageData(bitmap, fillContiguousColorRegion(getBitmapImageData(bitmap), options));
}

function applyPaintBucketFillMask(
  output: ImageData,
  source: ImageData,
  selected: Uint8Array,
  fill: readonly [number, number, number],
  opacity: number,
  blendMode: BlendMode,
  preserveTransparency: boolean,
  antiAlias: boolean,
): void {
  const { width, height } = output;
  for (let index = 0; index < selected.length; index += 1) {
    if (!selected[index]) continue;
    applyFillToPixel(output, source, index * 4, fill, opacity, blendMode, preserveTransparency);
  }
  if (!antiAlias) return;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (selected[index]) continue;

      const coverage = paintBucketEdgeCoverage(selected, width, height, x, y);
      if (coverage <= 0) continue;
      applyFillToPixel(output, source, index * 4, fill, opacity * coverage, blendMode, preserveTransparency);
    }
  }
}

function paintBucketEdgeCoverage(
  selected: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let orthogonalWeight = 0;
  let diagonalWeight = 0;
  if (isSelectedFillPixel(selected, width, height, x - 1, y)) orthogonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x + 1, y)) orthogonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x, y - 1)) orthogonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x, y + 1)) orthogonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x - 1, y - 1)) diagonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x + 1, y - 1)) diagonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x - 1, y + 1)) diagonalWeight += 1;
  if (isSelectedFillPixel(selected, width, height, x + 1, y + 1)) diagonalWeight += 1;
  return Math.min(0.75, orthogonalWeight * 0.1875 + diagonalWeight * 0.125);
}

function isSelectedFillPixel(
  selected: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && selected[y * width + x] === 1;
}

function matchesSeed(
  imageData: ImageData,
  index: number,
  seed: readonly [number, number, number],
  toleranceSquared: number,
): boolean {
  const offset = index * 4;
  const dr = imageData.data[offset] - seed[0];
  const dg = imageData.data[offset + 1] - seed[1];
  const db = imageData.data[offset + 2] - seed[2];
  return dr * dr + dg * dg + db * db <= toleranceSquared;
}

function parseHexColor(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

function getPaintBucketFillWorkflowWarnings(options: {
  requestedAntiAlias: boolean;
  gapClosePixels: number;
  requestedChannel: PaintBucketFillTargetChannel;
}): PaintBucketFillWorkflowWarning[] {
  const warnings: PaintBucketFillWorkflowWarning[] = [];
  if (options.gapClosePixels > 0) {
    warnings.push({
      code: 'gap-close-unsupported',
      severity: 'warning',
      message: 'Gap close is not implemented for Paint Bucket fills; matching uses direct contiguous or global color comparison only.',
    });
  }
  if (options.requestedChannel !== 'rgb') {
    warnings.push({
      code: 'channel-specific-fill-unsupported',
      severity: 'warning',
      message: 'Paint Bucket fills currently write composite RGBA pixels on the active layer instead of routing to an individual color, alpha, or spot channel.',
    });
  }
  return warnings;
}

function getMagicWandReadinessCaveats(options: {
  requestedAntiAlias: boolean;
  gapClosePixels: number;
  requestedChannel: PaintBucketFillTargetChannel;
}): MagicWandReadinessCaveat[] {
  const caveats: MagicWandReadinessCaveat[] = [];
  if (options.requestedAntiAlias) {
    caveats.push({
      code: 'anti-alias-selection-edge-unsupported',
      severity: 'warning',
      message: 'Magic Wand selection edges are binary masks; anti-aliased selection edge weighting is not applied.',
    });
  }
  if (options.gapClosePixels > 0) {
    caveats.push({
      code: 'gap-close-unsupported',
      severity: 'warning',
      message: 'Gap close is not implemented for Magic Wand selection; matching uses direct contiguous or global color comparison only.',
    });
  }
  if (options.requestedChannel !== 'rgb') {
    caveats.push({
      code: 'channel-specific-selection-unsupported',
      severity: 'warning',
      message: 'Magic Wand selection currently samples composite RGBA color instead of an individual color, alpha, or spot channel.',
    });
  }
  return caveats;
}

function getPaintBucketActionBlockers(
  options: PaintBucketActionReadinessOptions,
  toleranceValid: boolean,
  opacity: number,
): PaintBucketActionBlocker[] {
  const blockers: PaintBucketActionBlocker[] = [];
  if (options.hasPixelSource === false) {
    blockers.push({
      code: 'missing-pixel-source',
      severity: 'blocker',
      message: 'Paint Bucket matching requires an active layer bitmap or visible composite sample source.',
    });
  }
  if (options.hasWritableLayer === false) {
    blockers.push({
      code: 'missing-writable-layer',
      severity: 'blocker',
      message: 'Paint Bucket fill requires a writable active layer target.',
    });
  }
  if (!toleranceValid) {
    blockers.push({
      code: 'invalid-tolerance',
      severity: 'blocker',
      message: 'Paint Bucket tolerance must be a finite number between 0 and 255.',
    });
  }
  if (opacity <= 0) {
    blockers.push({
      code: 'zero-opacity-fill',
      severity: 'blocker',
      message: 'Paint Bucket opacity must be greater than 0 to change pixels.',
    });
  }
  return blockers;
}

function getPaintBucketUnsupportedDescriptors(options: {
  requestedGapClose: boolean;
  requestedPatternFill: boolean;
  requestedContentAwareFill: boolean;
  requestedChannel: PaintBucketFillTargetChannel;
}): PaintBucketUnsupportedDescriptor[] {
  const unsupported: PaintBucketUnsupportedDescriptor[] = [];
  if (options.requestedGapClose) {
    unsupported.push({
      feature: 'gap-close',
      status: 'unsupported',
      caveat: 'Gap close is not implemented for Paint Bucket fills.',
    });
  }
  if (options.requestedPatternFill) {
    unsupported.push({
      feature: 'pattern-fill',
      status: 'unsupported',
      caveat: 'Photoshop-style Paint Bucket pattern fill states are not implemented by this solid-color fill path.',
    });
  }
  if (options.requestedContentAwareFill) {
    unsupported.push({
      feature: 'content-aware-fill',
      status: 'unsupported',
      caveat: 'Content-aware fill is handled by separate repair workflows, not by Paint Bucket flood fill.',
    });
  }
  if (options.requestedChannel !== 'rgb') {
    unsupported.push({
      feature: 'channel-specific-fill',
      status: 'unsupported',
      caveat: 'Paint Bucket fills write composite RGBA pixels and do not directly write individual color, alpha, or spot channels.',
    });
  }
  return unsupported;
}

function getPaintBucketTargetBlockers(
  target: PaintBucketActionTarget,
  requestedChannel: PaintBucketFillTargetChannel,
): PaintBucketTargetBlocker[] {
  const blockers: PaintBucketTargetBlocker[] = [];
  if (target === 'layer-mask') {
    blockers.push({
      code: 'layer-mask-runtime-route-unsupported',
      severity: 'blocker',
      target,
      message: 'Layer mask Paint Bucket fills are descriptor-only; runtime fills still write active layer RGBA pixels.',
    });
  } else if (target === 'quick-mask') {
    blockers.push({
      code: 'quick-mask-runtime-route-unsupported',
      severity: 'blocker',
      target,
      message: 'Quick Mask Paint Bucket fills are descriptor-only; runtime fills still write active layer RGBA pixels.',
    });
  }
  if (requestedChannel !== 'rgb') {
    blockers.push({
      code: 'channel-specific-runtime-route-unsupported',
      severity: 'blocker',
      target,
      message: 'Paint Bucket channel-specific routing is descriptor-only; runtime fills still write composite RGBA pixels.',
    });
  }
  return blockers;
}

function buildPaintBucketRoutingDescriptor(options: {
  operation: PaintBucketFillOperationDescriptor;
  target: PaintBucketActionTarget;
  requestedChannel: PaintBucketFillTargetChannel;
  targetBlockers: PaintBucketTargetBlocker[];
}): PaintBucketRoutingDescriptor {
  const writePath = getPaintBucketActionWritePath(options.target);
  const fill = {
    route: 'active-layer-rgba-compositor' as const,
    blendMode: options.operation.fill.blendMode,
    preserveTransparency: options.operation.fill.preserveTransparency,
    opacity: options.operation.fill.opacity,
  };
  const target = {
    requested: options.target,
    requestedChannel: options.requestedChannel,
    writePath,
    runtimeStatus: options.targetBlockers.length > 0 ? 'blocked' as const : 'ready' as const,
    blockers: options.targetBlockers,
  };
  return {
    fill: {
      ...fill,
      signature: buildPaintBucketFillRoutingSignature(fill),
    },
    target: {
      ...target,
      signature: buildPaintBucketTargetRoutingSignature(target),
    },
  };
}

function buildPaintBucketReadinessChecks(options: {
  operation: PaintBucketFillOperationDescriptor;
  toleranceValid: boolean;
  requestedAntiAlias: boolean;
  gapClosePixels: number;
  target: PaintBucketActionTarget;
  requestedChannel: PaintBucketFillTargetChannel;
  targetBlockers: PaintBucketTargetBlocker[];
}): ImagePaintReadinessCheck[] {
  const targetRoutingBlockers = options.targetBlockers
    .filter((blocker) => blocker.code !== 'channel-specific-runtime-route-unsupported')
    .map((blocker) => blocker.code);
  const channelRoutingBlockers = options.targetBlockers
    .filter((blocker) => blocker.code === 'channel-specific-runtime-route-unsupported')
    .map((blocker) => blocker.code);
  return [
    buildImagePaintReadinessCheck({
      code: 'tolerance',
      status: options.toleranceValid ? 'ready' : 'blocked',
      message: options.toleranceValid
        ? `Tolerance ${options.operation.tolerance.value} is ready for deterministic RGB Euclidean matching.`
        : 'Tolerance must be finite and between 0 and 255 before Paint Bucket execution.',
      blockerCodes: options.toleranceValid ? [] : ['invalid-tolerance'],
    }),
    buildImagePaintReadinessCheck({
      code: 'sample-all-layers',
      status: 'ready',
      message: options.operation.sampling.sampleAllLayers
        ? 'Sample all layers uses the visible document composite as the match source.'
        : 'Sample all layers is disabled; matching uses the active layer bitmap.',
    }),
    buildImagePaintReadinessCheck({
      code: 'contiguous',
      status: 'ready',
      message: options.operation.matching.scope === 'contiguous'
        ? 'Contiguous matching uses 4-connected seed-bounded flood fill.'
        : 'Global matching uses document-wide color matching.',
    }),
    buildImagePaintReadinessCheck({
      code: 'anti-alias',
      status: 'ready',
      message: options.requestedAntiAlias
        ? 'Anti-aliased Paint Bucket edges use a one-pixel neighbor-coverage fringe around the filled region.'
        : 'Anti-aliased Paint Bucket edge weighting is available but not requested.',
    }),
    buildImagePaintReadinessCheck({
      code: 'gap-close',
      status: options.gapClosePixels > 0 ? 'unsupported' : 'ready',
      message: options.gapClosePixels > 0
        ? `Gap close ${options.gapClosePixels}px is requested but not applied to Paint Bucket matching.`
        : 'Gap close is not requested; matching uses direct color comparison.',
      caveatCodes: options.gapClosePixels > 0 ? ['gap-close-unsupported'] : [],
    }),
    buildImagePaintReadinessCheck({
      code: 'blend-mode',
      status: 'ready',
      message: `Blend mode ${options.operation.fill.blendMode} routes through the active-layer RGBA compositor.`,
    }),
    buildImagePaintReadinessCheck({
      code: 'preserve-transparency',
      status: 'ready',
      message: options.operation.fill.preserveTransparency
        ? 'Preserve transparency keeps zero-alpha pixels from gaining alpha during fill compositing.'
        : 'Preserve transparency is disabled; fill opacity can write alpha into transparent pixels.',
    }),
    buildImagePaintReadinessCheck({
      code: 'target-routing',
      status: targetRoutingBlockers.length > 0 ? 'blocked' : 'ready',
      message: targetRoutingBlockers.length > 0
        ? `${formatPaintBucketTarget(options.target)} target routing is descriptor-only and cannot be executed by the Paint Bucket runtime path.`
        : 'Active layer Paint Bucket target routing is executable by the RGBA fill path.',
      blockerCodes: targetRoutingBlockers,
    }),
    buildImagePaintReadinessCheck({
      code: 'channel-routing',
      status: channelRoutingBlockers.length > 0 ? 'blocked' : 'ready',
      message: channelRoutingBlockers.length > 0
        ? `Channel ${options.requestedChannel} routing is unsupported; Paint Bucket writes composite RGBA pixels.`
        : 'Composite RGB channel routing is ready for Paint Bucket fills.',
      caveatCodes: channelRoutingBlockers.length > 0 ? ['channel-specific-fill-unsupported'] : [],
      blockerCodes: channelRoutingBlockers,
    }),
  ];
}

function buildMagicWandPlannerChecks(
  descriptor: Omit<MagicWandReadinessDescriptor, 'checks' | 'stableSignatures' | 'previewSignature'>,
): ImagePaintReadinessCheck[] {
  const caveatCodes = descriptor.caveats.map((caveat) => caveat.code);
  const channelBlocked = descriptor.target.channelSensitivity === 'composite-rgba-channel-request-unsupported';
  return [
    buildImagePaintReadinessCheck({
      code: 'tolerance',
      status: 'ready',
      message: `Tolerance ${descriptor.tolerance.value} is ready for deterministic Magic Wand RGB matching.`,
    }),
    buildImagePaintReadinessCheck({
      code: 'sample-all-layers',
      status: 'ready',
      message: descriptor.sampling.sampleAllLayers
        ? 'Sample all layers uses the visible document composite as the Magic Wand match source.'
        : 'Sample all layers is disabled; Magic Wand matching uses the active layer bitmap.',
    }),
    buildImagePaintReadinessCheck({
      code: 'contiguous',
      status: 'ready',
      message: descriptor.selection.scope === 'contiguous'
        ? 'Contiguous Magic Wand matching uses a 4-connected seed-bounded selection.'
        : 'Global Magic Wand matching uses document-wide color matching.',
    }),
    buildImagePaintReadinessCheck({
      code: 'anti-alias',
      status: caveatCodes.includes('anti-alias-selection-edge-unsupported') ? 'unsupported' : 'ready',
      message: caveatCodes.includes('anti-alias-selection-edge-unsupported')
        ? 'Anti-aliased Magic Wand selection edges are requested but not applied.'
        : 'Anti-aliased Magic Wand selection edge weighting is not requested.',
      caveatCodes: caveatCodes.includes('anti-alias-selection-edge-unsupported')
        ? ['anti-alias-selection-edge-unsupported']
        : [],
    }),
    buildImagePaintReadinessCheck({
      code: 'gap-close',
      status: caveatCodes.includes('gap-close-unsupported') ? 'unsupported' : 'ready',
      message: caveatCodes.includes('gap-close-unsupported')
        ? `Gap close ${descriptor.selection.gapClosePixels}px is requested but not applied to Magic Wand matching.`
        : 'Gap close is not requested for Magic Wand matching.',
      caveatCodes: caveatCodes.includes('gap-close-unsupported') ? ['gap-close-unsupported'] : [],
    }),
    buildImagePaintReadinessCheck({
      code: 'channel-routing',
      status: channelBlocked ? 'blocked' : 'ready',
      message: channelBlocked
        ? `Channel ${descriptor.target.requestedChannel} routing is unsupported; Magic Wand samples composite RGBA color.`
        : 'Composite RGB channel routing is ready for Magic Wand sampling.',
      caveatCodes: channelBlocked ? ['channel-specific-selection-unsupported'] : [],
      blockerCodes: channelBlocked ? ['channel-specific-selection-unsupported'] : [],
    }),
  ];
}

function buildImagePaintReadinessCheck(options: {
  code: ImagePaintReadinessCheckCode;
  status: ImagePaintReadinessCheckStatus;
  message: string;
  caveatCodes?: MagicWandReadinessCaveatCode[];
  blockerCodes?: ImagePaintReadinessCheckBlockerCode[];
}): ImagePaintReadinessCheck {
  const check = {
    code: options.code,
    status: options.status,
    message: options.message,
    caveatCodes: options.caveatCodes ?? [],
    blockerCodes: options.blockerCodes ?? [],
  };
  return {
    ...check,
    signature: buildImagePaintReadinessCheckSignature(check),
  };
}

function buildImagePaintReadinessCheckSignature(
  check: Pick<ImagePaintReadinessCheck, 'code' | 'status' | 'caveatCodes' | 'blockerCodes'>,
): string {
  return `image-paint-readiness-check:v1:${JSON.stringify({
    code: check.code,
    status: check.status,
    caveats: check.caveatCodes,
    blockers: check.blockerCodes,
  })}`;
}

function buildImagePaintReadinessChecksSignature(checks: ImagePaintReadinessCheck[]): string {
  return `image-paint-readiness-checks:v1:${JSON.stringify(checks.map((check) => `${check.code}:${check.status}`))}`;
}

function buildPaintBucketFillRoutingSignature(
  fill: Pick<PaintBucketRoutingDescriptor['fill'], 'route' | 'blendMode' | 'preserveTransparency' | 'opacity'>,
): string {
  return `paint-bucket-fill-routing:v1:${JSON.stringify(fill)}`;
}

function buildPaintBucketTargetRoutingSignature(
  target: Pick<PaintBucketRoutingDescriptor['target'], 'requested' | 'requestedChannel' | 'writePath' | 'blockers'>,
): string {
  return `paint-bucket-target-routing:v1:${JSON.stringify({
    requested: target.requested,
    requestedChannel: target.requestedChannel,
    writePath: target.writePath,
    blockers: target.blockers.map((blocker) => blocker.code),
  })}`;
}

function buildPaintBucketRoutingSignature(routing: PaintBucketRoutingDescriptor): string {
  return `paint-bucket-routing:v1:${JSON.stringify({
    fill: {
      route: routing.fill.route,
      blendMode: routing.fill.blendMode,
      preserveTransparency: routing.fill.preserveTransparency,
      opacity: routing.fill.opacity,
    },
    target: {
      requested: routing.target.requested,
      requestedChannel: routing.target.requestedChannel,
      writePath: routing.target.writePath,
      blockers: routing.target.blockers.map((blocker) => blocker.code),
    },
  })}`;
}

function getPaintBucketActionWritePath(target: PaintBucketActionTarget): PaintBucketActionWritePath {
  switch (target) {
    case 'layer-mask':
      return 'active-layer-mask-alpha';
    case 'quick-mask':
      return 'quick-mask-alpha';
    case 'active-layer':
    default:
      return 'active-layer-rgba';
  }
}

function formatPaintBucketTarget(target: PaintBucketActionTarget): string {
  switch (target) {
    case 'layer-mask':
      return 'Layer mask';
    case 'quick-mask':
      return 'Quick Mask';
    case 'active-layer':
    default:
      return 'Active layer';
  }
}

function getPaintBucketActionTargetCaveats(
  target: PaintBucketActionTarget,
  requestedChannel: PaintBucketFillTargetChannel,
): string[] {
  const caveats: string[] = [];
  if (target === 'layer-mask') {
    caveats.push('Layer mask Paint Bucket routing is descriptor-only here; runtime bucket fills still target active layer RGBA pixels.');
  } else if (target === 'quick-mask') {
    caveats.push('Quick Mask Paint Bucket routing is descriptor-only here; commit requires a selection/mask workflow.');
  }
  if (requestedChannel === 'spot') {
    caveats.push('Spot channel routing is unsupported for Paint Bucket fills; use composite RGBA or a dedicated channel workflow.');
  } else if (requestedChannel === 'alpha') {
    caveats.push('Alpha channel routing is unsupported for Paint Bucket fills; use layer mask or saved-channel workflows.');
  } else if (requestedChannel !== 'rgb') {
    caveats.push('Individual RGB channel routing is unsupported for Paint Bucket fills; writes are composite RGBA.');
  }
  return caveats;
}

function getPaintToolReadiness(options: {
  hasPixelSource?: boolean;
  hasWritableLayer?: boolean;
}): ImagePaintToolReadinessState {
  const blockerCodes: PaintBucketReadinessBlockerCode[] = [];
  if (options.hasPixelSource === false) blockerCodes.push('missing-pixel-source');
  if (options.hasWritableLayer === false) blockerCodes.push('missing-writable-layer');
  return {
    status: blockerCodes.length > 0 ? 'blocked' : 'ready',
    blockerCodes,
  };
}

function buildPaintBucketFillOperationPreviewSignature(
  descriptor: Omit<PaintBucketFillOperationDescriptor, 'previewSignature'>,
): string {
  const signaturePayload: Record<string, unknown> = {
    seed: descriptor.seed,
    tolerance: descriptor.tolerance.value,
    matching: {
      scope: descriptor.matching.scope,
      connectivity: descriptor.matching.connectivity,
      gapClosePixels: descriptor.matching.gapClosePixels,
    },
    sampling: descriptor.sampling.source,
    fill: descriptor.fill,
    target: {
      requestedChannel: descriptor.target.requestedChannel,
      channelRouting: descriptor.target.channelRouting,
    },
    warnings: descriptor.warnings.map((warning) => warning.code),
  };
  if (descriptor.readiness.blockerCodes.length > 0) {
    signaturePayload.blockers = descriptor.readiness.blockerCodes;
  }
  return `paint-bucket-fill-operation:v1:${JSON.stringify(signaturePayload)}`;
}

function buildMagicWandReadinessPreviewSignature(
  descriptor: Omit<MagicWandReadinessDescriptor, 'checks' | 'stableSignatures' | 'previewSignature'>,
): string {
  return `magic-wand-readiness:v1:${JSON.stringify({
    seed: descriptor.seed,
    tolerance: descriptor.tolerance.value,
    selection: {
      scope: descriptor.selection.scope,
      connectivity: descriptor.selection.connectivity,
    },
    sampling: descriptor.sampling.source,
    target: {
      requestedChannel: descriptor.target.requestedChannel,
      channelSensitivity: descriptor.target.channelSensitivity,
    },
    caveats: descriptor.caveats.map((caveat) => caveat.code),
    blockers: descriptor.readiness.blockerCodes,
  })}`;
}

function applyFillToPixel(
  output: ImageData,
  source: ImageData,
  offset: number,
  fill: readonly [number, number, number],
  opacity: number,
  blendMode: BlendMode,
  preserveTransparency: boolean,
): void {
  const beforeAlpha = source.data[offset + 3];
  if (preserveTransparency && beforeAlpha <= 0) return;

  const blended = blendRgb(
    [source.data[offset], source.data[offset + 1], source.data[offset + 2]],
    fill,
    blendMode,
  );
  output.data[offset] = mixByte(source.data[offset], blended[0], opacity);
  output.data[offset + 1] = mixByte(source.data[offset + 1], blended[1], opacity);
  output.data[offset + 2] = mixByte(source.data[offset + 2], blended[2], opacity);
  output.data[offset + 3] = preserveTransparency
    ? beforeAlpha
    : mixByte(beforeAlpha, 255, opacity);
}

function blendRgb(
  base: readonly [number, number, number],
  fill: readonly [number, number, number],
  blendMode: BlendMode,
): [number, number, number] {
  switch (blendMode) {
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return blendHslMode(base, fill, blendMode);
    default:
      return [
        blendChannel(base[0], fill[0], blendMode),
        blendChannel(base[1], fill[1], blendMode),
        blendChannel(base[2], fill[2], blendMode),
      ];
  }
}

function blendChannel(base: number, fill: number, blendMode: BlendMode): number {
  const b = clampByte(base);
  const s = clampByte(fill);
  switch (blendMode) {
    case 'multiply':
      return Math.round((b * s) / 255);
    case 'screen':
      return Math.round(255 - ((255 - b) * (255 - s)) / 255);
    case 'overlay':
      return b < 128
        ? Math.round((2 * b * s) / 255)
        : Math.round(255 - (2 * (255 - b) * (255 - s)) / 255);
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'color-dodge':
      return s >= 255 ? 255 : clampByte(Math.round((b * 255) / (255 - s)));
    case 'color-burn':
      return s <= 0 ? 0 : clampByte(Math.round(255 - ((255 - b) * 255) / s));
    case 'hard-light':
      return s < 128
        ? Math.round((2 * b * s) / 255)
        : Math.round(255 - (2 * (255 - b) * (255 - s)) / 255);
    case 'soft-light':
      return blendSoftLightChannel(b, s);
    case 'difference':
      return Math.abs(b - s);
    case 'exclusion':
      return clampByte(Math.round(b + s - (2 * b * s) / 255));
    case 'normal':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
    default:
      return s;
  }
}

function blendSoftLightChannel(base: number, fill: number): number {
  const b = clamp01(base / 255);
  const s = clamp01(fill / 255);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  const result = s <= 0.5
    ? b - (1 - 2 * s) * b * (1 - b)
    : b + (2 * s - 1) * (d - b);
  return clampByte(Math.round(result * 255));
}

function blendHslMode(
  base: readonly [number, number, number],
  fill: readonly [number, number, number],
  blendMode: 'hue' | 'saturation' | 'color' | 'luminosity',
): [number, number, number] {
  const baseHsl = rgbToHsl(base[0], base[1], base[2]);
  const fillHsl = rgbToHsl(fill[0], fill[1], fill[2]);
  switch (blendMode) {
    case 'hue':
      return hslToRgb(fillHsl[0], baseHsl[1], baseHsl[2]);
    case 'saturation':
      return hslToRgb(baseHsl[0], fillHsl[1], baseHsl[2]);
    case 'color':
      return hslToRgb(fillHsl[0], fillHsl[1], baseHsl[2]);
    case 'luminosity':
      return hslToRgb(baseHsl[0], baseHsl[1], fillHsl[2]);
  }
}

function normalizeSeedCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value);
}

function normalizeTolerance(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return roundNumber(value, 3);
}

function normalizeGapClosePixels(value: number | boolean | undefined): number {
  if (value === true) return 1;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return roundNumber(value, 3);
}

function normalizeHexColor(color: string): string {
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex.split('').map((part) => part + part).join('').toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return `#${hex.toLowerCase()}`;
  }
  return '#000000';
}

function normalizeBlendMode(value: BlendMode | undefined): BlendMode {
  switch (value) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'color-dodge':
    case 'color-burn':
    case 'hard-light':
    case 'soft-light':
    case 'difference':
    case 'exclusion':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return value;
    case 'normal':
    default:
      return 'normal';
  }
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function contains(imageData: ImageData, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < imageData.width && y < imageData.height;
}

function cloneImageData(imageData: ImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data);
  // Must be a REAL ImageData instance: the result is handed to ctx.putImageData(), which rejects a
  // plain {width,height,data} object ("parameter 1 is not of type 'ImageData'") — that bug made the
  // paint bucket silently no-op in the browser while node tests (which only read .data) passed.
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, imageData.width, imageData.height);
  }
  return { width: imageData.width, height: imageData.height, data } as ImageData;
}

function mixByte(before: number, after: number, amount: number): number {
  return Math.round(before + (after - before) * amount);
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = clamp01(r / 255);
  const green = clamp01(g / 255);
  const blue = clamp01(b / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness];
  }

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue = 0;
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return [hue / 6, saturation, lightness];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  const saturation = clamp01(s);
  const lightness = clamp01(l);
  if (saturation === 0) {
    const gray = clampByte(lightness * 255);
    return [gray, gray, gray];
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    clampByte(hueToRgb(p, q, hue + 1 / 3) * 255),
    clampByte(hueToRgb(p, q, hue) * 255),
    clampByte(hueToRgb(p, q, hue - 1 / 3) * 255),
  ];
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}
