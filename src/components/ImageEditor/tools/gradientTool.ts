import type { GradientToolSettings, ImageLayer } from '../../../types/imageEditor';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { cloneBitmap, createBitmap, getBitmapImageData } from '../LayerBitmap';
import {
  applyGradientToBitmap,
  describeGradientFillParity,
  type GradientFillParityDescriptor,
  type GradientOptions,
  type GradientParityUnsupportedDescriptor,
} from '../ImageGradientFill';
import type { Point, ToolEnv, ToolHandler } from './types';

interface GradientStroke {
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  start: Point;
  last: Point;
}

let stroke: GradientStroke | null = null;

export interface GradientToolParityDescriptor {
  descriptorId: 'image-gradient-tool:v1';
  version: 1;
  presetId: string;
  mode: GradientToolSettings['mode'];
  colorMode: GradientToolSettings['colorMode'];
  behavior: {
    foregroundToTransparent: boolean;
    reverse: boolean;
    dither: boolean;
    alphaStops: boolean;
  };
  presetPortability: {
    portable: boolean;
    format: 'signal-loom-gradient-preset:v1';
    stopCount: number;
    warnings: string[];
  };
  fill: GradientFillParityDescriptor;
  preview: {
    id: string;
    signature: string;
  };
  sourceBin: {
    presetSignature: string;
    exportSignature: string;
    caveats: string[];
  };
  unsupported: GradientParityUnsupportedDescriptor[];
  caveats: string[];
}

export function describeGradientToolParity(options: {
  settings: GradientToolSettings;
  foregroundColor: string;
  backgroundColor: string;
  brushOpacity: number;
  previewFrom: Point;
  previewTo: Point;
  presetId?: string;
}): GradientToolParityDescriptor {
  const presetId = options.presetId ?? options.settings.presetId ?? 'current';
  const fillOptions = buildGradientOptionsFromToolSettings({
    settings: options.settings,
    foregroundColor: options.foregroundColor,
    backgroundColor: options.backgroundColor,
    brushOpacity: options.brushOpacity,
    from: options.previewFrom,
    to: options.previewTo,
  });
  const fill = describeGradientFillParity(fillOptions);
  const stopCount = fill.stops.length;
  const portable = options.settings.colorMode !== 'multiStop' || stopCount >= 2;
  const warnings = portable ? [] : ['Multi-stop presets need at least two color stops to round-trip as a portable preset.'];
  const reverseStatus = options.settings.reverse ? 'reverse' : 'forward';
  const presetSignature = [
    'signal-loom-gradient-preset:v1',
    presetId,
    options.settings.mode,
    options.settings.colorMode,
    `reverse:${options.settings.reverse}`,
    `dither:${Boolean(options.settings.dither)}`,
    `stops:${fill.stops.map((stop) => `${stop.offset}:${stop.color}@${stop.opacity}`).join('|')}`,
  ].join('|');
  const signature = [
    'image-gradient-tool:v1',
    presetId,
    options.settings.mode,
    options.settings.colorMode,
    `reverse:${options.settings.reverse}`,
    `dither:${Boolean(options.settings.dither)}`,
    fill.preview.signature,
  ].join('|');

  return {
    descriptorId: 'image-gradient-tool:v1',
    version: 1,
    presetId,
    mode: options.settings.mode,
    colorMode: options.settings.colorMode,
    behavior: {
      foregroundToTransparent: options.settings.colorMode === 'foregroundToTransparent',
      reverse: options.settings.reverse,
      dither: Boolean(options.settings.dither),
      alphaStops: fill.stops.some((stop) => stop.sourceOpacity < 1 || stop.opacity < fill.alpha.overallOpacity),
    },
    presetPortability: {
      portable,
      format: 'signal-loom-gradient-preset:v1',
      stopCount,
      warnings,
    },
    fill,
    preview: {
      id: `gradient-tool-preview:${presetId}:${options.settings.mode}:${options.settings.colorMode}:${reverseStatus}`,
      signature,
    },
    sourceBin: {
      presetSignature,
      exportSignature: [
        'image-gradient-tool-export:v1',
        `preset:${presetId}`,
        `fill:${fill.preview.signature}`,
        'native-layer:false',
      ].join('|'),
      caveats: [
        'Source Bin handoff stores normalized raster gradient metadata and preview signatures, not editable native gradient layers.',
        'Exports flatten the rendered gradient stroke into layer pixels before downstream reuse.',
      ],
    },
    unsupported: [
      { feature: 'mesh-gradient', status: 'unsupported', caveat: 'Mesh gradients are not available in the Gradient tool.' },
      { feature: 'noise-gradient', status: 'unsupported', caveat: 'Noise gradients are not available in the Gradient tool.' },
    ],
    caveats: [
      'Gradient tool strokes rasterize into the active pixel layer and do not remain editable gradient objects.',
      ...(options.settings.dither ? ['Ordered dithering is deterministic and rasterized into the active layer.'] : ['Dither is available but disabled for this stroke.']),
    ],
  };
}

export const gradientTool: ToolHandler = {
  onPointerDown(env, point) {
    const layer = env.activeLayer;
    if (!canEditImageLayerPixels(layer)) return;
    const bitmap = ensureBitmap(env, layer);
    stroke = {
      layerId: layer.id,
      bitmapBefore: cloneBitmap(bitmap),
      start: point,
      last: point,
    };
    previewGradient(env, point);
  },

  onPointerMove(env, point) {
    if (!stroke) return;
    stroke.last = point;
    previewGradient(env, point);
  },

  onPointerUp(env, point) {
    if (!stroke) return;
    stroke.last = point;
    previewGradient(env, point);
    const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
    if (layer?.bitmap) {
      env.pushOperation({
        kind: 'paint',
        docId: env.doc.id,
        layerId: layer.id,
        before: stroke.bitmapBefore,
        after: cloneBitmap(layer.bitmap),
      });
      env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
      env.store.markDocumentDirty(env.doc.id);
    }
    stroke = null;
  },

  onCancel() {
    stroke = null;
  },
};

function previewGradient(env: ToolEnv, end: Point): void {
  if (!stroke) return;
  const layer = env.doc.layers.find((candidate) => candidate.id === stroke?.layerId);
  if (!layer?.bitmap) return;
  const gradientSettings = env.gradientToolSettings ?? {
    mode: 'linear',
    colorMode: 'foregroundToTransparent',
    reverse: false,
    dither: false,
  };
  const fillOptions = buildGradientOptionsFromToolSettings({
    settings: gradientSettings,
    foregroundColor: env.brushSettings.color,
    backgroundColor: env.backgroundColor ?? '#000000',
    brushOpacity: env.brushSettings.opacity,
    from: {
      x: stroke.start.x - layer.x,
      y: stroke.start.y - layer.y,
    },
    to: {
      x: end.x - layer.x,
      y: end.y - layer.y,
    },
    sourceImageData: getBitmapImageData(stroke.bitmapBefore),
  });

  applyGradientToBitmap(layer.bitmap, fillOptions);
  env.requestRender();
}

function buildGradientOptionsFromToolSettings(options: {
  settings: GradientToolSettings;
  foregroundColor: string;
  backgroundColor: string;
  brushOpacity: number;
  from: Point;
  to: Point;
  sourceImageData?: ImageData;
}): GradientOptions {
  const { settings } = options;
  const startColor = options.foregroundColor;
  const endColor = settings.colorMode === 'foregroundToBackground'
    ? options.backgroundColor
    : options.foregroundColor;
  const startOpacity = settings.colorMode === 'foregroundToBackground' ? 1 : 1;
  const endOpacity = settings.colorMode === 'foregroundToBackground' || settings.colorMode === 'multiStop' ? 1 : 0;
  const colorStops = settings.colorMode === 'multiStop'
    ? normalizeToolGradientStops(settings.colorStops, settings.reverse)
    : undefined;
  const gradientStops = settings.reverse && settings.colorMode !== 'multiStop'
    ? {
        startColor: endColor,
        endColor: startColor,
        startOpacity: endOpacity,
        endOpacity: startOpacity,
      }
    : {
        startColor,
        endColor,
        startOpacity,
        endOpacity,
      };
  return {
    from: options.from,
    to: options.to,
    startColor: gradientStops.startColor,
    endColor: gradientStops.endColor,
    colorStops,
    opacity: options.brushOpacity,
    mode: settings.mode,
    startOpacity: gradientStops.startOpacity,
    endOpacity: gradientStops.endOpacity,
    dither: settings.dither,
    sourceImageData: options.sourceImageData,
  };
}

function normalizeToolGradientStops(
  stops: NonNullable<ToolEnv['gradientToolSettings']>['colorStops'] | undefined,
  reverse: boolean,
) {
  if (!stops || stops.length < 2) return undefined;
  const boundedStops = stops.map((stop) => ({
    ...stop,
    offset: reverse ? 1 - stop.offset : stop.offset,
  }));
  return boundedStops.sort((a, b) => a.offset - b.offset);
}

function ensureBitmap(env: ToolEnv, layer: ImageLayer): OffscreenCanvas {
  if (layer.bitmap) return layer.bitmap;
  const bitmap = createBitmap(env.doc.width, env.doc.height);
  env.store.updateLayer(env.doc.id, layer.id, { bitmap });
  return bitmap;
}
