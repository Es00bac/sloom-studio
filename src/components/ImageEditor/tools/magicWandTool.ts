import {
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageColorChannel,
  type SelectionMode,
  type SelectionToolSettings,
} from '../../../types/imageEditor';
import type { ToolEnv, ToolHandler, Point, Modifiers } from './types';
import { createMask, setFloodFill, type SelectionMask } from '../SelectionMask';
import { SelectionInteraction } from './selectionInteraction';
import { getBitmapImageData, createBitmap } from '../LayerBitmap';

export type MagicWandWorkflowWarningCode =
  | 'gap-close-unsupported'
  | 'channel-specific-selection-unsupported';

export type MagicWandTargetChannel = ImageColorChannel | 'alpha' | 'spot';
export type MagicWandReadinessCheckStatus = 'ready' | 'unsupported' | 'blocked';
export type MagicWandReadinessCheckCode =
  | 'tolerance'
  | 'sample-all-layers'
  | 'contiguous'
  | 'anti-alias'
  | 'gap-close'
  | 'channel-routing';

export interface MagicWandWorkflowWarning {
  code: MagicWandWorkflowWarningCode;
  severity: 'warning';
  message: string;
}

export interface MagicWandReadinessCheck {
  code: MagicWandReadinessCheckCode;
  status: MagicWandReadinessCheckStatus;
  message: string;
  caveatCodes: MagicWandWorkflowWarningCode[];
  blockerCodes: MagicWandWorkflowWarningCode[];
  signature: string;
}

export interface MagicWandWorkflowDescriptorOptions {
  selectionSettings?: Partial<Pick<
    SelectionToolSettings,
    'mode' | 'magicWandTolerance' | 'sampleAllLayers' | 'contiguous' | 'antiAlias' | 'feather'
  >>;
  selectionMode?: SelectionMode;
  targetChannel?: MagicWandTargetChannel;
  requestedGapClose?: number | boolean;
}

export interface MagicWandWorkflowDescriptor {
  descriptorId: 'magic-wand-workflow:v1';
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
  };
  sampling: {
    sampleAllLayers: boolean;
    source: 'active-layer-bitmap' | 'visible-document-composite';
  };
  matching: {
    scope: 'contiguous' | 'global';
    connectivity: 4 | 'document-wide';
    gapClosePixels: number;
    gapCloseSupported: false;
  };
  selectionOutput: {
    target: 'document-selection';
    mode: SelectionMode;
    alpha: 255;
  };
  target: {
    requestedChannel: MagicWandTargetChannel;
    channelSensitivity: 'composite-rgba' | 'composite-rgba-channel-request-unsupported';
  };
  antiAlias: {
    requested: boolean;
    applied: boolean;
    edgeModel: 'alpha-aware-flood-fill-edge' | 'binary-flood-fill';
  };
  warnings: MagicWandWorkflowWarning[];
  previewSignature: string;
}

export type MagicWandReadinessStatus = 'ready' | 'limited-ready' | 'blocked';
export type MagicWandReadinessBlockerCode =
  | MagicWandWorkflowWarningCode
  | 'transform-selection-needs-active-selection';

export interface MagicWandReadinessBlocker {
  code: MagicWandReadinessBlockerCode;
  severity: 'warning' | 'error';
  operation: 'selection-edge-processing' | 'channel-target-routing' | 'transform-selection';
  message: string;
}

export interface MagicWandReadinessOptions extends MagicWandWorkflowDescriptorOptions {
  hasActiveSelection?: boolean;
  requireTransformSelection?: boolean;
}

export interface MagicWandReadinessDescriptor {
  descriptorId: 'magic-wand-readiness:v1';
  status: MagicWandReadinessStatus;
  tolerance: {
    value: number;
    metric: 'rgb-euclidean-distance';
    replayDeterminism: 'stable-for-fixed-source-bitmap';
  };
  sampling: MagicWandWorkflowDescriptor['sampling'];
  matching: MagicWandWorkflowDescriptor['matching'] & {
    contiguousBehavior: 'seed-bounded-flood-fill' | 'document-wide-color-match';
  };
  edgeModes: {
    feather: {
      requestedPx: number;
      appliedToSelectionMask: boolean;
      preview: 'feathered-mask' | 'no-feather-requested';
    };
    antiAlias: {
      requested: boolean;
      appliedToSelectionMask: boolean;
      preview: 'alpha-aware-flood-fill-edge' | 'binary-flood-fill-edge';
    };
  };
  transformSelectionHandoff: {
    target: 'transform-selection';
    readiness: 'requires-committed-selection';
    source: 'document-selection-registry';
    commitBoundary: 'after-selection-commit';
    invalidBlockerSignature: 'transform-selection-needs-active-selection';
  };
  target: MagicWandWorkflowDescriptor['target'];
  checks: MagicWandReadinessCheck[];
  blockers: MagicWandReadinessBlocker[];
  batchActionSuitability: {
    status: 'ready' | 'limited-ready' | 'blocked';
    actionRecordable: true;
    batchSafe: false;
    requiresSelectionReplayValidation: true;
    reason: string;
  };
  previewSignatures: {
    workflow: string;
    readiness: string;
    blockers: string;
    checks: string;
    target: string;
  };
}

export function describeMagicWandWorkflow(
  options: MagicWandWorkflowDescriptorOptions = {},
): MagicWandWorkflowDescriptor {
  const settings = {
    ...DEFAULT_SELECTION_TOOL_SETTINGS,
    ...options.selectionSettings,
  };
  const requestedChannel = options.targetChannel ?? 'rgb';
  const gapClosePixels = normalizeGapClosePixels(options.requestedGapClose);
  const descriptor = {
    descriptorId: 'magic-wand-workflow:v1' as const,
    tolerance: {
      value: normalizeTolerance(settings.magicWandTolerance),
      metric: 'rgb-euclidean-distance' as const,
    },
    sampling: {
      sampleAllLayers: settings.sampleAllLayers,
      source: settings.sampleAllLayers ? 'visible-document-composite' as const : 'active-layer-bitmap' as const,
    },
    matching: {
      scope: settings.contiguous ? 'contiguous' as const : 'global' as const,
      connectivity: settings.contiguous ? 4 as const : 'document-wide' as const,
      gapClosePixels,
      gapCloseSupported: false as const,
    },
    selectionOutput: {
      target: 'document-selection' as const,
      mode: options.selectionMode ?? settings.mode,
      alpha: 255 as const,
    },
    target: {
      requestedChannel,
      channelSensitivity: requestedChannel === 'rgb'
        ? 'composite-rgba' as const
        : 'composite-rgba-channel-request-unsupported' as const,
    },
    antiAlias: {
      requested: settings.antiAlias,
      applied: settings.antiAlias,
      edgeModel: settings.antiAlias ? 'alpha-aware-flood-fill-edge' as const : 'binary-flood-fill' as const,
    },
    warnings: getMagicWandWorkflowWarnings({
      gapClosePixels,
      requestedChannel,
    }),
  };

  return {
    ...descriptor,
    previewSignature: buildMagicWandWorkflowPreviewSignature(descriptor),
  };
}

export function describeMagicWandReadiness(
  options: MagicWandReadinessOptions = {},
): MagicWandReadinessDescriptor {
  const workflow = describeMagicWandWorkflow(options);
  const settings = {
    ...DEFAULT_SELECTION_TOOL_SETTINGS,
    ...options.selectionSettings,
  };
  const featherPx = normalizeFeather(settings.feather);
  const hasActiveSelection = options.hasActiveSelection ?? false;
  const blockers = getMagicWandReadinessBlockers({
    warnings: workflow.warnings,
    requireTransformSelection: options.requireTransformSelection === true,
    hasActiveSelection,
  });
  const status = blockers.some((blocker) => blocker.severity === 'error')
    ? 'blocked'
    : blockers.length > 0
      ? 'limited-ready'
      : 'ready';
  const descriptor: Omit<MagicWandReadinessDescriptor, 'previewSignatures'> = {
    descriptorId: 'magic-wand-readiness:v1',
    status,
    tolerance: {
      ...workflow.tolerance,
      replayDeterminism: 'stable-for-fixed-source-bitmap',
    },
    sampling: workflow.sampling,
    matching: {
      ...workflow.matching,
      contiguousBehavior: workflow.matching.scope === 'contiguous'
        ? 'seed-bounded-flood-fill'
        : 'document-wide-color-match',
    },
    edgeModes: {
      feather: {
        requestedPx: featherPx,
        appliedToSelectionMask: featherPx > 0,
        preview: featherPx > 0 ? 'feathered-mask' : 'no-feather-requested',
      },
      antiAlias: {
        requested: workflow.antiAlias.requested,
        appliedToSelectionMask: workflow.antiAlias.applied,
        preview: workflow.antiAlias.applied ? 'alpha-aware-flood-fill-edge' : 'binary-flood-fill-edge',
      },
    },
    transformSelectionHandoff: {
      ...buildTransformSelectionHandoff(),
      invalidBlockerSignature: 'transform-selection-needs-active-selection',
    },
    target: workflow.target,
    checks: buildMagicWandReadinessChecks(workflow),
    blockers,
    batchActionSuitability: {
      status: status === 'ready' ? 'ready' : status === 'blocked' ? 'blocked' : 'limited-ready',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: status === 'blocked'
        ? 'Magic Wand playback is blocked until required transform-selection prerequisites exist.'
        : 'Magic Wand playback must revalidate the sampled source bitmap, seed point, and selection combine mode.',
    },
  };

  return {
    ...descriptor,
    previewSignatures: {
      workflow: workflow.previewSignature,
      readiness: buildMagicWandReadinessPreviewSignature(descriptor),
      blockers: buildMagicWandBlockerSignature(descriptor.blockers),
      checks: buildMagicWandReadinessChecksSignature(descriptor.checks),
      target: buildMagicWandTargetRoutingSignature(descriptor.target),
    },
  };
}

export const magicWandTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    sample(env, point, mods);
  },
};

function sample(env: ToolEnv, point: Point, mods: Modifiers): void {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= env.doc.width || y >= env.doc.height) return;

  const sourceImage = sourceImageAt(env);
  const shape: SelectionMask = createMask(env.doc.width, env.doc.height);
  setFloodFill(
    shape,
    sourceImage,
    x,
    y,
    env.selectionToolSettings.magicWandTolerance,
    env.selectionToolSettings.contiguous,
  );

  const selectionShape = env.selectionToolSettings.antiAlias
    ? buildMagicWandAntiAliasedMask(shape)
    : shape;
  const interaction = new SelectionInteraction(env, env.resolveSelectionMode(mods));
  interaction.preview(env, selectionShape);
  interaction.commit(env);
}

function buildMagicWandAntiAliasedMask(mask: SelectionMask): SelectionMask {
  const next = createMask(mask.width, mask.height);
  next.data.set(mask.data);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const index = y * mask.width + x;
      if (mask.data[index] > 0) continue;

      let orthogonalWeight = 0;
      let diagonalWeight = 0;
      if (isMaskPixelSelected(mask, x - 1, y)) orthogonalWeight += 1;
      if (isMaskPixelSelected(mask, x + 1, y)) orthogonalWeight += 1;
      if (isMaskPixelSelected(mask, x, y - 1)) orthogonalWeight += 1;
      if (isMaskPixelSelected(mask, x, y + 1)) orthogonalWeight += 1;
      if (isMaskPixelSelected(mask, x - 1, y - 1)) diagonalWeight += 1;
      if (isMaskPixelSelected(mask, x + 1, y - 1)) diagonalWeight += 1;
      if (isMaskPixelSelected(mask, x - 1, y + 1)) diagonalWeight += 1;
      if (isMaskPixelSelected(mask, x + 1, y + 1)) diagonalWeight += 1;

      const alpha = Math.min(192, orthogonalWeight * 48 + diagonalWeight * 32);
      if (alpha > 0) {
        next.data[index] = alpha;
      }
    }
  }
  return next;
}

function isMaskPixelSelected(mask: SelectionMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] > 0;
}

/** Build the configured sample source while keeping the selection document-sized. */
function sourceImageAt(env: ToolEnv): ImageData {
  if (!env.selectionToolSettings.sampleAllLayers && env.activeLayer?.bitmap) {
    const target = createBitmap(env.doc.width, env.doc.height);
    const ctx = target.getContext('2d');
    if (!ctx) {
      return new ImageData(env.doc.width, env.doc.height);
    }
    ctx.drawImage(env.activeLayer.bitmap, env.activeLayer.x, env.activeLayer.y);
    return getBitmapImageData(target);
  }

  const target = createBitmap(env.doc.width, env.doc.height);
  const ctx = target.getContext('2d');
  if (!ctx) {
    return new ImageData(env.doc.width, env.doc.height);
  }
  for (const layer of env.doc.layers) {
    if (!layer.visible || !layer.bitmap) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(layer.opacity);
    ctx.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
    ctx.drawImage(layer.bitmap, layer.x, layer.y);
    ctx.restore();
  }
  return getBitmapImageData(target);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function getMagicWandWorkflowWarnings(options: {
  gapClosePixels: number;
  requestedChannel: MagicWandTargetChannel;
}): MagicWandWorkflowWarning[] {
  const warnings: MagicWandWorkflowWarning[] = [];
  if (options.gapClosePixels > 0) {
    warnings.push({
      code: 'gap-close-unsupported',
      severity: 'warning',
      message: 'Gap close is not implemented for Magic Wand selections; matching uses direct contiguous or global color comparison only.',
    });
  }
  if (options.requestedChannel !== 'rgb') {
    warnings.push({
      code: 'channel-specific-selection-unsupported',
      severity: 'warning',
      message: 'Magic Wand sampling currently uses composite RGBA color instead of routing to an individual color, alpha, or spot channel.',
    });
  }
  return warnings;
}

function getMagicWandReadinessBlockers(options: {
  warnings: MagicWandWorkflowWarning[];
  requireTransformSelection: boolean;
  hasActiveSelection: boolean;
}): MagicWandReadinessBlocker[] {
  const blockers: MagicWandReadinessBlocker[] = options.warnings.map((warning) => ({
    code: warning.code,
    severity: 'warning',
    operation: warning.code === 'channel-specific-selection-unsupported'
      ? 'channel-target-routing'
      : 'selection-edge-processing',
    message: warning.message,
  }));
  if (options.requireTransformSelection && !options.hasActiveSelection) {
    blockers.push({
      code: 'transform-selection-needs-active-selection',
      severity: 'error',
      operation: 'transform-selection',
      message: 'Transform Selection interop requires a committed non-empty selection in the document selection registry.',
    });
  }
  return blockers;
}

function buildMagicWandWorkflowPreviewSignature(
  descriptor: Omit<MagicWandWorkflowDescriptor, 'previewSignature'>,
): string {
  return `magic-wand-workflow:v1:${JSON.stringify({
    tolerance: descriptor.tolerance.value,
    sampling: descriptor.sampling.source,
    matching: {
      scope: descriptor.matching.scope,
      connectivity: descriptor.matching.connectivity,
      gapClosePixels: descriptor.matching.gapClosePixels,
    },
    selectionOutput: descriptor.selectionOutput,
    antiAlias: {
      requested: descriptor.antiAlias.requested,
      applied: descriptor.antiAlias.applied,
      edgeModel: descriptor.antiAlias.edgeModel,
    },
    warnings: descriptor.warnings.map((warning) => warning.code),
  })}`;
}

function buildMagicWandReadinessPreviewSignature(
  descriptor: Omit<MagicWandReadinessDescriptor, 'previewSignatures'>,
): string {
  return `magic-wand-readiness:v1:${JSON.stringify({
    status: descriptor.status,
    tolerance: descriptor.tolerance.value,
    matching: {
      scope: descriptor.matching.scope,
      connectivity: descriptor.matching.connectivity,
      contiguousBehavior: descriptor.matching.contiguousBehavior,
    },
    feather: descriptor.edgeModes.feather,
    antiAlias: descriptor.edgeModes.antiAlias,
    blockers: descriptor.blockers.map((blocker) => blocker.code),
  })}`;
}

function buildMagicWandReadinessChecks(workflow: MagicWandWorkflowDescriptor): MagicWandReadinessCheck[] {
  const channelBlocked = workflow.target.channelSensitivity === 'composite-rgba-channel-request-unsupported';
  return [
    buildMagicWandReadinessCheck({
      code: 'tolerance',
      status: 'ready',
      message: `Tolerance ${workflow.tolerance.value} is ready for deterministic RGB Euclidean matching.`,
    }),
    buildMagicWandReadinessCheck({
      code: 'sample-all-layers',
      status: 'ready',
      message: workflow.sampling.sampleAllLayers
        ? 'Sample all layers uses the visible document composite as the match source.'
        : 'Sample all layers is disabled; matching uses the active layer bitmap.',
    }),
    buildMagicWandReadinessCheck({
      code: 'contiguous',
      status: 'ready',
      message: workflow.matching.scope === 'contiguous'
        ? 'Contiguous matching uses 4-connected seed-bounded flood fill.'
        : 'Global matching uses document-wide color matching.',
    }),
    buildMagicWandReadinessCheck({
      code: 'anti-alias',
      status: 'ready',
      message: workflow.antiAlias.requested
        ? 'Magic Wand anti-alias uses an alpha-aware one-pixel edge model in the committed selection mask.'
        : 'Magic Wand anti-alias edge weighting is not requested.',
    }),
    buildMagicWandReadinessCheck({
      code: 'gap-close',
      status: workflow.matching.gapClosePixels > 0 ? 'unsupported' : 'ready',
      message: workflow.matching.gapClosePixels > 0
        ? `Gap close ${workflow.matching.gapClosePixels}px is requested but not applied to Magic Wand matching.`
        : 'Gap close is not requested; matching uses direct color comparison.',
      caveatCodes: workflow.matching.gapClosePixels > 0 ? ['gap-close-unsupported'] : [],
    }),
    buildMagicWandReadinessCheck({
      code: 'channel-routing',
      status: channelBlocked ? 'blocked' : 'ready',
      message: channelBlocked
        ? `Channel ${workflow.target.requestedChannel} routing is unsupported; Magic Wand samples composite RGBA color.`
        : 'Composite RGB channel routing is ready for Magic Wand sampling.',
      caveatCodes: channelBlocked ? ['channel-specific-selection-unsupported'] : [],
      blockerCodes: channelBlocked ? ['channel-specific-selection-unsupported'] : [],
    }),
  ];
}

function buildMagicWandReadinessCheck(options: {
  code: MagicWandReadinessCheckCode;
  status: MagicWandReadinessCheckStatus;
  message: string;
  caveatCodes?: MagicWandWorkflowWarningCode[];
  blockerCodes?: MagicWandWorkflowWarningCode[];
}): MagicWandReadinessCheck {
  const check = {
    code: options.code,
    status: options.status,
    message: options.message,
    caveatCodes: options.caveatCodes ?? [],
    blockerCodes: options.blockerCodes ?? [],
  };
  return {
    ...check,
    signature: `magic-wand-readiness-check:v1:${JSON.stringify({
      code: check.code,
      status: check.status,
      caveats: check.caveatCodes,
      blockers: check.blockerCodes,
    })}`,
  };
}

function buildMagicWandReadinessChecksSignature(checks: MagicWandReadinessCheck[]): string {
  return `magic-wand-readiness-checks:v1:${JSON.stringify(checks.map((check) => `${check.code}:${check.status}`))}`;
}

function buildMagicWandTargetRoutingSignature(target: MagicWandWorkflowDescriptor['target']): string {
  const blockers = target.channelSensitivity === 'composite-rgba-channel-request-unsupported'
    ? ['channel-specific-selection-unsupported']
    : [];
  return `magic-wand-target-routing:v1:${JSON.stringify({
    requestedChannel: target.requestedChannel,
    channelSensitivity: target.channelSensitivity,
    blockers,
  })}`;
}

function buildMagicWandBlockerSignature(
  blockers: MagicWandReadinessBlocker[],
): string {
  return `magic-wand-blockers:v1:${JSON.stringify(blockers.map((blocker) => blocker.code))}`;
}

function buildTransformSelectionHandoff() {
  return {
    target: 'transform-selection' as const,
    readiness: 'requires-committed-selection' as const,
    source: 'document-selection-registry' as const,
    commitBoundary: 'after-selection-commit' as const,
  };
}

function normalizeTolerance(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return roundNumber(value, 3);
}

function normalizeFeather(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundNumber(value, 3);
}

function normalizeGapClosePixels(value: number | boolean | undefined): number {
  if (value === true) return 1;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return roundNumber(value, 3);
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
