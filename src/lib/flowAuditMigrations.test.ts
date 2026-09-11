import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode, ProviderSettings } from '../types/flow';
import { annotateFlowEdges } from './flowConnectionContracts';
import { getImageModelDefinition } from './imageProviderCapabilities';
import { getVertexProjectConfig } from './vertexProviderSettings';
import { computeVertexAuthStatus } from './vertex/vertexAuthStatus';

interface GraphFixture {
  nodes: AppNode[];
  edges: Edge[];
}

function fixture<T>(name: string): T {
  const url = new URL(`../test/fixtures/flow-audit/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

describe('Flow audit saved-project migrations', () => {
  it('round-trips a valid legacy edge and derives typed presentation without schema mutation', () => {
    const input = fixture<GraphFixture>('valid-typed-flow.json');
    const roundTripped = JSON.parse(JSON.stringify(input)) as GraphFixture;
    const edges = annotateFlowEdges(roundTripped.edges, roundTripped.nodes);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'number-to-math',
      type: 'typed',
      data: {
        flowContract: {
          valid: true,
          carriedType: { kind: 'number' },
          acceptedTypes: [{ kind: 'number' }],
        },
      },
    });
  });

  it('preserves an incompatible legacy edge and annotates the blocker instead of deleting it', () => {
    const input = fixture<GraphFixture>('invalid-legacy-edge.json');
    const edges = annotateFlowEdges(input.edges, input.nodes);

    expect(edges.map((edge) => edge.id)).toEqual(['legacy-text-to-number']);
    expect(edges[0].data?.flowContract).toMatchObject({
      valid: false,
      carriedType: { kind: 'text' },
      acceptedTypes: [{ kind: 'number' }],
      converterNodeTypes: ['javascriptNode'],
    });
    expect(String(edges[0].data?.flowContract && (edges[0].data.flowContract as { reason?: string }).reason))
      .toContain('text cannot connect to number');
  });

  it('keeps a shut-down saved model exact and explains the migration path', () => {
    const { node } = fixture<{ node: AppNode }>('legacy-model-selection.json');
    const model = getImageModelDefinition('gemini', node.data.modelId);

    expect(model.modelId).toBe('gemini-3.1-flash-image-preview');
    expect(model.lifecycle).toBe('shutdown');
    expect(model.availability).toBe('unavailable');
    expect(model.migrationModelId).toBe('gemini-3.1-flash-image');
  });

  it('keeps legacy encrypted Vertex settings usable by the cross-platform broker', () => {
    const settings = fixture<ProviderSettings>('legacy-vertex-settings.json');
    const project = getVertexProjectConfig(settings);

    expect(project).toMatchObject({
      projectId: 'fixture-project',
      location: 'us-central1',
      auth: {
        mode: 'gcloud-adc',
        quotaProjectId: 'fixture-quota',
        credentialJson: expect.stringContaining('authorized_user'),
      },
    });
    expect(computeVertexAuthStatus(settings, 'desktop')).toMatchObject({
      source: 'adc-json',
      configured: true,
      blockers: [],
    });
    expect(computeVertexAuthStatus(settings, 'mobile')).toMatchObject({
      source: 'adc-json',
      configured: true,
      blockers: [],
    });
  });
});
