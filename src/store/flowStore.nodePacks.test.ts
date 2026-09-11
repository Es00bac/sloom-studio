// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { validateFlowConnection } from '../lib/flowConnectionContracts';
import {
  buildFlowNodePack,
  buildFlowNodePackInsertPayload,
  parseFlowNodePack,
  resolveCollisionFreeNodePackPosition,
  serializeFlowNodePack,
} from '../lib/flowNodePacks';

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

describe('flow store node-pack installation (MH-097)', () => {
  let useFlowStore: Awaited<typeof import('./flowStore')>['useFlowStore'];

  const buildSelection = (): { nodes: AppNode[]; edges: Edge[] } => {
    const prompt: AppNode = {
      id: 'textNode-src',
      type: 'textNode',
      position: { x: 40, y: 40 },
      selected: true,
      data: { mode: 'prompt', prompt: 'Neon koi pond at midnight', nodeInstanceId: 'inst-src', inputRevision: 'rev-src' },
    };
    const image: AppNode = {
      id: 'imageGen-dst',
      type: 'imageGen',
      position: { x: 520, y: 20 },
      selected: true,
      data: {},
    };
    const bystander: AppNode = {
      id: 'valueNode-bystander',
      type: 'valueNode',
      position: { x: 0, y: 900 },
      selected: false,
      data: { valueKind: 'number', value: 7 },
    };
    return {
      nodes: [prompt, image, bystander],
      edges: [
        { id: 'keep', source: 'textNode-src', target: 'imageGen-dst', sourceHandle: null, targetHandle: null },
        { id: 'drop', source: 'textNode-src', target: 'valueNode-bystander', sourceHandle: null, targetHandle: null },
      ],
    };
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

  const installPack = (
    canvasNodes: AppNode[],
    anchor: { x: number; y: number },
    options?: { select?: boolean },
  ) => {
    const { nodes, edges } = buildSelection();
    const exported = buildFlowNodePack({ nodes, edges, name: 'Koi pack' });
    if (!exported.ok) throw new Error(exported.reason);
    const document = parseFlowNodePack(serializeFlowNodePack(exported.value));
    if (!document.ok) throw new Error(document.reason);
    const position = resolveCollisionFreeNodePackPosition(document.value, canvasNodes, anchor);
    useFlowStore.getState().insertTemplate(buildFlowNodePackInsertPayload(document.value), position, options);
    return document.value;
  };

  it('installs an exported pack onto a live canvas with valid contracts and authored data', () => {
    const document = installPack([], { x: 100, y: 100 });
    const state = useFlowStore.getState();
    expect(state.nodes).toHaveLength(document.pack.nodeCount);
    expect(state.edges).toHaveLength(document.pack.edgeCount);

    const prompt = state.nodes.find((node) => node.type === 'textNode');
    expect(prompt?.data.prompt).toBe('Neon koi pond at midnight');
    // The store assigned fresh runtime identities (export stripped the originals).
    expect(prompt?.data.nodeInstanceId).not.toBe('inst-src');
    for (const node of state.nodes) {
      expect(typeof node.data.nodeInstanceId).toBe('string');
    }
    for (const edge of state.edges) {
      const validation = validateFlowConnection(edge, { nodes: state.nodes, edges: state.edges });
      expect(validation.valid, validation.reason).toBe(true);
    }
  });

  it('installs two copies of the same pack without node-box overlap and with distinct identities', () => {
    installPack([], { x: 200, y: 200 });
    const afterFirst = [...useFlowStore.getState().nodes];
    installPack(afterFirst, { x: 200, y: 200 });
    const afterSecond = useFlowStore.getState();

    expect(afterSecond.nodes).toHaveLength(afterFirst.length * 2);
    const secondBatch = afterSecond.nodes.filter((node) => !afterFirst.some((existing) => existing.id === node.id));
    expect(secondBatch).toHaveLength(afterFirst.length);

    const box = { width: 340, height: 280 };
    for (const a of afterFirst) {
      for (const b of secondBatch) {
        const overlaps = a.position.x < b.position.x + box.width
          && b.position.x < a.position.x + box.width
          && a.position.y < b.position.y + box.height
          && b.position.y < a.position.y + box.height;
        expect(overlaps).toBe(false);
      }
    }
    const identities = new Set(afterSecond.nodes.map((node) => node.data.nodeInstanceId));
    expect(identities.size).toBe(afterSecond.nodes.length);
  });

  it('performs installation as a single store update so Flow history snapshots it atomically', () => {
    let updates = 0;
    const unsubscribe = useFlowStore.subscribe(() => {
      updates += 1;
    });
    installPack([], { x: 0, y: 0 });
    unsubscribe();
    expect(updates).toBe(1);
    expect(useFlowStore.getState().nodes.length).toBeGreaterThan(0);
  });

  it('survives the project snapshot save/reopen round trip after installation', () => {
    installPack([], { x: 60, y: 60 });
    const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
    const ids = snapshot.nodes.map((node) => node.id);

    useFlowStore.setState({ nodes: [], edges: [] });
    useFlowStore.getState().replaceFlowSnapshot(snapshot);
    const after = useFlowStore.getState();
    expect(after.nodes.map((node) => node.id)).toEqual(ids);
    const prompt = after.nodes.find((node) => node.type === 'textNode');
    expect(prompt?.data.prompt).toBe('Neon koi pond at midnight');
    for (const edge of after.edges) {
      expect(validateFlowConnection(edge, { nodes: after.nodes, edges: after.edges }).valid).toBe(true);
    }
  });

  it('selects exactly the newly-installed nodes and edges when asked, replacing any prior selection (Faye Rowan P2: no highlight after import)', () => {
    const bystander: AppNode = {
      id: 'valueNode-existing',
      type: 'valueNode',
      position: { x: -400, y: -400 },
      selected: true,
      data: { valueKind: 'number', value: 1 },
    };
    useFlowStore.setState({ nodes: [bystander], edges: [] });

    const document = installPack([bystander], { x: 300, y: 300 }, { select: true });
    const state = useFlowStore.getState();

    const existing = state.nodes.find((node) => node.id === 'valueNode-existing');
    expect(existing?.selected).toBe(false);

    const installedNodes = state.nodes.filter((node) => node.id !== 'valueNode-existing');
    expect(installedNodes).toHaveLength(document.pack.nodeCount);
    for (const node of installedNodes) {
      expect(node.selected).toBe(true);
    }
    for (const edge of state.edges) {
      expect(edge.selected).toBe(true);
    }
  });

  it('leaves selection untouched when installation does not request it (starter-template insert path, MH-094)', () => {
    const bystander: AppNode = {
      id: 'valueNode-existing',
      type: 'valueNode',
      position: { x: -400, y: -400 },
      selected: true,
      data: { valueKind: 'number', value: 1 },
    };
    useFlowStore.setState({ nodes: [bystander], edges: [] });

    installPack([bystander], { x: 300, y: 300 });
    const state = useFlowStore.getState();

    const existing = state.nodes.find((node) => node.id === 'valueNode-existing');
    expect(existing?.selected).toBe(true);
    const installedNodes = state.nodes.filter((node) => node.id !== 'valueNode-existing');
    for (const node of installedNodes) {
      expect(node.selected).toBeFalsy();
    }
  });

  it('never lets an invalid pack reach the canvas', () => {
    const invalid = JSON.stringify({ format: 'sloom-flow-node-pack', version: 1, pack: { name: 'Bad' }, nodes: [{ id: 'x', type: 'trojan', position: { x: 0, y: 0 } }], edges: [] });
    const parsed = parseFlowNodePack(invalid);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('unknown node type');
    expect(useFlowStore.getState().nodes).toHaveLength(0);
  });
});
