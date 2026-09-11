import { describe, expect, it } from 'vitest';
import {
  describeUniversalImageUpscaleReadiness,
  describeUniversalImageUpscaleWorkflow,
  getUniversalImageUpscaleWorkflowWarnings,
  listUniversalImageUpscaleWorkflowDescriptors,
  resolveUniversalConfiguredUpscalePlan,
} from './universalImageUpscale';
import { DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';

describe('universalImageUpscale', () => {
  it('publishes deterministic method, cost, and capability descriptors for all universal image upscaler paths', () => {
    expect(listUniversalImageUpscaleWorkflowDescriptors().map((descriptor) => descriptor.provider)).toEqual([
      'android-accelerator',
      'android-native',
      'local-ai-cpu',
      'stability-fast',
      'stability-conservative',
      'vertex-imagen',
      'atlas-image-upscaler',
      'browser',
    ]);

    expect(describeUniversalImageUpscaleWorkflow('android-accelerator')).toMatchObject({
      provider: 'android-accelerator',
      family: 'android',
      methodLabel: 'Android accelerator',
      costUsd: 0,
      costLabel: 'free',
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: true,
        fixedScaleFactors: [],
        preservesImageDocumentLayers: false,
        requiresCloudCredentials: false,
        requiresConfiguredEndpoint: true,
        runsInAndroidApp: false,
        usesCloudProvider: false,
      },
    });
    expect(describeUniversalImageUpscaleWorkflow('android-native')).toMatchObject({
      provider: 'android-native',
      family: 'android',
      methodLabel: 'Android native image upscaler',
      costUsd: 0,
      costLabel: 'free',
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: true,
        runsInAndroidApp: true,
        usesCloudProvider: false,
      },
    });
    expect(describeUniversalImageUpscaleWorkflow('local-ai-cpu')).toMatchObject({
      provider: 'local-ai-cpu',
      family: 'local',
      methodLabel: 'Local Vulkan AI upscaler',
      costUsd: 0,
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: true,
        requiresConfiguredEndpoint: true,
        usesCloudProvider: false,
      },
      notes: ['Managed desktop runtime: Real-ESRGAN ncnn with Vulkan acceleration; no CPU fallback.'],
    });
    expect(describeUniversalImageUpscaleWorkflow('stability-fast')).toMatchObject({
      provider: 'stability-fast',
      family: 'cloud',
      costUsd: 0.02,
      costLabel: '$0.02',
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: false,
        fixedScaleFactors: [],
        requiresCloudCredentials: true,
        usesCloudProvider: true,
      },
    });
    expect(describeUniversalImageUpscaleWorkflow('stability-conservative')).toMatchObject({
      provider: 'stability-conservative',
      family: 'cloud',
      costUsd: 0.4,
      costLabel: '$0.40',
    });

    const vertex = describeUniversalImageUpscaleWorkflow('vertex-imagen');
    expect(vertex).toMatchObject({
      provider: 'vertex-imagen',
      family: 'cloud',
      costLabel: 'cost unknown',
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: false,
        fixedScaleFactors: ['x2', 'x3', 'x4'],
        requiresCloudCredentials: true,
        usesCloudProvider: true,
      },
    });
    expect(vertex.costUsd).toBeUndefined();

    expect(describeUniversalImageUpscaleWorkflow('atlas-image-upscaler')).toMatchObject({
      provider: 'atlas-image-upscaler',
      family: 'cloud',
      methodLabel: 'Atlas Image Upscaler',
      costUsd: 0.01,
      costLabel: '$0.01',
      capabilities: {
        aiUpscale: true,
        directTargetDimensions: false,
        fixedScaleFactors: ['x2', 'x3', 'x4'],
        requiresCloudCredentials: true,
        requiresConfiguredEndpoint: false,
        usesCloudProvider: true,
      },
    });

    expect(describeUniversalImageUpscaleWorkflow('browser')).toMatchObject({
      provider: 'browser',
      family: 'local',
      costUsd: 0,
      costLabel: 'free',
      capabilities: {
        aiUpscale: false,
        directTargetDimensions: true,
        fixedScaleFactors: [],
        preservesImageDocumentLayers: true,
        requiresCloudCredentials: false,
        requiresConfiguredEndpoint: false,
        usesCloudProvider: false,
      },
    });
  });

  it('reports contextual workflow warnings for unsupported sound-effect and already-print-resolution exclusions', () => {
    expect(getUniversalImageUpscaleWorkflowWarnings({})).toEqual([]);
    expect(getUniversalImageUpscaleWorkflowWarnings({
      sourceKind: 'comic-sound-effect',
      alreadyMeetsPrintResolution: true,
    })).toEqual([
      {
        code: 'unsupported-sound-effect',
        severity: 'warning',
        message: 'Comic sound-effect decals are skipped by the universal image upscaler; edit the SFX design or rasterize it as a normal image first.',
      },
      {
        code: 'already-print-resolution',
        severity: 'info',
        message: 'The source already meets the requested print resolution, so no universal upscaling job should be queued.',
      },
    ]);
  });

  it('publishes SFX, print-resolution, and fallback-order policy signatures', () => {
    const readiness = describeUniversalImageUpscaleReadiness({
      providerSettings: DEFAULT_PROVIDER_SETTINGS,
      sourceKind: 'comic-sound-effect',
      sourceWidthPx: 1200,
      sourceHeightPx: 900,
      printTarget: {
        widthIn: 4,
        heightIn: 3,
        targetDpi: 300,
      },
      androidNativeAvailable: true,
    }) as ReturnType<typeof describeUniversalImageUpscaleReadiness> & {
      policy?: {
        sourceExclusion: {
          sourceKind: string;
          action: string;
          blockerCode?: string;
        };
        printResolution: {
          defaultTargetDpi: number;
          action: string;
          alreadyMeetsPrintResolution: boolean;
        };
        fallbackOrder: Array<{ rank: number; routeId: string; provider: string; selected: boolean }>;
        stableSignature: string;
      };
    };

    expect(readiness.policy).toMatchObject({
      sourceExclusion: {
        sourceKind: 'comic-sound-effect',
        action: 'exclude-upscale',
        blockerCode: 'unsupported-sound-effect',
        stableSignature: 'image-upscale-source-exclusion:v1|source=comic-sound-effect|action=exclude-upscale|blocker=unsupported-sound-effect',
      },
      printResolution: {
        defaultTargetDpi: 300,
        action: 'skip-upscale',
        alreadyMeetsPrintResolution: true,
        stableSignature: 'image-upscale-print-resolution:v1|dpi=300|required=1200x900|action=skip-upscale|already=yes',
      },
      fallbackOrder: [
        { rank: 1, routeId: 'on-device-preferred', provider: 'android-native', selected: false },
        { rank: 2, routeId: 'cloud-fallback', provider: 'stability-fast', selected: false },
        { rank: 3, routeId: 'bitmap-fallback', provider: 'browser', selected: false },
      ],
      stableSignature: 'image-universal-upscale-policy:v1|source=comic-sound-effect:exclude-upscale|print=300:1200x900:skip-upscale|fallback=on-device-preferred>cloud-fallback>bitmap-fallback',
    });
  });

  it('selects Android native upscaling in Auto when running inside the Android app without a paired accelerator URL', () => {
    expect(resolveUniversalConfiguredUpscalePlan({
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        paperPrintUpscaleMethod: 'auto',
        androidAcceleratorBaseUrl: '',
        localAiCpuEndpointUrl: 'http://127.0.0.1:8788',
      },
      androidNativeAvailable: true,
    })).toMatchObject({
      provider: 'android-native',
      canRun: true,
      costUsd: 0,
      label: 'Android native image upscaler',
    });
  });

  it('describes on-device preferred, cloud fallback, and bitmap fallback readiness with print target metadata', () => {
    const readiness = describeUniversalImageUpscaleReadiness({
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        androidAcceleratorBaseUrl: 'http://192.168.1.44:8788',
      },
      apiKeys: { stability: 'stability-key' },
      sourceWidthPx: 600,
      sourceHeightPx: 400,
      printTarget: {
        widthIn: 4,
        heightIn: 3,
        targetDpi: 300,
      },
    });

    expect(readiness).toMatchObject({
      descriptorId: 'image-universal-upscale-readiness:v1',
      readiness: 'ready',
      sourceKind: 'image',
      target: {
        sourceWidthPx: 600,
        sourceHeightPx: 400,
        widthPx: 1200,
        heightPx: 900,
        policy: 'print-dpi',
        printResolution: {
          targetDpi: 300,
          alreadyMeetsPrintResolution: false,
          action: 'queue-upscale',
        },
      },
      blockers: [],
    });
    expect(readiness.routes.map((route) => ({
      id: route.id,
      provider: route.provider,
      readiness: route.readiness,
      selected: route.selected,
      costLabel: route.costLabel,
      usesCloudProvider: route.capabilities.usesCloudProvider,
    }))).toEqual([
      {
        id: 'on-device-preferred',
        provider: 'android-accelerator',
        readiness: 'ready',
        selected: true,
        costLabel: 'free',
        usesCloudProvider: false,
      },
      {
        id: 'cloud-fallback',
        provider: 'stability-fast',
        readiness: 'ready',
        selected: false,
        costLabel: '$0.02',
        usesCloudProvider: true,
      },
      {
        id: 'bitmap-fallback',
        provider: 'browser',
        readiness: 'ready',
        selected: false,
        costLabel: 'free',
        usesCloudProvider: false,
      },
    ]);
    expect(readiness.stableSignature).toBe(
      'image-universal-upscale-readiness:v1|source=image:600x400|target=print-dpi:1200x900:dpi=300:action=queue-upscale|readiness=ready|routes=on-device-preferred:android-accelerator:ready:selected,cloud-fallback:stability-fast:ready:fallback,bitmap-fallback:browser:ready:fallback|blockers=none',
    );
  });

  it('excludes comic SFX and marks already-print-resolution targets as skip-upscale', () => {
    const readiness = describeUniversalImageUpscaleReadiness({
      providerSettings: DEFAULT_PROVIDER_SETTINGS,
      sourceKind: 'comic-sound-effect',
      sourceWidthPx: 2400,
      sourceHeightPx: 1800,
      printTarget: {
        widthIn: 4,
        heightIn: 3,
        targetDpi: 300,
      },
      androidNativeAvailable: true,
    });

    expect(readiness.readiness).toBe('blocked');
    expect(readiness.target.printResolution.action).toBe('skip-upscale');
    expect(readiness.target.printResolution.alreadyMeetsPrintResolution).toBe(true);
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual(['unsupported-sound-effect']);
    expect(readiness.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-sound-effect',
      'already-print-resolution',
    ]);
    expect(readiness.routes.every((route) => route.readiness === 'blocked')).toBe(true);
    expect(readiness.stableSignature).toContain('blockers=unsupported-sound-effect');
  });

  it('reports dependency, model, runtime, and cloud blockers while keeping bitmap fallback ready', () => {
    const readiness = describeUniversalImageUpscaleReadiness({
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        vertexProjectId: '',
        vertexLocation: '',
        localAiCpuEndpointUrl: '',
        androidAcceleratorBaseUrl: '',
      },
      sourceWidthPx: 512,
      sourceHeightPx: 512,
      targetWidthPx: 2048,
      targetHeightPx: 2048,
      androidNativeAvailable: false,
      onDeviceRuntime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: false,
        bundledUpscalerModelAvailable: false,
      },
    });

    expect(readiness.readiness).toBe('degraded');
    expect(readiness.routes[0]).toMatchObject({
      id: 'on-device-preferred',
      provider: 'android-native',
      readiness: 'blocked',
    });
    expect(readiness.routes[0].blockers.map((blocker) => blocker.code)).toEqual([
      'qnn-runtime-missing',
      'upscaler-model-missing',
    ]);
    expect(readiness.routes[1].blockers.map((blocker) => blocker.code)).toEqual(['cloud-provider-missing']);
    expect(readiness.routes[2]).toMatchObject({
      id: 'bitmap-fallback',
      provider: 'browser',
      readiness: 'ready',
      selected: true,
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'qnn-runtime-missing',
      'upscaler-model-missing',
      'cloud-provider-missing',
    ]);
  });

  it('keeps print-resolution skip policy explicit even when Android native upscaling is otherwise available', () => {
    const readiness = describeUniversalImageUpscaleReadiness({
      providerSettings: DEFAULT_PROVIDER_SETTINGS,
      sourceWidthPx: 2400,
      sourceHeightPx: 1800,
      printTarget: {
        widthIn: 4,
        heightIn: 3,
        targetDpi: 300,
      },
      androidNativeAvailable: true,
      onDeviceRuntime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: true,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: true,
        singleApplicationRuntimeAvailable: true,
        secondAppDependencyRequired: false,
        preferredAccelerators: ['qnn'],
        acceleratedExecutionProven: false,
      },
    });

    expect(readiness.readiness).toBe('not-needed');
    expect(readiness.target.printResolution).toMatchObject({
      alreadyMeetsPrintResolution: true,
      action: 'skip-upscale',
    });
    expect(readiness.routes.every((route) => route.selected === false)).toBe(true);
    expect(readiness.routes.map((route) => route.readiness)).toEqual([
      'not-needed',
      'not-needed',
      'not-needed',
    ]);
    expect(readiness.warnings.map((warning) => warning.code)).toEqual(['already-print-resolution']);
  });
});
