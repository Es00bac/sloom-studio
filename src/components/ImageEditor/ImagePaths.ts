import type { ImageDocument, ImageLayer, ImageVectorPathPoint, ImageVectorShape, LayerBitmap, ShapeToolSettings } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import { rasterizeLayerBitmapTransformed } from './ImageLayerTransform';
import { createLayerMaskFromSelection, type LayerSelectionMaskMode } from './LayerMaskOps';
import { createMask, setEllipse, setPolygon, setRect, type SelectionMask } from './SelectionMask';
import {
  buildVectorPathLayer,
  getEditableVectorShape,
  getVectorPathDocumentPoints,
  isEditableVectorShapeLayer,
  materializeEditableVectorShapeLayer,
  updateEditableVectorShapeLayer,
} from './ImageVectorShape';
import type { ImageVectorMaskDescriptorInput } from './ImageVectorMasks';

export type ImagePathWorkflowCapabilityKind =
  | 'straight-segment-paths'
  | 'anchor-editing'
  | 'path-to-selection'
  | 'path-to-fill-layer'
  | 'path-to-stroke-layer'
  | 'bezier-handles'
  | 'curvature-tool'
  | 'independent-saved-work-paths'
  | 'anchor-conversion'
  | 'independent-direct-selection'
  | 'independent-path-selection'
  | 'rasterize-vector-mask';

export type ImagePathWorkflowStorage = 'vector-layer' | 'document-work-path' | 'not-implemented';
export type ImagePathWorkflowGeometry = 'straight-segment' | 'shape-rasterization' | 'bezier' | 'curvature';
export type ImagePathWorkflowOutput = 'path-layer' | 'selection-mask' | 'vector-fill-layer' | 'vector-stroke-layer' | 'none';
export type ImagePathWorkflowUndoOperation = 'layerOp' | 'selection' | 'documentState' | 'none';

export type ImagePathWorkflowWarningCode =
  | 'unsupported-bezier-handles'
  | 'unsupported-curvature-tool'
  | 'unsupported-independent-saved-work-paths'
  | 'unsupported-anchor-conversion'
  | 'unsupported-independent-direct-selection'
  | 'unsupported-independent-path-selection';

export interface ImagePathWorkflowWarning {
  code: ImagePathWorkflowWarningCode;
  severity: 'warning';
  message: string;
  capability: ImagePathWorkflowCapabilityKind;
}

export interface ImagePathWorkflowCapabilityDescriptor {
  kind: ImagePathWorkflowCapabilityKind;
  label: string;
  supported: boolean;
  storage: ImagePathWorkflowStorage;
  geometry: ImagePathWorkflowGeometry;
  output: ImagePathWorkflowOutput;
  undoOperation: ImagePathWorkflowUndoOperation;
  warnings: ImagePathWorkflowWarning[];
}

export interface ImagePathLayerWorkflowDescriptor {
  layerId: string;
  name: string;
  kind: ImageVectorShape['kind'];
  classification: 'saved-layer-path' | 'saved-shape-path';
  closed: boolean;
  pointCount: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  editableAnchors: boolean;
  anchorEditing: {
    mode: 'numeric-and-canvas-point-editing' | 'shape-bounds-editing';
    canMoveAnchors: boolean;
    canConvertAnchors: boolean;
    canEditBezierHandles: boolean;
    limitations: Array<'anchor-conversion' | 'bezier-handle-editing'>;
  };
  editReadiness: ImagePathEditReadinessDescriptor;
  canConvertToSelection: boolean;
  canCreateFillLayer: boolean;
  canCreateStrokeLayer: boolean;
  canRasterizeVectorMask: boolean;
  hasBezierHandles: boolean;
  previewId: string;
  previewSignature: string;
}

export interface ImagePathWorkflowDescriptorOptions {
  requireBezierHandles?: boolean;
  requireCurvatureTool?: boolean;
  requireIndependentSavedWorkPaths?: boolean;
}

export type ImagePathsPanelEntrySource = 'layer-backed-saved-path' | 'document-work-path';
export type ImagePathsPanelOperationKind = 'loadSelection' | 'fillPath' | 'strokePath' | 'createVectorMask';
export type ImagePathsPanelOperationBlocker =
  | 'no-path-entries'
  | 'selected-path-missing'
  | 'target-layer-missing'
  | 'target-layer-locked'
  | 'target-layer-is-selected-path'
  | 'selected-path-needs-three-points';
export type ImagePathsPanelOperationCaveat =
  | 'straight-segment-rasterization'
  | 'creates-vector-fill-layer-copy'
  | 'uses-current-shape-stroke-settings'
  | 'requires-three-or-more-source-points'
  | 'target-local-retained-path';
export type ImagePathsPanelCaveatCode =
  | 'independent-saved-paths-unsupported'
  | 'bezier-operations-unsupported';
export type ImagePathsPanelVisibilityState = 'visible' | 'empty';
export type ImagePathsPanelVisibilityReason = 'path-entries-available' | 'no-path-entries';
export type ImagePathsPanelRecordStorage = 'vector-layer' | 'document-work-path';
export type ImagePathsPanelRecordPersistence = 'layer-stack' | 'temporary-session';
export type ImagePathsPanelRecordEditableState = 'straight-anchor-editable' | 'shape-bounds-editable';
export type ImagePathsPanelExportCaveatCode =
  | 'svg-export-retains-straight-segments-only'
  | 'psd-export-flattens-independent-path-records';
export type ImagePathsPanelActionSuitabilityState =
  | 'suitable'
  | 'suitable-with-selected-entry-and-target'
  | 'suitable-deterministic'
  | 'blocked'
  | 'unsupported';

export type ImagePathsPanelEntryReadinessThumbnailRenderer = 'canvas' | 'none';
export type ImagePathsPanelEntryThumbnailReadinessReason =
  | 'path-thumbnails-not-rendered'
  | 'independent-saved-path-thumbnails-unsupported';
export type ImagePathsPanelIndependentSavedPathState = 'empty' | 'layer-backed-surrogate-only' | 'document-records';
export type ImagePathsPanelIndependentSavedPathBlocker = 'independent-document-saved-path-storage-unsupported';
export type ImagePathsPanelIndependentSavedPathCaveat =
  | 'saved-paths-use-vector-layer-surrogates'
  | 'work-paths-are-session-only';
export type ImagePathsPanelThumbnailReadinessState = 'empty' | 'ready' | 'mixed' | 'unsupported';
export type ImagePathsPanelThumbnailReadinessRenderer = 'canvas' | 'mixed' | 'none';
export type ImagePathsPanelOperationCheckReadiness = 'ready' | 'blocked';
export type ImagePathsPanelUnsupportedStateCode =
  | 'bezier-handles-unsupported'
  | 'bezier-anchor-conversion-unsupported'
  | 'curvature-path-editing-unsupported'
  | 'detached-saved-path-records-unsupported';
export type ImagePathsPanelUnsupportedStateCategory = 'bezier' | 'saved-paths';
export type ImagePathAnchorEditSessionStatus = 'ready' | 'blocked' | 'unsupported';
export type ImagePathAnchorSelectionMode = 'none' | 'single-anchor' | 'multi-anchor';
export type ImagePathAnchorEditBlocker =
  | 'not-retained-vector-path'
  | 'no-anchors'
  | 'selected-anchor-missing'
  | 'invalid-anchor-delta'
  | 'invalid-anchor-point'
  | 'minimum-anchor-count';
export type ImagePathAnchorUnsupportedCode =
  | 'bezier-handle-editing-unsupported'
  | 'anchor-conversion-unsupported';
export type ImagePathAnchorUnsupportedCategory = 'bezier' | 'anchor-structure';
export type ImagePathAnchorOperationResult = 'retained-vector-path-layer' | 'unsupported';
export type ImagePathAnchorMoveStatus = 'updated' | 'unchanged' | 'blocked';
export type ImagePathAnchorStructureOperation = 'insert' | 'delete';
export type ImagePathConversionOperationKind =
  | 'selection'
  | 'fill'
  | 'stroke'
  | 'vector-mask'
  | 'text-on-path'
  | 'live-stroke-style'
  | 'native-psd-path';
export type ImagePathOperationReadinessState = 'ready' | 'ready-with-caveats' | 'blocked' | 'unsupported';
export type ImagePathOperationBlockerCode =
  | 'not-retained-vector-path'
  | 'path-needs-two-points'
  | 'path-needs-three-points'
  | 'open-path-will-be-closed-for-fill'
  | 'open-path-not-valid-for-vector-mask'
  | 'target-layer-missing'
  | 'target-layer-locked'
  | 'target-layer-is-selected-path'
  | 'bezier-text-on-path-unsupported'
  | 'live-stroke-styles-unsupported'
  | 'native-psd-path-fidelity-unsupported';
export type ImagePathValidityState = 'valid' | 'valid-with-caveats' | 'invalid';

export interface ImagePathOperationReadinessCheck {
  kind: ImagePathConversionOperationKind;
  state: ImagePathOperationReadinessState;
  blockers: ImagePathOperationBlockerCode[];
  result:
    | 'selection-mask'
    | 'retained-vector-fill-layer-copy'
    | 'retained-vector-stroke-layer-copy'
    | 'target-local-retained-vector-mask'
    | 'unsupported';
  destructive: boolean;
  signature: string;
}

export interface ImagePathOperationReadinessLane {
  layerId: string;
  geometrySignature: string;
  pathValidity: {
    closed: boolean;
    pointCount: number;
    selection: ImagePathValidityState;
    fill: ImagePathValidityState;
    stroke: ImagePathValidityState;
    vectorMask: ImagePathValidityState;
  };
  operations: ImagePathOperationReadinessCheck[];
  unsupportedStates: Array<
    'bezier-text-on-path-editing-unsupported'
    | 'live-stroke-styles-unsupported'
    | 'native-psd-path-fidelity-unsupported'
  >;
  signature: string;
}

const IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIZE = 28;
const IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIGNATURE_ID = 'image-path-panel-thumbnail:v1';

export interface ImagePathsPanelReadinessOptions {
  selectedPathLayerId?: string | null;
  targetLayerId?: string | null;
  workPathEntries?: Array<{
    id: string;
    name: string;
    closed: boolean;
    pointCount: number;
    bounds: { x: number; y: number; width: number; height: number };
    /** Document-owned saved paths default to 'saved'; only one 'work' entry exists at a time. */
    kind?: 'work' | 'saved';
  }>;
  includeIndependentSavedPathCaveats?: boolean;
  includeBezierOperationCaveats?: boolean;
}

export interface ImagePathsPanelEntryReadiness {
  id: string;
  layerId: string | null;
  name: string;
  source: ImagePathsPanelEntrySource;
  record: {
    storage: ImagePathsPanelRecordStorage;
    persistence: ImagePathsPanelRecordPersistence;
    editableState: ImagePathsPanelRecordEditableState;
  };
  kind: ImageVectorShape['kind'] | 'work-path';
  closed: boolean;
  pointCount: number;
  bounds: { x: number; y: number; width: number; height: number };
  editReadiness: ImagePathEditReadinessDescriptor;
  thumbnail: {
    supported: boolean;
    status: 'ready' | 'unsupported';
    reason?: ImagePathsPanelEntryThumbnailReadinessReason;
    renderer: ImagePathsPanelEntryReadinessThumbnailRenderer;
    width: number;
    height: number;
    signature: string;
  };
  previewId: string;
  previewSignature: string;
}

export type ImagePathEditReadinessRetainedPath = 'layer-vector-shape-metadata';
export type ImagePathAnchorPointEditState = 'ready-for-retained-anchor-editing' | 'shape-bounds-only';
export type ImagePathAnchorPointCoordinateSpace = 'document' | 'layer-bounds';
export type ImagePathBooleanOperationMode = 'separate-layer-boolean-actions-only';
export type ImagePathHandoffWarningCode =
  | 'rasterize-flattens-retained-path-editing'
  | 'vector-mask-uses-closed-target-local-copy';
export type ImagePathInteropCaveatValue = 'straight-segment-path-only' | 'layer-backed-path-only';

export interface ImagePathEditReadinessDescriptor {
  retainedPath: ImagePathEditReadinessRetainedPath;
  anchorPointEditReadiness: {
    state: ImagePathAnchorPointEditState;
    coordinateSpace: ImagePathAnchorPointCoordinateSpace;
    supportsPointAddDelete: boolean;
    supportsMultiAnchorSelection: false;
  };
  booleanOperations: {
    mode: ImagePathBooleanOperationMode;
    supportsLiveBooleanStack: false;
    supportsBezierOperands: false;
    supportsOverlapResolution: false;
  };
  handoffWarnings: ImagePathHandoffWarningCode[];
  interopCaveats: {
    svg: Extract<ImagePathInteropCaveatValue, 'straight-segment-path-only'>;
    psd: Extract<ImagePathInteropCaveatValue, 'layer-backed-path-only'>;
  };
  previewSignature: string;
}

export interface ImagePathsPanelOperationReadiness {
  ready: boolean;
  blockers: ImagePathsPanelOperationBlocker[];
  caveats: ImagePathsPanelOperationCaveat[];
}

export interface ImagePathsPanelIndependentSavedPathMetadata {
  state: ImagePathsPanelIndependentSavedPathState;
  detachedDocumentRecordsSupported: boolean;
  savedPathMetadataEditable: boolean;
  durableRepresentation: 'vector-layer-metadata' | 'document-record';
  workPathRepresentation: 'temporary-readiness-entry' | 'document-record';
  layerBackedSavedPathCount: number;
  temporaryWorkPathCount: number;
  detachedSavedPathCount: number;
  blockers: ImagePathsPanelIndependentSavedPathBlocker[];
  caveats: ImagePathsPanelIndependentSavedPathCaveat[];
  signature: string;
}

export interface ImagePathsPanelThumbnailReadiness {
  state: ImagePathsPanelThumbnailReadinessState;
  renderer: ImagePathsPanelThumbnailReadinessRenderer;
  readyCount: number;
  unsupportedCount: number;
  signatures: string[];
  signature: string;
}

export interface ImagePathsPanelOperationCheck {
  checkId: `image-paths-panel-operation:${ImagePathsPanelOperationKind}`;
  operation: ImagePathsPanelOperationKind;
  readiness: ImagePathsPanelOperationCheckReadiness;
  ready: boolean;
  selectedEntryId: string | null;
  targetLayerId: string | null;
  blockers: ImagePathsPanelOperationBlocker[];
  caveats: ImagePathsPanelOperationCaveat[];
  signature: string;
}

export interface ImagePathsPanelUnsupportedState {
  code: ImagePathsPanelUnsupportedStateCode;
  category: ImagePathsPanelUnsupportedStateCategory;
  state: 'unsupported';
  affectedOperations: ImagePathsPanelOperationKind[];
  message: string;
}

export interface ImagePathsPanelReadinessSignatures {
  entries: string[];
  thumbnails: string[];
  thumbnailReadiness: string;
  operations: string;
  independentSavedPaths: string;
  unsupportedStates: string;
}

export interface ImagePathsPanelCaveat {
  code: ImagePathsPanelCaveatCode;
  severity: 'warning';
  message: string;
}

export interface ImagePathsPanelExportCaveat {
  code: ImagePathsPanelExportCaveatCode;
  severity: 'warning';
  message: string;
}

export interface ImagePathsPanelReadiness {
  summary: {
    totalEntries: number;
    workPathEntries: number;
    savedPathEntries: number;
    layerBackedPathEntries: number;
    selectedEntryId: string | null;
    targetLayerId: string | null;
  };
  visibility: {
    panel: ImagePathsPanelVisibilityState;
    reason: ImagePathsPanelVisibilityReason;
    selectedEntryVisible: boolean;
  };
  entries: ImagePathsPanelEntryReadiness[];
  independentSavedPaths: ImagePathsPanelIndependentSavedPathMetadata;
  thumbnailReadiness: ImagePathsPanelThumbnailReadiness;
  conversionTargets: {
    selection: 'selection-mask';
    fill: 'retained-vector-fill-layer-copy';
    stroke: 'retained-vector-stroke-layer-copy';
    vectorMask: 'target-local-retained-vector-mask';
  };
  operations: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationReadiness>;
  operationChecks: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationCheck>;
  operationBlockers: ImagePathsPanelOperationBlocker[];
  unsupportedStates: ImagePathsPanelUnsupportedState[];
  caveats: ImagePathsPanelCaveat[];
  exportCaveats: ImagePathsPanelExportCaveat[];
  actionSuitability: {
    panelCommands: Extract<ImagePathsPanelActionSuitabilityState, 'suitable' | 'blocked'>;
    batchActions: Extract<ImagePathsPanelActionSuitabilityState, 'suitable-with-selected-entry-and-target' | 'blocked'>;
    macroPlayback: Extract<ImagePathsPanelActionSuitabilityState, 'suitable-deterministic' | 'blocked'>;
    arbitraryBezierEditing: Extract<ImagePathsPanelActionSuitabilityState, 'suitable'>;
  };
  signatures: ImagePathsPanelReadinessSignatures;
  previewId: 'image-paths-panel-readiness:v1';
  previewSignature: string;
}

export interface ImagePathAnchorEditSessionOperation {
  ready: boolean;
  blockers: Array<ImagePathAnchorEditBlocker | ImagePathAnchorUnsupportedCode>;
  result: ImagePathAnchorOperationResult;
}

export interface ImagePathAnchorUnsupportedState {
  code: ImagePathAnchorUnsupportedCode;
  category: ImagePathAnchorUnsupportedCategory;
  state: 'unsupported';
  message: string;
}

export interface ImagePathAnchorEditSessionOptions {
  selectedAnchorIndices?: number[];
  activeAnchorIndex?: number | null;
}

export interface ImagePathAnchorEditSessionDescriptor {
  layerId: string;
  pathKind: ImageVectorShape['kind'] | 'none';
  status: ImagePathAnchorEditSessionStatus;
  coordinateSpace: ImagePathAnchorPointCoordinateSpace;
  anchorCount: number;
  selection: {
    mode: ImagePathAnchorSelectionMode;
    requestedAnchorIndices: number[];
    selectedAnchorIndices: number[];
    activeAnchorIndex: number | null;
    selectedBounds: { x: number; y: number; width: number; height: number } | null;
  };
  operations: {
    moveSelectedAnchors: ImagePathAnchorEditSessionOperation;
    nudgeSelectedAnchors: ImagePathAnchorEditSessionOperation;
    addAnchor: ImagePathAnchorEditSessionOperation;
    deleteAnchor: ImagePathAnchorEditSessionOperation;
    convertAnchor: ImagePathAnchorEditSessionOperation;
    editBezierHandles: ImagePathAnchorEditSessionOperation;
  };
  unsupportedStates: ImagePathAnchorUnsupportedState[];
  blockers: ImagePathAnchorEditBlocker[];
  previewId: `image-path-anchor-edit-session:${string}`;
  previewSignature: string;
}

export interface ImagePathAnchorMoveOptions {
  anchorIndices: number[];
  delta: { x: number; y: number };
  documentBounds?: { width: number; height: number };
}

export interface ImagePathAnchorMoveResult {
  status: ImagePathAnchorMoveStatus;
  layer: ImageLayer;
  movedAnchorIndices: number[];
  blockers: ImagePathAnchorEditBlocker[];
  beforePoints: ImageVectorPathPoint[];
  afterPoints: ImageVectorPathPoint[];
  clamped: boolean;
  previewSignature: string;
}

export interface ImagePathAnchorInsertOptions {
  afterAnchorIndex: number;
  point: ImageVectorPathPoint;
  documentBounds?: { width: number; height: number };
}

export interface ImagePathAnchorDeleteOptions {
  anchorIndex: number;
}

export interface ImagePathAnchorStructureResult {
  operation: ImagePathAnchorStructureOperation;
  status: ImagePathAnchorMoveStatus;
  layer: ImageLayer;
  anchorIndex: number | null;
  blockers: ImagePathAnchorEditBlocker[];
  beforePoints: ImageVectorPathPoint[];
  afterPoints: ImageVectorPathPoint[];
  clamped: boolean;
  previewSignature: string;
}

export interface ImagePathWorkflowDescriptor {
  pathLayerCount: number;
  straightSegmentPathLayerCount: number;
  pathsPanel: {
    classification: 'layer-backed-paths-panel';
    savedPathPolicy: 'vector-layer-saved-path-surrogate';
    workPathPolicy: 'pen-preview-layer-before-commit';
    independentSavedWorkPaths: boolean;
  };
  operationReadiness: {
    loadSelection: boolean;
    fillPath: boolean;
    strokePath: boolean;
    rasterizeVectorMask: boolean;
  };
  supportStatus: {
    bezierHandles: 'supported';
    curvatureTool: 'supported';
    anchorConversion: 'supported';
    independentDirectSelection: 'supported';
    independentPathSelection: 'supported';
  };
  layers: ImagePathLayerWorkflowDescriptor[];
  capabilities: ImagePathWorkflowCapabilityDescriptor[];
  warnings: ImagePathWorkflowWarning[];
  previewId: 'image-path-workflow:v2';
  previewSignature: string;
}

const IMAGE_PATH_WORKFLOW_CAPABILITY_ORDER: ImagePathWorkflowCapabilityKind[] = [
  'straight-segment-paths',
  'anchor-editing',
  'path-to-selection',
  'path-to-fill-layer',
  'path-to-stroke-layer',
  'bezier-handles',
  'curvature-tool',
  'independent-saved-work-paths',
  'anchor-conversion',
  'independent-direct-selection',
  'independent-path-selection',
  'rasterize-vector-mask',
];

export function getVectorPathLayers(
  doc: Pick<ImageDocument, 'layers'>,
): Array<ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> }> {
  return doc.layers.filter((layer): layer is ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> } => (
    isEditableVectorShapeLayer(layer)
  ));
}

export function describeImagePathWorkflowCapabilities(
  doc: Pick<ImageDocument, 'layers'>,
  options: ImagePathWorkflowDescriptorOptions = {},
): ImagePathWorkflowDescriptor {
  const layers = getVectorPathLayers(doc).map(describeImagePathLayerWorkflow);
  const warnings = getUnsupportedImagePathWorkflowWarnings(options);
  const capabilities = IMAGE_PATH_WORKFLOW_CAPABILITY_ORDER.map((kind) => (
    buildImagePathWorkflowCapabilityDescriptor(kind, warnings)
  ));
  const straightSegmentPathLayerCount = layers.filter((layer) => layer.kind === 'path').length;
  const pathsPanel = buildImagePathsPanelDescriptor();
  const operationReadiness = buildImagePathOperationReadinessDescriptor(layers);
  const supportStatus = buildImagePathSupportStatusDescriptor();

  return {
    pathLayerCount: layers.length,
    straightSegmentPathLayerCount,
    pathsPanel,
    operationReadiness,
    supportStatus,
    layers,
    capabilities,
    warnings,
    previewId: 'image-path-workflow:v2',
    previewSignature: buildImagePathWorkflowPreviewSignature(
      layers,
      capabilities,
      warnings,
      straightSegmentPathLayerCount,
      pathsPanel,
      operationReadiness,
      supportStatus,
    ),
  };
}

export function describeImagePathsPanelReadiness(
  doc: Pick<ImageDocument, 'layers'>,
  options: ImagePathsPanelReadinessOptions = {},
): ImagePathsPanelReadiness {
  const layerEntries = getVectorPathLayers(doc).map(describeImagePathsPanelLayerEntry);
  const workPathEntries = (options.workPathEntries ?? []).map(describeImagePathsPanelWorkPathEntry);
  const entries = [...layerEntries, ...workPathEntries];
  const selectedEntry = selectImagePathsPanelEntry(entries, options.selectedPathLayerId);
  const targetLayer = options.targetLayerId
    ? doc.layers.find((layer) => layer.id === options.targetLayerId) ?? null
    : null;
  const operations = buildImagePathsPanelOperations(entries, selectedEntry, targetLayer, options.targetLayerId ?? null);
  const operationChecks = buildImagePathsPanelOperationChecks(
    operations,
    selectedEntry,
    targetLayer?.id ?? options.targetLayerId ?? null,
  );
  const caveats = buildImagePathsPanelCaveats(options);
  const documentWorkPathCount = (options.workPathEntries ?? []).filter((entry) => entry.kind === 'work').length;
  const documentSavedPathCount = (options.workPathEntries ?? []).filter((entry) => (entry.kind ?? 'saved') === 'saved').length;
  const summary: ImagePathsPanelReadiness['summary'] = {
    totalEntries: entries.length,
    workPathEntries: workPathEntries.length,
    savedPathEntries: layerEntries.length + documentSavedPathCount,
    layerBackedPathEntries: layerEntries.length,
    selectedEntryId: selectedEntry?.id ?? null,
    targetLayerId: targetLayer?.id ?? null,
  };
  const operationBlockers = collectImagePathsPanelOperationBlockers(operations);
  const independentSavedPaths = buildImagePathsPanelIndependentSavedPaths(
    layerEntries.length,
    documentWorkPathCount,
    documentSavedPathCount,
  );
  const thumbnailReadiness = buildImagePathsPanelThumbnailReadiness(entries);
  const unsupportedStates = buildImagePathsPanelUnsupportedStates();
  const signatures = buildImagePathsPanelReadinessSignatures(
    entries,
    thumbnailReadiness,
    operationChecks,
    independentSavedPaths,
    unsupportedStates,
  );
  const readiness: Omit<ImagePathsPanelReadiness, 'previewSignature'> = {
    summary,
    visibility: buildImagePathsPanelVisibility(entries, selectedEntry),
    entries,
    independentSavedPaths,
    thumbnailReadiness,
    conversionTargets: buildImagePathsPanelConversionTargets(),
    operations,
    operationChecks,
    operationBlockers,
    unsupportedStates,
    caveats,
    exportCaveats: buildImagePathsPanelExportCaveats(),
    actionSuitability: buildImagePathsPanelActionSuitability(operationBlockers),
    signatures,
    previewId: 'image-paths-panel-readiness:v1',
  };
  return {
    ...readiness,
    previewSignature: buildImagePathsPanelReadinessPreviewSignature(readiness),
  };
}

export function getUnsupportedImagePathWorkflowWarnings(
  options: ImagePathWorkflowDescriptorOptions = {},
): ImagePathWorkflowWarning[] {
  void options.requireBezierHandles;
  void options.requireCurvatureTool;
  void options.requireIndependentSavedWorkPaths;
  return [];
}

export function vectorPathLayerToSelectionMask(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  layer: ImageLayer,
): SelectionMask {
  const mask = createMask(doc.width, doc.height);
  const shape = getEditableVectorShape(layer);
  if (!shape) return mask;

  const hasComplexTransform = Boolean(
    (layer.rotationDeg ?? 0) !== 0
      || (layer.skewXDeg ?? 0) !== 0
      || (layer.skewYDeg ?? 0) !== 0
      || (layer.perspectiveX ?? 0) !== 0
      || (layer.perspectiveY ?? 0) !== 0
      || (layer.warp && (layer.warp.top !== 0 || layer.warp.right !== 0 || layer.warp.bottom !== 0 || layer.warp.left !== 0))
      || (layer.cornerOffsets && Object.values(layer.cornerOffsets).some((point) => point.x !== 0 || point.y !== 0))
  );

  if (!hasComplexTransform) {
    if (shape.kind === 'ellipse') {
      setEllipse(
        mask,
        layer.x + shape.width / 2,
        layer.y + shape.height / 2,
        shape.width / 2,
        shape.height / 2,
        255,
        true,
      );
      return mask;
    }
    if (shape.kind === 'rect') {
      setRect(mask, layer.x, layer.y, shape.width, shape.height, 255, false);
      return mask;
    }
    if (shape.kind === 'path') {
      rasterizeVectorPathSelection(mask, layer.x, layer.y, shape);
      return mask;
    }
  }

  const materialized = materializeEditableVectorShapeLayer(layer);
  if (!materialized.bitmap) return mask;
  const rasterized = rasterizeLayerBitmapTransformed(materialized.bitmap, materialized);
  const imageData = getBitmapImageData(rasterized.bitmap);

  for (let y = 0; y < imageData.height; y += 1) {
    const targetY = rasterized.top + y;
    if (targetY < 0 || targetY >= mask.height) continue;
    for (let x = 0; x < imageData.width; x += 1) {
      const targetX = rasterized.left + x;
      if (targetX < 0 || targetX >= mask.width) continue;
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha <= 0) continue;
      mask.data[targetY * mask.width + targetX] = alpha;
    }
  }
  return mask;
}

export function createLayerMaskFromVectorPath(
  doc: ImageDocument,
  pathLayer: ImageLayer,
  targetLayer: ImageLayer,
  mode: LayerSelectionMaskMode = 'reveal-selection',
): LayerBitmap {
  return createLayerMaskFromSelection(
    doc,
    targetLayer,
    vectorPathLayerToSelectionMask(doc, pathLayer),
    mode,
  );
}

export function createVectorMaskDescriptorFromVectorPath(
  pathLayer: ImageLayer,
  targetLayer: ImageLayer,
): ImageVectorMaskDescriptorInput | null {
  const sourcePoints = getVectorMaskSourceDocumentPoints(pathLayer);
  if (sourcePoints.length < 3) return null;
  return {
    id: `vector-mask-${targetLayer.id}`,
    name: `${pathLayer.name} Vector Mask`,
    kind: 'path',
    targetLayerId: targetLayer.id,
    enabled: true,
    inverted: false,
    linked: true,
    path: {
      closed: true,
      points: sourcePoints.map((point) => ({
        x: point.x - targetLayer.x,
        y: point.y - targetLayer.y,
      })),
    },
  };
}

export function describeImagePathAnchorEditSession(
  layer: ImageLayer,
  options: ImagePathAnchorEditSessionOptions = {},
): ImagePathAnchorEditSessionDescriptor {
  const shape = getEditableVectorShape(layer);
  const pathKind = shape?.kind ?? 'none';
  const documentPoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : [];
  const requestedAnchorIndices = options.selectedAnchorIndices ?? [];
  const selectedAnchorIndices = normalizeImagePathAnchorIndices(requestedAnchorIndices, documentPoints.length);
  const activeAnchorIndex = resolveImagePathActiveAnchorIndex(
    options.activeAnchorIndex ?? null,
    selectedAnchorIndices,
  );
  const blockers = buildImagePathAnchorEditSessionBlockers(shape, documentPoints.length, requestedAnchorIndices, selectedAnchorIndices);
  const status: ImagePathAnchorEditSessionStatus = !shape || shape.kind !== 'path'
    ? 'unsupported'
    : documentPoints.length === 0
      ? 'blocked'
      : 'ready';
  const canMoveSelectedAnchors = shape?.kind === 'path' && documentPoints.length > 0 && selectedAnchorIndices.length > 0;
  const canAddAnchor = canMoveSelectedAnchors;
  const canDeleteAnchor = canMoveSelectedAnchors && documentPoints.length > 2;
  const canConvertAnchor = canMoveSelectedAnchors;
  const canEditBezierHandles = canMoveSelectedAnchors;
  const selectedBounds = buildImagePathAnchorSelectedBounds(documentPoints, selectedAnchorIndices);
  const unsupportedStates = buildImagePathAnchorUnsupportedStates({ bezierHandlesSupported: canEditBezierHandles });
  const descriptor: Omit<ImagePathAnchorEditSessionDescriptor, 'previewSignature'> = {
    layerId: layer.id,
    pathKind,
    status,
    coordinateSpace: shape?.kind === 'path' ? 'document' : 'layer-bounds',
    anchorCount: documentPoints.length,
    selection: {
      mode: selectedAnchorIndices.length > 1
        ? 'multi-anchor'
        : selectedAnchorIndices.length === 1
          ? 'single-anchor'
          : 'none',
      requestedAnchorIndices,
      selectedAnchorIndices,
      activeAnchorIndex,
      selectedBounds,
    },
    operations: {
      moveSelectedAnchors: {
        ready: canMoveSelectedAnchors,
        blockers: canMoveSelectedAnchors ? [] : buildImagePathAnchorMoveBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canMoveSelectedAnchors ? 'retained-vector-path-layer' : 'unsupported',
      },
      nudgeSelectedAnchors: {
        ready: canMoveSelectedAnchors,
        blockers: canMoveSelectedAnchors ? [] : buildImagePathAnchorMoveBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canMoveSelectedAnchors ? 'retained-vector-path-layer' : 'unsupported',
      },
      addAnchor: {
        ready: canAddAnchor,
        blockers: canAddAnchor ? [] : buildImagePathAnchorMoveBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canAddAnchor ? 'retained-vector-path-layer' : 'unsupported',
      },
      deleteAnchor: {
        ready: canDeleteAnchor,
        blockers: canDeleteAnchor
          ? []
          : buildImagePathAnchorDeleteBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canDeleteAnchor ? 'retained-vector-path-layer' : 'unsupported',
      },
      convertAnchor: {
        ready: canConvertAnchor,
        blockers: canConvertAnchor ? [] : buildImagePathAnchorMoveBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canConvertAnchor ? 'retained-vector-path-layer' : 'unsupported',
      },
      editBezierHandles: {
        ready: canEditBezierHandles,
        blockers: canEditBezierHandles ? [] : buildImagePathAnchorMoveBlockers(shape, documentPoints.length, selectedAnchorIndices),
        result: canEditBezierHandles ? 'retained-vector-path-layer' : 'unsupported',
      },
    },
    unsupportedStates,
    blockers,
    previewId: `image-path-anchor-edit-session:${layer.id}`,
  };

  return {
    ...descriptor,
    previewSignature: buildImagePathAnchorEditSessionPreviewSignature(descriptor),
  };
}

export function moveImagePathAnchors(
  layer: ImageLayer,
  options: ImagePathAnchorMoveOptions,
): ImagePathAnchorMoveResult {
  const shape = getEditableVectorShape(layer);
  const beforePoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : [];
  const movedAnchorIndices = normalizeImagePathAnchorIndices(options.anchorIndices, beforePoints.length);
  const delta = {
    x: normalizePathWorkflowNumber(options.delta.x),
    y: normalizePathWorkflowNumber(options.delta.y),
  };
  const blockers: ImagePathAnchorEditBlocker[] = [];
  if (!shape || shape.kind !== 'path') {
    blockers.push('not-retained-vector-path');
  }
  if (shape?.kind === 'path' && beforePoints.length === 0) {
    blockers.push('no-anchors');
  }
  if (movedAnchorIndices.length === 0) {
    blockers.push('selected-anchor-missing');
  }
  if (!Number.isFinite(options.delta.x) || !Number.isFinite(options.delta.y)) {
    blockers.push('invalid-anchor-delta');
  }

  if (blockers.length > 0 || !shape || shape.kind !== 'path') {
    return buildImagePathAnchorMoveResult({
      status: 'blocked',
      layer,
      movedAnchorIndices,
      blockers: uniqueImagePathAnchorBlockers(blockers),
      beforePoints,
      afterPoints: beforePoints,
      delta,
      documentBounds: options.documentBounds,
      clamped: false,
    });
  }

  let clamped = false;
  const afterPoints = beforePoints.map((point, index) => {
    if (!movedAnchorIndices.includes(index)) return point;
    const moved = {
      x: Math.round(point.x + delta.x),
      y: Math.round(point.y + delta.y),
    };
    const bounded = clampImagePathAnchorPoint(moved, options.documentBounds);
    if (bounded.x !== moved.x || bounded.y !== moved.y) {
      clamped = true;
    }
    return bounded;
  });
  const changed = afterPoints.some((point, index) => (
    point.x !== beforePoints[index]?.x || point.y !== beforePoints[index]?.y
  ));
  const nextLayer = changed
    ? buildVectorPathLayer({
        doc: null,
        points: afterPoints,
        closed: shape.closed,
        settings: shape,
        existingLayer: layer,
      })
    : layer;

  return buildImagePathAnchorMoveResult({
    status: changed ? 'updated' : 'unchanged',
    layer: nextLayer,
    movedAnchorIndices,
    blockers: [],
    beforePoints,
    afterPoints,
    delta,
    documentBounds: options.documentBounds,
    clamped,
  });
}

export function insertImagePathAnchor(
  layer: ImageLayer,
  options: ImagePathAnchorInsertOptions,
): ImagePathAnchorStructureResult {
  const shape = getEditableVectorShape(layer);
  const beforePoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : [];
  const blockers: ImagePathAnchorEditBlocker[] = [];
  const afterAnchorIndex = Number.isInteger(options.afterAnchorIndex) ? options.afterAnchorIndex : -1;
  const hasValidPoint = Number.isFinite(options.point.x) && Number.isFinite(options.point.y);
  if (!shape || shape.kind !== 'path') {
    blockers.push('not-retained-vector-path');
  }
  if (shape?.kind === 'path' && beforePoints.length === 0) {
    blockers.push('no-anchors');
  }
  if (afterAnchorIndex < 0 || afterAnchorIndex >= beforePoints.length) {
    blockers.push('selected-anchor-missing');
  }
  if (!hasValidPoint) {
    blockers.push('invalid-anchor-point');
  }

  if (blockers.length > 0 || !shape || shape.kind !== 'path') {
    return buildImagePathAnchorStructureResult({
      operation: 'insert',
      status: 'blocked',
      layer,
      anchorIndex: null,
      blockers: uniqueImagePathAnchorBlockers(blockers),
      beforePoints,
      afterPoints: beforePoints,
      documentBounds: options.documentBounds,
      clamped: false,
    });
  }

  const roundedPoint = {
    x: Math.round(options.point.x),
    y: Math.round(options.point.y),
  };
  const boundedPoint = clampImagePathAnchorPoint(roundedPoint, options.documentBounds);
  const clamped = boundedPoint.x !== roundedPoint.x || boundedPoint.y !== roundedPoint.y;
  const anchorIndex = afterAnchorIndex + 1;
  const afterPoints = [
    ...beforePoints.slice(0, anchorIndex),
    boundedPoint,
    ...beforePoints.slice(anchorIndex),
  ];
  const nextLayer = buildVectorPathLayer({
    doc: null,
    points: afterPoints,
    closed: shape.closed,
    settings: shape,
    existingLayer: layer,
  });

  return buildImagePathAnchorStructureResult({
    operation: 'insert',
    status: 'updated',
    layer: nextLayer,
    anchorIndex,
    blockers: [],
    beforePoints,
    afterPoints,
    documentBounds: options.documentBounds,
    clamped,
  });
}

export function deleteImagePathAnchor(
  layer: ImageLayer,
  options: ImagePathAnchorDeleteOptions,
): ImagePathAnchorStructureResult {
  const shape = getEditableVectorShape(layer);
  const beforePoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : [];
  const blockers: ImagePathAnchorEditBlocker[] = [];
  const anchorIndex = Number.isInteger(options.anchorIndex) ? options.anchorIndex : -1;
  if (!shape || shape.kind !== 'path') {
    blockers.push('not-retained-vector-path');
  }
  if (shape?.kind === 'path' && beforePoints.length === 0) {
    blockers.push('no-anchors');
  }
  if (anchorIndex < 0 || anchorIndex >= beforePoints.length) {
    blockers.push('selected-anchor-missing');
  }
  if (beforePoints.length <= 2) {
    blockers.push('minimum-anchor-count');
  }

  if (blockers.length > 0 || !shape || shape.kind !== 'path') {
    return buildImagePathAnchorStructureResult({
      operation: 'delete',
      status: 'blocked',
      layer,
      anchorIndex: anchorIndex >= 0 && anchorIndex < beforePoints.length ? anchorIndex : null,
      blockers: uniqueImagePathAnchorBlockers(blockers),
      beforePoints,
      afterPoints: beforePoints,
      clamped: false,
    });
  }

  const afterPoints = beforePoints.filter((_, index) => index !== anchorIndex);
  const nextLayer = buildVectorPathLayer({
    doc: null,
    points: afterPoints,
    closed: shape.closed,
    settings: shape,
    existingLayer: layer,
  });

  return buildImagePathAnchorStructureResult({
    operation: 'delete',
    status: 'updated',
    layer: nextLayer,
    anchorIndex,
    blockers: [],
    beforePoints,
    afterPoints,
    clamped: false,
  });
}

export function buildImagePathGeometrySignature(layer: ImageLayer): string {
  const shape = getEditableVectorShape(layer);
  const documentPoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : getImagePathShapeDocumentPoints(layer, shape);
  const bounds = buildImagePathDocumentPointBounds(documentPoints, layer, shape);
  const payload = {
    layerId: layer.id,
    kind: shape?.kind ?? 'none',
    closed: shape?.kind === 'path' ? shape.closed : Boolean(shape),
    pointCount: documentPoints.length,
    bounds,
    points: documentPoints,
    hasBezierHandles: false,
  };
  return `image-path-geometry:v1:${JSON.stringify(payload)}`;
}

export function describeImagePathOperationReadinessLane(
  layer: ImageLayer,
  targetLayer: ImageLayer | null = null,
): ImagePathOperationReadinessLane {
  const shape = getEditableVectorShape(layer);
  const documentPoints = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : getImagePathShapeDocumentPoints(layer, shape);
  const pointCount = documentPoints.length;
  const closed = shape?.kind === 'path' ? shape.closed : Boolean(shape);
  const geometrySignature = buildImagePathGeometrySignature(layer);
  const pathValidity: ImagePathOperationReadinessLane['pathValidity'] = {
    closed,
    pointCount,
    selection: shape && pointCount >= 2 ? 'valid' : 'invalid',
    fill: shape && pointCount >= 2 ? (closed ? 'valid' : 'valid-with-caveats') : 'invalid',
    stroke: shape && pointCount >= 2 ? 'valid' : 'invalid',
    vectorMask: shape && pointCount >= 3 && closed && targetLayer && !targetLayer.locked && targetLayer.id !== layer.id
      ? 'valid'
      : 'invalid',
  };
  const operations: ImagePathOperationReadinessCheck[] = [
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'selection',
      state: pathValidity.selection === 'valid' ? 'ready' : 'blocked',
      blockers: pathValidity.selection === 'valid' ? [] : buildBaseImagePathOperationBlockers(shape, pointCount, 2),
      result: 'selection-mask',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'fill',
      state: pathValidity.fill === 'valid'
        ? 'ready'
        : pathValidity.fill === 'valid-with-caveats'
          ? 'ready-with-caveats'
          : 'blocked',
      blockers: pathValidity.fill === 'valid'
        ? []
        : pathValidity.fill === 'valid-with-caveats'
          ? ['open-path-will-be-closed-for-fill']
          : buildBaseImagePathOperationBlockers(shape, pointCount, 2),
      result: 'retained-vector-fill-layer-copy',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'stroke',
      state: pathValidity.stroke === 'valid' ? 'ready' : 'blocked',
      blockers: pathValidity.stroke === 'valid' ? [] : buildBaseImagePathOperationBlockers(shape, pointCount, 2),
      result: 'retained-vector-stroke-layer-copy',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'vector-mask',
      state: pathValidity.vectorMask === 'valid' ? 'ready' : 'blocked',
      blockers: buildImagePathVectorMaskOperationBlockers(shape, pointCount, closed, layer, targetLayer),
      result: 'target-local-retained-vector-mask',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'text-on-path',
      state: 'unsupported',
      blockers: ['bezier-text-on-path-unsupported'],
      result: 'unsupported',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'live-stroke-style',
      state: 'unsupported',
      blockers: ['live-stroke-styles-unsupported'],
      result: 'unsupported',
      destructive: false,
    }),
    buildImagePathOperationCheck({
      layerId: layer.id,
      geometrySignature,
      kind: 'native-psd-path',
      state: 'unsupported',
      blockers: ['native-psd-path-fidelity-unsupported'],
      result: 'unsupported',
      destructive: false,
    }),
  ];
  const unsupportedStates: ImagePathOperationReadinessLane['unsupportedStates'] = [
    'bezier-text-on-path-editing-unsupported',
    'live-stroke-styles-unsupported',
    'native-psd-path-fidelity-unsupported',
  ];
  const payload = {
    layerId: layer.id,
    geometry: geometrySignature,
    pathValidity,
    operations: operations.map((operation) => operation.signature),
    unsupportedStates,
  };
  return {
    layerId: layer.id,
    geometrySignature,
    pathValidity,
    operations,
    unsupportedStates,
    signature: `image-path-operation-readiness:v1:${JSON.stringify(payload)}`,
  };
}

function getVectorMaskSourceDocumentPoints(layer: ImageLayer): ImageVectorPathPoint[] {
  const shape = getEditableVectorShape(layer);
  if (!shape || hasComplexVectorMaskSourceTransform(layer)) return [];
  if (shape.kind === 'path') {
    return getVectorPathDocumentPoints(layer);
  }
  if (shape.kind === 'rect') {
    return [
      { x: layer.x, y: layer.y },
      { x: layer.x + shape.width, y: layer.y },
      { x: layer.x + shape.width, y: layer.y + shape.height },
      { x: layer.x, y: layer.y + shape.height },
    ];
  }
  const cx = layer.x + shape.width / 2;
  const cy = layer.y + shape.height / 2;
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  return Array.from({ length: 24 }, (_, index) => {
    const theta = (Math.PI * 2 * index) / 24;
    return {
      x: cx + Math.cos(theta) * rx,
      y: cy + Math.sin(theta) * ry,
    };
  });
}

function hasComplexVectorMaskSourceTransform(layer: ImageLayer): boolean {
  return Boolean(
    (layer.rotationDeg ?? 0) !== 0
      || (layer.skewXDeg ?? 0) !== 0
      || (layer.skewYDeg ?? 0) !== 0
      || (layer.perspectiveX ?? 0) !== 0
      || (layer.perspectiveY ?? 0) !== 0
      || (layer.warp && (layer.warp.top !== 0 || layer.warp.right !== 0 || layer.warp.bottom !== 0 || layer.warp.left !== 0))
      || (layer.cornerOffsets && Object.values(layer.cornerOffsets).some((point) => point.x !== 0 || point.y !== 0))
  );
}

function getImagePathShapeDocumentPoints(
  layer: ImageLayer,
  shape: ImageVectorShape | null,
): ImageVectorPathPoint[] {
  if (!shape) return [];
  if (shape.kind === 'rect') {
    return [
      { x: normalizePathWorkflowNumber(layer.x), y: normalizePathWorkflowNumber(layer.y) },
      { x: normalizePathWorkflowNumber(layer.x + shape.width), y: normalizePathWorkflowNumber(layer.y) },
      { x: normalizePathWorkflowNumber(layer.x + shape.width), y: normalizePathWorkflowNumber(layer.y + shape.height) },
      { x: normalizePathWorkflowNumber(layer.x), y: normalizePathWorkflowNumber(layer.y + shape.height) },
    ];
  }
  if (shape.kind === 'ellipse') {
    const cx = layer.x + shape.width / 2;
    const cy = layer.y + shape.height / 2;
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    return Array.from({ length: 8 }, (_, index) => {
      const theta = (Math.PI * 2 * index) / 8;
      return {
        x: normalizePathWorkflowNumber(cx + Math.cos(theta) * rx),
        y: normalizePathWorkflowNumber(cy + Math.sin(theta) * ry),
      };
    });
  }
  return [];
}

function buildImagePathDocumentPointBounds(
  points: ImageVectorPathPoint[],
  layer: ImageLayer,
  shape: ImageVectorShape | null,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) {
    return {
      x: normalizePathWorkflowNumber(layer.x),
      y: normalizePathWorkflowNumber(layer.y),
      width: normalizePathWorkflowNumber(shape?.width ?? 0),
      height: normalizePathWorkflowNumber(shape?.height ?? 0),
    };
  }
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: normalizePathWorkflowNumber(minX),
    y: normalizePathWorkflowNumber(minY),
    width: normalizePathWorkflowNumber(maxX - minX),
    height: normalizePathWorkflowNumber(maxY - minY),
  };
}

function buildBaseImagePathOperationBlockers(
  shape: ImageVectorShape | null,
  pointCount: number,
  minimumPoints: 2 | 3,
): ImagePathOperationBlockerCode[] {
  if (!shape) return ['not-retained-vector-path'];
  if (pointCount < minimumPoints) return [minimumPoints === 2 ? 'path-needs-two-points' : 'path-needs-three-points'];
  return [];
}

function buildImagePathVectorMaskOperationBlockers(
  shape: ImageVectorShape | null,
  pointCount: number,
  closed: boolean,
  layer: ImageLayer,
  targetLayer: ImageLayer | null,
): ImagePathOperationBlockerCode[] {
  const blockers = buildBaseImagePathOperationBlockers(shape, pointCount, 3);
  if (shape && !closed) blockers.push('open-path-not-valid-for-vector-mask');
  if (!targetLayer) blockers.push('target-layer-missing');
  if (targetLayer?.locked) blockers.push('target-layer-locked');
  if (targetLayer?.id === layer.id) blockers.push('target-layer-is-selected-path');
  return blockers;
}

function buildImagePathOperationCheck(params: {
  layerId: string;
  geometrySignature: string;
  kind: ImagePathConversionOperationKind;
  state: ImagePathOperationReadinessState;
  blockers: ImagePathOperationBlockerCode[];
  result: ImagePathOperationReadinessCheck['result'];
  destructive: boolean;
}): ImagePathOperationReadinessCheck {
  const payload = {
    layerId: params.layerId,
    kind: params.kind,
    state: params.state,
    blockers: params.blockers,
    result: params.result,
    destructive: params.destructive,
    geometry: params.geometrySignature,
  };
  return {
    kind: params.kind,
    state: params.state,
    blockers: params.blockers,
    result: params.result,
    destructive: params.destructive,
    signature: `image-path-operation:v1:${JSON.stringify(payload)}`,
  };
}

function normalizeImagePathAnchorIndices(anchorIndices: number[], anchorCount: number): number[] {
  const selected: number[] = [];
  anchorIndices.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= anchorCount) return;
    if (selected.includes(index)) return;
    selected.push(index);
  });
  return selected;
}

function resolveImagePathActiveAnchorIndex(
  requestedActiveAnchorIndex: number | null,
  selectedAnchorIndices: number[],
): number | null {
  if (
    typeof requestedActiveAnchorIndex === 'number'
    && Number.isInteger(requestedActiveAnchorIndex)
    && selectedAnchorIndices.includes(requestedActiveAnchorIndex)
  ) {
    return requestedActiveAnchorIndex;
  }
  return selectedAnchorIndices[0] ?? null;
}

function buildImagePathAnchorEditSessionBlockers(
  shape: ImageVectorShape | null,
  anchorCount: number,
  requestedAnchorIndices: number[],
  selectedAnchorIndices: number[],
): ImagePathAnchorEditBlocker[] {
  if (!shape || shape.kind !== 'path') return ['not-retained-vector-path'];
  if (anchorCount === 0) return ['no-anchors'];
  if (requestedAnchorIndices.length > 0 && selectedAnchorIndices.length === 0) return ['selected-anchor-missing'];
  return [];
}

function buildImagePathAnchorMoveBlockers(
  shape: ImageVectorShape | null,
  anchorCount: number,
  selectedAnchorIndices: number[],
): ImagePathAnchorEditBlocker[] {
  if (!shape || shape.kind !== 'path') return ['not-retained-vector-path'];
  if (anchorCount === 0) return ['no-anchors'];
  if (selectedAnchorIndices.length === 0) return ['selected-anchor-missing'];
  return [];
}

function buildImagePathAnchorDeleteBlockers(
  shape: ImageVectorShape | null,
  anchorCount: number,
  selectedAnchorIndices: number[],
): ImagePathAnchorEditBlocker[] {
  const blockers = buildImagePathAnchorMoveBlockers(shape, anchorCount, selectedAnchorIndices);
  if (shape?.kind === 'path' && anchorCount <= 2) blockers.push('minimum-anchor-count');
  return uniqueImagePathAnchorBlockers(blockers);
}

function buildImagePathAnchorSelectedBounds(
  points: ImageVectorPathPoint[],
  selectedAnchorIndices: number[],
): ImagePathAnchorEditSessionDescriptor['selection']['selectedBounds'] {
  const selectedPoints = selectedAnchorIndices
    .map((index) => points[index])
    .filter((point): point is ImageVectorPathPoint => Boolean(point));
  if (selectedPoints.length === 0) return null;
  const minX = Math.min(...selectedPoints.map((point) => point.x));
  const minY = Math.min(...selectedPoints.map((point) => point.y));
  const maxX = Math.max(...selectedPoints.map((point) => point.x));
  const maxY = Math.max(...selectedPoints.map((point) => point.y));
  return {
    x: normalizePathWorkflowNumber(minX),
    y: normalizePathWorkflowNumber(minY),
    width: normalizePathWorkflowDimension(maxX - minX),
    height: normalizePathWorkflowDimension(maxY - minY),
  };
}

function buildImagePathAnchorUnsupportedStates({
  bezierHandlesSupported,
}: {
  bezierHandlesSupported: boolean;
}): ImagePathAnchorUnsupportedState[] {
  return [
    ...(bezierHandlesSupported ? [] : [{
      code: 'bezier-handle-editing-unsupported' as const,
      category: 'bezier' as const,
      state: 'unsupported' as const,
      message: 'Select at least one retained path anchor before editing Bezier handles.',
    }]),
  ];
}

function buildImagePathAnchorEditSessionPreviewSignature(
  descriptor: Omit<ImagePathAnchorEditSessionDescriptor, 'previewSignature'>,
): string {
  return `image-path-anchor-edit-session:v1:${JSON.stringify({
    layerId: descriptor.layerId,
    pathKind: descriptor.pathKind,
    status: descriptor.status,
    anchorCount: descriptor.anchorCount,
    selectedAnchorIndices: descriptor.selection.selectedAnchorIndices,
    activeAnchorIndex: descriptor.selection.activeAnchorIndex,
    selectedBounds: descriptor.selection.selectedBounds,
    operationReady: {
      move: descriptor.operations.moveSelectedAnchors.ready,
      nudge: descriptor.operations.nudgeSelectedAnchors.ready,
      add: descriptor.operations.addAnchor.ready,
      delete: descriptor.operations.deleteAnchor.ready,
      convert: descriptor.operations.convertAnchor.ready,
      bezier: descriptor.operations.editBezierHandles.ready,
    },
    unsupported: descriptor.unsupportedStates.map((state) => state.code),
    blockers: descriptor.blockers,
  })}`;
}

function clampImagePathAnchorPoint(
  point: ImageVectorPathPoint,
  documentBounds: ImagePathAnchorMoveOptions['documentBounds'],
): ImageVectorPathPoint {
  if (!documentBounds) return point;
  const maxX = Number.isFinite(documentBounds.width) ? Math.max(0, Math.round(documentBounds.width)) : point.x;
  const maxY = Number.isFinite(documentBounds.height) ? Math.max(0, Math.round(documentBounds.height)) : point.y;
  return {
    x: Math.min(maxX, Math.max(0, point.x)),
    y: Math.min(maxY, Math.max(0, point.y)),
  };
}

function uniqueImagePathAnchorBlockers(
  blockers: ImagePathAnchorEditBlocker[],
): ImagePathAnchorEditBlocker[] {
  return blockers.filter((blocker, index) => blockers.indexOf(blocker) === index);
}

function buildImagePathAnchorMoveResult(params: {
  status: ImagePathAnchorMoveStatus;
  layer: ImageLayer;
  movedAnchorIndices: number[];
  blockers: ImagePathAnchorEditBlocker[];
  beforePoints: ImageVectorPathPoint[];
  afterPoints: ImageVectorPathPoint[];
  delta: { x: number; y: number };
  documentBounds?: { width: number; height: number };
  clamped: boolean;
}): ImagePathAnchorMoveResult {
  const payload = {
    status: params.status,
    layerId: params.layer.id,
    movedAnchorIndices: params.movedAnchorIndices,
    delta: params.delta,
    ...(params.documentBounds ? { documentBounds: params.documentBounds } : {}),
    clamped: params.clamped,
    blockers: params.blockers,
    beforePoints: params.beforePoints,
    afterPoints: params.afterPoints,
  };
  return {
    status: params.status,
    layer: params.layer,
    movedAnchorIndices: params.movedAnchorIndices,
    blockers: params.blockers,
    beforePoints: params.beforePoints,
    afterPoints: params.afterPoints,
    clamped: params.clamped,
    previewSignature: `image-path-anchor-move:v1:${JSON.stringify(payload)}`,
  };
}

function buildImagePathAnchorStructureResult(params: {
  operation: ImagePathAnchorStructureOperation;
  status: ImagePathAnchorMoveStatus;
  layer: ImageLayer;
  anchorIndex: number | null;
  blockers: ImagePathAnchorEditBlocker[];
  beforePoints: ImageVectorPathPoint[];
  afterPoints: ImageVectorPathPoint[];
  documentBounds?: { width: number; height: number };
  clamped: boolean;
}): ImagePathAnchorStructureResult {
  const payload = {
    operation: params.operation,
    status: params.status,
    layerId: params.layer.id,
    anchorIndex: params.anchorIndex,
    ...(params.documentBounds ? { documentBounds: params.documentBounds } : {}),
    clamped: params.clamped,
    blockers: params.blockers,
    beforePoints: params.beforePoints,
    afterPoints: params.afterPoints,
  };
  return {
    operation: params.operation,
    status: params.status,
    layer: params.layer,
    anchorIndex: params.anchorIndex,
    blockers: params.blockers,
    beforePoints: params.beforePoints,
    afterPoints: params.afterPoints,
    clamped: params.clamped,
    previewSignature: `image-path-anchor-structure:v1:${JSON.stringify(payload)}`,
  };
}

function rasterizeVectorPathSelection(
  mask: SelectionMask,
  originX: number,
  originY: number,
  shape: NonNullable<ImageLayer['metadata']>['vectorShape'],
): void {
  if (!shape || shape.kind !== 'path' || shape.points.length < 2) return;
  const documentPoints = shape.points.map((point) => ({
    x: originX + point.x,
    y: originY + point.y,
  }));
  if (shape.closed && shape.fillOpacity > 0 && documentPoints.length >= 3) {
    setPolygon(mask, documentPoints);
  }
  if (shape.strokeWidth <= 0) return;
  const strokeRadius = Math.max(1, Math.ceil((shape.strokeWidth || 1) / 2));
  for (let index = 1; index < documentPoints.length; index += 1) {
    rasterizeLineStroke(mask, documentPoints[index - 1]!, documentPoints[index]!, strokeRadius);
  }
  if (shape.closed) {
    rasterizeLineStroke(mask, documentPoints[documentPoints.length - 1]!, documentPoints[0]!, strokeRadius);
  }
}

function rasterizeLineStroke(
  mask: SelectionMask,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    stampCircle(mask, x, y, radius);
  }
}

function stampCircle(mask: SelectionMask, cx: number, cy: number, radius: number): void {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radiusSquared) continue;
      mask.data[y * mask.width + x] = 255;
    }
  }
}

export function createFillLayerFromVectorPath(
  _doc: Pick<ImageDocument, 'layers'>,
  layer: ImageLayer,
  settings: ShapeToolSettings,
): ImageLayer {
  const source = cloneVectorPathLayer(layer, `${layer.name} Fill`);
  const fillOpacity = settings.fillOpacity > 0 ? settings.fillOpacity : 1;
  return updateEditableVectorShapeLayer(source, {
    ...(source.metadata?.vectorShape?.kind === 'path' ? { closed: true } : {}),
    fillColor: settings.fillColor,
    fillOpacity,
    strokeWidth: 0,
  });
}

export function createStrokeLayerFromVectorPath(
  _doc: Pick<ImageDocument, 'layers'>,
  layer: ImageLayer,
  settings: ShapeToolSettings,
): ImageLayer {
  const source = cloneVectorPathLayer(layer, `${layer.name} Stroke`);
  const strokeWidth = settings.strokeWidth > 0 ? settings.strokeWidth : 4;
  return updateEditableVectorShapeLayer(source, {
    fillOpacity: 0,
    strokeColor: settings.strokeColor,
    strokeOpacity: settings.strokeOpacity,
    strokeWidth,
  });
}

function cloneVectorPathLayer(layer: ImageLayer, name: string): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape) return layer;
  const id = globalThis.crypto?.randomUUID?.()
    ? `layer-vector-${globalThis.crypto.randomUUID()}`
    : `layer-vector-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}-${vectorPathCloneSequence += 1}`;
  return {
    ...layer,
    id,
    name,
    metadata: {
      ...layer.metadata,
      vectorShape: { ...shape },
    },
    bitmapVersion: 0,
  };
}

let vectorPathCloneSequence = 0;

function describeImagePathLayerWorkflow(
  layer: ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> },
): ImagePathLayerWorkflowDescriptor {
  const shape = getEditableVectorShape(layer)!;
  const editReadiness = describeImagePathEditReadiness(shape);
  const descriptor: Omit<ImagePathLayerWorkflowDescriptor, 'previewSignature'> = {
    layerId: layer.id,
    name: layer.name,
    kind: shape.kind,
    classification: shape.kind === 'path' ? 'saved-layer-path' : 'saved-shape-path',
    closed: shape.kind === 'path' ? shape.closed : true,
    pointCount: getImagePathWorkflowPointCount(shape),
    bounds: {
      x: normalizePathWorkflowNumber(layer.x),
      y: normalizePathWorkflowNumber(layer.y),
      width: normalizePathWorkflowDimension(shape.width),
      height: normalizePathWorkflowDimension(shape.height),
    },
    editableAnchors: shape.kind === 'path' && shape.points.length > 0,
    anchorEditing: buildImagePathAnchorEditingDescriptor(shape),
    editReadiness,
    canConvertToSelection: true,
    canCreateFillLayer: true,
    canCreateStrokeLayer: true,
    canRasterizeVectorMask: true,
    hasBezierHandles: false,
    previewId: `image-path-layer:${layer.id}`,
  };
  return {
    ...descriptor,
    previewSignature: buildImagePathLayerPreviewSignature(descriptor),
  };
}

export function describeImagePathsPanelLayerEntry(
  layer: ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> },
): ImagePathsPanelEntryReadiness {
  const workflowLayer = describeImagePathLayerWorkflow(layer);
  const entry: Omit<ImagePathsPanelEntryReadiness, 'previewSignature'> = {
    id: layer.id,
    layerId: layer.id,
    name: layer.name,
    source: 'layer-backed-saved-path',
    record: {
      storage: 'vector-layer',
      persistence: 'layer-stack',
      editableState: workflowLayer.kind === 'path' ? 'straight-anchor-editable' : 'shape-bounds-editable',
    },
    kind: workflowLayer.kind,
    closed: workflowLayer.closed,
    pointCount: workflowLayer.pointCount,
    bounds: workflowLayer.bounds,
    editReadiness: workflowLayer.editReadiness,
    thumbnail: buildImagePathsPanelLayerThumbnail(layer),
    previewId: `image-path-panel-entry:${layer.id}`,
  };
  return {
    ...entry,
    previewSignature: buildImagePathsPanelEntryPreviewSignature(entry),
  };
}

export function describeImagePathsPanelWorkPathEntry(
  workPath: NonNullable<ImagePathsPanelReadinessOptions['workPathEntries']>[number],
): ImagePathsPanelEntryReadiness {
  const editReadiness = describeImagePathEditReadiness({
    kind: 'path',
    width: workPath.bounds.width,
    height: workPath.bounds.height,
    closed: workPath.closed,
    points: Array.from({ length: workPath.pointCount }, () => ({ x: 0, y: 0 })),
    fillColor: '#ffffff',
    fillOpacity: 1,
    strokeColor: '#000000',
    strokeOpacity: 1,
    strokeWidth: 1,
  });
  const entry: Omit<ImagePathsPanelEntryReadiness, 'previewSignature'> = {
    id: workPath.id,
    layerId: null,
    name: workPath.name,
    source: 'document-work-path',
    record: {
      storage: 'document-work-path',
      persistence: 'temporary-session',
      editableState: 'straight-anchor-editable',
    },
    kind: 'work-path',
    closed: workPath.closed,
    pointCount: workPath.pointCount,
    bounds: {
      x: normalizePathWorkflowNumber(workPath.bounds.x),
      y: normalizePathWorkflowNumber(workPath.bounds.y),
      width: normalizePathWorkflowDimension(workPath.bounds.width),
      height: normalizePathWorkflowDimension(workPath.bounds.height),
    },
    editReadiness,
    thumbnail: buildUnsupportedImagePathsPanelThumbnail('independent-saved-path-thumbnails-unsupported'),
    previewId: `image-path-panel-entry:${workPath.id}`,
  };
  return {
    ...entry,
    previewSignature: buildImagePathsPanelEntryPreviewSignature(entry),
  };
}

function buildImagePathsPanelLayerThumbnail(
  layer: ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> },
): ImagePathsPanelEntryReadiness['thumbnail'] {
  const shape = getEditableVectorShape(layer);
  if (!shape) {
    return buildUnsupportedImagePathsPanelThumbnail('path-thumbnails-not-rendered');
  }
  return {
    supported: true,
    status: 'ready',
    renderer: 'canvas',
    width: IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIZE,
    height: IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIZE,
    signature: buildImagePathsPanelEntryThumbnailSignature(layer.id, shape),
  };
}

function buildUnsupportedImagePathsPanelThumbnail(
  reason: ImagePathsPanelEntryThumbnailReadinessReason,
): ImagePathsPanelEntryReadiness['thumbnail'] {
  return {
    supported: false,
    status: 'unsupported',
    reason,
    renderer: 'none',
    width: IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIZE,
    height: IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIZE,
    signature: `${IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIGNATURE_ID}:unsupported:${reason}`,
  };
}

export function selectImagePathsPanelEntry(
  entries: ImagePathsPanelEntryReadiness[],
  selectedPathLayerId: string | null | undefined,
): ImagePathsPanelEntryReadiness | null {
  if (entries.length === 0) return null;
  if (!selectedPathLayerId) return entries[0] ?? null;
  return entries.find((entry) => entry.id === selectedPathLayerId || entry.layerId === selectedPathLayerId) ?? null;
}

export function buildImagePathsPanelOperations(
  entries: ImagePathsPanelEntryReadiness[],
  selectedEntry: ImagePathsPanelEntryReadiness | null,
  targetLayer: ImageLayer | null,
  requestedTargetLayerId: string | null,
): Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationReadiness> {
  const pathBlockers = buildImagePathsPanelPathBlockers(entries, selectedEntry);
  return {
    loadSelection: buildImagePathsPanelOperation(pathBlockers, ['straight-segment-rasterization']),
    fillPath: buildImagePathsPanelOperation(pathBlockers, ['creates-vector-fill-layer-copy']),
    strokePath: buildImagePathsPanelOperation(pathBlockers, ['uses-current-shape-stroke-settings']),
    createVectorMask: buildImagePathsPanelOperation(
      [
        ...pathBlockers,
        ...buildImagePathsPanelVectorMaskBlockers(selectedEntry, targetLayer, requestedTargetLayerId),
      ],
      ['requires-three-or-more-source-points', 'target-local-retained-path'],
    ),
  };
}

function buildImagePathsPanelPathBlockers(
  entries: ImagePathsPanelEntryReadiness[],
  selectedEntry: ImagePathsPanelEntryReadiness | null,
): ImagePathsPanelOperationBlocker[] {
  if (entries.length === 0) return ['no-path-entries'];
  if (!selectedEntry) return ['selected-path-missing'];
  return [];
}

function buildImagePathsPanelVectorMaskBlockers(
  selectedEntry: ImagePathsPanelEntryReadiness | null,
  targetLayer: ImageLayer | null,
  requestedTargetLayerId: string | null,
): ImagePathsPanelOperationBlocker[] {
  const blockers: ImagePathsPanelOperationBlocker[] = [];
  if (selectedEntry && selectedEntry.pointCount < 3) {
    blockers.push('selected-path-needs-three-points');
  }
  if (selectedEntry?.layerId && targetLayer?.id === selectedEntry.layerId) {
    blockers.push('target-layer-is-selected-path');
  }
  if (requestedTargetLayerId && !targetLayer) {
    blockers.push('target-layer-missing');
  }
  if (targetLayer?.locked) {
    blockers.push('target-layer-locked');
  }
  return blockers;
}

function buildImagePathsPanelOperation(
  blockers: ImagePathsPanelOperationBlocker[],
  caveats: ImagePathsPanelOperationCaveat[],
): ImagePathsPanelOperationReadiness {
  const uniqueBlockers = uniqueImagePathsPanelBlockers(blockers);
  return {
    ready: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    caveats,
  };
}

function uniqueImagePathsPanelBlockers(
  blockers: ImagePathsPanelOperationBlocker[],
): ImagePathsPanelOperationBlocker[] {
  return blockers.filter((blocker, index) => blockers.indexOf(blocker) === index);
}

export function collectImagePathsPanelOperationBlockers(
  operations: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationReadiness>,
): ImagePathsPanelOperationBlocker[] {
  return uniqueImagePathsPanelBlockers([
    ...operations.loadSelection.blockers,
    ...operations.fillPath.blockers,
    ...operations.strokePath.blockers,
    ...operations.createVectorMask.blockers,
  ]);
}

function buildImagePathsPanelIndependentSavedPaths(
  layerBackedSavedPathCount: number,
  temporaryWorkPathCount: number,
  detachedSavedPathCount: number,
): ImagePathsPanelIndependentSavedPathMetadata {
  const state: ImagePathsPanelIndependentSavedPathState = detachedSavedPathCount > 0 || temporaryWorkPathCount > 0
    ? 'document-records'
    : layerBackedSavedPathCount > 0
      ? 'layer-backed-surrogate-only'
      : 'empty';
  const blockers: ImagePathsPanelIndependentSavedPathBlocker[] = [];
  const caveats: ImagePathsPanelIndependentSavedPathCaveat[] = layerBackedSavedPathCount > 0
    ? ['saved-paths-use-vector-layer-surrogates']
    : [];
  const payload = {
    state,
    layerBackedSavedPathCount,
    temporaryWorkPathCount,
    detachedSavedPathCount,
    detachedDocumentRecordsSupported: true,
    savedPathMetadataEditable: true,
    blockers,
    caveats,
  };

  return {
    state,
    detachedDocumentRecordsSupported: true,
    savedPathMetadataEditable: true,
    durableRepresentation: detachedSavedPathCount > 0 || temporaryWorkPathCount > 0 ? 'document-record' : 'vector-layer-metadata',
    workPathRepresentation: temporaryWorkPathCount > 0 ? 'document-record' : 'temporary-readiness-entry',
    layerBackedSavedPathCount,
    temporaryWorkPathCount,
    detachedSavedPathCount,
    blockers,
    caveats,
    signature: `image-paths-independent-saved-paths:v1:${JSON.stringify(payload)}`,
  };
}

function buildImagePathsPanelThumbnailReadiness(
  entries: ImagePathsPanelEntryReadiness[],
): ImagePathsPanelThumbnailReadiness {
  const readyCount = entries.filter((entry) => entry.thumbnail.status === 'ready').length;
  const unsupportedCount = entries.filter((entry) => entry.thumbnail.status === 'unsupported').length;
  const state: ImagePathsPanelThumbnailReadinessState = entries.length === 0
    ? 'empty'
    : readyCount > 0 && unsupportedCount > 0
      ? 'mixed'
      : readyCount > 0
        ? 'ready'
        : 'unsupported';
  const renderer: ImagePathsPanelThumbnailReadinessRenderer = entries.length === 0
    ? 'none'
    : entries.some((entry) => entry.thumbnail.renderer === 'canvas')
      && entries.some((entry) => entry.thumbnail.renderer === 'none')
      ? 'mixed'
      : entries.some((entry) => entry.thumbnail.renderer === 'canvas')
        ? 'canvas'
        : 'none';
  const signatures = entries.map((entry) => entry.thumbnail.signature);
  const payload = {
    state,
    renderer,
    readyCount,
    unsupportedCount,
    signatures,
  };

  return {
    state,
    renderer,
    readyCount,
    unsupportedCount,
    signatures,
    signature: `image-paths-panel-thumbnails:v1:${JSON.stringify(payload)}`,
  };
}

function buildImagePathsPanelOperationChecks(
  operations: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationReadiness>,
  selectedEntry: ImagePathsPanelEntryReadiness | null,
  targetLayerId: string | null,
): Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationCheck> {
  return {
    loadSelection: buildImagePathsPanelOperationCheck('loadSelection', operations.loadSelection, selectedEntry, targetLayerId),
    fillPath: buildImagePathsPanelOperationCheck('fillPath', operations.fillPath, selectedEntry, targetLayerId),
    strokePath: buildImagePathsPanelOperationCheck('strokePath', operations.strokePath, selectedEntry, targetLayerId),
    createVectorMask: buildImagePathsPanelOperationCheck('createVectorMask', operations.createVectorMask, selectedEntry, targetLayerId),
  };
}

function buildImagePathsPanelOperationCheck(
  operation: ImagePathsPanelOperationKind,
  readiness: ImagePathsPanelOperationReadiness,
  selectedEntry: ImagePathsPanelEntryReadiness | null,
  targetLayerId: string | null,
): ImagePathsPanelOperationCheck {
  const payload = {
    operation,
    ready: readiness.ready,
    selectedEntryId: selectedEntry?.id ?? null,
    targetLayerId,
    blockers: readiness.blockers,
    caveats: readiness.caveats,
  };

  return {
    checkId: `image-paths-panel-operation:${operation}`,
    operation,
    readiness: readiness.ready ? 'ready' : 'blocked',
    ready: readiness.ready,
    selectedEntryId: selectedEntry?.id ?? null,
    targetLayerId,
    blockers: readiness.blockers,
    caveats: readiness.caveats,
    signature: `image-paths-panel-operation:v1:${JSON.stringify(payload)}`,
  };
}

function buildImagePathsPanelUnsupportedStates(): ImagePathsPanelUnsupportedState[] {
  return [];
}

function buildImagePathsPanelReadinessSignatures(
  entries: ImagePathsPanelEntryReadiness[],
  thumbnailReadiness: ImagePathsPanelThumbnailReadiness,
  operationChecks: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationCheck>,
  independentSavedPaths: ImagePathsPanelIndependentSavedPathMetadata,
  unsupportedStates: ImagePathsPanelUnsupportedState[],
): ImagePathsPanelReadinessSignatures {
  return {
    entries: entries.map((entry) => entry.previewSignature),
    thumbnails: entries.map((entry) => entry.thumbnail.signature),
    thumbnailReadiness: thumbnailReadiness.signature,
    operations: buildImagePathsPanelOperationAggregateSignature(operationChecks),
    independentSavedPaths: independentSavedPaths.signature,
    unsupportedStates: buildImagePathsPanelUnsupportedStatesSignature(unsupportedStates),
  };
}

function buildImagePathsPanelOperationAggregateSignature(
  operationChecks: Record<ImagePathsPanelOperationKind, ImagePathsPanelOperationCheck>,
): string {
  return `image-paths-panel-operations:v1:${JSON.stringify({
    loadSelection: {
      ready: operationChecks.loadSelection.ready,
      blockers: operationChecks.loadSelection.blockers,
    },
    fillPath: {
      ready: operationChecks.fillPath.ready,
      blockers: operationChecks.fillPath.blockers,
    },
    strokePath: {
      ready: operationChecks.strokePath.ready,
      blockers: operationChecks.strokePath.blockers,
    },
    createVectorMask: {
      ready: operationChecks.createVectorMask.ready,
      blockers: operationChecks.createVectorMask.blockers,
    },
  })}`;
}

function buildImagePathsPanelUnsupportedStatesSignature(
  unsupportedStates: ImagePathsPanelUnsupportedState[],
): string {
  return `image-paths-panel-unsupported-states:v1:${JSON.stringify({
    codes: unsupportedStates.map((state) => state.code),
  })}`;
}

export function buildImagePathsPanelCaveats(
  options: ImagePathsPanelReadinessOptions,
): ImagePathsPanelCaveat[] {
  // Both options remain accepted for older callers, but the formerly advertised gaps are no
  // longer true: document-level saved paths are implemented (ImageSavedWorkPaths.ts), and
  // retained paths expose click-drag curvature, Corner/Smooth conversion, and direct handle editing.
  void options.includeIndependentSavedPathCaveats;
  void options.includeBezierOperationCaveats;
  return [];
}

function buildImagePathsPanelVisibility(
  entries: ImagePathsPanelEntryReadiness[],
  selectedEntry: ImagePathsPanelEntryReadiness | null,
): ImagePathsPanelReadiness['visibility'] {
  if (entries.length === 0) {
    return {
      panel: 'empty',
      reason: 'no-path-entries',
      selectedEntryVisible: false,
    };
  }
  return {
    panel: 'visible',
    reason: 'path-entries-available',
    selectedEntryVisible: Boolean(selectedEntry),
  };
}

function buildImagePathsPanelConversionTargets(): ImagePathsPanelReadiness['conversionTargets'] {
  return {
    selection: 'selection-mask',
    fill: 'retained-vector-fill-layer-copy',
    stroke: 'retained-vector-stroke-layer-copy',
    vectorMask: 'target-local-retained-vector-mask',
  };
}

function buildImagePathsPanelExportCaveats(): ImagePathsPanelExportCaveat[] {
  return [
    {
      code: 'svg-export-retains-straight-segments-only',
      severity: 'warning',
      message: 'Image SVG export flattens path appearance; retained straight and cubic path geometry stays editable in .slimg only.',
    },
    {
      code: 'psd-export-flattens-independent-path-records',
      severity: 'warning',
      message: 'PSD export does not preserve detached Photoshop-style saved path records; layer-backed vector paths remain the durable representation.',
    },
  ];
}

function buildImagePathsPanelActionSuitability(
  operationBlockers: ImagePathsPanelOperationBlocker[],
): ImagePathsPanelReadiness['actionSuitability'] {
  const blocked = operationBlockers.length > 0;
  return {
    panelCommands: blocked ? 'blocked' : 'suitable',
    batchActions: blocked ? 'blocked' : 'suitable-with-selected-entry-and-target',
    macroPlayback: blocked ? 'blocked' : 'suitable-deterministic',
    arbitraryBezierEditing: 'suitable',
  };
}

function getImagePathWorkflowPointCount(shape: ImageVectorShape): number {
  if (shape.kind === 'path') return shape.points.length;
  if (shape.kind === 'rect') return 4;
  return 0;
}

function buildImagePathWorkflowCapabilityDescriptor(
  kind: ImagePathWorkflowCapabilityKind,
  warnings: ImagePathWorkflowWarning[],
): ImagePathWorkflowCapabilityDescriptor {
  const base = getImagePathWorkflowCapabilityBase(kind);
  return {
    kind,
    label: imagePathWorkflowCapabilityLabel(kind),
    ...base,
    warnings: warnings.filter((warning) => warning.capability === kind),
  };
}

function getImagePathWorkflowCapabilityBase(kind: ImagePathWorkflowCapabilityKind): Omit<ImagePathWorkflowCapabilityDescriptor, 'kind' | 'label' | 'warnings'> {
  switch (kind) {
    case 'straight-segment-paths':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'layerOp',
      };
    case 'anchor-editing':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'layerOp',
      };
    case 'path-to-selection':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'selection-mask',
        undoOperation: 'selection',
      };
    case 'path-to-fill-layer':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'vector-fill-layer',
        undoOperation: 'layerOp',
      };
    case 'path-to-stroke-layer':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'vector-stroke-layer',
        undoOperation: 'layerOp',
      };
    case 'bezier-handles':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'layerOp',
      };
    case 'curvature-tool':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'curvature',
        output: 'path-layer',
        undoOperation: 'layerOp',
      };
    case 'independent-saved-work-paths':
      return {
        supported: true,
        storage: 'document-work-path',
        geometry: 'straight-segment',
        output: 'selection-mask',
        undoOperation: 'documentState',
      };
    case 'anchor-conversion':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'layerOp',
      };
    case 'independent-direct-selection':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'none',
      };
    case 'independent-path-selection':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'none',
      };
    case 'rasterize-vector-mask':
      return {
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'vector-fill-layer',
        undoOperation: 'layerOp',
      };
  }
}

function imagePathWorkflowCapabilityLabel(kind: ImagePathWorkflowCapabilityKind): string {
  switch (kind) {
    case 'straight-segment-paths':
      return 'Straight-segment paths';
    case 'anchor-editing':
      return 'Anchor editing';
    case 'path-to-selection':
      return 'Path to selection';
    case 'path-to-fill-layer':
      return 'Path to fill layer';
    case 'path-to-stroke-layer':
      return 'Path to stroke layer';
    case 'bezier-handles':
      return 'Bezier handles';
    case 'curvature-tool':
      return 'Curvature tool';
    case 'independent-saved-work-paths':
      return 'Independent saved work paths';
    case 'anchor-conversion':
      return 'Anchor conversion';
    case 'independent-direct-selection':
      return 'Independent direct selection';
    case 'independent-path-selection':
      return 'Independent path selection';
    case 'rasterize-vector-mask':
      return 'Rasterize vector mask';
  }
}

function buildImagePathWorkflowPreviewSignature(
  layers: ImagePathLayerWorkflowDescriptor[],
  capabilities: ImagePathWorkflowCapabilityDescriptor[],
  warnings: ImagePathWorkflowWarning[],
  straightSegmentPathLayerCount: number,
  pathsPanel: ImagePathWorkflowDescriptor['pathsPanel'],
  operationReadiness: ImagePathWorkflowDescriptor['operationReadiness'],
  supportStatus: ImagePathWorkflowDescriptor['supportStatus'],
): string {
  return `image-path-workflow:v2:${JSON.stringify({
    pathLayerCount: layers.length,
    straightSegmentPathLayerCount,
    pathsPanel,
    operationReadiness,
    supportStatus,
    layers: layers.map((layer) => ({
      layerId: layer.layerId,
      kind: layer.kind,
      classification: layer.classification,
      closed: layer.closed,
      pointCount: layer.pointCount,
      bounds: layer.bounds,
      editableAnchors: layer.editableAnchors,
      canConvertAnchors: layer.anchorEditing.canConvertAnchors,
      canRasterizeVectorMask: layer.canRasterizeVectorMask,
      hasBezierHandles: layer.hasBezierHandles,
      previewId: layer.previewId,
    })),
    capabilities: capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      output: capability.output,
    })),
    warnings: warnings.map((warning) => warning.code),
  })}`;
}

export function buildImagePathsPanelReadinessPreviewSignature(
  readiness: Omit<ImagePathsPanelReadiness, 'previewSignature'>,
): string {
  return `image-paths-panel-readiness:v1:${JSON.stringify({
    summary: readiness.summary,
    entries: readiness.entries.map((entry) => ({
      id: entry.id,
      source: entry.source,
      kind: entry.kind,
      closed: entry.closed,
      pointCount: entry.pointCount,
      bounds: entry.bounds,
      editSignature: entry.editReadiness.previewSignature,
      thumbnailStatus: entry.thumbnail.status,
      thumbnailRenderer: entry.thumbnail.renderer,
      thumbnailSignature: entry.thumbnail.signature,
    })),
    operations: readiness.operations,
    independentSavedPaths: readiness.independentSavedPaths.signature,
    thumbnailReadiness: readiness.thumbnailReadiness.signature,
    operationSignatures: {
      loadSelection: readiness.operationChecks.loadSelection.signature,
      fillPath: readiness.operationChecks.fillPath.signature,
      strokePath: readiness.operationChecks.strokePath.signature,
      createVectorMask: readiness.operationChecks.createVectorMask.signature,
    },
    unsupportedStates: readiness.unsupportedStates.map((state) => state.code),
    caveats: readiness.caveats.map((caveat) => caveat.code),
  })}`;
}

function buildImagePathsPanelEntryPreviewSignature(
  entry: Omit<ImagePathsPanelEntryReadiness, 'previewSignature'>,
): string {
  return `image-path-panel-entry:v1:${JSON.stringify({
    id: entry.id,
    source: entry.source,
    kind: entry.kind,
    closed: entry.closed,
    pointCount: entry.pointCount,
    bounds: entry.bounds,
    editSignature: entry.editReadiness.previewSignature,
    thumbnailStatus: entry.thumbnail.status,
    thumbnailRenderer: entry.thumbnail.renderer,
    thumbnailSignature: entry.thumbnail.signature,
  })}`;
}

export function describeImagePathEditReadiness(shape: ImageVectorShape): ImagePathEditReadinessDescriptor {
  const pointCount = shape.kind === 'path' ? shape.points?.length ?? 0 : shape.kind === 'rect' ? 4 : 0;
  const anchorState: ImagePathAnchorPointEditState = shape.kind === 'path'
    ? 'ready-for-retained-anchor-editing'
    : 'shape-bounds-only';
  const descriptor: Omit<ImagePathEditReadinessDescriptor, 'previewSignature'> = {
    retainedPath: 'layer-vector-shape-metadata',
    anchorPointEditReadiness: {
      state: anchorState,
      coordinateSpace: shape.kind === 'path' ? 'document' : 'layer-bounds',
      supportsPointAddDelete: shape.kind === 'path',
      supportsMultiAnchorSelection: false,
    },
    booleanOperations: {
      mode: 'separate-layer-boolean-actions-only',
      supportsLiveBooleanStack: false,
      supportsBezierOperands: false,
      supportsOverlapResolution: false,
    },
    handoffWarnings: [
      'rasterize-flattens-retained-path-editing',
      'vector-mask-uses-closed-target-local-copy',
    ],
    interopCaveats: {
      svg: 'straight-segment-path-only',
      psd: 'layer-backed-path-only',
    },
  };
  return {
    ...descriptor,
    previewSignature: `image-path-edit-readiness:v1:${JSON.stringify({
      kind: shape.kind,
      pointCount,
      closed: shape.kind === 'path' ? shape.closed : true,
      anchorState: descriptor.anchorPointEditReadiness.state,
      booleanMode: descriptor.booleanOperations.mode,
      handoffWarnings: descriptor.handoffWarnings,
      interop: {
        svg: descriptor.interopCaveats.svg,
        psd: descriptor.interopCaveats.psd,
      },
    })}`,
  };
}

function buildImagePathsPanelEntryThumbnailSignature(
  layerId: string,
  shape: ImageVectorShape,
): string {
  return `${IMAGE_PATHS_PANEL_ENTRY_THUMBNAIL_SIGNATURE_ID}:${layerId}:${JSON.stringify({
    kind: shape.kind,
    width: normalizePathWorkflowDimension(shape.width),
    height: normalizePathWorkflowDimension(shape.height),
    closed: shape.kind === 'path' ? shape.closed : true,
    pointCount: shape.kind === 'path' ? shape.points.length : 4,
    fillColor: shape.fillColor,
    fillOpacity: normalizePathWorkflowNumber(shape.fillOpacity),
    strokeColor: shape.strokeColor,
    strokeOpacity: normalizePathWorkflowNumber(shape.strokeOpacity),
    strokeWidth: normalizePathWorkflowDimension(shape.strokeWidth),
  })}`;
}

function buildImagePathsPanelDescriptor(): ImagePathWorkflowDescriptor['pathsPanel'] {
  return {
    classification: 'layer-backed-paths-panel',
    savedPathPolicy: 'vector-layer-saved-path-surrogate',
    workPathPolicy: 'pen-preview-layer-before-commit',
    independentSavedWorkPaths: true,
  };
}

function buildImagePathOperationReadinessDescriptor(
  layers: ImagePathLayerWorkflowDescriptor[],
): ImagePathWorkflowDescriptor['operationReadiness'] {
  const hasPathLayer = layers.length > 0;
  return {
    loadSelection: hasPathLayer,
    fillPath: hasPathLayer,
    strokePath: hasPathLayer,
    rasterizeVectorMask: hasPathLayer,
  };
}

function buildImagePathSupportStatusDescriptor(): ImagePathWorkflowDescriptor['supportStatus'] {
  return {
    bezierHandles: 'supported',
    curvatureTool: 'supported',
    anchorConversion: 'supported',
    independentDirectSelection: 'supported',
    independentPathSelection: 'supported',
  };
}

function buildImagePathAnchorEditingDescriptor(
  shape: ImageVectorShape,
): ImagePathLayerWorkflowDescriptor['anchorEditing'] {
  const canEditBezierHandles = shape.kind === 'path' && shape.points.length > 0;
  return {
    mode: shape.kind === 'path' ? 'numeric-and-canvas-point-editing' : 'shape-bounds-editing',
    canMoveAnchors: shape.kind === 'path' && shape.points.length > 0,
    canConvertAnchors: shape.kind === 'path' && shape.points.length > 0,
    canEditBezierHandles,
    limitations: canEditBezierHandles ? [] : ['bezier-handle-editing'],
  };
}

function buildImagePathLayerPreviewSignature(
  layer: Omit<ImagePathLayerWorkflowDescriptor, 'previewSignature'>,
): string {
  return `image-path-layer:v1:${JSON.stringify({
    layerId: layer.layerId,
    kind: layer.kind,
    closed: layer.closed,
    pointCount: layer.pointCount,
    bounds: layer.bounds,
    editableAnchors: layer.editableAnchors,
    hasBezierHandles: layer.hasBezierHandles,
  })}`;
}

function normalizePathWorkflowNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function normalizePathWorkflowDimension(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1, Math.round(value * 100) / 100);
}
