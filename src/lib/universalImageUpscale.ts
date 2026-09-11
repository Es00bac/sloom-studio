import type { ApiKeys, PaperPrintUpscaleMethod, ProviderSettings } from '../types/flow';
import { isAndroidAcceleratorConfigured } from './androidAccelerator';
import {
  isAndroidNativeImageUpscalerAvailable,
  type AndroidImageParityRuntimeInput,
} from './androidNativeImageUpscaler';
import {
  STABILITY_CONSERVATIVE_UPSCALE_COST_USD,
  STABILITY_FAST_UPSCALE_COST_USD,
} from './paperImageUpscale';
import { ATLAS_IMAGE_UPSCALE_COST_USD } from './cloudImageUpscale';
import { isVertexProjectConfigured } from './vertexProviderSettings';

export type UniversalConfiguredUpscaleProvider =
  | 'android-accelerator'
  | 'android-native'
  | 'stability-fast'
  | 'stability-conservative'
  | 'vertex-imagen'
  | 'atlas-image-upscaler'
  | 'local-ai-cpu'
  | 'browser';

export type UniversalImageUpscaleWorkflowFamily = 'android' | 'local' | 'cloud';
export type UniversalImageUpscaleWorkflowWarningSeverity = 'info' | 'warning';
export type UniversalImageUpscaleWorkflowWarningCode =
  | 'unsupported-sound-effect'
  | 'already-print-resolution'
  | 'flattened-raster-source';
export type UniversalImageUpscaleWorkflowSourceKind = 'image' | 'comic-sound-effect';
export type UniversalImageUpscaleWorkflowFixedScaleFactor = 'x2' | 'x3' | 'x4';
export type UniversalImageUpscaleReadinessState = 'ready' | 'degraded' | 'blocked' | 'not-needed';
export type UniversalImageUpscaleRouteReadinessState = 'ready' | 'blocked' | 'not-needed';
export type UniversalImageUpscaleReadinessRouteId = 'on-device-preferred' | 'cloud-fallback' | 'bitmap-fallback';
export type UniversalImageUpscaleTargetPolicy = 'scale-percent' | 'explicit-pixels' | 'print-dpi';
export type UniversalImageUpscaleTargetAction = 'queue-upscale' | 'skip-upscale';
export type UniversalImageUpscaleSourceExclusionAction = 'allow-upscale' | 'exclude-upscale';
export type UniversalImageUpscaleReadinessBlockerCode =
  | 'unsupported-sound-effect'
  | 'android-accelerator-endpoint-missing'
  | 'not-android-runtime'
  | 'android-plugin-missing'
  | 'local-dream-service-missing'
  | 'qnn-runtime-missing'
  | 'accelerator-runtime-missing'
  | 'runtime-assets-missing'
  | 'upscaler-model-missing'
  | 'single-app-runtime-missing'
  | 'second-app-handoff-required'
  | 'local-cpu-runtime-missing'
  | 'cloud-provider-missing';

export interface UniversalImageUpscaleWorkflowCapabilities {
  aiUpscale: boolean;
  directTargetDimensions: boolean;
  fixedScaleFactors: UniversalImageUpscaleWorkflowFixedScaleFactor[];
  preservesImageDocumentLayers: boolean;
  requiresCloudCredentials: boolean;
  requiresConfiguredEndpoint: boolean;
  runsInAndroidApp: boolean;
  usesCloudProvider: boolean;
}

export interface UniversalImageUpscaleWorkflowWarning {
  code: UniversalImageUpscaleWorkflowWarningCode;
  severity: UniversalImageUpscaleWorkflowWarningSeverity;
  message: string;
}

export interface UniversalImageUpscaleWorkflowDescriptor {
  provider: UniversalConfiguredUpscaleProvider;
  family: UniversalImageUpscaleWorkflowFamily;
  methodLabel: string;
  costUsd?: number;
  costLabel: string;
  capabilities: UniversalImageUpscaleWorkflowCapabilities;
  notes: string[];
  warnings: UniversalImageUpscaleWorkflowWarning[];
}

export interface UniversalConfiguredUpscalePlan {
  method: PaperPrintUpscaleMethod;
  provider: UniversalConfiguredUpscaleProvider;
  canRun: boolean;
  costUsd?: number;
  label: string;
  costLabel: string;
  notes: string[];
  unavailableReason?: string;
}

export interface UniversalImageUpscalePrintTargetInput {
  widthIn: number;
  heightIn: number;
  targetDpi: number;
  sourceDpi?: number;
}

export interface UniversalImageUpscaleReadinessInput {
  providerSettings: ProviderSettings;
  apiKeys?: Pick<ApiKeys, 'stability'>;
  sourceKind?: UniversalImageUpscaleWorkflowSourceKind;
  sourceWidthPx: number;
  sourceHeightPx: number;
  targetWidthPx?: number;
  targetHeightPx?: number;
  scalePercent?: number;
  printTarget?: UniversalImageUpscalePrintTargetInput;
  androidNativeAvailable?: boolean;
  onDeviceRuntime?: AndroidImageParityRuntimeInput;
}

export interface UniversalImageUpscalePrintResolutionDescriptor {
  targetDpi?: number;
  sourceDpi?: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  alreadyMeetsPrintResolution: boolean;
  action: UniversalImageUpscaleTargetAction;
}

export interface UniversalImageUpscaleTargetDescriptor {
  sourceWidthPx: number;
  sourceHeightPx: number;
  widthPx: number;
  heightPx: number;
  policy: UniversalImageUpscaleTargetPolicy;
  scalePercent?: number;
  printResolution: UniversalImageUpscalePrintResolutionDescriptor;
}

export interface UniversalImageUpscaleReadinessBlocker {
  code: UniversalImageUpscaleReadinessBlockerCode;
  message: string;
}

export interface UniversalImageUpscaleReadinessRouteDescriptor {
  id: UniversalImageUpscaleReadinessRouteId;
  provider: UniversalConfiguredUpscaleProvider;
  label: string;
  family: UniversalImageUpscaleWorkflowFamily;
  readiness: UniversalImageUpscaleRouteReadinessState;
  selected: boolean;
  costUsd?: number;
  costLabel: string;
  capabilities: UniversalImageUpscaleWorkflowCapabilities;
  notes: string[];
  blockers: UniversalImageUpscaleReadinessBlocker[];
  stableSignature: string;
}

export interface UniversalImageUpscaleSourceExclusionPolicyDescriptor {
  sourceKind: UniversalImageUpscaleWorkflowSourceKind;
  action: UniversalImageUpscaleSourceExclusionAction;
  blockerCode?: Extract<UniversalImageUpscaleReadinessBlockerCode, 'unsupported-sound-effect'>;
  summary: string;
  stableSignature: string;
}

export interface UniversalImageUpscalePrintResolutionPolicyDescriptor {
  defaultTargetDpi: number;
  targetDpi?: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  action: UniversalImageUpscaleTargetAction;
  alreadyMeetsPrintResolution: boolean;
  summary: string;
  stableSignature: string;
}

export interface UniversalImageUpscaleFallbackOrderDescriptor {
  rank: number;
  routeId: UniversalImageUpscaleReadinessRouteId;
  provider: UniversalConfiguredUpscaleProvider;
  readiness: UniversalImageUpscaleRouteReadinessState;
  selected: boolean;
  purpose: string;
}

export interface UniversalImageUpscaleReadinessPolicyDescriptor {
  sourceExclusion: UniversalImageUpscaleSourceExclusionPolicyDescriptor;
  printResolution: UniversalImageUpscalePrintResolutionPolicyDescriptor;
  fallbackOrder: UniversalImageUpscaleFallbackOrderDescriptor[];
  stableSignature: string;
}

export interface UniversalImageUpscaleReadinessDescriptor {
  descriptorId: 'image-universal-upscale-readiness:v1';
  readiness: UniversalImageUpscaleReadinessState;
  sourceKind: UniversalImageUpscaleWorkflowSourceKind;
  target: UniversalImageUpscaleTargetDescriptor;
  routes: UniversalImageUpscaleReadinessRouteDescriptor[];
  policy: UniversalImageUpscaleReadinessPolicyDescriptor;
  blockers: UniversalImageUpscaleReadinessBlocker[];
  warnings: UniversalImageUpscaleWorkflowWarning[];
  stableSignature: string;
}

const UNIVERSAL_IMAGE_UPSCALE_READINESS_DESCRIPTOR_ID = 'image-universal-upscale-readiness:v1' as const;
export const DEFAULT_UNIVERSAL_IMAGE_UPSCALE_PRINT_DPI = 300;

const FLATTENED_AI_UPSCALE_WARNING: UniversalImageUpscaleWorkflowWarning = {
  code: 'flattened-raster-source',
  severity: 'info',
  message: 'AI upscalers consume a flattened raster source; undo restores the original layered Image document.',
};

const UNIVERSAL_IMAGE_UPSCALE_WORKFLOW_DESCRIPTORS: readonly UniversalImageUpscaleWorkflowDescriptor[] = [
  {
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
    notes: ['Runs on the paired phone over LAN with no provider spend.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'android-native',
    family: 'android',
    methodLabel: 'Android native image upscaler',
    costUsd: 0,
    costLabel: 'free',
    capabilities: {
      aiUpscale: true,
      directTargetDimensions: true,
      fixedScaleFactors: [],
      preservesImageDocumentLayers: false,
      requiresCloudCredentials: false,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: true,
      usesCloudProvider: false,
    },
    notes: ['Runs inside the Android app as a single-app on-device path with no second-app handoff or provider spend.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'local-ai-cpu',
    family: 'local',
    methodLabel: 'Local Vulkan AI upscaler',
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
    notes: ['Managed desktop runtime: Real-ESRGAN ncnn with Vulkan acceleration; no CPU fallback.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'stability-fast',
    family: 'cloud',
    methodLabel: 'Stability Fast Upscale',
    costUsd: STABILITY_FAST_UPSCALE_COST_USD,
    costLabel: `$${STABILITY_FAST_UPSCALE_COST_USD.toFixed(2)}`,
    capabilities: {
      aiUpscale: true,
      directTargetDimensions: false,
      fixedScaleFactors: [],
      preservesImageDocumentLayers: false,
      requiresCloudCredentials: true,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: false,
      usesCloudProvider: true,
    },
    notes: ['Runs Stability AI Fast Upscale with fixed provider pricing per image.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'stability-conservative',
    family: 'cloud',
    methodLabel: 'Stability Conservative Upscale',
    costUsd: STABILITY_CONSERVATIVE_UPSCALE_COST_USD,
    costLabel: `$${STABILITY_CONSERVATIVE_UPSCALE_COST_USD.toFixed(2)}`,
    capabilities: {
      aiUpscale: true,
      directTargetDimensions: false,
      fixedScaleFactors: [],
      preservesImageDocumentLayers: false,
      requiresCloudCredentials: true,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: false,
      usesCloudProvider: true,
    },
    notes: ['Runs Stability AI Conservative Upscale with prompt-aware repair and fixed provider pricing per image.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'vertex-imagen',
    family: 'cloud',
    methodLabel: 'Vertex Imagen Upscale',
    costLabel: 'cost unknown',
    capabilities: {
      aiUpscale: true,
      directTargetDimensions: false,
      fixedScaleFactors: ['x2', 'x3', 'x4'],
      preservesImageDocumentLayers: false,
      requiresCloudCredentials: true,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: false,
      usesCloudProvider: true,
    },
    notes: ['Runs Vertex Imagen through the configured desktop Vertex project; exact cost is not mapped locally.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'atlas-image-upscaler',
    family: 'cloud',
    methodLabel: 'Atlas Image Upscaler',
    costUsd: ATLAS_IMAGE_UPSCALE_COST_USD,
    costLabel: `$${ATLAS_IMAGE_UPSCALE_COST_USD.toFixed(2)}`,
    capabilities: {
      aiUpscale: true,
      directTargetDimensions: false,
      fixedScaleFactors: ['x2', 'x3', 'x4'],
      preservesImageDocumentLayers: false,
      requiresCloudCredentials: true,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: false,
      usesCloudProvider: true,
    },
    notes: ['Runs the dedicated Atlas Cloud image upscaler (documented outscale 1-4) with fixed provider pricing per image.'],
    warnings: [FLATTENED_AI_UPSCALE_WARNING],
  },
  {
    provider: 'browser',
    family: 'local',
    methodLabel: 'Local browser upscale',
    costUsd: 0,
    costLabel: 'free',
    capabilities: {
      aiUpscale: false,
      directTargetDimensions: true,
      fixedScaleFactors: [],
      preservesImageDocumentLayers: true,
      requiresCloudCredentials: false,
      requiresConfiguredEndpoint: false,
      runsInAndroidApp: false,
      usesCloudProvider: false,
    },
    notes: ['Runs as local browser scaling with no provider spend.'],
    warnings: [],
  },
];

export function listUniversalImageUpscaleWorkflowDescriptors(): UniversalImageUpscaleWorkflowDescriptor[] {
  return UNIVERSAL_IMAGE_UPSCALE_WORKFLOW_DESCRIPTORS.map(cloneWorkflowDescriptor);
}

export function describeUniversalImageUpscaleWorkflow(
  provider: UniversalConfiguredUpscaleProvider,
): UniversalImageUpscaleWorkflowDescriptor {
  const descriptor = UNIVERSAL_IMAGE_UPSCALE_WORKFLOW_DESCRIPTORS.find((entry) => entry.provider === provider);
  if (!descriptor) {
    const fallback = UNIVERSAL_IMAGE_UPSCALE_WORKFLOW_DESCRIPTORS[UNIVERSAL_IMAGE_UPSCALE_WORKFLOW_DESCRIPTORS.length - 1];
    return cloneWorkflowDescriptor(fallback);
  }
  return cloneWorkflowDescriptor(descriptor);
}

export function getUniversalImageUpscaleWorkflowWarnings(input: {
  sourceKind?: UniversalImageUpscaleWorkflowSourceKind;
  alreadyMeetsPrintResolution?: boolean;
}): UniversalImageUpscaleWorkflowWarning[] {
  const warnings: UniversalImageUpscaleWorkflowWarning[] = [];

  if (input.sourceKind === 'comic-sound-effect') {
    warnings.push({
      code: 'unsupported-sound-effect',
      severity: 'warning',
      message: 'Comic sound-effect decals are skipped by the universal image upscaler; edit the SFX design or rasterize it as a normal image first.',
    });
  }

  if (input.alreadyMeetsPrintResolution) {
    warnings.push({
      code: 'already-print-resolution',
      severity: 'info',
      message: 'The source already meets the requested print resolution, so no universal upscaling job should be queued.',
    });
  }

  return warnings;
}

export function describeUniversalImageUpscaleReadiness(
  input: UniversalImageUpscaleReadinessInput,
): UniversalImageUpscaleReadinessDescriptor {
  const sourceKind = input.sourceKind ?? 'image';
  const target = describeUniversalImageUpscaleTarget(input);
  const warnings = getUniversalImageUpscaleWorkflowWarnings({
    sourceKind,
    alreadyMeetsPrintResolution: target.printResolution.alreadyMeetsPrintResolution,
  });
  const exclusionBlockers = sourceKind === 'comic-sound-effect'
    ? [buildUniversalImageUpscaleBlocker('unsupported-sound-effect')]
    : [];
  const routeMode = exclusionBlockers.length > 0
    ? 'blocked'
    : target.printResolution.action === 'skip-upscale'
      ? 'not-needed'
      : undefined;
  const routes = selectUniversalImageUpscaleRoutes(input, routeMode, exclusionBlockers);
  const selectedRoute = routes.find((route) => route.selected);
  const blockers = selectUniversalImageUpscaleBlockers(exclusionBlockers, routes, selectedRoute);
  const readiness = describeUniversalImageUpscaleReadinessState(
    exclusionBlockers,
    target,
    selectedRoute,
  );
  const policy = buildUniversalImageUpscaleReadinessPolicy({
    sourceKind,
    target,
    routes,
  });
  const descriptorWithoutSignature = {
    descriptorId: UNIVERSAL_IMAGE_UPSCALE_READINESS_DESCRIPTOR_ID,
    readiness,
    sourceKind,
    target,
    routes,
    policy,
    blockers,
    warnings,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: buildUniversalImageUpscaleStableSignature(descriptorWithoutSignature),
  };
}

export function resolveUniversalConfiguredUpscalePlan(input: {
  providerSettings: ProviderSettings;
  apiKeys?: Pick<ApiKeys, 'stability'>;
  androidNativeAvailable?: boolean;
}): UniversalConfiguredUpscalePlan {
  const method = input.providerSettings.paperPrintUpscaleMethod ?? 'auto';
  const hasAndroid = isAndroidAcceleratorConfigured(input.providerSettings);
  const hasAndroidNative = !hasAndroid && (input.androidNativeAvailable ?? isAndroidNativeImageUpscalerAvailable());
  const hasStability = Boolean(input.apiKeys?.stability?.trim());
  const hasVertex = isVertexProjectConfigured(input.providerSettings);
  const hasLocalCpu = Boolean(input.providerSettings.localAiCpuEndpointUrl?.trim());

  if (method === 'auto') {
    if (hasAndroid) {
      return plan(method, 'android-accelerator');
    }
    if (hasAndroidNative) {
      return plan(method, 'android-native');
    }
    if (hasLocalCpu) {
      return plan(method, 'local-ai-cpu');
    }
    if (hasStability) {
      return plan(method, 'stability-fast');
    }
    if (hasVertex) {
      return plan(method, 'vertex-imagen');
    }
    return plan(method, 'browser');
  }

  if (method === 'stability-fast') {
    return plan(method, 'stability-fast', hasStability ? undefined : 'Stability AI key is not configured.');
  }
  if (method === 'stability-conservative') {
    return plan(method, 'stability-conservative', hasStability ? undefined : 'Stability AI key is not configured.');
  }
  if (method === 'vertex-imagen') {
    return plan(method, 'vertex-imagen', hasVertex ? undefined : 'Vertex AI image project is not configured.');
  }
  if (method === 'android-accelerator') {
    return plan(method, 'android-accelerator', hasAndroid ? undefined : 'Android accelerator URL is not configured.');
  }
  if (method === 'local-ai-cpu') {
    return plan(method, 'local-ai-cpu', hasLocalCpu ? undefined : 'Local Vulkan AI upscaler runtime is not configured.');
  }
  return plan(method, 'browser');
}

export function addConfiguredUpscaleCost(input: {
  baseCostUsd?: number;
  enabled: boolean;
  providerSettings: ProviderSettings;
  apiKeys?: Pick<ApiKeys, 'stability'>;
}): { costUsd?: number; notes: string[] } {
  if (!input.enabled) {
    return { costUsd: input.baseCostUsd, notes: [] };
  }

  const upscale = resolveUniversalConfiguredUpscalePlan({
    providerSettings: input.providerSettings,
    apiKeys: input.apiKeys,
  });
  const notes = [`Auto-upscale: ${upscale.label} (${upscale.costLabel}).`];

  if (input.baseCostUsd === undefined || upscale.costUsd === undefined) {
    return {
      costUsd: undefined,
      notes,
    };
  }

  return {
    costUsd: roundUsd(input.baseCostUsd + upscale.costUsd),
    notes,
  };
}

type UniversalImageUpscaleRouteDraft = Omit<
  UniversalImageUpscaleReadinessRouteDescriptor,
  'selected' | 'stableSignature'
>;

function describeUniversalImageUpscaleTarget(
  input: UniversalImageUpscaleReadinessInput,
): UniversalImageUpscaleTargetDescriptor {
  const sourceWidthPx = positiveInteger(input.sourceWidthPx);
  const sourceHeightPx = positiveInteger(input.sourceHeightPx);
  const printTarget = input.printTarget;

  if (printTarget) {
    const targetDpi = positiveInteger(printTarget.targetDpi);
    const widthPx = positiveInteger(Math.ceil(positiveNumber(printTarget.widthIn) * targetDpi));
    const heightPx = positiveInteger(Math.ceil(positiveNumber(printTarget.heightIn) * targetDpi));
    return buildUniversalImageUpscaleTargetDescriptor({
      sourceWidthPx,
      sourceHeightPx,
      widthPx,
      heightPx,
      policy: 'print-dpi',
      targetDpi,
      sourceDpi: printTarget.sourceDpi,
    });
  }

  if (input.targetWidthPx !== undefined || input.targetHeightPx !== undefined) {
    return buildUniversalImageUpscaleTargetDescriptor({
      sourceWidthPx,
      sourceHeightPx,
      widthPx: positiveInteger(input.targetWidthPx ?? sourceWidthPx),
      heightPx: positiveInteger(input.targetHeightPx ?? sourceHeightPx),
      policy: 'explicit-pixels',
    });
  }

  const scalePercent = positiveNumber(input.scalePercent ?? 200);
  return buildUniversalImageUpscaleTargetDescriptor({
    sourceWidthPx,
    sourceHeightPx,
    widthPx: positiveInteger(Math.round(sourceWidthPx * scalePercent / 100)),
    heightPx: positiveInteger(Math.round(sourceHeightPx * scalePercent / 100)),
    policy: 'scale-percent',
    scalePercent,
  });
}

function buildUniversalImageUpscaleTargetDescriptor(input: {
  sourceWidthPx: number;
  sourceHeightPx: number;
  widthPx: number;
  heightPx: number;
  policy: UniversalImageUpscaleTargetPolicy;
  scalePercent?: number;
  targetDpi?: number;
  sourceDpi?: number;
}): UniversalImageUpscaleTargetDescriptor {
  const alreadyMeetsPrintResolution = input.sourceWidthPx >= input.widthPx && input.sourceHeightPx >= input.heightPx;
  return {
    sourceWidthPx: input.sourceWidthPx,
    sourceHeightPx: input.sourceHeightPx,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    policy: input.policy,
    ...(input.scalePercent === undefined ? {} : { scalePercent: input.scalePercent }),
    printResolution: {
      ...(input.targetDpi === undefined ? {} : { targetDpi: input.targetDpi }),
      ...(input.sourceDpi === undefined ? {} : { sourceDpi: positiveInteger(input.sourceDpi) }),
      requiredWidthPx: input.widthPx,
      requiredHeightPx: input.heightPx,
      alreadyMeetsPrintResolution,
      action: alreadyMeetsPrintResolution ? 'skip-upscale' : 'queue-upscale',
    },
  };
}

function selectUniversalImageUpscaleRoutes(
  input: UniversalImageUpscaleReadinessInput,
  forcedReadiness?: UniversalImageUpscaleRouteReadinessState,
  forcedBlockers: UniversalImageUpscaleReadinessBlocker[] = [],
): UniversalImageUpscaleReadinessRouteDescriptor[] {
  const routeDrafts = [
    buildOnDevicePreferredRouteDraft(input),
    buildCloudFallbackRouteDraft(input),
    buildBitmapFallbackRouteDraft(),
  ].map((route) => {
    if (!forcedReadiness) return route;
    return {
      ...route,
      readiness: forcedReadiness,
      blockers: forcedReadiness === 'blocked' ? forcedBlockers : [],
    };
  });
  const selectedRouteId = forcedReadiness
    ? undefined
    : routeDrafts.find((route) => route.readiness === 'ready')?.id;

  return routeDrafts.map((route) => {
    const descriptor = {
      ...route,
      selected: route.id === selectedRouteId,
      stableSignature: '',
    };
    return {
      ...descriptor,
      stableSignature: buildUniversalImageUpscaleRouteSignature(descriptor),
    };
  });
}

function buildOnDevicePreferredRouteDraft(
  input: UniversalImageUpscaleReadinessInput,
): UniversalImageUpscaleRouteDraft {
  if (isAndroidAcceleratorConfigured(input.providerSettings)) {
    return buildUniversalImageUpscaleRouteDraft('on-device-preferred', 'android-accelerator', 'ready', []);
  }

  if (input.onDeviceRuntime || input.androidNativeAvailable === true) {
    const blockers = buildAndroidNativeReadinessBlockers(input.onDeviceRuntime, input.androidNativeAvailable);
    return buildUniversalImageUpscaleRouteDraft(
      'on-device-preferred',
      'android-native',
      blockers.length > 0 ? 'blocked' : 'ready',
      blockers,
    );
  }

  if (input.providerSettings.localAiCpuEndpointUrl?.trim()) {
    return buildUniversalImageUpscaleRouteDraft('on-device-preferred', 'local-ai-cpu', 'ready', []);
  }

  return buildUniversalImageUpscaleRouteDraft('on-device-preferred', 'android-native', 'blocked', [
    buildUniversalImageUpscaleBlocker('android-accelerator-endpoint-missing'),
    buildUniversalImageUpscaleBlocker('not-android-runtime'),
    buildUniversalImageUpscaleBlocker('local-cpu-runtime-missing'),
  ]);
}

function buildCloudFallbackRouteDraft(
  input: UniversalImageUpscaleReadinessInput,
): UniversalImageUpscaleRouteDraft {
  const method = input.providerSettings.paperPrintUpscaleMethod ?? 'auto';
  const hasStability = Boolean(input.apiKeys?.stability?.trim());
  const hasVertex = isVertexProjectConfigured(input.providerSettings);
  const provider = selectCloudFallbackProvider(method, hasStability, hasVertex);
  const canRun = provider === 'vertex-imagen' ? hasVertex : hasStability;
  return buildUniversalImageUpscaleRouteDraft(
    'cloud-fallback',
    provider,
    canRun ? 'ready' : 'blocked',
    canRun ? [] : [buildUniversalImageUpscaleBlocker('cloud-provider-missing')],
  );
}

function buildBitmapFallbackRouteDraft(): UniversalImageUpscaleRouteDraft {
  return buildUniversalImageUpscaleRouteDraft('bitmap-fallback', 'browser', 'ready', []);
}

function buildUniversalImageUpscaleReadinessPolicy(input: {
  sourceKind: UniversalImageUpscaleWorkflowSourceKind;
  target: UniversalImageUpscaleTargetDescriptor;
  routes: UniversalImageUpscaleReadinessRouteDescriptor[];
}): UniversalImageUpscaleReadinessPolicyDescriptor {
  const sourceExcluded = input.sourceKind === 'comic-sound-effect';
  const sourceExclusion: UniversalImageUpscaleSourceExclusionPolicyDescriptor = {
    sourceKind: input.sourceKind,
    action: sourceExcluded ? 'exclude-upscale' : 'allow-upscale',
    ...(sourceExcluded ? { blockerCode: 'unsupported-sound-effect' as const } : {}),
    summary: sourceExcluded
      ? 'Comic sound-effect decals are excluded from universal image upscaling; edit or rasterize the SFX source first.'
      : 'Image sources are eligible for universal upscaling when target resolution requires it.',
    stableSignature: buildUniversalImageUpscaleSourceExclusionSignature({
      sourceKind: input.sourceKind,
      action: sourceExcluded ? 'exclude-upscale' : 'allow-upscale',
      blockerCode: sourceExcluded ? 'unsupported-sound-effect' : undefined,
    }),
  };
  const printResolution: UniversalImageUpscalePrintResolutionPolicyDescriptor = {
    defaultTargetDpi: DEFAULT_UNIVERSAL_IMAGE_UPSCALE_PRINT_DPI,
    ...(input.target.printResolution.targetDpi === undefined
      ? {}
      : { targetDpi: input.target.printResolution.targetDpi }),
    requiredWidthPx: input.target.printResolution.requiredWidthPx,
    requiredHeightPx: input.target.printResolution.requiredHeightPx,
    action: input.target.printResolution.action,
    alreadyMeetsPrintResolution: input.target.printResolution.alreadyMeetsPrintResolution,
    summary: input.target.printResolution.action === 'skip-upscale'
      ? 'No universal upscale should be queued when the source already meets the requested print-resolution target.'
      : 'Universal upscaling may be queued to meet the requested target dimensions or print-resolution target.',
    stableSignature: buildUniversalImageUpscalePrintResolutionSignature({
      defaultTargetDpi: DEFAULT_UNIVERSAL_IMAGE_UPSCALE_PRINT_DPI,
      requiredWidthPx: input.target.printResolution.requiredWidthPx,
      requiredHeightPx: input.target.printResolution.requiredHeightPx,
      action: input.target.printResolution.action,
      alreadyMeetsPrintResolution: input.target.printResolution.alreadyMeetsPrintResolution,
    }),
  };
  const fallbackOrder = input.routes.map((route, index) => ({
    rank: index + 1,
    routeId: route.id,
    provider: route.provider,
    readiness: route.readiness,
    selected: route.selected,
    purpose: describeUniversalImageUpscaleFallbackPurpose(route.id),
  }));
  const descriptorWithoutSignature = {
    sourceExclusion,
    printResolution,
    fallbackOrder,
  };

  return {
    ...descriptorWithoutSignature,
    stableSignature: buildUniversalImageUpscalePolicyStableSignature(descriptorWithoutSignature),
  };
}

function buildUniversalImageUpscaleSourceExclusionSignature(input: {
  sourceKind: UniversalImageUpscaleWorkflowSourceKind;
  action: UniversalImageUpscaleSourceExclusionAction;
  blockerCode?: Extract<UniversalImageUpscaleReadinessBlockerCode, 'unsupported-sound-effect'>;
}): string {
  return [
    'image-upscale-source-exclusion:v1',
    `source=${input.sourceKind}`,
    `action=${input.action}`,
    `blocker=${input.blockerCode ?? 'none'}`,
  ].join('|');
}

function buildUniversalImageUpscalePrintResolutionSignature(input: {
  defaultTargetDpi: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  action: UniversalImageUpscaleTargetAction;
  alreadyMeetsPrintResolution: boolean;
}): string {
  return [
    'image-upscale-print-resolution:v1',
    `dpi=${input.defaultTargetDpi}`,
    `required=${input.requiredWidthPx}x${input.requiredHeightPx}`,
    `action=${input.action}`,
    `already=${input.alreadyMeetsPrintResolution ? 'yes' : 'no'}`,
  ].join('|');
}

function describeUniversalImageUpscaleFallbackPurpose(
  routeId: UniversalImageUpscaleReadinessRouteId,
): string {
  if (routeId === 'on-device-preferred') {
    return 'Prefer local/on-device execution before spending cloud credits or falling back to bitmap resize.';
  }
  if (routeId === 'cloud-fallback') {
    return 'Use configured cloud image upscaling when on-device execution is blocked or unavailable.';
  }
  return 'Use deterministic local bitmap resizing as the final no-credential availability fallback.';
}

function buildUniversalImageUpscaleRouteDraft(
  id: UniversalImageUpscaleReadinessRouteId,
  provider: UniversalConfiguredUpscaleProvider,
  readiness: UniversalImageUpscaleRouteReadinessState,
  blockers: UniversalImageUpscaleReadinessBlocker[],
): UniversalImageUpscaleRouteDraft {
  const workflow = describeUniversalImageUpscaleWorkflow(provider);
  return {
    id,
    provider,
    label: workflow.methodLabel,
    family: workflow.family,
    readiness,
    costUsd: workflow.costUsd,
    costLabel: workflow.costLabel,
    capabilities: {
      ...workflow.capabilities,
      fixedScaleFactors: [...workflow.capabilities.fixedScaleFactors],
    },
    notes: [...workflow.notes],
    blockers,
  };
}

function selectCloudFallbackProvider(
  method: PaperPrintUpscaleMethod,
  hasStability: boolean,
  hasVertex: boolean,
): UniversalConfiguredUpscaleProvider {
  if (method === 'stability-conservative') return 'stability-conservative';
  if (method === 'stability-fast') return 'stability-fast';
  if (method === 'vertex-imagen') return 'vertex-imagen';
  if (hasStability) return 'stability-fast';
  if (hasVertex) return 'vertex-imagen';
  return 'stability-fast';
}

function buildAndroidNativeReadinessBlockers(
  runtime?: AndroidImageParityRuntimeInput,
  androidNativeAvailable?: boolean,
): UniversalImageUpscaleReadinessBlocker[] {
  if (!runtime) {
    return androidNativeAvailable === true ? [] : [buildUniversalImageUpscaleBlocker('not-android-runtime')];
  }

  const blockers: UniversalImageUpscaleReadinessBlocker[] = [];
  if (runtime.platform !== 'android' || runtime.capacitorAndroid !== true) {
    blockers.push(buildUniversalImageUpscaleBlocker('not-android-runtime'));
  }
  if (runtime.pluginRegistered !== true) {
    blockers.push(buildUniversalImageUpscaleBlocker('android-plugin-missing'));
  }
  if (runtime.localDreamServiceAvailable !== true) {
    blockers.push(buildUniversalImageUpscaleBlocker('local-dream-service-missing'));
  }
  if (runtime.singleApplicationRuntimeAvailable === false) {
    blockers.push(buildUniversalImageUpscaleBlocker('single-app-runtime-missing'));
  }
  if (runtime.secondAppDependencyRequired === true) {
    blockers.push(buildUniversalImageUpscaleBlocker('second-app-handoff-required'));
  }
  if (runtime.bundledRuntimeAssetsAvailable === false) {
    blockers.push(buildUniversalImageUpscaleBlocker('runtime-assets-missing'));
  }
  const accelerators = runtime.preferredAccelerators?.map((value) => value.trim().toLowerCase()).filter(Boolean) ?? ['qnn'];
  const acceleratorAvailable = accelerators.some((acceleratorId) => (
    acceleratorId === 'qnn'
      ? runtime.qnnRuntimeAvailable === true
      : acceleratorId === 'nnapi'
        ? runtime.nnapiRuntimeAvailable === true
        : runtime.equivalentAcceleratorAvailable === true
  ));
  if (!acceleratorAvailable) {
    blockers.push(buildUniversalImageUpscaleBlocker(
      accelerators.every((acceleratorId) => acceleratorId === 'qnn')
        ? 'qnn-runtime-missing'
        : 'accelerator-runtime-missing',
    ));
  }
  if (runtime.bundledUpscalerModelAvailable !== true) {
    blockers.push(buildUniversalImageUpscaleBlocker('upscaler-model-missing'));
  }
  return blockers;
}

function selectUniversalImageUpscaleBlockers(
  exclusionBlockers: UniversalImageUpscaleReadinessBlocker[],
  routes: UniversalImageUpscaleReadinessRouteDescriptor[],
  selectedRoute?: UniversalImageUpscaleReadinessRouteDescriptor,
): UniversalImageUpscaleReadinessBlocker[] {
  if (exclusionBlockers.length > 0) return exclusionBlockers;
  const onDeviceBlockers = routes.find((route) => route.id === 'on-device-preferred')?.blockers ?? [];
  const cloudBlockers = routes.find((route) => route.id === 'cloud-fallback')?.blockers ?? [];

  if (!selectedRoute) {
    return dedupeUniversalImageUpscaleBlockers(routes.flatMap((route) => route.blockers));
  }
  if (selectedRoute.id === 'on-device-preferred') return [];
  if (selectedRoute.id === 'cloud-fallback') return dedupeUniversalImageUpscaleBlockers(onDeviceBlockers);
  return dedupeUniversalImageUpscaleBlockers([...onDeviceBlockers, ...cloudBlockers]);
}

function describeUniversalImageUpscaleReadinessState(
  exclusionBlockers: UniversalImageUpscaleReadinessBlocker[],
  target: UniversalImageUpscaleTargetDescriptor,
  selectedRoute?: UniversalImageUpscaleReadinessRouteDescriptor,
): UniversalImageUpscaleReadinessState {
  if (exclusionBlockers.length > 0) return 'blocked';
  if (target.printResolution.action === 'skip-upscale') return 'not-needed';
  if (!selectedRoute) return 'blocked';
  return selectedRoute.id === 'on-device-preferred' ? 'ready' : 'degraded';
}

function buildUniversalImageUpscaleBlocker(
  code: UniversalImageUpscaleReadinessBlockerCode,
): UniversalImageUpscaleReadinessBlocker {
  const messages: Record<UniversalImageUpscaleReadinessBlockerCode, string> = {
    'unsupported-sound-effect': 'Comic sound-effect decals are excluded from universal image upscaling.',
    'android-accelerator-endpoint-missing': 'Android accelerator endpoint is not configured.',
    'not-android-runtime': 'Android-native upscaling requires an Android Capacitor runtime.',
    'android-plugin-missing': 'SignalLoomImageUpscaler native plugin registration has not been proven.',
    'local-dream-service-missing': 'Bundled Local Dream upscaler service availability has not been proven.',
    'qnn-runtime-missing': 'QNN runtime availability has not been proven.',
    'accelerator-runtime-missing': 'QNN, NNAPI, or equivalent accelerator availability has not been proven.',
    'runtime-assets-missing': 'Bundled runtime assets required for the on-device path have not been proven.',
    'upscaler-model-missing': 'Bundled upscaler model availability has not been proven.',
    'single-app-runtime-missing': 'The single-app Sloom Studio runtime path has not been proven.',
    'second-app-handoff-required': 'The current Android upscale path still depends on a second-app handoff.',
    'local-cpu-runtime-missing': 'Local Vulkan AI upscaler runtime is not configured.',
    'cloud-provider-missing': 'No configured cloud image upscaler fallback is available.',
  };
  return {
    code,
    message: messages[code],
  };
}

function dedupeUniversalImageUpscaleBlockers(
  blockers: UniversalImageUpscaleReadinessBlocker[],
): UniversalImageUpscaleReadinessBlocker[] {
  const seen = new Set<UniversalImageUpscaleReadinessBlockerCode>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.code)) return false;
    seen.add(blocker.code);
    return true;
  });
}

function buildUniversalImageUpscaleStableSignature(
  descriptor: Omit<UniversalImageUpscaleReadinessDescriptor, 'stableSignature'>,
): string {
  const routes = descriptor.routes.map((route) => [
    route.id,
    route.provider,
    route.readiness,
    route.selected ? 'selected' : 'fallback',
  ].join(':')).join(',');
  const blockers = descriptor.blockers.map((blocker) => blocker.code).join(',') || 'none';
  return [
    UNIVERSAL_IMAGE_UPSCALE_READINESS_DESCRIPTOR_ID,
    `source=${descriptor.sourceKind}:${descriptor.target.sourceWidthPx}x${descriptor.target.sourceHeightPx}`,
    `target=${buildUniversalImageUpscaleTargetSignature(descriptor.target)}`,
    `readiness=${descriptor.readiness}`,
    `routes=${routes}`,
    `blockers=${blockers}`,
  ].join('|');
}

function buildUniversalImageUpscalePolicyStableSignature(
  descriptor: Omit<UniversalImageUpscaleReadinessPolicyDescriptor, 'stableSignature'>,
): string {
  return [
    'image-universal-upscale-policy:v1',
    `source=${descriptor.sourceExclusion.sourceKind}:${descriptor.sourceExclusion.action}`,
    `print=${descriptor.printResolution.defaultTargetDpi}:${descriptor.printResolution.requiredWidthPx}x${descriptor.printResolution.requiredHeightPx}:${descriptor.printResolution.action}`,
    `fallback=${descriptor.fallbackOrder.map((route) => route.routeId).join('>')}`,
  ].join('|');
}

function buildUniversalImageUpscaleRouteSignature(
  route: UniversalImageUpscaleReadinessRouteDescriptor,
): string {
  const blockers = route.blockers.map((blocker) => blocker.code).join(',') || 'none';
  return [
    'image-universal-upscale-route:v1',
    `id=${route.id}`,
    `provider=${route.provider}`,
    `readiness=${route.readiness}`,
    `selected=${route.selected ? 'yes' : 'no'}`,
    `blockers=${blockers}`,
  ].join('|');
}

function buildUniversalImageUpscaleTargetSignature(target: UniversalImageUpscaleTargetDescriptor): string {
  const action = `action=${target.printResolution.action}`;
  if (target.policy === 'print-dpi') {
    return `print-dpi:${target.widthPx}x${target.heightPx}:dpi=${target.printResolution.targetDpi ?? 'unknown'}:${action}`;
  }
  if (target.policy === 'scale-percent') {
    return `scale-percent:${target.widthPx}x${target.heightPx}:scale=${target.scalePercent ?? 200}:${action}`;
  }
  return `explicit-pixels:${target.widthPx}x${target.heightPx}:${action}`;
}

function positiveInteger(value: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
}

function positiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function plan(
  method: PaperPrintUpscaleMethod,
  provider: UniversalConfiguredUpscaleProvider,
  unavailableReason?: string,
): UniversalConfiguredUpscalePlan {
  const costUsd = provider === 'stability-fast'
    ? STABILITY_FAST_UPSCALE_COST_USD
    : provider === 'stability-conservative'
      ? STABILITY_CONSERVATIVE_UPSCALE_COST_USD
      : provider === 'vertex-imagen'
        ? undefined
        : provider === 'atlas-image-upscaler'
          ? ATLAS_IMAGE_UPSCALE_COST_USD
          : 0;
  const label = describeUniversalConfiguredUpscaleProvider(provider);

  return {
    method,
    provider,
    canRun: !unavailableReason,
    costUsd,
    label,
    costLabel: costUsd === undefined ? 'cost unknown' : costUsd <= 0 ? 'free' : `$${costUsd.toFixed(2)}`,
    notes: provider === 'android-accelerator'
      ? ['Runs on the paired phone over LAN with no provider spend.']
      : provider === 'android-native'
        ? ['Runs inside the Android app with no provider spend.']
      : provider === 'local-ai-cpu'
        ? ['Managed desktop runtime: Real-ESRGAN ncnn with Vulkan acceleration; no CPU fallback.']
        : provider === 'browser'
          ? ['Runs as local browser scaling with no provider spend.']
          : [],
    unavailableReason,
  };
}

function describeUniversalConfiguredUpscaleProvider(provider: UniversalConfiguredUpscaleProvider): string {
  return describeUniversalImageUpscaleWorkflow(provider).methodLabel;
}

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function cloneWorkflowDescriptor(
  descriptor: UniversalImageUpscaleWorkflowDescriptor,
): UniversalImageUpscaleWorkflowDescriptor {
  return {
    ...descriptor,
    capabilities: {
      ...descriptor.capabilities,
      fixedScaleFactors: [...descriptor.capabilities.fixedScaleFactors],
    },
    notes: [...descriptor.notes],
    warnings: descriptor.warnings.map((warning) => ({ ...warning })),
  };
}
