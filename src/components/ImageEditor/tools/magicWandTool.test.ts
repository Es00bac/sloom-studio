import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerBitmap, SelectionToolSettings } from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { clearAllSelections, getSelection } from '../selectionRegistry';

class FakeCanvasContext {
  readonly imageData: ImageData;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  save() {}
  restore() {}
  clearRect() {
    this.imageData.data.fill(0);
  }
  getImageData() {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }
  drawImage(source: FakeOffscreenCanvas, dx: number, dy: number) {
    const sourceData = source.context.imageData.data;
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        const tx = sx + dx;
        const ty = sy + dy;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (ty * this.width + tx) * 4;
        const alpha = (sourceData[sourceOffset + 3] / 255) * this.globalAlpha;
        if (alpha <= 0) continue;
        const inverse = 1 - alpha;
        this.imageData.data[targetOffset] = Math.round(sourceData[sourceOffset] * alpha + this.imageData.data[targetOffset] * inverse);
        this.imageData.data[targetOffset + 1] = Math.round(sourceData[sourceOffset + 1] * alpha + this.imageData.data[targetOffset + 1] * inverse);
        this.imageData.data[targetOffset + 2] = Math.round(sourceData[sourceOffset + 2] * alpha + this.imageData.data[targetOffset + 2] * inverse);
        this.imageData.data[targetOffset + 3] = Math.round((alpha + (this.imageData.data[targetOffset + 3] / 255) * inverse) * 255);
      }
    }
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  readonly context: FakeCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext() {
    return this.context;
  }
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  canvas.context.imageData.data[offset] = rgba[0];
  canvas.context.imageData.data[offset + 1] = rgba[1];
  canvas.context.imageData.data[offset + 2] = rgba[2];
  canvas.context.imageData.data[offset + 3] = rgba[3];
}

function makeSettings(overrides: Partial<{ sampleAllLayers: boolean; contiguous: boolean }> = {}): SelectionToolSettings {
  return {
    mode: 'replace',
    feather: 0,
    antiAlias: true,
    marqueeShape: 'rectangle',
    lassoShape: 'freehand',
    magicWandTolerance: 0,
    sampleAllLayers: overrides.sampleAllLayers ?? false,
    contiguous: overrides.contiguous ?? true,
  } as unknown as SelectionToolSettings;
}

describe('magicWandTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    clearAllSelections();
  });

  it('samples only the active layer when sample-all-layers is disabled', async () => {
    const { magicWandTool } = await import('./magicWandTool');
    const background = new OffscreenCanvas(2, 1) as LayerBitmap;
    setPixel(background, 0, 0, [255, 0, 0, 255]);
    setPixel(background, 1, 0, [0, 0, 255, 255]);
    const activeBitmap = new OffscreenCanvas(2, 1) as LayerBitmap;
    const env = {
      doc: {
        id: 'doc-wand',
        title: 'Wand',
        width: 2,
        height: 1,
        layers: [
          { id: 'bg', name: 'Background', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: background, bitmapVersion: 0, mask: null },
          { id: 'active', name: 'Active', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: activeBitmap, bitmapVersion: 0, mask: null },
        ],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer: { id: 'active', name: 'Active', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: activeBitmap, bitmapVersion: 0, mask: null },
      brushSettings: {} as ToolEnv['brushSettings'],
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      selectionToolSettings: makeSettings({ sampleAllLayers: false }),
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        bumpSelectionVersion: vi.fn(),
        setHasSelection: vi.fn(),
      },
    } as unknown as ToolEnv;

    magicWandTool.onPointerDown?.(env, { x: 0, y: 0 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    expect(Array.from(getSelection('doc-wand')?.data ?? [])).toEqual([255, 255]);
  });

  it('adds partial edge alpha to Magic Wand selections when anti-alias is enabled', async () => {
    const { magicWandTool } = await import('./magicWandTool');
    const activeBitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        setPixel(activeBitmap, x, y, [255, 255, 255, 255]);
      }
    }
    setPixel(activeBitmap, 1, 1, [0, 0, 0, 255]);
    const env = {
      doc: {
        id: 'doc-wand-antialias',
        title: 'Wand Anti Alias',
        width: 3,
        height: 3,
        layers: [
          { id: 'active', name: 'Active', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: activeBitmap, bitmapVersion: 0, mask: null },
        ],
        activeLayerId: 'active',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
      },
      activeLayer: { id: 'active', name: 'Active', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: activeBitmap, bitmapVersion: 0, mask: null },
      brushSettings: {} as ToolEnv['brushSettings'],
      cropToolSettings: {} as ToolEnv['cropToolSettings'],
      selectionToolSettings: makeSettings({ sampleAllLayers: false, contiguous: true }),
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: vi.fn(),
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
      store: {
        bumpSelectionVersion: vi.fn(),
        setHasSelection: vi.fn(),
      },
    } as unknown as ToolEnv;

    magicWandTool.onPointerDown?.(env, { x: 1, y: 1 }, { shift: false, alt: false, ctrl: false, meta: false }, {} as PointerEvent);

    const selection = getSelection('doc-wand-antialias');
    expect(selection?.data[4]).toBe(255);
    expect(selection?.data[5]).toBeGreaterThan(0);
    expect(selection?.data[5]).toBeLessThan(255);
  });

  it('describes tolerance, global sampling, selection output, and edge controls', async () => {
    const { describeMagicWandWorkflow } = await import('./magicWandTool');

    const descriptor = describeMagicWandWorkflow({
      selectionSettings: {
        ...makeSettings({ sampleAllLayers: true, contiguous: false }),
        mode: 'add',
        magicWandTolerance: 17,
        antiAlias: true,
      },
      requestedGapClose: 3,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'magic-wand-workflow:v1',
      tolerance: {
        value: 17,
        metric: 'rgb-euclidean-distance',
      },
      sampling: {
        sampleAllLayers: true,
        source: 'visible-document-composite',
      },
      matching: {
        scope: 'global',
        connectivity: 'document-wide',
        gapClosePixels: 3,
        gapCloseSupported: false,
      },
      selectionOutput: {
        target: 'document-selection',
        mode: 'add',
        alpha: 255,
      },
      antiAlias: {
        requested: true,
        applied: true,
        edgeModel: 'alpha-aware-flood-fill-edge',
      },
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'gap-close-unsupported',
    ]);
    expect(descriptor.previewSignature).toBe(
      'magic-wand-workflow:v1:{"tolerance":17,"sampling":"visible-document-composite","matching":{"scope":"global","connectivity":"document-wide","gapClosePixels":3},"selectionOutput":{"target":"document-selection","mode":"add","alpha":255},"antiAlias":{"requested":true,"applied":true,"edgeModel":"alpha-aware-flood-fill-edge"},"warnings":["gap-close-unsupported"]}',
    );
  });

  it('describes readiness for tolerance, contiguous/global matching, transform handoff, and batch suitability', async () => {
    const { describeMagicWandReadiness } = await import('./magicWandTool');

    const readiness = describeMagicWandReadiness({
      selectionSettings: {
        ...makeSettings({ sampleAllLayers: false, contiguous: true }),
        mode: 'subtract',
        feather: 4,
        antiAlias: true,
        magicWandTolerance: 32,
      },
      requestedGapClose: true,
      hasActiveSelection: false,
      requireTransformSelection: true,
    });

    expect(readiness).toMatchObject({
      descriptorId: 'magic-wand-readiness:v1',
      status: 'blocked',
      tolerance: {
        value: 32,
        metric: 'rgb-euclidean-distance',
        replayDeterminism: 'stable-for-fixed-source-bitmap',
      },
      matching: {
        scope: 'contiguous',
        connectivity: 4,
        contiguousBehavior: 'seed-bounded-flood-fill',
      },
      edgeModes: {
        feather: {
          requestedPx: 4,
          appliedToSelectionMask: true,
          preview: 'feathered-mask',
        },
        antiAlias: {
          requested: true,
          appliedToSelectionMask: true,
          preview: 'alpha-aware-flood-fill-edge',
        },
      },
      transformSelectionHandoff: {
        target: 'transform-selection',
        readiness: 'requires-committed-selection',
        source: 'document-selection-registry',
        commitBoundary: 'after-selection-commit',
        invalidBlockerSignature: 'transform-selection-needs-active-selection',
      },
    });
    expect(readiness.batchActionSuitability).toEqual({
      status: 'blocked',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: 'Magic Wand playback is blocked until required transform-selection prerequisites exist.',
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'gap-close-unsupported',
      'transform-selection-needs-active-selection',
    ]);
    expect(readiness.previewSignatures.blockers).toBe(
      'magic-wand-blockers:v1:["gap-close-unsupported","transform-selection-needs-active-selection"]',
    );
  });

  it('reports alpha-aware anti-alias readiness without an unsupported anti-alias caveat on the supported path', async () => {
    const { describeMagicWandReadiness, describeMagicWandWorkflow } = await import('./magicWandTool');
    const selectionSettings = {
      ...makeSettings({ sampleAllLayers: false, contiguous: true }),
      antiAlias: true,
      magicWandTolerance: 9,
    };

    const workflow = describeMagicWandWorkflow({
      selectionSettings,
      targetChannel: 'rgb',
    });
    const readiness = describeMagicWandReadiness({
      selectionSettings,
      targetChannel: 'rgb',
    });
    const antiAliasCheck = readiness.checks.find((check) => check.code === 'anti-alias');

    expect(workflow.antiAlias).toEqual({
      requested: true,
      applied: true,
      edgeModel: 'alpha-aware-flood-fill-edge',
    });
    expect(workflow.warnings).toEqual([]);
    expect(readiness.status).toBe('ready');
    expect(readiness.blockers).toEqual([]);
    expect(readiness.edgeModes.antiAlias).toEqual({
      requested: true,
      appliedToSelectionMask: true,
      preview: 'alpha-aware-flood-fill-edge',
    });
    expect(antiAliasCheck).toMatchObject({
      status: 'ready',
      message: 'Magic Wand anti-alias uses an alpha-aware one-pixel edge model in the committed selection mask.',
      caveatCodes: [],
      blockerCodes: [],
    });
    const serialized = JSON.stringify({ workflow, readiness });
    expect(serialized).not.toContain('anti-alias-selection-edge-unsupported');
    expect(serialized).not.toContain('anti-alias unsupported');
    expect(serialized).not.toContain('not applied');
  });

  it('surfaces typed edge, sampling, channel, and signature checks for wand parity', async () => {
    const { describeMagicWandReadiness } = await import('./magicWandTool');

    const readiness = describeMagicWandReadiness({
      selectionSettings: {
        ...makeSettings({ sampleAllLayers: true, contiguous: false }),
        antiAlias: true,
        magicWandTolerance: 42,
      },
      targetChannel: 'red',
      requestedGapClose: 2,
      hasActiveSelection: true,
      requireTransformSelection: true,
    });

    expect(readiness.target).toEqual({
      requestedChannel: 'red',
      channelSensitivity: 'composite-rgba-channel-request-unsupported',
    });
    expect(readiness.checks.map((check) => ({
      code: check.code,
      status: check.status,
      caveatCodes: check.caveatCodes,
      blockerCodes: check.blockerCodes,
    }))).toEqual([
      { code: 'tolerance', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'sample-all-layers', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'contiguous', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'anti-alias', status: 'ready', caveatCodes: [], blockerCodes: [] },
      { code: 'gap-close', status: 'unsupported', caveatCodes: ['gap-close-unsupported'], blockerCodes: [] },
      { code: 'channel-routing', status: 'blocked', caveatCodes: ['channel-specific-selection-unsupported'], blockerCodes: ['channel-specific-selection-unsupported'] },
    ]);
    expect(readiness.previewSignatures.checks).toBe(
      'magic-wand-readiness-checks:v1:["tolerance:ready","sample-all-layers:ready","contiguous:ready","anti-alias:ready","gap-close:unsupported","channel-routing:blocked"]',
    );
    expect(readiness.previewSignatures.target).toBe(
      'magic-wand-target-routing:v1:{"requestedChannel":"red","channelSensitivity":"composite-rgba-channel-request-unsupported","blockers":["channel-specific-selection-unsupported"]}',
    );
  });
});
