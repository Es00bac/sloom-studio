// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from './store/imageEditorStore';
import { useSourceBinStore } from './store/sourceBinStore';
import { useConfirmationStore } from './store/confirmationStore';
import { createAbortError } from './lib/abortSignals';
import type { NativeMenuCommand, SignalLoomNativeBridge } from './lib/nativeApp';

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

const mocks = vi.hoisted(() => ({
  showAlertDialog: vi.fn(),
  buildNativeSaveProjectDocument: vi.fn(),
  exportProjectAssets: vi.fn(),
  pickDirectory: vi.fn(),
  isFileSystemAccessSupported: vi.fn(),
  acknowledgePaperProjectSnapshot: vi.fn(),
  downloadJsonFile: vi.fn(),
}));

const topNavbarCapture = vi.hoisted(() => ({
  onMenuCommand: undefined as undefined | ((command: NativeMenuCommand, source?: string) => void),
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
  FlowWorkspaceShell: () => null,
}));

vi.mock('./components/Common/SharedContextMenu', () => ({
  SharedContextMenu: () => null,
}));

vi.mock('./components/Layout/TopNavbar', () => ({
  TopNavbar: ({ onMenuCommand }: { onMenuCommand: (command: NativeMenuCommand, source?: string) => void }) => {
    topNavbarCapture.onMenuCommand = onMenuCommand;
    return null;
  },
}));

vi.mock('./components/Settings/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('./components/Layout/CommunityStartupNotice', () => ({ CommunityStartupNotice: () => null }));
vi.mock('./components/Layout/FirstRunLanguageGate', () => ({ FirstRunLanguageGate: () => null }));
vi.mock('./components/Layout/EditBatonReadOnlyOverlay', () => ({ EditBatonReadOnlyOverlay: () => null }));
vi.mock('./components/Layout/SharedWorkspaceDockablePanels', () => ({ SharedWorkspaceDockablePanels: () => null }));
vi.mock('./components/Common/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));
vi.mock('./components/Common/TextInputDialog', () => ({ TextInputDialog: () => null }));
vi.mock('./components/Common/AlertDialog', () => ({ AlertDialog: () => null }));
vi.mock('./components/Common/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./components/Common/ActivityTrailPanel', () => ({ ActivityTrailPanel: () => null }));
vi.mock('./components/Common/GamepadInputManager', () => ({ GamepadInputManager: () => null }));
vi.mock('./components/Recovery/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children?: ReactNode }) => children }));

vi.mock('./store/alertDialogStore', () => ({
  showAlertDialog: mocks.showAlertDialog,
}));

vi.mock('./lib/nativeProjectDocument', () => ({
  buildNativeSaveProjectDocument: mocks.buildNativeSaveProjectDocument,
}));

vi.mock('./lib/projectAssets', () => ({
  exportProjectAssets: mocks.exportProjectAssets,
}));

vi.mock('./lib/fileSystemWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/fileSystemWorkspace')>();
  return {
    ...actual,
    pickDirectory: mocks.pickDirectory,
    isFileSystemAccessSupported: mocks.isFileSystemAccessSupported,
  };
});

vi.mock('./lib/paperLossPrevention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/paperLossPrevention')>();
  return {
    ...actual,
    acknowledgePaperProjectSnapshot: mocks.acknowledgePaperProjectSnapshot,
  };
});

vi.mock('./lib/projectLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/projectLibrary')>();
  return {
    ...actual,
    downloadJsonFile: mocks.downloadJsonFile,
  };
});

import App from './App';

function createStubBridge(overrides: Partial<SignalLoomNativeBridge> = {}): SignalLoomNativeBridge {
  return {
    getNativeState: vi.fn(async () => ({ platform: 'test', isDev: false })),
    onMenuCommand: vi.fn(() => () => {}),
    onProjectPathChanged: vi.fn(() => () => {}),
    setActiveWorkspace: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as SignalLoomNativeBridge;
}

async function flushAsync(rounds = 15): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
  }
}

describe('AUD-016 file-operation error boundary', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let unhandledRejections: unknown[] = [];
  let onUnhandledRejection: (reason: unknown) => void;
  const originalRequestConfirmation = useConfirmationStore.getState().requestConfirmation;

  beforeEach(() => {
    unhandledRejections = [];
    onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    mocks.showAlertDialog.mockReset().mockResolvedValue(undefined);
    mocks.buildNativeSaveProjectDocument.mockReset().mockResolvedValue({
      schemaVersion: 1,
      id: 'project-1',
      name: 'Test Project',
      savedAt: 0,
    });
    mocks.exportProjectAssets.mockReset().mockResolvedValue([]);
    mocks.pickDirectory.mockReset();
    mocks.isFileSystemAccessSupported.mockReset().mockReturnValue(true);
    mocks.acknowledgePaperProjectSnapshot.mockReset().mockReturnValue(true);
    mocks.downloadJsonFile.mockReset();

    delete (window as unknown as { signalLoomNative?: unknown }).signalLoomNative;

    useSourceBinStore.setState({
      importNativeFiles: vi.fn(async () => {}),
      migrateAssetsToScratch: vi.fn(async () => 0),
    });
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    topNavbarCapture.onMenuCommand = undefined;
    delete (window as unknown as { signalLoomNative?: unknown }).signalLoomNative;
    useConfirmationStore.setState({ requestConfirmation: originalRequestConfirmation });
    vi.restoreAllMocks();

    process.off('unhandledRejection', onUnhandledRejection);
    expect(unhandledRejections).toEqual([]);
  });

  async function renderApp(): Promise<void> {
    await act(async () => {
      root?.render(<App />);
    });
    await flushAsync(3);
  }

  /** Mirrors the production fire-and-forget dispatch: TopNavbar's onMenuCommand is `void`-wrapped. */
  async function dispatch(command: NativeMenuCommand): Promise<void> {
    act(() => {
      topNavbarCapture.onMenuCommand?.(command, 'menu');
    });
    await flushAsync();
  }

  function seedDirtyImageDocument(): void {
    const doc = {
      ...createEmptyImageDocument({ id: 'dirty-doc', title: 'Layered artwork', width: 8, height: 8 }),
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [doc], activeDocId: doc.id });
  }

  describe('Save Project / Save As', () => {
    it('shows Save Project Failed when native document build throws, and marks nothing clean', async () => {
      window.signalLoomNative = createStubBridge({
        saveProjectFile: vi.fn(async () => ({ canceled: false })),
      });
      mocks.buildNativeSaveProjectDocument.mockRejectedValue(new Error('Could not collect flow snapshot.'));
      seedDirtyImageDocument();
      const markCleanSpy = vi.spyOn(useImageEditorStore.getState(), 'markDocumentClean');

      await renderApp();
      await dispatch('file:save');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Save Project Failed',
        message: 'Could not collect flow snapshot.',
        tone: 'danger',
      });
      expect(markCleanSpy).not.toHaveBeenCalled();
      expect(mocks.acknowledgePaperProjectSnapshot).not.toHaveBeenCalled();
    });

    it('shows Save Project Failed when the native bridge rejects the write, and marks nothing clean', async () => {
      const saveProjectFile = vi.fn(async () => {
        throw new Error('ENOSPC: no space left on device');
      });
      window.signalLoomNative = createStubBridge({ saveProjectFile });
      seedDirtyImageDocument();
      const markCleanSpy = vi.spyOn(useImageEditorStore.getState(), 'markDocumentClean');

      await renderApp();
      await dispatch('file:save');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Save Project Failed',
        message: 'ENOSPC: no space left on device',
        tone: 'danger',
      });
      expect(markCleanSpy).not.toHaveBeenCalled();
      expect(mocks.acknowledgePaperProjectSnapshot).not.toHaveBeenCalled();
    });

    it('stays silent when the native save is cancelled by the user', async () => {
      const saveProjectFile = vi.fn(async () => ({ canceled: true }));
      window.signalLoomNative = createStubBridge({ saveProjectFile });

      await renderApp();
      await dispatch('file:save');

      expect(mocks.showAlertDialog).not.toHaveBeenCalled();
      expect(mocks.acknowledgePaperProjectSnapshot).not.toHaveBeenCalled();
    });

    it('routes a structured stale-project-authority rejection to the existing reload path, not the new failure dialog', async () => {
      const requestConfirmationSpy = vi.fn(async () => false);
      useConfirmationStore.setState({ requestConfirmation: requestConfirmationSpy });
      const saveProjectFile = vi.fn(async () => ({
        canceled: false,
        rejected: {
          code: 'stale' as const,
          message: 'Another window already saved a newer version of this project.',
          current: { authorityId: 'authority-1', version: 2 },
        },
      }));
      window.signalLoomNative = createStubBridge({ saveProjectFile });

      await renderApp();
      await dispatch('file:save');

      expect(requestConfirmationSpy).toHaveBeenCalledWith(expect.any(String), 'Project Out of Date');
      expect(mocks.showAlertDialog).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Save Project Failed' }),
      );
      expect(mocks.acknowledgePaperProjectSnapshot).not.toHaveBeenCalled();
    });

    it('shows Save Project Failed for Save As when native document build throws', async () => {
      window.signalLoomNative = createStubBridge({
        saveProjectFileAs: vi.fn(async () => ({ canceled: false })),
      });
      mocks.buildNativeSaveProjectDocument.mockRejectedValue(new Error('Paper asset packaging failed.'));

      await renderApp();
      await dispatch('file:save-as');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Save Project Failed',
        message: 'Paper asset packaging failed.',
        tone: 'danger',
      });
    });

    it('shows Save Project Failed when a browser download fails', async () => {
      mocks.downloadJsonFile.mockImplementation(() => {
        throw new Error('Popup blocked the download.');
      });

      await renderApp();
      await dispatch('file:save');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Save Project Failed',
        message: 'Popup blocked the download.',
        tone: 'danger',
      });
    });
  });

  describe('Import Media', () => {
    it('shows Import Media Failed when the native bridge throws', async () => {
      const importMediaFiles = vi.fn(async () => {
        throw new Error('The picker helper crashed.');
      });
      window.signalLoomNative = createStubBridge({ importMediaFiles });

      await renderApp();
      await dispatch('file:import-media');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Import Media Failed',
        message: 'The picker helper crashed.',
        tone: 'danger',
      });
    });

    it('shows Import Media Failed for a typed result.error without a throw', async () => {
      const importMediaFiles = vi.fn(async () => ({
        canceled: false,
        items: [],
        error: 'Materialization ran out of disk space.',
      }));
      window.signalLoomNative = createStubBridge({ importMediaFiles });

      await renderApp();
      await dispatch('file:import-media');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Import Media Failed',
        message: 'Materialization ran out of disk space.',
        tone: 'danger',
      });
    });

    it('shows Import Media Failed when the post-picker ingest rejects', async () => {
      const importMediaFiles = vi.fn(async () => ({
        canceled: false,
        items: [{ id: 'item-1', kind: 'image', label: 'photo.png', createdAt: 0 }],
      })) as unknown as SignalLoomNativeBridge['importMediaFiles'];
      window.signalLoomNative = createStubBridge({ importMediaFiles });
      useSourceBinStore.setState({
        importNativeFiles: vi.fn(async () => {
          throw new Error('The source bin could not ingest the batch.');
        }),
      });

      await renderApp();
      await dispatch('file:import-media');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Import Media Failed',
        message: 'The source bin could not ingest the batch.',
        tone: 'danger',
      });
    });

    it('stays silent when native media import is cancelled', async () => {
      const importMediaFiles = vi.fn(async () => ({ canceled: true, items: [] }));
      window.signalLoomNative = createStubBridge({ importMediaFiles });

      await renderApp();
      await dispatch('file:import-media');

      expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    });
  });

  describe('Set Scratch Folder', () => {
    it('shows Set Scratch Folder Failed when the native bridge throws', async () => {
      const chooseScratchDirectory = vi.fn(async () => {
        throw new Error('The main process could not open a chooser.');
      });
      window.signalLoomNative = createStubBridge({ chooseScratchDirectory });

      await renderApp();
      await dispatch('file:set-scratch-folder');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Set Scratch Folder Failed',
        message: 'The main process could not open a chooser.',
        tone: 'danger',
      });
    });

    it('shows Set Scratch Folder Failed for a typed result.error without a throw', async () => {
      const chooseScratchDirectory = vi.fn(async () => ({
        canceled: false,
        error: 'The chosen folder is not writable.',
      }));
      window.signalLoomNative = createStubBridge({ chooseScratchDirectory });

      await renderApp();
      await dispatch('file:set-scratch-folder');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Set Scratch Folder Failed',
        message: 'The chosen folder is not writable.',
        tone: 'danger',
      });
    });

    it('shows Set Scratch Folder Failed when the browser picker throws a non-cancellation error', async () => {
      mocks.pickDirectory.mockRejectedValue(new Error('Directory handle could not be created.'));

      await renderApp();
      await dispatch('file:set-scratch-folder');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Set Scratch Folder Failed',
        message: 'Directory handle could not be created.',
        tone: 'danger',
      });
    });

    it('stays silent when the browser directory picker is cancelled by the user', async () => {
      mocks.pickDirectory.mockRejectedValue(createAbortError('The user dismissed the picker.'));

      await renderApp();
      await dispatch('file:set-scratch-folder');

      expect(mocks.showAlertDialog).not.toHaveBeenCalled();
    });

    it('shows Set Scratch Folder Failed when migration to the chosen folder fails', async () => {
      mocks.pickDirectory.mockResolvedValue({} as FileSystemDirectoryHandle);
      useSourceBinStore.setState({
        migrateAssetsToScratch: vi.fn(async () => {
          throw new Error('Copying assets to scratch failed.');
        }),
      });

      await renderApp();
      await dispatch('file:set-scratch-folder');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Set Scratch Folder Failed',
        message: 'Copying assets to scratch failed.',
        tone: 'danger',
      });
    });
  });

  describe('Export Assets', () => {
    it('shows Export Assets Failed when export/download fails, with no false success', async () => {
      mocks.exportProjectAssets.mockRejectedValue(new Error('One asset could not be downloaded.'));

      await renderApp();
      await dispatch('file:export-assets');

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Export Assets Failed',
        message: 'One asset could not be downloaded.',
        tone: 'danger',
      });
    });
  });

  describe('Fire-and-forget dispatch settlement', () => {
    it('never lets a failing native Save escape as an unhandled rejection from the void-wrapped menu dispatch', async () => {
      const saveProjectFile = vi.fn(async () => {
        throw new Error('Disk write failed mid-save.');
      });
      window.signalLoomNative = createStubBridge({ saveProjectFile });

      await renderApp();

      // This call mirrors production exactly: TopNavbar invokes `(command, source) =>
      // void handleAppMenuCommand(command, source)`, so nothing here awaits the inner promise.
      act(() => {
        topNavbarCapture.onMenuCommand?.('file:save', 'menu');
      });
      await flushAsync();

      expect(mocks.showAlertDialog).toHaveBeenCalledWith({
        title: 'Save Project Failed',
        message: 'Disk write failed mid-save.',
        tone: 'danger',
      });
      // The outer afterEach also asserts unhandledRejections is empty; asserted again here for
      // locality with the exact scenario this test is proving.
      expect(unhandledRejections).toEqual([]);
    });
  });
});
