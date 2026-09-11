import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import { createGenerativeFillLayerFromBitmap } from './GenerativeFillLayer';
import * as GenerativeFillLayerModule from './GenerativeFillLayer';

class FakeContext {
  drawImageCalls: unknown[][] = [];
  lastImageData: ImageData | null = null;
  globalCompositeOperation = 'source-over';
  globalAlpha = 1;
  fillStyle = '#000000';

  drawImage(...args: unknown[]) {
    this.drawImageCalls.push(args);
  }

  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.lastImageData = imageData;
  }

  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeDoc(): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 100,
    height: 80,
    layers: [],
    activeLayerId: null,
    hasSelection: true,
    selectionVersion: 1,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

describe('GenerativeFillLayer', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('creates a Photoshop-style generated layer masked to the active selection', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);
    const providerBitmap = new OffscreenCanvas(doc.width, doc.height) as LayerBitmap;

    const layer = createGenerativeFillLayerFromBitmap({
      doc,
      edgeFeatherPx: 0,
      resultBitmap: providerBitmap,
      selection,
      prompt: 'red scarf',
      id: 'fill-1',
    });

    expect(layer).toMatchObject({
      id: 'fill-1',
      name: 'Generative Fill: "red scarf"',
      type: 'image',
      x: 0,
      y: 0,
      bitmapVersion: 0,
    });
    expect(layer.bitmap?.width).toBe(doc.width);
    expect(layer.bitmap?.height).toBe(doc.height);
    expect(layer.mask?.width).toBe(doc.width);
    expect(layer.mask?.height).toBe(doc.height);

    const maskData = (layer.mask as unknown as FakeOffscreenCanvas).context.lastImageData;
    expect(maskData?.data[(12 * doc.width + 10) * 4 + 3]).toBe(255);
    expect(maskData?.data[0 * 4 + 3]).toBe(0);
  });

  it('places selected-area generated results back at the source document bounds', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);
    const providerBitmap = new OffscreenCanvas(8, 6) as LayerBitmap;

    const layer = createGenerativeFillLayerFromBitmap({
      doc,
      edgeFeatherPx: 0,
      resultBitmap: providerBitmap,
      selection,
      placementBounds: { x: 8, y: 9, width: 12, height: 10 },
      prompt: 'replace sign text',
      id: 'fill-local',
    });

    expect(layer).toMatchObject({
      id: 'fill-local',
      x: 8,
      y: 9,
    });
    expect(layer.bitmap?.width).toBe(12);
    expect(layer.bitmap?.height).toBe(10);
    expect(layer.mask?.width).toBe(12);
    expect(layer.mask?.height).toBe(10);

    const maskData = (layer.mask as unknown as FakeOffscreenCanvas).context.lastImageData;
    expect(maskData?.data[((12 - 9) * 12 + (10 - 8)) * 4 + 3]).toBe(255);
    expect(maskData?.data[0 * 4 + 3]).toBe(0);
  });

  it('feathers generated layer masks by default to blend selected-region edits', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);
    const providerBitmap = new OffscreenCanvas(12, 10) as LayerBitmap;

    const layer = createGenerativeFillLayerFromBitmap({
      doc,
      resultBitmap: providerBitmap,
      selection,
      placementBounds: { x: 8, y: 9, width: 12, height: 10 },
      prompt: 'soft blended patch',
      id: 'fill-feathered',
    });

    const maskData = (layer.mask as unknown as FakeOffscreenCanvas).context.lastImageData;
    const selectedAlpha = maskData?.data[((12 - 9) * 12 + (10 - 8)) * 4 + 3] ?? 0;
    const edgeNeighborAlpha = maskData?.data[((12 - 9) * 12 + (9 - 8)) * 4 + 3] ?? 0;

    expect(selectedAlpha).toBeGreaterThan(0);
    expect(selectedAlpha).toBeLessThan(255);
    expect(edgeNeighborAlpha).toBeGreaterThan(0);
    expect(edgeNeighborAlpha).toBeLessThan(selectedAlpha);
  });

  it('describes generated fill layers as Source Library handoff candidates with durable-id warnings', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 12, 14, 6, 5, 255, false);
    const providerBitmap = new OffscreenCanvas(20, 16) as LayerBitmap;

    const layer = createGenerativeFillLayerFromBitmap({
      doc,
      edgeFeatherPx: 0,
      resultBitmap: providerBitmap,
      selection,
      placementBounds: { x: 10, y: 11, width: 20, height: 16 },
      prompt: 'neon sky replacement',
      id: 'fill-handoff',
    });
    const describeGeneratedImageLayerHandoff = GenerativeFillLayerModule.describeGeneratedImageLayerHandoff;

    expect(describeGeneratedImageLayerHandoff).toBeTypeOf('function');
    expect(layer.metadata?.sourceFormat).toBe('generative-fill');
    expect(layer.metadata?.sourceWarnings).toContain(
      'Generated fill is not linked to a durable Source Library item until saved or sent to another workspace.',
    );

    expect(describeGeneratedImageLayerHandoff?.({ doc, layer })).toEqual({
      descriptorId: 'generative-fill-layer-handoff:v1',
      documentId: 'doc-1',
      layerId: 'fill-handoff',
      layerName: 'Generative Fill: "neon sky replacement"',
      sourceKind: 'generated-layer',
      source: {
        assetUrlKind: 'none',
        blobOnly: false,
        durableAsset: false,
        durableSourceId: null,
        label: null,
        sourceFormat: 'generative-fill',
      },
      bounds: { x: 10, y: 11, width: 20, height: 16 },
      sendTo: {
        flow: {
          ready: false,
          reason: 'Save the generated layer to the Source Library before sending it to Flow.',
          target: 'flow',
        },
        video: {
          ready: false,
          reason: 'Save the generated layer to the Source Library before sending it to Video.',
          target: 'video',
        },
        paper: {
          ready: false,
          reason: 'Save the generated layer to the Source Library before placing it in Paper.',
          target: 'paper',
        },
      },
      warnings: [
        {
          code: 'missing-durable-source-id',
          message: 'Generated layer "fill-handoff" is not linked to a durable Source Library item.',
        },
      ],
      preview: {
        id: 'generative-fill-preview:doc-1:fill-handoff:none',
        label: 'Generative Fill: "neon sky replacement"',
        sizeLabel: '20x16',
        sourceLabel: null,
      },
      sourceSnapshotAvailability: {
        available: false,
        sourceId: null,
      },
      externalAssetPackaging: {
        required: true,
        caveats: ['Save generated layer "fill-handoff" into the Source Library before packaging it for Flow, Video, or Paper.'],
      },
      suiteHandoffBlockers: [
        {
          code: 'missing-durable-source-id',
          target: 'suite',
          message: 'Generated layer "fill-handoff" needs a durable Source Library item before Flow, Video, or Paper handoff.',
        },
      ],
      handoffSignatures: {
        preview: 'generative-fill-layer-handoff:v1:{"documentId":"doc-1","layerId":"fill-handoff","sourceId":null,"assetUrlKind":"none","durableAsset":false,"bounds":{"x":10,"y":11,"width":20,"height":16},"warnings":["missing-durable-source-id"]}',
        export: 'generative-fill-export-handoff:v1:{"documentId":"doc-1","layerId":"fill-handoff","sourceId":null,"assetUrlKind":"none","durableAsset":false,"warningCodes":["missing-durable-source-id"]}',
        sourceBin: 'generative-fill-source-bin-handoff:v1:{"documentId":"doc-1","layerId":"fill-handoff","sourceId":null,"assetUrlKind":"none","durableAsset":false,"warningCodes":["missing-durable-source-id"]}',
      },
      previewSignature: 'generative-fill-layer-handoff:v1:{"documentId":"doc-1","layerId":"fill-handoff","sourceId":null,"assetUrlKind":"none","durableAsset":false,"bounds":{"x":10,"y":11,"width":20,"height":16},"warnings":["missing-durable-source-id"]}',
    });
  });

  it('marks blob-only generated Source Library links as not ready for Flow, Video, or Paper handoff', () => {
    const doc = makeDoc();
    const layer = {
      id: 'fill-blob',
      name: 'Generated blob preview',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 4,
      y: 6,
      bitmap: { width: 24, height: 18 } as LayerBitmap,
      bitmapVersion: 0,
      mask: null,
      metadata: {
        sourceFormat: 'generative-fill',
        smartLinkedSourceId: 'generated-blob',
        sourceLabel: 'Generated blob',
        sourceLink: {
          id: 'generated-blob',
          label: 'Generated blob',
          width: 24,
          height: 18,
          status: 'linked',
          relinkHistory: [],
        },
      },
    } satisfies ImageLayer;

    const descriptor = GenerativeFillLayerModule.describeGeneratedImageLayerHandoff({
      doc,
      layer,
      sourceItem: {
        id: 'generated-blob',
        label: 'Generated blob',
        assetUrl: 'blob:file:///tmp/generated-blob',
      },
    });

    expect(descriptor.source).toEqual({
      assetUrlKind: 'blob-url',
      blobOnly: true,
      durableAsset: false,
      durableSourceId: 'generated-blob',
      label: 'Generated blob',
      sourceFormat: 'generative-fill',
    });
    expect(descriptor.sendTo).toEqual({
      flow: {
        target: 'flow',
        ready: false,
        reason: 'Persist generated Source Library item "generated-blob" before sending it to Flow.',
      },
      video: {
        target: 'video',
        ready: false,
        reason: 'Persist generated Source Library item "generated-blob" before sending it to Video.',
      },
      paper: {
        target: 'paper',
        ready: false,
        reason: 'Persist generated Source Library item "generated-blob" before placing it in Paper.',
      },
    });
    expect(descriptor.warnings).toEqual([
      {
        code: 'blob-only-source-url',
        message: 'Generated Source Library item "generated-blob" only has a blob URL and may not survive project save/open or native handoff.',
      },
    ]);
    expect(descriptor.preview).toEqual({
      id: 'generative-fill-preview:doc-1:fill-blob:generated-blob',
      label: 'Generated blob preview',
      sizeLabel: '24x18',
      sourceLabel: 'Generated blob',
    });
    expect(descriptor.externalAssetPackaging).toEqual({
      required: true,
      caveats: ['Generated Source Library item "generated-blob" is blob-only; package it into project scratch or native media before suite handoff.'],
    });
    expect(descriptor.suiteHandoffBlockers).toEqual([
      {
        code: 'blob-only-source-url',
        target: 'suite',
        message: 'Persist generated Source Library item "generated-blob" before Flow, Video, or Paper handoff.',
      },
    ]);
    expect(descriptor.previewSignature).toBe('generative-fill-layer-handoff:v1:{"documentId":"doc-1","layerId":"fill-blob","sourceId":"generated-blob","assetUrlKind":"blob-url","durableAsset":false,"bounds":{"x":4,"y":6,"width":24,"height":18},"warnings":["blob-only-source-url"]}');
  });

  it('summarizes selected-region edit readiness with provider capabilities, cost, and a stable preview signature', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 10, 12, 4, 3, 255, false);

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'selected-region-edit',
      provider: 'openai',
      modelId: 'gpt-image-1',
      prompt: 'replace the sign with hand-painted letters',
      selection,
      apiKeys: { openai: 'stored-key' },
    });

    expect(descriptor.ready).toBe(true);
    expect(descriptor.provider).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-image-1',
      routeKind: 'cloud',
      supportsSelectedRegion: true,
      supportsReferenceInputs: true,
      supportsOutpaint: true,
      cost: {
        estimatedUsd: 0.04,
        label: 'Cloud image edit estimate: about $0.04 per edit.',
        unit: 'per-edit',
      },
    });
    expect(descriptor.selectedRegion).toMatchObject({
      required: true,
      present: true,
      empty: false,
      selectedPixels: 12,
      coverage: 0.0015,
      bounds: { x: 10, y: 12, width: 4, height: 3 },
      ready: true,
    });
    expect(descriptor.references).toMatchObject({
      required: false,
      providedCount: 0,
      readyCount: 0,
      ready: true,
    });
    expect(descriptor.preview).toEqual({
      id: 'generative-edit-preview:doc-1:selected-region-edit:openai:gpt-image-1',
      label: 'OpenAI Images / gpt-image-1 selected-region-edit',
      operationLabel: 'selected-region edit',
      documentSizeLabel: '100x80',
      selectedRegionLabel: '4x3 (0.2% selected)',
    });
    expect(descriptor.previewSignature).toBe('generative-edit-readiness:v1:{"documentId":"doc-1","operation":"selected-region-edit","provider":"openai","modelId":"gpt-image-1","selectedPixels":12,"selectionBounds":{"x":10,"y":12,"width":4,"height":3},"references":[],"requestedUpscaleRoute":null,"blockers":[],"alreadyPrintResolution":false,"sourceKind":"document"}');
    expect(descriptor.fallbackStates).toEqual([
      {
        lane: 'selected-provider',
        routeKind: 'cloud',
        available: true,
        active: true,
        summary: 'OpenAI Images is the active cloud AI route for this edit.',
      },
      {
        lane: 'local-fallback',
        routeKind: 'local',
        available: false,
        active: false,
        summary: 'Local endpoint fallback is not active; configure a Local/Open provider to keep the edit on-device or LAN.',
      },
      {
        lane: 'browser-fallback',
        routeKind: 'browser',
        available: true,
        active: false,
        summary: 'Browser fallback is limited to manual local edits/export and does not provide cloud semantic synthesis.',
      },
    ]);
    expect(descriptor.unsupportedPhotoshopParityStates.map((state) => state.state)).toEqual([
      'photoshop-generative-fill-native-layer',
      'photoshop-firefly-variation-stack',
      'photoshop-contextual-taskbar-history',
      'photoshop-cloud-credit-meter',
      'photoshop-prompt-safety-review',
    ]);
  });

  it('summarizes cloud provider runtime blockers without claiming Photoshop native AI execution is wired', () => {
    const doc = makeDoc();
    const selection = createMask(doc.width, doc.height);
    setRect(selection, 20, 10, 8, 6, 255, false);

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'selected-region-edit',
      provider: 'openai',
      modelId: 'gpt-image-1',
      prompt: 'replace the object with a matte ceramic vase',
      selection,
      apiKeys: { openai: '' },
    });

    expect(descriptor.runtimeSummary).toEqual({
      executionMode: 'cloud-provider',
      dispatchStatus: 'blocked',
      photoshopNativeAi: {
        supported: false,
        reason: 'Photoshop/Firefly native Generative Fill execution is not wired; this descriptor only prepares Sloom Studio provider routes.',
      },
      signalLoomExecution: {
        usesCloudProvider: true,
        executesLocally: false,
        requiresStoredCredential: true,
        requiresConfiguredRuntime: false,
        browserOnlyFallback: false,
      },
      blockerSummary: {
        requiredInputCodes: [],
        providerCapabilityCodes: [],
        credentialCodes: ['missing-provider-credential'],
        runtimeCodes: [],
        allCodes: ['missing-provider-credential'],
      },
      warnings: [
        {
          code: 'not-photoshop-native-ai',
          severity: 'warning',
          message: 'Generative edit readiness does not call Photoshop, Firefly, or a native Photoshop cloud service.',
        },
        {
          code: 'external-cloud-provider',
          severity: 'warning',
          message: 'OpenAI Images would run through Sloom Studio provider dispatch with stored credentials, not Photoshop cloud execution.',
        },
      ],
    });
    expect(descriptor.previewSignature).toContain('"blockers":["missing-provider-credential"]');
  });

  it('reports missing selection, reference, credential, and provider capability blockers deterministically', () => {
    const doc = makeDoc();

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'reference-edit',
      provider: 'huggingface',
      modelId: 'custom-inpaint-endpoint',
      prompt: 'match the jacket from the reference',
      referenceInputs: [
        { id: 'ref-empty', kind: 'image-url', label: 'Jacket reference', value: '' },
      ],
      apiKeys: { huggingface: '' },
    });

    expect(descriptor.ready).toBe(false);
    expect(descriptor.references).toEqual({
      required: true,
      providedCount: 1,
      readyCount: 0,
      ready: false,
      inputs: [
        {
          id: 'ref-empty',
          kind: 'image-url',
          label: 'Jacket reference',
          ready: false,
          reason: 'Jacket reference needs a URL, Source Library id, or description before it can guide the edit.',
        },
      ],
    });
    expect(descriptor.blockers).toEqual([
      {
        code: 'missing-reference-input',
        message: 'At least one ready reference image or description is required for this operation.',
      },
      {
        code: 'unsupported-operation',
        message: 'Hugging Face image does not advertise reference-guided edit support in this readiness helper.',
      },
      {
        code: 'missing-provider-credential',
        message: 'Hugging Face image needs a stored API key before dispatch.',
      },
    ]);
    expect(descriptor.missingCredentialBlockers).toEqual([
      {
        code: 'missing-provider-credential',
        message: 'Hugging Face image needs a stored API key before dispatch.',
      },
    ]);
    expect(descriptor.previewSignature).toContain('"blockers":["missing-reference-input","unsupported-operation","missing-provider-credential"]');
  });

  it('describes reference input slots without exposing raw reference values', () => {
    const doc = makeDoc();

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'reference-edit',
      provider: 'openai',
      modelId: 'gpt-image-1',
      prompt: 'match the jacket and lighting from the references',
      referenceInputs: [
        {
          id: 'ref-url',
          kind: 'image-url',
          label: 'Style board',
          value: 'https://cdn.example.test/private/style-board.png?token=secret',
        },
        {
          id: 'ref-copy',
          kind: 'description',
          label: 'Material notes',
          value: 'matte red nylon with black trim',
        },
        {
          id: 'ref-source',
          kind: 'source-library-item',
          label: 'Source slot',
          value: '',
        },
      ],
      apiKeys: { openai: 'stored-key' },
    });

    expect(descriptor.referenceSlots).toEqual([
      {
        slotIndex: 1,
        id: 'ref-url',
        kind: 'image-url',
        label: 'Style board',
        dispatchRole: 'image-reference',
        ready: true,
        valueState: 'provided',
        valueKind: 'url',
        summary: 'Style board is ready as image reference slot 1.',
        blockerCode: null,
      },
      {
        slotIndex: 2,
        id: 'ref-copy',
        kind: 'description',
        label: 'Material notes',
        dispatchRole: 'text-reference',
        ready: true,
        valueState: 'provided',
        valueKind: 'description',
        summary: 'Material notes is ready as text reference slot 2.',
        blockerCode: null,
      },
      {
        slotIndex: 3,
        id: 'ref-source',
        kind: 'source-library-item',
        label: 'Source slot',
        dispatchRole: 'image-reference',
        ready: false,
        valueState: 'missing',
        valueKind: 'source-library-item',
        summary: 'Source slot is missing a Source Library item id for reference slot 3.',
        blockerCode: 'missing-reference-input',
      },
    ]);
    expect(JSON.stringify(descriptor.referenceSlots)).not.toContain('token=secret');
    expect(descriptor.referenceSlotSignature).toBe('generative-edit-reference-slots:v1:{"documentId":"doc-1","operation":"reference-edit","slots":["1:ref-url:image-url:provided","2:ref-copy:description:provided","3:ref-source:source-library-item:missing"]}');
  });

  it('blocks already print-resolution source upscales separately from comic SFX exclusions', () => {
    const doc = makeDoc();

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'upscale',
      provider: 'stability',
      modelId: 'stable-image-upscale',
      requestedUpscaleRoute: 'cloud',
      apiKeys: { stability: 'stored-key' },
      sourceKind: 'selected-layer',
      alreadyPrintResolution: true,
      targetDpi: 300,
    });

    expect(descriptor.blockers).toEqual([
      {
        code: 'source-print-resolution-excluded',
        message: 'Selected layer is already at print resolution; automatic AI upscaling is skipped unless explicitly overridden.',
      },
    ]);
    expect(descriptor.runtimeSummary.blockerSummary.requiredInputCodes).toEqual([
      'source-print-resolution-excluded',
    ]);
    expect(descriptor.previewSignature).toContain('"blockers":["source-print-resolution-excluded"]');
  });

  it('describes local, cloud, and Android upscaler routes with print-resolution comic SFX exclusion caveats', () => {
    const doc = makeDoc();

    const descriptor = GenerativeFillLayerModule.describeGenerativeEditReadiness({
      doc,
      operation: 'upscale',
      provider: 'android',
      modelId: 'local-dream-active',
      requestedUpscaleRoute: 'android-accelerator',
      providerSettings: {
        androidAcceleratorBaseUrl: '',
        localAiCpuEndpointUrl: 'http://127.0.0.1:7860',
      },
      isAndroidNativeUpscalerAvailable: true,
      sourceKind: 'comic-sfx-layer',
      alreadyPrintResolution: true,
      targetDpi: 300,
    });

    expect(descriptor.ready).toBe(false);
    expect(descriptor.upscaleRoutes).toEqual([
      {
        route: 'android-accelerator',
        available: false,
        label: 'Android accelerator NPU/GPU upscaler',
        costLabel: 'Local device route, no cloud cost.',
        blockers: ['missing-local-route'],
        caveats: ['Requires a paired Android accelerator service before dispatch.'],
      },
      {
        route: 'android-native',
        available: true,
        label: 'Android native image upscaler',
        costLabel: 'Native Android route, no cloud cost.',
        blockers: [],
        caveats: ['Only available when the Android native bridge reports an installed upscaler.'],
      },
      {
        route: 'local-ai-cpu',
        available: true,
        label: 'Local Vulkan AI upscaler',
        costLabel: 'Local endpoint route, no cloud cost.',
        blockers: [],
        caveats: ['The managed desktop runtime requires a working Vulkan GPU/driver and has no CPU fallback; custom compatible endpoints may differ.'],
      },
      {
        route: 'cloud',
        available: false,
        label: 'Cloud image upscaler',
        costLabel: 'Provider credit cost varies by model.',
        blockers: ['missing-provider-credential'],
        caveats: ['Cloud upscale availability depends on the selected provider/model capability.'],
      },
      {
        route: 'browser',
        available: true,
        label: 'Browser resize fallback',
        costLabel: 'Local browser resize, no AI cost.',
        blockers: [],
        caveats: ['Browser resize is deterministic but is not an AI super-resolution result.'],
      },
    ]);
    expect(descriptor.blockers).toEqual([
      {
        code: 'missing-local-route',
        message: 'Android accelerator needs a paired Android accelerator route before dispatch.',
      },
      {
        code: 'missing-local-route',
        message: 'Android accelerator NPU/GPU upscaler is not configured.',
      },
      {
        code: 'comic-sfx-print-resolution-excluded',
        message: 'Comic SFX layers already at print resolution are excluded from automatic AI upscaling.',
      },
    ]);
    expect(descriptor.caveats).toContain('Comic SFX layers retain designer recipes; print-resolution SFX should not be rerouted through AI upscaling unless explicitly requested.');
    expect(descriptor.caveats).toContain('Input is already at print resolution (300 DPI); automatic upscale should be skipped unless the user overrides it.');
    expect(descriptor.fallbackStates).toEqual([
      {
        lane: 'selected-provider',
        routeKind: 'android',
        available: false,
        active: false,
        summary: 'Android accelerator is selected for this upscale request, but the required Android runtime route is not configured yet.',
      },
      {
        lane: 'local-fallback',
        routeKind: 'local',
        available: true,
        active: false,
        summary: 'Local Vulkan AI fallback is available if the Android accelerator route is unavailable or intentionally bypassed.',
      },
      {
        lane: 'cloud-fallback',
        routeKind: 'cloud',
        available: false,
        active: false,
        summary: 'Cloud upscale fallback still depends on provider/model credentials and is currently unavailable.',
      },
      {
        lane: 'browser-fallback',
        routeKind: 'browser',
        available: true,
        active: false,
        summary: 'Browser resize fallback is available, but it is deterministic scaling rather than AI super-resolution.',
      },
    ]);
    expect(descriptor.previewSignature).toBe('generative-edit-readiness:v1:{"documentId":"doc-1","operation":"upscale","provider":"android","modelId":"local-dream-active","selectedPixels":0,"selectionBounds":null,"references":[],"requestedUpscaleRoute":"android-accelerator","blockers":["missing-local-route","missing-local-route","comic-sfx-print-resolution-excluded"],"alreadyPrintResolution":true,"sourceKind":"comic-sfx-layer"}');
  });
});
