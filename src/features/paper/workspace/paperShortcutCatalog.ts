import { buildAppMenuGroups } from '../../../lib/appMenuModel';
import type { AppLocale } from '../../../lib/i18n';
import {
  getKeyboardShortcutLabel,
  type KeyboardShortcutMap,
} from '../../../lib/keyboardShortcuts';
import type { NativeMenuCommand } from '../../../lib/nativeApp';

export type PaperShortcutSource = 'command' | 'canvas' | 'text-editing';

export interface PaperShortcutItem {
  id: string;
  label: string;
  shortcut: string;
  description?: string;
  source: PaperShortcutSource;
  command?: NativeMenuCommand;
}

export interface PaperShortcutGroup {
  id: string;
  label: string;
  items: PaperShortcutItem[];
}

export interface PaperShortcutCatalogLabels {
  canvasGroup: string;
  textEditingGroup: string;
}

export const DEFAULT_PAPER_SHORTCUT_CATALOG_LABELS: PaperShortcutCatalogLabels = {
  canvasGroup: 'Canvas',
  textEditingGroup: 'Text editing',
};

/**
 * Context-specific shortcuts implemented directly by PaperWorkspace. Menu-routed
 * commands are deliberately not repeated here: buildPaperShortcutCatalog reads
 * those from the shared Paper menu and the live keyboard-shortcut resolver below.
 */
const PAPER_DIRECT_SHORTCUT_GROUPS: ReadonlyArray<{
  id: 'canvas' | 'text-editing';
  labelKey: keyof PaperShortcutCatalogLabels;
  items: readonly PaperShortcutItem[];
}> = [
  {
    id: 'canvas',
    labelKey: 'canvasGroup',
    items: [
      {
        id: 'canvas:nudge',
        label: 'Nudge selected frame',
        shortcut: 'Arrow keys',
        description: 'Move by 1 mm.',
        source: 'canvas',
      },
      {
        id: 'canvas:nudge-large',
        label: 'Nudge selected frame farther',
        shortcut: 'Shift+Arrow keys',
        description: 'Move by 10 mm.',
        source: 'canvas',
      },
      {
        id: 'canvas:nudge-precise',
        label: 'Nudge selected frame precisely',
        shortcut: 'Alt+Arrow keys',
        description: 'Move by 0.25 mm.',
        source: 'canvas',
      },
      {
        id: 'canvas:add-selection',
        label: 'Add a frame to the selection',
        shortcut: 'Shift+Click',
        source: 'canvas',
      },
      {
        id: 'canvas:toggle-selection',
        label: 'Toggle a frame in the selection',
        shortcut: 'Ctrl/Cmd+Click',
        source: 'canvas',
      },
      {
        id: 'canvas:finish-polygon',
        label: 'Finish a free polygon',
        shortcut: 'Enter',
        description: 'Available after placing at least three points.',
        source: 'canvas',
      },
      {
        id: 'canvas:cancel-transient',
        label: 'Cancel the current transient action',
        shortcut: 'Esc',
        description: 'Closes the context menu and clears an unfinished polygon.',
        source: 'canvas',
      },
      {
        id: 'canvas:redo-alternate',
        label: 'Redo (alternate)',
        shortcut: 'Ctrl/Cmd+Y',
        source: 'canvas',
      },
      {
        id: 'canvas:delete-alternate',
        label: 'Delete selected frames (alternate)',
        shortcut: 'Backspace',
        source: 'canvas',
      },
    ],
  },
  {
    id: 'text-editing',
    labelKey: 'textEditingGroup',
    items: [
      {
        id: 'text:bold',
        label: 'Bold',
        shortcut: 'Ctrl/Cmd+B',
        description: 'While editing rich text.',
        source: 'text-editing',
      },
      {
        id: 'text:italic',
        label: 'Italic',
        shortcut: 'Ctrl/Cmd+I',
        description: 'While editing rich text.',
        source: 'text-editing',
      },
      {
        id: 'text:underline',
        label: 'Underline',
        shortcut: 'Ctrl/Cmd+U',
        description: 'While editing rich text.',
        source: 'text-editing',
      },
      {
        id: 'text:commit-plain',
        label: 'Commit plain-text editing',
        shortcut: 'Ctrl/Cmd+Enter',
        description: 'Applies the current plain-text frame edit.',
        source: 'text-editing',
      },
      {
        id: 'text:cancel-plain',
        label: 'Cancel plain-text editing',
        shortcut: 'Esc',
        source: 'text-editing',
      },
    ],
  },
];

/**
 * Build the visible Paper shortcut catalog from the same shared menu groups and
 * resolved shortcut map used by the application. User overrides therefore show
 * up without maintaining a second list of key bindings. Direct canvas and text
 * gestures are appended because those intentionally bypass native menu commands.
 */
export function buildPaperShortcutCatalog(
  shortcuts: KeyboardShortcutMap = {},
  locale: AppLocale = 'en',
  labels: PaperShortcutCatalogLabels = DEFAULT_PAPER_SHORTCUT_CATALOG_LABELS,
): PaperShortcutGroup[] {
  const commandGroups = buildAppMenuGroups('paper', shortcuts, locale)
    .map((group): PaperShortcutGroup => ({
      id: `menu:${group.id}`,
      label: group.label,
      items: group.items.flatMap((item): PaperShortcutItem[] => {
        const shortcut = getKeyboardShortcutLabel(item.command, shortcuts);
        if (!shortcut) return [];
        return [{
          id: `command:${item.command}`,
          label: item.label,
          shortcut,
          source: 'command',
          command: item.command,
        }];
      }),
    }))
    .filter((group) => group.items.length > 0);

  const directGroups = PAPER_DIRECT_SHORTCUT_GROUPS.map((group): PaperShortcutGroup => ({
    id: group.id,
    label: labels[group.labelKey],
    items: group.items.map((item) => ({ ...item })),
  }));

  return [...commandGroups, ...directGroups];
}

export function filterPaperShortcutCatalog(
  groups: readonly PaperShortcutGroup[],
  query: string,
): PaperShortcutGroup[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return groups.map(copyGroup);
  }

  return groups.flatMap((group): PaperShortcutGroup[] => {
    const groupMatches = normalizeSearchText(group.label).includes(normalizedQuery);
    const items = groupMatches
      ? group.items.map((item) => ({ ...item }))
      : group.items.filter((item) => paperShortcutSearchText(group, item).includes(normalizedQuery)).map((item) => ({ ...item }));
    return items.length ? [{ ...group, items }] : [];
  });
}

export function countPaperShortcuts(groups: readonly PaperShortcutGroup[]): number {
  return groups.reduce((total, group) => total + group.items.length, 0);
}

function copyGroup(group: PaperShortcutGroup): PaperShortcutGroup {
  return {
    ...group,
    items: group.items.map((item) => ({ ...item })),
  };
}

function paperShortcutSearchText(group: PaperShortcutGroup, item: PaperShortcutItem): string {
  return normalizeSearchText([
    group.label,
    item.label,
    item.shortcut,
    item.description,
    item.command,
    item.source,
    item.shortcut.replaceAll('Ctrl', 'Cmd'),
  ].filter(Boolean).join(' '));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
}
