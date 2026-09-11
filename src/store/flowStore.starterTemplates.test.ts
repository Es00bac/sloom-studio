// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { validateFlowConnection } from '../lib/flowConnectionContracts';
import { collectFlowDiagnostics } from '../lib/flowDiagnostics';
import {
  FLOW_STARTER_TEMPLATES,
  buildStarterTemplateInsertPayload,
  getFlowStarterTemplate,
  resolveCollisionFreeTemplatePosition,
} from '../lib/flowStarterTemplates';

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('flow store starter-template instantiation (MH-094)', () => {
  let useFlowStore: Awaited<typeof import('./flowStore')>['useFlowStore'];

  const insertTemplateById = (templateId: string, position: { x: number; y: number }) => {
    const template = getFlowStarterTemplate(templateId)!;
    useFlowStore.getState().insertTemplate(buildStarterTemplateInsertPayload(template), position);
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      localStorage: makeMemoryStorage(),
      removeEventListener: vi.fn(),
    });
    ({ useFlowStore } = await import('./flowStore'));
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it('instantiates every starter template with all nodes, edges, and authored data', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      useFlowStore.setState({ nodes: [], edges: [] });
      insertTemplateById(template.id, { x: 100, y: 80 });

      const state = useFlowStore.getState();
      expect(state.nodes).toHaveLength(template.nodes.length);
      expect(state.edges).toHaveLength(template.edges.length);

      // Authored data patches survive initial-data merge (spot-check one prompt node).
      const promptNode = template.nodes.find((node) => node.type === 'textNode' && typeof node.data?.prompt === 'string');
      if (promptNode) {
        const inserted = state.nodes.find((node) => node.type === 'textNode' && node.data.prompt === promptNode.data?.prompt);
        expect(inserted).toBeDefined();
      }

      // Every inserted node gets a fresh runtime identity (no template key collisions).
      const identities = new Set(state.nodes.map((node) => node.data.nodeInstanceId));
      expect(identities.size).toBe(template.nodes.length);
      // Positions honor the insertion anchor.
      for (const node of state.nodes) {
        expect(node.position.x).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('inserts graphs whose every edge satisfies the live typed connection contract', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      useFlowStore.setState({ nodes: [], edges: [] });
      insertTemplateById(template.id, { x: 0, y: 0 });

      const state = useFlowStore.getState();
      for (const edge of state.edges) {
        const validation = validateFlowConnection(edge, { nodes: state.nodes, edges: state.edges });
        expect(
          validation.valid,
          `${template.id}: edge ${edge.source} -> ${edge.target} (${edge.sourceHandle} -> ${edge.targetHandle}): ${validation.reason ?? ''}`,
        ).toBe(true);
      }
      const diagnostics = collectFlowDiagnostics(state.nodes, state.edges);
      expect(
        diagnostics.filter((diagnostic) => diagnostic.blocksRun),
        `${template.id} should not introduce run-blocking diagnostics`,
      ).toEqual([]);
    }
  });

  it('places a second identical template insert without node-box overlap on the canvas', () => {
    const template = getFlowStarterTemplate('prompt-builder')!;
    const first = resolveCollisionFreeTemplatePosition(template, [], { x: 300, y: 200 });
    insertTemplateById('prompt-builder', first);
    const afterFirst = useFlowStore.getState().nodes;

    const second = resolveCollisionFreeTemplatePosition(template, afterFirst, { x: 300, y: 200 });
    insertTemplateById('prompt-builder', second);
    const afterSecond = useFlowStore.getState();

    expect(afterSecond.nodes).toHaveLength(template.nodes.length * 2);
    const box = { width: 340, height: 280 };
    const firstBoxes = afterFirst.map((node) => ({ ...node.position, ...box }));
    const secondBoxes = afterSecond.nodes
      .filter((node) => !afterFirst.some((existing) => existing.id === node.id))
      .map((node) => ({ ...node.position, ...box }));
    expect(secondBoxes).toHaveLength(template.nodes.length);
    for (const a of firstBoxes) {
      for (const b of secondBoxes) {
        const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps).toBe(false);
      }
    }

    // Edges from both copies resolve against their own copy's nodes.
    const nodeIds = new Set(afterSecond.nodes.map((node) => node.id));
    for (const edge of afterSecond.edges as Edge[]) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('performs insertion as a single store update so Flow history can snapshot it atomically', () => {
    let updates = 0;
    const unsubscribe = useFlowStore.subscribe(() => {
      updates += 1;
    });
    insertTemplateById('text-to-image', { x: 10, y: 10 });
    unsubscribe();
    expect(updates).toBe(1);
    expect(useFlowStore.getState().nodes).toHaveLength(2);
  });

  it('survives the project snapshot save/reopen round trip with ids, edges, and authored data intact', () => {
    insertTemplateById('palette-consistency', { x: 120, y: 90 });

    const before = useFlowStore.getState();
    const snapshot = before.exportProjectFlowSnapshot();
    const snapshotNodeIds = snapshot.nodes.map((node) => node.id);
    const snapshotEdgeTuples = snapshot.edges.map((edge) => `${edge.source}->${edge.target}:${edge.targetHandle ?? ''}`);

    // Reopen into a fresh canvas (the same path project open uses).
    useFlowStore.setState({ nodes: [], edges: [] });
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    useFlowStore.getState().replaceFlowSnapshot(snapshot);

    const after = useFlowStore.getState();
    expect(after.nodes.map((node) => node.id)).toEqual(snapshotNodeIds);
    expect(after.edges.map((edge) => `${edge.source}->${edge.target}:${edge.targetHandle ?? ''}`)).toEqual(snapshotEdgeTuples);

    const palette = after.nodes.find((node) => node.type === 'colorSwatchNode');
    expect(palette?.data.colorSwatchColors).toEqual(['#243b53', '#7ab6ff', '#ffd57a']);

    // The reopened graph still passes the live connection contract.
    for (const edge of after.edges) {
      expect(validateFlowConnection(edge, { nodes: after.nodes, edges: after.edges }).valid).toBe(true);
    }
  });

  it('exports instantiated templates through the persisted Flow JSON document', () => {
    insertTemplateById('local-calculator', { x: 0, y: 0 });
    const exported = JSON.parse(useFlowStore.getState().exportFlow()) as { nodes: AppNode[]; edges: Edge[] };
    expect(exported.nodes).toHaveLength(4);
    expect(exported.edges).toHaveLength(3);
    const valueA = exported.nodes.find((node) => node.data.valueKind === 'number' && node.data.value === 24);
    expect(valueA).toBeDefined();
  });
});
