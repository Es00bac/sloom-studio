// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import {
  noteActiveSourceCatalogProjectDocument,
  recordSourceCatalogProjectDocument,
  useSourceCatalogStore,
} from './sourceCatalogStore';
import type { SourceBinProjectSnapshot } from './sourceBinStore';

function resetStore() {
  useSourceCatalogStore.setState({
    records: [],
    activeProjectId: undefined,
    activeProjectName: undefined,
  });
}

function snapshot(items: Array<Record<string, unknown>>): SourceBinProjectSnapshot {
  return {
    bins: [{ id: 'bin-1', name: 'Bin', items: items as never, collapsed: false, createdAt: 1 }],
    dismissedSourceKeys: [],
  };
}

describe('sourceCatalogStore', () => {
  afterEach(() => resetStore());

  it('records a project from its save/open observation', () => {
    useSourceCatalogStore.getState().recordProject({
      projectId: 'p1',
      projectName: 'My Project',
      savedAt: 42,
      snapshot: snapshot([{ id: 'i1', label: 'Render', kind: 'image', createdAt: 40, isGenerated: true }]),
    });
    const state = useSourceCatalogStore.getState();
    expect(state.records).toHaveLength(1);
    expect(state.records[0]).toMatchObject({
      projectId: 'p1',
      projectName: 'My Project',
      firstRecordedAt: 42,
      lastSavedAt: 42,
      truncated: false,
    });
    expect(state.records[0].entries).toHaveLength(1);
    expect(state.records[0].entries[0]).toMatchObject({ itemId: 'i1', kind: 'image', isGenerated: true });
  });

  it('ignores incomplete or invalid recording input without throwing', () => {
    useSourceCatalogStore.getState().recordProject({ projectId: '', projectName: 'x', savedAt: 1 });
    useSourceCatalogStore.getState().recordProject({ projectId: 'p', projectName: '', savedAt: 1 });
    useSourceCatalogStore.getState().recordProject({ projectId: 'p', projectName: 'x', savedAt: Number.NaN });
    expect(useSourceCatalogStore.getState().records).toEqual([]);
  });

  it('upserts on re-record instead of accumulating duplicates', () => {
    useSourceCatalogStore.getState().recordProject({
      projectId: 'p1',
      projectName: 'My Project',
      savedAt: 10,
      snapshot: snapshot([{ id: 'a', label: 'A', kind: 'text', createdAt: 1 }]),
    });
    useSourceCatalogStore.getState().recordProject({
      projectId: 'p1',
      projectName: 'My Project',
      savedAt: 20,
      snapshot: snapshot([{ id: 'b', label: 'B', kind: 'text', createdAt: 2 }]),
    });
    const records = useSourceCatalogStore.getState().records;
    expect(records).toHaveLength(1);
    expect(records[0].entries.map((entry) => entry.itemId)).toEqual(['b']);
    expect(records[0].firstRecordedAt).toBe(10);
  });

  it('sets the active project identity and forgets and clears records', () => {
    useSourceCatalogStore.getState().setActiveProject({ id: 'p1', name: 'One' });
    expect(useSourceCatalogStore.getState()).toMatchObject({ activeProjectId: 'p1', activeProjectName: 'One' });

    useSourceCatalogStore.getState().recordProject({ projectId: 'p1', projectName: 'One', savedAt: 1 });
    useSourceCatalogStore.getState().recordProject({ projectId: 'p2', projectName: 'Two', savedAt: 2 });
    useSourceCatalogStore.getState().forgetProject('p1');
    expect(useSourceCatalogStore.getState().records.map((record) => record.projectId)).toEqual(['p2']);

    useSourceCatalogStore.getState().clearCatalogue();
    expect(useSourceCatalogStore.getState().records).toEqual([]);
  });
});

describe('source catalogue document helpers', () => {
  afterEach(() => resetStore());

  it('records from a canonical project document on the save funnel', () => {
    recordSourceCatalogProjectDocument({
      id: 'doc-1',
      name: 'Saved Project',
      savedAt: 77,
      sourceBin: snapshot([{ id: 's1', label: 'Still', kind: 'image', createdAt: 70 }]),
    });
    expect(useSourceCatalogStore.getState().records).toHaveLength(1);
    expect(useSourceCatalogStore.getState().records[0]).toMatchObject({
      projectId: 'doc-1',
      projectName: 'Saved Project',
      lastSavedAt: 77,
    });
  });

  it('notes the active project and records its snapshot after a replacement', () => {
    noteActiveSourceCatalogProjectDocument({
      id: 'doc-2',
      name: 'Opened Project',
      savedAt: 88,
      sourceBin: snapshot([{ id: 'o1', label: 'Opened', kind: 'video', createdAt: 80 }]),
    });
    const state = useSourceCatalogStore.getState();
    expect(state.activeProjectId).toBe('doc-2');
    expect(state.activeProjectName).toBe('Opened Project');
    expect(state.records[0].entries.map((entry) => entry.itemId)).toEqual(['o1']);
  });

  it('defaults the saved timestamp when an opened document omits it', () => {
    const before = Date.now();
    noteActiveSourceCatalogProjectDocument({ id: 'doc-3', name: 'No Time' });
    const record = useSourceCatalogStore.getState().records[0];
    expect(record.lastSavedAt).toBeGreaterThanOrEqual(before);
  });
});
