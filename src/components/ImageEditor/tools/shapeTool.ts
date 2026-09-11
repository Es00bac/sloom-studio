import type { ImageLayer, ShapeToolSettings } from '../../../types/imageEditor';
import { DEFAULT_SHAPE_TOOL_SETTINGS } from '../../../types/imageEditor';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import {
  buildCustomVectorShapeLayerFromDrag,
  buildVectorShapeLayerFromDrag,
  describeCustomVectorShapePresetGeometry,
  type RectEllipseVectorShapeKind,
  updateEditableVectorShapeLayer,
  type VectorShapePoint,
} from '../ImageVectorShape';
import type { Point, ToolEnv, ToolHandler } from './types';

interface ShapeStroke {
  layerId: string | null;
  beforeLayers: ImageLayer[];
  beforeActiveLayerId: string | null;
  start: VectorShapePoint;
}

export interface ShapeToolVectorPlanDescriptor {
  outputShapeKind: 'rect' | 'ellipse' | 'path';
  closedPath: boolean;
  shapeLibrary: 'native-rect-shape-tool' | 'native-ellipse-shape-tool' | 'signal-loom-custom-shape-library';
  nativeShapeSemantics:
    | 'retained-rect-shape'
    | 'retained-ellipse-shape'
    | 'fill-and-stroke-closed-path'
    | 'stroke-only-open-path';
  presetLibraryStatus: {
    source: ShapeToolVectorPlanDescriptor['shapeLibrary'];
    presetKind: ShapeToolSettings['presetKind'];
    retainedPresetMetadata: boolean;
    retainedStyleMetadata: boolean;
    nativeLibraryInstance: false;
    editableParameters: Array<'polygonSides' | 'starInnerRadius'>;
  };
  presetGeometry: {
    kind: ShapeToolSettings['presetKind'] | 'ellipse';
    source: ShapeToolVectorPlanDescriptor['shapeLibrary'];
    pointCount: number;
    closed: boolean;
    editableParameters: Array<'polygonSides' | 'starInnerRadius'>;
    parameterSignature: string;
    geometrySignature: string;
  };
  fillBehavior: 'editable-fill-and-stroke' | 'ignored-until-path-is-closed';
  stylePersistence: {
    retainedOnVectorLayer: true;
    editableAfterCommit: true;
    fillAppliesToOpenPath: boolean;
    strokeAppliesToOpenPath: true;
    persistedFields: Array<keyof Pick<ShapeToolSettings, 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>>;
    svgStyleSignature: string;
    psdStyleSignature: string;
  };
  retainedStyleFields: Array<keyof Pick<ShapeToolSettings, 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth'>>;
  pathPointEditability: 'not-path' | 'endpoints-only-until-converted' | 'straight-segment-local-points';
  rasterizeWarnings: string[];
  handoffWarnings: string[];
  booleanLimitations: string[];
  previewSignatureFields: string[];
  previewSignature: string;
}

export function describeShapeToolVectorPlan(
  settings: ShapeToolSettings,
  options: { toolKind?: RectEllipseVectorShapeKind } = {},
): ShapeToolVectorPlanDescriptor {
  const toolKind = options.toolKind ?? 'rect';
  const outputShapeKind = toolKind === 'ellipse'
    ? 'ellipse'
    : settings.presetKind === 'rect'
      ? 'rect'
      : 'path';
  const closedPath = settings.presetKind !== 'line';
  const shapeLibrary = outputShapeKind === 'ellipse'
    ? 'native-ellipse-shape-tool'
    : settings.presetKind === 'rect'
      ? 'native-rect-shape-tool'
      : 'signal-loom-custom-shape-library';
  const nativeShapeSemantics = outputShapeKind === 'ellipse'
    ? 'retained-ellipse-shape'
    : settings.presetKind === 'rect'
      ? 'retained-rect-shape'
      : settings.presetKind === 'line'
        ? 'stroke-only-open-path'
        : 'fill-and-stroke-closed-path';
  const fillBehavior = settings.presetKind === 'line' ? 'ignored-until-path-is-closed' : 'editable-fill-and-stroke';
  const retainedStyleFields: ShapeToolVectorPlanDescriptor['retainedStyleFields'] = [
    'fillColor',
    'fillOpacity',
    'strokeColor',
    'strokeOpacity',
    'strokeWidth',
  ];
  const presetGeometry = describeShapeToolPresetGeometry(settings, outputShapeKind, shapeLibrary);
  const presetSignature = getShapeToolPresetSignature(settings);
  return {
    outputShapeKind,
    closedPath,
    shapeLibrary,
    nativeShapeSemantics,
    presetLibraryStatus: {
      source: shapeLibrary,
      presetKind: settings.presetKind,
      retainedPresetMetadata: shapeLibrary === 'signal-loom-custom-shape-library',
      retainedStyleMetadata: true,
      nativeLibraryInstance: false,
      editableParameters: getShapeToolPresetEditableParameters(settings.presetKind),
    },
    presetGeometry,
    fillBehavior,
    stylePersistence: {
      retainedOnVectorLayer: true,
      editableAfterCommit: true,
      fillAppliesToOpenPath: settings.presetKind !== 'line',
      strokeAppliesToOpenPath: true,
      persistedFields: retainedStyleFields,
      svgStyleSignature: `svg-style|fill:${settings.fillColor}:${settings.fillOpacity}|stroke:${settings.strokeColor}:${settings.strokeOpacity}:${settings.strokeWidth}`,
      psdStyleSignature: `psd-style|fill:${settings.fillColor}:${settings.fillOpacity}|stroke:${settings.strokeColor}:${settings.strokeOpacity}:${settings.strokeWidth}|metadata-only`,
    },
    retainedStyleFields,
    pathPointEditability: outputShapeKind === 'path'
      ? (settings.presetKind === 'line' ? 'endpoints-only-until-converted' : 'straight-segment-local-points')
      : 'not-path',
    rasterizeWarnings: [
      'rasterize-before-pixel-edit-discards-shape-tool-style-controls',
      ...(outputShapeKind === 'ellipse' ? ['ellipse-rasterization-freezes-parametric-shape-bounds'] : []),
      ...(settings.presetKind === 'line' ? ['open-line-path-has-no-fill-until-closed'] : []),
      ...(settings.presetKind === 'line' ? ['rasterized-line-preserves-stroke-only-appearance'] : []),
    ],
    handoffWarnings: [
      'vector-mask-creates-closed-local-copy',
      ...(outputShapeKind === 'ellipse'
        ? [
            'svg-export-keeps-retained-ellipse-until-general-path-conversion',
            'psd-export-keeps-raster-preview-plus-vector-metadata',
            'native-ellipse-boolean-roundtrip-not-guaranteed',
          ]
        : []),
      ...(outputShapeKind === 'ellipse' ? [] : ['svg-export-keeps-straight-segments-only']),
      ...(outputShapeKind === 'ellipse' ? [] : ['psd-export-keeps-layer-backed-path-only']),
      ...(settings.presetKind === 'rect' ? [] : ['source-bin-handoff-keeps-sloom-vector-metadata-plus-svg-preview']),
      ...(settings.presetKind === 'rect' ? [] : ['native-custom-shape-library-instances-are-not-preserved']),
    ],
    booleanLimitations: [
      ...(outputShapeKind === 'ellipse'
        ? ['ellipse-shapes-must-convert-to-path-before-general-boolean-materialization']
        : []),
      'boolean-ops-run-as-separate-layer-actions',
      ...(settings.presetKind === 'line' ? ['open-line-paths-must-close-before-boolean-materialization'] : []),
      'live-boolean-stack-unsupported',
      'bezier-boolean-operands-unsupported',
    ],
    previewSignatureFields: [
      ...(outputShapeKind === 'ellipse' ? ['toolKind'] : []),
      'presetKind',
      'fill',
      'stroke',
      'strokeWidth',
      'closedPath',
    ],
    previewSignature: [
      'shape-tool-plan',
      ...(outputShapeKind === 'ellipse' ? ['ellipse'] : []),
      settings.presetKind,
      shapeLibrary,
      nativeShapeSemantics,
      closedPath ? 'closed' : 'open',
      `${settings.fillColor}:${settings.fillOpacity}`,
      `${settings.strokeColor}:${settings.strokeOpacity}:${settings.strokeWidth}`,
      ...(presetSignature === 'none' ? [] : [presetSignature]),
    ].join('|'),
  };
}

function describeShapeToolPresetGeometry(
  settings: ShapeToolSettings,
  outputShapeKind: ShapeToolVectorPlanDescriptor['outputShapeKind'],
  source: ShapeToolVectorPlanDescriptor['shapeLibrary'],
): ShapeToolVectorPlanDescriptor['presetGeometry'] {
  if (outputShapeKind === 'ellipse') {
    return {
      kind: 'ellipse',
      source,
      pointCount: 0,
      closed: true,
      editableParameters: [],
      parameterSignature: 'native-ellipse',
      geometrySignature: 'native-ellipse-shape|parametric-bounds',
    };
  }
  if (settings.presetKind === 'rect') {
    return {
      kind: 'rect',
      source,
      pointCount: 0,
      closed: true,
      editableParameters: [],
      parameterSignature: 'native-rect',
      geometrySignature: 'native-rect-shape|parametric-bounds',
    };
  }
  const geometry = describeCustomVectorShapePresetGeometry({
    presetKind: settings.presetKind,
    settings,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  });
  const sides = geometry.parameters.polygonSides.value;
  const inner = geometry.parameters.starInnerRadius.value;
  return {
    kind: geometry.kind,
    source,
    pointCount: geometry.pointCount,
    closed: geometry.closed,
    editableParameters: geometry.editableParameters,
    parameterSignature: `sides:${sides ?? 'none'}|inner:${inner ?? 'none'}`,
    geometrySignature: geometry.previewSignature,
  };
}

function getShapeToolPresetEditableParameters(
  presetKind: ShapeToolSettings['presetKind'],
): Array<'polygonSides' | 'starInnerRadius'> {
  if (presetKind === 'star') return ['polygonSides', 'starInnerRadius'];
  if (presetKind === 'polygon') return ['polygonSides'];
  return [];
}

function getShapeToolPresetSignature(settings: ShapeToolSettings): string {
  if (settings.presetKind === 'star') {
    return `star:${Math.max(3, Math.min(12, Math.round(settings.polygonSides)))}:${Math.max(0.1, Math.min(0.9, Math.round(settings.starInnerRadius * 100) / 100))}`;
  }
  if (settings.presetKind === 'polygon') {
    return `polygon:${Math.max(3, Math.min(12, Math.round(settings.polygonSides)))}`;
  }
  return 'none';
}

function makeShapeTool(kind: RectEllipseVectorShapeKind): ToolHandler {
  let stroke: ShapeStroke | null = null;

  const previewShape = (env: ToolEnv, end: Point) => {
    if (!stroke) return;
    const currentStroke = stroke;
    const currentStore = useImageEditorStore.getState();
    const currentDoc = currentStore.documents.find((candidate) => candidate.id === env.doc.id);
    if (!currentDoc) return;
    const settings = resolveShapeToolSettings(env);

    if (!currentStroke.layerId) {
      const layer = kind === 'rect' && settings.presetKind !== 'rect'
        ? buildCustomVectorShapeLayerFromDrag({
            doc: currentDoc,
            presetKind: settings.presetKind,
            from: currentStroke.start,
            to: end,
            settings,
          })
        : buildVectorShapeLayerFromDrag({
            doc: currentDoc,
            kind,
            from: currentStroke.start,
            to: end,
            settings,
          });
      currentStroke.layerId = layer.id;
      currentStore.addLayer(env.doc.id, layer);
      env.requestRender();
      return;
    }

    const existingLayer = currentDoc.layers.find((candidate) => candidate.id === currentStroke.layerId);
    if (!existingLayer) return;
    const rebuiltLayer = kind === 'rect' && settings.presetKind !== 'rect'
      ? buildCustomVectorShapeLayerFromDrag({
          doc: currentDoc,
          presetKind: settings.presetKind,
          from: currentStroke.start,
          to: end,
          settings,
          existingLayer,
        })
      : buildVectorShapeLayerFromDrag({
          doc: currentDoc,
          kind,
          from: currentStroke.start,
          to: end,
          settings,
          existingLayer,
        });
    currentStore.updateLayer(
      env.doc.id,
      existingLayer.id,
      updateEditableVectorShapeLayer(
        existingLayer,
        rebuiltLayer.metadata?.vectorShape ?? {},
        {
          x: Math.floor(Math.min(currentStroke.start.x, end.x)),
          y: Math.floor(Math.min(currentStroke.start.y, end.y)),
        },
      ),
    );
    env.requestRender();
  };

  const resetPreview = (env: ToolEnv) => {
    if (!stroke) return;
    useImageEditorStore.getState().setLayers(env.doc.id, stroke.beforeLayers, stroke.beforeActiveLayerId);
    env.requestRender();
    stroke = null;
  };

  return {
    onPointerDown(env, point) {
      stroke = {
        layerId: null,
        beforeLayers: env.doc.layers,
        beforeActiveLayerId: env.doc.activeLayerId,
        start: point,
      };
      previewShape(env, point);
    },

    onPointerMove(env, point) {
      previewShape(env, point);
    },

    onPointerUp(env, point) {
      if (!stroke) return;
      previewShape(env, point);
      const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === env.doc.id);
      if (currentDoc && stroke.layerId && currentDoc.layers !== stroke.beforeLayers) {
        env.pushOperation({
          kind: 'layerOp',
          docId: env.doc.id,
          before: stroke.beforeLayers,
          after: currentDoc.layers,
        });
      }
      stroke = null;
    },

    onCancel(env) {
      resetPreview(env);
    },
  };
}

function resolveShapeToolSettings(env: ToolEnv): ShapeToolSettings {
  if (env.shapeToolSettings) {
    return env.shapeToolSettings;
  }
  return {
    ...DEFAULT_SHAPE_TOOL_SETTINGS,
    fillColor: env.brushSettings.color,
    fillOpacity: env.brushSettings.opacity,
  };
}

export const rectShapeTool = makeShapeTool('rect');
export const ellipseShapeTool = makeShapeTool('ellipse');
