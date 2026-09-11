import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { replaceProjectDocument } from './projectDocumentActions';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import {
  resetPaperLossPreventionForTests,
  usePaperLossPreventionStore,
  type PaperLossSaveResult,
} from '../store/paperLossPreventionStore';
import { usePaperStore } from '../store/paperStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { useFlowStore } from '../store/flowStore';
import { useSourceBinStore } from '../store/sourceBinStore';

function seedDirtyPaper(title = 'Outgoing Paper') {
  const document = createDefaultPaperDocument({ title });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  usePaperStore.getState().addPage();
  return document;
}

function validIncomingProject() {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: 'ordering-incoming',
    name: 'Ordering Incoming',
    savedAt: 1,
    flow: { version: 3 as const, nodes: [], edges: [] },
    sourceBin: { dismissedSourceKeys: [] },
    paper: {
      document: createDefaultPaperDocument({ title: 'Incoming Paper' }),
      tool: 'select' as const,
      zoom: 0.8,
    },
  };
}

/** Bounded-shape-valid project whose deep validation must fail: it references a managed Paper
 *  asset but carries no portable paperAssets section. */
function boundedButInvalidIncomingProject() {
  const sha256 = 'e'.repeat(64);
  const base = createDefaultPaperDocument({ title: 'Invalid Incoming' });
  const paperDocument = addFrameToPaperPage(base, base.pages[0].id, {
    kind: 'image', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30,
    asset: {
      label: 'Managed art',
      kind: 'image',
      locator: { kind: 'managed', ref: { id: `sha256:${sha256}`, sha256, mimeType: 'image/png', byteLength: 4 } },
    },
  }).document;
  return {
    ...validIncomingProject(),
    id: 'ordering-invalid',
    name: 'Ordering Invalid',
    paper: { document: paperDocument, tool: 'select' as const, zoom: 0.8 },
  };
}

function failedSave(): Promise<PaperLossSaveResult> {
  return Promise.resolve({ status: 'failed', error: 'not selected' });
}

async function waitForPaperReplacementRequest() {
  await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
}

async function flushReplacementQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetPaperLossPreventionForTests();
  useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
  useFlowStore.getState().replaceFlowSnapshot({
    nodes: [{ id: 'ordering-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
    edges: [],
  });
});

afterEach(() => {
  resetPaperLossPreventionForTests();
  usePaperStore.getState().restoreSnapshot(undefined);
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
  useSourceBinStore.setState({ dismissedSourceKeys: [] });
});

describe('replaceProjectDocument authorization-before-validation ordering', () => {
  it('shows the replacement decision without deep-reading the incoming project and skips validation on Cancel', async () => {
    seedDirtyPaper();
    let deepReads = 0;
    const incoming = new Proxy(validIncomingProject(), {
      get(target, property, receiver) {
        deepReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const operation = replaceProjectDocument(incoming, { key: 'ordering:cancel', save: failedSave });
    await waitForPaperReplacementRequest();
    expect(deepReads).toBe(0);
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(deepReads).toBe(0);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['ordering-node']);
  });

  it('reports the validation error without replacement after a Discard decision', async () => {
    seedDirtyPaper();

    const operation = replaceProjectDocument(boundedButInvalidIncomingProject(), {
      key: 'ordering:invalid', save: failedSave,
    });
    operation.catch(() => undefined);
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).rejects.toThrow(/managed Paper assets|paperAssets/);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['ordering-node']);
  });

  it('gives a later bounded-but-invalid request its own current identity so the older dialog cannot commit', async () => {
    seedDirtyPaper();

    const first = replaceProjectDocument(validIncomingProject(), { key: 'ordering:first', save: failedSave });
    await waitForPaperReplacementRequest();
    const second = replaceProjectDocument(boundedButInvalidIncomingProject(), {
      key: 'ordering:second', save: failedSave,
    });
    second.catch(() => undefined);
    await flushReplacementQueue();

    // Answering the FIRST dialog must not commit it: the second request superseded its identity.
    usePaperLossPreventionStore.getState().discard();
    await expect(first).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');

    // The second request then fails at validation, after its own paired decision.
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();
    await expect(second).rejects.toThrow(/managed Paper assets|paperAssets/);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['ordering-node']);
  });

  it('fails closed when the incoming project mutates the workspace during deferred validation', async () => {
    seedDirtyPaper();
    const hostile = validIncomingProject() as Record<string, unknown>;
    Object.defineProperty(hostile, 'flow', {
      enumerable: true,
      configurable: true,
      get() {
        usePaperStore.getState().addPage();
        return { version: 3, nodes: [], edges: [] };
      },
    });

    const operation = replaceProjectDocument(hostile, { key: 'ordering:hostile', save: failedSave });
    operation.catch(() => undefined);
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).rejects.toThrow(/workspace changed/i);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['ordering-node']);
  });

  it('still commits a valid replacement exactly once after the paired decision', async () => {
    seedDirtyPaper();
    const originalPaperRestore = usePaperStore.getState().restoreSnapshot;
    let paperRestores = 0;
    usePaperStore.setState({
      restoreSnapshot: ((...args: Parameters<typeof originalPaperRestore>) => {
        paperRestores += 1;
        return originalPaperRestore(...args);
      }) as typeof originalPaperRestore,
    });

    try {
      const operation = replaceProjectDocument(validIncomingProject(), {
        key: 'ordering:valid', save: failedSave,
      });
      await waitForPaperReplacementRequest();
      usePaperLossPreventionStore.getState().discard();

      await expect(operation).resolves.toBe(true);
      expect(paperRestores).toBe(1);
      expect(usePaperStore.getState().document.title).toBe('Incoming Paper');
      expect(useFlowStore.getState().nodes).toEqual([]);
    } finally {
      usePaperStore.setState({ restoreSnapshot: originalPaperRestore });
    }
  });
});
