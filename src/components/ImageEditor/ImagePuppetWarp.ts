export interface ImagePuppetWarpPoint {
  x: number;
  y: number;
}

export interface ImagePuppetWarpPin {
  source: ImagePuppetWarpPoint;
  target: ImagePuppetWarpPoint;
  radius: number;
}

export interface ImagePuppetWarpSessionPin extends ImagePuppetWarpPin {
  id: string;
}

export interface ImagePuppetWarpOptions {
  pins: ImagePuppetWarpPin[];
  minPinRadius?: number;
  maxPinRadius?: number;
}

export interface ImagePuppetWarpPinSessionOptions {
  defaultRadius?: number;
  minRadius?: number;
  maxRadius?: number;
  maxPinCount?: number;
  preserveSmartObjects?: boolean;
  documentId?: string;
  layerId?: string;
}

export interface ImagePuppetWarpLayerBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ImagePuppetWarpPreviewWarning =
  | 'invalid-pin-ignored'
  | 'unsupported-on-canvas-pin-editor'
  | 'unsupported-non-destructive-workflow'
  | 'unsupported-smart-object-preservation';
export type ImagePuppetWarpLocalDeformation = 'weighted-pin-displacement';
export type ImagePuppetWarpPhotoshopUnsupportedState =
  | 'interactive-on-canvas-pin-editor'
  | 'direct-triangulated-mesh-editing'
  | 'mesh-density-modes'
  | 'perspective-warp'
  | 'smart-object-puppet-warp-filter';
export type ImagePuppetWarpSmartSourceCaveat =
  | 'smart-object-preservation-is-metadata-only'
  | 'source-linked-layer-must-be-exported-as-derived-bitmap';
export type ImagePuppetWarpNonDestructiveLimitation =
  | 'puppet-warp-commits-pixels-on-apply'
  | 'no-reopenable-puppet-mesh-state'
  | 'callers-need-history-or-duplicate-layer-for-reversal';
export type ImagePuppetWarpBatchActionCaveat =
  | 'requires-fixed-pin-coordinates-radius-and-layer-bounds'
  | 'not-suitable-for-freeform-on-canvas-mesh-edit-recording';
export type ImagePuppetWarpValidationIssueCode =
  | 'duplicate-pin-id'
  | 'pin-coordinate-not-finite'
  | 'pin-radius-not-finite'
  | 'pin-radius-clamped'
  | 'pin-source-outside-layer-bounds'
  | 'pin-target-outside-layer-bounds'
  | 'pin-count-exceeds-limit'
  | 'stationary-pin';
export type ImagePuppetWarpValidationSeverity = 'warning' | 'error';
export type ImagePuppetWarpMeshPreviewCaveat =
  | 'preview-mesh-is-not-editable-triangulated-puppet-mesh'
  | 'perspective-corner-plane-warp-is-not-supported'
  | 'grid-warp-handles-are-preview-metadata-only';
export type ImagePuppetWarpSourceKind =
  | 'pixel-layer'
  | 'smart-object'
  | 'source-linked-layer';
export type ImagePuppetWarpOutputPolicy =
  | 'active-layer-pixels'
  | 'derived-bitmap-layer'
  | 'discard-preview-only';
export type ImagePuppetWarpSourceSafetyWarning =
  | 'apply-commits-active-layer-pixels'
  | 'apply-commits-derived-pixels'
  | 'source-linked-original-is-not-mutated'
  | 'smart-object-filter-is-not-preserved';
export type ImagePuppetWarpUnsupportedApplyCaveat =
  | 'perspective-warp-plane-handles-unsupported'
  | 'photoshop-smart-object-puppet-filter-unsupported'
  | 'gimp-cage-transform-equivalent-unsupported'
  | 'reopenable-puppet-mesh-state-unsupported';
export type ImagePuppetWarpReadinessLaneFeature =
  | 'interactive-on-canvas-pin-editor'
  | 'true-triangulated-mesh'
  | 'perspective-warp-planes'
  | 'smart-object-preservation'
  | 'reopenable-mesh-state';
export type ImagePuppetWarpReadinessLaneUnsupportedState =
  | ImagePuppetWarpPhotoshopUnsupportedState
  | 'reopenable-puppet-mesh-state';
export type ImagePuppetWarpReadinessLaneFallback =
  | 'bounded-pin-session-descriptors'
  | 'weighted-pin-segment-preview'
  | 'use-transform-or-weighted-puppet-pins'
  | 'derived-bitmap-layer'
  | 'history-snapshot-or-cancel-preview';

export interface ImagePuppetWarpPinSession {
  pins: ImagePuppetWarpSessionPin[];
  warnings: ImagePuppetWarpPreviewWarning[];
}

export interface ImagePuppetWarpPinValidationIssue {
  code: ImagePuppetWarpValidationIssueCode;
  severity: ImagePuppetWarpValidationSeverity;
  pinIndex: number;
  pinId?: string;
}

export interface ImagePuppetWarpPinValidationOptions extends ImagePuppetWarpPinSessionOptions {
  layerBounds?: ImagePuppetWarpLayerBounds;
}

export interface ImagePuppetWarpPinValidationDescriptor {
  sanitizedPins: ImagePuppetWarpSessionPin[];
  issues: ImagePuppetWarpPinValidationIssue[];
  acceptedCount: number;
  rejectedCount: number;
  maxPinCount: number | null;
  valid: boolean;
  hasMovedPins: boolean;
  layerBounds: ImagePuppetWarpPreviewMetadata['bounds'] | null;
  validationSignature: string;
}

export interface ImagePuppetWarpPreviewMetadata {
  bounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  meshSize: {
    columns: number;
    rows: number;
  };
  pinCount: number;
  warnings: ImagePuppetWarpPreviewWarning[];
}

export interface ImagePuppetWarpPlanningDescriptor {
  toolSupport: {
    pins: boolean;
    directMeshEditing: boolean;
    densityModes: boolean;
    smartObjectPreservation: boolean;
    onCanvasPinEditor: false;
    nonDestructive: false;
    pinSessionHelpers: {
      add: true;
      move: true;
      remove: true;
    };
  };
  pinSummary: {
    count: number;
    movedCount: number;
    averageRadius: number;
    totalDisplacement: number;
    pins: Array<{
      id: string;
      source: ImagePuppetWarpPoint;
      target: ImagePuppetWarpPoint;
      radius: number;
      displacement: ImagePuppetWarpPoint & { distance: number };
    }>;
  };
  mesh: {
    bounds: ImagePuppetWarpPreviewMetadata['bounds'];
    columns: number;
    rows: number;
    limitation: 'weighted-pin-field-only';
  };
  preview: {
    id: string;
    signature: string;
  };
  warnings: ImagePuppetWarpPreviewWarning[];
}

export interface ImagePuppetWarpMeshPreviewOptions extends ImagePuppetWarpPinValidationOptions {
  meshColumns?: number;
  meshRows?: number;
}

export interface ImagePuppetWarpMeshPreviewVertex {
  id: string;
  source: ImagePuppetWarpPoint;
  offset: ImagePuppetWarpPoint;
  target: ImagePuppetWarpPoint;
  influenceCount: number;
}

export interface ImagePuppetWarpMeshPreviewSegment {
  id: string;
  from: string;
  to: string;
  axis: 'horizontal' | 'vertical';
  maxOffsetDistance: number;
}

export interface ImagePuppetWarpMeshPreviewPlan {
  mesh: {
    bounds: ImagePuppetWarpPreviewMetadata['bounds'];
    columns: number;
    rows: number;
    vertexCount: number;
    segmentCount: number;
    activeSegmentCount: number;
    mode: 'weighted-pin-segment-preview';
  };
  vertices: ImagePuppetWarpMeshPreviewVertex[];
  segments: ImagePuppetWarpMeshPreviewSegment[];
  pinOverlays: Array<{
    id: string;
    source: ImagePuppetWarpPoint;
    target: ImagePuppetWarpPoint;
    radius: number;
    moved: boolean;
    influenceBounds: ImagePuppetWarpPreviewMetadata['bounds'];
  }>;
  validation: ImagePuppetWarpPinValidationDescriptor;
  unsupportedCaveats: ImagePuppetWarpMeshPreviewCaveat[];
  previewSignature: string;
}

export interface ImagePuppetWarpApplyCancelPlanOptions extends ImagePuppetWarpPinValidationOptions {
  sourceKind?: ImagePuppetWarpSourceKind;
  sourceId?: string;
  duplicateLayerBeforeApply?: boolean;
}

export interface ImagePuppetWarpApplyCancelPlan {
  sourceSafety: {
    sourceKind: ImagePuppetWarpSourceKind;
    sourceId: string | null;
    outputPolicy: Exclude<ImagePuppetWarpOutputPolicy, 'discard-preview-only'>;
    preservesOriginalSource: boolean;
    preservesActiveLayerPixels: boolean;
    requiresHistorySnapshot: boolean;
    requiresDuplicateLayerForNonDestructiveEdit: boolean;
    warnings: ImagePuppetWarpSourceSafetyWarning[];
  };
  apply: {
    action: 'apply-puppet-warp';
    mutatesPixels: true;
    outputPolicy: Exclude<ImagePuppetWarpOutputPolicy, 'discard-preview-only'>;
    signature: string;
  };
  cancel: {
    action: 'cancel-puppet-warp-preview';
    mutatesPixels: false;
    outputPolicy: 'discard-preview-only';
    signature: string;
  };
  validation: ImagePuppetWarpPinValidationDescriptor;
  unsupportedCaveats: ImagePuppetWarpUnsupportedApplyCaveat[];
  planSignature: string;
}

export interface ImagePuppetWarpReadinessLaneUnsupportedDescriptor {
  feature: ImagePuppetWarpReadinessLaneFeature;
  supported: false;
  requested: boolean;
  state: ImagePuppetWarpReadinessLaneUnsupportedState;
  fallback: ImagePuppetWarpReadinessLaneFallback;
  signature: string;
}

export interface ImagePuppetWarpDeformationReadinessOptions extends ImagePuppetWarpMeshPreviewOptions {
  sourceKind?: ImagePuppetWarpSourceKind;
  sourceId?: string;
  duplicateLayerBeforeApply?: boolean;
}

export interface ImagePuppetWarpDeformationReadinessDescriptor {
  lane: 'image-deformation-puppet-warp';
  pinPlan: {
    previewId: string;
    pinPlanSignature: string;
    validationSignature: string;
    bounded: boolean;
    acceptedPinCount: number;
    rejectedPinCount: number;
    movedPinCount: number;
  };
  mesh: {
    previewId: string;
    previewSignature: string;
    trueTriangulatedMeshSupported: false;
    perspectiveWarpPlanesSupported: false;
    reopenableMeshStateSupported: false;
  };
  sourceSafety: {
    sourceKind: ImagePuppetWarpSourceKind;
    sourceId: string | null;
    outputPolicy: Exclude<ImagePuppetWarpOutputPolicy, 'discard-preview-only'>;
    signature: string;
  };
  previewActions: {
    applySignature: string;
    cancelSignature: string;
  };
  validation: ImagePuppetWarpPinValidationDescriptor;
  unsupportedStates: ImagePuppetWarpReadinessLaneUnsupportedDescriptor[];
  signature: string;
}

export interface ImagePuppetWarpReadinessDescriptor {
  supportedLocalDeformations: ImagePuppetWarpLocalDeformation[];
  sessionState: {
    type: 'bounded-pin-session';
    pinCount: number;
    maxPinCount: number | null;
    previewBeforeCommit: boolean;
    destructiveApply: boolean;
    undoSnapshotRequired: boolean;
  };
  controlState: {
    addPin: boolean;
    movePin: boolean;
    removePin: boolean;
    pinRadius: boolean;
    directMeshEditing: boolean;
    densityModes: boolean;
    perspectiveWarp: boolean;
  };
  pinReadiness: {
    addPin: boolean;
    movePin: boolean;
    removePin: boolean;
    pinRadius: boolean;
    movedPinCount: number;
    unmovedPinCount: number;
    actionSuitable: boolean;
    batchSuitable: boolean;
    previewSignature: string;
    exportSignature: string;
  };
  pinSupport: {
    supported: boolean;
    maxPinCount: number | null;
    movablePins: boolean;
    fixedPins: boolean;
    movedPinCount: number;
    unmovedPinCount: number;
    limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp';
  };
  meshReadiness: {
    weightedFieldSupported: boolean;
    triangulatedMeshEditingSupported: boolean;
    meshDensityModesSupported: boolean;
    perspectiveWarpSupported: boolean;
    limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp';
    unsupportedStates: Array<
      'direct-triangulated-mesh-editing' | 'mesh-density-modes' | 'perspective-warp'
    >;
  };
  unsupportedPhotoshopEquivalentStates: ImagePuppetWarpPhotoshopUnsupportedState[];
  smartSourceCaveats: ImagePuppetWarpSmartSourceCaveat[];
  nonDestructiveLimitations: ImagePuppetWarpNonDestructiveLimitation[];
  previewExportSignatures: {
    preview: string;
    export: string;
  };
  workspace: {
    fullyInteractive: false;
    onCanvasPinPlacementPreview: true;
    reopenableMeshWorkspaceSupported: false;
    limitation: 'descriptor-only-pin-session-not-live-deformation-workspace';
    unsupportedFeatures: Array<
      'interactive-on-canvas-pin-editor' | 'mesh-density-overlays' | 'reopenable-puppet-mesh-workspace'
    >;
  };
  exportSourceBinHandoffSafety: {
    safeForFlattenedExport: boolean;
    safeForSourceBinDerivedBitmap: boolean;
    preservesOriginalSource: boolean;
    caveat: 'handoff-should-use-derived-bitmap-or-snapshot-not-original-smart-source';
  };
  batchActionSuitability: {
    deterministic: boolean;
    suitableForRecordedActions: boolean;
    caveats: ImagePuppetWarpBatchActionCaveat[];
  };
  readinessSignature: string;
}

export function computePuppetWarpOffset(
  point: ImagePuppetWarpPoint,
  pins: ImagePuppetWarpPin[],
  options?: Pick<ImagePuppetWarpOptions, 'minPinRadius' | 'maxPinRadius'>,
): ImagePuppetWarpPoint {
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;

  for (const pin of pins) {
    const radius = normalizeRadius(pin.radius, {
      minRadius: options?.minPinRadius,
      maxRadius: options?.maxPinRadius,
    });
    if (radius === 0) continue;

    const dx = point.x - pin.source.x;
    const dy = point.y - pin.source.y;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) continue;

    const weight = (radius - distance + 1) ** 2;
    weightedX += (pin.target.x - pin.source.x) * weight;
    weightedY += (pin.target.y - pin.source.y) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: weightedX / totalWeight,
    y: weightedY / totalWeight,
  };
}

export function applyPuppetWarpToImageData(
  imageData: ImageData,
  options: ImagePuppetWarpOptions,
): ImageData {
  const output = new Uint8ClampedArray(imageData.data.length);

  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const offset = computePuppetWarpOffset({ x, y }, options.pins, options);
      const sourceX = clamp(Math.round(x - offset.x), 0, imageData.width - 1);
      const sourceY = clamp(Math.round(y - offset.y), 0, imageData.height - 1);
      const sourceIndex = (sourceY * imageData.width + sourceX) * 4;
      const targetIndex = (y * imageData.width + x) * 4;

      output[targetIndex] = imageData.data[sourceIndex];
      output[targetIndex + 1] = imageData.data[sourceIndex + 1];
      output[targetIndex + 2] = imageData.data[sourceIndex + 2];
      output[targetIndex + 3] = imageData.data[sourceIndex + 3];
    }
  }

  return {
    width: imageData.width,
    height: imageData.height,
    data: output,
  } as ImageData;
}

export function createPuppetWarpPinSession(
  pins: ImagePuppetWarpPin[],
  options: ImagePuppetWarpPinSessionOptions = {},
): ImagePuppetWarpPinSession {
  const warnings: ImagePuppetWarpPreviewWarning[] = [];
  const sessionPins: ImagePuppetWarpSessionPin[] = [];

  if (options.preserveSmartObjects) {
    warnings.push('unsupported-smart-object-preservation');
  }

  for (let index = 0; index < pins.length; index += 1) {
    if (options.maxPinCount !== undefined && sessionPins.length >= options.maxPinCount) {
      break;
    }

    const sanitized = sanitizePin(pins[index], options);
    if (!sanitized) {
      if (!warnings.includes('invalid-pin-ignored')) {
        warnings.push('invalid-pin-ignored');
      }
      continue;
    }

    sessionPins.push({
      id: nextPinId(sessionPins),
      ...sanitized,
    });
  }

  return {
    pins: sessionPins,
    warnings,
  };
}

export function addPuppetWarpPin(
  pins: ImagePuppetWarpSessionPin[],
  pin: ImagePuppetWarpPin,
  options: Omit<ImagePuppetWarpPinSessionOptions, 'preserveSmartObjects'> = {},
): ImagePuppetWarpSessionPin[] {
  if (options.maxPinCount !== undefined && options.maxPinCount <= pins.length) {
    return pins;
  }

  const sanitized = sanitizePin(pin, options);
  if (!sanitized) {
    return pins;
  }

  return [
    ...pins,
    {
      id: nextPinId(pins),
      ...sanitized,
    },
  ];
}

export function movePuppetWarpPin(
  pins: ImagePuppetWarpSessionPin[],
  id: string,
  patch: Partial<Omit<ImagePuppetWarpSessionPin, 'id'>>,
  options: Omit<ImagePuppetWarpPinSessionOptions, 'preserveSmartObjects'> = {},
): ImagePuppetWarpSessionPin[] {
  const index = pins.findIndex((pin) => pin.id === id);
  if (index === -1) {
    return pins;
  }

  const current = pins[index];
  const nextPin = sanitizePin(
    {
      source: patch.source ?? current.source,
      target: patch.target ?? current.target,
      radius: patch.radius ?? current.radius,
    },
    options,
  );
  if (!nextPin) {
    return pins;
  }

  return pins.map((pin, pinIndex) => (pinIndex === index ? { id, ...nextPin } : pin));
}

export function removePuppetWarpPin(
  pins: ImagePuppetWarpSessionPin[],
  id: string,
): ImagePuppetWarpSessionPin[] {
  const nextPins = pins.filter((pin) => pin.id !== id);
  return nextPins.length === pins.length ? pins : nextPins;
}

export function validatePuppetWarpPinSession(
  pins: Array<ImagePuppetWarpPin | ImagePuppetWarpSessionPin>,
  options: ImagePuppetWarpPinValidationOptions = {},
): ImagePuppetWarpPinValidationDescriptor {
  const issues: ImagePuppetWarpPinValidationIssue[] = [];
  const sanitizedPins: ImagePuppetWarpSessionPin[] = [];
  const layerBounds = normalizeLayerBounds(options.layerBounds);
  const maxPinCount = options.maxPinCount ?? null;
  let rejectedCount = 0;

  for (let pinIndex = 0; pinIndex < pins.length; pinIndex += 1) {
    const candidate = pins[pinIndex];
    const candidateId = getCandidatePinId(candidate);

    if (maxPinCount !== null && sanitizedPins.length >= maxPinCount) {
      issues.push({
        code: 'pin-count-exceeds-limit',
        severity: 'warning',
        pinIndex,
        ...(candidateId ? { pinId: candidateId } : {}),
      });
      rejectedCount += 1;
      continue;
    }

    if (!isFinitePoint(candidate.source) || !isFinitePoint(candidate.target)) {
      issues.push({
        code: 'pin-coordinate-not-finite',
        severity: 'error',
        pinIndex,
        ...(candidateId ? { pinId: candidateId } : {}),
      });
      rejectedCount += 1;
      continue;
    }

    if (layerBounds && !isPointInsideBounds(candidate.source, layerBounds)) {
      issues.push({
        code: 'pin-source-outside-layer-bounds',
        severity: 'error',
        pinIndex,
        ...(candidateId ? { pinId: candidateId } : {}),
      });
      rejectedCount += 1;
      continue;
    }

    let pinId = candidateId;
    if (!pinId) {
      pinId = nextPinId(sanitizedPins);
    } else if (sanitizedPins.some((pin) => pin.id === pinId)) {
      issues.push({
        code: 'duplicate-pin-id',
        severity: 'warning',
        pinIndex,
        pinId,
      });
      pinId = nextPinId(sanitizedPins);
    }

    const normalizedRadius = normalizeRadius(candidate.radius, {
      defaultRadius: options.defaultRadius,
      minRadius: options.minRadius,
      maxRadius: options.maxRadius,
    });
    const sanitizedPin: ImagePuppetWarpSessionPin = {
      id: pinId,
      source: { x: candidate.source.x, y: candidate.source.y },
      target: { x: candidate.target.x, y: candidate.target.y },
      radius: normalizedRadius,
    };

    if (!Number.isFinite(candidate.radius)) {
      issues.push({
        code: 'pin-radius-not-finite',
        severity: 'warning',
        pinIndex,
        pinId,
      });
    } else if (normalizedRadius !== Math.max(0, candidate.radius)) {
      issues.push({
        code: 'pin-radius-clamped',
        severity: 'warning',
        pinIndex,
        pinId,
      });
    }

    if (isStationaryPin(sanitizedPin)) {
      issues.push({
        code: 'stationary-pin',
        severity: 'warning',
        pinIndex,
        pinId,
      });
    }

    if (layerBounds && !isPointInsideBounds(sanitizedPin.target, layerBounds)) {
      issues.push({
        code: 'pin-target-outside-layer-bounds',
        severity: 'warning',
        pinIndex,
        pinId,
      });
    }

    sanitizedPins.push(sanitizedPin);
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';

  return {
    sanitizedPins,
    issues,
    acceptedCount: sanitizedPins.length,
    rejectedCount,
    maxPinCount,
    valid: errorCount === 0,
    hasMovedPins: sanitizedPins.some((pin) => !isStationaryPin(pin)),
    layerBounds,
    validationSignature: [
      'puppet-validate',
      'v1',
      documentId,
      layerId,
      `${sanitizedPins.length}/${maxPinCount ?? 'unbounded'}`,
      `errors=${errorCount}`,
      `warnings=${warningCount}`,
      formatPuppetWarpPinListSignature(sanitizedPins),
    ].join(':'),
  };
}

export function buildPuppetWarpMeshPreviewPlan(
  pins: Array<ImagePuppetWarpPin | ImagePuppetWarpSessionPin>,
  options: ImagePuppetWarpMeshPreviewOptions = {},
): ImagePuppetWarpMeshPreviewPlan {
  const validation = validatePuppetWarpPinSession(pins, options);
  const bounds = validation.layerBounds ?? computePreviewBounds(validation.sanitizedPins);
  const columns = normalizeMeshCount(options.meshColumns, 3);
  const rows = normalizeMeshCount(options.meshRows, 3);
  const vertices: ImagePuppetWarpMeshPreviewVertex[] = [];
  const segments: ImagePuppetWarpMeshPreviewSegment[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const source = {
        x: interpolateGridValue(bounds.left, bounds.right, column, columns),
        y: interpolateGridValue(bounds.top, bounds.bottom, row, rows),
      };
      const offset = roundPoint(computePuppetWarpOffset(source, validation.sanitizedPins));
      const target = roundPoint({ x: source.x + offset.x, y: source.y + offset.y });
      vertices.push({
        id: meshVertexId(column, row),
        source,
        offset,
        target,
        influenceCount: countInfluencingPins(source, validation.sanitizedPins),
      });
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      segments.push(makeMeshSegment(`h-${column}-${row}`, column, row, column + 1, row, 'horizontal', vertices));
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      segments.push(makeMeshSegment(`v-${column}-${row}`, column, row, column, row + 1, 'vertical', vertices));
    }
  }

  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';

  return {
    mesh: {
      bounds,
      columns,
      rows,
      vertexCount: vertices.length,
      segmentCount: segments.length,
      activeSegmentCount: segments.filter((segment) => segment.maxOffsetDistance > 0).length,
      mode: 'weighted-pin-segment-preview',
    },
    vertices,
    segments,
    pinOverlays: validation.sanitizedPins.map((pin) => ({
      id: pin.id,
      source: { ...pin.source },
      target: { ...pin.target },
      radius: pin.radius,
      moved: !isStationaryPin(pin),
      influenceBounds: computePreviewBounds([pin]),
    })),
    validation,
    unsupportedCaveats: [
      'preview-mesh-is-not-editable-triangulated-puppet-mesh',
      'perspective-corner-plane-warp-is-not-supported',
      'grid-warp-handles-are-preview-metadata-only',
    ],
    previewSignature: [
      'puppet-mesh',
      'v1',
      documentId,
      layerId,
      `${columns}x${rows}`,
      `${formatPlanningNumber(bounds.left)},${formatPlanningNumber(bounds.top)},${formatPlanningNumber(bounds.right)},${formatPlanningNumber(bounds.bottom)}`,
      formatPuppetWarpPinListSignature(validation.sanitizedPins),
      vertices
        .map((vertex) => `${vertex.id}>${formatPlanningNumber(vertex.target.x)},${formatPlanningNumber(vertex.target.y)}`)
        .join('|'),
    ].join(':'),
  };
}

export function buildPuppetWarpApplyCancelPlan(
  pins: Array<ImagePuppetWarpPin | ImagePuppetWarpSessionPin>,
  options: ImagePuppetWarpApplyCancelPlanOptions = {},
): ImagePuppetWarpApplyCancelPlan {
  const validation = validatePuppetWarpPinSession(pins, options);
  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';
  const maxPinCount = options.maxPinCount ?? 'unbounded';
  const pinSignature = formatPuppetWarpPinListSignature(validation.sanitizedPins);
  const sourceKind = options.sourceKind ?? (options.preserveSmartObjects ? 'smart-object' : 'pixel-layer');
  const sourceId = options.sourceId ?? null;
  const outputPolicy: Exclude<ImagePuppetWarpOutputPolicy, 'discard-preview-only'> =
    sourceKind === 'pixel-layer' && !options.duplicateLayerBeforeApply
      ? 'active-layer-pixels'
      : 'derived-bitmap-layer';
  const preservesActiveLayerPixels = outputPolicy === 'derived-bitmap-layer' || Boolean(options.duplicateLayerBeforeApply);
  const warnings: ImagePuppetWarpSourceSafetyWarning[] = [
    outputPolicy === 'derived-bitmap-layer'
      ? 'apply-commits-derived-pixels'
      : 'apply-commits-active-layer-pixels',
  ];

  if (sourceKind === 'source-linked-layer') {
    warnings.push('source-linked-original-is-not-mutated');
  }

  if (sourceKind === 'smart-object' || options.preserveSmartObjects) {
    warnings.push('smart-object-filter-is-not-preserved');
  }

  const applySignature = [
    'puppet-apply',
    'v1',
    documentId,
    layerId,
    `${validation.sanitizedPins.length}/${maxPinCount}`,
    outputPolicy,
    options.duplicateLayerBeforeApply ? 'duplicate-layer' : 'active-layer',
    pinSignature,
  ].join(':');
  const cancelSignature = [
    'puppet-cancel',
    'v1',
    documentId,
    layerId,
    `${validation.sanitizedPins.length}/${maxPinCount}`,
    'no-pixel-mutation',
    pinSignature,
  ].join(':');

  return {
    sourceSafety: {
      sourceKind,
      sourceId,
      outputPolicy,
      preservesOriginalSource: sourceKind !== 'pixel-layer' || Boolean(options.duplicateLayerBeforeApply),
      preservesActiveLayerPixels,
      requiresHistorySnapshot: true,
      requiresDuplicateLayerForNonDestructiveEdit: !preservesActiveLayerPixels,
      warnings,
    },
    apply: {
      action: 'apply-puppet-warp',
      mutatesPixels: true,
      outputPolicy,
      signature: applySignature,
    },
    cancel: {
      action: 'cancel-puppet-warp-preview',
      mutatesPixels: false,
      outputPolicy: 'discard-preview-only',
      signature: cancelSignature,
    },
    validation,
    unsupportedCaveats: [
      'perspective-warp-plane-handles-unsupported',
      'photoshop-smart-object-puppet-filter-unsupported',
      'gimp-cage-transform-equivalent-unsupported',
      'reopenable-puppet-mesh-state-unsupported',
    ],
    planSignature: [
      'puppet-plan',
      'v1',
      documentId,
      layerId,
      sourceKind,
      sourceId ?? 'no-source',
      `apply=${applySignature}`,
      `cancel=${cancelSignature}`,
    ].join(':'),
  };
}

export function buildPuppetWarpDeformationReadinessDescriptor(
  pins: Array<ImagePuppetWarpPin | ImagePuppetWarpSessionPin>,
  options: ImagePuppetWarpDeformationReadinessOptions = {},
): ImagePuppetWarpDeformationReadinessDescriptor {
  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';
  const validation = validatePuppetWarpPinSession(pins, options);
  const mesh = buildPuppetWarpMeshPreviewPlan(validation.sanitizedPins, options);
  const applyCancel = buildPuppetWarpApplyCancelPlan(validation.sanitizedPins, options);
  const movedPinCount = validation.sanitizedPins.filter((pin) => !isStationaryPin(pin)).length;
  const pinPlanSignature = [
    'puppet-pin-plan',
    'v1',
    documentId,
    layerId,
    `${validation.acceptedCount}/${validation.maxPinCount ?? 'unbounded'}`,
    `moved=${movedPinCount}`,
    formatPuppetWarpPinListSignature(validation.sanitizedPins),
  ].join(':');
  const unsupportedStates = buildPuppetWarpReadinessLaneUnsupportedDescriptors(
    documentId,
    layerId,
    options,
  );

  return {
    lane: 'image-deformation-puppet-warp',
    pinPlan: {
      previewId: `puppet-warp-${documentId}-${layerId}-${validation.acceptedCount}-pins`,
      pinPlanSignature,
      validationSignature: validation.validationSignature,
      bounded: validation.maxPinCount !== null || validation.layerBounds !== null,
      acceptedPinCount: validation.acceptedCount,
      rejectedPinCount: validation.rejectedCount,
      movedPinCount,
    },
    mesh: {
      previewId: `puppet-mesh-${documentId}-${layerId}-${mesh.mesh.columns}x${mesh.mesh.rows}`,
      previewSignature: mesh.previewSignature,
      trueTriangulatedMeshSupported: false,
      perspectiveWarpPlanesSupported: false,
      reopenableMeshStateSupported: false,
    },
    sourceSafety: {
      sourceKind: applyCancel.sourceSafety.sourceKind,
      sourceId: applyCancel.sourceSafety.sourceId,
      outputPolicy: applyCancel.sourceSafety.outputPolicy,
      signature: buildPuppetWarpSourceSafetySignature(applyCancel, documentId, layerId),
    },
    previewActions: {
      applySignature: applyCancel.apply.signature,
      cancelSignature: applyCancel.cancel.signature,
    },
    validation,
    unsupportedStates,
    signature: [
      'puppet-lane',
      'v1',
      documentId,
      layerId,
      pinPlanSignature,
      applyCancel.sourceSafety.sourceKind,
      applyCancel.sourceSafety.outputPolicy,
      unsupportedStates.map((state) => state.feature).join('|') || 'none',
    ].join(':'),
  };
}

export function buildPuppetWarpPreviewMetadata(
  pins: ImagePuppetWarpPin[],
  options: ImagePuppetWarpPinSessionOptions = {},
): ImagePuppetWarpPreviewMetadata {
  const session = createPuppetWarpPinSession(pins, options);
  const bounds = computePreviewBounds(session.pins);
  const maxRadius = resolveMaxRadius(session.pins, options.maxRadius);
  const spanX = Math.max(0, bounds.right - bounds.left);
  const spanY = Math.max(0, bounds.bottom - bounds.top);

  return {
    bounds,
    meshSize: {
      columns: Math.max(2, Math.ceil(spanX / Math.max(1, maxRadius * 2))) + (session.pins.length > 1 ? 1 : 0),
      rows: Math.max(2, Math.ceil(spanY / Math.max(1, maxRadius * 2))),
    },
    pinCount: session.pins.length,
    warnings: session.warnings,
  };
}

export function buildPuppetWarpPlanningDescriptor(
  pins: ImagePuppetWarpPin[],
  options: ImagePuppetWarpPinSessionOptions = {},
): ImagePuppetWarpPlanningDescriptor {
  const session = createPuppetWarpPinSession(pins, options);
  const metadata = buildPuppetWarpPreviewMetadata(pins, options);
  const pinSummaries = session.pins.map((pin) => {
    const x = roundPlanningNumber(pin.target.x - pin.source.x);
    const y = roundPlanningNumber(pin.target.y - pin.source.y);
    return {
      id: pin.id,
      source: { ...pin.source },
      target: { ...pin.target },
      radius: pin.radius,
      displacement: {
        x,
        y,
        distance: roundPlanningNumber(Math.hypot(x, y)),
      },
    };
  });
  const totalRadius = session.pins.reduce((total, pin) => total + pin.radius, 0);
  const totalDisplacement = pinSummaries.reduce((total, pin) => total + pin.displacement.distance, 0);
  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';
  const warnings = [...session.warnings];

  if (!warnings.includes('unsupported-on-canvas-pin-editor')) {
    warnings.push('unsupported-on-canvas-pin-editor');
  }

  if (!warnings.includes('unsupported-non-destructive-workflow')) {
    warnings.push('unsupported-non-destructive-workflow');
  }

  return {
    toolSupport: {
      pins: true,
      directMeshEditing: false,
      densityModes: false,
      smartObjectPreservation: false,
      onCanvasPinEditor: false,
      nonDestructive: false,
      pinSessionHelpers: {
        add: true,
        move: true,
        remove: true,
      },
    },
    pinSummary: {
      count: session.pins.length,
      movedCount: pinSummaries.filter((pin) => pin.displacement.distance > 0).length,
      averageRadius: session.pins.length > 0 ? roundPlanningNumber(totalRadius / session.pins.length) : 0,
      totalDisplacement: roundPlanningNumber(totalDisplacement),
      pins: pinSummaries,
    },
    mesh: {
      bounds: metadata.bounds,
      columns: metadata.meshSize.columns,
      rows: metadata.meshSize.rows,
      limitation: 'weighted-pin-field-only',
    },
    preview: {
      id: `puppet-warp-${documentId}-${layerId}-${session.pins.length}-pins`,
      signature: [
        'puppet',
        documentId,
        layerId,
        pinSummaries
          .map((pin) => `${pin.id}@${formatPlanningNumber(pin.source.x)},${formatPlanningNumber(pin.source.y)}>${formatPlanningNumber(pin.target.x)},${formatPlanningNumber(pin.target.y)}/${formatPlanningNumber(pin.radius)}`)
          .join('|'),
        `${metadata.meshSize.columns}x${metadata.meshSize.rows}`,
        `${metadata.bounds.left},${metadata.bounds.top},${metadata.bounds.right},${metadata.bounds.bottom}`,
      ].join(':'),
    },
    warnings,
  };
}

export function describePuppetWarpReadiness(
  pins: ImagePuppetWarpPin[],
  options: ImagePuppetWarpPinSessionOptions = {},
): ImagePuppetWarpReadinessDescriptor {
  const session = createPuppetWarpPinSession(pins, options);
  const documentId = options.documentId ?? 'document';
  const layerId = options.layerId ?? 'layer';
  const movedPinCount = session.pins.filter((pin) => {
    return roundPlanningNumber(Math.hypot(pin.target.x - pin.source.x, pin.target.y - pin.source.y)) > 0;
  }).length;
  const maxPinCount = options.maxPinCount ?? null;
  const unsupportedStates: ImagePuppetWarpPhotoshopUnsupportedState[] = [
    'interactive-on-canvas-pin-editor',
    'direct-triangulated-mesh-editing',
    'mesh-density-modes',
    'perspective-warp',
  ];

  if (options.preserveSmartObjects) {
    unsupportedStates.push('smart-object-puppet-warp-filter');
  }

  return {
    supportedLocalDeformations: ['weighted-pin-displacement'],
    sessionState: {
      type: 'bounded-pin-session',
      pinCount: session.pins.length,
      maxPinCount,
      previewBeforeCommit: true,
      destructiveApply: true,
      undoSnapshotRequired: true,
    },
    controlState: {
      addPin: true,
      movePin: true,
      removePin: true,
      pinRadius: true,
      directMeshEditing: false,
      densityModes: false,
      perspectiveWarp: false,
    },
    pinReadiness: {
      addPin: true,
      movePin: true,
      removePin: true,
      pinRadius: true,
      movedPinCount,
      unmovedPinCount: session.pins.length - movedPinCount,
      actionSuitable: true,
      batchSuitable: true,
      previewSignature: `puppet-pin-preview:v1:${documentId}:${layerId}:${session.pins.length}:${movedPinCount}:${session.pins.length - movedPinCount}`,
      exportSignature: `puppet-pin-export:v1:${documentId}:${layerId}:derived-bitmap`,
    },
    pinSupport: {
      supported: true,
      maxPinCount,
      movablePins: true,
      fixedPins: true,
      movedPinCount,
      unmovedPinCount: session.pins.length - movedPinCount,
      limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp',
    },
    meshReadiness: {
      weightedFieldSupported: true,
      triangulatedMeshEditingSupported: false,
      meshDensityModesSupported: false,
      perspectiveWarpSupported: false,
      limitation: 'weighted-local-pin-field-not-triangulated-mesh-warp',
      unsupportedStates: [
        'direct-triangulated-mesh-editing',
        'mesh-density-modes',
        'perspective-warp',
      ],
    },
    unsupportedPhotoshopEquivalentStates: unsupportedStates,
    smartSourceCaveats: [
      'smart-object-preservation-is-metadata-only',
      'source-linked-layer-must-be-exported-as-derived-bitmap',
    ],
    nonDestructiveLimitations: [
      'puppet-warp-commits-pixels-on-apply',
      'no-reopenable-puppet-mesh-state',
      'callers-need-history-or-duplicate-layer-for-reversal',
    ],
    previewExportSignatures: {
      preview: `puppet-readiness-preview:v1:${documentId}:${layerId}:${session.pins.length}/${maxPinCount ?? 'unbounded'}:${movedPinCount}`,
      export: `puppet-readiness-export:v1:${documentId}:${layerId}:derived-bitmap`,
    },
    workspace: {
      fullyInteractive: false,
      onCanvasPinPlacementPreview: true,
      reopenableMeshWorkspaceSupported: false,
      limitation: 'descriptor-only-pin-session-not-live-deformation-workspace',
      unsupportedFeatures: [
        'interactive-on-canvas-pin-editor',
        'mesh-density-overlays',
        'reopenable-puppet-mesh-workspace',
      ],
    },
    exportSourceBinHandoffSafety: {
      safeForFlattenedExport: true,
      safeForSourceBinDerivedBitmap: true,
      preservesOriginalSource: false,
      caveat: 'handoff-should-use-derived-bitmap-or-snapshot-not-original-smart-source',
    },
    batchActionSuitability: {
      deterministic: true,
      suitableForRecordedActions: true,
      caveats: [
        'requires-fixed-pin-coordinates-radius-and-layer-bounds',
        'not-suitable-for-freeform-on-canvas-mesh-edit-recording',
      ],
    },
    readinessSignature: [
      'puppet-readiness',
      documentId,
      layerId,
      `${session.pins.length}/${maxPinCount ?? 'unbounded'}`,
      String(movedPinCount),
      options.preserveSmartObjects ? 'smart' : 'bitmap',
      session.pins
        .map((pin) => `${pin.id}@${formatPlanningNumber(pin.source.x)},${formatPlanningNumber(pin.source.y)}>${formatPlanningNumber(pin.target.x)},${formatPlanningNumber(pin.target.y)}/${formatPlanningNumber(pin.radius)}`)
        .join('|') || 'no-pins',
    ].join(':'),
  };
}

function nextPinId(pins: ImagePuppetWarpSessionPin[]): string {
  const used = new Set(pins.map((pin) => pin.id));
  let index = 1;
  while (used.has(`pin-${index}`)) {
    index += 1;
  }

  return `pin-${index}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizePin(
  pin: ImagePuppetWarpPin,
  options: Omit<ImagePuppetWarpPinSessionOptions, 'preserveSmartObjects'>,
): ImagePuppetWarpPin | null {
  if (!isFinitePoint(pin.source) || !isFinitePoint(pin.target)) {
    return null;
  }

  return {
    source: { x: pin.source.x, y: pin.source.y },
    target: { x: pin.target.x, y: pin.target.y },
    radius: normalizeRadius(pin.radius, {
      defaultRadius: options.defaultRadius,
      minRadius: options.minRadius,
      maxRadius: options.maxRadius,
    }),
  };
}

function isFinitePoint(point: ImagePuppetWarpPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizeRadius(
  radius: number,
  options: {
    defaultRadius?: number;
    minRadius?: number;
    maxRadius?: number;
  } = {},
): number {
  const defaultRadius = Number.isFinite(options.defaultRadius) ? Math.max(0, options.defaultRadius ?? 0) : 0;
  const minRadius = Number.isFinite(options.minRadius) ? Math.max(0, options.minRadius ?? 0) : 0;
  const maxRadius = Number.isFinite(options.maxRadius) ? Math.max(minRadius, options.maxRadius ?? minRadius) : Number.POSITIVE_INFINITY;
  const baseRadius = Number.isFinite(radius) ? radius : defaultRadius;
  return clamp(Math.max(0, baseRadius), minRadius, maxRadius);
}

function computePreviewBounds(
  pins: ImagePuppetWarpSessionPin[],
): ImagePuppetWarpPreviewMetadata['bounds'] {
  if (pins.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const pin of pins) {
    left = Math.min(left, pin.source.x - pin.radius, pin.target.x - pin.radius);
    top = Math.min(top, pin.source.y - pin.radius, pin.target.y - pin.radius);
    right = Math.max(right, pin.source.x + pin.radius, pin.target.x + pin.radius);
    bottom = Math.max(bottom, pin.source.y + pin.radius, pin.target.y + pin.radius);
  }

  return {
    left: Math.max(0, Math.floor(left)),
    top: Math.max(0, Math.floor(top)),
    right: Math.max(0, Math.ceil(right)),
    bottom: Math.max(0, Math.ceil(bottom)),
  };
}

function resolveMaxRadius(
  pins: ImagePuppetWarpSessionPin[],
  configuredMaxRadius?: number,
): number {
  if (Number.isFinite(configuredMaxRadius)) {
    return Math.max(0, configuredMaxRadius ?? 0);
  }

  return pins.reduce((largest, pin) => Math.max(largest, pin.radius), 0);
}

function getCandidatePinId(pin: ImagePuppetWarpPin | ImagePuppetWarpSessionPin): string | undefined {
  if ('id' in pin && pin.id.trim().length > 0) {
    return pin.id;
  }

  return undefined;
}

function normalizeLayerBounds(
  bounds?: ImagePuppetWarpLayerBounds,
): ImagePuppetWarpPreviewMetadata['bounds'] | null {
  if (!bounds || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return null;
  }

  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;

  return {
    left: roundPlanningNumber(Math.min(bounds.left, right)),
    top: roundPlanningNumber(Math.min(bounds.top, bottom)),
    right: roundPlanningNumber(Math.max(bounds.left, right)),
    bottom: roundPlanningNumber(Math.max(bounds.top, bottom)),
  };
}

function isPointInsideBounds(
  point: ImagePuppetWarpPoint,
  bounds: ImagePuppetWarpPreviewMetadata['bounds'],
): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function isStationaryPin(pin: ImagePuppetWarpPin): boolean {
  return roundPlanningNumber(Math.hypot(pin.target.x - pin.source.x, pin.target.y - pin.source.y)) === 0;
}

function buildPuppetWarpSourceSafetySignature(
  plan: ImagePuppetWarpApplyCancelPlan,
  documentId: string,
  layerId: string,
): string {
  const smartFilterState = plan.sourceSafety.warnings.includes('smart-object-filter-is-not-preserved')
    ? 'smart-filter-unsupported'
    : 'bitmap-commit';

  return [
    'puppet-source-safety',
    'v1',
    documentId,
    layerId,
    plan.sourceSafety.sourceKind,
    plan.sourceSafety.sourceId ?? 'no-source',
    plan.sourceSafety.outputPolicy,
    smartFilterState,
  ].join(':');
}

function buildPuppetWarpReadinessLaneUnsupportedDescriptors(
  documentId: string,
  layerId: string,
  options: ImagePuppetWarpDeformationReadinessOptions,
): ImagePuppetWarpReadinessLaneUnsupportedDescriptor[] {
  return [
    buildPuppetWarpReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'interactive-on-canvas-pin-editor',
      'interactive-on-canvas-pin-editor',
      true,
      'bounded-pin-session-descriptors',
    ),
    buildPuppetWarpReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'true-triangulated-mesh',
      'direct-triangulated-mesh-editing',
      true,
      'weighted-pin-segment-preview',
    ),
    buildPuppetWarpReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'perspective-warp-planes',
      'perspective-warp',
      true,
      'use-transform-or-weighted-puppet-pins',
    ),
    buildPuppetWarpReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'smart-object-preservation',
      'smart-object-puppet-warp-filter',
      Boolean(options.preserveSmartObjects || options.sourceKind === 'smart-object'),
      'derived-bitmap-layer',
    ),
    buildPuppetWarpReadinessLaneUnsupportedDescriptor(
      documentId,
      layerId,
      'reopenable-mesh-state',
      'reopenable-puppet-mesh-state',
      true,
      'history-snapshot-or-cancel-preview',
    ),
  ];
}

function buildPuppetWarpReadinessLaneUnsupportedDescriptor(
  documentId: string,
  layerId: string,
  feature: ImagePuppetWarpReadinessLaneFeature,
  state: ImagePuppetWarpReadinessLaneUnsupportedState,
  requested: boolean,
  fallback: ImagePuppetWarpReadinessLaneFallback,
): ImagePuppetWarpReadinessLaneUnsupportedDescriptor {
  return {
    feature,
    supported: false,
    requested,
    state,
    fallback,
    signature: ['puppet-unsupported', 'v1', documentId, layerId, feature].join(':'),
  };
}

function normalizeMeshCount(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(2, Math.floor(value ?? fallback));
}

function interpolateGridValue(start: number, end: number, index: number, count: number): number {
  if (count <= 1) {
    return roundPlanningNumber(start);
  }

  return roundPlanningNumber(start + ((end - start) * index) / (count - 1));
}

function meshVertexId(column: number, row: number): string {
  return `v-${column}-${row}`;
}

function roundPoint(point: ImagePuppetWarpPoint): ImagePuppetWarpPoint {
  return {
    x: roundPlanningNumber(point.x),
    y: roundPlanningNumber(point.y),
  };
}

function countInfluencingPins(point: ImagePuppetWarpPoint, pins: ImagePuppetWarpSessionPin[]): number {
  return pins.filter((pin) => {
    if (pin.radius === 0) {
      return false;
    }

    return Math.hypot(point.x - pin.source.x, point.y - pin.source.y) <= pin.radius;
  }).length;
}

function makeMeshSegment(
  id: string,
  fromColumn: number,
  fromRow: number,
  toColumn: number,
  toRow: number,
  axis: ImagePuppetWarpMeshPreviewSegment['axis'],
  vertices: ImagePuppetWarpMeshPreviewVertex[],
): ImagePuppetWarpMeshPreviewSegment {
  const from = meshVertexId(fromColumn, fromRow);
  const to = meshVertexId(toColumn, toRow);
  const fromVertex = vertices.find((vertex) => vertex.id === from);
  const toVertex = vertices.find((vertex) => vertex.id === to);

  return {
    id,
    from,
    to,
    axis,
    maxOffsetDistance: roundPlanningNumber(Math.max(
      fromVertex ? Math.hypot(fromVertex.offset.x, fromVertex.offset.y) : 0,
      toVertex ? Math.hypot(toVertex.offset.x, toVertex.offset.y) : 0,
    )),
  };
}

function formatPuppetWarpPinListSignature(pins: ImagePuppetWarpSessionPin[]): string {
  return pins
    .map((pin) => `${pin.id}@${formatPlanningNumber(pin.source.x)},${formatPlanningNumber(pin.source.y)}>${formatPlanningNumber(pin.target.x)},${formatPlanningNumber(pin.target.y)}/${formatPlanningNumber(pin.radius)}`)
    .join('|') || 'no-pins';
}

function roundPlanningNumber(value: number): number {
  return Number(value.toFixed(2));
}

function formatPlanningNumber(value: number): string {
  return roundPlanningNumber(value).toString();
}
