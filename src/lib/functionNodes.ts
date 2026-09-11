import type { Edge, XYPosition } from '@xyflow/react';
import type {
  AppNode,
  DynamicValue,
  FunctionBoundaryLink,
  FunctionInputBinding,
  FunctionNodeOutput,
  FunctionNodeConfig,
  FunctionOutputBinding,
  FunctionPortKind,
  FunctionTransformStep,
  FunctionValueKind,
  GroupNodeConfig,
  NodeData,
  ResultType,
} from '../types/flow';
import { FUNCTION_NODE_SCHEMA_VERSION } from '../types/flow';
import { NonRetryableError } from './exponentialBackoff';
import { resolveFlowNodePort } from './flowNodeContracts';
import { evaluateNodeSignal } from './flowSignals';

type IdFactory = (prefix: string) => string;

export interface FlowClipboardPayload {
  version: 1;
  nodes: AppNode[];
  edges: Edge[];
  bounds: Bounds;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CollapseFunctionInput {
  nodes: AppNode[];
  edges: Edge[];
  createId: IdFactory;
  title?: string;
}

interface CollapseFunctionResult {
  functionNode: AppNode;
  nextNodes: AppNode[];
  nextEdges: Edge[];
}

interface CollapseSelection {
  internalNodes: AppNode[];
  internalIds: Set<string>;
  removeIds: Set<string>;
  titleNodes: AppNode[];
}

interface BoundaryEdgeGroup {
  key: string;
  edges: Edge[];
  port: FunctionPortKind;
}

interface PasteFlowClipboardInput {
  clipboard: FlowClipboardPayload | null;
  existingNodes: AppNode[];
  existingEdges: Edge[];
  position: XYPosition;
  createId: IdFactory;
}

interface PasteFlowClipboardResult {
  nodes: AppNode[];
  edges: Edge[];
  nextNodes: AppNode[];
  nextEdges: Edge[];
}

const RUNTIME_NODE_DATA_KEYS = new Set([
  'onChange',
  'onRun',
  'onSelectAttempt',
  'isRunning',
  'retryState',
  'error',
  'statusMessage',
]);

export function createDefaultFunctionNodeConfig(title = 'Reusable function'): FunctionNodeConfig {
  const contractId = slugifyIdentifier(title) || 'function';
  const inputPorts: FunctionPortKind[] = [
    {
      id: 'input-flow',
      key: 'flow_input',
      label: 'Flow Input',
      resultType: 'any',
      required: false,
      order: 0,
    },
    {
      id: 'input-constant',
      key: 'constant_value',
      label: 'Constant',
      resultType: 'any',
      required: false,
      order: 1,
    },
    {
      id: 'input-expression',
      key: 'expression_value',
      label: 'Expression',
      resultType: 'any',
      required: false,
      order: 2,
    },
  ];
  const outputPorts: FunctionPortKind[] = [
    {
      id: 'output-result',
      key: 'result',
      label: 'Result',
      resultType: 'any',
      required: true,
      order: 0,
    },
  ];

  return {
    schemaVersion: FUNCTION_NODE_SCHEMA_VERSION,
    title,
    contract: {
      id: contractId,
      title,
      inputPorts,
      outputPorts,
      version: 1,
    },
    graph: {
      version: 1,
      nodes: [],
      edges: [],
    },
    inputBindings: [
      {
        id: 'binding-flow',
        targetInputPortId: inputPorts[0].id,
        source: {
          mode: 'flow',
          sourceType: 'nodeOutput',
        },
        transforms: [],
        resultType: 'any',
        missing: { strategy: 'default', value: '' },
      },
      {
        id: 'binding-constant',
        targetInputPortId: inputPorts[1].id,
        source: {
          mode: 'constant',
          valueType: 'string',
          value: '',
        },
        transforms: [],
        resultType: 'any',
        missing: { strategy: 'default', value: '' },
      },
      {
        id: 'binding-expression',
        targetInputPortId: inputPorts[2].id,
        source: {
          mode: 'expression',
          language: 'mustache',
          expression: '{{flow.input.flow_input}}',
        },
        transforms: [],
        resultType: 'any',
        missing: { strategy: 'default', value: '' },
      },
    ],
    outputBindings: [
      {
        id: 'binding-output',
        targetOutputPortId: outputPorts[0].id,
        sourceNodeId: '',
        transforms: [],
        resultType: 'any',
        missing: { strategy: 'default', value: '' },
      },
    ],
    lastRunRuntime: {
      result: 'idle',
      lastRunAt: 0,
      nodeCount: 0,
      edgeCount: 0,
    },
  };
}

export function createGroupNodeConfig(input: {
  title?: string;
  childNodeIds: string[];
  childEdgeIds: string[];
  bounds: Bounds;
}): GroupNodeConfig {
  return {
    title: input.title ?? 'Group',
    childNodeIds: [...input.childNodeIds],
    childEdgeIds: [...input.childEdgeIds],
    bounds: { ...input.bounds },
    collapsed: false,
    color: '#38bdf8',
  };
}

export function applyFunctionTransforms(value: DynamicValue, transforms: FunctionTransformStep[]): DynamicValue {
  return transforms.reduce<DynamicValue>((current, step) => {
    switch (step.kind) {
      case 'identity':
        return current;
      case 'defaultValue':
        return isEmptyValue(current) ? valueFromStep(step, 'value') : current;
      case 'ifEmpty':
        return isEmptyValue(current) ? valueFromStep(step, 'fallback') : current;
      case 'trim':
        return valueToString(current).trim();
      case 'toText':
        return valueToString(current);
      case 'toNumber': {
        const parsed = Number(valueToString(current).trim());
        return Number.isFinite(parsed) ? parsed : 0;
      }
      case 'toBoolean':
        return valueToBoolean(current);
      case 'toJson':
        return parseJsonValue(current);
      case 'coalesce':
        return current ?? '';
      case 'prefix':
      case 'prepend':
        return `${textFromStep(step, 'text')}${valueToString(current)}`;
      case 'suffix':
      case 'append':
        return `${valueToString(current)}${textFromStep(step, 'text')}`;
      case 'replace':
        return valueToString(current).split(textFromStep(step, 'find')).join(textFromStep(step, 'replacement'));
      case 'regexReplace':
        return regexReplace(current, step);
      case 'slice': {
        const count = numberFromStep(step, 'count');
        return Array.isArray(current) ? current.slice(0, count) : valueToString(current).slice(0, count);
      }
      case 'split':
        return valueToString(current).split(textFromStep(step, 'text') || ',');
      case 'join':
        return Array.isArray(current) ? current.map(valueToString).join(textFromStep(step, 'text') || ', ') : valueToString(current);
      case 'take':
        return Array.isArray(current)
          ? current.slice(0, numberFromStep(step, 'count'))
          : valueToString(current).slice(0, numberFromStep(step, 'count'));
      case 'drop':
        return Array.isArray(current)
          ? current.slice(numberFromStep(step, 'count'))
          : valueToString(current).slice(numberFromStep(step, 'count'));
      case 'template':
        return renderTemplate(textFromStep(step, 'template'), { value: current });
      case 'case':
        return applyCase(valueToString(current), textFromStep(step, 'when'));
      case 'jsonPath':
      case 'pick': {
        const picked = readPath(current, textFromStep(step, 'path'));
        return picked === undefined ? valueFromStep(step, 'fallback') : picked;
      }
      case 'set':
        return readPath(current, textFromStep(step, 'sourcePath')) ?? current;
      case 'map':
      case 'filter':
        return current;
      default:
        return current;
    }
  }, value);
}

export function serializeFlowSelection(nodes: AppNode[], edges: Edge[]): FlowClipboardPayload | null {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const bounds = getNodeBounds(selectedNodes);

  return {
    version: 1,
    nodes: selectedNodes.map(clonePersistableNode),
    edges: selectedEdges.map(cloneEdge),
    bounds,
  };
}

export function pasteFlowClipboard(input: PasteFlowClipboardInput): PasteFlowClipboardResult {
  const { clipboard, existingNodes, existingEdges, position, createId } = input;
  if (!clipboard || clipboard.nodes.length === 0) {
    return { nodes: [], edges: [], nextNodes: existingNodes, nextEdges: existingEdges };
  }

  const idMap = new Map<string, string>();
  const anchor = {
    x: clipboard.bounds.x + clipboard.bounds.width / 2,
    y: clipboard.bounds.y + clipboard.bounds.height / 2,
  };

  const nodes = clipboard.nodes.map((node) => {
    const nextId = createId(String(node.type ?? 'node'));
    idMap.set(node.id, nextId);
    return {
      ...clonePersistableNode(node),
      id: nextId,
      selected: true,
      position: {
        x: position.x + (node.position.x - anchor.x),
        y: position.y + (node.position.y - anchor.y),
      },
    } satisfies AppNode;
  });

  const edges = clipboard.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) {
      return [];
    }
    return [{
      ...cloneEdge(edge),
      id: createId('edge'),
      source,
      target,
    }];
  });

  return {
    nodes,
    edges,
    nextNodes: [
      ...existingNodes.map((node) => ({ ...node, selected: false })),
      ...nodes,
    ],
    nextEdges: [...existingEdges, ...edges],
  };
}

export function buildCollapsedFunctionNode(input: CollapseFunctionInput): CollapseFunctionResult | null {
  const selection = resolveCollapseSelection(input.nodes);
  if (!selection) {
    return null;
  }

  const { internalNodes, internalIds, removeIds, titleNodes } = selection;
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const bounds = getNodeBounds(internalNodes);
  const internalEdges = input.edges.filter((edge) => internalIds.has(edge.source) && internalIds.has(edge.target));
  const incomingBoundaryEdges = input.edges.filter((edge) => !internalIds.has(edge.source) && internalIds.has(edge.target));
  const outgoingBoundaryEdges = input.edges.filter((edge) => internalIds.has(edge.source) && !internalIds.has(edge.target));
  const functionNodeId = input.createId('functionNode');
  const title = input.title ?? deriveFunctionTitle(titleNodes);
  const config = createDefaultFunctionNodeConfig(title);

  // Check for explicit markers inside the selection
  const markerInputNodes = internalNodes.filter((node) => node.type === 'functionInputNode');
  const markerOutputNodes = internalNodes.filter((node) => node.type === 'functionOutputNode');
  const hasMarkers = markerInputNodes.length > 0 || markerOutputNodes.length > 0;

  let inputPorts: FunctionPortKind[] = [];
  let outputPorts: FunctionPortKind[] = [];
  const inputBoundaryLinks: FunctionBoundaryLink[] = [];
  const outputBoundaryLinks: FunctionBoundaryLink[] = [];
  const inputBindings: FunctionInputBinding[] = [];
  const outputBindings: FunctionOutputBinding[] = [];
  const nextEdges: Edge[] = [];

  if (hasMarkers) {
    // 1. Build input ports from functionInputNode markers
    const markerInputIds = new Set(markerInputNodes.map((n) => n.id));
    const incomingEdgeByMarkerId = new Map<string, Edge[]>();
    for (const edge of incomingBoundaryEdges) {
      if (markerInputIds.has(edge.target)) {
        const arr = incomingEdgeByMarkerId.get(edge.target) || [];
        arr.push(edge);
        incomingEdgeByMarkerId.set(edge.target, arr);
      }
    }

    markerInputNodes.forEach((node, index) => {
      const portLabel = typeof node.data.functionPortLabel === 'string' ? node.data.functionPortLabel : (typeof node.data.customTitle === 'string' ? node.data.customTitle : `Input Port ${index + 1}`);
      const portKey = typeof node.data.functionPortKey === 'string' ? node.data.functionPortKey : slugifyIdentifier(portLabel);
      const portType = typeof node.data.functionPortType === 'string' ? node.data.functionPortType : 'any';
      const portId = `input-marker-${node.id}`;

      const port: FunctionPortKind = {
        id: portId,
        key: portKey,
        label: titleCaseLabel(humanizeIdentifier(portKey)),
        resultType: portType as FunctionValueKind,
        required: false,
        order: index,
      };
      inputPorts.push(port);

      // Create a boundary link targeting the marker node itself
      inputBoundaryLinks.push({
        id: `input-boundary-${node.id}`,
        edgeId: '',
        portId: portId,
        internalNodeId: node.id,
        internalHandle: undefined,
      });

      // Reroute external edges targeting this marker node
      const extEdges = incomingEdgeByMarkerId.get(node.id) || [];
      for (const extEdge of extEdges) {
        nextEdges.push({
          ...cloneEdge(extEdge),
          id: input.createId('edge'),
          target: functionNodeId,
          targetHandle: portId,
        });
      }

      inputBindings.push({
        id: `input-binding-${portId}`,
        targetInputPortId: portId,
        source: {
          mode: 'flow',
          sourceType: 'nodeInput',
          sourceHandle: portId,
          sourceVariable: portKey,
        },
        transforms: [],
        resultType: port.resultType,
        missing: { strategy: 'default', value: '' },
      });
    });

    // 2. Build output ports from functionOutputNode markers
    const markerOutputIds = new Set(markerOutputNodes.map((n) => n.id));
    const outgoingEdgeByMarkerId = new Map<string, Edge[]>();
    for (const edge of outgoingBoundaryEdges) {
      if (markerOutputIds.has(edge.source)) {
        const arr = outgoingEdgeByMarkerId.get(edge.source) || [];
        arr.push(edge);
        outgoingEdgeByMarkerId.set(edge.source, arr);
      }
    }

    markerOutputNodes.forEach((node, index) => {
      const portLabel = typeof node.data.functionPortLabel === 'string' ? node.data.functionPortLabel : (typeof node.data.customTitle === 'string' ? node.data.customTitle : `Output Port ${index + 1}`);
      const portKey = typeof node.data.functionPortKey === 'string' ? node.data.functionPortKey : slugifyIdentifier(portLabel);
      const portType = typeof node.data.functionPortType === 'string' ? node.data.functionPortType : 'any';
      const portId = `output-marker-${node.id}`;

      const port: FunctionPortKind = {
        id: portId,
        key: portKey,
        label: titleCaseLabel(humanizeIdentifier(portKey)),
        resultType: portType as FunctionValueKind,
        required: false,
        order: index,
      };
      outputPorts.push(port);

      // Create boundary link
      outputBoundaryLinks.push({
        id: `output-boundary-${node.id}`,
        edgeId: '',
        portId: portId,
        internalNodeId: node.id,
        internalHandle: undefined,
      });

      // Reroute external edges starting from this marker node
      const extEdges = outgoingEdgeByMarkerId.get(node.id) || [];
      for (const extEdge of extEdges) {
        nextEdges.push({
          ...cloneEdge(extEdge),
          id: input.createId('edge'),
          source: functionNodeId,
          sourceHandle: portId,
        });
      }

      outputBindings.push({
        id: `output-binding-${portId}`,
        targetOutputPortId: portId,
        sourceNodeId: node.id,
        sourceHandle: undefined,
        transforms: [],
        resultType: port.resultType,
        missing: { strategy: 'default', value: '' },
      });
    });

    // Handle any non-marker boundary crossings robustly so connections aren't lost
    const unmappedIncomingEdges = incomingBoundaryEdges.filter((edge) => !markerInputIds.has(edge.target));
    if (unmappedIncomingEdges.length > 0) {
      const fallbackIncomingGroups = groupBoundaryEdges(unmappedIncomingEdges, (edge) => `${edge.source}::${edge.sourceHandle ?? ''}`, (edge, index) => {
        const sourceNode = nodesById.get(edge.source);
        return createBoundaryPort({
          idPrefix: 'input',
          edge,
          keySource: buildBoundaryPortLabel(sourceNode, edge.sourceHandle ?? edge.targetHandle ?? edge.source),
          index: inputPorts.length + index,
          resultType: inferNodeResultType(sourceNode),
        });
      });

      for (const group of fallbackIncomingGroups) {
        inputPorts.push(group.port);
        inputBoundaryLinks.push(...group.edges.map((edge) => ({
          id: `input-boundary-${edge.id}`,
          edgeId: edge.id,
          portId: group.port.id,
          internalNodeId: edge.target,
          internalHandle: edge.targetHandle ?? undefined,
          externalNodeId: edge.source,
          externalHandle: edge.sourceHandle ?? undefined,
        })));
        inputBindings.push({
          id: `input-binding-${group.port.id}`,
          targetInputPortId: group.port.id,
          source: {
            mode: 'flow',
            sourceType: 'nodeInput',
            sourceHandle: group.port.id,
            sourceVariable: group.port.key,
          },
          transforms: [],
          resultType: group.port.resultType,
          missing: { strategy: 'default', value: group.port.defaultValue ?? '' },
        });

        const firstEdge = group.edges[0];
        nextEdges.push({
          ...cloneEdge(firstEdge),
          id: input.createId('edge'),
          target: functionNodeId,
          targetHandle: group.port.id,
        });
      }
    }

    const unmappedOutgoingEdges = outgoingBoundaryEdges.filter((edge) => !markerOutputIds.has(edge.source));
    if (unmappedOutgoingEdges.length > 0) {
      const fallbackOutgoingGroups = groupBoundaryEdges(unmappedOutgoingEdges, (edge) => `${edge.source}::${edge.sourceHandle ?? ''}`, (edge, index) => {
        const sourceNode = nodesById.get(edge.source);
        return createBoundaryPort({
          idPrefix: 'output',
          edge,
          keySource: buildBoundaryPortLabel(sourceNode, edge.sourceHandle ?? edge.targetHandle ?? edge.source),
          index: outputPorts.length + index,
          resultType: inferNodeResultType(sourceNode),
        });
      });

      for (const group of fallbackOutgoingGroups) {
        outputPorts.push(group.port);
        outputBoundaryLinks.push(...group.edges.map((edge) => ({
          id: `output-boundary-${edge.id}`,
          edgeId: edge.id,
          portId: group.port.id,
          internalNodeId: edge.source,
          internalHandle: edge.sourceHandle ?? undefined,
          externalNodeId: edge.target,
          externalHandle: edge.targetHandle ?? undefined,
        })));
        outputBindings.push({
          id: `output-binding-${group.port.id}`,
          targetOutputPortId: group.port.id,
          sourceNodeId: group.edges[0].source,
          sourceHandle: group.edges[0].sourceHandle ?? undefined,
          transforms: [],
          resultType: group.port.resultType,
          missing: { strategy: 'default', value: group.port.defaultValue ?? '' },
        });

        for (const extEdge of group.edges) {
          nextEdges.push({
            ...cloneEdge(extEdge),
            id: input.createId('edge'),
            source: functionNodeId,
            sourceHandle: group.port.id,
          });
        }
      }
    }

    config.contract.inputPorts = inputPorts;
    config.contract.outputPorts = outputPorts;
    config.graph = {
      version: 1,
      nodes: internalNodes.map(clonePersistableNode),
      edges: internalEdges.map(cloneEdge),
      inputBoundaryLinks,
      outputBoundaryLinks,
      bounds,
    };
    config.inputBindings = inputBindings;
    config.outputBindings = outputBindings;

    // Preserving external edges not touching any internal node (pure external edges)
    const internalOrRemoveIds = new Set([...internalIds, ...removeIds]);
    for (const edge of input.edges) {
      if (!internalOrRemoveIds.has(edge.source) && !internalOrRemoveIds.has(edge.target)) {
        nextEdges.push(edge);
      }
    }

  } else {
    // Normal group collapse with direct crossovers (no marker nodes)
    const inputGroups = groupBoundaryEdges(incomingBoundaryEdges, (edge) => `${edge.source}::${edge.sourceHandle ?? ''}`, (edge, index) => {
      const sourceNode = nodesById.get(edge.source);
      return createBoundaryPort({
        idPrefix: 'input',
        edge,
        keySource: buildBoundaryPortLabel(sourceNode, edge.sourceHandle ?? edge.targetHandle ?? edge.source),
        index,
        resultType: inferNodeResultType(sourceNode),
      });
    });
    const outputGroups = groupBoundaryEdges(outgoingBoundaryEdges, (edge) => `${edge.source}::${edge.sourceHandle ?? ''}`, (edge, index) => {
      const sourceNode = nodesById.get(edge.source);
      return createBoundaryPort({
        idPrefix: 'output',
        edge,
        keySource: buildBoundaryPortLabel(sourceNode, edge.sourceHandle ?? edge.targetHandle ?? edge.source),
        index,
        resultType: inferNodeResultType(sourceNode),
      });
    });

    inputPorts = inputGroups.map((group) => group.port);
    outputPorts = outputGroups.map((group) => group.port);

    config.contract.inputPorts = inputPorts;
    config.contract.outputPorts = outputPorts;
    config.graph = {
      version: 1,
      nodes: internalNodes.map(clonePersistableNode),
      edges: internalEdges.map(cloneEdge),
      inputBoundaryLinks: inputGroups.flatMap((group) => group.edges.map((edge) => ({
        id: `input-boundary-${edge.id}`,
        edgeId: edge.id,
        portId: group.port.id,
        internalNodeId: edge.target,
        internalHandle: edge.targetHandle ?? undefined,
        externalNodeId: edge.source,
        externalHandle: edge.sourceHandle ?? undefined,
      }))),
      outputBoundaryLinks: outputGroups.flatMap((group) => group.edges.map((edge) => ({
        id: `output-boundary-${edge.id}`,
        edgeId: edge.id,
        portId: group.port.id,
        internalNodeId: edge.source,
        internalHandle: edge.sourceHandle ?? undefined,
        externalNodeId: edge.target,
        externalHandle: edge.targetHandle ?? undefined,
      }))),
      bounds,
    };
    config.inputBindings = inputGroups.map(({ port }) => {
      return {
        id: `input-binding-${port.id}`,
        targetInputPortId: port.id,
        source: {
          mode: 'flow',
          sourceType: 'nodeInput',
          sourceHandle: port.id,
          sourceVariable: port.key,
        },
        transforms: [],
        resultType: port.resultType,
        missing: { strategy: 'default', value: port.defaultValue ?? '' },
      };
    });
    config.outputBindings = outputGroups.map(({ port, edges }) => {
      const edge = edges[0];
      return {
        id: `output-binding-${port.id}`,
        targetOutputPortId: port.id,
        sourceNodeId: edge.source,
        sourceHandle: edge.sourceHandle ?? undefined,
        transforms: [],
        resultType: port.resultType,
        missing: { strategy: 'default', value: port.defaultValue ?? '' },
      };
    });

    const inputGroupByEdgeId = new Map(inputGroups.flatMap((group) => group.edges.map((edge) => [edge.id, group] as const)));
    const outputPortByEdgeId = new Map(outputGroups.flatMap((group) => group.edges.map((edge) => [edge.id, group.port] as const)));
    const emittedInputGroupKeys = new Set<string>();

    input.edges.forEach((edge) => {
      if (internalIds.has(edge.source) && internalIds.has(edge.target)) {
        return;
      }
      if (!internalIds.has(edge.source) && internalIds.has(edge.target)) {
        const group = inputGroupByEdgeId.get(edge.id);
        if (!group || emittedInputGroupKeys.has(group.key)) {
          return;
        }
        emittedInputGroupKeys.add(group.key);
        const port = group.port;
        if (port) {
          nextEdges.push({
            ...cloneEdge(edge),
            id: input.createId('edge'),
            target: functionNodeId,
            targetHandle: port.id,
          });
        }
        return;
      }
      if (internalIds.has(edge.source) && !internalIds.has(edge.target)) {
        const port = outputPortByEdgeId.get(edge.id);
        if (port) {
          nextEdges.push({
            ...cloneEdge(edge),
            id: input.createId('edge'),
            source: functionNodeId,
            sourceHandle: port.id,
          });
        }
        return;
      }
      if (removeIds.has(edge.source) || removeIds.has(edge.target)) {
        return;
      }
      nextEdges.push(edge);
    });
  }

  config.lastRunRuntime = {
    result: 'idle',
    lastRunAt: 0,
    nodeCount: internalNodes.length,
    edgeCount: internalEdges.length,
  };

  const functionNode: AppNode = {
    id: functionNodeId,
    type: 'functionNode',
    selected: true,
    position: {
      x: bounds.x + bounds.width / 2 - 150,
      y: bounds.y + bounds.height / 2 - 100,
    },
    data: {
      customTitle: title,
      functionNode: config,
    },
  };

  return {
    functionNode,
    nextNodes: [
      ...input.nodes.filter((node) => !removeIds.has(node.id)).map((node) => ({ ...node, selected: false })),
      functionNode,
    ],
    nextEdges,
  };
}

function resolveCollapseSelection(nodes: AppNode[]): CollapseSelection | null {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (selectedNodes.length === 0) {
    return null;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const selectedGroupNodes = selectedNodes.filter((node) => node.type === 'groupNode' && (node.data.groupNode?.childNodeIds.length ?? 0) > 0);
  const groupedChildIds = new Set<string>();
  for (const groupNode of selectedGroupNodes) {
    for (const childNodeId of groupNode.data.groupNode?.childNodeIds ?? []) {
      if (nodeById.has(childNodeId)) {
        groupedChildIds.add(childNodeId);
      }
    }
  }

  const selectedGroupNodeIds = new Set(selectedGroupNodes.map((node) => node.id));
  const internalIds = new Set<string>(groupedChildIds);
  for (const node of selectedNodes) {
    if (!selectedGroupNodeIds.has(node.id)) {
      internalIds.add(node.id);
    }
  }

  const internalNodes = nodes.filter((node) => internalIds.has(node.id) && !selectedGroupNodeIds.has(node.id));
  if (internalNodes.length === 0) {
    return null;
  }

  const removeIds = new Set(internalIds);
  for (const groupNodeId of selectedGroupNodeIds) {
    removeIds.add(groupNodeId);
  }

  return {
    internalNodes,
    internalIds,
    removeIds,
    titleNodes: selectedGroupNodes.length > 0 ? selectedGroupNodes : internalNodes,
  };
}

function groupBoundaryEdges(
  edges: Edge[],
  keyForEdge: (edge: Edge) => string,
  createPort: (edge: Edge, index: number) => FunctionPortKind,
): BoundaryEdgeGroup[] {
  const groups: BoundaryEdgeGroup[] = [];
  const groupByKey = new Map<string, BoundaryEdgeGroup>();

  for (const edge of edges) {
    const key = keyForEdge(edge);
    const existing = groupByKey.get(key);
    if (existing) {
      existing.edges.push(edge);
      continue;
    }
    const group = {
      key,
      edges: [edge],
      port: createPort(edge, groups.length),
    };
    groups.push(group);
    groupByKey.set(key, group);
  }

  return groups;
}

export interface FunctionExecutionOutcome {
  result: string;
  resultType: ResultType;
  statusMessage: string;
}

export interface PreparedFunctionSubgraph {
  nodes: AppNode[];
  edges: Edge[];
}

export function executeFunctionNodeConfig(config: FunctionNodeConfig, flowInputs: Record<string, DynamicValue> = {}): FunctionExecutionOutcome {
  const outputBinding = config.outputBindings[0];
  if (!outputBinding) {
    return {
      result: '',
      resultType: 'text',
      statusMessage: 'Function did not expose an output binding.',
    };
  }

  const resolvedInputs = resolveFunctionInputBindings(config, flowInputs);
  const prepared = prepareFunctionSubgraph(config, resolvedInputs);
  const rawValue = resolveFunctionOutputFromGraph(config, outputBinding, prepared, resolvedInputs);
  return serializeFunctionExecutionOutcome(config, outputBinding, rawValue);
}

/** Resolve every advertised Function input before the internal graph is prepared.
 * Persisted Functions may deliberately use constants and expressions instead of an
 * incoming canvas edge; treating those ports as empty silently changed their API. */
export function resolveFunctionInputBindings(
  config: FunctionNodeConfig,
  supplied: Record<string, DynamicValue> = {},
): Record<string, DynamicValue> {
  const resolved: Record<string, DynamicValue> = { ...supplied };
  const portsById = new Map(config.contract.inputPorts.map((port) => [port.id, port]));

  for (const binding of config.inputBindings) {
    const port = portsById.get(binding.targetInputPortId);
    if (!port) continue;

    let value: DynamicValue;
    if (binding.source.mode === 'constant') {
      value = binding.source.value;
    } else if (binding.source.mode === 'expression') {
      value = renderTemplate(binding.source.expression, buildFunctionTemplateContext(config, resolved));
    } else {
      const source = binding.source;
      value = resolved[source.sourceHandle ?? '']
        ?? resolved[source.sourceVariable ?? '']
        ?? resolved[port.id]
        ?? resolved[port.key]
        ?? '';
    }

    if (isEmptyValue(value)) {
      value = resolveMissingInput(binding, port);
    }
    value = applyFunctionTransforms(value, binding.transforms);
    resolved[port.id] = value;
    resolved[port.key] = value;
  }

  // Ports without an explicit binding still honour supplied values/defaults.
  for (const port of config.contract.inputPorts) {
    const value = resolved[port.id] ?? resolved[port.key] ?? port.defaultValue ?? '';
    resolved[port.id] = value;
    resolved[port.key] = value;
  }
  return resolved;
}

function resolveMissingInput(binding: FunctionInputBinding, port: FunctionPortKind): DynamicValue {
  switch (binding.missing.strategy) {
    case 'null': return null;
    case 'error': throw new Error(`Function input ${port.label} is missing.`);
    case 'skip': return '';
    case 'default': return binding.missing.value ?? port.defaultValue ?? '';
  }
}

export function getFunctionNodeOutput(node: AppNode, sourceHandle?: string | null): FunctionNodeOutput | undefined {
  if (node.type !== 'functionNode') return undefined;
  const outputs = node.data.namedOutputs ?? node.data.functionOutputs;
  if (sourceHandle && outputs?.[sourceHandle]) return outputs[sourceHandle];
  const primaryBinding = node.data.functionNode?.outputBindings[0];
  if (primaryBinding && outputs?.[primaryBinding.targetOutputPortId]) {
    return outputs[primaryBinding.targetOutputPortId];
  }
  return node.data.result !== undefined && node.data.resultType !== undefined
    ? {
      result: node.data.result,
      resultType: node.data.resultType,
      mimeType: node.data.resultMimeType,
      extension: node.data.resultExtension,
      fileName: node.data.resultFileName,
      outputMetadata: node.data.resultOutputMetadata,
    }
    : undefined;
}

export function serializeFunctionExecutionOutcome(
  config: FunctionNodeConfig,
  outputBinding: FunctionOutputBinding,
  rawValue: DynamicValue,
): FunctionExecutionOutcome {
  const transformedValue = applyFunctionTransforms(rawValue, outputBinding.transforms);
  const resultType = normalizeFunctionResultType(outputBinding.resultType, transformedValue);

  return {
    result: serializeExecutionResult(transformedValue, resultType),
    resultType,
    statusMessage: `Resolved ${config.title} from ${config.graph.nodes.length} internal node${config.graph.nodes.length === 1 ? '' : 's'}`,
  };
}

/**
 * Clone the function's internal graph and bind the caller's current inputs into it. Marker
 * nodes receive their value directly; non-marker boundary targets additionally get a
 * synthesized carrier node wired through the original target handle, so the value arrives
 * the same way the pre-collapse graph delivered it — through an edge that both signal
 * evaluation and execution-context collectors can see.
 */
export function prepareFunctionSubgraph(
  config: FunctionNodeConfig,
  flowInputs: Record<string, DynamicValue> = {},
): PreparedFunctionSubgraph | null {
  if (!config.graph || !Array.isArray(config.graph.nodes) || config.graph.nodes.length === 0) {
    return null;
  }

  const resolvedInputs = resolveFunctionInputBindings(config, flowInputs);
  const nodes = config.graph.nodes.map((node) => ({
    ...node,
    data: { ...node.data },
  })) as AppNode[];
  // Persisted configs from older saves can lose their wiring array; treat malformed
  // wiring as an unwired graph so execution degrades instead of crashing.
  const edges = Array.isArray(config.graph.edges) ? [...config.graph.edges] : [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const portsById = new Map(config.contract.inputPorts.map((port) => [port.id, port]));

  nodes.forEach((node) => {
    if (node.type === 'functionInputNode') {
      const portLabel = typeof node.data.functionPortLabel === 'string' ? node.data.functionPortLabel : (typeof node.data.customTitle === 'string' ? node.data.customTitle : 'Input Port');
      const portKey = typeof node.data.functionPortKey === 'string' ? node.data.functionPortKey : slugifyIdentifier(portLabel);
      const portId = `input-marker-${node.id}`;

      const val = resolvedInputs[portId] ?? resolvedInputs[portKey] ?? node.data.value ?? '';
      const valStr = typeof val === 'string' ? val : JSON.stringify(val);
      node.data.result = valStr;
      node.data.value = val;
      node.data.prompt = valStr;
    }
  });

  (config.graph.inputBoundaryLinks ?? []).forEach((link, index) => {
    const targetNode = nodesById.get(link.internalNodeId);
    if (!targetNode) {
      return;
    }

    const val = resolvedInputs[link.portId] ?? '';
    if (link.internalHandle) {
      targetNode.data[link.internalHandle] = val;
    } else {
      targetNode.data.result = typeof val === 'string' ? val : JSON.stringify(val);
      targetNode.data.value = val;
    }

    // Marker nodes carry their own value; everything else gets a boundary carrier edge.
    if (targetNode.type === 'functionInputNode') {
      return;
    }

    const carrier = createBoundaryCarrierNode(link, portsById.get(link.portId), val, index);
    nodes.push(carrier.node);
    edges.push(carrier.edge);
    nodesById.set(carrier.node.id, carrier.node);
  });

  return { nodes, edges };
}

function createBoundaryCarrierNode(
  link: FunctionBoundaryLink,
  port: FunctionPortKind | undefined,
  value: DynamicValue,
  index: number,
): { node: AppNode; edge: Edge } {
  const valueText = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const kind = resolveBoundaryCarrierKind(port?.resultType, valueText);
  const carrierId = `function-boundary-input-${link.id}`;
  const position: XYPosition = { x: -480, y: index * 96 };

  const node: AppNode = kind === 'image' || kind === 'video' || kind === 'audio'
    ? {
      id: carrierId,
      // Import-mode media nodes are the canonical "media source" the execution-context
      // collectors already understand; functionInputNode is only recognized as text.
      type: kind === 'image' ? 'imageGen' : kind === 'video' ? 'videoGen' : 'audioGen',
      position,
      data: {
        mediaMode: 'import',
        result: valueText,
        resultType: kind,
        sourceAssetUrl: valueText,
      },
    }
    : {
      id: carrierId,
      type: 'functionInputNode',
      position,
      data: {
        value,
        result: valueText,
        prompt: valueText,
      },
    };

  const edge: Edge = {
    id: `edge-${carrierId}`,
    source: carrierId,
    target: link.internalNodeId,
    sourceHandle: null,
    targetHandle: link.internalHandle ?? null,
  };

  return { node, edge };
}

function resolveBoundaryCarrierKind(portResultType: FunctionValueKind | undefined, valueText: string): 'image' | 'video' | 'audio' | 'text' {
  if (portResultType === 'image' || portResultType === 'video' || portResultType === 'audio') {
    return portResultType;
  }
  if (valueText.startsWith('data:image/')) return 'image';
  if (valueText.startsWith('data:video/')) return 'video';
  if (valueText.startsWith('data:audio/')) return 'audio';
  return 'text';
}

export function collectFunctionNodeWarnings(config: FunctionNodeConfig): string[] {
  const warnings: string[] = [];
  const inputIds = new Set(config.contract.inputPorts.map((port) => port.id));
  const outputIds = new Set(config.contract.outputPorts.map((port) => port.id));
  const graphNodeIds = new Set(config.graph.nodes.map((node) => node.id));

  for (const binding of config.inputBindings) {
    if (!inputIds.has(binding.targetInputPortId)) {
      warnings.push(`Input binding ${binding.id} targets a missing port.`);
    }
  }

  for (const binding of config.outputBindings) {
    if (!outputIds.has(binding.targetOutputPortId)) {
      warnings.push(`Output binding ${binding.id} targets a missing port.`);
    }
    if (binding.sourceNodeId && !graphNodeIds.has(binding.sourceNodeId)) {
      warnings.push(`Output binding ${binding.id} reads a missing internal node.`);
    }
  }

  return warnings;
}

export function getNodeResultForFunctionRouting(node: AppNode): DynamicValue {
  if (node.data.result !== undefined) return node.data.result;
  if (node.data.prompt !== undefined) return node.data.prompt;
  if (node.data.sourceAssetUrl !== undefined) return node.data.sourceAssetUrl;
  if (node.data.envelopeItems !== undefined) return node.data.envelopeItems as unknown as DynamicValue;
  return '';
}

export function resolveFunctionOutputFromGraph(
  config: FunctionNodeConfig,
  outputBinding: FunctionOutputBinding,
  prepared: PreparedFunctionSubgraph | null,
  flowInputs: Record<string, DynamicValue>,
): DynamicValue {
  assertFunctionOutputBindingHandle(config, outputBinding, prepared);

  // If there are internal nodes, resolve the bound output through sub-DAG signals
  if (prepared) {
    try {
      const targetNodeId = outputBinding.sourceNodeId;
      if (targetNodeId) {
        const signal = evaluateNodeSignal(
          targetNodeId,
          prepared.nodes,
          prepared.edges,
          new Set<string>(),
          undefined,
          outputBinding.sourceHandle,
        );
        return signal.value as DynamicValue;
      }
    } catch (err) {
      console.error('Dynamic sub-DAG function execution failed:', err);
    }
  }

  const sourceNode = (prepared?.nodes ?? config.graph.nodes).find((node) => node.id === outputBinding.sourceNodeId);
  const context = buildFunctionTemplateContext(config, flowInputs);

  if (outputBinding.expression?.trim()) {
    return renderTemplate(outputBinding.expression, context);
  }

  if (!sourceNode) {
    return resolveMissingOutput(outputBinding);
  }

  const data = sourceNode.data as NodeData;
  if (outputBinding.sourceHandle) {
    const keyedValue = data[outputBinding.sourceHandle];
    if (keyedValue !== undefined) {
      return keyedValue as DynamicValue;
    }
  }

  return (data.result ?? data.prompt ?? data.sourceAssetUrl ?? '') as DynamicValue;
}

/** Fail closed for named output identity before signal evaluation can fall back to a
 * source node's primary/default value. Default handles intentionally retain legacy
 * compatibility even on nodes whose visible contract uses named ports. */
export function assertFunctionOutputBindingHandle(
  config: FunctionNodeConfig,
  outputBinding: FunctionOutputBinding,
  prepared: PreparedFunctionSubgraph | null,
): void {
  if (!outputBinding.sourceHandle) return;

  const nodes = prepared?.nodes ?? (config.graph.nodes as AppNode[]);
  const edges = prepared?.edges ?? (Array.isArray(config.graph.edges) ? config.graph.edges : []);
  const sourceNode = nodes.find((node) => node.id === outputBinding.sourceNodeId);
  const sourcePort = sourceNode
    ? resolveFlowNodePort({ node: sourceNode, nodes, edges }, 'output', outputBinding.sourceHandle)
    : undefined;

  if (!sourceNode || !sourcePort) {
    throw new NonRetryableError(
      `Reusable function output source handle "${outputBinding.sourceHandle}" is not available on internal node ${outputBinding.sourceNodeId || '(missing)'}. Refusing to route primary/default data.`,
    );
  }
}

function resolveMissingOutput(binding: FunctionOutputBinding): DynamicValue {
  switch (binding.missing.strategy) {
    case 'null':
      return null;
    case 'error':
      throw new Error(`Function output ${binding.targetOutputPortId} is missing its internal source.`);
    case 'skip':
      return '';
    case 'default':
    default:
      return binding.missing.value ?? '';
  }
}

function buildFunctionTemplateContext(config: FunctionNodeConfig, flowInputs: Record<string, DynamicValue>) {
  const inputs = Object.fromEntries(
    config.contract.inputPorts.map((port) => [port.key, flowInputs[port.id] ?? flowInputs[port.key] ?? port.defaultValue ?? '']),
  );

  return {
    flow: {
      input: inputs,
    },
    function: {
      title: config.title,
      id: config.contract.id,
    },
  };
}

function createBoundaryPort(input: {
  idPrefix: 'input' | 'output';
  edge: Edge;
  keySource: string;
  index: number;
  resultType: FunctionValueKind;
}): FunctionPortKind {
  const key = slugifyIdentifier(input.keySource) || `${input.idPrefix}_${input.index + 1}`;
  return {
    id: `${input.idPrefix}-${input.index + 1}-${key}`,
    key,
    label: titleCaseLabel(humanizeIdentifier(key)),
    resultType: input.resultType,
    required: false,
    order: input.index,
  };
}

function buildBoundaryPortLabel(node: AppNode | undefined, handle: string | null | undefined): string {
  const base = getNodeLabel(node);
  const handleLabel = handle ? humanizeIdentifier(handle) : '';
  if (!handleLabel) {
    return titleCaseLabel(base);
  }
  const label = base.toLowerCase().includes(handleLabel.toLowerCase()) ? base : `${base} ${handleLabel}`;
  return titleCaseLabel(label);
}

function getNodeLabel(node: AppNode | undefined): string {
  if (!node) {
    return 'Input';
  }

  const customTitle = typeof node.data.customTitle === 'string' ? node.data.customTitle.trim() : '';
  if (customTitle) {
    return customTitle;
  }

  const sourceAssetName = typeof node.data.sourceAssetName === 'string' ? node.data.sourceAssetName.trim() : '';
  if (sourceAssetName) {
    return sourceAssetName;
  }

  return humanizeIdentifier(node.id || String(node.type ?? 'node'));
}

function clonePersistableNode(node: AppNode): AppNode {
  return {
    ...node,
    selected: false,
    data: sanitizeNodeData(node.data),
  };
}

function sanitizeNodeData(data: NodeData): NodeData {
  const next: NodeData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!RUNTIME_NODE_DATA_KEYS.has(key) && value !== undefined) {
      next[key] = deepClone(value);
    }
  }
  return next;
}

function cloneEdge(edge: Edge): Edge {
  return deepClone(edge) as Edge;
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function getNodeBounds(nodes: AppNode[]): Bounds {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + widthForNode(node)));
  const maxY = Math.max(...nodes.map((node) => node.position.y + heightForNode(node)));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function widthForNode(node: AppNode): number {
  return typeof node.measured?.width === 'number' ? node.measured.width : 280;
}

function heightForNode(node: AppNode): number {
  return typeof node.measured?.height === 'number' ? node.measured.height : 180;
}

function deriveFunctionTitle(nodes: AppNode[]): string {
  if (nodes.length === 1) {
    return typeof nodes[0].data.customTitle === 'string' && nodes[0].data.customTitle.trim()
      ? `${nodes[0].data.customTitle.trim()} Function`
      : `${humanizeIdentifier(String(nodes[0].type))} Function`;
  }

  return `Function (${nodes.length} nodes)`;
}

function inferNodeResultType(node?: AppNode): FunctionValueKind {
  const explicit = node?.data.resultType;
  if (isResultType(explicit)) {
    return explicit;
  }

  switch (node?.type) {
    case 'imageGen':
    case 'cropImageNode':
      return 'image';
    case 'videoGen':
    case 'composition':
      return 'video';
    case 'audioGen':
      return 'audio';
    case 'list':
      return 'list';
    case 'envelope':
      return 'envelope';
    case 'numberNode':
    case 'mathNode':
    case 'listLengthNode':
      return 'number';
    case 'valueNode':
      return isResultType(node.data.valueKind) ? node.data.valueKind : 'text';
    case 'logicNode':
    case 'comparisonNode':
    case 'visionVerifyNode':
    case 'loopBreakNode':
      return 'boolean';
    default:
      return 'text';
  }
}

function normalizeFunctionResultType(resultType: FunctionValueKind, value: DynamicValue): ResultType {
  if (resultType !== 'any') {
    return resultType;
  }

  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (value && typeof value === 'object') return 'json';
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('blob:')) return 'image';
    if (value.startsWith('data:video/')) return 'video';
    if (value.startsWith('data:audio/')) return 'audio';
  }
  return 'text';
}

function isResultType(value: unknown): value is ResultType {
  return (
    value === 'text' ||
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'package' ||
    value === 'number' ||
    value === 'boolean' ||
    value === 'json' ||
    value === 'list' ||
    value === 'envelope'
  );
}

function serializeExecutionResult(value: DynamicValue, resultType: ResultType): string {
  if (typeof value === 'string') {
    return value;
  }
  if (resultType === 'number') {
    return String(typeof value === 'number' ? value : Number(value) || 0);
  }
  if (resultType === 'boolean') {
    return value ? 'true' : 'false';
  }
  return JSON.stringify(value ?? '');
}

function textFromStep(step: FunctionTransformStep, key: string): string {
  const value = (step as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function numberFromStep(step: FunctionTransformStep, key: string): number {
  const value = (step as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function valueFromStep(step: FunctionTransformStep, key: string): DynamicValue {
  return ((step as unknown as Record<string, unknown>)[key] ?? '') as DynamicValue;
}

function valueToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function valueToBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = valueToString(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function parseJsonValue(value: DynamicValue): DynamicValue {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as DynamicValue;
  } catch {
    return null;
  }
}

function regexReplace(value: DynamicValue, step: FunctionTransformStep): string {
  try {
    return valueToString(value).replace(
      new RegExp(textFromStep(step, 'pattern'), textFromStep(step, 'flags')),
      textFromStep(step, 'replacement'),
    );
  } catch {
    return valueToString(value);
  }
}

function applyCase(value: string, kind: string): string {
  const words = value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);

  switch (kind) {
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'title':
      return words.map(capitalize).join(' ');
    case 'camel':
      return words.map((word, index) => index === 0 ? word.toLowerCase() : capitalize(word)).join('');
    case 'pascal':
      return words.map(capitalize).join('');
    case 'kebab':
      return words.map((word) => word.toLowerCase()).join('-');
    case 'snake':
      return words.map((word) => word.toLowerCase()).join('_');
    default:
      return value;
  }
}

function readPath(value: unknown, path: string): DynamicValue | undefined {
  if (!path) {
    return value as DynamicValue;
  }

  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let current: unknown = value;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }

  return current as DynamicValue | undefined;
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const value = readPath(context, rawPath.trim());
    return valueToString(value);
  });
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function titleCaseLabel(value: string): string {
  return value
    .split(' ')
    .map((word) => (word.toUpperCase() === word ? word : capitalize(word)))
    .join(' ');
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : '';
}
