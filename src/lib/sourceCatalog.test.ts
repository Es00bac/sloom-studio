// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT,
  SOURCE_CATALOG_MAX_PROJECTS,
  SOURCE_CATALOG_MAX_SEARCH_RESULTS,
  buildSourceCatalogProjectRecord,
  deriveSourceCatalogEntries,
  deriveSourceCatalogLineage,
  parsePersistedSourceCatalog,
  searchSourceCatalog,
  upsertSourceCatalogProjectRecord,
  type SourceCatalogProjectRecord,
  type SourceCatalogRecordInput,
} from './sourceCatalog';
import type { SourceBinProjectSnapshot } from '../store/sourceBinStore';

function snapshot(items: Array<Record<string, unknown>>): SourceBinProjectSnapshot {
  return {
    bins: [{ id: 'bin-1', name: 'Bin', items: items as never, collapsed: false, createdAt: 1 }],
    dismissedSourceKeys: [],
  };
}

function recordInput(overrides: Partial<SourceCatalogRecordInput> = {}): SourceCatalogRecordInput {
  return {
    projectId: 'project-a',
    projectName: 'Project A',
    savedAt: 1000,
    snapshot: snapshot([
      {
        id: 'item-1',
        label: 'Hero render',
        kind: 'image',
        mimeType: 'image/png',
        createdAt: 900,
        sourceKey: 'source:hero',
        isGenerated: true,
        pixelWidth: 1024,
        pixelHeight: 768,
      },
      { id: 'item-2', label: 'Voice take', kind: 'audio', createdAt: 950, sourceKey: 'source:voice' },
      { id: 'item-2', label: 'Duplicate id', kind: 'text', createdAt: 999 },
      { label: 'Missing id', kind: 'text', createdAt: 999 },
      { id: 'item-3', kind: 'text', createdAt: 999, label: '' },
    ]),
    ...overrides,
  };
}

describe('deriveSourceCatalogEntries', () => {
  it('derives metadata-only entries and drops invalid or duplicate items', () => {
    const entries = deriveSourceCatalogEntries(recordInput().snapshot);
    expect(entries.map((entry) => entry.itemId)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(entries[0]).toEqual({
      itemId: 'item-1',
      label: 'Hero render',
      kind: 'image',
      mimeType: 'image/png',
      createdAt: 900,
      sourceKey: 'source:hero',
      originNodeId: undefined,
      originWorkspaceId: undefined,
      isGenerated: true,
      pixelWidth: 1024,
      pixelHeight: 768,
      starred: undefined,
    });
    expect(entries[2].label).toBe('Untitled item');
    // Metadata only: no asset bytes, URLs, or text content ever enter an entry.
    expect(JSON.stringify(entries)).not.toContain('assetUrl');
    expect(JSON.stringify(entries)).not.toMatch(/"text":/);
  });

  it('returns empty for a missing snapshot', () => {
    expect(deriveSourceCatalogEntries(undefined)).toEqual([]);
  });
});

describe('buildSourceCatalogProjectRecord', () => {
  it('caps entries per project and marks the record truncated', () => {
    const many = Array.from({ length: SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT + 25 }, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
      kind: 'text',
      createdAt: index,
    }));
    const record = buildSourceCatalogProjectRecord({
      projectId: 'p',
      projectName: 'P',
      savedAt: 5,
      snapshot: snapshot(many),
    });
    expect(record.entries).toHaveLength(SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT);
    expect(record.truncated).toBe(true);
  });
});

describe('upsertSourceCatalogProjectRecord', () => {
  it('refreshes an existing project while keeping its earliest first-seen time', () => {
    const first = buildSourceCatalogProjectRecord({ ...recordInput(), savedAt: 1000 });
    const second = buildSourceCatalogProjectRecord({
      ...recordInput(),
      savedAt: 2000,
      snapshot: snapshot([{ id: 'item-9', label: 'Newer', kind: 'image', createdAt: 1500 }]),
    });
    const updated = upsertSourceCatalogProjectRecord([first], second);
    expect(updated).toHaveLength(1);
    expect(updated[0].lastSavedAt).toBe(2000);
    expect(updated[0].firstRecordedAt).toBe(1000);
    expect(updated[0].entries.map((entry) => entry.itemId)).toEqual(['item-9']);
  });

  it('keeps the most recently saved projects and drops beyond the retention cap', () => {
    let records: SourceCatalogProjectRecord[] = [];
    for (let index = 0; index < SOURCE_CATALOG_MAX_PROJECTS + 5; index += 1) {
      const record = buildSourceCatalogProjectRecord({
        projectId: `project-${index}`,
        projectName: `Project ${index}`,
        savedAt: index,
        snapshot: snapshot([]),
      });
      records = upsertSourceCatalogProjectRecord(records, record);
    }
    expect(records).toHaveLength(SOURCE_CATALOG_MAX_PROJECTS);
    expect(records[0].projectId).toBe(`project-${SOURCE_CATALOG_MAX_PROJECTS + 4}`);
    // The five oldest projects were dropped.
    expect(records.some((record) => record.projectId === 'project-0')).toBe(false);
  });
});

describe('deriveSourceCatalogLineage', () => {
  it('links identical source keys across different projects only', () => {
    const recordA = buildSourceCatalogProjectRecord({ ...recordInput(), projectId: 'a', projectName: 'A', savedAt: 1 });
    const recordB = buildSourceCatalogProjectRecord({
      ...recordInput(),
      projectId: 'b',
      projectName: 'B',
      savedAt: 2,
      snapshot: snapshot([
        { id: 'b-1', label: 'Same hero', kind: 'image', createdAt: 5, sourceKey: 'source:hero' },
      ]),
    });
    const lineage = deriveSourceCatalogLineage([recordA, recordB]);
    expect(lineage).toEqual([{ sourceKey: 'source:hero', projectIds: ['a', 'b'] }]);
  });
});

describe('searchSourceCatalog', () => {
  const recordA = buildSourceCatalogProjectRecord({ ...recordInput(), savedAt: 2000 });
  const recordB = buildSourceCatalogProjectRecord({
    ...recordInput(),
    projectId: 'project-b',
    projectName: 'Project B',
    savedAt: 1000,
    snapshot: snapshot([
      { id: 'b-hero', label: 'Hero render', kind: 'image', createdAt: 500, sourceKey: 'source:hero' },
      { id: 'b-note', label: 'Notes', kind: 'text', createdAt: 400 },
    ]),
  });
  const records = [recordA, recordB];

  it('filters by text, project, kind, and generated origin', () => {
    expect(searchSourceCatalog(records, { text: 'hero' }).results.map((r) => r.entry.itemId).sort())
      .toEqual(['b-hero', 'item-1']);
    expect(searchSourceCatalog(records, { projectId: 'project-b' }).results.map((r) => r.entry.itemId))
      .toEqual(['b-hero', 'b-note']);
    expect(searchSourceCatalog(records, { kind: 'audio' }).results.map((r) => r.entry.itemId))
      .toEqual(['item-2']);
    expect(searchSourceCatalog(records, { generated: true }).results.map((r) => r.entry.itemId))
      .toEqual(['item-1']);
    expect(searchSourceCatalog(records, { generated: false }).results.map((r) => r.entry.itemId).sort())
      .toEqual(['b-hero', 'b-note', 'item-2', 'item-3']);
  });

  it('sorts by project save recency and reports same-source lineage as alsoIn', () => {
    const outcome = searchSourceCatalog(records, { text: 'hero' });
    expect(outcome.results[0].record.projectId).toBe('project-a');
    const heroInB = outcome.results.find((r) => r.entry.itemId === 'b-hero')!;
    expect(heroInB.alsoInProjectIds).toEqual(['project-a']);
    const heroInA = outcome.results.find((r) => r.entry.itemId === 'item-1')!;
    expect(heroInA.alsoInProjectIds).toEqual(['project-b']);
  });

  it('caps results and reports the full match count with a truncated flag', () => {
    const many = Array.from({ length: SOURCE_CATALOG_MAX_SEARCH_RESULTS + 10 }, (_, index) => ({
      id: `item-${index}`,
      label: `Render ${index}`,
      kind: 'image',
      createdAt: index,
    }));
    const dense = [buildSourceCatalogProjectRecord({
      projectId: 'dense',
      projectName: 'Dense',
      savedAt: 1,
      snapshot: snapshot(many),
    })];
    const outcome = searchSourceCatalog(dense, {});
    expect(outcome.results).toHaveLength(SOURCE_CATALOG_MAX_SEARCH_RESULTS);
    expect(outcome.totalMatches).toBe(SOURCE_CATALOG_MAX_SEARCH_RESULTS + 10);
    expect(outcome.truncated).toBe(true);
  });
});

describe('parsePersistedSourceCatalog', () => {
  it('parses valid records and drops structurally invalid ones', () => {
    const valid = buildSourceCatalogProjectRecord(recordInput());
    const parsed = parsePersistedSourceCatalog([
      valid,
      { projectId: '', projectName: 'No id', firstRecordedAt: 1, lastSavedAt: 1, entries: [] },
      { projectId: 'bad-entries', projectName: 'Bad entries', firstRecordedAt: 1, lastSavedAt: 2, entries: [{ itemId: 'x' }] },
      'nonsense',
    ]);
    expect(parsed.map((record) => record.projectId).sort()).toEqual(['bad-entries', 'project-a']);
    expect(parsed.find((record) => record.projectId === 'bad-entries')!.entries).toEqual([]);
  });

  it('fails closed to an empty catalogue for a non-array payload', () => {
    expect(parsePersistedSourceCatalog({ records: [] })).toEqual([]);
    expect(parsePersistedSourceCatalog(undefined)).toEqual([]);
    expect(parsePersistedSourceCatalog(null)).toEqual([]);
  });

  it('keeps only the most recent record for a duplicated project id', () => {
    const older = buildSourceCatalogProjectRecord({ ...recordInput(), savedAt: 1 });
    const newer = buildSourceCatalogProjectRecord({
      ...recordInput(),
      savedAt: 2,
      snapshot: snapshot([{ id: 'n-1', label: 'New', kind: 'text', createdAt: 2 }]),
    });
    const parsed = parsePersistedSourceCatalog([older, newer]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].lastSavedAt).toBe(2);
  });
});
