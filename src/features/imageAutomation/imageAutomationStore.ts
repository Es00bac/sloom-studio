import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import {
  getImageAutomationNodeEntry,
  type ImageAutomationNodeData,
  type ImageAutomationNodeType,
} from './imageAutomationCatalog';

export type ImageAutomationNode = Node<ImageAutomationNodeData, ImageAutomationNodeType>;
export type ImageAutomationEdge = Edge;

interface ImageAutomationState {
  nodes: ImageAutomationNode[];
  edges: ImageAutomationEdge[];
  addAutomationNode: (
    type: ImageAutomationNodeType,
    position: { x: number; y: number },
    dataPatch?: Partial<ImageAutomationNodeData>,
  ) => string;
  seedStarterFlow: () => void;
  resetAutomationFlow: () => void;
  onNodesChange: OnNodesChange<ImageAutomationNode>;
  onEdgesChange: OnEdgesChange<ImageAutomationEdge>;
  onConnect: OnConnect;
}

const memoryStorage = new Map<string, string>();

export const useImageAutomationStore = create<ImageAutomationState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      addAutomationNode: (type, position, dataPatch) => {
        const id = createImageAutomationNodeId(type);
        const entry = getImageAutomationNodeEntry(type);
        const node: ImageAutomationNode = {
          id,
          type,
          position,
          data: {
            ...entry.initialData,
            ...dataPatch,
          },
        };
        set((state) => ({ nodes: [...state.nodes, node] }));
        return id;
      },
      seedStarterFlow: () => {
        const nodes = createStarterAutomationNodes();
        set({
          nodes,
          edges: createStarterAutomationEdges(nodes),
        });
      },
      resetAutomationFlow: () => set({ nodes: [], edges: [] }),
      onNodesChange: (changes: NodeChange<ImageAutomationNode>[]) => {
        set({ nodes: applyNodeChanges(changes, get().nodes) });
      },
      onEdgesChange: (changes: EdgeChange<ImageAutomationEdge>[]) => {
        set({ edges: applyEdgeChanges(changes, get().edges) });
      },
      onConnect: (connection: Connection) => {
        set({ edges: addEdge({ ...connection, type: 'smoothstep' }, get().edges) });
      },
    }),
    {
      name: 'signal-loom-image-automation-flow',
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
      }),
      storage: createJSONStorage(getImageAutomationStorage),
    },
  ),
);

function getImageAutomationStorage(): StateStorage {
  let browserStorage: Storage | undefined;
  try {
    browserStorage = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    browserStorage = undefined;
  }

  if (
    browserStorage &&
    typeof browserStorage.getItem === 'function' &&
    typeof browserStorage.setItem === 'function' &&
    typeof browserStorage.removeItem === 'function'
  ) {
    return {
      getItem: (name) => {
        try {
          return browserStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          browserStorage.setItem(name, value);
        } catch {
          // Ignore unavailable/quota-limited storage during startup.
        }
      },
      removeItem: (name) => {
        try {
          browserStorage.removeItem(name);
        } catch {
          // Ignore unavailable storage during startup.
        }
      },
    };
  }

  return {
    getItem: (name) => memoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryStorage.delete(name);
    },
  };
}

function createStarterAutomationNodes(): ImageAutomationNode[] {
  const starter: Array<[ImageAutomationNodeType, { x: number; y: number }]> = [
    ['directoryInput', { x: 60, y: 120 }],
    ['imageBatchList', { x: 330, y: 120 }],
    ['applyAdjustment', { x: 600, y: 120 }],
    ['saveOutput', { x: 870, y: 120 }],
  ];

  return starter.map(([type, position]) => {
    const entry = getImageAutomationNodeEntry(type);
    return {
      id: `image-automation-starter-${type}`,
      type,
      position,
      data: { ...entry.initialData },
    };
  });
}

function createStarterAutomationEdges(nodes: ImageAutomationNode[]): ImageAutomationEdge[] {
  const nodeIds = new Map(nodes.map((node) => [node.type, node.id]));
  const starterEdges: Array<{
    source: ImageAutomationNodeType;
    sourceHandle: string;
    target: ImageAutomationNodeType;
    targetHandle: string;
  }> = [
    {
      source: 'directoryInput',
      sourceHandle: 'directory',
      target: 'imageBatchList',
      targetHandle: 'directory',
    },
    {
      source: 'imageBatchList',
      sourceHandle: 'imageBatch',
      target: 'applyAdjustment',
      targetHandle: 'imageBatch',
    },
    {
      source: 'applyAdjustment',
      sourceHandle: 'adjustedBatch',
      target: 'saveOutput',
      targetHandle: 'imageBatch',
    },
  ];

  return starterEdges.flatMap((edge) => {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (!source || !target) {
      return [];
    }

    return [{
      id: `image-automation-edge-${source}-${target}`,
      source,
      sourceHandle: edge.sourceHandle,
      target,
      targetHandle: edge.targetHandle,
      type: 'smoothstep',
    }];
  });
}

function createImageAutomationNodeId(type: ImageAutomationNodeType): string {
  return `image-automation-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
