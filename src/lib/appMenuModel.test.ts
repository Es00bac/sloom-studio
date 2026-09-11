import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_APP_LAUNCH_DESCRIPTORS,
  buildAppMenuGroups,
  buildWorkspaceSuiteStandaloneHandoff,
  getWorkspaceAppLaunchDescriptor,
  shouldShowIntegratedAppMenu,
} from './appMenuModel';

describe('renderer app menu model (per-workspace)', () => {
  it('returns only the active workspace\'s idiomatic top-level menus', () => {
    expect(buildAppMenuGroups('image').map((group) => group.label))
      .toEqual(['Project', 'File', 'Edit', 'Image', 'Select', 'Tools', 'View', 'Window', 'Help']);
    expect(buildAppMenuGroups('paper').map((group) => group.label))
      .toEqual(['Project', 'File', 'Edit', 'Layout', 'Insert', 'Tools', 'View', 'Window', 'Help']);
    expect(buildAppMenuGroups('editor').map((group) => group.label))
      .toEqual(['Project', 'Edit', 'Timeline', 'Keyframes', 'View', 'Window', 'Help']);
    expect(buildAppMenuGroups('flow').map((group) => group.label))
      .toEqual(['Project', 'Flow', 'View', 'Window', 'Help']);
  });

  it('does not show other workspaces\' menus and marks every returned group active', () => {
    const image = buildAppMenuGroups('image');
    expect(image.map((g) => g.label)).not.toContain('Paper');
    expect(image.map((g) => g.label)).not.toContain('Timeline');
    expect(image.every((g) => g.enabled)).toBe(true);
  });

  it('keeps project file commands available (separators/roles filtered out of the integrated menu)', () => {
    const project = buildAppMenuGroups('flow').find((group) => group.label === 'Project');
    const commands = project?.items.map((item) => item.command);
    expect(commands).toEqual([
      'file:new',
      'file:open',
      'file:save',
      'file:save-as',
      'file:import-media',
      'file:set-scratch-folder',
      'settings:keyboard-shortcuts',
      'settings:gamepad-bindings',
      'file:export-project',
      'file:export-assets',
    ]);
  });

  it('carries cross-app switching in the Window menu of every workspace', () => {
    for (const ws of ['flow', 'editor', 'image', 'paper'] as const) {
      const windowMenu = buildAppMenuGroups(ws).find((group) => group.label === 'Window');
      expect(windowMenu?.items.map((item) => item.command)).toEqual(
        expect.arrayContaining(['view:flow', 'view:editor', 'view:image', 'view:paper']),
      );
    }
  });

  it('flattens Image Edit + Tools commands into the integrated Image bar', () => {
    const groups = buildAppMenuGroups('image');
    const edit = groups.find((group) => group.label === 'Edit');
    const tools = groups.find((group) => group.label === 'Tools');
    expect(edit?.items.map((item) => item.command)).toEqual(['edit:undo', 'edit:redo', 'edit:cut', 'edit:copy', 'edit:paste', 'edit:delete']);
    expect(tools?.items.map((item) => item.command)).toEqual(expect.arrayContaining([
      'image:tool-hand', 'image:tool-move', 'image:tool-brush', 'image:tool-background-eraser',
      'image:tool-sharpen-brush', 'image:tool-rectangle-shape', 'image:tool-text', 'image:tool-eyedropper',
    ]));
    expect(tools?.items.find((item) => item.command === 'image:tool-background-eraser')?.shortcut).toBe('Alt+E');
  });

  it('exposes Paper exports (flattened from Project > Export) only in Paper', () => {
    const paperProject = buildAppMenuGroups('paper').find((group) => group.label === 'Project');
    const commands = paperProject?.items.map((item) => item.command);
    expect(commands).toEqual(expect.arrayContaining([
      'paper:export-pdf', 'paper:export-epub', 'paper:export-cbz', 'paper:export-idml',
      'paper:export-stories-txt', 'paper:package-print', 'paper:export-json',
    ]));
    // Paper export commands must not leak into the Image bar.
    const imageCommands = buildAppMenuGroups('image').flatMap((g) => g.items.map((i) => i.command));
    expect(imageCommands).not.toContain('paper:export-pdf');
  });

  it('exposes the interface toggle + layout defaults in the View menu', () => {
    const viewMenu = buildAppMenuGroups('image').find((group) => group.label === 'View');
    expect(viewMenu?.items.find((item) => item.command === 'view:toggle-interface')).toMatchObject({ shortcut: 'Tab' });
    const commands = viewMenu?.items.map((item) => item.command);
    expect(commands).toEqual(expect.arrayContaining(['view:layout-reset', 'view:layout-balanced', 'view:layout-focus', 'view:layout-all-panels']));
  });

  it('includes tutorial and feature help entries in the Help menu', () => {
    const helpMenu = buildAppMenuGroups('flow').find((group) => group.label === 'Help');
    expect(helpMenu?.items.map((item) => item.command)).toEqual([
      'help:project-documentation', 'help:tutorial', 'help:feature-help', 'help:keyboard-shortcuts', 'help:about',
    ]);
  });

  it('publishes deterministic workspace launch descriptors for menu identity and launch mode', () => {
    expect(WORKSPACE_APP_LAUNCH_DESCRIPTORS).toEqual([
      { workspace: 'flow', appName: 'Flow', menuGroupId: 'flow', menuGroupLabel: 'Flow', launchCommand: 'view:flow', launchLabel: 'Open/Focus Flow Window', shortcut: 'Ctrl+1', iconId: 'flow', suiteLaunchStatus: 'available', standaloneLaunchStatus: 'native-bridge-window' },
      { workspace: 'editor', appName: 'Video', menuGroupId: 'video', menuGroupLabel: 'Video', launchCommand: 'view:editor', launchLabel: 'Open/Focus Video Window', shortcut: 'Ctrl+2', iconId: 'editor', suiteLaunchStatus: 'available', standaloneLaunchStatus: 'native-bridge-window' },
      { workspace: 'image', appName: 'Image', menuGroupId: 'image', menuGroupLabel: 'Image', launchCommand: 'view:image', launchLabel: 'Open/Focus Image Window', shortcut: 'Ctrl+3', iconId: 'image', suiteLaunchStatus: 'available', standaloneLaunchStatus: 'native-bridge-window' },
      { workspace: 'paper', appName: 'Paper', menuGroupId: 'paper', menuGroupLabel: 'Paper', launchCommand: 'view:paper', launchLabel: 'Open/Focus Paper Window', shortcut: 'Ctrl+4', iconId: 'paper', suiteLaunchStatus: 'available', standaloneLaunchStatus: 'native-bridge-window' },
    ]);
    expect(getWorkspaceAppLaunchDescriptor('image').appName).toBe('Image');
  });

  it('builds suite-to-standalone handoff descriptors from launch menu identity', () => {
    expect(buildWorkspaceSuiteStandaloneHandoff('image')).toEqual({
      workspace: 'image',
      appName: 'Image',
      suiteCommand: 'view:image',
      suiteMenuGroupId: 'image',
      suiteMenuGroupLabel: 'Image',
      standaloneEntryPoint: 'signal-loom://workspace/image',
      standaloneMode: 'shared-binary-window',
      handoffStatus: 'ready',
      caveat: 'The Image workspace can be launched from the suite menu or deep-linked into the shared Sloom Studio binary; it is not a separately signed standalone executable.',
      signature: 'workspace-handoff:v1|image|view:image|signal-loom://workspace/image|shared-binary-window',
    });
  });

  it('translates group + item labels when locale is ja, keeping brand names and English default', () => {
    // Default (no locale arg) stays English — guards every other assertion in this file.
    expect(buildAppMenuGroups('paper').map((g) => g.label))
      .toEqual(['Project', 'File', 'Edit', 'Layout', 'Insert', 'Tools', 'View', 'Window', 'Help']);

    // Japanese: chrome translates, command ids are unchanged.
    const jaPaper = buildAppMenuGroups('paper', {}, 'ja');
    expect(jaPaper.map((g) => g.label))
      .toEqual(['プロジェクト', 'ファイル', '編集', 'レイアウト', '挿入', 'ツール', '表示', 'ウィンドウ', 'ヘルプ']);
    const edit = jaPaper.find((g) => g.label === '編集');
    expect(edit?.items.find((i) => i.command === 'edit:undo')?.label).toBe('元に戻す');
    const project = jaPaper.find((g) => g.label === 'プロジェクト');
    expect(project?.items.find((i) => i.command === 'paper:export-pdf')?.label).toBe('印刷用 PDF を書き出し...');
    expect(project?.items.find((i) => i.command === 'paper:export-epub')?.label).toBe('EPUB を書き出し...');
    // Command ids never change with locale.
    expect(edit?.items.map((i) => i.command)).toEqual(
      buildAppMenuGroups('paper').find((g) => g.label === 'Edit')?.items.map((i) => i.command),
    );

    // The Flow workspace group is a product proper noun — it stays "Flow" even in Japanese.
    expect(buildAppMenuGroups('flow', {}, 'ja').map((g) => g.label)).toContain('Flow');
  });

  it('renders the integrated menu on web/Android and Linux Electron, but defers to the native menu on macOS/Windows', () => {
    // Web / Android — no native shell, always show the integrated menu.
    expect(shouldShowIntegratedAppMenu(false)).toBe(true);
    // Electron shell, platform unknown — defer to the native menu (back-compat default).
    expect(shouldShowIntegratedAppMenu(true)).toBe(false);
    // Linux Electron — native menu bar is unreliable (Wayland/AppImage), show the integrated menu.
    expect(shouldShowIntegratedAppMenu(true, 'linux')).toBe(true);
    // macOS / Windows Electron — keep the reliable native menu.
    expect(shouldShowIntegratedAppMenu(true, 'darwin')).toBe(false);
    expect(shouldShowIntegratedAppMenu(true, 'win32')).toBe(false);
  });
});
