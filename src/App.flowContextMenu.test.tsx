// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOW_NODE_CATALOG_CATEGORIES, nodeCategoryLabel } from './lib/nodeCatalog';
import { useSettingsStore } from './store/settingsStore';

vi.hoisted(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  } satisfies Storage);
});

const flowWorkspaceCapture = vi.hoisted(() => ({
  onPaneContextMenu: undefined as undefined | ((event: MouseEvent) => void),
}));

const contextMenuCapture = vi.hoisted(() => ({
  items: undefined as undefined | Array<{ id: string; label: string }>,
}));

const reactFlowApi = vi.hoisted(() => ({
  fitView: () => {},
  screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  setCenter: () => {},
}));

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => children,
    useReactFlow: () => reactFlowApi,
    useViewport: () => ({ zoom: 1 }),
}));

vi.mock('./features/flow/workspace/FlowWorkspaceShell', () => ({
  FlowWorkspaceShell: ({ onPaneContextMenu }: { onPaneContextMenu: (event: MouseEvent) => void }) => {
    flowWorkspaceCapture.onPaneContextMenu = onPaneContextMenu;
    return null;
  },
}));

vi.mock('./components/Common/SharedContextMenu', () => ({
  SharedContextMenu: ({ items }: { items: Array<{ id: string; label: string }> }) => {
    contextMenuCapture.items = items;
    return null;
  },
}));

vi.mock('./components/Settings/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('./components/Layout/CommunityStartupNotice', () => ({ CommunityStartupNotice: () => null }));
vi.mock('./components/Layout/FirstRunLanguageGate', () => ({ FirstRunLanguageGate: () => null }));
vi.mock('./components/Layout/TopNavbar', () => ({ TopNavbar: () => null }));
vi.mock('./components/Layout/EditBatonReadOnlyOverlay', () => ({ EditBatonReadOnlyOverlay: () => null }));
vi.mock('./components/Layout/SharedWorkspaceDockablePanels', () => ({ SharedWorkspaceDockablePanels: () => null }));
vi.mock('./components/Common/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('./components/Common/TextInputDialog', () => ({ TextInputDialog: () => null }));
vi.mock('./components/Common/AlertDialog', () => ({ AlertDialog: () => null }));
vi.mock('./components/Common/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./components/Common/ActivityTrailPanel', () => ({ ActivityTrailPanel: () => null }));
vi.mock('./components/Common/GamepadInputManager', () => ({ GamepadInputManager: () => null }));
vi.mock('./components/Recovery/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children?: ReactNode }) => children }));
vi.mock('./lib/nativeApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/nativeApp')>();
  return {
    ...actual,
    dispatchNativeRendererCommand: () => undefined,
    getSignalLoomNativeBridge: () => undefined,
  };
});

import App from './App';

describe('Flow canvas context menu locale', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    flowWorkspaceCapture.onPaneContextMenu = undefined;
    contextMenuCapture.items = undefined;
    useSettingsStore.setState({ locale: 'en', localeChosen: false });
  });

  it('uses the newly selected locale when the user next opens the Flow canvas context menu', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<App />));
    expect(flowWorkspaceCapture.onPaneContextMenu).toBeTypeOf('function');

    await act(async () => useSettingsStore.getState().setLocale('ja'));
    await act(async () => flowWorkspaceCapture.onPaneContextMenu?.({
      clientX: 120,
      clientY: 80,
      preventDefault: () => {},
      stopPropagation: () => {},
    } as MouseEvent));

    const generateCategory = FLOW_NODE_CATALOG_CATEGORIES.find((category) => category.id === 'generate');
    expect(generateCategory).toBeDefined();
    expect(contextMenuCapture.items?.find((item) => item.id === 'node-category-generate')?.label)
      .toBe(nodeCategoryLabel(generateCategory!, 'ja'));
  });
});
