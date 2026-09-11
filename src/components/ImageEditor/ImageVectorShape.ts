import type {
  CustomVectorShapePreset,
  CustomVectorShapePresetKind,
  ImageDocument,
  ImageLayer,
  ImagePathVectorShape,
  ImageVectorPathPoint,
  ImageVectorShape,
  ShapeToolSettings,
  VectorShapeStyle,
} from '../../types/imageEditor';
import {
  describeImageVectorBooleanSupport,
  describeImageVectorBooleanSupportMatrix,
  planImageVectorBooleanOperation,
  type ImageVectorBooleanOperation,
  type ImageVectorBooleanPathDescriptor,
  type ImageVectorBooleanResult,
  type ImageVectorBooleanUnsupportedStateDescriptor,
  type ImageVectorBooleanWarning,
} from './ImageVectorBooleans';
import { createBitmap } from './LayerBitmap';

export interface VectorShapePoint {
  x: number;
  y: number;
}

export type RectEllipseVectorShapeKind = 'rect' | 'ellipse';
export type ImageVectorRetainedEditability = 'editable' | 'not-vector' | 'not-applicable';
export type ImageVectorPsdHandoffSupport = 'limited' | 'unsupported';
export type ImageVectorRasterizeReason = 'pixel-edit' | 'filter' | 'export-flatten' | 'manual';
export type ImageCustomVectorShapeEditableParameter = 'polygonSides' | 'starInnerRadius';
export type ImageRasterVectorShapeReadinessBlocker =
  | 'not-retained-vector-shape'
  | 'ellipse-boolean-requires-convert-to-path'
  | 'shape-already-editable-path';
export type ImageRasterVectorShapeReadinessWarning =
  | 'bezier-handles-not-retained'
  | 'ellipse-direct-boolean-blocked'
  | 'live-boolean-stack-not-retained'
  | 'overlapping-path-boolean-not-materialized'
  | 'psd-native-shape-roundtrip-limited';

export interface ImageVectorShapeUnsupportedState {
  code: ImageRasterVectorShapeReadinessWarning;
  severity: 'warning' | 'blocker';
  message: string;
  fallback: string;
}

export interface ImageCustomVectorShapePresetDescriptor {
  kind: CustomVectorShapePresetKind | 'none';
  polygonSides?: number;
  starInnerRadius?: number;
  source: 'shape-tool-preset' | 'none';
  retained: boolean;
  editableParameters: ImageCustomVectorShapeEditableParameter[];
  regeneration: 'regenerates-from-preset-until-points-are-edited' | 'none';
  nativeLibraryInstance: false;
}

export interface ImageCustomVectorShapeParameterDescriptor {
  applies: boolean;
  editable: boolean;
  value: number | null;
  min: number;
  max: number;
}

export interface ImageCustomVectorShapeGeometryDescriptor {
  kind: CustomVectorShapePresetKind;
  closed: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  documentPoints: ImageVectorPathPoint[];
  pointCount: number;
  pointSignature: string;
  parameters: {
    polygonSides: ImageCustomVectorShapeParameterDescriptor;
    starInnerRadius: ImageCustomVectorShapeParameterDescriptor;
  };
  editableParameters: ImageCustomVectorShapeEditableParameter[];
  booleanOperandReadiness: {
    ready: boolean;
    blockers: Array<'open-line-path'>;
    exactSubsets: Array<Extract<ImageVectorBooleanResult['supportedSubset'], 'identical-simple-polygons' | 'non-overlapping-simple-polygons'>>;
  };
  fillRule: 'evenodd';
  handoffSignatures: {
    svg: string;
    psd: string;
    sourceBin: string;
  };
  previewSignatureFields: string[];
  previewSignature: string;
}

export interface ImageVectorShapeMetadataDescriptor {
  layerId: string;
  retained: boolean;
  shapeKind: ImageVectorShape['kind'] | 'none';
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  geometry: {
    kind: ImageVectorShape['kind'] | 'none';
    pointCount: number;
    closed: boolean;
    supportsBezierHandles: boolean;
    presetKind: CustomVectorShapePresetKind | 'none';
    preset: ImageCustomVectorShapePresetDescriptor;
    localPoints: ImageVectorPathPoint[];
    localPointSignature: string;
    convertToPathApproximation: ImageRasterVectorShapeReadinessDescriptor['convertToPath']['approximation'];
  };
  style: {
    fillColor: string;
    fillOpacity: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeWidth: number;
    editableFields: Array<keyof VectorShapeStyle>;
  };
  source: {
    hasSvgSource: boolean;
    hasVectorRecipe: boolean;
    hasBooleanSource: boolean;
    booleanSourceOperation: ImageVectorBooleanOperation | 'none';
    booleanSourceSubset: ImageVectorBooleanResult['supportedSubset'] | 'none';
    shapeLibrary: 'none' | 'signal-loom-custom-shape-library' | 'native-shape-primitives-or-path';
    nativeShapeSemantics: 'none' | 'materialized-straight-segment-path-only' | 'retained-shape-or-path';
  };
  handoffCaveats: {
    svg: string[];
    psd: string[];
    sourceBin: string[];
  };
  handoffSignatures: {
    svg: string;
    psd: string;
    sourceBin: string;
  };
  unsupportedStates: ImageVectorShapeUnsupportedState[];
  warningCodes: ImageRasterVectorShapeReadinessWarning[];
  blockerCodes: ImageRasterVectorShapeReadinessBlocker[];
  previewSignatureFields: string[];
  previewSignature: string;
}

export interface ImageVectorLayerEditabilityDescriptor {
  editable: boolean;
  layerId: string;
  shapeKind: ImageVectorShape['kind'] | 'none';
  retainedStyle: {
    fillColor: ImageVectorRetainedEditability;
    fillOpacity: ImageVectorRetainedEditability;
    strokeColor: ImageVectorRetainedEditability;
    strokeOpacity: ImageVectorRetainedEditability;
    strokeWidth: ImageVectorRetainedEditability;
  };
  pathPoints: {
    editable: boolean;
    pointCount: number;
    supportsBezierHandles: boolean;
    boundary: 'none' | 'straight-segment-local-points-only' | 'preset-regenerates-on-size-change';
  };
  handoff: {
    svg: {
      supported: boolean;
      limitations: string[];
    };
    psd: {
      supported: ImageVectorPsdHandoffSupport;
      limitations: string[];
    };
  };
  preview: {
    width: number;
    height: number;
    hasBitmapPreview: boolean;
    hasSvgSource: boolean;
    signatureFields: string[];
    signature: string;
  };
}

export interface ImageVectorLayerRasterizePlan {
  layerId: string;
  reason: ImageVectorRasterizeReason;
  willDiscardRetainedFillStrokeEditability: boolean;
  willDiscardPathPointEditability: boolean;
  warnings: string[];
  previewSignature: string;
}

export interface ImageVectorLayerBooleanWarning {
  code:
    | ImageVectorBooleanWarning['code']
    | 'bezier-segments-not-supported'
    | 'not-retained-vector-shape'
    | 'unsupported-vector-shape-kind';
  layerId?: string;
  message: string;
}

export interface ImageVectorLayerBooleanMaterialization {
  operation: ImageVectorBooleanOperation;
  status: ImageVectorBooleanResult['status'];
  supportedSubset: ImageVectorBooleanResult['supportedSubset'];
  sourceLayerIds: [string, string];
  inputASignature: string;
  inputBSignature: string;
  previewSignature: string;
  outputLayers: ImageLayer[];
  warnings: ImageVectorLayerBooleanWarning[];
  handoffLimitations: string[];
  handoff: {
    exportReadiness: 'exact-materialized-paths' | 'unsupported-not-materialized';
    supportedExactMaterialization: boolean;
    outputShapeKind: 'path' | 'none';
    retainsLiveBooleanStack: false;
    retainsSourcePresetMetadata: false;
    caveats: string[];
  };
}

export interface ImageRasterVectorShapeReadinessDescriptor {
  layerId: string;
  shapeKind: ImageVectorShape['kind'] | 'none';
  vectorBacked: {
    supported: boolean;
    supportLevel: 'native-retained-vector' | 'not-vector';
    supportedKinds: Array<ImageVectorShape['kind']>;
  };
  retainedShape: ImageVectorShapeMetadataDescriptor;
  fillStrokeControls: ImageVectorLayerEditabilityDescriptor['retainedStyle'];
  rasterize: {
    ready: boolean;
    destructive: boolean;
    warnings: string[];
    blockerCodes: ImageRasterVectorShapeReadinessBlocker[];
    previewSignature: string;
  };
  convertToPath: {
    ready: boolean;
    outputKind: 'path' | 'already-path' | 'none';
    approximation: 'exact-rect-corners' | `polygonal-ellipse-${number}-segments` | 'none';
    blockerCodes: ImageRasterVectorShapeReadinessBlocker[];
    previewSignature: string;
  };
  booleanOperations: {
    ready: boolean;
    operations: ImageVectorBooleanOperation[];
    supportMatrixSignature: string;
    exactSubsets: Array<Exclude<ImageVectorBooleanResult['supportedSubset'], 'none'>>;
    unsupportedStates: ImageVectorBooleanUnsupportedStateDescriptor[];
    limitations: string[];
    blockerCodes: ImageRasterVectorShapeReadinessBlocker[];
    previewSignature: string;
  };
  handoffCaveats: ImageVectorShapeMetadataDescriptor['handoffCaveats'];
  customShapeCaveats: string[];
  warningCodes: ImageRasterVectorShapeReadinessWarning[];
  warnings: ImageVectorShapeUnsupportedState[];
  previewSignatureFields: string[];
  previewSignature: string;
  blockerCodes: ImageRasterVectorShapeReadinessBlocker[];
}

export const CUSTOM_VECTOR_SHAPE_PRESET_OPTIONS: CustomVectorShapePresetKind[] = [
  'line',
  'triangle',
  'diamond',
  'polygon',
  'star',
];

export function describeCustomVectorShapePresetGeometry(params: {
  presetKind: CustomVectorShapePresetKind;
  settings: Pick<ShapeToolSettings, 'polygonSides' | 'starInnerRadius'>;
  from?: VectorShapePoint;
  to?: VectorShapePoint;
  bounds?: { x: number; y: number; width: number; height: number };
}): ImageCustomVectorShapeGeometryDescriptor {
  const preset = buildCustomVectorShapePreset(params.presetKind, params.settings);
  const closed = preset.kind !== 'line';
  const bounds = params.bounds
    ? normalizeGeometryBounds(params.bounds)
    : normalizeDragBounds(params.from ?? { x: 0, y: 0 }, params.to ?? { x: 100, y: 100 });
  const documentPoints = params.from && params.to
    ? buildCustomVectorShapeDocumentPointsFromDrag(preset, params.from, params.to)
    : buildCustomVectorShapeDocumentPointsFromBounds(preset, bounds);
  const pointSignature = documentPoints
    .map((point) => `${formatSignatureNumber(point.x)},${formatSignatureNumber(point.y)}`)
    .join(';');
  const editableParameters = describeCustomVectorShapePresetEditableParameters(preset);
  const parameterSignature = buildCustomVectorShapeParameterSignature(preset);
  const exactSubsets: ImageCustomVectorShapeGeometryDescriptor['booleanOperandReadiness']['exactSubsets'] = closed
    ? ['identical-simple-polygons', 'non-overlapping-simple-polygons']
    : [];
  const handoffState = closed ? 'closed' : 'open';
  const previewSignature = [
    'custom-shape-geometry',
    preset.kind,
    handoffState,
    [
      formatSignatureNumber(bounds.x),
      formatSignatureNumber(bounds.y),
      formatSignatureNumber(bounds.width),
      formatSignatureNumber(bounds.height),
    ].join(','),
    String(documentPoints.length),
    pointSignature,
    parameterSignature,
  ].join('|');

  return {
    kind: preset.kind,
    closed,
    bounds,
    documentPoints,
    pointCount: documentPoints.length,
    pointSignature,
    parameters: {
      polygonSides: {
        applies: preset.kind === 'polygon' || preset.kind === 'star',
        editable: preset.kind === 'polygon' || preset.kind === 'star',
        value: preset.kind === 'polygon' || preset.kind === 'star' ? clampPolygonSides(preset.polygonSides) : null,
        min: 3,
        max: 12,
      },
      starInnerRadius: {
        applies: preset.kind === 'star',
        editable: preset.kind === 'star',
        value: preset.kind === 'star' ? clampStarInnerRadius(preset.starInnerRadius) : null,
        min: 0.1,
        max: 0.9,
      },
    },
    editableParameters,
    booleanOperandReadiness: {
      ready: closed,
      blockers: closed ? [] : ['open-line-path'],
      exactSubsets,
    },
    fillRule: 'evenodd',
    handoffSignatures: {
      svg: `svg|custom-shape|${preset.kind}|${handoffState}|${documentPoints.length}|${formatSignatureNumber(bounds.width)}x${formatSignatureNumber(bounds.height)}`,
      psd: `psd|custom-shape|${preset.kind}|${handoffState}|${documentPoints.length}|raster-preview-plus-vector-metadata`,
      sourceBin: `source-bin|custom-shape|${preset.kind}|${handoffState}|sloom-vector-metadata`,
    },
    previewSignatureFields: ['kind', 'closed', 'bounds', 'parameters', 'points'],
    previewSignature,
  };
}

export function getEditableVectorShape(layer: ImageLayer): ImageVectorShape | null {
  return layer.metadata?.vectorShape ?? null;
}

export function isEditableVectorShapeLayer(
  layer: ImageLayer | null | undefined,
): layer is ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> & { vectorShape: ImageVectorShape } } {
  return Boolean(layer?.type === 'vector' && layer.metadata?.vectorShape);
}

export function describeImageVectorLayerEditability(layer: ImageLayer): ImageVectorLayerEditabilityDescriptor {
  const shape = getEditableVectorShape(layer);
  const styleEditability: ImageVectorRetainedEditability = shape ? 'editable' : 'not-vector';
  const pathBoundary = describePathPointBoundary(shape);
  return {
    editable: Boolean(shape),
    layerId: layer.id,
    shapeKind: shape?.kind ?? 'none',
    retainedStyle: {
      fillColor: styleEditability,
      fillOpacity: styleEditability,
      strokeColor: styleEditability,
      strokeOpacity: styleEditability,
      strokeWidth: styleEditability,
    },
    pathPoints: {
      editable: shape?.kind === 'path',
      pointCount: shape?.kind === 'path' ? shape.points.length : 0,
      supportsBezierHandles: shape?.kind === 'path' && pathHasBezierHandles(shape.points),
      boundary: pathBoundary,
    },
    handoff: {
      svg: {
        supported: Boolean(shape),
        limitations: shape
          ? ['no-live-boolean-stack', 'no-bezier-handle-editing']
          : ['not-a-retained-vector-layer'],
      },
      psd: {
        supported: shape ? 'limited' : 'unsupported',
        limitations: shape
          ? ['exports-raster-preview-plus-vector-metadata', 'native-psd-shape-layer-roundtrip-not-guaranteed']
          : ['not-a-retained-vector-layer'],
      },
    },
    preview: {
      width: shape?.width ?? layer.bitmap?.width ?? 0,
      height: shape?.height ?? layer.bitmap?.height ?? 0,
      hasBitmapPreview: Boolean(layer.bitmap),
      hasSvgSource: Boolean(layer.metadata?.originalSvgSource || layer.vectorRecipe),
      signatureFields: ['layerId', 'shapeKind', 'bounds', 'style', 'pointCount', 'closed'],
      signature: buildVectorLayerPreviewSignature(layer, shape),
    },
  };
}

export function describeImageVectorShapeMetadata(
  layer: ImageLayer,
  options: { ellipseSegments?: number } = {},
): ImageVectorShapeMetadataDescriptor {
  const shape = getEditableVectorShape(layer);
  const bounds = {
    x: layer.x,
    y: layer.y,
    width: shape?.width ?? layer.bitmap?.width ?? 0,
    height: shape?.height ?? layer.bitmap?.height ?? 0,
  };
  const geometry = describeVectorShapeMetadataGeometry(shape, options.ellipseSegments);
  const unsupportedStates = describeVectorShapeUnsupportedStates(shape);
  const warningCodes = unsupportedStates.map((state) => state.code);
  const blockerCodes: ImageRasterVectorShapeReadinessBlocker[] = shape
    ? (shape.kind === 'ellipse' ? ['ellipse-boolean-requires-convert-to-path'] : [])
    : ['not-retained-vector-shape'];
  const vectorBooleanSource = layer.metadata?.vectorBooleanSource;
  const shapeLibrary = shape?.kind === 'path' && shape.preset
    ? 'signal-loom-custom-shape-library'
    : shape
      ? 'native-shape-primitives-or-path'
      : 'none';
  const nativeShapeSemantics = shape?.kind === 'path' && shape.preset
    ? 'materialized-straight-segment-path-only'
    : shape
      ? 'retained-shape-or-path'
      : 'none';

  return {
    layerId: layer.id,
    retained: Boolean(shape),
    shapeKind: shape?.kind ?? 'none',
    bounds,
    geometry,
    style: {
      fillColor: shape?.fillColor ?? 'none',
      fillOpacity: shape?.fillOpacity ?? 0,
      strokeColor: shape?.strokeColor ?? 'none',
      strokeOpacity: shape?.strokeOpacity ?? 0,
      strokeWidth: shape?.strokeWidth ?? 0,
      editableFields: shape
        ? ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth']
        : [],
    },
    source: {
      hasSvgSource: Boolean(layer.metadata?.originalSvgSource),
      hasVectorRecipe: Boolean(layer.vectorRecipe),
      hasBooleanSource: Boolean(vectorBooleanSource),
      booleanSourceOperation: vectorBooleanSource?.operation ?? 'none',
      booleanSourceSubset: vectorBooleanSource?.supportedSubset ?? 'none',
      shapeLibrary,
      nativeShapeSemantics,
    },
    handoffCaveats: shape
      ? {
          svg: [
            'svg-export-preserves-retained-rect-ellipse-path-metadata',
            'svg-export-does-not-preserve-live-boolean-stack',
            ...(shape.kind === 'path' && shape.preset
              ? ['svg-export-materializes-custom-shape-library-presets-to-path-segments']
              : []),
          ],
          psd: [
            'psd-export-carries-raster-preview-plus-vector-metadata',
            'native-psd-shape-layer-roundtrip-not-guaranteed',
            ...(shape.kind === 'path' && shape.preset
              ? ['native-psd-custom-shape-library-instances-not-preserved']
              : []),
          ],
          sourceBin: shape.kind === 'path' && shape.preset
            ? [
                'source-bin-handoff-preserves-sloom-vector-metadata-and-svg-preview',
                'source-bin-handoff-keeps-custom-preset-id-and-editable-style-metadata',
                'source-bin-handoff-does-not-create-native-psd-custom-shape-instances',
              ]
            : [
                'source-bin-handoff-preserves-sloom-vector-metadata-and-raster-preview',
              ],
        }
      : {
          svg: ['not-a-retained-vector-layer'],
          psd: ['not-a-retained-vector-layer'],
          sourceBin: ['not-a-retained-vector-layer'],
        },
    handoffSignatures: buildVectorShapeHandoffSignatures(
      layer,
      shape,
      geometry.localPointSignature,
      shapeLibrary,
      nativeShapeSemantics,
    ),
    unsupportedStates,
    warningCodes,
    blockerCodes,
    previewSignatureFields: ['layerId', 'shapeKind', 'bounds', 'style', 'geometry', 'unsupportedStates'],
    previewSignature: buildVectorShapeMetadataPreviewSignature(
      layer,
      shape,
      bounds,
      geometry.localPointSignature,
      shapeLibrary,
      nativeShapeSemantics,
      warningCodes,
      blockerCodes,
    ),
  };
}

export function describeImageRasterVectorShapeReadiness(
  layer: ImageLayer,
  options: { ellipseSegments?: number } = {},
): ImageRasterVectorShapeReadinessDescriptor {
  const editability = describeImageVectorLayerEditability(layer);
  const retainedShape = describeImageVectorShapeMetadata(layer, options);
  const shape = getEditableVectorShape(layer);
  const rasterizePlan = planImageVectorLayerRasterize(layer, 'manual');
  const booleanSupport = describeImageVectorBooleanSupport();
  const booleanMatrix = describeImageVectorBooleanSupportMatrix();
  const operations = booleanSupport.operations.map((operation) => operation.operation);
  const exactSubsets = booleanMatrix.exactSubsets;
  const unsupportedBlocker: ImageRasterVectorShapeReadinessBlocker[] = shape ? [] : ['not-retained-vector-shape'];
  const convertToPathBlockers: ImageRasterVectorShapeReadinessBlocker[] = shape
    ? (shape.kind === 'path' ? ['shape-already-editable-path'] : [])
    : ['not-retained-vector-shape'];
  const booleanBlockers: ImageRasterVectorShapeReadinessBlocker[] = shape
    ? (shape.kind === 'ellipse' ? ['ellipse-boolean-requires-convert-to-path'] : [])
    : ['not-retained-vector-shape'];
  const blockerCodes = uniqueReadinessBlockers([
    ...unsupportedBlocker,
    ...convertToPathBlockers,
    ...booleanBlockers,
  ]);
  const previewSignature = editability.preview.signature;

  return {
    layerId: layer.id,
    shapeKind: shape?.kind ?? 'none',
    vectorBacked: {
      supported: Boolean(shape),
      supportLevel: shape ? 'native-retained-vector' : 'not-vector',
      supportedKinds: ['rect', 'ellipse', 'path'],
    },
    retainedShape,
    fillStrokeControls: editability.retainedStyle,
    rasterize: {
      ready: Boolean(shape),
      destructive: true,
      warnings: rasterizePlan.warnings,
      blockerCodes: unsupportedBlocker,
      previewSignature: rasterizePlan.previewSignature,
    },
    convertToPath: {
      ready: Boolean(shape && shape.kind !== 'path'),
      outputKind: shape ? (shape.kind === 'path' ? 'already-path' : 'path') : 'none',
      approximation: describeConvertToPathApproximation(shape, options.ellipseSegments),
      blockerCodes: convertToPathBlockers,
      previewSignature: `convert-to-path|${previewSignature}|${describeConvertToPathApproximation(shape, options.ellipseSegments)}`,
    },
    booleanOperations: {
      ready: Boolean(shape && shape.kind !== 'ellipse'),
      operations,
      supportMatrixSignature: booleanMatrix.previewSignature,
      exactSubsets,
      unsupportedStates: booleanMatrix.unsupportedStates,
      limitations: [
        ...booleanSupport.limitations,
        'ellipse-inputs-must-convert-to-polygon-path-first',
        'ellipse-retains-fill-stroke-until-converted-to-polygon-path-operands',
        'live-boolean-operation-stack-not-retained',
        'boolean-results-flatten-source-stack-to-output-paths',
        'custom-shape-live-parametric-overlap-editing-not-supported',
      ],
      blockerCodes: booleanBlockers,
      previewSignature: `boolean-readiness|${previewSignature}|${exactSubsets.join(',') || 'none'}`,
    },
    handoffCaveats: retainedShape.handoffCaveats,
    customShapeCaveats: [
      'custom-shape-presets-are-stored-as-regeneratable-straight-segment-paths',
      'preset-geometry-regenerates-on-size-or-preset-change-unless-points-are-edited',
      'custom-shape-library-keeps-preset-kind-and-style-metadata-not-native-library-instance',
    ],
    warningCodes: retainedShape.warningCodes,
    warnings: retainedShape.unsupportedStates,
    previewSignatureFields: editability.preview.signatureFields,
    previewSignature,
    blockerCodes,
  };
}

export function planImageVectorLayerRasterize(
  layer: ImageLayer,
  reason: ImageVectorRasterizeReason,
): ImageVectorLayerRasterizePlan {
  const shape = getEditableVectorShape(layer);
  return {
    layerId: layer.id,
    reason,
    willDiscardRetainedFillStrokeEditability: Boolean(shape),
    willDiscardPathPointEditability: shape?.kind === 'path',
    warnings: shape
      ? [
          'rasterize-converts-retained-vector-style-to-pixels',
          ...(shape.kind === 'path' ? ['rasterize-removes-path-point-editing'] : []),
          'keep-duplicate-vector-layer-for-svg-psd-handoff',
        ]
      : ['layer-is-not-retained-vector-shape'],
    previewSignature: `rasterize|${layer.id}|${shape?.kind ?? 'none'}|${shape?.width ?? 0}x${shape?.height ?? 0}|${reason}`,
  };
}

export function getVectorPathDocumentPoints(layer: ImageLayer): ImageVectorPathPoint[] {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind !== 'path') return [];
  return shape.points.map((point) => translateVectorPathPoint(point, layer.x, layer.y));
}

export function updateVectorPathLayerPoint(
  layer: ImageLayer,
  pointIndex: number,
  point: ImageVectorPathPoint,
): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind !== 'path') return layer;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= shape.points.length) return layer;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return layer;

  const points = getVectorPathDocumentPoints(layer);
  const currentPoint = points[pointIndex];
  if (!currentPoint) return layer;
  const nextPoint = {
    ...currentPoint,
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
  const delta = {
    x: nextPoint.x - currentPoint.x,
    y: nextPoint.y - currentPoint.y,
  };
  if (currentPoint.inHandle) {
    nextPoint.inHandle = {
      x: Math.round(currentPoint.inHandle.x + delta.x),
      y: Math.round(currentPoint.inHandle.y + delta.y),
    };
  }
  if (currentPoint.outHandle) {
    nextPoint.outHandle = {
      x: Math.round(currentPoint.outHandle.x + delta.x),
      y: Math.round(currentPoint.outHandle.y + delta.y),
    };
  }
  points[pointIndex] = {
    ...nextPoint,
  };

  return buildVectorPathLayer({
    doc: null,
    points,
    closed: shape.closed,
    settings: shape,
    existingLayer: layer,
  });
}

export type ImageVectorPathHandleKind = 'inHandle' | 'outHandle';

export function updateVectorPathLayerHandle(
  layer: ImageLayer,
  pointIndex: number,
  handleKind: ImageVectorPathHandleKind,
  point: ImageVectorPathPoint,
): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind !== 'path') return layer;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= shape.points.length) return layer;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return layer;

  const points = getVectorPathDocumentPoints(layer);
  const currentPoint = points[pointIndex];
  if (!currentPoint) return layer;
  points[pointIndex] = {
    ...currentPoint,
    [handleKind]: {
      x: Math.round(point.x),
      y: Math.round(point.y),
    },
  };

  return buildVectorPathLayer({
    doc: null,
    points,
    closed: shape.closed,
    settings: shape,
    existingLayer: layer,
  });
}

export function buildVectorShapeLayerFromDrag(params: {
  doc: ImageDocument;
  kind: RectEllipseVectorShapeKind;
  from: VectorShapePoint;
  to: VectorShapePoint;
  settings: ShapeToolSettings;
  existingLayer?: ImageLayer | null;
}): ImageLayer {
  const bounds = normalizeDragBounds(params.from, params.to);
  const shape = normalizeVectorShape({
    kind: params.kind,
    width: bounds.width,
    height: bounds.height,
    ...params.settings,
  });
  return buildVectorShapeLayer({
    doc: params.doc,
    x: bounds.x,
    y: bounds.y,
    shape,
    existingLayer: params.existingLayer ?? null,
  });
}

export function buildVectorPathLayer(params: {
  doc: ImageDocument | null;
  points: ImageVectorPathPoint[];
  closed: boolean;
  settings: VectorShapeStyle & {
    preset?: CustomVectorShapePreset;
    liveBoolean?: NonNullable<ImagePathVectorShape['liveBoolean']>;
  };
  preset?: CustomVectorShapePreset;
  existingLayer?: ImageLayer | null;
}): ImageLayer {
  const geometry = normalizeVectorPathGeometry(params.points);
  const settingsWithPreset = params.settings as VectorShapeStyle & {
    preset?: CustomVectorShapePreset;
    liveBoolean?: NonNullable<ImagePathVectorShape['liveBoolean']>;
  };
  const preset = params.preset ?? settingsWithPreset.preset;
  const shape = normalizeVectorShape({
    ...settingsWithPreset,
    kind: 'path',
    width: geometry.width,
    height: geometry.height,
    points: geometry.points,
    closed: params.closed,
    ...(preset ? { preset } : {}),
    ...(settingsWithPreset.liveBoolean ? { liveBoolean: settingsWithPreset.liveBoolean } : {}),
  });
  return buildVectorShapeLayer({
    doc: params.doc,
    x: geometry.x,
    y: geometry.y,
    shape,
    existingLayer: params.existingLayer ?? null,
  });
}

export function buildCustomVectorShapeLayerFromDrag(params: {
  doc: ImageDocument;
  presetKind: CustomVectorShapePresetKind;
  from: VectorShapePoint;
  to: VectorShapePoint;
  settings: ShapeToolSettings;
  existingLayer?: ImageLayer | null;
}): ImageLayer {
  const preset = buildCustomVectorShapePreset(params.presetKind, params.settings);
  const points = buildCustomVectorShapeDocumentPointsFromDrag(preset, params.from, params.to);
  return buildVectorPathLayer({
    doc: params.doc,
    points,
    closed: preset.kind !== 'line',
    settings: params.settings,
    preset,
    existingLayer: params.existingLayer ?? null,
  });
}

export function updateEditableVectorShapeLayer(
  layer: ImageLayer,
  patch: Partial<ImageVectorShape>,
  positionPatch?: Partial<Pick<ImageLayer, 'x' | 'y'>>,
): ImageLayer {
  const current = getEditableVectorShape(layer);
  if (!current) return layer;
  const nextX = positionPatch?.x ?? layer.x;
  const nextY = positionPatch?.y ?? layer.y;
  const shouldRegeneratePresetGeometry = current.kind === 'path'
    && Boolean(current.preset)
    && !Object.prototype.hasOwnProperty.call(patch, 'points')
    && (
      Object.prototype.hasOwnProperty.call(patch, 'preset')
      || Object.prototype.hasOwnProperty.call(patch, 'width')
      || Object.prototype.hasOwnProperty.call(patch, 'height')
    );
  if (shouldRegeneratePresetGeometry) {
    const nextShape = mergeVectorShapePatch(current, patch);
    if (nextShape.kind === 'path' && nextShape.preset) {
      const points = buildCustomVectorShapeDocumentPointsFromBounds(nextShape.preset, {
        x: nextX,
        y: nextY,
        width: nextShape.width,
        height: nextShape.height,
      });
      return buildVectorPathLayer({
        doc: null,
        points,
        closed: nextShape.preset.kind !== 'line',
        settings: nextShape,
        preset: nextShape.preset,
        existingLayer: layer,
      });
    }
  }
  const shape = normalizeVectorShape(mergeVectorShapePatch(current, patch));
  return buildVectorShapeLayer({
    doc: null,
    x: nextX,
    y: nextY,
    shape,
    existingLayer: layer,
  });
}

function mergeVectorShapePatch(current: ImageVectorShape, patch: Partial<ImageVectorShape>): ImageVectorShape {
  if (current.kind === 'path') {
    const pathPatch = patch as Partial<ImagePathVectorShape>;
    return {
      ...current,
      ...pathPatch,
      kind: 'path',
      points: 'points' in pathPatch && pathPatch.points ? pathPatch.points : current.points,
      closed: 'closed' in pathPatch && typeof pathPatch.closed === 'boolean' ? pathPatch.closed : current.closed,
      preset: Object.prototype.hasOwnProperty.call(pathPatch, 'preset')
        ? pathPatch.preset
        : current.preset,
    };
  }
  if (current.kind === 'ellipse') {
    return {
      ...current,
      ...patch,
      kind: 'ellipse',
    };
  }
  return {
    ...current,
    ...patch,
    kind: 'rect',
  };
}

export function materializeEditableVectorShapeLayer(layer: ImageLayer): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape) return layer;
  return buildVectorShapeLayer({
    doc: null,
    x: layer.x,
    y: layer.y,
    shape,
    existingLayer: layer,
  });
}

export function convertEditableVectorShapeLayerToPath(
  layer: ImageLayer,
  options: { ellipseSegments?: number } = {},
): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind === 'path') return layer;
  const points = shape.kind === 'ellipse'
    ? buildEllipsePathDocumentPoints(layer, shape, options.ellipseSegments)
    : buildRectPathDocumentPoints(layer, shape);
  return buildVectorPathLayer({
    doc: null,
    points,
    closed: true,
    settings: shape,
    existingLayer: layer,
  });
}

export function rasterizeEditableVectorShapeLayer(layer: ImageLayer): ImageLayer {
  const materialized = materializeEditableVectorShapeLayer(layer);
  const bitmap = materialized.bitmap ?? renderVectorShapeToBitmap(getEditableVectorShape(materialized) ?? fallbackShape());
  const nextMetadata = omitVectorShapeMetadata(materialized.metadata);
  const { vectorRecipe: _vectorRecipe, ...rest } = materialized;
  return {
    ...rest,
    type: 'image',
    name: materialized.name,
    bitmap,
    bitmapVersion: materialized.bitmapVersion + 1,
    metadata: nextMetadata,
  };
}

export function materializeImageVectorBooleanLayers(
  operation: ImageVectorBooleanOperation,
  a: ImageLayer,
  b: ImageLayer,
): ImageVectorLayerBooleanMaterialization {
  const sourceLayerIds: [string, string] = [a.id, b.id];
  const descriptorA = vectorLayerToBooleanPathDescriptor(a);
  const descriptorB = vectorLayerToBooleanPathDescriptor(b);

  if ('warning' in descriptorA) {
    return unsupportedLayerBooleanMaterialization(operation, sourceLayerIds, descriptorA.warning);
  }
  if ('warning' in descriptorB) {
    return unsupportedLayerBooleanMaterialization(operation, sourceLayerIds, descriptorB.warning);
  }

  const plan = planImageVectorBooleanOperation(operation, descriptorA.descriptor, descriptorB.descriptor);
  const style = getEditableVectorShape(a) ?? fallbackShape();
  // 'approximate' results (degeneracy-perturbed overlapping-polygon clips) are
  // still real materialized paths — only truly unsupported inputs produce nothing.
  const outputLayers = plan.status !== 'unsupported'
    ? plan.descriptors.map((descriptor, index) => {
        const layer = buildVectorPathLayer({
          doc: null,
          points: descriptor.points,
          closed: descriptor.closed,
          settings: style,
        });
        const suffix = plan.descriptors.length > 1 ? ` ${index + 1}` : '';
        return {
          ...layer,
          name: `${a.name} ${formatBooleanOperationLabel(operation)} ${b.name}${suffix}`,
          metadata: {
            ...layer.metadata,
            vectorBooleanSource: {
              operation,
              sourceLayerIds,
              supportedSubset: plan.supportedSubset,
              previewSignature: plan.previewSignature,
            },
          },
        };
      })
    : [];

  return {
    operation,
    status: plan.status,
    supportedSubset: plan.supportedSubset,
    sourceLayerIds,
    inputASignature: plan.inputASignature,
    inputBSignature: plan.inputBSignature,
    previewSignature: plan.previewSignature,
    outputLayers,
    warnings: plan.warnings,
    handoffLimitations: plan.handoffLimitations,
    handoff: buildVectorBooleanHandoffDescriptor(plan.status),
  };
}

/**
 * Produces Boolean output layers while retaining the source paths. Each output
 * keeps the operation and ordinal so it can be regenerated after a source edit.
 */
export function createLiveImageVectorBooleanLayers(
  operation: ImageVectorBooleanOperation,
  a: ImageLayer,
  b: ImageLayer,
): ImageVectorLayerBooleanMaterialization {
  const materialization = materializeImageVectorBooleanLayers(operation, a, b);
  if (materialization.status === 'unsupported') return materialization;
  return {
    ...materialization,
    outputLayers: materialization.outputLayers.map((layer, outputIndex) => {
      const shape = getEditableVectorShape(layer);
      if (!shape || shape.kind !== 'path') return layer;
      return buildVectorPathLayer({
        doc: null,
        points: getVectorPathDocumentPoints(layer),
        closed: shape.closed,
        settings: {
          ...shape,
          liveBoolean: {
            version: 1,
            operation,
            sourceLayerIds: materialization.sourceLayerIds,
            outputIndex,
          },
        },
        existingLayer: layer,
      });
    }),
  };
}

/**
 * Resolves retained live Boolean outputs from the current operand geometry.
 * Invalid or empty derived results are hidden rather than showing stale pixels.
 */
export function refreshLiveImageVectorBooleanLayers(layers: readonly ImageLayer[]): ImageLayer[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  return layers.map((layer) => {
    const shape = getEditableVectorShape(layer);
    const live = shape?.kind === 'path' ? shape.liveBoolean : undefined;
    if (!live) return layer;
    const [firstId, secondId] = live.sourceLayerIds;
    const first = byId.get(firstId);
    const second = byId.get(secondId);
    if (!first || !second || first.id === layer.id || second.id === layer.id) return { ...layer, visible: false };
    const materialization = materializeImageVectorBooleanLayers(live.operation, first, second);
    const replacement = materialization.outputLayers[live.outputIndex];
    const replacementShape = replacement ? getEditableVectorShape(replacement) : null;
    if (!replacement || !replacementShape || replacementShape.kind !== 'path') return { ...layer, visible: false };
    return buildVectorPathLayer({
      doc: null,
      points: getVectorPathDocumentPoints(replacement),
      closed: replacementShape.closed,
      settings: {
        ...replacementShape,
        liveBoolean: live,
      },
      existingLayer: {
        ...layer,
        name: replacement.name,
        metadata: {
          ...replacement.metadata,
          ...layer.metadata,
          vectorBooleanSource: replacement.metadata?.vectorBooleanSource,
        },
      },
    });
  });
}

function vectorLayerToBooleanPathDescriptor(
  layer: ImageLayer,
): { descriptor: ImageVectorBooleanPathDescriptor } | { warning: ImageVectorLayerBooleanWarning } {
  const shape = getEditableVectorShape(layer);
  if (!shape) {
    return {
      warning: {
        code: 'not-retained-vector-shape',
        layerId: layer.id,
        message: 'Boolean operations require retained vector shape metadata.',
      },
    };
  }

  if (shape.kind === 'rect') {
    return {
      descriptor: {
        closed: true,
        fillRule: 'evenodd',
        points: [
          { x: layer.x, y: layer.y },
          { x: layer.x + shape.width, y: layer.y },
          { x: layer.x + shape.width, y: layer.y + shape.height },
          { x: layer.x, y: layer.y + shape.height },
        ],
      },
    };
  }

  if (shape.kind === 'path') {
    if (shape.points.some((point) => point.inHandle || point.outHandle)) {
      return {
        warning: {
          code: 'bezier-segments-not-supported',
          layerId: layer.id,
          message: 'Curved Bezier operands must be converted to straight paths or rasterized before Boolean operations.',
        },
      };
    }
    return {
      descriptor: {
        closed: shape.closed,
        fillRule: 'evenodd',
        points: shape.points.map((point) => ({
          x: layer.x + point.x,
          y: layer.y + point.y,
        })),
      },
    };
  }

  return {
    warning: {
      code: 'unsupported-vector-shape-kind',
      layerId: layer.id,
      message: 'Ellipse vector booleans are not materialized yet; convert to a polygon/path first.',
    },
  };
}

function buildRectPathDocumentPoints(
  layer: ImageLayer,
  shape: Extract<ImageVectorShape, { kind: 'rect' }>,
): ImageVectorPathPoint[] {
  return [
    { x: layer.x, y: layer.y },
    { x: layer.x + shape.width, y: layer.y },
    { x: layer.x + shape.width, y: layer.y + shape.height },
    { x: layer.x, y: layer.y + shape.height },
  ];
}

function buildEllipsePathDocumentPoints(
  layer: ImageLayer,
  shape: Extract<ImageVectorShape, { kind: 'ellipse' }>,
  segmentCount = 32,
): ImageVectorPathPoint[] {
  const segments = clampEllipsePathSegments(segmentCount);
  const centerX = layer.x + shape.width / 2;
  const centerY = layer.y + shape.height / 2;
  const radiusX = shape.width / 2;
  const radiusY = shape.height / 2;
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index * Math.PI * 2) / segments;
    return {
      x: roundVectorPoint(centerX + radiusX * Math.cos(angle)),
      y: roundVectorPoint(centerY + radiusY * Math.sin(angle)),
    };
  });
}

function clampEllipsePathSegments(value: number | undefined): number {
  if (!Number.isFinite(value)) return 32;
  const rounded = Math.round(value ?? 32);
  return Math.max(8, Math.min(128, rounded));
}

function roundVectorPoint(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unsupportedLayerBooleanMaterialization(
  operation: ImageVectorBooleanOperation,
  sourceLayerIds: [string, string],
  warning: ImageVectorLayerBooleanWarning,
): ImageVectorLayerBooleanMaterialization {
  return {
    operation,
    status: 'unsupported',
    supportedSubset: 'none',
    sourceLayerIds,
    inputASignature: `layer:${sourceLayerIds[0]}`,
    inputBSignature: `layer:${sourceLayerIds[1]}`,
    previewSignature: `${operation}|layer:${sourceLayerIds[0]}|layer:${sourceLayerIds[1]}|none`,
    outputLayers: [],
    warnings: [warning],
    handoffLimitations: [
      'keep-source-paths-for-svg-psd-handoff',
      'boolean-result-not-materialized-for-unsupported-inputs',
    ],
    handoff: buildVectorBooleanHandoffDescriptor('unsupported'),
  };
}

function buildVectorBooleanHandoffDescriptor(
  status: ImageVectorBooleanResult['status'],
): ImageVectorLayerBooleanMaterialization['handoff'] {
  const supportedExactMaterialization = status === 'exact';
  return {
    exportReadiness: supportedExactMaterialization ? 'exact-materialized-paths' : 'unsupported-not-materialized',
    supportedExactMaterialization,
    outputShapeKind: supportedExactMaterialization ? 'path' : 'none',
    retainsLiveBooleanStack: false,
    retainsSourcePresetMetadata: false,
    caveats: supportedExactMaterialization
      ? [
          'exact-boolean-output-is-safe-for-rasterize-vector-export-handoff',
          'boolean-result-is-flattened-to-output-path-descriptors',
          'live-boolean-stack-not-retained',
          'source-preset-library-membership-not-retained-on-boolean-output',
        ]
      : [
          'keep-source-paths-for-svg-psd-handoff',
          'boolean-result-not-materialized-for-unsupported-inputs',
          'live-boolean-stack-not-retained',
        ],
  };
}

function formatBooleanOperationLabel(operation: ImageVectorBooleanOperation): string {
  switch (operation) {
    case 'union':
      return 'Union';
    case 'intersect':
      return 'Intersect';
    case 'subtract':
      return 'Subtract';
    case 'xor':
      return 'Xor';
  }
}

function buildVectorShapeLayer(params: {
  doc: ImageDocument | null;
  x: number;
  y: number;
  shape: ImageVectorShape;
  existingLayer?: ImageLayer | null;
}): ImageLayer {
  const bitmap = renderVectorShapeToBitmap(params.shape);
  const svgSource = buildVectorShapeSvg(params.shape);
  const existing = params.existingLayer;
  const metadata = {
    ...existing?.metadata,
    vectorShape: params.shape,
    originalSvgSource: svgSource,
  };

  return {
    id: existing?.id ?? `layer-vector-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: existing?.name ?? defaultVectorShapeLayerName(params.doc, params.shape),
    type: 'vector',
    visible: existing?.visible ?? true,
    locked: existing?.locked ?? false,
    locks: existing?.locks,
    opacity: existing?.opacity ?? 1,
    blendMode: existing?.blendMode ?? 'normal',
    x: Math.round(params.x),
    y: Math.round(params.y),
    rotationDeg: existing?.rotationDeg,
    skewXDeg: existing?.skewXDeg,
    skewYDeg: existing?.skewYDeg,
    perspectiveX: existing?.perspectiveX,
    perspectiveY: existing?.perspectiveY,
    warp: existing?.warp,
    cornerOffsets: existing?.cornerOffsets,
    transformOriginX: existing?.transformOriginX,
    transformOriginY: existing?.transformOriginY,
    bitmap,
    bitmapVersion: (existing?.bitmapVersion ?? 0) + (existing ? 1 : 0),
    mask: existing?.mask ?? null,
    maskDensity: existing?.maskDensity,
    maskFeather: existing?.maskFeather,
    effects: existing?.effects,
    filters: existing?.filters,
    colorLabel: existing?.colorLabel,
    clippingMask: existing?.clippingMask,
    groupId: existing?.groupId,
    linkGroupId: existing?.linkGroupId,
    metadata,
    vectorRecipe: svgSource,
  };
}

function defaultVectorShapeLayerName(doc: ImageDocument | null, shape: ImageVectorShape): string {
  const base = shape.kind === 'ellipse'
    ? 'Ellipse'
    : shape.kind === 'path'
      ? (shape.preset ? formatCustomPresetLabel(shape.preset.kind) : 'Path')
      : 'Rectangle';
  const count = doc?.layers.filter((layer) => layer.type === 'vector').length ?? 0;
  return `${base} ${count + 1}`;
}

function normalizeDragBounds(from: VectorShapePoint, to: VectorShapePoint) {
  const x0 = Math.floor(Math.min(from.x, to.x));
  const y0 = Math.floor(Math.min(from.y, to.y));
  const x1 = Math.ceil(Math.max(from.x, to.x));
  const y1 = Math.ceil(Math.max(from.y, to.y));
  return {
    x: x0,
    y: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
}

function normalizeGeometryBounds(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    x: Math.floor(Number.isFinite(bounds.x) ? bounds.x : 0),
    y: Math.floor(Number.isFinite(bounds.y) ? bounds.y : 0),
    width: clampPositiveInteger(bounds.width, 1),
    height: clampPositiveInteger(bounds.height, 1),
  };
}

function renderVectorShapeToBitmap(shape: ImageVectorShape) {
  const bitmap = createBitmap(shape.width, shape.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire vector shape render context');

  ctx.clearRect(0, 0, shape.width, shape.height);

  if (shape.kind === 'path') {
    ctx.beginPath();
    if (shape.points.length > 0) {
      const [firstPoint, ...rest] = shape.points;
      ctx.moveTo(firstPoint!.x, firstPoint!.y);
      rest.forEach((point, index) => {
        const previous = shape.points[index]!;
        drawVectorPathSegment(ctx, previous, point);
      });
      if (shape.closed && shape.points.length > 1) {
        drawVectorPathSegment(ctx, shape.points[shape.points.length - 1]!, firstPoint!);
      }
      if (shape.closed) ctx.closePath();
    }
    if (shape.closed && shape.fillOpacity > 0) {
      ctx.fillStyle = shape.fillColor;
      ctx.globalAlpha = shape.fillOpacity;
      ctx.fill();
    }
    if (shape.strokeWidth > 0) {
      ctx.strokeStyle = shape.strokeColor;
      ctx.lineWidth = shape.strokeWidth;
      ctx.globalAlpha = shape.strokeOpacity;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return bitmap;
  }

  const inset = clampStrokeInset(shape.strokeWidth, shape.width, shape.height);
  const contentWidth = Math.max(0, shape.width - inset * 2);
  const contentHeight = Math.max(0, shape.height - inset * 2);

  ctx.beginPath();
  if (shape.kind === 'ellipse') {
    ctx.ellipse(
      shape.width / 2,
      shape.height / 2,
      Math.max(0, contentWidth / 2),
      Math.max(0, contentHeight / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.rect(inset, inset, contentWidth, contentHeight);
  }

  ctx.fillStyle = shape.fillColor;
  ctx.globalAlpha = shape.fillOpacity;
  ctx.fill();

  if (shape.strokeWidth > 0) {
    ctx.strokeStyle = shape.strokeColor;
    ctx.lineWidth = shape.strokeWidth;
    ctx.globalAlpha = shape.strokeOpacity;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return bitmap;
}

function buildVectorShapeSvg(shape: ImageVectorShape): string {
  if (shape.kind === 'path') {
    const pathData = buildSvgPathData(shape.points, shape.closed);
    const fill = shape.closed ? shape.fillColor : 'none';
    const fillOpacity = shape.closed ? formatNumber(shape.fillOpacity) : '0';
    const stroke = shape.strokeWidth > 0 ? shape.strokeColor : 'none';
    const strokeWidth = shape.strokeWidth > 0 ? shape.strokeWidth : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${shape.width}" height="${shape.height}" viewBox="0 0 ${shape.width} ${shape.height}"><path d="${pathData}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-opacity="${formatNumber(shape.strokeOpacity)}" stroke-width="${formatNumber(strokeWidth)}" /></svg>`;
  }

  const inset = clampStrokeInset(shape.strokeWidth, shape.width, shape.height);
  const contentWidth = Math.max(0, shape.width - inset * 2);
  const contentHeight = Math.max(0, shape.height - inset * 2);
  const fill = shape.fillColor;
  const stroke = shape.strokeWidth > 0 ? shape.strokeColor : 'none';
  const strokeWidth = shape.strokeWidth > 0 ? shape.strokeWidth : 0;
  const shapeMarkup = shape.kind === 'ellipse'
    ? `<ellipse cx="${formatNumber(shape.width / 2)}" cy="${formatNumber(shape.height / 2)}" rx="${formatNumber(contentWidth / 2)}" ry="${formatNumber(contentHeight / 2)}" fill="${fill}" fill-opacity="${formatNumber(shape.fillOpacity)}" stroke="${stroke}" stroke-opacity="${formatNumber(shape.strokeOpacity)}" stroke-width="${formatNumber(strokeWidth)}" />`
    : `<rect x="${formatNumber(inset)}" y="${formatNumber(inset)}" width="${formatNumber(contentWidth)}" height="${formatNumber(contentHeight)}" fill="${fill}" fill-opacity="${formatNumber(shape.fillOpacity)}" stroke="${stroke}" stroke-opacity="${formatNumber(shape.strokeOpacity)}" stroke-width="${formatNumber(strokeWidth)}" />`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${shape.width}" height="${shape.height}" viewBox="0 0 ${shape.width} ${shape.height}">${shapeMarkup}</svg>`;
}

function omitVectorShapeMetadata(metadata: ImageLayer['metadata'] | undefined) {
  if (!metadata) return undefined;
  const {
    originalSvgSource: _originalSvgSource,
    vectorBooleanSource: _vectorBooleanSource,
    vectorShape: _vectorShape,
    ...rest
  } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function normalizeVectorShape(shape: ImageVectorShape): ImageVectorShape {
  if (shape.kind === 'path') {
    const geometry = normalizeVectorPathGeometry(shape.points);
    return {
      kind: 'path',
      width: clampPositiveInteger(shape.width || geometry.width, 1),
      height: clampPositiveInteger(shape.height || geometry.height, 1),
      points: geometry.points,
      closed: Boolean(shape.closed),
      fillColor: normalizeColor(shape.fillColor, '#ffffff'),
      fillOpacity: clampUnit(shape.fillOpacity, 1),
      strokeColor: normalizeColor(shape.strokeColor, '#000000'),
      strokeOpacity: clampUnit(shape.strokeOpacity, 1),
      strokeWidth: clampStrokeWidth(shape.strokeWidth),
      preset: normalizeCustomVectorShapePreset(shape.preset),
      ...(normalizeLiveBoolean(shape.liveBoolean) ? { liveBoolean: normalizeLiveBoolean(shape.liveBoolean) } : {}),
    };
  }
  return {
    kind: shape.kind,
    width: clampPositiveInteger(shape.width, 1),
    height: clampPositiveInteger(shape.height, 1),
    fillColor: normalizeColor(shape.fillColor, '#ffffff'),
    fillOpacity: clampUnit(shape.fillOpacity, 1),
    strokeColor: normalizeColor(shape.strokeColor, '#000000'),
    strokeOpacity: clampUnit(shape.strokeOpacity, 1),
    strokeWidth: clampStrokeWidth(shape.strokeWidth),
  };
}

function normalizeLiveBoolean(
  value: ImagePathVectorShape['liveBoolean'] | undefined,
): ImagePathVectorShape['liveBoolean'] | undefined {
  if (!value || value.version !== 1) return undefined;
  if (!['union', 'intersect', 'subtract', 'xor'].includes(value.operation)) return undefined;
  const [firstId, secondId] = value.sourceLayerIds;
  if (!firstId || !secondId || firstId === secondId || !Number.isInteger(value.outputIndex) || value.outputIndex < 0) return undefined;
  return {
    version: 1,
    operation: value.operation,
    sourceLayerIds: [firstId, secondId],
    outputIndex: value.outputIndex,
  };
}

function clampStrokeInset(strokeWidth: number, width: number, height: number): number {
  return Math.min(width, height) <= 1 ? 0 : Math.max(0, Math.min(strokeWidth / 2, Math.min(width, height) / 2));
}

function clampStrokeWidth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(256, Math.round(value * 100) / 100));
}

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

function clampUnit(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const short = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  }
  return fallback;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatSignatureNumber(value: number): string {
  if (!Number.isFinite(value)) return 'NaN';
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function describeVectorShapeMetadataGeometry(
  shape: ImageVectorShape | null,
  ellipseSegments: number | undefined,
): ImageVectorShapeMetadataDescriptor['geometry'] {
  if (!shape) {
    return {
      kind: 'none',
      pointCount: 0,
      closed: false,
      supportsBezierHandles: false,
      presetKind: 'none',
      preset: describeCustomVectorShapePresetMetadata(undefined),
      localPoints: [],
      localPointSignature: 'none',
      convertToPathApproximation: 'none',
    };
  }

  if (shape.kind === 'path') {
    return {
      kind: 'path',
      pointCount: shape.points.length,
      closed: shape.closed,
      supportsBezierHandles: pathHasBezierHandles(shape.points),
      presetKind: shape.preset?.kind ?? 'none',
      preset: describeCustomVectorShapePresetMetadata(shape.preset),
      localPoints: shape.points.map((point) => ({ ...point })),
      localPointSignature: buildShapeLocalPointSignature(shape),
      convertToPathApproximation: 'none',
    };
  }

  return {
    kind: shape.kind,
    pointCount: 0,
    closed: true,
    supportsBezierHandles: false,
    presetKind: 'none',
    preset: describeCustomVectorShapePresetMetadata(undefined),
    localPoints: [],
    localPointSignature: buildShapeLocalPointSignature(shape),
    convertToPathApproximation: describeConvertToPathApproximation(shape, ellipseSegments),
  };
}

function describeVectorShapeUnsupportedStates(shape: ImageVectorShape | null): ImageVectorShapeUnsupportedState[] {
  if (!shape) return [];

  const states: ImageVectorShapeUnsupportedState[] = [];
  if (shape.kind === 'ellipse') {
    states.push({
      code: 'ellipse-direct-boolean-blocked',
      severity: 'blocker',
      message: 'Ellipse booleans require deterministic conversion to a polygon path before materialization.',
      fallback: 'convert-ellipse-to-editable-path',
    });
  }
  if (shape.kind === 'path' && !pathHasBezierHandles(shape.points)) {
    states.push({
      code: 'bezier-handles-not-retained',
      severity: 'warning',
      message: 'Path metadata retains straight local points only; Bezier handles are not editable yet.',
      fallback: 'store-straight-segment-path-or-rasterize-copy',
    });
  }

  states.push({
    code: 'live-boolean-stack-not-retained',
    severity: 'warning',
    message: 'Vector boolean outputs are materialized paths and do not retain a live operation stack.',
    fallback: 'keep-source-layers-for-later-rebuild',
  });

  if (shape.kind === 'path') {
    states.push({
      code: 'overlapping-path-boolean-not-materialized',
      severity: 'blocker',
      message: 'Overlapping non-identical path booleans are reported as unsupported instead of inventing geometry.',
      fallback: 'rasterize-duplicate-or-simplify-to-supported-subset',
    });
  }

  states.push({
    code: 'psd-native-shape-roundtrip-limited',
    severity: 'warning',
    message: 'PSD handoff preserves a raster preview plus vector metadata, not guaranteed native PSD shape layers.',
    fallback: 'keep-svg-or-sloom-source-for-editable-vector-handoff',
  });

  return states;
}

function buildShapeLocalPointSignature(shape: ImageVectorShape): string {
  if (shape.kind === 'rect') {
    return `rect:${formatSignatureNumber(shape.width)}x${formatSignatureNumber(shape.height)}`;
  }
  if (shape.kind === 'ellipse') {
    return `ellipse:${formatSignatureNumber(shape.width)}x${formatSignatureNumber(shape.height)}`;
  }

  const pathState = shape.closed ? 'closed' : 'open';
  const points = shape.points
    .map((point) => {
      const handles = [
        point.inHandle ? `i:${formatSignatureNumber(point.inHandle.x)},${formatSignatureNumber(point.inHandle.y)}` : '',
        point.outHandle ? `o:${formatSignatureNumber(point.outHandle.x)},${formatSignatureNumber(point.outHandle.y)}` : '',
      ].filter(Boolean).join(',');
      return `${formatSignatureNumber(point.x)},${formatSignatureNumber(point.y)}${handles ? `(${handles})` : ''}`;
    })
    .join(';');
  return `path:${pathState}:${shape.points.length}:${points}`;
}

function buildVectorShapeMetadataPreviewSignature(
  layer: ImageLayer,
  shape: ImageVectorShape | null,
  bounds: ImageVectorShapeMetadataDescriptor['bounds'],
  localPointSignature: string,
  shapeLibrary: ImageVectorShapeMetadataDescriptor['source']['shapeLibrary'],
  nativeShapeSemantics: ImageVectorShapeMetadataDescriptor['source']['nativeShapeSemantics'],
  warningCodes: ImageRasterVectorShapeReadinessWarning[],
  blockerCodes: ImageRasterVectorShapeReadinessBlocker[],
): string {
  const signatureCodes = warningCodes.length > 0 ? warningCodes : blockerCodes;
  const sourceSemantics = shapeLibrary === 'signal-loom-custom-shape-library'
    ? [shapeLibrary, nativeShapeSemantics]
    : [];
  const presetSignature = shape?.kind === 'path' ? buildCustomVectorShapePresetSignature(shape.preset) : 'none';
  const presetSemantics = presetSignature === 'none' || presetSignature === 'triangle' || presetSignature === 'diamond' || presetSignature === 'line'
    ? []
    : [presetSignature];
  return [
    'shape-meta',
    layer.id,
    shape?.kind ?? 'none',
    [
      formatSignatureNumber(bounds.x),
      formatSignatureNumber(bounds.y),
      formatSignatureNumber(bounds.width),
      formatSignatureNumber(bounds.height),
    ].join(','),
    shape ? `${shape.fillColor}:${formatSignatureNumber(shape.fillOpacity)}` : 'none',
    shape ? `${shape.strokeColor}:${formatSignatureNumber(shape.strokeOpacity)}:${formatSignatureNumber(shape.strokeWidth)}` : 'none',
    localPointSignature,
    ...sourceSemantics,
    ...presetSemantics,
    signatureCodes.join(',') || 'none',
  ].join('|');
}

function buildVectorShapeHandoffSignatures(
  layer: ImageLayer,
  shape: ImageVectorShape | null,
  localPointSignature: string,
  shapeLibrary: ImageVectorShapeMetadataDescriptor['source']['shapeLibrary'],
  nativeShapeSemantics: ImageVectorShapeMetadataDescriptor['source']['nativeShapeSemantics'],
): ImageVectorShapeMetadataDescriptor['handoffSignatures'] {
  if (!shape) {
    return {
      svg: `svg|${layer.id}|none|none|unsupported`,
      psd: `psd|${layer.id}|none|unsupported`,
      sourceBin: `source-bin|${layer.id}|none|unsupported`,
    };
  }
  return {
    svg: [
      'svg',
      layer.id,
      shape.kind,
      localPointSignature,
      `${shape.fillColor}:${formatSignatureNumber(shape.fillOpacity)}`,
      `${shape.strokeColor}:${formatSignatureNumber(shape.strokeOpacity)}:${formatSignatureNumber(shape.strokeWidth)}`,
      shapeLibrary,
    ].join('|'),
    psd: [
      'psd',
      layer.id,
      shape.kind,
      localPointSignature,
      'raster-preview-plus-vector-metadata',
      nativeShapeSemantics,
    ].join('|'),
    sourceBin: [
      'source-bin',
      layer.id,
      shape.kind,
      localPointSignature,
      'sloom-vector-metadata',
      shapeLibrary,
    ].join('|'),
  };
}

function describeCustomVectorShapePresetMetadata(
  preset: CustomVectorShapePreset | undefined,
): ImageCustomVectorShapePresetDescriptor {
  if (!preset) {
    return {
      kind: 'none',
      source: 'none',
      retained: false,
      editableParameters: [],
      regeneration: 'none',
      nativeLibraryInstance: false,
    };
  }
  return {
    kind: preset.kind,
    ...(typeof preset.polygonSides === 'number' ? { polygonSides: preset.polygonSides } : {}),
    ...(typeof preset.starInnerRadius === 'number' ? { starInnerRadius: preset.starInnerRadius } : {}),
    source: 'shape-tool-preset',
    retained: true,
    editableParameters: describeCustomVectorShapePresetEditableParameters(preset),
    regeneration: 'regenerates-from-preset-until-points-are-edited',
    nativeLibraryInstance: false,
  };
}

function describeCustomVectorShapePresetEditableParameters(
  preset: CustomVectorShapePreset,
): ImageCustomVectorShapeEditableParameter[] {
  if (preset.kind === 'star') return ['polygonSides', 'starInnerRadius'];
  if (preset.kind === 'polygon') return ['polygonSides'];
  return [];
}

function buildCustomVectorShapePresetSignature(
  preset: CustomVectorShapePreset | undefined,
): string {
  if (!preset) return 'none';
  if (preset.kind === 'star') {
    return `star:${clampPolygonSides(preset.polygonSides)}:${formatSignatureNumber(clampStarInnerRadius(preset.starInnerRadius))}`;
  }
  if (preset.kind === 'polygon') {
    return `polygon:${clampPolygonSides(preset.polygonSides)}`;
  }
  return preset.kind;
}

function buildCustomVectorShapeParameterSignature(preset: CustomVectorShapePreset): string {
  const sides = preset.kind === 'polygon' || preset.kind === 'star'
    ? formatSignatureNumber(clampPolygonSides(preset.polygonSides))
    : 'none';
  const inner = preset.kind === 'star'
    ? formatSignatureNumber(clampStarInnerRadius(preset.starInnerRadius))
    : 'none';
  return `sides:${sides}|inner:${inner}`;
}

function describeConvertToPathApproximation(
  shape: ImageVectorShape | null,
  ellipseSegments: number | undefined,
): ImageRasterVectorShapeReadinessDescriptor['convertToPath']['approximation'] {
  if (!shape || shape.kind === 'path') return 'none';
  if (shape.kind === 'rect') return 'exact-rect-corners';
  return `polygonal-ellipse-${clampEllipsePathSegments(ellipseSegments)}-segments`;
}

function uniqueReadinessBlockers(
  blockers: ImageRasterVectorShapeReadinessBlocker[],
): ImageRasterVectorShapeReadinessBlocker[] {
  return Array.from(new Set(blockers));
}

function describePathPointBoundary(
  shape: ImageVectorShape | null,
): ImageVectorLayerEditabilityDescriptor['pathPoints']['boundary'] {
  if (!shape || shape.kind !== 'path') return 'none';
  return shape.preset ? 'straight-segment-local-points-only' : 'straight-segment-local-points-only';
}

function buildVectorLayerPreviewSignature(layer: ImageLayer, shape: ImageVectorShape | null): string {
  if (!shape) return `${layer.id}|none|${layer.x},${layer.y},0,0|none|none|0|open`;
  const pointCount = shape.kind === 'path' ? shape.points.length : 0;
  const closed = shape.kind === 'path' ? shape.closed : true;
  return [
    layer.id,
    shape.kind,
    `${formatSignatureNumber(layer.x)},${formatSignatureNumber(layer.y)},${formatSignatureNumber(shape.width)},${formatSignatureNumber(shape.height)}`,
    `${shape.fillColor}:${formatSignatureNumber(shape.fillOpacity)}`,
    `${shape.strokeColor}:${formatSignatureNumber(shape.strokeOpacity)}:${formatSignatureNumber(shape.strokeWidth)}`,
    String(pointCount),
    closed ? 'closed' : 'open',
  ].join('|');
}

function buildSvgPathData(points: ImageVectorPathPoint[], closed: boolean): string {
  if (points.length === 0) return 'M 0 0';
  const [firstPoint, ...rest] = points;
  const commands = [`M ${formatNumber(firstPoint!.x)} ${formatNumber(firstPoint!.y)}`];
  rest.forEach((point, index) => {
    const previous = points[index]!;
    if (hasBezierSegment(previous, point)) {
      const control1 = previous.outHandle ?? previous;
      const control2 = point.inHandle ?? point;
      commands.push(
        `C ${formatNumber(control1.x)} ${formatNumber(control1.y)} ${formatNumber(control2.x)} ${formatNumber(control2.y)} ${formatNumber(point.x)} ${formatNumber(point.y)}`,
      );
      return;
    }
    commands.push(`L ${formatNumber(point.x)} ${formatNumber(point.y)}`);
  });
  if (closed && points.length > 1) {
    const lastPoint = points[points.length - 1]!;
    if (hasBezierSegment(lastPoint, firstPoint!)) {
      const control1 = lastPoint.outHandle ?? lastPoint;
      const control2 = firstPoint!.inHandle ?? firstPoint!;
      commands.push(
        `C ${formatNumber(control1.x)} ${formatNumber(control1.y)} ${formatNumber(control2.x)} ${formatNumber(control2.y)} ${formatNumber(firstPoint!.x)} ${formatNumber(firstPoint!.y)}`,
      );
    }
  }
  if (closed) commands.push('Z');
  return commands.join(' ');
}

function drawVectorPathSegment(
  ctx: OffscreenCanvasRenderingContext2D,
  from: ImageVectorPathPoint,
  to: ImageVectorPathPoint,
): void {
  if (!hasBezierSegment(from, to)) {
    ctx.lineTo(to.x, to.y);
    return;
  }
  const control1 = from.outHandle ?? from;
  const control2 = to.inHandle ?? to;
  ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, to.x, to.y);
}

function hasBezierSegment(from: ImageVectorPathPoint, to: ImageVectorPathPoint): boolean {
  return Boolean(from.outHandle || to.inHandle);
}

function pathHasBezierHandles(points: ImageVectorPathPoint[]): boolean {
  return points.some((point) => Boolean(point.inHandle || point.outHandle));
}

function translateVectorPathPoint(
  point: ImageVectorPathPoint,
  deltaX: number,
  deltaY: number,
): ImageVectorPathPoint {
  return {
    x: point.x + deltaX,
    y: point.y + deltaY,
    ...(point.inHandle
      ? {
          inHandle: {
            x: point.inHandle.x + deltaX,
            y: point.inHandle.y + deltaY,
          },
        }
      : {}),
    ...(point.outHandle
      ? {
          outHandle: {
            x: point.outHandle.x + deltaX,
            y: point.outHandle.y + deltaY,
          },
        }
      : {}),
  };
}

function normalizeVectorPathGeometry(points: ImageVectorPathPoint[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: ImageVectorPathPoint[];
} {
  if (points.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      points: [{ x: 0, y: 0 }],
    };
  }

  const boundsPoints = points.flatMap((point) => [
    point,
    ...(point.inHandle ? [point.inHandle] : []),
    ...(point.outHandle ? [point.outHandle] : []),
  ]);
  const minX = Math.min(...boundsPoints.map((point) => point.x));
  const minY = Math.min(...boundsPoints.map((point) => point.y));
  const maxX = Math.max(...boundsPoints.map((point) => point.x));
  const maxY = Math.max(...boundsPoints.map((point) => point.y));
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  const normalizedPoints = points.map((point) => translateVectorPathPoint(point, -x, -y));

  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
    points: normalizedPoints,
  };
}

function fallbackShape(): ImageVectorShape {
  return {
    kind: 'rect',
    width: 1,
    height: 1,
    fillColor: '#ffffff',
    fillOpacity: 1,
    strokeColor: '#000000',
    strokeOpacity: 1,
    strokeWidth: 0,
  };
}

function normalizeCustomVectorShapePreset(
  preset: CustomVectorShapePreset | undefined,
): CustomVectorShapePreset | undefined {
  if (!preset || !CUSTOM_VECTOR_SHAPE_PRESET_OPTIONS.includes(preset.kind)) return undefined;
  if (preset.kind === 'polygon' || preset.kind === 'star') {
    return {
      kind: preset.kind,
      polygonSides: clampPolygonSides(preset.polygonSides),
      ...(preset.kind === 'star' ? { starInnerRadius: clampStarInnerRadius(preset.starInnerRadius) } : {}),
    };
  }
  return { kind: preset.kind };
}

function buildCustomVectorShapePreset(
  presetKind: CustomVectorShapePresetKind,
  settings: Pick<ShapeToolSettings, 'polygonSides' | 'starInnerRadius'>,
): CustomVectorShapePreset {
  if (presetKind === 'polygon' || presetKind === 'star') {
    return {
      kind: presetKind,
      polygonSides: clampPolygonSides(settings.polygonSides),
      ...(presetKind === 'star' ? { starInnerRadius: clampStarInnerRadius(settings.starInnerRadius) } : {}),
    };
  }
  return { kind: presetKind };
}

function buildCustomVectorShapeDocumentPointsFromDrag(
  preset: CustomVectorShapePreset,
  from: VectorShapePoint,
  to: VectorShapePoint,
): ImageVectorPathPoint[] {
  if (preset.kind === 'line') {
    return [
      { x: Math.round(from.x), y: Math.round(from.y) },
      { x: Math.round(to.x), y: Math.round(to.y) },
    ];
  }
  return buildCustomVectorShapeDocumentPointsFromBounds(preset, normalizeDragBounds(from, to));
}

function buildCustomVectorShapeDocumentPointsFromBounds(
  preset: CustomVectorShapePreset,
  bounds: { x: number; y: number; width: number; height: number },
): ImageVectorPathPoint[] {
  const x = bounds.x;
  const y = bounds.y;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;

  switch (preset.kind) {
    case 'line':
      return [
        { x, y },
        { x: x + width, y: y + height },
      ];
    case 'triangle':
      return [
        { x: centerX, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
    case 'diamond':
      return [
        { x: centerX, y },
        { x: x + width, y: centerY },
        { x: centerX, y: y + height },
        { x, y: centerY },
      ];
    case 'polygon':
      return fitPointsToBounds(
        buildRegularPolygonPoints(centerX, centerY, radiusX, radiusY, clampPolygonSides(preset.polygonSides)),
        bounds,
      );
    case 'star':
      return fitPointsToBounds(
        buildStarPolygonPoints(
          centerX,
          centerY,
          radiusX,
          radiusY,
          clampPolygonSides(preset.polygonSides),
          clampStarInnerRadius(preset.starInnerRadius),
        ),
        bounds,
      );
  }
}

function buildRegularPolygonPoints(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  sides: number,
): ImageVectorPathPoint[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / sides;
    return {
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle),
    };
  });
}

function buildStarPolygonPoints(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  points: number,
  innerRadius: number,
): ImageVectorPathPoint[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const isOuterPoint = index % 2 === 0;
    const angle = (-Math.PI / 2) + (index * Math.PI) / points;
    const scale = isOuterPoint ? 1 : innerRadius;
    return {
      x: centerX + radiusX * scale * Math.cos(angle),
      y: centerY + radiusY * scale * Math.sin(angle),
    };
  });
}

function clampPolygonSides(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  const finiteValue = value ?? 5;
  return Math.max(3, Math.min(12, Math.round(finiteValue)));
}

function clampStarInnerRadius(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  const finiteValue = value ?? 0.5;
  return Math.max(0.1, Math.min(0.9, Math.round(finiteValue * 100) / 100));
}

function fitPointsToBounds(
  points: ImageVectorPathPoint[],
  bounds: { x: number; y: number; width: number; height: number },
): ImageVectorPathPoint[] {
  if (points.length === 0) return points;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  return points.map((point) => ({
    x: bounds.x + ((point.x - minX) / sourceWidth) * bounds.width,
    y: bounds.y + ((point.y - minY) / sourceHeight) * bounds.height,
  }));
}

function formatCustomPresetLabel(kind: CustomVectorShapePresetKind): string {
  switch (kind) {
    case 'line':
      return 'Line';
    case 'triangle':
      return 'Triangle';
    case 'diamond':
      return 'Diamond';
    case 'polygon':
      return 'Polygon';
    case 'star':
      return 'Star';
  }
}
