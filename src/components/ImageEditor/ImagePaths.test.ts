import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS, type ImageLayer, type LayerBitmap, type ShapeToolSettings } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import {
  buildVectorPathLayer,
  buildVectorShapeLayerFromDrag,
  getVectorPathDocumentPoints,
  updateVectorPathLayerPoint,
} from './ImageVectorShape';
import { maskBoundingBox } from './SelectionMask';
import * as ImagePaths from './ImagePaths';
import {
  createFillLayerFromVectorPath,
  describeImagePathOperationReadinessLane,
  createStrokeLayerFromVectorPath,
  buildImagePathGeometrySignature,
  describeImagePathAnchorEditSession,
  describeImagePathsPanelReadiness,
  deleteImagePathAnchor,
  describeImagePathWorkflowCapabilities,
  getVectorPathLayers,
  insertImagePathAnchor,
  moveImagePathAnchors,
  vectorPathLayerToSelectionMask,
} from './ImagePaths';
import { attachVectorMaskToLayer, getLayerVectorMaskDescriptor, type ImageVectorMaskDescriptorInput } from './ImageVectorMasks';

class FakeOffscreenCanvasContext {
  private currentPath: Array<{ x: number; y: number }> = [];
  private imageData = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  } as ImageData;

  beginPath() {}
  rect() {}
  ellipse() {}
  moveTo(x: number, y: number) {
    this.currentPath = [{ x, y }];
  }
  lineTo(x: number, y: number) {
    this.currentPath.push({ x, y });
  }
  bezierCurveTo(_x1: number, _y1: number, _x2: number, _y2: number, x: number, y: number) {
    this.currentPath.push({ x, y });
  }
  closePath() {
    if (this.currentPath.length > 0) {
      this.currentPath.push({ ...this.currentPath[0] });
    }
  }
  fill() {}
  stroke() {
    if (this.currentPath.length < 2) return;
    for (let index = 1; index < this.currentPath.length; index += 1) {
      rasterizeLine(this.imageData, this.currentPath[index - 1]!, this.currentPath[index]!);
    }
  }
  clearRect() {
    this.imageData = {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.width * this.imageData.height * 4),
    } as ImageData;
  }
  drawImage() {}
  save() {}
  restore() {}
  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }
  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeOffscreenCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeVectorLayer(doc = createEmptyImageDocument({ id: 'doc-paths', title: 'Paths', width: 200, height: 160 })) {
  return buildVectorShapeLayerFromDrag({
    doc,
    kind: 'rect',
    from: { x: 24, y: 36 },
    to: { x: 84, y: 72 },
    settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    existingLayer: null,
  }) as ImageLayer & { metadata: NonNullable<ImageLayer['metadata']> };
}

function makeImageLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'paint',
    name: 'Paint',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(80, 60) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  return getBitmapImageData(bitmap).data[(y * bitmap.width + x) * 4 + 3] ?? 0;
}

function rasterizeLine(
  imageData: ImageData,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx - dy;
  let x = Math.round(from.x);
  let y = Math.round(from.y);

  while (true) {
    if (x >= 0 && x < imageData.width && y >= 0 && y < imageData.height) {
      const offset = (y * imageData.width + x) * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = 255;
    }
    if (x === Math.round(to.x) && y === Math.round(to.y)) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

describe('ImagePaths', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns editable vector shape layers as path entries in document order', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-list', title: 'Paths', width: 200, height: 160 });
    const rect = makeVectorLayer(doc);
    const imageLayer: ImageLayer = {
      id: 'paint',
      name: 'Paint',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
    };
    const ellipse = buildVectorShapeLayerFromDrag({
      doc,
      kind: 'ellipse',
      from: { x: 100, y: 20 },
      to: { x: 156, y: 92 },
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      existingLayer: null,
    });

    doc.layers = [rect, imageLayer, ellipse];

    expect(getVectorPathLayers(doc).map((layer) => layer.id)).toEqual([rect.id, ellipse.id]);
  });

  it('builds a document-sized selection mask from an untransformed vector path layer', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-mask', title: 'Paths', width: 200, height: 160 });
    const rect = makeVectorLayer(doc);
    doc.layers = [rect];

    const mask = vectorPathLayerToSelectionMask(doc, rect);

    expect(maskBoundingBox(mask)).toEqual({
      x: rect.x,
      y: rect.y,
      width: rect.bitmap?.width ?? 0,
      height: rect.bitmap?.height ?? 0,
    });
  });

  it('creates a layer-local reveal mask from a vector path layer', () => {
    type VectorPathToLayerMask = (
      doc: ReturnType<typeof createEmptyImageDocument>,
      pathLayer: ImageLayer,
      targetLayer: ImageLayer,
      mode?: 'reveal-selection' | 'hide-selection',
    ) => LayerBitmap;
    const createMaskFromVectorPath = (ImagePaths as unknown as {
      createLayerMaskFromVectorPath?: VectorPathToLayerMask;
    }).createLayerMaskFromVectorPath;
    const doc = createEmptyImageDocument({ id: 'doc-path-layer-mask', title: 'Path Mask', width: 200, height: 160 });
    const rect = makeVectorLayer(doc);
    const targetLayer = makeImageLayer({
      x: 20,
      y: 30,
      bitmap: new OffscreenCanvas(90, 70) as LayerBitmap,
    });

    expect(typeof createMaskFromVectorPath).toBe('function');
    if (typeof createMaskFromVectorPath !== 'function') return;

    const mask = createMaskFromVectorPath(doc, rect, targetLayer);

    expect(mask.width).toBe(90);
    expect(mask.height).toBe(70);
    expect(alphaAt(mask, 3, 6)).toBe(0);
    expect(alphaAt(mask, 4, 6)).toBe(255);
    expect(alphaAt(mask, 63, 41)).toBe(255);
    expect(alphaAt(mask, 64, 42)).toBe(0);
  });

  it('builds a retained target-local vector mask descriptor from a selected path layer', () => {
    type VectorPathToVectorMask = (
      pathLayer: ImageLayer,
      targetLayer: ImageLayer,
    ) => ImageVectorMaskDescriptorInput | null;
    const createVectorMaskDescriptor = (ImagePaths as unknown as {
      createVectorMaskDescriptorFromVectorPath?: VectorPathToVectorMask;
    }).createVectorMaskDescriptorFromVectorPath;
    const doc = createEmptyImageDocument({ id: 'doc-path-vector-mask', title: 'Vector Mask', width: 200, height: 160 });
    const path = buildVectorPathLayer({
      doc,
      points: [
        { x: 24, y: 30 },
        { x: 94, y: 30 },
        { x: 94, y: 82 },
        { x: 24, y: 82 },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    const targetLayer = makeImageLayer({
      id: 'portrait',
      name: 'Portrait',
      x: 20,
      y: 24,
      bitmap: new OffscreenCanvas(100, 80) as LayerBitmap,
    });

    expect(typeof createVectorMaskDescriptor).toBe('function');
    if (typeof createVectorMaskDescriptor !== 'function') return;

    const descriptor = createVectorMaskDescriptor(path, targetLayer);
    const maskedLayer = descriptor ? getLayerVectorMaskDescriptor(attachVectorMaskToLayer(targetLayer, descriptor)) : null;

    expect(maskedLayer).toMatchObject({
      id: 'vector-mask-portrait',
      name: `${path.name} Vector Mask`,
      targetLayerId: 'portrait',
      enabled: true,
      inverted: false,
      linked: true,
      path: {
        closed: true,
        fillRule: 'evenodd',
        bounds: { x: 4, y: 6, width: 70, height: 52 },
        points: [
          { x: 4, y: 6 },
          { x: 74, y: 6 },
          { x: 74, y: 58 },
          { x: 4, y: 58 },
        ],
      },
    });
  });

  it('builds an open-stroke selection mask for retained pen path layers instead of filling the whole bounds', () => {
    const doc = createEmptyImageDocument({ id: 'doc-open-path-mask', title: 'Open Path', width: 200, height: 160 });
    const path = buildVectorPathLayer({
      doc,
      points: [
        { x: 20, y: 24 },
        { x: 84, y: 24 },
        { x: 84, y: 88 },
      ],
      closed: false,
      settings: {
        ...DEFAULT_SHAPE_TOOL_SETTINGS,
        strokeWidth: 4,
      },
    });
    doc.layers = [path];

    const mask = vectorPathLayerToSelectionMask(doc, path);

    expect(mask.data[24 * mask.width + 52]).toBeGreaterThan(0);
    expect(mask.data[56 * mask.width + 52]).toBe(0);
  });

  it('moves retained pen path points in document coordinates and updates derived selection geometry', () => {
    const doc = createEmptyImageDocument({ id: 'doc-edit-path-point', title: 'Edit Path', width: 220, height: 180 });
    const path = buildVectorPathLayer({
      doc,
      points: [
        { x: 20, y: 24 },
        { x: 84, y: 24 },
        { x: 84, y: 88 },
      ],
      closed: false,
      settings: {
        ...DEFAULT_SHAPE_TOOL_SETTINGS,
        strokeWidth: 4,
      },
    });

    const edited = updateVectorPathLayerPoint(path, 1, { x: 132, y: 52 });

    expect(getVectorPathDocumentPoints(edited)).toEqual([
      { x: 20, y: 24 },
      { x: 132, y: 52 },
      { x: 84, y: 88 },
    ]);
    expect(edited.id).toBe(path.id);
    expect(edited.bitmapVersion).toBeGreaterThan(path.bitmapVersion);

    const mask = vectorPathLayerToSelectionMask(doc, edited);
    expect(mask.data[52 * mask.width + 132]).toBeGreaterThan(0);
    expect(mask.data[24 * mask.width + 84]).toBe(0);
  });

  it('describes open versus closed path operation validity with deterministic geometry signatures', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-operation-lane', title: 'Path Operation Lane', width: 220, height: 180 });
    const openPath = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
        ],
        closed: false,
        settings: {
          ...DEFAULT_SHAPE_TOOL_SETTINGS,
          strokeWidth: 4,
        },
      }),
      id: 'open-path-op',
      name: 'Open Path',
    };
    const closedPath = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
        ],
        closed: true,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'closed-path-op',
      name: 'Closed Path',
    };
    const targetLayer = makeImageLayer({ id: 'target-layer', name: 'Target Layer' });

    const openLane = describeImagePathOperationReadinessLane(openPath, targetLayer);
    const closedLane = describeImagePathOperationReadinessLane(closedPath, targetLayer);

    expect(buildImagePathGeometrySignature(openPath)).toBe(
      'image-path-geometry:v1:{"layerId":"open-path-op","kind":"path","closed":false,"pointCount":2,"bounds":{"x":20,"y":24,"width":64,"height":0},"points":[{"x":20,"y":24},{"x":84,"y":24}],"hasBezierHandles":false}',
    );
    expect(openLane.operations.map((operation) => [operation.kind, operation.state, operation.blockers])).toEqual([
      ['selection', 'ready', []],
      ['fill', 'ready-with-caveats', ['open-path-will-be-closed-for-fill']],
      ['stroke', 'ready', []],
      ['vector-mask', 'blocked', ['path-needs-three-points', 'open-path-not-valid-for-vector-mask']],
      ['text-on-path', 'unsupported', ['bezier-text-on-path-unsupported']],
      ['live-stroke-style', 'unsupported', ['live-stroke-styles-unsupported']],
      ['native-psd-path', 'unsupported', ['native-psd-path-fidelity-unsupported']],
    ]);
    expect(closedLane.pathValidity).toMatchObject({
      selection: 'valid',
      fill: 'valid',
      stroke: 'valid',
      vectorMask: 'valid',
    });
    expect(closedLane.signature).toContain('image-path-operation-readiness:v1:');
    expect(closedLane.signature).toContain('"geometry":"image-path-geometry:v1:');
  });

  it('creates a filled vector layer from a source path using current shape settings', () => {
    const doc = createEmptyImageDocument({ id: 'doc-fill-path', title: 'Paths', width: 200, height: 160 });
    const source = makeVectorLayer(doc);
    const settings: ShapeToolSettings = {
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#ff00aa',
      fillOpacity: 0.65,
      strokeColor: '#112233',
      strokeOpacity: 1,
      strokeWidth: 9,
    };

    const filled = createFillLayerFromVectorPath(doc, source, settings);

    expect(filled.id).not.toBe(source.id);
    expect(filled.name).toContain('Fill');
    expect(filled.type).toBe('vector');
    expect(filled.x).toBe(source.x);
    expect(filled.y).toBe(source.y);
    expect(filled.metadata?.vectorShape).toMatchObject({
      fillColor: '#ff00aa',
      fillOpacity: 0.65,
      strokeWidth: 0,
    });
  });

  it('creates a stroked vector layer from a source path using current shape settings', () => {
    const doc = createEmptyImageDocument({ id: 'doc-stroke-path', title: 'Paths', width: 200, height: 160 });
    const source = makeVectorLayer(doc);
    const settings: ShapeToolSettings = {
      ...DEFAULT_SHAPE_TOOL_SETTINGS,
      fillColor: '#ff00aa',
      fillOpacity: 0.2,
      strokeColor: '#22ffee',
      strokeOpacity: 0.55,
      strokeWidth: 7,
    };

    const stroked = createStrokeLayerFromVectorPath(doc, source, settings);

    expect(stroked.id).not.toBe(source.id);
    expect(stroked.name).toContain('Stroke');
    expect(stroked.metadata?.vectorShape).toMatchObject({
      fillOpacity: 0,
      strokeColor: '#22ffee',
      strokeOpacity: 0.55,
      strokeWidth: 7,
    });
  });

  it('describes retained path workflow capabilities with Bezier handles and honest remaining gaps', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-capabilities', title: 'Path Capabilities', width: 200, height: 160 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
        ],
        closed: false,
        settings: {
          ...DEFAULT_SHAPE_TOOL_SETTINGS,
          strokeWidth: 4,
        },
      }),
      id: 'path-capability-1',
      name: 'Ink Contour',
    };
    doc.layers = [path];

    const descriptor = describeImagePathWorkflowCapabilities(doc, {
      requireBezierHandles: true,
      requireCurvatureTool: true,
      requireIndependentSavedWorkPaths: true,
    });

    expect(descriptor.pathLayerCount).toBe(1);
    expect(descriptor.straightSegmentPathLayerCount).toBe(1);
    expect(descriptor.pathsPanel).toEqual({
      classification: 'layer-backed-paths-panel',
      savedPathPolicy: 'vector-layer-saved-path-surrogate',
      workPathPolicy: 'pen-preview-layer-before-commit',
      independentSavedWorkPaths: true,
    });
    expect(descriptor.operationReadiness).toEqual({
      loadSelection: true,
      fillPath: true,
      strokePath: true,
      rasterizeVectorMask: true,
    });
    expect(descriptor.supportStatus).toEqual({
      bezierHandles: 'supported',
      curvatureTool: 'supported',
      anchorConversion: 'supported',
      independentDirectSelection: 'supported',
      independentPathSelection: 'supported',
    });
    expect(descriptor.layers).toEqual([
      {
        layerId: 'path-capability-1',
        name: 'Ink Contour',
        kind: 'path',
        classification: 'saved-layer-path',
        closed: false,
        pointCount: 3,
        bounds: { x: 20, y: 24, width: 64, height: 64 },
        editableAnchors: true,
        anchorEditing: {
          mode: 'numeric-and-canvas-point-editing',
          canMoveAnchors: true,
          canConvertAnchors: true,
          canEditBezierHandles: true,
          limitations: [],
        },
        editReadiness: {
          retainedPath: 'layer-vector-shape-metadata',
          anchorPointEditReadiness: {
            state: 'ready-for-retained-anchor-editing',
            coordinateSpace: 'document',
            supportsPointAddDelete: true,
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
          previewSignature: 'image-path-edit-readiness:v1:{"kind":"path","pointCount":3,"closed":false,"anchorState":"ready-for-retained-anchor-editing","booleanMode":"separate-layer-boolean-actions-only","handoffWarnings":["rasterize-flattens-retained-path-editing","vector-mask-uses-closed-target-local-copy"],"interop":{"svg":"straight-segment-path-only","psd":"layer-backed-path-only"}}',
        },
        canConvertToSelection: true,
        canCreateFillLayer: true,
        canCreateStrokeLayer: true,
        canRasterizeVectorMask: true,
        hasBezierHandles: false,
        previewId: 'image-path-layer:path-capability-1',
        previewSignature: 'image-path-layer:v1:{"layerId":"path-capability-1","kind":"path","closed":false,"pointCount":3,"bounds":{"x":20,"y":24,"width":64,"height":64},"editableAnchors":true,"hasBezierHandles":false}',
      },
    ]);
    expect(descriptor.capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      storage: capability.storage,
      geometry: capability.geometry,
      output: capability.output,
      undoOperation: capability.undoOperation,
    }))).toEqual([
      {
        kind: 'straight-segment-paths',
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'anchor-editing',
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'path-to-selection',
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'selection-mask',
        undoOperation: 'selection',
      },
      {
        kind: 'path-to-fill-layer',
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'vector-fill-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'path-to-stroke-layer',
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'vector-stroke-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'bezier-handles',
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'curvature-tool',
        supported: true,
        storage: 'vector-layer',
        geometry: 'curvature',
        output: 'path-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'independent-saved-work-paths',
        supported: true,
        storage: 'document-work-path',
        geometry: 'straight-segment',
        output: 'selection-mask',
        undoOperation: 'documentState',
      },
      {
        kind: 'anchor-conversion',
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'layerOp',
      },
      {
        kind: 'independent-direct-selection',
        supported: true,
        storage: 'vector-layer',
        geometry: 'bezier',
        output: 'path-layer',
        undoOperation: 'none',
      },
      {
        kind: 'independent-path-selection',
        supported: true,
        storage: 'vector-layer',
        geometry: 'straight-segment',
        output: 'path-layer',
        undoOperation: 'none',
      },
      {
        kind: 'rasterize-vector-mask',
        supported: true,
        storage: 'vector-layer',
        geometry: 'shape-rasterization',
        output: 'vector-fill-layer',
        undoOperation: 'layerOp',
      },
    ]);
    expect(descriptor.warnings).toEqual([]);
    expect(descriptor.previewId).toBe('image-path-workflow:v2');
    expect(descriptor.previewSignature).toBe(
      'image-path-workflow:v2:{"pathLayerCount":1,"straightSegmentPathLayerCount":1,"pathsPanel":{"classification":"layer-backed-paths-panel","savedPathPolicy":"vector-layer-saved-path-surrogate","workPathPolicy":"pen-preview-layer-before-commit","independentSavedWorkPaths":true},"operationReadiness":{"loadSelection":true,"fillPath":true,"strokePath":true,"rasterizeVectorMask":true},"supportStatus":{"bezierHandles":"supported","curvatureTool":"supported","anchorConversion":"supported","independentDirectSelection":"supported","independentPathSelection":"supported"},"layers":[{"layerId":"path-capability-1","kind":"path","classification":"saved-layer-path","closed":false,"pointCount":3,"bounds":{"x":20,"y":24,"width":64,"height":64},"editableAnchors":true,"canConvertAnchors":true,"canRasterizeVectorMask":true,"hasBezierHandles":false,"previewId":"image-path-layer:path-capability-1"}],"capabilities":[{"kind":"straight-segment-paths","supported":true,"output":"path-layer"},{"kind":"anchor-editing","supported":true,"output":"path-layer"},{"kind":"path-to-selection","supported":true,"output":"selection-mask"},{"kind":"path-to-fill-layer","supported":true,"output":"vector-fill-layer"},{"kind":"path-to-stroke-layer","supported":true,"output":"vector-stroke-layer"},{"kind":"bezier-handles","supported":true,"output":"path-layer"},{"kind":"curvature-tool","supported":true,"output":"path-layer"},{"kind":"independent-saved-work-paths","supported":true,"output":"selection-mask"},{"kind":"anchor-conversion","supported":true,"output":"path-layer"},{"kind":"independent-direct-selection","supported":true,"output":"path-layer"},{"kind":"independent-path-selection","supported":true,"output":"path-layer"},{"kind":"rasterize-vector-mask","supported":true,"output":"vector-fill-layer"}],"warnings":[]}',
    );
  });

  it('captures deeper retained path edit readiness, handoff warnings, and interop caveats with deterministic signatures', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-edit-readiness', title: 'Path Edit Readiness', width: 220, height: 180 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
          { x: 20, y: 88 },
        ],
        closed: false,
        settings: {
          ...DEFAULT_SHAPE_TOOL_SETTINGS,
          strokeWidth: 4,
        },
      }),
      id: 'path-readiness-1',
      name: 'Contour Path',
    };
    doc.layers = [path];

    const workflow = describeImagePathWorkflowCapabilities(doc);
    const panel = describeImagePathsPanelReadiness(doc, {
      selectedPathLayerId: 'path-readiness-1',
      targetLayerId: 'target-layer-missing',
      includeBezierOperationCaveats: true,
      includeIndependentSavedPathCaveats: true,
    });
    const layerDescriptor = workflow.layers[0] as any;
    const panelEntry = panel.entries[0] as any;

    expect(layerDescriptor.editReadiness).toEqual({
      retainedPath: 'layer-vector-shape-metadata',
      anchorPointEditReadiness: {
        state: 'ready-for-retained-anchor-editing',
        coordinateSpace: 'document',
        supportsPointAddDelete: true,
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
      previewSignature: 'image-path-edit-readiness:v1:{"kind":"path","pointCount":4,"closed":false,"anchorState":"ready-for-retained-anchor-editing","booleanMode":"separate-layer-boolean-actions-only","handoffWarnings":["rasterize-flattens-retained-path-editing","vector-mask-uses-closed-target-local-copy"],"interop":{"svg":"straight-segment-path-only","psd":"layer-backed-path-only"}}',
    });
    expect(panelEntry.editReadiness).toEqual(layerDescriptor.editReadiness);
    expect(panel.previewSignature).toContain('"editSignature":"image-path-edit-readiness:v1:{\\"kind\\":\\"path\\",\\"pointCount\\":4,\\"closed\\":false,\\"anchorState\\":\\"ready-for-retained-anchor-editing\\",\\"booleanMode\\":\\"separate-layer-boolean-actions-only\\",\\"handoffWarnings\\":[\\"rasterize-flattens-retained-path-editing\\",\\"vector-mask-uses-closed-target-local-copy\\"],\\"interop\\":{\\"svg\\":\\"straight-segment-path-only\\",\\"psd\\":\\"layer-backed-path-only\\"}}"');
  });

  it('summarizes layer-backed Paths panel entries with ready canvas thumbnails and deterministic signatures', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-ready', title: 'Path Panel', width: 200, height: 160 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'path-panel-1',
      name: 'Panel Path',
    };
    const targetLayer = makeImageLayer({ id: 'target-layer', name: 'Target Layer', locked: false });
    doc.layers = [targetLayer, path];

    const readiness = describeImagePathsPanelReadiness(doc, {
      selectedPathLayerId: 'path-panel-1',
      targetLayerId: 'target-layer',
      includeBezierOperationCaveats: true,
      includeIndependentSavedPathCaveats: true,
    });

    expect(readiness.summary).toEqual({
      totalEntries: 1,
      workPathEntries: 0,
      savedPathEntries: 1,
      layerBackedPathEntries: 1,
      selectedEntryId: 'path-panel-1',
      targetLayerId: 'target-layer',
    });
    expect(readiness.visibility).toEqual({
      panel: 'visible',
      reason: 'path-entries-available',
      selectedEntryVisible: true,
    });
    expect(readiness.conversionTargets).toEqual({
      selection: 'selection-mask',
      fill: 'retained-vector-fill-layer-copy',
      stroke: 'retained-vector-stroke-layer-copy',
      vectorMask: 'target-local-retained-vector-mask',
    });
    expect(readiness.exportCaveats.map((caveat) => caveat.code)).toEqual([
      'svg-export-retains-straight-segments-only',
      'psd-export-flattens-independent-path-records',
    ]);
    expect(readiness.actionSuitability).toEqual({
      panelCommands: 'suitable',
      batchActions: 'suitable-with-selected-entry-and-target',
      macroPlayback: 'suitable-deterministic',
      arbitraryBezierEditing: 'suitable',
    });
    expect(readiness.entries).toEqual([
      {
        id: 'path-panel-1',
        layerId: 'path-panel-1',
        name: 'Panel Path',
        source: 'layer-backed-saved-path',
        record: {
          storage: 'vector-layer',
          persistence: 'layer-stack',
          editableState: 'straight-anchor-editable',
        },
        kind: 'path',
        closed: false,
        pointCount: 3,
        bounds: { x: 20, y: 24, width: 64, height: 64 },
        editReadiness: {
          retainedPath: 'layer-vector-shape-metadata',
          anchorPointEditReadiness: {
            state: 'ready-for-retained-anchor-editing',
            coordinateSpace: 'document',
            supportsPointAddDelete: true,
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
          previewSignature: 'image-path-edit-readiness:v1:{"kind":"path","pointCount":3,"closed":false,"anchorState":"ready-for-retained-anchor-editing","booleanMode":"separate-layer-boolean-actions-only","handoffWarnings":["rasterize-flattens-retained-path-editing","vector-mask-uses-closed-target-local-copy"],"interop":{"svg":"straight-segment-path-only","psd":"layer-backed-path-only"}}',
        },
        thumbnail: {
          supported: true,
          status: 'ready',
          renderer: 'canvas',
          width: 28,
          height: 28,
          signature: 'image-path-panel-thumbnail:v1:path-panel-1:{"kind":"path","width":64,"height":64,"closed":false,"pointCount":3,"fillColor":"#ffffff","fillOpacity":1,"strokeColor":"#000000","strokeOpacity":1,"strokeWidth":1}',
        },
        previewId: 'image-path-panel-entry:path-panel-1',
        previewSignature: expect.stringContaining('"thumbnailRenderer":"canvas"'),
      },
    ]);
    expect(readiness.operations).toEqual({
      loadSelection: {
        ready: true,
        blockers: [],
        caveats: ['straight-segment-rasterization'],
      },
      fillPath: {
        ready: true,
        blockers: [],
        caveats: ['creates-vector-fill-layer-copy'],
      },
      strokePath: {
        ready: true,
        blockers: [],
        caveats: ['uses-current-shape-stroke-settings'],
      },
      createVectorMask: {
        ready: true,
        blockers: [],
        caveats: ['requires-three-or-more-source-points', 'target-local-retained-path'],
      },
    });
    expect(readiness.caveats).toEqual([]);
    expect(readiness.previewId).toBe('image-paths-panel-readiness:v1');
    expect(readiness.previewSignature).toBe(
      'image-paths-panel-readiness:v1:'
      + JSON.stringify({
        summary: {
          totalEntries: 1,
          workPathEntries: 0,
          savedPathEntries: 1,
          layerBackedPathEntries: 1,
          selectedEntryId: 'path-panel-1',
          targetLayerId: 'target-layer',
        },
        entries: [
          JSON.parse(
            readiness.entries[0]!.previewSignature.replace('image-path-panel-entry:v1:', ''),
          ),
        ],
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
        caveats: [],
      }),
    );
  });

  it('reports deterministic Paths panel operation blockers without a selected path or writable target layer', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-blocked', title: 'Path Panel Blocked', width: 200, height: 160 });
    const path = {
      ...makeVectorLayer(doc),
      id: 'path-panel-blocked',
      name: 'Blocked Path',
    };
    const lockedTarget = makeImageLayer({ id: 'locked-target', name: 'Locked Target', locked: true });
    doc.layers = [lockedTarget, path];

    const readiness = describeImagePathsPanelReadiness(doc, {
      selectedPathLayerId: 'missing-path',
      targetLayerId: 'locked-target',
    });

    expect(readiness.summary).toEqual({
      totalEntries: 1,
      workPathEntries: 0,
      savedPathEntries: 1,
      layerBackedPathEntries: 1,
      selectedEntryId: null,
      targetLayerId: 'locked-target',
    });
    expect(readiness.operations.loadSelection).toEqual({
      ready: false,
      blockers: ['selected-path-missing'],
      caveats: ['straight-segment-rasterization'],
    });
    expect(readiness.operations.fillPath).toEqual({
      ready: false,
      blockers: ['selected-path-missing'],
      caveats: ['creates-vector-fill-layer-copy'],
    });
    expect(readiness.operations.strokePath).toEqual({
      ready: false,
      blockers: ['selected-path-missing'],
      caveats: ['uses-current-shape-stroke-settings'],
    });
    expect(readiness.operations.createVectorMask).toEqual({
      ready: false,
      blockers: ['selected-path-missing', 'target-layer-locked'],
      caveats: ['requires-three-or-more-source-points', 'target-local-retained-path'],
    });
    expect(readiness.operationBlockers).toEqual([
      'selected-path-missing',
      'target-layer-locked',
    ]);
    expect(readiness.actionSuitability).toMatchObject({
      panelCommands: 'blocked',
      batchActions: 'blocked',
    });
  });

  it('reports empty Paths panel state as unsupported for path operations', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-empty', title: 'Empty Path Panel', width: 200, height: 160 });
    doc.layers = [makeImageLayer({ id: 'paint-only', name: 'Paint Only' })];

    const readiness = describeImagePathsPanelReadiness(doc, {
      targetLayerId: 'paint-only',
    });

    expect(readiness.summary).toEqual({
      totalEntries: 0,
      workPathEntries: 0,
      savedPathEntries: 0,
      layerBackedPathEntries: 0,
      selectedEntryId: null,
      targetLayerId: 'paint-only',
    });
    expect(readiness.operations).toEqual({
      loadSelection: {
        ready: false,
        blockers: ['no-path-entries'],
        caveats: ['straight-segment-rasterization'],
      },
      fillPath: {
        ready: false,
        blockers: ['no-path-entries'],
        caveats: ['creates-vector-fill-layer-copy'],
      },
      strokePath: {
        ready: false,
        blockers: ['no-path-entries'],
        caveats: ['uses-current-shape-stroke-settings'],
      },
      createVectorMask: {
        ready: false,
        blockers: ['no-path-entries'],
        caveats: ['requires-three-or-more-source-points', 'target-local-retained-path'],
      },
    });
    expect(readiness.operationBlockers).toEqual(['no-path-entries']);
    expect(readiness.entries).toEqual([]);
    expect(readiness.visibility).toEqual({
      panel: 'empty',
      reason: 'no-path-entries',
      selectedEntryVisible: false,
    });
  });

  it('reports work-path records and invalid vector-mask blockers for short paths', () => {
    const doc = createEmptyImageDocument({ id: 'doc-work-path-short', title: 'Work Path', width: 200, height: 160 });
    const target = makeImageLayer({ id: 'target-for-work-path', name: 'Target' });
    doc.layers = [target];

    const readiness = describeImagePathsPanelReadiness(doc, {
      selectedPathLayerId: 'work-short',
      targetLayerId: 'target-for-work-path',
      workPathEntries: [
        {
          id: 'work-short',
          name: 'Unsaved Work Path',
          closed: false,
          pointCount: 2,
          bounds: { x: 12, y: 18, width: 60, height: 0 },
          kind: 'work',
        },
      ],
    });

    expect(readiness.summary).toMatchObject({
      totalEntries: 1,
      workPathEntries: 1,
      savedPathEntries: 0,
      selectedEntryId: 'work-short',
      targetLayerId: 'target-for-work-path',
    });
    expect(readiness.entries[0]).toMatchObject({
      id: 'work-short',
      layerId: null,
      source: 'document-work-path',
      kind: 'work-path',
      record: {
        storage: 'document-work-path',
        persistence: 'temporary-session',
        editableState: 'straight-anchor-editable',
      },
    });
    expect(readiness.entries[0].thumbnail).toEqual({
      supported: false,
      status: 'unsupported',
      reason: 'independent-saved-path-thumbnails-unsupported',
      renderer: 'none',
      width: 28,
      height: 28,
      signature: 'image-path-panel-thumbnail:v1:unsupported:independent-saved-path-thumbnails-unsupported',
    });
    expect(readiness.operations.createVectorMask).toEqual({
      ready: false,
      blockers: ['selected-path-needs-three-points'],
      caveats: ['requires-three-or-more-source-points', 'target-local-retained-path'],
    });
    expect(readiness.operationBlockers).toEqual(['selected-path-needs-three-points']);
    expect(readiness.actionSuitability.batchActions).toBe('blocked');
  });

  it('exposes independent saved-path metadata, operation checks, unsupported states, and signature groups', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-signatures', title: 'Path Signatures', width: 200, height: 160 });
    const target = makeImageLayer({ id: 'target-layer', name: 'Target Layer' });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
          { x: 20, y: 88 },
        ],
        closed: true,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'saved-path-1',
      name: 'Saved Path One',
    };
    doc.layers = [target, path];

    const readiness = describeImagePathsPanelReadiness(doc, {
      selectedPathLayerId: 'saved-path-1',
      targetLayerId: 'target-layer',
      workPathEntries: [
        {
          id: 'work-path-1',
          name: 'Active Work Path',
          closed: false,
          pointCount: 3,
          bounds: { x: 12, y: 18, width: 48, height: 32 },
          kind: 'work',
        },
      ],
      includeBezierOperationCaveats: true,
      includeIndependentSavedPathCaveats: true,
    });

    expect(readiness.independentSavedPaths).toEqual({
      state: 'document-records',
      detachedDocumentRecordsSupported: true,
      savedPathMetadataEditable: true,
      durableRepresentation: 'document-record',
      workPathRepresentation: 'document-record',
      layerBackedSavedPathCount: 1,
      temporaryWorkPathCount: 1,
      detachedSavedPathCount: 0,
      blockers: [],
      caveats: ['saved-paths-use-vector-layer-surrogates'],
      signature: 'image-paths-independent-saved-paths:v1:{"state":"document-records","layerBackedSavedPathCount":1,"temporaryWorkPathCount":1,"detachedSavedPathCount":0,"detachedDocumentRecordsSupported":true,"savedPathMetadataEditable":true,"blockers":[],"caveats":["saved-paths-use-vector-layer-surrogates"]}',
    });
    expect(readiness.thumbnailReadiness).toEqual({
      state: 'mixed',
      renderer: 'mixed',
      readyCount: 1,
      unsupportedCount: 1,
      signatures: readiness.entries.map((entry) => entry.thumbnail.signature),
      signature: `image-paths-panel-thumbnails:v1:${JSON.stringify({
        state: 'mixed',
        renderer: 'mixed',
        readyCount: 1,
        unsupportedCount: 1,
        signatures: readiness.entries.map((entry) => entry.thumbnail.signature),
      })}`,
    });
    expect(readiness.operationChecks.loadSelection).toEqual({
      checkId: 'image-paths-panel-operation:loadSelection',
      operation: 'loadSelection',
      readiness: 'ready',
      ready: true,
      selectedEntryId: 'saved-path-1',
      targetLayerId: 'target-layer',
      blockers: [],
      caveats: ['straight-segment-rasterization'],
      signature: 'image-paths-panel-operation:v1:{"operation":"loadSelection","ready":true,"selectedEntryId":"saved-path-1","targetLayerId":"target-layer","blockers":[],"caveats":["straight-segment-rasterization"]}',
    });
    expect(readiness.operationChecks.createVectorMask).toEqual({
      checkId: 'image-paths-panel-operation:createVectorMask',
      operation: 'createVectorMask',
      readiness: 'ready',
      ready: true,
      selectedEntryId: 'saved-path-1',
      targetLayerId: 'target-layer',
      blockers: [],
      caveats: ['requires-three-or-more-source-points', 'target-local-retained-path'],
      signature: 'image-paths-panel-operation:v1:{"operation":"createVectorMask","ready":true,"selectedEntryId":"saved-path-1","targetLayerId":"target-layer","blockers":[],"caveats":["requires-three-or-more-source-points","target-local-retained-path"]}',
    });
    expect(readiness.unsupportedStates).toEqual([]);
    expect(readiness.signatures).toEqual({
      entries: readiness.entries.map((entry) => entry.previewSignature),
      thumbnails: readiness.entries.map((entry) => entry.thumbnail.signature),
      thumbnailReadiness: readiness.thumbnailReadiness.signature,
      operations: 'image-paths-panel-operations:v1:{"loadSelection":{"ready":true,"blockers":[]},"fillPath":{"ready":true,"blockers":[]},"strokePath":{"ready":true,"blockers":[]},"createVectorMask":{"ready":true,"blockers":[]}}',
      independentSavedPaths: readiness.independentSavedPaths.signature,
      unsupportedStates: 'image-paths-panel-unsupported-states:v1:{"codes":[]}',
    });
    expect(readiness.previewSignature).toContain('"independentSavedPaths":"image-paths-independent-saved-paths:v1:');
    expect(readiness.previewSignature).toContain('"operationSignatures"');
    expect(readiness.previewSignature).toContain('"unsupportedStates":[]');
  });

  it('describes selected path-anchor edit sessions with operation readiness and unsupported Bezier states', () => {
    const doc = createEmptyImageDocument({ id: 'doc-anchor-edit-session', title: 'Anchor Session', width: 220, height: 180 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
          { x: 20, y: 88 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'anchor-session-path',
      name: 'Anchor Session Path',
    };

    const session = describeImagePathAnchorEditSession(path, {
      selectedAnchorIndices: [1, 2, 2, 99],
      activeAnchorIndex: 2,
    });

    expect(session).toEqual({
      layerId: 'anchor-session-path',
      pathKind: 'path',
      status: 'ready',
      coordinateSpace: 'document',
      anchorCount: 4,
      selection: {
        mode: 'multi-anchor',
        requestedAnchorIndices: [1, 2, 2, 99],
        selectedAnchorIndices: [1, 2],
        activeAnchorIndex: 2,
        selectedBounds: { x: 84, y: 24, width: 1, height: 64 },
      },
      operations: {
        moveSelectedAnchors: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
        nudgeSelectedAnchors: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
        addAnchor: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
        deleteAnchor: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
        convertAnchor: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
        editBezierHandles: {
          ready: true,
          blockers: [],
          result: 'retained-vector-path-layer',
        },
      },
      unsupportedStates: [],
      blockers: [],
      previewId: 'image-path-anchor-edit-session:anchor-session-path',
      previewSignature: 'image-path-anchor-edit-session:v1:{"layerId":"anchor-session-path","pathKind":"path","status":"ready","anchorCount":4,"selectedAnchorIndices":[1,2],"activeAnchorIndex":2,"selectedBounds":{"x":84,"y":24,"width":1,"height":64},"operationReady":{"move":true,"nudge":true,"add":true,"delete":true,"convert":true,"bezier":true},"unsupported":[],"blockers":[]}',
    });
  });

  it('treats retained Bezier path handles as editable path-anchor state', () => {
    const doc = createEmptyImageDocument({ id: 'doc-anchor-bezier-session', title: 'Anchor Bezier Session', width: 220, height: 180 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24, outHandle: { x: 50, y: 12 } },
          { x: 84, y: 88, inHandle: { x: 62, y: 90 } },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'anchor-bezier-session-path',
      name: 'Anchor Bezier Session Path',
    };

    const session = describeImagePathAnchorEditSession(path, {
      selectedAnchorIndices: [0],
      activeAnchorIndex: 0,
    });

    expect(session.operations.editBezierHandles).toEqual({
      ready: true,
      blockers: [],
      result: 'retained-vector-path-layer',
    });
    expect(session.unsupportedStates.map((state) => state.code)).toEqual([
    ]);
    expect(session.previewSignature).toContain('"bezier":true');
    expect(session.previewSignature).not.toContain('bezier-handle-editing-unsupported');
  });

  it('moves multiple selected path anchors with document bounds and stable mutation signatures', () => {
    const doc = createEmptyImageDocument({ id: 'doc-anchor-move', title: 'Anchor Move', width: 100, height: 90 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
          { x: 20, y: 88 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'anchor-move-path',
      name: 'Anchor Move Path',
    };

    const result = moveImagePathAnchors(path, {
      anchorIndices: [1, 2, 99],
      delta: { x: 30, y: -40 },
      documentBounds: { width: 100, height: 90 },
    });

    expect(result.status).toBe('updated');
    expect(result.movedAnchorIndices).toEqual([1, 2]);
    expect(result.clamped).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.beforePoints).toEqual([
      { x: 20, y: 24 },
      { x: 84, y: 24 },
      { x: 84, y: 88 },
      { x: 20, y: 88 },
    ]);
    expect(result.afterPoints).toEqual([
      { x: 20, y: 24 },
      { x: 100, y: 0 },
      { x: 100, y: 48 },
      { x: 20, y: 88 },
    ]);
    expect(getVectorPathDocumentPoints(result.layer)).toEqual(result.afterPoints);
    expect(result.layer.id).toBe(path.id);
    expect(result.layer.bitmapVersion).toBeGreaterThan(path.bitmapVersion);
    expect(result.previewSignature).toBe(
      'image-path-anchor-move:v1:{"status":"updated","layerId":"anchor-move-path","movedAnchorIndices":[1,2],"delta":{"x":30,"y":-40},"documentBounds":{"width":100,"height":90},"clamped":true,"blockers":[],"beforePoints":[{"x":20,"y":24},{"x":84,"y":24},{"x":84,"y":88},{"x":20,"y":88}],"afterPoints":[{"x":20,"y":24},{"x":100,"y":0},{"x":100,"y":48},{"x":20,"y":88}]}',
    );
  });

  it('inserts and deletes straight path anchors without rasterizing retained path metadata', () => {
    const doc = createEmptyImageDocument({ id: 'doc-anchor-structure', title: 'Anchor Structure', width: 100, height: 90 });
    const path = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 20, y: 24 },
          { x: 84, y: 24 },
          { x: 84, y: 88 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'anchor-structure-path',
      name: 'Anchor Structure Path',
    };

    const inserted = insertImagePathAnchor(path, {
      afterAnchorIndex: 0,
      point: { x: 180, y: -12 },
      documentBounds: { width: 100, height: 90 },
    });

    expect(inserted.status).toBe('updated');
    expect(inserted.anchorIndex).toBe(1);
    expect(inserted.clamped).toBe(true);
    expect(inserted.blockers).toEqual([]);
    expect(inserted.beforePoints).toEqual([
      { x: 20, y: 24 },
      { x: 84, y: 24 },
      { x: 84, y: 88 },
    ]);
    expect(inserted.afterPoints).toEqual([
      { x: 20, y: 24 },
      { x: 100, y: 0 },
      { x: 84, y: 24 },
      { x: 84, y: 88 },
    ]);
    expect(getVectorPathDocumentPoints(inserted.layer)).toEqual(inserted.afterPoints);
    expect(inserted.layer.id).toBe(path.id);
    expect(inserted.layer.bitmapVersion).toBeGreaterThan(path.bitmapVersion);
    expect(inserted.previewSignature).toBe(
      'image-path-anchor-structure:v1:{"operation":"insert","status":"updated","layerId":"anchor-structure-path","anchorIndex":1,"documentBounds":{"width":100,"height":90},"clamped":true,"blockers":[],"beforePoints":[{"x":20,"y":24},{"x":84,"y":24},{"x":84,"y":88}],"afterPoints":[{"x":20,"y":24},{"x":100,"y":0},{"x":84,"y":24},{"x":84,"y":88}]}',
    );

    const deleted = deleteImagePathAnchor(inserted.layer, { anchorIndex: 1 });

    expect(deleted.status).toBe('updated');
    expect(deleted.anchorIndex).toBe(1);
    expect(deleted.clamped).toBe(false);
    expect(deleted.blockers).toEqual([]);
    expect(deleted.afterPoints).toEqual([
      { x: 20, y: 24 },
      { x: 84, y: 24 },
      { x: 84, y: 88 },
    ]);
    expect(getVectorPathDocumentPoints(deleted.layer)).toEqual(deleted.afterPoints);
    expect(deleted.previewSignature).toBe(
      'image-path-anchor-structure:v1:{"operation":"delete","status":"updated","layerId":"anchor-structure-path","anchorIndex":1,"clamped":false,"blockers":[],"beforePoints":[{"x":20,"y":24},{"x":100,"y":0},{"x":84,"y":24},{"x":84,"y":88}],"afterPoints":[{"x":20,"y":24},{"x":84,"y":24},{"x":84,"y":88}]}',
    );
  });
});
