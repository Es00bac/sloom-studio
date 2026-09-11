import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { BUNDLED_PROVIDER_PACKS } from './bundledProviderPacks';
import {
  listNeedsRemappingEdges,
  migrateModelCardOperationEdges,
  resolveModelCardPorts,
} from './providerCardFlow';
import { hashProviderPack } from './providerPackPortability';

describe('adaptive model-card Flow contracts', () => {
  it('creates the exact number of stable field/slot handles for a 14-reference card', () => {
    const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.packId === 'sloom.bundled.atlas');
    const card = pack?.cards.find((candidate) => candidate.fields.some((field) =>
      field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
    ));
    expect(pack).toBeDefined();
    expect(card).toBeDefined();
    const field = card?.fields.find((candidate) => candidate.semanticRole === 'reference-image');
    const operation = card?.operations.find((candidate) => candidate.inputPortFieldIds.includes(field?.id ?? ''));
    expect(operation).toBeDefined();
    const node = {
      id: 'atlas-card',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        modelCardRef: {
          packId: pack?.packId,
          version: pack?.version,
          hash: hashProviderPack(pack!),
          cardId: card?.id,
        },
        modelCardOperationId: operation?.id,
      },
    } as AppNode;
    const ports = resolveModelCardPorts(node) ?? [];
    const references = ports.filter((port) => port.id?.startsWith(`model-card:${field?.id}:`));
    expect(references).toHaveLength(14);
    expect(references.map((port) => port.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `model-card:${field?.id}:${index}`),
    );
  });

  it('migrates compatible edges by semantic role and index', () => {
    const card = adaptiveCard();
    const edges: Edge[] = [{
      id: 'reference-2',
      source: 'image',
      sourceHandle: 'output',
      target: 'model',
      targetHandle: 'model-card:references-a:1',
    }];
    const migrated = migrateModelCardOperationEdges({
      nodeId: 'model',
      edges,
      card,
      previousOperationId: 'generate',
      nextOperationId: 'edit',
    });
    expect(migrated[0].targetHandle).toBe('model-card:references-b:1');
    expect(listNeedsRemappingEdges(migrated)).toHaveLength(0);
  });

  it('never silently deletes incompatible edges and leaves visible remapping stubs', () => {
    const card = adaptiveCard();
    const edges: Edge[] = [{
      id: 'reference-3',
      source: 'image',
      sourceHandle: 'output',
      target: 'model',
      targetHandle: 'model-card:references-a:2',
    }, {
      id: 'metadata',
      source: 'model',
      sourceHandle: 'model-card-output:metadata',
      target: 'viewer',
      targetHandle: 'input',
    }];
    const migrated = migrateModelCardOperationEdges({
      nodeId: 'model',
      edges,
      card,
      previousOperationId: 'generate',
      nextOperationId: 'edit',
    });
    expect(migrated).toHaveLength(edges.length);
    expect(listNeedsRemappingEdges(migrated)).toHaveLength(2);
    expect(listNeedsRemappingEdges(migrated).map((edge) => edge.data.modelCardRemap.message))
      .toEqual(expect.arrayContaining([
        expect.stringContaining('not accepted'),
        expect.stringContaining('not produced'),
      ]));
  });
});

function adaptiveCard() {
  return {
    schemaVersion: 1 as const,
    id: 'model:adaptive',
    modelId: 'adaptive',
    displayName: 'Adaptive',
    modalities: ['image' as const],
    fields: [{
      id: 'references-a',
      label: 'References',
      apiPath: 'references',
      semanticRole: 'reference-image' as const,
      valueType: 'image' as const,
      cardinality: 'many' as const,
      connectable: true,
      constraints: { maxItems: 3, visiblePortCount: 3 },
      operationIds: ['generate'],
    }, {
      id: 'references-b',
      label: 'Edit references',
      apiPath: 'edit_references',
      semanticRole: 'reference-image' as const,
      valueType: 'image' as const,
      cardinality: 'many' as const,
      connectable: true,
      constraints: { maxItems: 2, visiblePortCount: 2 },
      operationIds: ['edit'],
    }],
    outputs: [{
      id: 'image',
      label: 'Image',
      semanticRole: 'image-output' as const,
      resultType: 'image' as const,
      primary: true,
      cardinality: 'one' as const,
      operationIds: ['generate', 'edit'],
    }, {
      id: 'metadata',
      label: 'Metadata',
      semanticRole: 'metadata-output' as const,
      resultType: 'json' as const,
      cardinality: 'one' as const,
      operationIds: ['generate'],
    }],
    operations: [{
      id: 'generate',
      label: 'Generate',
      transportProfileId: 'route',
      requiredFieldIds: [],
      visibleFieldIds: ['references-a'],
      inputPortFieldIds: ['references-a'],
      outputIds: ['image', 'metadata'],
    }, {
      id: 'edit',
      label: 'Edit',
      transportProfileId: 'route',
      requiredFieldIds: [],
      visibleFieldIds: ['references-b'],
      inputPortFieldIds: ['references-b'],
      outputIds: ['image'],
    }],
    evidence: [],
    confidence: 'manual' as const,
    status: 'ready-untested' as const,
    layout: {
      schemaVersion: 1 as const,
      id: 'layout',
      width: 390,
      minWidth: 260,
      maxWidth: 1040,
      fitTarget: '1080p' as const,
      heightBudget: 900,
      containers: [],
      elements: [],
    },
  };
}
