import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_WORKSPACE_STANDALONE_ENTRY_POINTS,
  beginProjectAuthorityTransition,
  buildNativeStandaloneEntryReadiness,
  captureProjectAuthorityMutationScope,
  captureProjectAuthorityStateScope,
  dispatchNativeRendererCommand,
  getSignalLoomNativeBridge,
  isNativeMenuCommand,
  isCurrentProjectAuthorityMutationScope,
  isCurrentProjectAuthorityStateScope,
  NATIVE_RENDERER_COMMAND_EVENT,
  onNativeRendererCommand,
  setCurrentProjectAuthorityClaim,
} from './nativeApp';

describe('native app bridge helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCurrentProjectAuthorityClaim(undefined);
  });

  it('returns undefined in the browser when Electron preload is absent', () => {
    vi.stubGlobal('window', {});

    expect(getSignalLoomNativeBridge()).toBeUndefined();
  });

  it('returns the preload bridge when Electron exposes it', () => {
    const bridge = {
      getNativeState: vi.fn(),
      onMenuCommand: vi.fn(),
    };
    vi.stubGlobal('window', { signalLoomNative: bridge });

    expect(getSignalLoomNativeBridge()).toBe(bridge);
  });

  it('epoch-guards async project mutations and withholds claims during a renderer switch barrier', () => {
    setCurrentProjectAuthorityClaim({ authorityId: 'project-a', version: 4 });
    const projectAJob = captureProjectAuthorityMutationScope();
    expect(projectAJob?.claim).toEqual({ authorityId: 'project-a', version: 4 });
    expect(isCurrentProjectAuthorityMutationScope(projectAJob)).toBe(true);

    const endTransition = beginProjectAuthorityTransition();
    expect(captureProjectAuthorityMutationScope()).toBeUndefined();
    expect(isCurrentProjectAuthorityMutationScope(projectAJob)).toBe(false);
    setCurrentProjectAuthorityClaim({ authorityId: 'project-b', version: 1 });
    endTransition();

    const projectBJob = captureProjectAuthorityMutationScope();
    expect(projectBJob?.claim).toEqual({ authorityId: 'project-b', version: 1 });
    expect(isCurrentProjectAuthorityMutationScope(projectAJob)).toBe(false);
    expect(isCurrentProjectAuthorityMutationScope(projectBJob)).toBe(true);
  });

  it('invalidates a delayed startup scope when a newer project is adopted from the no-claim state', () => {
    setCurrentProjectAuthorityClaim(undefined);
    const delayedStartup = captureProjectAuthorityStateScope();
    expect(isCurrentProjectAuthorityStateScope(delayedStartup)).toBe(true);

    setCurrentProjectAuthorityClaim({ authorityId: 'newer-open', version: 1 });

    expect(isCurrentProjectAuthorityStateScope(delayedStartup)).toBe(false);
  });

  it('dispatches renderer commands through a typed custom event', () => {
    const received: string[] = [];
    const eventTarget = new EventTarget();
    vi.stubGlobal('window', {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    });
    const remove = onNativeRendererCommand((command) => received.push(command));

    dispatchNativeRendererCommand('timeline:cut');
    window.dispatchEvent(new CustomEvent(NATIVE_RENDERER_COMMAND_EVENT, {
      detail: {
        command: 'invalid-command',
      },
    }));
    remove();
    dispatchNativeRendererCommand('timeline:select');

    expect(received).toEqual(['timeline:cut']);
  });

  it('accepts workspace layout default menu commands from native menus', () => {
    expect(isNativeMenuCommand('view:layout-reset')).toBe(true);
    expect(isNativeMenuCommand('view:command-palette')).toBe(true);
    expect(isNativeMenuCommand('view:activity-trail')).toBe(true);
    expect(isNativeMenuCommand('view:layout-balanced')).toBe(true);
    expect(isNativeMenuCommand('view:layout-focus')).toBe(true);
    expect(isNativeMenuCommand('view:layout-all-panels')).toBe(true);
  });

  it('types workspace window bridge methods exposed by Electron preload', () => {
    const bridge = {
      getNativeState: vi.fn(),
      openWorkspaceWindow: vi.fn(),
      generateVertexText: vi.fn(),
      normalizeImportedMediaBatch: vi.fn(),
      materializeSourceAsset: vi.fn(),
      getSourceLibrarySnapshot: vi.fn(),
      applySourceLibraryChange: vi.fn(),
      onSourceLibraryChanged: vi.fn(),
      onMenuCommand: vi.fn(),
    };
    vi.stubGlobal('window', { signalLoomNative: bridge });

    expect(getSignalLoomNativeBridge()?.openWorkspaceWindow).toBe(bridge.openWorkspaceWindow);
    expect(getSignalLoomNativeBridge()?.generateVertexText).toBe(bridge.generateVertexText);
    expect(getSignalLoomNativeBridge()?.normalizeImportedMediaBatch).toBe(bridge.normalizeImportedMediaBatch);
    expect(getSignalLoomNativeBridge()?.materializeSourceAsset).toBe(bridge.materializeSourceAsset);
    expect(getSignalLoomNativeBridge()?.getSourceLibrarySnapshot).toBe(bridge.getSourceLibrarySnapshot);
    expect(getSignalLoomNativeBridge()?.applySourceLibraryChange).toBe(bridge.applySourceLibraryChange);
    expect(getSignalLoomNativeBridge()?.onSourceLibraryChanged).toBe(bridge.onSourceLibraryChanged);
  });

  it('describes native shared-binary standalone entry points for workspace launch readiness', () => {
    expect(NATIVE_WORKSPACE_STANDALONE_ENTRY_POINTS.map((entry) => ({
      workspace: entry.workspace,
      command: entry.command,
      entryPoint: entry.entryPoint,
      mode: entry.mode,
    }))).toEqual([
      {
        workspace: 'flow',
        command: 'view:flow',
        entryPoint: 'signal-loom://workspace/flow',
        mode: 'shared-binary-window',
      },
      {
        workspace: 'editor',
        command: 'view:editor',
        entryPoint: 'signal-loom://workspace/editor',
        mode: 'shared-binary-window',
      },
      {
        workspace: 'image',
        command: 'view:image',
        entryPoint: 'signal-loom://workspace/image',
        mode: 'shared-binary-window',
      },
      {
        workspace: 'paper',
        command: 'view:paper',
        entryPoint: 'signal-loom://workspace/paper',
        mode: 'shared-binary-window',
      },
    ]);

    expect(buildNativeStandaloneEntryReadiness('paper')).toEqual({
      workspace: 'paper',
      command: 'view:paper',
      entryPoint: 'signal-loom://workspace/paper',
      mode: 'shared-binary-window',
      status: 'ready',
      unsupportedStandaloneExecutable: true,
      suiteHandoffMode: 'shared-binary-deep-link',
      packageTargets: ['macos', 'windows', 'linux'],
      packageCaveats: [
        'Standalone Image handoff stays inside the shared Sloom Studio desktop package; separate signed single-workspace executables are not produced.',
      ],
      caveat: 'Standalone workspace entry uses the shared Sloom Studio desktop binary and focused workspace windows; separate signed executables are not packaged.',
      signature: 'native-standalone-entry:v2|paper|view:paper|signal-loom://workspace/paper|shared-binary-window|suite-handoff=shared-binary-deep-link|targets=macos,windows,linux|separate-exe=false',
    });
  });

  it('accepts common edit clipboard commands from native menus', () => {
    expect(isNativeMenuCommand('edit:cut')).toBe(true);
    expect(isNativeMenuCommand('edit:copy')).toBe(true);
    expect(isNativeMenuCommand('edit:paste')).toBe(true);
  });

  it('accepts expanded Image and Paper tool commands from native menus', () => {
    expect(isNativeMenuCommand('image:tool-hand')).toBe(true);
    expect(isNativeMenuCommand('image:tool-sharpen-brush')).toBe(true);
    expect(isNativeMenuCommand('image:tool-background-eraser')).toBe(true);
    expect(isNativeMenuCommand('image:tool-magic-eraser')).toBe(true);
    expect(isNativeMenuCommand('image:tool-eyedropper')).toBe(true);
    expect(isNativeMenuCommand('paper:tool-select')).toBe(true);
    expect(isNativeMenuCommand('paper:tool-text')).toBe(true);
    expect(isNativeMenuCommand('paper:export-epub')).toBe(true);
    expect(isNativeMenuCommand('paper:export-kdp-assets')).toBe(true);
  });

  it('accepts Paper dockable panel menu commands from native menus', () => {
    expect(isNativeMenuCommand('paper:toggle-snap-to-guides')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-snap-to-grid')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-tools-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-document-strip-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-inspector-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-preflight-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-linked-assets-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:toggle-dtp-parity-panel')).toBe(true);
    expect(isNativeMenuCommand('paper:reset-panels')).toBe(true);
  });
});
