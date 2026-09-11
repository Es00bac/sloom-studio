// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from './store/editorStore';
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
  FlowWorkspaceShell: () => <div data-testid="flow-workspace" />,
}));

vi.mock('./components/ImageEditor/ImageEditorWorkspace', () => ({
  ImageEditorWorkspace: () => <div data-testid="image-workspace" />,
}));

vi.mock('./components/Common/SharedContextMenu', () => ({ SharedContextMenu: () => null }));
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('keyboard shortcut execution in App', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ keyboardShortcuts: {} });
    useEditorStore.getState().setWorkspaceView('flow');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    useSettingsStore.setState({ keyboardShortcuts: {} });
    useEditorStore.getState().setWorkspaceView('flow');
  });

  it('dispatches a saved workspace override through the global keydown handler', async () => {
    await act(async () => {
      useSettingsStore.getState().setKeyboardShortcut('view:image', 'Ctrl+Alt+I');
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem('flow-settings-storage')).toContain('Ctrl+Alt+I');
    });

    // Exercise the actual persisted-settings merge before App consumes the override. This keeps
    // the proof tied to the save/reopen boundary instead of only the in-memory setter state.
    // Mutate only the in-memory field so this reset cannot enqueue a second persisted write that
    // would replace the saved override before rehydrate reads it.
    useSettingsStore.getState().keyboardShortcuts = {};
    await act(async () => {
      await useSettingsStore.persist.rehydrate();
    });
    expect(useSettingsStore.getState().keyboardShortcuts).toMatchObject({
      'view:image': 'Ctrl+Alt+I',
    });

    await act(async () => root?.render(<App />));
    expect(container?.querySelector('[data-testid="flow-workspace"]')).not.toBeNull();

    const event = new KeyboardEvent('keydown', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'i',
    });
    await act(async () => window.dispatchEvent(event));
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(useEditorStore.getState().workspaceView).toBe('image');
    expect(container?.querySelector('[data-testid="image-workspace"]')).not.toBeNull();
  });

  it('does not consume that override while focus is in a text input', async () => {
    await act(async () => {
      useSettingsStore.getState().setKeyboardShortcut('view:image', 'Ctrl+Alt+I');
      root?.render(<App />);
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'i',
    });
    await act(async () => input.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(useEditorStore.getState().workspaceView).toBe('flow');
    expect(container?.querySelector('[data-testid="flow-workspace"]')).not.toBeNull();
    input.remove();
  });
});
