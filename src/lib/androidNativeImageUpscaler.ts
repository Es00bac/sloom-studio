import { Capacitor, registerPlugin } from '@capacitor/core';

export interface AndroidNativeImageUpscaleInput {
  sourceDataUrl: string;
  targetWidthPx: number;
  targetHeightPx: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  preferredBackend?: 'local-dream-qnn' | 'bitmap-fallback';
  upscalerId?: 'upscaler_realistic' | 'upscaler_anime' | string;
  allowBitmapFallback?: boolean;
}

export interface AndroidNativeImageUpscaleResult {
  dataUrl: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | string;
  width?: number;
  height?: number;
  accelerator?: string;
  backend?: string;
  modelUsed?: string;
  durationMs?: number;
  warnings?: string[];
}

export type AndroidImageParitySourceKind = 'blank-canvas' | 'imported-file' | 'generated' | 'source-library';

export type AndroidImageParityRouteReadiness = 'ready' | 'degraded' | 'blocked';

export interface AndroidImageParityRuntimeInput {
  platform?: string;
  capacitorAndroid?: boolean;
  pluginRegistered?: boolean;
  localDreamServiceAvailable?: boolean;
  qnnRuntimeAvailable?: boolean;
  nnapiRuntimeAvailable?: boolean;
  equivalentAcceleratorAvailable?: boolean;
  bundledRuntimeAssetsAvailable?: boolean;
  bundledUpscalerModelAvailable?: boolean;
  singleApplicationRuntimeAvailable?: boolean;
  secondAppDependencyRequired?: boolean;
  preferredAccelerators?: string[];
  acceleratedExecutionProven?: boolean;
  lastUpscaleAccelerator?: string;
  lastUpscaleBackend?: string;
  lastUpscaleModelUsed?: string;
}

export interface AndroidImageParityCloudFallbackInput {
  providerConfigured?: boolean;
  providerName?: string;
  modelId?: string;
  estimatedCostUsd?: number;
}

export interface AndroidImageParityDexEvidenceInput {
  available?: boolean;
  artifactPath?: string;
  width?: number;
  height?: number;
}

export interface AndroidImageParityOpenDocumentEvidenceInput {
  available?: boolean;
  documentKind?: AndroidImageParitySourceKind;
  editMarksVisible?: boolean;
  artifactPath?: string;
}

export interface AndroidImageParityImportedFileEvidenceInput {
  available?: boolean;
  fileName?: string;
  artifactPath?: string;
  editMarksVisible?: boolean;
}

export interface AndroidImageParityEvidenceInput {
  dexDisplay?: AndroidImageParityDexEvidenceInput;
  openDocumentEdit?: AndroidImageParityOpenDocumentEvidenceInput;
  importedFileEdit?: AndroidImageParityImportedFileEvidenceInput;
}

export interface AndroidImageParityReadinessInput {
  sourceKind?: AndroidImageParitySourceKind;
  targetWidthPx: number;
  targetHeightPx: number;
  runtime?: AndroidImageParityRuntimeInput;
  cloudFallback?: AndroidImageParityCloudFallbackInput;
  evidence?: AndroidImageParityEvidenceInput;
}

export interface AndroidImageParityCostDescriptor {
  tier: 'local-device' | 'metered-cloud';
  summary: string;
  estimatedCostUsd?: number;
}

export interface AndroidImageParityCapabilityDescriptor {
  summary: string;
  maxTargetPixels?: number;
  requiresAndroidRuntime: boolean;
  requiresBundledModel: boolean;
  singleApplicationOnly?: boolean;
  preferredAccelerators?: string[];
  mutatesPixels: false;
}

export interface AndroidImageParityMethodDescriptor {
  mode: 'on-device-qnn' | 'android-bitmap-resize' | 'cloud-provider';
  summary: string;
}

export interface AndroidImageParityRouteDescriptor {
  id: 'android-local-dream-qnn' | 'android-bitmap-fallback' | 'cloud-upscaler-fallback';
  label: string;
  readiness: AndroidImageParityRouteReadiness;
  method: AndroidImageParityMethodDescriptor;
  cost: AndroidImageParityCostDescriptor;
  capability: AndroidImageParityCapabilityDescriptor;
  blockers: AndroidImageParityBlocker[];
  caveats: string[];
}

export interface AndroidImageParityEvidenceDescriptor {
  available: boolean;
  artifactPath?: string;
}

export interface AndroidImageParityDexEvidenceDescriptor extends AndroidImageParityEvidenceDescriptor {
  resolution: string;
  status: 'covered' | 'insufficient' | 'missing';
  requiredResolution: '1920x1080';
  caveat: string;
}

export interface AndroidImageParityOpenDocumentEvidenceDescriptor extends AndroidImageParityEvidenceDescriptor {
  documentKind: AndroidImageParitySourceKind | 'unknown';
  editMarksVisible: boolean;
}

export interface AndroidImageParityImportedFileCoverageDescriptor extends AndroidImageParityEvidenceDescriptor {
  status: 'covered' | 'gap';
  required: true;
  fileName?: string;
  editMarksVisible: boolean;
  caveat: string;
}

export interface AndroidImageParityBlocker {
  code:
    | 'not-android-runtime'
    | 'android-plugin-missing'
    | 'local-dream-service-missing'
    | 'qnn-runtime-missing'
    | 'accelerator-runtime-missing'
    | 'runtime-assets-missing'
    | 'upscaler-model-missing'
    | 'single-app-runtime-missing'
    | 'second-app-handoff-required'
    | 'cloud-provider-missing'
    | 'dex-1080p-evidence-missing'
    | 'imported-file-edit-evidence-missing';
  message: string;
}

export interface AndroidImageParityUnsupportedState {
  code:
    | 'android-native-runtime-unavailable'
    | 'local-dream-qnn-upscale-unavailable'
    | 'accelerated-on-device-execution-unproven'
    | 'bitmap-fallback-unavailable'
    | 'cloud-fallback-unavailable'
    | 'dex-1080p-evidence-unproven'
    | 'imported-file-edit-evidence-unproven';
  summary: string;
}

export interface AndroidNativeUpscalerAcceleratorDescriptor {
  id: string;
  label: string;
  availability: 'available' | 'unavailable';
  preferred: boolean;
}

export interface AndroidNativeUpscalerSingleApplicationDescriptor {
  required: true;
  available: boolean;
  secondAppDependencyRequired: boolean;
  readiness: 'ready' | 'blocked';
  summary: string;
}

export interface AndroidNativeUpscalerModelBundleDescriptor {
  runtimeAssetsAvailable: boolean;
  upscalerModelAvailable: boolean;
  readiness: 'ready' | 'missing';
  summary: string;
}

export interface AndroidNativeUpscalerExecutionDescriptor {
  mode: 'accelerated-on-device-preferred';
  readiness: AndroidImageParityRouteReadiness;
  proven: boolean;
  summary: string;
  evidenceSource: 'plugin-runtime-report' | 'descriptor-flag' | 'descriptor-only';
  reportedRuntime?: {
    accelerator?: string;
    backend?: string;
    modelUsed?: string;
    kind: 'accelerated' | 'bitmap-fallback' | 'unknown';
  };
}

export interface AndroidNativeUpscalerPathDescriptor {
  readiness: AndroidImageParityRouteReadiness;
  singleApplication: AndroidNativeUpscalerSingleApplicationDescriptor;
  preferredAccelerators: string[];
  accelerators: AndroidNativeUpscalerAcceleratorDescriptor[];
  modelBundle: AndroidNativeUpscalerModelBundleDescriptor;
  execution: AndroidNativeUpscalerExecutionDescriptor;
  blockers: AndroidImageParityBlocker[];
}

export type AndroidNativeOnDeviceUpscaleReadinessCheckCode =
  | 'android-runtime'
  | 'native-plugin'
  | 'local-dream-service'
  | 'accelerator-runtime'
  | 'runtime-assets'
  | 'upscaler-model'
  | 'single-app-runtime'
  | 'no-second-app-handoff'
  | 'accelerated-execution'
  | 'dex-1080p-evidence'
  | 'imported-file-edit-evidence';

export type AndroidNativeOnDeviceUpscaleReadinessCheckState =
  | 'present'
  | 'missing'
  | 'blocked'
  | 'not-proven'
  | 'covered'
  | 'insufficient'
  | 'gap';

export interface AndroidNativeOnDeviceUpscaleReadinessCheck {
  code: AndroidNativeOnDeviceUpscaleReadinessCheckCode;
  label: string;
  required: boolean;
  state: AndroidNativeOnDeviceUpscaleReadinessCheckState;
  blockerCode?: AndroidImageParityBlocker['code'];
  summary: string;
}

export interface AndroidNativeOnDeviceUpscaleReadinessDescriptor {
  descriptorId: 'android-on-device-upscale-readiness:v1';
  mode: 'npu-qnn-style-on-device';
  target: {
    widthPx: number;
    heightPx: number;
  };
  path: AndroidNativeUpscalerPathDescriptor;
  checks: AndroidNativeOnDeviceUpscaleReadinessCheck[];
  evidence: {
    dexDisplay: AndroidImageParityDexEvidenceDescriptor;
    openDocumentEdit: AndroidImageParityOpenDocumentEvidenceDescriptor;
    importedFileEditingCoverage: AndroidImageParityImportedFileCoverageDescriptor;
  };
  fallbackOrder: AndroidImageParityRouteDescriptor['id'][];
  blockers: AndroidImageParityBlocker[];
  stableSignature: string;
}

export interface AndroidNativeUpscalerRouteContractInput {
  runtime?: AndroidImageParityRuntimeInput;
  cloudFallback?: AndroidImageParityCloudFallbackInput;
}

export interface AndroidNativeUpscalerNativeRouteContractDescriptor {
  routeId: Extract<AndroidImageParityRouteDescriptor['id'], 'android-local-dream-qnn'>;
  state: AndroidImageParityRouteReadiness;
  singleApplicationRequired: true;
  noSecondAppHandoff: boolean;
  acceleratedExecution: 'proven' | 'unproven';
  stableSignature: string;
}

export interface AndroidNativeUpscalerModelReadinessDescriptor {
  runtimeAssets: 'available' | 'missing';
  upscalerModel: 'available' | 'missing';
  state: 'ready' | 'missing';
  stableSignature: string;
}

export interface AndroidNativeUpscalerFallbackOrderContractDescriptor {
  routeIds: AndroidImageParityRouteDescriptor['id'][];
  stableSignature: string;
}

export interface AndroidNativeUpscalerRouteContractDescriptor {
  descriptorId: 'android-native-upscaler-route-contract:v1';
  nativeRoute: AndroidNativeUpscalerNativeRouteContractDescriptor;
  modelReadiness: AndroidNativeUpscalerModelReadinessDescriptor;
  fallbackOrder: AndroidNativeUpscalerFallbackOrderContractDescriptor;
  unsupportedStates: AndroidImageParityUnsupportedState[];
  stableSignature: string;
}

export interface AndroidImageParityReadinessDescriptor {
  descriptorId: 'android-image-parity-readiness:v1';
  sourceKind: AndroidImageParitySourceKind;
  target: {
    widthPx: number;
    heightPx: number;
  };
  routes: AndroidImageParityRouteDescriptor[];
  evidence: {
    dexDisplay: AndroidImageParityDexEvidenceDescriptor;
    openDocumentEdit: AndroidImageParityOpenDocumentEvidenceDescriptor;
  };
  importedFileEditingCoverage: AndroidImageParityImportedFileCoverageDescriptor;
  onDeviceUpscaleReadiness: AndroidNativeOnDeviceUpscaleReadinessDescriptor;
  blockers: AndroidImageParityBlocker[];
  unsupportedStates: AndroidImageParityUnsupportedState[];
  caveats: string[];
  previewSignature: string;
}

interface SignalLoomImageUpscalerPlugin {
  upscale(input: AndroidNativeImageUpscaleInput): Promise<AndroidNativeImageUpscaleResult>;
}

const SIGNAL_LOOM_IMAGE_UPSCALER_PLUGIN_KEY = '__signalLoomImageUpscalerPlugin';

function getSignalLoomImageUpscalerPlugin(): SignalLoomImageUpscalerPlugin {
  const globalState = globalThis as typeof globalThis & {
    [SIGNAL_LOOM_IMAGE_UPSCALER_PLUGIN_KEY]?: SignalLoomImageUpscalerPlugin;
  };
  const cachedPlugin = globalState[SIGNAL_LOOM_IMAGE_UPSCALER_PLUGIN_KEY];
  if (cachedPlugin) {
    return cachedPlugin;
  }
  const plugin = registerPlugin<SignalLoomImageUpscalerPlugin>('SignalLoomImageUpscaler');
  globalState[SIGNAL_LOOM_IMAGE_UPSCALER_PLUGIN_KEY] = plugin;
  return plugin;
}

export function isAndroidNativeImageUpscalerAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function runAndroidNativeImageUpscale(
  input: AndroidNativeImageUpscaleInput,
): Promise<AndroidNativeImageUpscaleResult> {
  const request = normalizeAndroidNativeImageUpscaleRequest(input);
  return getSignalLoomImageUpscalerPlugin().upscale(request);
}

export function normalizeAndroidNativeImageUpscaleRequest(
  input: AndroidNativeImageUpscaleInput,
): AndroidNativeImageUpscaleInput {
  const targetWidthPx = Math.max(1, Math.round(input.targetWidthPx));
  const targetHeightPx = Math.max(1, Math.round(input.targetHeightPx));
  const outputFormat = input.outputFormat ?? 'png';
  const preferredBackend = input.preferredBackend ?? 'local-dream-qnn';
  const upscalerId = input.upscalerId?.trim() || 'upscaler_realistic';
  const quality = typeof input.quality === 'number' && Number.isFinite(input.quality)
    ? Math.min(1, Math.max(0.05, input.quality))
    : undefined;

  return {
    sourceDataUrl: input.sourceDataUrl,
    targetWidthPx,
    targetHeightPx,
    outputFormat,
    preferredBackend,
    upscalerId,
    allowBitmapFallback: input.allowBitmapFallback ?? true,
    ...(quality === undefined ? {} : { quality }),
  };
}

export function describeAndroidNativeImageParityReadiness(
  input: AndroidImageParityReadinessInput,
): AndroidImageParityReadinessDescriptor {
  const sourceKind = input.sourceKind ?? 'blank-canvas';
  const target = {
    widthPx: Math.max(1, Math.round(input.targetWidthPx)),
    heightPx: Math.max(1, Math.round(input.targetHeightPx)),
  };
  const runtime = input.runtime ?? {};
  const cloudFallback = input.cloudFallback ?? {};
  const evidence = input.evidence ?? {};
  const nativePath = describeAndroidNativeUpscalerPath(runtime);
  const nativeBlockers = nativePath.blockers;
  const cloudBlockers = buildCloudFallbackBlockers(cloudFallback);
  const importedCoverage = describeImportedFileEditingCoverage(evidence.importedFileEdit);
  const importedEvidenceBlocker = importedCoverage.status === 'covered'
    ? []
    : [buildAndroidImageParityBlocker('imported-file-edit-evidence-missing')];
  const dexDisplay = describeDexEvidence(evidence.dexDisplay);
  const dexEvidenceBlocker = dexDisplay.status === 'covered'
    ? []
    : [buildAndroidImageParityBlocker('dex-1080p-evidence-missing')];
  const blockers = dedupeAndroidImageParityBlockers([
    ...nativeBlockers,
    ...cloudBlockers,
    ...dexEvidenceBlocker,
    ...importedEvidenceBlocker,
  ]);
  const routes = buildAndroidImageParityRoutes(cloudFallback, nativePath, cloudBlockers);
  const openDocumentEdit = describeOpenDocumentEvidence(evidence.openDocumentEdit);
  const unsupportedStates = describeAndroidImageParityUnsupportedStates({
    routes,
    runtime,
    nativePath,
    dexDisplay,
    importedCoverage,
  });
  const onDeviceUpscaleReadiness = buildAndroidNativeOnDeviceUpscaleReadiness({
    target,
    nativePath,
    routes,
    dexDisplay,
    openDocumentEdit,
    importedCoverage,
    blockers,
  });
  const caveats = [
    'Readiness helper is descriptor-only; it does not execute the Android plugin, start Local Dream, load models, or mutate image pixels.',
    nativePath.execution.evidenceSource === 'plugin-runtime-report'
      ? 'Plugin-reported runtime evidence is reflected when available; this helper still does not execute the Android plugin during the check.'
      : 'Accelerator preference is descriptor-only here; readiness does not claim that QNN, NNAPI, or equivalent accelerated inference is already executing in production.',
    'Bitmap fallback improves availability but does not prove QNN model quality or performance parity.',
    importedCoverage.caveat,
  ];
  const descriptorWithoutSignature = {
    descriptorId: 'android-image-parity-readiness:v1' as const,
    sourceKind,
    target,
    routes,
    evidence: {
      dexDisplay,
      openDocumentEdit,
    },
    importedFileEditingCoverage: importedCoverage,
    onDeviceUpscaleReadiness,
    blockers,
    unsupportedStates,
    caveats,
  };

  return {
    ...descriptorWithoutSignature,
    previewSignature: buildAndroidImageParityPreviewSignature(descriptorWithoutSignature),
  };
}

export function describeAndroidNativeUpscalerRouteContract(
  input: AndroidNativeUpscalerRouteContractInput = {},
): AndroidNativeUpscalerRouteContractDescriptor {
  const runtime = input.runtime ?? {};
  const nativePath = describeAndroidNativeUpscalerPath(runtime);
  const cloudBlockers = buildCloudFallbackBlockers(input.cloudFallback ?? {});
  const routes = buildAndroidImageParityRoutes(input.cloudFallback ?? {}, nativePath, cloudBlockers);
  const nativeRoute = buildAndroidNativeRouteContract(runtime, nativePath);
  const modelReadiness = buildAndroidNativeModelReadiness(nativePath);
  const fallbackOrder = buildAndroidNativeFallbackOrderContract(routes);
  const unsupportedStates = buildAndroidNativeRouteContractUnsupportedStates(routes, nativePath);
  const descriptorWithoutSignature = {
    descriptorId: 'android-native-upscaler-route-contract:v1' as const,
    nativeRoute,
    modelReadiness,
    fallbackOrder,
    unsupportedStates,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: buildAndroidNativeRouteContractStableSignature(descriptorWithoutSignature),
  };
}

function buildAndroidNativeRouteContract(
  runtime: AndroidImageParityRuntimeInput,
  nativePath: AndroidNativeUpscalerPathDescriptor,
): AndroidNativeUpscalerNativeRouteContractDescriptor {
  const descriptorWithoutSignature = {
    routeId: 'android-local-dream-qnn' as const,
    state: nativePath.readiness,
    singleApplicationRequired: true as const,
    noSecondAppHandoff: nativePath.singleApplication.secondAppDependencyRequired !== true,
    acceleratedExecution: nativePath.execution.proven ? 'proven' as const : 'unproven' as const,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: buildAndroidNativeRouteStableSignature(runtime, nativePath, descriptorWithoutSignature),
  };
}

function buildAndroidNativeRouteStableSignature(
  runtime: AndroidImageParityRuntimeInput,
  nativePath: AndroidNativeUpscalerPathDescriptor,
  descriptor: Omit<AndroidNativeUpscalerNativeRouteContractDescriptor, 'stableSignature'>,
): string {
  const runtimeParts = [
    runtime.platform === 'android' && runtime.capacitorAndroid === true ? 'android' : 'not-android',
    runtime.pluginRegistered === true ? 'plugin' : 'plugin-missing',
    runtime.localDreamServiceAvailable === true ? 'local-dream' : 'local-dream-missing',
  ];
  const accelerators = nativePath.accelerators
    .map((accelerator) => `${accelerator.id}:${accelerator.availability}`)
    .join(',');
  return [
    'android-native-route:v1',
    `route=${descriptor.routeId}`,
    `state=${descriptor.state}`,
    `runtime=${runtimeParts.join(':')}`,
    `accelerators=${accelerators}`,
    `single-app=${nativePath.singleApplication.available ? 'yes' : 'blocked'}`,
    `second-app=${descriptor.noSecondAppHandoff ? 'none' : 'blocked'}`,
    `execution=${descriptor.acceleratedExecution}`,
  ].join('|');
}

function buildAndroidNativeModelReadiness(
  nativePath: AndroidNativeUpscalerPathDescriptor,
): AndroidNativeUpscalerModelReadinessDescriptor {
  const runtimeAssets: AndroidNativeUpscalerModelReadinessDescriptor['runtimeAssets'] =
    nativePath.modelBundle.runtimeAssetsAvailable ? 'available' : 'missing';
  const upscalerModel: AndroidNativeUpscalerModelReadinessDescriptor['upscalerModel'] =
    nativePath.modelBundle.upscalerModelAvailable ? 'available' : 'missing';
  const state: AndroidNativeUpscalerModelReadinessDescriptor['state'] =
    runtimeAssets === 'available' && upscalerModel === 'available' ? 'ready' : 'missing';
  const descriptorWithoutSignature = {
    runtimeAssets,
    upscalerModel,
    state,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: [
      'android-native-model:v1',
      `runtime-assets=${runtimeAssets}`,
      `upscaler-model=${upscalerModel}`,
      `state=${state}`,
    ].join('|'),
  };
}

function buildAndroidNativeFallbackOrderContract(
  routes: AndroidImageParityRouteDescriptor[],
): AndroidNativeUpscalerFallbackOrderContractDescriptor {
  const routeIds = routes.map((route) => route.id);
  return {
    routeIds,
    stableSignature: [
      'android-native-fallback:v1',
      `order=${routeIds.join('>')}`,
      `states=${routes.map((route) => `${route.id}:${route.readiness}`).join(',')}`,
    ].join('|'),
  };
}

function buildAndroidNativeRouteContractUnsupportedStates(
  routes: AndroidImageParityRouteDescriptor[],
  nativePath: AndroidNativeUpscalerPathDescriptor,
): AndroidImageParityUnsupportedState[] {
  const states: AndroidImageParityUnsupportedState[] = [];
  const routeReadiness = new Map(routes.map((route) => [route.id, route.readiness]));
  if (routeReadiness.get('android-local-dream-qnn') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('local-dream-qnn-upscale-unavailable'));
  }
  if (!nativePath.execution.proven) {
    states.push(buildAndroidImageParityUnsupportedState('accelerated-on-device-execution-unproven'));
  }
  if (routeReadiness.get('android-bitmap-fallback') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('bitmap-fallback-unavailable'));
  }
  if (routeReadiness.get('cloud-upscaler-fallback') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('cloud-fallback-unavailable'));
  }
  return states;
}

function buildAndroidNativeRouteContractStableSignature(
  descriptor: Omit<AndroidNativeUpscalerRouteContractDescriptor, 'stableSignature'>,
): string {
  return [
    'android-native-upscaler-route-contract:v1',
    `native=${descriptor.nativeRoute.stableSignature}`,
    `model=${descriptor.modelReadiness.stableSignature}`,
    `fallback=${descriptor.fallbackOrder.stableSignature}`,
    `unsupported=${descriptor.unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
  ].join('|');
}

function buildAndroidNativeOnDeviceUpscaleReadiness(input: {
  target: AndroidImageParityReadinessDescriptor['target'];
  nativePath: AndroidNativeUpscalerPathDescriptor;
  routes: AndroidImageParityRouteDescriptor[];
  dexDisplay: AndroidImageParityDexEvidenceDescriptor;
  openDocumentEdit: AndroidImageParityOpenDocumentEvidenceDescriptor;
  importedCoverage: AndroidImageParityImportedFileCoverageDescriptor;
  blockers: AndroidImageParityBlocker[];
}): AndroidNativeOnDeviceUpscaleReadinessDescriptor {
  const hasNativeBlocker = (code: AndroidImageParityBlocker['code']) => (
    input.nativePath.blockers.some((blocker) => blocker.code === code)
  );
  const acceleratorPresent = input.nativePath.accelerators.some((accelerator) => accelerator.availability === 'available');
  const checks: AndroidNativeOnDeviceUpscaleReadinessCheck[] = [
    buildAndroidOnDeviceReadinessCheck(
      'android-runtime',
      hasNativeBlocker('not-android-runtime') ? 'missing' : 'present',
      hasNativeBlocker('not-android-runtime') ? 'not-android-runtime' : undefined,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'native-plugin',
      hasNativeBlocker('android-plugin-missing') ? 'missing' : 'present',
      hasNativeBlocker('android-plugin-missing') ? 'android-plugin-missing' : undefined,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'local-dream-service',
      hasNativeBlocker('local-dream-service-missing') ? 'missing' : 'present',
      hasNativeBlocker('local-dream-service-missing') ? 'local-dream-service-missing' : undefined,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'accelerator-runtime',
      acceleratorPresent ? 'present' : 'missing',
      hasNativeBlocker('qnn-runtime-missing')
        ? 'qnn-runtime-missing'
        : hasNativeBlocker('accelerator-runtime-missing')
          ? 'accelerator-runtime-missing'
          : undefined,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'runtime-assets',
      input.nativePath.modelBundle.runtimeAssetsAvailable ? 'present' : 'missing',
      input.nativePath.modelBundle.runtimeAssetsAvailable ? undefined : 'runtime-assets-missing',
    ),
    buildAndroidOnDeviceReadinessCheck(
      'upscaler-model',
      input.nativePath.modelBundle.upscalerModelAvailable ? 'present' : 'missing',
      input.nativePath.modelBundle.upscalerModelAvailable ? undefined : 'upscaler-model-missing',
    ),
    buildAndroidOnDeviceReadinessCheck(
      'single-app-runtime',
      input.nativePath.singleApplication.available ? 'present' : 'blocked',
      input.nativePath.singleApplication.available ? undefined : 'single-app-runtime-missing',
    ),
    buildAndroidOnDeviceReadinessCheck(
      'no-second-app-handoff',
      input.nativePath.singleApplication.secondAppDependencyRequired ? 'blocked' : 'present',
      input.nativePath.singleApplication.secondAppDependencyRequired ? 'second-app-handoff-required' : undefined,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'accelerated-execution',
      input.nativePath.execution.proven ? 'present' : 'not-proven',
      undefined,
      false,
    ),
    buildAndroidOnDeviceReadinessCheck(
      'dex-1080p-evidence',
      input.dexDisplay.status === 'covered' ? 'covered' : input.dexDisplay.status,
      input.dexDisplay.status === 'covered' ? undefined : 'dex-1080p-evidence-missing',
    ),
    buildAndroidOnDeviceReadinessCheck(
      'imported-file-edit-evidence',
      input.importedCoverage.status === 'covered' ? 'covered' : 'gap',
      input.importedCoverage.status === 'covered' ? undefined : 'imported-file-edit-evidence-missing',
    ),
  ];
  const fallbackOrder = input.routes.map((route) => route.id);
  const descriptorWithoutSignature = {
    descriptorId: 'android-on-device-upscale-readiness:v1' as const,
    mode: 'npu-qnn-style-on-device' as const,
    target: input.target,
    path: input.nativePath,
    checks,
    evidence: {
      dexDisplay: input.dexDisplay,
      openDocumentEdit: input.openDocumentEdit,
      importedFileEditingCoverage: input.importedCoverage,
    },
    fallbackOrder,
    blockers: input.blockers,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: buildAndroidOnDeviceUpscaleStableSignature(descriptorWithoutSignature),
  };
}

function buildAndroidOnDeviceReadinessCheck(
  code: AndroidNativeOnDeviceUpscaleReadinessCheckCode,
  state: AndroidNativeOnDeviceUpscaleReadinessCheckState,
  blockerCode?: AndroidImageParityBlocker['code'],
  required = true,
): AndroidNativeOnDeviceUpscaleReadinessCheck {
  const labels: Record<AndroidNativeOnDeviceUpscaleReadinessCheckCode, string> = {
    'android-runtime': 'Android Capacitor runtime',
    'native-plugin': 'SignalLoomImageUpscaler plugin',
    'local-dream-service': 'Bundled Local Dream service',
    'accelerator-runtime': 'QNN, NNAPI, or equivalent accelerator runtime',
    'runtime-assets': 'Bundled native runtime assets',
    'upscaler-model': 'In-app upscaler model',
    'single-app-runtime': 'Single-app runtime path',
    'no-second-app-handoff': 'No second-app handoff',
    'accelerated-execution': 'Live accelerated execution evidence',
    'dex-1080p-evidence': 'DeX 1080p opened-document evidence',
    'imported-file-edit-evidence': 'Imported-file edit evidence',
  };
  const summaries: Record<AndroidNativeOnDeviceUpscaleReadinessCheckCode, string> = {
    'android-runtime': 'Requires the Sloom Studio Capacitor app runtime on Android.',
    'native-plugin': 'Requires the Android native image upscaler plugin to be registered in the same app.',
    'local-dream-service': 'Requires the bundled Local Dream upscaler service startup path to be available.',
    'accelerator-runtime': 'Prefers QNN/HTP, NNAPI, or an equivalent on-device accelerator runtime when proven available.',
    'runtime-assets': 'Requires native runtime assets to be bundled with or owned by Sloom Studio.',
    'upscaler-model': 'Requires an in-app upscaler model bundle or download owned by Sloom Studio.',
    'single-app-runtime': 'Requires one Sloom Studio Android app to own the runtime, model, and plugin path.',
    'no-second-app-handoff': 'Blocks readiness when upscaling still depends on a second Android app.',
    'accelerated-execution': 'Reports whether live plugin evidence proves QNN, NNAPI, or equivalent accelerated inference.',
    'dex-1080p-evidence': 'Requires DeX or equivalent external-display evidence at 1920x1080 or higher.',
    'imported-file-edit-evidence': 'Requires an imported file, visible edit marks, and an artifact before imported-image parity is covered.',
  };
  return {
    code,
    label: labels[code],
    required,
    state,
    ...(blockerCode ? { blockerCode } : {}),
    summary: summaries[code],
  };
}

function buildAndroidOnDeviceUpscaleStableSignature(
  descriptor: Omit<AndroidNativeOnDeviceUpscaleReadinessDescriptor, 'stableSignature'>,
): string {
  const checks = descriptor.checks.map((check) => `${check.code}:${check.state}`).join(',');
  const fallback = descriptor.fallbackOrder.join('>');
  const blockers = descriptor.blockers.map((blocker) => blocker.code).join(',') || 'none';
  return [
    'android-on-device-upscale-readiness:v1',
    `target=${descriptor.target.widthPx}x${descriptor.target.heightPx}`,
    `checks=${checks}`,
    `fallback=${fallback}`,
    `blockers=${blockers}`,
  ].join('|');
}

function buildAndroidImageParityRoutes(
  cloudFallback: AndroidImageParityCloudFallbackInput,
  nativePath: AndroidNativeUpscalerPathDescriptor,
  cloudBlockers: AndroidImageParityBlocker[],
): AndroidImageParityRouteDescriptor[] {
  const nativeBlockers = nativePath.blockers;
  const bitmapBlockers = nativeBlockers.filter((blocker) => (
    blocker.code === 'not-android-runtime'
    || blocker.code === 'android-plugin-missing'
    || blocker.code === 'single-app-runtime-missing'
    || blocker.code === 'second-app-handoff-required'
  ));
  return [
    {
      id: 'android-local-dream-qnn',
      label: 'Android Local Dream QNN upscaler',
      readiness: nativePath.readiness,
      method: {
        mode: 'on-device-qnn',
        summary: nativePath.execution.evidenceSource === 'plugin-runtime-report' && nativePath.execution.reportedRuntime?.kind === 'bitmap-fallback'
          ? 'Single-app on-device accelerated model path exists, but the latest plugin-reported execution used Android bitmap fallback instead of QNN, NNAPI, or equivalent acceleration.'
          : nativePath.execution.proven
          ? 'Single-app on-device accelerated model path through the Capacitor plugin with QNN, NNAPI, or equivalent execution proven.'
          : 'Single-app on-device accelerated model path through the Capacitor plugin with QNN, NNAPI, or equivalent acceleration preferred but not yet proven live.',
      },
      cost: {
        tier: 'local-device',
        summary: 'Runs on the Android device through the bundled Local Dream/QNN route; no cloud usage cost.',
      },
      capability: {
        summary: 'Sloom Studio single-app Android-native accelerated upscaling path through the Capacitor plugin.',
        requiresAndroidRuntime: true,
        requiresBundledModel: true,
        singleApplicationOnly: true,
        preferredAccelerators: [...nativePath.preferredAccelerators],
        mutatesPixels: false,
      },
      blockers: nativeBlockers,
      caveats: [
        'Requires Android Capacitor runtime, registered native plugin, a single-app Sloom Studio execution path, Local Dream service startup, bundled runtime assets, and an in-app upscaler model.',
        nativePath.execution.summary,
      ],
    },
    {
      id: 'android-bitmap-fallback',
      label: 'Android bitmap resize fallback',
      readiness: bitmapBlockers.length === 0 ? 'ready' : 'blocked',
      method: {
        mode: 'android-bitmap-resize',
        summary: 'Local Android bitmap resize for availability-only upscale fallback.',
      },
      cost: {
        tier: 'local-device',
        summary: 'Runs local Android bitmap resizing; no cloud usage cost.',
      },
      capability: {
        summary: 'Deterministic Android bitmap resize fallback when QNN startup or model execution is unavailable.',
        requiresAndroidRuntime: true,
        requiresBundledModel: false,
        singleApplicationOnly: true,
        mutatesPixels: false,
      },
      blockers: bitmapBlockers,
      caveats: [
        'Fallback is availability-oriented and does not match learned QNN upscaling detail synthesis.',
      ],
    },
    {
      id: 'cloud-upscaler-fallback',
      label: 'Cloud upscaler fallback',
      readiness: cloudBlockers.length === 0 ? 'ready' : 'blocked',
      method: {
        mode: 'cloud-provider',
        summary: 'Provider-backed image upscale or regeneration handoff outside the Android runtime.',
      },
      cost: {
        tier: 'metered-cloud',
        summary: buildCloudCostSummary(cloudFallback),
        ...(typeof cloudFallback.estimatedCostUsd === 'number' && Number.isFinite(cloudFallback.estimatedCostUsd)
          ? { estimatedCostUsd: cloudFallback.estimatedCostUsd }
          : {}),
      },
      capability: {
        summary: 'Configured cloud image model fallback for upscale/regeneration handoff.',
        requiresAndroidRuntime: false,
        requiresBundledModel: false,
        mutatesPixels: false,
      },
      blockers: cloudBlockers,
      caveats: [
        'Cloud fallback depends on configured provider credentials and may use generative reconstruction rather than native Android model execution.',
      ],
    },
  ];
}

function buildAndroidNativeRuntimeBlockers(
  runtime: AndroidImageParityRuntimeInput,
): AndroidImageParityBlocker[] {
  const blockers: AndroidImageParityBlocker[] = [];
  if (runtime.platform !== 'android' || runtime.capacitorAndroid !== true) {
    blockers.push(buildAndroidImageParityBlocker('not-android-runtime'));
  }
  if (runtime.pluginRegistered !== true) blockers.push(buildAndroidImageParityBlocker('android-plugin-missing'));
  if (runtime.localDreamServiceAvailable !== true) {
    blockers.push(buildAndroidImageParityBlocker('local-dream-service-missing'));
  }
  if (runtime.singleApplicationRuntimeAvailable === false) {
    blockers.push(buildAndroidImageParityBlocker('single-app-runtime-missing'));
  }
  if (runtime.secondAppDependencyRequired === true) {
    blockers.push(buildAndroidImageParityBlocker('second-app-handoff-required'));
  }
  if (runtime.bundledRuntimeAssetsAvailable === false) {
    blockers.push(buildAndroidImageParityBlocker('runtime-assets-missing'));
  }
  const acceleratorIds = normalizePreferredAccelerators(runtime);
  const acceleratorAvailable = acceleratorIds.some((acceleratorId) => isAcceleratorAvailable(acceleratorId, runtime));
  if (!acceleratorAvailable) {
    blockers.push(buildAndroidImageParityBlocker(
      acceleratorIds.length > 0 && acceleratorIds.every((acceleratorId) => acceleratorId === 'qnn')
        ? 'qnn-runtime-missing'
        : 'accelerator-runtime-missing',
    ));
  }
  if (runtime.bundledUpscalerModelAvailable !== true) {
    blockers.push(buildAndroidImageParityBlocker('upscaler-model-missing'));
  }
  return blockers;
}

export function describeAndroidNativeUpscalerPath(
  runtime: AndroidImageParityRuntimeInput = {},
): AndroidNativeUpscalerPathDescriptor {
  const preferredAccelerators = normalizePreferredAccelerators(runtime);
  const blockers = buildAndroidNativeRuntimeBlockers(runtime);
  const reportedRuntime = describeReportedUpscaleRuntime(runtime);
  const proven = reportedRuntime?.kind === 'bitmap-fallback'
    ? false
    : reportedRuntime?.kind === 'accelerated'
      ? true
      : runtime.acceleratedExecutionProven === true;
  const readiness = blockers.length > 0
    ? 'blocked'
    : proven
      ? 'ready'
      : 'degraded';
  const evidenceSource = reportedRuntime
    ? 'plugin-runtime-report'
    : runtime.acceleratedExecutionProven === true
      ? 'descriptor-flag'
      : 'descriptor-only';

  return {
    readiness,
    singleApplication: {
      required: true,
      available: runtime.singleApplicationRuntimeAvailable !== false,
      secondAppDependencyRequired: runtime.secondAppDependencyRequired === true,
      readiness: runtime.singleApplicationRuntimeAvailable !== false && runtime.secondAppDependencyRequired !== true
        ? 'ready'
        : 'blocked',
      summary: 'Android native upscale readiness requires a single Sloom Studio app runtime path with no second-app handoff.',
    },
    preferredAccelerators: [...preferredAccelerators],
    accelerators: preferredAccelerators.map((acceleratorId) => ({
      id: acceleratorId,
      label: describeAcceleratorLabel(acceleratorId),
      availability: isAcceleratorAvailable(acceleratorId, runtime) ? 'available' : 'unavailable',
      preferred: true,
    })),
    modelBundle: {
      runtimeAssetsAvailable: runtime.bundledRuntimeAssetsAvailable !== false,
      upscalerModelAvailable: runtime.bundledUpscalerModelAvailable !== false,
      readiness: runtime.bundledRuntimeAssetsAvailable !== false && runtime.bundledUpscalerModelAvailable !== false
        ? 'ready'
        : 'missing',
      summary: 'The single-app accelerated path depends on bundled runtime assets plus an in-app upscaler model bundle or download owned by Sloom Studio.',
    },
    execution: {
      mode: 'accelerated-on-device-preferred',
      readiness,
      proven,
      summary: buildAndroidNativeExecutionSummary({
        evidenceSource,
        reportedRuntime,
      }),
      evidenceSource,
      ...(reportedRuntime ? { reportedRuntime } : {}),
    },
    blockers,
  };
}

function describeReportedUpscaleRuntime(
  runtime: AndroidImageParityRuntimeInput,
): AndroidNativeUpscalerExecutionDescriptor['reportedRuntime'] | undefined {
  const accelerator = runtime.lastUpscaleAccelerator?.trim();
  const backend = runtime.lastUpscaleBackend?.trim();
  const modelUsed = runtime.lastUpscaleModelUsed?.trim();
  if (!accelerator && !backend && !modelUsed) {
    return undefined;
  }

  const normalizedAccelerator = accelerator?.toLowerCase() ?? '';
  const normalizedBackend = backend?.toLowerCase() ?? '';
  const kind = normalizedAccelerator.includes('bitmap') || normalizedBackend.includes('bitmap')
    ? 'bitmap-fallback'
    : normalizedAccelerator.includes('qnn')
      || normalizedAccelerator.includes('nnapi')
      || normalizedBackend.includes('qnn')
      || normalizedBackend.includes('nnapi')
      || normalizedBackend.includes('local-dream')
      ? 'accelerated'
      : 'unknown';

  return {
    ...(accelerator ? { accelerator } : {}),
    ...(backend ? { backend } : {}),
    ...(modelUsed ? { modelUsed } : {}),
    kind,
  };
}

function buildAndroidNativeExecutionSummary(input: {
  evidenceSource: AndroidNativeUpscalerExecutionDescriptor['evidenceSource'];
  reportedRuntime?: NonNullable<AndroidNativeUpscalerExecutionDescriptor['reportedRuntime']>;
}): string {
  if (input.evidenceSource === 'plugin-runtime-report' && input.reportedRuntime?.kind === 'bitmap-fallback') {
    return 'The latest plugin-reported Android native upscale ran with bitmap fallback, so live QNN/NNAPI accelerator execution is still unproven.';
  }
  if (input.evidenceSource === 'plugin-runtime-report' && input.reportedRuntime?.kind === 'accelerated') {
    return `The latest plugin-reported Android native upscale executed with ${
      describeReportedAcceleratorLabel(input.reportedRuntime.accelerator, input.reportedRuntime.backend)
    }, giving real single-app accelerator evidence.`;
  }
  if (input.evidenceSource === 'descriptor-flag') {
    return 'Single-app on-device accelerated model path through the Capacitor plugin with QNN, NNAPI, or equivalent execution proven.';
  }
  return 'Sloom Studio is prepared to prefer an on-device accelerated model path (QNN/NNAPI or equivalent), but live accelerator inference is not yet proven by this helper.';
}

function buildCloudFallbackBlockers(
  cloudFallback: AndroidImageParityCloudFallbackInput,
): AndroidImageParityBlocker[] {
  return cloudFallback.providerConfigured === true
    ? []
    : [buildAndroidImageParityBlocker('cloud-provider-missing')];
}

function buildAndroidImageParityBlocker(
  code: AndroidImageParityBlocker['code'],
): AndroidImageParityBlocker {
  const messages: Record<AndroidImageParityBlocker['code'], string> = {
    'not-android-runtime': 'Android-native upscaling requires an Android Capacitor runtime.',
    'android-plugin-missing': 'SignalLoomImageUpscaler native plugin registration has not been proven.',
    'local-dream-service-missing': 'Bundled Local Dream upscaler service availability has not been proven.',
    'qnn-runtime-missing': 'QNN runtime availability has not been proven.',
    'accelerator-runtime-missing': 'QNN, NNAPI, or equivalent accelerator availability has not been proven.',
    'runtime-assets-missing': 'Bundled runtime assets required for the on-device path have not been proven.',
    'upscaler-model-missing': 'Bundled upscaler model availability has not been proven.',
    'single-app-runtime-missing': 'The single-app Sloom Studio runtime path has not been proven.',
    'second-app-handoff-required': 'The current Android upscale path still depends on a second-app handoff.',
    'cloud-provider-missing': 'No configured cloud image fallback provider is available.',
    'dex-1080p-evidence-missing': 'Android DeX or equivalent 1080p opened-document evidence is missing or insufficient.',
    'imported-file-edit-evidence-missing': 'Imported/opened file editing evidence is still missing.',
  };
  return {
    code,
    message: messages[code],
  };
}

function dedupeAndroidImageParityBlockers(
  blockers: AndroidImageParityBlocker[],
): AndroidImageParityBlocker[] {
  const seen = new Set<AndroidImageParityBlocker['code']>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.code)) return false;
    seen.add(blocker.code);
    return true;
  });
}

function describeDexEvidence(
  evidence?: AndroidImageParityDexEvidenceInput,
): AndroidImageParityDexEvidenceDescriptor {
  const width = typeof evidence?.width === 'number' && Number.isFinite(evidence.width)
    ? Math.max(1, Math.round(evidence.width))
    : undefined;
  const height = typeof evidence?.height === 'number' && Number.isFinite(evidence.height)
    ? Math.max(1, Math.round(evidence.height))
    : undefined;
  const available = evidence?.available === true;
  const resolution = width !== undefined && height !== undefined ? `${width}x${height}` : 'unknown';
  const status = !available
    ? 'missing'
    : width !== undefined && height !== undefined && width >= 1920 && height >= 1080
      ? 'covered'
      : 'insufficient';
  const caveat = status === 'covered'
    ? 'DeX evidence meets the 1080p opened-document requirement for Android Image parity review.'
    : 'Android Image parity requires DeX or equivalent external-display evidence at 1920x1080 or higher.';
  return {
    available,
    resolution,
    status,
    requiredResolution: '1920x1080',
    caveat,
    ...(evidence?.artifactPath ? { artifactPath: evidence.artifactPath } : {}),
  };
}

function describeOpenDocumentEvidence(
  evidence?: AndroidImageParityOpenDocumentEvidenceInput,
): AndroidImageParityOpenDocumentEvidenceDescriptor {
  return {
    available: evidence?.available === true,
    documentKind: evidence?.documentKind ?? 'unknown',
    editMarksVisible: evidence?.editMarksVisible === true,
    ...(evidence?.artifactPath ? { artifactPath: evidence.artifactPath } : {}),
  };
}

function describeImportedFileEditingCoverage(
  evidence?: AndroidImageParityImportedFileEvidenceInput,
): AndroidImageParityImportedFileCoverageDescriptor {
  const editMarksVisible = evidence?.editMarksVisible === true;
  const covered = evidence?.available === true
    && editMarksVisible
    && Boolean(evidence.artifactPath)
    && Boolean(evidence.fileName?.trim());
  return {
    available: covered,
    status: covered ? 'covered' : 'gap',
    required: true,
    editMarksVisible,
    caveat: covered
      ? 'Imported-file edit evidence is present with visible edit marks and an artifact for Android Image parity readiness.'
      : 'Blank-canvas opened-document evidence does not prove imported-file editing parity.',
    ...(evidence?.artifactPath ? { artifactPath: evidence.artifactPath } : {}),
    ...(evidence?.fileName ? { fileName: evidence.fileName } : {}),
  };
}

function describeAndroidImageParityUnsupportedStates(input: {
  routes: AndroidImageParityRouteDescriptor[];
  runtime: AndroidImageParityRuntimeInput;
  nativePath: AndroidNativeUpscalerPathDescriptor;
  dexDisplay: AndroidImageParityDexEvidenceDescriptor;
  importedCoverage: AndroidImageParityImportedFileCoverageDescriptor;
}): AndroidImageParityUnsupportedState[] {
  const states: AndroidImageParityUnsupportedState[] = [];
  const routeReadiness = new Map(input.routes.map((route) => [route.id, route.readiness]));
  if (input.runtime.platform !== 'android' || input.runtime.capacitorAndroid !== true) {
    states.push(buildAndroidImageParityUnsupportedState('android-native-runtime-unavailable'));
  }
  if (routeReadiness.get('android-local-dream-qnn') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('local-dream-qnn-upscale-unavailable'));
  }
  if (input.nativePath.execution.readiness === 'degraded') {
    states.push(buildAndroidImageParityUnsupportedState('accelerated-on-device-execution-unproven'));
  }
  if (routeReadiness.get('android-bitmap-fallback') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('bitmap-fallback-unavailable'));
  }
  if (routeReadiness.get('cloud-upscaler-fallback') === 'blocked') {
    states.push(buildAndroidImageParityUnsupportedState('cloud-fallback-unavailable'));
  }
  if (input.dexDisplay.status !== 'covered') {
    states.push(buildAndroidImageParityUnsupportedState('dex-1080p-evidence-unproven'));
  }
  if (input.importedCoverage.status !== 'covered') {
    states.push(buildAndroidImageParityUnsupportedState('imported-file-edit-evidence-unproven'));
  }
  return states;
}

function buildAndroidImageParityUnsupportedState(
  code: AndroidImageParityUnsupportedState['code'],
): AndroidImageParityUnsupportedState {
  const summaries: Record<AndroidImageParityUnsupportedState['code'], string> = {
    'android-native-runtime-unavailable': 'Android-native Image parity cannot be claimed outside the Android Capacitor runtime.',
    'local-dream-qnn-upscale-unavailable': 'On-device QNN upscaling is unsupported until the plugin, Local Dream service, QNN runtime, and bundled upscaler model are all proven.',
    'accelerated-on-device-execution-unproven': 'Accelerated on-device inference cannot be claimed until Sloom Studio proves QNN, NNAPI, or an equivalent backend is executing inside the same app.',
    'bitmap-fallback-unavailable': 'Bitmap fallback is unsupported until the Android runtime, plugin, and Local Dream service startup path are proven.',
    'cloud-fallback-unavailable': 'Cloud fallback is unsupported until provider credentials and a fallback image model are configured.',
    'dex-1080p-evidence-unproven': 'DeX or equivalent 1920x1080 opened-document evidence is required before Android Image parity can be marked covered.',
    'imported-file-edit-evidence-unproven': 'Imported-image editing parity is not proven until an imported file is opened, visibly edited, and captured as an artifact.',
  };
  return {
    code,
    summary: summaries[code],
  };
}

function buildCloudCostSummary(cloudFallback: AndroidImageParityCloudFallbackInput): string {
  const provider = cloudFallback.providerName?.trim() || 'unconfigured provider';
  const model = cloudFallback.modelId?.trim() || 'unspecified model';
  if (typeof cloudFallback.estimatedCostUsd === 'number' && Number.isFinite(cloudFallback.estimatedCostUsd)) {
    return `${provider}/${model} fallback estimated at $${cloudFallback.estimatedCostUsd.toFixed(2)} per operation.`;
  }
  return `${provider}/${model} fallback uses provider-metered image generation or editing costs.`;
}

function buildAndroidImageParityPreviewSignature(
  descriptor: Omit<AndroidImageParityReadinessDescriptor, 'previewSignature'>,
): string {
  const routes = descriptor.routes.map((route) => `${route.id}:${route.readiness}:${route.method.mode}`).join(',');
  const dexEvidence = `dex:${descriptor.evidence.dexDisplay.status}:${descriptor.evidence.dexDisplay.resolution}`;
  const openDocument = descriptor.evidence.openDocumentEdit;
  const openEvidence = [
    `open:${openDocument.available ? 'yes' : 'no'}`,
    openDocument.documentKind,
    openDocument.editMarksVisible ? 'edited' : 'not-edited',
  ].join(':');
  const importedEvidence = `imported:${descriptor.importedFileEditingCoverage.status}`;
  const blockers = descriptor.blockers.map((blocker) => blocker.code).join(',') || 'none';
  const unsupportedStates = descriptor.unsupportedStates.map((state) => state.code).join(',') || 'none';
  return [
    'android-image-parity-readiness:v1',
    `source=${descriptor.sourceKind}`,
    `target=${descriptor.target.widthPx}x${descriptor.target.heightPx}`,
    `routes=${routes}`,
    `evidence=${dexEvidence},${openEvidence},${importedEvidence}`,
    `blockers=${blockers}`,
    `unsupported=${unsupportedStates}`,
  ].join('|');
}

function normalizePreferredAccelerators(runtime: AndroidImageParityRuntimeInput): string[] {
  const explicit = runtime.preferredAccelerators
    ?.map((value) => value.trim().toLowerCase())
    .filter(Boolean) ?? [];
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const inferred: string[] = [];
  if (runtime.qnnRuntimeAvailable === true) inferred.push('qnn');
  if (runtime.nnapiRuntimeAvailable === true) inferred.push('nnapi');
  if (runtime.equivalentAcceleratorAvailable === true) inferred.push('equivalent');
  return inferred.length > 0 ? inferred : ['qnn'];
}

function isAcceleratorAvailable(
  acceleratorId: string,
  runtime: AndroidImageParityRuntimeInput,
): boolean {
  if (acceleratorId === 'qnn') return runtime.qnnRuntimeAvailable === true;
  if (acceleratorId === 'nnapi') return runtime.nnapiRuntimeAvailable === true;
  return runtime.equivalentAcceleratorAvailable === true;
}

function describeAcceleratorLabel(acceleratorId: string): string {
  if (acceleratorId === 'qnn') return 'QNN';
  if (acceleratorId === 'nnapi') return 'NNAPI';
  if (acceleratorId === 'equivalent') return 'Equivalent';
  return acceleratorId.toUpperCase();
}

function describeReportedAcceleratorLabel(accelerator?: string, backend?: string): string {
  const combined = `${accelerator ?? ''} ${backend ?? ''}`.toLowerCase();
  if (combined.includes('qnn')) return 'QNN';
  if (combined.includes('nnapi')) return 'NNAPI';
  if (combined.includes('bitmap')) return 'bitmap fallback';
  return accelerator ?? backend ?? 'an unknown runtime';
}
