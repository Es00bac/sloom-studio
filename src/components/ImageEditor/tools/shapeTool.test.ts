import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS, type ImageLayer, type LayerBitmap } from '../../../types/imageEditor';
import type { ToolEnv } from './types';

class FakeCanvasContext {
  readonly imageData: ImageData;
  fillStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';

  constructor(width: number, height: number) {
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  rect() {}
  ellipse() {}
  fill() {}
  stroke() {}
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
  drawImage() {}
  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: FakeCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(64, 64) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeEnv(docId: string): ToolEnv {
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((candidate) => candidate.id === docId)!;
  return {
    doc,
    activeLayer: doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null,
    backgroundColor: '#000000',
    brushSettings: store.brushSettings,
    cropToolSettings: store.cropToolSettings,
    gradientToolSettings: store.gradientToolSettings,
    selectionToolSettings: store.selectionToolSettings,
    shapeToolSettings: {
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#22cc88',
      fillOpacity: 0.8,
      strokeColor: '#1144ff',
      strokeOpacity: 0.6,
      strokeWidth: 6,
    },
    screenToDoc: (point: { x: number; y: number }) => point,
    docToScreen: (point: { x: number; y: number }) => point,
    pushOperation: vi.fn((operation) => store.pushOperation(operation)),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store,
  } as unknown as ToolEnv;
}

describe('shapeTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('creates a new vector rectangle layer instead of destructively painting the active bitmap layer', async () => {
    const { rectShapeTool } = await import('./shapeTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-rect-shape',
        title: 'Rect Shape',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-rect-shape');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    rectShapeTool.onPointerDown?.(env, { x: 24, y: 32 }, mods, {} as PointerEvent);
    rectShapeTool.onPointerMove?.(env, { x: 112, y: 76 }, mods, {} as PointerEvent);
    rectShapeTool.onPointerUp?.(env, { x: 112, y: 76 }, mods, {} as PointerEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-rect-shape');
    const created = doc?.layers.find((layer) => layer.id !== 'background') as
      | (ImageLayer & { metadata?: { vectorShape?: { kind?: string } } })
      | undefined;

    expect(doc?.layers).toHaveLength(2);
    expect(created?.type).toBe('vector');
    expect(created?.x).toBe(24);
    expect(created?.y).toBe(32);
    expect(created?.bitmap?.width).toBe(88);
    expect(created?.bitmap?.height).toBe(44);
    expect(created?.vectorRecipe).toContain('<svg');
    expect(created?.metadata?.originalSvgSource).toBe(created?.vectorRecipe);
    expect(created?.metadata?.vectorShape?.kind).toBe('rect');
    expect(useImageEditorStore.getState().undoStacks['doc-rect-shape']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-rect-shape',
    });
  });

  it('creates an editable ellipse vector layer with retained shape metadata', async () => {
    const { ellipseShapeTool } = await import('./shapeTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-ellipse-shape',
        title: 'Ellipse Shape',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-ellipse-shape');
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    ellipseShapeTool.onPointerDown?.(env, { x: 18, y: 20 }, mods, {} as PointerEvent);
    ellipseShapeTool.onPointerUp?.(env, { x: 74, y: 90 }, mods, {} as PointerEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-ellipse-shape');
    const created = doc?.layers.find((layer) => layer.id !== 'background') as
      | (ImageLayer & { metadata?: { vectorShape?: { kind?: string; strokeWidth?: number } } })
      | undefined;

    expect(created?.type).toBe('vector');
    expect(created?.metadata?.vectorShape?.kind).toBe('ellipse');
    expect(created?.metadata?.vectorShape?.strokeWidth).toBe(6);
    expect(created?.bitmap?.width).toBe(56);
    expect(created?.bitmap?.height).toBe(70);
  });

  it('creates a retained custom star vector path layer from the shape preset settings', async () => {
    const { rectShapeTool } = await import('./shapeTool');
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-star-shape',
        title: 'Star Shape',
        width: 320,
        height: 240,
      }),
      layers: [makeLayer({ id: 'background', name: 'Background' })],
      activeLayerId: 'background',
    });

    const env = makeEnv('doc-star-shape');
    env.shapeToolSettings = {
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      ...env.shapeToolSettings,
      presetKind: 'star',
      polygonSides: 5,
      starInnerRadius: 0.42,
    };
    const mods = { shift: false, alt: false, ctrl: false, meta: false };

    rectShapeTool.onPointerDown?.(env, { x: 40, y: 28 }, mods, {} as PointerEvent);
    rectShapeTool.onPointerMove?.(env, { x: 148, y: 132 }, mods, {} as PointerEvent);
    rectShapeTool.onPointerUp?.(env, { x: 148, y: 132 }, mods, {} as PointerEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-star-shape');
    const created = doc?.layers.find((layer) => layer.id !== 'background') as
      | (ImageLayer & {
          metadata?: {
            vectorShape?: {
              kind?: string;
              closed?: boolean;
              points?: Array<{ x: number; y: number }>;
              preset?: {
                kind?: string;
                polygonSides?: number;
                starInnerRadius?: number;
              };
            };
          };
        })
      | undefined;

    expect(created?.type).toBe('vector');
    expect(created?.x).toBe(40);
    expect(created?.y).toBe(28);
    expect(created?.metadata?.vectorShape?.kind).toBe('path');
    expect(created?.metadata?.vectorShape?.closed).toBe(true);
    expect(created?.metadata?.vectorShape?.preset).toMatchObject({
      kind: 'star',
      polygonSides: 5,
      starInnerRadius: 0.42,
    });
    expect(created?.metadata?.vectorShape?.points).toHaveLength(10);
    expect(created?.bitmap?.width).toBe(108);
    expect(created?.bitmap?.height).toBe(104);
    expect(useImageEditorStore.getState().undoStacks['doc-star-shape']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-star-shape',
    });
  });

  it('describes shape-tool vector planning without dispatching a pointer stroke', async () => {
    const { describeShapeToolVectorPlan } = await import('./shapeTool');

    expect(describeShapeToolVectorPlan({
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#22cc88',
      fillOpacity: 0.8,
      strokeColor: '#1144ff',
      strokeOpacity: 0.6,
      strokeWidth: 6,
      presetKind: 'line',
    })).toEqual({
      outputShapeKind: 'path',
      closedPath: false,
      shapeLibrary: 'signal-loom-custom-shape-library',
      nativeShapeSemantics: 'stroke-only-open-path',
      presetLibraryStatus: {
        source: 'signal-loom-custom-shape-library',
        presetKind: 'line',
        retainedPresetMetadata: true,
        retainedStyleMetadata: true,
        nativeLibraryInstance: false,
        editableParameters: [],
      },
      presetGeometry: {
        kind: 'line',
        source: 'signal-loom-custom-shape-library',
        pointCount: 2,
        closed: false,
        editableParameters: [],
        parameterSignature: 'sides:none|inner:none',
        geometrySignature: 'custom-shape-geometry|line|open|0,0,100,100|2|0,0;100,100|sides:none|inner:none',
      },
      fillBehavior: 'ignored-until-path-is-closed',
      stylePersistence: {
        retainedOnVectorLayer: true,
        editableAfterCommit: true,
        fillAppliesToOpenPath: false,
        strokeAppliesToOpenPath: true,
        persistedFields: ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'],
        svgStyleSignature: 'svg-style|fill:#22cc88:0.8|stroke:#1144ff:0.6:6',
        psdStyleSignature: 'psd-style|fill:#22cc88:0.8|stroke:#1144ff:0.6:6|metadata-only',
      },
      retainedStyleFields: ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'],
      pathPointEditability: 'endpoints-only-until-converted',
      rasterizeWarnings: [
        'rasterize-before-pixel-edit-discards-shape-tool-style-controls',
        'open-line-path-has-no-fill-until-closed',
        'rasterized-line-preserves-stroke-only-appearance',
      ],
      handoffWarnings: [
        'vector-mask-creates-closed-local-copy',
        'svg-export-keeps-straight-segments-only',
        'psd-export-keeps-layer-backed-path-only',
        'source-bin-handoff-keeps-sloom-vector-metadata-plus-svg-preview',
        'native-custom-shape-library-instances-are-not-preserved',
      ],
      booleanLimitations: [
        'boolean-ops-run-as-separate-layer-actions',
        'open-line-paths-must-close-before-boolean-materialization',
        'live-boolean-stack-unsupported',
        'bezier-boolean-operands-unsupported',
      ],
      previewSignatureFields: ['presetKind', 'fill', 'stroke', 'strokeWidth', 'closedPath'],
      previewSignature: 'shape-tool-plan|line|signal-loom-custom-shape-library|stroke-only-open-path|open|#22cc88:0.8|#1144ff:0.6:6',
    });
  });

  it('describes custom star geometry parameters in the shape-tool vector plan', async () => {
    const { describeShapeToolVectorPlan } = await import('./shapeTool');

    const plan = describeShapeToolVectorPlan({
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#facc15',
      fillOpacity: 0.7,
      strokeColor: '#1e293b',
      strokeOpacity: 0.9,
      strokeWidth: 5,
      presetKind: 'star',
      polygonSides: 7,
      starInnerRadius: 0.35,
    });

    expect(plan.presetGeometry).toEqual({
      kind: 'star',
      source: 'signal-loom-custom-shape-library',
      pointCount: 14,
      closed: true,
      editableParameters: ['polygonSides', 'starInnerRadius'],
      parameterSignature: 'sides:7|inner:0.35',
      geometrySignature: 'custom-shape-geometry|star|closed|0,0,100,100|14|50,0;57.788,36.016;90.097,19.806;67.5,48.508;100,64.31;64.034,64.084;72.252,100;50,71.016;27.748,100;35.966,64.084;0,64.31;32.5,48.508;9.903,19.806;42.212,36.016|sides:7|inner:0.35',
    });
    expect(plan.stylePersistence).toMatchObject({
      retainedOnVectorLayer: true,
      fillAppliesToOpenPath: true,
      strokeAppliesToOpenPath: true,
      svgStyleSignature: 'svg-style|fill:#facc15:0.7|stroke:#1e293b:0.9:5',
    });
    expect(plan.previewSignature).toContain('star:7:0.35');
  });

  it('describes native ellipse planning with explicit convert-to-path boolean and handoff caveats', async () => {
    const { describeShapeToolVectorPlan } = await import('./shapeTool');

    expect(describeShapeToolVectorPlan({
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#22cc88',
      fillOpacity: 0.8,
      strokeColor: '#1144ff',
      strokeOpacity: 0.6,
      strokeWidth: 6,
      presetKind: 'rect',
    }, { toolKind: 'ellipse' })).toEqual({
      outputShapeKind: 'ellipse',
      closedPath: true,
      shapeLibrary: 'native-ellipse-shape-tool',
      nativeShapeSemantics: 'retained-ellipse-shape',
      presetLibraryStatus: {
        source: 'native-ellipse-shape-tool',
        presetKind: 'rect',
        retainedPresetMetadata: false,
        retainedStyleMetadata: true,
        nativeLibraryInstance: false,
        editableParameters: [],
      },
      presetGeometry: {
        kind: 'ellipse',
        source: 'native-ellipse-shape-tool',
        pointCount: 0,
        closed: true,
        editableParameters: [],
        parameterSignature: 'native-ellipse',
        geometrySignature: 'native-ellipse-shape|parametric-bounds',
      },
      fillBehavior: 'editable-fill-and-stroke',
      stylePersistence: {
        retainedOnVectorLayer: true,
        editableAfterCommit: true,
        fillAppliesToOpenPath: true,
        strokeAppliesToOpenPath: true,
        persistedFields: ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'],
        svgStyleSignature: 'svg-style|fill:#22cc88:0.8|stroke:#1144ff:0.6:6',
        psdStyleSignature: 'psd-style|fill:#22cc88:0.8|stroke:#1144ff:0.6:6|metadata-only',
      },
      retainedStyleFields: ['fillColor', 'fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'],
      pathPointEditability: 'not-path',
      rasterizeWarnings: [
        'rasterize-before-pixel-edit-discards-shape-tool-style-controls',
        'ellipse-rasterization-freezes-parametric-shape-bounds',
      ],
      handoffWarnings: [
        'vector-mask-creates-closed-local-copy',
        'svg-export-keeps-retained-ellipse-until-general-path-conversion',
        'psd-export-keeps-raster-preview-plus-vector-metadata',
        'native-ellipse-boolean-roundtrip-not-guaranteed',
      ],
      booleanLimitations: [
        'ellipse-shapes-must-convert-to-path-before-general-boolean-materialization',
        'boolean-ops-run-as-separate-layer-actions',
        'live-boolean-stack-unsupported',
        'bezier-boolean-operands-unsupported',
      ],
      previewSignatureFields: ['toolKind', 'presetKind', 'fill', 'stroke', 'strokeWidth', 'closedPath'],
      previewSignature: 'shape-tool-plan|ellipse|rect|native-ellipse-shape-tool|retained-ellipse-shape|closed|#22cc88:0.8|#1144ff:0.6:6',
    });
  });
});
