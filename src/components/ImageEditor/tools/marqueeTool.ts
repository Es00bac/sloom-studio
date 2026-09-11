import {
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type MarqueeShape,
  type SelectionMode,
  type SelectionToolSettings,
} from '../../../types/imageEditor';
import type { ToolEnv, ToolHandler, Point, Modifiers } from './types';
import { createMask, setEllipse, setRect, type SelectionMask } from '../SelectionMask';
import { describeSelectionModeSemantics, SelectionInteraction, type SelectionModeOperation } from './selectionInteraction';

export type MarqueeSelectionLimitationCode = 'smoothing-unsupported';

export interface MarqueeSelectionLimitation {
  code: MarqueeSelectionLimitationCode;
  severity: 'limitation';
  message: string;
}

export interface MarqueeKeyboardModifierCaveat {
  input: 'shift' | 'alt' | 'escape';
  behavior: string;
  caveat: string;
}

export interface MarqueeBatchActionSuitability {
  status: 'ready' | 'limited-ready' | 'blocked';
  actionRecordable: true;
  batchSafe: boolean;
  requiresSelectionReplayValidation: true;
  reason: string;
}

export interface MarqueeModifierBehaviorDescriptor {
  input: 'shift' | 'alt' | 'escape';
  geometryEffect: 'constrain-to-square-or-circle' | 'draw-from-center' | 'cancel-preview';
  selectionModeOverride: 'add-when-resolved-by-environment' | 'subtract-when-resolved-by-environment' | 'none';
}

export type MarqueeSavedSelectionOperation =
  | 'save-selection-as-alpha-channel'
  | 'load-selection-replace'
  | 'load-selection-add'
  | 'load-selection-subtract'
  | 'load-selection-intersect';

export interface MarqueeSavedSelectionOperationDescriptor {
  operation: MarqueeSavedSelectionOperation;
  status: 'ready' | 'blocked-no-saved-alpha-channel';
  source: 'document-selection-registry' | 'document-alpha-channel-metadata';
  target: 'document-selection-registry' | 'document-alpha-channel-metadata';
}

export type MarqueeSelectionGeometryInvalidReason = 'zero-area-marquee';

export interface MarqueeSelectionGeometryOptions {
  start: Point;
  current: Point;
  square?: boolean;
  fromCenter?: boolean;
}

export interface MarqueeSelectionGeometryDescriptor {
  descriptorId: 'marquee-selection-geometry:v1';
  constraint: 'freeform' | 'square';
  origin: 'corner' | 'center';
  bounds: SelectionGeometryBounds;
  areaPx: number;
  validForCommit: boolean;
  invalidReason: MarqueeSelectionGeometryInvalidReason | null;
  signature: string;
}

export interface MarqueeSelectionWorkflowDescriptorOptions {
  selectionSettings?: Partial<Pick<
    SelectionToolSettings,
    'mode' | 'marqueeShape' | 'feather' | 'antiAlias'
  >>;
  selectionMode?: SelectionMode;
  drag?: MarqueeSelectionGeometryOptions;
}

export interface MarqueeSelectionWorkflowDescriptor {
  descriptorId: 'marquee-selection-workflow:v1';
  tool: 'marquee';
  selectionMode: {
    mode: SelectionMode;
    operation: SelectionModeOperation;
  };
  geometry: {
    shape: MarqueeShape;
    constraint: 'freeform' | 'square';
    origin: 'corner' | 'center';
    bounds: SelectionGeometryBounds | null;
    areaPx: number;
    validForCommit: boolean;
    invalidReason: MarqueeSelectionGeometryInvalidReason | null;
    signature: string | null;
  };
  edgeProcessing: {
    feather: {
      requestedPx: number;
      applied: boolean;
    };
    antiAlias: {
      requested: boolean;
      applied: boolean;
    };
    smoothing: {
      requested: false;
      applied: false;
    };
  };
  output: {
    target: 'document-selection';
    alpha: 255;
  };
  limitations: MarqueeSelectionLimitation[];
  previewSignature: string;
}

export type MarqueeSelectionReadinessStatus = 'ready' | 'limited-ready' | 'blocked';
export type MarqueeSelectionReadinessBlockerCode =
  | 'smoothing-pass-unsupported'
  | 'transform-selection-needs-active-selection'
  | 'saved-selection-round-trip-needs-alpha-channel'
  | 'invalid-marquee-geometry';

export interface MarqueeSelectionReadinessBlocker {
  code: MarqueeSelectionReadinessBlockerCode;
  severity: 'warning' | 'error';
  operation:
    | 'marquee-preview'
    | 'selection-edge-processing'
    | 'transform-selection'
    | 'save-load-selection';
  message: string;
}

export interface MarqueeSelectionReadinessOptions extends MarqueeSelectionWorkflowDescriptorOptions {
  hasActiveSelection?: boolean;
  savedAlphaChannelCount?: number;
  requireSoftFeatherPreview?: boolean;
  requireSmoothing?: boolean;
  requireTransformSelection?: boolean;
  requireSavedSelectionRoundTrip?: boolean;
  requireValidGeometry?: boolean;
}

export interface MarqueeSelectionReadinessDescriptor {
  descriptorId: 'marquee-selection-readiness:v1';
  status: MarqueeSelectionReadinessStatus;
  geometry: MarqueeSelectionGeometryDescriptor;
  shapes: {
    supported: Array<{
      shape: MarqueeShape;
      geometry: 'axis-aligned-rectangle' | 'axis-aligned-ellipse';
      squareConstraint: 'shift-key';
      fromCenter: 'alt-key';
      rasterizer: 'setRect' | 'setEllipse';
    }>;
    active: MarqueeShape;
  };
  edgeModes: {
    feather: {
      requestedPx: number;
      settingStored: true;
      preview: 'feathered-mask' | 'no-feather-requested';
      appliedToSelectionMask: boolean;
    };
    antiAlias: {
      requested: boolean;
      preview: 'rasterizer-edge-alpha' | 'binary-edge';
      appliedToSelectionMask: boolean;
    };
    smoothing: {
      requested: boolean;
      preview: 'unsupported';
      appliedToSelectionMask: false;
    };
  };
  selectionCombineModes: Array<{
    mode: SelectionMode;
    operation: SelectionModeOperation;
    previewTarget: 'document-selection-registry';
    commitTarget: 'document-selection-history';
  }>;
  transformInterop: {
    status: 'supported-after-selection-commit' | 'blocked-no-active-selection';
    owner: 'ImageSelectionTransform';
    supportedHandles: ['move', 'resize', 'rotate', 'skew', 'distort'];
    unsupportedHandles: ['perspective', 'warp'];
    input: 'document-selection-registry';
    output: 'undoable-selection-history';
  };
  saveLoadInterop: {
    currentSelectionPersistence: 'session-selection-registry';
    savedSelectionPersistence: 'document-alpha-channel-metadata';
    status: 'supported-via-alpha-channel-save' | 'supported-alpha-channel-round-trip' | 'blocked-no-saved-alpha-channel';
    savedAlphaChannelCount: number;
    operations: MarqueeSavedSelectionOperationDescriptor[];
  };
  modifierBehavior: MarqueeModifierBehaviorDescriptor[];
  transformSelectionHandoff: {
    target: 'transform-selection';
    readiness: 'requires-committed-selection';
    source: 'document-selection-registry';
    commitBoundary: 'after-selection-commit';
    invalidBlockerSignature: 'transform-selection-needs-active-selection';
  };
  previewSignatures: {
    workflow: string;
    readiness: string;
    combineModes: string[];
    blockers: string;
  };
  previewCaveats: MarqueeSelectionLimitation[];
  blockers: MarqueeSelectionReadinessBlocker[];
  keyboardModifierCaveats: MarqueeKeyboardModifierCaveat[];
  batchActionSuitability: MarqueeBatchActionSuitability;
}

interface SelectionGeometryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function describeMarqueeSelectionWorkflow(
  options: MarqueeSelectionWorkflowDescriptorOptions = {},
): MarqueeSelectionWorkflowDescriptor {
  const settings = {
    ...DEFAULT_SELECTION_TOOL_SETTINGS,
    ...options.selectionSettings,
  };
  const mode = options.selectionMode ?? settings.mode;
  const modeSemantics = describeSelectionModeSemantics(mode);
  const drag = options.drag;
  const geometry = drag ? describeMarqueeSelectionGeometry(drag) : null;
  const featherPx = normalizePixels(settings.feather);
  const descriptor = {
    descriptorId: 'marquee-selection-workflow:v1' as const,
    tool: 'marquee' as const,
    selectionMode: {
      mode,
      operation: modeSemantics.operation,
    },
    geometry: {
      shape: settings.marqueeShape,
      constraint: geometry?.constraint ?? 'freeform' as const,
      origin: geometry?.origin ?? 'corner' as const,
      bounds: geometry?.bounds ?? null,
      areaPx: geometry?.areaPx ?? 0,
      validForCommit: geometry?.validForCommit ?? false,
      invalidReason: geometry?.invalidReason ?? null,
      signature: geometry?.signature ?? null,
    },
    edgeProcessing: {
      feather: {
        requestedPx: featherPx,
        applied: featherPx > 0,
      },
      antiAlias: {
        requested: settings.antiAlias,
        applied: settings.antiAlias,
      },
      smoothing: {
        requested: false as const,
        applied: false as const,
      },
    },
    output: {
      target: 'document-selection' as const,
      alpha: 255 as const,
    },
    limitations: getMarqueeSelectionLimitations(),
  };

  return {
    ...descriptor,
    previewSignature: buildMarqueeSelectionPreviewSignature(descriptor),
  };
}

export function describeMarqueeSelectionReadiness(
  options: MarqueeSelectionReadinessOptions = {},
): MarqueeSelectionReadinessDescriptor {
  const workflow = describeMarqueeSelectionWorkflow(options);
  const geometry = options.drag
    ? describeMarqueeSelectionGeometry(options.drag)
    : describeMarqueeSelectionGeometry({
      start: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
    });
  const settings = {
    ...DEFAULT_SELECTION_TOOL_SETTINGS,
    ...options.selectionSettings,
  };
  const featherPx = normalizePixels(settings.feather);
  const requestedSmoothing = options.requireSmoothing === true;
  const selectionCombineModes = MARQUEE_SELECTION_MODES.map((mode) => {
    const semantics = describeSelectionModeSemantics(mode);
    return {
      mode,
      operation: semantics.operation,
      previewTarget: semantics.previewTarget,
      commitTarget: semantics.commitTarget,
    };
  });
  const savedAlphaChannelCount = normalizeCount(options.savedAlphaChannelCount);
  const hasActiveSelection = options.hasActiveSelection ?? workflow.geometry.bounds !== null;
  const blockers = buildMarqueeSelectionReadinessBlockers({
    requireSmoothing: requestedSmoothing,
    requireTransformSelection: options.requireTransformSelection === true,
    requireSavedSelectionRoundTrip: options.requireSavedSelectionRoundTrip === true,
    requireValidGeometry: options.requireValidGeometry === true,
    hasActiveSelection,
    savedAlphaChannelCount,
    geometry,
  });
  const status = blockers.some((blocker) => blocker.severity === 'error')
    ? 'blocked'
    : blockers.length > 0 || workflow.limitations.length > 0
      ? 'limited-ready'
      : 'ready';
  const descriptor: Omit<MarqueeSelectionReadinessDescriptor, 'previewSignatures'> = {
    descriptorId: 'marquee-selection-readiness:v1',
    status,
    geometry,
    shapes: {
      supported: [
        {
          shape: 'rectangle',
          geometry: 'axis-aligned-rectangle',
          squareConstraint: 'shift-key',
          fromCenter: 'alt-key',
          rasterizer: 'setRect',
        },
        {
          shape: 'ellipse',
          geometry: 'axis-aligned-ellipse',
          squareConstraint: 'shift-key',
          fromCenter: 'alt-key',
          rasterizer: 'setEllipse',
        },
      ],
      active: settings.marqueeShape,
    },
    edgeModes: {
      feather: {
        requestedPx: featherPx,
        settingStored: true,
        preview: featherPx > 0 ? 'feathered-mask' : 'no-feather-requested',
        appliedToSelectionMask: featherPx > 0,
      },
      antiAlias: {
        requested: settings.antiAlias,
        preview: settings.antiAlias ? 'rasterizer-edge-alpha' : 'binary-edge',
        appliedToSelectionMask: settings.antiAlias,
      },
      smoothing: {
        requested: requestedSmoothing,
        preview: 'unsupported',
        appliedToSelectionMask: false,
      },
    },
    selectionCombineModes,
    transformInterop: {
      status: hasActiveSelection ? 'supported-after-selection-commit' : 'blocked-no-active-selection',
      owner: 'ImageSelectionTransform',
      supportedHandles: ['move', 'resize', 'rotate', 'skew', 'distort'],
      unsupportedHandles: ['perspective', 'warp'],
      input: 'document-selection-registry',
      output: 'undoable-selection-history',
    },
    saveLoadInterop: {
      currentSelectionPersistence: 'session-selection-registry',
      savedSelectionPersistence: 'document-alpha-channel-metadata',
      status: options.requireSavedSelectionRoundTrip === true && savedAlphaChannelCount === 0
        ? 'blocked-no-saved-alpha-channel'
        : savedAlphaChannelCount > 0
          ? 'supported-alpha-channel-round-trip'
          : 'supported-via-alpha-channel-save',
      savedAlphaChannelCount,
      operations: buildMarqueeSavedSelectionOperations(savedAlphaChannelCount),
    },
    modifierBehavior: getMarqueeModifierBehavior(),
    transformSelectionHandoff: {
      ...describeSelectionModeSemantics(settings.mode).transformSelectionHandoff,
      invalidBlockerSignature: 'transform-selection-needs-active-selection',
    },
    previewCaveats: workflow.limitations,
    blockers,
    keyboardModifierCaveats: getMarqueeKeyboardModifierCaveats(),
    batchActionSuitability: {
      status: status === 'ready' ? 'ready' : status === 'blocked' ? 'blocked' : 'limited-ready',
      actionRecordable: true,
      batchSafe: false,
      requiresSelectionReplayValidation: true,
      reason: status === 'blocked'
        ? 'Marquee playback is blocked until required selection transform or saved-selection prerequisites exist.'
        : 'Marquee geometry can be recorded, but batch playback must revalidate document bounds and active selection combine mode.',
    },
  };

  return {
    ...descriptor,
    previewSignatures: {
      workflow: workflow.previewSignature,
      readiness: buildMarqueeSelectionReadinessPreviewSignature(descriptor),
      combineModes: MARQUEE_SELECTION_MODES.map((mode) => describeSelectionModeSemantics(mode).previewSignature),
      blockers: buildMarqueeSelectionBlockerSignature(descriptor.blockers),
    },
  };
}

interface State {
  start: Point;
  fromCenter: boolean;
  square: boolean;
  previewed: boolean;
  interaction: SelectionInteraction;
}

const MARQUEE_SELECTION_MODES: SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

let state: State | null = null;

export const marqueeTool: ToolHandler = {
  onPointerDown(env, point, mods) {
    const mode = env.resolveSelectionMode(mods);
    state = {
      start: point,
      fromCenter: mods.alt,
      square: mods.shift,
      previewed: false,
      interaction: new SelectionInteraction(env, mode),
    };
    update(env, point, mods);
  },

  onPointerMove(env, point, mods) {
    if (!state) return;
    update(env, point, mods);
  },

  onPointerUp(env) {
    if (!state) return;
    const current = state;
    if (current.previewed) {
      current.interaction.commit(env);
    } else {
      current.interaction.cancel(env);
    }
    state = null;
  },

  onCancel(env) {
    if (!state) return;
    state.interaction.cancel(env);
    state = null;
  },
};

function update(env: ToolEnv, point: Point, mods: Modifiers): void {
  if (!state) return;
  const start = state.start;
  let x0 = start.x;
  let y0 = start.y;
  let x1 = point.x;
  let y1 = point.y;

  if (mods.shift) {
    const w = x1 - x0;
    const h = y1 - y0;
    const size = Math.max(Math.abs(w), Math.abs(h));
    x1 = x0 + Math.sign(w || 1) * size;
    y1 = y0 + Math.sign(h || 1) * size;
  }
  if (mods.alt) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    x0 -= dx;
    y0 -= dy;
  }

  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width <= 0 || height <= 0) return;

  const shape: SelectionMask = createMask(env.doc.width, env.doc.height);
  if (env.selectionToolSettings.marqueeShape === 'ellipse') {
    setEllipse(
      shape,
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      255,
      env.selectionToolSettings.antiAlias,
    );
  } else {
    setRect(shape, x, y, width, height, 255, env.selectionToolSettings.antiAlias);
  }

  state.interaction.preview(env, shape);
  state.previewed = true;
}

export function describeMarqueeSelectionGeometry(
  options: MarqueeSelectionGeometryOptions,
): MarqueeSelectionGeometryDescriptor {
  const bounds = calculateMarqueeBounds(options);
  const areaPx = roundNumber(bounds.width * bounds.height, 3);
  const validForCommit = bounds.width > 0 && bounds.height > 0;
  const constraint = options.square ? 'square' : 'freeform';
  const origin = options.fromCenter ? 'center' : 'corner';

  return {
    descriptorId: 'marquee-selection-geometry:v1',
    constraint,
    origin,
    bounds,
    areaPx,
    validForCommit,
    invalidReason: validForCommit ? null : 'zero-area-marquee',
    signature: [
      'marquee-selection-geometry:v1',
      validForCommit ? 'ready' : 'invalid',
      constraint,
      origin,
      formatMarqueeBounds(bounds),
      formatMarqueeNumber(areaPx),
    ].join(':'),
  };
}

function calculateMarqueeBounds(options: MarqueeSelectionGeometryOptions): SelectionGeometryBounds {
  let x0 = options.start.x;
  let y0 = options.start.y;
  let x1 = options.current.x;
  let y1 = options.current.y;

  if (options.square) {
    const width = x1 - x0;
    const height = y1 - y0;
    const size = Math.max(Math.abs(width), Math.abs(height));
    x1 = x0 + Math.sign(width || 1) * size;
    y1 = y0 + Math.sign(height || 1) * size;
  }
  if (options.fromCenter) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    x0 -= dx;
    y0 -= dy;
  }

  return {
    x: roundNumber(Math.min(x0, x1), 3),
    y: roundNumber(Math.min(y0, y1), 3),
    width: roundNumber(Math.abs(x1 - x0), 3),
    height: roundNumber(Math.abs(y1 - y0), 3),
  };
}

function getMarqueeSelectionLimitations(): MarqueeSelectionLimitation[] {
  const limitations: MarqueeSelectionLimitation[] = [];
  limitations.push({
    code: 'smoothing-unsupported',
    severity: 'limitation',
    message: 'Marquee selection geometry does not apply an additional smoothing pass beyond the rectangle or ellipse rasterizer.',
  });
  return limitations;
}

function getMarqueeKeyboardModifierCaveats(): MarqueeKeyboardModifierCaveat[] {
  return [
    {
      input: 'shift',
      behavior: 'square-constraint-and-add-mode-when-resolved-by-environment',
      caveat: 'Shift constrains geometry during drag; selection add/subtract semantics come from the shared modifier resolver.',
    },
    {
      input: 'alt',
      behavior: 'draw-from-center-and-subtract-mode-when-resolved-by-environment',
      caveat: 'Alt changes marquee origin during drag; subtract semantics depend on environment resolution.',
    },
    {
      input: 'escape',
      behavior: 'cancel-active-marquee-preview',
      caveat: 'Cancel clears preview state without committing selection history.',
    },
  ];
}

function getMarqueeModifierBehavior(): MarqueeModifierBehaviorDescriptor[] {
  return [
    {
      input: 'shift',
      geometryEffect: 'constrain-to-square-or-circle',
      selectionModeOverride: 'add-when-resolved-by-environment',
    },
    {
      input: 'alt',
      geometryEffect: 'draw-from-center',
      selectionModeOverride: 'subtract-when-resolved-by-environment',
    },
    {
      input: 'escape',
      geometryEffect: 'cancel-preview',
      selectionModeOverride: 'none',
    },
  ];
}

function buildMarqueeSavedSelectionOperations(
  savedAlphaChannelCount: number,
): MarqueeSavedSelectionOperationDescriptor[] {
  const loadStatus = savedAlphaChannelCount > 0 ? 'ready' : 'blocked-no-saved-alpha-channel';
  return [
    {
      operation: 'save-selection-as-alpha-channel',
      status: 'ready',
      source: 'document-selection-registry',
      target: 'document-alpha-channel-metadata',
    },
    {
      operation: 'load-selection-replace',
      status: loadStatus,
      source: 'document-alpha-channel-metadata',
      target: 'document-selection-registry',
    },
    {
      operation: 'load-selection-add',
      status: loadStatus,
      source: 'document-alpha-channel-metadata',
      target: 'document-selection-registry',
    },
    {
      operation: 'load-selection-subtract',
      status: loadStatus,
      source: 'document-alpha-channel-metadata',
      target: 'document-selection-registry',
    },
    {
      operation: 'load-selection-intersect',
      status: loadStatus,
      source: 'document-alpha-channel-metadata',
      target: 'document-selection-registry',
    },
  ];
}

function buildMarqueeSelectionPreviewSignature(
  descriptor: Omit<MarqueeSelectionWorkflowDescriptor, 'previewSignature'>,
): string {
  return `marquee-selection-workflow:v1:${JSON.stringify({
    mode: descriptor.selectionMode.mode,
    shape: descriptor.geometry.shape,
    bounds: descriptor.geometry.bounds,
    constraint: descriptor.geometry.constraint,
    origin: descriptor.geometry.origin,
    feather: descriptor.edgeProcessing.feather,
    antiAlias: descriptor.edgeProcessing.antiAlias,
    limitations: descriptor.limitations.map((limitation) => limitation.code),
  })}`;
}

function buildMarqueeSelectionReadinessBlockers(options: {
  requireSmoothing: boolean;
  requireTransformSelection: boolean;
  requireSavedSelectionRoundTrip: boolean;
  requireValidGeometry: boolean;
  hasActiveSelection: boolean;
  savedAlphaChannelCount: number;
  geometry: MarqueeSelectionGeometryDescriptor;
}): MarqueeSelectionReadinessBlocker[] {
  const blockers: MarqueeSelectionReadinessBlocker[] = [];
  if (options.requireValidGeometry && !options.geometry.validForCommit) {
    blockers.push({
      code: 'invalid-marquee-geometry',
      severity: 'error',
      operation: 'marquee-preview',
      message: 'A marquee selection needs non-zero width and height before it can create selection history.',
    });
  }
  if (options.requireSmoothing) {
    blockers.push({
      code: 'smoothing-pass-unsupported',
      severity: 'warning',
      operation: 'selection-edge-processing',
      message: 'A separate smoothing pass is not available for marquee selections beyond rectangle or ellipse anti-alias rasterization.',
    });
  }
  if (options.requireTransformSelection && !options.hasActiveSelection) {
    blockers.push({
      code: 'transform-selection-needs-active-selection',
      severity: 'error',
      operation: 'transform-selection',
      message: 'Transform Selection interop requires a committed non-empty selection in the document selection registry.',
    });
  }
  if (options.requireSavedSelectionRoundTrip && options.savedAlphaChannelCount === 0) {
    blockers.push({
      code: 'saved-selection-round-trip-needs-alpha-channel',
      severity: 'error',
      operation: 'save-load-selection',
      message: 'Save/load round-trip validation requires at least one persisted saved alpha channel.',
    });
  }
  return blockers;
}

function buildMarqueeSelectionReadinessPreviewSignature(
  descriptor: Omit<MarqueeSelectionReadinessDescriptor, 'previewSignatures'>,
): string {
  return `marquee-selection-readiness:v1:${JSON.stringify({
    status: descriptor.status,
    activeShape: descriptor.shapes.active,
    feather: descriptor.edgeModes.feather,
    antiAlias: descriptor.edgeModes.antiAlias,
    smoothing: descriptor.edgeModes.smoothing,
    combineModes: descriptor.selectionCombineModes.map((mode) => mode.mode),
    transform: descriptor.transformInterop.status,
    saveLoad: descriptor.saveLoadInterop.status,
    blockers: descriptor.blockers.map((blocker) => blocker.code),
  })}`;
}

function buildMarqueeSelectionBlockerSignature(
  blockers: MarqueeSelectionReadinessBlocker[],
): string {
  return `marquee-selection-blockers:v1:${JSON.stringify(blockers.map((blocker) => blocker.code))}`;
}

function normalizePixels(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return roundNumber(value, 3);
}

function normalizeCount(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return 0;
  return Math.floor(value);
}

function formatMarqueeBounds(bounds: SelectionGeometryBounds): string {
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  ].map(formatMarqueeNumber).join(',');
}

function formatMarqueeNumber(value: number): string {
  return String(roundNumber(value, 3));
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
