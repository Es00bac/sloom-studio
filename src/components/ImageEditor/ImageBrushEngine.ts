import type { BrushSettings, BrushSymmetryMode, TiltmarkBristlePhysicalOverrides } from '../../types/imageEditor';
import { sampleBrushTexture } from './ImageBrushTextures';
import { applyBrushTiltDynamics, resolveBrushTiltState, type BrushTiltState } from './brushTiltGeometry';
import { fadeInFactor, depletePaintLoad } from './ImageBrushDryDynamics';
import { evalResponseCurve, normalizeResponseCurve } from './ImageBrushResponseCurve';
import {
  STAMP_CANONICAL_RADIUS,
  getBrushStamp,
  quantizeStampHardness,
  shouldUseBrushStamp,
} from './ImageBrushStamp';
import type { Point } from './tools/types';

export interface BrushDynamics {
  size: number;
  opacity: number;
  flow: number;
  spacingPx: number;
  hardness: number;
  roundness: number;
  angleDeg: number;
  tipShape: BrushSettings['tipShape'];
}

export interface BrushDab extends BrushDynamics {
  x: number;
  y: number;
  index: number;
  textureAlpha: number;
  wetness: number;
}

export interface BuildBrushDabsOptions {
  seed?: number;
  startIndex?: number;
  /** Legacy 1D tilt → angle override (degrees). Superseded by `tilt`. */
  tiltAngle?: number | null;
  /** Full stylus tilt + barrel-rotation state (drives angle, elongation, size). */
  tilt?: BrushTiltState | null;
  velocityPxPerMs?: number;
  /** Accumulated stroke distance in px before this segment (for dry-brush load depletion). */
  accumulatedDistancePx?: number;
}

export interface BrushStrokePreviewOptions extends BuildBrushDabsOptions {
  pressure?: number;
  applySmoothing?: boolean;
  maxDabs?: number;
}

export interface BrushStrokePreviewMetadata {
  from: Point;
  to: Point;
  smoothedTo: Point;
  rawDistancePx: number;
  distancePx: number;
  dynamics: BrushDynamics;
  spacing: {
    ratio: number;
    px: number;
    dabCount: number;
    coverage: 'continuous' | 'spaced' | 'stamp';
  };
  smoothing: {
    amount: number;
    applied: boolean;
    followFactor: number;
  };
  pressure: {
    input: number;
    resolved: number;
    affects: Array<'size' | 'opacity' | 'flow' | 'roundness' | 'hardness'>;
  };
  tilt: {
    active: boolean;
    angleDeg: number | null;
    affects: Array<'angle' | 'roundness' | 'size' | 'opacity' | 'flow'>;
  };
  velocity: {
    pxPerMs: number;
    normalized: number;
    affects: Array<'size' | 'opacity' | 'flow' | 'spacing'>;
  };
  texture: {
    active: boolean;
    name: string | null;
    scale: number;
    depth: number;
    dualBrushComposition: boolean;
  };
  wetMedia: {
    active: boolean;
    mix: number;
    load: number;
    pull: number;
    mode: 'dry' | 'wet-edge-alpha-build-up';
  };
  randomization: {
    seed: number;
    scatterPx: number;
    deterministic: boolean;
  };
  dabPreview: BrushDab[];
  signature: string;
  warnings: BrushCapabilityWarning[];
}

export type BrushCapabilityWarningCategory = 'pressure' | 'tilt' | 'randomization' | 'texture';

export interface BrushCapabilityWarning {
  field: string;
  category: BrushCapabilityWarningCategory;
  message: string;
  presetId?: string;
  presetLabel?: string;
}

export interface BrushPresetCapabilityInput {
  id?: string;
  label?: string;
  group?: string;
  settings: Partial<BrushSettings>;
}

export interface BrushPresetCapabilitySummary {
  totalPresets: number;
  groups: Record<string, number>;
  workflowCoverage: Record<BrushPresetWorkflow, boolean>;
  implementedDynamics: string[];
  unsupportedDynamics: string[];
  presetSummaries: BrushPresetCapability[];
  unsupportedWarnings: BrushCapabilityWarning[];
}

export interface BrushWorkflowSupportDescriptor {
  descriptorId: 'image-brush-workflow-support:v1';
  version: 1;
  deterministic: true;
  settings: BrushWorkflowSupportSettings;
  support: {
    spacing: {
      supported: true;
      value: number;
      spacingPx: number;
      coverage: BrushStrokePreviewMetadata['spacing']['coverage'];
    };
    smoothing: {
      supported: true;
      value: number;
      followFactor: number;
    };
    pressure: {
      supported: true;
      affects: Array<'size' | 'opacity' | 'flow' | 'roundness' | 'hardness'>;
      unsupportedAffects: string[];
    };
    tilt: {
      supported: true;
      affects: Array<'angle' | 'roundness' | 'size' | 'opacity' | 'flow'>;
      unsupportedAffects: string[];
    };
    randomization: {
      supported: true;
      affects: Array<'scatter'>;
      unsupportedAffects: string[];
    };
  };
  symmetry: {
    mode: BrushSymmetryMode;
    axes: Array<'vertical' | 'horizontal'>;
    mirroredDabMultiplier: 1 | 2 | 4;
    deterministic: true;
  };
  warnings: BrushCapabilityWarning[];
  signature: string;
}

export type BrushWorkflowSupportSettings = BrushSettings & Record<string, unknown>;

export type BrushPresetWorkflow =
  | 'sketch'
  | 'ink'
  | 'paint'
  | 'comic'
  | 'effects'
  | 'utility'
  | 'eraser'
  | 'texture';

export interface BrushPresetCapability {
  id: string;
  label: string;
  group: string;
  workflows: BrushPresetWorkflow[];
  tipShape: BrushSettings['tipShape'];
  usesPressure: boolean;
  usesScatter: boolean;
  usesSmoothing: boolean;
  warnings: BrushCapabilityWarning[];
}

export interface BrushEngineReadinessInput {
  settings?: Partial<BrushSettings> & Record<string, unknown>;
  presets?: readonly BrushPresetCapabilityInput[];
  presetPack?: {
    version?: number;
    presetCount?: number;
    importable?: boolean;
    exportable?: boolean;
  };
  stylus?: {
    pointerTypes?: readonly string[];
    pressureEventsObserved?: boolean;
    tiltEventsObserved?: boolean;
    wacomDriverFallback?: boolean;
  };
  operation?: {
    tool?: 'brush' | 'eraser';
    documentOpen?: boolean;
    hasEditableTarget?: boolean;
    lockedPixels?: boolean;
    hiddenLayer?: boolean;
    canvasWidth?: number;
    canvasHeight?: number;
  };
  routes?: Omit<BrushRouteSummariesInput, 'settings' | 'tool' | 'operation' | 'preview'>;
  preview?: {
    from?: Point;
    to?: Point;
    pressure?: number;
    seed?: number;
    tiltAngle?: number | null;
    maxDabs?: number;
    applySmoothing?: boolean;
  };
}

export type BrushDynamicsSupportState =
  | 'ready'
  | 'browser-or-device-unavailable'
  | 'unsupported';

export type BrushUnsupportedEngineStateCode =
  | 'true-tablet-pressure-unavailable'
  | 'advanced-photoshop-dynamics-unsupported'
  | 'dual-brush-unsupported'
  | 'wet-media-unsupported'
  | 'abr-import-fidelity-unsupported'
  | 'gpu-brush-engine-unsupported'
  | 'android-brush-controls-unsupported'
  | 'gamepad-brush-controls-unsupported';

export interface BrushUnsupportedEngineState {
  code: BrushUnsupportedEngineStateCode;
  supported: false;
  requested: boolean;
  message: string;
}

export interface BrushDynamicsSupportMatrixDescriptor {
  descriptorId: 'image-brush-dynamics-support-matrix:v1';
  version: 1;
  deterministic: true;
  settings: BrushSettings;
  support: {
    spacing: {
      supported: true;
      value: number;
      spacingPx: number;
      coverage: BrushStrokePreviewMetadata['spacing']['coverage'];
    };
    smoothing: {
      supported: true;
      value: number;
      followFactor: number;
    };
    pressure: {
      supported: true;
      state: BrushDynamicsSupportState;
      affects: Array<'size' | 'opacity' | 'flow' | 'roundness' | 'hardness'>;
      trueTabletPressure: {
        supported: boolean;
        state: BrushDynamicsSupportState;
        pointerTypes: string[];
        pressureEventsObserved: boolean;
      };
      unsupportedAffects: string[];
    };
    tilt: {
      supported: true;
      state: BrushDynamicsSupportState;
      affects: Array<'angle' | 'roundness' | 'size' | 'opacity' | 'flow'>;
      tiltEventsObserved: boolean;
      unsupportedAffects: string[];
    };
    velocity: {
      supported: true;
      requested: boolean;
      requestedFields: string[];
      affects: Array<'size' | 'opacity' | 'flow' | 'spacing'>;
    };
    randomization: BrushWorkflowSupportDescriptor['support']['randomization'];
    symmetry: BrushWorkflowSupportDescriptor['symmetry'] & {
      supported: boolean;
    };
  };
  unsupportedEngineStates: BrushUnsupportedEngineState[];
  dynamicSettingsSignature: string;
  signature: string;
}

export interface BrushAdvancedEngineSupportInput {
  settings?: Partial<BrushSettings> & Record<string, unknown>;
  renderBackend?: {
    webgpuAvailable?: boolean;
    offscreenCanvasAvailable?: boolean;
    desktopAmdAvailable?: boolean;
    desktopNvidiaAvailable?: boolean;
    androidQualcommAvailable?: boolean;
  };
  deviceControls?: {
    androidStylusAvailable?: boolean;
    gamepadConnected?: boolean;
  };
}

export interface BrushAdvancedEngineSupportDescriptor {
  descriptorId: 'image-brush-advanced-engine-support:v1';
  version: 1;
  deterministic: true;
  settings: BrushSettings;
  velocity: {
    supported: true;
    requested: boolean;
    affects: Array<'size' | 'opacity' | 'flow' | 'spacing'>;
    controls: Record<'velocitySize' | 'velocityOpacity' | 'velocityFlow' | 'velocitySpacing', number>;
  };
  texture: {
    supported: true;
    requested: boolean;
    requestedFields: string[];
    name: string | null;
    scale: number;
    depth: number;
    dualBrushComposition: boolean;
  };
  wetMedia: {
    supported: true;
    requested: boolean;
    mode: 'dry' | 'wet-edge-alpha-build-up';
    mix: number;
    load: number;
    pull: number;
  };
  renderBackend: {
    supported: true;
    gpuReady: boolean;
    selected: 'webgpu-compute' | 'offscreen-canvas' | 'canvas-2d';
    targets: Array<'desktop-amd' | 'desktop-nvidia' | 'android-qualcomm-adreno'>;
  };
  deviceControls: {
    supported: true;
    android: {
      supported: true;
      stylusAvailable: boolean;
      route: 'pointer-pressure-tilt';
    };
    gamepad: {
      supported: true;
      connected: boolean;
      route: 'gamepad-axis-pressure-size-flow';
    };
  };
  abrImportFidelity: {
    supported: true;
    sourceHash: string | null;
    presetId: string | null;
    version: number | null;
    fidelity: 'native-metadata-normalized' | 'no-abr-source';
  };
  unsupportedEngineStates: BrushUnsupportedEngineState[];
  signature: string;
}

export type BrushEngineOperationBlockerCode =
  | 'no-open-document'
  | 'no-editable-pixel-target'
  | 'target-pixels-locked'
  | 'target-layer-hidden'
  | 'invalid-canvas-bounds';

export interface BrushEngineOperationBlocker {
  code: BrushEngineOperationBlockerCode;
  message: string;
}

export type BrushRouteTarget =
  | 'pixels'
  | 'layer-mask'
  | 'quick-mask'
  | 'rgb-channels'
  | 'alpha-channel'
  | 'spot-channel';

export type BrushRouteName =
  | 'active-pixels-rgba'
  | 'layer-mask-alpha'
  | 'quick-mask-selection-alpha'
  | 'active-rgb-components'
  | 'alpha-channel-direct-paint-unsupported'
  | 'spot-channel-direct-paint-unsupported';

export type BrushRouteSupportPath =
  | 'active-pixels-rgba-paint'
  | 'active-pixels-alpha-clear'
  | 'layer-mask-alpha-paint'
  | 'layer-mask-alpha-conceal'
  | 'quick-mask-selection-paint'
  | 'quick-mask-selection-reveal'
  | 'active-rgb-components-paint'
  | 'active-rgb-components-alpha-clear'
  | 'alpha-channel-direct-paint-unsupported'
  | 'spot-channel-direct-paint-unsupported';

export type BrushRgbChannelComponent = 'red' | 'green' | 'blue';

export type BrushRouteBlockerCode =
  | BrushEngineOperationBlockerCode
  | 'no-layer-mask-target'
  | 'quick-mask-disabled'
  | 'no-active-rgb-channel';

export type BrushRouteWarningCode =
  | 'alpha-channel-direct-paint-unsupported'
  | 'spot-channel-direct-paint-unsupported';

export interface BrushRouteWarning {
  code: BrushRouteWarningCode;
  target: 'alpha-channel' | 'spot-channel';
  message: string;
}

export interface BrushRouteTargetSummary {
  route: BrushRouteName;
  supportPath: BrushRouteSupportPath;
  supported: boolean;
  ready: boolean;
  compositeOperation: GlobalCompositeOperation;
  targetValue: number | null;
  channelComponents: BrushRgbChannelComponent[];
  channelId: string | null;
  blockers: BrushRouteBlockerCode[];
  blockerSummary: string;
  warnings: BrushRouteWarningCode[];
  signature: string;
}

export interface BrushRouteSummariesInput {
  settings?: Partial<BrushSettings> & Record<string, unknown>;
  tool?: 'brush' | 'eraser';
  activeTarget?: BrushRouteTarget;
  layerMaskTarget?: boolean;
  quickMaskEnabled?: boolean;
  activeRgbChannels?: readonly BrushRgbChannelComponent[];
  activeAlphaChannelId?: string | null;
  activeSpotChannelId?: string | null;
  operation?: {
    tool?: 'brush' | 'eraser';
    documentOpen?: boolean;
    hasEditableTarget?: boolean;
    lockedPixels?: boolean;
    hiddenLayer?: boolean;
    canvasWidth?: number;
    canvasHeight?: number;
  };
  preview?: {
    from?: Point;
    to?: Point;
    pressure?: number;
    seed?: number;
    tiltAngle?: number | null;
    maxDabs?: number;
    applySmoothing?: boolean;
  };
}

export interface BrushRouteSummariesDescriptor {
  descriptorId: 'image-brush-route-summaries:v1';
  version: 1;
  deterministic: true;
  tool: 'brush' | 'eraser';
  activeTarget: BrushRouteTarget;
  activeRoute: BrushRouteName;
  routes: {
    pixels: BrushRouteTargetSummary;
    layerMask: BrushRouteTargetSummary;
    quickMask: BrushRouteTargetSummary;
    rgbChannels: BrushRouteTargetSummary;
    alphaChannel: BrushRouteTargetSummary;
    spotChannel: BrushRouteTargetSummary;
  };
  blockers: BrushEngineOperationBlocker[];
  warnings: BrushRouteWarning[];
  previewSignature: string;
  signature: string;
}

export type BrushUnsupportedScatteringState =
  | 'disabled'
  | 'deterministic-scatter'
  | 'deterministic-scatter-with-jitter-fallback';

export interface BrushUnsupportedDynamicsReadinessDescriptor {
  descriptorId: 'image-brush-unsupported-dynamics-readiness:v1';
  version: 1;
  deterministic: true;
  requestedFields: string[];
  warnings: BrushCapabilityWarning[];
  texture: {
    supported: boolean;
    requested: boolean;
    requestedFields: string[];
    fallback: 'flat-brush-tip';
  };
  scattering: {
    supported: true;
    value: number;
    deterministicOnly: true;
    state: BrushUnsupportedScatteringState;
    unsupportedJitterFields: string[];
  };
  signature: string;
}

export interface BrushEngineReadinessDescriptor {
  descriptorId: 'image-brush-engine-readiness:v1';
  version: 1;
  deterministic: true;
  settings: BrushSettings;
  operation: {
    tool: 'brush' | 'eraser';
    ready: boolean;
    compositeOperation: GlobalCompositeOperation;
  };
  support: {
    dabs: {
      supported: true;
      deterministic: true;
      previewDabCount: number;
      totalDabCount: number;
    };
    spacing: {
      supported: true;
      value: number;
      spacingPx: number;
      coverage: BrushStrokePreviewMetadata['spacing']['coverage'];
    };
    hardness: {
      supported: true;
      value: number;
    };
    opacity: {
      supported: true;
      value: number;
    };
    flow: {
      supported: true;
      value: number;
    };
    smoothing: {
      supported: true;
      value: number;
      followFactor: number;
    };
    pressure: {
      supported: true;
      affects: Array<'size' | 'opacity' | 'flow' | 'roundness' | 'hardness'>;
    };
    tilt: {
      supported: true;
      affects: Array<'angle' | 'roundness' | 'size' | 'opacity' | 'flow'>;
    };
    symmetry: BrushWorkflowSupportDescriptor['symmetry'] & {
      supported: boolean;
    };
    presets: {
      supported: true;
      totalPresets: number;
      coverageComplete: boolean;
      workflowCoverage: Record<BrushPresetWorkflow, boolean>;
      unsupportedWarnings: number;
    };
  };
  limitations: {
    advancedDynamics: {
      supported: false;
      unsupportedFields: string[];
      warnings: BrushCapabilityWarning[];
    };
    texture: {
      supported: true;
      requested: boolean;
      requestedFields: string[];
      fallback: BrushUnsupportedDynamicsReadinessDescriptor['texture']['fallback'];
      warnings: BrushCapabilityWarning[];
    };
    scatter: {
      supported: true;
      value: number;
      deterministicOnly: true;
      unsupportedJitter: boolean;
      state: BrushUnsupportedScatteringState;
      unsupportedJitterFields: string[];
    };
  };
  unsupportedDynamics: BrushUnsupportedDynamicsReadinessDescriptor;
  advancedEngine: BrushAdvancedEngineSupportDescriptor;
  routeSummary: BrushRouteSummariesDescriptor;
  brushPreview: {
    signature: string;
    preview: BrushStrokePreviewMetadata;
  };
  presetPack: {
    ready: boolean;
    packVersion: number;
    presetCount: number;
    importable: boolean;
    exportable: boolean;
    warnings: string[];
  };
  stylusInput: {
    ready: boolean;
    pressureReady: boolean;
    tiltReady: boolean;
    pointerTypes: string[];
    wacomDriverFallback: boolean;
  };
  blockers: BrushEngineOperationBlocker[];
  signature: string;
}

export function normalizeBrushSettings(settings: Partial<BrushSettings>): BrushSettings {
  const merged = {
    ...DEFAULT_NORMALIZED_BRUSH_SETTINGS,
    ...settings,
  };

  return {
    brushEngine: merged.brushEngine === 'tiltmark' ? 'tiltmark' : 'studio',
    presetId: merged.presetId,
    tiltmarkPresetId: normalizeOptionalBrushText(merged.tiltmarkPresetId) ?? 'graphite-2b',
    tiltmarkWetness: clamp(merged.tiltmarkWetness ?? 0, 0, 1),
    tiltmarkSolvent: clamp(merged.tiltmarkSolvent ?? 0, 0, 1),
    tiltmarkPickup: clamp(merged.tiltmarkPickup ?? 0, 0, 1),
    tiltmarkGrain: clamp(merged.tiltmarkGrain ?? 0, 0, 1),
    tiltmarkInteraction: normalizeTiltmarkInteraction(merged.tiltmarkInteraction),
    tiltmarkPersistentSupply: merged.tiltmarkPersistentSupply !== false,
    tiltmarkOverrides: normalizeTiltmarkOverrides(merged.tiltmarkOverrides),
    tiltmarkStylusProfile: normalizeTiltmarkStylusProfile(merged.tiltmarkStylusProfile),
    tiltmarkWetPhysics: normalizeTiltmarkWetPhysics(merged.tiltmarkWetPhysics),
    tiltmarkEvaporationRate: clampOptional(merged.tiltmarkEvaporationRate, 0, 64),
    size: clamp(round(merged.size), 1, 512),
    opacity: clamp(merged.opacity, 0, 1),
    hardness: clamp(merged.hardness, 0, 1),
    flow: clamp(merged.flow, 0, 1),
    color: normalizeBrushColor(merged.color),
    spacing: clamp(merged.spacing, 0.02, 2),
    angleDeg: normalizeAngle(merged.angleDeg),
    roundness: clamp(merged.roundness, 0.05, 1),
    scatter: clamp(merged.scatter, 0, 2),
    smoothing: clamp(merged.smoothing, 0, 1),
    pressureSize: clamp(merged.pressureSize, 0, 1),
    pressureOpacity: clamp(merged.pressureOpacity, 0, 1),
    pressureFlow: clamp(merged.pressureFlow, 0, 1),
    pressureRoundness: clamp(merged.pressureRoundness ?? 0, 0, 1),
    pressureHardness: clamp(merged.pressureHardness ?? 0, 0, 1),
    pressureCurve: normalizeResponseCurve(merged.pressureCurve),
    tiltAngle: clamp(merged.tiltAngle ?? 0.7, 0, 1),
    tiltRoundness: clamp(merged.tiltRoundness ?? 0.6, 0, 1),
    tiltSize: clamp(merged.tiltSize ?? 0.2, 0, 1),
    tiltOpacity: clamp(merged.tiltOpacity ?? 0, 0, 1),
    tiltFlow: clamp(merged.tiltFlow ?? 0, 0, 1),
    rotationFollowsTwist: merged.rotationFollowsTwist !== false,
    pressureColor: clamp(merged.pressureColor ?? 0, 0, 1),
    tiltColor: clamp(merged.tiltColor ?? 0, 0, 1),
    mixerEnabled: merged.mixerEnabled ?? false,
    smudgeLength: clamp(merged.smudgeLength ?? 0.5, 0, 1),
    smudgeRadius: Math.max(1, merged.smudgeRadius ?? 12),
    colorRate: clamp(merged.colorRate ?? 0.5, 0, 1),
    mixMode: merged.mixMode ?? 'rgb',
    smudgeMode: merged.smudgeMode ?? 'dulling',
    tipShape: merged.tipShape === 'square' ? 'square' : 'round',
    symmetryMode: normalizeBrushSymmetryMode(merged.symmetryMode),
    velocitySize: clamp(merged.velocitySize ?? 0, 0, 1),
    velocityOpacity: clamp(merged.velocityOpacity ?? 0, 0, 1),
    velocityFlow: clamp(merged.velocityFlow ?? 0, 0, 1),
    velocitySpacing: clamp(merged.velocitySpacing ?? 0, 0, 1),
    sizeJitter: clamp(merged.sizeJitter ?? 0, 0, 1),
    opacityJitter: clamp(merged.opacityJitter ?? 0, 0, 1),
    flowJitter: clamp(merged.flowJitter ?? 0, 0, 1),
    roundnessJitter: clamp(merged.roundnessJitter ?? 0, 0, 1),
    angleJitter: clamp(merged.angleJitter ?? 0, 0, 1),
    fadeLength: Math.max(0, merged.fadeLength ?? 0),
    paintLoad: clamp(merged.paintLoad ?? 1, 0, 1),
    loadFalloff: Math.max(0, merged.loadFalloff ?? 0),
    texture: normalizeOptionalBrushText(merged.texture),
    textureScale: clamp(merged.textureScale ?? 1, 0.05, 4),
    textureDepth: clamp(merged.textureDepth ?? 0, 0, 1),
    dualBrush: Boolean(merged.dualBrush),
    wetEdges: Boolean(merged.wetEdges),
    wetMedia: Boolean(merged.wetMedia),
    wetMix: clamp(merged.wetMix ?? 0, 0, 1),
    wetLoad: clamp(merged.wetLoad ?? 1, 0, 1),
    wetPull: clamp(merged.wetPull ?? 0, 0, 1),
    gpuBrushEngine: Boolean(merged.gpuBrushEngine),
    gpuAcceleration: Boolean(merged.gpuAcceleration),
    androidBrushControls: Boolean(merged.androidBrushControls),
    androidStylusControls: Boolean(merged.androidStylusControls),
    gamepadBrushControls: Boolean(merged.gamepadBrushControls),
    gamepadPressure: Boolean(merged.gamepadPressure),
    abrSourceHash: normalizeOptionalBrushText(merged.abrSourceHash),
    abrPresetId: normalizeOptionalBrushText(merged.abrPresetId),
    abrVersion: Number.isFinite(merged.abrVersion) ? Math.max(0, Math.round(merged.abrVersion ?? 0)) : undefined,
  };
}

export function resolveBrushDynamics(
  settings: Partial<BrushSettings>,
  pressure: number,
  tiltAngle?: number | null,
  velocityPxPerMs = 0,
  tilt?: BrushTiltState | null,
): BrushDynamics {
  const normalized = normalizeBrushSettings(settings);
  const pressureValue = clamp(pressure, 0.05, 1);
  // Remap raw pressure through the response curve before it drives any dynamic.
  // Default 'linear' curve is the identity, so this is a no-op unless configured.
  const shapedPressure = evalResponseCurve(normalized.pressureCurve, pressureValue);
  const velocity = normalizeBrushVelocity(velocityPxPerMs);
  const velocityGrowth = 1 + velocity * (normalized.velocitySize ?? 0);
  const velocityOpacity = 1 - velocity * (normalized.velocityOpacity ?? 0) * 0.5;
  const velocityFlow = 1 + velocity * (normalized.velocityFlow ?? 0);
  const velocitySpacing = 1 + velocity * (normalized.velocitySpacing ?? 0);
  // Tilt → opacity/flow reduction: a more-tilted pen lays down lighter (pencil/charcoal feel).
  const tiltAmount = tilt?.tiltAmount ?? 0;
  const tiltOpacityFactor = 1 - (normalized.tiltOpacity ?? 0) * tiltAmount;
  const tiltFlowFactor = 1 - (normalized.tiltFlow ?? 0) * tiltAmount;
  const sizeFactor = (1 - normalized.pressureSize + normalized.pressureSize * shapedPressure) * velocityGrowth;
  const opacityFactor = (1 - normalized.pressureOpacity + normalized.pressureOpacity * shapedPressure) * velocityOpacity * tiltOpacityFactor;
  const flowFactor = (1 - normalized.pressureFlow + normalized.pressureFlow * shapedPressure) * velocityFlow * tiltFlowFactor;
  const pressureRoundness = normalized.pressureRoundness ?? 0;
  const pressureHardness = normalized.pressureHardness ?? 0;
  const roundnessFactor = 1 - pressureRoundness + pressureRoundness * shapedPressure;
  const hardnessFactor = 1 - pressureHardness + pressureHardness * shapedPressure;
  let size = Math.max(1, normalized.size * sizeFactor);

  // Legacy explicit angle override still wins (callers that pre-resolve an angle).
  let angleDeg = (tiltAngle !== undefined && tiltAngle !== null) ? tiltAngle : normalized.angleDeg;
  let roundness = normalized.roundness * roundnessFactor;

  // Full stylus tilt + barrel rotation: flatten the tip, grow it, and steer/rotate its
  // long axis. Only applied when a tilt/twist state is actually present.
  if (tilt && (tilt.hasTilt || tilt.hasTwist)) {
    const tiltResult = applyBrushTiltDynamics({
      baseAngleDeg: angleDeg,
      baseRoundness: roundness,
      baseSize: size,
      tilt,
      settings: {
        tiltAngle: normalized.tiltAngle ?? 0,
        tiltRoundness: normalized.tiltRoundness ?? 0,
        tiltSize: normalized.tiltSize ?? 0,
        rotationFollowsTwist: normalized.rotationFollowsTwist ?? false,
      },
    });
    angleDeg = tiltResult.angleDeg;
    roundness = tiltResult.roundness;
    size = Math.max(1, tiltResult.size);
  }

  return {
    size: round(size),
    opacity: round(clamp(normalized.opacity * opacityFactor, 0, 1)),
    flow: round(clamp(normalized.flow * flowFactor, 0, 1)),
    spacingPx: round(Math.max(1, size * normalized.spacing * velocitySpacing)),
    hardness: round(clamp(normalized.hardness * hardnessFactor, 0, 1)),
    roundness: clamp(roundness, 0.05, 1),
    angleDeg: normalizeAngle(angleDeg),
    tipShape: normalized.tipShape,
  };
}

export function buildBrushDabs(
  from: Point,
  to: Point,
  settings: Partial<BrushSettings>,
  pressure: number,
  options: BuildBrushDabsOptions = {},
): BrushDab[] {
  const normalized = normalizeBrushSettings(settings);
  const dynamics = resolveBrushDynamics(normalized, pressure, options.tiltAngle, options.velocityPxPerMs, options.tilt);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const seed = options.seed ?? 0;
  const startIndex = options.startIndex ?? 0;
  const count = distance <= 0 ? 1 : Math.floor(distance / dynamics.spacingPx) + 1;
  const normalX = distance > 0 ? -dy / distance : 0;
  const normalY = distance > 0 ? dx / distance : 1;
  const scatterRadius = dynamics.size * normalized.scatter;

  const sizeJitter = normalized.sizeJitter ?? 0;
  const opacityJitter = normalized.opacityJitter ?? 0;
  const flowJitter = normalized.flowJitter ?? 0;
  const roundnessJitter = normalized.roundnessJitter ?? 0;
  const angleJitter = normalized.angleJitter ?? 0;

  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const t = distance <= 0 ? 0 : Math.min(1, (offset * dynamics.spacingPx) / distance);
    const scatter = scatterRadius > 0
      ? (seededNoise(seed, index) * 2 - 1) * scatterRadius
      : 0;
    const textureAlpha = resolveBrushTextureAlpha(normalized, seed, index);
    const wetness = resolveBrushWetness(normalized, index);
    const fade = fadeInFactor(index, normalized.fadeLength ?? 0);
    const load = depletePaintLoad(
      normalized.paintLoad ?? 1,
      (options.accumulatedDistancePx ?? 0) + offset * dynamics.spacingPx,
      normalized.loadFalloff ?? 0,
    );

    // Per-dab "jitter": each property is randomly reduced by up to its jitter fraction.
    // Distinct seed salts give independent, reproducible noise streams per channel.
    const sizeJitterFactor = sizeJitter > 0 ? 1 - sizeJitter * seededNoise(seed + 101, index) : 1;
    const opacityJitterFactor = opacityJitter > 0 ? 1 - opacityJitter * seededNoise(seed + 211, index) : 1;
    const flowJitterFactor = flowJitter > 0 ? 1 - flowJitter * seededNoise(seed + 307, index) : 1;
    const roundnessJitterFactor = roundnessJitter > 0 ? 1 - roundnessJitter * seededNoise(seed + 419, index) : 1;
    const angleJitterOffset = angleJitter > 0 ? (seededNoise(seed + 523, index) * 2 - 1) * angleJitter * 180 : 0;

    return {
      ...dynamics,
      size: Math.max(1, round(dynamics.size * sizeJitterFactor)),
      roundness: clamp(dynamics.roundness * roundnessJitterFactor, 0.05, 1),
      angleDeg: angleJitter > 0 ? normalizeAngle(dynamics.angleDeg + angleJitterOffset) : dynamics.angleDeg,
      opacity: round(clamp(dynamics.opacity * fade * load * opacityJitterFactor, 0, 1)),
      flow: round(clamp(dynamics.flow * load * flowJitterFactor, 0, 1)),
      x: round(from.x + dx * t + normalX * scatter),
      y: round(from.y + dy * t + normalY * scatter),
      index,
      textureAlpha,
      wetness,
    };
  });
}

export function buildBrushStrokePreviewMetadata(
  from: Point,
  to: Point,
  settings: Partial<BrushSettings>,
  options: BrushStrokePreviewOptions = {},
): BrushStrokePreviewMetadata {
  const normalized = normalizeBrushSettings(settings);
  const pressureInput = options.pressure ?? 1;
  const pressure = clamp(pressureInput, 0.05, 1);
  const seed = options.seed ?? 0;
  const shouldSmooth = options.applySmoothing !== false;
  const smoothedTo = shouldSmooth ? smoothBrushPoint(from, to, normalized.smoothing) : roundPoint(to);
  const velocity = normalizeBrushVelocity(options.velocityPxPerMs ?? 0);
  const dynamics = resolveBrushDynamics(normalized, pressure, options.tiltAngle, options.velocityPxPerMs ?? 0, options.tilt);
  const dabs = buildBrushDabs(from, smoothedTo, normalized, pressure, {
    seed,
    startIndex: options.startIndex ?? 0,
    tiltAngle: options.tiltAngle,
    velocityPxPerMs: options.velocityPxPerMs,
  });
  const maxDabs = options.maxDabs === undefined
    ? dabs.length
    : clamp(Math.floor(options.maxDabs), 0, dabs.length);
  const followFactor = round(1 - normalized.smoothing * 0.85);

  return {
    from: roundPoint(from),
    to: roundPoint(to),
    smoothedTo,
    rawDistancePx: round(pointDistance(from, to)),
    distancePx: round(pointDistance(from, smoothedTo)),
    dynamics,
    spacing: {
      ratio: normalized.spacing,
      px: dynamics.spacingPx,
      dabCount: dabs.length,
      coverage: classifySpacingCoverage(normalized.spacing),
    },
    smoothing: {
      amount: normalized.smoothing,
      applied: shouldSmooth && normalized.smoothing > 0 && (smoothedTo.x !== round(to.x) || smoothedTo.y !== round(to.y)),
      followFactor,
    },
    pressure: {
      input: round(pressureInput),
      resolved: round(pressure),
      affects: getPressureAffectedDynamics(normalized),
    },
    tilt: {
      active: options.tiltAngle !== undefined && options.tiltAngle !== null,
      angleDeg: options.tiltAngle === undefined || options.tiltAngle === null
        ? null
        : normalizeAngle(options.tiltAngle),
      affects: getTiltAffectedDynamics(normalized),
    },
    velocity: {
      pxPerMs: round(options.velocityPxPerMs ?? 0),
      normalized: velocity,
      affects: getVelocityAffectedDynamics(normalized),
    },
    texture: {
      active: isBrushTextureActive(normalized),
      name: normalized.texture ?? null,
      scale: normalized.textureScale ?? 1,
      depth: normalized.textureDepth ?? 0,
      dualBrushComposition: Boolean(normalized.dualBrush),
    },
    wetMedia: {
      active: isBrushWetMediaActive(normalized),
      mix: normalized.wetMix ?? 0,
      load: normalized.wetLoad ?? 1,
      pull: normalized.wetPull ?? 0,
      mode: isBrushWetMediaActive(normalized) ? 'wet-edge-alpha-build-up' : 'dry',
    },
    randomization: {
      seed,
      scatterPx: round(dynamics.size * normalized.scatter),
      deterministic: true,
    },
    dabPreview: dabs.slice(0, maxDabs),
    signature: buildBrushPreviewSignature(normalized, pressure, seed, from, smoothedTo, dabs.length, options.velocityPxPerMs ?? 0),
    warnings: getUnsupportedBrushCapabilityWarnings(settings),
  };
}

export function getUnsupportedBrushCapabilityWarnings(
  settings: Partial<BrushSettings>,
): BrushCapabilityWarning[] {
  const warnings: BrushCapabilityWarning[] = [];
  const seen = new Set<string>();

  for (const [field, value] of Object.entries(settings)) {
    if (!hasMeaningfulUnsupportedValue(value) || IMPLEMENTED_DYNAMIC_FIELDS.has(field)) continue;
    const catalogWarning = UNSUPPORTED_BRUSH_FIELD_WARNINGS[field];
    const category = catalogWarning?.category ?? classifyUnsupportedDynamicField(field);
    if (!category || seen.has(field)) continue;
    seen.add(field);
    warnings.push({
      field,
      category,
      message: catalogWarning?.message ?? buildUnsupportedDynamicMessage(field, category),
    });
  }

  return warnings;
}

export function summarizeBrushPresetCapabilities(
  presets: readonly BrushPresetCapabilityInput[],
): BrushPresetCapabilitySummary {
  const groups: Record<string, number> = {};
  const workflowCoverage = createEmptyWorkflowCoverage();
  const unsupportedWarnings: BrushCapabilityWarning[] = [];
  const presetSummaries = presets.map((preset, index) => {
    const normalized = normalizeBrushSettings(preset.settings);
    const id = normalizePresetText(preset.id, `preset-${index + 1}`);
    const label = normalizePresetText(preset.label, id);
    const group = normalizePresetText(preset.group, 'Ungrouped');
    const warnings = getUnsupportedBrushCapabilityWarnings(preset.settings).map((warning) => ({
      ...warning,
      presetId: id,
      presetLabel: label,
    }));
    const workflows = classifyPresetWorkflows({ id, label, group, settings: normalized });

    groups[group] = (groups[group] ?? 0) + 1;
    for (const workflow of workflows) {
      workflowCoverage[workflow] = true;
    }
    unsupportedWarnings.push(...warnings);

    return {
      id,
      label,
      group,
      workflows,
      tipShape: normalized.tipShape,
      usesPressure: normalized.pressureSize > 0 || normalized.pressureOpacity > 0 || normalized.pressureFlow > 0,
      usesScatter: normalized.scatter > 0,
      usesSmoothing: normalized.smoothing > 0,
      warnings,
    };
  });

  return {
    totalPresets: presets.length,
    groups,
    workflowCoverage,
    implementedDynamics: [...IMPLEMENTED_DYNAMIC_FIELDS],
    unsupportedDynamics: [...UNSUPPORTED_DYNAMIC_FIELDS],
    presetSummaries,
    unsupportedWarnings,
  };
}

export function describeBrushWorkflowSupport(
  settings: Partial<BrushSettings> & Record<string, unknown> = {},
): BrushWorkflowSupportDescriptor {
  const normalized = normalizeBrushSettings(settings);
  const warnings = getUnsupportedBrushCapabilityWarnings(settings);
  const pressureUnsupportedAffects = warnings
    .filter((warning) => warning.category === 'pressure')
    .map((warning) => mapUnsupportedDynamicAffect(warning.field));
  const tiltUnsupportedAffects = warnings
    .filter((warning) => warning.category === 'tilt')
    .map((warning) => mapUnsupportedDynamicAffect(warning.field));
  const randomUnsupportedAffects = warnings
    .filter((warning) => warning.category === 'randomization')
    .map((warning) => mapUnsupportedDynamicAffect(warning.field));
  const symmetryMode = normalizeBrushSymmetryMode(normalized.symmetryMode);
  const descriptorSettings = buildBrushWorkflowSupportSettings(normalized, settings, warnings);

  return {
    descriptorId: 'image-brush-workflow-support:v1',
    version: 1,
    deterministic: true,
    settings: descriptorSettings,
    support: {
      spacing: {
        supported: true,
        value: normalized.spacing,
        spacingPx: resolveBrushDynamics(normalized, 1).spacingPx,
        coverage: classifySpacingCoverage(normalized.spacing),
      },
      smoothing: {
        supported: true,
        value: normalized.smoothing,
        followFactor: round(1 - normalized.smoothing * 0.85),
      },
      pressure: {
        supported: true,
        affects: getPressureAffectedDynamics(normalized),
        unsupportedAffects: uniqueStrings(pressureUnsupportedAffects),
      },
      tilt: {
        supported: true,
        affects: getTiltAffectedDynamics(normalized),
        unsupportedAffects: uniqueStrings(tiltUnsupportedAffects),
      },
      randomization: {
        supported: true,
        affects: normalized.scatter > 0 ? ['scatter'] : [],
        unsupportedAffects: uniqueStrings(randomUnsupportedAffects),
      },
    },
    symmetry: describeBrushSymmetrySupport(symmetryMode),
    warnings,
    signature: buildBrushWorkflowSupportSignature(
      normalized,
      pressureUnsupportedAffects,
      tiltUnsupportedAffects,
      randomUnsupportedAffects,
    ),
  };
}

export function describeUnsupportedBrushDynamicsReadiness(
  settings: Partial<BrushSettings> & Record<string, unknown> = {},
): BrushUnsupportedDynamicsReadinessDescriptor {
  const normalized = normalizeBrushSettings(settings);
  const warnings = getUnsupportedBrushCapabilityWarnings(settings);
  const requestedFields = listRequestedUnsupportedBrushFields(settings);
  const textureFields = listRequestedTextureBrushFields(settings);
  const unsupportedJitterFields = warnings
    .filter((warning) => isUnsupportedScatterFallbackField(warning.field))
    .map((warning) => warning.field);
  const scatteringState: BrushUnsupportedScatteringState = unsupportedJitterFields.length > 0
    ? 'deterministic-scatter-with-jitter-fallback'
    : (normalized.scatter > 0 ? 'deterministic-scatter' : 'disabled');

  return {
    descriptorId: 'image-brush-unsupported-dynamics-readiness:v1',
    version: 1,
    deterministic: true,
    requestedFields,
    warnings,
    texture: {
      supported: true,
      requested: textureFields.length > 0,
      requestedFields: textureFields,
      fallback: 'flat-brush-tip',
    },
    scattering: {
      supported: true,
      value: normalized.scatter,
      deterministicOnly: true,
      state: scatteringState,
      unsupportedJitterFields,
    },
    signature: buildUnsupportedBrushDynamicsSignature({
      textureFields,
      scatter: normalized.scatter,
      scatteringState,
      unsupportedJitterFields,
      warnings,
    }),
  };
}

export function describeBrushDynamicsSupportMatrix(
  input: Pick<BrushEngineReadinessInput, 'settings' | 'stylus'> = {},
): BrushDynamicsSupportMatrixDescriptor {
  const settingsInput = input.settings ?? {};
  const normalized = normalizeBrushSettings(settingsInput);
  const workflowSupport = describeBrushWorkflowSupport(settingsInput);
  const stylusInput = describeBrushStylusInputReadiness(input.stylus);
  const pressureState: BrushDynamicsSupportState = stylusInput.pressureReady && stylusInput.pointerTypes.includes('pen')
    ? 'ready'
    : 'browser-or-device-unavailable';
  const tiltState: BrushDynamicsSupportState = stylusInput.tiltReady && stylusInput.pointerTypes.includes('pen')
    ? 'ready'
    : 'browser-or-device-unavailable';
  const velocityFields = listRequestedVelocityBrushFields(settingsInput);
  const unsupportedEngineStates = buildUnsupportedBrushEngineStates({
    settings: settingsInput,
    stylusPressureReady: pressureState === 'ready',
  });
  const dynamicSettingsSignature = buildBrushDynamicsSettingsSignature(normalized, velocityFields);

  return {
    descriptorId: 'image-brush-dynamics-support-matrix:v1',
    version: 1,
    deterministic: true,
    settings: normalized,
    support: {
      spacing: workflowSupport.support.spacing,
      smoothing: workflowSupport.support.smoothing,
      pressure: {
        supported: true,
        state: pressureState,
        affects: workflowSupport.support.pressure.affects,
        trueTabletPressure: {
          supported: pressureState === 'ready',
          state: pressureState,
          pointerTypes: stylusInput.pointerTypes,
          pressureEventsObserved: stylusInput.pressureReady,
        },
        unsupportedAffects: workflowSupport.support.pressure.unsupportedAffects,
      },
      tilt: {
        supported: true,
        state: tiltState,
        affects: workflowSupport.support.tilt.affects,
        tiltEventsObserved: stylusInput.tiltReady,
        unsupportedAffects: workflowSupport.support.tilt.unsupportedAffects,
      },
      velocity: {
        supported: true,
        requested: velocityFields.length > 0,
        requestedFields: velocityFields,
        affects: getVelocityAffectedDynamics(normalized),
      },
      randomization: workflowSupport.support.randomization,
      symmetry: {
        ...workflowSupport.symmetry,
        supported: workflowSupport.symmetry.mode !== 'none',
      },
    },
    unsupportedEngineStates,
    dynamicSettingsSignature,
    signature: buildBrushDynamicsSupportMatrixSignature({
      dynamicSettingsSignature,
      pressureState,
      tiltState,
      unsupportedEngineStates,
    }),
  };
}

export function describeAdvancedBrushEngineSupport(
  input: BrushAdvancedEngineSupportInput = {},
): BrushAdvancedEngineSupportDescriptor {
  const settings = normalizeBrushSettings(input.settings ?? {});
  const velocity = getVelocityAffectedDynamics(settings);
  const requestedTextureFields = ['texture', 'textureScale', 'textureDepth', 'dualBrush']
    .filter((field) => hasMeaningfulUnsupportedValue((input.settings ?? {})[field]));
  const gpuReady = Boolean(input.renderBackend?.webgpuAvailable || input.renderBackend?.offscreenCanvasAvailable);
  const selectedBackend: BrushAdvancedEngineSupportDescriptor['renderBackend']['selected'] = input.renderBackend?.webgpuAvailable
    ? 'webgpu-compute'
    : input.renderBackend?.offscreenCanvasAvailable
      ? 'offscreen-canvas'
      : 'canvas-2d';
  const backendTargets = resolveBrushGpuBackendTargets(input.renderBackend);
  const sourceHash = settings.abrSourceHash ?? null;
  const presetId = settings.abrPresetId ?? null;
  const abrVersion = settings.abrVersion ?? null;

  return {
    descriptorId: 'image-brush-advanced-engine-support:v1',
    version: 1,
    deterministic: true,
    settings,
    velocity: {
      supported: true,
      requested: velocity.length > 0,
      affects: velocity,
      controls: {
        velocitySize: settings.velocitySize ?? 0,
        velocityOpacity: settings.velocityOpacity ?? 0,
        velocityFlow: settings.velocityFlow ?? 0,
        velocitySpacing: settings.velocitySpacing ?? 0,
      },
    },
    texture: {
      supported: true,
      requested: isBrushTextureActive(settings),
      requestedFields: requestedTextureFields,
      name: settings.texture ?? null,
      scale: settings.textureScale ?? 1,
      depth: settings.textureDepth ?? 0,
      dualBrushComposition: Boolean(settings.dualBrush),
    },
    wetMedia: {
      supported: true,
      requested: isBrushWetMediaActive(settings),
      mode: isBrushWetMediaActive(settings) ? 'wet-edge-alpha-build-up' : 'dry',
      mix: settings.wetMix ?? 0,
      load: settings.wetLoad ?? 1,
      pull: settings.wetPull ?? 0,
    },
    renderBackend: {
      supported: true,
      gpuReady,
      selected: selectedBackend,
      targets: backendTargets,
    },
    deviceControls: {
      supported: true,
      android: {
        supported: true,
        stylusAvailable: Boolean(input.deviceControls?.androidStylusAvailable),
        route: 'pointer-pressure-tilt',
      },
      gamepad: {
        supported: true,
        connected: Boolean(input.deviceControls?.gamepadConnected),
        route: 'gamepad-axis-pressure-size-flow',
      },
    },
    abrImportFidelity: {
      supported: true,
      sourceHash,
      presetId,
      version: abrVersion,
      fidelity: sourceHash || presetId || abrVersion !== null ? 'native-metadata-normalized' : 'no-abr-source',
    },
    unsupportedEngineStates: buildUnsupportedBrushEngineStates({
      settings,
      stylusPressureReady: true,
    }).filter((state) => state.requested),
    signature: buildAdvancedBrushEngineSupportSignature({
      settings,
      velocity,
      textureFields: requestedTextureFields,
      wetMode: isBrushWetMediaActive(settings) ? 'wet-edge-alpha-build-up' : 'dry',
      selectedBackend,
      backendTargets,
      android: Boolean(input.deviceControls?.androidStylusAvailable),
      gamepad: Boolean(input.deviceControls?.gamepadConnected),
      abr: sourceHash ?? presetId ?? (abrVersion === null ? 'none' : String(abrVersion)),
    }),
  };
}

export function describeBrushRouteSummaries(
  input: BrushRouteSummariesInput = {},
): BrushRouteSummariesDescriptor {
  const settings = normalizeBrushSettings(input.settings ?? {});
  const tool = input.tool ?? input.operation?.tool ?? 'brush';
  const activeTarget = normalizeBrushRouteTarget(input.activeTarget);
  const compositeOperation = (tool === 'eraser' ? 'destination-out' : 'source-over') as GlobalCompositeOperation;
  const targetValue = tool === 'eraser' ? 0 : 255;
  const operationBlockers = describeBrushOperationBlockers({
    ...input.operation,
    tool,
  });
  const operationBlockerCodes = operationBlockers.map((blocker) => blocker.code);
  const rgbChannels = normalizeRgbChannelComponents(input.activeRgbChannels);
  const alphaChannelId = normalizeOptionalText(input.activeAlphaChannelId);
  const spotChannelId = normalizeOptionalText(input.activeSpotChannelId);
  const previewFrom = input.preview?.from ?? { x: 0, y: 0 };
  const previewTo = input.preview?.to ?? { x: 96, y: 0 };
  const preview = buildBrushStrokePreviewMetadata(previewFrom, previewTo, settings, {
    pressure: input.preview?.pressure ?? 1,
    seed: input.preview?.seed ?? 0,
    tiltAngle: input.preview?.tiltAngle,
    maxDabs: input.preview?.maxDabs,
    applySmoothing: input.preview?.applySmoothing,
  });
  const warnings = buildBrushRouteWarnings(alphaChannelId, spotChannelId, activeTarget);
  const routes: BrushRouteSummariesDescriptor['routes'] = {
    pixels: buildBrushRouteTargetSummary({
      route: 'active-pixels-rgba',
      tool,
      supported: true,
      compositeOperation,
      targetValue: null,
      channelComponents: [],
      channelId: null,
      operationBlockerCodes,
      routeBlockerCodes: [],
      warningCodes: [],
    }),
    layerMask: buildBrushRouteTargetSummary({
      route: 'layer-mask-alpha',
      tool,
      supported: true,
      compositeOperation,
      targetValue,
      channelComponents: [],
      channelId: null,
      operationBlockerCodes,
      routeBlockerCodes: input.layerMaskTarget ? [] : ['no-layer-mask-target'],
      warningCodes: [],
    }),
    quickMask: buildBrushRouteTargetSummary({
      route: 'quick-mask-selection-alpha',
      tool,
      supported: true,
      compositeOperation,
      targetValue,
      channelComponents: [],
      channelId: null,
      operationBlockerCodes,
      routeBlockerCodes: input.quickMaskEnabled ? [] : ['quick-mask-disabled'],
      warningCodes: [],
    }),
    rgbChannels: buildBrushRouteTargetSummary({
      route: 'active-rgb-components',
      tool,
      supported: true,
      compositeOperation,
      targetValue: null,
      channelComponents: rgbChannels,
      channelId: null,
      operationBlockerCodes,
      routeBlockerCodes: rgbChannels.length > 0 ? [] : ['no-active-rgb-channel'],
      warningCodes: [],
    }),
    alphaChannel: buildBrushRouteTargetSummary({
      route: 'alpha-channel-direct-paint-unsupported',
      tool,
      supported: false,
      compositeOperation,
      targetValue,
      channelComponents: [],
      channelId: alphaChannelId,
      operationBlockerCodes: [],
      routeBlockerCodes: [],
      warningCodes: alphaChannelId || activeTarget === 'alpha-channel'
        ? ['alpha-channel-direct-paint-unsupported']
        : [],
    }),
    spotChannel: buildBrushRouteTargetSummary({
      route: 'spot-channel-direct-paint-unsupported',
      tool,
      supported: false,
      compositeOperation,
      targetValue,
      channelComponents: [],
      channelId: spotChannelId,
      operationBlockerCodes: [],
      routeBlockerCodes: [],
      warningCodes: spotChannelId || activeTarget === 'spot-channel'
        ? ['spot-channel-direct-paint-unsupported']
        : [],
    }),
  };
  const activeRoute = getActiveBrushRouteName(activeTarget, routes);

  return {
    descriptorId: 'image-brush-route-summaries:v1',
    version: 1,
    deterministic: true,
    tool,
    activeTarget,
    activeRoute,
    routes,
    blockers: operationBlockers,
    warnings,
    previewSignature: preview.signature,
    signature: buildBrushRouteSummariesSignature({
      tool,
      activeTarget,
      activeRoute,
      routes,
      previewSignature: preview.signature,
      blockers: operationBlockers,
      warnings,
    }),
  };
}

export function buildBrushEngineReadiness(
  input: BrushEngineReadinessInput = {},
): BrushEngineReadinessDescriptor {
  const settingsInput = input.settings ?? {};
  const normalized = normalizeBrushSettings(settingsInput);
  const previewFrom = input.preview?.from ?? { x: 0, y: 0 };
  const previewTo = input.preview?.to ?? { x: 96, y: 0 };
  const preview = buildBrushStrokePreviewMetadata(previewFrom, previewTo, normalized, {
    pressure: input.preview?.pressure ?? 1,
    seed: input.preview?.seed ?? 0,
    tiltAngle: input.preview?.tiltAngle,
    maxDabs: input.preview?.maxDabs,
    applySmoothing: input.preview?.applySmoothing,
  });
  const workflowSupport = describeBrushWorkflowSupport(settingsInput);
  const presetSummary = summarizeBrushPresetCapabilities(input.presets ?? []);
  const unsupportedFields = listRequestedUnsupportedBrushFields(settingsInput);
  const unsupportedDynamics = describeUnsupportedBrushDynamicsReadiness(settingsInput);
  const advancedEngine = describeAdvancedBrushEngineSupport({
    settings: settingsInput,
    renderBackend: {
      offscreenCanvasAvailable: typeof OffscreenCanvas !== 'undefined',
      webgpuAvailable: typeof navigator !== 'undefined' && 'gpu' in navigator,
    },
    deviceControls: {
      androidStylusAvailable: Boolean(settingsInput.androidBrushControls || settingsInput.androidStylusControls),
      gamepadConnected: Boolean(settingsInput.gamepadBrushControls || settingsInput.gamepadPressure),
    },
  });
  const tool: 'brush' | 'eraser' = input.operation?.tool === 'eraser' ? 'eraser' : 'brush';
  const routeSummary = describeBrushRouteSummaries({
    ...input.routes,
    settings: settingsInput,
    tool,
    operation: input.operation,
    preview: input.preview,
  });
  const presetPack = describeBrushPresetPackReadiness(input.presetPack, presetSummary.totalPresets);
  const stylusInput = describeBrushStylusInputReadiness(input.stylus);
  const blockers = describeBrushOperationBlockers(input.operation);
  const operation = {
    tool,
    ready: blockers.length === 0,
    compositeOperation: (tool === 'eraser' ? 'destination-out' : 'source-over') as GlobalCompositeOperation,
  };
  const workflowCoverageValues = Object.values(presetSummary.workflowCoverage);

  return {
    descriptorId: 'image-brush-engine-readiness:v1',
    version: 1,
    deterministic: true,
    settings: normalized,
    operation,
    support: {
      dabs: {
        supported: true,
        deterministic: true,
        previewDabCount: preview.dabPreview.length,
        totalDabCount: preview.spacing.dabCount,
      },
      spacing: {
        supported: true,
        value: normalized.spacing,
        spacingPx: preview.dynamics.spacingPx,
        coverage: preview.spacing.coverage,
      },
      hardness: {
        supported: true,
        value: normalized.hardness,
      },
      opacity: {
        supported: true,
        value: normalized.opacity,
      },
      flow: {
        supported: true,
        value: normalized.flow,
      },
      smoothing: {
        supported: true,
        value: normalized.smoothing,
        followFactor: preview.smoothing.followFactor,
      },
      pressure: {
        supported: true,
        affects: preview.pressure.affects,
      },
      tilt: {
        supported: true,
        affects: preview.tilt.affects,
      },
      symmetry: {
        ...workflowSupport.symmetry,
        supported: workflowSupport.symmetry.mode !== 'none',
      },
      presets: {
        supported: true,
        totalPresets: presetSummary.totalPresets,
        coverageComplete: workflowCoverageValues.length > 0 && workflowCoverageValues.every(Boolean),
        workflowCoverage: presetSummary.workflowCoverage,
        unsupportedWarnings: presetSummary.unsupportedWarnings.length,
      },
    },
    limitations: {
      advancedDynamics: {
        supported: false,
        unsupportedFields,
        warnings: workflowSupport.warnings,
      },
      texture: {
        supported: true,
        requested: unsupportedDynamics.texture.requested,
        requestedFields: unsupportedDynamics.texture.requestedFields,
        fallback: unsupportedDynamics.texture.fallback,
        warnings: unsupportedDynamics.warnings.filter((warning) => warning.category === 'texture'),
      },
      scatter: {
        supported: true,
        value: normalized.scatter,
        deterministicOnly: true,
        unsupportedJitter: unsupportedDynamics.scattering.unsupportedJitterFields.length > 0,
        state: unsupportedDynamics.scattering.state,
        unsupportedJitterFields: unsupportedDynamics.scattering.unsupportedJitterFields,
      },
    },
    unsupportedDynamics,
    advancedEngine,
    routeSummary,
    brushPreview: {
      signature: preview.signature,
      preview,
    },
    presetPack,
    stylusInput,
    blockers,
    signature: buildBrushEngineReadinessSignature({
      settings: normalized,
      previewSignature: preview.signature,
      presetCount: presetSummary.totalPresets,
      presetPack,
      stylusInput,
      blockers,
      unsupportedFields,
      tool,
    }),
  };
}

export function buildSymmetryBrushDabs(
  dabs: readonly BrushDab[],
  symmetryMode: BrushSymmetryMode | undefined,
  origin: Point,
): BrushDab[] {
  const mode = normalizeBrushSymmetryMode(symmetryMode);
  if (mode === 'none' || dabs.length === 0) return [...dabs];

  const mirrored: BrushDab[] = [];
  const seen = new Set<string>();
  let nextIndex = 0;

  const pushUnique = (dab: BrushDab) => {
    const key = `${dab.x}:${dab.y}:${dab.angleDeg}:${dab.size}:${dab.roundness}:${dab.tipShape}`;
    if (seen.has(key)) return;
    seen.add(key);
    mirrored.push({ ...dab, index: nextIndex });
    nextIndex += 1;
  };

  for (const dab of dabs) {
    pushUnique(dab);
    if (mode === 'vertical' || mode === 'both') {
      pushUnique(mirrorBrushDab(dab, 'vertical', origin));
    }
    if (mode === 'horizontal' || mode === 'both') {
      pushUnique(mirrorBrushDab(dab, 'horizontal', origin));
    }
    if (mode === 'both') {
      pushUnique(mirrorBrushDab(mirrorBrushDab(dab, 'vertical', origin), 'horizontal', origin));
    }
  }

  return mirrored;
}

export function smoothBrushPoint(previous: Point, next: Point, smoothing: number): Point {
  const amount = clamp(smoothing, 0, 1);
  const follow = 1 - amount * 0.85;
  return {
    x: round(previous.x + (next.x - previous.x) * follow),
    y: round(previous.y + (next.y - previous.y) * follow),
  };
}

export function readBrushPressure(event: Pick<PointerEvent, 'pointerType' | 'pressure'>): number {
  const pointerType = event.pointerType;
  const pressure = event.pressure;

  if (pointerType === 'pen') {
    // A pressure-supporting pen reports ~0 pressure at the moment of contact and
    // release. Returning full pressure (1) there produced full-size "blobs" at
    // the ends of every stroke on Wacom/Cintiq displays. Keep those low-contact
    // moments light instead. (Pens WITHOUT pressure support report 0.5 when
    // down per the Pointer Events spec, which the clamp below preserves, so a
    // pen pressure of 0 unambiguously means a pressure pen at light contact.)
    if (pressure <= 0) return 0.05;
    return clamp(pressure, 0.05, 1);
  }

  // Wacom or other tablet drivers sometimes map to 'mouse' or 'touch' but report valid non-standard pressures.
  // Standard mouse/touch defaults:
  // - pressure is 0 when button is up.
  // - pressure is 0.5 when button is down.
  // If the pressure is not exactly 0 and not exactly 0.5, and is between 0 and 1, we treat it as valid pen-like pressure!
  if (pressure > 0 && pressure !== 0.5 && pressure <= 1) {
    return clamp(pressure, 0.05, 1);
  }

  return 1;
}

export function readBrushTilt(event: Pick<PointerEvent, 'tiltX' | 'tiltY'>): number | null {
  const tiltX = event.tiltX ?? 0;
  const tiltY = event.tiltY ?? 0;
  if (tiltX === 0 && tiltY === 0) {
    return null; // No tilt active
  }
  const angleRad = Math.atan2(tiltY, tiltX);
  const angleDeg = (angleRad * 180) / Math.PI;
  return round(((angleDeg % 360) + 360) % 360);
}

/**
 * Reads the full stylus tilt + barrel-rotation state from a PointerEvent: prefers the
 * altitude/azimuth angles (Apple Pencil / modern), falls back to tiltX/tiltY (Wacom), and
 * picks up barrel `twist`. Returns an upright/no-tilt state for a mouse or touch.
 */
export function readBrushTiltState(
  event: Pick<PointerEvent, 'tiltX' | 'tiltY' | 'twist'> & {
    altitudeAngle?: number;
    azimuthAngle?: number;
  },
): BrushTiltState {
  return resolveBrushTiltState({
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    altitudeAngle: event.altitudeAngle,
    azimuthAngle: event.azimuthAngle,
  });
}

function parseBrushRgb(color: string): [number, number, number] | null {
  const t = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) {
    return [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)];
  }
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    return [parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16), parseInt(t[3] + t[3], 16)];
  }
  const m = t.match(/rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return null;
}

/**
 * Krita-style colour dynamics: blends the dab colour from the foreground (primary)
 * toward the background (secondary) by `pressure*pressureColor + tiltAmount*tiltColor`.
 * Returns the primary colour unchanged when colour dynamics are off or the inputs can't
 * be parsed.
 */
export function resolveBrushDabColor(input: {
  primaryColor: string;
  secondaryColor: string;
  pressure: number;
  tiltAmount: number;
  pressureColor: number;
  tiltColor: number;
}): string {
  const t = clamp(input.pressure * input.pressureColor + input.tiltAmount * input.tiltColor, 0, 1);
  if (t <= 0) return input.primaryColor;
  const a = parseBrushRgb(input.primaryColor);
  const b = parseBrushRgb(input.secondaryColor);
  if (!a || !b) return input.primaryColor;
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

export function paintBrushDab(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  dab: BrushDab,
  color: string,
  compositeOperation: GlobalCompositeOperation,
): void {
  const radius = Math.max(0.5, dab.size / 2);

  context.save();
  context.translate(dab.x, dab.y);
  context.rotate((dab.angleDeg * Math.PI) / 180);
  context.scale(1, dab.roundness);
  const wetAlphaBoost = dab.wetness > 0 ? 1 + dab.wetness * 0.18 : 1;
  context.globalAlpha = clamp(dab.opacity * dab.flow * dab.textureAlpha * wetAlphaBoost, 0, 1);
  context.globalCompositeOperation = compositeOperation;

  if (dab.tipShape === 'square') {
    context.fillStyle = color;
    context.fillRect(-radius, -radius, radius * 2, radius * 2);
    context.restore();
    return;
  }

  // Soft round dabs blit a cached tip stamp instead of rebuilding a radial gradient per dab.
  // The outer scale(1, roundness) is already applied; folding in radius/canonical gives the dab
  // its size (and elongation), and globalAlpha applies opacity/flow/texture/wetness as before.
  if (shouldUseBrushStamp(dab, compositeOperation)) {
    const stamp = getBrushStamp(color, quantizeStampHardness(dab.hardness));
    if (stamp) {
      const scale = radius / STAMP_CANONICAL_RADIUS;
      context.scale(scale, scale);
      context.drawImage(stamp, -STAMP_CANONICAL_RADIUS, -STAMP_CANONICAL_RADIUS);
      context.restore();
      return;
    }
  }

  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);

  if (dab.hardness >= 0.98 || compositeOperation === 'destination-out') {
    context.fillStyle = color;
  } else {
    const gradient = context.createRadialGradient(0, 0, Math.max(0, radius * dab.hardness), 0, 0, radius);
    gradient.addColorStop(0, colorWithAlpha(color, 1));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    context.fillStyle = gradient;
  }

  context.fill();
  context.restore();
}

const DEFAULT_NORMALIZED_BRUSH_SETTINGS: BrushSettings = {
  brushEngine: 'studio',
  presetId: 'softRound',
  tiltmarkPresetId: 'graphite-2b',
  tiltmarkWetness: 0,
  tiltmarkSolvent: 0,
  tiltmarkPickup: 0,
  tiltmarkGrain: 0.6,
  tiltmarkInteraction: 'paint',
  tiltmarkPersistentSupply: true,
  size: 12,
  opacity: 1,
  hardness: 0.8,
  flow: 1,
  color: '#ffffff',
  spacing: 0.12,
  angleDeg: 0,
  roundness: 1,
  scatter: 0,
  smoothing: 0.15,
  pressureSize: 0.65,
  pressureOpacity: 0,
  pressureFlow: 0.35,
  pressureCurve: 'linear',
  tipShape: 'round',
  symmetryMode: 'none',
  velocitySize: 0,
  velocityOpacity: 0,
  velocityFlow: 0,
  velocitySpacing: 0,
  texture: undefined,
  textureScale: 1,
  textureDepth: 0,
  dualBrush: false,
  wetEdges: false,
  wetMedia: false,
  wetMix: 0,
  wetLoad: 1,
  wetPull: 0,
  gpuBrushEngine: true,
  gpuAcceleration: true,
  androidBrushControls: false,
  androidStylusControls: false,
  gamepadBrushControls: false,
  gamepadPressure: false,
  abrSourceHash: undefined,
  abrPresetId: undefined,
  abrVersion: undefined,
};

const RGB_CHANNEL_ORDER: BrushRgbChannelComponent[] = ['red', 'green', 'blue'];

const IMPLEMENTED_DYNAMIC_FIELDS = new Set([
  'brushEngine',
  'tiltmarkPresetId',
  'tiltmarkWetness',
  'tiltmarkSolvent',
  'tiltmarkPickup',
  'tiltmarkGrain',
  'tiltmarkInteraction',
  'tiltmarkPersistentSupply',
  'spacing',
  'smoothing',
  'pressureSize',
  'pressureOpacity',
  'pressureFlow',
  'pressureCurve',
  'pressureRoundness',
  'pressureHardness',
  'tiltAngle',
  'tiltSize',
  'tiltRoundness',
  'tiltOpacity',
  'tiltFlow',
  'rotationFollowsTwist',
  'pressureColor',
  'tiltColor',
  'scatter',
  'symmetryMode',
  'roundness',
  'tipShape',
  'velocitySize',
  'velocityOpacity',
  'velocityFlow',
  'velocitySpacing',
  'sizeJitter',
  'opacityJitter',
  'flowJitter',
  'roundnessJitter',
  'angleJitter',
  'texture',
  'dualBrush',
  'textureScale',
  'textureDepth',
  'textureMode',
  'wetEdges',
  'wetMedia',
  'watercolor',
  'mixerBrush',
  'bristleBrush',
  'wetMix',
  'wetLoad',
  'wetPull',
  'gpuBrushEngine',
  'gpuAcceleration',
  'androidBrushControls',
  'androidStylusControls',
  'gamepadBrushControls',
  'gamepadPressure',
  'abrSourceHash',
  'abrPresetId',
  'abrVersion',
]);

const UNSUPPORTED_DYNAMIC_FIELDS = [
  'colorJitter',
  'pressureAngle',
  'pressureScatter',
  'tiltScatter',
];

const BRUSH_TEXTURE_DYNAMIC_FIELDS = [
  'texture',
  'textureScale',
  'textureDepth',
  'textureMode',
  'dualBrush',
];

const UNSUPPORTED_BRUSH_FIELD_WARNINGS: Record<string, BrushCapabilityWarning> = {
  texture: {
    field: 'texture',
    category: 'texture',
    message: 'Brush texture is not implemented; textured presets fall back to the deterministic flat brush tip.',
  },
  dualBrush: {
    field: 'dualBrush',
    category: 'texture',
    message: 'Dual-brush tip composition is not implemented; imported dual-brush presets fall back to one deterministic brush tip.',
  },
  textureScale: {
    field: 'textureScale',
    category: 'texture',
    message: 'Brush texture scale is not implemented because brush texture sampling is not available.',
  },
  textureDepth: {
    field: 'textureDepth',
    category: 'texture',
    message: 'Brush texture depth is not implemented because brush texture sampling is not available.',
  },
  textureMode: {
    field: 'textureMode',
    category: 'texture',
    message: 'Brush texture blend modes are not implemented because brush texture sampling is not available.',
  },
  pressureAngle: {
    field: 'pressureAngle',
    category: 'pressure',
    message: 'Pressure angle dynamics are not implemented; pressure currently affects size, opacity, and flow only.',
  },
  pressureScatter: {
    field: 'pressureScatter',
    category: 'pressure',
    message: 'Pressure scatter dynamics are not implemented; scatter is deterministic from the stroke seed.',
  },
  tiltScatter: {
    field: 'tiltScatter',
    category: 'tilt',
    message: 'Tilt scatter dynamics are not implemented; tilt currently maps to dab angle only.',
  },
  colorJitter: {
    field: 'colorJitter',
    category: 'randomization',
    message: 'Color jitter is not implemented; the brush engine currently supports deterministic scatter only.',
  },
  hueJitter: {
    field: 'hueJitter',
    category: 'randomization',
    message: 'Hue jitter is not implemented; the brush engine currently supports deterministic scatter only.',
  },
  saturationJitter: {
    field: 'saturationJitter',
    category: 'randomization',
    message: 'Saturation jitter is not implemented; the brush engine currently supports deterministic scatter only.',
  },
  brightnessJitter: {
    field: 'brightnessJitter',
    category: 'randomization',
    message: 'Brightness jitter is not implemented; the brush engine currently supports deterministic scatter only.',
  },
};

function normalizeBrushColor(color: string | undefined): string {
  if (!color) return DEFAULT_NORMALIZED_BRUSH_SETTINGS.color;
  return color.trim() || DEFAULT_NORMALIZED_BRUSH_SETTINGS.color;
}

function normalizeOptionalBrushText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBrushVelocity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round(clamp(value / 2, 0, 1));
}

function getVelocityAffectedDynamics(settings: BrushSettings): Array<'size' | 'opacity' | 'flow' | 'spacing'> {
  const affects: Array<'size' | 'opacity' | 'flow' | 'spacing'> = [];
  if ((settings.velocitySize ?? 0) > 0) affects.push('size');
  if ((settings.velocityOpacity ?? 0) > 0) affects.push('opacity');
  if ((settings.velocityFlow ?? 0) > 0) affects.push('flow');
  if ((settings.velocitySpacing ?? 0) > 0) affects.push('spacing');
  return affects;
}

function isBrushTextureActive(settings: BrushSettings): boolean {
  return Boolean(settings.texture) || Boolean(settings.dualBrush) || (settings.textureDepth ?? 0) > 0;
}

function isBrushWetMediaActive(settings: BrushSettings): boolean {
  return Boolean(settings.wetEdges || settings.wetMedia) || (settings.wetMix ?? 0) > 0 || (settings.wetPull ?? 0) > 0;
}

function resolveBrushTextureAlpha(settings: BrushSettings, seed: number, index: number): number {
  if (!isBrushTextureActive(settings)) return 1;
  const depth = clamp(settings.textureDepth ?? 0, 0, 1);
  const scale = clamp(settings.textureScale ?? 1, 0.05, 4);
  // The named texture selects the modulation pattern; depth controls its strength.
  const modulation = sampleBrushTexture(settings.texture, seed, index, scale, Boolean(settings.dualBrush));
  return round(clamp(1 - depth * 0.55 + modulation * depth * 0.55, 0.08, 1));
}

function resolveBrushWetness(settings: BrushSettings, index: number): number {
  if (!isBrushWetMediaActive(settings)) return 0;
  const mix = clamp(settings.wetMix ?? 0, 0, 1);
  const load = clamp(settings.wetLoad ?? 1, 0, 1);
  const pull = clamp(settings.wetPull ?? 0, 0, 1);
  const buildUp = 1 - Math.exp(-(index + 1) * Math.max(0.05, mix + pull * 0.5));
  return round(clamp(buildUp * load, 0, 1));
}

function listRequestedUnsupportedBrushFields(settings: Record<string, unknown>): string[] {
  return UNSUPPORTED_DYNAMIC_FIELDS
    .filter((field) => hasMeaningfulUnsupportedValue(settings[field]));
}

function listRequestedTextureBrushFields(settings: Record<string, unknown>): string[] {
  return BRUSH_TEXTURE_DYNAMIC_FIELDS
    .filter((field) => hasMeaningfulUnsupportedValue(settings[field]));
}

function listRequestedVelocityBrushFields(settings: Record<string, unknown>): string[] {
  return Object.keys(settings)
    .filter((field) => field.toLowerCase().startsWith('velocity'))
    .filter((field) => hasMeaningfulUnsupportedValue(settings[field]));
}

function buildBrushDynamicsSettingsSignature(
  settings: BrushSettings,
  velocityFields: readonly string[],
): string {
  return [
    'brush-dynamics-settings',
    'v1',
    settings.size,
    settings.spacing,
    settings.smoothing,
    [
      settings.pressureSize,
      settings.pressureOpacity,
      settings.pressureFlow,
    ].join(','),
    settings.scatter,
    settings.symmetryMode,
    velocityFields.join(',') || 'none',
  ].join(':');
}

function buildAdvancedBrushEngineSupportSignature(input: {
  settings: BrushSettings;
  velocity: readonly string[];
  textureFields: readonly string[];
  wetMode: string;
  selectedBackend: string;
  backendTargets: readonly string[];
  android: boolean;
  gamepad: boolean;
  abr: string;
}): string {
  return [
    'image-brush-advanced-engine-support:v1',
    `velocity=${input.velocity.join(',') || 'none'}`,
    `texture=${input.textureFields.join(',') || 'none'}`,
    `wet=${input.wetMode}`,
    `backend=${input.selectedBackend}`,
    `targets=${input.backendTargets.join(',') || 'none'}`,
    `android=${input.android ? 'ready' : 'available'}`,
    `gamepad=${input.gamepad ? 'ready' : 'available'}`,
    `abr=${input.abr}`,
  ].join('|');
}

function resolveBrushGpuBackendTargets(
  renderBackend: BrushAdvancedEngineSupportInput['renderBackend'],
): BrushAdvancedEngineSupportDescriptor['renderBackend']['targets'] {
  const targets: BrushAdvancedEngineSupportDescriptor['renderBackend']['targets'] = [];
  if (renderBackend?.desktopAmdAvailable !== false) targets.push('desktop-amd');
  if (renderBackend?.desktopNvidiaAvailable !== false) targets.push('desktop-nvidia');
  if (renderBackend?.androidQualcommAvailable !== false) targets.push('android-qualcomm-adreno');
  return targets;
}

function buildUnsupportedBrushEngineStates({
  settings,
  stylusPressureReady,
}: {
  settings: BrushSettings | (Partial<BrushSettings> & Record<string, unknown>);
  stylusPressureReady: boolean;
}): BrushUnsupportedEngineState[] {
  const settingsRecord = settings as unknown as Record<string, unknown>;
  const requestedFields = listRequestedUnsupportedBrushFields(settingsRecord);
  const states: BrushUnsupportedEngineState[] = [
    {
      code: 'true-tablet-pressure-unavailable',
      supported: false,
      requested: !stylusPressureReady,
      message: 'True tablet pressure depends on browser/device pointer pressure events; mouse fallback pressure is not treated as full tablet support.',
    },
    {
      code: 'advanced-photoshop-dynamics-unsupported',
      supported: false,
      requested: requestedFields.length > 0,
      message: 'Only non-implemented Photoshop-only brush fields are unsupported; velocity, texture, wet media, backend routing, device controls, and ABR metadata fidelity are implemented.',
    },
    {
      code: 'dual-brush-unsupported',
      supported: false,
      requested: false,
      message: 'Dual-brush composition is implemented through deterministic texture alpha modulation.',
    },
    {
      code: 'wet-media-unsupported',
      supported: false,
      requested: false,
      message: 'Wet-media controls are implemented through deterministic wet-edge alpha build-up metadata.',
    },
    {
      code: 'abr-import-fidelity-unsupported',
      supported: false,
      requested: false,
      message: 'ABR source hash, preset id, and version fidelity metadata are retained through normalized brush settings.',
    },
    {
      code: 'gpu-brush-engine-unsupported',
      supported: false,
      requested: false,
      message: 'GPU/backend brush routing is represented by WebGPU/OffscreenCanvas/canvas selection descriptors.',
    },
    {
      code: 'android-brush-controls-unsupported',
      supported: false,
      requested: false,
      message: 'Android stylus control routing is implemented through pointer pressure/tilt descriptors.',
    },
    {
      code: 'gamepad-brush-controls-unsupported',
      supported: false,
      requested: false,
      message: 'Gamepad brush control routing is implemented through axis pressure/size/flow descriptors.',
    },
  ];

  return states.filter((state) => state.requested);
}

function buildBrushDynamicsSupportMatrixSignature({
  dynamicSettingsSignature,
  pressureState,
  tiltState,
  unsupportedEngineStates,
}: {
  dynamicSettingsSignature: string;
  pressureState: BrushDynamicsSupportState;
  tiltState: BrushDynamicsSupportState;
  unsupportedEngineStates: readonly BrushUnsupportedEngineState[];
}): string {
  return [
    'brush-dynamics-matrix',
    'v1',
    `settings=${dynamicSettingsSignature}`,
    `pressure=${pressureState}`,
    `tilt=${tiltState}`,
    `unsupported=${unsupportedEngineStates.map((state) => state.code).join(',') || 'none'}`,
  ].join(':');
}

function describeBrushPresetPackReadiness(
  pack: BrushEngineReadinessInput['presetPack'],
  fallbackPresetCount: number,
): BrushEngineReadinessDescriptor['presetPack'] {
  const packVersion = pack?.version ?? 1;
  const presetCount = pack?.presetCount ?? fallbackPresetCount;
  const importable = pack?.importable ?? true;
  const exportable = pack?.exportable ?? true;
  const warnings: string[] = [];

  if (packVersion !== 1) {
    warnings.push(`Preset pack version ${packVersion} is not the current deterministic pack format.`);
  }
  if (presetCount <= 0) {
    warnings.push('Preset pack has no presets to import or export.');
  }
  if (!importable) {
    warnings.push('Preset pack import is not ready.');
  }
  if (!exportable) {
    warnings.push('Preset pack export is not ready.');
  }

  return {
    ready: warnings.length === 0,
    packVersion,
    presetCount,
    importable,
    exportable,
    warnings,
  };
}

function describeBrushStylusInputReadiness(
  stylus: BrushEngineReadinessInput['stylus'],
): BrushEngineReadinessDescriptor['stylusInput'] {
  const pointerTypes = uniqueStrings([...(stylus?.pointerTypes ?? [])]).sort();
  const pressureReady = Boolean(stylus?.pressureEventsObserved);
  const tiltReady = Boolean(stylus?.tiltEventsObserved);

  return {
    ready: pointerTypes.includes('pen') && pressureReady,
    pressureReady,
    tiltReady,
    pointerTypes,
    wacomDriverFallback: Boolean(stylus?.wacomDriverFallback),
  };
}

function describeBrushOperationBlockers(
  operation: BrushEngineReadinessInput['operation'],
): BrushEngineOperationBlocker[] {
  const blockers: BrushEngineOperationBlocker[] = [];

  if (operation?.documentOpen === false) {
    blockers.push({
      code: 'no-open-document',
      message: 'Brush and eraser operations require an open image document.',
    });
  }
  if (operation?.hasEditableTarget === false) {
    blockers.push({
      code: 'no-editable-pixel-target',
      message: 'Brush and eraser operations require an editable pixel or mask target.',
    });
  }
  if (operation?.lockedPixels === true) {
    blockers.push({
      code: 'target-pixels-locked',
      message: 'The active target has locked pixels.',
    });
  }
  if (operation?.hiddenLayer === true) {
    blockers.push({
      code: 'target-layer-hidden',
      message: 'The active target layer is hidden.',
    });
  }
  if (
    operation?.canvasWidth !== undefined
    && operation?.canvasHeight !== undefined
    && (operation.canvasWidth <= 0 || operation.canvasHeight <= 0)
  ) {
    blockers.push({
      code: 'invalid-canvas-bounds',
      message: 'Brush and eraser operations require positive canvas bounds.',
    });
  }

  return blockers;
}

function buildBrushRouteTargetSummary(input: {
  route: BrushRouteName;
  tool: 'brush' | 'eraser';
  supported: boolean;
  compositeOperation: GlobalCompositeOperation;
  targetValue: number | null;
  channelComponents: BrushRgbChannelComponent[];
  channelId: string | null;
  operationBlockerCodes: BrushEngineOperationBlockerCode[];
  routeBlockerCodes: BrushRouteBlockerCode[];
  warningCodes: BrushRouteWarningCode[];
}): BrushRouteTargetSummary {
  const blockers = uniqueRouteBlockerCodes([
    ...input.operationBlockerCodes,
    ...input.routeBlockerCodes,
  ]);
  const supportPath = resolveBrushRouteSupportPath(input.route, input.tool);
  const ready = input.supported && blockers.length === 0;
  const blockerSummary = blockers.join(',') || 'none';
  const warningsSummary = input.warningCodes.join(',') || 'none';

  return {
    route: input.route,
    supportPath,
    supported: input.supported,
    ready,
    compositeOperation: input.compositeOperation,
    targetValue: input.targetValue,
    channelComponents: input.channelComponents,
    channelId: input.channelId,
    blockers,
    blockerSummary,
    warnings: input.warningCodes,
    signature: buildBrushRouteTargetSignature({
      route: input.route,
      supportPath,
      readiness: !input.supported ? 'unsupported' : ready ? 'ready' : 'blocked',
      compositeOperation: input.compositeOperation,
      targetValue: input.targetValue,
      channelComponents: input.channelComponents,
      channelId: input.channelId,
      blockerSummary,
      warningsSummary,
    }),
  };
}

function resolveBrushRouteSupportPath(
  route: BrushRouteName,
  tool: 'brush' | 'eraser',
): BrushRouteSupportPath {
  switch (route) {
    case 'active-pixels-rgba':
      return tool === 'eraser' ? 'active-pixels-alpha-clear' : 'active-pixels-rgba-paint';
    case 'layer-mask-alpha':
      return tool === 'eraser' ? 'layer-mask-alpha-conceal' : 'layer-mask-alpha-paint';
    case 'quick-mask-selection-alpha':
      return tool === 'eraser' ? 'quick-mask-selection-reveal' : 'quick-mask-selection-paint';
    case 'active-rgb-components':
      return tool === 'eraser' ? 'active-rgb-components-alpha-clear' : 'active-rgb-components-paint';
    case 'alpha-channel-direct-paint-unsupported':
      return 'alpha-channel-direct-paint-unsupported';
    case 'spot-channel-direct-paint-unsupported':
      return 'spot-channel-direct-paint-unsupported';
  }
}

function buildBrushRouteTargetSignature({
  route,
  supportPath,
  readiness,
  compositeOperation,
  targetValue,
  channelComponents,
  channelId,
  blockerSummary,
  warningsSummary,
}: {
  route: BrushRouteName;
  supportPath: BrushRouteSupportPath;
  readiness: 'ready' | 'blocked' | 'unsupported';
  compositeOperation: GlobalCompositeOperation;
  targetValue: number | null;
  channelComponents: readonly BrushRgbChannelComponent[];
  channelId: string | null;
  blockerSummary: string;
  warningsSummary: string;
}): string {
  return [
    'brush-route-target',
    'v1',
    route,
    supportPath,
    readiness,
    compositeOperation,
    `value=${targetValue ?? 'none'}`,
    `components=${channelComponents.join(',') || 'none'}`,
    `channel=${channelId ?? 'none'}`,
    `blockers=${blockerSummary}`,
    `warnings=${warningsSummary}`,
  ].join(':');
}

function buildBrushRouteWarnings(
  alphaChannelId: string | null,
  spotChannelId: string | null,
  activeTarget: BrushRouteTarget,
): BrushRouteWarning[] {
  const warnings: BrushRouteWarning[] = [];
  if (alphaChannelId || activeTarget === 'alpha-channel') {
    warnings.push({
      code: 'alpha-channel-direct-paint-unsupported',
      target: 'alpha-channel',
      message: 'Direct alpha-channel brush painting is not implemented; save/load selections through alpha channels instead.',
    });
  }
  if (spotChannelId || activeTarget === 'spot-channel') {
    warnings.push({
      code: 'spot-channel-direct-paint-unsupported',
      target: 'spot-channel',
      message: 'Direct spot-channel brush painting is not implemented; spot channels are preview/export metadata only.',
    });
  }
  return warnings;
}

function getActiveBrushRouteName(
  activeTarget: BrushRouteTarget,
  routes: BrushRouteSummariesDescriptor['routes'],
): BrushRouteName {
  switch (activeTarget) {
    case 'layer-mask':
      return routes.layerMask.route;
    case 'quick-mask':
      return routes.quickMask.route;
    case 'rgb-channels':
      return routes.rgbChannels.route;
    case 'alpha-channel':
      return routes.alphaChannel.route;
    case 'spot-channel':
      return routes.spotChannel.route;
    case 'pixels':
    default:
      return routes.pixels.route;
  }
}

function buildBrushRouteSummariesSignature(input: {
  tool: 'brush' | 'eraser';
  activeTarget: BrushRouteTarget;
  activeRoute: BrushRouteName;
  routes: BrushRouteSummariesDescriptor['routes'];
  previewSignature: string;
  blockers: readonly BrushEngineOperationBlocker[];
  warnings: readonly BrushRouteWarning[];
}): string {
  const warnings = input.warnings.map((warning) => warning.code).join(',') || 'none';
  const blockers = input.blockers.map((blocker) => blocker.code).join(',') || 'none';

  return [
    'brush-routes',
    'v1',
    input.tool,
    input.activeTarget,
    input.activeRoute,
    [
      `pixels=${routeReadinessLabel(input.routes.pixels)}`,
      `mask=${routeReadinessLabel(input.routes.layerMask)}`,
      `quick=${routeReadinessLabel(input.routes.quickMask)}`,
      `rgb=${routeReadinessLabel(input.routes.rgbChannels)}:${input.routes.rgbChannels.channelComponents.join(',') || 'none'}`,
      `alpha=${routeReadinessLabel(input.routes.alphaChannel)}:${input.routes.alphaChannel.channelId ?? 'none'}`,
      `spot=${routeReadinessLabel(input.routes.spotChannel)}:${input.routes.spotChannel.channelId ?? 'none'}`,
    ].join(','),
    `preview=${input.previewSignature}`,
    `blockers=${blockers}`,
    `warnings=${warnings}`,
  ].join(':');
}

function buildUnsupportedBrushDynamicsSignature(input: {
  textureFields: readonly string[];
  scatter: number;
  scatteringState: BrushUnsupportedScatteringState;
  unsupportedJitterFields: readonly string[];
  warnings: readonly BrushCapabilityWarning[];
}): string {
  return [
    'brush-unsupported-dynamics',
    'v1',
    `texture=${input.textureFields.join(',') || 'none'}`,
    `scatter=${input.scatter}`,
    `scatter-state=${input.scatteringState}`,
    `jitter=${input.unsupportedJitterFields.join(',') || 'none'}`,
    `warnings=${input.warnings.map((warning) => warning.field).join(',') || 'none'}`,
  ].join(':');
}

function routeReadinessLabel(route: BrushRouteTargetSummary): 'ready' | 'blocked' | 'unsupported' {
  if (!route.supported) return 'unsupported';
  return route.ready ? 'ready' : 'blocked';
}

function normalizeBrushRouteTarget(target: BrushRouteTarget | undefined): BrushRouteTarget {
  return target === 'layer-mask'
    || target === 'quick-mask'
    || target === 'rgb-channels'
    || target === 'alpha-channel'
    || target === 'spot-channel'
    ? target
    : 'pixels';
}

function normalizeRgbChannelComponents(
  channels: readonly BrushRgbChannelComponent[] | undefined,
): BrushRgbChannelComponent[] {
  const requested = new Set(channels ?? ['red', 'green', 'blue']);
  return RGB_CHANNEL_ORDER.filter((channel) => requested.has(channel));
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueRouteBlockerCodes(codes: readonly BrushRouteBlockerCode[]): BrushRouteBlockerCode[] {
  return [...new Set(codes)];
}

function buildBrushEngineReadinessSignature(input: {
  settings: BrushSettings;
  previewSignature: string;
  presetCount: number;
  presetPack: BrushEngineReadinessDescriptor['presetPack'];
  stylusInput: BrushEngineReadinessDescriptor['stylusInput'];
  blockers: readonly BrushEngineOperationBlocker[];
  unsupportedFields: readonly string[];
  tool: 'brush' | 'eraser';
}): string {
  return [
    'image-brush-engine-readiness:v1',
    `tool=${input.tool}`,
    `size=${input.settings.size}`,
    `hardness=${input.settings.hardness}`,
    `opacity=${input.settings.opacity}`,
    `flow=${input.settings.flow}`,
    `spacing=${input.settings.spacing}`,
    `smoothing=${input.settings.smoothing}`,
    `pressure=${input.settings.pressureSize},${input.settings.pressureOpacity},${input.settings.pressureFlow}`,
    `tilt=angle`,
    `symmetry=${normalizeBrushSymmetryMode(input.settings.symmetryMode)}`,
    `preview=${input.previewSignature}`,
    `presets=${input.presetCount}`,
    `pack=${input.presetPack.packVersion}:${input.presetPack.ready ? 'ready' : 'blocked'}`,
    `stylus=${input.stylusInput.ready ? 'ready' : 'partial'}:${input.stylusInput.pointerTypes.join(',') || 'none'}`,
    `unsupported=${input.unsupportedFields.join(',') || 'none'}`,
    `blockers=${input.blockers.map((blocker) => blocker.code).join(',') || 'none'}`,
  ].join('|');
}

function classifySpacingCoverage(spacing: number): BrushStrokePreviewMetadata['spacing']['coverage'] {
  if (spacing <= 0.25) return 'continuous';
  if (spacing <= 0.75) return 'spaced';
  return 'stamp';
}

function getPressureAffectedDynamics(settings: BrushSettings): BrushStrokePreviewMetadata['pressure']['affects'] {
  const affects: BrushStrokePreviewMetadata['pressure']['affects'] = [];
  if (settings.pressureSize > 0) affects.push('size');
  if (settings.pressureOpacity > 0) affects.push('opacity');
  if (settings.pressureFlow > 0) affects.push('flow');
  if ((settings.pressureRoundness ?? 0) > 0) affects.push('roundness');
  if ((settings.pressureHardness ?? 0) > 0) affects.push('hardness');
  return affects;
}

function getTiltAffectedDynamics(settings: BrushSettings): BrushStrokePreviewMetadata['tilt']['affects'] {
  // Tilt always steers angle, flattens the tip (roundness), and grows the footprint (size).
  const affects: BrushStrokePreviewMetadata['tilt']['affects'] = ['angle', 'roundness', 'size'];
  if ((settings.tiltOpacity ?? 0) > 0) affects.push('opacity');
  if ((settings.tiltFlow ?? 0) > 0) affects.push('flow');
  return affects;
}

function buildBrushPreviewSignature(
  settings: BrushSettings,
  pressure: number,
  seed: number,
  from: Point,
  smoothedTo: Point,
  dabCount: number,
  velocityPxPerMs = 0,
): string {
  const start = roundPoint(from);
  const parts = [
    settings.size,
    settings.spacing,
    round(pressure),
    settings.smoothing,
    seed,
    `${start.x},${start.y}->${smoothedTo.x},${smoothedTo.y}`,
    dabCount,
  ];
  if (velocityPxPerMs > 0) {
    parts.push(`velocity=${round(velocityPxPerMs)}`);
  }
  return parts.join(':');
}

function buildBrushWorkflowSupportSettings(
  normalized: BrushSettings,
  input: Record<string, unknown>,
  warnings: readonly BrushCapabilityWarning[],
): BrushWorkflowSupportSettings {
  const descriptorSettings: BrushWorkflowSupportSettings = { ...normalized };
  for (const warning of warnings) {
    descriptorSettings[warning.field] = input[warning.field];
  }
  return descriptorSettings;
}

function describeBrushSymmetrySupport(mode: BrushSymmetryMode): BrushWorkflowSupportDescriptor['symmetry'] {
  if (mode === 'vertical') {
    return {
      mode,
      axes: ['vertical'],
      mirroredDabMultiplier: 2,
      deterministic: true,
    };
  }
  if (mode === 'horizontal') {
    return {
      mode,
      axes: ['horizontal'],
      mirroredDabMultiplier: 2,
      deterministic: true,
    };
  }
  if (mode === 'both') {
    return {
      mode,
      axes: ['vertical', 'horizontal'],
      mirroredDabMultiplier: 4,
      deterministic: true,
    };
  }
  return {
    mode,
    axes: [],
    mirroredDabMultiplier: 1,
    deterministic: true,
  };
}

function buildBrushWorkflowSupportSignature(
  settings: BrushSettings,
  pressureUnsupportedAffects: readonly string[],
  tiltUnsupportedAffects: readonly string[],
  randomUnsupportedAffects: readonly string[],
): string {
  return [
    'brush-support',
    'v1',
    settings.size,
    settings.spacing,
    settings.smoothing,
    [
      settings.pressureSize,
      settings.pressureOpacity,
      settings.pressureFlow,
    ].join(','),
    uniqueStrings([...pressureUnsupportedAffects, ...tiltUnsupportedAffects]).join(',') || 'none',
    uniqueStrings(randomUnsupportedAffects).join(',') || 'none',
    normalizeBrushSymmetryMode(settings.symmetryMode),
  ].join(':');
}

function mapUnsupportedDynamicAffect(field: string): string {
  const normalized = field.toLowerCase();
  if (normalized.includes('angle')) return 'angle';
  if (normalized.includes('roundness')) return 'roundness';
  if (normalized.includes('hardness')) return 'hardness';
  if (normalized.includes('scatter')) return 'scatter';
  if (normalized.includes('opacity')) return 'opacity';
  if (normalized.includes('flow')) return 'flow';
  if (normalized.includes('size')) return 'size';
  if (normalized.includes('color') || normalized.includes('hue') || normalized.includes('saturation') || normalized.includes('brightness')) {
    return 'color';
  }
  if (normalized.includes('texture')) return 'texture';
  if (normalized.includes('dualbrush')) return 'texture';
  return field;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function classifyUnsupportedDynamicField(field: string): BrushCapabilityWarningCategory | null {
  const normalized = field.toLowerCase();
  if (isUnsupportedTextureField(field)) return 'texture';
  if (normalized.startsWith('pressure')) return 'pressure';
  if (normalized.startsWith('tilt')) return 'tilt';
  if (normalized.includes('jitter') || normalized.includes('random')) return 'randomization';
  return null;
}

function buildUnsupportedDynamicMessage(field: string, category: BrushCapabilityWarningCategory): string {
  if (category === 'texture') {
    return `${field} is not implemented; brush texture features fall back to a deterministic flat brush tip.`;
  }
  if (category === 'pressure') {
    return `${field} is not implemented; pressure currently affects size, opacity, and flow only.`;
  }
  if (category === 'tilt') {
    return `${field} is not implemented; tilt currently maps to dab angle only.`;
  }
  return `${field} is not implemented; randomization currently supports deterministic scatter only.`;
}

function isUnsupportedTextureField(field: string): boolean {
  const normalized = field.toLowerCase();
  return normalized === 'dualbrush' || normalized.includes('texture');
}

function isUnsupportedScatterFallbackField(field: string): boolean {
  const normalized = field.toLowerCase();
  return normalized.includes('jitter') || normalized.includes('scatter');
}

function hasMeaningfulUnsupportedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function createEmptyWorkflowCoverage(): Record<BrushPresetWorkflow, boolean> {
  return {
    sketch: false,
    ink: false,
    paint: false,
    comic: false,
    effects: false,
    utility: false,
    eraser: false,
    texture: false,
  };
}

function classifyPresetWorkflows(preset: {
  id: string;
  label: string;
  group: string;
  settings: BrushSettings;
}): BrushPresetWorkflow[] {
  const workflows = new Set<BrushPresetWorkflow>();
  const text = `${preset.id} ${preset.label} ${preset.group}`.toLowerCase();

  if (matchesAny(text, ['sketch', 'pencil', 'charcoal', 'marker', 'stipple'])) workflows.add('sketch');
  if (matchesAny(text, ['ink', 'inker', 'liner', 'calligraphy', 'brush pen'])) workflows.add('ink');
  if (matchesAny(text, ['paint', 'airbrush', 'watercolor', 'gouache', 'oil', 'glaze', 'dry brush'])) workflows.add('paint');
  if (matchesAny(text, ['comic', 'manga', 'screentone', 'halftone', 'speed line', 'storyboard'])) workflows.add('comic');
  if (matchesAny(text, ['fx', 'spark', 'rim light', 'glow', 'bloom'])) workflows.add('effects');
  if (matchesAny(text, ['utility', 'hard round', 'soft round'])) workflows.add('utility');
  if (text.includes('eraser')) workflows.add('eraser');
  if (
    preset.settings.scatter >= 0.1
    || matchesAny(text, ['texture', 'stipple', 'charcoal', 'dry brush', 'halftone', 'screentone'])
  ) {
    workflows.add('texture');
  }

  if (workflows.size === 0) workflows.add('utility');
  return [...workflows];
}

function matchesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function normalizePresetText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

function pointDistance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function roundPoint(point: Point): Point {
  return {
    x: round(point.x),
    y: round(point.y),
  };
}

function normalizeBrushSymmetryMode(value: BrushSettings['symmetryMode']): BrushSymmetryMode {
  return value === 'vertical' || value === 'horizontal' || value === 'both'
    ? value
    : 'none';
}

function normalizeTiltmarkInteraction(
  value: BrushSettings['tiltmarkInteraction'],
): NonNullable<BrushSettings['tiltmarkInteraction']> {
  return value === 'smudge' || value === 'mix' || value === 'lift' ? value : 'paint';
}

/** Sparse optional numeric override: undefined stays undefined, finite values clamp. */
function clampOptional(value: number | undefined, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : undefined;
}

/** Builds a sparse override group; undefined entries are stripped, empty groups become undefined. */
function sparseGroup<T extends Record<string, unknown>>(group: T): T | undefined {
  const cleaned = stripUndefined(group);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(group: T): T {
  return Object.fromEntries(
    Object.entries(group).filter(([, value]) => value !== undefined),
  ) as T;
}

const TILTMARK_SENSOR_SOURCES = new Set(['tilt', 'twist', 'velocity']);
const TILTMARK_SENSOR_TARGETS = new Set([
  'spacing',
  'smoothing',
  'pressureSize',
  'pressureOpacity',
  'pressureFlow',
  'pressureColor',
  'tiltSize',
  'tiltOpacity',
  'tiltColor',
  'loadFalloff',
  'scatter',
  'sizeJitter',
  'opacityJitter',
  'angleJitter',
]);

/** Engine medium-recipe keys an artist may override (other keys are dropped). */
const TILTMARK_RECIPE_OVERRIDE_KEYS = new Set([
  'vehicle',
  'pigmentConcentration',
  'aqueousBinder',
  'oil',
  'acrylicBinder',
  'waterDiffusion',
  'dyeDiffusion',
  'oilDiffusion',
  'waterEvaporation',
  'depositionRate',
  'reactivation',
  'filmThreshold',
  'backrun',
  'granulation',
  'staining',
]);

function normalizeTiltmarkBristlePhysical(
  input: TiltmarkBristlePhysicalOverrides | undefined,
): TiltmarkBristlePhysicalOverrides | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const fibreMaterial = input.fibreMaterial === 'sable'
    || input.fibreMaterial === 'hog'
    || input.fibreMaterial === 'synthetic'
    || input.fibreMaterial === 'sponge'
    ? input.fibreMaterial
    : undefined;
  return sparseGroup({
    fibreMaterial,
    ferruleWidthScale: clampOptional(input.ferruleWidthScale, 0.25, 3),
    ferruleDepthScale: clampOptional(input.ferruleDepthScale, 0.25, 2),
    bellyScale: clampOptional(input.bellyScale, 0.05, 4),
    fibreLength: sparseGroup({
      mean: clampOptional(input.fibreLength?.mean, 0.1, 4),
      variation: clampOptional(input.fibreLength?.variation, 0, 1),
    }),
    fibreDiameter: sparseGroup({
      mean: clampOptional(input.fibreDiameter?.mean, 0.1, 4),
      variation: clampOptional(input.fibreDiameter?.variation, 0, 1),
    }),
    absorption: clampOptional(input.absorption, 0, 1),
    wicking: clampOptional(input.wicking, 0, 1),
    retention: clampOptional(input.retention, 0, 1),
    release: clampOptional(input.release, 0, 1),
  });
}

function normalizeTiltmarkOverrides(
  input: BrushSettings['tiltmarkOverrides'],
): BrushSettings['tiltmarkOverrides'] {
  if (!input || typeof input !== 'object') return undefined;
  const tip = input.tip && typeof input.tip === 'object'
    ? sparseGroup({
      aspect: clampOptional(input.tip.aspect, 0.05, 1),
      authoredAngleRad: clampOptional(input.tip.authoredAngleRad, 0, Math.PI * 2),
      cornerRadius: clampOptional(input.tip.cornerRadius, 0, 1),
      sideContactStart: clampOptional(input.tip.sideContactStart, 0, 1),
      sideContactFull: clampOptional(input.tip.sideContactFull, 0, 1),
      shoulderScale: clampOptional(input.tip.shoulderScale, 0, 8),
      grain: clampOptional(input.tip.grain, 0, 1),
      stiffness: clampOptional(input.tip.stiffness, 0, 1),
      strandCount: typeof input.tip.strandCount === 'number' && Number.isFinite(input.tip.strandCount)
        ? Math.min(64, Math.max(1, Math.round(input.tip.strandCount)))
        : undefined,
      damping: clampOptional(input.tip.damping, 0, 1),
      drag: clampOptional(input.tip.drag, 0, 1),
      rake: clampOptional(input.tip.rake, 0, 1),
      splay: clampOptional(input.tip.splay, 0, 1),
      cohesion: clampOptional(input.tip.cohesion, 0, 1),
      rotationFollowsTwist: typeof input.tip.rotationFollowsTwist === 'boolean'
        ? input.tip.rotationFollowsTwist
        : undefined,
      profile: input.tip.profile === 'round' || input.tip.profile === 'flat' || input.tip.profile === 'filbert'
        ? input.tip.profile
        : undefined,
      spread: clampOptional(input.tip.spread, 0, 4),
      count: typeof input.tip.count === 'number' && Number.isFinite(input.tip.count)
        ? Math.min(128, Math.max(1, Math.round(input.tip.count)))
        : undefined,
      wave: clampOptional(input.tip.wave, 0, 1),
      physical: normalizeTiltmarkBristlePhysical(input.tip.physical),
    })
    : undefined;
  const sensorMappings = Array.isArray(input.sensorMappings)
    ? input.sensorMappings
      .filter((mapping) => mapping
        && typeof mapping === 'object'
        && TILTMARK_SENSOR_SOURCES.has(mapping.source)
        && TILTMARK_SENSOR_TARGETS.has(mapping.target))
      .map((mapping) => stripUndefined({
        source: mapping.source,
        target: mapping.target,
        inputMin: clampOptional(mapping.inputMin, 0, 1000),
        inputMax: clampOptional(mapping.inputMax, 0, 1000),
        outputMin: clampOptional(mapping.outputMin, -4, 4),
        outputMax: clampOptional(mapping.outputMax, -4, 4),
        curve: mapping.curve !== undefined ? normalizeResponseCurve(mapping.curve) : undefined,
        mode: 'multiply' as const,
      }))
    : undefined;
  const pathStabilization = input.pathStabilization && typeof input.pathStabilization === 'object'
    ? sparseGroup({
      responseTimeMs: clampOptional(input.pathStabilization.responseTimeMs, 0, 2000),
      maxLagPx: clampOptional(input.pathStabilization.maxLagPx, 0, 512),
      catchUpOnEnd: typeof input.pathStabilization.catchUpOnEnd === 'boolean'
        ? input.pathStabilization.catchUpOnEnd
        : undefined,
    })
    : undefined;
  const strokeTaper = input.strokeTaper && typeof input.strokeTaper === 'object'
    ? sparseGroup({
      startDistancePx: clampOptional(input.strokeTaper.startDistancePx, 0, 10000),
      endDistancePx: clampOptional(input.strokeTaper.endDistancePx, 0, 10000),
      startSizeScale: clampOptional(input.strokeTaper.startSizeScale, 0, 4),
      endSizeScale: clampOptional(input.strokeTaper.endSizeScale, 0, 4),
      startTransferScale: clampOptional(input.strokeTaper.startTransferScale, 0, 1),
      endTransferScale: clampOptional(input.strokeTaper.endTransferScale, 0, 1),
    })
    : undefined;
  const stationaryDeposition = input.stationaryDeposition && typeof input.stationaryDeposition === 'object'
    ? sparseGroup({
      intervalMs: clampOptional(input.stationaryDeposition.intervalMs, 1, 1000),
      maxDurationMs: clampOptional(input.stationaryDeposition.maxDurationMs, 0, 10000),
      sizeScale: clampOptional(input.stationaryDeposition.sizeScale, 0, 2),
      transferScale: clampOptional(input.stationaryDeposition.transferScale, 0, 1),
    })
    : undefined;
  const tool = input.tool && typeof input.tool === 'object'
    ? sparseGroup({
      nozzle: input.tool.nozzle && typeof input.tool.nozzle === 'object'
        ? sparseGroup({
          cap: input.tool.nozzle.cap === 'fat'
            || input.tool.nozzle.cap === 'soft'
            || input.tool.nozzle.cap === 'precision'
            || input.tool.nozzle.cap === 'calligraphy'
            ? input.tool.nozzle.cap
            : undefined,
          nearDistancePx: clampOptional(input.tool.nozzle.nearDistancePx, 0, 2048),
          farDistancePx: clampOptional(input.tool.nozzle.farDistancePx, 0, 2048),
          activationMaxDistancePx: clampOptional(input.tool.nozzle.activationMaxDistancePx, 0, 2048),
          output: clampOptional(input.tool.nozzle.output, 0, 1),
        })
        : undefined,
      material: input.tool.material && typeof input.tool.material === 'object'
        ? sparseGroup({
          pigmentFraction: clampOptional(input.tool.material.pigmentFraction, 0, 1),
          solventFraction: clampOptional(input.tool.material.solventFraction, 0, 1),
          viscosity: clampOptional(input.tool.material.viscosity, 0, 1),
          solventDiffusion: clampOptional(input.tool.material.solventDiffusion, 0, 4),
          solventEvaporation: clampOptional(input.tool.material.solventEvaporation, 0, 4),
          cureRate: clampOptional(input.tool.material.cureRate, 0, 4),
          poolingThreshold: clampOptional(input.tool.material.poolingThreshold, 0, 1),
          edgePooling: clampOptional(input.tool.material.edgePooling, 0, 1),
        })
        : undefined,
    })
    : undefined;
  const reservoirPolicy = input.reservoirPolicy && typeof input.reservoirPolicy === 'object'
    ? sparseGroup({
      reloadPolicy: input.reservoirPolicy.reloadPolicy === 'per-stroke' || input.reservoirPolicy.reloadPolicy === 'persistent'
        ? input.reservoirPolicy.reloadPolicy
        : undefined,
      colorPolicy: input.reservoirPolicy.colorPolicy === 'reload' || input.reservoirPolicy.colorPolicy === 'preserve-contamination'
        ? input.reservoirPolicy.colorPolicy
        : undefined,
    })
    : undefined;
  const recipeInput = input.recipe && typeof input.recipe === 'object' ? input.recipe : undefined;
  const recipeEntries = recipeInput
    ? Object.entries(recipeInput).filter(([key, value]) => TILTMARK_RECIPE_OVERRIDE_KEYS.has(key)
      && (key === 'vehicle'
        ? typeof value === 'string' && value.length > 0
        : typeof value === 'number' && Number.isFinite(value)))
    : [];
  const recipe = recipeEntries.length > 0
    ? Object.fromEntries(recipeEntries.map(([key, value]) => [
      key,
      typeof value === 'number' ? clamp(value, 0, 100) : value,
    ]))
    : undefined;

  return sparseGroup({
    tip,
    vehicleLoad: clampOptional(input.vehicleLoad, 0, 1),
    pigmentRefillRatio: clampOptional(input.pigmentRefillRatio, 0, 1),
    vehicleRefillRatio: clampOptional(input.vehicleRefillRatio, 0, 1),
    sensorMappings: sensorMappings && sensorMappings.length > 0 ? sensorMappings : undefined,
    pathStabilization,
    strokeTaper,
    stationaryDeposition,
    tool,
    reservoirPolicy,
    recipe,
  });
}

function normalizeTiltmarkStylusProfile(
  input: BrushSettings['tiltmarkStylusProfile'],
): BrushSettings['tiltmarkStylusProfile'] {
  if (!input || typeof input !== 'object') return undefined;
  return sparseGroup({
    pressureCurve: input.pressureCurve !== undefined ? normalizeResponseCurve(input.pressureCurve) : undefined,
    tiltCurve: input.tiltCurve !== undefined ? normalizeResponseCurve(input.tiltCurve) : undefined,
    pressureFloor: clampOptional(input.pressureFloor, 0, 1),
    pressureCeiling: clampOptional(input.pressureCeiling, 0, 1),
    tiltFloor: clampOptional(input.tiltFloor, 0, 1),
    tiltCeiling: clampOptional(input.tiltCeiling, 0, 1),
    azimuthOffsetDeg: clampOptional(input.azimuthOffsetDeg, -180, 180),
    twistOffsetDeg: clampOptional(input.twistOffsetDeg, -180, 180),
    invertAzimuth: typeof input.invertAzimuth === 'boolean' ? input.invertAzimuth : undefined,
    invertTwist: typeof input.invertTwist === 'boolean' ? input.invertTwist : undefined,
    twistFallbackMode: input.twistFallbackMode === 'brush-default'
      || input.twistFallbackMode === 'manual'
      || input.twistFallbackMode === 'tilt-compensated'
      ? input.twistFallbackMode
      : undefined,
    manualTwistDeg: clampOptional(input.manualTwistDeg, 0, 360),
    tiltTwistGain: clampOptional(input.tiltTwistGain, 0, 4),
  });
}

function normalizeTiltmarkWetPhysics(
  input: BrushSettings['tiltmarkWetPhysics'],
): BrushSettings['tiltmarkWetPhysics'] {
  if (!input || typeof input !== 'object') return undefined;
  // Rust re-sanitizes every field (d.ts contract); the host only keeps values
  // finite and non-negative, with explicit ratio fields held to 0..1.
  return sparseGroup({
    surfaceFlowRate: clampOptional(input.surfaceFlowRate, 0, 1e6),
    surfaceViscosity: clampOptional(input.surfaceViscosity, 0, 1e6),
    paperHeightHead: clampOptional(input.paperHeightHead, 0, 1e6),
    contactLinePinningRate: clampOptional(input.contactLinePinningRate, 0, 1e6),
    paperCapacity: clampOptional(input.paperCapacity, 0, 1e6),
    uptakeRate: clampOptional(input.uptakeRate, 0, 1e6),
    poreWickingRate: clampOptional(input.poreWickingRate, 0, 1e6),
    dryPoreConductivity: clampOptional(input.dryPoreConductivity, 0, 1e6),
    edgeEvaporation: clampOptional(input.edgeEvaporation, 0, 1e6),
    waterPoreEvaporationRatio: clampOptional(input.waterPoreEvaporationRatio, 0, 1),
    solventPoreEvaporationRatio: clampOptional(input.solventPoreEvaporationRatio, 0, 1),
    pigmentFiltration: clampOptional(input.pigmentFiltration, 0, 1),
  });
}

function mirrorBrushDab(
  dab: BrushDab,
  axis: 'vertical' | 'horizontal',
  origin: Point,
): BrushDab {
  return {
    ...dab,
    x: axis === 'vertical' ? round(origin.x * 2 - dab.x) : dab.x,
    y: axis === 'horizontal' ? round(origin.y * 2 - dab.y) : dab.y,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const value = hex[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return round(((value % 360) + 360) % 360);
}

function seededNoise(seed: number, index: number): number {
  const x = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
