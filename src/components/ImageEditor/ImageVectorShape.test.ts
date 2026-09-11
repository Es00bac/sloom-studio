import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import {
  convertEditableVectorShapeLayerToPath,
  buildVectorPathLayer,
  createLiveImageVectorBooleanLayers,
  describeCustomVectorShapePresetGeometry,
  describeImageRasterVectorShapeReadiness,
  describeImageVectorShapeMetadata,
  describeImageVectorLayerEditability,
  getVectorPathDocumentPoints,
  materializeImageVectorBooleanLayers,
  planImageVectorLayerRasterize,
  rasterizeEditableVectorShapeLayer,
  refreshLiveImageVectorBooleanLayers,
  updateEditableVectorShapeLayer,
  updateVectorPathLayerHandle,
} from './ImageVectorShape';

class FakeCanvasContext {
  fillStyle = '#000000';
  globalAlpha = 1;
  lineWidth = 1;
  strokeStyle = '#000000';

  beginPath() {}
  closePath() {}
  clearRect() {}
  ellipse() {}
  fill() {}
  bezierCurveTo() {}
  lineTo() {}
  moveTo() {}
  rect() {}
  stroke() {}
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function vectorLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'vector-1',
    name: 'Panel Star',
    type: 'vector',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 12,
    y: 18,
    bitmap: null,
    bitmapVersion: 3,
    mask: null,
    vectorRecipe: '<svg><path d="M 0 0 L 20 0 L 10 12 Z" /></svg>',
    metadata: {
      originalSvgSource: '<svg><path d="M 0 0 L 20 0 L 10 12 Z" /></svg>',
      vectorShape: {
        kind: 'path',
        width: 20,
        height: 12,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 12 },
        ],
        closed: true,
        fillColor: '#22cc88',
        fillOpacity: 0.75,
        strokeColor: '#1144ff',
        strokeOpacity: 0.5,
        strokeWidth: 4,
        preset: { kind: 'triangle' },
      },
    },
    ...overrides,
  };
}

function rectVectorLayer(id: string, x: number, y: number, width: number, height: number): ImageLayer {
  return vectorLayer({
    id,
    name: id === 'vector-a' ? 'Panel Shape A' : 'Panel Shape B',
    x,
    y,
    bitmap: null,
    vectorRecipe: '<svg />',
    metadata: {
      vectorShape: {
        kind: 'rect',
        width,
        height,
        fillColor: '#22cc88',
        fillOpacity: 0.75,
        strokeColor: '#1144ff',
        strokeOpacity: 0.5,
        strokeWidth: 4,
      },
      originalSvgSource: '<svg />',
    },
  });
}

function ellipseVectorLayer(): ImageLayer {
  return vectorLayer({
    id: 'ellipse-vector',
    name: 'Badge ellipse',
    x: 30,
    y: 40,
    metadata: {
      sourceLabel: 'Sticker sheet',
      vectorShape: {
        kind: 'ellipse',
        width: 64,
        height: 32,
        fillColor: '#44ccff',
        fillOpacity: 0.6,
        strokeColor: '#0f172a',
        strokeOpacity: 0.8,
        strokeWidth: 3,
      },
      originalSvgSource: '<svg />',
    },
  });
}

describe('ImageVectorShape descriptors', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('normalizes hostile retained colors before a mounted shape edit can throw', () => {
    const layer = vectorLayer();
    const shape = layer.metadata?.vectorShape;
    if (!shape) throw new Error('Expected retained vector shape');
    (shape as unknown as { fillColor: unknown; strokeColor: unknown }).fillColor = { value: '#ffffff' };
    (shape as unknown as { fillColor: unknown; strokeColor: unknown }).strokeColor = ['#000000'];

    const updated = updateEditableVectorShapeLayer(layer, { fillOpacity: 0.5 });

    expect(updated.metadata?.vectorShape).toMatchObject({
      fillColor: '#ffffff',
      fillOpacity: 0.5,
      strokeColor: '#000000',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('describes retained fill/stroke editability, path-point boundaries, and preview signature fields', () => {
    const descriptor = describeImageVectorLayerEditability(vectorLayer());

    expect(descriptor).toMatchObject({
      editable: true,
      layerId: 'vector-1',
      shapeKind: 'path',
      retainedStyle: {
        fillColor: 'editable',
        fillOpacity: 'editable',
        strokeColor: 'editable',
        strokeOpacity: 'editable',
        strokeWidth: 'editable',
      },
      pathPoints: {
        editable: true,
        pointCount: 3,
        supportsBezierHandles: false,
        boundary: 'straight-segment-local-points-only',
      },
      handoff: {
        svg: {
          supported: true,
          limitations: ['no-live-boolean-stack', 'no-bezier-handle-editing'],
        },
        psd: {
          supported: 'limited',
          limitations: ['exports-raster-preview-plus-vector-metadata', 'native-psd-shape-layer-roundtrip-not-guaranteed'],
        },
      },
      preview: {
        width: 20,
        height: 12,
        hasBitmapPreview: false,
        hasSvgSource: true,
        signatureFields: ['layerId', 'shapeKind', 'bounds', 'style', 'pointCount', 'closed'],
      },
    });
    expect(descriptor.preview.signature).toBe('vector-1|path|12,18,20,12|#22cc88:0.75|#1144ff:0.5:4|3|closed');
  });

  it('retains Bezier in/out handles on vector path layers and renders cubic SVG commands', () => {
    const layer = buildVectorPathLayer({
      doc: null,
      points: [
        { x: 10, y: 20, outHandle: { x: 40, y: 10 } },
        { x: 90, y: 60, inHandle: { x: 60, y: 80 } },
      ],
      closed: false,
      settings: {
        fillColor: '#22cc88',
        fillOpacity: 0,
        strokeColor: '#1144ff',
        strokeOpacity: 1,
        strokeWidth: 2,
      },
    });

    expect(getVectorPathDocumentPoints(layer)).toEqual([
      { x: 10, y: 20, outHandle: { x: 40, y: 10 } },
      { x: 90, y: 60, inHandle: { x: 60, y: 80 } },
    ]);
    expect(layer.vectorRecipe).toContain('C 30 0 50 70 80 50');
    expect(describeImageVectorLayerEditability(layer).pathPoints.supportsBezierHandles).toBe(true);
  });

  it('updates retained Bezier handles without dropping neighboring anchor metadata', () => {
    const layer = buildVectorPathLayer({
      doc: null,
      points: [
        { x: 10, y: 20, outHandle: { x: 40, y: 10 } },
        { x: 90, y: 60, inHandle: { x: 60, y: 80 } },
      ],
      closed: false,
      settings: {
        fillColor: '#22cc88',
        fillOpacity: 0,
        strokeColor: '#1144ff',
        strokeOpacity: 1,
        strokeWidth: 2,
      },
    });

    const edited = updateVectorPathLayerHandle(layer, 1, 'inHandle', { x: 52, y: 72 });

    expect(getVectorPathDocumentPoints(edited)).toEqual([
      { x: 10, y: 20, outHandle: { x: 40, y: 10 } },
      { x: 90, y: 60, inHandle: { x: 52, y: 72 } },
    ]);
    expect(edited.bitmapVersion).toBeGreaterThan(layer.bitmapVersion);
    expect(edited.vectorRecipe).toContain('C 30 0 42 62 80 50');
  });

  it('describes retained rectangle metadata with editable style and SVG/PSD handoff caveats', () => {
    const descriptor = describeImageVectorShapeMetadata(rectVectorLayer('vector-a', 4, 6, 48, 30));

    expect(descriptor).toMatchObject({
      layerId: 'vector-a',
      retained: true,
      shapeKind: 'rect',
      bounds: {
        x: 4,
        y: 6,
        width: 48,
        height: 30,
      },
      geometry: {
        kind: 'rect',
        pointCount: 0,
        closed: true,
        supportsBezierHandles: false,
        presetKind: 'none',
        localPointSignature: 'rect:48x30',
      },
      style: {
        fillColor: '#22cc88',
        fillOpacity: 0.75,
        strokeColor: '#1144ff',
        strokeOpacity: 0.5,
        strokeWidth: 4,
        editableFields: ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'],
      },
      handoffCaveats: {
        svg: [
          'svg-export-preserves-retained-rect-ellipse-path-metadata',
          'svg-export-does-not-preserve-live-boolean-stack',
        ],
        psd: [
          'psd-export-carries-raster-preview-plus-vector-metadata',
          'native-psd-shape-layer-roundtrip-not-guaranteed',
        ],
      },
      warningCodes: [
        'live-boolean-stack-not-retained',
        'psd-native-shape-roundtrip-limited',
      ],
      blockerCodes: [],
      previewSignatureFields: ['layerId', 'shapeKind', 'bounds', 'style', 'geometry', 'unsupportedStates'],
      previewSignature: 'shape-meta|vector-a|rect|4,6,48,30|#22cc88:0.75|#1144ff:0.5:4|rect:48x30|live-boolean-stack-not-retained,psd-native-shape-roundtrip-limited',
    });
  });

  it('describes retained ellipse metadata with deterministic polygonal path conversion caveat', () => {
    const descriptor = describeImageVectorShapeMetadata(ellipseVectorLayer(), { ellipseSegments: 20 });

    expect(descriptor).toMatchObject({
      layerId: 'ellipse-vector',
      retained: true,
      shapeKind: 'ellipse',
      geometry: {
        kind: 'ellipse',
        pointCount: 0,
        closed: true,
        supportsBezierHandles: false,
        presetKind: 'none',
        localPointSignature: 'ellipse:64x32',
        convertToPathApproximation: 'polygonal-ellipse-20-segments',
      },
      warningCodes: [
        'ellipse-direct-boolean-blocked',
        'live-boolean-stack-not-retained',
        'psd-native-shape-roundtrip-limited',
      ],
      blockerCodes: ['ellipse-boolean-requires-convert-to-path'],
    });
    expect(descriptor.previewSignature).toContain('ellipse-direct-boolean-blocked,live-boolean-stack-not-retained,psd-native-shape-roundtrip-limited');
  });

  it('describes path metadata with retained points and unsupported Bezier/overlap states', () => {
    const descriptor = describeImageVectorShapeMetadata(vectorLayer());

    expect(descriptor).toMatchObject({
      layerId: 'vector-1',
      retained: true,
      shapeKind: 'path',
      geometry: {
        kind: 'path',
        pointCount: 3,
        closed: true,
        supportsBezierHandles: false,
        presetKind: 'triangle',
        localPointSignature: 'path:closed:3:0,0;20,0;10,12',
        localPoints: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 12 },
        ],
      },
      source: {
        hasSvgSource: true,
        hasVectorRecipe: true,
        hasBooleanSource: false,
        booleanSourceOperation: 'none',
        booleanSourceSubset: 'none',
        shapeLibrary: 'signal-loom-custom-shape-library',
        nativeShapeSemantics: 'materialized-straight-segment-path-only',
      },
      handoffCaveats: {
        svg: [
          'svg-export-preserves-retained-rect-ellipse-path-metadata',
          'svg-export-does-not-preserve-live-boolean-stack',
          'svg-export-materializes-custom-shape-library-presets-to-path-segments',
        ],
        psd: [
          'psd-export-carries-raster-preview-plus-vector-metadata',
          'native-psd-shape-layer-roundtrip-not-guaranteed',
          'native-psd-custom-shape-library-instances-not-preserved',
        ],
        sourceBin: [
          'source-bin-handoff-preserves-sloom-vector-metadata-and-svg-preview',
          'source-bin-handoff-keeps-custom-preset-id-and-editable-style-metadata',
          'source-bin-handoff-does-not-create-native-psd-custom-shape-instances',
        ],
      },
      warningCodes: [
        'bezier-handles-not-retained',
        'live-boolean-stack-not-retained',
        'overlapping-path-boolean-not-materialized',
        'psd-native-shape-roundtrip-limited',
      ],
      blockerCodes: [],
    });
    expect(descriptor.unsupportedStates).toEqual([
      expect.objectContaining({
        code: 'bezier-handles-not-retained',
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'live-boolean-stack-not-retained',
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'overlapping-path-boolean-not-materialized',
        severity: 'blocker',
      }),
      expect.objectContaining({
        code: 'psd-native-shape-roundtrip-limited',
        severity: 'warning',
      }),
    ]);
    expect(descriptor.previewSignature).toBe('shape-meta|vector-1|path|12,18,20,12|#22cc88:0.75|#1144ff:0.5:4|path:closed:3:0,0;20,0;10,12|signal-loom-custom-shape-library|materialized-straight-segment-path-only|bezier-handles-not-retained,live-boolean-stack-not-retained,overlapping-path-boolean-not-materialized,psd-native-shape-roundtrip-limited');
  });

  it('retains custom shape preset/library readiness without claiming native library instances', () => {
    const descriptor = describeImageVectorShapeMetadata(vectorLayer({
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 120,
          height: 96,
          points: Array.from({ length: 12 }, (_, index) => ({
            x: index * 8,
            y: index % 2 === 0 ? 0 : 96,
          })),
          closed: true,
          fillColor: '#facc15',
          fillOpacity: 0.85,
          strokeColor: '#1e293b',
          strokeOpacity: 0.9,
          strokeWidth: 5,
          preset: {
            kind: 'star',
            polygonSides: 6,
            starInnerRadius: 0.38,
          },
        },
        originalSvgSource: '<svg />',
      },
    }));

    expect(descriptor.geometry.preset).toEqual({
      kind: 'star',
      polygonSides: 6,
      starInnerRadius: 0.38,
      source: 'shape-tool-preset',
      retained: true,
      editableParameters: ['polygonSides', 'starInnerRadius'],
      regeneration: 'regenerates-from-preset-until-points-are-edited',
      nativeLibraryInstance: false,
    });
    expect(descriptor.source).toMatchObject({
      shapeLibrary: 'signal-loom-custom-shape-library',
      nativeShapeSemantics: 'materialized-straight-segment-path-only',
    });
    expect(descriptor.handoffCaveats.sourceBin).toContain(
      'source-bin-handoff-keeps-custom-preset-id-and-editable-style-metadata',
    );
    expect(descriptor.previewSignature).toContain('star:6:0.38');
  });

  it('describes custom preset geometry with line direction, clamped star parameters, and handoff signatures', () => {
    const line = describeCustomVectorShapePresetGeometry({
      presetKind: 'line',
      from: { x: 9, y: 8 },
      to: { x: 2, y: 4 },
      settings: {
        polygonSides: 6,
        starInnerRadius: 0.5,
      },
    });

    expect(line).toEqual({
      kind: 'line',
      closed: false,
      bounds: { x: 2, y: 4, width: 7, height: 4 },
      documentPoints: [
        { x: 9, y: 8 },
        { x: 2, y: 4 },
      ],
      pointCount: 2,
      pointSignature: '9,8;2,4',
      parameters: {
        polygonSides: { applies: false, editable: false, value: null, min: 3, max: 12 },
        starInnerRadius: { applies: false, editable: false, value: null, min: 0.1, max: 0.9 },
      },
      editableParameters: [],
      booleanOperandReadiness: {
        ready: false,
        blockers: ['open-line-path'],
        exactSubsets: [],
      },
      fillRule: 'evenodd',
      handoffSignatures: {
        svg: 'svg|custom-shape|line|open|2|7x4',
        psd: 'psd|custom-shape|line|open|2|raster-preview-plus-vector-metadata',
        sourceBin: 'source-bin|custom-shape|line|open|sloom-vector-metadata',
      },
      previewSignatureFields: ['kind', 'closed', 'bounds', 'parameters', 'points'],
      previewSignature: 'custom-shape-geometry|line|open|2,4,7,4|2|9,8;2,4|sides:none|inner:none',
    });

    const star = describeCustomVectorShapePresetGeometry({
      presetKind: 'star',
      bounds: { x: 10, y: 20, width: 120, height: 80 },
      settings: {
        polygonSides: 99,
        starInnerRadius: 1.5,
      },
    });

    expect(star).toMatchObject({
      kind: 'star',
      closed: true,
      bounds: { x: 10, y: 20, width: 120, height: 80 },
      pointCount: 24,
      parameters: {
        polygonSides: { applies: true, editable: true, value: 12, min: 3, max: 12 },
        starInnerRadius: { applies: true, editable: true, value: 0.9, min: 0.1, max: 0.9 },
      },
      editableParameters: ['polygonSides', 'starInnerRadius'],
      booleanOperandReadiness: {
        ready: true,
        blockers: [],
        exactSubsets: ['identical-simple-polygons', 'non-overlapping-simple-polygons'],
      },
      handoffSignatures: {
        svg: 'svg|custom-shape|star|closed|24|120x80',
        psd: 'psd|custom-shape|star|closed|24|raster-preview-plus-vector-metadata',
        sourceBin: 'source-bin|custom-shape|star|closed|sloom-vector-metadata',
      },
    });
    expect(star.documentPoints[0]).toEqual({ x: 70, y: 20 });
    expect(star.previewSignature).toContain('sides:12');
    expect(star.previewSignature).toContain('inner:0.9');
  });

  it('adds stable SVG, PSD, and source-bin handoff signatures to retained vector metadata', () => {
    const descriptor = describeImageVectorShapeMetadata(vectorLayer());

    expect(descriptor.handoffSignatures).toEqual({
      svg: 'svg|vector-1|path|path:closed:3:0,0;20,0;10,12|#22cc88:0.75|#1144ff:0.5:4|signal-loom-custom-shape-library',
      psd: 'psd|vector-1|path|path:closed:3:0,0;20,0;10,12|raster-preview-plus-vector-metadata|materialized-straight-segment-path-only',
      sourceBin: 'source-bin|vector-1|path|path:closed:3:0,0;20,0;10,12|sloom-vector-metadata|signal-loom-custom-shape-library',
    });
  });

  it('plans rasterization as a lossy boundary without mutating vector layer state', () => {
    const layer = vectorLayer();
    const plan = planImageVectorLayerRasterize(layer, 'pixel-edit');

    expect(plan).toEqual({
      layerId: 'vector-1',
      reason: 'pixel-edit',
      willDiscardRetainedFillStrokeEditability: true,
      willDiscardPathPointEditability: true,
      warnings: [
        'rasterize-converts-retained-vector-style-to-pixels',
        'rasterize-removes-path-point-editing',
        'keep-duplicate-vector-layer-for-svg-psd-handoff',
      ],
      previewSignature: 'rasterize|vector-1|path|20x12|pixel-edit',
    });
    expect(layer.type).toBe('vector');
    expect(layer.metadata?.vectorShape).toBeDefined();
  });

  it('drops vector-only boolean provenance when rasterizing an editable vector layer', () => {
    const rasterized = rasterizeEditableVectorShapeLayer(vectorLayer({
      metadata: {
        sourceLabel: 'Generated badge',
        vectorBooleanSource: {
          operation: 'union',
          sourceLayerIds: ['shape-a', 'shape-b'],
          supportedSubset: 'axis-aligned-rectangles',
          previewSignature: 'union|shape-a|shape-b',
        },
        vectorShape: {
          kind: 'path',
          width: 20,
          height: 12,
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 10, y: 12 },
          ],
          closed: true,
          fillColor: '#22cc88',
          fillOpacity: 0.75,
          strokeColor: '#1144ff',
          strokeOpacity: 0.5,
          strokeWidth: 4,
        },
      },
    }));

    expect(rasterized.type).toBe('image');
    expect(rasterized.metadata?.sourceLabel).toBe('Generated badge');
    expect(rasterized.metadata?.vectorShape).toBeUndefined();
    expect(rasterized.metadata?.originalSvgSource).toBeUndefined();
    expect(rasterized.metadata?.vectorBooleanSource).toBeUndefined();
  });

  it('converts retained ellipse shapes into editable path layers without rasterizing style metadata', () => {
    const converted = convertEditableVectorShapeLayerToPath(ellipseVectorLayer(), { ellipseSegments: 16 });
    const shape = converted.metadata?.vectorShape;

    expect(converted).toMatchObject({
      id: 'ellipse-vector',
      name: 'Badge ellipse',
      type: 'vector',
      x: 30,
      y: 40,
    });
    expect(converted.bitmap).not.toBeNull();
    expect(converted.vectorRecipe).toContain('<path');
    expect(converted.metadata?.sourceLabel).toBe('Sticker sheet');
    expect(shape).toMatchObject({
      kind: 'path',
      width: 64,
      height: 32,
      closed: true,
      fillColor: '#44ccff',
      fillOpacity: 0.6,
      strokeColor: '#0f172a',
      strokeOpacity: 0.8,
      strokeWidth: 3,
    });
    expect(shape?.kind === 'path' ? shape.points : []).toHaveLength(16);
    expect(shape?.kind === 'path' ? shape.points[0] : undefined).toEqual({ x: 64, y: 16 });
    expect(shape?.kind === 'path' ? shape.points[4] : undefined).toEqual({ x: 32, y: 32 });
    expect(shape?.kind === 'path' ? shape.points[8] : undefined).toEqual({ x: 0, y: 16 });
    expect(shape?.kind === 'path' ? shape.points[12] : undefined).toEqual({ x: 32, y: 0 });
  });

  it('materializes exact rectangle boolean results as editable retained vector path layers', () => {
    const result = materializeImageVectorBooleanLayers(
      'intersect',
      rectVectorLayer('vector-a', 0, 0, 20, 20),
      rectVectorLayer('vector-b', 8, 6, 20, 18),
    );

    expect(result).toMatchObject({
      operation: 'intersect',
      status: 'exact',
      supportedSubset: 'axis-aligned-rectangles',
      sourceLayerIds: ['vector-a', 'vector-b'],
      warnings: [],
      outputLayers: [
        expect.objectContaining({
          type: 'vector',
          name: 'Panel Shape A Intersect Panel Shape B',
          x: 8,
          y: 6,
        }),
      ],
    });
    expect(result.previewSignature).toContain('intersect|closed:4:0,0;20,0;20,20;0,20|closed:4:8,6;28,6;28,24;8,24|axis-aligned-rectangles');
    expect(result.outputLayers).toHaveLength(1);
    expect(result.outputLayers[0]?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      closed: true,
      width: 12,
      height: 14,
      fillColor: '#22cc88',
      fillOpacity: 0.75,
      strokeColor: '#1144ff',
      strokeOpacity: 0.5,
      strokeWidth: 4,
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 14 },
        { x: 0, y: 14 },
      ],
    });
    expect(result.outputLayers[0]?.metadata?.vectorBooleanSource).toMatchObject({
      operation: 'intersect',
      sourceLayerIds: ['vector-a', 'vector-b'],
      supportedSubset: 'axis-aligned-rectangles',
    });
    expect(result.handoffLimitations).toContain('boolean-result-is-flattened-to-output-path-descriptors');
  });

  it('labels exact boolean output handoff as materialized paths without live stack retention', () => {
    const triangle = vectorLayer({
      id: 'triangle-vector',
      name: 'Triangle',
      x: 0,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 8,
          height: 6,
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 4, y: 6 },
          ],
          closed: true,
          fillColor: '#22cc88',
          fillOpacity: 0.75,
          strokeColor: '#1144ff',
          strokeOpacity: 0.5,
          strokeWidth: 4,
        },
      },
    });
    const diamond = vectorLayer({
      id: 'diamond-vector',
      name: 'Diamond',
      x: 12,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 8,
          height: 8,
          points: [
            { x: 4, y: 0 },
            { x: 8, y: 4 },
            { x: 4, y: 8 },
            { x: 0, y: 4 },
          ],
          closed: true,
          fillColor: '#f472b6',
          fillOpacity: 0.7,
          strokeColor: '#111827',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    });

    const result = materializeImageVectorBooleanLayers(
      'union',
      triangle,
      diamond,
    );

    expect(result.supportedSubset).toBe('non-overlapping-simple-polygons');
    expect(result.handoff).toEqual({
      exportReadiness: 'exact-materialized-paths',
      supportedExactMaterialization: true,
      outputShapeKind: 'path',
      retainsLiveBooleanStack: false,
      retainsSourcePresetMetadata: false,
      caveats: [
        'exact-boolean-output-is-safe-for-rasterize-vector-export-handoff',
        'boolean-result-is-flattened-to-output-path-descriptors',
        'live-boolean-stack-not-retained',
        'source-preset-library-membership-not-retained-on-boolean-output',
      ],
    });
  });

  it('materializes exact disjoint polygon boolean results as multiple retained vector path layers', () => {
    const triangle = vectorLayer({
      id: 'triangle-vector',
      name: 'Triangle',
      x: 0,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 6,
          height: 4,
          points: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 3, y: 4 },
          ],
          closed: true,
          fillColor: '#22cc88',
          fillOpacity: 0.75,
          strokeColor: '#1144ff',
          strokeOpacity: 0.5,
          strokeWidth: 4,
        },
      },
    });
    const diamond = vectorLayer({
      id: 'diamond-vector',
      name: 'Diamond',
      x: 8,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 8,
          height: 6,
          points: [
            { x: 4, y: 0 },
            { x: 8, y: 3 },
            { x: 4, y: 6 },
            { x: 0, y: 3 },
          ],
          closed: true,
          fillColor: '#f472b6',
          fillOpacity: 0.7,
          strokeColor: '#111827',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    });

    const result = materializeImageVectorBooleanLayers('union', triangle, diamond);

    expect(result).toMatchObject({
      operation: 'union',
      status: 'exact',
      supportedSubset: 'non-overlapping-simple-polygons',
      sourceLayerIds: ['triangle-vector', 'diamond-vector'],
      warnings: [],
    });
    expect(result.outputLayers).toHaveLength(2);
    expect(result.outputLayers.map((layer) => layer.type)).toEqual(['vector', 'vector']);
    expect(result.outputLayers.map((layer) => layer.metadata?.vectorShape?.kind)).toEqual(['path', 'path']);
    expect(result.outputLayers[0]?.metadata?.vectorShape).toMatchObject({
      fillColor: '#22cc88',
      strokeColor: '#1144ff',
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 3, y: 4 },
      ],
    });
    expect(result.outputLayers[1]).toMatchObject({
      x: 8,
      y: 0,
    });
    expect(result.outputLayers[1]?.metadata?.vectorShape).toMatchObject({
      fillColor: '#22cc88',
      strokeColor: '#1144ff',
      points: [
        { x: 4, y: 0 },
        { x: 8, y: 3 },
        { x: 4, y: 6 },
        { x: 0, y: 3 },
      ],
    });
    expect(result.outputLayers[0]?.metadata?.vectorBooleanSource).toMatchObject({
      supportedSubset: 'non-overlapping-simple-polygons',
      sourceLayerIds: ['triangle-vector', 'diamond-vector'],
    });
    expect(result.outputLayers[1]?.metadata?.vectorBooleanSource).toMatchObject({
      supportedSubset: 'non-overlapping-simple-polygons',
      sourceLayerIds: ['triangle-vector', 'diamond-vector'],
    });
  });

  it('keeps unsupported vector boolean inputs honest without creating output layers', () => {
    const ellipse = vectorLayer({
      id: 'ellipse-vector',
      name: 'Ellipse',
      x: 0,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'ellipse',
          width: 24,
          height: 18,
          fillColor: '#22cc88',
          fillOpacity: 0.75,
          strokeColor: '#1144ff',
          strokeOpacity: 0.5,
          strokeWidth: 4,
        },
      },
    });

    const result = materializeImageVectorBooleanLayers('union', ellipse, rectVectorLayer('vector-b', 8, 6, 20, 18));

    expect(result).toMatchObject({
      operation: 'union',
      status: 'unsupported',
      supportedSubset: 'none',
      sourceLayerIds: ['ellipse-vector', 'vector-b'],
      outputLayers: [],
      warnings: [
        expect.objectContaining({
          code: 'unsupported-vector-shape-kind',
        }),
      ],
    });
    expect(result.handoffLimitations).toContain('boolean-result-not-materialized-for-unsupported-inputs');
  });

  it('summarizes rectangle vector-backed shape readiness with style, rasterize, path, and boolean support', () => {
    const readiness = describeImageRasterVectorShapeReadiness(rectVectorLayer('vector-a', 4, 6, 48, 30));

    expect(readiness).toMatchObject({
      layerId: 'vector-a',
      shapeKind: 'rect',
      vectorBacked: {
        supported: true,
        supportLevel: 'native-retained-vector',
        supportedKinds: ['rect', 'ellipse', 'path'],
      },
      fillStrokeControls: {
        fillColor: 'editable',
        fillOpacity: 'editable',
        strokeColor: 'editable',
        strokeOpacity: 'editable',
        strokeWidth: 'editable',
      },
      retainedShape: {
        retained: true,
        shapeKind: 'rect',
        geometry: expect.objectContaining({
          kind: 'rect',
          localPointSignature: 'rect:48x30',
        }),
      },
      rasterize: {
        ready: true,
        destructive: true,
        blockerCodes: [],
      },
      convertToPath: {
        ready: true,
        outputKind: 'path',
        approximation: 'exact-rect-corners',
        blockerCodes: [],
      },
      booleanOperations: {
        ready: true,
        supportMatrixSignature: 'boolean-support|union,intersect,subtract,xor|axis-aligned-rectangles,identical-simple-polygons,non-overlapping-simple-polygons,overlapping-simple-polygons|bezier-segments-not-supported,live-boolean-stack-not-retained',
        exactSubsets: ['axis-aligned-rectangles', 'identical-simple-polygons', 'non-overlapping-simple-polygons', 'overlapping-simple-polygons'],
        blockerCodes: [],
        limitations: [
          'compound-path-holes-preserve-evenodd-only',
          'curved-bezier-segments-rasterize-or-convert-before-boolean',
          'degenerate-shared-vertex-inputs-resolve-approximately',
          'ellipse-inputs-must-convert-to-polygon-path-first',
          'ellipse-retains-fill-stroke-until-converted-to-polygon-path-operands',
          'live-boolean-operation-stack-not-retained',
          'boolean-results-flatten-source-stack-to-output-paths',
          'custom-shape-live-parametric-overlap-editing-not-supported',
        ],
      },
      customShapeCaveats: [
        'custom-shape-presets-are-stored-as-regeneratable-straight-segment-paths',
        'preset-geometry-regenerates-on-size-or-preset-change-unless-points-are-edited',
        'custom-shape-library-keeps-preset-kind-and-style-metadata-not-native-library-instance',
      ],
      blockerCodes: [],
      previewSignatureFields: ['layerId', 'shapeKind', 'bounds', 'style', 'pointCount', 'closed'],
    });
    expect(readiness.previewSignature).toBe('vector-a|rect|4,6,48,30|#22cc88:0.75|#1144ff:0.5:4|0|closed');
  });

  it('reports ellipse readiness as vector-backed with approximate convert-to-path and blocked direct booleans', () => {
    const readiness = describeImageRasterVectorShapeReadiness(ellipseVectorLayer(), { ellipseSegments: 20 });

    expect(readiness).toMatchObject({
      layerId: 'ellipse-vector',
      shapeKind: 'ellipse',
      vectorBacked: {
        supported: true,
        supportLevel: 'native-retained-vector',
      },
      rasterize: {
        ready: true,
      },
      convertToPath: {
        ready: true,
        outputKind: 'path',
        approximation: 'polygonal-ellipse-20-segments',
        blockerCodes: [],
      },
      booleanOperations: {
        ready: false,
        blockerCodes: ['ellipse-boolean-requires-convert-to-path'],
      },
      blockerCodes: ['ellipse-boolean-requires-convert-to-path'],
    });
    expect(readiness.booleanOperations.limitations).toContain('ellipse-inputs-must-convert-to-polygon-path-first');
    expect(readiness.booleanOperations.limitations).toContain(
      'ellipse-retains-fill-stroke-until-converted-to-polygon-path-operands',
    );
    expect(readiness.previewSignature).toBe('ellipse-vector|ellipse|30,40,64,32|#44ccff:0.6|#0f172a:0.8:3|0|closed');
  });

  it('keeps custom shape path readiness caveats explicit for overlapping booleans and live stacks', () => {
    const readiness = describeImageRasterVectorShapeReadiness(vectorLayer());

    expect(readiness).toMatchObject({
      layerId: 'vector-1',
      shapeKind: 'path',
      convertToPath: {
        ready: false,
        outputKind: 'already-path',
        approximation: 'none',
        blockerCodes: ['shape-already-editable-path'],
      },
      booleanOperations: {
        ready: true,
        blockerCodes: [],
      },
      customShapeCaveats: [
        'custom-shape-presets-are-stored-as-regeneratable-straight-segment-paths',
        'preset-geometry-regenerates-on-size-or-preset-change-unless-points-are-edited',
        'custom-shape-library-keeps-preset-kind-and-style-metadata-not-native-library-instance',
      ],
      blockerCodes: ['shape-already-editable-path'],
    });
    expect(readiness.booleanOperations.limitations).toEqual([
      'compound-path-holes-preserve-evenodd-only',
      'curved-bezier-segments-rasterize-or-convert-before-boolean',
      'degenerate-shared-vertex-inputs-resolve-approximately',
      'ellipse-inputs-must-convert-to-polygon-path-first',
      'ellipse-retains-fill-stroke-until-converted-to-polygon-path-operands',
      'live-boolean-operation-stack-not-retained',
      'boolean-results-flatten-source-stack-to-output-paths',
      'custom-shape-live-parametric-overlap-editing-not-supported',
    ]);
  });

  it('reports non-vector layers as blocked for retained shape workflows', () => {
    const readiness = describeImageRasterVectorShapeReadiness({
      ...vectorLayer(),
      id: 'pixel-layer',
      type: 'image',
      metadata: undefined,
    });

    expect(readiness).toMatchObject({
      layerId: 'pixel-layer',
      shapeKind: 'none',
      vectorBacked: {
        supported: false,
        supportLevel: 'not-vector',
      },
      fillStrokeControls: {
        fillColor: 'not-vector',
        fillOpacity: 'not-vector',
        strokeColor: 'not-vector',
        strokeOpacity: 'not-vector',
        strokeWidth: 'not-vector',
      },
      rasterize: {
        ready: false,
        blockerCodes: ['not-retained-vector-shape'],
      },
      convertToPath: {
        ready: false,
        outputKind: 'none',
        blockerCodes: ['not-retained-vector-shape'],
      },
      booleanOperations: {
        ready: false,
        blockerCodes: ['not-retained-vector-shape'],
      },
      blockerCodes: ['not-retained-vector-shape'],
    });
  });

  it('keeps Boolean operands and regenerates a retained live output after source geometry changes', () => {
    const first = rectVectorLayer('vector-a', 0, 0, 30, 20);
    const second = rectVectorLayer('vector-b', 10, 0, 30, 20);
    const live = createLiveImageVectorBooleanLayers('union', first, second);

    expect(live.status).toBe('exact');
    expect(live.outputLayers).toHaveLength(1);
    const output = live.outputLayers[0]!;
    expect(output.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      liveBoolean: {
        version: 1,
        operation: 'union',
        sourceLayerIds: ['vector-a', 'vector-b'],
        outputIndex: 0,
      },
    });

    const refreshed = refreshLiveImageVectorBooleanLayers([
      first,
      { ...second, x: 20 },
      output,
    ]);
    expect(refreshed.map((layer) => layer.id)).toEqual(['vector-a', 'vector-b', output.id]);
    expect(refreshed[2]?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      width: 50,
      liveBoolean: {
        operation: 'union',
        sourceLayerIds: ['vector-a', 'vector-b'],
      },
    });
  });

  it('refuses curved Bezier operands instead of silently flattening their handles', () => {
    const curved = vectorLayer({
      id: 'curved-a',
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 30,
          height: 20,
          points: [
            { x: 0, y: 0, outHandle: { x: 8, y: -6 } },
            { x: 30, y: 0, inHandle: { x: 22, y: -6 } },
            { x: 15, y: 20 },
          ],
          closed: true,
          fillColor: '#22cc88',
          fillOpacity: 0.75,
          strokeColor: '#1144ff',
          strokeOpacity: 0.5,
          strokeWidth: 4,
        },
      },
    });

    const result = createLiveImageVectorBooleanLayers(
      'union',
      curved,
      rectVectorLayer('vector-b', 8, 6, 20, 18),
    );

    expect(result.status).toBe('unsupported');
    expect(result.outputLayers).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'bezier-segments-not-supported',
        layerId: 'curved-a',
      }),
    ]);
  });
});
