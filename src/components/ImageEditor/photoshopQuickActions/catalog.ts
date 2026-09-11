import type { BlendMode } from '../../../types/imageEditor';
import type {
  GeneratedQuickActionDefinition,
  PhotoshopQuickAction,
  PhotoshopQuickActionCatalogSummary,
  PhotoshopQuickActionCategory,
  PhotoshopQuickActionCapabilityDescriptor,
  PhotoshopQuickActionCapabilityInput,
  PhotoshopQuickActionCapabilityOutput,
} from './types';
import { pascalCase, titleCase, titleLabel } from './utils';

export const BASE_PHOTOSHOP_QUICK_ACTIONS: PhotoshopQuickAction[] = [
  { id: 'selectLayerBounds', label: 'Select Layer Bounds', group: 'Selection' },
  { id: 'selectLayerOpaquePixels', label: 'Select Opaque Pixels', group: 'Selection' },
  { id: 'growSelection', label: 'Grow Selection', group: 'Selection' },
  { id: 'shrinkSelection', label: 'Shrink Selection', group: 'Selection' },
  { id: 'featherSelection', label: 'Feather Selection', group: 'Selection' },
  { id: 'borderSelection', label: 'Border Selection', group: 'Selection' },
  { id: 'smoothSelection', label: 'Smooth Selection', group: 'Selection' },
  { id: 'nudgeSelectionLeft', label: 'Nudge Selection Left 1 px', group: 'Selection' },
  { id: 'nudgeSelectionRight', label: 'Nudge Selection Right 1 px', group: 'Selection' },
  { id: 'nudgeSelectionUp', label: 'Nudge Selection Up 1 px', group: 'Selection' },
  { id: 'nudgeSelectionDown', label: 'Nudge Selection Down 1 px', group: 'Selection' },
  { id: 'clearOutsideSelection', label: 'Clear Outside Selection', group: 'Pixels' },
  { id: 'layerViaCopy', label: 'Layer via Copy', group: 'Layer' },
  { id: 'layerViaCut', label: 'Layer via Cut', group: 'Layer' },
  { id: 'cropLayerToSelection', label: 'Crop Layer to Selection', group: 'Layer' },
  { id: 'trimTransparentLayer', label: 'Trim Transparent Pixels', group: 'Layer' },
  { id: 'flipLayerHorizontal', label: 'Flip Layer Horizontal', group: 'Transform' },
  { id: 'flipLayerVertical', label: 'Flip Layer Vertical', group: 'Transform' },
  { id: 'rotateLayer90Clockwise', label: 'Rotate Layer 90 CW', group: 'Transform' },
  { id: 'rotateLayer90CounterClockwise', label: 'Rotate Layer 90 CCW', group: 'Transform' },
  { id: 'centerLayer', label: 'Center Layer', group: 'Transform' },
  { id: 'fitLayerToCanvas', label: 'Fit Layer to Canvas', group: 'Transform' },
  { id: 'resetLayerPosition', label: 'Reset Layer Position', group: 'Transform' },
  { id: 'trimCanvasToVisible', label: 'Trim Canvas to Visible Pixels', group: 'Canvas' },
  { id: 'selectCanvas', label: 'Select Canvas', group: 'Selection' },
  { id: 'selectLayerTransparentPixels', label: 'Select Transparent Pixels', group: 'Selection' },
  { id: 'selectSelectionBoundingBox', label: 'Select Selection Bounds', group: 'Selection' },
  { id: 'growSelectionLarge', label: 'Grow Selection 4 px', group: 'Selection' },
  { id: 'shrinkSelectionLarge', label: 'Shrink Selection 4 px', group: 'Selection' },
  { id: 'featherSelectionLarge', label: 'Feather Selection 4 px', group: 'Selection' },
  { id: 'borderSelectionLarge', label: 'Border Selection 4 px', group: 'Selection' },
  { id: 'clearSelectedPixels', label: 'Clear Selected Pixels', group: 'Pixels' },
  { id: 'duplicateLayer', label: 'Duplicate Layer', group: 'Layer' },
  { id: 'moveLayerToFront', label: 'Move Layer to Front', group: 'Layer' },
  { id: 'moveLayerToBack', label: 'Move Layer to Back', group: 'Layer' },
  { id: 'nudgeLayerLeft', label: 'Nudge Layer Left 1 px', group: 'Transform' },
  { id: 'nudgeLayerRight', label: 'Nudge Layer Right 1 px', group: 'Transform' },
  { id: 'nudgeLayerUp', label: 'Nudge Layer Up 1 px', group: 'Transform' },
  { id: 'nudgeLayerDown', label: 'Nudge Layer Down 1 px', group: 'Transform' },
  { id: 'nudgeLayerLeftLarge', label: 'Nudge Layer Left 10 px', group: 'Transform' },
  { id: 'nudgeLayerRightLarge', label: 'Nudge Layer Right 10 px', group: 'Transform' },
  { id: 'nudgeLayerUpLarge', label: 'Nudge Layer Up 10 px', group: 'Transform' },
  { id: 'nudgeLayerDownLarge', label: 'Nudge Layer Down 10 px', group: 'Transform' },
  { id: 'alignLayerLeft', label: 'Align Layer Left', group: 'Transform' },
  { id: 'alignLayerRight', label: 'Align Layer Right', group: 'Transform' },
  { id: 'alignLayerTop', label: 'Align Layer Top', group: 'Transform' },
  { id: 'alignLayerBottom', label: 'Align Layer Bottom', group: 'Transform' },
  { id: 'centerLayerHorizontal', label: 'Center Layer Horizontal', group: 'Transform' },
  { id: 'centerLayerVertical', label: 'Center Layer Vertical', group: 'Transform' },
  { id: 'fitLayerWidthToCanvas', label: 'Fit Layer Width to Canvas', group: 'Transform' },
  { id: 'fitLayerHeightToCanvas', label: 'Fit Layer Height to Canvas', group: 'Transform' },
  { id: 'invertLayerColors', label: 'Invert Layer Colors', group: 'Pixels' },
  { id: 'desaturateLayer', label: 'Desaturate Layer', group: 'Pixels' },
  { id: 'resetLayerOpacity', label: 'Reset Layer Opacity', group: 'Layer' },
  { id: 'selectTopHalf', label: 'Select Top Half', group: 'Selection' },
  { id: 'selectBottomHalf', label: 'Select Bottom Half', group: 'Selection' },
  { id: 'selectLeftHalf', label: 'Select Left Half', group: 'Selection' },
  { id: 'selectRightHalf', label: 'Select Right Half', group: 'Selection' },
  { id: 'selectCenterSquare', label: 'Select Center Square', group: 'Selection' },
  { id: 'selectHorizontalCenterBand', label: 'Select Horizontal Center Band', group: 'Selection' },
  { id: 'selectVerticalCenterBand', label: 'Select Vertical Center Band', group: 'Selection' },
  { id: 'setLayerOpacity25', label: 'Layer Opacity 25%', group: 'Layer' },
  { id: 'setLayerOpacity50', label: 'Layer Opacity 50%', group: 'Layer' },
  { id: 'setLayerOpacity75', label: 'Layer Opacity 75%', group: 'Layer' },
  { id: 'setLayerBlendNormal', label: 'Blend Mode Normal', group: 'Layer' },
  { id: 'setLayerBlendMultiply', label: 'Blend Mode Multiply', group: 'Layer' },
  { id: 'setLayerBlendScreen', label: 'Blend Mode Screen', group: 'Layer' },
  { id: 'setLayerBlendOverlay', label: 'Blend Mode Overlay', group: 'Layer' },
  { id: 'rotateLayer180', label: 'Rotate Layer 180', group: 'Transform' },
  { id: 'raiseLayerOneStep', label: 'Raise Layer One Step', group: 'Layer' },
  { id: 'lowerLayerOneStep', label: 'Lower Layer One Step', group: 'Layer' },
  { id: 'fitLayerInsideCanvas', label: 'Fit Layer Inside Canvas', group: 'Transform' },
  { id: 'fillLayerToCanvas', label: 'Fill Layer to Canvas', group: 'Transform' },
  { id: 'rasterizeLayerToCanvas', label: 'Rasterize Layer to Canvas', group: 'Layer' },
  { id: 'localContentAwareFillPatch', label: 'Local Content-Aware Fill / Patch', group: 'Pixels' },
] as const;

function buildSelectionMorphologyActions(): GeneratedQuickActionDefinition[] {
  const radii = [2, 3, 5, 6, 8, 10, 12, 16];
  const operations: Array<'grow' | 'shrink' | 'feather' | 'border'> = ['grow', 'shrink', 'feather', 'border'];

  return radii.flatMap((radius) =>
    operations.map((operation) => ({
      id: `${operation}Selection${radius}px`,
      label: `${titleCase(operation)} Selection ${radius} px`,
      group: 'Selection' as const,
      kind: 'selectionMorphology' as const,
      operation,
      radius,
    })),
  );
}

function buildGridSelectionActions(): GeneratedQuickActionDefinition[] {
  return [3, 4, 5].flatMap((size) =>
    Array.from({ length: size * size }, (_, index) => ({
      id: `selectGrid${size}x${size}Cell${index + 1}`,
      label: `Select ${size}x${size} Cell ${index + 1}`,
      group: 'Selection' as const,
      kind: 'selectionGrid' as const,
      columns: size,
      rows: size,
      cell: index + 1,
    })),
  );
}

function buildRegionSelectionActions(): GeneratedQuickActionDefinition[] {
  const edgePercents = [5, 10, 20, 25];
  const edges = ['top', 'bottom', 'left', 'right'] as const;
  const edgeActions = edgePercents.flatMap((percent) =>
    edges.map((edge) => ({
      id: `selectEdge${titleCase(edge)}${percent}Percent`,
      label: `Select ${titleCase(edge)} ${percent}% Edge`,
      group: 'Selection' as const,
      kind: 'selectionEdge' as const,
      edge,
      percent,
    })),
  );

  const insetActions = [10, 20, 30, 40].map((percent) => ({
    id: `selectInset${percent}Percent`,
    label: `Select ${percent}% Inset`,
    group: 'Selection' as const,
    kind: 'selectionInset' as const,
    percent,
  }));

  const borderActions = [5, 10, 20, 30].map((percent) => ({
    id: `selectBorderRing${percent}Percent`,
    label: `Select ${percent}% Border Ring`,
    group: 'Selection' as const,
    kind: 'selectionBorderRing' as const,
    percent,
  }));

  return [...edgeActions, ...insetActions, ...borderActions];
}

function buildLayerOpacityActions(): GeneratedQuickActionDefinition[] {
  return [0, 5, 10, 15, 20, 30, 35, 40, 45, 55, 60, 65, 70, 80, 85, 90, 95, 100].map((percent) => ({
    id: `setLayerOpacity${percent}`,
    label: `Layer Opacity ${percent}%`,
    group: 'Layer' as const,
    kind: 'layerOpacity' as const,
    opacity: percent / 100,
  }));
}

function buildLayerBlendActions(): GeneratedQuickActionDefinition[] {
  const modes: BlendMode[] = [
    'darken',
    'lighten',
    'color-dodge',
    'color-burn',
    'hard-light',
    'soft-light',
    'difference',
    'exclusion',
    'hue',
    'saturation',
    'color',
    'luminosity',
  ];

  return modes.map((blendMode) => ({
    id: `setLayerBlend${pascalCase(blendMode)}`,
    label: `Blend Mode ${titleLabel(blendMode)}`,
    group: 'Layer' as const,
    kind: 'layerBlend' as const,
    blendMode,
  }));
}

function buildNudgeActions(): GeneratedQuickActionDefinition[] {
  const cardinalDistances = [2, 3, 5, 20, 25, 50, 100];
  const cardinal = [
    { name: 'Left', dx: -1, dy: 0 },
    { name: 'Right', dx: 1, dy: 0 },
    { name: 'Up', dx: 0, dy: -1 },
    { name: 'Down', dx: 0, dy: 1 },
  ];
  const cardinalActions = cardinalDistances.flatMap((distance) =>
    cardinal.map((direction) => ({
      id: `nudgeLayer${direction.name}${distance}`,
      label: `Nudge Layer ${direction.name} ${distance} px`,
      group: 'Transform' as const,
      kind: 'nudge' as const,
      dx: direction.dx * distance,
      dy: direction.dy * distance,
    })),
  );

  const diagonalDistances = [1, 5, 10, 25, 50];
  const diagonal = [
    { name: 'UpLeft', label: 'Up Left', dx: -1, dy: -1 },
    { name: 'UpRight', label: 'Up Right', dx: 1, dy: -1 },
    { name: 'DownLeft', label: 'Down Left', dx: -1, dy: 1 },
    { name: 'DownRight', label: 'Down Right', dx: 1, dy: 1 },
  ];
  const diagonalActions = diagonalDistances.flatMap((distance) =>
    diagonal.map((direction) => ({
      id: `nudgeLayer${direction.name}${distance}`,
      label: `Nudge Layer ${direction.label} ${distance} px`,
      group: 'Transform' as const,
      kind: 'nudge' as const,
      dx: direction.dx * distance,
      dy: direction.dy * distance,
    })),
  );

  return [...cardinalActions, ...diagonalActions];
}

function buildLayerScaleActions(): GeneratedQuickActionDefinition[] {
  return [25, 50, 75, 90, 110, 125, 150, 200].map((percent) => ({
    id: `scaleLayer${percent}Percent`,
    label: `Scale Layer ${percent}%`,
    group: 'Transform' as const,
    kind: 'layerScale' as const,
    percent,
  }));
}

function buildPixelAdjustmentActions(): GeneratedQuickActionDefinition[] {
  const brightnessActions = [-50, -25, -10, 10, 25, 50].map((delta) => ({
    id: `adjustBrightness${delta < 0 ? 'Minus' : 'Plus'}${Math.abs(delta)}`,
    label: `Brightness ${delta > 0 ? '+' : ''}${delta}`,
    group: 'Pixels' as const,
    kind: 'brightness' as const,
    delta,
  }));
  const alphaActions = [50, 75].map((percent) => ({
    id: `setPixelAlpha${percent}`,
    label: `Set Pixel Alpha ${percent}%`,
    group: 'Pixels' as const,
    kind: 'pixelAlpha' as const,
    percent,
  }));

  return [...brightnessActions, ...alphaActions];
}

export const GENERATED_PHOTOSHOP_QUICK_ACTIONS: GeneratedQuickActionDefinition[] = [
  ...buildSelectionMorphologyActions(),
  ...buildGridSelectionActions(),
  ...buildRegionSelectionActions(),
  ...buildLayerOpacityActions(),
  ...buildLayerBlendActions(),
  ...buildNudgeActions(),
  ...buildLayerScaleActions(),
  ...buildPixelAdjustmentActions(),
];

export const generatedQuickActionById = new Map(
  GENERATED_PHOTOSHOP_QUICK_ACTIONS.map((action) => [action.id, action]),
);

export const PHOTOSHOP_QUICK_ACTIONS: PhotoshopQuickAction[] = [
  ...BASE_PHOTOSHOP_QUICK_ACTIONS,
  ...GENERATED_PHOTOSHOP_QUICK_ACTIONS,
];

type QuickActionCapabilityShape = Pick<
  PhotoshopQuickActionCapabilityDescriptor,
  'input' | 'output' | 'mutatesDocument' | 'implementation' | 'warning'
>;

const DOCUMENT_INPUT = ['document'] as const;
const ACTIVE_LAYER_INPUT = ['document', 'activeLayer'] as const;
const EDITABLE_PIXELS_INPUT = ['document', 'editablePixels'] as const;
const MOVABLE_LAYER_INPUT = ['document', 'movableLayer'] as const;
const SELECTION_INPUT = ['selection'] as const;
const ACTIVE_LAYER_SELECTION_INPUT = ['document', 'activeLayer', 'selection'] as const;
const EDITABLE_PIXELS_SELECTION_INPUT = ['document', 'editablePixels', 'selection'] as const;

const QUICK_ACTION_CATEGORIES: readonly PhotoshopQuickActionCategory[] = [
  'Selection',
  'Pixels',
  'Layer',
  'Transform',
  'Canvas',
];

const QUICK_ACTION_INPUTS: readonly PhotoshopQuickActionCapabilityInput[] = [
  'document',
  'activeLayer',
  'editablePixels',
  'movableLayer',
  'selection',
];

const QUICK_ACTION_OUTPUTS: readonly PhotoshopQuickActionCapabilityOutput[] = [
  'selection',
  'paint',
  'layer',
  'transform',
  'document',
];

const SELECTION_OUTPUT = {
  output: 'selection',
  mutatesDocument: false,
} as const;

const PAINT_OUTPUT = {
  output: 'paint',
  mutatesDocument: true,
} as const;

const LAYER_OUTPUT = {
  output: 'layer',
  mutatesDocument: true,
} as const;

const TRANSFORM_OUTPUT = {
  output: 'transform',
  mutatesDocument: true,
} as const;

const DOCUMENT_OUTPUT = {
  output: 'document',
  mutatesDocument: true,
} as const;

const DETERMINISTIC_IMPLEMENTATION = {
  implementation: 'local-deterministic',
  warning: null,
} as const;

const LOCAL_CONTENT_AWARE_FILL_WARNING =
  'Uses Sloom Studio local pixel patching; Photoshop Content-Aware Fill and cloud Generative Fill may produce different semantic results.';

const BASE_QUICK_ACTION_CAPABILITY_BY_ID: Record<string, QuickActionCapabilityShape> = {
  selectLayerBounds: capability(ACTIVE_LAYER_INPUT, SELECTION_OUTPUT),
  selectLayerOpaquePixels: capability(ACTIVE_LAYER_INPUT, SELECTION_OUTPUT),
  growSelection: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  shrinkSelection: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  featherSelection: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  borderSelection: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  smoothSelection: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  nudgeSelectionLeft: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  nudgeSelectionRight: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  nudgeSelectionUp: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  nudgeSelectionDown: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  clearOutsideSelection: capability(EDITABLE_PIXELS_SELECTION_INPUT, PAINT_OUTPUT),
  layerViaCopy: capability(ACTIVE_LAYER_SELECTION_INPUT, LAYER_OUTPUT),
  layerViaCut: capability(EDITABLE_PIXELS_SELECTION_INPUT, LAYER_OUTPUT),
  cropLayerToSelection: capability(EDITABLE_PIXELS_SELECTION_INPUT, LAYER_OUTPUT),
  trimTransparentLayer: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  flipLayerHorizontal: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  flipLayerVertical: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  rotateLayer90Clockwise: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  rotateLayer90CounterClockwise: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  centerLayer: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  fitLayerToCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  resetLayerPosition: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  trimCanvasToVisible: capability(DOCUMENT_INPUT, DOCUMENT_OUTPUT),
  selectCanvas: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectLayerTransparentPixels: capability(ACTIVE_LAYER_INPUT, SELECTION_OUTPUT),
  selectSelectionBoundingBox: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  growSelectionLarge: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  shrinkSelectionLarge: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  featherSelectionLarge: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  borderSelectionLarge: capability(SELECTION_INPUT, SELECTION_OUTPUT),
  clearSelectedPixels: capability(EDITABLE_PIXELS_SELECTION_INPUT, PAINT_OUTPUT),
  duplicateLayer: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  moveLayerToFront: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  moveLayerToBack: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  nudgeLayerLeft: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerRight: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerUp: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerDown: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerLeftLarge: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerRightLarge: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerUpLarge: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  nudgeLayerDownLarge: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  alignLayerLeft: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  alignLayerRight: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  alignLayerTop: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  alignLayerBottom: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  centerLayerHorizontal: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  centerLayerVertical: capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT),
  fitLayerWidthToCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  fitLayerHeightToCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  invertLayerColors: capability(EDITABLE_PIXELS_INPUT, PAINT_OUTPUT),
  desaturateLayer: capability(EDITABLE_PIXELS_INPUT, PAINT_OUTPUT),
  resetLayerOpacity: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  selectTopHalf: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectBottomHalf: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectLeftHalf: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectRightHalf: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectCenterSquare: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectHorizontalCenterBand: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  selectVerticalCenterBand: capability(DOCUMENT_INPUT, SELECTION_OUTPUT),
  setLayerOpacity25: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerOpacity50: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerOpacity75: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerBlendNormal: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerBlendMultiply: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerBlendScreen: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  setLayerBlendOverlay: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  rotateLayer180: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  raiseLayerOneStep: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  lowerLayerOneStep: capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT),
  fitLayerInsideCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  fillLayerToCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  rasterizeLayerToCanvas: capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT),
  localContentAwareFillPatch: {
    ...capability(EDITABLE_PIXELS_INPUT, PAINT_OUTPUT),
    implementation: 'local-approximation',
    warning: LOCAL_CONTENT_AWARE_FILL_WARNING,
  },
};

export const PHOTOSHOP_QUICK_ACTION_CAPABILITY_DESCRIPTORS: readonly PhotoshopQuickActionCapabilityDescriptor[] =
  Object.freeze(PHOTOSHOP_QUICK_ACTIONS.map(describePhotoshopQuickActionCapability));

const quickActionCapabilityDescriptorById = new Map(
  PHOTOSHOP_QUICK_ACTION_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

export const PHOTOSHOP_QUICK_ACTION_CATALOG_SUMMARY: PhotoshopQuickActionCatalogSummary =
  buildPhotoshopQuickActionCatalogSummary(PHOTOSHOP_QUICK_ACTION_CAPABILITY_DESCRIPTORS);

export function listPhotoshopQuickActionCapabilityDescriptors(): readonly PhotoshopQuickActionCapabilityDescriptor[] {
  return PHOTOSHOP_QUICK_ACTION_CAPABILITY_DESCRIPTORS;
}

export function getPhotoshopQuickActionCapabilityDescriptor(
  actionId: string,
): PhotoshopQuickActionCapabilityDescriptor | null {
  return quickActionCapabilityDescriptorById.get(actionId) ?? null;
}

export function summarizePhotoshopQuickActionCatalog(): PhotoshopQuickActionCatalogSummary {
  return PHOTOSHOP_QUICK_ACTION_CATALOG_SUMMARY;
}

function describePhotoshopQuickActionCapability(
  action: PhotoshopQuickAction,
): PhotoshopQuickActionCapabilityDescriptor {
  const generatedAction = generatedQuickActionById.get(action.id);
  const shape = generatedAction
    ? getGeneratedQuickActionCapability(generatedAction)
    : BASE_QUICK_ACTION_CAPABILITY_BY_ID[action.id] ?? getFallbackQuickActionCapability(action);

  return Object.freeze({
    id: action.id,
    label: action.label,
    category: action.group,
    ...shape,
    undoable: true,
  });
}

function buildPhotoshopQuickActionCatalogSummary(
  descriptors: readonly PhotoshopQuickActionCapabilityDescriptor[],
): PhotoshopQuickActionCatalogSummary {
  const byCategory = createCategoryCounts();
  const byInput = createInputCounts();
  const byOutput = createOutputCounts();
  const undoable = { undoable: 0, notUndoable: 0 };
  const mutatesDocument = { mutating: 0, nonMutating: 0 };

  for (const descriptor of descriptors) {
    byCategory[descriptor.category] += 1;
    byOutput[descriptor.output] += 1;
    for (const input of descriptor.input) {
      byInput[input] += 1;
    }
    if (descriptor.undoable) {
      undoable.undoable += 1;
    } else {
      undoable.notUndoable += 1;
    }
    if (descriptor.mutatesDocument) {
      mutatesDocument.mutating += 1;
    } else {
      mutatesDocument.nonMutating += 1;
    }
  }

  return {
    total: descriptors.length,
    byCategory,
    byInput,
    byOutput,
    undoable,
    mutatesDocument,
    warnings: descriptors
      .filter((descriptor) => descriptor.warning)
      .map((descriptor) => ({
        id: descriptor.id,
        label: descriptor.label,
        warning: descriptor.warning ?? '',
      })),
  };
}

function getGeneratedQuickActionCapability(
  action: GeneratedQuickActionDefinition,
): QuickActionCapabilityShape {
  switch (action.kind) {
    case 'selectionMorphology':
      return capability(SELECTION_INPUT, SELECTION_OUTPUT);
    case 'selectionGrid':
    case 'selectionEdge':
    case 'selectionInset':
    case 'selectionBorderRing':
      return capability(DOCUMENT_INPUT, SELECTION_OUTPUT);
    case 'layerOpacity':
    case 'layerBlend':
      return capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT);
    case 'nudge':
      return capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT);
    case 'layerScale':
      return capability(EDITABLE_PIXELS_INPUT, LAYER_OUTPUT);
    case 'brightness':
    case 'pixelAlpha':
      return capability(EDITABLE_PIXELS_INPUT, PAINT_OUTPUT);
  }
}

function getFallbackQuickActionCapability(action: PhotoshopQuickAction): QuickActionCapabilityShape {
  switch (action.group) {
    case 'Selection':
      return capability(DOCUMENT_INPUT, SELECTION_OUTPUT);
    case 'Pixels':
      return capability(EDITABLE_PIXELS_INPUT, PAINT_OUTPUT);
    case 'Layer':
      return capability(ACTIVE_LAYER_INPUT, LAYER_OUTPUT);
    case 'Transform':
      return capability(MOVABLE_LAYER_INPUT, TRANSFORM_OUTPUT);
    case 'Canvas':
      return capability(DOCUMENT_INPUT, DOCUMENT_OUTPUT);
  }
}

function createCategoryCounts(): Record<PhotoshopQuickActionCategory, number> {
  return QUICK_ACTION_CATEGORIES.reduce(
    (counts, category) => ({ ...counts, [category]: 0 }),
    {} as Record<PhotoshopQuickActionCategory, number>,
  );
}

function createInputCounts(): Record<PhotoshopQuickActionCapabilityInput, number> {
  return QUICK_ACTION_INPUTS.reduce(
    (counts, input) => ({ ...counts, [input]: 0 }),
    {} as Record<PhotoshopQuickActionCapabilityInput, number>,
  );
}

function createOutputCounts(): Record<PhotoshopQuickActionCapabilityOutput, number> {
  return QUICK_ACTION_OUTPUTS.reduce(
    (counts, output) => ({ ...counts, [output]: 0 }),
    {} as Record<PhotoshopQuickActionCapabilityOutput, number>,
  );
}

function capability(
  input: readonly PhotoshopQuickActionCapabilityInput[],
  outputShape: {
    readonly output: PhotoshopQuickActionCapabilityOutput;
    readonly mutatesDocument: boolean;
  },
): QuickActionCapabilityShape {
  return {
    input,
    output: outputShape.output,
    mutatesDocument: outputShape.mutatesDocument,
    ...DETERMINISTIC_IMPLEMENTATION,
  };
}
