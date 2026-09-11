// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { API_REQUESTER_PERSISTED_CREDENTIAL_MARKER } from './apiRequesterCredentials';
import {
  buildFlowNodePack,
  buildFlowNodePackFileName,
  buildFlowNodePackInsertPayload,
  getFlowNodePackBounds,
  parseFlowNodePack,
  resolveCollisionFreeNodePackPosition,
  serializeFlowNodePack,
  FLOW_NODE_PACK_FORMAT,
} from './flowNodePacks';

function makeNode(overrides: Partial<AppNode> & { id: string; type: AppNode['type'] }): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    selected: false,
    ...overrides,
  } as AppNode;
}

function selectionGraph(): { nodes: AppNode[]; edges: Edge[] } {
  const prompt = makeNode({
    id: 'textNode-source',
    type: 'textNode',
    selected: true,
    position: { x: 1000, y: 800 },
    data: {
      mode: 'prompt',
      prompt: 'A lantern-lit alley in the rain',
      isRunning: true,
      statusMessage: 'running',
      result: 'stale-runtime-blob',
      nodeInstanceId: 'instance-1',
      inputRevision: 'revision-1',
    },
  });
  const joiner = makeNode({
    id: 'promptsJoinerNode-join',
    type: 'promptsJoinerNode',
    selected: true,
    position: { x: 1480, y: 820 },
    data: { delimiter: ', ' },
  });
  const image = makeNode({
    id: 'imageGen-out',
    type: 'imageGen',
    selected: true,
    position: { x: 1960, y: 800 },
    data: {},
  });
  const unselected = makeNode({
    id: 'valueNode-other',
    type: 'valueNode',
    selected: false,
    position: { x: 0, y: 0 },
    data: { valueKind: 'number', value: 3 },
  });
  const edges: Edge[] = [
    { id: 'e1', source: 'textNode-source', target: 'promptsJoinerNode-join', sourceHandle: null, targetHandle: 'A' },
    { id: 'e2', source: 'promptsJoinerNode-join', target: 'imageGen-out', sourceHandle: null, targetHandle: null },
    { id: 'e-crossing', source: 'textNode-source', target: 'valueNode-other', sourceHandle: null, targetHandle: null },
  ];
  return { nodes: [prompt, joiner, image, unselected], edges };
}

describe('node pack export', () => {
  it('exports the selected subgraph with normalized positions and only internal edges', () => {
    const { nodes, edges } = selectionGraph();
    const result = buildFlowNodePack({ nodes, edges, name: '  Alley starter  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = result.value;
    expect(document.format).toBe(FLOW_NODE_PACK_FORMAT);
    expect(document.version).toBe(1);
    expect(document.pack.name).toBe('Alley starter');
    expect(document.pack.nodeCount).toBe(3);
    expect(document.pack.edgeCount).toBe(2);
    expect(document.nodes).toHaveLength(3);
    // Crossing edge to an unselected node is excluded.
    expect(document.edges.every((edge) => edge.source !== 'valueNode-other' && edge.target !== 'valueNode-other')).toBe(true);
    // Positions normalized to the selection top-left.
    const minX = Math.min(...document.nodes.map((node) => node.position.x));
    const minY = Math.min(...document.nodes.map((node) => node.position.y));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    // Pack-local ids replaced canvas ids.
    expect(document.nodes.some((node) => node.id === 'textNode-source')).toBe(false);
  });

  it('strips runtime and transient node-data keys from the exported document', () => {
    const { nodes, edges } = selectionGraph();
    const result = buildFlowNodePack({ nodes, edges, name: 'Runtime strip' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prompt = result.value.nodes.find((node) => node.type === 'textNode')!;
    expect(prompt.data.prompt).toBe('A lantern-lit alley in the rain');
    expect(prompt.data.isRunning).toBeUndefined();
    expect(prompt.data.statusMessage).toBeUndefined();
    expect(prompt.data.result).toBeUndefined();
    expect(prompt.data.nodeInstanceId).toBeUndefined();
    expect(prompt.data.inputRevision).toBeUndefined();
  });

  it('redacts API Requester credentials in headers, url, body, and model card values', () => {
    const api = makeNode({
      id: 'apiFetchNode-1',
      type: 'apiFetchNode',
      selected: true,
      position: { x: 0, y: 0 },
      data: {
        url: 'https://api.example.com/v1?api_key=super-secret&lang=en',
        method: 'GET',
        headers: 'Authorization: Bearer sk-live-123\nX-Api-Key: sk-live-456\nAccept: application/json',
        body: '{"query":"hello","token":"tok-1","nested":{"client_secret":"cs-2"}}',
        modelCardValues: { apiKey: 'mc-secret', mode: 'fast' },
      },
    });
    const result = buildFlowNodePack({ nodes: [api], edges: [], name: 'Cred pack' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.value.nodes[0].data;
    expect(data.url).toContain(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect(data.url).toContain('lang=en');
    expect(data.url).not.toContain('super-secret');
    expect(data.headers).toContain(`Authorization: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`);
    expect(data.headers).toContain(`X-Api-Key: ${API_REQUESTER_PERSISTED_CREDENTIAL_MARKER}`);
    expect(data.headers).toContain('Accept: application/json');
    expect(data.body).not.toContain('tok-1');
    expect(data.body).not.toContain('cs-2');
    expect(data.body).toContain('"query":"hello"');
    expect((data.modelCardValues as Record<string, unknown>).apiKey).toBe(API_REQUESTER_PERSISTED_CREDENTIAL_MARKER);
    expect((data.modelCardValues as Record<string, unknown>).mode).toBe('fast');
  });

  it('rejects empty names and empty selections', () => {
    const { nodes, edges } = selectionGraph();
    expect(buildFlowNodePack({ nodes, edges, name: '   ' }).ok).toBe(false);
    const emptied = nodes.map((node) => ({ ...node, selected: false }));
    const rejected = buildFlowNodePack({ nodes: emptied, edges, name: 'No selection' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain('Select at least one node');
  });

  it('derives a safe download file name', () => {
    expect(buildFlowNodePackFileName('My Cool: Pack/2')).toBe('My-Cool-Pack-2.sloompack');
    expect(buildFlowNodePackFileName('   ')).toBe('flow-node-pack.sloompack');
  });
});

describe('node pack import validation', () => {
  const roundTrip = (name: string) => {
    const { nodes, edges } = selectionGraph();
    const exported = buildFlowNodePack({ nodes, edges, name });
    if (!exported.ok) throw new Error(exported.reason);
    return parseFlowNodePack(serializeFlowNodePack(exported.value));
  };

  it('round trips an exported pack through serialize and parse', () => {
    const result = roundTrip('Alley starter');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pack.name).toBe('Alley starter');
    expect(result.value.nodes).toHaveLength(3);
    expect(result.value.edges).toHaveLength(2);
    const prompt = result.value.nodes.find((node) => node.type === 'textNode')!;
    expect(prompt.data.prompt).toBe('A lantern-lit alley in the rain');
    const joinerEdge = result.value.edges.find((edge) => edge.targetHandle === 'A');
    expect(joinerEdge).toBeDefined();
  });

  it('fails closed on non-pack JSON, wrong format, and wrong version', () => {
    expect(parseFlowNodePack('not json').ok).toBe(false);
    expect(parseFlowNodePack('{"hello":1}').ok).toBe(false);
    const wrongFormat = roundTrip('x');
    if (!wrongFormat.ok) throw new Error(wrongFormat.reason);
    const badFormat = { ...wrongFormat.value, format: 'other-format' };
    expect(parseFlowNodePack(JSON.stringify(badFormat)).ok).toBe(false);
    const badVersion = { ...wrongFormat.value, version: 99 };
    const rejected = parseFlowNodePack(JSON.stringify(badVersion));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain('version');
  });

  it('rejects unknown node types, dangling edges, self edges, and non-finite positions', () => {
    const base = roundTrip('hostile');
    if (!base.ok) throw new Error(base.reason);
    const document = base.value;

    const unknownType = JSON.stringify({ ...document, nodes: [{ ...document.nodes[0], type: 'trojanNode' }, ...document.nodes.slice(1)] });
    expect(parseFlowNodePack(unknownType).ok).toBe(false);

    const dangling = JSON.stringify({ ...document, edges: [...document.edges, { source: 'ghost', target: document.nodes[0].id }] });
    expect(parseFlowNodePack(dangling).ok).toBe(false);

    const selfEdge = JSON.stringify({ ...document, edges: [{ source: document.nodes[0].id, target: document.nodes[0].id }] });
    expect(parseFlowNodePack(selfEdge).ok).toBe(false);

    const badPosition = JSON.stringify({ ...document, nodes: [{ ...document.nodes[0], position: { x: 'left' } }, ...document.nodes.slice(1)] });
    expect(parseFlowNodePack(badPosition).ok).toBe(false);
  });

  it('rejects contract-violating edges with the live validation reason', () => {
    const base = roundTrip('bad contract');
    if (!base.ok) throw new Error(base.reason);
    const document = base.value;
    const image = document.nodes.find((node) => node.type === 'imageGen')!;
    const joiner = document.nodes.find((node) => node.type === 'promptsJoinerNode')!;
    // Joiner output (text) into the nonexistent handle is invalid.
    const invalid = JSON.stringify({
      ...document,
      edges: [{ source: joiner.id, target: image.id, sourceHandle: null, targetHandle: 'no-such-handle' }],
    });
    const rejected = parseFlowNodePack(invalid);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain('connection contract');
  });

  it('strips hostile runtime keys injected into an otherwise valid pack', () => {
    const base = roundTrip('hostile runtime');
    if (!base.ok) throw new Error(base.reason);
    const document = base.value;
    const injected = JSON.stringify({
      ...document,
      nodes: document.nodes.map((node) => ({ ...node, data: { ...node.data, isRunning: true, result: 'blob', nodeInstanceId: 'x' } })),
    });
    const parsed = parseFlowNodePack(injected);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const node of parsed.value.nodes) {
      expect(node.data.isRunning).toBeUndefined();
      expect(node.data.result).toBeUndefined();
      expect(node.data.nodeInstanceId).toBeUndefined();
    }
  });
});

describe('node pack installation payload', () => {
  it('builds an insertTemplate payload keyed to pack ids and regenerates portal pair ids', () => {
    const exported = buildFlowNodePack({
      nodes: [
        makeNode({
          id: 'portal-entry-1',
          type: 'portal',
          selected: true,
          position: { x: 0, y: 0 },
          data: { portalRole: 'entry', portalPairId: 'pair-original', portalLabel: 'Portal pair' },
        }),
        makeNode({
          id: 'portal-exit-1',
          type: 'portal',
          selected: true,
          position: { x: 400, y: 0 },
          data: { portalRole: 'exit', portalPairId: 'pair-original', portalLabel: 'Portal pair' },
        }),
        makeNode({
          id: 'textNode-a',
          type: 'textNode',
          selected: true,
          position: { x: 800, y: 0 },
          data: { mode: 'prompt', prompt: 'Through the portal' },
        }),
      ],
      edges: [],
      name: 'Portal pack',
    });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const first = buildFlowNodePackInsertPayload(exported.value);
    const second = buildFlowNodePackInsertPayload(exported.value);
    const firstPairs = first.nodes
      .filter((node) => node.type === 'portal')
      .map((node) => (node.data as { portalPairId: string }).portalPairId);
    const secondPairs = second.nodes
      .filter((node) => node.type === 'portal')
      .map((node) => (node.data as { portalPairId: string }).portalPairId);

    // One shared fresh pair id per install, different across installs.
    expect(new Set(firstPairs).size).toBe(1);
    expect(new Set(secondPairs).size).toBe(1);
    expect(firstPairs[0]).not.toBe('pair-original');
    expect(firstPairs[0]).not.toBe(secondPairs[0]);

    // Payload node ids match pack ids so edges resolve after store remap.
    const packIds = new Set(exported.value.nodes.map((node) => node.id));
    for (const node of first.nodes) {
      expect(packIds.has(node.id as string)).toBe(true);
    }
  });

  it('places pack installs collision-free and reports the pack footprint', () => {
    const { nodes, edges } = selectionGraph();
    const exported = buildFlowNodePack({ nodes, edges, name: 'Placement' });
    if (!exported.ok) throw new Error(exported.reason);
    const document = exported.value;

    const first = resolveCollisionFreeNodePackPosition(document, [], { x: 0, y: 0 });
    expect(first).toEqual({ x: 0, y: 0 });
    const bounds = getFlowNodePackBounds(document);
    expect(bounds.width).toBeGreaterThan(0);

    const asExisting = document.nodes.map((node) => ({ position: { x: first.x + node.position.x, y: first.y + node.position.y } }));
    const second = resolveCollisionFreeNodePackPosition(document, asExisting, { x: 0, y: 0 });
    const boxAt = (anchor: { x: number; y: number }, node: { position: { x: number; y: number } }) => ({
      x: anchor.x + node.position.x,
      y: anchor.y + node.position.y,
      width: 340,
      height: 280,
    });
    for (const node of document.nodes) {
      for (const other of document.nodes) {
        const a = boxAt(first, node);
        const b = boxAt(second, other);
        const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlaps).toBe(false);
      }
    }
  });
});
