import { describe, expect, it } from 'vitest';
import { summarizeProjectRow, type FlowProjectDocument } from './projectLibrary';

function buildRow(overrides: Partial<FlowProjectDocument> = {}): FlowProjectDocument {
  return {
    schemaVersion: 1,
    id: 'project-1',
    name: 'Project One',
    savedAt: 1_000,
    flow: { version: 3, nodes: [], edges: [] },
    ...overrides,
  };
}

describe('project library summary resilience', () => {
  it('retains row metadata when one project measurement throws', () => {
    const summary = summarizeProjectRow(buildRow(), () => {
      throw new Error('measurement failure');
    });

    expect(summary).toMatchObject({
      id: 'project-1',
      name: 'Project One',
      savedAt: 1_000,
      nodeCount: 0,
    });
    expect(summary.sizeReport).toBeUndefined();
  });

  it('keeps a corrupt saved row listable when its flow nodes cannot be read', () => {
    const hostileFlow = {
      version: 3,
      edges: [],
      get nodes() {
        throw new Error('corrupt flow nodes');
      },
    } as unknown as FlowProjectDocument['flow'];

    const summary = summarizeProjectRow(buildRow({ flow: hostileFlow }));

    expect(summary).toMatchObject({
      id: 'project-1',
      name: 'Project One',
      savedAt: 1_000,
      nodeCount: 0,
      sizeReport: { documentBytes: 0, truncated: true },
    });
  });
});
