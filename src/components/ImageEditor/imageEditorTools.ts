import type { EditorTool } from '../../types/imageEditor';
import type { NativeMenuCommand } from '../../lib/nativeApp';
import { normalizeShortcutLabel } from '../../lib/keyboardShortcuts';

export interface ImageEditorToolDefinition {
  tool: EditorTool;
  label: string;
  shortcut: string;
}

export type ImageEditorToolCommand = Extract<NativeMenuCommand, `image:tool-${string}`>;
export type ImageEditorToolOptionStatus = 'configurable' | 'fixed' | 'descriptor-only' | 'unimplemented';
export type ImageEditorToolCommandState = 'available' | 'unavailable' | 'inactive';
export type ImageEditorToolDevice = 'desktop-keyboard' | 'android' | 'gamepad';
export type ImageEditorToolGroup =
  | 'navigation'
  | 'selection'
  | 'paint'
  | 'retouch'
  | 'vector'
  | 'transform'
  | 'text'
  | 'sample';
export type ImageEditorActionSuitability = 'preset-friendly' | 'single-document' | 'descriptor-only';
export type ImageEditorBatchSuitability = 'batch-safe' | 'document-conditional' | 'not-batch-safe';
export type ImageEditorToolbarFlyoutFootprint = 'absolute-overlay';
export type ImageEditorToolbarFlyoutGroupId =
  | 'move'
  | 'hand'
  | 'selection'
  | 'brush'
  | 'eraser'
  | 'clone-heal'
  | 'focus-retouch'
  | 'tone-retouch'
  | 'fill'
  | 'vector'
  | 'crop'
  | 'text'
  | 'eyedropper';

export interface ImageEditorToolDescriptor extends ImageEditorToolDefinition {
  command: ImageEditorToolCommand;
  group: ImageEditorToolGroup;
  nestedFlyoutSupported: boolean;
  nestedFlyoutCaveat: string;
  actionSuitability: ImageEditorActionSuitability;
  batchSuitability: ImageEditorBatchSuitability;
  batchCaveat: string;
}

export interface ImageEditorToolOptionSummary {
  status: ImageEditorToolOptionStatus;
  configurable: boolean;
  propertiesPanel: boolean;
  presetSupport: boolean;
  signature: string;
  caveat: string;
}

export interface ImageEditorToolReadinessItem extends ImageEditorToolDescriptor {
  optionSummary: ImageEditorToolOptionSummary;
  signature: string;
}

export interface ImageEditorToolbarGroupDescriptor {
  group: ImageEditorToolGroup;
  tools: EditorTool[];
  commands: ImageEditorToolCommand[];
  toolCount: number;
  signature: string;
}

export interface ImageEditorToolbarFlyoutGroupDescriptor {
  id: ImageEditorToolbarFlyoutGroupId;
  label: string;
  primaryTool: EditorTool;
  tools: EditorTool[];
  toolCount: number;
  hasFlyout: boolean;
  signature: string;
  footprint: ImageEditorToolbarFlyoutFootprint;
}

export interface ImageEditorToolCommandStateDescriptor {
  command: ImageEditorToolCommand;
  tool: EditorTool;
  state: ImageEditorToolCommandState;
  reason: string;
}

export interface ImageEditorToolDeviceRouteDescriptor {
  device: ImageEditorToolDevice;
  supported: boolean;
  caveat: string;
}

export interface ImageEditorToolbarCustomizationDescriptor {
  status: 'customizable-toolbar';
  supported: true;
  userReorderable: true;
  fixedPaletteSize: true;
  evidenceSignature: 'customization:user-reorderable-flyout-groups:no-dock:no-resize';
  orderSignature: string;
  caveat: string;
}

export interface ImageEditorToolReadinessDescriptor {
  descriptorId: 'image-tool-registry-shortcuts:v1';
  version: 1;
  registeredToolCount: number;
  tools: ImageEditorToolReadinessItem[];
  toolbarGroups: ImageEditorToolbarGroupDescriptor[];
  toolbarGroupingSignature: string;
  toolbarFlyoutGroups: ImageEditorToolbarFlyoutGroupDescriptor[];
  toolbarFlyoutSignature: string;
  toolbarFlyoutFootprint: ImageEditorToolbarFlyoutFootprint;
  toolbarCustomization: ImageEditorToolbarCustomizationDescriptor;
  shortcutMapSignature: string;
  shortcutConflicts: Array<{
    shortcut: string;
    commands: ImageEditorToolCommand[];
  }>;
  commandStates: ImageEditorToolCommandStateDescriptor[];
  deviceRoutes: ImageEditorToolDeviceRouteDescriptor[];
  unsupported: Array<{
    kind:
      | 'nested-tool-flyouts'
      | 'toolbar-customization'
      | 'android-shortcuts'
      | 'gamepad-tool-routes';
    supported: false;
    caveat: string;
  }>;
}

export interface ImageEditorToolRegistryReadiness {
  registeredToolCount: number;
  tools: ImageEditorToolDescriptor[];
  missingShortcutTools: EditorTool[];
  missingShortcutCommands: ImageEditorToolCommand[];
  shortcutCollisions: Array<{
    shortcut: string;
    commands: ImageEditorToolCommand[];
  }>;
  nestedFlyoutUnsupportedTools: EditorTool[];
  toolbarCustomization: {
    status: 'customizable-toolbar';
    supported: true;
    userReorderable: true;
    fixedPaletteSize: true;
    evidenceSignature: 'customization:user-reorderable-flyout-groups:no-dock:no-resize';
    orderSignature: string;
    caveat: string;
  };
  toolbarFlyoutGroups: ImageEditorToolbarFlyoutGroupDescriptor[];
  toolbarFlyoutSignature: string;
  workspaceCommandRouting: {
    workspace: 'image';
    supported: true;
    caveat: string;
  };
}

export const IMAGE_EDITOR_TOOL_DEFINITIONS: ImageEditorToolDefinition[] = [
  { tool: 'move', label: 'Move', shortcut: 'V' },
  { tool: 'hand', label: 'Hand', shortcut: 'H' },
  { tool: 'marquee', label: 'Marquee', shortcut: 'M' },
  { tool: 'lasso', label: 'Lasso', shortcut: 'L' },
  { tool: 'magicWand', label: 'Magic Wand', shortcut: 'W' },
  { tool: 'brush', label: 'Brush', shortcut: 'B' },
  { tool: 'eraser', label: 'Eraser', shortcut: 'E' },
  { tool: 'backgroundEraser', label: 'Background Eraser', shortcut: 'Alt+E' },
  { tool: 'magicEraser', label: 'Magic Eraser', shortcut: 'Shift+E' },
  { tool: 'cloneStamp', label: 'Clone Stamp', shortcut: 'S' },
  { tool: 'spotHeal', label: 'Spot Heal', shortcut: 'J' },
  { tool: 'blurBrush', label: 'Blur Brush', shortcut: 'R' },
  { tool: 'sharpenBrush', label: 'Sharpen Brush', shortcut: 'Shift+R' },
  { tool: 'smudgeBrush', label: 'Smudge Brush', shortcut: 'U' },
  { tool: 'dodgeBrush', label: 'Dodge Brush', shortcut: 'O' },
  { tool: 'burnBrush', label: 'Burn Brush', shortcut: 'Shift+O' },
  { tool: 'spongeSaturateBrush', label: 'Sponge Saturate', shortcut: 'P' },
  { tool: 'spongeDesaturateBrush', label: 'Sponge Desaturate', shortcut: 'Shift+P' },
  { tool: 'paintBucket', label: 'Paint Bucket', shortcut: 'G' },
  { tool: 'gradientTool', label: 'Gradient', shortcut: 'Shift+G' },
  { tool: 'pen', label: 'Pen', shortcut: 'Shift+B' },
  { tool: 'rectShape', label: 'Rectangle Shape', shortcut: 'X' },
  { tool: 'ellipseShape', label: 'Ellipse Shape', shortcut: 'Shift+X' },
  { tool: 'crop', label: 'Crop', shortcut: 'C' },
  { tool: 'text', label: 'Text', shortcut: 'T' },
  { tool: 'eyedropper', label: 'Eyedropper', shortcut: 'I' },
];

interface ImageEditorToolbarFlyoutGroupInput {
  id: ImageEditorToolbarFlyoutGroupId;
  label: string;
  primaryTool: EditorTool;
  tools: EditorTool[];
}

const TOOL_COMMANDS: Record<EditorTool, ImageEditorToolCommand> = {
  hand: 'image:tool-hand',
  move: 'image:tool-move',
  marquee: 'image:tool-marquee',
  lasso: 'image:tool-lasso',
  magicWand: 'image:tool-magic-wand',
  brush: 'image:tool-brush',
  pen: 'image:tool-pen',
  eraser: 'image:tool-eraser',
  backgroundEraser: 'image:tool-background-eraser',
  magicEraser: 'image:tool-magic-eraser',
  cloneStamp: 'image:tool-clone-stamp',
  spotHeal: 'image:tool-spot-heal',
  blurBrush: 'image:tool-blur-brush',
  sharpenBrush: 'image:tool-sharpen-brush',
  smudgeBrush: 'image:tool-smudge-brush',
  dodgeBrush: 'image:tool-dodge-brush',
  burnBrush: 'image:tool-burn-brush',
  spongeSaturateBrush: 'image:tool-sponge-saturate',
  spongeDesaturateBrush: 'image:tool-sponge-desaturate',
  paintBucket: 'image:tool-paint-bucket',
  gradientTool: 'image:tool-gradient',
  rectShape: 'image:tool-rectangle-shape',
  ellipseShape: 'image:tool-ellipse-shape',
  crop: 'image:tool-crop',
  text: 'image:tool-text',
  eyedropper: 'image:tool-eyedropper',
};

const TOOL_GROUPS: Record<EditorTool, ImageEditorToolGroup> = {
  hand: 'navigation',
  move: 'transform',
  marquee: 'selection',
  lasso: 'selection',
  magicWand: 'selection',
  brush: 'paint',
  pen: 'vector',
  eraser: 'paint',
  backgroundEraser: 'paint',
  magicEraser: 'paint',
  cloneStamp: 'retouch',
  spotHeal: 'retouch',
  blurBrush: 'retouch',
  sharpenBrush: 'retouch',
  smudgeBrush: 'retouch',
  dodgeBrush: 'retouch',
  burnBrush: 'retouch',
  spongeSaturateBrush: 'retouch',
  spongeDesaturateBrush: 'retouch',
  paintBucket: 'paint',
  gradientTool: 'paint',
  rectShape: 'vector',
  ellipseShape: 'vector',
  crop: 'transform',
  text: 'text',
  eyedropper: 'sample',
};

const TOOL_GROUP_ORDER: ImageEditorToolGroup[] = [
  'navigation',
  'selection',
  'paint',
  'retouch',
  'vector',
  'transform',
  'text',
  'sample',
];

const PRESET_FRIENDLY_TOOLS = new Set<EditorTool>([
  'brush',
  'eraser',
  'backgroundEraser',
  'magicEraser',
  'paintBucket',
  'gradientTool',
  'rectShape',
  'ellipseShape',
  'text',
]);

const DESCRIPTOR_ONLY_TOOLS = new Set<EditorTool>(['pen', 'crop', 'cloneStamp', 'spotHeal']);

const TOOL_DEFINITION_BY_TOOL = new Map<EditorTool, ImageEditorToolDefinition>(
  IMAGE_EDITOR_TOOL_DEFINITIONS.map((definition) => [definition.tool, definition]),
);

const IMAGE_EDITOR_TOOLBAR_FLYOUT_GROUP_INPUTS: ImageEditorToolbarFlyoutGroupInput[] = [
  { id: 'move', label: 'Move', primaryTool: 'move', tools: ['move'] },
  { id: 'hand', label: 'Hand', primaryTool: 'hand', tools: ['hand'] },
  { id: 'selection', label: 'Selection', primaryTool: 'marquee', tools: ['marquee', 'lasso', 'magicWand'] },
  { id: 'brush', label: 'Brush', primaryTool: 'brush', tools: ['brush'] },
  { id: 'eraser', label: 'Eraser', primaryTool: 'eraser', tools: ['eraser', 'backgroundEraser', 'magicEraser'] },
  { id: 'clone-heal', label: 'Clone / Heal', primaryTool: 'cloneStamp', tools: ['cloneStamp', 'spotHeal'] },
  {
    id: 'focus-retouch',
    label: 'Focus Retouch',
    primaryTool: 'blurBrush',
    tools: ['blurBrush', 'sharpenBrush', 'smudgeBrush'],
  },
  {
    id: 'tone-retouch',
    label: 'Tone Retouch',
    primaryTool: 'dodgeBrush',
    tools: ['dodgeBrush', 'burnBrush', 'spongeSaturateBrush', 'spongeDesaturateBrush'],
  },
  { id: 'fill', label: 'Fill', primaryTool: 'paintBucket', tools: ['paintBucket', 'gradientTool'] },
  { id: 'vector', label: 'Vector', primaryTool: 'pen', tools: ['pen', 'rectShape', 'ellipseShape'] },
  { id: 'crop', label: 'Crop', primaryTool: 'crop', tools: ['crop'] },
  { id: 'text', label: 'Text', primaryTool: 'text', tools: ['text'] },
  { id: 'eyedropper', label: 'Eyedropper', primaryTool: 'eyedropper', tools: ['eyedropper'] },
];

export const DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER: ImageEditorToolbarFlyoutGroupId[] =
  IMAGE_EDITOR_TOOLBAR_FLYOUT_GROUP_INPUTS.map((group) => group.id);

const TOOL_TO_FLYOUT_GROUP = new Map<EditorTool, ImageEditorToolbarFlyoutGroupInput>();
for (const group of IMAGE_EDITOR_TOOLBAR_FLYOUT_GROUP_INPUTS) {
  for (const tool of group.tools) {
    TOOL_TO_FLYOUT_GROUP.set(tool, group);
  }
}

const TOOL_OPTION_SUMMARIES: Record<EditorTool, Omit<ImageEditorToolOptionSummary, 'signature'>> = {
  hand: {
    status: 'fixed',
    configurable: false,
    propertiesPanel: false,
    presetSupport: false,
    caveat: 'Viewport panning is selected as a tool, but it has no dedicated tool options.',
  },
  move: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Move and transform controls expose numeric geometry, snapping, pivot, and apply/cancel state.',
  },
  marquee: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Selection mode, feather, anti-alias, and shape options are configurable.',
  },
  lasso: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Freehand, polygonal, and magnetic selection options are configurable. Magnetic lasso samples the document composite and falls back to freehand when a readable composite or canvas is unavailable.',
  },
  magicWand: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Tolerance, contiguous/global matching, sample-all-layers, and anti-alias options are configurable.',
  },
  pen: {
    status: 'descriptor-only',
    configurable: false,
    propertiesPanel: false,
    presetSupport: false,
    caveat: 'Straight path creation is handled, while Bezier/curvature/text-on-path options remain descriptor-only.',
  },
  brush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Brush size, hardness, opacity, flow, smoothing, symmetry, pressure, tilt, and presets are inspectable.',
  },
  eraser: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Eraser uses the shared brush engine and preset surface.',
  },
  backgroundEraser: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Background Eraser exposes bounded tolerance/limits/protect-foreground options.',
  },
  magicEraser: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Magic Eraser exposes tolerance and contiguous/global alpha-clear options.',
  },
  cloneStamp: {
    status: 'descriptor-only',
    configurable: false,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Sample source and aligned/restart state are inspectable; broader clone-source panels are not implemented.',
  },
  spotHeal: {
    status: 'descriptor-only',
    configurable: false,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Local spot healing is implemented; content-aware patch/remove workflows remain separately planned.',
  },
  blurBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Blur brush strength and brush-engine settings are configurable.',
  },
  sharpenBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Sharpen brush strength and brush-engine settings are configurable.',
  },
  smudgeBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Smudge strength and brush-engine settings are configurable.',
  },
  dodgeBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Dodge range/exposure and brush-engine settings are configurable.',
  },
  burnBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Burn range/exposure and brush-engine settings are configurable.',
  },
  spongeSaturateBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Sponge saturate flow and brush-engine settings are configurable.',
  },
  spongeDesaturateBrush: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Sponge desaturate flow and brush-engine settings are configurable.',
  },
  paintBucket: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Fill mode, tolerance, opacity, blend mode, gap close, and preserve transparency are configurable.',
  },
  gradientTool: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Gradient mode, stops, transparency, dither, angle, and preset IDs are configurable.',
  },
  rectShape: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Fill, stroke, dimensions, and retained vector metadata are configurable.',
  },
  ellipseShape: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Fill, stroke, dimensions, and retained vector metadata are configurable.',
  },
  crop: {
    status: 'descriptor-only',
    configurable: false,
    propertiesPanel: true,
    presetSupport: false,
    caveat: 'Crop guides and aspect presets are inspectable; crop presets are not exposed as reusable tool presets.',
  },
  text: {
    status: 'configurable',
    configurable: true,
    propertiesPanel: true,
    presetSupport: true,
    caveat: 'Font stack, OpenType toggles, color, alignment, and retained text metadata are configurable.',
  },
  eyedropper: {
    status: 'fixed',
    configurable: false,
    propertiesPanel: false,
    presetSupport: false,
    caveat: 'Eyedropper samples canvas color and has no dedicated tool options.',
  },
};

function formatToolLabelsForCaveat(tools: EditorTool[]): string {
  const labels = tools.map((tool) => TOOL_DEFINITION_BY_TOOL.get(tool)?.label ?? tool);
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function describeNestedFlyoutCaveat(tool: EditorTool): string {
  const group = TOOL_TO_FLYOUT_GROUP.get(tool);
  if (!group || group.tools.length <= 1) {
    return 'This tool is a direct compact toolbar slot and does not need a nested flyout.';
  }
  return `Compact flyout group "${group.label}" exposes ${formatToolLabelsForCaveat(group.tools)} without adding toolbar rows.`;
}

export function sanitizeImageEditorToolbarFlyoutOrder(
  order?: readonly string[] | null,
): ImageEditorToolbarFlyoutGroupId[] {
  const validIds = new Set<ImageEditorToolbarFlyoutGroupId>(DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER);
  const next: ImageEditorToolbarFlyoutGroupId[] = [];
  for (const id of order ?? []) {
    if (!validIds.has(id as ImageEditorToolbarFlyoutGroupId)) continue;
    const typedId = id as ImageEditorToolbarFlyoutGroupId;
    if (next.includes(typedId)) continue;
    next.push(typedId);
  }
  for (const id of DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function getImageEditorToolbarCustomOrderSignature(order?: readonly string[] | null): string {
  return sanitizeImageEditorToolbarFlyoutOrder(order).join('|');
}

export function getImageEditorToolbarFlyoutGroups(
  order?: readonly string[] | null,
): ImageEditorToolbarFlyoutGroupDescriptor[] {
  const groupById = new Map(IMAGE_EDITOR_TOOLBAR_FLYOUT_GROUP_INPUTS.map((group) => [group.id, group]));
  return sanitizeImageEditorToolbarFlyoutOrder(order).map((id) => {
    const group = groupById.get(id) ?? IMAGE_EDITOR_TOOLBAR_FLYOUT_GROUP_INPUTS[0];
    return {
    id: group.id,
    label: group.label,
    primaryTool: group.primaryTool,
    tools: [...group.tools],
    toolCount: group.tools.length,
    hasFlyout: group.tools.length > 1,
    signature: `${group.id}:${group.tools.join(',')}`,
    footprint: 'absolute-overlay',
    };
  });
}

export function getImageEditorToolbarFlyoutSignature(order?: readonly string[] | null): string {
  return getImageEditorToolbarFlyoutGroups(order).map((group) => group.signature).join('|');
}

export const IMAGE_EDITOR_TOOL_DESCRIPTORS: ImageEditorToolDescriptor[] = IMAGE_EDITOR_TOOL_DEFINITIONS.map((definition) => {
  const actionSuitability = DESCRIPTOR_ONLY_TOOLS.has(definition.tool)
    ? 'descriptor-only'
    : PRESET_FRIENDLY_TOOLS.has(definition.tool)
      ? 'preset-friendly'
      : 'single-document';
  const batchSuitability = 'not-batch-safe';
  const flyoutGroup = TOOL_TO_FLYOUT_GROUP.get(definition.tool);
  return {
    ...definition,
    command: TOOL_COMMANDS[definition.tool],
    group: TOOL_GROUPS[definition.tool],
    nestedFlyoutSupported: (flyoutGroup?.tools.length ?? 0) > 1,
    nestedFlyoutCaveat: describeNestedFlyoutCaveat(definition.tool),
    actionSuitability,
    batchSuitability,
    batchCaveat: 'Requires live document context, pointer input, or source sampling and is not safe for unattended batch playback.',
  };
});

export function getImageEditorToolbarGroups(): ImageEditorToolbarGroupDescriptor[] {
  return TOOL_GROUP_ORDER.map((group) => {
    const tools = IMAGE_EDITOR_TOOL_DESCRIPTORS
      .filter((tool) => tool.group === group)
      .map((tool) => tool.tool);
    const commands = tools.map((tool) => TOOL_COMMANDS[tool]);
    return {
      group,
      tools,
      commands,
      toolCount: tools.length,
      signature: `${group}:${tools.join(',')}`,
    };
  });
}

export function getImageEditorToolbarGroupingSignature(): string {
  return getImageEditorToolbarGroups().map((group) => group.signature).join('|');
}

function describeOptionSummary(tool: EditorTool): ImageEditorToolOptionSummary {
  const summary = TOOL_OPTION_SUMMARIES[tool];
  return {
    ...summary,
    signature: `${tool}:${summary.status}:${summary.configurable ? 'configurable' : 'fixed'}:${summary.propertiesPanel ? 'panel' : 'no-panel'}:${summary.presetSupport ? 'presets' : 'no-presets'}`,
  };
}

function buildShortcutMapSignature(shortcuts: Partial<Record<NativeMenuCommand, string>>): string {
  return IMAGE_EDITOR_TOOL_DESCRIPTORS
    .map((tool) => `${tool.command}=${normalizeShortcutLabel(shortcuts[tool.command]) || 'unassigned'}`)
    .join('|');
}

function getCommandStates(
  shortcuts: Partial<Record<NativeMenuCommand, string>>,
): ImageEditorToolCommandStateDescriptor[] {
  return IMAGE_EDITOR_TOOL_DESCRIPTORS.map((tool) => {
    const shortcut = normalizeShortcutLabel(shortcuts[tool.command]);
    if (!shortcut) {
      return {
        command: tool.command,
        tool: tool.tool,
        state: 'unavailable',
        reason: 'No normalized keyboard shortcut is assigned.',
      };
    }
    if (tool.tool === 'hand') {
      return {
        command: tool.command,
        tool: tool.tool,
        state: 'inactive',
        reason: 'Command selects the Hand tool, but the canvas dispatcher currently has no Hand ToolHandler callbacks.',
      };
    }
    return {
      command: tool.command,
      tool: tool.tool,
      state: 'available',
      reason: 'Command has a normalized desktop shortcut and an Image workspace menu route.',
    };
  });
}

export function buildImageEditorToolReadinessDescriptor(
  shortcuts: Partial<Record<NativeMenuCommand, string>>,
  toolbarFlyoutOrder?: readonly string[] | null,
): ImageEditorToolReadinessDescriptor {
  const registry = getImageEditorToolRegistryReadiness(shortcuts, toolbarFlyoutOrder);
  return {
    descriptorId: 'image-tool-registry-shortcuts:v1',
    version: 1,
    registeredToolCount: IMAGE_EDITOR_TOOL_DESCRIPTORS.length,
    tools: IMAGE_EDITOR_TOOL_DESCRIPTORS.map((tool) => {
      const optionSummary = describeOptionSummary(tool.tool);
      return {
        ...tool,
        optionSummary,
        signature: `${tool.group}:${tool.tool}:${tool.command}:${normalizeShortcutLabel(shortcuts[tool.command]) || 'unassigned'}:${optionSummary.signature}`,
      };
    }),
    toolbarGroups: getImageEditorToolbarGroups(),
    toolbarGroupingSignature: getImageEditorToolbarGroupingSignature(),
    toolbarFlyoutGroups: getImageEditorToolbarFlyoutGroups(toolbarFlyoutOrder),
    toolbarFlyoutSignature: getImageEditorToolbarFlyoutSignature(toolbarFlyoutOrder),
    toolbarFlyoutFootprint: 'absolute-overlay',
    toolbarCustomization: registry.toolbarCustomization,
    shortcutMapSignature: buildShortcutMapSignature(shortcuts),
    shortcutConflicts: registry.shortcutCollisions,
    commandStates: getCommandStates(shortcuts),
    deviceRoutes: [
      {
        device: 'desktop-keyboard',
        supported: true,
        caveat: 'Image tool shortcuts are desktop keyboard routes scoped to the Image workspace.',
      },
      {
        device: 'android',
        supported: false,
        caveat: 'Android hardware/software shortcut routing for Image tool commands is not implemented.',
      },
      {
        device: 'gamepad',
        supported: false,
        caveat: 'Gamepad bindings open settings but do not route Image tool selection commands.',
      },
    ],
    unsupported: [
      {
        kind: 'android-shortcuts',
        supported: false,
        caveat: 'Android hardware/software shortcut routing for Image tool commands is not implemented.',
      },
      {
        kind: 'gamepad-tool-routes',
        supported: false,
        caveat: 'Gamepad bindings do not select Image tools.',
      },
    ],
  };
}

export function getImageEditorToolCommand(tool: EditorTool): ImageEditorToolCommand {
  return TOOL_COMMANDS[tool];
}

export function getImageEditorToolRegistryReadiness(
  shortcuts: Partial<Record<NativeMenuCommand, string>>,
  toolbarFlyoutOrder?: readonly string[] | null,
): ImageEditorToolRegistryReadiness {
  const missing = IMAGE_EDITOR_TOOL_DESCRIPTORS.filter((tool) => !normalizeShortcutLabel(shortcuts[tool.command]));
  const shortcutBuckets = new Map<string, ImageEditorToolCommand[]>();
  for (const tool of IMAGE_EDITOR_TOOL_DESCRIPTORS) {
    const shortcut = normalizeShortcutLabel(shortcuts[tool.command]);
    if (!shortcut) continue;
    shortcutBuckets.set(shortcut, [...shortcutBuckets.get(shortcut) ?? [], tool.command]);
  }

  return {
    registeredToolCount: IMAGE_EDITOR_TOOL_DESCRIPTORS.length,
    tools: IMAGE_EDITOR_TOOL_DESCRIPTORS,
    missingShortcutTools: missing.map((tool) => tool.tool),
    missingShortcutCommands: missing.map((tool) => tool.command),
    shortcutCollisions: [...shortcutBuckets.entries()]
      .filter(([, commands]) => commands.length > 1)
      .map(([shortcut, commands]) => ({ shortcut, commands })),
    nestedFlyoutUnsupportedTools: IMAGE_EDITOR_TOOL_DESCRIPTORS
      .filter((tool) => !tool.nestedFlyoutSupported)
      .map((tool) => tool.tool),
    toolbarCustomization: {
      status: 'customizable-toolbar',
      supported: true,
      userReorderable: true,
      fixedPaletteSize: true,
      evidenceSignature: 'customization:user-reorderable-flyout-groups:no-dock:no-resize',
      orderSignature: getImageEditorToolbarCustomOrderSignature(toolbarFlyoutOrder),
      caveat: 'Compact flyout groups can be reordered by the user while preserving the fixed two-column no-dock/no-resize palette.',
    },
    toolbarFlyoutGroups: getImageEditorToolbarFlyoutGroups(toolbarFlyoutOrder),
    toolbarFlyoutSignature: getImageEditorToolbarFlyoutSignature(toolbarFlyoutOrder),
    workspaceCommandRouting: {
      workspace: 'image',
      supported: true,
      caveat: 'Image tool commands route through image:* native menu commands only while the Image workspace is active.',
    },
  };
}
