import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import type { BrushDab } from './ImageBrushEngine';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import { createMask, type SelectionMask } from './SelectionMask';

export interface ImageLayerMaskSettings {
  density: number;
  feather: number;
}

export type ImageLayerMaskWorkflowWarningCode =
  | 'selection-required'
  | 'refine-workspace-unsupported'
  | 'copy-link-workflow-unsupported'
  | 'copy-link-workflow-partial'
  | 'source-mask-required'
  | 'target-layer-required'
  | 'target-mask-size-mismatch'
  | 'mask-pixel-size-mismatch'
  | 'target-bitmap-required'
  | 'apply-mask-bitmap-required';

export interface ImageLayerMaskWorkflowWarning {
  code: ImageLayerMaskWorkflowWarningCode;
  severity: 'warning';
  message: string;
}

export interface ImageLayerMaskWorkflowSupportRequest {
  refineWorkspace?: boolean;
  copyLinkWorkflow?: boolean;
}

export type ImageLayerMaskRefinePreviewMode =
  | 'masked-areas'
  | 'selected-areas'
  | 'on-black'
  | 'on-white'
  | 'black-white';

export interface ImageLayerMaskPreviewModeSummary {
  mode: ImageLayerMaskRefinePreviewMode;
  ready: boolean;
  summary: string;
}

export interface ImageLayerMaskWorkflowBlocker {
  code: ImageLayerMaskWorkflowWarningCode;
  summary: string;
}

export interface ImageLayerMaskRefineWorkspaceUnsupportedDescriptor {
  code: 'refine-workspace-unsupported';
  target: 'select-and-mask-handoff-unsupported';
  summary: string;
}

export type ImageLayerMaskWorkflowKind =
  | 'copy-mask'
  | 'link-mask'
  | 'apply-mask'
  | 'refine-workspace-handoff';

export type ImageLayerMaskWorkflowSupport = 'supported' | 'partial' | 'unsupported';
export type ImageLayerMaskWorkflowUnsupportedState =
  | 'none'
  | 'partial-ui'
  | 'state-model-missing'
  | 'workspace-missing';

export interface ImageLayerMaskWorkflowDescriptor {
  descriptorId: string;
  kind: ImageLayerMaskWorkflowKind;
  label: string;
  support: ImageLayerMaskWorkflowSupport;
  unsupportedState: ImageLayerMaskWorkflowUnsupportedState;
  source: 'existing-mask' | 'layer-mask-or-selection';
  output: 'layer-mask' | 'layer-bitmap' | 'refine-workspace';
  previewId: string;
  handoffCaveat: string | null;
  exportCaveat: string;
  caveat: string;
  previewModes: ImageLayerMaskPreviewModeSummary[];
  unsupportedDescriptor: ImageLayerMaskRefineWorkspaceUnsupportedDescriptor | null;
}

export interface ImageLayerMaskWorkflowPlanOptions {
  sourceLayer?: Pick<ImageLayer, 'id' | 'mask' | 'bitmap'> | null;
  targetLayer?: Pick<ImageLayer, 'id' | 'mask' | 'bitmap'> | null;
}

export interface ImageLayerMaskWorkflowHandoff {
  preferredInput: 'selection-or-mask-alpha';
  expectedReturn: 'updated-layer-mask-alpha';
}

export type ImageLayerMaskWorkflowReadinessState =
  | 'ready'
  | 'ready-with-caveats'
  | 'blocked'
  | 'unsupported';

export interface ImageLayerMaskWorkflowReadiness {
  state: ImageLayerMaskWorkflowReadinessState;
  unsupportedState: ImageLayerMaskWorkflowUnsupportedState;
  blockingWarningCodes: ImageLayerMaskWorkflowWarningCode[];
}

export interface ImageLayerMaskWorkflowPreview {
  id: string;
  signature: string;
}

export interface ImageLayerMaskTargetMismatch {
  expected: { width: number; height: number };
  actual: { width: number; height: number };
  warningCode: 'target-mask-size-mismatch';
}

export interface ImageLayerMaskWorkflowPlan {
  kind: ImageLayerMaskWorkflowKind;
  descriptor: ImageLayerMaskWorkflowDescriptor;
  canRun: boolean;
  support: ImageLayerMaskWorkflowSupport;
  sourceLayerId: string | null;
  targetLayerId: string | null;
  warnings: ImageLayerMaskWorkflowWarning[];
  blockers: ImageLayerMaskWorkflowBlocker[];
  preview: ImageLayerMaskWorkflowPreview;
  readiness: ImageLayerMaskWorkflowReadiness;
  targetMismatch: ImageLayerMaskTargetMismatch | null;
  previewModes: ImageLayerMaskPreviewModeSummary[];
  unsupportedDescriptor: ImageLayerMaskRefineWorkspaceUnsupportedDescriptor | null;
  handoff?: ImageLayerMaskWorkflowHandoff;
}

export type ImageLayerMaskOperationKind =
  | 'create-mask'
  | 'create-reveal-mask'
  | 'create-hide-mask'
  | 'create-mask-from-selection'
  | 'edit-mask'
  | 'apply-mask'
  | 'delete-mask'
  | 'invert-mask'
  | 'adjust-density'
  | 'adjust-feather';

export type ImageLayerMaskOperationSupport = 'supported' | 'partial' | 'unsupported';
export type ImageLayerMaskOperationReadinessState =
  | 'ready'
  | 'ready-with-caveats'
  | 'blocked'
  | 'unsupported';

export type ImageLayerMaskOperationUnsupportedState =
  | 'none'
  | 'missing-layer'
  | 'missing-selection'
  | 'missing-mask'
  | 'missing-bitmap'
  | 'size-mismatch'
  | 'state-model-missing'
  | 'workspace-missing';

export type ImageLayerMaskCreateMode =
  | 'generic'
  | 'reveal-all'
  | 'hide-all'
  | 'from-selection';

export interface ImageLayerMaskOperationDescriptor {
  descriptorId: string;
  kind: ImageLayerMaskOperationKind;
  label: string;
  support: ImageLayerMaskOperationSupport;
  previewId: string;
  createMode: ImageLayerMaskCreateMode | null;
  requiresSelection: boolean;
  mutatesMask: boolean;
  mutatesPixels: boolean;
  removesMask: boolean;
  caveat: string | null;
}

export interface ImageLayerMaskOperationPlanOptions {
  layer?: Pick<ImageLayer, 'id' | 'mask' | 'bitmap' | 'maskDensity' | 'maskFeather'> | null;
  selection?: SelectionMask | null;
  requestedDensity?: number;
  requestedFeather?: number;
}

export interface ImageLayerMaskOperationReadiness {
  state: ImageLayerMaskOperationReadinessState;
  unsupportedState: ImageLayerMaskOperationUnsupportedState;
  blockingWarningCodes: ImageLayerMaskWorkflowWarningCode[];
}

export interface ImageLayerMaskPixelTargetMismatch {
  mask: { width: number; height: number };
  pixels: { width: number; height: number };
  warningCode: 'mask-pixel-size-mismatch';
}

export interface ImageLayerMaskSelectionSummary {
  present: boolean;
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  alphaRange: { min: number; max: number } | null;
}

export interface ImageLayerMaskOverlayPreviewStatus {
  status: 'available' | 'empty' | 'size-mismatch';
  id: string;
  signature: string;
  layerId: string | null;
  documentSize: { width: number; height: number };
  maskSize: { width: number; height: number } | null;
  settings: ImageLayerMaskSettings;
  mismatch: ImageLayerMaskPixelTargetMismatch | null;
}

export type ImageLayerMaskPreviewModeKind =
  | 'mask-overlay'
  | 'density-preview'
  | 'feather-preview'
  | 'refine-handoff-summaries';

export type ImageLayerMaskPreviewModeStatus =
  | ImageLayerMaskOverlayPreviewStatus['status']
  | 'summary-only';

export type ImageLayerMaskPreviewModeBacking =
  | 'layer-mask-overlay-alpha'
  | 'processed-mask-density'
  | 'processed-mask-feather'
  | 'workflow-preview-summary';

export interface ImageLayerMaskPreviewModeDescriptor {
  kind: 'image-layer-mask-preview-mode';
  mode: ImageLayerMaskPreviewModeKind;
  label: string;
  support: ImageLayerMaskWorkflowSupport;
  status: ImageLayerMaskPreviewModeStatus;
  backedBy: ImageLayerMaskPreviewModeBacking;
  previewId: string;
  settings: ImageLayerMaskSettings;
  unsupportedState: ImageLayerMaskOperationUnsupportedState | ImageLayerMaskWorkflowUnsupportedState;
  summary: string;
  caveat: string | null;
  dedicatedRefineWorkspace: false;
  linkedMaskWorkflow: false;
  signature: string;
}

export interface ImageLayerMaskOperationPreview {
  id: string;
  signature: string;
  overlay: ImageLayerMaskOverlayPreviewStatus;
}

export interface ImageLayerMaskSettingsApplicationEntry {
  value: number;
  appliesTo: Array<'overlay-preview' | 'mask-bake' | 'export-flattening'>;
  nonDestructive: boolean;
  summary: string;
  previewCaveat: string;
}

export interface ImageLayerMaskSettingsApplicationSummary {
  density: ImageLayerMaskSettingsApplicationEntry;
  feather: ImageLayerMaskSettingsApplicationEntry;
}

export interface ImageLayerMaskOperationPlan {
  kind: ImageLayerMaskOperationKind;
  descriptor: ImageLayerMaskOperationDescriptor;
  layerId: string | null;
  canRun: boolean;
  support: ImageLayerMaskOperationSupport;
  warnings: ImageLayerMaskWorkflowWarning[];
  readiness: ImageLayerMaskOperationReadiness;
  preview: ImageLayerMaskOperationPreview;
  mismatch: ImageLayerMaskPixelTargetMismatch | null;
  createMode: ImageLayerMaskCreateMode | null;
  selection: ImageLayerMaskSelectionSummary;
  requestedSettings: ImageLayerMaskSettings;
  settingsApplication: ImageLayerMaskSettingsApplicationSummary;
  caveats: {
    copyLinkApplyRefine: string[];
    overlayPreview: string | null;
    settingsPreview: string[];
    unsupportedWorkflows: ImageLayerMaskWorkflowDescriptor[];
  };
}

export interface ImageLayerMaskReadinessSummary {
  plans: ImageLayerMaskOperationPlan[];
  workflowPlans: ImageLayerMaskWorkflowPlan[];
  overlayPreview: ImageLayerMaskOverlayPreviewStatus;
  previewModeDescriptors: ImageLayerMaskPreviewModeDescriptor[];
  unsupportedCapabilities: ImageLayerMaskUnsupportedCapabilityDescriptor[];
  signature: string;
}

export type ImageLayerMaskUnsupportedCapabilityCode =
  | 'dedicated-refine-mask-workspace'
  | 'advanced-matte-refine-brush'
  | 'photoshop-linked-mask-parity'
  | 'native-psd-mask-fidelity';

export interface ImageLayerMaskUnsupportedCapabilityDescriptor {
  kind: 'image-layer-mask-unsupported-capability';
  code: ImageLayerMaskUnsupportedCapabilityCode;
  area: 'state-model' | 'workspace' | 'brush-engine' | 'photoshop-parity' | 'native-file-interop';
  support: 'unsupported';
  blocker: ImageLayerMaskOperationUnsupportedState | ImageLayerMaskWorkflowUnsupportedState;
  caveat: string;
  fallback: string;
  signature: string;
}

export interface ImageLayerMaskReadinessLaneDescriptor {
  kind: 'image-layer-mask-readiness-lane';
  operationKinds: ImageLayerMaskOperationKind[];
  workflowKinds: ImageLayerMaskWorkflowKind[];
  unsupportedCapabilities: ImageLayerMaskUnsupportedCapabilityDescriptor[];
  stableSignatures: {
    operations: string[];
    workflows: string[];
    overlay: string;
    previewModes: string[];
    unsupportedCapabilities: string[];
  };
  signature: string;
}

export const IMAGE_LAYER_MASK_OPERATION_DESCRIPTORS: readonly ImageLayerMaskOperationDescriptor[] = [
  {
    descriptorId: 'layer-mask-operation:create-mask',
    kind: 'create-mask',
    label: 'Create Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:create-mask',
    createMode: 'generic',
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Creation is planned as a local layer-mask alpha attachment; Photoshop channel panel and vector-mask creation variants are tracked separately.',
  },
  {
    descriptorId: 'layer-mask-operation:create-reveal-mask',
    kind: 'create-reveal-mask',
    label: 'Reveal All Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:create-reveal-mask',
    createMode: 'reveal-all',
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Reveal-all creation attaches an opaque layer mask using the target layer pixel bounds.',
  },
  {
    descriptorId: 'layer-mask-operation:create-hide-mask',
    kind: 'create-hide-mask',
    label: 'Hide All Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:create-hide-mask',
    createMode: 'hide-all',
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Hide-all creation attaches a concealed layer mask using the target layer pixel bounds.',
  },
  {
    descriptorId: 'layer-mask-operation:create-mask-from-selection',
    kind: 'create-mask-from-selection',
    label: 'Layer Mask From Selection',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:create-mask-from-selection',
    createMode: 'from-selection',
    requiresSelection: true,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Selection-based creation maps active selection alpha into target-layer-local mask pixels.',
  },
  {
    descriptorId: 'layer-mask-operation:edit-mask',
    kind: 'edit-mask',
    label: 'Edit Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:edit-mask',
    createMode: null,
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Mask editing is bounded to direct alpha painting; no dedicated Photoshop refine workspace is available.',
  },
  {
    descriptorId: 'layer-mask-operation:apply-mask',
    kind: 'apply-mask',
    label: 'Apply Layer Mask',
    support: 'partial',
    previewId: 'layer-mask-operation-preview:apply-mask',
    createMode: null,
    requiresSelection: false,
    mutatesMask: false,
    mutatesPixels: true,
    removesMask: true,
    caveat: 'Applying a mask is planned as bitmap alpha baking; smart-object and apply-as-selection preservation are not modeled.',
  },
  {
    descriptorId: 'layer-mask-operation:delete-mask',
    kind: 'delete-mask',
    label: 'Delete Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:delete-mask',
    createMode: null,
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: true,
    caveat: 'Deletion removes editable mask state without changing bitmap pixels.',
  },
  {
    descriptorId: 'layer-mask-operation:invert-mask',
    kind: 'invert-mask',
    label: 'Invert Layer Mask',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:invert-mask',
    createMode: null,
    requiresSelection: false,
    mutatesMask: true,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Invert is planned as a deterministic alpha inversion on the existing layer mask.',
  },
  {
    descriptorId: 'layer-mask-operation:adjust-density',
    kind: 'adjust-density',
    label: 'Adjust Mask Density',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:adjust-density',
    createMode: null,
    requiresSelection: false,
    mutatesMask: false,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Density is retained as non-destructive mask metadata and applied in preview/export flattening.',
  },
  {
    descriptorId: 'layer-mask-operation:adjust-feather',
    kind: 'adjust-feather',
    label: 'Adjust Mask Feather',
    support: 'supported',
    previewId: 'layer-mask-operation-preview:adjust-feather',
    createMode: null,
    requiresSelection: false,
    mutatesMask: false,
    mutatesPixels: false,
    removesMask: false,
    caveat: 'Feather is retained as non-destructive mask metadata and approximated with a local alpha blur.',
  },
];

const IMAGE_LAYER_MASK_OPERATION_DESCRIPTOR_BY_KIND = new Map(
  IMAGE_LAYER_MASK_OPERATION_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]),
);

export const IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTORS: readonly ImageLayerMaskWorkflowDescriptor[] = [
  {
    descriptorId: 'layer-mask-workflow:copy-mask',
    kind: 'copy-mask',
    label: 'Copy Layer Mask',
    support: 'partial',
    unsupportedState: 'partial-ui',
    source: 'existing-mask',
    output: 'layer-mask',
    previewId: 'layer-mask-workflow-preview:copy-mask',
    handoffCaveat: null,
    exportCaveat: 'Copied mask pixels can export as a normal alpha mask after they are materialized on the target layer.',
    caveat: 'Mask pixels can be duplicated by helper code, but no UI command or cross-layer target picker is wired yet.',
    previewModes: [],
    unsupportedDescriptor: null,
  },
  {
    descriptorId: 'layer-mask-workflow:link-mask',
    kind: 'link-mask',
    label: 'Link Layer Mask',
    support: 'supported',
    unsupportedState: 'none',
    source: 'existing-mask',
    output: 'layer-mask',
    previewId: 'layer-mask-workflow-preview:link-mask',
    handoffCaveat: null,
    exportCaveat: 'Sloom .slimg saves the linked source reference. PSD handoff cannot preserve the shared relationship; retain .slimg for linked editing.',
    caveat: 'A linked consumer follows one direct source mask; unlinking materializes an independent copy.',
    previewModes: [],
    unsupportedDescriptor: null,
  },
  {
    descriptorId: 'layer-mask-workflow:apply-mask',
    kind: 'apply-mask',
    label: 'Apply Layer Mask',
    support: 'partial',
    unsupportedState: 'partial-ui',
    source: 'existing-mask',
    output: 'layer-bitmap',
    previewId: 'layer-mask-workflow-preview:apply-mask',
    handoffCaveat: null,
    exportCaveat: 'Applied masks export as baked bitmap alpha; editable layer-mask state is removed.',
    caveat: 'Mask application can bake alpha into bitmap layers, but apply-as-selection or smart-object style mask preservation is not modeled.',
    previewModes: [],
    unsupportedDescriptor: null,
  },
  {
    descriptorId: 'layer-mask-workflow:refine-workspace-handoff',
    kind: 'refine-workspace-handoff',
    label: 'Refine Mask Workspace Handoff',
    support: 'unsupported',
    unsupportedState: 'workspace-missing',
    source: 'layer-mask-or-selection',
    output: 'refine-workspace',
    previewId: 'layer-mask-workflow-preview:refine-workspace-handoff',
    handoffCaveat: 'Send selection or mask alpha to Select & Mask style refinement before committing a layer mask.',
    exportCaveat: 'No refine workspace state is exported; only the committed mask alpha can be preserved.',
    caveat: 'No dedicated refine-mask workspace exists yet; refine the selection first or paint the layer mask directly.',
    previewModes: buildRefineWorkspacePreviewModes(),
    unsupportedDescriptor: {
      code: 'refine-workspace-unsupported',
      target: 'select-and-mask-handoff-unsupported',
      summary: 'Refine Mask workspace is not available; hand off selection or mask alpha to a future Select and Mask style workflow instead.',
    },
  },
];

const IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTOR_BY_KIND = new Map(
  IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTORS.map((descriptor) => [descriptor.kind, descriptor]),
);

export const IMAGE_LAYER_MASK_UNSUPPORTED_CAPABILITY_DESCRIPTORS: readonly ImageLayerMaskUnsupportedCapabilityDescriptor[] = [
  {
    kind: 'image-layer-mask-unsupported-capability',
    code: 'dedicated-refine-mask-workspace',
    area: 'workspace',
    support: 'unsupported',
    blocker: 'workspace-missing',
    caveat: 'There is no dedicated Select and Mask style workspace for layer-mask edge preview or commit.',
    fallback: 'Refine the document selection first, then create a mask from selection or paint the mask directly.',
    signature: 'image-layer-mask-unsupported:v1:dedicated-refine-mask-workspace:workspace-missing',
  },
  {
    kind: 'image-layer-mask-unsupported-capability',
    code: 'advanced-matte-refine-brush',
    area: 'brush-engine',
    support: 'unsupported',
    blocker: 'workspace-missing',
    caveat: 'Advanced matte cleanup and refine-edge brush strokes are not modeled as layer-mask operations.',
    fallback: 'Use normal brush/eraser alpha painting on the mask or hand off to future selection refinement.',
    signature: 'image-layer-mask-unsupported:v1:advanced-matte-refine-brush:workspace-missing',
  },
  {
    kind: 'image-layer-mask-unsupported-capability',
    code: 'photoshop-linked-mask-parity',
    area: 'photoshop-parity',
    support: 'unsupported',
    blocker: 'partial-ui',
    caveat: 'Sloom Studio linked masks are stored in .slimg, but native Photoshop linked-mask parity is not emitted.',
    fallback: 'Keep .slimg for linked editing; PSD handoff materializes or flattens mask behavior.',
    signature: 'image-layer-mask-unsupported:v1:photoshop-linked-mask-parity:partial-ui',
  },
  {
    kind: 'image-layer-mask-unsupported-capability',
    code: 'native-psd-mask-fidelity',
    area: 'native-file-interop',
    support: 'unsupported',
    blocker: 'partial-ui',
    caveat: 'Native PSD layer-mask fidelity is not guaranteed; editable Sloom Studio masks may flatten or degrade outside the app.',
    fallback: 'Preserve Sloom Studio project metadata for editability and export flattened previews when native fidelity is required.',
    signature: 'image-layer-mask-unsupported:v1:native-psd-mask-fidelity:partial-ui',
  },
];

export function getImageLayerMaskWorkflowDescriptors(): ImageLayerMaskWorkflowDescriptor[] {
  return IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}

export function getImageLayerMaskWorkflowDescriptor(
  kind: ImageLayerMaskWorkflowKind,
): ImageLayerMaskWorkflowDescriptor {
  const descriptor = IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTOR_BY_KIND.get(kind);
  if (!descriptor) {
    throw new Error(`Unsupported layer-mask workflow: ${kind}`);
  }
  return { ...descriptor };
}

export function getImageLayerMaskOperationDescriptors(): ImageLayerMaskOperationDescriptor[] {
  return IMAGE_LAYER_MASK_OPERATION_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}

export function getImageLayerMaskOperationDescriptor(
  kind: ImageLayerMaskOperationKind,
): ImageLayerMaskOperationDescriptor {
  const descriptor = IMAGE_LAYER_MASK_OPERATION_DESCRIPTOR_BY_KIND.get(kind);
  if (!descriptor) {
    throw new Error(`Unsupported layer-mask operation: ${kind}`);
  }
  return { ...descriptor };
}

export function planImageLayerMaskOperation(
  kind: ImageLayerMaskOperationKind,
  options: ImageLayerMaskOperationPlanOptions = {},
): ImageLayerMaskOperationPlan {
  const descriptor = getImageLayerMaskOperationDescriptor(kind);
  const layer = options.layer ?? null;
  const warnings: ImageLayerMaskWorkflowWarning[] = [];
  const mismatch = resolveLayerMaskPixelTargetMismatch(layer);
  const selection = summarizeImageLayerMaskSelection(options.selection ?? null);
  const requestedSettings: ImageLayerMaskSettings = {
    density: options.requestedDensity === undefined
      ? resolveImageLayerMaskSettings(layer).density
      : clampImageLayerMaskDensity(options.requestedDensity),
    feather: options.requestedFeather === undefined
      ? resolveImageLayerMaskSettings(layer).feather
      : clampImageLayerMaskFeather(options.requestedFeather),
  };

  if (!layer) {
    warnings.push({
      code: 'target-layer-required',
      severity: 'warning',
      message: 'This layer-mask operation requires a target layer.',
    });
  }

  if (descriptor.requiresSelection && !selection.present) {
    warnings.push({
      code: 'selection-required',
      severity: 'warning',
      message: 'Creating a layer mask from selection requires active selection alpha.',
    });
  }

  if (layer && !layer.bitmap && (descriptor.createMode !== null || kind === 'apply-mask')) {
    warnings.push({
      code: kind === 'apply-mask' ? 'apply-mask-bitmap-required' : 'target-bitmap-required',
      severity: 'warning',
      message: kind === 'apply-mask'
        ? 'Applying a layer mask requires editable bitmap pixels on the source layer.'
        : 'Creating a layer mask requires editable target-layer pixel bounds.',
    });
  }

  if (layer && descriptor.createMode === null && !layer.mask) {
    warnings.push({
      code: 'source-mask-required',
      severity: 'warning',
      message: 'This layer-mask operation requires an existing mask.',
    });
  }

  if (mismatch && (kind === 'apply-mask' || kind === 'edit-mask' || kind === 'invert-mask')) {
    warnings.push({
      code: mismatch.warningCode,
      severity: 'warning',
      message: `Layer mask size ${mismatch.mask.width}x${mismatch.mask.height} does not match pixel layer size ${mismatch.pixels.width}x${mismatch.pixels.height}.`,
    });
  }

  const blockingWarningCodes = warnings
    .filter((warning) => (
      warning.code === 'target-layer-required'
      || warning.code === 'target-bitmap-required'
      || warning.code === 'selection-required'
      || warning.code === 'source-mask-required'
      || warning.code === 'apply-mask-bitmap-required'
    ))
    .map((warning) => warning.code);
  const readiness = resolveImageLayerMaskOperationReadiness(descriptor, blockingWarningCodes, mismatch);
  const overlay = describeImageLayerMaskOverlayPreview(layer, layer?.bitmap?.width ?? layer?.mask?.width ?? 0, layer?.bitmap?.height ?? layer?.mask?.height ?? 0);
  const preview: ImageLayerMaskOperationPreview = {
    id: `${descriptor.previewId}:${layer?.id ?? 'none'}`,
    signature: buildLayerMaskOperationSignature({
      kind,
      support: descriptor.support,
      layer,
      warnings,
      requestedSettings,
      createMode: descriptor.createMode,
      selection,
      mismatch,
    }),
    overlay,
  };
  const settingsApplication = describeImageLayerMaskSettingsApplication(requestedSettings);

  return {
    kind,
    descriptor,
    layerId: layer?.id ?? null,
    canRun: descriptor.support !== 'unsupported' && blockingWarningCodes.length === 0,
    support: descriptor.support,
    warnings,
    readiness,
    preview,
    mismatch,
    createMode: descriptor.createMode,
    selection,
    requestedSettings,
    settingsApplication,
    caveats: {
      copyLinkApplyRefine: resolveImageLayerMaskWorkflowCaveats(),
      overlayPreview: overlay.status === 'available'
        ? null
        : overlay.status === 'size-mismatch'
          ? 'Mask overlay can preview, but mask bounds do not match pixel bounds.'
          : 'No mask overlay is available until the layer has mask alpha.',
      settingsPreview: [
        'Density preview changes interpreted mask coverage without mutating stored mask alpha.',
        'Feather preview uses a local blur approximation and should be reviewed before destructive apply/export.',
      ],
      unsupportedWorkflows: getUnsupportedImageLayerMaskWorkflowDescriptors(),
    },
  };
}

export function summarizeImageLayerMaskReadiness(
  options: ImageLayerMaskOperationPlanOptions & ImageLayerMaskWorkflowPlanOptions = {},
): ImageLayerMaskReadinessSummary {
  const layer = options.layer ?? options.sourceLayer ?? null;
  const overlayPreview = describeImageLayerMaskOverlayPreview(
    layer,
    layer?.bitmap?.width ?? layer?.mask?.width ?? 0,
    layer?.bitmap?.height ?? layer?.mask?.height ?? 0,
  );
  const previewModeDescriptors = describeImageLayerMaskPreviewModeDescriptors(
    layer,
    layer?.bitmap?.width ?? layer?.mask?.width ?? 0,
    layer?.bitmap?.height ?? layer?.mask?.height ?? 0,
  );
  const operationKinds: ImageLayerMaskOperationKind[] = [
    'create-mask',
    'create-reveal-mask',
    'create-hide-mask',
    'create-mask-from-selection',
    'edit-mask',
    'apply-mask',
    'delete-mask',
    'invert-mask',
    'adjust-density',
    'adjust-feather',
  ];
  const workflowKinds: ImageLayerMaskWorkflowKind[] = [
    'copy-mask',
    'link-mask',
    'apply-mask',
    'refine-workspace-handoff',
  ];
  const plans = operationKinds.map((operationKind) => planImageLayerMaskOperation(operationKind, {
    layer,
    selection: options.selection,
    requestedDensity: options.requestedDensity,
    requestedFeather: options.requestedFeather,
  }));
  const workflowPlans = workflowKinds.map((workflowKind) => planImageLayerMaskWorkflow(workflowKind, {
    sourceLayer: options.sourceLayer ?? layer,
    targetLayer: options.targetLayer,
  }));

  return {
    plans,
    workflowPlans,
    overlayPreview,
    previewModeDescriptors,
    unsupportedCapabilities: getImageLayerMaskUnsupportedCapabilityDescriptors(),
    signature: `layer-mask-readiness:v1:${JSON.stringify({
      layerId: layer?.id ?? null,
      operationSignatures: plans.map((plan) => plan.preview.signature),
      workflowSignatures: workflowPlans.map((plan) => plan.preview.signature),
      overlaySignature: overlayPreview.signature,
      previewModeSignatures: previewModeDescriptors.map((descriptor) => descriptor.signature),
      unsupportedCapabilities: IMAGE_LAYER_MASK_UNSUPPORTED_CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.signature),
    })}`,
  };
}

export function planImageLayerMaskWorkflow(
  kind: ImageLayerMaskWorkflowKind,
  options: ImageLayerMaskWorkflowPlanOptions = {},
): ImageLayerMaskWorkflowPlan {
  const descriptor = getImageLayerMaskWorkflowDescriptor(kind);
  const warnings: ImageLayerMaskWorkflowWarning[] = [];
  const sourceLayer = options.sourceLayer ?? null;
  const targetLayer = options.targetLayer ?? null;

  if ((kind === 'copy-mask' || kind === 'link-mask' || kind === 'apply-mask') && !sourceLayer?.mask) {
    warnings.push({
      code: 'source-mask-required',
      severity: 'warning',
      message: 'This layer-mask workflow requires a source layer with an existing mask.',
    });
  }

  if ((kind === 'copy-mask' || kind === 'link-mask') && !targetLayer) {
    warnings.push({
      code: 'target-layer-required',
      severity: 'warning',
      message: 'Copying or linking a layer mask requires a target layer.',
    });
  }

  const targetMismatch = resolveLayerMaskTargetMismatch(sourceLayer, targetLayer);
  if ((kind === 'copy-mask' || kind === 'link-mask') && targetMismatch) {
    warnings.push({
      code: targetMismatch.warningCode,
      severity: 'warning',
      message: `Target layer mask size ${targetMismatch.actual.width}x${targetMismatch.actual.height} does not match source mask size ${targetMismatch.expected.width}x${targetMismatch.expected.height}.`,
    });
  }

  if (kind === 'apply-mask' && !sourceLayer?.bitmap) {
    warnings.push({
      code: 'apply-mask-bitmap-required',
      severity: 'warning',
      message: 'Applying a layer mask requires editable bitmap pixels on the source layer.',
    });
  }

  const hasCopyMaskRequirementWarning = warnings.some((warning) => (
    warning.code === 'source-mask-required'
    || warning.code === 'target-layer-required'
  ));

  if (kind === 'copy-mask' && !hasCopyMaskRequirementWarning) {
    warnings.push({
      code: 'copy-link-workflow-partial',
      severity: 'warning',
      message: descriptor.caveat,
    });
  }

  if (kind === 'refine-workspace-handoff') {
    warnings.push({
      code: 'refine-workspace-unsupported',
      severity: 'warning',
      message: descriptor.caveat,
    });
  }

  const hasBlockingWarning = warnings.some((warning) => (
    warning.code === 'source-mask-required'
    || warning.code === 'target-layer-required'
    || warning.code === 'apply-mask-bitmap-required'
    || warning.code === 'copy-link-workflow-unsupported'
    || warning.code === 'refine-workspace-unsupported'
  ));
  const blockingWarningCodes = warnings
    .filter((warning) => (
      warning.code === 'source-mask-required'
      || warning.code === 'target-layer-required'
      || warning.code === 'apply-mask-bitmap-required'
      || warning.code === 'copy-link-workflow-unsupported'
      || warning.code === 'refine-workspace-unsupported'
    ))
    .map((warning) => warning.code);
  const readiness: ImageLayerMaskWorkflowReadiness = {
    state: descriptor.support === 'unsupported'
      ? 'unsupported'
      : hasBlockingWarning
        ? 'blocked'
        : descriptor.support === 'partial'
          ? 'ready-with-caveats'
          : 'ready',
    unsupportedState: descriptor.unsupportedState,
    blockingWarningCodes,
  };
  const sourceLayerId = sourceLayer?.id ?? null;
  const targetLayerId = targetLayer?.id ?? null;
  const preview: ImageLayerMaskWorkflowPreview = {
    id: `${descriptor.previewId}:${sourceLayerId ?? 'none'}:${targetLayerId ?? 'none'}`,
    signature: buildLayerMaskWorkflowSignature({
      kind,
      support: descriptor.support,
      sourceLayer,
      targetLayer,
      warnings,
      blockers: blockingWarningCodes,
      previewModes: descriptor.previewModes,
    }),
  };
  const blockers = buildImageLayerMaskWorkflowBlockers(blockingWarningCodes);

  return {
    kind,
    descriptor,
    canRun: descriptor.support !== 'unsupported' && !hasBlockingWarning,
    support: descriptor.support,
    sourceLayerId,
    targetLayerId,
    warnings,
    blockers,
    preview,
    readiness,
    targetMismatch,
    previewModes: descriptor.previewModes.map((mode) => ({ ...mode })),
    unsupportedDescriptor: descriptor.unsupportedDescriptor
      ? { ...descriptor.unsupportedDescriptor }
      : null,
    handoff: kind === 'refine-workspace-handoff'
      ? {
          preferredInput: 'selection-or-mask-alpha',
          expectedReturn: 'updated-layer-mask-alpha',
        }
      : undefined,
  };
}

export function getUnsupportedImageLayerMaskWorkflowWarnings(
  request: ImageLayerMaskWorkflowSupportRequest = {},
): ImageLayerMaskWorkflowWarning[] {
  const warnings: ImageLayerMaskWorkflowWarning[] = [];

  if (request.refineWorkspace === true) {
    warnings.push({
      code: 'refine-workspace-unsupported',
      severity: 'warning',
      message: 'Select & Mask style layer-mask refinement is not supported yet; refine the selection before creating the mask or paint the mask directly.',
    });
  }

  if (request.copyLinkWorkflow === true) {
    warnings.push({
      code: 'copy-link-workflow-partial',
      severity: 'warning',
      message: 'Layer-mask linking is available; copying remains a separate manual/unlink workflow.',
    });
  }

  return warnings;
}

export function getUnsupportedImageLayerMaskWorkflowDescriptors(): ImageLayerMaskWorkflowDescriptor[] {
  return IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTORS
    .filter((descriptor) => descriptor.support === 'unsupported')
    .map((descriptor) => ({ ...descriptor }));
}

export function getImageLayerMaskUnsupportedCapabilityDescriptors(): ImageLayerMaskUnsupportedCapabilityDescriptor[] {
  return IMAGE_LAYER_MASK_UNSUPPORTED_CAPABILITY_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}

export function describeImageLayerMaskReadinessLane(
  options: ImageLayerMaskOperationPlanOptions & ImageLayerMaskWorkflowPlanOptions = {},
): ImageLayerMaskReadinessLaneDescriptor {
  const summary = summarizeImageLayerMaskReadiness(options);
  const unsupportedCapabilities = getImageLayerMaskUnsupportedCapabilityDescriptors();
  const stableSignatures = {
    operations: summary.plans.map((plan) => plan.preview.signature),
    workflows: summary.workflowPlans.map((plan) => plan.preview.signature),
    overlay: summary.overlayPreview.signature,
    previewModes: summary.previewModeDescriptors.map((descriptor) => descriptor.signature),
    unsupportedCapabilities: unsupportedCapabilities.map((descriptor) => descriptor.signature),
  };

  return {
    kind: 'image-layer-mask-readiness-lane',
    operationKinds: summary.plans.map((plan) => plan.kind),
    workflowKinds: summary.workflowPlans.map((plan) => plan.kind),
    unsupportedCapabilities,
    stableSignatures,
    signature: `image-layer-mask-readiness-lane:v1:${JSON.stringify(stableSignatures)}`,
  };
}

export function describeImageLayerMaskOverlayPreview(
  layer: Pick<ImageLayer, 'id' | 'mask' | 'bitmap' | 'maskDensity' | 'maskFeather'> | null | undefined,
  documentWidth: number,
  documentHeight: number,
): ImageLayerMaskOverlayPreviewStatus {
  const resolvedLayer = layer ?? null;
  const settings = resolveImageLayerMaskSettings(resolvedLayer);
  const mismatch = resolveLayerMaskPixelTargetMismatch(resolvedLayer);
  const maskSize = resolvedLayer?.mask
    ? { width: resolvedLayer.mask.width, height: resolvedLayer.mask.height }
    : null;
  const status: ImageLayerMaskOverlayPreviewStatus['status'] = !maskSize
    ? 'empty'
    : mismatch
      ? 'size-mismatch'
      : 'available';

  return {
    status,
    id: `layer-mask-overlay-preview:${resolvedLayer?.id ?? 'none'}:${documentWidth}x${documentHeight}`,
    signature: `layer-mask-overlay-preview:v1:${JSON.stringify({
      layerId: resolvedLayer?.id ?? null,
      documentWidth,
      documentHeight,
      maskSize,
      bitmapSize: resolvedLayer?.bitmap
        ? { width: resolvedLayer.bitmap.width, height: resolvedLayer.bitmap.height }
        : null,
      settings,
      status,
    })}`,
    layerId: resolvedLayer?.id ?? null,
    documentSize: { width: documentWidth, height: documentHeight },
    maskSize,
    settings,
    mismatch,
  };
}

export function describeImageLayerMaskPreviewModeDescriptors(
  layer: Pick<ImageLayer, 'id' | 'mask' | 'bitmap' | 'maskDensity' | 'maskFeather'> | null | undefined,
  documentWidth: number,
  documentHeight: number,
): ImageLayerMaskPreviewModeDescriptor[] {
  const overlay = describeImageLayerMaskOverlayPreview(layer, documentWidth, documentHeight);
  const overlaySupport: ImageLayerMaskWorkflowSupport = overlay.status === 'available'
    ? 'supported'
    : 'partial';
  const overlayUnsupportedState = resolveImageLayerMaskPreviewModeUnsupportedState(overlay.status);
  const overlayCaveat = describeImageLayerMaskPreviewModeStatusCaveat(overlay.status);

  return [
    buildImageLayerMaskPreviewModeDescriptor({
      mode: 'mask-overlay',
      label: 'Mask Overlay',
      support: overlaySupport,
      status: overlay.status,
      backedBy: 'layer-mask-overlay-alpha',
      previewId: overlay.id,
      settings: overlay.settings,
      unsupportedState: overlayUnsupportedState,
      summary: overlay.status === 'available'
        ? 'Mask Overlay preview is backed by concealed layer-mask alpha rendered in document coordinates.'
        : 'Mask Overlay preview is backed by layer-mask alpha once the target layer has compatible mask pixels.',
      caveat: overlayCaveat,
    }),
    buildImageLayerMaskPreviewModeDescriptor({
      mode: 'density-preview',
      label: 'Density Preview',
      support: overlaySupport,
      status: overlay.status,
      backedBy: 'processed-mask-density',
      previewId: `${overlay.id}:density`,
      settings: overlay.settings,
      unsupportedState: overlayUnsupportedState,
      summary: 'Density preview is backed by processed mask alpha using non-destructive maskDensity metadata.',
      caveat: 'Density preview changes interpreted mask alpha without rewriting stored mask pixels.',
    }),
    buildImageLayerMaskPreviewModeDescriptor({
      mode: 'feather-preview',
      label: 'Feather Preview',
      support: overlaySupport,
      status: overlay.status,
      backedBy: 'processed-mask-feather',
      previewId: `${overlay.id}:feather`,
      settings: overlay.settings,
      unsupportedState: overlayUnsupportedState,
      summary: 'Feather preview is backed by processed mask alpha using the local maskFeather blur approximation.',
      caveat: 'Feather preview uses the local alpha blur approximation; it is not a dedicated Select and Mask workspace.',
    }),
    buildImageLayerMaskPreviewModeDescriptor({
      mode: 'refine-handoff-summaries',
      label: 'Refine Handoff Summaries',
      support: 'partial',
      status: 'summary-only',
      backedBy: 'workflow-preview-summary',
      previewId: 'layer-mask-workflow-preview:refine-workspace-handoff:summary-only',
      settings: overlay.settings,
      unsupportedState: 'workspace-missing',
      summary: 'Refine handoff summaries reuse unsupported workflow preview-mode metadata for planning only.',
      caveat: 'Descriptor-only refine handoff summaries are available; no dedicated refine-mask workspace renders Select & Mask preview modes.',
    }),
  ];
}

function buildImageLayerMaskPreviewModeDescriptor(options: {
  mode: ImageLayerMaskPreviewModeKind;
  label: string;
  support: ImageLayerMaskWorkflowSupport;
  status: ImageLayerMaskPreviewModeStatus;
  backedBy: ImageLayerMaskPreviewModeBacking;
  previewId: string;
  settings: ImageLayerMaskSettings;
  unsupportedState: ImageLayerMaskOperationUnsupportedState | ImageLayerMaskWorkflowUnsupportedState;
  summary: string;
  caveat: string | null;
}): ImageLayerMaskPreviewModeDescriptor {
  const descriptor = {
    kind: 'image-layer-mask-preview-mode' as const,
    mode: options.mode,
    label: options.label,
    support: options.support,
    status: options.status,
    backedBy: options.backedBy,
    previewId: options.previewId,
    settings: options.settings,
    unsupportedState: options.unsupportedState,
    summary: options.summary,
    caveat: options.caveat,
    dedicatedRefineWorkspace: false as const,
    linkedMaskWorkflow: false as const,
  };

  return {
    ...descriptor,
    signature: `image-layer-mask-preview-mode:v1:${JSON.stringify({
      mode: descriptor.mode,
      support: descriptor.support,
      status: descriptor.status,
      backedBy: descriptor.backedBy,
      previewId: descriptor.previewId,
      settings: descriptor.settings,
      unsupportedState: descriptor.unsupportedState,
      dedicatedRefineWorkspace: descriptor.dedicatedRefineWorkspace,
      linkedMaskWorkflow: descriptor.linkedMaskWorkflow,
    })}`,
  };
}

function resolveImageLayerMaskPreviewModeUnsupportedState(
  status: ImageLayerMaskOverlayPreviewStatus['status'],
): ImageLayerMaskOperationUnsupportedState {
  switch (status) {
    case 'empty':
      return 'missing-mask';
    case 'size-mismatch':
      return 'size-mismatch';
    case 'available':
    default:
      return 'none';
  }
}

function describeImageLayerMaskPreviewModeStatusCaveat(
  status: ImageLayerMaskOverlayPreviewStatus['status'],
): string | null {
  switch (status) {
    case 'empty':
      return 'Layer-mask preview modes need mask alpha before they can render overlay pixels.';
    case 'size-mismatch':
      return 'Layer-mask preview modes can summarize settings, but mask bounds do not match pixel bounds.';
    case 'available':
    default:
      return null;
  }
}

function resolveImageLayerMaskOperationReadiness(
  descriptor: ImageLayerMaskOperationDescriptor,
  blockingWarningCodes: ImageLayerMaskWorkflowWarningCode[],
  mismatch: ImageLayerMaskPixelTargetMismatch | null,
): ImageLayerMaskOperationReadiness {
  const unsupportedState: ImageLayerMaskOperationUnsupportedState = blockingWarningCodes.includes('target-layer-required')
    ? 'missing-layer'
    : blockingWarningCodes.includes('selection-required')
      ? 'missing-selection'
    : blockingWarningCodes.includes('source-mask-required')
      ? 'missing-mask'
      : blockingWarningCodes.includes('target-bitmap-required')
        || blockingWarningCodes.includes('apply-mask-bitmap-required')
        ? 'missing-bitmap'
        : mismatch
          ? 'size-mismatch'
          : 'none';

  return {
    state: descriptor.support === 'unsupported'
      ? 'unsupported'
      : blockingWarningCodes.length > 0
        ? 'blocked'
        : descriptor.support === 'partial' || mismatch
          ? 'ready-with-caveats'
          : 'ready',
    unsupportedState,
    blockingWarningCodes,
  };
}

function resolveLayerMaskPixelTargetMismatch(
  layer: Pick<ImageLayer, 'mask' | 'bitmap'> | null,
): ImageLayerMaskPixelTargetMismatch | null {
  if (!layer?.mask || !layer.bitmap) return null;
  if (layer.mask.width === layer.bitmap.width && layer.mask.height === layer.bitmap.height) return null;
  return {
    mask: { width: layer.mask.width, height: layer.mask.height },
    pixels: { width: layer.bitmap.width, height: layer.bitmap.height },
    warningCode: 'mask-pixel-size-mismatch',
  };
}

function summarizeImageLayerMaskSelection(selection: SelectionMask | null): ImageLayerMaskSelectionSummary {
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

  const present = maxX >= minX && maxY >= minY;
  return {
    present,
    width: selection.width,
    height: selection.height,
    bounds: present
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

function resolveImageLayerMaskWorkflowCaveats(): string[] {
  return IMAGE_LAYER_MASK_WORKFLOW_DESCRIPTORS
    .filter((descriptor) => (
      descriptor.kind === 'copy-mask'
      || descriptor.kind === 'link-mask'
      || descriptor.kind === 'apply-mask'
      || descriptor.kind === 'refine-workspace-handoff'
    ))
    .map((descriptor) => descriptor.caveat);
}

function buildRefineWorkspacePreviewModes(): ImageLayerMaskPreviewModeSummary[] {
  return [
    {
      mode: 'masked-areas',
      ready: false,
      summary: 'Masked Areas preview is not available because no dedicated refine-mask workspace exists yet.',
    },
    {
      mode: 'selected-areas',
      ready: false,
      summary: 'Selected Areas preview is not available because no dedicated refine-mask workspace exists yet.',
    },
    {
      mode: 'on-black',
      ready: false,
      summary: 'On Black preview is not available because no dedicated refine-mask workspace exists yet.',
    },
    {
      mode: 'on-white',
      ready: false,
      summary: 'On White preview is not available because no dedicated refine-mask workspace exists yet.',
    },
    {
      mode: 'black-white',
      ready: false,
      summary: 'Black & White preview is not available because no dedicated refine-mask workspace exists yet.',
    },
  ];
}

function buildImageLayerMaskWorkflowBlockers(
  blockingWarningCodes: ImageLayerMaskWorkflowWarningCode[],
): ImageLayerMaskWorkflowBlocker[] {
  return blockingWarningCodes.map((code) => ({
    code,
    summary: describeImageLayerMaskWorkflowBlocker(code),
  }));
}

function describeImageLayerMaskWorkflowBlocker(
  code: ImageLayerMaskWorkflowWarningCode,
): string {
  switch (code) {
    case 'copy-link-workflow-unsupported':
      return 'Linked layer masks are blocked until shared mask references exist in document state.';
    case 'apply-mask-bitmap-required':
      return 'Applying a layer mask is blocked until the source layer has editable bitmap pixels.';
    case 'refine-workspace-unsupported':
      return 'Refine Mask workspace is blocked because the dedicated refinement workspace is not implemented.';
    case 'source-mask-required':
      return 'This workflow is blocked until the source layer has a layer mask.';
    case 'target-layer-required':
      return 'This workflow is blocked until a target layer is selected.';
    default:
      return 'This workflow is currently blocked.';
  }
}

function describeImageLayerMaskSettingsApplication(
  requestedSettings: ImageLayerMaskSettings,
): ImageLayerMaskSettingsApplicationSummary {
  return {
    density: {
      value: requestedSettings.density,
      appliesTo: ['overlay-preview', 'mask-bake', 'export-flattening'],
      nonDestructive: true,
      summary: 'Density metadata updates preview/export immediately and applies during mask baking without rewriting stored mask pixels.',
      previewCaveat: 'Density preview changes the interpreted mask alpha in overlay/export previews; stored mask pixels remain unchanged until baking.',
    },
    feather: {
      value: requestedSettings.feather,
      appliesTo: ['overlay-preview', 'mask-bake', 'export-flattening'],
      nonDestructive: true,
      summary: 'Feather metadata updates preview/export immediately and applies during mask baking without rewriting stored mask pixels.',
      previewCaveat: 'Feather preview is a local blur approximation in overlay/export previews and may not match a dedicated Select and Mask workspace.',
    },
  };
}

function resolveLayerMaskTargetMismatch(
  sourceLayer: Pick<ImageLayer, 'mask' | 'bitmap'> | null,
  targetLayer: Pick<ImageLayer, 'mask' | 'bitmap'> | null,
): ImageLayerMaskTargetMismatch | null {
  const expected = resolveLayerMaskWorkflowSize(sourceLayer);
  const actual = resolveLayerMaskWorkflowSize(targetLayer);
  if (!expected || !actual) return null;
  if (expected.width === actual.width && expected.height === actual.height) return null;
  return {
    expected,
    actual,
    warningCode: 'target-mask-size-mismatch',
  };
}

function resolveLayerMaskWorkflowSize(
  layer: Pick<ImageLayer, 'mask' | 'bitmap'> | null,
): { width: number; height: number } | null {
  const source = layer?.mask ?? layer?.bitmap ?? null;
  if (!source) return null;
  return {
    width: source.width,
    height: source.height,
  };
}

function buildLayerMaskWorkflowSignature(options: {
  kind: ImageLayerMaskWorkflowKind;
  support: ImageLayerMaskWorkflowSupport;
  sourceLayer: Pick<ImageLayer, 'id' | 'mask' | 'bitmap'> | null;
  targetLayer: Pick<ImageLayer, 'id' | 'mask' | 'bitmap'> | null;
  warnings: ImageLayerMaskWorkflowWarning[];
  blockers: ImageLayerMaskWorkflowWarningCode[];
  previewModes: ImageLayerMaskPreviewModeSummary[];
}): string {
  return `layer-mask-workflow:v1:${JSON.stringify({
    kind: options.kind,
    support: options.support,
    sourceLayerId: options.sourceLayer?.id ?? null,
    targetLayerId: options.targetLayer?.id ?? null,
    sourceHasMask: Boolean(options.sourceLayer?.mask),
    targetHasMask: Boolean(options.targetLayer?.mask),
    sourceHasBitmap: Boolean(options.sourceLayer?.bitmap),
    targetHasBitmap: Boolean(options.targetLayer?.bitmap),
    warnings: options.warnings.map((warning) => warning.code),
    blockers: options.blockers,
    previewModes: options.previewModes.map((mode) => ({
      mode: mode.mode,
      ready: mode.ready,
    })),
  })}`;
}

function buildLayerMaskOperationSignature(options: {
  kind: ImageLayerMaskOperationKind;
  support: ImageLayerMaskOperationSupport;
  layer: Pick<ImageLayer, 'id' | 'mask' | 'bitmap' | 'maskDensity' | 'maskFeather'> | null;
  warnings: ImageLayerMaskWorkflowWarning[];
  requestedSettings: ImageLayerMaskSettings;
  createMode: ImageLayerMaskCreateMode | null;
  selection: ImageLayerMaskSelectionSummary;
  mismatch: ImageLayerMaskPixelTargetMismatch | null;
}): string {
  return `layer-mask-operation:v1:${JSON.stringify({
    kind: options.kind,
    support: options.support,
    layerId: options.layer?.id ?? null,
    hasMask: Boolean(options.layer?.mask),
    hasBitmap: Boolean(options.layer?.bitmap),
    maskSize: options.layer?.mask
      ? { width: options.layer.mask.width, height: options.layer.mask.height }
      : null,
    bitmapSize: options.layer?.bitmap
      ? { width: options.layer.bitmap.width, height: options.layer.bitmap.height }
        : null,
    layerSettings: resolveImageLayerMaskSettings(options.layer),
    requestedSettings: options.requestedSettings,
    createMode: options.createMode,
    selection: options.selection,
    mismatch: options.mismatch
      ? {
          mask: options.mismatch.mask,
          pixels: options.mismatch.pixels,
        }
      : null,
    warnings: options.warnings.map((warning) => warning.code),
  })}`;
}

export function resolveLayerMaskBrushTargetValue(color: string, isEraser: boolean): number {
  if (isEraser) return 0;
  const rgb = parseColor(color);
  if (!rgb) return 255;
  return clampByte((rgb.r + rgb.g + rgb.b) / 3);
}

export function paintLayerMaskDabs(
  mask: LayerBitmap,
  layer: Pick<ImageLayer, 'x' | 'y'>,
  dabs: readonly BrushDab[],
  targetValue: number,
  selection?: SelectionMask | null,
): void {
  const imageData = getBitmapImageData(mask);
  const nextTarget = clampByte(targetValue);
  for (const dab of dabs) {
    paintLayerMaskDab(imageData, mask.width, mask.height, layer, dab, nextTarget, selection ?? null);
  }
  putBitmapImageData(mask, imageData);
}

export function createLayerMaskOverlayMask(
  layer: Pick<ImageLayer, 'x' | 'y' | 'mask' | 'maskDensity' | 'maskFeather'>,
  width: number,
  height: number,
): SelectionMask {
  const overlay = createMask(width, height);
  const mask = getProcessedLayerMaskImageData(layer);
  if (!mask) return overlay;

  for (let py = 0; py < mask.height; py += 1) {
    for (let px = 0; px < mask.width; px += 1) {
      const docX = Math.round(layer.x + px);
      const docY = Math.round(layer.y + py);
      if (docX < 0 || docY < 0 || docX >= width || docY >= height) continue;
      const maskAlpha = mask.data[(py * mask.width + px) * 4 + 3] ?? 0;
      overlay.data[docY * width + docX] = Math.max(
        overlay.data[docY * width + docX],
        255 - maskAlpha,
      );
    }
  }

  return overlay;
}

export function clampImageLayerMaskDensity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.round(value * 1000) / 1000;
}

export function clampImageLayerMaskFeather(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

export function sanitizeImageLayerMaskDensity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return clampImageLayerMaskDensity(value);
}

export function sanitizeImageLayerMaskFeather(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return clampImageLayerMaskFeather(value);
}

export function resolveImageLayerMaskSettings(
  layer: Pick<ImageLayer, 'maskDensity' | 'maskFeather'> | null | undefined,
): ImageLayerMaskSettings {
  return {
    density: layer?.maskDensity === undefined ? 1 : clampImageLayerMaskDensity(layer.maskDensity),
    feather: clampImageLayerMaskFeather(layer?.maskFeather ?? 0),
  };
}

export function getProcessedLayerMaskImageData(
  layer: Pick<ImageLayer, 'mask' | 'maskDensity' | 'maskFeather'>,
): ImageData | null {
  if (!layer.mask) return null;
  const settings = resolveImageLayerMaskSettings(layer);
  const source = getBitmapImageData(layer.mask);
  if (settings.density === 1 && settings.feather === 0) {
    return source;
  }

  const output = cloneImageData(source);
  const width = source.width;
  const height = source.height;
  let alpha: Uint8ClampedArray = new Uint8ClampedArray(width * height);

  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = source.data[index * 4 + 3];
  }

  const featherRadius = Math.round(settings.feather);
  if (featherRadius > 0) {
    alpha = applyAlphaBoxBlur(alpha, width, height, featherRadius);
  }

  for (let index = 0; index < alpha.length; index += 1) {
    const adjustedAlpha = applyMaskDensity(alpha[index], settings.density);
    const offset = index * 4;
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = adjustedAlpha;
  }

  return output;
}

export function applyLayerMaskToImageData(
  source: ImageData,
  layer: Pick<ImageLayer, 'mask' | 'maskDensity' | 'maskFeather'>,
): ImageData {
  const mask = getProcessedLayerMaskImageData(layer);
  if (!mask) return cloneImageData(source);

  const output = cloneImageData(source);
  const maskData = mask.data;
  const maskWidth = mask.width;
  const maskHeight = mask.height;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const maskAlpha =
        x < maskWidth && y < maskHeight
          ? maskData[(y * maskWidth + x) * 4 + 3]
          : 0;
      output.data[offset + 3] = Math.round((output.data[offset + 3] * maskAlpha) / 255);
    }
  }

  return output;
}

export function composeLayerBitmapWithMask(
  layer: Pick<ImageLayer, 'bitmap' | 'mask' | 'maskDensity' | 'maskFeather'>,
): LayerBitmap | null {
  if (!layer.bitmap) return null;
  if (!layer.mask) return layer.bitmap;
  const output = createBitmap(layer.bitmap.width, layer.bitmap.height);
  const imageData = applyLayerMaskToImageData(getBitmapImageData(layer.bitmap), layer);
  putBitmapImageData(output, imageData);
  return output;
}

export function createProcessedLayerMaskBitmap(
  layer: Pick<ImageLayer, 'mask' | 'maskDensity' | 'maskFeather'>,
): LayerBitmap | null {
  const imageData = getProcessedLayerMaskImageData(layer);
  const mask = layer.mask;
  if (!imageData || !mask) return null;
  const output = createBitmap(mask.width, mask.height);
  putBitmapImageData(output, imageData);
  return output;
}

function paintLayerMaskDab(
  imageData: ImageData,
  width: number,
  height: number,
  layer: Pick<ImageLayer, 'x' | 'y'>,
  dab: BrushDab,
  targetValue: number,
  selection: SelectionMask | null,
): void {
  const radiusX = Math.max(0.5, dab.size / 2);
  const radiusY = Math.max(0.5, radiusX * dab.roundness);
  const angle = (dab.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const alpha = clamp01(dab.opacity * dab.flow);
  const centerX = dab.x - layer.x;
  const centerY = dab.y - layer.y;
  const minX = Math.max(0, Math.floor(centerX - radiusX - 1));
  const maxX = Math.min(width, Math.ceil(centerX + radiusX + 1));
  const minY = Math.max(0, Math.floor(centerY - radiusY - 1));
  const maxY = Math.min(height, Math.ceil(centerY + radiusY + 1));

  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const dx = px + 0.5 - centerX;
      const dy = py + 0.5 - centerY;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const strength = sampleBrushStrength(dab, localX / radiusX, localY / radiusY);
      if (strength <= 0) continue;
      const selectionFactor = selection
        ? sampleSelectionFactor(selection, Math.round(layer.x + px), Math.round(layer.y + py))
        : 1;
      if (selectionFactor <= 0) continue;

      const offset = (py * width + px) * 4;
      const current = imageData.data[offset + 3];
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = clampByte(
        current + (targetValue - current) * alpha * strength * selectionFactor,
      );
    }
  }
}

function applyMaskDensity(alpha: number, density: number): number {
  if (density >= 1) return alpha;
  if (density <= 0) return 255;
  return clampByte(255 - (255 - alpha) * density);
}

function applyAlphaBoxBlur(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0 || width <= 0 || height <= 0) {
    return new Uint8ClampedArray(source);
  }

  const temp = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let count = 0;

    for (let xx = -radius; xx <= radius; xx += 1) {
      if (xx >= 0 && xx < width) {
        sum += source[y * width + xx];
        count += 1;
      }
    }

    for (let x = 0; x < width; x += 1) {
      temp[y * width + x] = clampByte(sum / count);

      const leavingX = x - radius;
      if (leavingX >= 0 && leavingX < width) {
        sum -= source[y * width + leavingX];
        count -= 1;
      }

      const enteringX = x + radius + 1;
      if (enteringX >= 0 && enteringX < width) {
        sum += source[y * width + enteringX];
        count += 1;
      }
    }
  }

  const output = new Uint8ClampedArray(source.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let count = 0;

    for (let yy = -radius; yy <= radius; yy += 1) {
      if (yy >= 0 && yy < height) {
        sum += temp[yy * width + x];
        count += 1;
      }
    }

    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = clampByte(sum / count);

      const leavingY = y - radius;
      if (leavingY >= 0 && leavingY < height) {
        sum -= temp[leavingY * width + x];
        count -= 1;
      }

      const enteringY = y + radius + 1;
      if (enteringY >= 0 && enteringY < height) {
        sum += temp[enteringY * width + x];
        count += 1;
      }
    }
  }

  return output;
}

function cloneImageData(imageData: ImageData): ImageData {
  const data = new Uint8ClampedArray(imageData.data.length);
  data.set(imageData.data);

  if (typeof ImageData === 'function') {
    try {
      return new ImageData(data, imageData.width, imageData.height);
    } catch {
      // Fall through to the structural clone for test stubs that do not expose
      // a browser-native ImageData constructor.
    }
  }

  return {
    width: imageData.width,
    height: imageData.height,
    data,
  } as ImageData;
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

function sampleBrushStrength(dab: BrushDab, normalizedX: number, normalizedY: number): number {
  const hardEdge = clamp01(dab.hardness);
  const distance = dab.tipShape === 'square'
    ? Math.max(Math.abs(normalizedX), Math.abs(normalizedY))
    : Math.hypot(normalizedX, normalizedY);
  if (distance > 1) return 0;
  if (hardEdge >= 0.999) return 1;
  if (distance <= hardEdge) return 1;
  return clamp01(1 - ((distance - hardEdge) / Math.max(0.001, 1 - hardEdge)));
}

function sampleSelectionFactor(selection: SelectionMask, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= selection.width || y >= selection.height) return 0;
  return (selection.data[y * selection.width + x] ?? 0) / 255;
}

function parseColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().toLowerCase();
  const longHex = /^#([0-9a-f]{6})$/.exec(hex);
  if (longHex) {
    return {
      r: Number.parseInt(longHex[1].slice(0, 2), 16),
      g: Number.parseInt(longHex[1].slice(2, 4), 16),
      b: Number.parseInt(longHex[1].slice(4, 6), 16),
    };
  }

  const shortHex = /^#([0-9a-f]{3})$/.exec(hex);
  if (shortHex) {
    return {
      r: Number.parseInt(shortHex[1][0] + shortHex[1][0], 16),
      g: Number.parseInt(shortHex[1][1] + shortHex[1][1], 16),
      b: Number.parseInt(shortHex[1][2] + shortHex[1][2], 16),
    };
  }

  if (hex === 'white') return { r: 255, g: 255, b: 255 };
  if (hex === 'black') return { r: 0, g: 0, b: 0 };
  return null;
}
