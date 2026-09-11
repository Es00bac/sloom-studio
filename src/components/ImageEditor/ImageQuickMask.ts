import type { BrushDab } from './ImageBrushEngine';
import {
  cloneMask,
  createMask,
  describeSelectionMaskOverlay,
  type SelectionMask,
  type SelectionMaskAlphaSummary,
  type SelectionMaskOverlayDisplayDescriptor,
} from './SelectionMask';
import type { QuickMaskViewMode } from '../../types/imageEditor';

export type QuickMaskOverlaySource = 'selection' | 'inverse-selection';

export type QuickMaskOverlayWarningCode =
  | 'quick-mask-edge-refinement-preview-unsupported'
  | 'quick-mask-richer-visualization-unsupported';

export interface QuickMaskOverlayWarning {
  code: QuickMaskOverlayWarningCode;
  severity: 'warning';
  message: string;
}

export interface QuickMaskOverlayDescriptorOptions {
  viewMode: QuickMaskViewMode;
  tintColor?: string;
  opacity?: number;
  featherPx?: number;
}

export interface QuickMaskAlphaSummary {
  transparentPixels: number;
  partialPixels: number;
  fullPixels: number;
  averageAlpha: number;
}

export interface QuickMaskBrushTargetDescriptor {
  paint: 'white' | 'black' | 'gray' | 'eraser';
  targetValue: number;
  effect: string;
}

export interface QuickMaskRefinementDescriptor {
  supportsPartialAlpha: boolean;
  brushTargets: QuickMaskBrushTargetDescriptor[];
}

export interface QuickMaskOverlayDescriptor {
  kind: 'quick-mask-overlay';
  viewMode: QuickMaskViewMode;
  overlaySource: QuickMaskOverlaySource;
  size: { width: number; height: number };
  selection: QuickMaskAlphaSummary;
  overlay: QuickMaskAlphaSummary;
  display: SelectionMaskOverlayDisplayDescriptor;
  refinement: QuickMaskRefinementDescriptor;
  warnings: QuickMaskOverlayWarning[];
  limitations: string[];
  signature: string;
}

export type QuickMaskEditingOperation = 'enter-mode' | 'exit-mode' | 'paint-mask';

export type QuickMaskEditingBrushTool = 'brush' | 'eraser' | 'backgroundEraser' | 'magicEraser';

export type QuickMaskReadinessChannel = 'rgb' | 'alpha' | 'spot' | 'selection';

export type QuickMaskReadinessWarningCode =
  | QuickMaskOverlayWarningCode
  | 'quick-mask-alpha-channel-interop-warning'
  | 'quick-mask-direct-channel-paint-unsupported';

export type QuickMaskReadinessBlockerCode =
  | 'quick-mask-no-active-document'
  | 'quick-mask-invalid-document-size'
  | 'quick-mask-not-active'
  | 'quick-mask-brush-tool-unsupported';

export interface QuickMaskReadinessWarning {
  code: QuickMaskReadinessWarningCode;
  severity: 'warning';
  message: string;
}

export interface QuickMaskReadinessBlocker {
  code: QuickMaskReadinessBlockerCode;
  severity: 'error';
  message: string;
}

export interface QuickMaskEditingBrushOptions {
  tool: QuickMaskEditingBrushTool;
  color?: string;
}

export interface QuickMaskEditingReadinessOptions extends QuickMaskOverlayDescriptorOptions {
  enabled: boolean;
  operation: QuickMaskEditingOperation;
  brush?: QuickMaskEditingBrushOptions;
  activeChannel?: QuickMaskReadinessChannel;
  hasActiveDocument?: boolean;
}

export interface QuickMaskModeCommandDescriptor {
  readiness: 'ready' | 'already-active' | 'inactive' | 'blocked';
  action: 'enable-quick-mask' | 'commit-mask-to-selection';
  output: 'selection-alpha-as-editable-mask' | 'current-selection';
  blocker?: QuickMaskReadinessBlockerCode;
}

export interface QuickMaskSelectionToMaskDescriptor {
  readiness: 'ready' | 'blocked';
  source: 'current-selection' | 'empty-selection';
  white: 'selected';
  black: 'masked-unselected';
  gray: 'partially-selected';
  preservesPartialAlpha: boolean;
  blocker?: QuickMaskReadinessBlockerCode;
}

export interface QuickMaskMaskToSelectionDescriptor {
  readiness: 'ready' | 'blocked';
  output: 'current-selection';
  preservesPartialAlpha: boolean;
  blocker?: QuickMaskReadinessBlockerCode;
}

export interface QuickMaskEditingSemanticsDescriptor {
  selectionToMask: QuickMaskSelectionToMaskDescriptor;
  maskToSelection: QuickMaskMaskToSelectionDescriptor;
}

export interface QuickMaskEditingOverlayDescriptor {
  viewMode: QuickMaskViewMode;
  overlaySource: QuickMaskOverlaySource;
  tintColor: string;
  opacity: number;
  opacityLabel: string;
  featherPx: number;
  featherLabel: string;
}

export interface QuickMaskBrushRoutingDescriptor {
  tool: QuickMaskEditingBrushTool;
  supported: boolean;
  route: 'quick-mask-selection-alpha' | 'unsupported-pixel-alpha-tool';
  targetValue: number | null;
  effect: string;
  blocker?: QuickMaskReadinessBlockerCode;
}

export interface QuickMaskEditingReadinessDescriptor {
  kind: 'quick-mask-edit-readiness';
  operation: QuickMaskEditingOperation;
  mode: {
    enabled: boolean;
    enter: QuickMaskModeCommandDescriptor;
    exit: QuickMaskModeCommandDescriptor;
  };
  semantics: QuickMaskEditingSemanticsDescriptor;
  overlay: QuickMaskEditingOverlayDescriptor;
  brushRouting: QuickMaskBrushRoutingDescriptor;
  selection: QuickMaskAlphaSummary;
  overlayAlpha: QuickMaskAlphaSummary;
  blockers: QuickMaskReadinessBlocker[];
  warnings: QuickMaskReadinessWarning[];
  caveats: string[];
  signature: string;
}

export type QuickMaskEditRouteKind =
  | 'enter-quick-mask'
  | 'exit-quick-mask'
  | 'brush-to-selection-alpha'
  | 'eraser-to-selection-alpha'
  | 'background-eraser-blocked'
  | 'magic-eraser-blocked'
  | 'channel-handoff';

export interface QuickMaskEditRouteDescriptor {
  kind: 'quick-mask-edit-route';
  route: QuickMaskEditRouteKind;
  support: 'supported' | 'separate-workflow' | 'unsupported';
  operation: QuickMaskEditingOperation | 'channel-handoff';
  source: 'current-selection' | 'quick-mask-selection-alpha' | 'pixel-alpha-tool' | 'active-channel';
  output: 'quick-mask-selection-alpha' | 'current-selection' | 'saved-alpha-channel-workflow' | 'blocked';
  blocker: QuickMaskReadinessBlockerCode | null;
  caveat: string | null;
  signature: string;
}

export interface QuickMaskChannelHandoffDescriptor {
  kind: 'quick-mask-channel-handoff';
  activeChannel: QuickMaskReadinessChannel;
  quickMaskSource: 'transient-selection-alpha';
  commitTarget: 'current-selection';
  savedAlphaPersistence: 'separate-channels-workflow';
  directChannelPainting: 'unsupported-while-quick-mask-active';
  warnings: QuickMaskReadinessWarning[];
  signature: string;
}

export interface QuickMaskReadinessLaneDescriptor {
  kind: 'quick-mask-readiness-lane';
  editRoutes: QuickMaskEditRouteDescriptor[];
  channelHandoff: QuickMaskChannelHandoffDescriptor;
  readiness: QuickMaskEditingReadinessDescriptor;
  stableSignatures: {
    editRoutes: string[];
    channelHandoff: string;
    readiness: string;
  };
  signature: string;
}

export const QUICK_MASK_EDIT_ROUTE_DESCRIPTORS: readonly QuickMaskEditRouteDescriptor[] = [
  {
    kind: 'quick-mask-edit-route',
    route: 'enter-quick-mask',
    support: 'supported',
    operation: 'enter-mode',
    source: 'current-selection',
    output: 'quick-mask-selection-alpha',
    blocker: null,
    caveat: null,
    signature: 'quick-mask-edit-route:v1:enter-quick-mask:supported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'exit-quick-mask',
    support: 'supported',
    operation: 'exit-mode',
    source: 'quick-mask-selection-alpha',
    output: 'current-selection',
    blocker: null,
    caveat: null,
    signature: 'quick-mask-edit-route:v1:exit-quick-mask:supported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'brush-to-selection-alpha',
    support: 'supported',
    operation: 'paint-mask',
    source: 'quick-mask-selection-alpha',
    output: 'quick-mask-selection-alpha',
    blocker: null,
    caveat: 'Brush color is converted to selection-alpha coverage instead of painting RGB pixels.',
    signature: 'quick-mask-edit-route:v1:brush-to-selection-alpha:supported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'eraser-to-selection-alpha',
    support: 'supported',
    operation: 'paint-mask',
    source: 'quick-mask-selection-alpha',
    output: 'quick-mask-selection-alpha',
    blocker: null,
    caveat: 'Eraser restores selected coverage in the QuickMask alpha buffer.',
    signature: 'quick-mask-edit-route:v1:eraser-to-selection-alpha:supported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'background-eraser-blocked',
    support: 'unsupported',
    operation: 'paint-mask',
    source: 'pixel-alpha-tool',
    output: 'blocked',
    blocker: 'quick-mask-brush-tool-unsupported',
    caveat: 'Background Eraser targets pixel alpha and is blocked from QuickMask selection-alpha editing.',
    signature: 'quick-mask-edit-route:v1:background-eraser-blocked:quick-mask-brush-tool-unsupported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'magic-eraser-blocked',
    support: 'unsupported',
    operation: 'paint-mask',
    source: 'pixel-alpha-tool',
    output: 'blocked',
    blocker: 'quick-mask-brush-tool-unsupported',
    caveat: 'Magic Eraser targets pixel alpha and is blocked from QuickMask selection-alpha editing.',
    signature: 'quick-mask-edit-route:v1:magic-eraser-blocked:quick-mask-brush-tool-unsupported',
  },
  {
    kind: 'quick-mask-edit-route',
    route: 'channel-handoff',
    support: 'separate-workflow',
    operation: 'channel-handoff',
    source: 'active-channel',
    output: 'saved-alpha-channel-workflow',
    blocker: null,
    caveat: 'QuickMask commits to the current selection; saved alpha-channel persistence is handled by the Channels workflow.',
    signature: 'quick-mask-edit-route:v1:channel-handoff:separate-workflow',
  },
];

export function createQuickMaskOverlayMask(
  selection: SelectionMask | null,
  width: number,
  height: number,
  viewMode: QuickMaskViewMode,
): SelectionMask {
  const base = selection ? cloneMask(selection) : createMask(width, height);
  if (viewMode === 'selectedAreas') {
    return base;
  }

  const overlay = createMask(width, height);
  for (let index = 0; index < overlay.data.length; index += 1) {
    overlay.data[index] = 255 - base.data[index];
  }
  return overlay;
}

export function buildQuickMaskOverlayDescriptor(
  selection: SelectionMask | null,
  width: number,
  height: number,
  options: QuickMaskOverlayDescriptorOptions,
): QuickMaskOverlayDescriptor {
  const base = selection ? cloneMask(selection) : createMask(width, height);
  const overlay = createQuickMaskOverlayMask(selection, width, height, options.viewMode);
  const selectionDescriptor = describeSelectionMaskOverlay(base, {
    label: 'QuickMask Selection',
  });
  const overlayDescriptor = describeSelectionMaskOverlay(overlay, {
    label: 'QuickMask Overlay',
    tintColor: options.tintColor,
    opacity: options.opacity,
    featherPx: options.featherPx,
  });
  const overlaySource = resolveQuickMaskOverlaySource(options.viewMode);
  const warnings = buildQuickMaskOverlayWarnings(overlayDescriptor.display.featherPx);
  const selectionSummary = toQuickMaskAlphaSummary(selectionDescriptor.alpha);
  const overlaySummary = toQuickMaskAlphaSummary(overlayDescriptor.alpha);
  const signature = `quick-mask-overlay:v1:${JSON.stringify({
    viewMode: options.viewMode,
    overlaySource,
    width: overlay.width,
    height: overlay.height,
    selection: selectionSummary,
    overlay: overlaySummary,
    display: {
      opacity: overlayDescriptor.display.opacity,
      featherPx: overlayDescriptor.display.featherPx,
    },
    warnings: warnings.map((warning) => warning.code),
  })}`;

  return {
    kind: 'quick-mask-overlay',
    viewMode: options.viewMode,
    overlaySource,
    size: { width: overlay.width, height: overlay.height },
    selection: selectionSummary,
    overlay: overlaySummary,
    display: overlayDescriptor.display,
    refinement: buildQuickMaskRefinementDescriptor(),
    warnings,
    limitations: warnings.map((warning) => warning.message),
    signature,
  };
}

export function describeQuickMaskEditingReadiness(
  selection: SelectionMask | null,
  width: number,
  height: number,
  options: QuickMaskEditingReadinessOptions,
): QuickMaskEditingReadinessDescriptor {
  const overlayDescriptor = buildQuickMaskOverlayDescriptor(selection, width, height, options);
  const selectionSummary = overlayDescriptor.selection;
  const blockers = buildQuickMaskReadinessBlockers(width, height, options);
  const warnings = buildQuickMaskReadinessWarnings(overlayDescriptor.warnings, options.activeChannel);
  const brushRouting = buildQuickMaskBrushRoutingDescriptor(options.brush);
  const blockingCode = blockers[0]?.code;
  const signature = `quick-mask-edit-readiness:v1:${JSON.stringify({
    operation: options.operation,
    enabled: options.enabled,
    viewMode: options.viewMode,
    overlaySource: overlayDescriptor.overlaySource,
    width: overlayDescriptor.size.width,
    height: overlayDescriptor.size.height,
    selection: selectionSummary,
    overlay: {
      tintColor: overlayDescriptor.display.tintColor,
      opacity: overlayDescriptor.display.opacity,
      featherPx: overlayDescriptor.display.featherPx,
    },
    brush: {
      tool: brushRouting.tool,
      supported: brushRouting.supported,
      targetValue: brushRouting.targetValue,
      route: brushRouting.route,
    },
    blockers: blockers.map((blocker) => blocker.code),
    warnings: warnings.map((warning) => warning.code),
  })}`;

  return {
    kind: 'quick-mask-edit-readiness',
    operation: options.operation,
    mode: {
      enabled: options.enabled,
      enter: buildQuickMaskEnterDescriptor(options.enabled, blockingCode),
      exit: buildQuickMaskExitDescriptor(options.enabled, blockingCode),
    },
    semantics: {
      selectionToMask: buildQuickMaskSelectionToMaskDescriptor(selection, blockingCode),
      maskToSelection: buildQuickMaskMaskToSelectionDescriptor(options.enabled, blockingCode),
    },
    overlay: {
      viewMode: overlayDescriptor.viewMode,
      overlaySource: overlayDescriptor.overlaySource,
      tintColor: overlayDescriptor.display.tintColor,
      opacity: overlayDescriptor.display.opacity,
      opacityLabel: overlayDescriptor.display.opacityLabel,
      featherPx: overlayDescriptor.display.featherPx,
      featherLabel: overlayDescriptor.display.featherLabel,
    },
    brushRouting,
    selection: selectionSummary,
    overlayAlpha: overlayDescriptor.overlay,
    blockers,
    warnings,
    caveats: warnings.map((warning) => warning.message),
    signature,
  };
}

export function getQuickMaskEditRouteDescriptors(): QuickMaskEditRouteDescriptor[] {
  return QUICK_MASK_EDIT_ROUTE_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
}

export function describeQuickMaskChannelHandoff(
  activeChannel: QuickMaskReadinessChannel = 'selection',
): QuickMaskChannelHandoffDescriptor {
  const warnings = buildQuickMaskReadinessWarnings([], activeChannel);

  return {
    kind: 'quick-mask-channel-handoff',
    activeChannel,
    quickMaskSource: 'transient-selection-alpha',
    commitTarget: 'current-selection',
    savedAlphaPersistence: 'separate-channels-workflow',
    directChannelPainting: 'unsupported-while-quick-mask-active',
    warnings,
    signature: `quick-mask-channel-handoff:v1:${JSON.stringify({
      activeChannel,
      warnings: warnings.map((warning) => warning.code),
    })}`,
  };
}

export function describeQuickMaskReadinessLane(
  selection: SelectionMask | null,
  width: number,
  height: number,
  options: QuickMaskEditingReadinessOptions,
): QuickMaskReadinessLaneDescriptor {
  const editRoutes = getQuickMaskEditRouteDescriptors();
  const channelHandoff = describeQuickMaskChannelHandoff(options.activeChannel ?? 'selection');
  const readiness = describeQuickMaskEditingReadiness(selection, width, height, options);
  const stableSignatures = {
    editRoutes: editRoutes.map((descriptor) => descriptor.signature),
    channelHandoff: channelHandoff.signature,
    readiness: readiness.signature,
  };

  return {
    kind: 'quick-mask-readiness-lane',
    editRoutes,
    channelHandoff,
    readiness,
    stableSignatures,
    signature: `quick-mask-readiness-lane:v1:${JSON.stringify(stableSignatures)}`,
  };
}

export function resolveQuickMaskBrushTargetValue(color: string, isEraser: boolean): number {
  if (isEraser) return 255;
  const rgb = parseColor(color);
  if (!rgb) return 255;
  return Math.round((rgb.r + rgb.g + rgb.b) / 3);
}

export function paintQuickMaskDabs(
  selection: SelectionMask,
  dabs: readonly BrushDab[],
  targetValue: number,
): void {
  const nextTarget = clampByte(targetValue);
  for (const dab of dabs) {
    paintQuickMaskDab(selection, dab, nextTarget);
  }
}

function paintQuickMaskDab(selection: SelectionMask, dab: BrushDab, targetValue: number): void {
  const radiusX = Math.max(0.5, dab.size / 2);
  const radiusY = Math.max(0.5, radiusX * dab.roundness);
  const angle = (dab.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const alpha = clamp01(dab.opacity * dab.flow);
  const minX = Math.max(0, Math.floor(dab.x - radiusX - 1));
  const maxX = Math.min(selection.width, Math.ceil(dab.x + radiusX + 1));
  const minY = Math.max(0, Math.floor(dab.y - radiusY - 1));
  const maxY = Math.min(selection.height, Math.ceil(dab.y + radiusY + 1));

  for (let py = minY; py < maxY; py += 1) {
    for (let px = minX; px < maxX; px += 1) {
      const dx = px + 0.5 - dab.x;
      const dy = py + 0.5 - dab.y;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      const strength = sampleQuickMaskDabStrength(dab, localX / radiusX, localY / radiusY);
      if (strength <= 0) continue;
      const index = py * selection.width + px;
      const current = selection.data[index];
      selection.data[index] = clampByte(
        Math.round(current + (targetValue - current) * alpha * strength),
      );
    }
  }
}

function resolveQuickMaskOverlaySource(viewMode: QuickMaskViewMode): QuickMaskOverlaySource {
  return viewMode === 'selectedAreas' ? 'selection' : 'inverse-selection';
}

function buildQuickMaskRefinementDescriptor(): QuickMaskRefinementDescriptor {
  return {
    supportsPartialAlpha: true,
    brushTargets: [
      {
        paint: 'white',
        targetValue: 255,
        effect: 'adds selected coverage',
      },
      {
        paint: 'black',
        targetValue: 0,
        effect: 'removes selected coverage',
      },
      {
        paint: 'gray',
        targetValue: 128,
        effect: 'writes partial selected coverage',
      },
      {
        paint: 'eraser',
        targetValue: 255,
        effect: 'restores selected coverage',
      },
    ],
  };
}

function buildQuickMaskEnterDescriptor(
  enabled: boolean,
  blockingCode: QuickMaskReadinessBlockerCode | undefined,
): QuickMaskModeCommandDescriptor {
  if (blockingCode && blockingCode !== 'quick-mask-not-active' && blockingCode !== 'quick-mask-brush-tool-unsupported') {
    return {
      readiness: 'blocked',
      action: 'enable-quick-mask',
      output: 'selection-alpha-as-editable-mask',
      blocker: blockingCode,
    };
  }

  return {
    readiness: enabled ? 'already-active' : 'ready',
    action: 'enable-quick-mask',
    output: 'selection-alpha-as-editable-mask',
  };
}

function buildQuickMaskExitDescriptor(
  enabled: boolean,
  blockingCode: QuickMaskReadinessBlockerCode | undefined,
): QuickMaskModeCommandDescriptor {
  if (!enabled) {
    return {
      readiness: 'inactive',
      action: 'commit-mask-to-selection',
      output: 'current-selection',
      blocker: 'quick-mask-not-active',
    };
  }

  if (blockingCode && blockingCode !== 'quick-mask-brush-tool-unsupported') {
    return {
      readiness: 'blocked',
      action: 'commit-mask-to-selection',
      output: 'current-selection',
      blocker: blockingCode,
    };
  }

  return {
    readiness: 'ready',
    action: 'commit-mask-to-selection',
    output: 'current-selection',
  };
}

function buildQuickMaskSelectionToMaskDescriptor(
  selection: SelectionMask | null,
  blockingCode: QuickMaskReadinessBlockerCode | undefined,
): QuickMaskSelectionToMaskDescriptor {
  if (blockingCode && blockingCode !== 'quick-mask-not-active' && blockingCode !== 'quick-mask-brush-tool-unsupported') {
    return {
      readiness: 'blocked',
      source: selection ? 'current-selection' : 'empty-selection',
      white: 'selected',
      black: 'masked-unselected',
      gray: 'partially-selected',
      preservesPartialAlpha: true,
      blocker: blockingCode,
    };
  }

  return {
    readiness: 'ready',
    source: selection ? 'current-selection' : 'empty-selection',
    white: 'selected',
    black: 'masked-unselected',
    gray: 'partially-selected',
    preservesPartialAlpha: true,
  };
}

function buildQuickMaskMaskToSelectionDescriptor(
  enabled: boolean,
  blockingCode: QuickMaskReadinessBlockerCode | undefined,
): QuickMaskMaskToSelectionDescriptor {
  if (!enabled) {
    return {
      readiness: 'blocked',
      output: 'current-selection',
      preservesPartialAlpha: true,
      blocker: 'quick-mask-not-active',
    };
  }

  if (blockingCode && blockingCode !== 'quick-mask-brush-tool-unsupported') {
    return {
      readiness: 'blocked',
      output: 'current-selection',
      preservesPartialAlpha: true,
      blocker: blockingCode,
    };
  }

  return {
    readiness: 'ready',
    output: 'current-selection',
    preservesPartialAlpha: true,
  };
}

function buildQuickMaskBrushRoutingDescriptor(
  brush: QuickMaskEditingBrushOptions | undefined,
): QuickMaskBrushRoutingDescriptor {
  const tool = brush?.tool ?? 'brush';
  if (tool === 'backgroundEraser' || tool === 'magicEraser') {
    return {
      tool,
      supported: false,
      route: 'unsupported-pixel-alpha-tool',
      targetValue: null,
      effect: 'Quick Mask only routes Brush and Eraser strokes into selection-alpha editing.',
      blocker: 'quick-mask-brush-tool-unsupported',
    };
  }

  const isEraser = tool === 'eraser';
  const targetValue = resolveQuickMaskBrushTargetValue(brush?.color ?? (isEraser ? '#ffffff' : '#ffffff'), isEraser);
  return {
    tool,
    supported: true,
    route: 'quick-mask-selection-alpha',
    targetValue,
    effect: describeQuickMaskBrushTargetEffect(targetValue, isEraser),
  };
}

function describeQuickMaskBrushTargetEffect(targetValue: number, isEraser: boolean): string {
  if (isEraser) return 'restores selected coverage';
  if (targetValue <= 0) return 'removes selected coverage';
  if (targetValue >= 255) return 'adds selected coverage';
  return 'writes partial selected coverage';
}

function buildQuickMaskOverlayWarnings(featherPx: number): QuickMaskOverlayWarning[] {
  const warnings: QuickMaskOverlayWarning[] = [];
  if (featherPx > 0) {
    warnings.push({
      code: 'quick-mask-edge-refinement-preview-unsupported',
      severity: 'warning',
      message: 'QuickMask feather/refinement controls are reported as display metadata; this helper does not run Select & Mask edge preview.',
    });
  }
  warnings.push({
    code: 'quick-mask-richer-visualization-unsupported',
    severity: 'warning',
    message: 'Animated marching ants, rubylith blend modes, and per-channel matte preview controls are not represented by this QuickMask descriptor.',
  });
  return warnings;
}

function buildQuickMaskReadinessBlockers(
  width: number,
  height: number,
  options: QuickMaskEditingReadinessOptions,
): QuickMaskReadinessBlocker[] {
  const blockers: QuickMaskReadinessBlocker[] = [];
  if (options.hasActiveDocument === false) {
    blockers.push({
      code: 'quick-mask-no-active-document',
      severity: 'error',
      message: 'Quick Mask requires an active image document.',
    });
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    blockers.push({
      code: 'quick-mask-invalid-document-size',
      severity: 'error',
      message: 'Quick Mask requires positive document dimensions.',
    });
  }
  if ((options.operation === 'exit-mode' || options.operation === 'paint-mask') && !options.enabled) {
    blockers.push({
      code: 'quick-mask-not-active',
      severity: 'error',
      message: 'Quick Mask must be active before committing or painting the editable mask.',
    });
  }
  if (options.brush?.tool === 'backgroundEraser' || options.brush?.tool === 'magicEraser') {
    blockers.push({
      code: 'quick-mask-brush-tool-unsupported',
      severity: 'error',
      message: 'Background Eraser and Magic Eraser target pixel alpha, not the Quick Mask selection-alpha buffer.',
    });
  }
  return blockers;
}

function buildQuickMaskReadinessWarnings(
  overlayWarnings: readonly QuickMaskOverlayWarning[],
  activeChannel: QuickMaskReadinessChannel | undefined,
): QuickMaskReadinessWarning[] {
  const warnings: QuickMaskReadinessWarning[] = overlayWarnings.map((warning) => ({ ...warning }));
  warnings.push({
    code: 'quick-mask-alpha-channel-interop-warning',
    severity: 'warning',
    message: 'Quick Mask edits the transient selection alpha buffer; saved alpha channel persistence remains a separate Channels workflow.',
  });
  if (activeChannel && activeChannel !== 'selection') {
    warnings.push({
      code: 'quick-mask-direct-channel-paint-unsupported',
      severity: 'warning',
      message: 'Quick Mask brush routing overrides RGB, alpha, and spot-channel paint targets while the mode is active.',
    });
  }
  return warnings;
}

function toQuickMaskAlphaSummary(alpha: SelectionMaskAlphaSummary): QuickMaskAlphaSummary {
  return {
    transparentPixels: alpha.transparentPixels,
    partialPixels: alpha.partialPixels,
    fullPixels: alpha.fullPixels,
    averageAlpha: alpha.averageAlpha,
  };
}

function sampleQuickMaskDabStrength(dab: BrushDab, normalizedX: number, normalizedY: number): number {
  const hardEdge = clamp01(dab.hardness);
  const distance = dab.tipShape === 'square'
    ? Math.max(Math.abs(normalizedX), Math.abs(normalizedY))
    : Math.hypot(normalizedX, normalizedY);

  if (distance > 1) return 0;
  if (hardEdge >= 0.999) return 1;
  if (distance <= hardEdge) return 1;
  return clamp01(1 - ((distance - hardEdge) / Math.max(0.001, 1 - hardEdge)));
}

function parseColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().toLowerCase();
  const longHex = /^#([0-9a-f]{6})$/.exec(hex);
  if (longHex) {
    return {
      r: Number.parseInt(longHex[1].slice(0, 2), 16),
      g: Number.parseInt(longHex[1].slice(2, 4), 16),
      b: Number.parseInt(longHex[1].slice(4, 6), 16),
    };
  }

  const shortHex = /^#([0-9a-f]{3})$/.exec(hex);
  if (shortHex) {
    return {
      r: Number.parseInt(shortHex[1][0] + shortHex[1][0], 16),
      g: Number.parseInt(shortHex[1][1] + shortHex[1][1], 16),
      b: Number.parseInt(shortHex[1][2] + shortHex[1][2], 16),
    };
  }

  if (hex === 'white') return { r: 255, g: 255, b: 255 };
  if (hex === 'black') return { r: 0, g: 0, b: 0 };
  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
