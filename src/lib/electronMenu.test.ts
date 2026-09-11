import { describe, expect, it } from 'vitest';

interface ElectronMenuModule {
  SIGNAL_LOOM_MENU_COMMANDS: Record<string, string>;
  DESKTOP_WORKSPACE_MENU_DESCRIPTORS: { workspace: string; menuLabel: string }[];
  createApplicationMenuTemplate: (options: {
    appName: string;
    isMac?: boolean;
    activeWorkspace?: string;
    keyboardShortcuts?: Record<string, string>;
    sendCommand: (command: string) => void;
  }) => ElectronMenuItem[];
}

interface ElectronMenuItem {
  label?: string;
  enabled?: boolean;
  accelerator?: string;
  role?: string;
  type?: string;
  click?: () => void;
  submenu?: ElectronMenuItem[];
}

async function loadMenuModule(): Promise<ElectronMenuModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/menu.cjs') as ElectronMenuModule;
}

function labelsOf(template: ElectronMenuItem[]): (string | undefined)[] {
  return template.map((entry) => entry.label);
}

function findItem(items: ElectronMenuItem[] | undefined, label: string): ElectronMenuItem | undefined {
  if (!items) return undefined;
  for (const item of items) {
    if (item.label === label) return item;
    const nested = findItem(item.submenu, label);
    if (nested) return nested;
  }
  return undefined;
}

describe('Electron native menu template (per-workspace)', () => {
  it('shows only the active workspace\'s idiomatic top-level menus', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const send = () => undefined;

    expect(labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'image', sendCommand: send })))
      .toEqual(['Project', 'File', 'Edit', 'Image', 'Select', 'Tools', 'View', 'Window', 'Help']);
    expect(labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'paper', sendCommand: send })))
      .toEqual(['Project', 'File', 'Edit', 'Layout', 'Insert', 'Tools', 'View', 'Window', 'Help']);
    expect(labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'editor', sendCommand: send })))
      .toEqual(['Project', 'Edit', 'Timeline', 'Keyframes', 'View', 'Window', 'Help']);
    expect(labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'flow', sendCommand: send })))
      .toEqual(['Project', 'Flow', 'View', 'Window', 'Help']);
  });

  it('does not show other workspaces\' menus', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const image = labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'image', sendCommand: () => undefined }));
    expect(image).not.toContain('Paper');
    expect(image).not.toContain('Timeline');
    expect(image).not.toContain('Flow');
  });

  it('dispatches stable command IDs with native accelerators from the Project menu', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const commands: string[] = [];
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'image', sendCommand: (c) => commands.push(c) });
    const project = template.find((entry) => entry.label === 'Project');
    const save = findItem(project?.submenu, 'Save');
    const saveAs = findItem(project?.submenu, 'Save As...');
    save?.click?.();
    saveAs?.click?.();
    expect(save?.accelerator).toBe('CommandOrControl+S');
    expect(saveAs?.accelerator).toBe('CommandOrControl+Shift+S');
    expect(commands).toEqual(['file:save', 'file:save-as']);
  });

  it('keeps the Window menu with all four workspace launchers in every workspace (cross-app switching)', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    for (const ws of ['flow', 'editor', 'image', 'paper']) {
      const commands: string[] = [];
      const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: ws, sendCommand: (c) => commands.push(c) });
      const windowMenu = template.find((entry) => entry.label === 'Window');
      expect(windowMenu, `Window menu missing for ${ws}`).toBeTruthy();
      for (const [label, command, accel] of [
        ['Open/Focus Flow Window', 'view:flow', 'CommandOrControl+1'],
        ['Open/Focus Video Window', 'view:editor', 'CommandOrControl+2'],
        ['Open/Focus Image Window', 'view:image', 'CommandOrControl+3'],
        ['Open/Focus Paper Window', 'view:paper', 'CommandOrControl+4'],
      ] as const) {
        const item = findItem(windowMenu?.submenu, label);
        expect(item?.accelerator).toBe(accel);
        item?.click?.();
        expect(commands.at(-1)).toBe(command);
      }
    }
  });

  it('dispatches Image Edit/Tools commands (not native text roles) with nested tool submenus', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const commands: string[] = [];
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'image', sendCommand: (c) => commands.push(c) });
    const edit = template.find((entry) => entry.label === 'Edit');
    const cut = findItem(edit?.submenu, 'Cut');
    expect(cut?.role).toBeUndefined();
    expect(cut?.accelerator).toBe('CommandOrControl+X');
    cut?.click?.();

    const tools = template.find((entry) => entry.label === 'Tools');
    expect(tools?.submenu?.map((s) => s.label)).toEqual(['Selection', 'Paint', 'Retouch', 'Shape & Type']);
    const brush = findItem(tools?.submenu, 'Brush Tool');
    expect(brush?.accelerator).toBe('B');
    brush?.click?.();
    expect(commands).toEqual(['edit:cut', 'image:tool-brush']);
  });

  it('wires the Image File menu to the .slimg open/save-as commands', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const commands: string[] = [];
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'image', sendCommand: (c) => commands.push(c) });
    const file = template.find((entry) => entry.label === 'File');
    expect(file).toBeTruthy();
    const open = findItem(file?.submenu, 'Open...');
    const saveAs = findItem(file?.submenu, 'Save As...');
    const compatibility = findItem(file?.submenu, 'Export .slimg v1 Compatibility Copy...');
    open?.click?.();
    saveAs?.click?.();
    compatibility?.click?.();
    expect(commands).toEqual([
      'image:file-open',
      'image:file-save-as',
      'image:file-export-v1-compatibility',
    ]);
  });

  it('wires the Paper File menu to the .slppr open/save/save-as commands', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const commands: string[] = [];
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'paper', sendCommand: (c) => commands.push(c) });
    const file = template.find((entry) => entry.label === 'File');
    expect(file).toBeTruthy();
    const open = findItem(file?.submenu, 'Open...');
    const save = findItem(file?.submenu, 'Save');
    const saveAs = findItem(file?.submenu, 'Save As...');
    open?.click?.();
    save?.click?.();
    saveAs?.click?.();
    expect(commands).toEqual(['paper:file-open', 'paper:file-save', 'paper:file-save-as']);
  });

  it('keeps the per-document File menu out of the Flow and Video workspaces', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    for (const ws of ['flow', 'editor']) {
      const other = labelsOf(createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: ws, sendCommand: () => undefined }));
      expect(other).not.toContain('File');
    }
  });

  it('puts Paper exports under Project > Export and dispatches them', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const commands: string[] = [];
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'paper', sendCommand: (c) => commands.push(c) });
    const project = template.find((entry) => entry.label === 'Project');
    const exportSubmenu = project?.submenu?.find((entry) => entry.label === 'Export');
    expect(exportSubmenu?.submenu).toBeTruthy();
    const exportPdf = findItem(exportSubmenu?.submenu, 'Export Print PDF...');
    expect(exportPdf?.accelerator).toBe('CommandOrControl+P');
    exportPdf?.click?.();
    findItem(exportSubmenu?.submenu, 'Export EPUB...')?.click?.();
    findItem(exportSubmenu?.submenu, 'Export CBZ...')?.click?.();
    findItem(exportSubmenu?.submenu, 'Export Stories TXT...')?.click?.();
    expect(commands).toEqual(['paper:export-pdf', 'paper:export-epub', 'paper:export-cbz', 'paper:export-stories-txt']);
  });

  it('keeps View roles (fullscreen/reload) and the layout-defaults submenu', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', activeWorkspace: 'flow', sendCommand: () => undefined });
    const view = template.find((entry) => entry.label === 'View');
    expect(view?.submenu?.some((entry) => entry.role === 'togglefullscreen')).toBe(true);
    expect(view?.submenu?.some((entry) => entry.role === 'reload')).toBe(true);
    const layout = findItem(view?.submenu, 'Workspace Layout Defaults');
    expect(layout?.submenu?.map((entry) => entry.label)).toEqual([
      'Reset Current Workspace Panels', 'Balanced Default', 'Focus Canvas', 'Show All Panels',
    ]);
  });

  it('uses customized shortcut accelerators when the renderer sends overrides', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const template = createApplicationMenuTemplate({
      appName: 'Sloom Studio',
      activeWorkspace: 'image',
      keyboardShortcuts: { 'image:tool-brush': 'Ctrl+Shift+B', 'edit:cut': 'Ctrl+Alt+X' },
      sendCommand: () => undefined,
    });
    const tools = template.find((entry) => entry.label === 'Tools');
    const edit = template.find((entry) => entry.label === 'Edit');
    expect(findItem(tools?.submenu, 'Brush Tool')?.accelerator).toBe('CommandOrControl+Shift+B');
    expect(findItem(edit?.submenu, 'Cut')?.accelerator).toBe('CommandOrControl+Alt+X');
  });

  it('prepends the macOS application menu when isMac', async () => {
    const { createApplicationMenuTemplate } = await loadMenuModule();
    const template = createApplicationMenuTemplate({ appName: 'Sloom Studio', isMac: true, activeWorkspace: 'image', sendCommand: () => undefined });
    expect(template[0]?.label).toBe('Sloom Studio');
    expect(template[1]?.label).toBe('Project');
  });
});
