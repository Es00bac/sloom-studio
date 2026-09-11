import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

import { createDefaultPaperDocument } from './paperDocument';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import { applyNativeStartupProjectReplacement } from './nativeStartupProjectReplacement';
import { replaceProjectDocument } from './projectDocumentActions';
import { resetPaperLossPreventionForTests, usePaperLossPreventionStore } from '../store/paperLossPreventionStore';
import { useFlowStore } from '../store/flowStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { usePaperStore } from '../store/paperStore';
import type { ImageDocument } from '../types/imageEditor';
import type { FlowProjectDocument } from './projectLibrary';

function rememberedProject(nodeId = 'remembered-node'): FlowProjectDocument {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: 'remembered-project',
    name: 'Remembered Project',
    savedAt: 1,
    flow: {
      version: 3,
      nodes: [{ id: nodeId, type: 'textNode', position: { x: 10, y: 20 }, data: {} }],
      edges: [],
    },
  };
}

function imageDocument(id: string, dirty = true): ImageDocument {
  return {
    id,
    title: `Image ${id}`,
    width: 10,
    height: 10,
    layers: [],
    activeLayerId: null,
    activeLayerEditTarget: 'layer',
    selectedLayerIds: [],
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty,
  };
}

function makePaperDirty(title = 'Delayed live Paper'): void {
  const document = createDefaultPaperDocument({ title });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.getState().addPage();
  expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
}

function startDelayedRememberedProject(options: {
  save?: () => Promise<{ status: 'success' } | { status: 'failed'; error: string }>;
  authorizeDirtyImageReplacement?: (projection: { dirtyDocumentCount: number }) => Promise<boolean>;
} = {}) {
  let requestCurrent = true;
  let resolveNativeState!: (document: FlowProjectDocument) => void;
  const delayedNativeState = new Promise<FlowProjectDocument>((resolve) => {
    resolveNativeState = resolve;
  });
  const result = delayedNativeState.then((rememberedDocument) => applyNativeStartupProjectReplacement({
    rememberedDocument,
    startBlank: false,
    save: options.save ?? (async () => ({ status: 'failed', error: 'save not selected' })),
    authorizeDirtyImageReplacement: options.authorizeDirtyImageReplacement ?? (async () => false),
    isStartupRequestCurrent: () => requestCurrent,
  }));
  return {
    invalidateStartupRequest: () => { requestCurrent = false; },
    resolveNativeState,
    result,
  };
}

function startDelayedBlankProject(options: {
  authorizeDirtyImageReplacement?: (projection: { dirtyDocumentCount: number }) => Promise<boolean>;
} = {}) {
  let requestCurrent = true;
  let resolveNativeState!: () => void;
  const delayedNativeState = new Promise<void>((resolve) => {
    resolveNativeState = resolve;
  });
  const result = delayedNativeState.then(() => applyNativeStartupProjectReplacement({
    startBlank: true,
    save: async () => ({ status: 'failed', error: 'save not selected' }),
    authorizeDirtyImageReplacement: options.authorizeDirtyImageReplacement ?? (async () => false),
    isStartupRequestCurrent: () => requestCurrent,
  }));
  return {
    invalidateStartupRequest: () => { requestCurrent = false; },
    resolveNativeState,
    result,
  };
}

async function waitForPaperDecision(): Promise<void> {
  await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
}

beforeEach(() => {
  resetPaperLossPreventionForTests();
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
  useFlowWorkspaceStore.getState().reset();
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  const document = createDefaultPaperDocument({ title: 'Clean startup baseline' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
});

afterEach(() => {
  resetPaperLossPreventionForTests();
  vi.unstubAllGlobals();
});

describe('delayed native startup project replacement', () => {
  it('opens a clean remembered project normally', async () => {
    const startup = startDelayedRememberedProject();
    startup.resolveNativeState(rememberedProject());

    await expect(startup.result).resolves.toBe('remembered-project');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['remembered-node']);
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('does not let delayed remembered startup overwrite a newer completed project open', async () => {
    const startup = startDelayedRememberedProject();
    await expect(replaceProjectDocument(rememberedProject('newer-open-node'), {
      save: async () => ({ status: 'failed', error: 'save not selected' }),
      authorizeDirtyImageReplacement: async () => false,
    })).resolves.toBe(true);
    startup.invalidateStartupRequest();

    startup.resolveNativeState(rememberedProject('stale-startup-node'));

    await expect(startup.result).resolves.toBe('stale-startup');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['newer-open-node']);
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('does not let delayed blank startup overwrite a newer completed project open', async () => {
    const startup = startDelayedBlankProject();
    await expect(replaceProjectDocument(rememberedProject('newer-blank-race-node'), {
      save: async () => ({ status: 'failed', error: 'save not selected' }),
      authorizeDirtyImageReplacement: async () => false,
    })).resolves.toBe(true);
    startup.invalidateStartupRequest();

    startup.resolveNativeState();

    await expect(startup.result).resolves.toBe('stale-startup');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['newer-blank-race-node']);
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('settles blank startup without prompting and leaves its canonical Paper baseline clean', async () => {
    const startup = startDelayedBlankProject();
    startup.resolveNativeState();

    await expect(startup.result).resolves.toBe('blank-project');
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
  });

  it('recovers genuinely dirty hydrated Paper work without prompting during blank startup', async () => {
    makePaperDirty('Hydrated dirty Paper');
    const startup = startDelayedBlankProject();
    startup.resolveNativeState();

    await expect(startup.result).resolves.toBe('blank-project');
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toEqual([
      expect.objectContaining({
        reason: 'startup-recovery',
        snapshot: expect.objectContaining({
          document: expect.objectContaining({ title: 'Hydrated dirty Paper' }),
        }),
      }),
    ]);
  });

  it('recovers dirty hydrated Image work without asking for discard during blank startup', async () => {
    const authorize = vi.fn(async () => false);
    const liveImage = imageDocument('hydrated-startup-image');
    useImageEditorStore.setState({ documents: [liveImage], activeDocId: liveImage.id });
    const startup = startDelayedBlankProject({ authorizeDirtyImageReplacement: authorize });
    startup.resolveNativeState();

    await expect(startup.result).resolves.toBe('blank-project');
    expect(authorize).not.toHaveBeenCalled();
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
    expect(useImageEditorStore.getState().documents).toEqual([]);
    expect(useImageEditorStore.getState().discardedDocumentRecoveries).toEqual([
      expect.objectContaining({
        reason: 'startup-recovery',
        snapshot: expect.objectContaining({ title: 'Image hydrated-startup-image' }),
      }),
    ]);
  });

  it('never invokes an Image dirty accessor that could update Flow during remembered startup', async () => {
    const startup = startDelayedRememberedProject();
    const liveImage = imageDocument('accessor-image');
    let accessorCalls = 0;
    Object.defineProperty(liveImage, 'dirty', {
      configurable: true,
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        useFlowStore.getState().replaceFlowSnapshot({
          nodes: [{ id: 'accessor-flow-edit', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        });
        return true;
      },
    });
    useImageEditorStore.setState({ documents: [liveImage], activeDocId: liveImage.id });
    startup.resolveNativeState(rememberedProject());

    await expect(startup.result).resolves.toBe('preserved-live-work');
    expect(accessorCalls).toBe(0);
    expect(useImageEditorStore.getState().documents).toEqual([liveImage]);
    expect(useFlowStore.getState().nodes).toEqual([]);
  });

  it('fails closed when an Image metadata Proxy trap updates Flow during remembered startup', async () => {
    const startup = startDelayedRememberedProject();
    const liveImage = imageDocument('proxy-image');
    let trapCalls = 0;
    const proxiedImage = new Proxy(liveImage, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'dirty') {
          trapCalls += 1;
          useFlowStore.getState().replaceFlowSnapshot({
            nodes: [{ id: 'newer-flow-edit', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
            edges: [],
          });
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    useImageEditorStore.setState({ documents: [proxiedImage], activeDocId: liveImage.id });
    startup.resolveNativeState(rememberedProject());

    await expect(startup.result).resolves.toBe('preserved-live-work');
    expect(trapCalls).toBeGreaterThan(0);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['newer-flow-edit']);
    expect(useImageEditorStore.getState().documents).toEqual([proxiedImage]);
  });

  it.each([
    ['missing', undefined],
    ['cleared', null],
    ['unavailable', new Error('storage unavailable')],
  ] as const)('uses live dirty Paper when its persisted marker is %s', async (_label, markerResult) => {
    const getItem = vi.fn((): string | null => {
      if (markerResult instanceof Error) throw markerResult;
      return markerResult ?? null;
    });
    vi.stubGlobal('localStorage', {
      length: 0,
      clear: vi.fn(),
      getItem,
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    } satisfies Storage);
    const startup = startDelayedRememberedProject();
    makePaperDirty();
    startup.resolveNativeState(rememberedProject());
    await waitForPaperDecision();

    expect(getItem).not.toHaveBeenCalled();
    usePaperLossPreventionStore.getState().discard();
    await expect(startup.result).resolves.toBe('remembered-project');
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['remembered-node']);
  });

  it('keeps dirty Image with clean Paper open when startup replacement is canceled', async () => {
    const authorize = vi.fn(async () => false);
    const startup = startDelayedRememberedProject({ authorizeDirtyImageReplacement: authorize });
    const liveImage = imageDocument('dirty-image');
    useImageEditorStore.setState({ documents: [liveImage], activeDocId: liveImage.id });
    startup.resolveNativeState(rememberedProject());

    await expect(startup.result).resolves.toBe('preserved-live-work');
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ dirtyDocumentCount: 1 }));
    expect(useImageEditorStore.getState().documents).toEqual([liveImage]);
    expect(useFlowStore.getState().nodes).toEqual([]);
  });

  it('keeps both dirty workspaces open when Paper discard is followed by Image cancel', async () => {
    const authorize = vi.fn(async () => false);
    const startup = startDelayedRememberedProject({ authorizeDirtyImageReplacement: authorize });
    makePaperDirty('Both dirty Paper');
    const liveImage = imageDocument('both-dirty-image');
    useImageEditorStore.setState({ documents: [liveImage], activeDocId: liveImage.id });
    startup.resolveNativeState(rememberedProject());
    await waitForPaperDecision();
    usePaperLossPreventionStore.getState().discard();

    await expect(startup.result).resolves.toBe('preserved-live-work');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
    expect(useImageEditorStore.getState().documents).toEqual([liveImage]);
  });

  it('shows a failed Paper save without replacing, then succeeds on retry', async () => {
    let saveAttempt = 0;
    const startup = startDelayedRememberedProject({
      save: vi.fn(async () => {
        saveAttempt += 1;
        if (saveAttempt === 1) return { status: 'failed' as const, error: 'disk full' };
        usePaperStore.getState().markAllDocumentsProjectSaved();
        return { status: 'success' as const };
      }),
    });
    makePaperDirty('Retry Paper');
    startup.resolveNativeState(rememberedProject());
    await waitForPaperDecision();

    await usePaperLossPreventionStore.getState().save();
    expect(usePaperLossPreventionStore.getState().activeRequest).toMatchObject({
      saving: false,
      error: 'disk full',
    });
    expect(useFlowStore.getState().nodes).toEqual([]);

    await usePaperLossPreventionStore.getState().save();
    await expect(startup.result).resolves.toBe('remembered-project');
    expect(saveAttempt).toBe(2);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['remembered-node']);
  });

  it('preserves live Paper on cancel and permits an explicit startup retry', async () => {
    makePaperDirty('Canceled Paper');
    const first = startDelayedRememberedProject();
    first.resolveNativeState(rememberedProject('first-remembered-node'));
    await waitForPaperDecision();
    usePaperLossPreventionStore.getState().cancel();
    await expect(first.result).resolves.toBe('preserved-live-work');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(useFlowStore.getState().nodes).toEqual([]);

    const retry = startDelayedRememberedProject();
    retry.resolveNativeState(rememberedProject('retry-remembered-node'));
    await waitForPaperDecision();
    usePaperLossPreventionStore.getState().discard();
    await expect(retry.result).resolves.toBe('remembered-project');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['retry-remembered-node']);
  });
});
