import { describe, it, expect } from 'vitest';
import { sanitizeProjectDocument } from './projectValidation';
import {
  captureProjectReplacementAuthorization,
  restoreProjectDocument,
} from './projectDocumentActions';
import { useFlowStore } from '../store/flowStore';

const projectFixture = {
  schemaVersion: 3,
  id: 'worktree-safe-project-fixture',
  name: 'Worktree Safe Project Fixture',
  savedAt: 0,
  flow: {
    version: 3,
    nodes: [
      {
        id: 'fixture-text-node',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: {
          prompt: 'Describe a consistent production palette for this scene.',
        },
      },
    ],
    edges: [],
  },
};

function cloneProjectFixture(): typeof projectFixture {
  return JSON.parse(JSON.stringify(projectFixture));
}

describe('Frontend Parsing Test', () => {
  it('should parse a project fixture successfully', () => {
    const raw = cloneProjectFixture();
    const sanitized = sanitizeProjectDocument(raw);
    console.log('Frontend Nodes count:', sanitized.flow?.nodes?.length);
    console.log('Frontend Edges count:', sanitized.flow?.edges?.length);
    expect(sanitized.flow?.nodes?.length).toBeGreaterThan(0);
  });

  it('should restore a project fixture successfully without throwing', async () => {
    const raw = cloneProjectFixture();
    const authorization = captureProjectReplacementAuthorization();
    await restoreProjectDocument(raw, {
      imageAuthorization: authorization.image,
      paperAuthorization: authorization.paper,
    });
    console.log('Restored Nodes count:', useFlowStore.getState().nodes.length);
    console.log('Restored Edges count:', useFlowStore.getState().edges.length);
    expect(useFlowStore.getState().nodes.length).toBeGreaterThan(0);
  });
});
