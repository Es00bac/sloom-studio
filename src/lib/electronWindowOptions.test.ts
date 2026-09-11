import { describe, expect, it, vi } from 'vitest';

interface ElectronWindowOptionsModule {
  buildWorkspaceWindowOpenResult: (
    details: { frameName?: string; features?: string },
    parentWindow: unknown,
  ) => {
    action: 'allow' | 'deny';
    overrideBrowserWindowOptions?: Record<string, unknown>;
  };
  focusFloatingPanelChildWindow: (
    parentWindow: unknown,
    childWindow: Record<string, unknown>,
    details?: { frameName?: string; features?: string },
  ) => void;
  isAllowedWorkspaceNavigation: (
    targetUrl: unknown,
    rendererEntryUrl: unknown,
    workspace: unknown,
  ) => boolean;
  isSignalLoomFloatingPanelWindow: (details: { frameName?: string; features?: string }) => boolean;
}

async function loadWindowOptionsModule(): Promise<ElectronWindowOptionsModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/window-options.cjs') as ElectronWindowOptionsModule;
}

describe('Electron floating panel window options', () => {
  it('parents Sloom Studio popup windows to the owning workspace window', async () => {
    const { buildWorkspaceWindowOpenResult } = await loadWindowOptionsModule();
    const parentWindow = { id: 1 };
    const result = buildWorkspaceWindowOpenResult({
      frameName: 'signal-loom-flow-source-bin',
      features: 'popup=yes,frame=false,width=360,height=420',
    }, parentWindow);

    expect(result.action).toBe('allow');
    expect(result.overrideBrowserWindowOptions).toMatchObject({
      parent: parentWindow,
      modal: false,
      frame: false,
      show: true,
      skipTaskbar: true,
    });
  });

  it('honors non-resizable fixed palette popup features for compact tool windows', async () => {
    const { buildWorkspaceWindowOpenResult } = await loadWindowOptionsModule();
    const parentWindow = { id: 1 };
    const result = buildWorkspaceWindowOpenResult({
      frameName: 'signal-loom-image-tools',
      features: 'popup=yes,frame=false,width=66,height=456,left=2368,top=192,resizable=no',
    }, parentWindow);

    expect(result.action).toBe('allow');
    expect(result.overrideBrowserWindowOptions).toMatchObject({
      parent: parentWindow,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      height: 456,
      maxHeight: 456,
      maxWidth: 66,
      minHeight: 456,
      minWidth: 66,
      resizable: false,
      transparent: true,
      useContentSize: true,
      width: 66,
      x: 2368,
      y: 192,
    });
  });

  it('denies unrelated renderer-created windows', async () => {
    const { buildWorkspaceWindowOpenResult } = await loadWindowOptionsModule();

    expect(buildWorkspaceWindowOpenResult({
      frameName: 'external',
      features: 'width=800,height=600',
    }, {})).toEqual({ action: 'deny' });
  });

  it('allows only the exact workspace renderer as a main-frame navigation target', async () => {
    const { isAllowedWorkspaceNavigation } = await loadWindowOptionsModule();
    const packagedEntry = 'file:///opt/sloom/resources/app.asar/dist/index.html';

    expect(isAllowedWorkspaceNavigation(
      `${packagedEntry}?workspace=image`,
      packagedEntry,
      'image',
    )).toBe(true);
    expect(isAllowedWorkspaceNavigation(
      `${packagedEntry}?workspace=paper`,
      packagedEntry,
      'image',
    )).toBe(false);
    expect(isAllowedWorkspaceNavigation(
      'file:///opt/sloom/resources/app.asar/dist/icc/SNAP_TR002_newsprint.icc',
      packagedEntry,
      'image',
    )).toBe(false);
    expect(isAllowedWorkspaceNavigation(
      'https://example.test/',
      packagedEntry,
      'image',
    )).toBe(false);
    expect(isAllowedWorkspaceNavigation('not a url', packagedEntry, 'image')).toBe(false);
  });

  it('focuses floating panel child windows above their owner', async () => {
    const { focusFloatingPanelChildWindow } = await loadWindowOptionsModule();
    const parentWindow = { id: 1 };
    const childWindow = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      moveTop: vi.fn(),
      restore: vi.fn(),
      setParentWindow: vi.fn(),
      show: vi.fn(),
    };

    focusFloatingPanelChildWindow(parentWindow, childWindow);

    expect(childWindow.setParentWindow).toHaveBeenCalledWith(parentWindow);
    expect(childWindow.restore).toHaveBeenCalled();
    expect(childWindow.show).toHaveBeenCalled();
    expect(childWindow.moveTop).toHaveBeenCalled();
    expect(childWindow.focus).toHaveBeenCalled();
  });

  it('clips fixed compact floating child windows to their requested palette shape', async () => {
    const { focusFloatingPanelChildWindow } = await loadWindowOptionsModule();
    const childWindow = {
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      moveTop: vi.fn(),
      setContentSize: vi.fn(),
      setMaximumSize: vi.fn(),
      setMinimumSize: vi.fn(),
      setParentWindow: vi.fn(),
      setResizable: vi.fn(),
      setShape: vi.fn(),
      setSize: vi.fn(),
      show: vi.fn(),
    };

    focusFloatingPanelChildWindow({ id: 1 }, childWindow, {
      features: 'popup=yes,frame=false,width=66,height=456,left=2368,top=192,resizable=no',
    });

    expect(childWindow.setResizable).toHaveBeenCalledWith(false);
    expect(childWindow.setMinimumSize).toHaveBeenCalledWith(66, 456);
    expect(childWindow.setMaximumSize).toHaveBeenCalledWith(66, 456);
    expect(childWindow.setContentSize).toHaveBeenCalledWith(66, 456);
    expect(childWindow.setSize).toHaveBeenCalledWith(66, 456);
    expect(childWindow.setShape).toHaveBeenCalledWith([{ x: 0, y: 0, width: 66, height: 456 }]);
  });
});
