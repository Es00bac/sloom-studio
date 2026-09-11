import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createBitmap, getBitmapImageData } from './LayerBitmap';
import {
  clampImageLayerMaskDensity,
  clampImageLayerMaskFeather,
  composeLayerBitmapWithMask,
  getUnsupportedImageLayerMaskWorkflowWarnings,
  resolveImageLayerMaskSettings,
  type ImageLayerMaskWorkflowSupportRequest,
  type ImageLayerMaskWorkflowWarningCode,
} from './ImageLayerMask';
import type { SelectionMask } from './SelectionMask';

export type LayerSelectionMaskMode = 'reveal-selection' | 'hide-selection';
export type LayerMaskOperationKind =
  | 'reveal-all'
  | 'hide-all'
  | 'from-selection'
  | 'invert'
  | 'apply'
  | 'delete'
  | 'density'
  | 'feather';

export type LayerMaskOperationSource =
  | 'constant'
  | 'selection'
  | 'existing-mask'
  | 'mask-settings'
  | 'none';

export type LayerMaskOperationOutput =
  | 'layer-mask'
  | 'layer-bitmap'
  | 'mask-settings'
  | 'none';

export type LayerMaskOperationMutation =
  | 'replace-mask'
  | 'update-mask'
  | 'remove-mask'
  | 'bake-mask'
  | 'update-mask-settings';

export type LayerMaskOperationWarningCode =
  | 'selection-required'
  | 'mask-required'
  | 'bitmap-required'
  | 'mask-target-ignored-for-pixel-operation'
  | 'pixel-target-ignored-for-mask-operation'
  | ImageLayerMaskWorkflowWarningCode;

export interface LayerMaskOperationWarning {
  code: LayerMaskOperationWarningCode;
  severity: 'warning';
  message: string;
}

export interface LayerMaskOperationDescriptor {
  kind: LayerMaskOperationKind;
  label: string;
  source: LayerMaskOperationSource;
  output: LayerMaskOperationOutput;
  mutation: LayerMaskOperationMutation;
  requiresSelection: boolean;
  requiresMask: boolean;
  requiresBitmap: boolean;
  destructive: boolean;
  undoable: boolean;
  supportsPreview: boolean;
}

export type LayerMaskOperationPreviewTarget =
  | 'mask-alpha'
  | 'mask-settings'
  | 'pixel-alpha'
  | 'none';

export interface LayerMaskOperationPreviewMetadata {
  target: LayerMaskOperationPreviewTarget;
  changesPixels: boolean;
  changesMaskPixels: boolean;
  changesMaskSettings: boolean;
}

export interface LayerMaskOperationSignature {
  kind: LayerMaskOperationKind;
  label: string;
  source: LayerMaskOperationSource;
  output: LayerMaskOperationOutput;
  mutation: LayerMaskOperationMutation;
  requirements: {
    selection: boolean;
    mask: boolean;
    bitmap: boolean;
  };
  behavior: {
    destructive: boolean;
    undoable: boolean;
    supportsPreview: boolean;
  };
  readiness: LayerMaskOperationReadinessDescriptor;
  previewMetadata: LayerMaskOperationPreviewMetadata;
}

export type LayerMaskOperationReadinessState =
  | 'ready'
  | 'ready-destructive'
  | 'blocked';

export type LayerMaskOperationAction = 'apply' | 'delete' | 'rasterize' | 'adjust' | 'create';

export interface LayerMaskOperationReadinessDescriptor {
  readinessId: string;
  action: LayerMaskOperationAction;
  stateWhenRequirementsMet: Exclude<LayerMaskOperationReadinessState, 'blocked'>;
  requiresRasterTarget: boolean;
  exportCaveat: string;
}

export interface LayerMaskOperationSelectionSummary {
  present: boolean;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  alphaRange: { min: number; max: number } | null;
}

export interface LayerMaskOperationSettingsSummary {
  density: number;
  feather: number;
  selectionMode?: LayerSelectionMaskMode;
}

export interface LayerMaskOperationPlanOptions {
  selection?: SelectionMask | null;
  selectionMode?: LayerSelectionMaskMode;
  density?: number;
  feather?: number;
  workflows?: ImageLayerMaskWorkflowSupportRequest;
  editTarget?: 'mask' | 'pixels';
}

export interface LayerMaskOperationPlanPreview extends LayerMaskOperationPreviewMetadata {
  id: string;
  signature: string;
  summary: string;
  reversiblePreview: boolean;
}

export interface LayerMaskOperationSettingsApplicationEntry {
  value: number;
  appliesTo: Array<'mask-preview' | 'mask-bake' | 'export-flattening'>;
  nonDestructive: boolean;
  previewCaveat: string;
}

export interface LayerMaskOperationSettingsApplicationSummary {
  density: LayerMaskOperationSettingsApplicationEntry;
  feather: LayerMaskOperationSettingsApplicationEntry;
}

export interface LayerMaskOperationPlanReadiness {
  readinessId: string;
  state: LayerMaskOperationReadinessState;
  action: LayerMaskOperationAction;
  blockingWarningCodes: LayerMaskOperationWarningCode[];
  requiresRasterTarget: boolean;
  exportCaveat: string;
}

export interface LayerMaskOperationPlan {
  kind: LayerMaskOperationKind;
  layerId: string;
  descriptor: LayerMaskOperationDescriptor;
  canRun: boolean;
  hasBitmap: boolean;
  hasMask: boolean;
  maskSize: { width: number; height: number };
  selection: LayerMaskOperationSelectionSummary;
  settings: LayerMaskOperationSettingsSummary;
  warnings: LayerMaskOperationWarning[];
  previewSignature: string;
  preview: LayerMaskOperationPlanPreview;
  readiness: LayerMaskOperationPlanReadiness;
  settingsApplication: LayerMaskOperationSettingsApplicationSummary;
}

export const LAYER_MASK_OPERATION_DESCRIPTORS: readonly LayerMaskOperationDescriptor[] = [
  {
    kind: 'reveal-all',
    label: 'Reveal All',
    source: 'constant',
    output: 'layer-mask',
    mutation: 'replace-mask',
    requiresSelection: false,
    requiresMask: false,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'hide-all',
    label: 'Hide All',
    source: 'constant',
    output: 'layer-mask',
    mutation: 'replace-mask',
    requiresSelection: false,
    requiresMask: false,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'from-selection',
    label: 'Mask From Selection',
    source: 'selection',
    output: 'layer-mask',
    mutation: 'replace-mask',
    requiresSelection: true,
    requiresMask: false,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'invert',
    label: 'Invert Layer Mask',
    source: 'existing-mask',
    output: 'layer-mask',
    mutation: 'update-mask',
    requiresSelection: false,
    requiresMask: true,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'apply',
    label: 'Apply Layer Mask',
    source: 'existing-mask',
    output: 'layer-bitmap',
    mutation: 'bake-mask',
    requiresSelection: false,
    requiresMask: true,
    requiresBitmap: true,
    destructive: true,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'delete',
    label: 'Delete Layer Mask',
    source: 'existing-mask',
    output: 'none',
    mutation: 'remove-mask',
    requiresSelection: false,
    requiresMask: true,
    requiresBitmap: false,
    destructive: true,
    undoable: true,
    supportsPreview: false,
  },
  {
    kind: 'density',
    label: 'Mask Density',
    source: 'mask-settings',
    output: 'mask-settings',
    mutation: 'update-mask-settings',
    requiresSelection: false,
    requiresMask: true,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
  {
    kind: 'feather',
    label: 'Mask Feather',
    source: 'mask-settings',
    output: 'mask-settings',
    mutation: 'update-mask-settings',
    requiresSelection: false,
    requiresMask: true,
    requiresBitmap: false,
    destructive: false,
    undoable: true,
    supportsPreview: true,
  },
];

const LAYER_MASK_OPERATION_DESCRIPTOR_BY_KIND = new Map(
  LAYER_MASK_OPERATION_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]),
);

export function getLayerMaskOperationDescriptor(kind: LayerMaskOperationKind): LayerMaskOperationDescriptor {
  const descriptor = LAYER_MASK_OPERATION_DESCRIPTOR_BY_KIND.get(kind);
  if (!descriptor) {
    throw new Error(`Unsupported layer mask operation: ${kind}`);
  }
  return descriptor;
}

export function buildLayerMaskOperationSignature(
  descriptor: LayerMaskOperationDescriptor,
): LayerMaskOperationSignature {
  return {
    kind: descriptor.kind,
    label: descriptor.label,
    source: descriptor.source,
    output: descriptor.output,
    mutation: descriptor.mutation,
    requirements: {
      selection: descriptor.requiresSelection,
      mask: descriptor.requiresMask,
      bitmap: descriptor.requiresBitmap,
    },
    behavior: {
      destructive: descriptor.destructive,
      undoable: descriptor.undoable,
      supportsPreview: descriptor.supportsPreview,
    },
    readiness: getLayerMaskOperationReadinessDescriptor(descriptor.kind),
    previewMetadata: getLayerMaskOperationPreviewMetadata(descriptor.kind),
  };
}

export function getLayerMaskOperationSignatures(): LayerMaskOperationSignature[] {
  return LAYER_MASK_OPERATION_DESCRIPTORS.map(buildLayerMaskOperationSignature);
}

export function planLayerMaskOperation(
  doc: ImageDocument,
  layer: ImageLayer,
  kind: LayerMaskOperationKind,
  options: LayerMaskOperationPlanOptions = {},
): LayerMaskOperationPlan {
  const descriptor = getLayerMaskOperationDescriptor(kind);
  const maskSize = resolveMaskSize(doc, layer);
  const selection = summarizeSelection(options.selection ?? null);
  const currentSettings = resolveImageLayerMaskSettings(layer);
  const settings: LayerMaskOperationSettingsSummary = {
    density: clampImageLayerMaskDensity(options.density ?? currentSettings.density),
    feather: clampImageLayerMaskFeather(options.feather ?? currentSettings.feather),
  };

  if (kind === 'from-selection') {
    settings.selectionMode = options.selectionMode ?? 'reveal-selection';
  }

  const warnings: LayerMaskOperationWarning[] = [];
  if (descriptor.requiresSelection && !selection.present) {
    warnings.push({
      code: 'selection-required',
      severity: 'warning',
      message: 'Layer-mask operation requires an active selection.',
    });
  }
  if (descriptor.requiresMask && !layer.mask) {
    warnings.push({
      code: 'mask-required',
      severity: 'warning',
      message: 'Layer-mask operation requires an existing layer mask.',
    });
  }
  if (descriptor.requiresBitmap && !layer.bitmap) {
    warnings.push({
      code: 'bitmap-required',
      severity: 'warning',
      message: 'Applying a layer mask requires editable layer bitmap pixels.',
    });
  }
  const previewMetadata = getLayerMaskOperationPreviewMetadata(kind);
  if (options.editTarget === 'mask' && previewMetadata.changesPixels) {
    warnings.push({
      code: 'mask-target-ignored-for-pixel-operation',
      severity: 'warning',
      message: 'This layer-mask operation bakes into layer pixels even when mask editing is targeted.',
    });
  }
  if (
    options.editTarget === 'pixels'
    && (previewMetadata.changesMaskPixels || previewMetadata.changesMaskSettings)
  ) {
    warnings.push({
      code: 'pixel-target-ignored-for-mask-operation',
      severity: 'warning',
      message: 'This layer-mask operation changes the mask, not the layer pixel target.',
    });
  }
  warnings.push(...getUnsupportedImageLayerMaskWorkflowWarnings(options.workflows));

  const hasBlockingWarning = warnings.some((warning) => (
    warning.code === 'selection-required'
    || warning.code === 'mask-required'
    || warning.code === 'bitmap-required'
  ));
  const blockingWarningCodes = warnings
    .filter((warning) => (
      warning.code === 'selection-required'
      || warning.code === 'mask-required'
      || warning.code === 'bitmap-required'
    ))
    .map((warning) => warning.code);

  const plan: Omit<LayerMaskOperationPlan, 'previewSignature' | 'preview' | 'readiness' | 'settingsApplication'> = {
    kind,
    layerId: layer.id,
    descriptor,
    canRun: !hasBlockingWarning,
    hasBitmap: Boolean(layer.bitmap),
    hasMask: Boolean(layer.mask),
    maskSize,
    selection,
    settings,
    warnings,
  };
  const previewSignature = buildLayerMaskOperationPreviewSignature(plan);

  return {
    ...plan,
    previewSignature,
    preview: {
      id: `layer-mask-op-preview:${kind}:${layer.id}`,
      signature: previewSignature,
      summary: buildLayerMaskOperationPreviewSummary(descriptor, settings),
      ...previewMetadata,
      reversiblePreview: descriptor.supportsPreview && descriptor.undoable,
    },
    readiness: buildLayerMaskOperationPlanReadiness(kind, layer.id, blockingWarningCodes),
    settingsApplication: buildLayerMaskOperationSettingsApplication(settings),
  };
}

export function createLayerMaskFromSelection(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
  mode: LayerSelectionMaskMode = 'reveal-selection',
): LayerBitmap {
  const { width, height } = resolveMaskSize(doc, layer);
  return createMaskBitmap(width, height, (x, y) => {
    const docX = Math.round(layer.x + x);
    const docY = Math.round(layer.y + y);
    const selectionAlpha =
      docX >= 0 && docY >= 0 && docX < selection.width && docY < selection.height
        ? selection.data[docY * selection.width + docX]
        : 0;
    return mode === 'hide-selection' ? 255 - selectionAlpha : selectionAlpha;
  });
}

export function createRevealAllLayerMask(
  doc: ImageDocument,
  layer: ImageLayer,
): LayerBitmap {
  const { width, height } = resolveMaskSize(doc, layer);
  return createMaskBitmap(width, height, () => 255);
}

export function createHideAllLayerMask(
  doc: ImageDocument,
  layer: ImageLayer,
): LayerBitmap {
  const { width, height } = resolveMaskSize(doc, layer);
  return createMaskBitmap(width, height, () => 0);
}

export function invertLayerMask(mask: LayerBitmap): LayerBitmap {
  const source = getBitmapImageData(mask);
  return createMaskBitmap(mask.width, mask.height, (x, y) => {
    const alpha = source.data[(y * mask.width + x) * 4 + 3] ?? 0;
    return 255 - alpha;
  });
}

export function applyLayerMaskToLayer(layer: ImageLayer): ImageLayer {
  if (!layer.bitmap || !layer.mask) {
    return { ...layer, mask: null };
  }

  const applied = composeLayerBitmapWithMask(layer) ?? createBitmap(layer.bitmap.width, layer.bitmap.height);
  return {
    ...layer,
    bitmap: applied,
    bitmapVersion: layer.bitmapVersion + 1,
    mask: null,
  };
}

function resolveMaskSize(
  doc: ImageDocument,
  layer: ImageLayer,
): { width: number; height: number } {
  return {
    width: layer.bitmap?.width ?? doc.width,
    height: layer.bitmap?.height ?? doc.height,
  };
}

function createMaskBitmap(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
): LayerBitmap {
  const bitmap = createBitmap(width, height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for layer mask');
  const imageData = ctx.createImageData(bitmap.width, bitmap.height);

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = (y * bitmap.width + x) * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = clampByte(alphaAt(x, y));
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return bitmap;
}

function summarizeSelection(selection: SelectionMask | null): LayerMaskOperationSelectionSummary {
  if (!selection) {
    return {
      present: false,
      width: 0,
      height: 0,
      bounds: null,
      alphaRange: null,
    };
  }

  let minX = selection.width;
  let minY = selection.height;
  let maxX = -1;
  let maxY = -1;
  let minAlpha = 255;
  let maxAlpha = 0;

  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      const alpha = selection.data[y * selection.width + x] ?? 0;
      minAlpha = Math.min(minAlpha, alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha <= 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const hasActivePixels = maxX >= minX && maxY >= minY;
  return {
    present: hasActivePixels,
    width: selection.width,
    height: selection.height,
    bounds: hasActivePixels
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : null,
    alphaRange: { min: minAlpha, max: maxAlpha },
  };
}

function buildLayerMaskOperationPreviewSignature(
  plan: Omit<LayerMaskOperationPlan, 'previewSignature' | 'preview' | 'readiness' | 'settingsApplication'>,
): string {
  return `layer-mask-op:v1:${JSON.stringify({
    kind: plan.kind,
    layerId: plan.layerId,
    maskSize: plan.maskSize,
    hasBitmap: plan.hasBitmap,
    hasMask: plan.hasMask,
    settings: plan.settings,
    selection: plan.selection,
    warnings: plan.warnings.map((warning) => warning.code),
  })}`;
}

function getLayerMaskOperationPreviewMetadata(
  kind: LayerMaskOperationKind,
): LayerMaskOperationPreviewMetadata {
  if (kind === 'apply') {
    return {
      target: 'pixel-alpha',
      changesPixels: true,
      changesMaskPixels: false,
      changesMaskSettings: false,
    };
  }
  if (kind === 'density' || kind === 'feather') {
    return {
      target: 'mask-settings',
      changesPixels: false,
      changesMaskPixels: false,
      changesMaskSettings: true,
    };
  }
  if (kind === 'delete') {
    return {
      target: 'none',
      changesPixels: false,
      changesMaskPixels: false,
      changesMaskSettings: false,
    };
  }
  return {
    target: 'mask-alpha',
    changesPixels: false,
    changesMaskPixels: true,
    changesMaskSettings: false,
  };
}

function buildLayerMaskOperationPreviewSummary(
  descriptor: LayerMaskOperationDescriptor,
  settings: LayerMaskOperationSettingsSummary,
): string {
  if (descriptor.kind === 'apply') {
    return 'Apply Layer Mask previews bitmap alpha baking with current density/feather mask metadata.';
  }
  if (descriptor.kind === 'from-selection') {
    return `${descriptor.label} previews a ${settings.selectionMode ?? 'reveal-selection'} mask with density ${settings.density} and feather ${settings.feather} metadata; density and feather remain preview-time metadata until baking.`;
  }
  return `${descriptor.label} previews layer-mask metadata with density ${settings.density} and feather ${settings.feather}.`;
}

function buildLayerMaskOperationSettingsApplication(
  settings: LayerMaskOperationSettingsSummary,
): LayerMaskOperationSettingsApplicationSummary {
  return {
    density: {
      value: settings.density,
      appliesTo: ['mask-preview', 'mask-bake', 'export-flattening'],
      nonDestructive: true,
      previewCaveat: 'Density preview changes interpreted mask coverage without rewriting stored mask alpha.',
    },
    feather: {
      value: settings.feather,
      appliesTo: ['mask-preview', 'mask-bake', 'export-flattening'],
      nonDestructive: true,
      previewCaveat: 'Feather preview uses a local blur approximation before any destructive mask bake.',
    },
  };
}

function buildLayerMaskOperationPlanReadiness(
  kind: LayerMaskOperationKind,
  layerId: string,
  blockingWarningCodes: LayerMaskOperationWarningCode[],
): LayerMaskOperationPlanReadiness {
  const descriptor = getLayerMaskOperationReadinessDescriptor(kind);
  return {
    readinessId: `${descriptor.readinessId}:${layerId}`,
    state: blockingWarningCodes.length > 0 ? 'blocked' : descriptor.stateWhenRequirementsMet,
    action: descriptor.action,
    blockingWarningCodes,
    requiresRasterTarget: descriptor.requiresRasterTarget,
    exportCaveat: descriptor.exportCaveat,
  };
}

function getLayerMaskOperationReadinessDescriptor(
  kind: LayerMaskOperationKind,
): LayerMaskOperationReadinessDescriptor {
  if (kind === 'apply') {
    return {
      readinessId: 'layer-mask-op-readiness:apply',
      action: 'apply',
      stateWhenRequirementsMet: 'ready-destructive',
      requiresRasterTarget: true,
      exportCaveat: 'Applied layer masks bake alpha into bitmap pixels; the editable mask is removed after commit.',
    };
  }
  if (kind === 'delete') {
    return {
      readinessId: 'layer-mask-op-readiness:delete',
      action: 'delete',
      stateWhenRequirementsMet: 'ready-destructive',
      requiresRasterTarget: false,
      exportCaveat: 'Deleted layer masks are omitted from handoff/export and cannot round-trip as editable masks.',
    };
  }
  if (kind === 'density' || kind === 'feather' || kind === 'invert') {
    return {
      readinessId: `layer-mask-op-readiness:${kind}`,
      action: 'adjust',
      stateWhenRequirementsMet: 'ready',
      requiresRasterTarget: false,
      exportCaveat: 'Editable layer-mask state is preserved for handoff/export after this adjustment.',
    };
  }
  return {
    readinessId: `layer-mask-op-readiness:${kind}`,
    action: 'create',
    stateWhenRequirementsMet: 'ready',
    requiresRasterTarget: false,
    exportCaveat: 'Created layer masks export as editable alpha masks when the target format supports masks.',
  };
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}
