import { describe, expect, it } from 'vitest';
import { FLOW_NODE_TYPES, type AppNode, type FlowNodeType, type NodeData } from '../types/flow';
import { FLOW_NODE_CATALOG_ENTRIES } from './nodeCatalog';
import { resolveFlowNodePorts } from './flowNodeContracts';
import {
  FLOW_RUNTIME_PORT_CAPABILITIES,
  getFlowRuntimePortEvidence,
} from './flowRuntimePortCapabilities';

function node(type: FlowNodeType, data: NodeData = {}): AppNode {
  return { id: `runtime-audit-${type}`, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function auditNode(type: FlowNodeType, data: NodeData = {}): AppNode {
  const initialData = FLOW_NODE_CATALOG_ENTRIES.find((entry) => entry.type === type)?.initialData ?? {};
  return node(type, { ...initialData, ...data });
}

function assertInputsHaveEvidence(current: AppNode): void {
  const ports = resolveFlowNodePorts({ node: current, nodes: [current], edges: [] })
    .filter((port) => port.direction === 'input');
  for (const port of ports) {
    const evidence = getFlowRuntimePortEvidence(current.type, port.id);
    expect(evidence, `${current.type}:${port.id ?? 'default'} has no independent runtime evidence`).toBeDefined();
    expect(evidence?.consumer).toMatch(/^(src\/|.+#)/);
    expect(evidence?.verification).toMatch(/^src\/.*\.test\.(?:ts|tsx)$/);
  }
}

describe('Flow runtime port capability inventory', () => {
  it('covers all 63 registered node types without contract-derived fallback entries', () => {
    expect(Object.keys(FLOW_RUNTIME_PORT_CAPABILITIES).sort()).toEqual([...FLOW_NODE_TYPES].sort());
  });

  it.each(FLOW_NODE_TYPES)('%s maps every default input handle to a runtime consumer and test', (type) => {
    assertInputsHaveEvidence(auditNode(type, type === 'textNode' ? { mode: 'generate' } : {}));
  });

  it('covers every port-changing dynamic variant', () => {
    const variants: AppNode[] = [
      auditNode('textNode', { mode: 'prompt' }),
      auditNode('textNode', { mode: 'generate', provider: 'huggingface', modelId: 'Qwen/Qwen3-4B-Thinking-2507' }),
      auditNode('audioGen', { audioGenerationMode: 'voiceChange' }),
      auditNode('portal', { portalRole: 'entry' }),
      auditNode('portal', { portalRole: 'exit' }),
      auditNode('logicNode', { operation: 'NOT' }),
      auditNode('composition', { compositionAudioTrackCount: 4, editorExportPresetPlan: { presetId: 'png-image-sequence' } }),
      auditNode('csvParserNode', { mode: 'format' }),
      auditNode('xmlYamlNode', { mode: 'json-to-yaml' }),
      auditNode('functionOutputNode', { functionPortType: 'any' }),
      auditNode('functionNode', {
        functionNode: {
          schemaVersion: 1,
          title: 'Audit function',
          description: '',
          contract: {
            id: 'audit-function',
            title: 'Audit function',
            inputPorts: [{ id: 'items', key: 'items', label: 'Items', resultType: 'list', required: true, allowMultiple: true, order: 0 }],
            outputPorts: [{ id: 'result', key: 'result', label: 'Result', resultType: 'text', required: true, order: 0 }],
            version: 1,
          },
          graph: { version: 1, nodes: [], edges: [] },
          inputBindings: [],
          outputBindings: [],
        },
      }),
    ];

    for (const variant of variants) assertInputsHaveEvidence(variant);
  });

  it('names focused behavioral coverage for every multi-type input', () => {
    for (const type of FLOW_NODE_TYPES) {
      const current = auditNode(type, type === 'textNode' ? { mode: 'generate' } : {});
      const ports = resolveFlowNodePorts({ node: current, nodes: [current], edges: [] })
        .filter((port) => port.direction === 'input' && port.types.length > 1);
      for (const port of ports) {
        const evidence = getFlowRuntimePortEvidence(type, port.id);
        expect(evidence?.verification, `${type}:${port.id ?? 'default'} multi-type input lacks a behavioral test`)
          .toMatch(/^src\/.*\.test\.(?:ts|tsx)$/);
      }
    }
  });
});
