import type { GradientToolMode, ImageColorChannel, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import type { Point } from './tools/types';

export interface GradientOptions {
  from: Point;
  to: Point;
  startColor: string;
  endColor: string;
  colorStops?: GradientColorStop[];
  opacity: number;
  mode: GradientToolMode;
  startOpacity?: number;
  endOpacity?: number;
  dither?: boolean;
  sourceImageData?: ImageData;
}

export interface GradientColorStop {
  offset: number;
  color: string;
  opacity?: number;
}

export type GradientParityUnsupportedFeature =
  | 'mesh-gradient'
  | 'noise-gradient'
  | 'native-gradient-fill-layer'
  | 'gradient-map-adjustment';

export interface GradientParityUnsupportedDescriptor {
  feature: GradientParityUnsupportedFeature;
  status: 'unsupported';
  caveat: string;
}

export interface GradientFillParityDescriptor {
  descriptorId: 'image-gradient-fill:v1';
  version: 1;
  kind: 'linear-two-color' | 'foreground-to-transparent' | 'custom-multi-stop';
  mode: GradientToolMode;
  support: 'supported';
  geometry: {
    from: Point;
    to: Point;
    radius: number;
    length: number;
  };
  stops: Array<{
    offset: number;
    color: string;
    opacity: number;
    sourceOpacity: number;
  }>;
  alpha: {
    overallOpacity: number;
    startOpacity: number;
    endOpacity: number;
    compositing: 'source-over-alpha';
    preservesBaseAlpha: boolean;
  };
  capabilities: {
    linear: boolean;
    radial: boolean;
    angle: boolean;
    reflected: boolean;
    diamond: boolean;
    customMultiStop: boolean;
    foregroundToTransparent: boolean;
    reverse: boolean;
    dither: boolean;
  };
  preview: {
    id: string;
    signature: string;
  };
  unsupported: GradientParityUnsupportedDescriptor[];
  export: {
    renderPath: 'rasterized-canvas-image-data';
    portablePreset: boolean;
    caveats: string[];
  };
}

export type GradientReadinessModeStatus = 'supported';
export type GradientReadinessDitherStatus = 'supported-enabled' | 'supported-disabled';

export interface GradientReadinessDescriptor {
  descriptorId: 'image-gradient-readiness:v1';
  version: 1;
  modes: Record<GradientToolMode, {
    status: GradientReadinessModeStatus;
    previewSignatureSegment: string;
  }>;
  preset: {
    status: 'supported';
    portable: boolean;
    caveat: string;
  };
  stops: {
    status: 'supported';
    count: number;
    arbitraryOffsets: boolean;
    perStopOpacity: boolean;
    hasTransparency: boolean;
    signature: string;
  };
  dither: {
    status: GradientReadinessDitherStatus;
    deterministic: boolean;
    caveat: string;
  };
  nativeGradientLayer: {
    status: 'unsupported';
    caveat: string;
  };
  unsupported: GradientParityUnsupportedDescriptor[];
  gradientMap: {
    status: 'caveat';
    caveat: string;
  };
  preview: {
    fillSignature: string;
    readinessSignature: string;
  };
  export: {
    flattening: 'rasterized-canvas-image-data';
    sourceBinAsset: {
      kind: 'flattened-gradient-fill';
      previewSignature: string;
      exportSignature: string;
    };
    caveats: string[];
  };
}

export type GradientActionTarget = 'active-layer' | 'layer-mask' | 'quick-mask' | 'selection';

export type GradientActionBlockerCode =
  | 'zero-length-gradient'
  | 'missing-writable-layer'
  | 'opacity-out-of-range'
  | 'invalid-stop-count';

export interface GradientActionBlocker {
  code: GradientActionBlockerCode;
  severity: 'blocker';
  message: string;
}

export interface GradientActionReadinessOptions {
  options: GradientOptions;
  hasSelection?: boolean;
  selectionFeather?: number;
  target?: GradientActionTarget;
  activeChannel?: ImageColorChannel | 'alpha' | 'spot';
  hasWritableLayer?: boolean;
  batch?: boolean;
  actionRecording?: boolean;
  requestedNativeGradientLayer?: boolean;
  requestedGradientMap?: boolean;
}

export interface GradientActionReadinessDescriptor {
  descriptorId: 'image-gradient-action-readiness:v1';
  version: 1;
  fill: GradientFillParityDescriptor;
  selection: {
    route: 'full-layer' | 'selection-mask-clipped';
    hasSelection: boolean;
    featherPixels: number;
    caveat: string;
  };
  alpha: {
    transparentStops: boolean;
    overallOpacity: number;
    writesTransparentPixels: boolean;
    preservesExistingTransparentPixels: false;
    caveat: string;
  };
  target: {
    requested: GradientActionTarget;
    writePath: 'active-layer-rgba' | 'active-layer-mask-alpha' | 'quick-mask-alpha' | 'selection-mask-preview';
    activeChannel: ImageColorChannel | 'alpha' | 'spot';
    caveats: string[];
  };
  blockers: GradientActionBlocker[];
  unsupported: GradientParityUnsupportedDescriptor[];
  batch: {
    suitable: boolean;
    actionRecordable: boolean;
    exportSignature: string;
    caveats: string[];
  };
  preview: {
    signature: string;
  };
}

export function describeGradientFillParity(options: GradientOptions): GradientFillParityDescriptor {
  const overallOpacity = roundUnit(clamp01(options.opacity));
  const startOpacity = roundUnit(clamp01((options.startOpacity ?? 1) * overallOpacity));
  const endOpacity = roundUnit(clamp01((options.endOpacity ?? 1) * overallOpacity));
  const stops = describeGradientStops(options.colorStops, {
    startColor: options.startColor,
    endColor: options.endColor,
    overallOpacity,
    startOpacity,
    endOpacity,
  });
  const from = roundPoint(options.from);
  const to = roundPoint(options.to);
  const length = roundGeometry(Math.hypot(options.to.x - options.from.x, options.to.y - options.from.y));
  const kind = getGradientDescriptorKind(options, stops);
  const stopSignature = stops.map((stop) => `${formatNumber(stop.offset)}:${stop.color}@${formatNumber(stop.opacity)}`).join('|');
  const signature = [
    'image-gradient-fill:v1',
    options.mode,
    kind,
    `${formatNumber(from.x)},${formatNumber(from.y)}`,
    `${formatNumber(to.x)},${formatNumber(to.y)}`,
    stopSignature,
    `alpha:${formatNumber(startOpacity)}/${formatNumber(endOpacity)}`,
    `dither:${Boolean(options.dither)}`,
  ].join('|');

  return {
    descriptorId: 'image-gradient-fill:v1',
    version: 1,
    kind,
    mode: options.mode,
    support: 'supported',
    geometry: {
      from,
      to,
      radius: length,
      length,
    },
    stops,
    alpha: {
      overallOpacity,
      startOpacity,
      endOpacity,
      compositing: 'source-over-alpha',
      preservesBaseAlpha: true,
    },
    capabilities: {
      linear: true,
      radial: true,
      angle: true,
      reflected: true,
      diamond: true,
      customMultiStop: true,
      foregroundToTransparent: true,
      reverse: true,
      dither: Boolean(options.dither),
    },
    preview: {
      id: `gradient-preview:${options.mode}:${kind}:${formatNumber(from.x)},${formatNumber(from.y)}:${formatNumber(to.x)},${formatNumber(to.y)}:${stops.length}`,
      signature,
    },
    unsupported: getUnsupportedGradientFillDescriptors(),
    export: {
      renderPath: 'rasterized-canvas-image-data',
      portablePreset: true,
      caveats: [
        'Gradient fills are applied destructively to layer pixels; editable native gradient layers are not exported.',
        ...(options.dither ? ['Ordered dithering is applied deterministically before raster export.'] : ['Dither is available but disabled for this fill.']),
        'Unsupported mesh and noise gradients require raster fallback before export.',
      ],
    },
  };
}

export function describeGradientReadiness(options: GradientOptions): GradientReadinessDescriptor {
  const fill = describeGradientFillParity(options);
  const stopSignature = fill.stops
    .map((stop) => `${formatNumber(stop.offset)}:${stop.color}@${formatNumber(stop.opacity)}`)
    .join('|');
  const hasTransparency = fill.stops.some((stop) => stop.sourceOpacity < fill.alpha.overallOpacity);
  const unsupported = getUnsupportedGradientFillDescriptors();
  const modeEntries = GRADIENT_READINESS_MODES.map((mode) => [
    mode,
    {
      status: 'supported' as const,
      previewSignatureSegment: `mode:${mode}`,
    },
  ]);
  const ditherEnabled = Boolean(options.dither);
  const readinessSignature = [
    'image-gradient-readiness:v1',
    `mode:${fill.mode}`,
    `stops:${fill.stops.length}`,
    `preset:${fill.export.portablePreset ? 'portable' : 'not-portable'}`,
    `transparency:${hasTransparency}`,
    `dither:${ditherEnabled}`,
    'native-layer:unsupported',
    `unsupported:${unsupported.map((entry) => entry.feature).join(',')}`,
  ].join('|');

  return {
    descriptorId: 'image-gradient-readiness:v1',
    version: 1,
    modes: Object.fromEntries(modeEntries) as GradientReadinessDescriptor['modes'],
    preset: {
      status: 'supported',
      portable: fill.export.portablePreset,
      caveat: 'Preset identity is portable as normalized colors/stops, not as a native Photoshop preset object.',
    },
    stops: {
      status: 'supported',
      count: fill.stops.length,
      arbitraryOffsets: true,
      perStopOpacity: true,
      hasTransparency,
      signature: stopSignature,
    },
    dither: {
      status: ditherEnabled ? 'supported-enabled' : 'supported-disabled',
      deterministic: true,
      caveat: ditherEnabled
        ? 'Ordered dithering is applied deterministically for this descriptor.'
        : 'Ordered dithering is available and deterministic, but disabled for this descriptor.',
    },
    nativeGradientLayer: {
      status: 'unsupported',
      caveat: 'Editable native Photoshop-style gradient fill layers are not retained; fills are rasterized into layer pixels.',
    },
    unsupported,
    gradientMap: {
      status: 'caveat',
      caveat: 'Gradient Map tonal remapping belongs to adjustment-layer planning, not the pixel gradient fill path.',
    },
    preview: {
      fillSignature: fill.preview.signature,
      readinessSignature,
    },
    export: {
      flattening: 'rasterized-canvas-image-data',
      sourceBinAsset: {
        kind: 'flattened-gradient-fill',
        previewSignature: fill.preview.signature,
        exportSignature: [
          'image-gradient-export:v1',
          `fill:${fill.preview.signature}`,
          'flatten:rasterized-canvas-image-data',
          'native-layer:false',
        ].join('|'),
      },
      caveats: [
        'Gradient output is flattened through raster canvas ImageData for preview and export.',
        'Editable native gradient layer parameters are not preserved across export.',
        'Mesh, noise, and Gradient Map workflows require separate raster or adjustment-layer fallbacks.',
      ],
    },
  };
}

export function describeGradientActionReadiness(
  descriptorOptions: GradientActionReadinessOptions,
): GradientActionReadinessDescriptor {
  const fill = describeGradientFillParity(descriptorOptions.options);
  const hasSelection = descriptorOptions.hasSelection === true;
  const target = descriptorOptions.target ?? 'active-layer';
  const activeChannel = descriptorOptions.activeChannel ?? 'rgb';
  const blockers = getGradientActionBlockers(descriptorOptions.options, descriptorOptions.hasWritableLayer);
  const unsupported = getGradientActionUnsupportedDescriptors({
    requestedNativeGradientLayer: descriptorOptions.requestedNativeGradientLayer === true,
    requestedGradientMap: descriptorOptions.requestedGradientMap === true,
  });
  const transparentStops = fill.stops.some((stop) => stop.opacity < fill.alpha.overallOpacity);
  const selectionRoute: GradientActionReadinessDescriptor['selection']['route'] = hasSelection ? 'selection-mask-clipped' : 'full-layer';
  const batchSuitable = descriptorOptions.batch === true && blockers.length === 0;
  const descriptor = {
    descriptorId: 'image-gradient-action-readiness:v1' as const,
    version: 1 as const,
    fill,
    selection: {
      route: selectionRoute,
      hasSelection,
      featherPixels: Math.max(0, roundGeometry(descriptorOptions.selectionFeather ?? 0)),
      caveat: hasSelection
        ? 'Gradient output is clipped by the current selection mask before writing to the target pixels.'
        : 'Gradient output writes to the full target bounds because no selection mask is active.',
    },
    alpha: {
      transparentStops,
      overallOpacity: fill.alpha.overallOpacity,
      writesTransparentPixels: transparentStops,
      preservesExistingTransparentPixels: false as const,
      caveat: transparentStops
        ? 'Transparent gradient stops lower source opacity during source-over compositing; existing transparent pixels can still receive color unless layer transparency is separately locked.'
        : 'Opaque gradient stops source-over composite into the target; separate transparency locks are outside this helper.',
    },
    target: {
      requested: target,
      writePath: getGradientActionWritePath(target),
      activeChannel,
      caveats: getGradientActionTargetCaveats(target, activeChannel),
    },
    blockers,
    unsupported,
    batch: {
      suitable: batchSuitable,
      actionRecordable: descriptorOptions.actionRecording === true,
      exportSignature: [
        'image-gradient-action-batch:v1',
        fill.preview.signature,
        `target:${target}`,
        `channel:${activeChannel}`,
        `selection:${selectionRoute}`,
      ].join('|'),
      caveats: [
        'Batch gradient fills require deterministic endpoints and a writable target for every document.',
        'Recorded actions can replay normalized endpoints, colors, stops, opacity, mode, selection routing, and dither state.',
      ],
    },
  };

  return {
    ...descriptor,
    preview: {
      signature: [
        'image-gradient-action-readiness:v1',
        fill.preview.signature,
        `selection:${selectionRoute}`,
        `target:${target}`,
        `channel:${activeChannel}`,
        `blockers:${blockers.map((blocker) => blocker.code).join(',')}`,
        `batch:${batchSuitable}`,
      ].join('|'),
    },
  };
}

export function applyGradientToBitmap(
  bitmap: LayerBitmap,
  options: GradientOptions,
): void {
  const source = options.sourceImageData ?? getBitmapImageData(bitmap);
  putBitmapImageData(bitmap, applyGradientToImageData(source, options));
}

export function applyGradientToImageData(
  imageData: ImageData,
  options: GradientOptions,
): ImageData {
  const output = cloneImageData(imageData);
  const overallOpacity = clamp01(options.opacity);
  const startOpacity = clamp01((options.startOpacity ?? 1) * overallOpacity);
  const endOpacity = clamp01((options.endOpacity ?? 1) * overallOpacity);
  const colorStops = normalizeGradientStops(options.colorStops, {
    startColor: options.startColor,
    endColor: options.endColor,
    overallOpacity,
    startOpacity,
    endOpacity,
  });
  const radius = Math.hypot(options.to.x - options.from.x, options.to.y - options.from.y);
  const dx = options.to.x - options.from.x;
  const dy = options.to.y - options.from.y;
  const lengthSquared = dx * dx + dy * dy;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const rawAmount = computeGradientAmount({ x, y }, options, radius, lengthSquared);
      const t = options.dither ? applyOrderedDither(rawAmount, x, y) : rawAmount;
      const gradientStop = sampleGradientStops(colorStops, t);
      const gradientColor = gradientStop.color;
      const gradientAlpha = gradientStop.opacity;
      const offset = (y * output.width + x) * 4;
      const baseAlpha = imageData.data[offset + 3] / 255;
      const outAlpha = gradientAlpha + baseAlpha * (1 - gradientAlpha);

      if (outAlpha <= 0) {
        output.data[offset] = 0;
        output.data[offset + 1] = 0;
        output.data[offset + 2] = 0;
        output.data[offset + 3] = 0;
        continue;
      }

      const baseWeight = baseAlpha * (1 - gradientAlpha);
      output.data[offset] = compositeChannel(imageData.data[offset], gradientColor[0], baseWeight, gradientAlpha, outAlpha);
      output.data[offset + 1] = compositeChannel(imageData.data[offset + 1], gradientColor[1], baseWeight, gradientAlpha, outAlpha);
      output.data[offset + 2] = compositeChannel(imageData.data[offset + 2], gradientColor[2], baseWeight, gradientAlpha, outAlpha);
      output.data[offset + 3] = Math.round(outAlpha * 255);
    }
  }

  return output;
}

function applyOrderedDither(amount: number, x: number, y: number): number {
  const matrix = BAYER_4X4[y % 4][x % 4];
  return clamp01(amount + ((matrix - 7.5) / 255));
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const GRADIENT_READINESS_MODES: GradientToolMode[] = ['linear', 'radial', 'angle', 'reflected', 'diamond'];

function normalizeGradientStops(
  stops: GradientColorStop[] | undefined,
  fallback: {
    startColor: string;
    endColor: string;
    overallOpacity: number;
    startOpacity: number;
    endOpacity: number;
  },
): Array<{ offset: number; color: [number, number, number]; opacity: number }> {
  const hasCustomStops = Boolean(stops && stops.length >= 2);
  const sourceStops: GradientColorStop[] = hasCustomStops
    ? stops ?? []
    : [
        { offset: 0, color: fallback.startColor, opacity: fallback.startOpacity },
        { offset: 1, color: fallback.endColor, opacity: fallback.endOpacity },
      ];

  return sourceStops
    .map((stop) => ({
      offset: clamp01(stop.offset),
      color: parseHexColor(stop.color),
      opacity: clamp01(clamp01(stop.opacity ?? 1) * (hasCustomStops ? fallback.overallOpacity : 1)),
    }))
    .sort((a, b) => a.offset - b.offset);
}

function describeGradientStops(
  stops: GradientColorStop[] | undefined,
  fallback: {
    startColor: string;
    endColor: string;
    overallOpacity: number;
    startOpacity: number;
    endOpacity: number;
  },
): GradientFillParityDescriptor['stops'] {
  const hasCustomStops = Boolean(stops && stops.length >= 2);
  const sourceStops: GradientColorStop[] = hasCustomStops
    ? stops ?? []
    : [
        { offset: 0, color: fallback.startColor, opacity: fallback.startOpacity },
        { offset: 1, color: fallback.endColor, opacity: fallback.endOpacity },
      ];

  return sourceStops
    .map((stop) => {
      const sourceOpacity = roundUnit(clamp01(stop.opacity ?? 1));
      return {
        offset: roundUnit(clamp01(stop.offset)),
        color: normalizeHexColor(stop.color),
        opacity: roundUnit(clamp01(sourceOpacity * (hasCustomStops ? fallback.overallOpacity : 1))),
        sourceOpacity,
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

function getGradientDescriptorKind(
  options: GradientOptions,
  stops: GradientFillParityDescriptor['stops'],
): GradientFillParityDescriptor['kind'] {
  if (options.colorStops && options.colorStops.length >= 2) return 'custom-multi-stop';
  if (stops.length >= 2 && stops[0].color === stops[1].color && stops[1].opacity === 0) {
    return 'foreground-to-transparent';
  }
  return 'linear-two-color';
}

function getUnsupportedGradientFillDescriptors(): GradientParityUnsupportedDescriptor[] {
  return [
    { feature: 'mesh-gradient', status: 'unsupported', caveat: 'Mesh gradients are not represented by the raster gradient fill path.' },
    { feature: 'noise-gradient', status: 'unsupported', caveat: 'Noise gradients are not procedurally generated by this fill path.' },
  ];
}

function getGradientActionUnsupportedDescriptors(options: {
  requestedNativeGradientLayer: boolean;
  requestedGradientMap: boolean;
}): GradientParityUnsupportedDescriptor[] {
  return [
    ...getUnsupportedGradientFillDescriptors(),
    ...(options.requestedNativeGradientLayer
      ? [{
          feature: 'native-gradient-fill-layer' as const,
          status: 'unsupported' as const,
          caveat: 'Photoshop-style editable gradient fill layers are not created by this raster fill helper.',
        }]
      : []),
    ...(options.requestedGradientMap
      ? [{
          feature: 'gradient-map-adjustment' as const,
          status: 'unsupported' as const,
          caveat: 'Gradient Map adjustment workflows are separate tonal remapping operations, not pixel gradient fills.',
        }]
      : []),
  ];
}

function getGradientActionBlockers(
  options: GradientOptions,
  hasWritableLayer: boolean | undefined,
): GradientActionBlocker[] {
  const blockers: GradientActionBlocker[] = [];
  if (Math.hypot(options.to.x - options.from.x, options.to.y - options.from.y) <= 0) {
    blockers.push({
      code: 'zero-length-gradient',
      severity: 'blocker',
      message: 'Gradient drag endpoints must not be identical.',
    });
  }
  if (hasWritableLayer === false) {
    blockers.push({
      code: 'missing-writable-layer',
      severity: 'blocker',
      message: 'A writable active layer or mask target is required before applying a gradient fill.',
    });
  }
  if (!Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1) {
    blockers.push({
      code: 'opacity-out-of-range',
      severity: 'blocker',
      message: 'Gradient opacity must be between 0 and 1 before execution.',
    });
  }
  if (options.colorStops && options.colorStops.length > 0 && options.colorStops.length < 2) {
    blockers.push({
      code: 'invalid-stop-count',
      severity: 'blocker',
      message: 'Custom gradient fills require at least two stops.',
    });
  }
  return blockers;
}

function getGradientActionWritePath(target: GradientActionTarget): GradientActionReadinessDescriptor['target']['writePath'] {
  switch (target) {
    case 'layer-mask':
      return 'active-layer-mask-alpha';
    case 'quick-mask':
      return 'quick-mask-alpha';
    case 'selection':
      return 'selection-mask-preview';
    case 'active-layer':
    default:
      return 'active-layer-rgba';
  }
}

function getGradientActionTargetCaveats(
  target: GradientActionTarget,
  activeChannel: ImageColorChannel | 'alpha' | 'spot',
): string[] {
  const caveats: string[] = [];
  if (target === 'layer-mask') {
    caveats.push('Layer mask targets use alpha-mask writes; color stops are converted to luminance/alpha mask intent.');
  } else if (target === 'quick-mask') {
    caveats.push('Quick Mask targets are preview/selection alpha workflows, not retained gradient layers.');
  } else if (target === 'selection') {
    caveats.push('Selection targets describe preview clipping only; committing still requires a writable layer or mask.');
  }
  if (activeChannel === 'alpha') {
    caveats.push('Alpha channel routing is descriptor-only for gradient fills; saved alpha channels are not directly written by this helper.');
  } else if (activeChannel === 'spot') {
    caveats.push('Spot channel routing is unsupported for gradient fills; convert through composite RGBA or spot-channel workflows.');
  } else if (activeChannel !== 'rgb') {
    caveats.push('Individual RGB channel routing is not directly written by the raster gradient helper.');
  }
  return caveats;
}

function sampleGradientStops(
  stops: Array<{ offset: number; color: [number, number, number]; opacity: number }>,
  amount: number,
): { color: [number, number, number]; opacity: number } {
  if (amount <= stops[0].offset) {
    return { color: stops[0].color, opacity: stops[0].opacity };
  }
  const lastStop = stops[stops.length - 1];
  if (amount >= lastStop.offset) {
    return { color: lastStop.color, opacity: lastStop.opacity };
  }

  for (let index = 1; index < stops.length; index += 1) {
    const next = stops[index];
    if (amount > next.offset) continue;
    const previous = stops[index - 1];
    const span = next.offset - previous.offset;
    const localAmount = span <= 0 ? 0 : (amount - previous.offset) / span;
    return {
      color: mixColor(previous.color, next.color, localAmount),
      opacity: mixScalar(previous.opacity, next.opacity, localAmount),
    };
  }

  return { color: lastStop.color, opacity: lastStop.opacity };
}

export function applyLinearGradientToBitmap(
  bitmap: LayerBitmap,
  options: {
    from: Point;
    to: Point;
    color: string;
    opacity: number;
    sourceImageData?: ImageData;
  },
): void {
  applyGradientToBitmap(bitmap, {
    from: options.from,
    to: options.to,
    startColor: options.color,
    endColor: options.color,
    opacity: options.opacity,
    mode: 'linear',
    startOpacity: 1,
    endOpacity: 0,
    sourceImageData: options.sourceImageData,
  });
}

export function applyLinearGradientToImageData(
  imageData: ImageData,
  options: {
    from: Point;
    to: Point;
    color: string;
    opacity: number;
  },
): ImageData {
  return applyGradientToImageData(imageData, {
    from: options.from,
    to: options.to,
    startColor: options.color,
    endColor: options.color,
    opacity: options.opacity,
    mode: 'linear',
    startOpacity: 1,
    endOpacity: 0,
  });
}

function computeGradientAmount(
  point: Point,
  options: GradientOptions,
  radius: number,
  lengthSquared: number,
): number {
  if (options.mode === 'angle') {
    return computeAngleGradientAmount(point, options);
  }
  if (options.mode === 'radial') {
    if (radius <= 0) return 0;
    return clamp01(Math.hypot(point.x - options.from.x, point.y - options.from.y) / radius);
  }
  if (options.mode === 'diamond') {
    if (radius <= 0) return 0;
    const deltaX = point.x - options.from.x;
    const deltaY = point.y - options.from.y;
    const unitX = (options.to.x - options.from.x) / radius;
    const unitY = (options.to.y - options.from.y) / radius;
    const perpendicularX = -unitY;
    const perpendicularY = unitX;
    const projected = Math.abs(deltaX * unitX + deltaY * unitY);
    const perpendicular = Math.abs(deltaX * perpendicularX + deltaY * perpendicularY);
    return clamp01((projected + perpendicular) / radius);
  }
  if (lengthSquared <= 0) return 0;
  const projectedAmount =
    ((point.x - options.from.x) * (options.to.x - options.from.x)
      + (point.y - options.from.y) * (options.to.y - options.from.y)) / lengthSquared;
  if (options.mode === 'reflected') {
    return clamp01(Math.abs(projectedAmount));
  }
  return clamp01(projectedAmount);
}

function computeAngleGradientAmount(point: Point, options: GradientOptions): number {
  const baseAngle = Math.atan2(options.to.y - options.from.y, options.to.x - options.from.x);
  const pointAngle = Math.atan2(point.y - options.from.y, point.x - options.from.x);
  const fullTurn = Math.PI * 2;
  return ((pointAngle - baseAngle + fullTurn) % fullTurn) / fullTurn;
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

function normalizeHexColor(color: string): string {
  const [red, green, blue] = parseHexColor(color);
  return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`;
}

function toHexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

function roundPoint(point: Point): Point {
  return {
    x: roundGeometry(point.x),
    y: roundGeometry(point.y),
  };
}

function roundGeometry(value: number): number {
  return roundTo(value, 2);
}

function roundUnit(value: number): number {
  return roundTo(value, 4);
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatNumber(value: number): string {
  return String(value);
}

function cloneImageData(imageData: ImageData): ImageData {
  const clonedData = new Uint8ClampedArray(imageData.data);
  if (typeof ImageData !== 'undefined') {
    return new ImageData(clonedData, imageData.width, imageData.height);
  }
  return {
    width: imageData.width,
    height: imageData.height,
    data: clonedData,
  } as ImageData;
}

function mixColor(
  start: [number, number, number],
  end: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    mixScalar(start[0], end[0], amount),
    mixScalar(start[1], end[1], amount),
    mixScalar(start[2], end[2], amount),
  ];
}

function compositeChannel(
  base: number,
  overlay: number,
  baseWeight: number,
  overlayWeight: number,
  outAlpha: number,
): number {
  return Math.round((base * baseWeight + overlay * overlayWeight) / outAlpha);
}

function mixScalar(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
