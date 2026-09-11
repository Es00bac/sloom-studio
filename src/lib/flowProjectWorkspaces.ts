import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';

export interface FlowProjectFlowSnapshot {
  version: number;
  nodes: AppNode[];
  edges: Edge[];
}

export type FlowProjectFlowSnapshotInput = Pick<FlowProjectFlowSnapshot, 'nodes' | 'edges'>
  & Partial<Pick<FlowProjectFlowSnapshot, 'version'>>;

export interface FlowWorkspaceProjectSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  flow: FlowProjectFlowSnapshot;
}

export const DEFAULT_FLOW_WORKSPACE_ID = 'main';
export const DEFAULT_FLOW_WORKSPACE_NAME = 'Main Flow';

export function buildDefaultFlowWorkspace(
  flow: FlowProjectFlowSnapshot,
  now = Date.now(),
): FlowWorkspaceProjectSnapshot {
  return {
    id: DEFAULT_FLOW_WORKSPACE_ID,
    name: DEFAULT_FLOW_WORKSPACE_NAME,
    createdAt: now,
    updatedAt: now,
    flow,
  };
}

export function findActiveFlowWorkspace(
  workspaces: readonly FlowWorkspaceProjectSnapshot[] | undefined,
  activeFlowWorkspaceId: string | undefined,
): FlowWorkspaceProjectSnapshot | undefined {
  if (!workspaces || workspaces.length === 0) {
    return undefined;
  }

  return workspaces.find((workspace) => workspace.id === activeFlowWorkspaceId) ?? workspaces[0];
}
