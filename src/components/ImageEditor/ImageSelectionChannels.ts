import type {
  ImageChannelEditTarget,
  ImageColorChannel,
  ImageColorChannelComponent,
  ImageSavedSelectionChannel,
  ImageSpotChannel,
  SelectionMode,
} from '../../types/imageEditor';
import { cloneMask, combineMasks, type SelectionMask } from './SelectionMask';
import {
  buildImageSpotChannelPlanningDescriptor,
  buildImageSpotChannelReadinessDescriptor,
  buildImageSpotChannelWorkflowDescriptors,
  buildSpotChannelExportWarnings,
  buildImageSpotChannelExportReadinessDescriptor,
  type ImageSpotChannelReadinessIssue,
} from './ImageSpotChannels';

const MAX_SAVED_SELECTION_CHANNELS = 12;
const DEFAULT_ALPHA_CHANNEL_TINT = { r: 0, g: 174, b: 239 };
const DEFAULT_ALPHA_CHANNEL_OPACITY = 0.45;
const RGB_CHANNEL_LIMITATIONS = [
  'Direct channel painting is limited to RGB brush and eraser routing.',
  'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
];
const SAVED_ALPHA_CHANNEL_LIMITATIONS = [
  'Direct alpha-channel painting is not implemented; save or load selections instead.',
  'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
];
const SPOT_CHANNEL_PREVIEW_CAVEAT = 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.';
const SPOT_CHANNEL_DIRECT_PAINT_CAVEAT = 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.';
const COLOR_CHANNEL_COMPONENTS: Record<ImageColorChannel, ImageColorChannelComponent[]> = {
  rgb: ['red', 'green', 'blue'],
  red: ['red'],
  green: ['green'],
  blue: ['blue'],
};
const ALPHA_CHANNEL_LOAD_MODES: Array<{ mode: SelectionMode; label: string }> = [
  { mode: 'replace', label: 'Replace selection' },
  { mode: 'add', label: 'Add to selection' },
  { mode: 'subtract', label: 'Subtract from selection' },
  { mode: 'intersect', label: 'Intersect with selection' },
];

export const IMAGE_COLOR_CHANNELS: Array<{ value: ImageColorChannel; label: string }> = [
  { value: 'rgb', label: 'RGB Composite' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
];

export interface ImageChannelActionDescriptor {
  supported: boolean;
  enabled: boolean;
  label: string;
  description: string;
}

export interface ImageChannelRowActionsDescriptor {
  visibility: ImageChannelActionDescriptor;
  edit: ImageChannelActionDescriptor;
  loadSelection: ImageChannelActionDescriptor;
}

export interface ImageChannelRowDescriptor {
  id: string;
  kind: 'rgb' | 'alpha';
  source: 'color-channel' | 'saved-selection';
  channel?: ImageColorChannel;
  channelId?: string;
  label: string;
  shortLabel: string;
  detail: string;
  dimensions: string;
  active: boolean;
  components: ImageColorChannelComponent[];
  actions: ImageChannelRowActionsDescriptor;
  warnings: string[];
  limitations: string[];
}

export interface SavedSelectionChannelPreviewMetadata {
  previewKind: 'alpha-mask-overlay';
  tintColor: { r: number; g: number; b: number };
  tintCssColor: string;
  opacity: number;
  visible: boolean;
}

export interface SavedSelectionChannelManifestDescriptor {
  id: string;
  kind: 'alpha';
  source: 'saved-selection';
  name: string;
  label: string;
  index: number;
  width: number;
  height: number;
  pixelCount: number;
  byteLength: number;
  createdAt: number;
  canLoadSelection: boolean;
  canReplaceSelection: boolean;
  actions: ImageChannelRowActionsDescriptor;
  limitations: string[];
  preview: SavedSelectionChannelPreviewMetadata;
  warnings: string[];
}

export interface ImageRgbChannelTargetSummary {
  channel: ImageColorChannel;
  label: string;
  components: ImageColorChannelComponent[];
  componentCount: number;
  dimensions: string;
  pixelCount: number;
  active: boolean;
  directPaint: {
    supported: boolean;
    enabled: boolean;
    summary: string;
  };
  preview: {
    previewKind: 'rgb-channel-target';
    signature: string;
    componentSignature: string;
  };
  warnings: string[];
  limitations: string[];
}

export interface ImageChannelPaintRoutingDescriptor {
  kind: 'channel-paint-routing';
  dimensions: string;
  activeRgbChannel: ImageColorChannel;
  activeRgbComponents: ImageColorChannelComponent[];
  activeRgbRoute: {
    supported: true;
    enabled: true;
    route: 'rgb-composite' | 'rgb-component';
    paintTarget: 'active-pixel-layer';
    brushTool: 'brush';
    eraserTool: 'eraser';
    brushCompositing: 'source-over';
    eraserCompositing: 'destination-out' | 'source-over-channel-route';
    preservesAlpha: boolean;
    preservesInactiveComponents: boolean;
    summary: string;
    evidence: string[];
  };
  unsupportedTargets: {
    alpha: {
      supported: false;
      enabled: false;
      status: 'unsupported';
      fallback: 'save-or-load-selection';
      reason: string;
      availableActions: Array<'save-selection-as-alpha' | 'load-alpha-as-selection' | 'rename-alpha' | 'delete-alpha'>;
    };
    spot: {
      supported: false;
      enabled: false;
      status: 'metadata-only';
      fallback: 'selection-to-spot-metadata';
      reason: string;
      availableActions: Array<'save-selection-as-spot' | 'preview-rgb-tint' | 'edit-spot-metadata' | 'delete-spot'>;
    };
  };
  signature: string;
}

export interface ImageChannelExportReadinessDescriptor {
  targetFormat: ImageChannelPlanningExportFormat;
  alpha: {
    channelCount: number;
    status: 'none' | 'metadata-only';
    warnings: string[];
    summary: string;
  };
  spot: {
    channelCount: number;
    status: 'none' | 'metadata-only';
    warnings: string[];
    summary: string;
  };
  separation: {
    supported: false;
    status: 'metadata-only';
    warning: string;
    externalPrepressRequired: boolean;
    summary: string;
  };
  checks: ImageChannelExportReadinessCheck[];
  signature: string;
}

export type ImageChannelExportReadinessCheckCode =
  | 'alpha-export-metadata-only'
  | 'spot-export-metadata-only'
  | 'spot-external-prepress-required'
  | 'native-channel-plates-unsupported';

export interface ImageChannelExportReadinessCheck {
  code: ImageChannelExportReadinessCheckCode;
  target: 'alpha' | 'spot' | 'separation';
  severity: 'warning';
  ready: false;
  targetFormat: ImageChannelPlanningExportFormat;
  channelCount: number;
  status: 'metadata-only' | 'unsupported';
  message: string;
  signature: string;
}

export interface SelectionToSavedSelectionChannelPlan {
  operation: 'selection-to-channel';
  canApply: boolean;
  channelName: string;
  width: number;
  height: number;
  pixelCount: number;
  selectedPixelCount: number;
  coverage: number;
  summary: string;
  warnings: string[];
}

export interface AlphaChannelActionSummary {
  operation: 'selection-to-channel' | 'channel-to-selection';
  canApply: boolean;
  channelId?: string;
  channelName: string;
  mode?: SelectionMode;
  dimensions: string;
  pixelCount: number;
  selectedPixelCount: number;
  coverage: number;
  actionLabel: string;
  actionSummary: string;
  previewSignature: string;
  directPaint: {
    supported: false;
    enabled: false;
    reason: string;
  };
  printSeparation: {
    supported: false;
    warning: string;
  };
  warnings: string[];
}

export type ImageChannelPlanningExportFormat = 'source' | 'png' | 'jpeg' | 'webp' | 'psd' | 'tiff';

export interface ImageChannelPlanningDescriptor {
  kind: 'channel-planning';
  dimensions: string;
  readinessSignature: string;
  directEdit: {
    rgb: {
      supported: true;
      enabled: true;
      status: 'supported';
      activeChannel: ImageColorChannel;
      editableComponents: ImageColorChannelComponent[];
      signature: string;
      caveats: string[];
    };
    alpha: {
      supported: false;
      enabled: false;
      status: 'unsupported';
      signature: string;
      reason: string;
    };
  };
  paintRouting: ImageChannelPaintRoutingDescriptor;
  previews: Array<{
    id: string;
    kind: 'rgb' | 'alpha' | 'spot';
    signature: string;
    ready: boolean;
  }>;
  selectionExchange: {
    canSaveSelection: boolean;
    canLoadSavedSelections: boolean;
    caveats: string[];
  };
  spotChannels: {
    count: number;
    canCreateFromSelection: boolean;
    canPreview: boolean;
    caveats: string[];
  };
  printSeparation: {
    supported: false;
    status: 'metadata-only';
    warning: string;
  };
  exportReadiness: ImageChannelExportReadinessDescriptor;
  exportWarnings: string[];
}

export interface ImageChannelWorkflowPlan {
  kind: 'channel-workflow-plan';
  dimensions: string;
  policySignature: string;
  activeRgbTarget: {
    channel: ImageColorChannel;
    components: ImageColorChannelComponent[];
    directPaintSupported: boolean;
    previewSignature: string;
    editSignature: string;
    summary: string;
  };
  selectionToChannel: {
    ready: boolean;
    channelName: string;
    selectedPixelCount: number;
    pixelCount: number;
    coverage: number;
    previewSignature: string;
    summary: string;
    warnings: string[];
  };
  channelToSelection: Array<{
    channelId: string;
    channelName: string;
    mode: SelectionMode;
    ready: boolean;
    selectedPixelCount: number;
    pixelCount: number;
    coverage: number;
    previewSignature: string;
    summary: string;
    warnings: string[];
  }>;
  alphaPersistence: {
    ready: boolean;
    channelCount: number;
    maxChannels: number;
    remainingSlots: number;
    invalidChannelIds: string[];
    signature: string;
    caveats: string[];
  };
  spotChannels: {
    count: number;
    canPreview: boolean;
    previewSignatures: string[];
    caveats: string[];
    exportWarnings: string[];
  };
  directPainting: {
    rgb: {
      supported: true;
      enabled: true;
      signature: string;
    };
    alpha: {
      supported: false;
      enabled: false;
      signature: string;
      reason: string;
    };
    spot: {
      supported: false;
      enabled: false;
      signature: string;
      reason: string;
    };
  };
  previews: {
    signatures: string[];
    policySignature: string;
  };
  warnings: string[];
}

export interface BuildImageChannelWorkflowPlanInput {
  width: number;
  height: number;
  activeColorChannel?: unknown;
  currentSelection?: SelectionMask | null;
  preferredAlphaChannelName?: string;
  loadSelectionMode?: SelectionMode;
  savedSelectionChannels?: ImageSavedSelectionChannel[];
  spotChannels?: ImageSpotChannel[];
  targetFormat?: ImageChannelPlanningExportFormat;
}

export type ImageChannelReadinessIssueCode =
  | 'alpha-selection-missing'
  | 'alpha-channel-mask-invalid'
  | 'alpha-channel-size-mismatch'
  | 'alpha-channel-native-export-unsupported'
  | 'alpha-channel-export-metadata-only'
  | 'alpha-channel-direct-paint-unsupported'
  | ImageSpotChannelReadinessIssue['code'];

export interface ImageChannelReadinessIssue {
  code: ImageChannelReadinessIssueCode;
  severity: 'blocker' | 'warning';
  channelId?: string;
  message: string;
}

export interface SelectionChannelRoundTripDescriptor {
  kind: 'selection-channel-roundtrip';
  channelId: string;
  channelName: string;
  sourceDimensions: string;
  targetDimensions: string;
  pixelCount: number;
  selectedPixelCount: number;
  coverage: number;
  canRoundTrip: boolean;
  signature: string;
  blockers: ImageChannelReadinessIssue[];
  warnings: ImageChannelReadinessIssue[];
}

export interface ImageChannelReadinessDescriptor {
  kind: 'channel-readiness';
  dimensions: string;
  targetFormat: ImageChannelPlanningExportFormat;
  readinessSignature: string;
  activeRgbRouting: {
    channel: ImageColorChannel;
    route: 'composite' | 'component';
    components: ImageColorChannelComponent[];
    directPaintSupported: true;
    previewSignature: string;
    editSignature: string;
    signature: string;
    blockers: ImageChannelReadinessIssue[];
    warnings: ImageChannelReadinessIssue[];
  };
  alpha: {
    save: {
      ready: boolean;
      channelName: string;
      selectedPixelCount: number;
      pixelCount: number;
      coverage: number;
      previewSignature: string;
      signature: string;
      blockers: ImageChannelReadinessIssue[];
      warnings: ImageChannelReadinessIssue[];
    };
    load: Array<{
      channelId: string;
      channelName: string;
      mode: SelectionMode;
      ready: boolean;
      selectedPixelCount: number;
      pixelCount: number;
      coverage: number;
      previewSignature: string;
      signature: string;
      blockers: ImageChannelReadinessIssue[];
      warnings: ImageChannelReadinessIssue[];
    }>;
    persistence: {
      ready: boolean;
      channelCount: number;
      maxChannels: number;
      remainingSlots: number;
      invalidChannelIds: string[];
      signature: string;
      blockers: ImageChannelReadinessIssue[];
      warnings: ImageChannelReadinessIssue[];
    };
    roundTrip: SelectionChannelRoundTripDescriptor[];
  };
  spot: {
    channelCount: number;
    previewReady: boolean;
    previewSignatures: string[];
    readinessSignature: string;
    exportWarnings: string[];
    blockers: ImageChannelReadinessIssue[];
    warnings: ImageChannelReadinessIssue[];
  };
  directPainting: ImageChannelWorkflowPlan['directPainting'];
  stableSignatures: {
    workflow: string;
    preview: string;
    alphaPersistence: string;
    spot: string;
    directPaint: string;
  };
  blockers: ImageChannelReadinessIssue[];
  warnings: ImageChannelReadinessIssue[];
}

export interface ImageChannelSignatureDescriptor {
  kind: 'channel-signatures';
  dimensions: string;
  targetFormat: ImageChannelPlanningExportFormat;
  channelManifest: {
    rgbSignature: string;
    alphaSignature: string;
    spotSignature: string;
    signature: string;
  };
  alphaOperations: {
    saveSignature: string;
    loadSignatures: string[];
    persistenceSignature: string;
    roundTripSignature: string;
    signature: string;
  };
  spotPreviews: {
    previewKind: 'rgb-tint-preview';
    signatures: string[];
    rgbOnly: true;
    signature: string;
  };
  exportReadiness: {
    signature: string;
    checkSignatures: string[];
    limitation: {
      realSpotPlates: false;
      photoshopSeparations: false;
      cmykSpotPressReadyExport: false;
      status: 'metadata-only';
    };
  };
  paintRoutingBlockers: {
    rgbSignature: string;
    alphaSignature: string;
    spotSignature: string;
    alphaDirectPaintSupported: false;
    spotDirectPaintSupported: false;
    blockerCodes: ImageChannelReadinessIssueCode[];
    signature: string;
  };
  unsupportedStates: {
    directAlphaPainting: 'unsupported';
    directSpotPainting: 'unsupported';
    realSpotPlates: 'unsupported';
    photoshopSeparations: 'unsupported';
    cmykSpotPressReadyExport: 'unsupported';
  };
  signature: string;
}

export interface BuildAlphaChannelPanelDescriptorInput {
  documentWidth: number;
  documentHeight: number;
  savedSelectionChannels?: ImageSavedSelectionChannel[];
  selectedChannelId?: string | null;
  loadMode: SelectionMode;
  targetFormat?: ImageChannelPlanningExportFormat;
}

export interface AlphaChannelPanelActionReadinessDescriptor {
  loadSelection: {
    supported: true;
    enabled: boolean;
    mode: SelectionMode;
    selectedChannelId: string | null;
    sourceDimensions: string | null;
    targetDimensions: string;
    blockerCodes: ImageChannelReadinessIssueCode[];
    summary: string;
  };
  loadModes: AlphaChannelLoadModeDescriptor[];
  directPaint: AlphaChannelActionSummary['directPaint'];
  exportMetadata: {
    targetFormat: ImageChannelPlanningExportFormat;
    status: 'none' | 'metadata-only';
    separationSupported: false;
    warningCount: number;
    warnings: string[];
    summary: string;
  };
  signature: string;
}

export interface AlphaChannelLoadModeDescriptor {
  mode: SelectionMode;
  label: string;
  enabled: boolean;
  blockerCodes: ImageChannelReadinessIssueCode[];
  previewSignature: string;
  signature: string;
  summary: string;
}

export interface AlphaChannelPanelDescriptor {
  kind: 'alpha-channel-panel';
  channelCount: number;
  selectedChannelId: string | null;
  selectedChannelName: string | null;
  selectedDimensions: string | null;
  loadMode: SelectionMode;
  loadEnabled: boolean;
  directPaint: AlphaChannelActionSummary['directPaint'];
  printSeparation: AlphaChannelActionSummary['printSeparation'];
  actionReadiness: AlphaChannelPanelActionReadinessDescriptor;
  blockers: string[];
  warnings: string[];
  summaryLines: string[];
  signature: string;
}

export interface SavedSelectionChannelToSelectionPlan {
  operation: 'channel-to-selection';
  canApply: boolean;
  channelId: string;
  channelName: string;
  mode: SelectionMode;
  width: number;
  height: number;
  pixelCount: number;
  selectedPixelCount: number;
  coverage: number;
  summary: string;
  warnings: string[];
}

export function getActiveImageColorChannel(doc: { activeColorChannel?: unknown }): ImageColorChannel {
  return isImageColorChannel(doc.activeColorChannel) ? doc.activeColorChannel : 'rgb';
}

export function getImageChannelEditTarget(doc: { activeColorChannel?: unknown }): ImageChannelEditTarget {
  const channel = getActiveImageColorChannel(doc);
  return {
    kind: 'colorChannel',
    channel,
    components: [...COLOR_CHANNEL_COMPONENTS[channel]],
  };
}

export function buildRgbChannelTargetSummaries(doc: {
  width: number;
  height: number;
  activeColorChannel?: unknown;
}): ImageRgbChannelTargetSummary[] {
  const activeChannel = getActiveImageColorChannel(doc);
  const dimensions = formatDimensions(doc.width, doc.height);
  const pixelCount = getMaskPixelCount(doc.width, doc.height);

  return IMAGE_COLOR_CHANNELS.map((channel) => {
    const components = [...COLOR_CHANNEL_COMPONENTS[channel.value]];
    const componentSignature = components.join('+');
    const active = channel.value === activeChannel;

    return {
      channel: channel.value,
      label: channel.label,
      components,
      componentCount: components.length,
      dimensions,
      pixelCount,
      active,
      directPaint: {
        supported: true,
        enabled: true,
        summary: getRgbDirectPaintSummary(channel.value),
      },
      preview: {
        previewKind: 'rgb-channel-target',
        signature: `rgb-target:${channel.value}:${dimensions}:${componentSignature}:${active ? 'active' : 'inactive'}`,
        componentSignature,
      },
      warnings: [],
      limitations: [...RGB_CHANNEL_LIMITATIONS],
    };
  });
}

export function buildImageChannelPaintRoutingDescriptor(doc: {
  width: number;
  height: number;
  activeColorChannel?: unknown;
}): ImageChannelPaintRoutingDescriptor {
  const activeRgbChannel = getActiveImageColorChannel(doc);
  const dimensions = formatDimensions(doc.width, doc.height);
  const activeRgbComponents = [...COLOR_CHANNEL_COMPONENTS[activeRgbChannel]];
  const route = activeRgbChannel === 'rgb' ? 'rgb-composite' : 'rgb-component';
  const eraserCompositing = activeRgbChannel === 'rgb' ? 'destination-out' : 'source-over-channel-route';
  const preservesAlpha = activeRgbChannel !== 'rgb';
  const preservesInactiveComponents = activeRgbChannel !== 'rgb';

  return {
    kind: 'channel-paint-routing',
    dimensions,
    activeRgbChannel,
    activeRgbComponents,
    activeRgbRoute: {
      supported: true,
      enabled: true,
      route,
      paintTarget: 'active-pixel-layer',
      brushTool: 'brush',
      eraserTool: 'eraser',
      brushCompositing: 'source-over',
      eraserCompositing,
      preservesAlpha,
      preservesInactiveComponents,
      summary: getPaintRoutingSummary(activeRgbChannel),
      evidence: getPaintRoutingEvidence(activeRgbChannel),
    },
    unsupportedTargets: {
      alpha: {
        supported: false,
        enabled: false,
        status: 'unsupported',
        fallback: 'save-or-load-selection',
        reason: SAVED_ALPHA_CHANNEL_LIMITATIONS[0],
        availableActions: ['save-selection-as-alpha', 'load-alpha-as-selection', 'rename-alpha', 'delete-alpha'],
      },
      spot: {
        supported: false,
        enabled: false,
        status: 'metadata-only',
        fallback: 'selection-to-spot-metadata',
        reason: SPOT_CHANNEL_DIRECT_PAINT_CAVEAT,
        availableActions: ['save-selection-as-spot', 'preview-rgb-tint', 'edit-spot-metadata', 'delete-spot'],
      },
    },
    signature: `channel-paint-routing:v1:${dimensions}:${activeRgbChannel}:${activeRgbComponents.join('+')}:${route}:alpha-unsupported:spot-metadata-only`,
  };
}

export function buildImageChannelRowDescriptors(doc: {
  width: number;
  height: number;
  activeColorChannel?: unknown;
  savedSelectionChannels?: ImageSavedSelectionChannel[];
}): ImageChannelRowDescriptor[] {
  const activeChannel = getActiveImageColorChannel(doc);
  const dimensions = formatDimensions(doc.width, doc.height);
  const colorRows = IMAGE_COLOR_CHANNELS.map((channel): ImageChannelRowDescriptor => {
    const components = [...COLOR_CHANNEL_COMPONENTS[channel.value]];
    return {
      id: `color-${channel.value}`,
      kind: 'rgb',
      source: 'color-channel',
      channel: channel.value,
      label: channel.label,
      shortLabel: getColorChannelShortLabel(channel.value),
      detail: channel.value === 'rgb'
        ? 'Composite RGB preview and edit target'
        : `${channel.label} component paint target`,
      dimensions,
      active: channel.value === activeChannel,
      components,
      actions: buildRgbChannelActions(channel.value),
      warnings: [],
      limitations: [...RGB_CHANNEL_LIMITATIONS],
    };
  });

  const alphaRows = buildSavedSelectionChannelManifest(doc.savedSelectionChannels ?? []).map((channel): ImageChannelRowDescriptor => {
    const sizeMatchesDocument = channel.width === doc.width && channel.height === doc.height;
    const warnings = [...channel.warnings];
    if (channel.canLoadSelection && !sizeMatchesDocument) {
      warnings.push(`Saved alpha channel is ${channel.width}x${channel.height} but the document is ${doc.width}x${doc.height}.`);
    }

    return {
      id: `alpha-${channel.id}`,
      kind: 'alpha',
      source: 'saved-selection',
      channelId: channel.id,
      label: channel.name,
      shortLabel: 'A',
      detail: 'Saved selection alpha channel',
      dimensions: formatDimensions(channel.width, channel.height),
      active: false,
      components: [],
      actions: {
        visibility: channel.actions.visibility,
        edit: channel.actions.edit,
        loadSelection: {
          ...channel.actions.loadSelection,
          enabled: channel.actions.loadSelection.enabled && sizeMatchesDocument,
          description: getSavedAlphaLoadSelectionDescription(channel.canLoadSelection, sizeMatchesDocument),
        },
      },
      warnings,
      limitations: [...channel.limitations],
    };
  });

  return [...colorRows, ...alphaRows];
}

export function buildSavedSelectionChannel(
  mask: SelectionMask,
  existing: ImageSavedSelectionChannel[],
  preferredName?: string,
): ImageSavedSelectionChannel {
  return {
    id: `alpha-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: sanitizeSavedSelectionChannelName(preferredName) ?? getNextSavedSelectionChannelName(existing),
    width: mask.width,
    height: mask.height,
    dataBase64: encodeMaskData(mask.data),
    createdAt: Date.now(),
  };
}

export function savedSelectionChannelToMask(channel: ImageSavedSelectionChannel): SelectionMask | null {
  if (!Number.isFinite(channel.width) || channel.width <= 0 || !Number.isFinite(channel.height) || channel.height <= 0) {
    return null;
  }
  const data = decodeMaskData(channel.dataBase64);
  if (!data) return null;
  if (data.length !== channel.width * channel.height) return null;
  return {
    width: channel.width,
    height: channel.height,
    data,
  };
}

export function applySavedSelectionChannel(
  channel: ImageSavedSelectionChannel,
  currentSelection: SelectionMask | null,
  mode: SelectionMode,
): SelectionMask {
  const source = savedSelectionChannelToMask(channel);
  if (!source) {
    throw new Error('Saved alpha channel data is invalid.');
  }
  if (mode === 'replace' || !currentSelection) {
    return source;
  }
  const next = cloneMask(currentSelection);
  combineMasks(next, source, mode);
  return next;
}

export function truncateSavedSelectionChannels(channels: ImageSavedSelectionChannel[]): ImageSavedSelectionChannel[] {
  return channels.slice(-MAX_SAVED_SELECTION_CHANNELS);
}

export function buildSavedSelectionChannelManifest(
  channels: ImageSavedSelectionChannel[],
): SavedSelectionChannelManifestDescriptor[] {
  return channels.map((channel, index) => {
    const mask = savedSelectionChannelToMask(channel);
    const pixelCount = getMaskPixelCount(channel.width, channel.height);
    const warnings = mask ? [] : ['Saved alpha channel data is invalid and cannot be loaded as a selection.'];

    return {
      id: channel.id,
      kind: 'alpha',
      source: 'saved-selection',
      name: channel.name,
      label: `${channel.name} (saved selection)`,
      index,
      width: channel.width,
      height: channel.height,
      pixelCount,
      byteLength: mask?.data.length ?? 0,
      createdAt: channel.createdAt,
      canLoadSelection: Boolean(mask),
      canReplaceSelection: Boolean(mask),
      actions: buildSavedAlphaChannelActions(Boolean(mask)),
      limitations: [...SAVED_ALPHA_CHANNEL_LIMITATIONS],
      preview: buildAlphaChannelPreviewMetadata(),
      warnings,
    };
  });
}

export function planSelectionToSavedSelectionChannel(
  mask: SelectionMask,
  existing: ImageSavedSelectionChannel[],
  preferredName?: string,
): SelectionToSavedSelectionChannelPlan {
  const isValidMask = isValidSelectionMask(mask);
  const pixelCount = isValidMask ? mask.width * mask.height : 0;
  const selectedPixelCount = isValidMask ? countSelectedPixels(mask.data) : 0;
  const baseName = sanitizeSavedSelectionChannelName(preferredName) ?? getNextSavedSelectionChannelName(existing);
  const channelName = getUniqueSavedSelectionChannelName(baseName, existing);
  const warnings = isValidMask ? [] : ['Selection mask data is invalid and cannot be saved as an alpha channel.'];

  return {
    operation: 'selection-to-channel',
    canApply: warnings.length === 0,
    channelName,
    width: mask.width,
    height: mask.height,
    pixelCount,
    selectedPixelCount,
    coverage: getSelectionCoverage(selectedPixelCount, pixelCount),
    summary: warnings.length === 0
      ? `Save current selection as "${channelName}" alpha channel (${selectedPixelCount} of ${pixelCount} pixels selected).`
      : 'Selection cannot be saved as an alpha channel.',
    warnings,
  };
}

export function planSavedSelectionChannelToSelection(
  channel: ImageSavedSelectionChannel,
  mode: SelectionMode,
): SavedSelectionChannelToSelectionPlan {
  const mask = savedSelectionChannelToMask(channel);
  const pixelCount = mask ? mask.width * mask.height : getMaskPixelCount(channel.width, channel.height);
  const selectedPixelCount = mask ? countSelectedPixels(mask.data) : 0;
  const warnings = mask ? [] : ['Saved alpha channel data is invalid and cannot be loaded as a selection.'];

  return {
    operation: 'channel-to-selection',
    canApply: warnings.length === 0,
    channelId: channel.id,
    channelName: channel.name,
    mode,
    width: channel.width,
    height: channel.height,
    pixelCount,
    selectedPixelCount,
    coverage: getSelectionCoverage(selectedPixelCount, pixelCount),
    summary: warnings.length === 0
      ? `Load "${channel.name}" alpha channel into the selection using ${mode} mode (${selectedPixelCount} of ${pixelCount} pixels selected).`
      : `Cannot load "${channel.name}" alpha channel into the selection.`,
    warnings,
  };
}

export function buildSelectionToAlphaChannelActionSummary(
  mask: SelectionMask,
  existing: ImageSavedSelectionChannel[],
  preferredName?: string,
): AlphaChannelActionSummary {
  const plan = planSelectionToSavedSelectionChannel(mask, existing, preferredName);
  const dimensions = formatDimensions(plan.width, plan.height);

  return {
    operation: plan.operation,
    canApply: plan.canApply,
    channelName: plan.channelName,
    dimensions,
    pixelCount: plan.pixelCount,
    selectedPixelCount: plan.selectedPixelCount,
    coverage: plan.coverage,
    actionLabel: 'Save selection as alpha channel',
    actionSummary: plan.summary,
    previewSignature: `alpha-save:${plan.channelName}:${dimensions}:${plan.selectedPixelCount}/${plan.pixelCount}:${plan.coverage}`,
    directPaint: buildUnsupportedAlphaDirectPaintDescriptor(),
    printSeparation: buildAlphaPrintSeparationDescriptor(),
    warnings: [...plan.warnings],
  };
}

export function buildAlphaChannelLoadActionSummary(
  channel: ImageSavedSelectionChannel,
  mode: SelectionMode,
): AlphaChannelActionSummary {
  const plan = planSavedSelectionChannelToSelection(channel, mode);
  const dimensions = formatDimensions(plan.width, plan.height);

  return {
    operation: plan.operation,
    canApply: plan.canApply,
    channelId: plan.channelId,
    channelName: plan.channelName,
    mode: plan.mode,
    dimensions,
    pixelCount: plan.pixelCount,
    selectedPixelCount: plan.selectedPixelCount,
    coverage: plan.coverage,
    actionLabel: 'Load alpha channel as selection',
    actionSummary: plan.summary,
    previewSignature: `alpha-load:${plan.channelId}:${plan.mode}:${dimensions}:${plan.selectedPixelCount}/${plan.pixelCount}:${plan.coverage}`,
    directPaint: buildUnsupportedAlphaDirectPaintDescriptor(),
    printSeparation: buildAlphaPrintSeparationDescriptor(),
    warnings: [...plan.warnings],
  };
}

export function buildImageChannelExportReadinessDescriptor(input: {
  alphaChannelCount: number;
  spotChannels?: ImageSpotChannel[];
  targetFormat?: ImageChannelPlanningExportFormat;
}): ImageChannelExportReadinessDescriptor {
  const targetFormat = input.targetFormat ?? 'source';
  const spotChannels = input.spotChannels ?? [];
  const alphaWarnings = buildChannelExportWarnings(input.alphaChannelCount, targetFormat);
  const spotWarnings = buildSpotChannelExportWarnings(spotChannels, { targetFormat });
  const alphaStatus = input.alphaChannelCount > 0 ? 'metadata-only' : 'none';
  const spotStatus = spotChannels.length > 0 ? 'metadata-only' : 'none';
  const externalPrepressRequired = input.alphaChannelCount > 0 || spotChannels.length > 0;
  const separationWarning = 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.';
  const checks = buildChannelExportReadinessChecks({
    alphaChannelCount: input.alphaChannelCount,
    spotChannelCount: spotChannels.length,
    targetFormat,
    alphaWarnings,
    spotWarnings,
    separationWarning,
  });

  return {
    targetFormat,
    alpha: {
      channelCount: input.alphaChannelCount,
      status: alphaStatus,
      warnings: alphaWarnings,
      summary: getAlphaExportReadinessSummary(input.alphaChannelCount),
    },
    spot: {
      channelCount: spotChannels.length,
      status: spotStatus,
      warnings: spotWarnings,
      summary: getSpotExportReadinessSummary(spotChannels.length),
    },
    separation: {
      supported: false,
      status: 'metadata-only',
      warning: separationWarning,
      externalPrepressRequired,
      summary: externalPrepressRequired
        ? 'Native alpha/spot separations are not emitted; export carries metadata warnings only.'
        : 'No alpha or spot metadata is present for separation export.',
    },
    checks,
    signature: `channel-export-readiness:v1:${targetFormat}:alpha=${input.alphaChannelCount}:${alphaStatus}:spot=${spotChannels.length}:${spotStatus}:warnings=${alphaWarnings.length + spotWarnings.length}`,
  };
}

export function buildImageChannelPlanningDescriptor(doc: {
  width: number;
  height: number;
  activeColorChannel?: unknown;
  savedSelectionChannels?: ImageSavedSelectionChannel[];
  spotChannels?: ImageSpotChannel[];
  targetFormat?: ImageChannelPlanningExportFormat;
}): ImageChannelPlanningDescriptor {
  const activeChannel = getActiveImageColorChannel(doc);
  const dimensions = formatDimensions(doc.width, doc.height);
  const savedChannels = doc.savedSelectionChannels ?? [];
  const spotChannels = doc.spotChannels ?? [];
  const alphaManifests = buildSavedSelectionChannelManifest(savedChannels);
  const alphaIdsSignature = alphaManifests.map((channel) => channel.id).join('+') || 'none';
  const spotIdsSignature = spotChannels.map((channel) => channel.id).join('+') || 'none';
  const format = doc.targetFormat ?? 'source';
  const rgbTarget = getImageChannelEditTarget({ activeColorChannel: activeChannel });
  const paintRouting = buildImageChannelPaintRoutingDescriptor({
    width: doc.width,
    height: doc.height,
    activeColorChannel: activeChannel,
  });
  const exportReadiness = buildImageChannelExportReadinessDescriptor({
    alphaChannelCount: alphaManifests.length,
    spotChannels,
    targetFormat: format,
  });
  const colorPreviews = buildRgbChannelTargetSummaries(doc).map((channel) => ({
    id: `color-${channel.channel}`,
    kind: 'rgb' as const,
    signature: channel.preview.signature,
    ready: true,
  }));
  const alphaPreviews = alphaManifests.map((channel) => {
    const mask = savedSelectionChannelToMask(savedChannels.find((candidate) => candidate.id === channel.id) ?? {
      id: channel.id,
      name: channel.name,
      width: channel.width,
      height: channel.height,
      dataBase64: '',
      createdAt: channel.createdAt,
    });
    const selectedPixelCount = mask ? countSelectedPixels(mask.data) : 0;
    const coverage = getSelectionCoverage(selectedPixelCount, channel.pixelCount);

    return {
      id: channel.id,
      kind: 'alpha' as const,
      signature: `alpha-preview:${channel.id}:${formatDimensions(channel.width, channel.height)}:${selectedPixelCount}/${channel.pixelCount}:${coverage}`,
      ready: channel.canLoadSelection,
    };
  });
  const spotWorkflows = buildImageSpotChannelWorkflowDescriptors(spotChannels, { targetFormat: format });
  const spotPreviews = spotWorkflows.map((channel) => ({
    id: channel.id,
    kind: 'spot' as const,
    signature: channel.preview.signature,
    ready: channel.warnings.length === 0,
  }));

  return {
    kind: 'channel-planning',
    dimensions,
    readinessSignature: `channels:${dimensions}:${activeChannel}:${alphaIdsSignature}:${spotIdsSignature}:${format}`,
    directEdit: {
      rgb: {
        supported: true,
        enabled: true,
        status: 'supported',
        activeChannel,
        editableComponents: [...rgbTarget.components],
        signature: `rgb-edit:${activeChannel}:${rgbTarget.components.join('+')}:${dimensions}`,
        caveats: [RGB_CHANNEL_LIMITATIONS[0]],
      },
      alpha: {
        ...buildUnsupportedAlphaDirectPaintDescriptor(),
        status: 'unsupported',
        signature: `alpha-edit:${alphaManifests.length}:${dimensions}:unsupported`,
      },
    },
    paintRouting,
    previews: [...colorPreviews, ...alphaPreviews, ...spotPreviews],
    selectionExchange: {
      canSaveSelection: getMaskPixelCount(doc.width, doc.height) > 0,
      canLoadSavedSelections: alphaManifests.some((channel) => channel.canLoadSelection),
      caveats: [
        'Saved alpha channels are selection masks; they do not preserve editable alpha paint strokes.',
        'Loading a saved alpha channel requires dimensions that match the current document.',
      ],
    },
    spotChannels: {
      count: spotChannels.length,
      canCreateFromSelection: getMaskPixelCount(doc.width, doc.height) > 0,
      canPreview: spotWorkflows.every((channel) => channel.warnings.length === 0),
      caveats: [
        SPOT_CHANNEL_PREVIEW_CAVEAT,
        SPOT_CHANNEL_DIRECT_PAINT_CAVEAT,
      ],
    },
    printSeparation: {
      supported: false,
      status: 'metadata-only',
      warning: 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.',
    },
    exportReadiness,
    exportWarnings: [
      ...buildChannelExportWarnings(alphaManifests.length, format),
      ...buildSpotChannelExportWarnings(spotChannels, { targetFormat: format }),
    ],
  };
}

export function buildImageChannelWorkflowPlan(input: BuildImageChannelWorkflowPlanInput): ImageChannelWorkflowPlan {
  const activeChannel = getActiveImageColorChannel(input);
  const dimensions = formatDimensions(input.width, input.height);
  const format = input.targetFormat ?? 'source';
  const savedChannels = input.savedSelectionChannels ?? [];
  const spotChannels = input.spotChannels ?? [];
  const loadMode = input.loadSelectionMode ?? 'replace';
  const planning = buildImageChannelPlanningDescriptor({
    width: input.width,
    height: input.height,
    activeColorChannel: activeChannel,
    savedSelectionChannels: savedChannels,
    spotChannels,
    targetFormat: format,
  });
  const spotPlanning = buildImageSpotChannelPlanningDescriptor(spotChannels, { targetFormat: format });
  const rgbTargets = buildRgbChannelTargetSummaries({
    width: input.width,
    height: input.height,
    activeColorChannel: activeChannel,
  });
  const activeRgbTarget = rgbTargets.find((target) => target.active) ?? rgbTargets[0];
  const rgbComponents = activeRgbTarget?.components ?? [...COLOR_CHANNEL_COMPONENTS.rgb];
  const rgbPreviewSignature = activeRgbTarget?.preview.signature ?? `rgb-target:rgb:${dimensions}:red+green+blue:active`;
  const rgbEditSignature = `rgb-edit:${activeChannel}:${rgbComponents.join('+')}:${dimensions}`;
  const selectionToChannel = buildWorkflowSelectionToChannelSummary(
    input.currentSelection,
    savedChannels,
    input.preferredAlphaChannelName,
    dimensions,
  );
  const channelToSelection = savedChannels.map((channel) => {
    const summary = buildAlphaChannelLoadActionSummary(channel, loadMode);
    return {
      channelId: channel.id,
      channelName: channel.name,
      mode: loadMode,
      ready: summary.canApply,
      selectedPixelCount: summary.selectedPixelCount,
      pixelCount: summary.pixelCount,
      coverage: summary.coverage,
      previewSignature: summary.previewSignature,
      summary: summary.actionSummary,
      warnings: [...summary.warnings],
    };
  });
  const alphaManifests = buildSavedSelectionChannelManifest(savedChannels);
  const invalidChannelIds = alphaManifests
    .filter((channel) => !channel.canLoadSelection)
    .map((channel) => channel.id);
  const alphaPersistenceSignature = buildAlphaPersistenceSignature(alphaManifests.length, invalidChannelIds, savedChannels);
  const previewSignatures = planning.previews.map((preview) => preview.signature);
  const alphaSignature = buildAlphaWorkflowPolicySignature(savedChannels);
  const spotSignature = buildSpotWorkflowPolicySignature(spotPlanning.channels);

  return {
    kind: 'channel-workflow-plan',
    dimensions,
    policySignature: [
      'channel-workflow:v1',
      `doc=${dimensions}`,
      `active=${activeChannel}`,
      `format=${format}`,
      `selection=${buildSelectionWorkflowPolicySignature(input.currentSelection)}`,
      `alpha=${alphaSignature}`,
      `spot=${spotSignature}`,
    ].join('|'),
    activeRgbTarget: {
      channel: activeChannel,
      components: [...rgbComponents],
      directPaintSupported: true,
      previewSignature: rgbPreviewSignature,
      editSignature: rgbEditSignature,
      summary: activeRgbTarget?.directPaint.summary ?? getRgbDirectPaintSummary(activeChannel),
    },
    selectionToChannel,
    channelToSelection,
    alphaPersistence: {
      ready: invalidChannelIds.length === 0,
      channelCount: alphaManifests.length,
      maxChannels: MAX_SAVED_SELECTION_CHANNELS,
      remainingSlots: Math.max(0, MAX_SAVED_SELECTION_CHANNELS - alphaManifests.length),
      invalidChannelIds,
      signature: alphaPersistenceSignature,
      caveats: [
        'Saved alpha channels persist as Sloom Studio document metadata.',
        'Native alpha-channel export and direct alpha painting are not implemented.',
      ],
    },
    spotChannels: {
      count: spotPlanning.channelCount,
      canPreview: spotPlanning.channels.every((channel) => channel.ready),
      previewSignatures: spotPlanning.channels.map((channel) => channel.previewSignature),
      caveats: [
        SPOT_CHANNEL_PREVIEW_CAVEAT,
        SPOT_CHANNEL_DIRECT_PAINT_CAVEAT,
        spotPlanning.printSeparation.warning,
      ],
      exportWarnings: [...spotPlanning.exportWarnings],
    },
    directPainting: {
      rgb: {
        supported: true,
        enabled: true,
        signature: rgbEditSignature,
      },
      alpha: {
        supported: false,
        enabled: false,
        signature: planning.directEdit.alpha.signature,
        reason: planning.directEdit.alpha.reason,
      },
      spot: {
        supported: false,
        enabled: false,
        signature: spotPlanning.directPaint.signature,
        reason: spotPlanning.directPaint.reason,
      },
    },
    previews: {
      signatures: previewSignatures,
      policySignature: `preview-policy:${dimensions}:${activeChannel}:${alphaManifests.map((channel) => channel.id).join('+') || 'none'}:${spotPlanning.channels.map((channel) => channel.id).join('+') || 'none'}:${format}`,
    },
    warnings: [...planning.exportWarnings],
  };
}

export function buildSelectionChannelRoundTripDescriptor(
  channel: ImageSavedSelectionChannel,
  targetDimensions?: { width: number; height: number },
): SelectionChannelRoundTripDescriptor {
  const mask = savedSelectionChannelToMask(channel);
  const sourceDimensions = formatDimensions(channel.width, channel.height);
  const targetWidth = targetDimensions?.width ?? channel.width;
  const targetHeight = targetDimensions?.height ?? channel.height;
  const targetDimensionsLabel = formatDimensions(targetWidth, targetHeight);
  const pixelCount = mask ? mask.width * mask.height : getMaskPixelCount(channel.width, channel.height);
  const selectedPixelCount = mask ? countSelectedPixels(mask.data) : 0;
  const coverage = getSelectionCoverage(selectedPixelCount, pixelCount);
  const blockers: ImageChannelReadinessIssue[] = [];

  if (!mask) {
    blockers.push({
      code: 'alpha-channel-mask-invalid',
      severity: 'blocker',
      channelId: channel.id,
      message: `Saved alpha channel "${channel.name}" data is invalid and cannot round-trip as a selection channel.`,
    });
  } else if (channel.width !== targetWidth || channel.height !== targetHeight) {
    blockers.push({
      code: 'alpha-channel-size-mismatch',
      severity: 'blocker',
      channelId: channel.id,
      message: `Saved alpha channel "${channel.name}" is ${sourceDimensions} but the active document is ${targetDimensionsLabel}.`,
    });
  }

  const canRoundTrip = blockers.length === 0;

  return {
    kind: 'selection-channel-roundtrip',
    channelId: channel.id,
    channelName: channel.name,
    sourceDimensions,
    targetDimensions: targetDimensionsLabel,
    pixelCount,
    selectedPixelCount,
    coverage,
    canRoundTrip,
    signature: `selection-channel-roundtrip:${channel.id}:${sourceDimensions}:${targetDimensionsLabel}:${selectedPixelCount}/${pixelCount}:${coverage}:${canRoundTrip ? 'ready' : 'blocked'}`,
    blockers,
    warnings: [],
  };
}

export function buildImageChannelReadinessDescriptor(
  input: BuildImageChannelWorkflowPlanInput,
): ImageChannelReadinessDescriptor {
  const format = input.targetFormat ?? 'source';
  const workflow = buildImageChannelWorkflowPlan({ ...input, targetFormat: format });
  const savedChannels = input.savedSelectionChannels ?? [];
  const spotChannels = input.spotChannels ?? [];
  const spotReadiness = buildImageSpotChannelReadinessDescriptor(spotChannels, { targetFormat: format });
  const activeRgbRouting = {
    channel: workflow.activeRgbTarget.channel,
    route: workflow.activeRgbTarget.channel === 'rgb' ? 'composite' as const : 'component' as const,
    components: [...workflow.activeRgbTarget.components],
    directPaintSupported: true as const,
    previewSignature: workflow.activeRgbTarget.previewSignature,
    editSignature: workflow.activeRgbTarget.editSignature,
    signature: `rgb-route:${workflow.activeRgbTarget.channel}:${workflow.activeRgbTarget.components.join('+')}:${workflow.dimensions}:${workflow.activeRgbTarget.editSignature}`,
    blockers: [] as ImageChannelReadinessIssue[],
    warnings: [] as ImageChannelReadinessIssue[],
  };
  const alphaSaveBlockers = workflow.selectionToChannel.ready
    ? []
    : buildAlphaSaveBlockers(workflow.selectionToChannel);
  const alphaSave = {
    ready: workflow.selectionToChannel.ready,
    channelName: workflow.selectionToChannel.channelName,
    selectedPixelCount: workflow.selectionToChannel.selectedPixelCount,
    pixelCount: workflow.selectionToChannel.pixelCount,
    coverage: workflow.selectionToChannel.coverage,
    previewSignature: workflow.selectionToChannel.previewSignature,
    signature: `${workflow.selectionToChannel.previewSignature}:${workflow.selectionToChannel.ready ? 'ready' : 'blocked'}`,
    blockers: alphaSaveBlockers,
    warnings: [] as ImageChannelReadinessIssue[],
  };
  const alphaLoad = workflow.channelToSelection.map((summary) => {
    const channel = savedChannels.find((candidate) => candidate.id === summary.channelId);
    const blockers = buildAlphaLoadBlockers(summary, channel, input.width, input.height);
    return {
      channelId: summary.channelId,
      channelName: summary.channelName,
      mode: summary.mode,
      ready: blockers.length === 0,
      selectedPixelCount: summary.selectedPixelCount,
      pixelCount: summary.pixelCount,
      coverage: summary.coverage,
      previewSignature: summary.previewSignature,
      signature: `${summary.previewSignature}:${blockers.length === 0 ? 'ready' : 'blocked'}`,
      blockers,
      warnings: [] as ImageChannelReadinessIssue[],
    };
  });
  const roundTrip = savedChannels.map((channel) => (
    buildSelectionChannelRoundTripDescriptor(channel, { width: input.width, height: input.height })
  ));
  const alphaPersistenceBlockers = roundTrip
    .filter((channel) => !channel.canRoundTrip)
    .flatMap((channel) => channel.blockers);
  const alphaPersistenceWarnings = savedChannels.length > 0
    ? [{
        code: 'alpha-channel-native-export-unsupported' as const,
        severity: 'warning' as const,
        message: 'Native alpha-channel export and direct alpha painting are not implemented.',
      }]
    : [];
  const alphaExportWarnings = buildChannelExportWarnings(savedChannels.length, format).map((message): ImageChannelReadinessIssue => ({
    code: 'alpha-channel-export-metadata-only',
    severity: 'warning',
    message,
  }));
  const alphaDirectPaintWarning: ImageChannelReadinessIssue = {
    code: 'alpha-channel-direct-paint-unsupported',
    severity: 'warning',
    message: workflow.directPainting.alpha.reason,
  };
  const spotBlockers = spotReadiness.blockers.map(mapSpotReadinessIssue);
  const spotWarnings = spotReadiness.warnings.map(mapSpotReadinessIssue);
  const directPaintSignature = [
    workflow.directPainting.rgb.signature,
    workflow.directPainting.alpha.signature,
    workflow.directPainting.spot.signature,
  ].join('|');
  const stableSignatures = {
    workflow: workflow.policySignature,
    preview: workflow.previews.policySignature,
    alphaPersistence: workflow.alphaPersistence.signature,
    spot: spotReadiness.readinessSignature,
    directPaint: `direct-paint:${directPaintSignature}`,
  };
  const blockers = [
    ...alphaSave.blockers,
    ...alphaLoad.flatMap((channel) => channel.blockers),
    ...alphaPersistenceBlockers,
    ...spotBlockers,
  ];
  const warnings = [
    ...alphaPersistenceWarnings,
    ...alphaExportWarnings,
    alphaDirectPaintWarning,
    ...spotWarnings,
  ];

  return {
    kind: 'channel-readiness',
    dimensions: workflow.dimensions,
    targetFormat: format,
    readinessSignature: `channel-readiness:v1|workflow=${workflow.policySignature}|spot=${spotReadiness.readinessSignature}`,
    activeRgbRouting,
    alpha: {
      save: alphaSave,
      load: alphaLoad,
      persistence: {
        ready: alphaPersistenceBlockers.length === 0,
        channelCount: workflow.alphaPersistence.channelCount,
        maxChannels: workflow.alphaPersistence.maxChannels,
        remainingSlots: workflow.alphaPersistence.remainingSlots,
        invalidChannelIds: [...workflow.alphaPersistence.invalidChannelIds],
        signature: workflow.alphaPersistence.signature,
        blockers: alphaPersistenceBlockers,
        warnings: alphaPersistenceWarnings,
      },
      roundTrip,
    },
    spot: {
      channelCount: spotReadiness.channelCount,
      previewReady: spotReadiness.preview.ready,
      previewSignatures: [...spotReadiness.preview.previewSignatures],
      readinessSignature: spotReadiness.readinessSignature,
      exportWarnings: [...spotReadiness.export.warnings],
      blockers: spotBlockers,
      warnings: spotWarnings,
    },
    directPainting: workflow.directPainting,
    stableSignatures,
    blockers,
    warnings,
  };
}

export function buildImageChannelSignatureDescriptor(
  input: BuildImageChannelWorkflowPlanInput,
): ImageChannelSignatureDescriptor {
  const format = input.targetFormat ?? 'source';
  const dimensions = formatDimensions(input.width, input.height);
  const activeChannel = getActiveImageColorChannel(input);
  const savedChannels = input.savedSelectionChannels ?? [];
  const spotChannels = input.spotChannels ?? [];
  const workflow = buildImageChannelWorkflowPlan({ ...input, targetFormat: format });
  const readiness = buildImageChannelReadinessDescriptor({ ...input, targetFormat: format });
  const spotExportReadiness = buildImageSpotChannelExportReadinessDescriptor(spotChannels, {
    targetFormat: format,
    documentWidth: input.width,
    documentHeight: input.height,
  });
  const rgbSignature = `rgb-manifest:${dimensions}:active=${activeChannel}:channels=rgb+red+green+blue`;
  const alphaManifestSignature = buildAlphaManifestSignature(savedChannels);
  const spotManifestSignature = buildSpotManifestSignature(spotExportReadiness.preview.signatures, spotChannels);
  const channelManifestSignature = `channel-manifest:v1:${dimensions}:${activeChannel}:${alphaManifestSignature}:${spotManifestSignature}`;
  const alphaLoadSignatures = readiness.alpha.load.map((load) => load.signature);
  const alphaRoundTripSignature = `alpha-roundtrip:${
    readiness.alpha.roundTrip.map((channel) => `${channel.channelId}:${channel.canRoundTrip ? 'ready' : 'blocked'}`).join('+') || 'none'
  }`;
  const alphaOperationsSignature = [
    'alpha-operations:v1',
    readiness.alpha.save.previewSignature,
    alphaLoadSignatures.join('+') || 'none',
    readiness.alpha.persistence.signature,
    alphaRoundTripSignature,
  ].join(':');
  const exportReadiness = buildImageChannelExportReadinessDescriptor({
    alphaChannelCount: savedChannels.length,
    spotChannels,
    targetFormat: format,
  });
  const blockerCodes = uniqueReadinessIssueCodes([
    ...readiness.alpha.load.flatMap((load) => load.blockers),
    ...readiness.alpha.persistence.blockers,
    ...readiness.spot.blockers,
  ]);
  const paintRoutingBlockersSignature = [
    'paint-routing-blockers:v1',
    workflow.directPainting.rgb.signature,
    workflow.directPainting.alpha.signature,
    workflow.directPainting.spot.signature,
    blockerCodes.join('+') || 'none',
  ].join(':');
  const spotPreviewSignature = `spot-previews:v1:${spotExportReadiness.preview.signatures.join('+') || 'none'}`;

  return {
    kind: 'channel-signatures',
    dimensions,
    targetFormat: format,
    channelManifest: {
      rgbSignature,
      alphaSignature: `alpha-manifest:${alphaManifestSignature}`,
      spotSignature: `spot-manifest:${spotManifestSignature}`,
      signature: channelManifestSignature,
    },
    alphaOperations: {
      saveSignature: readiness.alpha.save.previewSignature,
      loadSignatures: alphaLoadSignatures,
      persistenceSignature: readiness.alpha.persistence.signature,
      roundTripSignature: alphaRoundTripSignature,
      signature: alphaOperationsSignature,
    },
    spotPreviews: {
      previewKind: 'rgb-tint-preview',
      signatures: [...spotExportReadiness.preview.signatures],
      rgbOnly: true,
      signature: spotPreviewSignature,
    },
    exportReadiness: {
      signature: exportReadiness.signature,
      checkSignatures: exportReadiness.checks.map((check) => check.signature),
      limitation: {
        realSpotPlates: false,
        photoshopSeparations: false,
        cmykSpotPressReadyExport: false,
        status: 'metadata-only',
      },
    },
    paintRoutingBlockers: {
      rgbSignature: workflow.directPainting.rgb.signature,
      alphaSignature: workflow.directPainting.alpha.signature,
      spotSignature: workflow.directPainting.spot.signature,
      alphaDirectPaintSupported: false,
      spotDirectPaintSupported: false,
      blockerCodes,
      signature: paintRoutingBlockersSignature,
    },
    unsupportedStates: {
      directAlphaPainting: 'unsupported',
      directSpotPainting: 'unsupported',
      realSpotPlates: 'unsupported',
      photoshopSeparations: 'unsupported',
      cmykSpotPressReadyExport: 'unsupported',
    },
    signature: [
      'channel-signatures:v1',
      channelManifestSignature,
      alphaOperationsSignature,
      spotPreviewSignature,
      exportReadiness.signature,
      paintRoutingBlockersSignature,
    ].join('|'),
  };
}

export function buildAlphaChannelPanelDescriptor(
  input: BuildAlphaChannelPanelDescriptorInput,
): AlphaChannelPanelDescriptor {
  const format = input.targetFormat ?? 'source';
  const savedChannels = input.savedSelectionChannels ?? [];
  const selectedChannel = savedChannels.find((channel) => channel.id === input.selectedChannelId) ?? null;
  const selectedManifest = selectedChannel
    ? buildSavedSelectionChannelManifest([selectedChannel])[0] ?? null
    : null;
  const loadBlockerIssues = selectedChannel
    ? buildAlphaLoadBlockers(
        {
          channelId: selectedChannel.id,
          channelName: selectedChannel.name,
          mode: input.loadMode,
          ready: true,
          selectedPixelCount: 0,
          pixelCount: getMaskPixelCount(selectedChannel.width, selectedChannel.height),
          coverage: 0,
          previewSignature: `alpha-load:${selectedChannel.id}:${input.loadMode}:${formatDimensions(selectedChannel.width, selectedChannel.height)}:0/${getMaskPixelCount(selectedChannel.width, selectedChannel.height)}:0`,
          summary: '',
          warnings: [],
        },
        selectedChannel,
        input.documentWidth,
        input.documentHeight,
      )
    : [];
  const blockers = loadBlockerIssues.map((issue) => issue.message);
  const sizeMismatch = blockers.some((message) => message.includes('active document'));
  const warnings = buildChannelExportWarnings(savedChannels.length, format);
  const loadEnabled = Boolean(selectedManifest?.actions.loadSelection.enabled) && blockers.length === 0;
  const actionReadiness = buildAlphaChannelPanelActionReadinessDescriptor({
    selectedChannel,
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    loadMode: input.loadMode,
    loadEnabled,
    loadBlockerIssues,
    savedChannelCount: savedChannels.length,
    targetFormat: format,
    exportWarnings: warnings,
  });
  const summaryLines = [
    selectedManifest?.actions.visibility.description
      ?? 'Saved alpha channels expose preview metadata only; independent channel visibility toggles are not implemented.',
    'Direct alpha painting is unavailable; save or load selections instead.',
    sizeMismatch
      ? 'Load selection is blocked until the saved alpha channel matches the active document dimensions.'
      : (selectedManifest?.actions.loadSelection.description ?? 'Load this alpha channel into the current selection.'),
    buildAlphaPrintSeparationDescriptor().warning,
  ];

  return {
    kind: 'alpha-channel-panel',
    channelCount: savedChannels.length,
    selectedChannelId: selectedChannel?.id ?? null,
    selectedChannelName: selectedChannel?.name ?? null,
    selectedDimensions: selectedChannel ? formatDimensions(selectedChannel.width, selectedChannel.height) : null,
    loadMode: input.loadMode,
    loadEnabled,
    directPaint: buildUnsupportedAlphaDirectPaintDescriptor(),
    printSeparation: buildAlphaPrintSeparationDescriptor(),
    actionReadiness,
    blockers,
    warnings,
    summaryLines,
    signature: `alpha-channel-panel:v1:${formatDimensions(input.documentWidth, input.documentHeight)}:${input.loadMode}:${selectedChannel?.id ?? 'none'}:${loadEnabled ? 'ready' : 'blocked'}:${sizeMismatch ? 'size-mismatch' : 'none'}:${format}`,
  };
}

function buildAlphaChannelPanelActionReadinessDescriptor(input: {
  selectedChannel: ImageSavedSelectionChannel | null;
  documentWidth: number;
  documentHeight: number;
  loadMode: SelectionMode;
  loadEnabled: boolean;
  loadBlockerIssues: ImageChannelReadinessIssue[];
  savedChannelCount: number;
  targetFormat: ImageChannelPlanningExportFormat;
  exportWarnings: string[];
}): AlphaChannelPanelActionReadinessDescriptor {
  const sourceDimensions = input.selectedChannel
    ? formatDimensions(input.selectedChannel.width, input.selectedChannel.height)
    : null;
  const targetDimensions = formatDimensions(input.documentWidth, input.documentHeight);
  const blockerCodes = input.loadBlockerIssues.map((issue) => issue.code);
  const exportStatus = input.savedChannelCount > 0 ? 'metadata-only' : 'none';

  return {
    loadSelection: {
      supported: true,
      enabled: input.loadEnabled,
      mode: input.loadMode,
      selectedChannelId: input.selectedChannel?.id ?? null,
      sourceDimensions,
      targetDimensions,
      blockerCodes,
      summary: getAlphaPanelLoadSelectionSummary(
        input.selectedChannel,
        input.loadEnabled,
        input.loadBlockerIssues,
        targetDimensions,
        input.loadMode,
      ),
    },
    loadModes: buildAlphaChannelLoadModeDescriptors({
      selectedChannel: input.selectedChannel,
      documentWidth: input.documentWidth,
      documentHeight: input.documentHeight,
    }),
    directPaint: buildUnsupportedAlphaDirectPaintDescriptor(),
    exportMetadata: {
      targetFormat: input.targetFormat,
      status: exportStatus,
      separationSupported: false,
      warningCount: input.exportWarnings.length,
      warnings: [...input.exportWarnings],
      summary: getAlphaExportReadinessSummary(input.savedChannelCount),
    },
    signature: `alpha-channel-panel-actions:v1:${targetDimensions}:${input.loadMode}:${input.selectedChannel?.id ?? 'none'}:${input.loadEnabled ? 'ready' : 'blocked'}:${blockerCodes.join('+') || 'none'}:${input.targetFormat}:${exportStatus}`,
  };
}

export function sanitizeSavedSelectionChannelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function isPlausibleSavedSelectionChannelData(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}

function getNextSavedSelectionChannelName(existing: ImageSavedSelectionChannel[]): string {
  let index = 1;
  const names = new Set(existing.map((channel) => channel.name));
  while (names.has(`Alpha ${index}`)) {
    index += 1;
  }
  return `Alpha ${index}`;
}

function getUniqueSavedSelectionChannelName(preferredName: string, existing: ImageSavedSelectionChannel[]): string {
  const names = new Set(existing.map((channel) => channel.name));
  if (!names.has(preferredName)) return preferredName;
  let index = 2;
  while (names.has(`${preferredName} ${index}`)) {
    index += 1;
  }
  return `${preferredName} ${index}`;
}

function isImageColorChannel(value: unknown): value is ImageColorChannel {
  return value === 'rgb' || value === 'red' || value === 'green' || value === 'blue';
}

function buildAlphaChannelPreviewMetadata(): SavedSelectionChannelPreviewMetadata {
  return {
    previewKind: 'alpha-mask-overlay',
    tintColor: { ...DEFAULT_ALPHA_CHANNEL_TINT },
    tintCssColor: formatRgbCss(DEFAULT_ALPHA_CHANNEL_TINT),
    opacity: DEFAULT_ALPHA_CHANNEL_OPACITY,
    visible: true,
  };
}

function isValidSelectionMask(mask: SelectionMask): boolean {
  return Number.isInteger(mask.width)
    && mask.width > 0
    && Number.isInteger(mask.height)
    && mask.height > 0
    && mask.data.length === mask.width * mask.height;
}

function getMaskPixelCount(width: number, height: number): number {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) return 0;
  return width * height;
}

function countSelectedPixels(data: Uint8ClampedArray): number {
  let selected = 0;
  for (const value of data) {
    if (value > 0) selected += 1;
  }
  return selected;
}

function getSelectionCoverage(selectedPixelCount: number, pixelCount: number): number {
  if (pixelCount <= 0) return 0;
  return Math.round((selectedPixelCount / pixelCount) * 10000) / 10000;
}

function formatRgbCss(color: { r: number; g: number; b: number }): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function formatDimensions(width: number, height: number): string {
  return `${width}x${height}`;
}

function getColorChannelShortLabel(channel: ImageColorChannel): string {
  switch (channel) {
    case 'rgb':
      return 'RGB';
    case 'red':
      return 'R';
    case 'green':
      return 'G';
    case 'blue':
      return 'B';
  }
}

function buildRgbChannelActions(channel: ImageColorChannel): ImageChannelRowActionsDescriptor {
  const label = IMAGE_COLOR_CHANNELS.find((candidate) => candidate.value === channel)?.label ?? 'RGB Composite';
  return {
    visibility: {
      supported: false,
      enabled: false,
      label: channel === 'rgb' ? 'Composite visibility fixed' : 'Component visibility fixed',
      description: channel === 'rgb'
        ? 'The RGB composite stays visible; independent channel visibility toggles are not implemented.'
        : `Selecting ${label} changes the edit target; independent channel visibility toggles are not implemented.`,
    },
    edit: {
      supported: true,
      enabled: true,
      label: channel === 'rgb' ? 'Edit RGB composite' : `Edit ${label} channel`,
      description: channel === 'rgb'
        ? 'Brush and eraser strokes affect red, green, and blue components.'
        : `Brush and eraser strokes affect only the ${label.toLowerCase()} component.`,
    },
    loadSelection: {
      supported: false,
      enabled: false,
      label: 'Load selection unavailable',
      description: 'RGB color channels cannot be loaded as saved selection masks.',
    },
  };
}

function buildSavedAlphaChannelActions(canLoadSelection: boolean): ImageChannelRowActionsDescriptor {
  return {
    visibility: {
      supported: false,
      enabled: false,
      label: 'Preview alpha overlay',
      description: 'Saved alpha channels expose preview metadata only; independent channel visibility toggles are not implemented.',
    },
    edit: {
      supported: false,
      enabled: false,
      label: 'Direct alpha painting unavailable',
      description: 'Saved alpha channels can be renamed, deleted, or loaded as selections, but cannot be painted directly.',
    },
    loadSelection: {
      supported: true,
      enabled: canLoadSelection,
      label: 'Load as selection',
      description: getSavedAlphaLoadSelectionDescription(canLoadSelection, true),
    },
  };
}

function getRgbDirectPaintSummary(channel: ImageColorChannel): string {
  if (channel === 'rgb') return 'Brush and eraser strokes affect red, green, and blue components.';
  return `Brush and eraser strokes affect only the ${channel} component.`;
}

function getPaintRoutingSummary(channel: ImageColorChannel): string {
  if (channel === 'rgb') {
    return 'Brush strokes affect red, green, and blue; eraser clears pixel alpha on the RGB composite.';
  }
  return `Brush and eraser strokes route to the ${channel} component and preserve ${formatInactiveChannelList(channel)} and alpha.`;
}

function getPaintRoutingEvidence(channel: ImageColorChannel): string[] {
  if (channel === 'rgb') {
    return [
      'brushTool paints the RGB composite with source-over compositing.',
      'brushTool eraser uses destination-out on the RGB composite.',
    ];
  }
  return [
    'brushTool applies source-over paint then restores inactive RGB components.',
    'brushTool eraser uses source-over-channel-route for single RGB components.',
  ];
}

function formatInactiveChannelList(channel: ImageColorChannel): string {
  const inactive = COLOR_CHANNEL_COMPONENTS.rgb.filter((component) => component !== channel);
  return `${inactive.join(', ')},`;
}

function getAlphaExportReadinessSummary(channelCount: number): string {
  if (channelCount === 0) return 'No saved alpha channels are present for export metadata.';
  if (channelCount === 1) {
    return '1 saved alpha channel will be preserved as Sloom Studio metadata only; no native alpha plate is exported.';
  }
  return `${channelCount} saved alpha channels will be preserved as Sloom Studio metadata only; no native alpha plates are exported.`;
}

function getSpotExportReadinessSummary(channelCount: number): string {
  if (channelCount === 0) return 'No spot channels are present for export metadata.';
  if (channelCount === 1) {
    return '1 spot channel will be preserved as Sloom Studio metadata only; press-ready spot plates require external prepress.';
  }
  return `${channelCount} spot channels will be preserved as Sloom Studio metadata only; press-ready spot plates require external prepress.`;
}

function getAlphaPanelLoadSelectionSummary(
  channel: ImageSavedSelectionChannel | null,
  loadEnabled: boolean,
  blockers: ImageChannelReadinessIssue[],
  targetDimensions: string,
  mode: SelectionMode,
): string {
  if (!channel) return 'Select a saved alpha channel before loading it as a selection.';
  if (loadEnabled) return `Load "${channel.name}" into the current selection using ${mode} mode.`;
  const sourceDimensions = formatDimensions(channel.width, channel.height);
  if (blockers.some((blocker) => blocker.code === 'alpha-channel-size-mismatch')) {
    return `Load "${channel.name}" is blocked: saved alpha is ${sourceDimensions} but the active document is ${targetDimensions}.`;
  }
  if (blockers.some((blocker) => blocker.code === 'alpha-channel-mask-invalid')) {
    return `Load "${channel.name}" is blocked because the saved alpha data is invalid.`;
  }
  return `Load "${channel.name}" is unavailable.`;
}

function buildAlphaChannelLoadModeDescriptors(input: {
  selectedChannel: ImageSavedSelectionChannel | null;
  documentWidth: number;
  documentHeight: number;
}): AlphaChannelLoadModeDescriptor[] {
  if (!input.selectedChannel) return [];

  const sourceDimensions = formatDimensions(input.selectedChannel.width, input.selectedChannel.height);
  const targetDimensions = formatDimensions(input.documentWidth, input.documentHeight);

  return ALPHA_CHANNEL_LOAD_MODES.map(({ mode, label }) => {
    const action = buildAlphaChannelLoadActionSummary(input.selectedChannel as ImageSavedSelectionChannel, mode);
    const blockers = buildAlphaLoadBlockers(
      {
        channelId: action.channelId ?? input.selectedChannel!.id,
        channelName: action.channelName,
        mode,
        ready: action.canApply,
        selectedPixelCount: action.selectedPixelCount,
        pixelCount: action.pixelCount,
        coverage: action.coverage,
        previewSignature: action.previewSignature,
        summary: action.actionSummary,
        warnings: [...action.warnings],
      },
      input.selectedChannel,
      input.documentWidth,
      input.documentHeight,
    );
    const blockerCodes = blockers.map((blocker) => blocker.code);
    const enabled = action.canApply && blockerCodes.length === 0;

    return {
      mode,
      label,
      enabled,
      blockerCodes,
      previewSignature: action.previewSignature,
      signature: `alpha-load-mode:${input.selectedChannel!.id}:${mode}:${sourceDimensions}->${targetDimensions}:${enabled ? 'ready' : 'blocked'}:${blockerCodes.join('+') || 'none'}`,
      summary: getAlphaLoadModeSummary(label, enabled, blockerCodes),
    };
  });
}

function getAlphaLoadModeSummary(
  label: string,
  enabled: boolean,
  blockerCodes: ImageChannelReadinessIssueCode[],
): string {
  if (enabled) return `${label} is ready.`;
  if (blockerCodes.includes('alpha-channel-size-mismatch')) {
    return `${label} is blocked until the saved alpha channel matches the active document dimensions.`;
  }
  if (blockerCodes.includes('alpha-channel-mask-invalid')) {
    return `${label} is blocked because the saved alpha channel data is invalid.`;
  }
  return `${label} is unavailable.`;
}

function buildUnsupportedAlphaDirectPaintDescriptor(): AlphaChannelActionSummary['directPaint'] {
  return {
    supported: false,
    enabled: false,
    reason: SAVED_ALPHA_CHANNEL_LIMITATIONS[0],
  };
}

function buildAlphaPrintSeparationDescriptor(): AlphaChannelActionSummary['printSeparation'] {
  return {
    supported: false,
    warning: 'Saved alpha channels are selection masks only and do not create press-ready separations.',
  };
}

function buildAlphaSaveBlockers(
  summary: ImageChannelWorkflowPlan['selectionToChannel'],
): ImageChannelReadinessIssue[] {
  return [{
    code: 'alpha-selection-missing',
    severity: 'blocker',
    message: summary.warnings[0] ?? 'Current selection cannot be saved as an alpha channel.',
  }];
}

function buildAlphaLoadBlockers(
  summary: ImageChannelWorkflowPlan['channelToSelection'][number],
  channel: ImageSavedSelectionChannel | null | undefined,
  documentWidth: number,
  documentHeight: number,
): ImageChannelReadinessIssue[] {
  const blockers: ImageChannelReadinessIssue[] = [];
  if (!channel || !savedSelectionChannelToMask(channel)) {
    blockers.push({
      code: 'alpha-channel-mask-invalid',
      severity: 'blocker',
      channelId: summary.channelId,
      message: `Saved alpha channel "${summary.channelName}" data is invalid and cannot be loaded as a selection.`,
    });
    return blockers;
  }

  if (channel.width !== documentWidth || channel.height !== documentHeight) {
    blockers.push({
      code: 'alpha-channel-size-mismatch',
      severity: 'blocker',
      channelId: summary.channelId,
      message: `Saved alpha channel "${summary.channelName}" is ${formatDimensions(channel.width, channel.height)} but the active document is ${formatDimensions(documentWidth, documentHeight)}.`,
    });
  }

  return blockers;
}

function mapSpotReadinessIssue(issue: ImageSpotChannelReadinessIssue): ImageChannelReadinessIssue {
  return issue.channelId === undefined
    ? {
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
      }
    : {
        code: issue.code,
        severity: issue.severity,
        channelId: issue.channelId,
        message: issue.message,
      };
}

function buildAlphaManifestSignature(channels: ImageSavedSelectionChannel[]): string {
  if (channels.length === 0) return 'none';
  return buildSavedSelectionChannelManifest(channels)
    .map((channel) => `${channel.id}:${formatDimensions(channel.width, channel.height)}:${channel.canLoadSelection ? 'ready' : 'blocked'}`)
    .join('+');
}

function buildSpotManifestSignature(
  previewSignatures: string[],
  channels: ImageSpotChannel[],
): string {
  if (channels.length === 0) return 'none';
  return channels.map((channel, index) => {
    const dimensions = formatDimensions(channel.width, channel.height);
    const ready = previewSignatures[index] ? 'ready' : 'blocked';
    return `${channel.id}:${dimensions}:${ready}`;
  }).join('+');
}

function uniqueReadinessIssueCodes(issues: ImageChannelReadinessIssue[]): ImageChannelReadinessIssueCode[] {
  return Array.from(new Set(issues.map((issue) => issue.code)));
}

function buildChannelExportReadinessChecks(input: {
  alphaChannelCount: number;
  spotChannelCount: number;
  targetFormat: ImageChannelPlanningExportFormat;
  alphaWarnings: string[];
  spotWarnings: string[];
  separationWarning: string;
}): ImageChannelExportReadinessCheck[] {
  const checks: ImageChannelExportReadinessCheck[] = [];

  for (const warning of input.alphaWarnings) {
    checks.push({
      code: 'alpha-export-metadata-only',
      target: 'alpha',
      severity: 'warning',
      ready: false,
      targetFormat: input.targetFormat,
      channelCount: input.alphaChannelCount,
      status: 'metadata-only',
      message: warning,
      signature: buildChannelExportCheckSignature('alpha', input.targetFormat, input.alphaChannelCount, 'metadata-only', 'warning'),
    });
  }

  for (const warning of input.spotWarnings) {
    const isPrepressWarning = warning === 'Use an external prepress tool for final spot-color separations before print handoff.';
    checks.push({
      code: isPrepressWarning ? 'spot-external-prepress-required' : 'spot-export-metadata-only',
      target: isPrepressWarning ? 'separation' : 'spot',
      severity: 'warning',
      ready: false,
      targetFormat: input.targetFormat,
      channelCount: input.spotChannelCount,
      status: isPrepressWarning ? 'unsupported' : 'metadata-only',
      message: warning,
      signature: buildChannelExportCheckSignature(
        isPrepressWarning ? 'separation' : 'spot',
        input.targetFormat,
        input.spotChannelCount,
        isPrepressWarning ? 'unsupported' : 'metadata-only',
        'warning',
      ),
    });
  }

  const totalPlateChannels = input.alphaChannelCount + input.spotChannelCount;
  if (totalPlateChannels > 0) {
    checks.push({
      code: 'native-channel-plates-unsupported',
      target: 'separation',
      severity: 'warning',
      ready: false,
      targetFormat: input.targetFormat,
      channelCount: totalPlateChannels,
      status: 'metadata-only',
      message: input.separationWarning,
      signature: buildChannelExportCheckSignature('separation', input.targetFormat, totalPlateChannels, 'metadata-only', 'warning'),
    });
  }

  return checks;
}

function buildChannelExportCheckSignature(
  target: ImageChannelExportReadinessCheck['target'],
  targetFormat: ImageChannelPlanningExportFormat,
  channelCount: number,
  status: ImageChannelExportReadinessCheck['status'],
  severity: ImageChannelExportReadinessCheck['severity'],
): string {
  return `channel-export-check:${target}:${targetFormat}:${channelCount}:${status}:${severity}`;
}

function buildChannelExportWarnings(alphaChannelCount: number, format: ImageChannelPlanningExportFormat): string[] {
  if (alphaChannelCount === 0) return [];
  return [
    `${formatExportTarget(format)} export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.`,
  ];
}

function buildWorkflowSelectionToChannelSummary(
  selection: SelectionMask | null | undefined,
  existing: ImageSavedSelectionChannel[],
  preferredName: string | undefined,
  dimensions: string,
): ImageChannelWorkflowPlan['selectionToChannel'] {
  const fallbackName = sanitizeSavedSelectionChannelName(preferredName) ?? getNextSavedSelectionChannelName(existing);
  if (!selection) {
    return {
      ready: false,
      channelName: getUniqueSavedSelectionChannelName(fallbackName, existing),
      selectedPixelCount: 0,
      pixelCount: 0,
      coverage: 0,
      previewSignature: `alpha-save:unavailable:${dimensions}:none`,
      summary: 'No current selection mask is available to save as an alpha channel.',
      warnings: ['No current selection mask is available to save as an alpha channel.'],
    };
  }

  const summary = buildSelectionToAlphaChannelActionSummary(selection, existing, preferredName);
  return {
    ready: summary.canApply,
    channelName: summary.channelName,
    selectedPixelCount: summary.selectedPixelCount,
    pixelCount: summary.pixelCount,
    coverage: summary.coverage,
    previewSignature: summary.previewSignature,
    summary: summary.actionSummary,
    warnings: [...summary.warnings],
  };
}

function buildSelectionWorkflowPolicySignature(selection: SelectionMask | null | undefined): string {
  if (!selection || !isValidSelectionMask(selection)) return 'none';
  const pixelCount = selection.width * selection.height;
  const selectedPixelCount = countSelectedPixels(selection.data);
  return `${selectedPixelCount}/${pixelCount}:${getSelectionCoverage(selectedPixelCount, pixelCount)}`;
}

function buildAlphaWorkflowPolicySignature(channels: ImageSavedSelectionChannel[]): string {
  if (channels.length === 0) return 'none';
  return channels.map((channel) => {
    const mask = savedSelectionChannelToMask(channel);
    if (!mask) return `${channel.id}:invalid`;
    const pixelCount = mask.width * mask.height;
    const selectedPixelCount = countSelectedPixels(mask.data);
    return `${channel.id}:${selectedPixelCount}/${pixelCount}:${getSelectionCoverage(selectedPixelCount, pixelCount)}`;
  }).join('+');
}

function buildSpotWorkflowPolicySignature(
  channels: ReturnType<typeof buildImageSpotChannelPlanningDescriptor>['channels'],
): string {
  if (channels.length === 0) return 'none';
  return channels.map((channel) => channel.previewSignature.replace(/^spot-preview:/, '')).join('+');
}

function buildAlphaPersistenceSignature(
  channelCount: number,
  invalidChannelIds: string[],
  channels: ImageSavedSelectionChannel[],
): string {
  const ids = channels.map((channel) => channel.id).join('+') || 'none';
  return `alpha-persistence:${channelCount}/${MAX_SAVED_SELECTION_CHANNELS}:${ids}:${invalidChannelIds.length === 0 ? 'ready' : 'invalid'}`;
}

function formatExportTarget(format: ImageChannelPlanningExportFormat): string {
  if (format === 'source') return 'Source';
  return format.toUpperCase();
}

function getSavedAlphaLoadSelectionDescription(canLoadSelection: boolean, sizeMatchesDocument: boolean): string {
  if (!canLoadSelection) return 'Cannot load because the saved alpha channel data is invalid.';
  if (!sizeMatchesDocument) return 'Cannot load until the alpha channel dimensions match the current document.';
  return 'Load this alpha channel into the current selection.';
}

function encodeMaskData(data: Uint8ClampedArray): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    const chunk = data.subarray(index, index + chunkSize);
    for (let inner = 0; inner < chunk.length; inner += 1) {
      binary += String.fromCharCode(chunk[inner] ?? 0);
    }
  }
  return btoa(binary);
}

function decodeMaskData(value: string): Uint8ClampedArray | null {
  if (!isPlausibleSavedSelectionChannelData(value)) return null;
  try {
    const binary = atob(value);
    const data = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index);
    }
    return data;
  } catch {
    return null;
  }
}
