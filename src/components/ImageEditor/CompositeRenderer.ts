import type { ImageAnimationPlaybackCursor, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { recordStrokeDraw } from './imageStrokePerf';
import { maskToCanvas, type SelectionMask } from './SelectionMask';
import { createQuickMaskOverlayMask } from './ImageQuickMask';
import { buildSelectAndMaskPreviewMask, createSelectAndMaskMatteMask } from './ImageSelectAndMask';
import { drawCropPreviewOverlay, drawPerspectiveCropPreviewOverlay } from './ImageCropOverlay';
import { buildViewRotationTransform, computeVisibleDocumentBlit } from './viewport';
import { getCropPreview, getPerspectiveCropPreview } from './tools/cropTool';
import { isPerspectiveCropQuadValid } from './tools/perspectiveCropSession';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { createBitmap } from './LayerBitmap';
import { generateGridLines, type ImageViewSettings } from './ImageRulersGuides';
import { createLayerMaskOverlayMask } from './ImageLayerMask';
import { renderLayerWithEffects } from './ImageLayerEffects';
import { hasImageLayerGroupHierarchy, isImageLayerEffectivelyVisible } from './ImageLayerGroups';
import type { ImageLayerWithVectorMask } from './ImageVectorMasks';
import { materializeImageLinkedMasks } from './ImageLinkedMasks';
import {
  composeAnimationFrameDisplay,
  planAnimationFrameDisplay,
  renderAnimationFrameDisplayParts,
  type AnimationFrameDisplayParts,
} from './ImageFrameAnimation';

import {
  renderImageDocumentLayersToBitmap,
  compositeLayerRangeInto,
  setLiveMaskBypassLayer,
  composeLayerBitmapWithLiveMasks,
  clamp01,
} from './ImageAdjustmentLayer';
import {
  checkNativeWorkerMemoryAdmission,
  createNativeRefusalDisplay,
  dispatchNativeRenderRefusal,
  isHighBitDocument,
  prepareNativeCompositeLayers,
  renderNativeHighBitDocument,
} from './pixels/nativeDisplay';
import { NativeCompositeRefusal, type NativeCompositeRefusalCode } from './pixels/compositeBuffers';

const ANTS_DASH_LENGTH = 4;
const ANTS_PERIOD_MS = 600;
/** After this many high-res worker crashes the renderer stays on the synchronous compositor. */
const MAX_WORKER_FAILURES = 3;

type ImageBlendMode = ImageLayer['blendMode'];

export interface ImageBlendModeRenderCapability {
  supported: true;
  compositeOperation: GlobalCompositeOperation;
}

export interface ImageBlendModeCapabilityDescriptor {
  mode: ImageBlendMode;
  label: string;
  canvasCompositeOperation: GlobalCompositeOperation;
  preview: ImageBlendModeRenderCapability;
  export: ImageBlendModeRenderCapability;
  warnings: readonly string[];
}

export interface ImageBlendModeWarningOptions {
  blendIf?: boolean;
  advancedBlending?: boolean;
}

export type ImageBlendModeSupportGroupId = 'basic' | 'contrast' | 'component';

export interface ImageBlendModeSupportGroup {
  id: ImageBlendModeSupportGroupId;
  label: string;
  modes: ImageBlendMode[];
  supported: boolean;
  caveats: string[];
}

export interface ImageBlendModeCanvasCompositeMapping {
  mode: ImageBlendMode;
  compositeOperation: GlobalCompositeOperation;
}

export type ImageBlendModeAdvancedStateId =
  | 'blend-if'
  | 'fill-opacity'
  | 'knockout'
  | 'channel-targeting';

export type ImageBlendModeChannelTarget = 'red' | 'green' | 'blue';
export type ImageBlendModeKnockoutMode = 'none' | 'shallow' | 'deep';
export type ImageBlendModeExportTarget = 'editable' | 'flattened' | 'source-bin';

export interface UnsupportedPhotoshopBlendFeature {
  id: 'blend-if' | 'advanced-blending';
  label: string;
  supported: false;
  caveat: string;
}

export interface ImageBlendModeAlphaOpacityCaveat {
  id: 'layer-opacity' | 'flattened-alpha';
  label: string;
  value: number;
  caveat: string;
}

export interface ImageBlendModeParityOptions extends ImageBlendModeWarningOptions {
  activeModes?: readonly ImageBlendMode[];
  opacity?: number;
  exportTarget?: 'editable' | 'flattened';
}

export interface ImageBlendModeParityDescriptor {
  previewId: 'image-blend-mode-parity:v1';
  activeModes: ImageBlendMode[];
  supportGroups: ImageBlendModeSupportGroup[];
  canvasCompositeMappings: ImageBlendModeCanvasCompositeMapping[];
  unsupportedPhotoshopFeatures: UnsupportedPhotoshopBlendFeature[];
  alphaOpacityCaveats: ImageBlendModeAlphaOpacityCaveat[];
  knownMathLimitations: string[];
  previewSignature: string;
  exportSignature: string;
  warnings: string[];
}

export interface ImageBlendModePortabilityReadinessOptions {
  activeModes?: readonly ImageBlendMode[];
  blendIf?: boolean;
  fillOpacity?: number;
  knockout?: Exclude<ImageBlendModeKnockoutMode, 'none'>;
  channelTargeting?: readonly ImageBlendModeChannelTarget[];
  exportTarget?: ImageBlendModeExportTarget;
  sourceBinLinked?: boolean;
  batchLayerCount?: number;
}

export interface ImageBlendModeCanvasCompositeSupport {
  supported: true;
  modes: ImageBlendMode[];
  mappings: ImageBlendModeCanvasCompositeMapping[];
}

export interface ImageBlendModeUnsupportedAdvancedState {
  id: ImageBlendModeAdvancedStateId;
  label: string;
  requested: boolean;
  supported: false;
  value?: number;
  mode?: ImageBlendModeKnockoutMode;
  channels?: ImageBlendModeChannelTarget[];
  caveat: string;
  reasonCode: ImageBlendModePortabilityReasonCode;
}

export type ImageBlendModeSourceBinParityCaveatCode =
  | 'source-bin-visible-export-flattens-blend-stack'
  | 'source-bin-overwrite-requires-linked-source';

export interface ImageBlendModeSourceBinParityCaveat {
  code: ImageBlendModeSourceBinParityCaveatCode;
  target: ImageBlendModeExportTarget;
  warning: string;
}

export type ImageBlendModePortabilityReasonCode =
  | 'advanced-blending-unsupported'
  | 'blend-if-unsupported'
  | 'fill-opacity-unsupported'
  | 'knockout-unsupported'
  | 'channel-targeting-unsupported'
  | 'source-bin-linked-visible-export'
  | 'source-bin-unlinked-visible-export';

export interface ImageBlendModeActionSuitability {
  recordable: boolean;
  replayable: boolean;
  reasonCodes: ImageBlendModePortabilityReasonCode[];
}

export interface ImageBlendModeBatchSuitability {
  status: 'ready' | 'warning' | 'blocked';
  layerCount: number;
  reasonCodes: ImageBlendModePortabilityReasonCode[];
}

export interface ImageBlendModePortabilityReadinessDescriptor {
  id: 'image-blend-mode-portability-readiness:v1';
  canvasCompositeSupport: ImageBlendModeCanvasCompositeSupport;
  unsupportedPhotoshopAdvancedStates: ImageBlendModeUnsupportedAdvancedState[];
  exportSourceBinParityCaveats: ImageBlendModeSourceBinParityCaveat[];
  actionSuitability: ImageBlendModeActionSuitability;
  batchSuitability: ImageBlendModeBatchSuitability;
  signature: string;
  warnings: string[];
}

export const SUPPORTED_IMAGE_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const satisfies readonly ImageBlendMode[];

const IMAGE_BLEND_MODE_LABELS = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color Dodge',
  'color-burn': 'Color Burn',
  'hard-light': 'Hard Light',
  'soft-light': 'Soft Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
} satisfies Record<ImageBlendMode, string>;

const BLEND_IF_UNSUPPORTED_WARNING =
  'Blend If source/underlying tonal range splitting is not supported yet; flatten or rasterize those advanced blending settings before relying on Image preview/export parity.';
const ADVANCED_BLENDING_UNSUPPORTED_WARNING =
  'Advanced blending options such as channel targeting, knockout, and fill opacity are not supported yet; only layer opacity and canvas-native blend modes are previewed and exported.';
const FILL_OPACITY_UNSUPPORTED_WARNING =
  'Photoshop Fill Opacity is not supported yet; Sloom Studio uses layer opacity for canvas preview/export and treats fill opacity as metadata-only.';
const KNOCKOUT_UNSUPPORTED_WARNING =
  'Photoshop shallow/deep knockout is not supported yet; group and layer stacks render without knockout isolation.';
const CHANNEL_TARGETING_UNSUPPORTED_WARNING =
  'Photoshop advanced blending channel targeting is not supported yet; canvas blend modes apply to the full composited RGB result.';
const CANVAS_BLEND_MATH_LIMITATION =
  'Canvas blend math is browser-managed and may not exactly match Photoshop in non-sRGB, high-bit-depth, or color-managed documents.';
const COMPONENT_BLEND_MATH_LIMITATION =
  'Hue, Saturation, Color, and Luminosity rely on Canvas 2D component blending and are treated as flattened sRGB preview/export approximations.';
const SOFT_LIGHT_DODGE_BURN_LIMITATION =
  'Soft Light and Color Dodge/Burn formulas are delegated to the browser Canvas implementation; parity should be validated visually for critical PSD roundtrips.';
const LAYER_OPACITY_CAVEAT =
  'Layer opacity is applied through CanvasRenderingContext2D.globalAlpha before blend compositing; Photoshop fill opacity and per-channel opacity are not modeled.';
const FLATTENED_ALPHA_CAVEAT =
  'Flattened blend exports preserve canvas alpha compositing but do not retain editable Photoshop blend-mode stacks.';
const SOURCE_BIN_FLATTENED_BLEND_STACK_CAVEAT =
  'Source Bin visible exports flatten the canvas blend result and do not preserve editable blend-mode stacks for suite handoff.';
const SOURCE_BIN_LINK_REQUIRED_CAVEAT =
  'Source Bin overwrite parity requires a linked source item; unlinked layers can export a new flattened asset but cannot safely overwrite source content.';

const IMAGE_BLEND_MODE_SUPPORT_GROUPS: readonly ImageBlendModeSupportGroup[] = [
  {
    id: 'basic',
    label: 'Basic canvas blend modes',
    modes: ['normal', 'multiply', 'screen', 'overlay'],
    supported: true,
    caveats: [],
  },
  {
    id: 'contrast',
    label: 'Contrast and comparison blend modes',
    modes: ['darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion'],
    supported: true,
    caveats: [CANVAS_BLEND_MATH_LIMITATION],
  },
  {
    id: 'component',
    label: 'Component blend modes',
    modes: ['hue', 'saturation', 'color', 'luminosity'],
    supported: true,
    caveats: [COMPONENT_BLEND_MATH_LIMITATION],
  },
];

export const IMAGE_BLEND_MODE_CAPABILITIES: readonly ImageBlendModeCapabilityDescriptor[] =
  SUPPORTED_IMAGE_BLEND_MODES.map((mode) => {
    const compositeOperation = imageBlendModeToCanvasCompositeOperation(mode);
    return {
      mode,
      label: IMAGE_BLEND_MODE_LABELS[mode],
      canvasCompositeOperation: compositeOperation,
      preview: {
        supported: true,
        compositeOperation,
      },
      export: {
        supported: true,
        compositeOperation,
      },
      warnings: [],
    };
  });

const IMAGE_BLEND_MODE_CAPABILITY_BY_MODE = new Map(
  IMAGE_BLEND_MODE_CAPABILITIES.map((descriptor) => [descriptor.mode, descriptor]),
);

export function imageBlendModeToCanvasCompositeOperation(blendMode: ImageBlendMode): GlobalCompositeOperation {
  return blendMode === 'normal' ? 'source-over' : blendMode;
}

export function getImageBlendModeCapability(mode: ImageBlendMode): ImageBlendModeCapabilityDescriptor {
  return IMAGE_BLEND_MODE_CAPABILITY_BY_MODE.get(mode) ?? IMAGE_BLEND_MODE_CAPABILITIES[0];
}

export function getUnsupportedImageBlendModeWarnings(
  options: ImageBlendModeWarningOptions = {},
): string[] {
  const warnings: string[] = [];
  if (options.blendIf) {
    warnings.push(BLEND_IF_UNSUPPORTED_WARNING);
  }
  if (options.advancedBlending) {
    warnings.push(ADVANCED_BLENDING_UNSUPPORTED_WARNING);
  }
  return warnings;
}

export function getImageBlendModeCapabilityGroups(): ImageBlendModeSupportGroup[] {
  return IMAGE_BLEND_MODE_SUPPORT_GROUPS.map((group) => ({
    ...group,
    modes: [...group.modes],
    caveats: [...group.caveats],
  }));
}

export function describeImageBlendModeParity(
  options: ImageBlendModeParityOptions = {},
): ImageBlendModeParityDescriptor {
  const supportGroups = getImageBlendModeCapabilityGroups();
  const canvasCompositeMappings = IMAGE_BLEND_MODE_CAPABILITIES.map((descriptor) => ({
    mode: descriptor.mode,
    compositeOperation: descriptor.canvasCompositeOperation,
  }));
  const activeModes = uniqueBlendModes(options.activeModes ?? SUPPORTED_IMAGE_BLEND_MODES);
  const unsupportedPhotoshopFeatures = describeUnsupportedPhotoshopBlendFeatures(options);
  const alphaOpacityCaveats = describeBlendModeAlphaOpacityCaveats(options);
  const knownMathLimitations = [
    CANVAS_BLEND_MATH_LIMITATION,
    COMPONENT_BLEND_MATH_LIMITATION,
    SOFT_LIGHT_DODGE_BURN_LIMITATION,
  ];
  const warnings = [
    ...getUnsupportedImageBlendModeWarnings(options),
    ...alphaOpacityCaveats.map((caveat) => caveat.caveat),
    ...knownMathLimitations,
  ];

  return {
    previewId: 'image-blend-mode-parity:v1',
    activeModes,
    supportGroups,
    canvasCompositeMappings,
    unsupportedPhotoshopFeatures,
    alphaOpacityCaveats,
    knownMathLimitations,
    previewSignature: `image-blend-preview:v1:${JSON.stringify({
      previewId: 'image-blend-mode-parity:v1',
      activeModes,
      mappings: canvasCompositeMappings.filter((mapping) => activeModes.includes(mapping.mode)),
      supportGroups: supportGroups.map((group) => group.id),
      unsupported: unsupportedPhotoshopFeatures.map((feature) => feature.id),
      alphaOpacityCaveats: alphaOpacityCaveats.map((caveat) => caveat.id),
      knownMathLimitations,
    })}`,
    exportSignature: `image-blend-export:v1:${JSON.stringify({
      previewId: 'image-blend-mode-parity:v1',
      target: options.exportTarget ?? 'editable',
      activeModes,
      mappings: canvasCompositeMappings,
      unsupported: unsupportedPhotoshopFeatures,
      alphaOpacityCaveats,
      knownMathLimitations,
    })}`,
    warnings,
  };
}

export function describeImageBlendModePortabilityReadiness(
  options: ImageBlendModePortabilityReadinessOptions = {},
): ImageBlendModePortabilityReadinessDescriptor {
  const activeModes = uniqueBlendModes(options.activeModes ?? SUPPORTED_IMAGE_BLEND_MODES);
  const mappings = IMAGE_BLEND_MODE_CAPABILITIES
    .filter((descriptor) => activeModes.includes(descriptor.mode))
    .map((descriptor) => ({
      mode: descriptor.mode,
      compositeOperation: descriptor.canvasCompositeOperation,
    }));
  const unsupportedPhotoshopAdvancedStates = describeUnsupportedBlendAdvancedStates(options);
  const activeUnsupportedStates = unsupportedPhotoshopAdvancedStates.filter((state) => state.requested);
  const exportSourceBinParityCaveats = describeBlendSourceBinParityCaveats(options);
  const hasAdvancedUnsupported = activeUnsupportedStates.length > 0;
  const actionReasonCodes: ImageBlendModePortabilityReasonCode[] = hasAdvancedUnsupported
    ? ['advanced-blending-unsupported']
    : [];
  const batchReasonCodes: ImageBlendModePortabilityReasonCode[] = [...actionReasonCodes];
  if (options.exportTarget === 'source-bin') {
    batchReasonCodes.push(options.sourceBinLinked ? 'source-bin-linked-visible-export' : 'source-bin-unlinked-visible-export');
  }
  const batchLayerCount = Math.max(1, Math.trunc(options.batchLayerCount ?? 1));
  const batchStatus: ImageBlendModeBatchSuitability['status'] = hasAdvancedUnsupported
    ? 'blocked'
    : batchReasonCodes.length > 0
      ? 'warning'
      : 'ready';
  const warnings = [
    ...activeUnsupportedStates.map((state) => state.caveat),
    ...exportSourceBinParityCaveats.map((caveat) => caveat.warning),
  ];

  return {
    id: 'image-blend-mode-portability-readiness:v1',
    canvasCompositeSupport: {
      supported: true,
      modes: activeModes,
      mappings,
    },
    unsupportedPhotoshopAdvancedStates,
    exportSourceBinParityCaveats,
    actionSuitability: {
      recordable: !hasAdvancedUnsupported,
      replayable: !hasAdvancedUnsupported,
      reasonCodes: actionReasonCodes,
    },
    batchSuitability: {
      status: batchStatus,
      layerCount: batchLayerCount,
      reasonCodes: batchReasonCodes,
    },
    signature: `image-blend-mode-portability-readiness:v1:${JSON.stringify({
      activeModes,
      unsupported: activeUnsupportedStates.map((state) => state.id),
      exportTarget: options.exportTarget ?? 'editable',
      sourceBinLinked: options.sourceBinLinked ?? false,
      batchLayerCount,
    })}`,
    warnings,
  };
}

function describeUnsupportedPhotoshopBlendFeatures(
  options: ImageBlendModeWarningOptions,
): UnsupportedPhotoshopBlendFeature[] {
  const features: UnsupportedPhotoshopBlendFeature[] = [];
  if (options.blendIf) {
    features.push({
      id: 'blend-if',
      label: 'Blend If',
      supported: false,
      caveat: BLEND_IF_UNSUPPORTED_WARNING,
    });
  }
  if (options.advancedBlending) {
    features.push({
      id: 'advanced-blending',
      label: 'Advanced Blending',
      supported: false,
      caveat: ADVANCED_BLENDING_UNSUPPORTED_WARNING,
    });
  }
  return features;
}

function describeBlendModeAlphaOpacityCaveats(
  options: ImageBlendModeParityOptions,
): ImageBlendModeAlphaOpacityCaveat[] {
  const opacity = typeof options.opacity === 'number' && Number.isFinite(options.opacity)
    ? clamp01(options.opacity)
    : 1;
  const caveats: ImageBlendModeAlphaOpacityCaveat[] = [{
    id: 'layer-opacity',
    label: 'Layer opacity',
    value: opacity,
    caveat: LAYER_OPACITY_CAVEAT,
  }];
  if (options.exportTarget === 'flattened') {
    caveats.push({
      id: 'flattened-alpha',
      label: 'Flattened export alpha',
      value: 1,
      caveat: FLATTENED_ALPHA_CAVEAT,
    });
  }
  return caveats;
}

function describeUnsupportedBlendAdvancedStates(
  options: ImageBlendModePortabilityReadinessOptions,
): ImageBlendModeUnsupportedAdvancedState[] {
  const fillOpacity = typeof options.fillOpacity === 'number' && Number.isFinite(options.fillOpacity)
    ? clamp01(options.fillOpacity)
    : 1;
  const channels = uniqueChannels(options.channelTargeting ?? []);
  return [
    {
      id: 'blend-if',
      label: 'Blend If',
      requested: options.blendIf === true,
      supported: false,
      caveat: BLEND_IF_UNSUPPORTED_WARNING,
      reasonCode: 'blend-if-unsupported',
    },
    {
      id: 'fill-opacity',
      label: 'Fill Opacity',
      requested: options.fillOpacity !== undefined && fillOpacity < 1,
      supported: false,
      value: fillOpacity,
      caveat: FILL_OPACITY_UNSUPPORTED_WARNING,
      reasonCode: 'fill-opacity-unsupported',
    },
    {
      id: 'knockout',
      label: 'Knockout',
      requested: options.knockout !== undefined,
      supported: false,
      mode: options.knockout ?? 'none',
      caveat: KNOCKOUT_UNSUPPORTED_WARNING,
      reasonCode: 'knockout-unsupported',
    },
    {
      id: 'channel-targeting',
      label: 'Channel Targeting',
      requested: channels.length > 0,
      supported: false,
      channels,
      caveat: CHANNEL_TARGETING_UNSUPPORTED_WARNING,
      reasonCode: 'channel-targeting-unsupported',
    },
  ];
}

function describeBlendSourceBinParityCaveats(
  options: ImageBlendModePortabilityReadinessOptions,
): ImageBlendModeSourceBinParityCaveat[] {
  if (options.exportTarget !== 'source-bin') return [];
  const caveats: ImageBlendModeSourceBinParityCaveat[] = [{
    code: 'source-bin-visible-export-flattens-blend-stack',
    target: 'source-bin',
    warning: SOURCE_BIN_FLATTENED_BLEND_STACK_CAVEAT,
  }];
  caveats.push({
    code: 'source-bin-overwrite-requires-linked-source',
    target: 'source-bin',
    warning: SOURCE_BIN_LINK_REQUIRED_CAVEAT,
  });
  return caveats;
}

function uniqueChannels(channels: readonly ImageBlendModeChannelTarget[]): ImageBlendModeChannelTarget[] {
  const seen = new Set<ImageBlendModeChannelTarget>();
  const unique: ImageBlendModeChannelTarget[] = [];
  for (const channel of channels) {
    if (seen.has(channel)) continue;
    seen.add(channel);
    unique.push(channel);
  }
  return unique;
}

function uniqueBlendModes(modes: readonly ImageBlendMode[]): ImageBlendMode[] {
  const seen = new Set<ImageBlendMode>();
  const unique: ImageBlendMode[] = [];
  for (const mode of modes) {
    if (seen.has(mode)) continue;
    seen.add(mode);
    unique.push(mode);
  }
  return unique;
}

/**
 * The high-res compositor is a real Vite module worker (`highResComposite.worker.ts`). Its
 * predecessor was a Blob URL assembled from `Function.toString()` of ~30 helpers, which broke in
 * every minified build: a stringified function's internal calls reference its own module's
 * minified names, which don't exist in the blob's scope (`_r is not defined`, docs/notes/820).
 */
function createHighResWorker(): Worker {
  return new Worker(new URL('./highResComposite.worker.ts', import.meta.url), { type: 'module' });
}

const NATIVE_REFUSAL_CODES: readonly NativeCompositeRefusalCode[] = [
  'no-layers', 'shape-mismatch', 'mixed-depth', 'unsupported-state', 'mask-shape', 'budget-exceeded',
];

function refusalFromWorkerEnvelope(value: unknown): NativeCompositeRefusal | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as { code?: unknown; message?: unknown };
  const code = typeof envelope.code === 'string' && NATIVE_REFUSAL_CODES.includes(envelope.code as NativeCompositeRefusalCode)
    ? envelope.code as NativeCompositeRefusalCode
    : 'unsupported-state';
  const message = typeof envelope.message === 'string' ? envelope.message : 'Native worker refused the composite payload.';
  return new NativeCompositeRefusal(code, message);
}

/** Keep the legacy Canvas2D path byte-identical for 8-bit documents. */
function renderDocumentForDisplay(doc: ImageDocument): LayerBitmap {
  if (!isHighBitDocument(doc)) return renderImageDocumentLayersToBitmap(doc);
  const result = renderNativeHighBitDocument(doc);
  if (result.refusal) dispatchNativeRenderRefusal(result.refusal);
  return result.bitmap;
}

/**
 * Whether the layer range [startIndex, end) can be safely recomposited within a dab-sized dirty
 * rect alone. Layer effects (drop shadow / outer glow / stroke) and adjustments bleed outside the
 * painted pixels, and groups/adjustment layers transform the whole region — for those we fall back
 * to a full recomposite so the dirty-rect fast path never produces a stale edge.
 */
function rangeIsDirtyRectSafe(layers: readonly ImageLayer[], startIndex: number): boolean {
  for (let i = startIndex; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!layer) continue;
    if (layer.type === 'group' || layer.type === 'adjustment') return false;
    if (layer.adjustment) return false;
    if (layer.effects && layer.effects.length > 0) return false;
  }
  return true;
}

export class CompositeRenderer {
  private canvas: HTMLCanvasElement;
  private wrapper: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private antsRafId: number | null = null;
  private antsStart = 0;
  private currentDoc: ImageDocument | null = null;
  private currentSelection: SelectionMask | null = null;
  // Marching-ants overlay cache. The selection mask is a fresh object only when the user edits the
  // selection (bumpSelectionVersion does an immutable doc update, so the registry pushes a new mask
  // per edit); the continuous ants animation runs every frame but only advances the dash offset.
  // Rebuilding the full-document tint raster (maskToCanvas: an O(W*H) loop + a ~W*H*4-byte
  // allocation) and the per-pixel boundary (computeMaskOutline: O(W*H)) on EVERY animation frame
  // pinned the main thread — merely having a selection on a 4K document dropped the editor to
  // sub-1fps, and drawing/moving one stacked per-event mask rebuilds on top. Cache both, keyed by
  // mask identity, and rebuild only when the mask object actually changes (≈ once per edit).
  private antsCacheMask: SelectionMask | null = null;
  private antsTintCanvas: OffscreenCanvas | null = null;
  private antsOutline: Edge[] | null = null;
  private deviceWidth = 0;
  private deviceHeight = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  private workerResultBitmap: ImageBitmap | HTMLCanvasElement | LayerBitmap | null = null;
  private workerDocSignature: string | null = null;
  private isWorkerRunning = false;
  private workerFailureCount = 0;
  private lowResDoc: ImageDocument | null = null;
  private lowResScale = 1;
  private workerObj: Worker | null = null;
  // Cached editor-only animation display (onion ghosts / playback cel) over the last composite.
  // Keyed by document signature + the pure display plan so an idle loop redraws nothing; holds
  // OffscreenCanvas copies only, never aliases the worker bitmap it wrapped. Never reaches export.
  private animationDisplayKey: string | null = null;
  private animationDisplayBitmap: LayerBitmap | HTMLCanvasElement | ImageBitmap | null = null;
  private animationDisplayPartsKey: string | null = null;
  private animationDisplayParts: AnimationFrameDisplayParts | null = null;
  private animationFastDisplayBitmap: LayerBitmap | null = null;

  // Live-stroke fast path (used while isPaintingStroke): cache the composite of the layers BELOW
  // the active layer so each frame only recomposites the active layer + everything above it.
  private strokeBackdrop: LayerBitmap | null = null;
  private strokeScratch: LayerBitmap | null = null;
  private strokeBackdropState: LayerBitmap | null = null; // clippingBaseMask after the backdrop range
  private strokeBackdropLayers: readonly ImageLayer[] | null = null; // identity refs of [0, activeIndex)
  private strokeBackdropActiveId: string | null = null;
  // Dirty-rect live compositing (the Krita/GIMP "projection" model): the paint tools report the
  // doc-space region they touched each frame; we recomposite ONLY that region into the persistent
  // scratch instead of the whole document. This is the difference between O(document) and O(dab)
  // per frame — the entire reason fast sketching was unusable at 4K.
  private strokeDirtyRect: { x: number; y: number; width: number; height: number } | null = null;
  private strokeProjectionValid = false; // does the scratch hold a full, current composite to update?
  private wasPaintingStroke = false;
  private lastCompositeIncremental = false; // diagnostic: did the last stroke composite use the dirty-rect path?

  constructor(canvas: HTMLCanvasElement, wrapper: HTMLElement) {
    this.canvas = canvas;
    this.wrapper = wrapper;
    // The visible composite canvas uses a SYNCHRONIZED 2D context by default. A
    // `desynchronized: true` (low-latency) context presents this canvas through a separate
    // overlay surface that, on a real GPU compositor (Linux/Wayland + AMD especially), can
    // present an INCOMPLETE frame on a full-canvas redraw: the transparency checkerboard
    // (drawn first, synchronously, via fillRect) appears WITHOUT the composited image on top
    // (a deferred drawImage of a worker ImageBitmap). That is the long-standing "image
    // disappears to the checkerboard on zoom" bug — the backing store is correct
    // (getImageData reads the image) but the presented frame is stale, which is why it never
    // reproduced in a headless screenshot or pixel readback. Desync measured no perf win on
    // this hardware (present is already 60fps), so it is now opt-in only via the
    // __SIGNAL_LOOM_DESYNC_CANVAS__ window flag for A/B testing brush latency.
    const wantDesyncCanvas =
      typeof window !== 'undefined' &&
      (window as { __SIGNAL_LOOM_DESYNC_CANVAS__?: boolean }).__SIGNAL_LOOM_DESYNC_CANVAS__ === true;
    const ctx =
      (wantDesyncCanvas ? canvas.getContext('2d', { desynchronized: true }) : null) ??
      canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for composite renderer');
    }
    this.ctx = ctx;
    this.attachResizeObserver();
    this.syncSize();
    window.addEventListener('sloom-svg-loaded', this.handleSvgLoaded);
  }

  private handleSvgLoaded = (): void => {
    this.requestRender();
  };

  destroy(): void {
    window.removeEventListener('sloom-svg-loaded', this.handleSvgLoaded);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.antsRafId !== null) cancelAnimationFrame(this.antsRafId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.rafId = null;
    this.antsRafId = null;
    this.currentDoc = null;
    this.currentSelection = null;
    this.invalidateAntsCache();
    this.cleanupWorker();
  }

  private cleanupWorker(): void {
    if (this.workerObj) {
      this.workerObj.terminate();
      this.workerObj = null;
    }
    this.isWorkerRunning = false;
    this.workerDocSignature = null;
    this.closeWorkerResultBitmap();
    this.clearAnimationDisplayCache();
  }

  private clearAnimationDisplayCache(): void {
    // OffscreenCanvas buffers need no explicit close; dropping the references lets GC reclaim them.
    this.animationDisplayKey = null;
    this.animationDisplayBitmap = null;
    this.animationDisplayPartsKey = null;
    this.animationDisplayParts = null;
    this.animationFastDisplayBitmap = null;
  }

  /**
   * Onion-skin/playback display seam: EVERY main-canvas composite — module-worker result or
   * synchronous render alike — passes through here, so the mounted checkbox visibly affects the
   * normal view on any browser. Unaffected states return the input object untouched, and export
   * never calls this, so ordinary output cannot contain ghost imagery.
   */
  private applyAnimationFrameDisplay(
    composite: ImageBitmap | HTMLCanvasElement | LayerBitmap,
    doc: ImageDocument,
    cursor: ImageAnimationPlaybackCursor | null,
  ): ImageBitmap | HTMLCanvasElement | LayerBitmap {
    const plan = planAnimationFrameDisplay(doc, cursor);
    if (!plan) return composite;
    const key = `${this.buildDocSignature(doc)}|${JSON.stringify(plan)}`;
    if (this.animationDisplayKey === key && this.animationDisplayBitmap) return this.animationDisplayBitmap;
    const composed = composeAnimationFrameDisplay(composite, doc, cursor);
    this.animationDisplayKey = key;
    this.animationDisplayBitmap = composed;
    return composed;
  }

  /** Apply cached ghost/cel parts over the live stroke or low-resolution slider projection.
   * Frame-dependent rendering happens at most once per animation plan; subsequent pointer events
   * reuse the parts and only redraw the already-cheap base projection. */
  private applyAnimationFrameFastPath(
    base: ImageBitmap | HTMLCanvasElement | LayerBitmap,
    doc: ImageDocument,
    cursor: ImageAnimationPlaybackCursor | null,
  ): ImageBitmap | HTMLCanvasElement | LayerBitmap {
    const plan = planAnimationFrameDisplay(doc, cursor);
    if (!plan) return base;
    const key = `${doc.id}|${doc.width}x${doc.height}|${JSON.stringify(plan)}|${JSON.stringify(doc.metadata?.animation)}`;
    if (this.animationDisplayPartsKey !== key) {
      this.animationDisplayParts = renderAnimationFrameDisplayParts(doc, cursor);
      this.animationDisplayPartsKey = key;
    }
    const parts = this.animationDisplayParts;
    if (!parts) return base;
    if (!this.animationFastDisplayBitmap
      || this.animationFastDisplayBitmap.width !== base.width
      || this.animationFastDisplayBitmap.height !== base.height) {
      this.animationFastDisplayBitmap = createBitmap(base.width, base.height);
    }
    const output = this.animationFastDisplayBitmap;
    const context = output.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, output.width, output.height);
    if (parts.ghosts) {
      context.drawImage(parts.ghosts, 0, 0, parts.ghosts.width, parts.ghosts.height, 0, 0, output.width, output.height);
    }
    const shown = parts.cel ?? base;
    context.drawImage(shown, 0, 0, shown.width, shown.height, 0, 0, output.width, output.height);
    return output;
  }

  private closeWorkerResultBitmap(): void {
    if (this.workerResultBitmap && 'close' in this.workerResultBitmap) {
      (this.workerResultBitmap as ImageBitmap).close();
    }
    this.workerResultBitmap = null;
  }

  getCssSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  setInputs(doc: ImageDocument | null, selection: SelectionMask | null): void {
    this.currentDoc = doc;
    this.currentSelection = selection;
    this.requestRender();
    if (selection) {
      this.startAntsLoop();
    } else {
      this.stopAntsLoop();
    }
  }

  requestRender(options: { invalidateBitmapCache?: boolean } = {}): void {
    if (options.invalidateBitmapCache) {
      this.workerDocSignature = null;
      this.closeWorkerResultBitmap();
      this.lowResDoc = null;
      this.clearAnimationDisplayCache();
    }
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.draw();
    });
  }

  private attachResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.syncSize()) this.requestRender();
    });
    this.resizeObserver.observe(this.wrapper);
  }

  private syncSize(): boolean {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const deviceWidth = Math.floor(cssWidth * dpr);
    const deviceHeight = Math.floor(cssHeight * dpr);
    if (
      cssWidth === this.cssWidth &&
      cssHeight === this.cssHeight &&
      deviceWidth === this.deviceWidth &&
      deviceHeight === this.deviceHeight
    ) {
      return false;
    }
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.deviceWidth = deviceWidth;
    this.deviceHeight = deviceHeight;
    this.canvas.width = deviceWidth;
    this.canvas.height = deviceHeight;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    return true;
  }

  private startAntsLoop(): void {
    if (this.antsRafId !== null) return;
    this.antsStart = performance.now();
    const tick = () => {
      this.antsRafId = requestAnimationFrame(tick);
      this.draw();
    };
    this.antsRafId = requestAnimationFrame(tick);
  }

  private stopAntsLoop(): void {
    this.invalidateAntsCache();
    if (this.antsRafId === null) return;
    cancelAnimationFrame(this.antsRafId);
    this.antsRafId = null;
  }

  private invalidateAntsCache(): void {
    this.antsCacheMask = null;
    this.antsTintCanvas = null;
    this.antsOutline = null;
  }

  private buildDocSignature(doc: ImageDocument): string {
    return JSON.stringify({
      width: doc.width,
      height: doc.height,
      layers: doc.layers.map(l => ({
        id: l.id,
        type: l.type,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        x: l.x,
        y: l.y,
        rotationDeg: l.rotationDeg,
        skewXDeg: l.skewXDeg,
        skewYDeg: l.skewYDeg,
        perspectiveX: l.perspectiveX,
        perspectiveY: l.perspectiveY,
        warp: l.warp,
        warpMesh: l.warpMesh,
        cornerOffsets: l.cornerOffsets,
        transformOriginX: l.transformOriginX,
        transformOriginY: l.transformOriginY,
        adjustment: l.adjustment,
        bitmapVersion: l.bitmapVersion,
        hasMask: Boolean(l.mask),
        maskLinkSourceLayerId: l.maskLinkSourceLayerId,
        maskDensity: l.maskDensity,
        maskFeather: l.maskFeather,
        effects: l.effects,
        filters: l.filters,
        clippingMask: l.clippingMask,
        groupId: l.groupId,
        groupExpanded: l.groupExpanded,
        groupPassThrough: l.groupPassThrough,
        vectorMask: getLayerVectorMaskMetadata(l),
      }))
    });
  }

  private prepareLowResDoc(doc: ImageDocument): void {
    const maxDim = Math.max(doc.width, doc.height);
    this.lowResScale = Math.min(1, 1024 / maxDim);

    if (this.lowResScale >= 1) {
      this.lowResDoc = doc;
      return;
    }

    const scaledWidth = Math.round(doc.width * this.lowResScale);
    const scaledHeight = Math.round(doc.height * this.lowResScale);

    // If it's already built for this doc structure (minus volatile adjustment values) we just update volatiles
    // A full re-downscale is only needed if bitmaps/structure changed.
    // For simplicity, we create a proxy doc on the fly.
    const layers = materializeImageLinkedMasks(doc.layers).map(layer => {
      let scaledBitmap = null;
      if (layer.bitmap && layer.type !== 'adjustment') {
        scaledBitmap = createBitmap(Math.max(1, Math.round(layer.bitmap.width * this.lowResScale)), Math.max(1, Math.round(layer.bitmap.height * this.lowResScale)));
        const sCtx = scaledBitmap.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(layer.bitmap, 0, 0, layer.bitmap.width, layer.bitmap.height, 0, 0, scaledBitmap.width, scaledBitmap.height);
        }
      }

      let scaledMask = null;
      if (layer.mask) {
        scaledMask = createBitmap(Math.max(1, Math.round(layer.mask.width * this.lowResScale)), Math.max(1, Math.round(layer.mask.height * this.lowResScale)));
        const sCtx = scaledMask.getContext('2d');
        if (sCtx) {
          sCtx.drawImage(layer.mask, 0, 0, layer.mask.width, layer.mask.height, 0, 0, scaledMask.width, scaledMask.height);
        }
      }

      const vectorMask = getLayerVectorMaskMetadata(layer);
      const scaledMetadata = vectorMask
        ? {
            ...layer.metadata,
            vectorMask: {
              ...vectorMask,
              path: {
                ...vectorMask.path,
                bounds: vectorMask.path.bounds
                  ? {
                      x: vectorMask.path.bounds.x * this.lowResScale,
                      y: vectorMask.path.bounds.y * this.lowResScale,
                      width: vectorMask.path.bounds.width * this.lowResScale,
                      height: vectorMask.path.bounds.height * this.lowResScale,
                    }
                  : null,
                points: vectorMask.path.points.map((point) => ({
                  x: point.x * this.lowResScale,
                  y: point.y * this.lowResScale,
                })),
              },
            },
          }
        : layer.metadata;

      return {
        ...layer,
        metadata: scaledMetadata,
        x: layer.x * this.lowResScale,
        y: layer.y * this.lowResScale,
        ...(layer.cornerOffsets ? {
          cornerOffsets: {
            nw: {
              x: layer.cornerOffsets.nw.x * this.lowResScale,
              y: layer.cornerOffsets.nw.y * this.lowResScale,
            },
            ne: {
              x: layer.cornerOffsets.ne.x * this.lowResScale,
              y: layer.cornerOffsets.ne.y * this.lowResScale,
            },
            se: {
              x: layer.cornerOffsets.se.x * this.lowResScale,
              y: layer.cornerOffsets.se.y * this.lowResScale,
            },
            sw: {
              x: layer.cornerOffsets.sw.x * this.lowResScale,
              y: layer.cornerOffsets.sw.y * this.lowResScale,
            },
          },
        } : {}),
        ...(layer.maskFeather !== undefined ? { maskFeather: layer.maskFeather * this.lowResScale } : {}),
        bitmap: scaledBitmap || layer.bitmap, // fallback to original if scaling failed or it's an adjustment
        mask: scaledMask || layer.mask,
      };
    });

    this.lowResDoc = {
      ...doc,
      width: scaledWidth,
      height: scaledHeight,
      layers,
    };
  }

  private async runHighResWorker(doc: ImageDocument): Promise<void> {
    const signature = this.buildDocSignature(doc);
    if (this.workerDocSignature === signature || this.isWorkerRunning) {
      return; // Already rendering or rendered this exact state
    }

    const nativeHighBit = isHighBitDocument(doc);
    let nativeLayers: ReturnType<typeof prepareNativeCompositeLayers> | undefined;
    if (nativeHighBit) {
      const memory = checkNativeWorkerMemoryAdmission(doc);
      if (!memory.admitted) {
        const refusal = new NativeCompositeRefusal('budget-exceeded', memory.reason ?? 'Native worker memory admission refused.');
        dispatchNativeRenderRefusal(refusal);
        this.closeWorkerResultBitmap();
        this.workerResultBitmap = createNativeRefusalDisplay(doc);
        this.workerDocSignature = signature;
        this.requestRender();
        return;
      }
      try {
        nativeLayers = prepareNativeCompositeLayers(doc);
      } catch {
        const result = renderNativeHighBitDocument(doc);
        if (result.refusal) dispatchNativeRenderRefusal(result.refusal);
        this.closeWorkerResultBitmap();
        this.workerResultBitmap = result.bitmap;
        this.workerDocSignature = signature;
        this.requestRender();
        return;
      }
    }

    if (!nativeHighBit && hasImageLayerGroupHierarchy(doc.layers)) {
      // The ordinary worker contract is intentionally flat and cannot preserve isolated or
      // pass-through folder semantics. Keep grouped 8-bit documents on the proven tree compositor
      // rather than letting a later worker result replace the correct synchronous preview.
      this.closeWorkerResultBitmap();
      this.workerResultBitmap = renderImageDocumentLayersToBitmap(doc);
      this.workerDocSignature = signature;
      this.requestRender();
      return;
    }

    if (
      typeof Worker === 'undefined'
      || typeof OffscreenCanvas === 'undefined'
      || typeof createImageBitmap === 'undefined'
      || this.workerFailureCount >= MAX_WORKER_FAILURES
    ) {
      // Synchronous fallback (also the permanent path once the worker has proven broken —
      // endless crash/retry churn is worse than main-thread compositing). This cache slot holds
      // PURE compositor bytes only; ghost/playback wrapping happens exclusively through
      // applyAnimationFrameDisplay in draw(), so toggling onion skin cannot leave stale ghosts here.
      this.closeWorkerResultBitmap();
      this.workerResultBitmap = renderDocumentForDisplay(doc);
      this.workerDocSignature = signature;
      this.requestRender();
      return;
    }

    this.isWorkerRunning = true;
    this.workerDocSignature = signature;

    if (!this.workerObj) {
      try {
        this.workerObj = createHighResWorker();
      } catch (error) {
        this.isWorkerRunning = false;
        this.workerDocSignature = null;
        this.workerFailureCount += 1;
        this.closeWorkerResultBitmap();
        this.requestRender();
        return Promise.reject(error);
      }
    }

    // Prepare transferable data
    const transferables: Transferable[] = [];

    // We map the doc's layers, rendering effects to flat bitmaps before sending
    const effectiveLayers = materializeImageLinkedMasks(doc.layers);
    const mappedLayers = nativeHighBit ? [] : await Promise.all(effectiveLayers.map(async layer => {
      if (!isImageLayerEffectivelyVisible(layer, effectiveLayers) || layer.type === 'group') return { visible: false };

      if (layer.type === 'adjustment') {
        let maskBitmap = null;
        if (layer.mask) {
          maskBitmap = await createImageBitmap(layer.mask);
          transferables.push(maskBitmap);
        }
        return {
          type: 'adjustment',
          visible: true,
          adjustment: layer.adjustment,
          opacity: layer.opacity,
          maskBitmap,
        };
      }

      // Normal layer
      const styled = layer.effects?.some((effect) => effect.enabled) || layer.filters?.some((filter) => filter.enabled)
        ? renderLayerWithEffects(layer)
        : null;

      const bitmapToTransfer = styled
        ? styled.bitmap
        : composeLayerBitmapWithLiveMasks(layer);

      let imageBitmap = null;
      if (bitmapToTransfer) {
        imageBitmap = await createImageBitmap(bitmapToTransfer);
        transferables.push(imageBitmap);
      }

        return {
          type: layer.type,
          visible: true,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          x: layer.x,
          y: layer.y,
          rotationDeg: layer.rotationDeg,
          skewXDeg: layer.skewXDeg,
          skewYDeg: layer.skewYDeg,
          perspectiveX: layer.perspectiveX,
          perspectiveY: layer.perspectiveY,
          warp: layer.warp,
          warpMesh: layer.warpMesh,
          cornerOffsets: layer.cornerOffsets,
          transformOriginX: layer.transformOriginX,
          transformOriginY: layer.transformOriginY,
          offsetX: styled?.offsetX || 0,
          offsetY: styled?.offsetY || 0,
          baseWidth: layer.bitmap?.width || imageBitmap?.width || 0,
          baseHeight: layer.bitmap?.height || imageBitmap?.height || 0,
          bitmap: imageBitmap,
        };
      }));

    return new Promise<void>((resolve, reject) => {
      if (!this.workerObj) {
        resolve();
        return;
      }
      this.workerObj.onmessage = (e) => {
        this.isWorkerRunning = false;
        const refusal = refusalFromWorkerEnvelope(e.data.refusal);
        if (refusal) {
          this.workerDocSignature = null;
          this.closeWorkerResultBitmap();
          dispatchNativeRenderRefusal(refusal);
          this.requestRender();
          resolve();
          return;
        }
        if (e.data.error) {
          this.workerDocSignature = null;
          this.workerFailureCount += 1;
          this.closeWorkerResultBitmap();
          this.requestRender();
          resolve();
          return;
        }
        // The doc may have changed (or the cache been invalidated) while the worker ran — a
        // result for a signature we no longer track must be dropped, never displayed.
        if (this.workerDocSignature !== signature) {
          (e.data.result as ImageBitmap | undefined)?.close?.();
          this.requestRender();
          resolve();
          return;
        }
        this.closeWorkerResultBitmap();
        this.workerResultBitmap = e.data.result;
        this.requestRender();
        resolve();
      };
      this.workerObj.onerror = (e) => {
        this.isWorkerRunning = false;
        // Un-poison the signature: leaving it set would advertise a render we never produced,
        // pinning the canvas to a stale (or blank) result until the next unrelated edit. The
        // draw loop's synchronous composite remains correct either way.
        this.workerDocSignature = null;
        this.closeWorkerResultBitmap();
        this.workerFailureCount += 1;
        this.requestRender();
        reject(e);
      };

      try {
        this.workerObj.postMessage({
          docWidth: doc.width,
          docHeight: doc.height,
          layers: mappedLayers,
          nativeLayers,
        }, transferables);
      } catch (error) {
        this.isWorkerRunning = false;
        this.workerDocSignature = null;
        this.workerFailureCount += 1;
        this.closeWorkerResultBitmap();
        this.requestRender();
        reject(error);
      }
    });
  }

  /**
   * Live-stroke composite: recomposite only the active layer + everything above it over a cached
   * backdrop of the layers below. Produces pixel-identical output to a full render (the backdrop
   * range + the live range together cover the whole stack), but skips recompositing the unchanged
   * layers below the one being painted — the common, expensive case when painting on an upper layer.
   */
  /** Paint tools call this with the doc-space region they touched so the next frame only
   * recomposites that region instead of the whole document. */
  markStrokeDirty(x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const right = x + width;
    const bottom = y + height;
    if (!this.strokeDirtyRect) {
      this.strokeDirtyRect = { x, y, width, height };
      return;
    }
    const r = this.strokeDirtyRect;
    const nx = Math.min(r.x, x);
    const ny = Math.min(r.y, y);
    r.width = Math.max(r.x + r.width, right) - nx;
    r.height = Math.max(r.y + r.height, bottom) - ny;
    r.x = nx;
    r.y = ny;
  }

  private consumeStrokeDirtyRect(
    docWidth: number,
    docHeight: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const r = this.strokeDirtyRect;
    this.strokeDirtyRect = null;
    if (!r) return null;
    const x = Math.max(0, Math.floor(r.x));
    const y = Math.max(0, Math.floor(r.y));
    const right = Math.min(docWidth, Math.ceil(r.x + r.width));
    const bottom = Math.min(docHeight, Math.ceil(r.y + r.height));
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
  }

  private compositeActiveAware(doc: ImageDocument): ImageBitmap | HTMLCanvasElement | LayerBitmap {
    // The stroke-range cache is deliberately flat. Once folders participate in composition,
    // using it would bypass isolated/pass-through folder semantics for the live preview. Fall
    // back to the same complete tree compositor used by export until the cache becomes tree-aware.
    if (doc.layers.some((layer) => layer.type === 'group')) {
      return renderDocumentForDisplay(doc);
    }
    const activeIndex = doc.activeLayerId
      ? doc.layers.findIndex((layer) => layer.id === doc.activeLayerId)
      : -1;
    if (activeIndex < 0) return renderDocumentForDisplay(doc);

    if (
      !this.strokeBackdrop ||
      this.strokeBackdropActiveId !== doc.activeLayerId ||
      !this.strokeBackdropLayersMatch(doc.layers, activeIndex)
    ) {
      this.rebuildStrokeBackdrop(doc, activeIndex);
    }

    const scratch = this.ensureStrokeCanvas('scratch', doc.width, doc.height);
    const ctx = scratch.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx || !this.strokeBackdrop) return renderDocumentForDisplay(doc);

    // Dirty-rect update: if the scratch already holds a current full composite and the paint tool
    // reported a touched region (and no layer at/above the active one has effects/adjustments that
    // bleed outside the dab), recomposite ONLY that region over the cached backdrop. Everything
    // outside it is retained from the previous frame. ~50-200x cheaper than a full recomposite.
    const dirty = this.consumeStrokeDirtyRect(doc.width, doc.height);
    const incremental =
      this.strokeProjectionValid && dirty !== null && rangeIsDirtyRectSafe(doc.layers, activeIndex);
    this.lastCompositeIncremental = incremental && dirty !== null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // The active layer's pixels/mask are changing live, so recompute its masked composite fresh
    // each frame; the cached backdrop already covers the (unchanged) layers below it.
    setLiveMaskBypassLayer(doc.activeLayerId);
    try {
      if (incremental && dirty) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(dirty.x, dirty.y, dirty.width, dirty.height);
        ctx.clip();
        ctx.clearRect(dirty.x, dirty.y, dirty.width, dirty.height);
        ctx.drawImage(this.strokeBackdrop, 0, 0);
        compositeLayerRangeInto(
          scratch,
          doc.layers,
          doc.width,
          doc.height,
          activeIndex,
          doc.layers.length,
          this.strokeBackdropState,
        );
        ctx.restore();
      } else {
        ctx.clearRect(0, 0, scratch.width, scratch.height);
        ctx.drawImage(this.strokeBackdrop, 0, 0);
        compositeLayerRangeInto(
          scratch,
          doc.layers,
          doc.width,
          doc.height,
          activeIndex,
          doc.layers.length,
          this.strokeBackdropState,
        );
        this.strokeProjectionValid = true;
      }
    } finally {
      setLiveMaskBypassLayer(null);
    }
    return scratch;
  }

  private rebuildStrokeBackdrop(doc: ImageDocument, activeIndex: number): void {
    const backdrop = this.ensureStrokeCanvas('backdrop', doc.width, doc.height);
    const ctx = backdrop.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, backdrop.width, backdrop.height);
    this.strokeBackdropState = compositeLayerRangeInto(
      backdrop,
      doc.layers,
      doc.width,
      doc.height,
      0,
      activeIndex,
      null,
    );
    this.strokeBackdropLayers = doc.layers.slice(0, activeIndex);
    this.strokeBackdropActiveId = doc.activeLayerId;
    // Backdrop changed → the scratch projection is stale; force a full recomposite next frame.
    this.strokeProjectionValid = false;
  }

  /**
   * The below-active backdrop cache is valid iff every layer object below the active one is the
   * same reference it was when cached. Zustand replaces a layer's object on any metadata change, and
   * below-layer bitmaps are not mutated in place during an active-layer stroke, so reference
   * equality is a correct, allocation-free validity check.
   */
  private strokeBackdropLayersMatch(layers: readonly ImageLayer[], activeIndex: number): boolean {
    const cached = this.strokeBackdropLayers;
    if (!cached || cached.length !== activeIndex) return false;
    for (let i = 0; i < activeIndex; i += 1) {
      if (cached[i] !== layers[i]) return false;
    }
    return true;
  }

  private ensureStrokeCanvas(which: 'backdrop' | 'scratch', width: number, height: number): LayerBitmap {
    const existing = which === 'backdrop' ? this.strokeBackdrop : this.strokeScratch;
    if (existing && existing.width === width && existing.height === height) return existing;
    const canvas = createBitmap(width, height);
    if (which === 'backdrop') this.strokeBackdrop = canvas;
    else this.strokeScratch = canvas;
    return canvas;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.deviceWidth, this.deviceHeight);
    ctx.fillStyle = '#0f1018';
    ctx.fillRect(0, 0, this.deviceWidth, this.deviceHeight);
    ctx.restore();

    const doc = this.currentDoc;
    if (!doc) return;

    // Snap the document to a whole-device-pixel rect before drawing the
    // checkerboard + composited pixels. At fractional zoom / DPR an unsnapped
    // document antialiases its top and bottom edges against the dark checker
    // backdrop, which reads as a thin transparency strip — the canvas looking
    // larger than the image. Drawing into an integer device rect keeps all four
    // edges crisp. Selection/mask overlays are drawn afterwards in document
    // space anchored to the same snapped origin.
    const dpr = this.dpr;
    const zoom = doc.viewport.zoom;
    const x0 = Math.round(doc.viewport.panX * dpr);
    const y0 = Math.round(doc.viewport.panY * dpr);
    const x1 = Math.round((doc.viewport.panX + doc.width * zoom) * dpr);
    const y1 = Math.round((doc.viewport.panY + doc.height * zoom) * dpr);
    const dw = Math.max(1, x1 - x0);
    const dh = Math.max(1, y1 - y0);
    const viewRotation = buildViewRotationTransform(
      doc.viewport,
      dpr,
      { width: this.deviceWidth / dpr, height: this.deviceHeight / dpr },
    );
    const viewRotated = viewRotation.radians !== 0;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (viewRotated) {
      ctx.translate(viewRotation.pivotX, viewRotation.pivotY);
      ctx.rotate(viewRotation.radians);
      ctx.translate(-viewRotation.pivotX, -viewRotation.pivotY);
    }
    drawTransparencyCheckerboard(ctx, x0, y0, dw, dh, 16 * zoom * dpr);

    const store = useImageEditorStore.getState();
    const perfCompositeStart = performance.now();
    let composite: ImageBitmap | HTMLCanvasElement | LayerBitmap | null = null;
    if (store.isDraggingSlider) {
      if (!this.lowResDoc) {
        this.prepareLowResDoc(doc);
      } else {
        // Sync volatile properties from doc to lowResDoc
        const updatedLayers = this.lowResDoc.layers.map((lowLayer, idx) => {
          const highLayer = doc.layers[idx];
          if (!highLayer) return lowLayer;
          return {
            ...lowLayer,
            visible: highLayer.visible,
            opacity: highLayer.opacity,
            adjustment: highLayer.adjustment,
          };
        });
        this.lowResDoc = { ...this.lowResDoc, layers: updatedLayers };
      }
      composite = this.lowResDoc ? renderDocumentForDisplay(this.lowResDoc) : null;
      if (composite) {
        composite = this.applyAnimationFrameFastPath(composite, doc, store.animationPlayback ?? null);
      }
    } else if (store.isPaintingStroke) {
      // Live brush/eraser/retouch stroke: composite the active layer + everything above it over a
      // cached backdrop of the layers below, reflecting the in-place bitmap mutation every frame.
      // Don't run the off-thread worker here — it would re-snapshot every layer per frame, and the
      // committed full-quality render happens on pointer-up (see dispatcher onUp).
      this.lowResDoc = null;
      // First frame of a new stroke: force a full composite so the dirty-rect projection starts
      // from a correct, complete scratch before incremental dab updates take over.
      if (!this.wasPaintingStroke) {
        this.strokeProjectionValid = false;
        this.wasPaintingStroke = true;
      }
      composite = this.compositeActiveAware(doc);
      composite = this.applyAnimationFrameFastPath(composite, doc, store.animationPlayback ?? null);
    } else {
      this.wasPaintingStroke = false;
      this.lowResDoc = null;
      // Rebuild fast-path ghost/cel parts after a stroke so the next live session sees fresh
      // pixels, while retaining them across the pointer events within the current session.
      this.animationDisplayPartsKey = null;
      this.animationDisplayParts = null;
      this.animationFastDisplayBitmap = null;
      const animationCursor = store.animationPlayback ?? null;
      const displayPlan = planAnimationFrameDisplay(doc, animationCursor);
      const signature = this.buildDocSignature(doc);
      if (this.workerDocSignature === signature && this.workerResultBitmap) {
        composite = this.workerResultBitmap;
      } else {
        // Fallback to sync render while worker processes, or start worker. While playback owns
        // the view the displayed pixels get rebased onto the played cel below anyway, so skip
        // pointless off-thread churn instead of re-snapshotting layers behind the timer's back.
        composite = renderDocumentForDisplay(doc);
        if (!animationCursor) this.runHighResWorker(doc).catch(console.error);
      }
      if (displayPlan && composite) {
        composite = this.applyAnimationFrameDisplay(composite, doc, animationCursor);
      }
    }
    const perfBlitStart = performance.now();
    if (composite) {
      ctx.imageSmoothingEnabled = true;
      // Blit only the on-canvas portion of the document. Drawing the entire composite into the full
      // (x0,y0,dw,dh) rect means a destination far larger than the canvas at high zoom (dw ≈
      // docWidth × zoom × DPR). On a real GPU compositor surface (Electron / native Wayland, worst
      // at HiDPI) that oversized scaled drawImage can be dropped entirely, leaving only the
      // checkerboard (a plain fillRect, which the GPU clips fine) — i.e. the image "disappears"
      // on zoom-in. Clamping source + destination to the visible region keeps the draw on-canvas
      // and is also cheaper. Identical visible pixels when the document fully fits.
      //
      // Under view rotation the axis-aligned visible-region clamp is wrong (the visible region is
      // itself rotated), so the rotated path intentionally draws the full document rect and lets
      // the compositor clip it. View rotation is a drawing-comfort feature used at working zooms,
      // not a 64x pixel-peeping mode; upright views keep the clamped fast path.
      if (viewRotated) {
        ctx.drawImage(composite, 0, 0, composite.width, composite.height, x0, y0, dw, dh);
      } else {
        const blit = computeVisibleDocumentBlit(x0, y0, dw, dh, composite.width, composite.height, this.deviceWidth, this.deviceHeight);
        if (blit) {
          ctx.drawImage(composite, blit.sx, blit.sy, blit.sw, blit.sh, blit.dx, blit.dy, blit.dw, blit.dh);
        }
      }
    }
    ctx.restore();
    const perfOverlayStart = performance.now();

    ctx.save();
    ctx.scale(dpr, dpr);
    if (viewRotated) {
      ctx.translate(viewRotation.pivotX / dpr, viewRotation.pivotY / dpr);
      ctx.rotate(viewRotation.radians);
      ctx.translate(-viewRotation.pivotX / dpr, -viewRotation.pivotY / dpr);
    }
    ctx.translate(x0 / dpr, y0 / dpr);
    ctx.scale(zoom, zoom);

    const { quickMaskSettings, selectAndMaskSettings, imageViewSettings } = useImageEditorStore.getState();
    this.drawDocumentGridAndGuides(doc, imageViewSettings, zoom);
    const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null;
    if (selectAndMaskSettings.enabled && this.currentSelection) {
      this.drawSelectAndMaskPreview(
        buildSelectAndMaskPreviewMask(this.currentSelection, selectAndMaskSettings),
        doc.width,
        doc.height,
        selectAndMaskSettings.previewMode,
      );
    } else if (!quickMaskSettings.enabled && doc.activeLayerEditTarget === 'mask' && activeLayer?.mask) {
      this.drawActiveLayerMaskOverlay(activeLayer, doc.width, doc.height);
    } else if (quickMaskSettings.enabled && doc) {
      this.drawQuickMaskOverlay(
        this.currentSelection,
        doc.width,
        doc.height,
        quickMaskSettings.viewMode,
        quickMaskSettings.overlayOpacity,
      );
    } else if (this.currentSelection) {
      this.drawSelectionAnts(this.currentSelection);
    }

    ctx.restore();

    const cropSettings = useImageEditorStore.getState().cropToolSettings;
    const cropMode = cropSettings.mode ?? 'rectangular';
    const cropPreview = cropMode === 'rectangular' ? getCropPreview(doc) : null;
    if (cropPreview) {
      const guideMode = cropSettings.guideMode;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      if (viewRotated) {
        ctx.translate(viewRotation.pivotX / this.dpr, viewRotation.pivotY / this.dpr);
        ctx.rotate(viewRotation.radians);
        ctx.translate(-viewRotation.pivotX / this.dpr, -viewRotation.pivotY / this.dpr);
      }
      drawCropPreviewOverlay(ctx, {
        canvasSize: {
          width: this.canvas.width / this.dpr,
          height: this.canvas.height / this.dpr,
        },
        guideMode,
        preview: cropPreview,
        viewport: doc.viewport,
      });
      ctx.restore();
    }

    const perspectiveQuad = cropMode === 'perspective' ? getPerspectiveCropPreview(doc) : null;
    if (perspectiveQuad) {
      const guideMode = cropSettings.guideMode;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      drawPerspectiveCropPreviewOverlay(ctx, {
        canvasSize: {
          width: this.canvas.width / this.dpr,
          height: this.canvas.height / this.dpr,
        },
        guideMode,
        quad: perspectiveQuad,
        valid: isPerspectiveCropQuadValid(perspectiveQuad),
        view: {
          width: this.canvas.width / this.dpr,
          height: this.canvas.height / this.dpr,
        },
        viewport: doc.viewport,
      });
      ctx.restore();
    }

    recordStrokeDraw(
      perfBlitStart - perfCompositeStart,
      perfOverlayStart - perfBlitStart,
      performance.now() - perfOverlayStart,
      this.lastCompositeIncremental,
    );
  }

  private drawDocumentGridAndGuides(doc: ImageDocument, settings: ImageViewSettings, zoom: number): void {
    const ctx = this.ctx;
    const lineWidth = 1 / Math.max(zoom, 0.0001);
    if (settings.grid) {
      const { xs, ys } = generateGridLines(doc.width, doc.height, settings.gridSpacing);
      ctx.save();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = 'rgba(120,165,230,0.45)';
      ctx.beginPath();
      for (const x of xs) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, doc.height);
      }
      for (const y of ys) {
        ctx.moveTo(0, y);
        ctx.lineTo(doc.width, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (settings.guides && doc.guides && doc.guides.length > 0) {
      ctx.save();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = 'rgba(0,200,255,0.9)';
      ctx.beginPath();
      for (const guide of doc.guides) {
        if (guide.axis === 'x') {
          ctx.moveTo(guide.position, 0);
          ctx.lineTo(guide.position, doc.height);
        } else {
          ctx.moveTo(0, guide.position);
          ctx.lineTo(doc.width, guide.position);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawSelectionAnts(mask: SelectionMask): void {
    // Rebuild the expensive O(W*H) tint raster + per-pixel outline only when the mask object
    // changes; the per-frame animation below reuses the cache and only moves the dash offset.
    if (this.antsCacheMask !== mask) {
      this.antsTintCanvas = maskToCanvas(mask, 60, 220, 240);
      this.antsOutline = computeMaskOutline(mask);
      this.antsCacheMask = mask;
    }
    const elapsed = performance.now() - this.antsStart;
    const phase = (elapsed / ANTS_PERIOD_MS) * (ANTS_DASH_LENGTH * 2);
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1 / Math.max(this.currentDoc?.viewport.zoom ?? 1, 0.01);

    ctx.globalAlpha = 0.4;
    if (this.antsTintCanvas) ctx.drawImage(this.antsTintCanvas, 0, 0);
    ctx.globalAlpha = 1;

    const outline = this.antsOutline;
    if (outline && outline.length > 0) {
      ctx.lineWidth = 1 / Math.max(this.currentDoc?.viewport.zoom ?? 1, 0.01);
      ctx.setLineDash([ANTS_DASH_LENGTH, ANTS_DASH_LENGTH]);
      ctx.lineDashOffset = -phase;
      ctx.strokeStyle = '#000000';
      tracePaths(ctx, outline);
      ctx.lineDashOffset = -phase + ANTS_DASH_LENGTH;
      ctx.strokeStyle = '#ffffff';
      tracePaths(ctx, outline);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  private drawQuickMaskOverlay(
    selection: SelectionMask | null,
    width: number,
    height: number,
    viewMode: 'maskedAreas' | 'selectedAreas',
    overlayOpacity: number,
  ): void {
    const ctx = this.ctx;
    const overlay = createQuickMaskOverlayMask(selection, width, height, viewMode);
    ctx.save();
    ctx.globalAlpha = Math.max(0.1, Math.min(0.9, overlayOpacity));
    ctx.drawImage(maskToCanvas(overlay, 255, 0, 0), 0, 0);
    ctx.restore();
  }

  private drawSelectAndMaskPreview(
    selection: SelectionMask,
    width: number,
    height: number,
    previewMode: 'maskedAreas' | 'selectedAreas' | 'onBlack' | 'onWhite' | 'blackWhite',
  ): void {
    const ctx = this.ctx;

    if (previewMode === 'blackWhite') {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(maskToCanvas(selection, 255, 255, 255), 0, 0);
      ctx.restore();
      return;
    }

    const matte = createSelectAndMaskMatteMask(selection, width, height, previewMode);
    ctx.save();
    if (previewMode === 'onBlack') {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(maskToCanvas(matte, 0, 0, 0), 0, 0);
    } else if (previewMode === 'onWhite') {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(maskToCanvas(matte, 255, 255, 255), 0, 0);
    } else {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(maskToCanvas(matte, 255, 0, 0), 0, 0);
    }
    ctx.restore();
  }

  private drawActiveLayerMaskOverlay(
    layer: Pick<ImageLayer, 'x' | 'y' | 'mask' | 'maskDensity' | 'maskFeather'>,
    width: number,
    height: number,
  ): void {
    const ctx = this.ctx;
    const overlay = createLayerMaskOverlayMask(layer, width, height);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(maskToCanvas(overlay, 255, 0, 0), 0, 0);
    ctx.restore();
  }
}

function getLayerVectorMaskMetadata(layer: ImageLayer) {
  return (layer as ImageLayerWithVectorMask).metadata?.vectorMask ?? null;
}

// Cached 2x2-tile checker bitmap, keyed by device tile size. Rebuilt only when the
// zoom/dpr-derived tile size changes — NOT per frame.
let checkerTileCache: { step: number; canvas: LayerBitmap } | null = null;

function getCheckerTile(step: number): LayerBitmap {
  const size = Math.max(1, Math.round(step));
  if (checkerTileCache && checkerTileCache.step === size) return checkerTileCache.canvas;
  const canvas = createBitmap(size * 2, size * 2);
  const tctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (tctx) {
    tctx.fillStyle = '#1a1b23';
    tctx.fillRect(0, 0, size * 2, size * 2);
    tctx.fillStyle = '#222637';
    // (i+j) even tiles get the lighter colour → light squares at (0,0) and (1,1).
    tctx.fillRect(0, 0, size, size);
    tctx.fillRect(size, size, size, size);
  }
  checkerTileCache = { step: size, canvas };
  return canvas;
}

function drawTransparencyCheckerboard(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  width: number,
  height: number,
  tile: number,
): void {
  // Drawn in device space within the document's snapped integer rect. The checker used
  // to be a nested fillRect loop — tens of thousands of fillRects per frame at 4K/DPR,
  // re-run every frame even though it never changes and is painted over by an opaque
  // image. Now it's a cached tile stamped as a repeating pattern: one fillRect.
  const step = Math.max(1, tile);
  const pattern = ctx.createPattern(getCheckerTile(step), 'repeat');
  ctx.save();
  if (pattern) {
    // Translate so the pattern's tile boundary aligns to the document origin (tracks pan).
    ctx.translate(originX, originY);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#1a1b23';
    ctx.fillRect(originX, originY, width, height);
  }
  ctx.restore();
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function computeMaskOutline(mask: SelectionMask): Edge[] {
  const out: Edge[] = [];
  const { width, height, data } = mask;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = data[y * width + x] > 127;
      if (!inside) continue;
      // top
      if (y === 0 || data[(y - 1) * width + x] <= 127) {
        out.push({ x0: x, y0: y, x1: x + 1, y1: y });
      }
      // bottom
      if (y === height - 1 || data[(y + 1) * width + x] <= 127) {
        out.push({ x0: x, y0: y + 1, x1: x + 1, y1: y + 1 });
      }
      // left
      if (x === 0 || data[y * width + (x - 1)] <= 127) {
        out.push({ x0: x, y0: y, x1: x, y1: y + 1 });
      }
      // right
      if (x === width - 1 || data[y * width + (x + 1)] <= 127) {
        out.push({ x0: x + 1, y0: y, x1: x + 1, y1: y + 1 });
      }
    }
  }
  return out;
}

function tracePaths(ctx: CanvasRenderingContext2D, edges: Edge[]): void {
  ctx.beginPath();
  for (const edge of edges) {
    ctx.moveTo(edge.x0, edge.y0);
    ctx.lineTo(edge.x1, edge.y1);
  }
  ctx.stroke();
}
