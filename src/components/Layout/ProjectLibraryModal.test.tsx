// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// zustand's persist middleware resolves `localStorage` once at store creation (module import),
// and Node's experimental localStorage getter yields undefined without --localstorage-file.
// Install a Map-backed stand-in before any store module loads.
const localStorageBacking = vi.hoisted(() => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, String(value));
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => backing.clear(),
      key: () => null,
      length: 0,
    },
  });
  return backing;
});

const savedToFolder = vi.hoisted(() => ({ documents: [] as Array<Record<string, unknown>> }));
const downloadedJson = vi.hoisted(() => ({ payloads: [] as Array<{ fileName: string; data: Record<string, unknown> }> }));

vi.mock('../DockablePanel', () => ({
  DockableDialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../lib/projectLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectLibrary')>();
  return {
    ...actual,
    downloadJsonFile: (fileName: string, data: unknown) => {
      downloadedJson.payloads.push({ fileName, data: data as Record<string, unknown> });
    },
  };
});

vi.mock('../../lib/fileSystemWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/fileSystemWorkspace')>();
  const scratchDirectoryHandle = { name: 'scratch' };
  return {
    ...actual,
    isFileSystemAccessSupported: () => true,
    pickDirectory: async () => ({
      name: 'ProjectFolder',
      getDirectoryHandle: async () => scratchDirectoryHandle,
    }),
    loadFileSystemWorkspaceHandles: async () => ({}),
    loadFileSystemWorkspaceSummary: async () => undefined,
    saveFileSystemWorkspaceHandles: async ({ projectId }: { projectId: string }) => ({
      projectId,
      projectDirectoryName: 'ProjectFolder',
      scratchDirectoryName: 'scratch',
      hasProjectDirectory: true,
      hasScratchDirectory: true,
    }),
    saveProjectWorkspaceToFileSystem: async ({ document }: { document: Record<string, unknown> }) => {
      savedToFolder.documents.push(document);
      return { projectDirectoryName: 'ProjectFolder', scratchDirectoryName: 'scratch' };
    },
    writeScratchAssets: async () => 0,
  };
});

import { ProjectLibraryModal } from './ProjectLibraryModal';
import { listProjectSummaries, loadProjectDocument } from '../../lib/projectLibrary';
import { restoreProjectDocument } from '../../lib/projectDocumentActions';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../../lib/paperDocument';
import { usePaperStore } from '../../store/paperStore';
import { useFlowStore } from '../../store/flowStore';
import { useProjectUsageStore } from '../../store/projectUsageStore';
import { useSourceBinStore } from '../../store/sourceBinStore';

const originalSetScratchDirectoryHandle = useSourceBinStore.getState().setScratchDirectoryHandle;
const originalMigrateAssetsToScratch = useSourceBinStore.getState().migrateAssetsToScratch;

describe('ProjectLibraryModal project persistence', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorageBacking.clear();
    window.indexedDB = new IDBFactory() as unknown as typeof window.indexedDB;
    savedToFolder.documents.length = 0;
    downloadedJson.payloads.length = 0;

    const base = { ...createDefaultPaperDocument({ title: 'Modal Paper Tab' }), id: 'paper-modal' };
    const paperDocument = addFrameToPaperPage(base, base.pages[0].id, {
      id: 'modal-frame',
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 60,
      heightMm: 20,
    } as never).document;
    usePaperStore.getState().restoreSnapshot({
      document: paperDocument,
      selectedPageId: paperDocument.pages[0].id,
      tool: 'select',
      zoom: 0.8,
    });
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'modal-node', type: 'textNode', position: { x: 1, y: 2 }, data: { prompt: 'keep' } }],
      edges: [],
    });
    useProjectUsageStore.getState().restoreSnapshot(undefined);
    useProjectUsageStore.getState().recordUsage({
      nodeId: 'modal-node',
      nodeType: 'textNode',
      nodeData: {},
      workspace: 'flow',
      usage: {
        source: 'actual',
        confidence: 'measured',
        provider: 'openai',
        modelId: 'gpt-test',
        costUsd: 0.01,
      },
      createdAt: 100,
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    useSourceBinStore.setState({
      setScratchDirectoryHandle: originalSetScratchDirectoryHandle,
      migrateAssetsToScratch: originalMigrateAssetsToScratch,
    });
    usePaperStore.getState().restoreSnapshot(undefined);
    useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
    useProjectUsageStore.getState().restoreSnapshot(undefined);
    vi.unstubAllGlobals();
  });

  function renderModal() {
    act(() => {
      root.render(<ProjectLibraryModal isOpen onClose={() => undefined} />);
    });
  }

  async function flushAsync(ms = 10) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  function clickButton(label: string) {
    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button, `button "${label}" should be rendered`).toBeDefined();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function clickExactButton(label: string) {
    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(button, `button exactly matching "${label}" should be rendered`).toBeDefined();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  async function waitForStatus(fragment: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (container.textContent?.includes(fragment)) return;
      await flushAsync(10);
    }
    throw new Error(`Timed out waiting for status containing "${fragment}". Modal text: ${container.textContent}`);
  }

  async function waitForCondition(label: string, condition: () => Promise<boolean> | boolean) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await condition()) return;
      await flushAsync(10);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async function insertLegacyLocalProject(row: Record<string, unknown>) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('flow-project-library', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore('projects').put(row);
    });

    database.close();
  }

  it('keeps Paper and every other project slice when saving through the Save button', async () => {
    renderModal();
    await flushAsync();

    clickButton('Save Current Project');
    await waitForCondition('project saved to the library', async () =>
      (await listProjectSummaries()).length === 1);

    const summaries = await listProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].sizeReport?.documentBytes).toBeGreaterThan(0);
    expect(container.querySelector(`[data-testid="project-size-${summaries[0].id}"]`)?.textContent)
      .toContain('embedded media');
    const record = await loadProjectDocument(summaries[0].id);
    expect(record).not.toBeNull();

    // The whole-record overwrite must contain every canonical slice, not just flow/editor.
    expect(record?.paper?.document?.title).toBe('Modal Paper Tab');
    expect(record?.paper?.documents?.length).toBeGreaterThan(0);
    expect(record?.paper?.document?.pages[0]?.frames.some((frame) => frame.id === 'modal-frame')).toBe(true);
    expect(record?.usageLedger?.entries).toHaveLength(1);
    expect(record?.imageEditor).toBeDefined();
    expect(record?.flow.nodes.map((node) => node.id)).toEqual(['modal-node']);

    // Reopening the saved record restores the same Paper workspace instead of a blank default.
    await restoreProjectDocument(record);
    expect(usePaperStore.getState().document.title).toBe('Modal Paper Tab');
    expect(usePaperStore.getState().document.pages[0]?.frames.some((frame) => frame.id === 'modal-frame')).toBe(true);

    // Saving again keeps the same project identity instead of forking a second record.
    const firstSavedAt = record?.savedAt;
    clickButton('Save Current Project');
    await waitForCondition('the record was overwritten in place', async () =>
      (await loadProjectDocument(summaries[0].id))?.savedAt !== firstSavedAt);
    const summariesAfterResave = await listProjectSummaries();
    expect(summariesAfterResave).toHaveLength(1);
    expect(summariesAfterResave[0].id).toBe(summaries[0].id);
    expect(summariesAfterResave[0].name).toBe(summaries[0].name);
    const resaved = await loadProjectDocument(summaries[0].id);
    expect(resaved?.paper?.document?.title).toBe('Modal Paper Tab');
  });

  it('keeps the mounted saved-project list usable when a legacy row has no flow nodes', async () => {
    renderModal();
    await flushAsync();
    clickButton('Save Current Project');
    await waitForCondition('ordinary project saved', async () =>
      (await listProjectSummaries()).length === 1);

    await insertLegacyLocalProject({
      id: 'legacy-incomplete-flow',
      name: 'Legacy incomplete project',
      savedAt: 2_000,
      flow: { version: 3, edges: [] },
    });

    clickExactButton('Refresh');
    await waitForStatus('Legacy incomplete project');

    const summaries = await listProjectSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries.find((summary) => summary.id === 'legacy-incomplete-flow')).toMatchObject({
      nodeCount: 0,
    });
    expect(container.textContent).toContain('0 nodes');
  });

  it('keeps Paper when saving the project to a folder', async () => {
    useSourceBinStore.setState({
      setScratchDirectoryHandle: () => undefined,
      migrateAssetsToScratch: async () => 0,
    });
    renderModal();
    await flushAsync();

    clickButton('Save Project To Folder');
    await waitForStatus('to folder "ProjectFolder"');

    expect(savedToFolder.documents.length).toBeGreaterThan(0);
    const folderDocument = savedToFolder.documents.at(-1) as { paper?: { document?: { title?: string } } };
    expect(folderDocument.paper?.document?.title).toBe('Modal Paper Tab');

    const summaries = await listProjectSummaries();
    expect(summaries).toHaveLength(1);
    const record = await loadProjectDocument(summaries[0].id);
    expect(record?.paper?.document?.title).toBe('Modal Paper Tab');
    expect(record?.usageLedger?.entries).toHaveLength(1);
  });

  it('exports the full current workspace, including Paper, as a .sloom download', async () => {
    renderModal();
    await flushAsync();

    clickButton('Export Current Project JSON');
    await waitForStatus('Exported');

    expect(downloadedJson.payloads).toHaveLength(1);
    const payload = downloadedJson.payloads[0].data as {
      paper?: { document?: { title?: string } };
      usageLedger?: { entries?: unknown[] };
      imageEditor?: unknown;
    };
    expect(payload.paper?.document?.title).toBe('Modal Paper Tab');
    expect(payload.usageLedger?.entries).toHaveLength(1);
    expect(payload.imageEditor).toBeDefined();
  });

  it('blocks saved-row export when ordinary Save recorded excluded and missing Paper assets', async () => {
    const missingSha256 = '1'.repeat(64);
    const restrictedSha256 = '2'.repeat(64);
    const missingRef = {
      id: `sha256:${missingSha256}`,
      sha256: missingSha256,
      mimeType: 'image/png',
      byteLength: 4,
      fileName: 'missing-panel.png',
    } as const;
    const restrictedFontRef = {
      id: `sha256:${restrictedSha256}`,
      sha256: restrictedSha256,
      mimeType: 'font/ttf',
      byteLength: 4,
      fileName: 'restricted.ttf',
    } as const;
    const base = createDefaultPaperDocument({ title: 'Incomplete Saved Project' });
    const withMissingImage = addFrameToPaperPage(base, base.pages[0].id, {
      id: 'missing-image-frame',
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 60,
      heightMm: 40,
      asset: {
        label: 'Missing Panel',
        kind: 'image',
        mimeType: missingRef.mimeType,
        locator: { kind: 'managed', ref: missingRef },
      },
    } as never).document;
    const incompleteDocument = {
      ...withMissingImage,
      importedFonts: [{
        id: 'restricted-face',
        familyId: 'restricted-family',
        familyName: 'Restricted Family',
        postscriptName: 'RestrictedFamily-Regular',
        weight: 400,
        style: 'normal',
        stretchPercent: 100,
        collectionIndex: 0,
        variableAxes: {},
        unicodeRanges: [],
        format: 'truetype',
        fontAsset: restrictedFontRef,
        embeddability: 'restricted',
        canSubset: false,
        source: { kind: 'user-import' },
        license: {},
      }],
    } as never;
    usePaperStore.getState().restoreSnapshot({
      document: incompleteDocument,
      selectedPageId: withMissingImage.pages[0].id,
      tool: 'select',
      zoom: 1,
    });

    renderModal();
    await flushAsync();
    clickButton('Save Current Project');
    await waitForCondition('incomplete project saved without blocking', async () =>
      (await listProjectSummaries()).length === 1);

    const summaries = await listProjectSummaries();
    expect(summaries).toHaveLength(1);
    const saved = await loadProjectDocument(summaries[0].id);
    expect(saved?.paperAssets?.excludedFonts).toHaveLength(1);
    expect(saved?.paperAssets?.missingAssets).toHaveLength(1);

    clickExactButton('Export');
    await waitForStatus('cannot be completed as a self-contained package');

    expect(container.textContent).toContain('Restricted Family');
    expect(container.textContent).toContain(missingRef.id);
    expect(downloadedJson.payloads).toHaveLength(0);
  });
});
