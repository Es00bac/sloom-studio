import { buildNativeStandaloneEntryReadiness, type NativeMenuCommand } from './nativeApp';
import type { WorkspaceView } from '../types/flow';
import { getKeyboardShortcutLabel, type KeyboardShortcutMap } from './keyboardShortcuts';
import type { WorkspaceIconId } from './workspaceIcons';
import type { AppLocale } from './i18n';
import workspaceMenuData from '../../shared/workspaceMenus.json';

interface RawMenuItem {
  command?: NativeMenuCommand;
  label?: string;
  labelJa?: string;
  accelerator?: string;
  type?: 'separator';
  role?: string;
  nativeOnly?: boolean;
  items?: RawMenuItem[];
}
interface RawMenuGroup {
  id: string;
  label: string;
  labelJa?: string;
  items: RawMenuItem[] | string;
}

/** Pick a menu label for the active locale, falling back to English (and finally the command id). The
 *  bilingual `labelJa` fields live alongside `label` in shared/workspaceMenus.json so the integrated
 *  React menu, the native Electron menu, and the KDE global menu all translate from one source. */
function pickMenuLabel(node: { label?: string; labelJa?: string; command?: string }, locale: AppLocale): string {
  if (locale === 'ja' && node.labelJa) return node.labelJa;
  return node.label ?? node.command ?? '';
}
const WORKSPACE_MENUS = workspaceMenuData as unknown as Record<string, RawMenuGroup[]> & {
  $shared: Record<string, RawMenuItem[]>;
};
const WORKSPACE_MENU_KEYS: readonly WorkspaceView[] = ['flow', 'editor', 'image', 'paper'];

/** Resolve a group's `items` — either an inline array or a `$shared` reference like "$project". */
function resolveWorkspaceMenuItems(items: RawMenuItem[] | string): RawMenuItem[] {
  if (typeof items === 'string' && items.startsWith('$')) {
    return WORKSPACE_MENUS.$shared[items.slice(1)] ?? [];
  }
  return Array.isArray(items) ? items : [];
}

/**
 * The integrated React menu is a flat list per group, so submenu leaves are
 * flattened in and separators + native-only roles (quit/close/reload/…) are
 * dropped. The native Electron menu keeps the full nested structure.
 */
function flattenIntegratedMenuItems(items: RawMenuItem[], locale: AppLocale): AppMenuItem[] {
  const out: AppMenuItem[] = [];
  for (const item of items) {
    if (item.type === 'separator' || item.role || item.nativeOnly) continue;
    if (item.command) {
      out.push({ label: pickMenuLabel(item, locale), command: item.command, shortcut: item.accelerator });
    } else if (Array.isArray(item.items)) {
      out.push(...flattenIntegratedMenuItems(item.items, locale));
    }
  }
  return out;
}

export interface AppMenuItem {
  label: string;
  command: NativeMenuCommand;
  shortcut?: string;
}

export interface AppMenuGroup {
  id: string;
  label: string;
  enabled: boolean;
  items: AppMenuItem[];
}

export type WorkspaceMenuGroupId = 'flow' | 'video' | 'image' | 'paper';
export type WorkspaceSuiteLaunchStatus = 'available';
export type WorkspaceStandaloneLaunchStatus = 'native-bridge-window';

export interface WorkspaceAppLaunchDescriptor {
  workspace: WorkspaceView;
  appName: string;
  menuGroupId: WorkspaceMenuGroupId;
  menuGroupLabel: string;
  launchCommand: NativeMenuCommand;
  launchLabel: string;
  shortcut: string;
  iconId: WorkspaceIconId;
  suiteLaunchStatus: WorkspaceSuiteLaunchStatus;
  standaloneLaunchStatus: WorkspaceStandaloneLaunchStatus;
}

export type WorkspaceSuiteStandaloneHandoffStatus = 'ready';
export type WorkspaceStandaloneEntryPoint = `signal-loom://workspace/${WorkspaceView}`;

export interface WorkspaceSuiteStandaloneHandoff {
  workspace: WorkspaceView;
  appName: string;
  suiteCommand: NativeMenuCommand;
  suiteMenuGroupId: WorkspaceMenuGroupId;
  suiteMenuGroupLabel: string;
  standaloneEntryPoint: WorkspaceStandaloneEntryPoint;
  standaloneMode: 'shared-binary-window';
  handoffStatus: WorkspaceSuiteStandaloneHandoffStatus;
  caveat: string;
  signature: string;
}

export const WORKSPACE_APP_LAUNCH_DESCRIPTORS: readonly WorkspaceAppLaunchDescriptor[] = [
  {
    workspace: 'flow',
    appName: 'Flow',
    menuGroupId: 'flow',
    menuGroupLabel: 'Flow',
    launchCommand: 'view:flow',
    launchLabel: 'Open/Focus Flow Window',
    shortcut: 'Ctrl+1',
    iconId: 'flow',
    suiteLaunchStatus: 'available',
    standaloneLaunchStatus: 'native-bridge-window',
  },
  {
    workspace: 'editor',
    appName: 'Video',
    menuGroupId: 'video',
    menuGroupLabel: 'Video',
    launchCommand: 'view:editor',
    launchLabel: 'Open/Focus Video Window',
    shortcut: 'Ctrl+2',
    iconId: 'editor',
    suiteLaunchStatus: 'available',
    standaloneLaunchStatus: 'native-bridge-window',
  },
  {
    workspace: 'image',
    appName: 'Image',
    menuGroupId: 'image',
    menuGroupLabel: 'Image',
    launchCommand: 'view:image',
    launchLabel: 'Open/Focus Image Window',
    shortcut: 'Ctrl+3',
    iconId: 'image',
    suiteLaunchStatus: 'available',
    standaloneLaunchStatus: 'native-bridge-window',
  },
  {
    workspace: 'paper',
    appName: 'Paper',
    menuGroupId: 'paper',
    menuGroupLabel: 'Paper',
    launchCommand: 'view:paper',
    launchLabel: 'Open/Focus Paper Window',
    shortcut: 'Ctrl+4',
    iconId: 'paper',
    suiteLaunchStatus: 'available',
    standaloneLaunchStatus: 'native-bridge-window',
  },
];

export function getWorkspaceAppLaunchDescriptor(workspace: WorkspaceView): WorkspaceAppLaunchDescriptor {
  const descriptor = WORKSPACE_APP_LAUNCH_DESCRIPTORS.find((entry) => entry.workspace === workspace);
  if (!descriptor) {
    throw new Error(`Unknown workspace app launch descriptor: ${workspace}`);
  }
  return descriptor;
}

export function buildWorkspaceSuiteStandaloneHandoff(workspace: WorkspaceView): WorkspaceSuiteStandaloneHandoff {
  const descriptor = getWorkspaceAppLaunchDescriptor(workspace);
  const standalone = buildNativeStandaloneEntryReadiness(workspace);

  return {
    workspace,
    appName: descriptor.appName,
    suiteCommand: descriptor.launchCommand,
    suiteMenuGroupId: descriptor.menuGroupId,
    suiteMenuGroupLabel: descriptor.menuGroupLabel,
    standaloneEntryPoint: standalone.entryPoint,
    standaloneMode: standalone.mode,
    handoffStatus: 'ready',
    caveat: `The ${descriptor.appName} workspace can be launched from the suite menu or deep-linked into the shared Sloom Studio binary; it is not a separately signed standalone executable.`,
    signature: [
      'workspace-handoff:v1',
      workspace,
      descriptor.launchCommand,
      standalone.entryPoint,
      standalone.mode,
    ].join('|'),
  };
}

export function buildAppMenuGroups(
  activeWorkspace: WorkspaceView,
  shortcuts: KeyboardShortcutMap = {},
  locale: AppLocale = 'en',
): AppMenuGroup[] {
  // Return only the active workspace's idiomatic menu bar (no other-workspace
  // menus, no greying). Sourced from the shared workspaceMenus.json so the
  // integrated React menu and the native Electron menu can never drift.
  const key = WORKSPACE_MENU_KEYS.includes(activeWorkspace) ? activeWorkspace : 'flow';
  const groups: AppMenuGroup[] = (WORKSPACE_MENUS[key] ?? WORKSPACE_MENUS.flow).map((group) => ({
    id: group.id,
    label: pickMenuLabel(group, locale),
    enabled: true,
    items: flattenIntegratedMenuItems(resolveWorkspaceMenuItems(group.items), locale),
  }));

  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      shortcut: getKeyboardShortcutLabel(item.command, shortcuts) ?? item.shortcut,
    })),
  }));
}

export const APP_MENU_GROUPS: AppMenuGroup[] = buildAppMenuGroups('flow');

export function shouldShowIntegratedAppMenu(hasNativeBridge: boolean, platform?: string): boolean {
  // Web / Android (no native shell) always render the integrated React menu.
  // In an Electron shell we normally defer to the native menu — but on Linux the native menu
  // is unreliable: Wayland/AppImage builds can drop the in-window menu bar entirely, and the
  // global-menu export only works on desktops running a global-menu applet. So render the
  // integrated menu on Linux too. macOS keeps its reliable global menu bar; Windows keeps its
  // in-window native bar.
  return !hasNativeBridge || platform === 'linux';
}
