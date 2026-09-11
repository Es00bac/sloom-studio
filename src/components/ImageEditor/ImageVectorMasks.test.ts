import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import {
  attachVectorMaskToLayer,
  describeVectorMaskPathOperationReadiness,
  getLayerVectorMaskDescriptor,
  planLayerVectorMaskRasterization,
  rasterizeLayerVectorMask,
  summarizeLayerVectorMaskReadiness,
} from './ImageVectorMasks';

class FakeOffscreenCanvasContext {
  private imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  drawImage() {}

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
  private readonly context: FakeOffscreenCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeOffscreenCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeImageLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'image-layer',
    name: 'Image',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 10,
    y: 20,
    bitmap: new OffscreenCanvas(8, 6) as LayerBitmap,
    bitmapVersion: 3,
    mask: new OffscreenCanvas(8, 6) as LayerBitmap,
    metadata: {
      sourceLabel: 'Generated frame',
    },
    ...overrides,
  };
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  return getBitmapImageData(bitmap).data[(y * bitmap.width + x) * 4 + 3] ?? 0;
}

describe('ImageVectorMasks', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a path-backed vector mask descriptor on an image layer without mutating existing pixel mask state', () => {
    const layer = makeImageLayer();

    const masked = attachVectorMaskToLayer(layer, {
      id: 'vm-1',
      name: 'Panel crop',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1.4, y: 1.4 },
          { x: 5.6, y: 1.4 },
          { x: 5.6, y: 4.6 },
          { x: 1.4, y: 4.6 },
        ],
      },
    });

    expect(masked).not.toBe(layer);
    expect(masked.mask).toBe(layer.mask);
    expect(masked.bitmapVersion).toBe(layer.bitmapVersion);
    expect(masked.metadata?.sourceLabel).toBe('Generated frame');
    expect(getLayerVectorMaskDescriptor(masked)).toEqual({
      id: 'vm-1',
      name: 'Panel crop',
      kind: 'path',
      targetLayerId: 'image-layer',
      enabled: true,
      inverted: false,
      linked: true,
      path: {
        closed: true,
        fillRule: 'evenodd',
        bounds: { x: 1, y: 1, width: 5, height: 4 },
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });
  });

  it('normalizes vector mask bounds, target layer id, inversion, and link flags', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-normalized',
      name: 'Normalized mask',
      kind: 'path',
      enabled: true,
      inverted: true,
      linked: false,
      path: {
        closed: true,
        points: [
          { x: 1.2, y: 2.8 },
          { x: Number.NaN, y: 8 },
          { x: 6.7, y: 2.2 },
          { x: 6.4, y: 5.7 },
          { x: 1.1, y: 5.2 },
        ],
      },
    });

    expect(getLayerVectorMaskDescriptor(masked)).toEqual({
      id: 'vm-normalized',
      name: 'Normalized mask',
      kind: 'path',
      targetLayerId: 'image-layer',
      enabled: true,
      inverted: true,
      linked: false,
      path: {
        closed: true,
        fillRule: 'evenodd',
        bounds: { x: 1, y: 2, width: 6, height: 4 },
        points: [
          { x: 1, y: 3 },
          { x: 7, y: 2 },
          { x: 6, y: 6 },
          { x: 1, y: 5 },
        ],
      },
    });
  });

  it('rasterizes the retained vector mask deterministically to the current layer mask size', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-rect',
      name: 'Rectangular vector mask',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const raster = rasterizeLayerVectorMask(masked);

    expect(raster.width).toBe(8);
    expect(raster.height).toBe(6);
    expect(alphaAt(raster, 0, 0)).toBe(0);
    expect(alphaAt(raster, 2, 2)).toBe(255);
    expect(alphaAt(raster, 5, 4)).toBe(255);
    expect(alphaAt(raster, 7, 5)).toBe(0);
  });

  it('honors inverted vector masks during rasterization', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-inverted',
      name: 'Inverted vector mask',
      kind: 'path',
      targetLayerId: 'image-layer',
      enabled: true,
      inverted: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const raster = rasterizeLayerVectorMask(masked);

    expect(alphaAt(raster, 0, 0)).toBe(255);
    expect(alphaAt(raster, 2, 2)).toBe(0);
    expect(alphaAt(raster, 7, 5)).toBe(255);
  });

  it('plans vector mask rasterization metadata with output dimensions and unsupported capability warnings', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-plan',
      name: 'Planned vector mask',
      kind: 'path',
      enabled: true,
      linked: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const plan = planLayerVectorMaskRasterization(masked);

    expect(plan).toEqual({
      layerId: 'image-layer',
      descriptorId: 'vm-plan',
      targetLayerId: 'image-layer',
      enabled: true,
      inverted: false,
      linked: true,
      canRasterize: true,
      outputWidth: 8,
      outputHeight: 6,
      outputSource: 'layer-mask',
      pathBounds: { x: 1, y: 1, width: 5, height: 4 },
      preview: {
        id: 'vector-mask-preview:image-layer:vm-plan',
        signature: 'vector-mask:v1:{"layerId":"image-layer","descriptorId":"vm-plan","targetLayerId":"image-layer","enabled":true,"inverted":false,"linked":true,"outputWidth":8,"outputHeight":6,"outputSource":"layer-mask","pathBounds":{"x":1,"y":1,"width":5,"height":4},"canRasterize":true,"warnings":["live-bezier-editing-unsupported","advanced-path-operations-unsupported","boolean-operations-unsupported","psd-vector-mask-roundtrip-limited"]}',
      },
      readiness: {
        readinessId: 'vector-mask-rasterize:image-layer:vm-plan',
        action: 'rasterize',
        state: 'ready-with-caveats',
        blockingWarningCodes: [],
        exportCaveat: 'Vector masks can be rasterized to layer-mask alpha, but editable PSD vector-mask round-trip metadata is limited.',
      },
      limitations: [
        {
          code: 'live-bezier-editing-unsupported',
          category: 'editing',
          severity: 'warning',
          message: 'Live Bezier handle editing is not available for vector masks yet.',
        },
        {
          code: 'advanced-path-operations-unsupported',
          category: 'boolean',
          severity: 'warning',
          message: 'Advanced vector mask path operations are not available yet.',
        },
        {
          code: 'boolean-operations-unsupported',
          category: 'boolean',
          severity: 'warning',
          message: 'Vector mask boolean combine/subtract/intersect/exclude modes are not modeled yet.',
        },
        {
          code: 'psd-vector-mask-roundtrip-limited',
          category: 'psd',
          severity: 'warning',
          message: 'PSD handoff can preserve rasterized alpha, but editable vector mask metadata is limited.',
        },
      ],
      exportCaveats: [
        'Live preview/export composites retained vector masks as rasterized alpha.',
        'Editable PSD vector mask round-trip and boolean operations remain limited.',
      ],
      targetMismatch: null,
      warnings: [
        {
          code: 'live-bezier-editing-unsupported',
          message: 'Live Bezier handle editing is not available for vector masks yet.',
        },
        {
          code: 'advanced-path-operations-unsupported',
          message: 'Advanced vector mask path operations are not available yet.',
        },
        {
          code: 'boolean-operations-unsupported',
          message: 'Vector mask boolean combine/subtract/intersect/exclude modes are not modeled yet.',
        },
        {
          code: 'psd-vector-mask-roundtrip-limited',
          message: 'PSD handoff can preserve rasterized alpha, but editable vector mask metadata is limited.',
        },
      ],
    });
  });

  it('can still report live vector render as unsupported for external handoff targets', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-external',
      name: 'External mask',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const plan = planLayerVectorMaskRasterization(masked, { liveVectorRender: false });

    expect(plan.warnings.map((warning) => warning.code)).toContain('live-vector-render-unsupported');
    expect(plan.limitations.map((limitation) => limitation.category)).toContain('rendering');
  });

  it('adds target mismatch details to vector mask rasterization planning', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-mismatch',
      name: 'Mismatched vector mask',
      kind: 'path',
      targetLayerId: 'other-layer',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const plan = planLayerVectorMaskRasterization(masked, {
      liveBezierEditing: true,
      advancedPathOperations: true,
    });

    expect(plan.canRasterize).toBe(true);
    expect(plan.targetMismatch).toEqual({
      expectedLayerId: 'other-layer',
      actualLayerId: 'image-layer',
      warningCode: 'target-layer-mismatch',
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'target-layer-mismatch',
      'boolean-operations-unsupported',
      'psd-vector-mask-roundtrip-limited',
    ]);
  });

  it('summarizes retained vector mask readiness with target, link, invert, action, and batch suitability', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-readiness',
      name: 'Readiness mask',
      kind: 'path',
      enabled: true,
      inverted: true,
      linked: false,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const readiness = summarizeLayerVectorMaskReadiness(masked, {
      liveBezierEditing: true,
      advancedPathOperations: true,
      liveVectorRender: true,
    });

    expect(readiness.retained).toEqual({
      present: true,
      descriptorId: 'vm-readiness',
      pathEditable: true,
      preservesVectorPath: true,
      targetLayerId: 'image-layer',
      enabled: true,
      linked: false,
      inverted: true,
    });
    expect(readiness.state).toEqual({
      targetLayerId: 'image-layer',
      targetMatchesLayer: true,
      enabled: true,
      linked: false,
      inverted: true,
    });
    expect(readiness.actions.map((action) => [action.kind, action.state, action.batchSuitable])).toEqual([
      ['retain', 'ready', true],
      ['rasterize', 'ready', true],
      ['toggle-invert', 'ready', true],
      ['toggle-link', 'ready', true],
      ['boolean-combine', 'unsupported', false],
      ['boolean-subtract', 'unsupported', false],
      ['boolean-intersect', 'unsupported', false],
      ['boolean-exclude', 'unsupported', false],
      ['psd-editable-roundtrip', 'unsupported', false],
    ]);
    expect(readiness.batch).toEqual({
      rasterizeSuitable: true,
      retainSuitable: true,
      blockingWarningCodes: [],
      caveats: [
        'Batch rasterization is deterministic for closed finite polygon vector masks.',
        'Batch retain handoff preserves metadata, but external PSD consumers may not reopen it as an editable vector mask.',
      ],
    });
  });

  it('keeps unsupported boolean and PSD vector-mask states explicit in handoff readiness', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-unsupported',
      name: 'Unsupported states',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const readiness = summarizeLayerVectorMaskReadiness(masked);

    expect(readiness.unsupportedStates).toEqual([
      {
        code: 'boolean-vector-mask-live-stack-unsupported',
        category: 'boolean',
        state: 'unsupported',
        message: 'Live vector-mask boolean stacks are not retained; materialize supported path booleans before masking.',
      },
      {
        code: 'psd-editable-vector-mask-roundtrip-unsupported',
        category: 'psd',
        state: 'unsupported',
        message: 'PSD handoff can carry rasterized alpha and metadata caveats, not a guaranteed editable Photoshop vector mask.',
      },
    ]);
    expect(readiness.handoffCaveats).toEqual([
      'Retained vector masks stay editable inside Sloom Studio as path metadata.',
      'Preview/export rasterizes vector masks to alpha for deterministic output.',
      'PSD handoff should be treated as metadata/raster-alpha preservation, not native editable vector-mask parity.',
      'Boolean vector-mask stacks, overlaps, and live PSD vector-mask states remain unsupported.',
    ]);
  });

  it('blocks rasterize and batch suitability when the retained vector mask is not rasterizable', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-open',
      name: 'Open path',
      kind: 'path',
      enabled: true,
      path: {
        closed: false,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
        ],
      },
    });

    const readiness = summarizeLayerVectorMaskReadiness(masked);

    expect(readiness.actions.find((action) => action.kind === 'rasterize')).toMatchObject({
      state: 'blocked',
      batchSuitable: false,
      blockingWarningCodes: ['open-path-not-rasterized'],
    });
    expect(readiness.batch).toMatchObject({
      rasterizeSuitable: false,
      retainSuitable: true,
      blockingWarningCodes: ['open-path-not-rasterized'],
    });
  });

  it('describes vector-mask path operation blockers for open paths and unsupported Bezier/native PSD states', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-operation-open',
      name: 'Open operation mask',
      kind: 'path',
      enabled: true,
      path: {
        closed: false,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
        ],
      },
    });

    const readiness = describeVectorMaskPathOperationReadiness(masked);

    expect(readiness).toEqual({
      layerId: 'image-layer',
      descriptorId: 'vm-operation-open',
      pathValidity: {
        closed: false,
        pointCount: 3,
        canRetain: true,
        canRasterize: false,
        blockers: ['open-path-not-rasterized'],
      },
      operations: {
        retain: {
          state: 'ready',
          blockers: [],
          preservesEditablePath: true,
          signature: 'image-vector-mask-operation:v1:{"layerId":"image-layer","descriptorId":"vm-operation-open","kind":"retain","state":"ready","blockers":[],"preservesEditablePath":true}',
        },
        rasterize: {
          state: 'blocked',
          blockers: ['open-path-not-rasterized'],
          preservesEditablePath: false,
          signature: 'image-vector-mask-operation:v1:{"layerId":"image-layer","descriptorId":"vm-operation-open","kind":"rasterize","state":"blocked","blockers":["open-path-not-rasterized"],"preservesEditablePath":false}',
        },
        editBezierHandles: {
          state: 'unsupported',
          blockers: ['live-bezier-editing-unsupported'],
          preservesEditablePath: false,
          signature: 'image-vector-mask-operation:v1:{"layerId":"image-layer","descriptorId":"vm-operation-open","kind":"editBezierHandles","state":"unsupported","blockers":["live-bezier-editing-unsupported"],"preservesEditablePath":false}',
        },
        nativePsdRoundtrip: {
          state: 'unsupported',
          blockers: ['psd-vector-mask-roundtrip-limited'],
          preservesEditablePath: false,
          signature: 'image-vector-mask-operation:v1:{"layerId":"image-layer","descriptorId":"vm-operation-open","kind":"nativePsdRoundtrip","state":"unsupported","blockers":["psd-vector-mask-roundtrip-limited"],"preservesEditablePath":false}',
        },
      },
      signature: expect.stringContaining('image-vector-mask-path-operations:v1:'),
    });
  });

  it('exposes vector-mask parity checks with boolean, Bezier, and rasterization caveat signatures', () => {
    const masked = attachVectorMaskToLayer(makeImageLayer(), {
      id: 'vm-parity',
      name: 'Parity mask',
      kind: 'path',
      enabled: true,
      path: {
        closed: true,
        points: [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 5 },
          { x: 1, y: 5 },
        ],
      },
    });

    const readiness = summarizeLayerVectorMaskReadiness(masked);

    expect(readiness.parityChecks).toEqual({
      checkId: 'image-vector-mask-parity:v1',
      layerId: 'image-layer',
      descriptorId: 'vm-parity',
      targetLayerId: 'image-layer',
      creation: {
        state: 'ready',
        ready: true,
        source: 'path-backed-layer-metadata',
        caveats: ['target-local-retained-path-copy'],
        signature: 'image-vector-mask-creation:v1:{"layerId":"image-layer","descriptorId":"vm-parity","targetLayerId":"image-layer","ready":true,"caveats":["target-local-retained-path-copy"]}',
      },
      booleanOperations: {
        state: 'unsupported',
        supportedModes: [],
        unsupportedModes: ['combine', 'subtract', 'intersect', 'exclude'],
        caveats: [
          'live-vector-mask-boolean-stack-unsupported',
          'overlap-resolution-unsupported',
          'materialize-path-boolean-before-vector-mask',
        ],
        signature: 'image-vector-mask-booleans:v1:{"layerId":"image-layer","descriptorId":"vm-parity","state":"unsupported","supportedModes":[],"unsupportedModes":["combine","subtract","intersect","exclude"],"caveats":["live-vector-mask-boolean-stack-unsupported","overlap-resolution-unsupported","materialize-path-boolean-before-vector-mask"]}',
      },
      bezierEditing: {
        state: 'unsupported',
        caveats: ['bezier-handles-unsupported', 'smooth-anchor-conversion-unsupported'],
        signature: 'image-vector-mask-bezier:v1:{"layerId":"image-layer","descriptorId":"vm-parity","state":"unsupported","caveats":["bezier-handles-unsupported","smooth-anchor-conversion-unsupported"]}',
      },
      rasterization: {
        state: 'ready-with-caveats',
        canRasterize: true,
        outputSource: 'layer-mask',
        destructive: true,
        preservesEditableVectorMask: false,
        blockingWarningCodes: [],
        caveats: [
          'rasterizes-vector-mask-to-alpha',
          'rasterization-bakes-editable-path',
          'psd-editable-vector-mask-roundtrip-limited',
        ],
        signature: 'image-vector-mask-rasterization:v1:{"layerId":"image-layer","descriptorId":"vm-parity","state":"ready-with-caveats","canRasterize":true,"outputSource":"layer-mask","blockingWarningCodes":[],"caveats":["rasterizes-vector-mask-to-alpha","rasterization-bakes-editable-path","psd-editable-vector-mask-roundtrip-limited"]}',
      },
      signature: 'image-vector-mask-parity:v1:{"layerId":"image-layer","descriptorId":"vm-parity","targetLayerId":"image-layer","creation":"image-vector-mask-creation:v1:{\\"layerId\\":\\"image-layer\\",\\"descriptorId\\":\\"vm-parity\\",\\"targetLayerId\\":\\"image-layer\\",\\"ready\\":true,\\"caveats\\":[\\"target-local-retained-path-copy\\"]}","booleanOperations":"image-vector-mask-booleans:v1:{\\"layerId\\":\\"image-layer\\",\\"descriptorId\\":\\"vm-parity\\",\\"state\\":\\"unsupported\\",\\"supportedModes\\":[],\\"unsupportedModes\\":[\\"combine\\",\\"subtract\\",\\"intersect\\",\\"exclude\\"],\\"caveats\\":[\\"live-vector-mask-boolean-stack-unsupported\\",\\"overlap-resolution-unsupported\\",\\"materialize-path-boolean-before-vector-mask\\"]}","bezierEditing":"image-vector-mask-bezier:v1:{\\"layerId\\":\\"image-layer\\",\\"descriptorId\\":\\"vm-parity\\",\\"state\\":\\"unsupported\\",\\"caveats\\":[\\"bezier-handles-unsupported\\",\\"smooth-anchor-conversion-unsupported\\"]}","rasterization":"image-vector-mask-rasterization:v1:{\\"layerId\\":\\"image-layer\\",\\"descriptorId\\":\\"vm-parity\\",\\"state\\":\\"ready-with-caveats\\",\\"canRasterize\\":true,\\"outputSource\\":\\"layer-mask\\",\\"blockingWarningCodes\\":[],\\"caveats\\":[\\"rasterizes-vector-mask-to-alpha\\",\\"rasterization-bakes-editable-path\\",\\"psd-editable-vector-mask-roundtrip-limited\\"]}"}',
    });
  });
});
