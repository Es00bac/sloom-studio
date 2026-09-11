import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  describeAndroidNativeUpscalerRouteContract,
  describeAndroidNativeUpscalerPath,
  describeAndroidNativeImageParityReadiness,
  normalizeAndroidNativeImageUpscaleRequest,
} from './androidNativeImageUpscaler';

describe('androidNativeImageUpscaler', () => {
  it('normalizes target dimensions, output format, and quality before calling Android', () => {
    expect(normalizeAndroidNativeImageUpscaleRequest({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 255.6,
      targetHeightPx: 0,
      outputFormat: 'jpeg',
      quality: 2,
    })).toEqual({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 256,
      targetHeightPx: 1,
      outputFormat: 'jpeg',
      quality: 1,
      preferredBackend: 'local-dream-qnn',
      upscalerId: 'upscaler_realistic',
      allowBitmapFallback: true,
    });
  });

  it('defaults Android native requests to Local Dream QNN upscaling', () => {
    expect(normalizeAndroidNativeImageUpscaleRequest({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 1024,
      targetHeightPx: 1024,
    })).toMatchObject({
      preferredBackend: 'local-dream-qnn',
      upscalerId: 'upscaler_realistic',
    });
  });

  it('keeps the Android plugin wired to Local Dream QNN binary upscale before bitmap fallback', () => {
    const javaSource = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/java/studio/sloom/slstapp/SignalLoomImageUpscalerPlugin.java'),
      'utf8',
    );
    const gradleSource = readFileSync(
      resolve(process.cwd(), 'android/app/build.gradle'),
      'utf8',
    );

    expect(javaSource).toContain('LOCAL_DREAM_UPSCALE_URL');
    expect(javaSource).toContain('http://127.0.0.1:8081/upscale');
    expect(javaSource).toContain('X-Upscaler-Path');
    expect(javaSource).toContain('startBundledLocalDreamUpscalerBackend');
    expect(javaSource).toContain('getFilesDir()');
    expect(javaSource).toContain('local-dream-qnn-htp');
    expect(javaSource).toContain('runBitmapFallbackUpscale');
    expect(javaSource).not.toContain('io.github.xororz.localdream');
    expect(javaSource).not.toContain('/data/data/');
    expect(gradleSource).toContain('useLegacyPackaging true');
  });

  it('summarizes Android-native QNN and fallback upscaler readiness deterministically', () => {
    const descriptor = describeAndroidNativeImageParityReadiness({
      sourceKind: 'blank-canvas',
      targetWidthPx: 2048,
      targetHeightPx: 1536,
      runtime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: true,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: true,
        singleApplicationRuntimeAvailable: true,
        secondAppDependencyRequired: false,
        acceleratedExecutionProven: true,
      },
      cloudFallback: {
        providerConfigured: true,
        providerName: 'openai',
        modelId: 'gpt-image-1',
        estimatedCostUsd: 0.06,
      },
      evidence: {
        dexDisplay: {
          available: true,
          artifactPath: 'artifacts/android/dex-1080p-open-document.png',
          width: 1920,
          height: 1080,
        },
        openDocumentEdit: {
          available: true,
          documentKind: 'blank-canvas',
          editMarksVisible: true,
          artifactPath: 'artifacts/android/open-document-brush.png',
        },
        importedFileEdit: {
          available: false,
        },
      },
    });

    expect(descriptor.unsupportedStates).toEqual([
      {
        code: 'imported-file-edit-evidence-unproven',
        summary: 'Imported-image editing parity is not proven until an imported file is opened, visibly edited, and captured as an artifact.',
      },
    ]);
    expect(descriptor.evidence.dexDisplay).toMatchObject({
      status: 'covered',
      requiredResolution: '1920x1080',
      caveat: 'DeX evidence meets the 1080p opened-document requirement for Android Image parity review.',
    });
    expect(descriptor.routes.map((route) => ({
      id: route.id,
      readiness: route.readiness,
      method: route.method.summary,
      costTier: route.cost.tier,
      capability: route.capability.summary,
    }))).toEqual([
      {
        id: 'android-local-dream-qnn',
        readiness: 'ready',
        method: 'Single-app on-device accelerated model path through the Capacitor plugin with QNN, NNAPI, or equivalent execution proven.',
        costTier: 'local-device',
        capability: 'Sloom Studio single-app Android-native accelerated upscaling path through the Capacitor plugin.',
      },
      {
        id: 'android-bitmap-fallback',
        readiness: 'ready',
        method: 'Local Android bitmap resize for availability-only upscale fallback.',
        costTier: 'local-device',
        capability: 'Deterministic Android bitmap resize fallback when QNN startup or model execution is unavailable.',
      },
      {
        id: 'cloud-upscaler-fallback',
        readiness: 'ready',
        method: 'Provider-backed image upscale or regeneration handoff outside the Android runtime.',
        costTier: 'metered-cloud',
        capability: 'Configured cloud image model fallback for upscale/regeneration handoff.',
      },
    ]);
    expect(descriptor.evidence.dexDisplay).toMatchObject({
      available: true,
      resolution: '1920x1080',
      artifactPath: 'artifacts/android/dex-1080p-open-document.png',
    });
    expect(descriptor.importedFileEditingCoverage).toMatchObject({
      status: 'gap',
      required: true,
      caveat: 'Blank-canvas opened-document evidence does not prove imported-file editing parity.',
    });
    expect(descriptor.blockers.map((blocker) => blocker.code)).toEqual(['imported-file-edit-evidence-missing']);
    expect(descriptor.previewSignature).toBe('android-image-parity-readiness:v1|source=blank-canvas|target=2048x1536|routes=android-local-dream-qnn:ready:on-device-qnn,android-bitmap-fallback:ready:android-bitmap-resize,cloud-upscaler-fallback:ready:cloud-provider|evidence=dex:covered:1920x1080,open:yes:blank-canvas:edited,imported:gap|blockers=imported-file-edit-evidence-missing|unsupported=imported-file-edit-evidence-unproven');
  });

  it('publishes concrete on-device NPU readiness checks with fallback order and stable signature', () => {
    const descriptor = describeAndroidNativeImageParityReadiness({
      sourceKind: 'imported-file',
      targetWidthPx: 1600,
      targetHeightPx: 1200,
      runtime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: true,
        nnapiRuntimeAvailable: false,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: false,
        singleApplicationRuntimeAvailable: false,
        secondAppDependencyRequired: true,
        preferredAccelerators: ['qnn', 'nnapi'],
        acceleratedExecutionProven: false,
      },
      evidence: {
        dexDisplay: {
          available: true,
          width: 1366,
          height: 768,
          artifactPath: 'artifacts/android/dex-too-small.png',
        },
        openDocumentEdit: {
          available: true,
          documentKind: 'imported-file',
          editMarksVisible: true,
          artifactPath: 'artifacts/android/imported-open-document.png',
        },
        importedFileEdit: {
          available: true,
          fileName: 'portrait.png',
          editMarksVisible: false,
          artifactPath: 'artifacts/android/imported-without-edits.png',
        },
      },
    }) as ReturnType<typeof describeAndroidNativeImageParityReadiness> & {
      onDeviceUpscaleReadiness?: {
        descriptorId: string;
        checks: Array<{ code: string; state: string; blockerCode?: string }>;
        fallbackOrder: string[];
        stableSignature: string;
      };
    };

    expect(descriptor.onDeviceUpscaleReadiness).toMatchObject({
      descriptorId: 'android-on-device-upscale-readiness:v1',
      fallbackOrder: [
        'android-local-dream-qnn',
        'android-bitmap-fallback',
        'cloud-upscaler-fallback',
      ],
      stableSignature: 'android-on-device-upscale-readiness:v1|target=1600x1200|checks=android-runtime:present,native-plugin:present,local-dream-service:present,accelerator-runtime:present,runtime-assets:present,upscaler-model:missing,single-app-runtime:blocked,no-second-app-handoff:blocked,accelerated-execution:not-proven,dex-1080p-evidence:insufficient,imported-file-edit-evidence:gap|fallback=android-local-dream-qnn>android-bitmap-fallback>cloud-upscaler-fallback|blockers=single-app-runtime-missing,second-app-handoff-required,upscaler-model-missing,cloud-provider-missing,dex-1080p-evidence-missing,imported-file-edit-evidence-missing',
    });
    expect(descriptor.onDeviceUpscaleReadiness?.checks.map((check) => [
      check.code,
      check.state,
      check.blockerCode,
    ])).toEqual([
      ['android-runtime', 'present', undefined],
      ['native-plugin', 'present', undefined],
      ['local-dream-service', 'present', undefined],
      ['accelerator-runtime', 'present', undefined],
      ['runtime-assets', 'present', undefined],
      ['upscaler-model', 'missing', 'upscaler-model-missing'],
      ['single-app-runtime', 'blocked', 'single-app-runtime-missing'],
      ['no-second-app-handoff', 'blocked', 'second-app-handoff-required'],
      ['accelerated-execution', 'not-proven', undefined],
      ['dex-1080p-evidence', 'insufficient', 'dex-1080p-evidence-missing'],
      ['imported-file-edit-evidence', 'gap', 'imported-file-edit-evidence-missing'],
    ]);
  });

  it('publishes route-contract signatures for one-app QNN, model assets, fallbacks, and second-app blockers', () => {
    const contract = describeAndroidNativeUpscalerRouteContract({
      runtime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: false,
        nnapiRuntimeAvailable: true,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: false,
        singleApplicationRuntimeAvailable: true,
        secondAppDependencyRequired: true,
        preferredAccelerators: ['qnn', 'nnapi'],
        acceleratedExecutionProven: false,
      },
      cloudFallback: {
        providerConfigured: false,
        providerName: 'openai',
        modelId: 'gpt-image-1',
      },
    });

    expect(contract).toMatchObject({
      descriptorId: 'android-native-upscaler-route-contract:v1',
      nativeRoute: {
        routeId: 'android-local-dream-qnn',
        state: 'blocked',
        singleApplicationRequired: true,
        noSecondAppHandoff: false,
        acceleratedExecution: 'unproven',
        stableSignature: 'android-native-route:v1|route=android-local-dream-qnn|state=blocked|runtime=android:plugin:local-dream|accelerators=qnn:unavailable,nnapi:available|single-app=yes|second-app=blocked|execution=unproven',
      },
      modelReadiness: {
        runtimeAssets: 'available',
        upscalerModel: 'missing',
        state: 'missing',
        stableSignature: 'android-native-model:v1|runtime-assets=available|upscaler-model=missing|state=missing',
      },
      fallbackOrder: {
        routeIds: [
          'android-local-dream-qnn',
          'android-bitmap-fallback',
          'cloud-upscaler-fallback',
        ],
        stableSignature: 'android-native-fallback:v1|order=android-local-dream-qnn>android-bitmap-fallback>cloud-upscaler-fallback|states=android-local-dream-qnn:blocked,android-bitmap-fallback:blocked,cloud-upscaler-fallback:blocked',
      },
    });
    expect(contract.unsupportedStates.map((state) => state.code)).toEqual([
      'local-dream-qnn-upscale-unavailable',
      'accelerated-on-device-execution-unproven',
      'bitmap-fallback-unavailable',
      'cloud-fallback-unavailable',
    ]);
    expect(contract.stableSignature).toBe('android-native-upscaler-route-contract:v1|native=android-native-route:v1|route=android-local-dream-qnn|state=blocked|runtime=android:plugin:local-dream|accelerators=qnn:unavailable,nnapi:available|single-app=yes|second-app=blocked|execution=unproven|model=android-native-model:v1|runtime-assets=available|upscaler-model=missing|state=missing|fallback=android-native-fallback:v1|order=android-local-dream-qnn>android-bitmap-fallback>cloud-upscaler-fallback|states=android-local-dream-qnn:blocked,android-bitmap-fallback:blocked,cloud-upscaler-fallback:blocked|unsupported=local-dream-qnn-upscale-unavailable,accelerated-on-device-execution-unproven,bitmap-fallback-unavailable,cloud-fallback-unavailable');
  });

  it('reports runtime and model blockers without claiming imported-file editing coverage', () => {
    const descriptor = describeAndroidNativeImageParityReadiness({
      sourceKind: 'imported-file',
      targetWidthPx: 4096,
      targetHeightPx: 4096,
      runtime: {
        platform: 'web',
        capacitorAndroid: false,
        pluginRegistered: false,
        localDreamServiceAvailable: false,
        qnnRuntimeAvailable: false,
        bundledUpscalerModelAvailable: false,
      },
      cloudFallback: {
        providerConfigured: false,
        providerName: 'openai',
        modelId: 'gpt-image-1',
      },
      evidence: {
        openDocumentEdit: {
          available: true,
          documentKind: 'blank-canvas',
          editMarksVisible: true,
        },
        importedFileEdit: {
          available: false,
        },
      },
    });

    expect(descriptor.routes.map((route) => [route.id, route.readiness])).toEqual([
      ['android-local-dream-qnn', 'blocked'],
      ['android-bitmap-fallback', 'blocked'],
      ['cloud-upscaler-fallback', 'blocked'],
    ]);
    expect(descriptor.evidence.dexDisplay).toMatchObject({
      status: 'missing',
      requiredResolution: '1920x1080',
      caveat: 'Android Image parity requires DeX or equivalent external-display evidence at 1920x1080 or higher.',
    });
    expect(descriptor.blockers.map((blocker) => blocker.code)).toEqual([
      'not-android-runtime',
      'android-plugin-missing',
      'local-dream-service-missing',
      'qnn-runtime-missing',
      'upscaler-model-missing',
      'cloud-provider-missing',
      'dex-1080p-evidence-missing',
      'imported-file-edit-evidence-missing',
    ]);
    expect(descriptor.unsupportedStates.map((state) => state.code)).toEqual([
      'android-native-runtime-unavailable',
      'local-dream-qnn-upscale-unavailable',
      'bitmap-fallback-unavailable',
      'cloud-fallback-unavailable',
      'dex-1080p-evidence-unproven',
      'imported-file-edit-evidence-unproven',
    ]);
    expect(descriptor.caveats).toContain('Readiness helper is descriptor-only; it does not execute the Android plugin, start Local Dream, load models, or mutate image pixels.');
    expect(descriptor.previewSignature).toBe('android-image-parity-readiness:v1|source=imported-file|target=4096x4096|routes=android-local-dream-qnn:blocked:on-device-qnn,android-bitmap-fallback:blocked:android-bitmap-resize,cloud-upscaler-fallback:blocked:cloud-provider|evidence=dex:missing:unknown,open:yes:blank-canvas:edited,imported:gap|blockers=not-android-runtime,android-plugin-missing,local-dream-service-missing,qnn-runtime-missing,upscaler-model-missing,cloud-provider-missing,dex-1080p-evidence-missing,imported-file-edit-evidence-missing|unsupported=android-native-runtime-unavailable,local-dream-qnn-upscale-unavailable,bitmap-fallback-unavailable,cloud-fallback-unavailable,dex-1080p-evidence-unproven,imported-file-edit-evidence-unproven');
  });

  it('requires imported file name, visible edit marks, and an artifact before covering imported-image edits', () => {
    const descriptor = describeAndroidNativeImageParityReadiness({
      sourceKind: 'imported-file',
      targetWidthPx: 1200,
      targetHeightPx: 800,
      runtime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: true,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: true,
        singleApplicationRuntimeAvailable: true,
        secondAppDependencyRequired: false,
        acceleratedExecutionProven: true,
      },
      cloudFallback: {
        providerConfigured: true,
        providerName: 'openai',
        modelId: 'gpt-image-1',
      },
      evidence: {
        dexDisplay: {
          available: true,
          width: 1920,
          height: 1080,
          artifactPath: 'artifacts/android/dex-imported-edit.png',
        },
        openDocumentEdit: {
          available: true,
          documentKind: 'imported-file',
          editMarksVisible: true,
          artifactPath: 'artifacts/android/imported-open-document.png',
        },
        importedFileEdit: {
          available: true,
          fileName: 'portrait.png',
          artifactPath: 'artifacts/android/imported-portrait-edit.png',
          editMarksVisible: true,
        },
      },
    });

    expect(descriptor.importedFileEditingCoverage).toMatchObject({
      available: true,
      status: 'covered',
      fileName: 'portrait.png',
      editMarksVisible: true,
      caveat: 'Imported-file edit evidence is present with visible edit marks and an artifact for Android Image parity readiness.',
    });
    expect(descriptor.blockers).toEqual([]);
    expect(descriptor.unsupportedStates).toEqual([]);
  });

  it('requires a single-app runtime contract and rejects second-app handoff dependencies', () => {
    const path = describeAndroidNativeUpscalerPath({
      platform: 'android',
      capacitorAndroid: true,
      pluginRegistered: true,
      localDreamServiceAvailable: true,
      qnnRuntimeAvailable: true,
      bundledRuntimeAssetsAvailable: true,
      bundledUpscalerModelAvailable: true,
      singleApplicationRuntimeAvailable: false,
      secondAppDependencyRequired: true,
      preferredAccelerators: ['qnn', 'nnapi'],
      acceleratedExecutionProven: false,
    });

    expect(path.singleApplication).toEqual({
      required: true,
      available: false,
      secondAppDependencyRequired: true,
      readiness: 'blocked',
      summary: 'Android native upscale readiness requires a single Sloom Studio app runtime path with no second-app handoff.',
    });
    expect(path.readiness).toBe('blocked');
    expect(path.blockers.map((blocker) => blocker.code)).toEqual([
      'single-app-runtime-missing',
      'second-app-handoff-required',
    ]);
  });

  it('describes QNN and NNAPI accelerator preference honestly when live accelerated execution is not yet proven', () => {
    const path = describeAndroidNativeUpscalerPath({
      platform: 'android',
      capacitorAndroid: true,
      pluginRegistered: true,
      localDreamServiceAvailable: true,
      qnnRuntimeAvailable: true,
      nnapiRuntimeAvailable: true,
      bundledRuntimeAssetsAvailable: true,
      bundledUpscalerModelAvailable: true,
      singleApplicationRuntimeAvailable: true,
      secondAppDependencyRequired: false,
      preferredAccelerators: ['qnn', 'nnapi'],
      acceleratedExecutionProven: false,
    });

    expect(path.readiness).toBe('degraded');
    expect(path.preferredAccelerators).toEqual(['qnn', 'nnapi']);
    expect(path.accelerators).toEqual([
      {
        id: 'qnn',
        label: 'QNN',
        availability: 'available',
        preferred: true,
      },
      {
        id: 'nnapi',
        label: 'NNAPI',
        availability: 'available',
        preferred: true,
      },
    ]);
    expect(path.execution).toEqual({
      mode: 'accelerated-on-device-preferred',
      readiness: 'degraded',
      proven: false,
      summary: 'Sloom Studio is prepared to prefer an on-device accelerated model path (QNN/NNAPI or equivalent), but live accelerator inference is not yet proven by this helper.',
      evidenceSource: 'descriptor-only',
    });
  });

  it('checks bundled runtime assets and in-app model availability before advertising the accelerated path as ready', () => {
    const path = describeAndroidNativeUpscalerPath({
      platform: 'android',
      capacitorAndroid: true,
      pluginRegistered: true,
      localDreamServiceAvailable: true,
      qnnRuntimeAvailable: true,
      bundledRuntimeAssetsAvailable: false,
      bundledUpscalerModelAvailable: false,
      singleApplicationRuntimeAvailable: true,
      secondAppDependencyRequired: false,
      preferredAccelerators: ['qnn'],
      acceleratedExecutionProven: false,
    });

    expect(path.modelBundle).toEqual({
      runtimeAssetsAvailable: false,
      upscalerModelAvailable: false,
      readiness: 'missing',
      summary: 'The single-app accelerated path depends on bundled runtime assets plus an in-app upscaler model bundle or download owned by Sloom Studio.',
    });
    expect(path.blockers.map((blocker) => blocker.code)).toEqual([
      'runtime-assets-missing',
      'upscaler-model-missing',
    ]);
  });

  it('projects explicit degraded fallback states from Android readiness without claiming live accelerator execution', () => {
    const descriptor = describeAndroidNativeImageParityReadiness({
      sourceKind: 'generated',
      targetWidthPx: 2048,
      targetHeightPx: 2048,
      runtime: {
        platform: 'android',
        capacitorAndroid: true,
        pluginRegistered: true,
        localDreamServiceAvailable: true,
        qnnRuntimeAvailable: true,
        nnapiRuntimeAvailable: true,
        bundledRuntimeAssetsAvailable: true,
        bundledUpscalerModelAvailable: true,
        singleApplicationRuntimeAvailable: true,
        secondAppDependencyRequired: false,
        preferredAccelerators: ['qnn', 'nnapi'],
        acceleratedExecutionProven: false,
      },
      evidence: {
        dexDisplay: {
          available: true,
          width: 1920,
          height: 1080,
          artifactPath: 'artifacts/android/dex-generated-upscale.png',
        },
        openDocumentEdit: {
          available: true,
          documentKind: 'generated',
          editMarksVisible: true,
          artifactPath: 'artifacts/android/generated-upscale-edit.png',
        },
        importedFileEdit: {
          available: true,
          fileName: 'generated.png',
          artifactPath: 'artifacts/android/generated-upscale-imported.png',
          editMarksVisible: true,
        },
      },
    });

    expect(descriptor.routes.map((route) => [route.id, route.readiness])).toEqual([
      ['android-local-dream-qnn', 'degraded'],
      ['android-bitmap-fallback', 'ready'],
      ['cloud-upscaler-fallback', 'blocked'],
    ]);
    expect(descriptor.unsupportedStates).toEqual([
      {
        code: 'accelerated-on-device-execution-unproven',
        summary: 'Accelerated on-device inference cannot be claimed until Sloom Studio proves QNN, NNAPI, or an equivalent backend is executing inside the same app.',
      },
      {
        code: 'cloud-fallback-unavailable',
        summary: 'Cloud fallback is unsupported until provider credentials and a fallback image model are configured.',
      },
    ]);
    expect(descriptor.caveats).toContain(
      'Accelerator preference is descriptor-only here; readiness does not claim that QNN, NNAPI, or equivalent accelerated inference is already executing in production.',
    );
  });

  it('distinguishes plugin-reported bitmap fallback execution from real accelerator evidence', () => {
    const path = describeAndroidNativeUpscalerPath({
      platform: 'android',
      capacitorAndroid: true,
      pluginRegistered: true,
      localDreamServiceAvailable: true,
      qnnRuntimeAvailable: true,
      nnapiRuntimeAvailable: true,
      bundledRuntimeAssetsAvailable: true,
      bundledUpscalerModelAvailable: true,
      singleApplicationRuntimeAvailable: true,
      secondAppDependencyRequired: false,
      preferredAccelerators: ['qnn', 'nnapi'],
      acceleratedExecutionProven: true,
      lastUpscaleAccelerator: 'android-native-bitmap-fallback',
      lastUpscaleBackend: 'android-bitmap',
    });

    expect(path.readiness).toBe('degraded');
    expect(path.execution).toMatchObject({
      proven: false,
      readiness: 'degraded',
      summary: 'The latest plugin-reported Android native upscale ran with bitmap fallback, so live QNN/NNAPI accelerator execution is still unproven.',
      evidenceSource: 'plugin-runtime-report',
      reportedRuntime: {
        accelerator: 'android-native-bitmap-fallback',
        backend: 'android-bitmap',
        kind: 'bitmap-fallback',
      },
    });
  });

  it('registers the Capacitor plugin only once across module re-evaluation and use', async () => {
    vi.resetModules();
    const upscale = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,upscaled',
      mimeType: 'image/png',
    }));
    const registerPlugin = vi.fn(() => ({ upscale }));

    vi.doMock('@capacitor/core', () => ({
      Capacitor: {
        getPlatform: () => 'android',
      },
      registerPlugin,
    }));

    const firstModule = await import('./androidNativeImageUpscaler');
    await firstModule.runAndroidNativeImageUpscale({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 10,
      targetHeightPx: 10,
    });
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: {
        getPlatform: () => 'android',
      },
      registerPlugin,
    }));
    const secondModule = await import('./androidNativeImageUpscaler');
    await secondModule.runAndroidNativeImageUpscale({
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 12,
      targetHeightPx: 12,
    });

    expect(registerPlugin).toHaveBeenCalledTimes(1);
    expect(upscale).toHaveBeenCalledTimes(2);

    vi.doUnmock('@capacitor/core');
    vi.resetModules();
  });
});
