import {
  DEFAULT_SELECT_AND_MASK_SETTINGS,
  type SelectAndMaskPreviewMode,
  type SelectAndMaskSettings,
} from '../../types/imageEditor';
import type {
  LocalObjectSelectionCleanupPassMetadata,
  LocalObjectSelectionForegroundConfidenceSummary,
  LocalObjectSelectionSelectAndMaskReadinessDescriptor,
} from './ImageObjectSelection';
import { cloneMask, createMask, maskBoundingBox, type Point, type SelectionMask } from './SelectionMask';
import {
  growSelection,
  featherSelection,
  shrinkSelection,
  smoothSelection,
} from './photoshopQuickActions/selectionActions';

export { DEFAULT_SELECT_AND_MASK_SETTINGS } from '../../types/imageEditor';

export function buildSelectAndMaskPreviewMask(
  selection: SelectionMask,
  settings: SelectAndMaskSettings,
): SelectionMask {
  let next = cloneMask(selection);
  const smoothPasses = clampInteger(settings.smooth, 0, 16);
  const featherRadius = clampInteger(settings.feather, 0, 64);
  const shiftEdge = clampInteger(settings.shiftEdge, -64, 64);
  const contrast = clampInteger(settings.contrast, 0, 100);

  for (let index = 0; index < smoothPasses; index += 1) {
    next = smoothSelection(next);
  }

  if (featherRadius > 0) {
    next = featherSelection(next, featherRadius);
  }

  if (contrast > 0) {
    next = applySelectionContrast(next, contrast);
  }

  if (shiftEdge > 0) {
    next = growSelection(next, shiftEdge);
  } else if (shiftEdge < 0) {
    next = shrinkSelection(next, Math.abs(shiftEdge));
  }

  return next;
}

export interface RefineSelectionBrushStrokeOptions {
  mode: 'expand' | 'contract' | 'soften';
  points: Point[];
  radius?: number;
  strength?: number;
}

export interface SelectAndMaskBrushRefinementDescriptor {
  index: number;
  mode: RefineSelectionBrushStrokeOptions['mode'];
  pointCount: number;
  radius: number;
  strength: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  signature: string;
}

export interface SelectAndMaskOutputTargetDescriptor {
  mode: SelectAndMaskSettings['outputMode'];
  label: string;
  destructive: boolean;
  targetLayerId: string | null;
  alphaChannelName: string | null;
  signature: string;
}

export interface SelectAndMaskOutputRoutingDescriptor {
  readiness: 'ready' | 'blocked';
  requestedOutput: SelectAndMaskSettings['outputMode'];
  route: 'document-selection' | 'quick-mask-edit-buffer' | 'layer-mask-target' | 'alpha-channel';
  commitAction:
    | 'replace-active-selection'
    | 'enable-quick-mask-from-preview'
    | 'apply-preview-to-layer-mask'
    | 'create-alpha-channel-from-preview';
  targetLayerId: string | null;
  alphaChannelName: string | null;
  selectionRegistryWrite: boolean;
  quickMaskEnabledAfterCommit: boolean;
  layerMaskWrite: boolean;
  alphaChannelWrite: boolean;
  preservesSoftEdges: boolean;
  blockerCodes: SelectAndMaskInvalidSelectionBlocker['code'][];
  signature: string;
}

export interface SelectAndMaskPreviewDescriptor {
  mode: SelectAndMaskPreviewMode;
  matteMode: 'selection-alpha' | 'inverse-overlay';
  bounds: { x: number; y: number; width: number; height: number } | null;
  partialPixelCount: number;
  signature: string;
}

export interface SelectAndMaskLocalMattePreviewDescriptor {
  kind: 'local-matte-preview';
  mode: SelectAndMaskPreviewMode;
  localRenderer: 'selection-mask-alpha';
  previewRole: 'selection-alpha' | 'inverse-overlay';
  displayBackground: 'transparent' | 'ruby-overlay' | 'black' | 'white' | 'black-white';
  selectedPixelCount: number;
  rejectedPixelCount: number;
  partialPixelCount: number;
  coverageRatio: number;
  softEdgeRatio: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  signature: string;
}

export interface SelectAndMaskUnsupportedWarning {
  code:
    | 'select-mask-radius-unsupported'
    | 'select-mask-decontaminate-unsupported'
    | 'select-mask-refine-edge-unsupported';
  severity: 'warning';
  message: string;
}

export type SelectAndMaskReadinessState = 'ready' | 'ready-with-caveats' | 'blocked';

export type SelectAndMaskReadinessWarningCode =
  | 'select-mask-radius-unsupported'
  | 'select-mask-decontaminate-unsupported'
  | 'select-mask-refine-edge-unsupported'
  | 'object-selection-confidence-review'
  | 'object-selection-offline-ai-caveats'
  | 'empty-selection'
  | 'output-layer-target-missing'
  | 'alpha-channel-name-missing';

export interface SelectAndMaskReadinessDescriptor {
  state: SelectAndMaskReadinessState;
  warningCodes: SelectAndMaskReadinessWarningCode[];
}

export type SelectAndMaskWorkingSelectionType =
  | 'session-selection'
  | 'pixel-mask-preview'
  | 'quick-mask-handoff'
  | 'layer-mask-handoff'
  | 'alpha-channel-handoff';

export interface SelectAndMaskRefinementStateDescriptor {
  smooth: { requested: number; applied: boolean };
  feather: { requestedPx: number; applied: boolean };
  contrast: { requested: number; applied: boolean };
  shiftEdge: { requestedPx: number; applied: boolean };
  smartRadius: { requestedPx: number; applied: false };
  edgeDetection: 'local-mask-operators';
}

export interface SelectAndMaskMaskHandoffDescriptor {
  source: 'preview-selection-mask';
  target: 'selection' | 'quick-mask' | 'layer-mask' | 'alpha-channel';
  targetLayerId: string | null;
  alphaChannelName: string | null;
  preservesSoftEdges: boolean;
  destructive: false;
}

export interface SelectAndMaskInvalidSelectionBlocker {
  code: Extract<
    SelectAndMaskReadinessWarningCode,
    'empty-selection' | 'output-layer-target-missing' | 'alpha-channel-name-missing'
  >;
  severity: 'error';
  message: string;
}

export interface SelectAndMaskBatchActionSuitability {
  status: 'ready' | 'limited-ready' | 'blocked';
  actionRecordable: true;
  batchSafe: boolean;
  reason: string;
}

export type SelectAndMaskEdgeRefinementBlockerCode =
  | 'smart-radius-local-only'
  | 'edge-aware-refine-brush-unsupported'
  | 'semantic-hair-fur-refinement-unsupported'
  | 'decontaminate-colors-unsupported';

export interface SelectAndMaskEdgeRefinementBlocker {
  code: SelectAndMaskEdgeRefinementBlockerCode;
  severity: 'unsupported';
  blocksLocalPreview: boolean;
  blocksNativeParity: boolean;
  message: string;
}

export interface SelectAndMaskSaveLoadHandoffDescriptor {
  schemaVersion: 1;
  source: 'select-and-mask-planning-descriptor';
  roundTripSafe: boolean;
  maskSnapshotRequired: boolean;
  serializedFields: string[];
  volatileFields: string[];
  outputRouteSignature: string;
  mattePreviewSignature: string;
  signature: string;
}

export interface SelectAndMaskPlanningDescriptorOptions {
  settings: SelectAndMaskSettings;
  brushStrokes?: RefineSelectionBrushStrokeOptions[];
  refineRadius?: number;
  decontaminateColors?: boolean;
  targetLayerId?: string | null;
  alphaChannelName?: string | null;
  objectSelectionHandoff?: {
    mode: 'object' | 'subject';
    foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
    selectAndMaskReadiness: LocalObjectSelectionSelectAndMaskReadinessDescriptor;
    cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
    offlineAICaveats: string[];
  };
}

export interface SelectAndMaskObjectSelectionHandoffDescriptor {
  mode: 'object' | 'subject';
  readinessState: LocalObjectSelectionSelectAndMaskReadinessDescriptor['state'];
  recommendationCode: LocalObjectSelectionSelectAndMaskReadinessDescriptor['recommendationCode'];
  recommendedSettings: LocalObjectSelectionSelectAndMaskReadinessDescriptor['recommendedSettings'];
  foregroundConfidenceBand: LocalObjectSelectionForegroundConfidenceSummary['band'];
  foregroundConfidenceSummary: string;
  cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
  offlineAICaveats: string[];
  signature: string;
}

export interface SelectAndMaskRefinementHandoffDescriptor {
  source: 'manual-selection' | 'object-selection-handoff';
  mode: 'object' | 'subject' | null;
  readinessState: LocalObjectSelectionSelectAndMaskReadinessDescriptor['state'] | 'ready';
  recommendationCode: LocalObjectSelectionSelectAndMaskReadinessDescriptor['recommendationCode'] | 'manual-selection-review';
  reviewRequired: boolean;
  appliedSettingsMatchRecommendation: boolean;
  unsupportedFeatures: LocalObjectSelectionSelectAndMaskReadinessDescriptor['unsupportedFeatures'];
  warningCodes: SelectAndMaskReadinessWarningCode[];
  cleanupSignature: string | null;
  offlineAICaveats: string[];
  signature: string;
}

export interface SelectAndMaskPlanningDescriptor {
  kind: 'select-and-mask-plan';
  size: { width: number; height: number };
  settings: {
    enabled: boolean;
    previewMode: SelectAndMaskPreviewMode;
    smooth: number;
    feather: number;
    contrast: number;
    shiftEdge: number;
    refineRadius: number;
    decontaminateColors: boolean;
    decontaminateAmount: number;
    outputMode: SelectAndMaskSettings['outputMode'];
  };
  preview: SelectAndMaskPreviewDescriptor;
  mattePreview: SelectAndMaskLocalMattePreviewDescriptor;
  workingSelectionTypes: SelectAndMaskWorkingSelectionType[];
  refinementState: SelectAndMaskRefinementStateDescriptor;
  brushRefinements: SelectAndMaskBrushRefinementDescriptor[];
  outputTarget: SelectAndMaskOutputTargetDescriptor;
  outputRouting: SelectAndMaskOutputRoutingDescriptor;
  maskHandoff: SelectAndMaskMaskHandoffDescriptor;
  objectSelectionHandoff?: SelectAndMaskObjectSelectionHandoffDescriptor;
  refinementHandoff: SelectAndMaskRefinementHandoffDescriptor;
  readiness: SelectAndMaskReadinessDescriptor;
  unsupportedWarnings: SelectAndMaskUnsupportedWarning[];
  invalidSelectionBlockers: SelectAndMaskInvalidSelectionBlocker[];
  edgeRefinementBlockers: SelectAndMaskEdgeRefinementBlocker[];
  saveLoadHandoff: SelectAndMaskSaveLoadHandoffDescriptor;
  batchActionSuitability: SelectAndMaskBatchActionSuitability;
  signature: string;
}

export type SelectAndMaskReadinessLaneUnsupportedCode =
  | 'smart-radius-edge-algorithm-unsupported'
  | 'decontaminate-colors-edge-algorithm-unsupported'
  | 'dedicated-refine-workspace-ui-unsupported'
  | 'live-edge-brush-parity-unsupported'
  | 'photoshop-gimp-matte-preview-fidelity-unsupported';

export interface SelectAndMaskReadinessLaneUnsupportedState {
  code: SelectAndMaskReadinessLaneUnsupportedCode;
  area: 'edge-refinement' | 'workspace-ui' | 'matte-preview';
  supported: false;
  blocksLocalPreview: boolean;
  blocksNativeParity: boolean;
  fallback:
    | 'local-mask-operators'
    | 'metadata-only-warning'
    | 'planning-descriptor-and-existing-controls'
    | 'deterministic-expand-contract-soften-brush'
    | 'selection-mask-alpha-preview';
}

export interface SelectAndMaskReadinessLaneDescriptor {
  kind: 'select-and-mask-readiness-lane';
  stableHandoffId: string;
  state: SelectAndMaskReadinessState;
  outputRoute: SelectAndMaskOutputRoutingDescriptor;
  signatures: {
    refinementPlan: string;
    outputRoute: string;
    mattePreview: string;
    saveLoadHandoff: string;
  };
  unsupportedStates: SelectAndMaskReadinessLaneUnsupportedState[];
  signature: string;
}

export interface SelectAndMaskPreviewModeCoverageEntry {
  mode: SelectAndMaskPreviewMode;
  displayBackground: SelectAndMaskLocalMattePreviewDescriptor['displayBackground'];
  previewRole: SelectAndMaskLocalMattePreviewDescriptor['previewRole'];
  matteMode: SelectAndMaskPreviewDescriptor['matteMode'];
  mattePreviewSignature: string;
}

export interface SelectAndMaskPreviewModeCoverageDescriptor {
  kind: 'select-and-mask-preview-mode-coverage';
  modeCount: number;
  coversRicherEdgeVisualizationModes: true;
  dedicatedWorkspaceUi: true;
  modes: SelectAndMaskPreviewModeCoverageEntry[];
  signature: string;
}

const SELECT_AND_MASK_PREVIEW_MODES: SelectAndMaskPreviewMode[] = [
  'maskedAreas',
  'selectedAreas',
  'onBlack',
  'onWhite',
  'blackWhite',
];

export function buildSelectAndMaskPlanningDescriptor(
  selection: SelectionMask,
  options: SelectAndMaskPlanningDescriptorOptions,
): SelectAndMaskPlanningDescriptor {
  const settings = normalizeSelectAndMaskSettings(options.settings);
  const refineRadius = Math.max(0, Math.round(options.refineRadius ?? settings.refineRadius));
  const decontaminateColors = options.decontaminateColors ?? settings.decontaminateColors;
  const previewMask = buildSelectAndMaskPreviewMask(selection, settings);
  const previewBounds = maskBoundingBox(previewMask);
  const partialPixelCount = countPartialPixels(previewMask);
  const preview: SelectAndMaskPreviewDescriptor = {
    mode: settings.previewMode,
    matteMode: settings.previewMode === 'selectedAreas' || settings.previewMode === 'blackWhite'
      ? 'selection-alpha'
      : 'inverse-overlay',
    bounds: previewBounds,
    partialPixelCount,
    signature: [
      `select-mask-preview:v1:${selection.width}x${selection.height}`,
      settings.previewMode,
      `s${settings.smooth}`,
      `f${settings.feather}`,
      `c${settings.contrast}`,
      `shift${settings.shiftEdge}`,
      `bounds${formatBounds(previewBounds)}`,
      `partial${partialPixelCount}`,
    ].join(':'),
  };
  const mattePreview = buildSelectAndMaskLocalMattePreviewDescriptor({
    previewMask,
    previewMode: settings.previewMode,
    bounds: previewBounds,
    partialPixelCount,
  });
  const brushRefinements = (options.brushStrokes ?? []).map((stroke, index) => {
    const radius = Math.max(1, Math.floor(stroke.radius ?? 1));
    const strength = Math.max(1, Math.floor(stroke.strength ?? 1));
    const influence = rasterizeBrushStroke(selection.width, selection.height, stroke.points, radius);
    const bounds = maskBoundingBox(influence);
    return {
      index,
      mode: stroke.mode,
      pointCount: stroke.points.length,
      radius,
      strength,
      bounds,
      signature: `select-mask-brush:v1:${index}:${stroke.mode}:r${radius}:s${strength}:p${stroke.points.length}:b${formatBounds(bounds)}`,
    };
  });
  const outputTarget = buildSelectAndMaskOutputTargetDescriptor(
    settings.outputMode,
    options.targetLayerId ?? null,
    options.alphaChannelName ?? null,
  );
  const objectSelectionHandoff = buildSelectAndMaskObjectSelectionHandoff(options.objectSelectionHandoff);
  const invalidSelectionBlockers = buildSelectAndMaskInvalidSelectionBlockers({
    hasSelection: maskBoundingBox(selection) !== null,
    outputTarget,
  });
  const unsupportedWarnings = buildSelectAndMaskUnsupportedWarnings({
    ...options,
    refineRadius,
    decontaminateColors,
  });
  const objectSelectionWarningCodes = buildSelectAndMaskObjectSelectionWarningCodes(objectSelectionHandoff);
  const readiness = buildSelectAndMaskReadiness({
    objectSelectionWarningCodes,
    unsupportedWarningCodes: unsupportedWarnings.map((warning) => warning.code),
    blockerCodes: invalidSelectionBlockers.map((blocker) => blocker.code),
    previewPixelCount: previewMask.width * previewMask.height,
    partialPixelCount,
  });
  const preservesSoftEdges = settings.feather > 0 || partialPixelCount > 0;
  const maskHandoff = buildSelectAndMaskMaskHandoff(outputTarget, preservesSoftEdges);
  const outputRouting = buildSelectAndMaskOutputRoutingDescriptor(
    outputTarget,
    preservesSoftEdges,
    invalidSelectionBlockers,
  );
  const edgeRefinementBlockers = buildSelectAndMaskEdgeRefinementBlockers({
    ...options,
    refineRadius,
    decontaminateColors,
  });
  const saveLoadHandoff = buildSelectAndMaskSaveLoadHandoffDescriptor({
    settings,
    outputRouting,
    mattePreview,
    edgeRefinementBlockers,
  });
  const refinementHandoff = buildSelectAndMaskRefinementHandoff(
    options.objectSelectionHandoff,
    settings,
    objectSelectionWarningCodes,
  );

  return {
    kind: 'select-and-mask-plan',
    size: { width: selection.width, height: selection.height },
    settings,
    preview,
    mattePreview,
    workingSelectionTypes: [
      'session-selection',
      'pixel-mask-preview',
      'quick-mask-handoff',
      'layer-mask-handoff',
      'alpha-channel-handoff',
    ],
    refinementState: {
      smooth: { requested: settings.smooth, applied: settings.smooth > 0 },
      feather: { requestedPx: settings.feather, applied: settings.feather > 0 },
      contrast: { requested: settings.contrast, applied: settings.contrast > 0 },
      shiftEdge: { requestedPx: settings.shiftEdge, applied: settings.shiftEdge !== 0 },
      smartRadius: { requestedPx: refineRadius, applied: false },
      edgeDetection: 'local-mask-operators',
    },
    brushRefinements,
    outputTarget,
    outputRouting,
    maskHandoff,
    objectSelectionHandoff,
    refinementHandoff,
    readiness,
    unsupportedWarnings,
    invalidSelectionBlockers,
    edgeRefinementBlockers,
    saveLoadHandoff,
    batchActionSuitability: buildSelectAndMaskBatchActionSuitability(readiness),
    signature: [
      `select-mask-plan:v1:${selection.width}x${selection.height}`,
      settings.previewMode,
      `s${settings.smooth}`,
      `f${settings.feather}`,
      `c${settings.contrast}`,
      `shift${settings.shiftEdge}`,
      `radius${settings.refineRadius}`,
      `decontaminate${settings.decontaminateColors ? settings.decontaminateAmount : 0}`,
      `out-${settings.outputMode}`,
      `handoff-${objectSelectionHandoff?.recommendationCode ?? 'none'}`,
      `brush-${brushRefinements.length > 0 ? brushRefinements.map((brush) => brush.signature).join('|') : 'none'}`,
      `w-${unsupportedWarnings.length > 0 ? unsupportedWarnings.map((warning) => warning.code).join(',') : 'none'}`,
    ].join(':'),
  };
}

export function describeSelectAndMaskPreviewModeCoverage(
  selection: SelectionMask,
  settings: SelectAndMaskSettings = DEFAULT_SELECT_AND_MASK_SETTINGS,
): SelectAndMaskPreviewModeCoverageDescriptor {
  const modes = SELECT_AND_MASK_PREVIEW_MODES.map((previewMode) => {
    const plan = buildSelectAndMaskPlanningDescriptor(selection, {
      settings: {
        ...settings,
        previewMode,
      },
    });
    return {
      mode: previewMode,
      displayBackground: plan.mattePreview.displayBackground,
      previewRole: plan.mattePreview.previewRole,
      matteMode: plan.preview.matteMode,
      mattePreviewSignature: plan.mattePreview.signature,
    };
  });

  return {
    kind: 'select-and-mask-preview-mode-coverage',
    modeCount: modes.length,
    coversRicherEdgeVisualizationModes: true,
    dedicatedWorkspaceUi: true,
    modes,
    signature: [
      `select-mask-preview-coverage:v1:${selection.width}x${selection.height}`,
      `modes-${modes.map((mode) => mode.mode).join('|')}`,
      `bg-${modes.map((mode) => mode.displayBackground).join('|')}`,
      'workspace1',
    ].join(':'),
  };
}

export function describeSelectAndMaskReadinessLane(
  plan: SelectAndMaskPlanningDescriptor,
): SelectAndMaskReadinessLaneDescriptor {
  const stableHandoffId = [
    'select-mask-handoff:v1',
    `${plan.size.width}x${plan.size.height}`,
    plan.outputRouting.requestedOutput,
    plan.outputRouting.targetLayerId ?? 'none',
    plan.outputRouting.alphaChannelName ?? 'none',
  ].join(':');
  const unsupportedStates = buildSelectAndMaskReadinessLaneUnsupportedStates(plan);

  return {
    kind: 'select-and-mask-readiness-lane',
    stableHandoffId,
    state: plan.readiness.state,
    outputRoute: plan.outputRouting,
    signatures: {
      refinementPlan: plan.refinementHandoff.signature,
      outputRoute: plan.outputRouting.signature,
      mattePreview: plan.mattePreview.signature,
      saveLoadHandoff: plan.saveLoadHandoff.signature,
    },
    unsupportedStates,
    signature: [
      'select-mask-readiness-lane:v1',
      stableHandoffId,
      plan.readiness.state,
      plan.outputRouting.signature,
      plan.mattePreview.signature,
      unsupportedStates.map((state) => state.code).join('|') || 'none',
    ].join(':'),
  };
}

function buildSelectAndMaskReadinessLaneUnsupportedStates(
  plan: SelectAndMaskPlanningDescriptor,
): SelectAndMaskReadinessLaneUnsupportedState[] {
  const edgeBlockerCodes = new Set(plan.edgeRefinementBlockers.map((blocker) => blocker.code));
  const states: SelectAndMaskReadinessLaneUnsupportedState[] = [];

  if (edgeBlockerCodes.has('smart-radius-local-only')) {
    states.push({
      code: 'smart-radius-edge-algorithm-unsupported',
      area: 'edge-refinement',
      supported: false,
      blocksLocalPreview: false,
      blocksNativeParity: true,
      fallback: 'local-mask-operators',
    });
  }
  if (edgeBlockerCodes.has('decontaminate-colors-unsupported')) {
    states.push({
      code: 'decontaminate-colors-edge-algorithm-unsupported',
      area: 'edge-refinement',
      supported: false,
      blocksLocalPreview: false,
      blocksNativeParity: true,
      fallback: 'metadata-only-warning',
    });
  }

  states.push(
    {
      code: 'live-edge-brush-parity-unsupported',
      area: 'edge-refinement',
      supported: false,
      blocksLocalPreview: false,
      blocksNativeParity: true,
      fallback: 'deterministic-expand-contract-soften-brush',
    },
    {
      code: 'photoshop-gimp-matte-preview-fidelity-unsupported',
      area: 'matte-preview',
      supported: false,
      blocksLocalPreview: false,
      blocksNativeParity: true,
      fallback: 'selection-mask-alpha-preview',
    },
  );

  return states;
}

function buildSelectAndMaskLocalMattePreviewDescriptor(params: {
  previewMask: SelectionMask;
  previewMode: SelectAndMaskPreviewMode;
  bounds: { x: number; y: number; width: number; height: number } | null;
  partialPixelCount: number;
}): SelectAndMaskLocalMattePreviewDescriptor {
  const totalPixels = params.previewMask.width * params.previewMask.height;
  const selectedPixelCount = countSelectedPixels(params.previewMask);
  const rejectedPixelCount = Math.max(0, totalPixels - selectedPixelCount);
  const coverageRatio = roundToFixed(selectedAreaRatio(selectedPixelCount, Math.max(1, totalPixels)), 4);
  const softEdgeRatio = roundToFixed(
    selectedAreaRatio(params.partialPixelCount, Math.max(1, selectedPixelCount)),
    4,
  );
  const previewRole = params.previewMode === 'selectedAreas' || params.previewMode === 'blackWhite'
    ? 'selection-alpha'
    : 'inverse-overlay';
  const displayBackgroundByMode: Record<SelectAndMaskPreviewMode, SelectAndMaskLocalMattePreviewDescriptor['displayBackground']> = {
    maskedAreas: 'ruby-overlay',
    selectedAreas: 'transparent',
    onBlack: 'black',
    onWhite: 'white',
    blackWhite: 'black-white',
  };

  return {
    kind: 'local-matte-preview',
    mode: params.previewMode,
    localRenderer: 'selection-mask-alpha',
    previewRole,
    displayBackground: displayBackgroundByMode[params.previewMode],
    selectedPixelCount,
    rejectedPixelCount,
    partialPixelCount: params.partialPixelCount,
    coverageRatio,
    softEdgeRatio,
    bounds: params.bounds,
    signature: [
      `select-mask-matte:v1:${params.previewMask.width}x${params.previewMask.height}`,
      params.previewMode,
      previewRole,
      `bg-${displayBackgroundByMode[params.previewMode]}`,
      `sel${selectedPixelCount}`,
      `partial${params.partialPixelCount}`,
      `coverage${coverageRatio}`,
      `soft${softEdgeRatio}`,
      `bounds${formatBounds(params.bounds)}`,
    ].join(':'),
  };
}

function buildSelectAndMaskMaskHandoff(
  outputTarget: SelectAndMaskOutputTargetDescriptor,
  preservesSoftEdges: boolean,
): SelectAndMaskMaskHandoffDescriptor {
  const targetByMode: Record<SelectAndMaskSettings['outputMode'], SelectAndMaskMaskHandoffDescriptor['target']> = {
    selection: 'selection',
    quickMask: 'quick-mask',
    layerMask: 'layer-mask',
    newAlphaChannel: 'alpha-channel',
  };
  return {
    source: 'preview-selection-mask',
    target: targetByMode[outputTarget.mode],
    targetLayerId: outputTarget.targetLayerId,
    alphaChannelName: outputTarget.alphaChannelName,
    preservesSoftEdges,
    destructive: false,
  };
}

function buildSelectAndMaskOutputRoutingDescriptor(
  outputTarget: SelectAndMaskOutputTargetDescriptor,
  preservesSoftEdges: boolean,
  blockers: SelectAndMaskInvalidSelectionBlocker[],
): SelectAndMaskOutputRoutingDescriptor {
  const blockerCodes = blockers.map((blocker) => blocker.code);
  const readiness = blockerCodes.length > 0 ? 'blocked' : 'ready';
  const routeByMode: Record<SelectAndMaskSettings['outputMode'], SelectAndMaskOutputRoutingDescriptor['route']> = {
    selection: 'document-selection',
    quickMask: 'quick-mask-edit-buffer',
    layerMask: 'layer-mask-target',
    newAlphaChannel: 'alpha-channel',
  };
  const commitActionByMode: Record<
    SelectAndMaskSettings['outputMode'],
    SelectAndMaskOutputRoutingDescriptor['commitAction']
  > = {
    selection: 'replace-active-selection',
    quickMask: 'enable-quick-mask-from-preview',
    layerMask: 'apply-preview-to-layer-mask',
    newAlphaChannel: 'create-alpha-channel-from-preview',
  };
  const selectionRegistryWrite = outputTarget.mode === 'selection' || outputTarget.mode === 'quickMask';
  const quickMaskEnabledAfterCommit = outputTarget.mode === 'quickMask';
  const layerMaskWrite = outputTarget.mode === 'layerMask';
  const alphaChannelWrite = outputTarget.mode === 'newAlphaChannel';
  const route = routeByMode[outputTarget.mode];

  return {
    readiness,
    requestedOutput: outputTarget.mode,
    route,
    commitAction: commitActionByMode[outputTarget.mode],
    targetLayerId: outputTarget.targetLayerId,
    alphaChannelName: outputTarget.alphaChannelName,
    selectionRegistryWrite,
    quickMaskEnabledAfterCommit,
    layerMaskWrite,
    alphaChannelWrite,
    preservesSoftEdges,
    blockerCodes,
    signature: [
      'select-mask-route:v1',
      outputTarget.mode,
      readiness,
      route,
      `selection${selectionRegistryWrite ? 1 : 0}`,
      `quick${quickMaskEnabledAfterCommit ? 1 : 0}`,
      `layer${layerMaskWrite ? 1 : 0}`,
      `alpha${alphaChannelWrite ? 1 : 0}`,
      `target${outputTarget.targetLayerId ?? 'none'}`,
      `alpha${outputTarget.alphaChannelName ?? 'none'}`,
      `soft${preservesSoftEdges ? 1 : 0}`,
      `blockers${blockerCodes.length > 0 ? blockerCodes.join('|') : 'none'}`,
    ].join(':'),
  };
}

function buildSelectAndMaskEdgeRefinementBlockers(
  options: SelectAndMaskPlanningDescriptorOptions,
): SelectAndMaskEdgeRefinementBlocker[] {
  const blockers: SelectAndMaskEdgeRefinementBlocker[] = [];
  if ((options.refineRadius ?? 0) > 0) {
    blockers.push({
      code: 'smart-radius-local-only',
      severity: 'unsupported',
      blocksLocalPreview: false,
      blocksNativeParity: true,
      message: 'Smart Radius is recorded as requested, but the local matte preview uses deterministic mask operators instead of learned edge detection.',
    });
  }
  blockers.push({
    code: 'edge-aware-refine-brush-unsupported',
    severity: 'unsupported',
    blocksLocalPreview: false,
    blocksNativeParity: true,
    message: 'Refine Edge Brush parity is unavailable; brush strokes are deterministic expand, contract, or soften masks without edge-aware sampling.',
  });
  if (options.objectSelectionHandoff?.selectAndMaskReadiness.unsupportedFeatures.includes('semantic-hair-fur-refinement')) {
    blockers.push({
      code: 'semantic-hair-fur-refinement-unsupported',
      severity: 'unsupported',
      blocksLocalPreview: false,
      blocksNativeParity: true,
      message: 'Semantic hair and fur refinement is not available; object-selection handoffs require local matte review before edge-critical output.',
    });
  }
  if (options.decontaminateColors === true) {
    blockers.push({
      code: 'decontaminate-colors-unsupported',
      severity: 'unsupported',
      blocksLocalPreview: false,
      blocksNativeParity: true,
      message: 'Decontaminate Colors is persisted as a caveat only and is not applied to source pixels or matte colors.',
    });
  }
  return blockers;
}

function buildSelectAndMaskSaveLoadHandoffDescriptor(params: {
  settings: SelectAndMaskPlanningDescriptor['settings'];
  outputRouting: SelectAndMaskOutputRoutingDescriptor;
  mattePreview: SelectAndMaskLocalMattePreviewDescriptor;
  edgeRefinementBlockers: SelectAndMaskEdgeRefinementBlocker[];
}): SelectAndMaskSaveLoadHandoffDescriptor {
  const serializedFields = [
    'settings',
    'preview-signature',
    'matte-preview',
    'output-routing',
    'refinement-handoff',
    'brush-refinement-descriptors',
    'edge-refinement-blockers',
  ];
  const volatileFields = [
    'preview-mask-pixels',
    'edge-aware-brush-samples',
    'ai-subject-model-state',
  ];
  const blockerCodes = params.edgeRefinementBlockers.map((blocker) => blocker.code);

  return {
    schemaVersion: 1,
    source: 'select-and-mask-planning-descriptor',
    roundTripSafe: true,
    maskSnapshotRequired: true,
    serializedFields,
    volatileFields,
    outputRouteSignature: params.outputRouting.signature,
    mattePreviewSignature: params.mattePreview.signature,
    signature: [
      'select-mask-save-load:v1',
      params.settings.previewMode,
      `out-${params.settings.outputMode}`,
      `route-${params.outputRouting.signature}`,
      `matte-${params.mattePreview.signature}`,
      `blockers${blockerCodes.length > 0 ? blockerCodes.join('|') : 'none'}`,
    ].join(':'),
  };
}

function buildSelectAndMaskRefinementHandoff(
  handoff: SelectAndMaskPlanningDescriptorOptions['objectSelectionHandoff'],
  settings: SelectAndMaskPlanningDescriptor['settings'],
  warningCodes: SelectAndMaskReadinessWarningCode[],
): SelectAndMaskRefinementHandoffDescriptor {
  if (!handoff) {
    return {
      source: 'manual-selection',
      mode: null,
      readinessState: 'ready',
      recommendationCode: 'manual-selection-review',
      reviewRequired: false,
      appliedSettingsMatchRecommendation: false,
      unsupportedFeatures: [],
      warningCodes: [],
      cleanupSignature: null,
      offlineAICaveats: [],
      signature: 'select-mask-refinement-handoff:v1:manual-selection:none:ready:manual-selection-review:review0:settings0:unsupportednone:cleanupnone',
    };
  }

  const recommended = handoff.selectAndMaskReadiness.recommendedSettings;
  const appliedSettingsMatchRecommendation = settings.smooth === recommended.smooth
    && settings.feather === recommended.feather
    && settings.contrast === recommended.contrast
    && settings.shiftEdge === recommended.shiftEdge;
  const unsupportedFeatures = handoff.selectAndMaskReadiness.unsupportedFeatures;
  const reviewRequired = handoff.selectAndMaskReadiness.state !== 'ready'
    || handoff.selectAndMaskReadiness.retainedForegroundLimits.edgeReviewRequired
    || warningCodes.length > 0;

  return {
    source: 'object-selection-handoff',
    mode: handoff.mode,
    readinessState: handoff.selectAndMaskReadiness.state,
    recommendationCode: handoff.selectAndMaskReadiness.recommendationCode,
    reviewRequired,
    appliedSettingsMatchRecommendation,
    unsupportedFeatures,
    warningCodes,
    cleanupSignature: handoff.cleanupPassMetadata.signature,
    offlineAICaveats: handoff.offlineAICaveats,
    signature: [
      'select-mask-refinement-handoff:v1',
      'object-selection',
      handoff.mode,
      handoff.selectAndMaskReadiness.state,
      handoff.selectAndMaskReadiness.recommendationCode,
      `review${reviewRequired ? 1 : 0}`,
      `settings${appliedSettingsMatchRecommendation ? 1 : 0}`,
      `unsupported${unsupportedFeatures.length > 0 ? unsupportedFeatures.join('|') : 'none'}`,
      `cleanup${handoff.cleanupPassMetadata.signature}`,
    ].join(':'),
  };
}

export function refineSelectionMaskWithBrushStroke(
  selection: SelectionMask,
  options: RefineSelectionBrushStrokeOptions,
): SelectionMask {
  const radius = Math.max(1, Math.floor(options.radius ?? 1));
  const strength = Math.max(1, Math.floor(options.strength ?? 1));
  const influence = rasterizeBrushStroke(selection.width, selection.height, options.points, radius);
  if (influence.data.every((value) => value === 0)) {
    return cloneMask(selection);
  }

  switch (options.mode) {
    case 'expand':
      return applyInfluenceBlend(selection, influence, growSelection(selection, strength));
    case 'contract':
      return contractSelectionAlongInfluence(selection, influence, strength);
    case 'soften':
      return applyInfluenceBlend(selection, influence, featherSelection(selection, strength));
  }
}

function normalizeSelectAndMaskSettings(settings: SelectAndMaskSettings): SelectAndMaskPlanningDescriptor['settings'] {
  return {
    enabled: settings.enabled === true,
    previewMode: settings.previewMode,
    smooth: clampInteger(settings.smooth, 0, 16),
    feather: clampInteger(settings.feather, 0, 64),
    contrast: clampInteger(settings.contrast, 0, 100),
    shiftEdge: clampInteger(settings.shiftEdge, -64, 64),
    refineRadius: clampInteger(settings.refineRadius ?? 0, 0, 64),
    decontaminateColors: settings.decontaminateColors === true,
    decontaminateAmount: clampNumber(settings.decontaminateAmount ?? 0, 0, 1),
    outputMode: settings.outputMode,
  };
}

function buildSelectAndMaskOutputTargetDescriptor(
  mode: SelectAndMaskSettings['outputMode'],
  targetLayerId: string | null,
  alphaChannelName: string | null,
): SelectAndMaskOutputTargetDescriptor {
  const labelByMode: Record<SelectAndMaskSettings['outputMode'], string> = {
    selection: 'Selection',
    quickMask: 'Quick Mask',
    layerMask: 'Layer Mask',
    newAlphaChannel: 'New Alpha Channel',
  };
  const resolvedTargetLayerId = mode === 'layerMask' ? targetLayerId : null;
  const resolvedAlphaChannelName = mode === 'newAlphaChannel' ? alphaChannelName : null;
  return {
    mode,
    label: labelByMode[mode],
    destructive: false,
    targetLayerId: resolvedTargetLayerId,
    alphaChannelName: resolvedAlphaChannelName,
    signature: `select-mask-output:v1:${mode}:layer-${resolvedTargetLayerId ?? 'none'}:alpha-${resolvedAlphaChannelName ?? 'none'}`,
  };
}

function buildSelectAndMaskUnsupportedWarnings(
  options: SelectAndMaskPlanningDescriptorOptions,
): SelectAndMaskUnsupportedWarning[] {
  const warnings: SelectAndMaskUnsupportedWarning[] = [];
  warnings.push({
    code: 'select-mask-refine-edge-unsupported',
    severity: 'warning',
    message: 'Edge refinement is local-only and lacks full AI/edge-aware refinement parity; refine controls are intentionally planning and preview-limited.',
  });
  if ((options.refineRadius ?? 0) > 0) {
    warnings.push({
      code: 'select-mask-radius-unsupported',
      severity: 'warning',
      message: 'Smart Radius / edge detection radius is tracked for planning only and is not applied by the local matte builder.',
    });
  }
  if (options.decontaminateColors === true) {
    warnings.push({
      code: 'select-mask-decontaminate-unsupported',
      severity: 'warning',
      message: 'Decontaminate Colors is tracked for planning only and is not applied to pixels by the local matte builder.',
    });
  }
  return warnings;
}

function buildSelectAndMaskInvalidSelectionBlockers(params: {
  hasSelection: boolean;
  outputTarget: SelectAndMaskOutputTargetDescriptor;
}): SelectAndMaskInvalidSelectionBlocker[] {
  const blockers: SelectAndMaskInvalidSelectionBlocker[] = [];
  if (!params.hasSelection) {
    blockers.push({
      code: 'empty-selection',
      severity: 'error',
      message: 'Select and Mask requires a non-empty source selection before refinement or handoff.',
    });
  }
  if (params.outputTarget.mode === 'layerMask' && !params.outputTarget.targetLayerId) {
    blockers.push({
      code: 'output-layer-target-missing',
      severity: 'error',
      message: 'Layer Mask output requires a target layer id for deterministic mask handoff.',
    });
  }
  if (params.outputTarget.mode === 'newAlphaChannel' && !params.outputTarget.alphaChannelName) {
    blockers.push({
      code: 'alpha-channel-name-missing',
      severity: 'error',
      message: 'New Alpha Channel output requires a stable alpha channel name.',
    });
  }
  return blockers;
}

function buildSelectAndMaskBatchActionSuitability(
  readiness: SelectAndMaskReadinessDescriptor,
): SelectAndMaskBatchActionSuitability {
  if (readiness.state === 'blocked') {
    return {
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      reason: 'Select and Mask needs a non-empty source selection and valid per-document output target before batch playback.',
    };
  }
  return {
    status: readiness.state === 'ready' ? 'ready' : 'limited-ready',
    actionRecordable: true,
    batchSafe: readiness.state === 'ready',
    reason: readiness.state === 'ready'
      ? 'Select and Mask settings can be recorded when each document supplies a valid active selection and output target.'
      : 'Select and Mask can be recorded, but unsupported edge controls and soft-edge caveats require per-document review.',
  };
}

function buildSelectAndMaskReadiness(params: {
  objectSelectionWarningCodes: SelectAndMaskReadinessWarningCode[];
  unsupportedWarningCodes: SelectAndMaskReadinessWarningCode[];
  blockerCodes: SelectAndMaskReadinessWarningCode[];
  previewPixelCount: number;
  partialPixelCount: number;
}): SelectAndMaskReadinessDescriptor {
  const warningCodes = [
    ...params.objectSelectionWarningCodes,
    ...params.unsupportedWarningCodes,
    ...params.blockerCodes,
  ];
  if (params.previewPixelCount === 0 || params.blockerCodes.length > 0) {
    return {
      state: 'blocked',
      warningCodes,
    };
  }
  if (warningCodes.length > 0 || params.partialPixelCount > 0) {
    return {
      state: 'ready-with-caveats',
      warningCodes,
    };
  }
  return {
    state: 'ready',
    warningCodes,
  };
}

function buildSelectAndMaskObjectSelectionHandoff(
  handoff: SelectAndMaskPlanningDescriptorOptions['objectSelectionHandoff'],
): SelectAndMaskObjectSelectionHandoffDescriptor | undefined {
  if (!handoff) return undefined;
  return {
    mode: handoff.mode,
    readinessState: handoff.selectAndMaskReadiness.state,
    recommendationCode: handoff.selectAndMaskReadiness.recommendationCode,
    recommendedSettings: handoff.selectAndMaskReadiness.recommendedSettings,
    foregroundConfidenceBand: handoff.foregroundConfidenceSummary.band,
    foregroundConfidenceSummary: handoff.foregroundConfidenceSummary.summary,
    cleanupPassMetadata: handoff.cleanupPassMetadata,
    offlineAICaveats: handoff.offlineAICaveats,
    signature: [
      'select-mask-object-handoff:v1',
      handoff.mode,
      handoff.selectAndMaskReadiness.state,
      handoff.selectAndMaskReadiness.recommendationCode,
      handoff.foregroundConfidenceSummary.band,
      handoff.selectAndMaskReadiness.signature,
    ].join(':'),
  };
}

function buildSelectAndMaskObjectSelectionWarningCodes(
  handoff: SelectAndMaskObjectSelectionHandoffDescriptor | undefined,
): SelectAndMaskReadinessWarningCode[] {
  if (!handoff) return [];
  const warnings: SelectAndMaskReadinessWarningCode[] = [];
  if (handoff.readinessState !== 'ready' || handoff.foregroundConfidenceBand !== 'high') {
    warnings.push('object-selection-confidence-review');
  }
  if (handoff.offlineAICaveats.length > 0) {
    warnings.push('object-selection-offline-ai-caveats');
  }
  return warnings;
}

function countPartialPixels(mask: SelectionMask): number {
  let count = 0;
  for (const value of mask.data) {
    if (value > 0 && value < 255) count += 1;
  }
  return count;
}

function countSelectedPixels(mask: SelectionMask): number {
  let count = 0;
  for (const value of mask.data) {
    if (value > 0) count += 1;
  }
  return count;
}

function selectedAreaRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function roundToFixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function formatBounds(bounds: { x: number; y: number; width: number; height: number } | null): string {
  return bounds ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}` : 'none';
}

export function createSelectAndMaskMatteMask(
  selection: SelectionMask | null,
  width: number,
  height: number,
  previewMode: SelectAndMaskPreviewMode,
): SelectionMask {
  const base = selection ? cloneMask(selection) : createMask(width, height);
  if (previewMode === 'selectedAreas' || previewMode === 'blackWhite') {
    return base;
  }

  const overlay = createMask(width, height);
  for (let index = 0; index < overlay.data.length; index += 1) {
    overlay.data[index] = 255 - base.data[index];
  }
  return overlay;
}

function applySelectionContrast(selection: SelectionMask, contrast: number): SelectionMask {
  const factor = 1 + clampInteger(contrast, 0, 100) / 20;
  const next = cloneMask(selection);
  for (let index = 0; index < next.data.length; index += 1) {
    const centered = next.data[index] - 128;
    next.data[index] = clampByte(centered * factor + 128);
  }
  return next;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SELECT_AND_MASK_SETTINGS.shiftEdge;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function applyInfluenceBlend(
  selection: SelectionMask,
  influence: SelectionMask,
  refined: SelectionMask,
): SelectionMask {
  const next = cloneMask(selection);
  for (let index = 0; index < next.data.length; index += 1) {
    if (influence.data[index] === 0) continue;
    next.data[index] = refined.data[index];
  }
  return next;
}

function contractSelectionAlongInfluence(
  selection: SelectionMask,
  influence: SelectionMask,
  strength: number,
): SelectionMask {
  let current = cloneMask(selection);
  for (let pass = 0; pass < strength; pass += 1) {
    const next = cloneMask(current);
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const index = y * current.width + x;
        if (influence.data[index] === 0 || current.data[index] === 0) continue;
        if (hasOutsideNeighbor(current, x, y)) {
          next.data[index] = 0;
        }
      }
    }
    current = next;
  }
  return current;
}

function hasOutsideNeighbor(mask: SelectionMask, x: number, y: number): boolean {
  return (
    x === 0 ||
    x === mask.width - 1 ||
    y === 0 ||
    y === mask.height - 1 ||
    mask.data[y * mask.width + (x - 1)] === 0 ||
    mask.data[y * mask.width + (x + 1)] === 0 ||
    mask.data[(y - 1) * mask.width + x] === 0 ||
    mask.data[(y + 1) * mask.width + x] === 0
  );
}

function rasterizeBrushStroke(
  width: number,
  height: number,
  points: Point[],
  radius: number,
): SelectionMask {
  const stroke = createMask(width, height);
  if (points.length === 0) {
    return stroke;
  }
  if (points.length === 1) {
    stampBrushCircle(stroke, points[0], radius);
    return stroke;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      stampBrushCircle(stroke, {
        x: start.x + dx * t,
        y: start.y + dy * t,
      }, radius);
    }
  }
  return stroke;
}

function stampBrushCircle(mask: SelectionMask, point: Point, radius: number): void {
  const minX = Math.max(0, Math.floor(point.x - radius));
  const maxX = Math.min(mask.width - 1, Math.ceil(point.x + radius));
  const minY = Math.max(0, Math.floor(point.y - radius));
  const maxY = Math.min(mask.height - 1, Math.ceil(point.y + radius));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - point.x;
      const dy = y + 0.5 - point.y;
      if (dx * dx + dy * dy > radiusSquared) continue;
      mask.data[y * mask.width + x] = 255;
    }
  }
}
