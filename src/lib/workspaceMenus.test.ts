import { describe, expect, it } from 'vitest';
import workspaceMenuData from '../../shared/workspaceMenus.json';
import { NATIVE_MENU_COMMANDS } from './nativeApp';
import { buildAppMenuGroups } from './appMenuModel';
import type { WorkspaceView } from '../types/flow';

interface RawItem {
  command?: string;
  type?: string;
  role?: string;
  items?: RawItem[] | string;
}
const data = workspaceMenuData as unknown as Record<string, unknown> & {
  $shared: Record<string, RawItem[]>;
};
const WORKSPACES: WorkspaceView[] = ['flow', 'editor', 'image', 'paper'];
const NATIVE_COMMAND_SET = new Set<string>(NATIVE_MENU_COMMANDS as readonly string[]);

function resolveItems(items: RawItem[] | string | undefined): RawItem[] {
  if (typeof items === 'string' && items.startsWith('$')) return data.$shared[items.slice(1)] ?? [];
  return Array.isArray(items) ? items : [];
}

/** All command IDs in DFS order, flattening submenus and dropping separators/roles. */
function flattenCommands(items: RawItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.type === 'separator' || item.role) continue;
    if (item.command) out.push(item.command);
    else if (item.items) out.push(...flattenCommands(resolveItems(item.items)));
  }
  return out;
}

interface ElectronMenuItem { label?: string; command?: string; role?: string; click?: () => void; submenu?: ElectronMenuItem[]; }
interface ElectronMenuModule {
  createApplicationMenuTemplate: (o: { appName: string; isMac?: boolean; activeWorkspace?: string; locale?: string; sendCommand: (c: string) => void }) => ElectronMenuItem[];
}
async function loadNativeMenu(): Promise<ElectronMenuModule> {
  // @ts-expect-error CommonJS Electron helper outside the renderer tsconfig module graph.
  return await import('../../electron/menu.cjs') as ElectronMenuModule;
}
function clickAllInOrder(items: ElectronMenuItem[] | undefined): void {
  if (!items) return;
  for (const item of items) {
    if (item.submenu) clickAllInOrder(item.submenu);
    else item.click?.();
  }
}

describe('workspaceMenus single source of truth', () => {
  it('references only real native menu commands', () => {
    const groups = WORKSPACES.flatMap((ws) => (data[ws] as { items: RawItem[] | string }[]));
    const sharedGroups = Object.values(data.$shared);
    const allCommands = [
      ...groups.flatMap((g) => flattenCommands(resolveItems(g.items))),
      ...sharedGroups.flatMap((items) => flattenCommands(items)),
    ];
    expect(allCommands.length).toBeGreaterThan(0);
    const unknown = [...new Set(allCommands)].filter((c) => !NATIVE_COMMAND_SET.has(c));
    expect(unknown).toEqual([]);
  });

  it('produces identical top-level labels + command sequences in the native and integrated menus', async () => {
    const { createApplicationMenuTemplate } = await loadNativeMenu();
    for (const ws of WORKSPACES) {
      // Renderer (integrated) side.
      const groups = buildAppMenuGroups(ws);
      const rendererLabels = groups.map((g) => g.label);
      const rendererCommands = groups.flatMap((g) => g.items.map((i) => i.command));

      // Native side: capture command IDs by clicking each command item in order.
      const nativeCommands: string[] = [];
      const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', isMac: false, activeWorkspace: ws, sendCommand: (c) => nativeCommands.push(c) });
      const nativeLabels = template.map((g) => g.label);
      clickAllInOrder(template);

      expect(nativeLabels, `labels differ for ${ws}`).toEqual(rendererLabels);
      expect(nativeCommands, `commands differ for ${ws}`).toEqual(rendererCommands);
    }
  });

  it('keeps native and integrated labels identical in Japanese too (no cross-surface drift)', async () => {
    const { createApplicationMenuTemplate } = await loadNativeMenu();
    for (const ws of WORKSPACES) {
      const rendererLabels = buildAppMenuGroups(ws, {}, 'ja').map((g) => g.label);
      const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', isMac: false, activeWorkspace: ws, locale: 'ja', sendCommand: () => {} });
      expect(template.map((g) => g.label), `ja labels differ for ${ws}`).toEqual(rendererLabels);
    }
    // Sanity: at least one label actually changed from English (the JSON labelJa fields are wired).
    const jaFlow = buildAppMenuGroups('flow', {}, 'ja').map((g) => g.label);
    expect(jaFlow).toContain('ヘルプ'); // Help → ヘルプ
    expect(jaFlow).toContain('Flow'); // brand proper noun stays English
  });

  it('keeps all four window launchers in every workspace (cross-app switching never lost)', () => {
    for (const ws of WORKSPACES) {
      const windowMenu = buildAppMenuGroups(ws).find((g) => g.label === 'Window');
      const commands = windowMenu?.items.map((i) => i.command) ?? [];
      for (const launcher of ['view:flow', 'view:editor', 'view:image', 'view:paper']) {
        expect(commands, `${ws} Window menu missing ${launcher}`).toContain(launcher);
      }
    }
  });

  it('gives the Video workspace a Window toggle for every dockable panel', () => {
    const windowMenu = buildAppMenuGroups('editor').find((g) => g.label === 'Window');
    const commands = windowMenu?.items.map((i) => i.command) ?? [];
    const expected = [
      'editor:toggle-source-bin-panel',
      'editor:toggle-source-monitor-panel',
      'editor:toggle-program-monitor-panel',
      'editor:toggle-inspector-panel',
      'editor:toggle-timeline-panel',
      'editor:toggle-premiere-parity-panel',
      'editor:toggle-sequence-settings-panel',
      'editor:toggle-export-preset-panel',
      'editor:toggle-diagnostics-panel',
      'editor:reset-panels',
    ];
    for (const command of expected) {
      expect(commands, `editor Window menu missing ${command}`).toContain(command);
    }
  });
});
