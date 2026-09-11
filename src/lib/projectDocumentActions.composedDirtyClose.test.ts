import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

import { createDefaultPaperDocument } from './paperDocument';
import {
  buildCurrentProjectDocument,
  buildDirtyImageReplacementConfirmationMessage,
  captureProjectReplacementAuthorization,
  isCurrentImageWorkspaceAtProjectSnapshot,
  isImageReplacementAuthorizationCurrent,
  replaceProjectDocument,
  replaceWithBlankProject,
  resetProjectDocument,
  restoreProjectDocument,
  type DirtyImageReplacementProjection,
} from './projectDocumentActions';
import { acknowledgePaperProjectSnapshot } from './paperLossPrevention';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import {
  resetPaperLossPreventionForTests,
  usePaperLossPreventionStore,
  type PaperLossSaveResult,
} from '../store/paperLossPreventionStore';
import { fingerprintPaperAuthoredContent, usePaperStore } from '../store/paperStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { useFlowStore } from '../store/flowStore';
import type { EditorOperation, ImageDocument } from '../types/imageEditor';
import { useSourceBinStore } from '../store/sourceBinStore';
import { useEditorStore } from '../store/editorStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import { useProjectUsageStore } from '../store/projectUsageStore';
import {
  getSourceLibraryRendererNativeVersion,
  setSourceLibraryRendererNativeVersion,
} from './sourceLibraryNativeSync';
import { getSelection, setSelection } from '../components/ImageEditor/selectionRegistry';

const originalImageRestore = useImageEditorStore.getState().restoreProjectSnapshot;
const originalImageRestoreWithPixels = useImageEditorStore.getState().restoreProjectSnapshotWithPixels;
const originalImageExportWithPixels = useImageEditorStore.getState().exportProjectSnapshotWithPixels;
const originalImagePrepareWithPixels = useImageEditorStore.getState().prepareProjectSnapshotWithPixels;
const originalImageCommitPreparedWithPixels = useImageEditorStore.getState().commitPreparedProjectSnapshotWithPixels;
const originalSourceBinExport = useSourceBinStore.getState().exportProjectSnapshot;
const originalSourceBinRestore = useSourceBinStore.getState().restoreProjectSnapshot;
const originalSourceBinPrepare = useSourceBinStore.getState().prepareProjectSnapshot;
const originalSourceBinCommit = useSourceBinStore.getState().commitPreparedProjectSnapshot;

function imageDocument(id = 'dirty-image', dirty = true): ImageDocument {
  return {
    id,
    title: id,
    width: 10,
    height: 10,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty,
  };
}

function seedPaper(dirty: boolean, title = 'Outgoing Paper') {
  const document = createDefaultPaperDocument({ title });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  if (dirty) usePaperStore.getState().addPage();
  return document;
}

function seedImage(dirty: boolean) {
  const document = imageDocument('Outgoing Image', dirty);
  useImageEditorStore.setState({
    documents: dirty ? [document] : [],
    activeDocId: dirty ? document.id : null,
    undoStacks: {},
    redoStacks: {},
  });
  return document;
}

const incomingPaper = createDefaultPaperDocument({ title: 'Incoming Paper' });
const incomingProject = {
  schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
  id: 'incoming-project',
  name: 'Incoming Project',
  savedAt: 1,
  flow: { version: 3 as const, nodes: [], edges: [] },
  sourceBin: { dismissedSourceKeys: [] },
  paper: { document: incomingPaper, tool: 'select' as const, zoom: 0.8 },
};

type Boundary = 'project-replacement' | 'open' | 'import' | 'reset';
const boundaries: Boundary[] = ['project-replacement', 'open', 'import', 'reset'];

function runBoundary(
  boundary: Boundary,
  options: {
    save?: () => Promise<PaperLossSaveResult>;
    imageAuthorization?: ReturnType<typeof captureProjectReplacementAuthorization>['image'];
    authorizeDirtyImageReplacement?: (projection: DirtyImageReplacementProjection) => Promise<boolean>;
  } = {},
) {
  const guardedOptions = {
    key: `test:${boundary}`,
    save: options.save ?? vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
    imageAuthorization: options.imageAuthorization,
    authorizeDirtyImageReplacement: options.authorizeDirtyImageReplacement,
  };
  return boundary === 'reset'
    ? replaceWithBlankProject(guardedOptions)
    : replaceProjectDocument(incomingProject, guardedOptions);
}

async function waitForPaperReplacementRequest() {
  await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
}

beforeEach(() => {
  resetPaperLossPreventionForTests();
  seedPaper(false);
  seedImage(false);
  useFlowStore.getState().replaceFlowSnapshot({
    nodes: [{ id: 'outgoing-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
    edges: [],
  });
});

afterEach(() => {
  resetPaperLossPreventionForTests();
  useImageEditorStore.setState({ restoreProjectSnapshot: originalImageRestore });
  useImageEditorStore.setState({ restoreProjectSnapshotWithPixels: originalImageRestoreWithPixels });
  useImageEditorStore.setState({ exportProjectSnapshotWithPixels: originalImageExportWithPixels });
  useImageEditorStore.setState({ prepareProjectSnapshotWithPixels: originalImagePrepareWithPixels });
  useImageEditorStore.setState({ commitPreparedProjectSnapshotWithPixels: originalImageCommitPreparedWithPixels });
  useSourceBinStore.setState({ exportProjectSnapshot: originalSourceBinExport });
  useSourceBinStore.setState({ restoreProjectSnapshot: originalSourceBinRestore });
  useSourceBinStore.setState({ prepareProjectSnapshot: originalSourceBinPrepare });
  useSourceBinStore.setState({ commitPreparedProjectSnapshot: originalSourceBinCommit });
  setSourceLibraryRendererNativeVersion(0);
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  usePaperStore.getState().restoreSnapshot(undefined);
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
  useSourceBinStore.setState({ dismissedSourceKeys: [] });
});

describe.each(boundaries)('%s composed dirty-close boundary', (boundary) => {
  it('blocks dirty Image-only replacement when Image authorization is canceled', async () => {
    const liveImage = seedImage(true);
    const authorize = vi.fn().mockResolvedValue(false);

    await expect(runBoundary(boundary, { authorizeDirtyImageReplacement: authorize })).resolves.toBe(false);

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(useImageEditorStore.getState().documents).toEqual([liveImage]);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
  });

  it('blocks dirty Paper-only replacement when Paper is canceled', async () => {
    seedPaper(true);
    const operation = runBoundary(boundary);
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
  });

  it('still blocks dirty Paper after Image replacement was independently authorized', async () => {
    seedPaper(true);
    seedImage(true);
    const operation = runBoundary(boundary, {
      imageAuthorization: captureProjectReplacementAuthorization().image,
    });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
  });
});

describe('ordered Paper and Image decisions', () => {
  it('keeps the project after Paper Save then Image Cancel', async () => {
    seedPaper(true);
    seedImage(true);
    const authorize = vi.fn().mockResolvedValue(false);
    const save = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().markAllDocumentsProjectSaved();
      return { status: 'success' as const };
    });
    const operation = runBoundary('open', {
      save,
      authorizeDirtyImageReplacement: authorize,
    });
    await waitForPaperReplacementRequest();
    await usePaperLossPreventionStore.getState().save();

    await expect(operation).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
  });

  it('keeps the project and recovery after Paper Discard then Image Cancel', async () => {
    seedPaper(true);
    seedImage(true);
    const authorize = vi.fn().mockResolvedValue(false);
    const operation = runBoundary('import', { authorizeDirtyImageReplacement: authorize });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).resolves.toBe(false);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
  });

  it('replaces only after both dirty policies independently approve', async () => {
    seedPaper(true);
    seedImage(true);
    const authorize = vi.fn().mockResolvedValue(true);
    const operation = runBoundary('project-replacement', {
      authorizeDirtyImageReplacement: authorize,
    });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().document.title).toBe('Incoming Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
    expect(useImageEditorStore.getState().documents).toEqual([]);
  });

  it('re-runs Paper discard after a local edit lands during the Image dialog', async () => {
    seedPaper(true, 'Local race Paper');
    seedImage(true);
    const authorize = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().addPage();
      return true;
    });
    const operation = runBoundary('open', { authorizeDirtyImageReplacement: authorize });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    expect(usePaperStore.getState().document.pages).toHaveLength(3);
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledTimes(1);
    const recoveryPageCounts = usePaperStore.getState().discardedDocumentRecoveries
      .filter((entry) => entry.reason === 'project-replacement')
      .map((entry) => entry.snapshot.document.pages.length);
    expect(recoveryPageCounts).toEqual(expect.arrayContaining([2, 3]));
  });

  it('re-runs Paper loss prevention for a remote edit, then preserves everything on Cancel', async () => {
    seedPaper(true, 'Remote race Paper');
    seedImage(true);
    const authorize = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().applyRemotePaperDocumentChange({
        type: 'paper-document-snapshot',
        document: { ...usePaperStore.getState().document, title: 'Remote edit after authorization' },
      });
      return true;
    });
    const operation = runBoundary('import', { authorizeDirtyImageReplacement: authorize });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest?.documentTitles)
      .toContain('Remote edit after authorization'));
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Remote edit after authorization');
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
  });

  it('revalidates Image again when Image changes during a later Paper dialog (Image-first)', async () => {
    seedPaper(true, 'Image-first Paper');
    seedImage(true);
    const authorize = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const operation = replaceProjectDocument(incomingProject, {
      key: 'test:image-first-race',
      save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
      authorizationOrder: 'image-first',
      authorizeDirtyImageReplacement: authorize,
    });

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((document) => ({ ...document, title: 'Newer Image edit', width: 11 })),
    }));
    usePaperLossPreventionStore.getState().discard();

    await expect(operation).resolves.toBe(false);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(useImageEditorStore.getState().documents[0]?.title).toBe('Newer Image edit');
    expect(usePaperStore.getState().document.title).toBe('Image-first Paper');
  });

  it('revalidates tab creation, close, and reorder after Paper authorization', async () => {
    seedPaper(true, 'First tab');
    usePaperStore.getState().createNewDocument({ title: 'Second tab' });
    const secondId = usePaperStore.getState().activeDocumentId;
    seedImage(true);
    const authorize = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().createNewDocument({ title: 'Created during Image dialog' });
      const createdId = usePaperStore.getState().activeDocumentId;
      usePaperStore.getState().closeDocument(secondId, { discard: true, recoveryReason: 'project-replacement' });
      usePaperStore.setState((state) => ({ documents: [...state.documents].reverse() }));
      expect(usePaperStore.getState().documents.some((document) => document.id === createdId)).toBe(true);
      return true;
    });
    const operation = runBoundary('open', { authorizeDirtyImageReplacement: authorize });
    await waitForPaperReplacementRequest();
    usePaperLossPreventionStore.getState().discard();

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(usePaperStore.getState().documents.map((document) => document.document.title))
      .toContain('Created during Image dialog');
    expect(usePaperStore.getState().documents.map((document) => document.id)).not.toContain(secondId);
  });

  it('repeats Paper authorization across repeated mutations after Save', async () => {
    seedPaper(true, 'Repeated race Paper');
    seedImage(true);
    const save = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().markAllDocumentsProjectSaved();
      return { status: 'success' as const };
    });
    let mutation = 0;
    const authorize = vi.fn().mockImplementation(async () => {
      mutation += 1;
      usePaperStore.getState().addFrame('text', { id: `late-${mutation}`, text: `late ${mutation}` });
      return true;
    });
    const operation = runBoundary('open', { save, authorizeDirtyImageReplacement: authorize });
    await waitForPaperReplacementRequest();
    await usePaperLossPreventionStore.getState().save();

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperStore.getState().addPage();
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().cancel();

    await expect(operation).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().document.pages).toHaveLength(3);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
  });
});

describe('low-level independent authorizations and rollback', () => {
  it('fails closed after an awaited rollback snapshot and does not run native-sync bookkeeping', async () => {
    seedPaper(true, 'Late low-level race');
    const authorization = captureProjectReplacementAuthorization();
    let releaseExport!: () => void;
    const exportBlocked = new Promise<void>((resolve) => { releaseExport = resolve; });
    useSourceBinStore.setState({
      prepareProjectSnapshot: async (snapshot) => {
        await exportBlocked;
        return originalSourceBinPrepare(snapshot);
      },
    });
    setSourceLibraryRendererNativeVersion(17);
    useSourceBinStore.getState().setNativeSyncStatus({ state: 'synced', lastAckVersion: 17 });
    const previousStatus = useSourceBinStore.getState().nativeSyncStatus;
    const operation = restoreProjectDocument(incomingProject, {
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
      transactionBookkeeping: 'reset-source-library-native-sync',
    });
    usePaperStore.getState().addPage();
    releaseExport();

    await expect(operation).rejects.toThrow('Paper workspace changed after replacement was authorized');
    expect(getSourceLibraryRendererNativeVersion()).toBe(17);
    expect(useSourceBinStore.getState().nativeSyncStatus).toBe(previousStatus);
    expect(usePaperStore.getState().document.title).toBe('Late low-level race');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
  });

  it('keeps a newer Paper edit dirty when it lands during project serialization/write', async () => {
    seedPaper(true, 'Serialization race Paper');
    const serializedPageCount = usePaperStore.getState().document.pages.length;
    useImageEditorStore.setState({
      exportProjectSnapshotWithPixels: async () => {
        usePaperStore.getState().addPage();
        return { documents: [], activeDocId: null };
      },
    });

    const serialized = await buildCurrentProjectDocument({ id: 'race-save', name: 'Race Save' });

    expect(serialized.paper?.document?.pages).toHaveLength(serializedPageCount);
    expect(acknowledgePaperProjectSnapshot(serialized.paper)).toBe(false);
    expect(usePaperStore.getState().document.pages).toHaveLength(serializedPageCount + 1);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
  });

  it('matches only the exact acknowledged Image project snapshot before save-result restore', async () => {
    seedImage(true);
    const serialized = await buildCurrentProjectDocument({ id: 'image-race-save', name: 'Image Race Save' });

    expect(isCurrentImageWorkspaceAtProjectSnapshot(serialized.imageEditor)).toBe(true);
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((document) => ({ ...document, title: 'Newer live Image title' })),
    }));
    expect(isCurrentImageWorkspaceAtProjectSnapshot(serialized.imageEditor)).toBe(false);
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
  });

  it('invalidates Image authorization when a sanctioned pixel mutation advances bitmapVersion', () => {
    const document = {
      ...imageDocument('pixel-version-image', true),
      activeLayerId: 'pixels',
      layers: [{
        id: 'pixels',
        name: 'Pixels',
        type: 'image' as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal' as const,
        x: 0,
        y: 0,
        bitmap: null,
        bitmapVersion: 0,
        mask: null,
      }],
    };
    useImageEditorStore.setState({ documents: [document], activeDocId: document.id });
    const authorization = captureProjectReplacementAuthorization().image;

    useImageEditorStore.getState().bumpLayerBitmapVersion(document.id, 'pixels');

    expect(useImageEditorStore.getState().documents[0].layers[0].bitmapVersion).toBe(1);
    expect(isImageReplacementAuthorizationCurrent(authorization)).toBe(false);
  });

  it('does not let Image authorization bypass a dirty Paper guard', async () => {
    seedPaper(true);
    const imageAuthorization = captureProjectReplacementAuthorization().image;
    await expect(restoreProjectDocument(incomingProject, {
      imageAuthorization,
    })).rejects.toThrow('dirty Paper document');
    expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
  });

  it('does not let Paper authorization bypass a dirty Image guard', async () => {
    const liveImage = seedImage(true);
    const paperAuthorization = captureProjectReplacementAuthorization().paper;
    await expect(resetProjectDocument({
      paperAuthorization,
    })).rejects.toThrow('dirty Image document');
    expect(useImageEditorStore.getState().documents).toEqual([liveImage]);
  });

  it('rolls back every authored workspace and Image history when reset fails late', async () => {
    seedPaper(true, 'Rollback Paper');
    const paperBefore = fingerprintPaperAuthoredContent(usePaperStore.getState().document);
    const liveImage = seedImage(true);
    const undo = [{
      kind: 'selection',
      docId: liveImage.id,
      before: null,
      after: null,
    }] as EditorOperation[];
    useImageEditorStore.setState({ undoStacks: { [liveImage.id]: undo } });
    useImageEditorStore.setState({
      commitPreparedProjectSnapshotWithPixels: () => {
        throw new Error('image reset failed');
      },
    });

    const authorization = captureProjectReplacementAuthorization();
    await expect(resetProjectDocument({
      imageAuthorization: authorization.image,
      paperAuthorization: authorization.paper,
    })).rejects.toThrow('Previous workspace was left unchanged');

    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
    expect(fingerprintPaperAuthoredContent(usePaperStore.getState().document)).toBe(paperBefore);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(useImageEditorStore.getState().documents[0]).toBe(liveImage);
    expect(useImageEditorStore.getState().undoStacks[liveImage.id]).toBe(undo);
  });
});

describe.each(['restore', 'reset'] as const)('%s transaction-owned bookkeeping', (operationKind) => {
  function runWithBookkeeping() {
    const authorization = captureProjectReplacementAuthorization();
    const options = {
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
      transactionBookkeeping: 'reset-source-library-native-sync' as const,
    };
    return operationKind === 'restore'
      ? restoreProjectDocument(incomingProject, options)
      : resetProjectDocument(options);
  }

  function runWithLegacyCallback(beforeReplace: unknown) {
    const authorization = captureProjectReplacementAuthorization();
    const options = {
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
      beforeReplace,
    } as unknown as Parameters<typeof resetProjectDocument>[0];
    return operationKind === 'restore'
      ? restoreProjectDocument(incomingProject, options)
      : resetProjectDocument(options);
  }

  function captureLiveStates() {
    return {
      flow: useFlowStore.getState(),
      flowWorkspaces: useFlowWorkspaceStore.getState(),
      editor: useEditorStore.getState(),
      sourceBin: useSourceBinStore.getState(),
      usage: useProjectUsageStore.getState(),
      paper: usePaperStore.getState(),
      image: useImageEditorStore.getState(),
    };
  }

  function expectLiveStatesUnchanged(before: ReturnType<typeof captureLiveStates>) {
    expect(useFlowStore.getState()).toBe(before.flow);
    expect(useFlowWorkspaceStore.getState()).toBe(before.flowWorkspaces);
    expect(useEditorStore.getState()).toBe(before.editor);
    expect(useSourceBinStore.getState()).toBe(before.sourceBin);
    expect(useProjectUsageStore.getState()).toBe(before.usage);
    expect(usePaperStore.getState()).toBe(before.paper);
    expect(useImageEditorStore.getState()).toBe(before.image);
  }

  function mutateLiveAuthoredStores(marker = 'legacy-callback') {
    usePaperStore.getState().addPage();
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((document) => ({
        ...document,
        width: document.width + 1,
        dirty: true,
      })),
    }));
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: marker, type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    useSourceBinStore.setState((state) => ({
      dismissedSourceKeys: [...state.dismissedSourceKeys, marker],
    }));
  }

  function mutateDeferredNonPaperStores(marker: string) {
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((document) => ({
        ...document,
        width: document.width + 1,
        dirty: true,
      })),
    }));
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: marker, type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    useSourceBinStore.setState((state) => ({
      dismissedSourceKeys: [...state.dismissedSourceKeys, marker],
    }));
  }

  async function flushDeferredWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function captureTrapMutationState() {
    const paper = usePaperStore.getState();
    const image = useImageEditorStore.getState();
    return {
      paperPageCount: paper.document.pages.length,
      paperDocumentIds: paper.documents.map((document) => document.id),
      paperInstanceIds: paper.documentInstanceIds,
      imageWidths: image.documents.map((document) => document.width),
      imageDocuments: image.documents,
      flow: useFlowStore.getState().exportProjectFlowSnapshot(),
      dismissedSourceKeys: useSourceBinStore.getState().dismissedSourceKeys,
    };
  }

  function runWithRuntimeOptions(options: object) {
    return operationKind === 'restore'
      ? restoreProjectDocument(incomingProject, options as Parameters<typeof restoreProjectDocument>[1])
      : resetProjectDocument(options as Parameters<typeof resetProjectDocument>[0]);
  }

  it('commits valid synchronous Source Library bookkeeping with the replacement', async () => {
    setSourceLibraryRendererNativeVersion(23);
    useSourceBinStore.getState().setNativeSyncStatus({ state: 'synced', lastAckVersion: 23 });

    await expect(runWithBookkeeping()).resolves.toBeUndefined();

    expect(getSourceLibraryRendererNativeVersion()).toBe(0);
    expect(useSourceBinStore.getState().nativeSyncStatus).toEqual({ state: 'idle' });
    expect(usePaperStore.getState().document.title).toBe(
      operationKind === 'restore' ? 'Incoming Paper' : 'Untitled Paper Layout',
    );
  });

  it('rolls back transaction-owned bookkeeping and every authored workspace on a later failure', async () => {
    seedPaper(true, 'Bookkeeping rollback Paper');
    const liveImage = seedImage(true);
    setSourceLibraryRendererNativeVersion(29);
    useSourceBinStore.getState().setNativeSyncStatus({ state: 'degraded', message: 'before replacement' });
    const statusBefore = useSourceBinStore.getState().nativeSyncStatus;
    useImageEditorStore.setState({
      commitPreparedProjectSnapshotWithPixels: vi.fn(() => { throw new Error('late Image failure'); }),
    });
    // Image commits last, so the Image store must come through the rollback object-identical;
    // the earlier stores roll back through their own snapshot restores and must be
    // content-exact (authored state, dirty baselines, and the bookkeeping mirror).
    const imageStateBefore = useImageEditorStore.getState();
    const paperFingerprintBefore = fingerprintPaperAuthoredContent(usePaperStore.getState().document);
    const flowNodeIdsBefore = useFlowStore.getState().nodes.map((node) => node.id);
    const dismissedBefore = [...useSourceBinStore.getState().dismissedSourceKeys];
    const usageBefore = useProjectUsageStore.getState().exportSnapshot();

    await expect(runWithBookkeeping()).rejects.toThrow('Previous workspace was left unchanged');

    expect(getSourceLibraryRendererNativeVersion()).toBe(29);
    expect(useSourceBinStore.getState().nativeSyncStatus).toBe(statusBefore);
    expect(useImageEditorStore.getState()).toBe(imageStateBefore);
    expect(useImageEditorStore.getState().documents[0]).toBe(liveImage);
    expect(fingerprintPaperAuthoredContent(usePaperStore.getState().document)).toBe(paperFingerprintBefore);
    expect(usePaperStore.getState().document.title).toBe('Bookkeeping rollback Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(flowNodeIdsBefore);
    expect(useSourceBinStore.getState().dismissedSourceKeys).toEqual(dismissedBefore);
    expect(useProjectUsageStore.getState().exportSnapshot()).toEqual(usageBefore);
  });

  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'runs a hostile %s trap only during normalization and preserves what it changed',
    async (trapName) => {
      seedPaper(true, `${trapName} Paper`);
      seedImage(true);
      const authorization = captureProjectReplacementAuthorization();
      const trapCalls = vi.fn();
      const mutate = () => {
        trapCalls();
        mutateLiveAuthoredStores(`trap-${trapName}-${trapCalls.mock.calls.length}`);
      };
      const target = {
        paperAuthorization: authorization.paper,
        imageAuthorization: authorization.image,
      };
      const options = new Proxy(target, {
        getPrototypeOf(inner) {
          if (trapName === 'getPrototypeOf') mutate();
          return Reflect.getPrototypeOf(inner);
        },
        ownKeys(inner) {
          if (trapName === 'ownKeys') mutate();
          return Reflect.ownKeys(inner);
        },
        getOwnPropertyDescriptor(inner, key) {
          if (trapName === 'getOwnPropertyDescriptor') mutate();
          return Reflect.getOwnPropertyDescriptor(inner, key);
        },
      });

      await expect(runWithRuntimeOptions(options)).rejects.toThrow('workspace changed after replacement was authorized');
      expect(trapCalls).toHaveBeenCalled();
      const afterRejection = captureTrapMutationState();
      expect(afterRejection.paperPageCount).toBeGreaterThan(2);
      expect(afterRejection.imageWidths[0]).toBeGreaterThan(10);
      expect(afterRejection.flow.nodes[0]?.id).toContain(`trap-${trapName}`);
      expect(afterRejection.dismissedSourceKeys.at(-1)).toContain(`trap-${trapName}`);

      await flushDeferredWork();
      expect(captureTrapMutationState()).toEqual(afterRejection);
    },
  );

  it('never invokes a caller Proxy has trap for legacy beforeReplace detection', async () => {
    const authorization = captureProjectReplacementAuthorization();
    const hasTrap = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-has');
      return false;
    });
    const options = new Proxy({
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    }, { has: hasTrap });

    await expect(runWithRuntimeOptions(options)).resolves.toBeUndefined();
    expect(hasTrap).not.toHaveBeenCalled();
    expect(useSourceBinStore.getState().dismissedSourceKeys).not.toContain('forbidden-has');
  });

  it('never calls get traps after accepting inert option descriptors', async () => {
    const authorization = captureProjectReplacementAuthorization();
    const getTrap = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-get');
      return undefined;
    });
    const target = {
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    };
    const options = new Proxy(target, { get: getTrap });

    await expect(runWithRuntimeOptions(options)).resolves.toBeUndefined();
    expect(getTrap).not.toHaveBeenCalled();
    expect(useSourceBinStore.getState().dismissedSourceKeys).not.toContain('forbidden-get');
  });

  it('rejects option accessors without reading their getter', async () => {
    const authorization = captureProjectReplacementAuthorization();
    const accessor = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-accessor');
      return authorization.paper;
    });
    const options = Object.create(null, {
      paperAuthorization: { configurable: true, enumerable: true, get: accessor },
      imageAuthorization: { configurable: true, enumerable: true, value: authorization.image },
    });
    const before = captureLiveStates();

    await expect(runWithRuntimeOptions(options)).rejects.toThrow('must be an inert data property');
    expect(accessor).not.toHaveBeenCalled();
    expectLiveStatesUnchanged(before);
  });

  it('rejects legacy inherited callback authority without reading or invoking it', async () => {
    const callback = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-legacy-callback');
      return () => undefined;
    });
    const callbackGetter = vi.fn(() => callback);
    const prototype = Object.create(null, {
      beforeReplace: { configurable: true, get: callbackGetter },
    });
    const options = Object.assign(Object.create(prototype), {
      transactionBookkeeping: 'reset-source-library-native-sync',
    });
    const before = captureLiveStates();

    await expect(runWithRuntimeOptions(options)).rejects.toThrow('beforeReplace callbacks are not supported');
    expect(callbackGetter).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expectLiveStatesUnchanged(before);
  });

  it('does not coerce or await hostile option values and thenables', async () => {
    const coercion = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-coercion');
      return 'reset-source-library-native-sync';
    });
    const then = vi.fn(() => {
      mutateLiveAuthoredStores('forbidden-thenable');
    });
    const value = {
      then,
      toString: coercion,
      valueOf: coercion,
      [Symbol.toPrimitive]: coercion,
    };
    const before = captureLiveStates();

    await expect(runWithRuntimeOptions({
      transactionBookkeeping: value,
    })).rejects.toThrow('Unsupported project replacement bookkeeping primitive');
    expect(coercion).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
    expectLiveStatesUnchanged(before);
  });

  it('rejects synchronous re-entrancy from a normalization trap before either transaction starts', async () => {
    seedPaper(true, 'Re-entrant trap Paper');
    seedImage(true);
    const authorization = captureProjectReplacementAuthorization();
    let nested: Promise<void> | undefined;
    const options = new Proxy({
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    }, {
      ownKeys(inner) {
        if (!nested) {
          nested = resetProjectDocument();
          void nested.catch(() => undefined);
        }
        mutateLiveAuthoredStores('reentrant-trap');
        return Reflect.ownKeys(inner);
      },
    });

    await expect(runWithRuntimeOptions(options)).rejects.toThrow('workspace changed after replacement was authorized');
    await expect(nested).rejects.toThrow('Re-entrant project replacement option normalization is not supported');
    const afterRejection = captureTrapMutationState();
    await flushDeferredWork();
    expect(captureTrapMutationState()).toEqual(afterRejection);
  });

  it('fails closed on a synchronous normalization trap and preserves its deferred work without opening authorization', async () => {
    seedPaper(false, 'Deferred trap Paper');
    seedImage(true);
    setSourceLibraryRendererNativeVersion(41);
    useSourceBinStore.getState().setNativeSyncStatus({ state: 'synced', lastAckVersion: 41 });
    const statusBefore = useSourceBinStore.getState().nativeSyncStatus;
    const events: string[] = [];
    let scheduled = false;
    const scheduleTrapWork = () => {
      if (scheduled) return;
      scheduled = true;
      events.push('sync');
      mutateLiveAuthoredStores('trap-sync');
      queueMicrotask(() => {
        events.push('microtask');
        mutateDeferredNonPaperStores('trap-microtask');
      });
      setTimeout(() => {
        events.push('timer');
        mutateDeferredNonPaperStores('trap-timer');
      }, 0);
    };
    const guardedTarget = operationKind === 'restore'
      ? {
          key: 'test:proxy-rollback-restore',
          save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
          authorizeDirtyImageReplacement: vi.fn().mockResolvedValue(true),
          transactionBookkeeping: 'reset-source-library-native-sync' as const,
        }
      : {
          key: 'test:proxy-rollback-reset',
          save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
          confirmOtherChanges: vi.fn().mockResolvedValue(true),
          transactionBookkeeping: 'reset-source-library-native-sync' as const,
        };
    const guardedOptions = new Proxy(guardedTarget, {
      ownKeys(inner) {
        scheduleTrapWork();
        return Reflect.ownKeys(inner);
      },
    });
    if (operationKind === 'restore') {
      useImageEditorStore.setState({
        commitPreparedProjectSnapshotWithPixels: vi.fn(() => { throw new Error('late Image restore failure'); }),
      });
    } else {
      useImageEditorStore.setState({
        commitPreparedProjectSnapshotWithPixels: vi.fn(() => { throw new Error('late Image reset failure'); }),
      });
    }

    const operation = operationKind === 'restore'
      ? replaceProjectDocument(incomingProject, guardedOptions)
      : replaceWithBlankProject(guardedOptions);
    expect(events).toEqual(['sync']);
    await expect(operation).rejects.toThrow('workspace changed after replacement was authorized');
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
    expect(getSourceLibraryRendererNativeVersion()).toBe(41);
    expect(useSourceBinStore.getState().nativeSyncStatus).toBe(statusBefore);

    await flushDeferredWork();
    expect(events).toEqual(['sync', 'microtask', 'timer']);
    const afterDeferredWork = captureTrapMutationState();
    expect(getSourceLibraryRendererNativeVersion()).toBe(41);
    expect(useSourceBinStore.getState().nativeSyncStatus).toBe(statusBefore);

    await flushDeferredWork();
    expect(events).toEqual(['sync', 'microtask', 'timer']);
    expect(captureTrapMutationState()).toEqual(afterDeferredWork);
  });

  const invalidCallbackCases = [
    {
      name: 'Promise callback that queues a Paper/Image/Flow microtask',
      create: (mutate: () => void) => () => Promise.resolve().then(() => {
        mutate();
        return () => undefined;
      }),
    },
    {
      name: 'rejected Promise callback',
      create: () => () => Promise.reject(new Error('async bookkeeping rejection')),
    },
    {
      name: 'nested thenable callback',
      create: (mutate: () => void) => () => ({
        then(resolve: (value: unknown) => void) {
          queueMicrotask(mutate);
          resolve({ then: (nestedResolve: (value: unknown) => void) => nestedResolve(() => undefined) });
        },
      }),
    },
    {
      name: 'synchronous mutation followed by a Promise return',
      create: (mutate: () => void) => () => {
        mutate();
        return Promise.resolve(() => undefined);
      },
    },
    {
      name: 'throwing callback',
      create: (mutate: () => void) => () => {
        mutate();
        throw new Error('synchronous callback throw');
      },
    },
    {
      name: 'timer-scheduling callback',
      create: (mutate: () => void) => () => {
        setTimeout(mutate, 0);
        return Promise.resolve(() => undefined);
      },
    },
  ];

  it.each(invalidCallbackCases)(
    'rejects a legacy $name without granting callback mutation authority',
    async ({ create }) => {
      seedPaper(true, 'Legacy callback Paper');
      seedImage(true);
      const before = captureLiveStates();
      const callback = vi.fn(create(mutateLiveAuthoredStores));

      const result = runWithLegacyCallback(callback);
      expect(callback).not.toHaveBeenCalled();
      expectLiveStatesUnchanged(before);

      await expect(result).rejects.toThrow('beforeReplace callbacks are not supported');
      expect(callback).not.toHaveBeenCalled();
      expectLiveStatesUnchanged(before);

      await flushDeferredWork();
      expect(callback).not.toHaveBeenCalled();
      expectLiveStatesUnchanged(before);
    },
  );
});

function captureLiveStatesForPreparation() {
  return {
    flow: useFlowStore.getState(),
    flowWorkspaces: useFlowWorkspaceStore.getState(),
    editor: useEditorStore.getState(),
    sourceBin: useSourceBinStore.getState(),
    usage: useProjectUsageStore.getState(),
    paper: usePaperStore.getState(),
    image: useImageEditorStore.getState(),
  };
}

function expectLiveStatesForPreparation(before: ReturnType<typeof captureLiveStatesForPreparation>) {
  expect(useFlowStore.getState()).toBe(before.flow);
  expect(useFlowWorkspaceStore.getState()).toBe(before.flowWorkspaces);
  expect(useEditorStore.getState()).toBe(before.editor);
  expect(useSourceBinStore.getState()).toBe(before.sourceBin);
  expect(useProjectUsageStore.getState()).toBe(before.usage);
  expect(usePaperStore.getState()).toBe(before.paper);
  expect(useImageEditorStore.getState()).toBe(before.image);
}

describe('detached dirty Image confirmation projection', () => {
  it('rejects a metadata Proxy side effect captured after the all-workspace token and preserves the edit', async () => {
    const target = imageDocument('proxy-side-effect');
    let mutated = false;
    const document = new Proxy(target, {
      get(targetDocument, key, receiver) {
        if (!mutated && (key === 'dirty' || key === 'title')) {
          mutated = true;
          useFlowStore.getState().replaceFlowSnapshot({
            nodes: [{ id: 'metadata-side-effect', type: 'textNode', position: { x: 41, y: 0 }, data: {} }],
            edges: [],
          });
        }
        return Reflect.get(targetDocument, key, receiver);
      },
      getOwnPropertyDescriptor(targetDocument, key) {
        if (!mutated && (key === 'dirty' || key === 'title')) {
          mutated = true;
          useFlowStore.getState().replaceFlowSnapshot({
            nodes: [{ id: 'metadata-side-effect', type: 'textNode', position: { x: 41, y: 0 }, data: {} }],
            edges: [],
          });
        }
        return Reflect.getOwnPropertyDescriptor(targetDocument, key);
      },
    });
    useImageEditorStore.setState({ documents: [document], activeDocId: target.id });
    const authorize = vi.fn().mockResolvedValue(true);

    await expect(runBoundary('open', { authorizeDirtyImageReplacement: authorize })).resolves.toBe(false);

    expect(mutated).toBe(true);
    expect(authorize).not.toHaveBeenCalled();
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['metadata-side-effect']);
    expect(useImageEditorStore.getState().documents[0]).toBe(document);
  });

  it.each(['dirty', 'title'] as const)(
    'fails closed on a %s accessor without invoking document metadata code',
    async (key) => {
      const document = imageDocument(`accessor-${key}`);
      const getter = vi.fn(() => key === 'dirty' ? true : 'Accessor title');
      Object.defineProperty(document, key, { configurable: true, get: getter });
      useImageEditorStore.setState({ documents: [document], activeDocId: document.id });
      const stateBefore = useImageEditorStore.getState();
      const authorize = vi.fn().mockResolvedValue(true);

      await expect(runBoundary('open', { authorizeDirtyImageReplacement: authorize })).resolves.toBe(false);

      expect(getter).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(useImageEditorStore.getState()).toBe(stateBefore);
      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['outgoing-node']);
    },
  );

  it('passes the exact frozen bounded UI projection and no Image document capabilities', async () => {
    const liveDocument = seedImage(true);
    liveDocument.layers.push({ id: 'private-live-layer' } as never);
    liveDocument.snapshots = [{ id: 'private-history' } as never];
    let projection: DirtyImageReplacementProjection | undefined;

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        projection = candidate;
        return false;
      },
    })).resolves.toBe(false);

    expect(projection).toEqual({
      dirtyDocumentCount: 1,
      soleDocument: { title: 'Outgoing Image' },
    });
    expect(Object.keys(projection ?? {})).toEqual(['dirtyDocumentCount', 'soleDocument']);
    expect(Object.keys(projection?.soleDocument ?? {})).toEqual(['title']);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection?.soleDocument)).toBe(true);
    expect(projection).not.toBe(liveDocument);
    expect(projection?.soleDocument).not.toBe(liveDocument);
    expect(JSON.stringify(projection)).not.toContain('private-live-layer');
    expect(JSON.stringify(projection)).not.toContain('private-history');
    expect(buildDirtyImageReplacementConfirmationMessage(projection!)).toBe(
      'Discard unsaved layered changes in Image document “Outgoing Image” and replace the project?',
    );
  });

  it('keeps plural output constant-size and does not expose titles the UI will not display', async () => {
    const first = imageDocument('first-dirty');
    const second = imageDocument('second-dirty');
    first.title = 'First title';
    second.title = 'Second title';
    useImageEditorStore.setState({ documents: [first, second], activeDocId: first.id });
    let projection: DirtyImageReplacementProjection | undefined;

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        projection = candidate;
        return false;
      },
    })).resolves.toBe(false);

    expect(projection).toEqual({ dirtyDocumentCount: 2, soleDocument: null });
    expect(buildDirtyImageReplacementConfirmationMessage(projection!)).toBe(
      'Discard unsaved layered changes in 2 Image documents and replace the project?',
    );
    expect(JSON.stringify(projection)).not.toContain('First title');
    expect(JSON.stringify(projection)).not.toContain('Second title');
    expect(Object.isFrozen(projection)).toBe(true);
  });

  it('bounds the sole display title without coercing or awaiting non-string values', async () => {
    const longTitle = 'x'.repeat(700);
    const liveDocument = seedImage(true);
    liveDocument.title = longTitle;
    let projection: DirtyImageReplacementProjection | undefined;

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        projection = candidate;
        return false;
      },
    })).resolves.toBe(false);

    expect(projection?.soleDocument?.title).toBe(`${'x'.repeat(511)}…`);
    expect(projection?.soleDocument?.title).toHaveLength(512);
  });

  it('fails closed on Proxy/accessor input and never executes its getter, iterator, or thenable', async () => {
    const then = vi.fn();
    const titleValue = new Proxy({ then }, { get: vi.fn(Reflect.get) });
    const titleGetter = vi.fn(() => titleValue);
    const documentTarget = imageDocument('proxy-dirty');
    Object.defineProperty(documentTarget, 'title', { configurable: true, get: titleGetter });
    const documentGet = vi.fn();
    const document = new Proxy(documentTarget, {
      get(target, key, receiver) {
        documentGet(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const iterator = vi.fn(function* () { yield document; });
    const documents = new Proxy([document], {
      get(target, key, receiver) {
        if (key === Symbol.iterator) return iterator;
        return Reflect.get(target, key, receiver);
      },
    });
    useImageEditorStore.setState({ documents, activeDocId: documentTarget.id });
    let projection: DirtyImageReplacementProjection | undefined;
    const authorize = vi.fn(async (candidate: DirtyImageReplacementProjection) => {
      projection = candidate;
      return false;
    });

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: authorize,
    })).resolves.toBe(false);

    await Promise.resolve();
    expect(authorize).not.toHaveBeenCalled();
    expect(projection).toBeUndefined();
    expect(titleGetter).not.toHaveBeenCalled();
    expect(documentGet).not.toHaveBeenCalled();
    expect(iterator).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
  });

  it.each(['open', 'reset'] as const)(
    'cannot mutate the exact restored Image workspace through a retained projection after late %s failure',
    async (boundary) => {
      const liveDocument = seedImage(true);
      let retained: DirtyImageReplacementProjection | undefined;
      useImageEditorStore.setState({
        commitPreparedProjectSnapshotWithPixels: vi.fn(() => { throw new Error('injected late Image commit failure'); }),
      });
      const exactStateBefore = useImageEditorStore.getState();
      const exactDocumentsBefore = exactStateBefore.documents;

      await expect(runBoundary(boundary, {
        authorizeDirtyImageReplacement: async (candidate) => {
          retained = candidate;
          return true;
        },
      })).rejects.toThrow('Previous workspace was left unchanged');

      expect(useImageEditorStore.getState()).toBe(exactStateBefore);
      expect(useImageEditorStore.getState().documents).toBe(exactDocumentsBefore);
      expect(useImageEditorStore.getState().documents[0]).toBe(liveDocument);
      expect(() => Object.assign(retained as object, { dirtyDocumentCount: 99 })).toThrow(TypeError);
      expect(() => Object.assign(retained?.soleDocument as object, { title: 'retained mutation' })).toThrow(TypeError);
      expect(useImageEditorStore.getState()).toBe(exactStateBefore);
      expect(useImageEditorStore.getState().documents[0]).toBe(liveDocument);
      expect(liveDocument.title).toBe('Outgoing Image');
    },
  );

  it('remains detached after a successful replacement commit', async () => {
    seedImage(true);
    let retained: DirtyImageReplacementProjection | undefined;

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        retained = candidate;
        return true;
      },
    })).resolves.toBe(true);

    const committedState = useImageEditorStore.getState();
    expect(committedState.documents).toEqual([]);
    expect(() => Object.assign(retained?.soleDocument as object, { title: 'post-commit mutation' })).toThrow(TypeError);
    expect(useImageEditorStore.getState()).toBe(committedState);
    expect(useImageEditorStore.getState().documents).toEqual([]);
  });

  it('remains detached after rejection and preserves the exact prior Image state', async () => {
    const liveDocument = seedImage(true);
    const exactStateBefore = useImageEditorStore.getState();
    let retained: DirtyImageReplacementProjection | undefined;

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        retained = candidate;
        return false;
      },
    })).resolves.toBe(false);

    expect(useImageEditorStore.getState()).toBe(exactStateBefore);
    expect(() => Object.assign(retained?.soleDocument as object, { title: 'post-rejection mutation' })).toThrow(TypeError);
    expect(useImageEditorStore.getState()).toBe(exactStateBefore);
    expect(useImageEditorStore.getState().documents[0]).toBe(liveDocument);
    expect(liveDocument.title).toBe('Outgoing Image');
  });

  it('does not let an overlapping superseded confirmation retain authority over the newer workspace', async () => {
    seedImage(true);
    let retained: DirtyImageReplacementProjection | undefined;
    let resolveFirst!: (approved: boolean) => void;
    const firstDecision = new Promise<boolean>((resolve) => { resolveFirst = resolve; });
    const first = runBoundary('open', {
      authorizeDirtyImageReplacement: async (candidate) => {
        retained = candidate;
        return firstDecision;
      },
    });
    await vi.waitFor(() => expect(retained).toBeDefined());

    await expect(runBoundary('open', {
      authorizeDirtyImageReplacement: vi.fn().mockResolvedValue(true),
    })).resolves.toBe(true);
    const newerDocument = seedImage(true);
    const newerState = useImageEditorStore.getState();
    resolveFirst(true);

    await expect(first).resolves.toBe(false);
    expect(() => Object.assign(retained?.soleDocument as object, { title: 'superseded mutation' })).toThrow(TypeError);
    expect(useImageEditorStore.getState()).toBe(newerState);
    expect(useImageEditorStore.getState().documents[0]).toBe(newerDocument);
    expect(newerDocument.title).toBe('Outgoing Image');
  });
});

describe('Paper project-replacement decision queue', () => {
  it('does not authorize a newer same-key workspace from the earlier visible Discard', async () => {
    seedPaper(true, 'First dirty Paper');
    const firstSave = vi.fn().mockResolvedValue({ status: 'failed', error: 'first save not selected' });
    const secondSave = vi.fn().mockResolvedValue({ status: 'failed', error: 'second save not selected' });
    const first = replaceProjectDocument(incomingProject, {
      key: 'same-project-open',
      title: 'First project replacement',
      message: 'First workspace message',
      save: firstSave,
    });
    await waitForPaperReplacementRequest();
    const firstVisible = usePaperLossPreventionStore.getState().activeRequest!;
    expect(firstVisible.documentTitles).toEqual(['First dirty Paper']);

    usePaperStore.getState().createNewDocument({ title: 'Newer dirty Paper tab' });
    usePaperStore.getState().addPage();
    const second = replaceProjectDocument(incomingProject, {
      key: 'same-project-open',
      title: 'Second project replacement',
      message: 'Second workspace message',
      save: secondSave,
    });
    let secondSettlements = 0;
    void second.then(() => { secondSettlements += 1; });
    await Promise.resolve();

    expect(usePaperLossPreventionStore.getState().activeRequest?.id).toBe(firstVisible.id);
    usePaperLossPreventionStore.getState().discard(firstVisible.id);
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).toMatchObject({
      title: 'Second project replacement',
      message: 'Second workspace message',
      documentTitles: ['First dirty Paper', 'Newer dirty Paper tab'],
    }));
    expect(secondSettlements).toBe(0);
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).not.toHaveBeenCalled();

    const secondVisibleId = usePaperLossPreventionStore.getState().activeRequest!.id;
    expect(secondVisibleId).not.toBe(firstVisible.id);
    usePaperLossPreventionStore.getState().discard(secondVisibleId);
    await expect(second).resolves.toBe(true);
    expect(secondSettlements).toBe(1);

    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest?.title)
      .toBe('First project replacement'));
    usePaperLossPreventionStore.getState().cancel();
    await expect(first).resolves.toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Incoming Paper');
  });
});

describe('closed project replacement authority', () => {
  it('consumes an Image replacement capability on its first attempted replacement', async () => {
    seedImage(true);
    const authorization = captureProjectReplacementAuthorization();

    await expect(resetProjectDocument({
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    })).resolves.toBeUndefined();
    expect(isImageReplacementAuthorizationCurrent(authorization.image)).toBe(false);

    seedImage(true);
    await expect(resetProjectDocument({
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    })).rejects.toThrow('dirty Image document');
  });

  describe.each(['restore', 'reset'] as const)('%s preparation snapshot', (operationKind) => {
    const delayedMutations = [
      {
        name: 'Flow',
        mutate: () => useFlowStore.getState().replaceFlowSnapshot({
          nodes: [{ id: 'newer-flow', type: 'textNode', position: { x: 7, y: 0 }, data: {} }],
          edges: [],
        }),
      },
      {
        name: 'Flow workspaces',
        mutate: () => { useFlowWorkspaceStore.getState().createWorkspace('Newer workspace'); },
      },
      {
        name: 'Editor',
        mutate: () => useEditorStore.getState().setWorkspaceView('image'),
      },
      {
        name: 'Source Bin',
        mutate: () => useSourceBinStore.setState({ dismissedSourceKeys: ['newer-source-bin'] }),
      },
      {
        name: 'usage',
        mutate: () => useProjectUsageStore.setState({ balancesLoading: true }),
      },
      {
        name: 'Paper',
        mutate: () => usePaperStore.getState().addPage(),
      },
      {
        name: 'Image',
        mutate: () => useImageEditorStore.setState((state) => ({
          documents: state.documents.map((document) => ({
            ...document,
            width: document.width + 1,
            dirty: true,
          })),
        })),
      },
      {
        name: 'Source native version',
        mutate: () => setSourceLibraryRendererNativeVersion(73),
      },
    ];

    it.each(delayedMutations)(
      'rejects and preserves a newer $name identity while async I/O is pending',
      async ({ mutate }) => {
        seedPaper(true, 'Preparation Paper');
        seedImage(true);
        const authorization = captureProjectReplacementAuthorization();
        let preparationEntered!: () => void;
        let releasePreparation!: () => void;
        const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
        const blocked = new Promise<void>((resolve) => { releasePreparation = resolve; });
        useImageEditorStore.setState({
          prepareProjectSnapshotWithPixels: vi.fn(async (snapshot) => {
            preparationEntered();
            await blocked;
            return originalImagePrepareWithPixels(snapshot);
          }),
        });

        const operation = operationKind === 'restore'
          ? restoreProjectDocument(incomingProject, {
              paperAuthorization: authorization.paper,
              imageAuthorization: authorization.image,
            })
          : resetProjectDocument({
              paperAuthorization: authorization.paper,
              imageAuthorization: authorization.image,
            });
        await entered;
        mutate();
        const newerState = {
          live: captureLiveStatesForPreparation(),
          nativeVersion: getSourceLibraryRendererNativeVersion(),
        };
        releasePreparation();

        await expect(operation).rejects.toThrow(/workspace changed/);
        expectLiveStatesForPreparation(newerState.live);
        expect(getSourceLibraryRendererNativeVersion()).toBe(newerState.nativeVersion);
      },
    );

    it('rejects caller timer work that lands after authorization but before commit', async () => {
      vi.useFakeTimers();
      try {
        seedImage(true);
        let preparationEntered!: () => void;
        let releasePreparation!: () => void;
        const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
        const blocked = new Promise<void>((resolve) => { releasePreparation = resolve; });
        useImageEditorStore.setState({
          prepareProjectSnapshotWithPixels: vi.fn(async (snapshot) => {
            preparationEntered();
            await blocked;
            return originalImagePrepareWithPixels(snapshot);
          }),
        });
        const authorize = vi.fn(async () => {
          setTimeout(() => {
            useFlowStore.getState().replaceFlowSnapshot({
              nodes: [{ id: 'caller-timer-edit', type: 'textNode', position: { x: 9, y: 0 }, data: {} }],
              edges: [],
            });
          }, 0);
          return true;
        });

        const operation = operationKind === 'restore'
          ? replaceProjectDocument(incomingProject, {
              save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
              authorizeDirtyImageReplacement: authorize,
            })
          : replaceWithBlankProject({
              save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
              confirmOtherChanges: authorize,
            });
        await entered;
        await vi.advanceTimersByTimeAsync(0);
        const newerFlow = useFlowStore.getState();
        expect(newerFlow.nodes.map((node) => node.id)).toEqual(['caller-timer-edit']);
        releasePreparation();

        await expect(operation).rejects.toThrow('workspace changed while project replacement was prepared');
        expect(useFlowStore.getState()).toBe(newerFlow);
        expect(authorize).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('rejects a prepared commit after Image selection plus undo/redo identities change', async () => {
    seedPaper(true, 'Selection/history preparation Paper');
    const liveImage = seedImage(true);
    const authorization = captureProjectReplacementAuthorization();
    let preparationEntered!: () => void;
    let releasePreparation!: () => void;
    const entered = new Promise<void>((resolve) => { preparationEntered = resolve; });
    const blocked = new Promise<void>((resolve) => { releasePreparation = resolve; });
    useImageEditorStore.setState({
      prepareProjectSnapshotWithPixels: vi.fn(async (snapshot) => {
        preparationEntered();
        await blocked;
        return originalImagePrepareWithPixels(snapshot);
      }),
    });
    const operation = restoreProjectDocument(incomingProject, {
      paperAuthorization: authorization.paper,
      imageAuthorization: authorization.image,
    });
    await entered;

    const selection = { width: 10, height: 10, data: new Uint8ClampedArray(100).fill(255) };
    const undo = [{
      kind: 'selection' as const,
      docId: liveImage.id,
      before: null,
      after: null,
    }];
    const redo = [{
      kind: 'selection' as const,
      docId: liveImage.id,
      before: null,
      after: null,
    }];
    setSelection(liveImage.id, selection);
    useImageEditorStore.setState({
      undoStacks: { [liveImage.id]: undo },
      redoStacks: { [liveImage.id]: redo },
    });
    const newerImageState = useImageEditorStore.getState();
    releasePreparation();

    await expect(operation).rejects.toThrow(/workspace changed/);
    expect(useImageEditorStore.getState()).toBe(newerImageState);
    expect(useImageEditorStore.getState().documents[0]).toBe(liveImage);
    expect(useImageEditorStore.getState().undoStacks[liveImage.id]).toBe(undo);
    expect(useImageEditorStore.getState().redoStacks[liveImage.id]).toBe(redo);
    expect(getSelection(liveImage.id)).toBe(selection);
  });

  it('does not commit across a 30 ms Proxy-trap Flow edit while restore preparation is pending', async () => {
    vi.useFakeTimers();
    try {
      const authorization = captureProjectReplacementAuthorization();
      let scheduled = false;
      const options = new Proxy({
        paperAuthorization: authorization.paper,
        imageAuthorization: authorization.image,
      }, {
        ownKeys(target) {
          if (!scheduled) {
            scheduled = true;
            setTimeout(() => {
              useFlowStore.getState().replaceFlowSnapshot({
                nodes: [{ id: 'proxy-30ms-edit', type: 'textNode', position: { x: 30, y: 0 }, data: {} }],
                edges: [],
              });
            }, 30);
          }
          return Reflect.ownKeys(target);
        },
      });
      useImageEditorStore.setState({
        prepareProjectSnapshotWithPixels: vi.fn(async (snapshot) => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 60);
          });
          return originalImagePrepareWithPixels(snapshot);
        }),
      });

      const operation = restoreProjectDocument(incomingProject, options);
      const rejected = expect(operation).rejects.toThrow('workspace changed while project replacement was prepared');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30);
      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['proxy-30ms-edit']);
      await vi.advanceTimersByTimeAsync(30);

      await rejected;
      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['proxy-30ms-edit']);
      expect(usePaperStore.getState().document.title).toBe('Outgoing Paper');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a reentrant guarded restore supersede the outer blank replacement', async () => {
    const nestedAuthorization = captureProjectReplacementAuthorization();
    let nested: Promise<void> | undefined;
    let confirmationCalls = 0;

    const outer = replaceWithBlankProject({
      save: vi.fn().mockResolvedValue({ status: 'failed', error: 'not selected' }),
      confirmOtherChanges: async () => {
        confirmationCalls += 1;
        if (!nested) {
          nested = restoreProjectDocument(incomingProject, {
            paperAuthorization: nestedAuthorization.paper,
            imageAuthorization: nestedAuthorization.image,
          });
          await nested;
        }
        return true;
      },
    });

    await expect(outer).resolves.toBe(false);
    await expect(nested).resolves.toBeUndefined();
    expect(confirmationCalls).toBe(1);
    expect(usePaperStore.getState().document.title).toBe('Incoming Paper');
  });

  it('exposes Image replacement authorization as one frozen scalar capability', () => {
    const authorization = captureProjectReplacementAuthorization().image;

    expect(Object.keys(authorization)).toEqual(['token']);
    expect(typeof (authorization as { token?: unknown }).token).toBe('string');
    expect(Object.isFrozen(authorization)).toBe(true);
  });
});
