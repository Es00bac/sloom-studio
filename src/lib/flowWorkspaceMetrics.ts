export interface FlowWorkspaceMetricSnapshot {
  workspaceId: string;
  nodeCount: number;
  edgeCount: number;
  sourceItemCount: number;
  importDurationMs?: number;
  switchDurationMs?: number;
}

export function buildFlowWorkspaceMetricSnapshot(
  input: FlowWorkspaceMetricSnapshot,
): FlowWorkspaceMetricSnapshot {
  return input;
}

export function buildFlowWorkspaceMetricLabel(snapshot: FlowWorkspaceMetricSnapshot): string {
  const parts = [
    `Flow ${snapshot.workspaceId}`,
    `N${snapshot.nodeCount}`,
    `E${snapshot.edgeCount}`,
    `S${snapshot.sourceItemCount}`,
  ];

  if (typeof snapshot.importDurationMs === 'number') {
    parts.push(`I${snapshot.importDurationMs}ms`);
  }

  if (typeof snapshot.switchDurationMs === 'number') {
    parts.push(`W${snapshot.switchDurationMs}ms`);
  }

  return parts.join(' ');
}

export function shouldShowFlowWorkspaceDiagnostics(value: string | undefined): boolean {
  return value === '1';
}
