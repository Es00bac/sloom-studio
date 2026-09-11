import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  createMask,
  isMaskEmpty,
  maskBoundingBox,
  toSnapshot,
  type SelectionMask,
} from './SelectionMask';
import { getSelection, setSelection } from './selectionRegistry';
import { getBitmapImageData } from './LayerBitmap';

export interface LocalObjectSelectionOptions {
  selectionMode?: 'object' | 'subject';
  alphaThreshold?: number;
  luminanceThreshold?: number;
  readLayerImageData?: (layer: ImageLayer) => ImageData | null;
  minComponentArea?: number;
  includeDisconnectedIslands?: boolean;
  fillHoles?: boolean;
  cleanupPasses?: number;
}

export interface LocalObjectSelectionResult {
  mask: SelectionMask;
  bounds: { x: number; y: number; width: number; height: number };
  sourceLayerId: string;
}

export interface LocalObjectSelectionComponentDiagnostics {
  boundsArea: number;
  density: number;
  touchesCanvasEdge: boolean;
  selectionRole: 'retained' | 'rejected-below-min-area' | 'rejected-not-largest';
}

export interface LocalObjectSelectionComponentDescriptor {
  id: string;
  area: number;
  bounds: { x: number; y: number; width: number; height: number };
  selected: boolean;
  rejectedReason: 'below-min-area' | 'not-largest' | null;
  diagnostics: LocalObjectSelectionComponentDiagnostics;
}

export interface LocalObjectSelectionComponentSummary {
  componentCount: number;
  selectedComponentCount: number;
  selectedArea: number;
  rejectedArea: number;
  largestComponentArea: number;
}

export type LocalObjectSelectionReadinessState = 'ready' | 'ready-with-caveats' | 'blocked';
export type LocalObjectSelectionReadinessWarningCode =
  | 'ai-subject-detection-unsupported'
  | 'no-detected-foreground'
  | 'all-foreground-filtered';

export interface LocalObjectSelectionReadinessDescriptor {
  mode: 'object' | 'subject';
  state: LocalObjectSelectionReadinessState;
  warningCodes: LocalObjectSelectionReadinessWarningCode[];
}

export interface LocalObjectSelectionForegroundScore {
  sourcePixelCount: number;
  foregroundPixelCount: number;
  selectedArea: number;
  rejectedArea: number;
  selectedToForegroundRatio: number;
  selectedToImageRatio: number;
  score: number;
}

export interface LocalObjectSelectionSubjectDetectionDescriptor {
  requested: boolean;
  state: 'not-requested' | 'local-heuristic';
  implementation: 'not-run' | 'local-border-contrast-saliency';
  model: null;
  fallbackDetector: 'local-alpha-luminance-components' | 'local-border-contrast-subject-heuristic';
  confidenceSource: 'heuristic-foreground-score';
  warningCodes: Extract<LocalObjectSelectionReadinessWarningCode, 'ai-subject-detection-unsupported'>[];
  message: string;
}

export interface LocalObjectSelectionHandoffMetadataDescriptor {
  localOnly: true;
  source: 'layer-bitmap-image-data';
  selectionSpace: 'source-image-pixels';
  outputSpace: 'document-selection';
  writesDocumentSelection: true;
  retainedObjectIds: string[];
  selectedArea: number;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  refineTarget: 'select-and-mask';
  requiresSelectAndMaskReview: boolean;
  confidenceBand: LocalObjectSelectionForegroundConfidenceSummary['band'];
  signature: string;
}

export interface LocalObjectSelectionForegroundDiagnosticsDescriptor {
  sourcePixelCount: number;
  foregroundPixelCount: number;
  componentCount: number;
  selectedComponentIds: string[];
  rejectedComponentIds: string[];
  edgeTouchingComponentIds: string[];
  foregroundCoverageRatio: number;
  selectedForegroundRatio: number;
  selectedBoundsArea: number;
  selectedDensity: number;
  signature: string;
}

export interface LocalObjectSelectionConfidenceDiagnosticsDescriptor {
  band: LocalObjectSelectionForegroundConfidenceSummary['band'];
  coverageBand: 'none' | 'tiny' | 'sparse' | 'balanced' | 'dominant';
  foregroundCoverageRatio: number;
  selectedForegroundRatio: number;
  selectedToImageRatio: number;
  selectedDensity: number;
  edgeTouchingRetainedComponentCount: number;
  edgeTouchingRejectedComponentCount: number;
  edgeRisk: 'low' | 'medium' | 'high';
  reviewRecommended: boolean;
  reviewCodes: Array<
    | 'subject-ai-fallback'
    | 'rejected-edge-foreground'
    | 'selected-edge-foreground'
    | 'filtered-foreground'
    | 'disconnected-components'
    | 'low-confidence'
    | 'confidence-review'
  >;
  signature: string;
}

export interface LocalObjectSelectionRefineHandoffDescriptor {
  target: 'select-and-mask';
  required: boolean;
  reason: string;
  caveat: string;
  selectAndMaskReadiness: LocalObjectSelectionSelectAndMaskReadinessDescriptor;
  cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
  offlineAICaveats: string[];
}

export interface LocalObjectSelectionMetadataDescriptor {
  detector: 'local-alpha-luminance-components' | 'local-border-contrast-subject-heuristic';
  source: 'layer-bitmap-image-data';
  confidenceModel: 'heuristic-foreground-score';
  photoshopEquivalent: 'object-selection' | 'select-subject';
  retainedObjectIds: string[];
}

export interface LocalObjectSelectionMaskHandoffDescriptor {
  source: 'local-component-mask';
  target: 'document-selection';
  refineTarget: 'select-and-mask';
  hasSelection: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export type LocalObjectSelectionUnsupportedCode =
  | 'ai-subject-detection-unsupported'
  | 'cloud-object-finder-unsupported';

export interface LocalObjectSelectionUnsupportedState {
  code: LocalObjectSelectionUnsupportedCode;
  severity: 'unsupported';
  message: string;
}

export type LocalObjectSelectionUnsupportedRefinementCode =
  | 'ai-subject-detection-unsupported'
  | 'edge-aware-object-brush-unsupported';

export interface LocalObjectSelectionUnsupportedRefinementState {
  code: LocalObjectSelectionUnsupportedRefinementCode;
  stage: 'subject-detection' | 'select-and-mask-refinement';
  severity: 'unsupported';
  recoverableWith: 'local-alpha-luminance-components' | 'local-border-contrast-subject-heuristic' | 'select-and-mask-local-brush';
  message: string;
}

export interface LocalObjectSelectionInvalidBlocker {
  code: 'no-detected-foreground' | 'all-foreground-filtered';
  severity: 'error';
  message: string;
}

export interface LocalObjectSelectionBatchActionSuitability {
  status: 'ready' | 'limited-ready' | 'blocked';
  actionRecordable: true;
  batchSafe: boolean;
  reason: string;
}

export interface LocalObjectSelectionCleanupDescriptor {
  includeDisconnectedIslands: boolean;
  minComponentArea: number;
  fillHoles: boolean;
  cleanupPasses: number;
  estimatedHolePixelsFilled: number;
  edgeCleanupEnabled: boolean;
}

export interface LocalObjectSelectionCleanupPassMetadata {
  requestedPasses: number;
  appliedPasses: number;
  holeFillApplied: boolean;
  estimatedHolePixelsFilled: number;
  edgeCleanupEnabled: boolean;
  signature: string;
}

export interface LocalObjectSelectionForegroundConfidenceSummary {
  band: 'high' | 'medium' | 'low' | 'none';
  score: number;
  selectedToForegroundRatio: number;
  selectedToImageRatio: number;
  summary: string;
  reviewRecommended: boolean;
}

export interface LocalObjectSelectionSaveLoadHandoffMetadataDescriptor {
  schemaVersion: 1;
  source: 'local-object-selection-plan';
  localOnly: true;
  stableForSaveLoad: boolean;
  maskSnapshotRecommended: boolean;
  selectionSpace: 'source-image-pixels';
  outputSpace: 'document-selection';
  serializedFields: string[];
  volatileFields: string[];
  handoffSignature: string;
  confidenceSignature: string;
  signature: string;
}

export interface LocalObjectSelectionSelectAndMaskReadinessDescriptor {
  state: LocalObjectSelectionReadinessState;
  recommendationCode:
    | 'selection-unavailable'
    | 'single-component-minimal-refine'
    | 'component-edge-review'
    | 'subject-fragment-cleanup-review';
  unsupportedFeatures: Array<
    'semantic-hair-fur-refinement' | 'decontaminate-colors' | 'radius-brush-edge-learning'
  >;
  retainedForegroundLimits: {
    retainedComponentCount: number;
    rejectedComponentCount: number;
    disconnectedForeground: boolean;
    edgeReviewRequired: boolean;
    maximumComponentsBeforeManualCleanup: number;
  };
  recommendedSettings: {
    smooth: number;
    feather: number;
    contrast: number;
    shiftEdge: number;
  };
  reasons: string[];
  warnings: Array<{
    code: 'select-mask-multi-component-review' | 'select-mask-local-edge-refine-only';
    severity: 'warning';
    message: string;
  }>;
  signature: string;
}

export interface LocalObjectSelectionPlanDescriptor {
  kind: 'local-object-selection-plan';
  mode: 'object' | 'subject';
  size: { width: number; height: number };
  thresholds: { alpha: number; luminance: number };
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  foregroundScore: LocalObjectSelectionForegroundScore;
  foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
  foregroundDiagnostics: LocalObjectSelectionForegroundDiagnosticsDescriptor;
  confidenceDiagnostics: LocalObjectSelectionConfidenceDiagnosticsDescriptor;
  readiness: LocalObjectSelectionReadinessDescriptor;
  subjectDetection: LocalObjectSelectionSubjectDetectionDescriptor;
  refineHandoff: LocalObjectSelectionRefineHandoffDescriptor;
  handoffMetadata: LocalObjectSelectionHandoffMetadataDescriptor;
  saveLoadHandoffMetadata: LocalObjectSelectionSaveLoadHandoffMetadataDescriptor;
  objectSelectionMetadata: LocalObjectSelectionMetadataDescriptor;
  maskHandoff: LocalObjectSelectionMaskHandoffDescriptor;
  unsupportedPhotoshopEquivalents: LocalObjectSelectionUnsupportedState[];
  unsupportedRefinementStates: LocalObjectSelectionUnsupportedRefinementState[];
  invalidSelectionBlockers: LocalObjectSelectionInvalidBlocker[];
  batchActionSuitability: LocalObjectSelectionBatchActionSuitability;
  componentSummary: LocalObjectSelectionComponentSummary;
  components: LocalObjectSelectionComponentDescriptor[];
  cleanup: LocalObjectSelectionCleanupDescriptor;
  previewSignature: string;
}

export interface LocalObjectSelectionDiagnosticSignaturesDescriptor {
  kind: 'local-object-selection-diagnostic-signatures';
  stableHandoffId: string;
  localOnly: true;
  signatures: {
    preview: string;
    foregroundDiagnostics: string;
    confidenceDiagnostics: string;
    cleanup: string;
    selectAndMaskReadiness: string;
    handoff: string;
    saveLoadHandoff: string;
  };
  unsupportedStates: Array<
    LocalObjectSelectionUnsupportedCode | LocalObjectSelectionUnsupportedRefinementCode
  >;
  blockerCodes: LocalObjectSelectionInvalidBlocker['code'][];
  signature: string;
}

export type ObjectSelectionCloudFallbackBlocker =
  | 'cloud-provider-not-configured'
  | 'cloud-fallback-disabled';

export interface ObjectSelectionFallbackRoutesOptions {
  hasEditableLayerBitmap: boolean;
  cloudProviderConfigured?: boolean;
  allowCloudFallback?: boolean;
}

export interface ObjectSelectionFallbackRoutesDescriptor {
  descriptorId: 'image-object-selection-fallback-routes:v1';
  local: {
    route: 'local-alpha-luminance-components';
    state: 'ready' | 'blocked';
    output: 'document-selection';
    refinementTarget: 'select-and-mask';
  };
  cloud: {
    route: 'cloud-ai-subject-object-provider';
    state: 'ready' | 'blocked';
    blocker: ObjectSelectionCloudFallbackBlocker | null;
    fallback: 'local-alpha-luminance-components';
  };
  routingOrder: ['local-alpha-luminance-components', 'cloud-ai-subject-object-provider'];
  signature: string;
}

const DEFAULT_ALPHA_THRESHOLD = 8;
const DEFAULT_LUMINANCE_THRESHOLD = 8;

interface ForegroundComponent {
  pixels: number[];
  bounds: { x: number; y: number; width: number; height: number };
}

export function describeObjectSelectionFallbackRoutes(
  options: ObjectSelectionFallbackRoutesOptions,
): ObjectSelectionFallbackRoutesDescriptor {
  const localState = options.hasEditableLayerBitmap ? 'ready' : 'blocked';
  const cloudAllowed = options.allowCloudFallback !== false;
  const cloudBlocker: ObjectSelectionCloudFallbackBlocker | null = !cloudAllowed
    ? 'cloud-fallback-disabled'
    : options.cloudProviderConfigured
      ? null
      : 'cloud-provider-not-configured';
  const cloudState = cloudBlocker ? 'blocked' : 'ready';
  return {
    descriptorId: 'image-object-selection-fallback-routes:v1',
    local: {
      route: 'local-alpha-luminance-components',
      state: localState,
      output: 'document-selection',
      refinementTarget: 'select-and-mask',
    },
    cloud: {
      route: 'cloud-ai-subject-object-provider',
      state: cloudState,
      blocker: cloudBlocker,
      fallback: 'local-alpha-luminance-components',
    },
    routingOrder: ['local-alpha-luminance-components', 'cloud-ai-subject-object-provider'],
    signature: `object-selection-fallbacks:v1:local=${localState}:cloud=${cloudState}${cloudBlocker ? `-${cloudBlocker}` : ''}:order=local-alpha-luminance-components>cloud-ai-subject-object-provider`,
  };
}

export function buildLocalObjectSelectionPlan(
  source: ImageData,
  options: Pick<
    LocalObjectSelectionOptions,
    'selectionMode'
    | 'alphaThreshold'
    | 'luminanceThreshold'
    | 'minComponentArea'
    | 'includeDisconnectedIslands'
    | 'fillHoles'
    | 'cleanupPasses'
  > = {},
): LocalObjectSelectionPlanDescriptor {
  const normalized = normalizeLocalObjectSelectionOptions(options);
  const components = findForegroundComponents(
    source,
    normalized.alphaThreshold,
    normalized.luminanceThreshold,
    normalized.selectionMode,
  );
  const largestArea = components.reduce((best, component) => Math.max(best, component.pixels.length), 0);
  const selectedIndexes = new Set<number>();

  if (normalized.includeDisconnectedIslands) {
    components.forEach((component, index) => {
      if (component.pixels.length >= normalized.minComponentArea) {
        selectedIndexes.add(index);
      }
    });
  } else {
    let selectedIndex = -1;
    components.forEach((component, index) => {
      if (selectedIndex < 0 || (
        normalized.selectionMode === 'subject'
          ? scoreSubjectComponent(component, source.width, source.height) > scoreSubjectComponent(components[selectedIndex], source.width, source.height)
          : component.pixels.length > components[selectedIndex].pixels.length
      )) {
        selectedIndex = index;
      }
    });
    if (selectedIndex >= 0 && components[selectedIndex].pixels.length >= normalized.minComponentArea) {
      selectedIndexes.add(selectedIndex);
    }
  }

  const selectedArea = components.reduce(
    (total, component, index) => total + (selectedIndexes.has(index) ? component.pixels.length : 0),
    0,
  );
  const rejectedArea = components.reduce(
    (total, component, index) => total + (selectedIndexes.has(index) ? 0 : component.pixels.length),
    0,
  );
  const selectedMask = createMask(source.width, source.height);
  components.forEach((component, index) => {
    if (!selectedIndexes.has(index)) return;
    for (const pixel of component.pixels) {
      selectedMask.data[pixel] = 255;
    }
  });
  const estimatedHolePixelsFilled = normalized.fillHoles ? countMaskHolePixels(selectedMask) : 0;
  const selectedIds = components
    .map((_, index) => index)
    .filter((index) => selectedIndexes.has(index))
    .map((index) => `component-${index + 1}`);
  const selectionBounds = resolveSelectedComponentBounds(
    components,
    selectedIndexes,
  );
  const foregroundPixelCount = components.reduce((total, component) => total + component.pixels.length, 0);
  const componentSummary: LocalObjectSelectionComponentSummary = {
    componentCount: components.length,
    selectedComponentCount: selectedIndexes.size,
    selectedArea,
    rejectedArea,
    largestComponentArea: largestArea,
  };
  const foregroundScore = buildLocalObjectSelectionForegroundScore({
    width: source.width,
    height: source.height,
    foregroundPixelCount,
    selectedArea,
    rejectedArea,
    largestComponentArea: largestArea,
  });
  const cleanupPassMetadata = buildLocalObjectSelectionCleanupPassMetadata({
    cleanupPasses: normalized.cleanupPasses,
    fillHoles: normalized.fillHoles,
    estimatedHolePixelsFilled,
  });
  const foregroundConfidenceSummary = buildLocalObjectSelectionForegroundConfidenceSummary({
    mode: normalized.selectionMode,
    foregroundScore,
    componentSummary,
    cleanupPassMetadata,
  });
  const readiness = buildLocalObjectSelectionReadiness({
    mode: normalized.selectionMode,
    componentSummary,
  });
  const refineHandoff = buildLocalObjectSelectionRefineHandoff({
    mode: normalized.selectionMode,
    componentSummary,
    selectionBounds,
    foregroundConfidenceSummary,
    cleanupPassMetadata,
    readinessState: readiness.state,
  });
  const componentDescriptors: LocalObjectSelectionComponentDescriptor[] = components.map((component, index) => {
    const selected = selectedIndexes.has(index);
    const rejectedReason = selected
      ? null
      : component.pixels.length < normalized.minComponentArea
        ? 'below-min-area'
        : 'not-largest';
    return {
      id: `component-${index + 1}`,
      area: component.pixels.length,
      bounds: component.bounds,
      selected,
      rejectedReason,
      diagnostics: buildLocalObjectSelectionComponentDiagnostics({
        component,
        selected,
        rejectedReason,
        sourceWidth: source.width,
        sourceHeight: source.height,
      }),
    };
  });
  const foregroundDiagnostics = buildLocalObjectSelectionForegroundDiagnostics({
    width: source.width,
    height: source.height,
    foregroundPixelCount,
    selectedArea,
    selectionBounds,
    components: componentDescriptors,
  });
  const confidenceDiagnostics = buildLocalObjectSelectionConfidenceDiagnostics({
    mode: normalized.selectionMode,
    foregroundScore,
    foregroundConfidenceSummary,
    foregroundDiagnostics,
    componentSummary,
    components: componentDescriptors,
  });
  const handoffMetadata = buildLocalObjectSelectionHandoffMetadata({
    mode: normalized.selectionMode,
    retainedObjectIds: selectedIds,
    selectedArea,
    selectionBounds,
    refineHandoff,
    foregroundConfidenceSummary,
  });
  const saveLoadHandoffMetadata = buildLocalObjectSelectionSaveLoadHandoffMetadata({
    mode: normalized.selectionMode,
    retainedObjectIds: selectedIds,
    selectionBounds,
    handoffMetadata,
    confidenceDiagnostics,
  });

  return {
    kind: 'local-object-selection-plan',
    mode: normalized.selectionMode,
    size: { width: source.width, height: source.height },
    thresholds: {
      alpha: normalized.alphaThreshold,
      luminance: normalized.luminanceThreshold,
    },
    selectionBounds,
    foregroundScore,
    foregroundConfidenceSummary,
    foregroundDiagnostics,
    confidenceDiagnostics,
    readiness,
    subjectDetection: buildLocalObjectSelectionSubjectDetection(normalized.selectionMode),
    refineHandoff,
    handoffMetadata,
    saveLoadHandoffMetadata,
    objectSelectionMetadata: {
      detector: normalized.selectionMode === 'subject'
        ? 'local-border-contrast-subject-heuristic'
        : 'local-alpha-luminance-components',
      source: 'layer-bitmap-image-data',
      confidenceModel: 'heuristic-foreground-score',
      photoshopEquivalent: normalized.selectionMode === 'subject' ? 'select-subject' : 'object-selection',
      retainedObjectIds: selectedIds,
    },
    maskHandoff: {
      source: 'local-component-mask',
      target: 'document-selection',
      refineTarget: 'select-and-mask',
      hasSelection: selectionBounds !== null && selectedArea > 0,
      bounds: selectionBounds,
    },
    unsupportedPhotoshopEquivalents: buildLocalObjectSelectionUnsupportedStates(normalized.selectionMode),
    unsupportedRefinementStates: buildLocalObjectSelectionUnsupportedRefinementStates(normalized.selectionMode),
    invalidSelectionBlockers: buildLocalObjectSelectionInvalidBlockers(componentSummary),
    batchActionSuitability: buildLocalObjectSelectionBatchActionSuitability(readiness),
    componentSummary,
    components: componentDescriptors,
    cleanup: {
      includeDisconnectedIslands: normalized.includeDisconnectedIslands,
      minComponentArea: normalized.minComponentArea,
      fillHoles: normalized.fillHoles,
      cleanupPasses: normalized.cleanupPasses,
      estimatedHolePixelsFilled,
      edgeCleanupEnabled: normalized.cleanupPasses > 0,
    },
    previewSignature: [
      `object-select:v1:${source.width}x${source.height}`,
      `a${normalized.alphaThreshold}`,
      `l${normalized.luminanceThreshold}`,
      `min${normalized.minComponentArea}`,
      `islands${normalized.includeDisconnectedIslands ? 1 : 0}`,
      `fill${normalized.fillHoles ? 1 : 0}`,
      `cleanup${normalized.cleanupPasses}`,
      `selected:${selectedIds.length > 0 ? selectedIds.join(',') : 'none'}`,
      `area${selectedArea}`,
      `components${selectedIndexes.size}`,
      `rejected${Math.max(0, componentSummary.componentCount - selectedIndexes.size)}`,
      `holes${estimatedHolePixelsFilled}`,
      `bounds${selectionBounds ? formatBounds(selectionBounds) : 'none'}`,
      `score${foregroundScore.score}`,
      `ready-${normalized.selectionMode}-${readiness.state}`,
      `warnings${readiness.warningCodes.join('|') || 'none'}`,
      `refine-${refineHandoff.target}-${refineHandoff.required ? 'required' : 'optional'}`,
    ].join(':'),
  };
}

export function describeLocalObjectSelectionDiagnosticSignatures(
  plan: LocalObjectSelectionPlanDescriptor,
): LocalObjectSelectionDiagnosticSignaturesDescriptor {
  const unsupportedStates = dedupeObjectSelectionUnsupportedCodes([
    ...plan.unsupportedPhotoshopEquivalents.map((state) => state.code),
    ...plan.unsupportedRefinementStates.map((state) => state.code),
  ]);
  const blockerCodes = plan.invalidSelectionBlockers.map((blocker) => blocker.code);
  const retainedIds = plan.handoffMetadata.retainedObjectIds.length > 0
    ? plan.handoffMetadata.retainedObjectIds.join('|')
    : 'none';
  const stableHandoffId = [
    'object-select-handoff:v1',
    plan.mode,
    `${plan.size.width}x${plan.size.height}`,
    retainedIds,
  ].join(':');

  return {
    kind: 'local-object-selection-diagnostic-signatures',
    stableHandoffId,
    localOnly: true,
    signatures: {
      preview: plan.previewSignature,
      foregroundDiagnostics: plan.foregroundDiagnostics.signature,
      confidenceDiagnostics: plan.confidenceDiagnostics.signature,
      cleanup: plan.refineHandoff.cleanupPassMetadata.signature,
      selectAndMaskReadiness: plan.refineHandoff.selectAndMaskReadiness.signature,
      handoff: plan.handoffMetadata.signature,
      saveLoadHandoff: plan.saveLoadHandoffMetadata.signature,
    },
    unsupportedStates,
    blockerCodes,
    signature: [
      'object-select-diagnostics:v1',
      stableHandoffId,
      plan.foregroundDiagnostics.signature,
      plan.confidenceDiagnostics.signature,
      plan.refineHandoff.selectAndMaskReadiness.signature,
      `unsupported-${unsupportedStates.length > 0 ? unsupportedStates.join('|') : 'none'}`,
      `blockers-${blockerCodes.length > 0 ? blockerCodes.join('|') : 'none'}`,
    ].join(':'),
  };
}

function dedupeObjectSelectionUnsupportedCodes(
  codes: Array<LocalObjectSelectionUnsupportedCode | LocalObjectSelectionUnsupportedRefinementCode>,
): Array<LocalObjectSelectionUnsupportedCode | LocalObjectSelectionUnsupportedRefinementCode> {
  const seen = new Set<string>();
  return codes.filter((code) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

export function selectLargestForegroundComponent(
  source: ImageData,
  options: Pick<
    LocalObjectSelectionOptions,
    'alphaThreshold' | 'luminanceThreshold' | 'minComponentArea' | 'includeDisconnectedIslands' | 'fillHoles' | 'cleanupPasses'
  > = {},
): SelectionMask {
  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
  const luminanceThreshold = options.luminanceThreshold ?? DEFAULT_LUMINANCE_THRESHOLD;
  const minComponentArea = Math.max(1, Math.floor(options.minComponentArea ?? 1));
  const includeDisconnectedIslands = options.includeDisconnectedIslands === true;
  const fillHoles = options.fillHoles === true;
  const cleanupPasses = Math.max(0, Math.floor(options.cleanupPasses ?? 0));
  const width = source.width;
  const height = source.height;
  const foreground = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const data = source.data;

  for (let index = 0; index < foreground.length; index += 1) {
    const offset = index * 4;
    if (data[offset + 3] <= alphaThreshold) continue;
    if (relativeLuminance(data[offset], data[offset + 1], data[offset + 2]) <= luminanceThreshold) continue;
    foreground[index] = 1;
  }

  const components: number[][] = [];
  const stack: number[] = [];
  for (let index = 0; index < foreground.length; index += 1) {
    if (!foreground[index] || visited[index]) continue;
    const pixels: number[] = [];
    visited[index] = 1;
    stack.push(index);
    while (stack.length > 0) {
      const current = stack.pop()!;
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      visitNeighbor(current - 1, x > 0);
      visitNeighbor(current + 1, x < width - 1);
      visitNeighbor(current - width, y > 0);
      visitNeighbor(current + width, y < height - 1);
    }
    components.push(pixels);
  }

  const mask = createMask(width, height);
  const selectedComponents = includeDisconnectedIslands
    ? components.filter((component) => component.length >= minComponentArea)
    : [components.reduce<number[]>((best, component) => (component.length > best.length ? component : best), [])]
        .filter((component) => component.length >= minComponentArea);
  for (const component of selectedComponents) {
    for (const index of component) {
      mask.data[index] = 255;
    }
  }

  if (fillHoles) {
    fillMaskHoles(mask);
  }
  for (let pass = 0; pass < cleanupPasses; pass += 1) {
    cleanupMaskEdges(mask);
  }
  return mask;

  function visitNeighbor(next: number, inBounds: boolean): void {
    if (!inBounds || visited[next] || !foreground[next]) return;
    visited[next] = 1;
    stack.push(next);
  }
}

/**
 * Offline subject selection for a composited bitmap. This is deliberately a
 * local visual heuristic, not a learned/semantic model: it estimates the
 * border-connected background colour, keeps contrast-separated foreground,
 * then favors a central non-edge component.
 */
export function selectOfflineSubject(
  source: ImageData,
  options: Omit<LocalObjectSelectionOptions, 'selectionMode'> = {},
): SelectionMask {
  const normalized = normalizeLocalObjectSelectionOptions({ ...options, selectionMode: 'subject' });
  const components = findForegroundComponents(
    source,
    normalized.alphaThreshold,
    normalized.luminanceThreshold,
    'subject',
  );
  const mask = createMask(source.width, source.height);
  if (normalized.includeDisconnectedIslands) {
    for (const component of components) {
      if (component.pixels.length < normalized.minComponentArea) continue;
      for (const pixel of component.pixels) mask.data[pixel] = 255;
    }
  } else {
    const subject = components
      .filter((component) => component.pixels.length >= normalized.minComponentArea)
      .sort((left, right) => scoreSubjectComponent(right, source.width, source.height) - scoreSubjectComponent(left, source.width, source.height))[0];
    for (const pixel of subject?.pixels ?? []) mask.data[pixel] = 255;
  }
  if (normalized.fillHoles) fillMaskHoles(mask);
  for (let pass = 0; pass < normalized.cleanupPasses; pass += 1) cleanupMaskEdges(mask);
  return mask;
}

function normalizeLocalObjectSelectionOptions(
  options: Pick<
    LocalObjectSelectionOptions,
    | 'selectionMode'
    | 'alphaThreshold'
    | 'luminanceThreshold'
    | 'minComponentArea'
    | 'includeDisconnectedIslands'
    | 'fillHoles'
    | 'cleanupPasses'
  >,
) {
  return {
    selectionMode: options.selectionMode ?? 'object',
    alphaThreshold: options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD,
    luminanceThreshold: options.luminanceThreshold ?? DEFAULT_LUMINANCE_THRESHOLD,
    minComponentArea: Math.max(1, Math.floor(options.minComponentArea ?? 1)),
    includeDisconnectedIslands: options.includeDisconnectedIslands === true,
    fillHoles: options.fillHoles === true,
    cleanupPasses: Math.max(0, Math.floor(options.cleanupPasses ?? 0)),
  };
}

export function buildLocalObjectSelectionReadiness(params: {
  mode: 'object' | 'subject';
  componentSummary: Pick<
    LocalObjectSelectionComponentSummary,
    'selectedArea' | 'componentCount' | 'rejectedArea'
  >;
}): LocalObjectSelectionReadinessDescriptor {
  const warningCodes: LocalObjectSelectionReadinessWarningCode[] = [];
  if (params.mode === 'subject') {
    warningCodes.push('ai-subject-detection-unsupported');
  }
  if (params.componentSummary.componentCount === 0) {
    warningCodes.push('no-detected-foreground');
  }
  if (params.componentSummary.selectedArea === 0 && params.componentSummary.componentCount > 0) {
    warningCodes.push('all-foreground-filtered');
  }

  const hasBlockingWarning = warningCodes.includes('no-detected-foreground')
    || warningCodes.includes('all-foreground-filtered');
  return {
    mode: params.mode,
    state: hasBlockingWarning ? 'blocked' : warningCodes.length > 0 ? 'ready-with-caveats' : 'ready',
    warningCodes,
  };
}

export function buildLocalObjectSelectionForegroundScore(params: {
  width: number;
  height: number;
  foregroundPixelCount: number;
  selectedArea: number;
  rejectedArea: number;
  largestComponentArea: number;
}): LocalObjectSelectionForegroundScore {
  const sourcePixelCount = Math.max(1, params.width * params.height);
  const foregroundPixelCount = Math.max(0, params.foregroundPixelCount);
  const selectedToForegroundRatio = foregroundPixelCount === 0
    ? 0
    : roundToFixed(selectedAreaRatio(params.selectedArea, foregroundPixelCount), 4);

  return {
    sourcePixelCount: params.width * params.height,
    foregroundPixelCount,
    selectedArea: params.selectedArea,
    rejectedArea: params.rejectedArea,
    selectedToForegroundRatio,
    selectedToImageRatio: roundToFixed(selectedAreaRatio(params.selectedArea, sourcePixelCount), 4),
    score: roundToFixed(selectedToForegroundRatio * 100, 2),
  };
}

function buildLocalObjectSelectionSubjectDetection(
  mode: 'object' | 'subject',
): LocalObjectSelectionSubjectDetectionDescriptor {
  const requested = mode === 'subject';
  return {
    requested,
    state: requested ? 'local-heuristic' : 'not-requested',
    implementation: requested ? 'local-border-contrast-saliency' : 'not-run',
    model: null,
    fallbackDetector: requested
      ? 'local-border-contrast-subject-heuristic'
      : 'local-alpha-luminance-components',
    confidenceSource: 'heuristic-foreground-score',
    warningCodes: requested ? ['ai-subject-detection-unsupported'] : [],
    message: requested
      ? 'Offline Select Subject uses a local border-contrast visual heuristic; no learned AI subject model is executed.'
      : 'AI subject detection was not requested; local object selection uses alpha/luminance foreground components.',
  };
}

function buildLocalObjectSelectionHandoffMetadata(params: {
  mode: 'object' | 'subject';
  retainedObjectIds: string[];
  selectedArea: number;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  refineHandoff: LocalObjectSelectionRefineHandoffDescriptor;
  foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
}): LocalObjectSelectionHandoffMetadataDescriptor {
  return {
    localOnly: true,
    source: 'layer-bitmap-image-data',
    selectionSpace: 'source-image-pixels',
    outputSpace: 'document-selection',
    writesDocumentSelection: true,
    retainedObjectIds: params.retainedObjectIds,
    selectedArea: params.selectedArea,
    selectionBounds: params.selectionBounds,
    refineTarget: params.refineHandoff.target,
    requiresSelectAndMaskReview: params.refineHandoff.required,
    confidenceBand: params.foregroundConfidenceSummary.band,
    signature: [
      'object-select-local-handoff:v1',
      params.mode,
      'local1',
      'out-document-selection',
      `objects${params.retainedObjectIds.length > 0 ? params.retainedObjectIds.join('|') : 'none'}`,
      `area${params.selectedArea}`,
      `bounds${params.selectionBounds ? formatBounds(params.selectionBounds) : 'none'}`,
      `refine${params.refineHandoff.required ? 1 : 0}`,
      `conf${params.foregroundConfidenceSummary.band}`,
    ].join(':'),
  };
}

function buildLocalObjectSelectionSaveLoadHandoffMetadata(params: {
  mode: 'object' | 'subject';
  retainedObjectIds: string[];
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  handoffMetadata: LocalObjectSelectionHandoffMetadataDescriptor;
  confidenceDiagnostics: LocalObjectSelectionConfidenceDiagnosticsDescriptor;
}): LocalObjectSelectionSaveLoadHandoffMetadataDescriptor {
  const serializedFields = [
    'mode',
    'thresholds',
    'component-summary',
    'component-diagnostics',
    'confidence-diagnostics',
    'cleanup-pass-metadata',
    'select-and-mask-readiness',
  ];
  const volatileFields = [
    'source-image-data',
    'document-selection-registry',
    'ai-subject-model-result',
  ];
  return {
    schemaVersion: 1,
    source: 'local-object-selection-plan',
    localOnly: true,
    stableForSaveLoad: true,
    maskSnapshotRecommended: true,
    selectionSpace: 'source-image-pixels',
    outputSpace: 'document-selection',
    serializedFields,
    volatileFields,
    handoffSignature: params.handoffMetadata.signature,
    confidenceSignature: params.confidenceDiagnostics.signature,
    signature: [
      'object-select-save-load:v1',
      params.mode,
      `objects${params.retainedObjectIds.length > 0 ? params.retainedObjectIds.join('|') : 'none'}`,
      `bounds${params.selectionBounds ? formatBounds(params.selectionBounds) : 'none'}`,
      `conf${params.confidenceDiagnostics.band}`,
      `coverage-${params.confidenceDiagnostics.coverageBand}`,
      `review${params.confidenceDiagnostics.reviewRecommended ? 1 : 0}`,
    ].join(':'),
  };
}

function buildLocalObjectSelectionComponentDiagnostics(params: {
  component: ForegroundComponent;
  selected: boolean;
  rejectedReason: LocalObjectSelectionComponentDescriptor['rejectedReason'];
  sourceWidth: number;
  sourceHeight: number;
}): LocalObjectSelectionComponentDiagnostics {
  const boundsArea = Math.max(1, params.component.bounds.width * params.component.bounds.height);
  return {
    boundsArea,
    density: roundToFixed(params.component.pixels.length / boundsArea, 4),
    touchesCanvasEdge: componentTouchesCanvasEdge(
      params.component.bounds,
      params.sourceWidth,
      params.sourceHeight,
    ),
    selectionRole: params.selected
      ? 'retained'
      : params.rejectedReason === 'below-min-area'
        ? 'rejected-below-min-area'
        : 'rejected-not-largest',
  };
}

function buildLocalObjectSelectionForegroundDiagnostics(params: {
  width: number;
  height: number;
  foregroundPixelCount: number;
  selectedArea: number;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  components: LocalObjectSelectionComponentDescriptor[];
}): LocalObjectSelectionForegroundDiagnosticsDescriptor {
  const sourcePixelCount = params.width * params.height;
  const selectedComponentIds = params.components
    .filter((component) => component.selected)
    .map((component) => component.id);
  const rejectedComponentIds = params.components
    .filter((component) => !component.selected)
    .map((component) => component.id);
  const edgeTouchingComponentIds = params.components
    .filter((component) => component.diagnostics.touchesCanvasEdge)
    .map((component) => component.id);
  const selectedBoundsArea = params.selectionBounds
    ? params.selectionBounds.width * params.selectionBounds.height
    : 0;
  const foregroundCoverageRatio = roundToFixed(
    selectedAreaRatio(params.foregroundPixelCount, Math.max(1, sourcePixelCount)),
    4,
  );
  const selectedForegroundRatio = roundToFixed(
    selectedAreaRatio(params.selectedArea, Math.max(1, params.foregroundPixelCount)),
    4,
  );
  const selectedDensity = selectedBoundsArea > 0
    ? roundToFixed(params.selectedArea / selectedBoundsArea, 4)
    : 0;
  return {
    sourcePixelCount,
    foregroundPixelCount: params.foregroundPixelCount,
    componentCount: params.components.length,
    selectedComponentIds,
    rejectedComponentIds,
    edgeTouchingComponentIds,
    foregroundCoverageRatio,
    selectedForegroundRatio,
    selectedBoundsArea,
    selectedDensity,
    signature: [
      'object-select-foreground:v1',
      `${sourcePixelCount}px`,
      `fg${params.foregroundPixelCount}`,
      `components${params.components.length}`,
      `selected${selectedComponentIds.length > 0 ? selectedComponentIds.join('|') : 'none'}`,
      `rejected${rejectedComponentIds.length > 0 ? rejectedComponentIds.join('|') : 'none'}`,
      `edge${edgeTouchingComponentIds.length > 0 ? edgeTouchingComponentIds.join('|') : 'none'}`,
      `coverage${foregroundCoverageRatio}`,
      `selected${selectedForegroundRatio}`,
      `density${selectedDensity}`,
    ].join(':'),
  };
}

function buildLocalObjectSelectionConfidenceDiagnostics(params: {
  mode: 'object' | 'subject';
  foregroundScore: LocalObjectSelectionForegroundScore;
  foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
  foregroundDiagnostics: LocalObjectSelectionForegroundDiagnosticsDescriptor;
  componentSummary: LocalObjectSelectionComponentSummary;
  components: LocalObjectSelectionComponentDescriptor[];
}): LocalObjectSelectionConfidenceDiagnosticsDescriptor {
  const edgeTouchingRetainedComponentCount = params.components.filter(
    (component) => component.selected && component.diagnostics.touchesCanvasEdge,
  ).length;
  const edgeTouchingRejectedComponentCount = params.components.filter(
    (component) => !component.selected && component.diagnostics.touchesCanvasEdge,
  ).length;
  const reviewCodes: LocalObjectSelectionConfidenceDiagnosticsDescriptor['reviewCodes'] = [];
  if (params.mode === 'subject') {
    reviewCodes.push('subject-ai-fallback');
  }
  if (edgeTouchingRejectedComponentCount > 0) {
    reviewCodes.push('rejected-edge-foreground');
  }
  if (edgeTouchingRetainedComponentCount > 0) {
    reviewCodes.push('selected-edge-foreground');
  }
  if (params.componentSummary.rejectedArea > 0) {
    reviewCodes.push('filtered-foreground');
  }
  if (params.componentSummary.selectedComponentCount > 1) {
    reviewCodes.push('disconnected-components');
  }
  if (params.foregroundConfidenceSummary.band === 'low') {
    reviewCodes.push('low-confidence');
  }
  if (reviewCodes.length === 0 && params.foregroundConfidenceSummary.reviewRecommended) {
    reviewCodes.push('confidence-review');
  }
  const edgeRisk = edgeTouchingRetainedComponentCount > 0
    ? 'high'
    : edgeTouchingRejectedComponentCount > 0 || params.componentSummary.rejectedArea > 0
      ? 'medium'
      : 'low';
  const coverageBand = resolveObjectSelectionCoverageBand(
    params.foregroundDiagnostics.foregroundCoverageRatio,
  );
  const reviewRecommended = params.foregroundConfidenceSummary.reviewRecommended || reviewCodes.length > 0;

  return {
    band: params.foregroundConfidenceSummary.band,
    coverageBand,
    foregroundCoverageRatio: params.foregroundDiagnostics.foregroundCoverageRatio,
    selectedForegroundRatio: params.foregroundDiagnostics.selectedForegroundRatio,
    selectedToImageRatio: params.foregroundScore.selectedToImageRatio,
    selectedDensity: params.foregroundDiagnostics.selectedDensity,
    edgeTouchingRetainedComponentCount,
    edgeTouchingRejectedComponentCount,
    edgeRisk,
    reviewRecommended,
    reviewCodes,
    signature: [
      'object-select-confidence:v1',
      params.foregroundConfidenceSummary.band,
      coverageBand,
      `fg${params.foregroundDiagnostics.foregroundCoverageRatio}`,
      `selected${params.foregroundDiagnostics.selectedForegroundRatio}`,
      `image${params.foregroundScore.selectedToImageRatio}`,
      `density${params.foregroundDiagnostics.selectedDensity}`,
      `edge-retained${edgeTouchingRetainedComponentCount}`,
      `edge-rejected${edgeTouchingRejectedComponentCount}`,
      `risk${edgeRisk}`,
      `review${reviewCodes.length > 0 ? reviewCodes.join('|') : 'none'}`,
    ].join(':'),
  };
}

function resolveObjectSelectionCoverageBand(
  coverageRatio: number,
): LocalObjectSelectionConfidenceDiagnosticsDescriptor['coverageBand'] {
  if (coverageRatio <= 0) return 'none';
  if (coverageRatio < 0.05) return 'tiny';
  if (coverageRatio < 0.35) return 'sparse';
  if (coverageRatio < 0.75) return 'balanced';
  return 'dominant';
}

function componentTouchesCanvasEdge(
  bounds: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  return bounds.x <= 0
    || bounds.y <= 0
    || bounds.x + bounds.width >= sourceWidth
    || bounds.y + bounds.height >= sourceHeight;
}

export function buildLocalObjectSelectionRefineHandoff(params: {
  mode: 'object' | 'subject';
  componentSummary: Pick<
    LocalObjectSelectionComponentSummary,
    'componentCount' | 'selectedComponentCount' | 'selectedArea' | 'rejectedArea'
  >;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
  foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
  cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
  readinessState: LocalObjectSelectionReadinessState;
}): LocalObjectSelectionRefineHandoffDescriptor {
  const hasSelection = params.selectionBounds !== null && params.componentSummary.selectedArea > 0;
  const requiresRefinement = hasSelection && (
    params.componentSummary.rejectedArea > 0
    || params.componentSummary.selectedComponentCount > 1
    || params.componentSummary.selectedComponentCount !== params.componentSummary.componentCount
    || params.mode === 'subject'
  );
  const offlineAICaveats = buildLocalObjectSelectionOfflineAICaveats(params.mode);
  const selectAndMaskReadiness = buildLocalObjectSelectionSelectAndMaskReadiness({
    mode: params.mode,
    hasSelection,
    requiresRefinement,
    componentSummary: params.componentSummary,
    foregroundConfidenceSummary: params.foregroundConfidenceSummary,
    cleanupPassMetadata: params.cleanupPassMetadata,
    readinessState: params.readinessState,
  });
  return {
    target: 'select-and-mask',
    required: requiresRefinement,
    reason: hasSelection
      ? requiresRefinement
        ? params.componentSummary.selectedComponentCount > 1
          ? 'Multiple retained foreground components need Select and Mask review before destructive output.'
          : 'Foreground candidates were reduced by local component heuristics; refine before downstream edge-critical use.'
        : 'Local object selection matched a single candidate component.'
      : 'Local object selection did not yield an active region to refine.',
    caveat: 'Select and Mask is local-only and is used for edge refinement; cloud AI subject detection is not available.',
    selectAndMaskReadiness,
    cleanupPassMetadata: params.cleanupPassMetadata,
    offlineAICaveats,
  };
}

function buildLocalObjectSelectionUnsupportedStates(
  mode: 'object' | 'subject',
): LocalObjectSelectionUnsupportedState[] {
  const unsupported: LocalObjectSelectionUnsupportedState[] = [];
  if (mode === 'subject') {
    unsupported.push({
      code: 'ai-subject-detection-unsupported',
      severity: 'unsupported',
      message: 'Select Subject is represented by local foreground heuristics; no AI subject model is executed.',
    });
  }
  unsupported.push({
    code: 'cloud-object-finder-unsupported',
    severity: 'unsupported',
    message: 'Photoshop-style cloud object finding and semantic object labels are not available in the local selector.',
  });
  return unsupported;
}

function buildLocalObjectSelectionUnsupportedRefinementStates(
  mode: 'object' | 'subject',
): LocalObjectSelectionUnsupportedRefinementState[] {
  const unsupported: LocalObjectSelectionUnsupportedRefinementState[] = [];
  if (mode === 'subject') {
    unsupported.push({
      code: 'ai-subject-detection-unsupported',
      stage: 'subject-detection',
      severity: 'unsupported',
      recoverableWith: 'local-border-contrast-subject-heuristic',
      message: 'A learned AI subject model is not executed; Offline Select Subject uses local border-contrast foreground analysis and records confidence diagnostics for review.',
    });
  }
  unsupported.push({
    code: 'edge-aware-object-brush-unsupported',
    stage: 'select-and-mask-refinement',
    severity: 'unsupported',
    recoverableWith: 'select-and-mask-local-brush',
    message: 'Edge-aware object refinement brushes are not available; downstream Select and Mask can only expand, contract, or soften deterministic mask regions.',
  });
  return unsupported;
}

function buildLocalObjectSelectionInvalidBlockers(
  componentSummary: Pick<LocalObjectSelectionComponentSummary, 'componentCount' | 'selectedArea'>,
): LocalObjectSelectionInvalidBlocker[] {
  if (componentSummary.componentCount === 0) {
    return [{
      code: 'no-detected-foreground',
      severity: 'error',
      message: 'Object selection requires foreground pixels above the alpha and luminance thresholds.',
    }];
  }
  if (componentSummary.selectedArea === 0) {
    return [{
      code: 'all-foreground-filtered',
      severity: 'error',
      message: 'Foreground was detected, but every component was filtered out by the minimum area constraint.',
    }];
  }
  return [];
}

function buildLocalObjectSelectionBatchActionSuitability(
  readiness: LocalObjectSelectionReadinessDescriptor,
): LocalObjectSelectionBatchActionSuitability {
  if (readiness.state === 'blocked') {
    return {
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      reason: 'Object/subject selection needs foreground pixels in each document before batch playback can commit a selection.',
    };
  }
  return {
    status: readiness.state === 'ready' ? 'ready' : 'limited-ready',
    actionRecordable: true,
    batchSafe: false,
    reason: 'Object/subject selection is deterministic for a loaded layer bitmap, but batch playback must validate each document foreground before committing.',
  };
}

function buildLocalObjectSelectionCleanupPassMetadata(params: {
  cleanupPasses: number;
  fillHoles: boolean;
  estimatedHolePixelsFilled: number;
}): LocalObjectSelectionCleanupPassMetadata {
  const appliedPasses = Math.max(0, params.cleanupPasses);
  return {
    requestedPasses: appliedPasses,
    appliedPasses,
    holeFillApplied: params.fillHoles,
    estimatedHolePixelsFilled: params.estimatedHolePixelsFilled,
    edgeCleanupEnabled: appliedPasses > 0,
    signature: [
      'object-select-cleanup:v1',
      `passes${appliedPasses}`,
      `applied${appliedPasses}`,
      `fill${params.fillHoles ? 1 : 0}`,
      `holes${params.estimatedHolePixelsFilled}`,
      `edge${appliedPasses > 0 ? 1 : 0}`,
    ].join(':'),
  };
}

function buildLocalObjectSelectionForegroundConfidenceSummary(params: {
  mode: 'object' | 'subject';
  foregroundScore: LocalObjectSelectionForegroundScore;
  componentSummary: LocalObjectSelectionComponentSummary;
  cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
}): LocalObjectSelectionForegroundConfidenceSummary {
  const { foregroundScore, componentSummary, cleanupPassMetadata } = params;
  const hasSelection = foregroundScore.selectedArea > 0;
  const reviewRecommended = hasSelection && (
    params.mode === 'subject'
    || componentSummary.rejectedArea > 0
    || componentSummary.selectedComponentCount > 1
    || cleanupPassMetadata.holeFillApplied
    || cleanupPassMetadata.appliedPasses > 0
  );
  const band = !hasSelection
    ? 'none'
    : !reviewRecommended && foregroundScore.score >= 98
      ? 'high'
      : foregroundScore.score >= 70
        ? 'medium'
        : 'low';
  return {
    band,
    score: foregroundScore.score,
    selectedToForegroundRatio: foregroundScore.selectedToForegroundRatio,
    selectedToImageRatio: foregroundScore.selectedToImageRatio,
    summary: !hasSelection
      ? 'No foreground pixels were retained for Select and Mask handoff.'
      : `Selected ${foregroundScore.selectedArea} of ${foregroundScore.foregroundPixelCount} foreground pixels across ${componentSummary.selectedComponentCount} retained components; ${reviewRecommended ? 'review edges before mask handoff.' : 'handoff is ready for minimal edge refinement.'}`,
    reviewRecommended,
  };
}

function buildLocalObjectSelectionOfflineAICaveats(mode: 'object' | 'subject'): string[] {
  const caveats = [
    mode === 'subject'
      ? 'Selection was generated locally from border-background contrast and component saliency; no cloud or on-device learned semantic AI model ran.'
      : 'Selection was generated locally from alpha/luminance-connected components; no cloud or on-device semantic AI model ran.',
  ];
  if (mode === 'subject') {
    caveats.push(
      'Select Subject parity is approximate and should be reviewed in Select and Mask before destructive output.',
    );
  }
  return caveats;
}

function buildLocalObjectSelectionSelectAndMaskReadiness(params: {
  mode: 'object' | 'subject';
  hasSelection: boolean;
  requiresRefinement: boolean;
  componentSummary: Pick<
    LocalObjectSelectionComponentSummary,
    'componentCount' | 'selectedComponentCount' | 'selectedArea' | 'rejectedArea'
  >;
  foregroundConfidenceSummary: LocalObjectSelectionForegroundConfidenceSummary;
  cleanupPassMetadata: LocalObjectSelectionCleanupPassMetadata;
  readinessState: LocalObjectSelectionReadinessState;
}): LocalObjectSelectionSelectAndMaskReadinessDescriptor {
  if (!params.hasSelection || params.readinessState === 'blocked') {
    return {
      state: 'blocked',
      recommendationCode: 'selection-unavailable',
      unsupportedFeatures: [
        'semantic-hair-fur-refinement',
        'decontaminate-colors',
        'radius-brush-edge-learning',
      ],
      retainedForegroundLimits: {
        retainedComponentCount: 0,
        rejectedComponentCount: Math.max(0, params.componentSummary.componentCount),
        disconnectedForeground: false,
        edgeReviewRequired: false,
        maximumComponentsBeforeManualCleanup: 4,
      },
      recommendedSettings: {
        smooth: 0,
        feather: 0,
        contrast: 0,
        shiftEdge: 0,
      },
      reasons: ['No retained foreground selection is available for Select and Mask refinement.'],
      warnings: [
        {
          code: 'select-mask-local-edge-refine-only',
          severity: 'warning',
          message: 'Select and Mask readiness is limited to local edge cleanup metadata; semantic refine features are not available.',
        },
      ],
      signature: 'object-select-handoff:v2:none:blocked:s0:f0:c0:shift0:none:cleanup0:holes0:components0:rejected0:limitslocal-edge-only',
    };
  }

  const retainedForegroundLimits = {
    retainedComponentCount: params.componentSummary.selectedComponentCount,
    rejectedComponentCount: Math.max(
      0,
      params.componentSummary.componentCount - params.componentSummary.selectedComponentCount,
    ),
    disconnectedForeground: params.componentSummary.selectedComponentCount > 1,
    edgeReviewRequired: params.requiresRefinement || params.foregroundConfidenceSummary.reviewRecommended,
    maximumComponentsBeforeManualCleanup: 4,
  };
  const recommendationCode = params.mode === 'subject'
    && (params.cleanupPassMetadata.holeFillApplied || params.cleanupPassMetadata.appliedPasses > 0)
    && params.foregroundConfidenceSummary.reviewRecommended
    ? 'subject-fragment-cleanup-review'
    : params.requiresRefinement || retainedForegroundLimits.retainedComponentCount > 1
      ? 'component-edge-review'
      : 'single-component-minimal-refine';
  const recommendedSettings = recommendationCode === 'single-component-minimal-refine'
    ? { smooth: 0, feather: 0, contrast: 0, shiftEdge: 0 }
    : {
        smooth: params.cleanupPassMetadata.appliedPasses > 0 ? 1 : 0,
        feather: params.foregroundConfidenceSummary.reviewRecommended ? 1 : 0,
        contrast: params.componentSummary.rejectedArea > 0 || params.mode === 'subject' ? 18 : 12,
        shiftEdge: params.cleanupPassMetadata.holeFillApplied || params.cleanupPassMetadata.appliedPasses > 0 ? -1 : 0,
      };
  const reasons: string[] = [];
  if (params.mode === 'subject') {
    reasons.push('Subject mode is using offline foreground heuristics instead of AI subject detection.');
  }
  if (params.componentSummary.selectedComponentCount > 1 || params.componentSummary.rejectedArea > 0) {
    reasons.push('Multiple retained components and rejected foreground islands need explicit edge review.');
  }
  if (params.cleanupPassMetadata.holeFillApplied || params.cleanupPassMetadata.appliedPasses > 0) {
    reasons.push('Hole fill and edge cleanup metadata should be reviewed before committing a mask output.');
  }
  if (reasons.length === 0) {
    reasons.push('Single retained foreground component is ready for minimal Select and Mask review.');
  }
  const warnings: LocalObjectSelectionSelectAndMaskReadinessDescriptor['warnings'] = [];
  if (retainedForegroundLimits.retainedComponentCount > 1) {
    warnings.push({
      code: 'select-mask-multi-component-review',
      severity: 'warning',
      message: 'Multiple retained foreground components need manual review before mask output.',
    });
  }
  warnings.push({
    code: 'select-mask-local-edge-refine-only',
    severity: 'warning',
    message: 'Select and Mask readiness is limited to local edge cleanup metadata; semantic refine features are not available.',
  });
  return {
    state: params.foregroundConfidenceSummary.reviewRecommended ? 'ready-with-caveats' : 'ready',
    recommendationCode,
    unsupportedFeatures: [
      'semantic-hair-fur-refinement',
      'decontaminate-colors',
      'radius-brush-edge-learning',
    ],
    retainedForegroundLimits,
    recommendedSettings,
    reasons,
    warnings,
    signature: [
      'object-select-handoff:v2',
      params.mode,
      params.foregroundConfidenceSummary.reviewRecommended ? 'ready-with-caveats' : 'ready',
      `s${recommendedSettings.smooth}`,
      `f${recommendedSettings.feather}`,
      `c${recommendedSettings.contrast}`,
      `shift${recommendedSettings.shiftEdge}`,
      params.foregroundConfidenceSummary.band,
      `cleanup${params.cleanupPassMetadata.appliedPasses}`,
      `holes${params.cleanupPassMetadata.estimatedHolePixelsFilled}`,
      `components${retainedForegroundLimits.retainedComponentCount}`,
      `rejected${retainedForegroundLimits.rejectedComponentCount}`,
      'limitslocal-edge-only',
    ].join(':'),
  };
}

function findForegroundComponents(
  source: ImageData,
  alphaThreshold: number,
  luminanceThreshold: number,
  mode: 'object' | 'subject' = 'object',
): ForegroundComponent[] {
  const width = source.width;
  const height = source.height;
  const foreground = mode === 'subject'
    ? buildOfflineSubjectForegroundMap(source, alphaThreshold)
    : buildAlphaLuminanceForegroundMap(source, alphaThreshold, luminanceThreshold);
  const visited = new Uint8Array(width * height);

  const components: ForegroundComponent[] = [];
  const stack: number[] = [];
  for (let index = 0; index < foreground.length; index += 1) {
    if (!foreground[index] || visited[index]) continue;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    visited[index] = 1;
    stack.push(index);
    while (stack.length > 0) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      pixels.push(current);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visitNeighbor(current - 1, x > 0);
      visitNeighbor(current + 1, x < width - 1);
      visitNeighbor(current - width, y > 0);
      visitNeighbor(current + width, y < height - 1);
    }
    components.push({
      pixels,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }

  return components;

  function visitNeighbor(next: number, inBounds: boolean): void {
    if (!inBounds || visited[next] || !foreground[next]) return;
    visited[next] = 1;
    stack.push(next);
  }
}

function buildAlphaLuminanceForegroundMap(
  source: ImageData,
  alphaThreshold: number,
  luminanceThreshold: number,
): Uint8Array {
  const foreground = new Uint8Array(source.width * source.height);
  for (let index = 0; index < foreground.length; index += 1) {
    const offset = index * 4;
    if (source.data[offset + 3] <= alphaThreshold) continue;
    if (relativeLuminance(source.data[offset], source.data[offset + 1], source.data[offset + 2]) <= luminanceThreshold) continue;
    foreground[index] = 1;
  }
  return foreground;
}

function buildOfflineSubjectForegroundMap(source: ImageData, alphaThreshold: number): Uint8Array {
  const width = source.width;
  const height = source.height;
  const opaque = new Uint8Array(width * height);
  const edgeColours: Array<[number, number, number]> = [];
  const collect = (x: number, y: number) => {
    const index = y * width + x;
    const offset = index * 4;
    if (source.data[offset + 3] <= alphaThreshold) return;
    opaque[index] = 1;
    edgeColours.push([source.data[offset], source.data[offset + 1], source.data[offset + 2]]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (source.data[offset + 3] > alphaThreshold) opaque[index] = 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) collect(x, y);
    }
  }
  // Transparent-border artwork is already a strong foreground signal.
  if (edgeColours.length < Math.max(4, Math.floor((width + height) * 0.3))) return opaque;

  const background: [number, number, number] = [
    median(edgeColours.map((colour) => colour[0])),
    median(edgeColours.map((colour) => colour[1])),
    median(edgeColours.map((colour) => colour[2])),
  ];
  const edgeDistances = edgeColours.map((colour) => colourDistance(colour, background)).sort((left, right) => left - right);
  const noiseAllowance = percentile(edgeDistances, 0.8);
  const threshold = Math.min(96, Math.max(24, noiseAllowance + 14));
  const foreground = new Uint8Array(width * height);
  for (let index = 0; index < foreground.length; index += 1) {
    if (!opaque[index]) continue;
    const offset = index * 4;
    if (colourDistance([source.data[offset], source.data[offset + 1], source.data[offset + 2]], background) > threshold) {
      foreground[index] = 1;
    }
  }
  return foreground;
}

function scoreSubjectComponent(component: ForegroundComponent, width: number, height: number): number {
  const centerX = component.bounds.x + component.bounds.width / 2;
  const centerY = component.bounds.y + component.bounds.height / 2;
  const distanceX = Math.abs(centerX - width / 2) / Math.max(1, width / 2);
  const distanceY = Math.abs(centerY - height / 2) / Math.max(1, height / 2);
  const centrality = Math.max(0, 1 - Math.hypot(distanceX, distanceY) / Math.SQRT2);
  const edgePenalty = componentTouchesCanvasEdge(component.bounds, width, height) ? 0.58 : 1;
  return component.pixels.length * (0.65 + centrality * 0.7) * edgePenalty;
}

function colourDistance(left: readonly number[], right: readonly number[]): number {
  const red = (left[0] ?? 0) - (right[0] ?? 0);
  const green = (left[1] ?? 0) - (right[1] ?? 0);
  const blue = (left[2] ?? 0) - (right[2] ?? 0);
  return Math.sqrt(red * red + green * green + blue * blue);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return percentile(ordered, 0.5);
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * quantile)));
  return sortedValues[index] ?? 0;
}

function countMaskHolePixels(mask: SelectionMask): number {
  const before = new Uint8ClampedArray(mask.data);
  const filled = createMask(mask.width, mask.height);
  filled.data.set(mask.data);
  fillMaskHoles(filled);
  let count = 0;
  for (let index = 0; index < filled.data.length; index += 1) {
    if (before[index] === 0 && filled.data[index] > 0) {
      count += 1;
    }
  }
  return count;
}

function resolveSelectedComponentBounds(
  components: ForegroundComponent[],
  selectedIndexes: Set<number>,
): { x: number; y: number; width: number; height: number } | null {
  const selectedBounds = components
    .filter((_, index) => selectedIndexes.has(index))
    .map((component) => component.bounds);
  if (selectedBounds.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const bounds of selectedBounds) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width - 1);
    maxY = Math.max(maxY, bounds.y + bounds.height - 1);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function selectedAreaRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function roundToFixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function formatBounds(bounds: { x: number; y: number; width: number; height: number }): string {
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function fillMaskHoles(mask: SelectionMask): void {
  const visited = new Uint8Array(mask.width * mask.height);
  const stack: number[] = [];
  const enqueue = (index: number) => {
    if (visited[index] || mask.data[index] !== 0) return;
    visited[index] = 1;
    stack.push(index);
  };

  for (let x = 0; x < mask.width; x += 1) {
    enqueue(x);
    enqueue((mask.height - 1) * mask.width + x);
  }
  for (let y = 0; y < mask.height; y += 1) {
    enqueue(y * mask.width);
    enqueue(y * mask.width + (mask.width - 1));
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    const x = current % mask.width;
    const y = Math.floor(current / mask.width);
    if (x > 0) enqueue(current - 1);
    if (x < mask.width - 1) enqueue(current + 1);
    if (y > 0) enqueue(current - mask.width);
    if (y < mask.height - 1) enqueue(current + mask.width);
  }

  for (let index = 0; index < mask.data.length; index += 1) {
    if (mask.data[index] === 0 && !visited[index]) {
      mask.data[index] = 255;
    }
  }
}

function cleanupMaskEdges(mask: SelectionMask): void {
  const next = new Uint8ClampedArray(mask.data);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      const count = countOrthogonalNeighbors(mask, x, y);
      if (mask.data[index] > 0 && count <= 1) {
        next[index] = 0;
      } else if (mask.data[index] === 0 && count >= 3) {
        next[index] = 255;
      }
    }
  }
  mask.data.set(next);
}

function countOrthogonalNeighbors(mask: SelectionMask, x: number, y: number): number {
  let count = 0;
  if (x > 0 && mask.data[y * mask.width + (x - 1)] > 0) count += 1;
  if (x < mask.width - 1 && mask.data[y * mask.width + (x + 1)] > 0) count += 1;
  if (y > 0 && mask.data[(y - 1) * mask.width + x] > 0) count += 1;
  if (y < mask.height - 1 && mask.data[(y + 1) * mask.width + x] > 0) count += 1;
  return count;
}

export function buildLocalObjectSelectionMask(
  doc: ImageDocument,
  options: LocalObjectSelectionOptions = {},
): SelectionMask | null {
  const layer = getObjectSelectionSourceLayer(doc);
  if (!layer?.bitmap) return null;
  const imageData = options.readLayerImageData?.(layer) ?? getBitmapImageData(layer.bitmap);
  const localMask = options.selectionMode === 'subject'
    ? selectOfflineSubject(imageData, options)
    : selectLargestForegroundComponent(imageData, options);
  if (isMaskEmpty(localMask)) return null;

  const docMask = createMask(doc.width, doc.height);
  const offsetX = Math.round(layer.x);
  const offsetY = Math.round(layer.y);
  for (let y = 0; y < localMask.height; y += 1) {
    const docY = offsetY + y;
    if (docY < 0 || docY >= doc.height) continue;
    for (let x = 0; x < localMask.width; x += 1) {
      if (localMask.data[y * localMask.width + x] === 0) continue;
      const docX = offsetX + x;
      if (docX < 0 || docX >= doc.width) continue;
      docMask.data[docY * docMask.width + docX] = 255;
    }
  }

  return isMaskEmpty(docMask) ? null : docMask;
}

export function applyLocalObjectSelection(
  doc: ImageDocument,
  options: LocalObjectSelectionOptions = {},
): LocalObjectSelectionResult | null {
  const sourceLayer = getObjectSelectionSourceLayer(doc);
  if (!sourceLayer) return null;
  const mask = buildLocalObjectSelectionMask(doc, options);
  if (!mask) return null;
  const bounds = maskBoundingBox(mask);
  if (!bounds) return null;

  const beforeSelection = getSelection(doc.id);
  const before = beforeSelection && !isMaskEmpty(beforeSelection)
    ? toSnapshot(beforeSelection)
    : null;
  setSelection(doc.id, mask);
  const store = useImageEditorStore.getState();
  store.pushOperation({
    kind: 'selection',
    docId: doc.id,
    before,
    after: toSnapshot(mask),
  });
  store.setHasSelection(doc.id, true);

  return {
    mask,
    bounds,
    sourceLayerId: sourceLayer.id,
  };
}

function getObjectSelectionSourceLayer(doc: ImageDocument): ImageLayer | null {
  const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null;
  if (isSelectableLayer(activeLayer)) return activeLayer;
  for (let index = doc.layers.length - 1; index >= 0; index -= 1) {
    const layer = doc.layers[index];
    if (isSelectableLayer(layer)) return layer;
  }
  return null;
}

function isSelectableLayer(layer: ImageLayer | null | undefined): layer is ImageLayer {
  return Boolean(layer?.visible && layer.bitmap && layer.type !== 'group' && layer.type !== 'adjustment');
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
