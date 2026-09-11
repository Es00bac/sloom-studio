import type { DocumentViewport, ImageDocument } from '../../types/imageEditor';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitToContainer,
  normalizeViewRotationDeg,
  resetViewRotation,
  rotateViewByStep,
  zoomAround,
  zoomViewportStepAroundCenter,
  type Size,
} from './viewport';

export type ImageNavigationCommand =
  | 'fit'
  | 'actual-size'
  | 'zoom-in'
  | 'zoom-out'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'reset-rotation';
export type ImageNavigationReadinessCommand = ImageNavigationCommand | 'pan';
export type ImageNavigationPointerInteraction = 'idle' | 'tool-drag';
export type ImageNavigationCommandKind = 'pan' | 'zoom' | 'fit' | 'rotation';
export type ImageNavigationCommandRoute =
  | 'viewport-pan'
  | 'viewport-fit'
  | 'viewport-actual-size'
  | 'viewport-zoom-step'
  | 'viewport-rotate-step'
  | 'viewport-rotate-reset';
export type ImageNavigationViewportTarget =
  | 'pointer-delta-pan'
  | 'document-fit-to-container'
  | 'current-center-actual-size'
  | 'container-center-zoom-step'
  | 'document-center-rotate-step'
  | 'view-rotation-reset';
export type ImageNavigationShortcutScope = 'image-editor-canvas';
export type ImageNavigationEditableTargetPolicy = 'ignore-editable-targets';
export type ImageNavigationPlatformTarget = 'desktop' | 'android-touch' | 'android-dex';

export interface ImageNavigationReadinessOptions {
  doc: Pick<ImageDocument, 'width' | 'height' | 'viewport'>;
  container: Size;
  activeTool: string;
  canvasHasFocus: boolean;
  pointerInteraction: ImageNavigationPointerInteraction;
}

export interface ImageNavigationCommandReadiness {
  command: ImageNavigationReadinessCommand;
  label: string;
  ready: boolean;
  mutatesDocument: false;
  viewportOnly: true;
}

export interface ImageNavigationCommandDescriptor {
  command: ImageNavigationReadinessCommand;
  label: string;
  kind: ImageNavigationCommandKind;
  route: ImageNavigationCommandRoute;
  viewportTarget: ImageNavigationViewportTarget;
  viewportOnly: true;
  mutatesDocument: false;
  toolbarSuitable: boolean;
  shortcutSuitable: boolean;
  actionRecordable: boolean;
  batchSuitable: boolean;
  shortcutKeys: string[];
  caveats: string[];
}

export interface ImageNavigationKeyboardShortcutReadiness {
  command: ImageNavigationReadinessCommand;
  keys: string[];
  ready: boolean;
}

export interface ImageNavigationShortcutRoute {
  command: ImageNavigationReadinessCommand;
  keys: string[];
  scope: ImageNavigationShortcutScope;
  route: ImageNavigationCommandRoute;
  ready: boolean;
  requiresCanvasFocus: true;
  ignoresEditableTargets: true;
  editableTargetPolicy: ImageNavigationEditableTargetPolicy;
  preventDefault: boolean;
  blockers: ImageNavigationReadinessBlocker['code'][];
}

export type ImageNavigationKeyboardShortcutIgnoredReason =
  | 'editable-target'
  | 'missing-modifier'
  | 'unmapped-shortcut'
  | 'shortcut-not-ready';

export interface ImageNavigationKeyboardShortcutEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;
}

export interface ImageNavigationKeyboardShortcutResolution {
  command: ImageNavigationCommand | null;
  route: ImageNavigationCommandRoute | null;
  ready: boolean;
  shouldPreventDefault: boolean;
  ignoredReason: ImageNavigationKeyboardShortcutIgnoredReason | null;
  blockers: ImageNavigationReadinessBlocker['code'][];
}

export interface ImageNavigationViewportBounds {
  minZoom: number;
  maxZoom: number;
  document: Size & { valid: boolean };
  container: Size & { valid: boolean };
  current: DocumentViewport;
  fit: DocumentViewport;
  actualSize: DocumentViewport;
}

export interface ImageNavigationFocusBehavior {
  canvasHasFocus: boolean;
  shortcutsRequireCanvasFocus: true;
  canReceiveFocus: boolean;
  focusBlockers: string[];
}

export interface ImageNavigationMixedToolCaveat {
  code: 'spacebar-temporary-hand-tool' | 'active-tool-drag-in-progress';
  severity: 'info' | 'warning';
  message: string;
}

export type ImageNavigationPanRoute = 'hand-tool' | 'spacebar-drag' | 'middle-mouse-drag';
export type ImageNavigationAffordanceSurface = 'top-toolbar' | 'floating-tool-palette' | 'canvas';
export type ImageNavigationAffordanceInput =
  | 'button'
  | 'button-pair'
  | 'tool'
  | 'keyboard-pointer-chord'
  | 'wheel'
  | 'touch-gesture';

export interface ImageNavigationMixedToolInteraction {
  stable: true;
  preservesActiveTool: true;
  temporaryHandPan: true;
  ignoresNavigationWhileToolDragActive: true;
  panRoutes: ImageNavigationPanRoute[];
  pointerCapturePolicy: 'capture-pointer-during-pan-release-on-pointerup';
  cursorPolicy: 'grab-while-panning-restore-active-tool-cursor-after-pan';
}

export interface ImageNavigationAffordanceDescriptor {
  id: string;
  label: string;
  surface: ImageNavigationAffordanceSurface;
  command: ImageNavigationReadinessCommand;
  input: ImageNavigationAffordanceInput;
  visible: boolean;
  discoverable: boolean;
}

export interface ImageNavigationReadinessBlocker {
  code: 'invalid-document-bounds' | 'invalid-container-bounds' | 'canvas-not-focused';
  severity: 'blocking' | 'warning';
  message: string;
}

export interface ImageNavigationPlatformHandoffCaveat {
  target: ImageNavigationPlatformTarget;
  severity: 'info' | 'warning';
  message: string;
}

export interface ImageNavigationActionSuitability {
  actionRecordable: true;
  batchSuitable: true;
  suitability: 'viewport-only-safe';
  reason: string;
  caveats: string[];
}

export interface ImageNavigationStableSignatures {
  viewport: string;
  commands: string;
  shortcuts: string;
  readiness: string;
}

export interface ImageNavigationReadinessDescriptor {
  ready: boolean;
  commandDescriptors: ImageNavigationCommandDescriptor[];
  commands: ImageNavigationCommandReadiness[];
  keyboardShortcuts: ImageNavigationKeyboardShortcutReadiness[];
  shortcutRouting: ImageNavigationShortcutRoute[];
  viewportBounds: ImageNavigationViewportBounds;
  focusBehavior: ImageNavigationFocusBehavior;
  mixedToolCaveats: ImageNavigationMixedToolCaveat[];
  mixedToolInteraction: ImageNavigationMixedToolInteraction;
  navigationAffordances: ImageNavigationAffordanceDescriptor[];
  platformHandoffCaveats: ImageNavigationPlatformHandoffCaveat[];
  actionSuitability: ImageNavigationActionSuitability;
  blockers: ImageNavigationReadinessBlocker[];
  stableSignatures: ImageNavigationStableSignatures;
}

const NAVIGATION_COMMANDS: readonly Omit<ImageNavigationCommandReadiness, 'ready'>[] = [
  { command: 'pan', label: 'Pan view', mutatesDocument: false, viewportOnly: true },
  { command: 'fit', label: 'Fit on screen', mutatesDocument: false, viewportOnly: true },
  { command: 'actual-size', label: '100% zoom', mutatesDocument: false, viewportOnly: true },
  { command: 'zoom-in', label: 'Zoom in', mutatesDocument: false, viewportOnly: true },
  { command: 'zoom-out', label: 'Zoom out', mutatesDocument: false, viewportOnly: true },
  { command: 'rotate-cw', label: 'Rotate view clockwise', mutatesDocument: false, viewportOnly: true },
  { command: 'rotate-ccw', label: 'Rotate view counterclockwise', mutatesDocument: false, viewportOnly: true },
  { command: 'reset-rotation', label: 'Reset view rotation', mutatesDocument: false, viewportOnly: true },
];

const NAVIGATION_COMMAND_DESCRIPTORS: readonly ImageNavigationCommandDescriptor[] = [
  {
    command: 'pan',
    label: 'Pan view',
    kind: 'pan',
    route: 'viewport-pan',
    viewportTarget: 'pointer-delta-pan',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: false,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Space+Drag', 'Middle Mouse Drag'],
    caveats: ['Temporary hand panning must not commit the Hand tool over the active paint or selection tool.'],
  },
  {
    command: 'fit',
    label: 'Fit on screen',
    kind: 'fit',
    route: 'viewport-fit',
    viewportTarget: 'document-fit-to-container',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+0', 'Cmd+0'],
    caveats: ['Fit depends on the current editor container size and should be replayed after layout restore.'],
  },
  {
    command: 'actual-size',
    label: '100% zoom',
    kind: 'zoom',
    route: 'viewport-actual-size',
    viewportTarget: 'current-center-actual-size',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+1', 'Cmd+1'],
    caveats: ['100% zoom preserves the current viewport center and does not resample document pixels.'],
  },
  {
    command: 'zoom-in',
    label: 'Zoom in',
    kind: 'zoom',
    route: 'viewport-zoom-step',
    viewportTarget: 'container-center-zoom-step',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+=', 'Cmd+=', 'Ctrl++', 'Cmd++'],
    caveats: ['Zoom steps clamp to the shared viewport maximum and should not affect document history.'],
  },
  {
    command: 'zoom-out',
    label: 'Zoom out',
    kind: 'zoom',
    route: 'viewport-zoom-step',
    viewportTarget: 'container-center-zoom-step',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+-', 'Cmd+-'],
    caveats: ['Zoom steps clamp to the shared viewport minimum and should not affect document history.'],
  },
  {
    command: 'rotate-cw',
    label: 'Rotate view clockwise',
    kind: 'rotation',
    route: 'viewport-rotate-step',
    viewportTarget: 'document-center-rotate-step',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+Shift+.', 'Cmd+Shift+.'],
    caveats: ['View rotation turns the camera around the document center in 15-degree steps and never resamples pixels.'],
  },
  {
    command: 'rotate-ccw',
    label: 'Rotate view counterclockwise',
    kind: 'rotation',
    route: 'viewport-rotate-step',
    viewportTarget: 'document-center-rotate-step',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+Shift+,', 'Cmd+Shift+,'],
    caveats: ['View rotation turns the camera around the document center in 15-degree steps and never resamples pixels.'],
  },
  {
    command: 'reset-rotation',
    label: 'Reset view rotation',
    kind: 'rotation',
    route: 'viewport-rotate-reset',
    viewportTarget: 'view-rotation-reset',
    viewportOnly: true,
    mutatesDocument: false,
    toolbarSuitable: true,
    shortcutSuitable: true,
    actionRecordable: true,
    batchSuitable: true,
    shortcutKeys: ['Ctrl+Shift+0', 'Cmd+Shift+0'],
    caveats: ['Resetting rotation keeps the current zoom and pan; it only returns the view angle to upright.'],
  },
];

const NAVIGATION_SHORTCUTS: readonly Omit<ImageNavigationKeyboardShortcutReadiness, 'ready'>[] = [
  { command: 'fit', keys: ['Ctrl+0', 'Cmd+0'] },
  { command: 'actual-size', keys: ['Ctrl+1', 'Cmd+1'] },
  { command: 'zoom-in', keys: ['Ctrl+=', 'Cmd+=', 'Ctrl++', 'Cmd++'] },
  { command: 'zoom-out', keys: ['Ctrl+-', 'Cmd+-'] },
  { command: 'rotate-cw', keys: ['Ctrl+Shift+.', 'Cmd+Shift+.'] },
  { command: 'rotate-ccw', keys: ['Ctrl+Shift+,', 'Cmd+Shift+,'] },
  { command: 'reset-rotation', keys: ['Ctrl+Shift+0', 'Cmd+Shift+0'] },
  { command: 'pan', keys: ['Space+Drag', 'Middle Mouse Drag'] },
];

export function getImageNavigationCommandDescriptors(): ImageNavigationCommandDescriptor[] {
  return NAVIGATION_COMMAND_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    shortcutKeys: [...descriptor.shortcutKeys],
    caveats: [...descriptor.caveats],
  }));
}

export function getImageNavigationShortcutRoutes(
  options: Pick<ImageNavigationReadinessDescriptor, 'keyboardShortcuts' | 'blockers'>,
): ImageNavigationShortcutRoute[] {
  const blockerCodes = options.blockers.map((blocker) => blocker.code);
  return options.keyboardShortcuts.map((shortcut) => ({
    command: shortcut.command,
    keys: [...shortcut.keys],
    scope: 'image-editor-canvas',
    route: getNavigationCommandRoute(shortcut.command),
    ready: shortcut.ready,
    requiresCanvasFocus: true,
    ignoresEditableTargets: true,
    editableTargetPolicy: 'ignore-editable-targets',
    preventDefault: shortcut.ready,
    blockers: shortcut.ready ? [] : blockerCodes,
  }));
}

export function resolveImageNavigationKeyboardShortcut(
  event: ImageNavigationKeyboardShortcutEventLike,
  readiness: Pick<ImageNavigationReadinessDescriptor, 'shortcutRouting'>,
): ImageNavigationKeyboardShortcutResolution {
  if (isEditableNavigationShortcutTarget(event.target)) {
    return makeNavigationShortcutResolution(null, null, false, 'editable-target', []);
  }
  if (!event.ctrlKey && !event.metaKey) {
    return makeNavigationShortcutResolution(null, null, false, 'missing-modifier', []);
  }

  const command = getNavigationKeyboardCommand(event.key, event.shiftKey === true);
  if (!command) {
    return makeNavigationShortcutResolution(null, null, false, 'unmapped-shortcut', []);
  }

  const route = getNavigationCommandRoute(command);
  const shortcutRoute = readiness.shortcutRouting.find((candidate) => candidate.command === command);
  const ready = shortcutRoute?.ready === true;
  const blockers = shortcutRoute?.blockers ?? [];
  return makeNavigationShortcutResolution(
    command,
    route,
    ready,
    ready ? null : 'shortcut-not-ready',
    blockers,
  );
}

export function getImageNavigationCommandViewport(
  command: ImageNavigationCommand,
  doc: Pick<ImageDocument, 'width' | 'height' | 'viewport'>,
  container: Size,
): DocumentViewport {
  switch (command) {
    case 'fit': {
      const fitted = fitToContainer({ width: doc.width, height: doc.height }, container);
      return doc.viewport.rotationDeg ? { ...fitted, rotationDeg: doc.viewport.rotationDeg } : fitted;
    }
    case 'actual-size':
      return zoomViewportToActualSize(doc.viewport, container, container);
    case 'zoom-in':
      return zoomViewportStepAroundCenter(doc.viewport, container, 'in', container);
    case 'zoom-out':
      return zoomViewportStepAroundCenter(doc.viewport, container, 'out', container);
    case 'rotate-cw':
      return rotateViewByStep(doc.viewport, 'cw');
    case 'rotate-ccw':
      return rotateViewByStep(doc.viewport, 'ccw');
    case 'reset-rotation':
      return resetViewRotation(doc.viewport);
  }
}

export function describeImageNavigationReadiness(
  options: ImageNavigationReadinessOptions,
): ImageNavigationReadinessDescriptor {
  const docSize = normalizeSize(options.doc);
  const container = normalizeSize(options.container);
  const documentValid = docSize.width > 0 && docSize.height > 0;
  const containerValid = container.width > 0 && container.height > 0;
  const current = normalizeViewport(options.doc.viewport);
  const viewportDoc = { width: docSize.width, height: docSize.height, viewport: current };
  const fit = getImageNavigationCommandViewport('fit', viewportDoc, container);
  const actualSize = getImageNavigationCommandViewport('actual-size', viewportDoc, container);
  const blockers = getNavigationReadinessBlockers(documentValid, containerValid, options.canvasHasFocus);
  const hasBlockingBlocker = blockers.some((blocker) => blocker.severity === 'blocking');
  const commands = NAVIGATION_COMMANDS.map((command): ImageNavigationCommandReadiness => ({
    ...command,
    ready: !hasBlockingBlocker,
  }));
  const keyboardShortcuts = NAVIGATION_SHORTCUTS.map((shortcut): ImageNavigationKeyboardShortcutReadiness => ({
    ...shortcut,
    ready: !hasBlockingBlocker && options.canvasHasFocus,
  }));
  const shortcutRouting = getImageNavigationShortcutRoutes({ keyboardShortcuts, blockers });
  const focusBehavior: ImageNavigationFocusBehavior = {
    canvasHasFocus: options.canvasHasFocus,
    shortcutsRequireCanvasFocus: true,
    canReceiveFocus: true,
    focusBlockers: options.canvasHasFocus ? [] : ['canvas-not-focused'],
  };
  const mixedToolCaveats = getMixedToolCaveats(options.activeTool, options.pointerInteraction);
  const mixedToolInteraction = getMixedToolInteraction();
  const navigationAffordances = getNavigationAffordances();
  const platformHandoffCaveats = getPlatformHandoffCaveats();
  const actionSuitability = getNavigationActionSuitability();
  const ready = !hasBlockingBlocker;
  const viewportBounds: ImageNavigationViewportBounds = {
    minZoom: ZOOM_MIN,
    maxZoom: ZOOM_MAX,
    document: { ...docSize, valid: documentValid },
    container: { ...container, valid: containerValid },
    current,
    fit,
    actualSize,
  };

  return {
    ready,
    commandDescriptors: getImageNavigationCommandDescriptors(),
    commands,
    keyboardShortcuts,
    shortcutRouting,
    viewportBounds,
    focusBehavior,
    mixedToolCaveats,
    mixedToolInteraction,
    navigationAffordances,
    platformHandoffCaveats,
    actionSuitability,
    blockers,
    stableSignatures: buildNavigationStableSignatures({
      ready,
      blockers,
      activeTool: options.activeTool,
      pointerInteraction: options.pointerInteraction,
      canvasHasFocus: options.canvasHasFocus,
      viewportBounds,
      commands,
      keyboardShortcuts,
      mixedToolInteraction,
      navigationAffordances,
    }),
  };
}

function getNavigationKeyboardCommand(key: string, shift: boolean): ImageNavigationCommand | null {
  const normalized = key.toLowerCase();
  if (shift) {
    if (normalized === '.') return 'rotate-cw';
    if (normalized === ',') return 'rotate-ccw';
    if (normalized === '0') return 'reset-rotation';
    return null;
  }
  if (normalized === '=' || normalized === '+') return 'zoom-in';
  if (normalized === '-' || normalized === '_') return 'zoom-out';
  if (normalized === '0') return 'fit';
  if (normalized === '1') return 'actual-size';
  return null;
}

function isEditableNavigationShortcutTarget(
  target: ImageNavigationKeyboardShortcutEventLike['target'],
): boolean {
  const tagName = target?.tagName?.toUpperCase();
  return Boolean(
    target?.isContentEditable
      || tagName === 'INPUT'
      || tagName === 'TEXTAREA'
      || tagName === 'SELECT',
  );
}

function makeNavigationShortcutResolution(
  command: ImageNavigationCommand | null,
  route: ImageNavigationCommandRoute | null,
  ready: boolean,
  ignoredReason: ImageNavigationKeyboardShortcutIgnoredReason | null,
  blockers: ImageNavigationReadinessBlocker['code'][],
): ImageNavigationKeyboardShortcutResolution {
  return {
    command,
    route,
    ready,
    shouldPreventDefault: ready,
    ignoredReason,
    blockers: [...blockers],
  };
}

function getNavigationCommandRoute(command: ImageNavigationReadinessCommand): ImageNavigationCommandRoute {
  switch (command) {
    case 'pan':
      return 'viewport-pan';
    case 'fit':
      return 'viewport-fit';
    case 'actual-size':
      return 'viewport-actual-size';
    case 'zoom-in':
    case 'zoom-out':
      return 'viewport-zoom-step';
    case 'rotate-cw':
    case 'rotate-ccw':
      return 'viewport-rotate-step';
    case 'reset-rotation':
      return 'viewport-rotate-reset';
  }
}

function getPlatformHandoffCaveats(): ImageNavigationPlatformHandoffCaveat[] {
  return [
    {
      target: 'desktop',
      severity: 'info',
      message: 'Desktop handoff should persist viewport state as editor chrome metadata only; document pixels and layer history are unchanged.',
    },
    {
      target: 'android-touch',
      severity: 'warning',
      message: 'Android touch handoff should expose pinch zoom and two-finger pan equivalents because hardware keyboard shortcuts may be unavailable.',
    },
    {
      target: 'android-dex',
      severity: 'warning',
      message: 'Android DeX handoff depends on focused canvas routing for Ctrl/Cmd shortcuts; pointer hover and middle-button pan availability vary by device.',
    },
  ];
}

function getMixedToolInteraction(): ImageNavigationMixedToolInteraction {
  return {
    stable: true,
    preservesActiveTool: true,
    temporaryHandPan: true,
    ignoresNavigationWhileToolDragActive: true,
    panRoutes: ['hand-tool', 'spacebar-drag', 'middle-mouse-drag'],
    pointerCapturePolicy: 'capture-pointer-during-pan-release-on-pointerup',
    cursorPolicy: 'grab-while-panning-restore-active-tool-cursor-after-pan',
  };
}

function getNavigationAffordances(): ImageNavigationAffordanceDescriptor[] {
  return [
    {
      id: 'toolbar-fit',
      label: 'Fit on screen',
      surface: 'top-toolbar',
      command: 'fit',
      input: 'button',
      visible: true,
      discoverable: true,
    },
    {
      id: 'toolbar-actual-size',
      label: '100% zoom',
      surface: 'top-toolbar',
      command: 'actual-size',
      input: 'button',
      visible: true,
      discoverable: true,
    },
    {
      id: 'toolbar-zoom-step',
      label: 'Zoom in / zoom out',
      surface: 'top-toolbar',
      command: 'zoom-in',
      input: 'button-pair',
      visible: true,
      discoverable: true,
    },
    {
      id: 'toolbar-rotate-step',
      label: 'Rotate view clockwise / counterclockwise',
      surface: 'top-toolbar',
      command: 'rotate-cw',
      input: 'button-pair',
      visible: true,
      discoverable: true,
    },
    {
      id: 'twist-rotate',
      label: 'Two-finger twist view rotation',
      surface: 'canvas',
      command: 'rotate-cw',
      input: 'touch-gesture',
      visible: false,
      discoverable: true,
    },
    {
      id: 'hand-tool-pan',
      label: 'Hand tool pan',
      surface: 'floating-tool-palette',
      command: 'pan',
      input: 'tool',
      visible: true,
      discoverable: true,
    },
    {
      id: 'spacebar-temporary-pan',
      label: 'Temporary hand pan',
      surface: 'canvas',
      command: 'pan',
      input: 'keyboard-pointer-chord',
      visible: false,
      discoverable: true,
    },
    {
      id: 'wheel-zoom',
      label: 'Wheel zoom',
      surface: 'canvas',
      command: 'zoom-in',
      input: 'wheel',
      visible: false,
      discoverable: true,
    },
    {
      id: 'pinch-zoom-touch-pan',
      label: 'Pinch zoom / two-finger pan',
      surface: 'canvas',
      command: 'zoom-in',
      input: 'touch-gesture',
      visible: false,
      discoverable: true,
    },
  ];
}

function getNavigationActionSuitability(): ImageNavigationActionSuitability {
  return {
    actionRecordable: true,
    batchSuitable: true,
    suitability: 'viewport-only-safe',
    reason: 'Navigation actions only update viewport metadata, so action playback and batch previews can replay them without mutating pixels, layers, masks, or sources.',
    caveats: [
      'Batch playback should apply navigation after each document opens and after layout/container sizing settles.',
      'Recorded pan positions are screen-layout dependent and should be treated as review convenience rather than export-affecting state.',
    ],
  };
}

function zoomViewportToActualSize(viewport: DocumentViewport, container: Size, view: Size): DocumentViewport {
  const safeWidth = Number.isFinite(container.width) && container.width > 0 ? container.width : 0;
  const safeHeight = Number.isFinite(container.height) && container.height > 0 ? container.height : 0;
  const anchor = { x: safeWidth / 2, y: safeHeight / 2 };
  const currentZoom = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;
  return zoomAround({ ...viewport, zoom: currentZoom }, anchor, 1 / currentZoom, view);
}

function normalizeSize(size: Size): Size {
  return {
    width: Number.isFinite(size.width) && size.width > 0 ? size.width : 0,
    height: Number.isFinite(size.height) && size.height > 0 ? size.height : 0,
  };
}

function normalizeViewport(viewport: DocumentViewport): DocumentViewport {
  const rotationDeg = Number.isFinite(viewport.rotationDeg) && viewport.rotationDeg !== 0
    ? normalizeViewRotationDeg(viewport.rotationDeg ?? 0)
    : undefined;
  return {
    zoom: clampZoom(viewport.zoom),
    panX: Number.isFinite(viewport.panX) ? viewport.panX : 0,
    panY: Number.isFinite(viewport.panY) ? viewport.panY : 0,
    ...(rotationDeg ? { rotationDeg } : {}),
  };
}

function getNavigationReadinessBlockers(
  documentValid: boolean,
  containerValid: boolean,
  canvasHasFocus: boolean,
): ImageNavigationReadinessBlocker[] {
  const blockers: ImageNavigationReadinessBlocker[] = [];
  if (!documentValid) {
    blockers.push({
      code: 'invalid-document-bounds',
      severity: 'blocking',
      message: 'Navigation needs a positive document width and height before fit or zoom targets can be trusted.',
    });
  }
  if (!containerValid) {
    blockers.push({
      code: 'invalid-container-bounds',
      severity: 'blocking',
      message: 'Navigation needs a positive canvas container width and height before viewport targets can be trusted.',
    });
  }
  if (!canvasHasFocus) {
    blockers.push({
      code: 'canvas-not-focused',
      severity: 'warning',
      message: 'Keyboard navigation shortcuts are idle until the image canvas or editor chrome has focus.',
    });
  }
  return blockers;
}

function getMixedToolCaveats(
  activeTool: string,
  pointerInteraction: ImageNavigationPointerInteraction,
): ImageNavigationMixedToolCaveat[] {
  const caveats: ImageNavigationMixedToolCaveat[] = [];
  const normalizedTool = activeTool.trim().toLowerCase();
  if (normalizedTool !== '' && normalizedTool !== 'hand') {
    caveats.push({
      code: 'spacebar-temporary-hand-tool',
      severity: 'info',
      message: `${formatToolName(activeTool)} remains the active tool; Space+Drag should temporarily pan the viewport without changing paint settings.`,
    });
  }
  if (pointerInteraction === 'tool-drag') {
    caveats.push({
      code: 'active-tool-drag-in-progress',
      severity: 'warning',
      message: 'Defer keyboard navigation until the current tool drag completes so the pointer gesture is not reinterpreted as pan or zoom.',
    });
  }
  return caveats;
}

function formatToolName(tool: string): string {
  const trimmed = tool.trim();
  if (trimmed === '') return 'The current tool';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function buildNavigationStableSignatures(input: {
  ready: boolean;
  blockers: ImageNavigationReadinessBlocker[];
  activeTool: string;
  pointerInteraction: ImageNavigationPointerInteraction;
  canvasHasFocus: boolean;
  viewportBounds: ImageNavigationViewportBounds;
  commands: ImageNavigationCommandReadiness[];
  keyboardShortcuts: ImageNavigationKeyboardShortcutReadiness[];
  mixedToolInteraction: ImageNavigationMixedToolInteraction;
  navigationAffordances: ImageNavigationAffordanceDescriptor[];
}): ImageNavigationStableSignatures {
  const commandSignature = input.commands
    .map((command) => command.command)
    .sort()
    .join(',');
  const shortcutSignature = input.keyboardShortcuts
    .map((shortcut) => `${shortcut.command}:${shortcut.keys.join('/')}`)
    .sort()
    .join('|');

  return {
    viewport: `image-navigation-viewport:v1:${JSON.stringify({
      doc: `${input.viewportBounds.document.width}x${input.viewportBounds.document.height}`,
      container: `${input.viewportBounds.container.width}x${input.viewportBounds.container.height}`,
      zoom: input.viewportBounds.current.zoom,
      panX: input.viewportBounds.current.panX,
      panY: input.viewportBounds.current.panY,
      fit: formatViewportSignature(input.viewportBounds.fit),
      actualSize: formatViewportSignature(input.viewportBounds.actualSize),
    })}`,
    commands: `image-navigation-commands:v1:${commandSignature}`,
    shortcuts: `image-navigation-shortcuts:v1:${shortcutSignature}`,
    readiness: `image-navigation-readiness:v1:${JSON.stringify({
      ready: input.ready,
      blockers: input.blockers.map((blocker) => blocker.code),
      tool: input.activeTool,
      interaction: input.pointerInteraction,
      focus: input.canvasHasFocus,
      mixedStable: input.mixedToolInteraction.stable,
      affordances: input.navigationAffordances.length,
    })}`,
  };
}

function formatViewportSignature(viewport: DocumentViewport): string {
  return `${formatSignatureNumber(viewport.zoom)}:${formatSignatureNumber(viewport.panX)}:${formatSignatureNumber(viewport.panY)}`;
}

function formatSignatureNumber(value: number): number {
  return Number(value.toFixed(4));
}
