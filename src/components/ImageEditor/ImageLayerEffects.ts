import type {
  ImageLayerBlendIf,
  ImageLayer,
  ImageLayerEffect,
  LayerBitmap,
  LayerEffectKind,
} from '../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import { applyLayerFiltersToImageData } from './ImageLayerFilters';
import { applyLayerMaskToImageData } from './ImageLayerMask';
import { tryRenderLayerEffectsGpu } from './ImageLayerEffectsGpu';

export interface RenderedLayerWithEffects {
  bitmap: LayerBitmap;
  offsetX: number;
  offsetY: number;
}

export type PhotoshopLayerEffectKind = LayerEffectKind;

export interface LayerEffectCapability {
  kind: PhotoshopLayerEffectKind;
  label: string;
  supported: boolean;
  presetEligible: boolean;
  renderer: 'canvas' | 'content' | 'unsupported';
  warning?: string;
}

export interface LayerEffectCapabilityGroup {
  id: 'canvas-effects' | 'content-effects' | 'unsupported-photoshop-effects';
  label: string;
  effectKinds: PhotoshopLayerEffectKind[];
  supported: boolean;
}

export interface LayerEffectPresetDescription {
  effectKinds: LayerEffectKind[];
  labels: string[];
  usesGlobalLight: boolean;
  expandsBounds: boolean;
  contentEffectKinds: LayerEffectKind[];
  canvasEffectKinds: LayerEffectKind[];
}

export interface LayerEffectStackInteropOptions {
  unsupportedEffectKinds?: readonly PhotoshopLayerEffectKind[];
  blendIf?: 'absent' | 'present';
  globalLightAngle?: number;
  exportTarget?: 'editable' | 'flattened';
}

export interface LayerEffectGlobalLightDescriptor {
  required: boolean;
  angle: number | null;
  dependentEffectIds: string[];
  participants: LayerEffectGlobalLightParticipant[];
}

export interface LayerEffectGlobalLightParticipant {
  effectId: string;
  kind: Extract<LayerEffectKind, 'dropShadow' | 'innerShadow'>;
  participates: true;
}

export interface LayerEffectUnsupportedStatus {
  kind: PhotoshopLayerEffectKind;
  label: string;
  status: 'unsupported';
  preservation: 'metadata-only';
  warning: string;
}

export interface LayerEffectAdvancedBlendingDescriptor {
  blendIf: 'absent' | 'present';
  supported: boolean;
  warning?: string;
}

export interface LayerEffectUnsupportedBlendIfDescriptor {
  id: 'blend-if';
  label: 'Blend If';
  supported: boolean;
  preservation: 'editable-sloom' | 'not-needed';
  requiresFlatteningForParity: boolean;
  warning?: string;
  signature: string;
}

export interface LayerEffectGlobalLightPortabilityDescriptor {
  id: 'layer-effect-global-light-portability:v1';
  portableWithinSignalLoom: boolean;
  portableAcrossDocuments: boolean;
  portableAsEditablePhotoshopLayerStyle: false;
  usesGlobalLight: boolean;
  angle: number | null;
  participantEffectIds: string[];
  warnings: string[];
  signature: string;
}

export interface LayerEffectPresetPortabilityDescriptor {
  id: 'layer-effect-preset-portability:v1';
  portableWithinSignalLoom: boolean;
  portableAcrossDocuments: boolean;
  portableAsEditablePhotoshopLayerStyle: false;
  usesGlobalLight: boolean;
  unsupportedFeatures: Array<'blend-if' | 'bevelEmboss'>;
  warnings: string[];
  signature: string;
}

export interface LayerEffectFlattenedExportDescriptor {
  target: 'editable' | 'flattened';
  rasterizesEffects: boolean;
  preservesEditableLayerStyles: boolean;
  warning?: string;
}

export interface LayerEffectAlphaOpacityCaveat {
  id: 'effect-opacity' | 'flattened-export-alpha';
  label: string;
  affectedEffectIds: string[];
  caveat: string;
}

export type LayerEffectPerEffectExportCaveatCode =
  | 'effect-flattened-for-export'
  | 'canvas-effect-bounds-expansion'
  | 'content-effect-raster-approximation'
  | 'global-light-metadata-only'
  | 'native-photoshop-layer-style-roundtrip-unavailable';

export interface LayerEffectPerEffectExportCaveat {
  effectId: string;
  kind: LayerEffectKind;
  label: string;
  renderer: LayerEffectCapability['renderer'];
  presetEligible: boolean;
  usesGlobalLight: boolean;
  expandsBounds: boolean;
  flattenedForExport: boolean;
  preservesEditableSignalLoomMetadata: true;
  nativePhotoshopLayerStyleRoundtrip: false;
  caveatCodes: LayerEffectPerEffectExportCaveatCode[];
  caveats: string[];
  signature: string;
}

export interface LayerEffectStackInteropDescriptor {
  previewId: 'image-layer-effects-stack:v2';
  effectKinds: LayerEffectKind[];
  labels: string[];
  globalLight: LayerEffectGlobalLightDescriptor;
  globalLightPortability: LayerEffectGlobalLightPortabilityDescriptor;
  capabilityGroups: LayerEffectCapabilityGroup[];
  unsupportedEffects: LayerEffectUnsupportedStatus[];
  advancedBlending: LayerEffectAdvancedBlendingDescriptor;
  unsupportedBlendIf: LayerEffectUnsupportedBlendIfDescriptor;
  flattenedExport: LayerEffectFlattenedExportDescriptor;
  presetPortability: LayerEffectPresetPortabilityDescriptor;
  alphaOpacityCaveats: LayerEffectAlphaOpacityCaveat[];
  perEffectExportCaveats: LayerEffectPerEffectExportCaveat[];
  knownMathLimitations: string[];
  blendOrderSignature: string;
  previewSignature: string;
  exportSignature: string;
  warnings: string[];
  stackPortability: LayerEffectStackPortabilityDescriptor;
}

export interface LayerEffectStackPortabilityDescriptor {
  portableWithinSignalLoom: boolean;
  portableAcrossSignalLoomDocuments: boolean;
  portableAsEditablePhotoshopLayerStyle: false;
  requiresFlattenedPixelsForExport: boolean;
  warnings: string[];
  signature: string;
}

export interface LayerEffectReadinessSupportedEffect {
  kind: LayerEffectKind;
  label: string;
  renderer: Exclude<LayerEffectCapability['renderer'], 'unsupported'>;
  presetEligible: boolean;
}

export interface LayerEffectUnsupportedReadinessItem {
  supported: boolean;
  preservation: 'metadata-only' | 'not-needed';
  flatteningRequiredForPixels: boolean;
  warning: string;
}

export interface LayerEffectBlendIfReadinessItem {
  supported: boolean;
  preservation: 'editable-sloom' | 'not-needed';
  flatteningRequiredForPixels: boolean;
  warning?: string;
}

export interface LayerEffectReadinessGlobalLight {
  participates: boolean;
  angle: number | null;
  effectIds: string[];
}

export interface LayerEffectReadinessPortability {
  exportTarget: 'editable' | 'flattened';
  portableAsSignalLoomPreset: boolean;
  flattensForPixelExport: boolean;
  preservesEditablePhotoshopLayerStyles: boolean;
  warnings: string[];
}

export type LayerEffectReadinessBlockerCode =
  | 'layer-effect-bevel-emboss-unsupported'
  | 'layer-effect-blend-if-unsupported'
  | 'native-psd-live-effect-fidelity-unsupported'
  | 'smart-object-effect-preservation-unsupported';

export interface LayerEffectReadinessBlocker {
  code: LayerEffectReadinessBlockerCode;
  severity: 'blocker';
  message: string;
}

export type LayerEffectReadinessWarningCode =
  | 'layer-effect-flattened-export-rasterizes-effects'
  | 'layer-effect-opacity-baked-into-render'
  | 'layer-effect-flattened-alpha-controls-not-editable'
  | 'layer-effect-preset-portability-limited';

export interface LayerEffectReadinessWarning {
  code: LayerEffectReadinessWarningCode;
  severity: 'warning';
  message: string;
}

export interface LayerEffectPresetCompatibilityReadiness {
  presetEligibleEffectKinds: LayerEffectKind[];
  unsupportedEffectKinds: PhotoshopLayerEffectKind[];
  compatibleWithSignalLoomPresets: boolean;
  compatibleWithNativePhotoshopLayerStyles: false;
  signature: string;
}

export interface LayerEffectReadinessSignatures {
  stack: string;
  preview: string;
  export: string;
  capabilityCatalog: string;
}

export type LayerEffectUnsupportedStateCapability =
  | 'unsupported-effect'
  | 'blend-if'
  | 'native-psd-live-effect-fidelity'
  | 'smart-object-effect-preservation';

export interface LayerEffectUnsupportedStateDescriptor {
  id: `effect-kind:${PhotoshopLayerEffectKind}` | 'blend-if' | 'native-psd-live-effect-fidelity' | 'smart-object-effect-preservation';
  label: string;
  capability: LayerEffectUnsupportedStateCapability;
  supported: false;
  preservation: 'metadata-only' | 'flattened-pixels-and-signal-loom-metadata';
  requiresFlattenedPixelsForParity: boolean;
  reasonCode: LayerEffectReadinessBlockerCode;
  warning: string;
  signature: string;
}

export interface LayerEffectUnsupportedStateDescriptorOptions {
  unsupportedEffectKinds?: readonly PhotoshopLayerEffectKind[];
  blendIf?: 'absent' | 'present';
  nativePsdLiveEffects?: 'not-required' | 'required';
  smartObjectEffectPreservation?: 'not-required' | 'required';
}

export interface LayerEffectReadinessSummary {
  id: 'image-layer-effects-readiness:v1';
  effectKinds: LayerEffectKind[];
  supportedEffectCatalog: LayerEffectReadinessSupportedEffect[];
  supportedEffects: LayerEffectReadinessSupportedEffect[];
  unsupportedReadiness: {
    bevelEmboss: LayerEffectUnsupportedReadinessItem;
    blendIf: LayerEffectBlendIfReadinessItem;
  };
  globalLight: LayerEffectReadinessGlobalLight;
  globalLightPortability: LayerEffectGlobalLightPortabilityDescriptor;
  blendIfPortability: LayerEffectUnsupportedBlendIfDescriptor;
  portability: LayerEffectReadinessPortability;
  blockers: LayerEffectReadinessBlocker[];
  warnings: LayerEffectReadinessWarning[];
  unsupportedStates: string[];
  unsupportedStateDescriptors: LayerEffectUnsupportedStateDescriptor[];
  mathCaveats: string[];
  perEffectExportCaveats: LayerEffectPerEffectExportCaveat[];
  presetCompatibility: LayerEffectPresetCompatibilityReadiness;
  presetPortability: LayerEffectPresetPortabilityDescriptor;
  signatures: LayerEffectReadinessSignatures;
}

const SUPPORTED_LAYER_EFFECT_CAPABILITIES: readonly LayerEffectCapability[] = [
  { kind: 'stroke', label: 'Stroke', supported: true, presetEligible: true, renderer: 'canvas' },
  { kind: 'bevelEmboss', label: 'Bevel & Emboss', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'dropShadow', label: 'Drop Shadow', supported: true, presetEligible: true, renderer: 'canvas' },
  { kind: 'innerShadow', label: 'Inner Shadow', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'outerGlow', label: 'Outer Glow', supported: true, presetEligible: true, renderer: 'canvas' },
  { kind: 'innerGlow', label: 'Inner Glow', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'colorOverlay', label: 'Color Overlay', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'satin', label: 'Satin', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'patternOverlay', label: 'Pattern Overlay', supported: true, presetEligible: true, renderer: 'content' },
  { kind: 'gradientOverlay', label: 'Gradient Overlay', supported: true, presetEligible: true, renderer: 'content' },
];

const UNSUPPORTED_LAYER_EFFECT_CAPABILITIES: readonly LayerEffectCapability[] = [];

const LAYER_EFFECT_CAPABILITY_CATALOG: readonly LayerEffectCapability[] = [
  ...SUPPORTED_LAYER_EFFECT_CAPABILITIES,
  ...UNSUPPORTED_LAYER_EFFECT_CAPABILITIES,
];

const LAYER_EFFECT_STACK_PREVIEW_ID = 'image-layer-effects-stack:v2' as const;
const LAYER_EFFECT_CAPABILITY_GROUPS: readonly LayerEffectCapabilityGroup[] = [
  {
    id: 'canvas-effects',
    label: 'Canvas-rendered effects',
    effectKinds: ['stroke', 'dropShadow', 'outerGlow'],
    supported: true,
  },
  {
    id: 'content-effects',
    label: 'Content-rendered effects',
    effectKinds: ['bevelEmboss', 'innerShadow', 'innerGlow', 'colorOverlay', 'satin', 'patternOverlay', 'gradientOverlay'],
    supported: true,
  },
];

const GLOBAL_LIGHT_EFFECT_KINDS = new Set<LayerEffectKind>(['dropShadow', 'innerShadow']);
const CONTENT_EFFECT_KINDS = new Set<LayerEffectKind>(['bevelEmboss', 'innerShadow', 'innerGlow', 'colorOverlay', 'satin', 'patternOverlay', 'gradientOverlay']);
const CANVAS_EFFECT_KINDS = new Set<LayerEffectKind>(['stroke', 'dropShadow', 'outerGlow']);
const LAYER_EFFECT_OPACITY_CAVEAT =
  'Layer effect opacity is baked into rendered pixels before the parent layer blend mode is applied; Photoshop fill opacity and advanced blending masks are not modeled.';
const LAYER_EFFECT_FLATTENED_ALPHA_CAVEAT =
  'Flattened exports preserve rendered alpha but do not preserve editable Photoshop layer-style opacity controls.';
const LAYER_EFFECT_MATH_LIMITATIONS = [
  'Stroke, glow, shadow, and bevel use deterministic raster expansion instead of Photoshop contour/noise kernels.',
  'Bevel & Emboss, Inner Shadow, Inner Glow, Satin, Pattern Overlay, Gradient Overlay, and Color Overlay are content-rendered approximations that are flattened before blend-mode compositing.',
  'Blend If supplies this-layer tonal endpoints only; underlying-layer split sliders are intentionally not modeled.',
] as const;

export function createDefaultLayerEffect(kind: LayerEffectKind): ImageLayerEffect {
  const id = `effect-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  switch (kind) {
    case 'stroke':
      return {
        id,
        kind,
        enabled: true,
        color: '#ffffff',
        opacity: 1,
        size: 4,
        position: 'outside',
      };
    case 'bevelEmboss':
      return {
        id,
        kind,
        enabled: true,
        highlightColor: '#ffffff',
        shadowColor: '#000000',
        opacity: 0.7,
        angle: 45,
        size: 6,
      };
    case 'dropShadow':
      return {
        id,
        kind,
        enabled: true,
        color: '#000000',
        opacity: 0.65,
        angle: 45,
        distance: 12,
        size: 12,
      };
    case 'innerShadow':
      return {
        id,
        kind,
        enabled: true,
        color: '#000000',
        opacity: 0.55,
        angle: 45,
        distance: 8,
        size: 10,
      };
    case 'outerGlow':
      return {
        id,
        kind,
        enabled: true,
        color: '#60a5fa',
        opacity: 0.7,
        size: 12,
      };
    case 'innerGlow':
      return {
        id,
        kind,
        enabled: true,
        color: '#60a5fa',
        opacity: 0.65,
        size: 10,
      };
    case 'colorOverlay':
      return {
        id,
        kind,
        enabled: true,
        color: '#ffffff',
        opacity: 1,
      };
    case 'satin':
      return {
        id,
        kind,
        enabled: true,
        color: '#000000',
        opacity: 0.45,
        angle: 19,
        distance: 10,
        size: 12,
        invert: false,
      };
    case 'patternOverlay':
      return {
        id,
        kind,
        enabled: true,
        color: '#ffffff',
        backgroundColor: '#000000',
        opacity: 0.35,
        pattern: 'checker',
        scale: 8,
      };
    case 'gradientOverlay':
      return {
        id,
        kind,
        enabled: true,
        color: '#ffffff',
        secondaryColor: '#000000',
        opacity: 1,
        angle: 0,
        scale: 1,
        reverse: false,
      };
  }
}

export function getLayerEffectCapabilityCatalog(): LayerEffectCapability[] {
  return LAYER_EFFECT_CAPABILITY_CATALOG.map((entry) => ({ ...entry }));
}

export function getUnsupportedLayerEffectWarnings(
  kinds: readonly PhotoshopLayerEffectKind[],
): string[] {
  const warnings: string[] = [];
  const seen = new Set<PhotoshopLayerEffectKind>();
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === kind);
    if (!capability?.warning) continue;
    warnings.push(capability.warning);
  }
  return warnings;
}

export function describeLayerEffectPreset(
  effects: readonly ImageLayerEffect[],
): LayerEffectPresetDescription {
  const enabledEffects = effects.filter((effect) => effect.enabled);
  const effectKinds = enabledEffects.map((effect) => effect.kind);
  return {
    effectKinds,
    labels: effectKinds.map(layerEffectLabel),
    usesGlobalLight: enabledEffects.some((effect) => GLOBAL_LIGHT_EFFECT_KINDS.has(effect.kind)),
    expandsBounds: enabledEffects.some((effect) => isCanvasEffectKind(effect.kind)),
    contentEffectKinds: effectKinds.filter((kind) => CONTENT_EFFECT_KINDS.has(kind)),
    canvasEffectKinds: effectKinds.filter((kind) => CANVAS_EFFECT_KINDS.has(kind)),
  };
}

export function describeLayerEffectStackInterop(
  effects: readonly ImageLayerEffect[],
  options: LayerEffectStackInteropOptions = {},
): LayerEffectStackInteropDescriptor {
  const enabledEffects = effects.filter((effect) => effect.enabled);
  const preset = describeLayerEffectPreset(effects);
  const unsupportedEffectKinds = uniqueEffectKinds(options.unsupportedEffectKinds ?? [])
    .filter(isUnsupportedLayerEffectKind);
  const globalLight = describeLayerEffectGlobalLight(enabledEffects, options.globalLightAngle);
  const blendIf = options.blendIf ?? 'absent';
  const exportTarget = options.exportTarget ?? 'editable';
  const capabilityGroups = getLayerEffectCapabilityGroups();
  const unsupportedEffects = describeUnsupportedLayerEffects(unsupportedEffectKinds);
  const advancedBlending = describeLayerEffectAdvancedBlending(blendIf);
  const unsupportedBlendIf = describeLayerEffectUnsupportedBlendIf(advancedBlending);
  const flattenedExport = describeLayerEffectFlattenedExport(exportTarget);
  const alphaOpacityCaveats = describeLayerEffectAlphaOpacityCaveats(enabledEffects, exportTarget);
  const perEffectExportCaveats = describeLayerEffectPerEffectExportCaveats(enabledEffects, exportTarget, globalLight);
  const knownMathLimitations = [...LAYER_EFFECT_MATH_LIMITATIONS];
  const globalLightPortability = describeLayerEffectGlobalLightPortability(globalLight);
  const presetPortability = describeLayerEffectPresetPortability({
    globalLight,
    unsupportedEffects,
    unsupportedBlendIf,
    flattenedExport,
  });
  const stackPortability = describeLayerEffectStackPortability(flattenedExport, unsupportedEffects, advancedBlending);
  const orderItems = enabledEffects.map((effect, order) => ({
    order,
    kind: effect.kind,
    enabled: effect.enabled,
    renderer: layerEffectRenderer(effect.kind),
  }));
  const previewItems = enabledEffects.map((effect, order) => {
    const item: Record<string, unknown> = {
      order,
      id: effect.id,
      kind: effect.kind,
      enabled: effect.enabled,
      renderer: layerEffectRenderer(effect.kind),
    };
    if (GLOBAL_LIGHT_EFFECT_KINDS.has(effect.kind)) {
      item.globalLight = globalLight.angle;
    }
    return item;
  });
  const exportItems = previewItems.map(({ id: _id, ...item }) => item);

  return {
    previewId: LAYER_EFFECT_STACK_PREVIEW_ID,
    effectKinds: preset.effectKinds,
    labels: preset.labels,
    globalLight,
    globalLightPortability,
    capabilityGroups,
    unsupportedEffects,
    advancedBlending,
    unsupportedBlendIf,
    flattenedExport,
    presetPortability,
    blendOrderSignature: `layer-effect-order:v1:${JSON.stringify(orderItems)}`,
    previewSignature: `layer-effect-preview:v1:${JSON.stringify({
      previewId: LAYER_EFFECT_STACK_PREVIEW_ID,
      effects: previewItems,
      blendIf,
      advancedBlending,
      alphaOpacityCaveats: alphaOpacityCaveats.map((caveat) => caveat.id),
      perEffectExportCaveats: perEffectExportCaveats.map((caveat) => caveat.effectId),
      knownMathLimitations,
    })}`,
    exportSignature: `layer-effect-export:v1:${JSON.stringify({
      previewId: LAYER_EFFECT_STACK_PREVIEW_ID,
      target: exportTarget,
      effects: exportItems,
      unsupported: unsupportedEffectKinds,
      unsupportedEffects,
      blendIf,
      flattenedExport,
      capabilityGroups: capabilityGroups.map((group) => group.id),
      alphaOpacityCaveats,
      perEffectExportCaveats,
      knownMathLimitations,
    })}`,
    alphaOpacityCaveats,
    perEffectExportCaveats,
    knownMathLimitations,
    warnings: [
      ...getLayerEffectRasterizationWarnings(flattenedExport),
      ...unsupportedEffects.map((effect) => effect.warning),
      ...getLayerEffectBlendIfWarnings(advancedBlending),
    ],
    stackPortability,
  };
}

export function buildLayerEffectReadinessSummary(
  effects: readonly ImageLayerEffect[],
  options: LayerEffectStackInteropOptions = {},
): LayerEffectReadinessSummary {
  const enabledEffects = effects.filter((effect) => effect.enabled);
  const interop = describeLayerEffectStackInterop(effects, options);
  const unsupportedEffectKinds = uniqueEffectKinds(options.unsupportedEffectKinds ?? [])
    .filter(isUnsupportedLayerEffectKind);
  const hasBevelEmbossMetadata = unsupportedEffectKinds.includes('bevelEmboss');
  const blendIfPresent = interop.advancedBlending.blendIf === 'present';
  const supportedEffectCatalog = buildLayerEffectSupportedEffectCatalog();
  const supportedEffects = enabledEffects.map((effect) => {
    const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === effect.kind);
    const renderer = layerEffectRenderer(effect.kind);
    return {
      kind: effect.kind,
      label: capability?.label ?? layerEffectLabel(effect.kind),
      renderer: renderer === 'unsupported' ? 'content' : renderer,
      presetEligible: capability?.presetEligible ?? false,
    };
  });
  const portableWarnings = [...interop.warnings];
  const presetEligibleEffectKinds = supportedEffects
    .filter((effect) => effect.presetEligible)
    .map((effect) => effect.kind);
  const blockers = buildLayerEffectReadinessBlockers({
    hasBevelEmbossMetadata,
    blendIfPresent,
  });
  const warnings = buildLayerEffectReadinessWarnings(interop);

  return {
    id: 'image-layer-effects-readiness:v1',
    effectKinds: interop.effectKinds,
    supportedEffectCatalog,
    supportedEffects,
    unsupportedReadiness: {
      bevelEmboss: {
        supported: true,
        preservation: 'not-needed',
        flatteningRequiredForPixels: hasBevelEmbossMetadata,
        warning: hasBevelEmbossMetadata
          ? 'A legacy unsupported Bevel & Emboss import marker was found; the current Sloom Studio effect is rendered as a bounded raster bevel.'
          : '',
      },
      blendIf: {
        supported: true,
        preservation: blendIfPresent ? 'editable-sloom' : 'not-needed',
        flatteningRequiredForPixels: false,
        ...(interop.advancedBlending.warning ? { warning: interop.advancedBlending.warning } : {}),
      },
    },
    globalLight: {
      participates: interop.globalLight.required,
      angle: interop.globalLight.angle,
      effectIds: [...interop.globalLight.dependentEffectIds],
    },
    globalLightPortability: interop.globalLightPortability,
    blendIfPortability: interop.unsupportedBlendIf,
    portability: {
      exportTarget: interop.flattenedExport.target,
      portableAsSignalLoomPreset: portableWarnings.length === 0 && unsupportedEffectKinds.length === 0,
      flattensForPixelExport: interop.flattenedExport.rasterizesEffects,
      preservesEditablePhotoshopLayerStyles: interop.flattenedExport.preservesEditableLayerStyles,
      warnings: portableWarnings,
    },
    blockers,
    warnings,
    unsupportedStates: buildLayerEffectUnsupportedStates({
      hasBevelEmbossMetadata,
      blendIfPresent,
    }),
    unsupportedStateDescriptors: describeLayerEffectUnsupportedStateDescriptors({
      unsupportedEffectKinds,
      blendIf: interop.advancedBlending.blendIf,
    }),
    mathCaveats: [...interop.knownMathLimitations],
    perEffectExportCaveats: interop.perEffectExportCaveats,
    presetCompatibility: {
      presetEligibleEffectKinds,
      unsupportedEffectKinds,
      compatibleWithSignalLoomPresets: portableWarnings.length === 0 && unsupportedEffectKinds.length === 0,
      compatibleWithNativePhotoshopLayerStyles: false,
      signature: buildLayerEffectPresetCompatibilitySignature(
        presetEligibleEffectKinds,
        interop.globalLight.angle,
        unsupportedEffectKinds,
        interop.advancedBlending.blendIf,
      ),
    },
    presetPortability: interop.presetPortability,
    signatures: {
      stack: `layer-effect-readiness-stack:v1:${JSON.stringify({
        effects: enabledEffects.map((effect, order) => ({
          order,
          id: effect.id,
          kind: effect.kind,
          renderer: layerEffectRenderer(effect.kind),
        })),
        globalLight: interop.globalLight,
        unsupportedEffectKinds,
        blendIf: interop.advancedBlending.blendIf,
        exportTarget: interop.flattenedExport.target,
      })}`,
      preview: interop.previewSignature,
      export: interop.exportSignature,
      capabilityCatalog: `layer-effect-capability-catalog:v1:${JSON.stringify(LAYER_EFFECT_CAPABILITY_CATALOG)}`,
    },
  };
}

export function describeLayerEffectUnsupportedStateDescriptors(
  options: LayerEffectUnsupportedStateDescriptorOptions = {},
): LayerEffectUnsupportedStateDescriptor[] {
  const states: LayerEffectUnsupportedStateDescriptor[] = [];
  for (const kind of uniqueEffectKinds(options.unsupportedEffectKinds ?? []).filter(isUnsupportedLayerEffectKind)) {
    const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === kind);
    states.push(buildLayerEffectUnsupportedStateDescriptor({
      id: `effect-kind:${kind}`,
      label: capability?.label ?? kind,
      capability: 'unsupported-effect',
      preservation: 'metadata-only',
      reasonCode: 'layer-effect-bevel-emboss-unsupported',
      warning: capability?.warning ?? 'This Photoshop layer effect is not implemented in Sloom Studio yet.',
    }));
  }
  if (options.nativePsdLiveEffects === 'required') {
    states.push(buildLayerEffectUnsupportedStateDescriptor({
      id: 'native-psd-live-effect-fidelity',
      label: 'Native PSD live effect fidelity',
      capability: 'native-psd-live-effect-fidelity',
      preservation: 'flattened-pixels-and-signal-loom-metadata',
      reasonCode: 'native-psd-live-effect-fidelity-unsupported',
      warning: 'Native PSD live layer-effect fidelity is not supported; Sloom Studio preserves deterministic metadata and flattened pixels for export.',
    }));
  }
  if (options.smartObjectEffectPreservation === 'required') {
    states.push(buildLayerEffectUnsupportedStateDescriptor({
      id: 'smart-object-effect-preservation',
      label: 'Smart Object effect preservation',
      capability: 'smart-object-effect-preservation',
      preservation: 'metadata-only',
      reasonCode: 'smart-object-effect-preservation-unsupported',
      warning: 'Smart Object layer effect preservation is not supported; effects must be represented as Sloom Studio metadata or flattened pixels.',
    }));
  }
  return states;
}

function buildLayerEffectUnsupportedStateDescriptor(input: {
  id: LayerEffectUnsupportedStateDescriptor['id'];
  label: string;
  capability: LayerEffectUnsupportedStateCapability;
  preservation: LayerEffectUnsupportedStateDescriptor['preservation'];
  reasonCode: LayerEffectReadinessBlockerCode;
  warning: string;
}): LayerEffectUnsupportedStateDescriptor {
  return {
    id: input.id,
    label: input.label,
    capability: input.capability,
    supported: false,
    preservation: input.preservation,
    requiresFlattenedPixelsForParity: true,
    reasonCode: input.reasonCode,
    warning: input.warning,
    signature: `layer-effect-unsupported-state:v1:${input.id}:${input.reasonCode}:${input.preservation}`,
  };
}

function buildLayerEffectSupportedEffectCatalog(): LayerEffectReadinessSupportedEffect[] {
  return LAYER_EFFECT_CAPABILITY_CATALOG.flatMap((capability) => {
    if (!capability.supported || capability.renderer === 'unsupported') return [];
    return [{
      kind: capability.kind as LayerEffectKind,
      label: capability.label,
      renderer: capability.renderer,
      presetEligible: capability.presetEligible,
    }];
  });
}

function buildLayerEffectReadinessBlockers(input: {
  hasBevelEmbossMetadata: boolean;
  blendIfPresent: boolean;
}): LayerEffectReadinessBlocker[] {
  const blockers: LayerEffectReadinessBlocker[] = [];
  if (input.hasBevelEmbossMetadata) {
    blockers.push({
      code: 'layer-effect-bevel-emboss-unsupported',
      severity: 'blocker',
      message: 'Bevel & Emboss layer styles are metadata-only in Sloom Studio; flatten before requiring pixel parity.',
    });
  }
  return blockers;
}

function buildLayerEffectReadinessWarnings(
  interop: LayerEffectStackInteropDescriptor,
): LayerEffectReadinessWarning[] {
  const warnings: LayerEffectReadinessWarning[] = [];
  if (interop.flattenedExport.warning) {
    warnings.push({
      code: 'layer-effect-flattened-export-rasterizes-effects',
      severity: 'warning',
      message: interop.flattenedExport.warning,
    });
  }
  for (const caveat of interop.alphaOpacityCaveats) {
    if (caveat.id === 'effect-opacity') {
      warnings.push({
        code: 'layer-effect-opacity-baked-into-render',
        severity: 'warning',
        message: caveat.caveat,
      });
    }
    if (caveat.id === 'flattened-export-alpha') {
      warnings.push({
        code: 'layer-effect-flattened-alpha-controls-not-editable',
        severity: 'warning',
        message: caveat.caveat,
      });
    }
  }
  if (
    interop.unsupportedEffects.length > 0
    || !interop.advancedBlending.supported
    || interop.flattenedExport.rasterizesEffects
  ) {
    warnings.push({
      code: 'layer-effect-preset-portability-limited',
      severity: 'warning',
      message: 'Layer style presets remain portable inside Sloom Studio only for supported effects; native Photoshop-only controls require metadata or flattened pixels.',
    });
  }
  return warnings;
}

function buildLayerEffectUnsupportedStates(input: {
  hasBevelEmbossMetadata: boolean;
  blendIfPresent: boolean;
}): string[] {
  const states: string[] = [];
  if (input.hasBevelEmbossMetadata) states.push('bevelEmboss:metadata-only');
  return states;
}

export function layerEffectLabel(kind: LayerEffectKind): string {
  switch (kind) {
    case 'stroke':
      return 'Stroke';
    case 'bevelEmboss':
      return 'Bevel & Emboss';
    case 'dropShadow':
      return 'Drop Shadow';
    case 'innerShadow':
      return 'Inner Shadow';
    case 'outerGlow':
      return 'Outer Glow';
    case 'innerGlow':
      return 'Inner Glow';
    case 'colorOverlay':
      return 'Color Overlay';
    case 'satin':
      return 'Satin';
    case 'patternOverlay':
      return 'Pattern Overlay';
    case 'gradientOverlay':
      return 'Gradient Overlay';
  }
}

export function synchronizeLayerEffectsGlobalLight(
  effects: readonly ImageLayerEffect[],
  angle: number,
): ImageLayerEffect[] {
  return effects.map((effect) => {
    if (effect.kind !== 'dropShadow' && effect.kind !== 'innerShadow') return effect;
    if (effect.angle === angle) return effect;
    return { ...effect, angle };
  });
}

function describeLayerEffectGlobalLight(
  effects: readonly ImageLayerEffect[],
  requestedAngle: number | undefined,
): LayerEffectGlobalLightDescriptor {
  const dependentEffects = effects.filter(
    (effect): effect is Extract<ImageLayerEffect, { kind: 'dropShadow' | 'innerShadow' }> =>
      effect.kind === 'dropShadow' || effect.kind === 'innerShadow',
  );
  const fallbackAngle = dependentEffects.find(
    (effect): effect is Extract<ImageLayerEffect, { kind: 'dropShadow' | 'innerShadow' }> =>
      effect.kind === 'dropShadow' || effect.kind === 'innerShadow',
  )?.angle;
  const angle = normalizeOptionalAngle(requestedAngle ?? fallbackAngle);
  return {
    required: dependentEffects.length > 0,
    angle,
    dependentEffectIds: dependentEffects.map((effect) => effect.id),
    participants: dependentEffects.map((effect) => ({
      effectId: effect.id,
      kind: effect.kind,
      participates: true,
    })),
  };
}

function normalizeOptionalAngle(angle: number | undefined): number | null {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null;
  return Math.round(angle * 1000) / 1000;
}

function uniqueEffectKinds(kinds: readonly PhotoshopLayerEffectKind[]): PhotoshopLayerEffectKind[] {
  const seen = new Set<PhotoshopLayerEffectKind>();
  const unique: PhotoshopLayerEffectKind[] = [];
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    unique.push(kind);
  }
  return unique;
}

function getLayerEffectCapabilityGroups(): LayerEffectCapabilityGroup[] {
  return LAYER_EFFECT_CAPABILITY_GROUPS.map((group) => ({
    ...group,
    effectKinds: [...group.effectKinds],
  }));
}

function describeUnsupportedLayerEffects(
  kinds: readonly PhotoshopLayerEffectKind[],
): LayerEffectUnsupportedStatus[] {
  return kinds.flatMap((kind) => {
    const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === kind);
    if (!capability?.warning) return [];
    return [{
      kind,
      label: capability.label,
      status: 'unsupported' as const,
      preservation: 'metadata-only' as const,
      warning: capability.warning,
    }];
  });
}

function isUnsupportedLayerEffectKind(kind: PhotoshopLayerEffectKind): boolean {
  const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === kind);
  return Boolean(capability?.warning);
}

function describeLayerEffectFlattenedExport(
  target: 'editable' | 'flattened',
): LayerEffectFlattenedExportDescriptor {
  const warning = target === 'flattened'
    ? 'Layer effects are rasterized into flattened exports; editable Photoshop layer-style roundtrip is not preserved.'
    : undefined;
  return {
    target,
    rasterizesEffects: target === 'flattened',
    preservesEditableLayerStyles: target !== 'flattened',
    ...(warning ? { warning } : {}),
  };
}

function describeLayerEffectAdvancedBlending(
  blendIf: 'absent' | 'present',
): LayerEffectAdvancedBlendingDescriptor {
  return {
    blendIf,
    supported: true,
    ...(blendIf === 'present'
      ? { warning: 'This Layer tonal endpoints are executable; Photoshop Underlying Layer and split-slider controls remain unavailable.' }
      : {}),
  };
}

function describeLayerEffectUnsupportedBlendIf(
  advancedBlending: LayerEffectAdvancedBlendingDescriptor,
): LayerEffectUnsupportedBlendIfDescriptor {
  return {
    id: 'blend-if',
    label: 'Blend If',
    supported: true,
    preservation: advancedBlending.blendIf === 'present' ? 'editable-sloom' : 'not-needed',
    requiresFlatteningForParity: false,
    ...(advancedBlending.warning ? { warning: advancedBlending.warning } : {}),
    signature: `layer-effect-blend-if:v1:${advancedBlending.blendIf}:this-layer-only`,
  };
}

function describeLayerEffectGlobalLightPortability(
  globalLight: LayerEffectGlobalLightDescriptor,
): LayerEffectGlobalLightPortabilityDescriptor {
  return {
    id: 'layer-effect-global-light-portability:v1',
    portableWithinSignalLoom: true,
    portableAcrossDocuments: true,
    portableAsEditablePhotoshopLayerStyle: false,
    usesGlobalLight: globalLight.required,
    angle: globalLight.angle,
    participantEffectIds: [...globalLight.dependentEffectIds],
    warnings: [],
    signature: `layer-effect-global-light:v1:${globalLight.angle ?? 'none'}:${globalLight.dependentEffectIds.join('|') || 'none'}`,
  };
}

function describeLayerEffectPresetPortability(input: {
  globalLight: LayerEffectGlobalLightDescriptor;
  unsupportedEffects: readonly LayerEffectUnsupportedStatus[];
  unsupportedBlendIf: LayerEffectUnsupportedBlendIfDescriptor;
  flattenedExport: LayerEffectFlattenedExportDescriptor;
}): LayerEffectPresetPortabilityDescriptor {
  const unsupportedFeatures: Array<'blend-if' | 'bevelEmboss'> = [];
  if (input.unsupportedEffects.some((effect) => effect.kind === 'bevelEmboss')) {
    unsupportedFeatures.push('bevelEmboss');
  }
  const warnings = [
    ...(input.flattenedExport.warning ? [input.flattenedExport.warning] : []),
    ...input.unsupportedEffects.map((effect) => effect.warning),
  ];
  const portableWithinSignalLoom = warnings.length === 0;
  return {
    id: 'layer-effect-preset-portability:v1',
    portableWithinSignalLoom,
    portableAcrossDocuments: portableWithinSignalLoom,
    portableAsEditablePhotoshopLayerStyle: false,
    usesGlobalLight: input.globalLight.required,
    unsupportedFeatures,
    warnings,
    signature: `layer-effect-preset-portability:v1:${unsupportedFeatures.join('|') || 'none'}:global-light:${input.globalLight.angle ?? 'none'}:${input.globalLight.dependentEffectIds.join('|') || 'none'}`,
  };
}

function describeLayerEffectAlphaOpacityCaveats(
  effects: readonly ImageLayerEffect[],
  exportTarget: 'editable' | 'flattened',
): LayerEffectAlphaOpacityCaveat[] {
  if (effects.length === 0) return [];
  const affectedEffectIds = effects.map((effect) => effect.id);
  const caveats: LayerEffectAlphaOpacityCaveat[] = [{
    id: 'effect-opacity',
    label: 'Layer effect opacity',
    affectedEffectIds,
    caveat: LAYER_EFFECT_OPACITY_CAVEAT,
  }];
  if (exportTarget === 'flattened') {
    caveats.push({
      id: 'flattened-export-alpha',
      label: 'Flattened export alpha',
      affectedEffectIds,
      caveat: LAYER_EFFECT_FLATTENED_ALPHA_CAVEAT,
    });
  }
  return caveats;
}

function describeLayerEffectPerEffectExportCaveats(
  effects: readonly ImageLayerEffect[],
  exportTarget: 'editable' | 'flattened',
  globalLight: LayerEffectGlobalLightDescriptor,
): LayerEffectPerEffectExportCaveat[] {
  return effects.map((effect) => {
    const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === effect.kind);
    const label = capability?.label ?? layerEffectLabel(effect.kind);
    const renderer = layerEffectRenderer(effect.kind);
    const usesGlobalLight = GLOBAL_LIGHT_EFFECT_KINDS.has(effect.kind);
    const expandsBounds = isCanvasEffectKind(effect.kind);
    const flattenedForExport = exportTarget === 'flattened';
    const caveatCodes = describeLayerEffectExportCaveatCodes({
      renderer,
      usesGlobalLight,
      expandsBounds,
      flattenedForExport,
    });

    return {
      effectId: effect.id,
      kind: effect.kind,
      label,
      renderer,
      presetEligible: capability?.presetEligible ?? false,
      usesGlobalLight,
      expandsBounds,
      flattenedForExport,
      preservesEditableSignalLoomMetadata: true,
      nativePhotoshopLayerStyleRoundtrip: false,
      caveatCodes,
      caveats: caveatCodes.map((code) => describeLayerEffectExportCaveatMessage({
        code,
        label,
        globalLightAngle: globalLight.angle,
      })),
      signature: `layer-effect-export-caveat:v1:${JSON.stringify({
        effectId: effect.id,
        kind: effect.kind,
        renderer,
        target: exportTarget,
        globalLight: globalLight.angle,
        caveatCodes,
      })}`,
    };
  });
}

function describeLayerEffectExportCaveatCodes(input: {
  renderer: LayerEffectCapability['renderer'];
  usesGlobalLight: boolean;
  expandsBounds: boolean;
  flattenedForExport: boolean;
}): LayerEffectPerEffectExportCaveatCode[] {
  const caveatCodes: LayerEffectPerEffectExportCaveatCode[] = [];
  if (input.flattenedForExport) caveatCodes.push('effect-flattened-for-export');
  if (input.expandsBounds) caveatCodes.push('canvas-effect-bounds-expansion');
  if (input.renderer === 'content') caveatCodes.push('content-effect-raster-approximation');
  if (input.usesGlobalLight) caveatCodes.push('global-light-metadata-only');
  caveatCodes.push('native-photoshop-layer-style-roundtrip-unavailable');
  return caveatCodes;
}

function describeLayerEffectExportCaveatMessage(input: {
  code: LayerEffectPerEffectExportCaveatCode;
  label: string;
  globalLightAngle: number | null;
}): string {
  switch (input.code) {
    case 'effect-flattened-for-export':
      return `Flattened export bakes ${input.label} into pixels while keeping editable Sloom Studio effect metadata.`;
    case 'canvas-effect-bounds-expansion':
      return `${input.label} can expand raster bounds before export.`;
    case 'content-effect-raster-approximation':
      return `${input.label} is rendered into layer content before blend-mode compositing.`;
    case 'global-light-metadata-only':
      return input.globalLightAngle === null
        ? `${input.label} participates in shared global light metadata when an angle is available.`
        : `${input.label} participates in shared global light metadata at ${input.globalLightAngle} degrees.`;
    case 'native-photoshop-layer-style-roundtrip-unavailable':
      return 'Editable native Photoshop layer-style roundtrip is unavailable; export relies on flattened pixels plus Sloom Studio metadata.';
  }
}

function getLayerEffectRasterizationWarnings(flattenedExport: LayerEffectFlattenedExportDescriptor): string[] {
  return flattenedExport.warning ? [flattenedExport.warning] : [];
}

function describeLayerEffectStackPortability(
  flattenedExport: LayerEffectFlattenedExportDescriptor,
  unsupportedEffects: readonly LayerEffectUnsupportedStatus[],
  advancedBlending: LayerEffectAdvancedBlendingDescriptor,
): LayerEffectStackPortabilityDescriptor {
  const warnings = [
    ...getLayerEffectRasterizationWarnings(flattenedExport),
    ...unsupportedEffects.map((effect) => effect.warning),
    ...getLayerEffectBlendIfWarnings(advancedBlending),
  ];
  const portableWithinSignalLoom = warnings.length === 0;
  const portableAcrossSignalLoomDocuments = warnings.length === 0;
  return {
    portableWithinSignalLoom,
    portableAcrossSignalLoomDocuments,
    portableAsEditablePhotoshopLayerStyle: false,
    requiresFlattenedPixelsForExport: flattenedExport.rasterizesEffects,
    warnings,
    signature: `layer-effect-stack-portability:v1:${JSON.stringify({
      portableWithinSignalLoom,
      portableAcrossSignalLoomDocuments,
      portableAsEditablePhotoshopLayerStyle: false,
      requiresFlattenedPixelsForExport: flattenedExport.rasterizesEffects,
      warnings,
    })}`,
  };
}

function getLayerEffectBlendIfWarnings(advancedBlending: LayerEffectAdvancedBlendingDescriptor): string[] {
  return advancedBlending.warning ? [advancedBlending.warning] : [];
}

function layerEffectRenderer(kind: LayerEffectKind): LayerEffectCapability['renderer'] {
  const capability = LAYER_EFFECT_CAPABILITY_CATALOG.find((entry) => entry.kind === kind);
  return capability?.renderer ?? 'unsupported';
}

function buildLayerEffectPresetCompatibilitySignature(
  effectKinds: readonly LayerEffectKind[],
  globalLightAngle: number | null,
  unsupportedEffectKinds: readonly PhotoshopLayerEffectKind[],
  blendIf: 'absent' | 'present',
): string {
  const globalLightPart = globalLightAngle === null ? 'no-global-light' : `global-light:${globalLightAngle}`;
  const unsupportedPart = unsupportedEffectKinds.length > 0
    ? `unsupported:${unsupportedEffectKinds.join(',')}`
    : 'unsupported:none';
  return [
    'layer-effect-preset:v1',
    effectKinds.join('|') || 'none',
    globalLightPart,
    unsupportedPart,
    `blend-if:${blendIf}`,
  ].join(':');
}

interface LayerEffectRenderCacheEntry {
  signature: string;
  result: RenderedLayerWithEffects;
}

/**
 * Memoizes the (expensive) styled-bitmap render per layer id. `renderLayerWithEffects`
 * is called from many hot paths — the composite renderer alone invokes it twice per
 * frame (the synchronous fallback AND the worker-prep), plus layer-panel thumbnails,
 * the eyedropper, crop, and PSD/XCF export. Recomputing the per-pixel effect stack
 * every time made unrelated re-renders (panel toggle, pan, zoom) re-run the full
 * stroke/shadow/glow computation, which is why "toggling the interface takes minutes".
 *
 * The cache key mirrors exactly the fields `CompositeRenderer.buildDocSignature` uses to
 * decide whether a layer's composited appearance changed, so it shares the codebase's
 * existing invalidation contract (bitmapVersion is bumped on any pixel/mask edit). The
 * cached bitmap is only ever read by callers, never mutated, so sharing it is safe.
 */
const layerEffectRenderCache = new Map<string, LayerEffectRenderCacheEntry>();
const MAX_LAYER_EFFECT_CACHE_ENTRIES = 64;

function buildLayerEffectRenderSignature(layer: ImageLayer): string {
  return JSON.stringify({
    width: layer.bitmap?.width ?? 0,
    height: layer.bitmap?.height ?? 0,
    bitmapVersion: layer.bitmapVersion,
    hasMask: Boolean(layer.mask),
    maskDensity: layer.maskDensity,
    maskFeather: layer.maskFeather,
    blendIf: layer.blendIf ?? null,
    effects: layer.effects ?? null,
    filters: layer.filters ?? null,
  });
}

/** Clears the layer-effect render memo. Exposed for tests and for callers that need to
 * force a recompute (e.g. after disposing of a document). */
export function clearLayerEffectRenderCache(): void {
  layerEffectRenderCache.clear();
}

export function renderLayerWithEffects(layer: ImageLayer): RenderedLayerWithEffects | null {
  if (!layer.bitmap) return null;

  const signature = buildLayerEffectRenderSignature(layer);
  const cached = layerEffectRenderCache.get(layer.id);
  if (cached && cached.signature === signature) {
    return cached.result;
  }

  const result = computeLayerWithEffects(layer);
  if (result) {
    // Bound the cache so long sessions with many transient layers don't grow it
    // without limit. Layer ids are stable, so the common case is a steady set of
    // entries far below this cap.
    if (!layerEffectRenderCache.has(layer.id) && layerEffectRenderCache.size >= MAX_LAYER_EFFECT_CACHE_ENTRIES) {
      const oldestKey = layerEffectRenderCache.keys().next().value;
      if (oldestKey !== undefined) layerEffectRenderCache.delete(oldestKey);
    }
    layerEffectRenderCache.set(layer.id, { signature, result });
  }
  return result;
}

function computeLayerWithEffects(layer: ImageLayer): RenderedLayerWithEffects | null {
  if (!layer.bitmap) return null;

  const enabledEffects = (layer.effects ?? []).filter((effect) => effect.enabled);
  const source = getLayerSourceImageData(layer);
  const padding = resolveEffectPadding(source, enabledEffects);

  // Try the GPU compositor first (stroke/shadow/glow/colorOverlay). It returns null for
  // any unsupported effect, an oversized layer, or a GL failure, so we transparently fall
  // back to the CPU path below — correctness is identical on every device.
  const gpu = tryRenderLayerEffectsGpu(source, enabledEffects, padding);
  if (gpu) return gpu;

  return renderLayerEffectsCpu(source, enabledEffects, padding);
}

/**
 * Pure CPU render of the layer effect stack. This is the canonical/reference
 * implementation and the fallback when the GPU path is unavailable; it is also exported
 * so GPU output can be parity-checked against it.
 */
export function renderLayerEffectsCpu(
  source: ImageData,
  enabledEffects: ImageLayerEffect[],
  padding: { left: number; right: number; top: number; bottom: number },
): RenderedLayerWithEffects {
  const output = createBitmap(source.width + padding.left + padding.right, source.height + padding.top + padding.bottom);
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire layer effect render context');
  const imageData = ctx.createImageData(output.width, output.height);

  for (const effect of enabledEffects) {
    renderEffectInto(imageData, source, effect, padding.left, padding.top);
  }

  const content = applyContentEffects(source, enabledEffects);
  compositeImageData(imageData, content, padding.left, padding.top);
  putBitmapImageData(output, imageData);

  return {
    bitmap: output,
    offsetX: padding.left === 0 ? 0 : -padding.left,
    offsetY: padding.top === 0 ? 0 : -padding.top,
  };
}

function getLayerSourceImageData(layer: ImageLayer): ImageData {
  if (!layer.bitmap) {
    throw new Error('Cannot read image data from a layer without a bitmap.');
  }
  const source = getBitmapImageData(layer.bitmap);
  const masked = layer.mask ? applyLayerMaskToImageData(source, layer) : source;
  const filtered = applyLayerFiltersToImageData(masked, layer.filters);
  return layer.blendIf ? applyBlendIfToImageData(filtered, layer.blendIf) : filtered;
}

/** Applies the persisted "This Layer" Blend If range to source alpha before effects and
 * blend-mode composition, so canvas preview and flattened export share the same result.
 * Fails safe under direct hostile calls: non-finite endpoints fall back to the neutral
 * defaults the project sanitizer uses, and a reversed finite range swaps instead of
 * silently rendering the whole layer transparent. */
export function applyBlendIfToImageData(source: ImageData, blendIf: ImageLayerBlendIf): ImageData {
  const output = cloneImageData(source);
  const blackCandidate = Number.isFinite(blendIf.sourceBlack) ? blendIf.sourceBlack : 0;
  const whiteCandidate = Number.isFinite(blendIf.sourceWhite) ? blendIf.sourceWhite : 255;
  let black = Math.max(0, Math.min(254, Math.round(blackCandidate)));
  let white = Math.max(1, Math.min(255, Math.round(whiteCandidate)));
  if (white < black) [black, white] = [white, black];
  white = Math.max(white, black + 1);
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const luma = output.data[offset] * 0.2126 + output.data[offset + 1] * 0.7152 + output.data[offset + 2] * 0.0722;
    const coverage = luma <= black ? 0 : luma >= white ? 1 : (luma - black) / (white - black);
    output.data[offset + 3] = Math.round(output.data[offset + 3] * coverage);
  }
  return output;
}

function renderEffectInto(
  target: ImageData,
  source: ImageData,
  effect: ImageLayerEffect,
  originX: number,
  originY: number,
): void {
  switch (effect.kind) {
    case 'stroke':
      renderStroke(target, source, effect, originX, originY);
      break;
    case 'dropShadow':
      renderSpreadAlphaEffect(target, source, {
        color: effect.color,
        opacity: effect.opacity,
        radius: effect.size,
        offsetX: Math.round(Math.cos((effect.angle * Math.PI) / 180) * effect.distance),
        offsetY: Math.round(Math.sin((effect.angle * Math.PI) / 180) * effect.distance),
        originX,
        originY,
        outsideOnly: false,
      });
      break;
    case 'innerShadow':
      break;
    case 'bevelEmboss':
      break;
    case 'outerGlow':
      renderSpreadAlphaEffect(target, source, {
        color: effect.color,
        opacity: effect.opacity,
        radius: effect.size,
        offsetX: 0,
        offsetY: 0,
        originX,
        originY,
        outsideOnly: true,
      });
      break;
    case 'innerGlow':
      break;
    case 'colorOverlay':
      break;
    case 'satin':
      break;
    case 'patternOverlay':
      break;
    case 'gradientOverlay':
      break;
  }
}

/**
 * Stroke via an O(W×H) Euclidean distance transform instead of the old
 * O(opaquePixels × radius²) per-pixel disk scan. We build the source coverage in
 * the padded target space, compute the exact Euclidean distance from every pixel to
 * the nearest opaque pixel (and, for inside strokes, to the nearest transparent
 * pixel), then paint the band whose distance falls within `radius`. The feather curve
 * and the inside/outside/center positioning match the previous renderer's behaviour
 * (a round, dilation-style stroke), but the cost no longer explodes with radius — a
 * 200px stroke on a multi-megapixel layer is now a few linear passes, not billions of
 * synchronous main-thread operations.
 */
function renderStroke(
  target: ImageData,
  source: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'stroke' }>,
  originX: number,
  originY: number,
): void {
  const color = parseCssColor(effect.color);
  if (effect.opacity <= 0) return;
  const W = target.width;
  const H = target.height;
  const feather = computeStrokeFeatherField(source, effect, W, H, originX, originY);
  if (!feather) return;

  for (let i = 0; i < W * H; i += 1) {
    const effectAlpha = effect.opacity * feather[i];
    if (effectAlpha <= 0) continue;
    blendPixel(target, i % W, Math.floor(i / W), color, effectAlpha);
  }
}

/**
 * Per-output-pixel stroke coverage (0..1, the feathered band before colour/opacity), or
 * null for a no-op (radius 0). Shared by the CPU `renderStroke` and the GPU effect path
 * so both use the same tested distance-transform band logic.
 */
export function computeStrokeFeatherField(
  source: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'stroke' }>,
  width: number,
  height: number,
  originX: number,
  originY: number,
): Float32Array | null {
  const radius = Math.max(0, Math.round(effect.size));
  if (radius === 0) return null;

  const coverage = buildCoverageField(source, width, height, originX, originY, 0, 0);
  // Distance from every target pixel to the nearest opaque source pixel.
  const distToOpaque = euclideanDistanceField(coverage, width, height, (value) => value > 0);
  // Inside strokes additionally need the distance to the nearest transparent pixel.
  const distToEmpty = effect.position === 'inside'
    ? euclideanDistanceField(coverage, width, height, (value) => value <= 0)
    : null;

  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const isInside = coverage[i] > 0;
    let edgeDistance: number;
    if (effect.position === 'outside') {
      if (isInside) continue;
      edgeDistance = distToOpaque[i];
    } else if (effect.position === 'inside') {
      if (!isInside) continue;
      edgeDistance = distToEmpty ? distToEmpty[i] : distToOpaque[i];
    } else {
      // center: dilation-style band covering inside content plus an outer ring.
      edgeDistance = distToOpaque[i];
    }
    if (edgeDistance > radius + 0.001) continue;
    out[i] = radius <= 1 ? 1 : clamp01(1 - Math.max(0, edgeDistance - radius + 1));
  }
  return out;
}

/**
 * Drop shadow / outer glow via a separable box blur of the alpha channel — O(W×H) per
 * pass — replacing the old O(opaquePixels × radius²) disk accumulation. A box blur
 * applied twice approximates the previous linear (cone) falloff while spreading roughly
 * `radius` pixels; a zero radius is an exact identity so the unblurred (size 0) cases
 * are unchanged. The blurred alpha is colorized, offset, and (for outer glow) masked to
 * the area outside the source content, matching the prior compositing.
 */
function renderSpreadAlphaEffect(
  target: ImageData,
  source: ImageData,
  options: {
    color: string;
    opacity: number;
    radius: number;
    offsetX: number;
    offsetY: number;
    originX: number;
    originY: number;
    outsideOnly: boolean;
  },
): void {
  const color = parseCssColor(options.color);
  const radius = Math.max(0, Math.round(options.radius));
  if (options.opacity <= 0) return;

  const W = target.width;
  const H = target.height;
  const field = buildCoverageField(source, W, H, options.originX, options.originY, options.offsetX, options.offsetY);

  if (radius > 0) {
    // Two box-blur passes ≈ a triangular (cone) falloff reaching ~radius. Halving the
    // radius per pass keeps the combined spread close to the requested size.
    const halfWidth = Math.max(1, Math.round(radius / 2));
    separableBoxBlur(field, W, H, halfWidth, 2);
  }

  for (let i = 0; i < W * H; i += 1) {
    const spread = field[i];
    if (spread <= 0) continue;
    if (options.outsideOnly) {
      const sourceCoverage = sampleAlpha(source, (i % W) - options.originX, Math.floor(i / W) - options.originY);
      if (sourceCoverage > 0) continue;
    }
    const effectAlpha = spread * options.opacity;
    if (effectAlpha <= 0) continue;
    blendPixel(target, i % W, Math.floor(i / W), color, effectAlpha);
  }
}

/**
 * Builds an alpha-coverage field (0..1) at the padded target size, placing the source
 * layer's alpha at (originX + offsetX, originY + offsetY). Used as the input to the
 * distance transform (stroke) and the blur (shadow/glow).
 */
function buildCoverageField(
  source: ImageData,
  width: number,
  height: number,
  originX: number,
  originY: number,
  offsetX: number,
  offsetY: number,
): Float32Array {
  const field = new Float32Array(width * height);
  const baseX = originX + offsetX;
  const baseY = originY + offsetY;
  for (let y = 0; y < source.height; y += 1) {
    const ty = baseY + y;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const tx = baseX + x;
      if (tx < 0 || tx >= width) continue;
      const alpha = source.data[(y * source.width + x) * 4 + 3] / 255;
      if (alpha > 0) field[ty * width + tx] = alpha;
    }
  }
  return field;
}

const EDT_INF = 1e20;

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher). Returns, for every
 * cell, the Euclidean distance to the nearest cell for which `isSeed` is true. Runs in
 * O(W×H) via two passes of the 1-D squared-distance transform.
 */
function euclideanDistanceField(
  coverage: Float32Array,
  width: number,
  height: number,
  isSeed: (value: number) => boolean,
): Float32Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = isSeed(coverage[i]) ? 0 : EDT_INF;
  }

  const maxDim = Math.max(width, height);
  const f = new Float64Array(maxDim);
  const d = new Float64Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float64Array(maxDim + 1);

  // Vertical passes (columns).
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }
  // Horizontal passes (rows).
  for (let y = 0; y < height; y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) f[x] = grid[base + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x += 1) grid[base + x] = d[x];
  }

  const result = new Float32Array(width * height);
  for (let i = 0; i < result.length; i += 1) {
    result[i] = Math.sqrt(grid[i]);
  }
  return result;
}

/**
 * Euclidean distance from every pixel to the nearest transparent cell, where everything
 * outside the image bounds counts as transparent (matching the old `sampleAlpha`
 * out-of-bounds-is-0 behaviour that inner glow/shadow relied on). This is the inner
 * counterpart used by content effects; it is O(W×H) like `euclideanDistanceField`.
 */
function distanceToEmptyField(coverage: Float32Array, width: number, height: number): Float32Array {
  const internal = euclideanDistanceField(coverage, width, height, (value) => value <= 0);
  for (let y = 0; y < height; y += 1) {
    // Distance to the nearest cell just outside each edge (always orthogonal).
    const borderY = Math.min(y + 1, height - y);
    for (let x = 0; x < width; x += 1) {
      const border = Math.min(x + 1, width - x, borderY);
      const idx = y * width + x;
      if (border < internal[idx]) internal[idx] = border;
    }
  }
  return internal;
}

/** Samples a distance field at integer coords; out-of-bounds reads as 0 (transparent). */
function sampleDistanceField(field: Float32Array, x: number, y: number, width: number, height: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return field[y * width + x];
}

/** 1-D squared distance transform of a sampled function (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q += 1) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Separable box blur of a single-channel field, with clamp-to-edge sampling. Each pass
 * is O(W×H) thanks to a sliding-window running sum. Applying it `passes` times
 * approximates a Gaussian (two passes ≈ a triangular kernel).
 */
function separableBoxBlur(field: Float32Array, width: number, height: number, radius: number, passes: number): void {
  if (radius <= 0 || passes <= 0) return;
  const scratch = new Float32Array(field.length);
  for (let p = 0; p < passes; p += 1) {
    // Each pass writes field -> scratch (horizontal) then scratch -> field (vertical),
    // so the final result is always back in `field`.
    boxBlurAxis(field, scratch, width, height, radius, true);
    boxBlurAxis(scratch, field, width, height, radius, false);
  }
}

function boxBlurAxis(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const windowSize = 2 * radius + 1;
  const inv = 1 / windowSize;
  if (horizontal) {
    for (let y = 0; y < height; y += 1) {
      const base = y * width;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += src[base + clampIndex(k, width)];
      }
      for (let x = 0; x < width; x += 1) {
        dst[base + x] = sum * inv;
        sum += src[base + clampIndex(x + radius + 1, width)] - src[base + clampIndex(x - radius, width)];
      }
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += src[clampIndex(k, height) * width + x];
      }
      for (let y = 0; y < height; y += 1) {
        dst[y * width + x] = sum * inv;
        sum += src[clampIndex(y + radius + 1, height) * width + x] - src[clampIndex(y - radius, height) * width + x];
      }
    }
  }
}

function clampIndex(index: number, length: number): number {
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

function applyContentEffects(source: ImageData, effects: ImageLayerEffect[]): ImageData {
  const output = cloneImageData(source);
  for (const effect of effects) {
    if (!effect.enabled) continue;
    switch (effect.kind) {
      case 'bevelEmboss':
        applyBevelEmbossToContent(output, source, effect);
        break;
      case 'innerShadow':
        applyInnerShadowToContent(output, source, effect);
        break;
      case 'innerGlow':
        applyInnerGlowToContent(output, source, effect);
        break;
      case 'satin':
        applySatinToContent(output, source, effect);
        break;
      case 'patternOverlay':
        applyPatternOverlayToContent(output, effect);
        break;
      case 'gradientOverlay':
        applyGradientOverlayToContent(output, effect);
        break;
      case 'colorOverlay':
        applyColorOverlayToContent(output, effect);
        break;
      case 'stroke':
      case 'dropShadow':
      case 'outerGlow':
        break;
    }
  }

  return output;
}

function applyBevelEmbossToContent(
  output: ImageData,
  sourceAlpha: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'bevelEmboss' }>,
): void {
  const highlight = parseCssColor(effect.highlightColor);
  const shadow = parseCssColor(effect.shadowColor);
  const radius = Math.max(1, Math.round(effect.size));
  const angle = effect.angle * Math.PI / 180;
  const lightX = Math.round(Math.cos(angle) * radius);
  const lightY = Math.round(Math.sin(angle) * radius);
  const W = sourceAlpha.width;
  const H = sourceAlpha.height;
  const coverage = buildCoverageField(sourceAlpha, W, H, 0, 0, 0, 0);
  const distToEmpty = distanceToEmptyField(coverage, W, H);
  const denom = radius + 1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const offset = (y * W + x) * 4;
      const alpha = sourceAlpha.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const edge = clamp01(1 - distToEmpty[y * W + x] / denom);
      if (edge <= 0) continue;
      const highlightEdge = Math.max(0, alpha - sampleCoverage(coverage, x - lightX, y - lightY, W, H));
      const shadowEdge = Math.max(0, alpha - sampleCoverage(coverage, x + lightX, y + lightY, W, H));
      const color = highlightEdge >= shadowEdge ? highlight : shadow;
      const strength = clamp01(Math.max(highlightEdge, shadowEdge) * edge * effect.opacity * alpha);
      output.data[offset] = mixByte(output.data[offset], color[0], strength);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], strength);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], strength);
    }
  }
}

function sampleCoverage(coverage: Float32Array, x: number, y: number, width: number, height: number): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  return coverage[y * width + x] ?? 0;
}

function applyColorOverlayToContent(
  output: ImageData,
  overlay: Extract<ImageLayerEffect, { kind: 'colorOverlay' }>,
): void {
  const color = parseCssColor(overlay.color);
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = output.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const opacity = clamp01(overlay.opacity);
      output.data[offset] = mixByte(output.data[offset], color[0], opacity);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], opacity);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], opacity);
    }
  }
}

function applyInnerShadowToContent(
  output: ImageData,
  sourceAlpha: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'innerShadow' }>,
): void {
  const color = parseCssColor(effect.color);
  const radius = Math.max(0, Math.round(effect.size));
  const offsetX = Math.round(Math.cos((effect.angle * Math.PI) / 180) * effect.distance);
  const offsetY = Math.round(Math.sin((effect.angle * Math.PI) / 180) * effect.distance);
  if (effect.opacity <= 0) return;

  // The old per-pixel disk scan found the closest transparent pixel within `radius` of
  // the light-shifted position; that is exactly the distance to the nearest transparent
  // cell, which an O(W×H) distance transform gives directly.
  const W = sourceAlpha.width;
  const H = sourceAlpha.height;
  const coverage = buildCoverageField(sourceAlpha, W, H, 0, 0, 0, 0);
  const distToEmpty = distanceToEmptyField(coverage, W, H);
  const denom = radius + 1;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = sourceAlpha.data[offset + 3] / 255;
      if (alpha <= 0) continue;

      const dist = sampleDistanceField(distToEmpty, x - offsetX, y - offsetY, W, H);
      if (dist > radius) continue;
      const strength = clamp01(1 - dist / denom);

      const opacity = clamp01(effect.opacity * alpha * strength);
      if (opacity <= 0) continue;
      output.data[offset] = mixByte(output.data[offset], color[0], opacity);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], opacity);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], opacity);
    }
  }
}

function applyInnerGlowToContent(
  output: ImageData,
  sourceAlpha: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'innerGlow' }>,
): void {
  const color = parseCssColor(effect.color);
  const radius = Math.max(0, Math.round(effect.size));
  const opacity = clamp01(effect.opacity);
  if (opacity <= 0) return;

  // Inner glow brightens inward from the shape's edge; the strength at a pixel is set by
  // how close the nearest transparent cell is. Replaces the old O(W×H × radius²) disk
  // scan with one O(W×H) distance transform.
  const W = sourceAlpha.width;
  const H = sourceAlpha.height;
  const coverage = buildCoverageField(sourceAlpha, W, H, 0, 0, 0, 0);
  const distToEmpty = distanceToEmptyField(coverage, W, H);
  const denom = radius + 1;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = sourceAlpha.data[offset + 3] / 255;
      if (alpha <= 0) continue;

      const dist = distToEmpty[y * W + x];
      if (dist > radius) continue;
      const strength = clamp01(1 - dist / denom);

      const mix = clamp01(strength * opacity * alpha);
      if (mix <= 0) continue;
      output.data[offset] = mixByte(output.data[offset], color[0], mix);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], mix);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], mix);
    }
  }
}

function applySatinToContent(
  output: ImageData,
  sourceAlpha: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'satin' }>,
): void {
  const color = parseCssColor(effect.color);
  const radius = Math.max(1, Math.round(effect.size));
  const offsetX = Math.round(Math.cos((effect.angle * Math.PI) / 180) * effect.distance);
  const offsetY = Math.round(Math.sin((effect.angle * Math.PI) / 180) * effect.distance);
  const opacity = clamp01(effect.opacity);
  if (opacity <= 0) return;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = sourceAlpha.data[offset + 3] / 255;
      if (alpha <= 0) continue;

      const forward = sampleAlpha(sourceAlpha, x + offsetX, y + offsetY);
      const backward = sampleAlpha(sourceAlpha, x - offsetX, y - offsetY);
      const distanceFromCenterX = Math.abs(x - (sourceAlpha.width - 1) / 2) / Math.max(1, sourceAlpha.width / 2);
      const distanceFromCenterY = Math.abs(y - (sourceAlpha.height - 1) / 2) / Math.max(1, sourceAlpha.height / 2);
      const centerFalloff = clamp01(1 - Math.hypot(distanceFromCenterX, distanceFromCenterY) / Math.max(1, radius / 4));
      const directionalInfluence = 0.5 + Math.abs(forward - backward) * 0.5;
      const directionalContrast = clamp01(centerFalloff * directionalInfluence);
      const strength = effect.invert ? 1 - directionalContrast : directionalContrast;
      const mix = clamp01(strength * opacity * alpha);
      if (mix <= 0) continue;
      output.data[offset] = mixByte(output.data[offset], color[0], mix);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], mix);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], mix);
    }
  }
}

function applyGradientOverlayToContent(
  output: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'gradientOverlay' }>,
): void {
  const start = parseCssColor(effect.color);
  const end = parseCssColor(effect.secondaryColor);
  const opacity = clamp01(effect.opacity);
  if (opacity <= 0) return;

  const angle = (effect.angle * Math.PI) / 180;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const centerX = (output.width - 1) / 2;
  const centerY = (output.height - 1) / 2;
  const corners = [
    projectGradientPoint(0, 0, centerX, centerY, dirX, dirY),
    projectGradientPoint(output.width - 1, 0, centerX, centerY, dirX, dirY),
    projectGradientPoint(0, output.height - 1, centerX, centerY, dirX, dirY),
    projectGradientPoint(output.width - 1, output.height - 1, centerX, centerY, dirX, dirY),
  ];
  const minProjection = Math.min(...corners);
  const maxProjection = Math.max(...corners);
  const span = Math.max(1, (maxProjection - minProjection) * Math.max(0.01, effect.scale));

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = output.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const projection = projectGradientPoint(x, y, centerX, centerY, dirX, dirY);
      let t = clamp01((projection - minProjection) / span);
      if (effect.reverse) t = 1 - t;
      const color: [number, number, number] = [
        mixByte(start[0], end[0], t),
        mixByte(start[1], end[1], t),
        mixByte(start[2], end[2], t),
      ];
      const mix = opacity * alpha;
      output.data[offset] = mixByte(output.data[offset], color[0], mix);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], mix);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], mix);
    }
  }
}

function projectGradientPoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  dirX: number,
  dirY: number,
): number {
  return (x - centerX) * dirX + (y - centerY) * dirY;
}

function applyPatternOverlayToContent(
  output: ImageData,
  effect: Extract<ImageLayerEffect, { kind: 'patternOverlay' }>,
): void {
  const foreground = parseCssColor(effect.color);
  const background = parseCssColor(effect.backgroundColor);
  const opacity = clamp01(effect.opacity);
  const scale = Math.max(1, Math.round(effect.scale));
  if (opacity <= 0) return;

  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const alpha = output.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      const color = samplePatternOverlayColor(effect.pattern, x, y, scale, foreground, background);
      const mix = opacity * alpha;
      output.data[offset] = mixByte(output.data[offset], color[0], mix);
      output.data[offset + 1] = mixByte(output.data[offset + 1], color[1], mix);
      output.data[offset + 2] = mixByte(output.data[offset + 2], color[2], mix);
    }
  }
}

function samplePatternOverlayColor(
  pattern: Extract<ImageLayerEffect, { kind: 'patternOverlay' }>['pattern'],
  x: number,
  y: number,
  scale: number,
  foreground: [number, number, number],
  background: [number, number, number],
): [number, number, number] {
  const tileX = Math.floor(x / scale);
  const tileY = Math.floor(y / scale);
  switch (pattern) {
    case 'diagonal':
      return Math.floor((x + y) / scale) % 2 === 0 ? foreground : background;
    case 'dots': {
      const center = (scale - 1) / 2;
      const localX = x % scale;
      const localY = y % scale;
      return Math.hypot(localX - center, localY - center) <= Math.max(1, scale / 4)
        ? foreground
        : background;
    }
    case 'grid':
      return x % scale === 0 || y % scale === 0 ? foreground : background;
    case 'checker':
    default:
      return (tileX + tileY) % 2 === 0 ? foreground : background;
  }
}

function resolveEffectPadding(
  source: ImageData,
  effects: ImageLayerEffect[],
): { left: number; right: number; top: number; bottom: number } {
  const padding = { left: 0, right: 0, top: 0, bottom: 0 };

  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.kind === 'stroke') {
      const size = Math.max(0, Math.ceil(effect.size));
      if (effect.position !== 'inside') {
        padding.left = Math.max(padding.left, size);
        padding.right = Math.max(padding.right, size);
        padding.top = Math.max(padding.top, size);
        padding.bottom = Math.max(padding.bottom, size);
      }
    }

    if (effect.kind === 'outerGlow') {
      const size = Math.max(0, Math.ceil(effect.size));
      padding.left = Math.max(padding.left, size);
      padding.right = Math.max(padding.right, size);
      padding.top = Math.max(padding.top, size);
      padding.bottom = Math.max(padding.bottom, size);
    }

    if (effect.kind === 'dropShadow') {
      const size = Math.max(0, Math.ceil(effect.size));
      const dx = Math.round(Math.cos((effect.angle * Math.PI) / 180) * effect.distance);
      const dy = Math.round(Math.sin((effect.angle * Math.PI) / 180) * effect.distance);
      padding.left = Math.max(padding.left, size + Math.max(0, -dx));
      padding.right = Math.max(padding.right, size + Math.max(0, dx));
      padding.top = Math.max(padding.top, size + Math.max(0, -dy));
      padding.bottom = Math.max(padding.bottom, size + Math.max(0, dy));
    }
  }

  // Keep layer-effect buffers bounded by the source dimensions plus realistic
  // effect extents. This also prevents empty effects from creating zero-size
  // or unexpectedly huge buffers.
  return {
    left: Math.min(source.width * 2, padding.left),
    right: Math.min(source.width * 2, padding.right),
    top: Math.min(source.height * 2, padding.top),
    bottom: Math.min(source.height * 2, padding.bottom),
  };
}

function compositeImageData(target: ImageData, source: ImageData, dx: number, dy: number): void {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const alpha = source.data[offset + 3] / 255;
      if (alpha <= 0) continue;
      blendPixel(target, dx + x, dy + y, [
        source.data[offset],
        source.data[offset + 1],
        source.data[offset + 2],
      ], alpha);
    }
  }
}

function sampleAlpha(imageData: ImageData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return 0;
  return imageData.data[(y * imageData.width + x) * 4 + 3] / 255;
}

function blendPixel(
  imageData: ImageData,
  x: number,
  y: number,
  color: [number, number, number],
  alpha: number,
): void {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return;
  const offset = (y * imageData.width + x) * 4;
  const sourceAlpha = clamp01(alpha);
  const destAlpha = imageData.data[offset + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;

  imageData.data[offset] = Math.round(
    (color[0] * sourceAlpha + imageData.data[offset] * destAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  imageData.data[offset + 1] = Math.round(
    (color[1] * sourceAlpha + imageData.data[offset + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  imageData.data[offset + 2] = Math.round(
    (color[2] * sourceAlpha + imageData.data[offset + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
  );
  imageData.data[offset + 3] = Math.round(outAlpha * 255);
}

function parseCssColor(color: string): [number, number, number] {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return [
      parseInt(trimmed.slice(1, 3), 16),
      parseInt(trimmed.slice(3, 5), 16),
      parseInt(trimmed.slice(5, 7), 16),
    ];
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return [
      parseInt(trimmed[1] + trimmed[1], 16),
      parseInt(trimmed[2] + trimmed[2], 16),
      parseInt(trimmed[3] + trimmed[3], 16),
    ];
  }
  return [255, 255, 255];
}

function cloneImageData(imageData: ImageData): ImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  } as ImageData;
}

function mixByte(before: number, after: number, opacity: number): number {
  return Math.round(before + (after - before) * clamp01(opacity));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isCanvasEffectKind(kind: LayerEffectKind): boolean {
  return kind === 'stroke' || kind === 'dropShadow' || kind === 'outerGlow';
}
