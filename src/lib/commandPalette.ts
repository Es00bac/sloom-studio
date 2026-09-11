import { buildAppMenuGroups } from './appMenuModel';
import type { KeyboardShortcutMap } from './keyboardShortcuts';
import type { NativeMenuCommand } from './nativeApp';
import type { AppLocale } from './i18n';
import type { WorkspaceView } from '../types/flow';

export type CommandPaletteAppAction =
  | 'app:open-provider-settings'
  | 'app:open-flow-diagnostics'
  | 'app:clean-flow';

export type CommandPaletteEntry =
  | {
      id: string;
      type: 'menu';
      command: NativeMenuCommand;
      label: string;
      group: string;
      description: string;
      shortcut?: string;
      keywords: string[];
      disabled?: boolean;
    }
  | {
      id: string;
      type: 'app';
      action: CommandPaletteAppAction;
      label: string;
      group: string;
      description: string;
      shortcut?: string;
      keywords: string[];
      disabled?: boolean;
    };

export interface CommandPaletteBuildOptions {
  activeWorkspace: WorkspaceView;
  shortcuts?: KeyboardShortcutMap;
  locale?: AppLocale;
  flowNodeCount?: number;
  flowDiagnosticsCount?: number;
  canCleanFlow?: boolean;
}

const ALWAYS_VISIBLE_GROUPS = new Set(['project', 'view', 'help']);

export function buildCommandPaletteEntries({
  activeWorkspace,
  shortcuts = {},
  locale = 'en',
  flowNodeCount = 0,
  flowDiagnosticsCount = 0,
  canCleanFlow = false,
}: CommandPaletteBuildOptions): CommandPaletteEntry[] {
  const menuEntries = buildAppMenuGroups(activeWorkspace, shortcuts, locale)
    .filter((group) => group.enabled || ALWAYS_VISIBLE_GROUPS.has(group.id))
    .flatMap((group) => group.items
      .filter((item) => item.command !== 'view:command-palette')
      .map((item): CommandPaletteEntry => ({
        id: `menu:${item.command}`,
        type: 'menu',
        command: item.command,
        label: item.label,
        group: group.label,
        description: buildMenuCommandDescription(group.label, item.label),
        shortcut: item.shortcut,
        keywords: buildKeywords(group.label, item.label, item.command),
      })));

  const appEntries: CommandPaletteEntry[] = [
    {
      id: 'app:open-provider-settings',
      type: 'app',
      action: 'app:open-provider-settings',
      label: 'Provider Settings',
      group: 'Settings',
      description: 'Open API keys, model defaults, render backend, and provider setup.',
      keywords: ['settings', 'provider', 'api', 'models', 'render'],
    },
    {
      id: 'app:open-flow-diagnostics',
      type: 'app',
      action: 'app:open-flow-diagnostics',
      label: `Flow Diagnostics${flowDiagnosticsCount > 0 ? ` (${flowDiagnosticsCount})` : ''}`,
      group: 'Flow',
      description: flowDiagnosticsCount > 0
        ? 'Open Flow diagnostics, blockers, and debug signals.'
        : 'Open Flow diagnostics and debug signals.',
      keywords: ['flow', 'diagnostics', 'errors', 'debug', 'warnings'],
    },
  ];

  if (activeWorkspace === 'flow') {
    appEntries.push(
      {
        id: 'app:clean-flow',
        type: 'app',
        action: 'app:clean-flow',
        label: 'Clean Flow Workspace',
        group: 'Flow',
        description: flowNodeCount > 0
          ? 'Organize the current Flow graph into a cleaner workspace layout.'
          : 'Clean Flow is available after nodes are added to the canvas.',
        keywords: ['flow', 'organize', 'layout', 'clean', 'graph'],
        disabled: !canCleanFlow,
      },
    );
  }

  return dedupeCommandPaletteEntries([...appEntries, ...menuEntries]);
}

export function filterCommandPaletteEntries(
  entries: CommandPaletteEntry[],
  query: string,
  limit = 40,
): CommandPaletteEntry[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return entries.slice(0, limit);
  }

  const terms = normalizedQuery.split(' ').filter(Boolean);
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreCommandPaletteEntry(entry, terms),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.entry)
    .slice(0, limit);
}

function buildMenuCommandDescription(groupLabel: string, itemLabel: string): string {
  if (groupLabel === 'View') return 'Switch workspaces, show panels, or change the current workspace layout.';
  if (groupLabel === 'Project') return 'Run a project, file, import, export, or setup command.';
  if (groupLabel === 'Help') return 'Open documentation, tutorials, shortcuts, or product information.';
  return `Run ${itemLabel} in the ${groupLabel} workspace.`;
}

function buildKeywords(groupLabel: string, itemLabel: string, command: string): string[] {
  return [
    groupLabel,
    itemLabel,
    command,
    command.replaceAll(':', ' '),
  ].map(normalizeSearchText);
}

function dedupeCommandPaletteEntries(entries: CommandPaletteEntry[]): CommandPaletteEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

function scoreCommandPaletteEntry(entry: CommandPaletteEntry, terms: string[]): number {
  const label = normalizeSearchText(entry.label);
  const group = normalizeSearchText(entry.group);
  const description = normalizeSearchText(entry.description);
  const shortcut = normalizeSearchText(entry.shortcut ?? '');
  const keywords = entry.keywords.map(normalizeSearchText);

  return terms.reduce((score, term) => {
    if (label === term) return score + 80;
    if (label.startsWith(term)) return score + 60;
    if (label.includes(term)) return score + 40;
    if (group.includes(term)) return score + 28;
    if (keywords.some((keyword) => keyword.includes(term))) return score + 24;
    if (description.includes(term)) return score + 12;
    if (shortcut.includes(term)) return score + 8;
    return -1000;
  }, 0);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
