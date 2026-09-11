import { describe, expect, it, vi } from 'vitest';
import type { AndroidAcceleratorUpscaleInput } from '../../lib/androidAccelerator';
import type { AndroidNativeImageUpscaleInput } from '../../lib/androidNativeImageUpscaler';
import type { LocalCpuUpscalerInput } from '../../lib/localCpuUpscaler';
import { DEFAULT_PROVIDER_SETTINGS } from '../../lib/providerCatalog';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import type { ProviderSettings } from '../../types/flow';
import {
  describeImageDocumentUniversalUpscaleReadiness,
  describeUniversalImageUpscaleProvider,
  upscaleImageDocumentUniversal,
} from './ImageUniversalUpscale';
import { createImageCmykPixelBuffer } from './cmyk/ImageCmykDocument';

function providerSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return { ...DEFAULT_PROVIDER_SETTINGS, ...overrides };
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
    x: 2,
    y: 3,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('ImageUniversalUpscale', () => {
  it('refuses native CMYK before an upscale provider can serialize or replace its ink authority', async () => {
    const authority = createImageCmykPixelBuffer(2, 1, new Uint8Array([12, 34, 56, 78, 255, 21, 43, 65, 87, 255]));
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-cmyk', title: 'ink.tiff', width: 2, height: 1 }),
      layers: [makeLayer({ cmykPixels: authority })],
      activeLayerId: 'layer-1',
      metadata: {
        colorMode: 'cmyk' as const,
        cmyk: {
          profileId: 'fogra39',
          profileLabel: 'FOGRA39',
          profileSource: { kind: 'bundled' as const, id: 'fogra39' },
          intent: 'relative' as const,
          blackPointCompensation: true,
          paperWhiteSimulation: false,
        },
      },
    };
    const documentToDataUrl = vi.fn(async () => 'data:image/png;base64,should-not-run');

    await expect(upscaleImageDocumentUniversal({
      doc,
      providerSettings: providerSettings({ androidAcceleratorBaseUrl: 'http://127.0.0.1:8788' }),
      documentToDataUrl,
      androidUpscale: vi.fn(),
    })).rejects.toThrow(/native CMYK/i);
    expect(documentToDataUrl).not.toHaveBeenCalled();
    expect(doc.layers[0]?.cmykPixels).toBe(authority);
  });

  it('uses the configured Android accelerator for Image/Photos 2x upscale', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-1', title: 'photo.png', width: 200, height: 150 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const upscaledBitmap = { width: 400, height: 300 } as LayerBitmap;
    const androidUpscale = vi.fn(async (request: AndroidAcceleratorUpscaleInput) => ({
      dataUrl: 'data:image/png;base64,upscaled',
      mimeType: 'image/png' as const,
      modelUsed: 'upscaler_anime',
      accelerator: 'qnn-htp',
      width: request.targetWidthPx,
      height: request.targetHeightPx,
    }));

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      providerSettings: providerSettings({
        androidAcceleratorBaseUrl: ' http://192.168.1.42:8788/ ',
        androidAcceleratorAuthToken: 'pair-token',
        androidAcceleratorDefaultUpscaler: 'upscaler_anime',
      }),
      androidUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async (dataUrl) => {
        expect(dataUrl).toBe('data:image/png;base64,upscaled');
        return upscaledBitmap;
      },
    });

    expect(androidUpscale).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://192.168.1.42:8788',
      authToken: 'pair-token',
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 400,
      targetHeightPx: 300,
      upscalerId: 'upscaler_anime',
      outputFormat: 'png',
    }));
    expect(result).toMatchObject({
      provider: 'android-accelerator',
      estimatedCostUsd: 0,
      statusMessage: 'Upscaled "photo.png" to 400 x 300px with Android accelerator.',
    });
    expect(result.document).toMatchObject({
      id: 'doc-1',
      width: 400,
      height: 300,
      dirty: true,
      activeLayerId: 'phone-upscale-doc-1',
      hasSelection: false,
    });
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.layers[0]).toMatchObject({
      id: 'phone-upscale-doc-1',
      name: 'Phone AI upscale',
      x: 0,
      y: 0,
      bitmap: upscaledBitmap,
      bitmapVersion: 1,
    });
  });

  it('falls back to the local layer-preserving resize when no Android accelerator is configured', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-1', title: 'photo.png', width: 200, height: 150 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const androidUpscale = vi.fn();

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      providerSettings: providerSettings({
        androidAcceleratorBaseUrl: '   ',
        androidAcceleratorAuthToken: '',
        androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
      }),
      androidUpscale,
    });

    expect(androidUpscale).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: 'browser',
      statusMessage: 'Resized "photo.png" to 400 x 300px locally.',
    });
    expect(result.document.layers).toHaveLength(1);
    expect(result.document.layers[0]).toMatchObject({
      id: 'layer-1',
      x: 4,
      y: 6,
    });
  });

  it('uses the in-app Android native image upscaler before browser resize when running on Android', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-native', title: 'camera.png', width: 300, height: 200 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const upscaledBitmap = { width: 600, height: 400 } as LayerBitmap;
    const androidNativeUpscale = vi.fn(async (request: AndroidNativeImageUpscaleInput) => ({
      dataUrl: 'data:image/png;base64,native-upscaled',
      mimeType: 'image/png' as const,
      width: request.targetWidthPx,
      height: request.targetHeightPx,
      accelerator: 'android-native-bitmap',
    }));

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      providerSettings: providerSettings({
        androidAcceleratorBaseUrl: '',
        androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
      }),
      androidNativeUpscale,
      isAndroidNativeUpscalerAvailable: true,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async (dataUrl) => {
        expect(dataUrl).toBe('data:image/png;base64,native-upscaled');
        return upscaledBitmap;
      },
    });

    expect(androidNativeUpscale).toHaveBeenCalledWith(expect.objectContaining({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 600,
      targetHeightPx: 400,
      outputFormat: 'png',
    }));
    expect(result).toMatchObject({
      provider: 'android-native',
      estimatedCostUsd: 0,
      statusMessage: 'Upscaled "camera.png" to 600 x 400px with Android native image upscaler.',
    });
    expect(result.document).toMatchObject({
      width: 600,
      height: 400,
      activeLayerId: 'android-native-upscale-doc-native',
    });
    expect(result.document.layers[0]).toMatchObject({
      id: 'android-native-upscale-doc-native',
      name: 'Android native upscale',
      bitmap: upscaledBitmap,
    });
  });

  it('surfaces the native plugin runtime evidence in status text and result metadata', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-native-runtime', title: 'camera.png', width: 300, height: 200 }),
      layers: [makeLayer(), makeLayer({ id: 'layer-2', name: 'Layer 2' })],
      activeLayerId: 'layer-1',
    };
    const upscaledBitmap = { width: 600, height: 400 } as LayerBitmap;
    const androidNativeUpscale = vi.fn(async (request: AndroidNativeImageUpscaleInput) => ({
      dataUrl: 'data:image/png;base64,native-upscaled',
      mimeType: 'image/png' as const,
      width: request.targetWidthPx,
      height: request.targetHeightPx,
      accelerator: 'local-dream-qnn-htp',
      backend: 'signal-loom-bundled-local-dream',
      modelUsed: 'upscaler_realistic',
      warnings: ['Bundled Local Dream QNN upscaler output is 4x internally and was final-fit to the requested dimensions.'],
    }));

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      providerSettings: providerSettings({
        androidAcceleratorBaseUrl: '',
        androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
      }),
      androidNativeUpscale,
      isAndroidNativeUpscalerAvailable: true,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async () => upscaledBitmap,
    });

    expect(result).toMatchObject({
      provider: 'android-native',
      statusMessage: 'Upscaled "camera.png" to 600 x 400px with Android native image upscaler via QNN (signal-loom-bundled-local-dream).',
      runtime: {
        accelerator: 'local-dream-qnn-htp',
        backend: 'signal-loom-bundled-local-dream',
        modelUsed: 'upscaler_realistic',
        kind: 'accelerated',
      },
    });
    expect(result.document.layers[0].metadata).toMatchObject({
      sourceFormat: 'android-native-upscale',
      sourceWarnings: expect.arrayContaining([
        'The AI upscaler operates on the flattened visible image; undo restores the original layers.',
        'Android native runtime: QNN via signal-loom-bundled-local-dream.',
        'Android native model: upscaler_realistic.',
        'Bundled Local Dream QNN upscaler output is 4x internally and was final-fit to the requested dimensions.',
      ]),
    });
  });

  it('uses explicit labels for the visible method/status indicator', () => {
    expect(describeUniversalImageUpscaleProvider('android-accelerator')).toBe('Android accelerator: NPU/GPU upscaler');
    expect(describeUniversalImageUpscaleProvider('android-native')).toBe('Android native image upscaler');
    expect(describeUniversalImageUpscaleProvider('browser')).toBe('Local image resize');
    expect(describeUniversalImageUpscaleProvider('local-ai-cpu')).toBe('Local Vulkan AI upscaler');
    expect(describeUniversalImageUpscaleProvider('stability-fast')).toBe('Stability Fast Upscale');
    expect(describeUniversalImageUpscaleProvider('stability-conservative')).toBe('Stability Conservative Upscale');
    expect(describeUniversalImageUpscaleProvider('vertex-imagen')).toBe('Vertex Imagen Upscale');
    expect(describeUniversalImageUpscaleProvider('atlas-image-upscaler')).toBe('Atlas Image Upscaler');
  });

  it('runs the Atlas Cloud dedicated upscaler when selected, mapping the 2x scale to outscale 2', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-atlas', title: 'sprite.png', width: 256, height: 256 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const atlasUpscale = vi.fn(async (request) => {
      expect(request).toMatchObject({
        sourceImage: 'data:image/png;base64,source',
        apiKey: 'atlas-key',
        outscale: 2,
        outputFormat: 'png',
      });
      return { result: 'data:image/png;base64,atlas-upscaled', mimeType: 'image/png' };
    });

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      provider: 'atlas-image-upscaler',
      providerSettings: providerSettings(),
      apiKeys: { atlas: 'atlas-key' },
      atlasUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async (dataUrl) => {
        expect(dataUrl).toBe('data:image/png;base64,atlas-upscaled');
        return { width: 512, height: 512 } as LayerBitmap;
      },
    });

    expect(atlasUpscale).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      provider: 'atlas-image-upscaler',
      estimatedCostUsd: 0.01,
      statusMessage: 'Upscaled "sprite.png" to 512 x 512px with Atlas Image Upscaler ($0.01).',
      runtime: { kind: 'cloud', modelUsed: 'Atlas Image Upscaler' },
    });
    expect(result.document.layers[0].metadata).toMatchObject({
      sourceFormat: 'atlas-image-upscaler-upscale',
      sourceWarnings: expect.arrayContaining([
        'Atlas Image Upscaler is a paid cloud upscaler; provider cost $0.01.',
      ]),
    });
  });

  it('runs the selected Stability Fast cloud upscaler and reports its paid cost label', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-cloud', title: 'render.png', width: 512, height: 512 }),
      layers: [makeLayer(), makeLayer({ id: 'layer-2', name: 'Layer 2' })],
      activeLayerId: 'layer-1',
    };
    const upscaledBitmap = { width: 2048, height: 2048 } as LayerBitmap;
    const stabilityUpscale = vi.fn(async (request) => {
      expect(request).toMatchObject({
        sourceImage: 'data:image/png;base64,source',
        mode: 'fast',
        outputFormat: 'png',
        apiKey: 'stability-key',
      });
      return { result: 'data:image/png;base64,cloud-upscaled', mimeType: 'image/png' };
    });

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      provider: 'stability-fast',
      providerSettings: providerSettings(),
      apiKeys: { stability: 'stability-key' },
      stabilityUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async (dataUrl) => {
        expect(dataUrl).toBe('data:image/png;base64,cloud-upscaled');
        return upscaledBitmap;
      },
    });

    expect(stabilityUpscale).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      provider: 'stability-fast',
      estimatedCostUsd: 0.02,
      statusMessage: 'Upscaled "render.png" to 2048 x 2048px with Stability Fast Upscale ($0.02).',
      runtime: { kind: 'cloud', modelUsed: 'Stability Fast Upscale' },
    });
    expect(result.document).toMatchObject({
      width: 2048,
      height: 2048,
      activeLayerId: 'cloud-upscale-doc-cloud',
    });
    expect(result.document.layers[0]).toMatchObject({
      id: 'cloud-upscale-doc-cloud',
      name: 'Stability Fast Upscale upscale',
      metadata: {
        sourceFormat: 'stability-fast-upscale',
        sourceWarnings: expect.arrayContaining([
          'The AI upscaler operates on the flattened visible image; undo restores the original layers.',
          'Stability Fast Upscale is a paid cloud upscaler; provider cost $0.02.',
        ]),
      },
    });
  });

  it('passes the conservative repair prompt through the Stability Conservative cloud upscaler', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-cons', title: 'poster.png', width: 300, height: 200 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const stabilityUpscale = vi.fn(async (request) => {
      expect(request).toMatchObject({ mode: 'conservative', prompt: 'Keep the logo crisp.' });
      return { result: 'data:image/png;base64,cons-upscaled', mimeType: 'image/png' };
    });

    const result = await upscaleImageDocumentUniversal({
      doc,
      provider: 'stability-conservative',
      providerSettings: providerSettings(),
      apiKeys: { stability: 'stability-key' },
      prompt: 'Keep the logo crisp.',
      stabilityUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async () => ({ width: 1200, height: 800 } as LayerBitmap),
    });

    expect(result.provider).toBe('stability-conservative');
    expect(result.estimatedCostUsd).toBe(0.4);
    expect(result.statusMessage).toContain('Stability Conservative Upscale ($0.40)');
  });

  it('runs the Vertex Imagen cloud upscaler when selected', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-vertex', title: 'art.png', width: 400, height: 400 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const vertexImagenUpscale = vi.fn(async (request) => {
      expect(request).toMatchObject({ sourceImage: 'data:image/png;base64,source', outputFormat: 'png' });
      return { result: 'data:image/png;base64,vertex-upscaled', mimeType: 'image/png' };
    });

    const result = await upscaleImageDocumentUniversal({
      doc,
      provider: 'vertex-imagen',
      providerSettings: providerSettings({ vertexProjectId: 'proj-1', vertexLocation: 'us-central1' }),
      vertexImagenUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async () => ({ width: 800, height: 800 } as LayerBitmap),
    });

    expect(vertexImagenUpscale).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      provider: 'vertex-imagen',
      estimatedCostUsd: 0,
      statusMessage: 'Upscaled "art.png" to 800 x 800px with Vertex Imagen Upscale (cost unknown).',
      runtime: { kind: 'cloud' },
    });
  });

  it('never spends on a cloud provider unless one is explicitly selected', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-auto', title: 'photo.png', width: 200, height: 150 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const stabilityUpscale = vi.fn();
    const vertexImagenUpscale = vi.fn();
    const atlasUpscale = vi.fn();

    const result = await upscaleImageDocumentUniversal({
      doc,
      providerSettings: providerSettings({ vertexProjectId: 'proj-1', vertexLocation: 'us-central1' }),
      apiKeys: { stability: 'stability-key', atlas: 'atlas-key' },
      stabilityUpscale,
      vertexImagenUpscale,
      atlasUpscale,
    });

    expect(stabilityUpscale).not.toHaveBeenCalled();
    expect(vertexImagenUpscale).not.toHaveBeenCalled();
    expect(atlasUpscale).not.toHaveBeenCalled();
    expect(result.provider).toBe('browser');
  });

  it('uses the legacy local route as a Vulkan upscaler when configured and callback provided', async () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-2', title: 'poster.png', width: 128, height: 100 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };
    const upscaledBitmap = { width: 256, height: 200 } as LayerBitmap;
    const localAiCpuUpscale = vi.fn(async (request: LocalCpuUpscalerInput) => {
      expect(request.targetWidthPx).toBe(256);
      expect(request.targetHeightPx).toBe(200);
      return {
        dataUrl: 'data:image/png;base64,local-upscaled',
        mimeType: 'image/png' as const,
        modelUsed: 'realesrgan-4x',
      };
    });

    const result = await upscaleImageDocumentUniversal({
      doc,
      scalePercent: 200,
      providerSettings: providerSettings({
        localAiCpuEndpointUrl: 'http://127.0.0.1:8788',
        localAiCpuModel: 'realesrgan-4x',
      }),
      localAiCpuUpscale,
      documentToDataUrl: async () => 'data:image/png;base64,source',
      dataUrlToBitmap: async () => upscaledBitmap,
    });

    expect(localAiCpuUpscale).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:8788',
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 256,
      targetHeightPx: 200,
      model: 'realesrgan-4x',
    }));
    expect(result.provider).toBe('local-ai-cpu');
    expect(result.document).toMatchObject({
      id: 'doc-2',
      width: 256,
      height: 200,
      activeLayerId: 'vulkan-upscale-doc-2',
      hasSelection: false,
    });
    expect(result.document.layers[0]).toMatchObject({
      id: 'vulkan-upscale-doc-2',
      name: 'Local Vulkan AI upscale',
      metadata: expect.objectContaining({
        sourceFormat: 'Real-ESRGAN Vulkan',
      }),
    });
  });

  it('describes document-level universal upscale readiness without executing providers', () => {
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-readiness', title: 'cover.png', width: 320, height: 240 }),
      layers: [makeLayer()],
      activeLayerId: 'layer-1',
    };

    const readiness = describeImageDocumentUniversalUpscaleReadiness({
      doc,
      scalePercent: 150,
      providerSettings: {
        androidAcceleratorBaseUrl: '',
        localAiCpuEndpointUrl: '',
      },
      isAndroidNativeUpscalerAvailable: true,
    });

    expect(readiness).toMatchObject({
      descriptorId: 'image-universal-upscale-readiness:v1',
      readiness: 'ready',
      target: {
        sourceWidthPx: 320,
        sourceHeightPx: 240,
        widthPx: 480,
        heightPx: 360,
        policy: 'scale-percent',
        scalePercent: 150,
      },
      routes: [
        expect.objectContaining({
          id: 'on-device-preferred',
          provider: 'android-native',
          readiness: 'ready',
          selected: true,
        }),
        expect.objectContaining({ id: 'cloud-fallback' }),
        expect.objectContaining({ id: 'bitmap-fallback' }),
      ],
    });
    expect(readiness.stableSignature).toContain('source=image:320x240');
    expect(readiness.stableSignature).toContain('target=scale-percent:480x360:scale=150:action=queue-upscale');
    expect((readiness as typeof readiness & {
      policy?: {
        sourceExclusion: { action: string };
        printResolution: { defaultTargetDpi: number; action: string };
        fallbackOrder: Array<{ rank: number; routeId: string; provider: string }>;
      };
    }).policy).toMatchObject({
      sourceExclusion: {
        action: 'allow-upscale',
      },
      printResolution: {
        defaultTargetDpi: 300,
        action: 'queue-upscale',
      },
      fallbackOrder: [
        { rank: 1, routeId: 'on-device-preferred', provider: 'android-native' },
        { rank: 2, routeId: 'cloud-fallback', provider: 'stability-fast' },
        { rank: 3, routeId: 'bitmap-fallback', provider: 'browser' },
      ],
    });
  });
});
