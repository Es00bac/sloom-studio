import type { NativeMenuCommand } from './nativeApp';
import type { WorkspaceView } from '../types/flow';
import {
  getDefaultVideoNativeCommandShortcuts,
  VIDEO_TRIM_NATIVE_COMMANDS,
  type VideoCommandContext,
} from './videoCommandRegistry';

type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'target'
>;

export type KeyboardShortcutMap = Partial<Record<NativeMenuCommand, string>>;
export interface KeyboardShortcutResolutionOptions {
  /** Required for commands whose key meaning is safe only inside a focused Video sub-context. */
  videoContext?: VideoCommandContext;
}
export type KeyboardShortcutWorkspaceRoute =
  | 'global'
  | 'edit-workspaces'
  | 'flow-workspace-only'
  | 'image-workspace-only'
  | 'paper-workspace-only'
  | 'editor-workspace-only'
  | 'unsupported';

export interface KeyboardShortcutReadiness {
  commandsWithShortcuts: NativeMenuCommand[];
  missingCommandShortcuts: NativeMenuCommand[];
  collisions: Array<{
    workspace: WorkspaceView;
    shortcut: string;
    commands: NativeMenuCommand[];
  }>;
  workspaceRoutes: Array<{
    command: NativeMenuCommand;
    workspace: WorkspaceView | 'global' | 'edit';
    route: KeyboardShortcutWorkspaceRoute;
  }>;
  unsupported: Array<{
    kind: 'nested-tool-flyouts' | 'toolbar-customization';
    supported: false;
    caveat: string;
  }>;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcutMap = {
  'file:new': 'Ctrl+N',
  'file:open': 'Ctrl+O',
  'file:save': 'Ctrl+S',
  'file:save-as': 'Ctrl+Shift+S',
  'file:import-media': 'Ctrl+I',
  'settings:gamepad-bindings': 'Ctrl+Alt+G',
  'edit:undo': 'Ctrl+Z',
  'edit:redo': 'Ctrl+Shift+Z',
  'edit:cut': 'Ctrl+X',
  'edit:copy': 'Ctrl+C',
  'edit:paste': 'Ctrl+V',
  'edit:delete': 'Del',
  'edit:select-all': 'Ctrl+A',
  'edit:deselect': 'Ctrl+D',
  'edit:invert-selection': 'Ctrl+Shift+I',
  'view:flow': 'Ctrl+1',
  'view:editor': 'Ctrl+2',
  'view:image': 'Ctrl+3',
  'view:paper': 'Ctrl+4',
  'view:toggle-interface': 'Tab',
  'view:command-palette': 'Ctrl+K',
  'image:tool-hand': 'H',
  'image:tool-move': 'V',
  'image:tool-marquee': 'M',
  'image:tool-lasso': 'L',
  'image:tool-magic-wand': 'W',
  'image:tool-brush': 'B',
  'image:tool-pen': 'Shift+B',
  'image:tool-eraser': 'E',
  'image:tool-background-eraser': 'Alt+E',
  'image:tool-magic-eraser': 'Shift+E',
  'image:tool-clone-stamp': 'S',
  'image:tool-spot-heal': 'J',
  'image:tool-blur-brush': 'R',
  'image:tool-sharpen-brush': 'Shift+R',
  'image:tool-smudge-brush': 'U',
  'image:tool-dodge-brush': 'O',
  'image:tool-burn-brush': 'Shift+O',
  'image:tool-sponge-saturate': 'P',
  'image:tool-sponge-desaturate': 'Shift+P',
  'image:tool-paint-bucket': 'G',
  'image:tool-gradient': 'Shift+G',
  'image:tool-rectangle-shape': 'X',
  'image:tool-ellipse-shape': 'Shift+X',
  'image:tool-crop': 'C',
  'image:tool-text': 'T',
  'image:tool-eyedropper': 'I',
  ...getDefaultVideoNativeCommandShortcuts(),
  'timeline:cut': 'C',
  'timeline:hand': 'H',
  'timeline:snap': 'M',
  'timeline:zoom-in-out': 'Shift+\\',
  'timeline:zoom-playhead': 'Ctrl+\\',
  'timeline:previous-zoom': 'Alt+\\',
  'timeline:add-marker': 'Ctrl+M',
  'timeline:previous-marker': 'Shift+M',
  'timeline:next-marker': 'Alt+M',
  'timeline:link': 'Ctrl+L',
  'timeline:unlink': 'Ctrl+Shift+L',
  'timeline:group': 'Ctrl+G',
  'timeline:ungroup': 'Ctrl+Shift+G',
  'timeline:add-keyframe': 'Shift+K',
  'timeline:previous-keyframe': '[',
  'timeline:next-keyframe': ']',
  'paper:tool-select': 'V',
  'paper:tool-hand': 'H',
  'paper:tool-text': 'T',
  'paper:tool-image': 'Shift+I',
  'paper:tool-eyedropper': 'I',
  'paper:new-document': 'Ctrl+Alt+N',
  'paper:add-page': 'Ctrl+Alt+P',
  'paper:export-pdf': 'Ctrl+P',
  'help:keyboard-shortcuts': 'F1',
};

const EDIT_WORKSPACES = new Set<WorkspaceView>(['flow', 'editor', 'image', 'paper']);

export function resolveKeyboardShortcutCommand(
  event: KeyboardShortcutEvent,
  workspace: WorkspaceView,
  shortcuts: KeyboardShortcutMap = {},
  options: KeyboardShortcutResolutionOptions = {},
): NativeMenuCommand | undefined {
  const overrideShortcuts = sanitizeKeyboardShortcutMap(shortcuts);
  const resolvedShortcuts = resolveKeyboardShortcutMap(shortcuts);
  const commandPaletteShortcut = resolvedShortcuts['view:command-palette'];
  if (
    commandPaletteShortcut &&
    doesEventMatchShortcut(event, commandPaletteShortcut) &&
    isCommandAvailableInWorkspace('view:command-palette', workspace, options)
  ) {
    return 'view:command-palette';
  }

  if (isEditableShortcutTarget(event.target)) return undefined;

  // Computed once: Tab must never resolve to `view:toggle-interface` from inside a marked
  // keyboard-focus scope (an open Start-menu popover, the empty-canvas gallery panel), no
  // matter which candidate loop below would otherwise match it — the interface-toggle default
  // shortcut is present in `resolvedShortcuts` regardless of overrides, so every loop that
  // iterates commands needs this same exemption, not just the explicit fast-path below.
  const interfaceToggleSuppressed = isWithinKeyboardFocusScope(event.target);

  const interfaceToggleShortcut = resolvedShortcuts['view:toggle-interface'];
  if (
    interfaceToggleShortcut &&
    doesEventMatchShortcut(event, interfaceToggleShortcut) &&
    isCommandAvailableInWorkspace('view:toggle-interface', workspace, options) &&
    !interfaceToggleSuppressed
  ) {
    return 'view:toggle-interface';
  }

  const overrideCandidates = Object.entries(overrideShortcuts) as Array<[NativeMenuCommand, string]>;
  for (const [command, shortcut] of overrideCandidates) {
    if (command === 'view:toggle-interface' && interfaceToggleSuppressed) continue;
    if (!isCommandAvailableInWorkspace(command, workspace, options)) continue;
    if (doesEventMatchShortcut(event, shortcut)) return command;
  }

  if (EDIT_WORKSPACES.has(workspace)) {
    const key = event.key.toLowerCase();
    if (!event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && key === 'y') return 'edit:redo';
    if (!event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.key === 'Backspace') return 'edit:delete';
  }
  const candidates = Object.entries(resolvedShortcuts).filter(([command]) => !(command in overrideShortcuts)) as Array<[NativeMenuCommand, string]>;
  for (const [command, shortcut] of candidates) {
    if (command === 'view:toggle-interface' && interfaceToggleSuppressed) continue;
    if (!isCommandAvailableInWorkspace(command, workspace, options)) continue;
    if (doesEventMatchShortcut(event, shortcut)) return command;
  }
  return undefined;
}

// `<input>` types you can't TYPE into — a focused slider / checkbox / button must NOT block keyboard
// shortcuts. This is what broke volume-key and `[`/`]` brush sizing: the bottom-left brush size is an
// `<input type="range">`, and once focused it was treated as "typing", so the shortcut handler bailed.
const NON_TEXT_INPUT_TYPES = new Set([
  'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image',
]);

function isTextEntryInput(type: string | null | undefined): boolean {
  return !NON_TEXT_INPUT_TYPES.has((type ?? 'text').toLowerCase());
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined') {
    const candidate = target as
      | {
          tagName?: string;
          type?: string;
          isContentEditable?: boolean;
          closest?: (selector: string) => unknown;
        }
      | null;
    const tagName = candidate?.tagName?.toLowerCase();
    if (tagName === 'input') return isTextEntryInput(candidate?.type);
    if (tagName === 'textarea' || tagName === 'select') return true;
    if (candidate?.isContentEditable) return true;
    return Boolean(candidate?.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]'));
  }
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return isTextEntryInput(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return Boolean(target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]'));
}

/**
 * True when the keydown target sits inside a surface marked
 * `data-keyboard-focus-scope="true"` (e.g. an open Start-menu popover or the
 * empty-canvas gallery panel). Tab must move focus through these surfaces
 * like an ordinary popover instead of firing the global interface-toggle
 * shortcut, which would unmount the surface being navigated.
 */
export function isWithinKeyboardFocusScope(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined') {
    const candidate = target as { closest?: (selector: string) => unknown } | null;
    return Boolean(candidate?.closest?.('[data-keyboard-focus-scope="true"]'));
  }
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-keyboard-focus-scope="true"]'));
}

/**
 * True when a keystroke should be treated as text entry rather than a shortcut: the event target OR
 * the currently focused element is an editable field (input/textarea/select/contenteditable). Checks
 * `document.activeElement` too because focus and the keydown target can differ inside overlays/portals
 * — relying on `event.target` alone is what let tool hotkeys fire while typing in some fields.
 */
export function isTypingIntoEditableTarget(
  event: { target?: EventTarget | null } | null | undefined,
): boolean {
  if (isEditableShortcutTarget(event?.target ?? null)) return true;
  if (typeof document !== 'undefined' && isEditableShortcutTarget(document.activeElement)) return true;
  return false;
}

export function resolveKeyboardShortcutMap(overrides: KeyboardShortcutMap = {}): KeyboardShortcutMap {
  return {
    ...DEFAULT_KEYBOARD_SHORTCUTS,
    ...sanitizeKeyboardShortcutMap(overrides),
  };
}

export function getKeyboardShortcutLabel(
  command: NativeMenuCommand,
  overrides: KeyboardShortcutMap = {},
): string | undefined {
  return resolveKeyboardShortcutMap(overrides)[command];
}

export function sanitizeKeyboardShortcutMap(shortcuts: KeyboardShortcutMap): KeyboardShortcutMap {
  return Object.fromEntries(
    Object.entries(shortcuts)
      .map(([command, shortcut]) => [command, normalizeShortcutLabel(shortcut)])
      .filter((entry): entry is [NativeMenuCommand, string] => Boolean(entry[1])),
  );
}

export function normalizeShortcutLabel(shortcut: unknown): string {
  if (typeof shortcut !== 'string') return '';
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  const modifiers: string[] = [];
  let key = '';
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control' || normalized === 'cmdorctrl' || normalized === 'commandorcontrol') {
      if (!modifiers.includes('Ctrl')) modifiers.push('Ctrl');
    } else if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') {
      if (!modifiers.includes('Meta')) modifiers.push('Meta');
    } else if (normalized === 'shift') {
      if (!modifiers.includes('Shift')) modifiers.push('Shift');
    } else if (normalized === 'alt' || normalized === 'option') {
      if (!modifiers.includes('Alt')) modifiers.push('Alt');
    } else {
      key = normalizeShortcutKey(part);
    }
  }
  return key ? [...modifiers, key].join('+') : '';
}

function doesEventMatchShortcut(event: KeyboardShortcutEvent, shortcut: string): boolean {
  const normalized = normalizeShortcutLabel(shortcut);
  if (!normalized) return false;
  const parts = normalized.split('+');
  const key = parts.at(-1) ?? '';
  const modifiers = new Set(parts.slice(0, -1));
  const ctrlWanted = modifiers.has('Ctrl');
  const metaWanted = modifiers.has('Meta');
  const ctrlOrMetaWanted = ctrlWanted && !metaWanted;
  const eventCtrl = Boolean(event.ctrlKey);
  const eventMeta = Boolean(event.metaKey);
  const eventShift = Boolean(event.shiftKey);
  const eventAlt = Boolean(event.altKey);
  const eventCtrlOrMeta = eventCtrl || eventMeta;

  if (ctrlOrMetaWanted ? !eventCtrlOrMeta : eventCtrl !== ctrlWanted || eventMeta !== metaWanted) return false;
  if (eventShift !== modifiers.has('Shift')) return false;
  if (eventAlt !== modifiers.has('Alt')) return false;
  if (normalizeShortcutKey(event.key) === key) return true;
  // `KeyboardEvent.key` reports the shifted glyph (`|` for Shift+Backslash on a US
  // keyboard), while a saved shortcut label describes the physical key (`\\`).
  // Keep the key path for layout-aware letters and use `code` for punctuation whose
  // shifted glyph cannot round-trip through the free-text shortcut field.
  return Boolean(event.code && SHORTCUT_KEY_CODES[key] === event.code);
}

const SHORTCUT_KEY_CODES: Record<string, string> = {
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
};

function normalizeShortcutKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'delete') return 'Del';
  if (lower === 'del') return 'Del';
  if (lower === 'esc') return 'Esc';
  if (lower === 'escape') return 'Esc';
  if (lower === 'space') return 'Space';
  if (lower === 'backspace') return 'Backspace';
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

export function isCommandAvailableInWorkspace(
  command: NativeMenuCommand,
  workspace: WorkspaceView,
  options: KeyboardShortcutResolutionOptions = {},
): boolean {
  if (command.startsWith('file:') || command.startsWith('view:') || command.startsWith('help:') || command.startsWith('settings:')) {
    return true;
  }
  if (command.startsWith('edit:')) return EDIT_WORKSPACES.has(workspace);
  if (command.startsWith('image:')) return workspace === 'image';
  if (command.startsWith('paper:')) return workspace === 'paper';
  if (command.startsWith('timeline:')) {
    if (workspace !== 'editor') return false;
    if ((VIDEO_TRIM_NATIVE_COMMANDS as readonly NativeMenuCommand[]).includes(command)) {
      return options.videoContext === 'trim';
    }
    return true;
  }
  if (command.startsWith('flow:')) return workspace === 'flow';
  return false;
}

export function describeKeyboardShortcutReadiness(
  shortcuts: KeyboardShortcutMap = DEFAULT_KEYBOARD_SHORTCUTS,
): KeyboardShortcutReadiness {
  const normalizedEntries = Object.entries(shortcuts)
    .map(([command, shortcut]) => [command as NativeMenuCommand, normalizeShortcutLabel(shortcut)] as const);
  const commandsWithShortcuts = normalizedEntries
    .filter(([, shortcut]) => Boolean(shortcut))
    .map(([command]) => command);
  const missingCommandShortcuts = normalizedEntries
    .filter(([, shortcut]) => !shortcut)
    .map(([command]) => command);
  const workspaces: WorkspaceView[] = ['flow', 'editor', 'image', 'paper'];
  const collisions: KeyboardShortcutReadiness['collisions'] = [];

  for (const workspace of workspaces) {
    const buckets = new Map<string, NativeMenuCommand[]>();
    for (const [command, shortcut] of normalizedEntries) {
      if (!shortcut || !isCommandAvailableInWorkspace(command, workspace)) continue;
      buckets.set(shortcut, [...buckets.get(shortcut) ?? [], command]);
    }
    for (const [shortcut, commands] of buckets.entries()) {
      if (commands.length > 1) {
        collisions.push({ workspace, shortcut, commands });
      }
    }
  }

  return {
    commandsWithShortcuts,
    missingCommandShortcuts,
    collisions,
    workspaceRoutes: commandsWithShortcuts.map((command) => ({
      command,
      ...describeCommandWorkspaceRoute(command),
    })),
    unsupported: [
      {
        kind: 'nested-tool-flyouts',
        supported: false,
        caveat: 'Shortcuts target concrete commands; cycling nested tool flyouts is not implemented.',
      },
      {
        kind: 'toolbar-customization',
        supported: false,
        caveat: 'Shortcut customization can remap commands, but toolbar layout customization is not implemented.',
      },
    ],
  };
}

function describeCommandWorkspaceRoute(command: NativeMenuCommand): {
  workspace: WorkspaceView | 'global' | 'edit';
  route: KeyboardShortcutWorkspaceRoute;
} {
  if (command.startsWith('file:') || command.startsWith('view:') || command.startsWith('help:') || command.startsWith('settings:')) {
    return { workspace: 'global', route: 'global' };
  }
  if (command.startsWith('edit:')) return { workspace: 'edit', route: 'edit-workspaces' };
  if (command.startsWith('image:')) return { workspace: 'image', route: 'image-workspace-only' };
  if (command.startsWith('paper:')) return { workspace: 'paper', route: 'paper-workspace-only' };
  if (command.startsWith('timeline:')) return { workspace: 'editor', route: 'editor-workspace-only' };
  if (command.startsWith('flow:')) return { workspace: 'flow', route: 'flow-workspace-only' };
  return { workspace: 'global', route: 'unsupported' };
}
