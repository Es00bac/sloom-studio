import { NATIVE_MENU_COMMANDS, type NativeMenuCommand } from './nativeApp';
import type { WorkspaceView } from '../types/flow';
import { isCommandAvailableInWorkspace } from './keyboardShortcuts';

type CanonicalGamepadWorkspace = Extract<WorkspaceView, 'flow' | 'editor' | 'image' | 'paper'>;
export type GamepadWorkspaceScope = 'flow' | 'video' | 'image' | 'paper';
export type GamepadWorkspace = CanonicalGamepadWorkspace | GamepadWorkspaceScope;
export type GamepadControlKind = 'button' | 'dpad' | 'trigger' | 'axis';
export type GamepadAxisPolarity = 'negative' | 'positive';
export type GamepadAnalogCurve = 'linear' | 'quadratic' | 'cubic';

export interface GamepadControlDefinition {
  id: string;
  label: string;
  kind: GamepadControlKind;
  buttonIndex?: number;
  axisIndex?: number;
  axisPolarity?: GamepadAxisPolarity;
}

export interface GamepadControlBinding {
  command: NativeMenuCommand | '';
  threshold: number;
  deadzone: number;
  sensitivity: number;
  inverted: boolean;
  curve: GamepadAnalogCurve;
  triggerMin: number;
  triggerMax: number;
}

export type GamepadBindingMap = Record<GamepadControlId, GamepadControlBinding>;
export type GamepadBindingProfile = Record<CanonicalGamepadWorkspace, GamepadBindingMap> & {
  video: GamepadBindingMap;
};
export type GamepadBindingExport = Record<GamepadWorkspaceScope, GamepadBindingMap>;

export interface GamepadBindingValidationIssue {
  path: string;
  message: string;
}

export const GAMEPAD_WORKSPACES: Array<{ id: CanonicalGamepadWorkspace; label: string }> = [
  { id: 'flow', label: 'Flow' },
  { id: 'editor', label: 'Video' },
  { id: 'image', label: 'Image' },
  { id: 'paper', label: 'Paper' },
];

export const GAMEPAD_WORKSPACE_SCOPES: Array<{
  id: GamepadWorkspaceScope;
  label: string;
  workspace: CanonicalGamepadWorkspace;
}> = [
  { id: 'flow', label: 'Flow', workspace: 'flow' },
  { id: 'video', label: 'Video', workspace: 'editor' },
  { id: 'image', label: 'Image', workspace: 'image' },
  { id: 'paper', label: 'Paper', workspace: 'paper' },
];

export const GAMEPAD_CONTROL_DEFINITIONS = [
  { id: 'buttonSouth', label: 'A / Cross', kind: 'button', buttonIndex: 0 },
  { id: 'buttonEast', label: 'B / Circle', kind: 'button', buttonIndex: 1 },
  { id: 'buttonWest', label: 'X / Square', kind: 'button', buttonIndex: 2 },
  { id: 'buttonNorth', label: 'Y / Triangle', kind: 'button', buttonIndex: 3 },
  { id: 'leftBumper', label: 'Left bumper', kind: 'button', buttonIndex: 4 },
  { id: 'rightBumper', label: 'Right bumper', kind: 'button', buttonIndex: 5 },
  { id: 'leftTrigger', label: 'Left trigger', kind: 'trigger', buttonIndex: 6 },
  { id: 'rightTrigger', label: 'Right trigger', kind: 'trigger', buttonIndex: 7 },
  { id: 'select', label: 'Select / Back', kind: 'button', buttonIndex: 8 },
  { id: 'start', label: 'Start / Menu', kind: 'button', buttonIndex: 9 },
  { id: 'leftStickPress', label: 'Left stick press', kind: 'button', buttonIndex: 10 },
  { id: 'rightStickPress', label: 'Right stick press', kind: 'button', buttonIndex: 11 },
  { id: 'dpadUp', label: 'D-pad up', kind: 'dpad', buttonIndex: 12 },
  { id: 'dpadDown', label: 'D-pad down', kind: 'dpad', buttonIndex: 13 },
  { id: 'dpadLeft', label: 'D-pad left', kind: 'dpad', buttonIndex: 14 },
  { id: 'dpadRight', label: 'D-pad right', kind: 'dpad', buttonIndex: 15 },
  { id: 'home', label: 'Home / Guide', kind: 'button', buttonIndex: 16 },
  { id: 'leftStickUp', label: 'Left stick up', kind: 'axis', axisIndex: 1, axisPolarity: 'negative' },
  { id: 'leftStickDown', label: 'Left stick down', kind: 'axis', axisIndex: 1, axisPolarity: 'positive' },
  { id: 'leftStickLeft', label: 'Left stick left', kind: 'axis', axisIndex: 0, axisPolarity: 'negative' },
  { id: 'leftStickRight', label: 'Left stick right', kind: 'axis', axisIndex: 0, axisPolarity: 'positive' },
  { id: 'rightStickUp', label: 'Right stick up', kind: 'axis', axisIndex: 3, axisPolarity: 'negative' },
  { id: 'rightStickDown', label: 'Right stick down', kind: 'axis', axisIndex: 3, axisPolarity: 'positive' },
  { id: 'rightStickLeft', label: 'Right stick left', kind: 'axis', axisIndex: 2, axisPolarity: 'negative' },
  { id: 'rightStickRight', label: 'Right stick right', kind: 'axis', axisIndex: 2, axisPolarity: 'positive' },
] as const;

export type GamepadControlId = (typeof GAMEPAD_CONTROL_DEFINITIONS)[number]['id'];

const CONTROL_IDS = new Set<string>(GAMEPAD_CONTROL_DEFINITIONS.map((control) => control.id));
const WORKSPACE_IDS = new Set<string>(GAMEPAD_WORKSPACES.map((workspace) => workspace.id));
const WORKSPACE_SCOPE_IDS = new Set<string>(GAMEPAD_WORKSPACE_SCOPES.map((workspace) => workspace.id));
const VALID_CURVES = new Set<GamepadAnalogCurve>(['linear', 'quadratic', 'cubic']);
const WORKSPACE_ALIASES: Record<GamepadWorkspace, CanonicalGamepadWorkspace> = {
  flow: 'flow',
  editor: 'editor',
  video: 'editor',
  image: 'image',
  paper: 'paper',
};

const DEFAULT_ANALOG_BINDING = {
  threshold: 0.65,
  deadzone: 0.18,
  sensitivity: 1,
  inverted: false,
  curve: 'linear' as const,
  triggerMin: 0,
  triggerMax: 1,
};

const DEFAULT_DIGITAL_BINDING = {
  threshold: 0.5,
  deadzone: 0.18,
  sensitivity: 1,
  inverted: false,
  curve: 'linear' as const,
  triggerMin: 0,
  triggerMax: 1,
};

const DEFAULT_COMMANDS: Partial<Record<CanonicalGamepadWorkspace, Partial<Record<GamepadControlId, NativeMenuCommand>>>> = {
  flow: {
    buttonSouth: 'view:command-palette',
    buttonEast: 'edit:deselect',
    buttonWest: 'flow:add-source-bin',
    buttonNorth: 'view:activity-trail',
    start: 'settings:gamepad-bindings',
  },
  editor: {
    buttonSouth: 'timeline:select',
    buttonEast: 'timeline:hand',
    buttonWest: 'timeline:cut',
    buttonNorth: 'timeline:slip',
    dpadLeft: 'timeline:previous-keyframe',
    dpadRight: 'timeline:next-keyframe',
    rightTrigger: 'timeline:add-keyframe',
    start: 'settings:gamepad-bindings',
  },
  image: {
    buttonSouth: 'image:tool-brush',
    buttonEast: 'image:tool-move',
    buttonWest: 'image:tool-eraser',
    buttonNorth: 'image:tool-eyedropper',
    leftBumper: 'edit:undo',
    rightBumper: 'edit:redo',
    leftTrigger: 'image:tool-hand',
    rightTrigger: 'image:tool-paint-bucket',
    start: 'settings:gamepad-bindings',
  },
  paper: {
    buttonSouth: 'paper:tool-select',
    buttonEast: 'paper:tool-hand',
    buttonWest: 'paper:tool-text',
    buttonNorth: 'paper:tool-image',
    dpadUp: 'paper:add-text-frame',
    dpadRight: 'paper:add-image-frame',
    dpadDown: 'paper:add-caption',
    dpadLeft: 'paper:add-speech-bubble',
    start: 'settings:gamepad-bindings',
  },
};

export function createDefaultGamepadBindings(): GamepadBindingProfile {
  return withVideoAlias(Object.fromEntries(GAMEPAD_WORKSPACES.map(({ id: workspace }) => [
    workspace,
    Object.fromEntries(GAMEPAD_CONTROL_DEFINITIONS.map((control) => [
      control.id,
      createBinding(control, DEFAULT_COMMANDS[workspace]?.[control.id] ?? ''),
    ])),
  ])) as Record<CanonicalGamepadWorkspace, GamepadBindingMap>);
}

export function normalizeGamepadBindings(input: unknown): GamepadBindingProfile {
  return validateGamepadBindingsImport(input).bindings;
}

export function validateGamepadBindingsImport(input: unknown): {
  bindings: GamepadBindingProfile;
  issues: GamepadBindingValidationIssue[];
} {
  const defaults = createDefaultGamepadBindings();
  const issues: GamepadBindingValidationIssue[] = [];
  if (!input || typeof input !== 'object') {
    return { bindings: defaults, issues };
  }

  const source = input as Record<string, Record<string, Partial<GamepadControlBinding>> | undefined>;

  for (const workspaceKey of Object.keys(source)) {
    if (!WORKSPACE_IDS.has(workspaceKey) && !WORKSPACE_SCOPE_IDS.has(workspaceKey)) {
      issues.push({ path: workspaceKey, message: 'Unknown workspace scope.' });
      continue;
    }

    const workspace = toCanonicalGamepadWorkspace(workspaceKey as GamepadWorkspace);
    const workspaceSource = source[workspaceKey];
    if (!workspaceSource || typeof workspaceSource !== 'object') continue;

    for (const controlKey of Object.keys(workspaceSource)) {
      if (!CONTROL_IDS.has(controlKey)) {
        issues.push({ path: `${workspaceKey}.${controlKey}`, message: 'Unknown gamepad control.' });
        continue;
      }

      const raw = workspaceSource[controlKey];
      if (!raw || typeof raw !== 'object') continue;
      const control = GAMEPAD_CONTROL_DEFINITIONS.find((candidate) => candidate.id === controlKey);
      if (!control) continue;

      defaults[workspace][control.id] = createBinding(control, sanitizeCommand(workspace, raw.command), raw, {
        workspaceKey,
        issues,
      });
      if (typeof raw.command === 'string' && raw.command && !defaults[workspace][control.id].command) {
        issues.push({ path: `${workspaceKey}.${control.id}.command`, message: 'Command is not valid for this workspace.' });
      }
    }
  }

  return { bindings: withVideoAlias(defaults), issues };
}

export function getGamepadCommandOptionsForWorkspace(workspace: GamepadWorkspace): NativeMenuCommand[] {
  const canonicalWorkspace = toCanonicalGamepadWorkspace(workspace);
  return NATIVE_COMMAND_OPTIONS.filter((command) => isCommandAvailableInWorkspace(command, canonicalWorkspace));
}

export function getDefaultGamepadActionMap(
  workspace: GamepadWorkspace,
): Partial<Record<GamepadControlId, NativeMenuCommand>> {
  return { ...(DEFAULT_COMMANDS[toCanonicalGamepadWorkspace(workspace)] ?? {}) };
}

export function updateGamepadBinding(
  profile: GamepadBindingProfile,
  workspace: GamepadWorkspace,
  controlId: GamepadControlId,
  patch: Partial<GamepadControlBinding>,
): GamepadBindingProfile {
  const canonicalWorkspace = toCanonicalGamepadWorkspace(workspace);
  const control = GAMEPAD_CONTROL_DEFINITIONS.find((candidate) => candidate.id === controlId);
  if (!control) {
    return profile;
  }

  const nextWorkspaceBindings = {
    ...profile[canonicalWorkspace],
    [controlId]: createBinding(
      control,
      sanitizeCommand(canonicalWorkspace, patch.command ?? profile[canonicalWorkspace][controlId].command),
      { ...profile[canonicalWorkspace][controlId], ...patch },
    ),
  };

  return withVideoAlias({
    ...profile,
    [canonicalWorkspace]: nextWorkspaceBindings,
  } as Record<CanonicalGamepadWorkspace, GamepadBindingMap>);
}

export function exportGamepadBindings(profile: GamepadBindingProfile): GamepadBindingExport {
  return Object.fromEntries(
    GAMEPAD_WORKSPACE_SCOPES.map(({ id, workspace }) => [
      id,
      cloneBindingMap(profile[workspace]),
    ]),
  ) as GamepadBindingExport;
}

export function resolveGamepadCommandEvents(input: {
  bindings: GamepadBindingProfile;
  workspace: GamepadWorkspace;
  gamepad: Gamepad;
  previousActiveControls: ReadonlySet<GamepadControlId>;
}): { commands: NativeMenuCommand[]; activeControls: Set<GamepadControlId> } {
  const bindings = input.bindings[toCanonicalGamepadWorkspace(input.workspace)];
  const activeControls = new Set<GamepadControlId>();
  const commands: NativeMenuCommand[] = [];

  for (const control of GAMEPAD_CONTROL_DEFINITIONS) {
    const binding = bindings[control.id];
    if (!binding.command) continue;
    if (!isControlActive(input.gamepad, control, binding)) continue;
    activeControls.add(control.id);
    if (!input.previousActiveControls.has(control.id)) {
      commands.push(binding.command);
    }
  }

  return { commands, activeControls };
}

function createBinding(
  control: GamepadControlDefinition,
  command: NativeMenuCommand | '',
  overrides: Partial<GamepadControlBinding> = {},
  validation?: {
    workspaceKey: string;
    issues: GamepadBindingValidationIssue[];
  },
): GamepadControlBinding {
  const base = control.kind === 'axis' || control.kind === 'trigger'
    ? DEFAULT_ANALOG_BINDING
    : DEFAULT_DIGITAL_BINDING;
  const curve = sanitizeCurve(overrides.curve, base.curve);
  if (validation && overrides.curve !== undefined && curve !== overrides.curve) {
    validation.issues.push({
      path: `${validation.workspaceKey}.${control.id}.curve`,
      message: 'Curve must be linear, quadratic, or cubic.',
    });
  }

  const triggerMin = clampNumber(overrides.triggerMin, 0, 1, base.triggerMin);
  const triggerMax = clampNumber(overrides.triggerMax, 0, 1, base.triggerMax);
  if (validation && triggerMin > triggerMax) {
    validation.issues.push({
      path: `${validation.workspaceKey}.${control.id}.triggerRange`,
      message: 'Trigger range start must be less than or equal to trigger range end.',
    });
  }
  const [safeTriggerMin, safeTriggerMax] = triggerMin <= triggerMax ? [triggerMin, triggerMax] : [base.triggerMin, base.triggerMax];

  return {
    command,
    threshold: clampNumber(overrides.threshold, 0.05, 1, base.threshold),
    deadzone: clampNumber(overrides.deadzone, 0, 0.95, base.deadzone),
    sensitivity: clampNumber(overrides.sensitivity, 0.1, 3, base.sensitivity),
    inverted: Boolean(overrides.inverted ?? base.inverted),
    curve,
    triggerMin: safeTriggerMin,
    triggerMax: safeTriggerMax,
  };
}

function isControlActive(gamepad: Gamepad, control: GamepadControlDefinition, binding: GamepadControlBinding): boolean {
  if (control.kind === 'axis') {
    const axis = gamepad.axes[control.axisIndex ?? -1] ?? 0;
    const directed = control.axisPolarity === 'negative' ? -axis : axis;
    return isAnalogValueActive(directed, binding);
  }

  if (control.kind === 'trigger') {
    const button = gamepad.buttons[control.buttonIndex ?? -1];
    const value = button?.value ?? (button?.pressed ? 1 : 0);
    return isAnalogValueActive(value, binding);
  }

  const button = gamepad.buttons[control.buttonIndex ?? -1];
  const value = button?.value ?? (button?.pressed ? 1 : 0);
  return value >= binding.threshold || Boolean(button?.pressed && binding.threshold <= 1);
}

function isAnalogValueActive(value: number, binding: GamepadControlBinding): boolean {
  const maybeInverted = binding.inverted ? -value : value;
  const normalized = Math.max(0, (maybeInverted - binding.deadzone) / Math.max(0.01, 1 - binding.deadzone));
  const curved = applyCurve(normalized, binding.curve);
  const scaled = Math.min(1, Math.max(0, curved * binding.sensitivity));
  const ranged = Math.max(0, Math.min(1, (scaled - binding.triggerMin) / Math.max(0.01, binding.triggerMax - binding.triggerMin)));
  return ranged >= binding.threshold;
}

function sanitizeCommand(workspace: CanonicalGamepadWorkspace, command: unknown): NativeMenuCommand | '' {
  if (typeof command !== 'string') return '';
  if (!NATIVE_COMMAND_OPTIONS.includes(command as NativeMenuCommand)) return '';
  return isCommandAvailableInWorkspace(command as NativeMenuCommand, workspace) ? command as NativeMenuCommand : '';
}

function sanitizeCurve(value: unknown, fallback: GamepadAnalogCurve): GamepadAnalogCurve {
  if (typeof value !== 'string') return fallback;
  return VALID_CURVES.has(value as GamepadAnalogCurve) ? value as GamepadAnalogCurve : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function applyCurve(value: number, curve: GamepadAnalogCurve): number {
  switch (curve) {
    case 'quadratic':
      return value * value;
    case 'cubic':
      return value * value * value;
    case 'linear':
    default:
      return value;
  }
}

function toCanonicalGamepadWorkspace(workspace: GamepadWorkspace): CanonicalGamepadWorkspace {
  return WORKSPACE_ALIASES[workspace];
}

function cloneBindingMap(bindings: GamepadBindingMap): GamepadBindingMap {
  return Object.fromEntries(
    GAMEPAD_CONTROL_DEFINITIONS.map((control) => [control.id, { ...bindings[control.id] }]),
  ) as GamepadBindingMap;
}

function withVideoAlias(
  profile: Record<CanonicalGamepadWorkspace, GamepadBindingMap>,
): GamepadBindingProfile {
  const typedProfile = profile as GamepadBindingProfile;
  Object.defineProperty(typedProfile, 'video', {
    value: typedProfile.editor,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return typedProfile;
}

const NATIVE_COMMAND_OPTIONS = [...NATIVE_MENU_COMMANDS];
