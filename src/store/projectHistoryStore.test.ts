import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROJECT_HISTORY_RESTORE_STACK_LIMIT,
  type ProjectHistorySection,
  type ProjectRevisionRecord,
} from '../lib/projectHistory';
import { useProjectHistoryStore } from './projectHistoryStore';

function buildRecord(id: string, overrides: Partial<ProjectRevisionRecord> = {}): ProjectRevisionRecord {
  return {
    id,
    kind: 'save',
    name: `Auto save ${id}`,
    createdAt: Number(id.replace('rev-', '')) * 1_000,
    summary: { version: 1, initial: true, sections: [] },
    payload: JSON.stringify({ id: 'project-1', name: 'Test', flow: { version: 3, nodes: [], edges: [] } }),
    payloadChars: 64,
    ...overrides,
  };
}

function buildSection(records: ProjectRevisionRecord[]): ProjectHistorySection {
  return { version: 1, revisions: records };
}

describe('useProjectHistoryStore', () => {
  beforeEach(() => {
    useProjectHistoryStore.getState().hydrateFromSection(undefined);
  });

  it('hydrates records from a section and clears session restore stacks', () => {
    useProjectHistoryStore.getState().recordRestoreHop({ beforeId: 'a', afterId: 'b', label: 'x' });
    useProjectHistoryStore.getState().hydrateFromSection(buildSection([buildRecord('rev-1')]));

    const state = useProjectHistoryStore.getState();
    expect(state.records.map((record) => record.id)).toEqual(['rev-1']);
    expect(state.restoreUndo).toHaveLength(0);
    expect(state.restoreRedo).toHaveLength(0);
  });

  it('clears history when hydrating an empty project', () => {
    useProjectHistoryStore.getState().hydrateFromSection(buildSection([buildRecord('rev-1')]));
    useProjectHistoryStore.getState().hydrateFromSection(undefined);

    expect(useProjectHistoryStore.getState().records).toHaveLength(0);
  });

  it('notes dropped corrupt revisions during hydration', () => {
    const record = buildRecord('rev-1');
    useProjectHistoryStore.getState().hydrateFromSection({
      version: 1,
      revisions: [record, { ...record, id: 'corrupt', kind: 'bogus' as unknown as 'save' }],
    });

    const state = useProjectHistoryStore.getState();
    expect(state.records.map((entry) => entry.id)).toEqual(['rev-1']);
    expect(state.droppedRevisionNote).toContain('1 corrupt');
  });

  it('adoptPersistedSection keeps session restore stacks while replacing records', () => {
    useProjectHistoryStore.getState().recordRestoreHop({ beforeId: 'a', afterId: 'b', label: 'x' });
    useProjectHistoryStore.getState().adoptPersistedSection(buildSection([buildRecord('rev-2')]));

    const state = useProjectHistoryStore.getState();
    expect(state.records.map((record) => record.id)).toEqual(['rev-2']);
    expect(state.restoreUndo).toHaveLength(1);
  });

  it('applySection replaces records without sanitizing away user edits', () => {
    useProjectHistoryStore.getState().applySection(buildSection([buildRecord('rev-1')]));

    expect(useProjectHistoryStore.getState().records).toHaveLength(1);
    expect(useProjectHistoryStore.getState().droppedRevisionNote).toBeUndefined();
  });

  it('records restore hops capped at the limit and clears redo', () => {
    const store = useProjectHistoryStore.getState();
    store.recordRestoreHop({ beforeId: 'a', afterId: 'b', label: 'first' });
    store.shiftRestoreUndo();
    expect(useProjectHistoryStore.getState().restoreRedo).toHaveLength(1);

    for (let index = 0; index < PROJECT_HISTORY_RESTORE_STACK_LIMIT + 3; index += 1) {
      useProjectHistoryStore.getState().recordRestoreHop({
        beforeId: `before-${index}`,
        afterId: `after-${index}`,
        label: `hop-${index}`,
      });
    }

    const state = useProjectHistoryStore.getState();
    expect(state.restoreUndo).toHaveLength(PROJECT_HISTORY_RESTORE_STACK_LIMIT);
    expect(state.restoreRedo).toHaveLength(0);
    expect(state.restoreUndo[state.restoreUndo.length - 1]?.label).toBe('hop-12');
  });

  it('shifts hops between the undo and redo stacks', () => {
    const store = useProjectHistoryStore.getState();
    store.recordRestoreHop({ beforeId: 'pre', afterId: 'post', label: 'restore' });

    const undoHop = useProjectHistoryStore.getState().shiftRestoreUndo();
    expect(undoHop).toMatchObject({ beforeId: 'pre', afterId: 'post' });
    expect(useProjectHistoryStore.getState().restoreUndo).toHaveLength(0);
    expect(useProjectHistoryStore.getState().restoreRedo).toHaveLength(1);

    const redoHop = useProjectHistoryStore.getState().shiftRestoreRedo();
    expect(redoHop).toMatchObject({ beforeId: 'pre', afterId: 'post' });
    expect(useProjectHistoryStore.getState().restoreUndo).toHaveLength(1);
    expect(useProjectHistoryStore.getState().restoreRedo).toHaveLength(0);

    expect(useProjectHistoryStore.getState().shiftRestoreUndo()).toBeDefined();
    expect(useProjectHistoryStore.getState().shiftRestoreUndo()).toBeUndefined();
    expect(useProjectHistoryStore.getState().shiftRestoreRedo()).toBeDefined();
    expect(useProjectHistoryStore.getState().shiftRestoreRedo()).toBeUndefined();
  });

  it('prunes restore hops whose revisions were deleted', () => {
    const store = useProjectHistoryStore.getState();
    store.applySection(buildSection([buildRecord('rev-1'), buildRecord('rev-2')]));
    store.recordRestoreHop({ beforeId: 'rev-1', afterId: 'rev-2', label: 'restore' });
    store.recordRestoreHop({ beforeId: 'rev-2', afterId: 'rev-9', label: 'restore-later' });
    store.shiftRestoreUndo();

    useProjectHistoryStore.getState().applySection(buildSection([buildRecord('rev-1')]));
    useProjectHistoryStore.getState().pruneRestoreHops();

    const state = useProjectHistoryStore.getState();
    expect(state.restoreUndo).toHaveLength(0);
    expect(state.restoreRedo).toHaveLength(0);
  });

  it('restores an exact snapshot for transaction rollback', () => {
    const store = useProjectHistoryStore.getState();
    store.applySection(buildSection([buildRecord('rev-1')]));
    const snapshot = useProjectHistoryStore.getState().captureSnapshot();

    useProjectHistoryStore.getState().applySection(buildSection([buildRecord('rev-2'), buildRecord('rev-3')]));
    useProjectHistoryStore.getState().restoreSnapshot(snapshot);

    expect(useProjectHistoryStore.getState().records.map((record) => record.id)).toEqual(['rev-1']);
  });
});
