import 'fake-indexeddb/auto';
import '../store/test-setup-window';
import { afterEach, describe, expect, it } from 'vitest';

// fake-indexeddb installs the factory on globalThis; the library opens it through `window`.
if (typeof window !== 'undefined' && !window.indexedDB && typeof indexedDB !== 'undefined') {
  Object.defineProperty(window, 'indexedDB', { value: indexedDB });
}
import { stageProjectSaveRevision } from './projectHistory';
import { sanitizeProjectDocument } from './projectValidation';
import {
  deleteProjectDocument,
  loadProjectDocument,
  saveProjectDocument,

} from './projectLibrary';
import { useProjectHistoryStore } from '../store/projectHistoryStore';

function buildDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'history-project',
    name: 'History Project',
    savedAt: 1_000,
    flow: { version: 3, nodes: [], edges: [] },
    ...overrides,
  };
}

describe('saveProjectDocument automatic revision capture', () => {
  afterEach(async () => {
    useProjectHistoryStore.getState().hydrateFromSection(undefined);
    await deleteProjectDocument('history-project').catch(() => undefined);
    await deleteProjectDocument('history-project-2').catch(() => undefined);
  });

  it('captures a revision on a successful save and persists it with the row', async () => {
    const saved = await saveProjectDocument(buildDocument() as never);

    expect(saved.projectHistory?.revisions).toHaveLength(1);
    expect(saved.projectHistory?.revisions[0]?.kind).toBe('save');
    expect(useProjectHistoryStore.getState().records).toHaveLength(1);

    const reopened = await loadProjectDocument('history-project');
    expect(reopened?.projectHistory?.revisions).toHaveLength(1);
  });

  it('does not duplicate a revision when identical content is saved again', async () => {
    const first = await saveProjectDocument(buildDocument() as never);
    const second = await saveProjectDocument({
      ...first,
      savedAt: 2_000,
    } as never);

    expect(second.projectHistory?.revisions).toHaveLength(1);
    expect(useProjectHistoryStore.getState().records).toHaveLength(1);
  });

  it('captures a second revision after a content change and reopens both', async () => {
    const first = await saveProjectDocument(buildDocument() as never);
    const second = await saveProjectDocument({
      ...first,
      flow: {
        version: 3,
        nodes: [{ id: 'n1', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
    } as never);

    expect(second.projectHistory?.revisions).toHaveLength(2);
    const reopened = await loadProjectDocument('history-project');
    expect(reopened?.projectHistory?.revisions.map((record) => record.id))
      .toEqual(second.projectHistory?.revisions.map((record) => record.id));
  });

  it('round-trips the persisted row through the canonical project sanitizer', async () => {
    const saved = await saveProjectDocument(buildDocument() as never);
    const sanitized = sanitizeProjectDocument(saved);

    expect(sanitized.projectHistory?.revisions).toHaveLength(1);
    expect(sanitized.projectHistory?.revisions[0]?.summary.version).toBe(1);
  });

  it('keeps a foreign document history intact when re-saving an imported project', async () => {
    const origin = await saveProjectDocument(buildDocument() as never);
    const record = origin.projectHistory?.revisions[0];
    if (!record) throw new Error('expected a captured revision');

    // Import semantics: the parsed project (identical id, content, and history) is saved again.
    const imported = await saveProjectDocument(JSON.parse(JSON.stringify(origin)) as never);

    expect(imported.projectHistory?.revisions[0]?.id).toBe(record.id);
    expect(imported.projectHistory?.revisions).toHaveLength(1);
  });
});

describe('store adoption stays consistent with staged sections', () => {
  afterEach(() => {
    useProjectHistoryStore.getState().hydrateFromSection(undefined);
  });

  it('adoptPersistedSection reflects exactly what a save persisted', async () => {
    const saved = await saveProjectDocument(buildDocument() as never);
    expect(useProjectHistoryStore.getState().records.map((record) => record.id))
      .toEqual(saved.projectHistory?.revisions.map((record) => record.id));
  });

  it('keeps session restore stacks across save adoption', async () => {
    await saveProjectDocument(buildDocument() as never);
    useProjectHistoryStore.getState().recordRestoreHop({ beforeId: 'x', afterId: 'y', label: 'hop' });
    await saveProjectDocument(buildDocument({ name: 'History Project 2' }) as never);

    expect(useProjectHistoryStore.getState().restoreUndo).toHaveLength(1);
  });
});

describe('stageProjectSaveRevision integration with sanitized documents', () => {
  it('stages on top of a sanitized document and survives a sanitize round trip', () => {
    const sanitized = sanitizeProjectDocument(buildDocument() as never);
    const staged = stageProjectSaveRevision(sanitized, { now: 5_000 });
    const resanitized = sanitizeProjectDocument(staged.document);

    expect(resanitized.projectHistory?.revisions).toHaveLength(1);
    expect(resanitized.projectHistory?.revisions[0]?.payloadChars)
      .toBe(staged.document.projectHistory?.revisions[0]?.payloadChars);
  });
});
