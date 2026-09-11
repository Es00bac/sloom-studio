import { describe, expect, it } from 'vitest';
import type { FlowProjectDocument } from './projectLibrary';
import {
  PROJECT_HISTORY_MAX_NAME_CHARS,
  PROJECT_HISTORY_MAX_REVISIONS,
  buildProjectRevisionContent,
  buildProjectRevisionChangeSummary,
  compactProjectRevisionName,
  deleteProjectRevisionRecord,
  describeProjectRevisionChangeSummary,
  projectHistoryTotalPayloadChars,
  renameProjectRevisionRecord,
  sanitizeProjectHistorySection,
  stageProjectManualSnapshot,
  stageProjectSaveRevision,
} from './projectHistory';

function buildProject(overrides: Partial<FlowProjectDocument> = {}): FlowProjectDocument {
  return {
    schemaVersion: 1,
    id: 'project-1',
    name: 'Test Project',
    savedAt: 1_000,
    flow: { version: 3, nodes: [], edges: [] },
    ...overrides,
  };
}

function buildProjectWithNodes(nodeIds: string[]): FlowProjectDocument {
  return buildProject({
    flow: {
      version: 3,
      nodes: nodeIds.map((id) => ({ id, type: 'textNode', position: { x: 0, y: 0 }, data: {} })),
      edges: [],
    },
  });
}

describe('buildProjectRevisionContent', () => {
  it('strips the history section and volatile save metadata', () => {
    const content = buildProjectRevisionContent(buildProject({
      fileSystem: { projectDirectoryName: 'dir' },
      projectHistory: { version: 1, revisions: [] },
    }));

    expect('projectHistory' in content).toBe(false);
    expect('savedAt' in content).toBe(false);
    expect('fileSystem' in content).toBe(false);
    expect(content.id).toBe('project-1');
    expect(content.name).toBe('Test Project');
  });
});

describe('buildProjectRevisionChangeSummary', () => {
  it('is deterministic for identical inputs regardless of key insertion order', () => {
    const before = buildProjectRevisionContent(buildProjectWithNodes(['a', 'b']));
    const after = buildProjectRevisionContent(buildProjectWithNodes(['b', 'c', 'd']));

    const first = buildProjectRevisionChangeSummary(before, after);
    const second = buildProjectRevisionChangeSummary(
      JSON.parse(JSON.stringify(before)),
      JSON.parse(JSON.stringify(after)),
    );

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('reports count changes and identity diffs per section', () => {
    const before = buildProjectRevisionContent(buildProjectWithNodes(['a', 'b']));
    const after = buildProjectRevisionContent(buildProjectWithNodes(['b', 'c', 'd']));

    const summary = buildProjectRevisionChangeSummary(before, after);
    const flowNodes = summary.sections.find((entry) => entry.section === 'flow.nodes');

    expect(summary.initial).toBe(false);
    expect(flowNodes).toMatchObject({ before: 2, after: 3, added: 2, removed: 1 });
  });

  it('marks the first capture as initial', () => {
    const summary = buildProjectRevisionChangeSummary(undefined, buildProjectRevisionContent(buildProjectWithNodes(['a'])));
    expect(summary.initial).toBe(true);
    expect(summary.sections.find((entry) => entry.section === 'flow.nodes')?.before).toBe(0);
  });

  it('records project name changes and describes them deterministically', () => {
    const before = buildProjectRevisionContent(buildProject({ name: 'Old' }));
    const after = buildProjectRevisionContent(buildProject({ name: 'New' }));
    const summary = buildProjectRevisionChangeSummary(before, after);

    expect(summary.name).toEqual({ from: 'Old', to: 'New' });
    expect(describeProjectRevisionChangeSummary(summary)).toEqual([
      'Project name: "Old" → "New".',
    ]);
  });
});

describe('stageProjectSaveRevision', () => {
  it('captures the first save as an initial revision inside the returned document', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });

    expect(staged.revision).not.toBeNull();
    expect(staged.revision?.kind).toBe('save');
    expect(staged.revision?.summary.initial).toBe(true);
    expect(staged.document.projectHistory?.revisions).toHaveLength(1);
    expect(staged.document.projectHistory?.revisions[0]?.payloadChars).toBeGreaterThan(0);
  });

  it('skips capture when the content is unchanged', () => {
    const first = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const second = stageProjectSaveRevision(first.document, { now: 6_000 });

    expect(second.revision).toBeNull();
    expect(second.skippedReason).toBe('unchanged');
    expect(second.document.projectHistory?.revisions).toHaveLength(1);
  });

  it('captures a new revision when the content changes and summarizes the diff', () => {
    const first = stageProjectSaveRevision(buildProjectWithNodes(['a']), { now: 5_000 });
    const second = stageProjectSaveRevision(
      { ...buildProjectWithNodes(['a', 'b']), projectHistory: first.document.projectHistory },
      { now: 6_000 },
    );

    expect(second.revision).not.toBeNull();
    expect(second.revision?.summary.initial).toBe(false);
    expect(second.document.projectHistory?.revisions).toHaveLength(2);
    expect(second.document.projectHistory?.revisions[1]?.summary.sections.find((s) => s.section === 'flow.nodes'))
      .toMatchObject({ before: 1, after: 2, added: 1, removed: 0 });
  });

  it('skips capture deterministically when the payload exceeds the per-revision budget', () => {
    const huge = buildProject({ name: 'x'.repeat(9 * 1024 * 1024) });
    const staged = stageProjectSaveRevision(huge);

    expect(staged.revision).toBeNull();
    expect(staged.skippedReason).toBe('payload-too-large');
    expect(staged.document.projectHistory).toBeUndefined();
  });

  it('evicts the oldest automatic revisions first at the record cap', () => {
    let document = buildProject();
    for (let index = 0; index < PROJECT_HISTORY_MAX_REVISIONS + 3; index += 1) {
      const staged = stageProjectSaveRevision(
        { ...buildProjectWithNodes([`node-${index}`]), projectHistory: document.projectHistory },
        { now: 5_000 + index },
      );
      document = staged.document;
    }

    const revisions = document.projectHistory?.revisions ?? [];
    expect(revisions).toHaveLength(PROJECT_HISTORY_MAX_REVISIONS);
    // The three oldest captures (indices 0–2) were evicted; the newest capture is retained.
    expect(revisions[0]?.createdAt).toBe(5_000 + 3);
    expect(revisions[revisions.length - 1]?.createdAt).toBe(5_000 + PROJECT_HISTORY_MAX_REVISIONS + 2);
  });

  it('never evicts the revision that was just appended', () => {
    let document = buildProject();
    for (let index = 0; index < PROJECT_HISTORY_MAX_REVISIONS + 1; index += 1) {
      const staged = stageProjectSaveRevision(
        { ...buildProjectWithNodes([`node-${index}`]), projectHistory: document.projectHistory },
        { now: 5_000 + index },
      );
      document = staged.document;
    }
    const revisions = document.projectHistory?.revisions ?? [];
    expect(revisions).toHaveLength(PROJECT_HISTORY_MAX_REVISIONS);
    expect(revisions[revisions.length - 1]?.createdAt).toBe(5_000 + PROJECT_HISTORY_MAX_REVISIONS);
    expect(revisions[revisions.length - 1]?.summary.sections.find((s) => s.section === 'flow.nodes')?.after)
      .toBe(1);
  });
});

describe('stageProjectManualSnapshot', () => {
  it('records a named snapshot with a compacted name', () => {
    const staged = stageProjectManualSnapshot(buildProject(), '   Milestone   one  ', { now: 5_000 });

    expect(staged.revision?.kind).toBe('manual');
    expect(staged.revision?.name).toBe('Milestone one');
    expect(staged.document.projectHistory?.revisions).toHaveLength(1);
  });

  it('compacts and caps provided names', () => {
    const staged = stageProjectManualSnapshot(buildProject(), 'x'.repeat(500), { now: 5_000 });
    expect(staged.revision?.name.length).toBe(PROJECT_HISTORY_MAX_NAME_CHARS);
  });

  it('throws a typed limit error when the project exceeds the payload budget', () => {
    const huge = buildProject({ name: 'x'.repeat(9 * 1024 * 1024) });
    expect(() => stageProjectManualSnapshot(huge, 'Big'))
      .toThrowError(expect.objectContaining({ name: 'ProjectHistoryLimitError', limit: 'payload' }));
  });

  it('evicts automatic revisions before manual ones under the count cap', () => {
    let document = buildProject();
    for (let index = 0; index < PROJECT_HISTORY_MAX_REVISIONS; index += 1) {
      document = stageProjectSaveRevision(
        { ...buildProjectWithNodes([`auto-${index}`]), projectHistory: document.projectHistory },
        { now: 5_000 + index },
      ).document;
    }
    const manual = stageProjectManualSnapshot(
      { ...buildProjectWithNodes(['manual-only']), projectHistory: document.projectHistory },
      'Keep me',
      { now: 90_000 },
    );

    const revisions = manual.document.projectHistory?.revisions ?? [];
    expect(revisions).toHaveLength(PROJECT_HISTORY_MAX_REVISIONS);
    expect(revisions.some((record) => record.kind === 'manual' && record.name === 'Keep me')).toBe(true);
    // The oldest auto saves were evicted; the newest auto save is retained.
    expect(revisions[0]?.kind).toBe('save');
    expect(revisions[0]?.createdAt).toBeGreaterThan(5_000);
  });
});

describe('rename and delete', () => {
  it('renames a revision and stamps renamedAt', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const records = staged.document.projectHistory?.revisions ?? [];
    const renamed = renameProjectRevisionRecord(records, records[0].id, '  Renamed  ', 7_000);

    expect(renamed?.[0]).toMatchObject({ name: 'Renamed', renamedAt: 7_000 });
    expect(renameProjectRevisionRecord(records, 'missing', 'Nope')).toBeNull();
  });

  it('deletes exactly the requested revision', () => {
    const first = stageProjectSaveRevision(buildProjectWithNodes(['a']), { now: 5_000 });
    const second = stageProjectSaveRevision(
      { ...buildProjectWithNodes(['a', 'b']), projectHistory: first.document.projectHistory },
      { now: 6_000 },
    );

    const records = second.document.projectHistory?.revisions ?? [];
    expect(records).toHaveLength(2);
    const afterDelete = deleteProjectRevisionRecord(records, records[0].id);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete?.[0].id).toBe(records[1].id);
    expect(deleteProjectRevisionRecord(records, 'missing')).toBeNull();
  });
});

describe('sanitizeProjectHistorySection', () => {
  it('returns no section for non-record input and unsupported versions', () => {
    expect(sanitizeProjectHistorySection(undefined).section).toBeUndefined();
    expect(sanitizeProjectHistorySection('nope').section).toBeUndefined();
    expect(sanitizeProjectHistorySection({ version: 2, revisions: [] }).section).toBeUndefined();
  });

  it('keeps valid records and drops corrupt ones deterministically', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const record = staged.document.projectHistory?.revisions[0];
    const dropped = sanitizeProjectHistorySection({
      version: 1,
      revisions: [
        { id: 'bad-kind', kind: 'weird', name: 'x', createdAt: 1, summary: record?.summary, payload: '{}' },
        { id: 'bad-payload', kind: 'save', name: 'x', createdAt: 1, summary: record?.summary, payload: '' },
        { id: 'bad-summary', kind: 'save', name: 'x', createdAt: 1, summary: { version: 9 }, payload: '{}' },
        record,
      ],
    });

    expect(dropped.section?.revisions.map((entry) => entry.id)).toEqual([record?.id]);
    expect(dropped.droppedCount).toBe(3);
  });

  it('drops records whose payload exceeds the per-record budget', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const record = staged.document.projectHistory?.revisions[0];
    const oversized = { ...record, payload: 'x'.repeat(9 * 1024 * 1024) };
    const result = sanitizeProjectHistorySection({ version: 1, revisions: [oversized, record] });

    expect(result.section?.revisions.map((entry) => entry.id)).toEqual([record?.id]);
    expect(result.droppedCount).toBe(1);
  });

  it('enforces the count cap by retaining the newest records', () => {
    const revisions = Array.from({ length: PROJECT_HISTORY_MAX_REVISIONS + 4 }, (_, index) => ({
      id: `rev-${index}`,
      kind: 'save' as const,
      name: `Auto save ${index + 1}`,
      createdAt: index,
      summary: { version: 1 as const, initial: true, sections: [] },
      payload: JSON.stringify({ id: 'project-1', name: `n${index}` }),
      payloadChars: 40,
    }));
    const result = sanitizeProjectHistorySection({ version: 1, revisions });

    expect(result.section?.revisions).toHaveLength(PROJECT_HISTORY_MAX_REVISIONS);
    expect(result.section?.revisions[0]?.id).toBe('rev-4');
    expect(result.droppedCount).toBe(4);
  });

  it('round-trips a staged section through sanitize without loss', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const roundTripped = sanitizeProjectHistorySection(
      JSON.parse(JSON.stringify(staged.document.projectHistory)),
    );

    expect(roundTripped.section).toEqual(staged.document.projectHistory);
    expect(roundTripped.droppedCount).toBe(0);
  });

  it('preserves branch provenance when it is well formed', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const section = {
      ...staged.document.projectHistory,
      branchedFrom: {
        projectId: 'p0',
        projectName: 'Origin',
        revisionId: 'r0',
        revisionName: 'Seed',
        branchedAt: 4_000,
      },
    };
    const result = sanitizeProjectHistorySection(JSON.parse(JSON.stringify(section)));
    expect(result.section?.branchedFrom).toEqual(section.branchedFrom);
  });
});

describe('compactProjectRevisionName', () => {
  it('collapses whitespace, trims, caps length, and falls back', () => {
    expect(compactProjectRevisionName('  a   b  ')).toBe('a b');
    expect(compactProjectRevisionName('   ')).toBe('Snapshot');
    expect(compactProjectRevisionName('y'.repeat(200)).length).toBe(PROJECT_HISTORY_MAX_NAME_CHARS);
  });
});

describe('projectHistoryTotalPayloadChars', () => {
  it('sums record payload sizes', () => {
    const staged = stageProjectSaveRevision(buildProject(), { now: 5_000 });
    const records = staged.document.projectHistory?.revisions ?? [];
    expect(projectHistoryTotalPayloadChars(records)).toBe(records[0].payloadChars);
  });
});
