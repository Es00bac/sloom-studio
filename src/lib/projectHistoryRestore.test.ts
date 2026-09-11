import { describe, expect, it } from 'vitest';
import type { FlowProjectDocument } from './projectLibrary';
import { stageProjectSaveRevision } from './projectHistory';
import {
  ProjectRevisionPayloadError,
  buildProjectRevisionBranchDocument,
  buildProjectRevisionRestoreDocument,
  parseProjectRevisionPayload,
} from './projectHistoryRestore';
import { sanitizeProjectDocument } from './projectValidation';

function buildProject(overrides: Partial<FlowProjectDocument> = {}): FlowProjectDocument {
  return sanitizeProjectDocument({
    id: 'project-1',
    name: 'Restore Source',
    savedAt: 1_000,
    flow: {
      version: 3,
      nodes: [{ id: 'node-current', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    },
    ...overrides,
  });
}

describe('parseProjectRevisionPayload', () => {
  it('fails closed with a typed error for corrupt JSON', () => {
    const record = {
      id: 'rev-bad',
      kind: 'save' as const,
      name: 'Bad',
      createdAt: 1,
      summary: { version: 1 as const, initial: true, sections: [] },
      payload: '{not json',
      payloadChars: 9,
    };
    expect(() => parseProjectRevisionPayload(record)).toThrowError(ProjectRevisionPayloadError);
  });

  it('fails closed with a typed error for invalid project content', () => {
    const record = {
      id: 'rev-invalid',
      kind: 'save' as const,
      name: 'Invalid',
      createdAt: 1,
      summary: { version: 1 as const, initial: true, sections: [] },
      payload: JSON.stringify({ id: 'x', name: 'x', flow: { version: 3, nodes: 'not-an-array', edges: [] } }),
      payloadChars: 10,
    };
    expect(() => parseProjectRevisionPayload(record)).toThrowError(/not a valid/);
  });
});

describe('buildProjectRevisionRestoreDocument', () => {
  it('reverts content while preserving project identity and history', () => {
    const oldState = buildProject({
      flow: {
        version: 3,
        nodes: [{ id: 'node-old', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
    });
    const staged = stageProjectSaveRevision(oldState, { now: 5_000 });
    const record = staged.document.projectHistory?.revisions[0];
    if (!record) throw new Error('expected a captured revision');

    const current = buildProject();
    const restored = buildProjectRevisionRestoreDocument(
      { ...current, projectHistory: staged.document.projectHistory },
      record,
    );

    expect(restored.id).toBe(current.id);
    expect(restored.flow.nodes.map((node) => node.id)).toEqual(['node-old']);
    expect(restored.projectHistory?.revisions.map((entry) => entry.id)).toEqual([record.id]);
  });

  it('restores a revision captured from an actually saved document', () => {
    const saved = stageProjectSaveRevision(buildProject(), { now: 5_000 }).document;
    const record = saved.projectHistory?.revisions[0];
    if (!record) throw new Error('expected a captured revision');

    const restored = buildProjectRevisionRestoreDocument(saved, record);
    expect(restored.flow.nodes.map((node) => node.id)).toEqual(['node-current']);
  });
});

describe('buildProjectRevisionBranchDocument', () => {
  it('creates a fresh project with provenance and no nested revisions', () => {
    const saved = stageProjectSaveRevision(buildProject(), { now: 5_000 }).document;
    const record = saved.projectHistory?.revisions[0];
    if (!record) throw new Error('expected a captured revision');

    const branch = buildProjectRevisionBranchDocument(saved, record, { now: 7_000 });

    expect(branch.id).not.toBe(saved.id);
    expect(branch.name).toContain('Restore Source');
    expect(branch.name).toContain(record.name);
    expect(branch.projectHistory?.revisions).toHaveLength(0);
    expect(branch.projectHistory?.branchedFrom).toMatchObject({
      projectId: saved.id,
      revisionId: record.id,
      branchedAt: 7_000,
    });
    expect(branch.flow.nodes.map((node) => node.id)).toEqual(['node-current']);
  });

  it('never overwrites the source document', () => {
    const saved = stageProjectSaveRevision(buildProject(), { now: 5_000 }).document;
    const record = saved.projectHistory?.revisions[0];
    if (!record) throw new Error('expected a captured revision');

    buildProjectRevisionBranchDocument(saved, record, { now: 7_000 });

    expect(saved.projectHistory?.revisions).toHaveLength(1);
    expect(saved.id).toBe('project-1');
  });
});
