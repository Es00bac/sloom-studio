import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { evaluateNodeSignal, getBlockingSignalDiagnostics, signalToTextAt } from './flowSignals';
import { LOOP_BREAK_TARGET_HANDLE } from './flowControlHandles';

export { LOOP_BREAK_TARGET_HANDLE };

export interface LoopBreakControl {
  nodeId: string;
  reason?: string;
}

export interface LoopBreakDecision {
  shouldBreak: boolean;
  controlNodeId?: string;
  reason?: string;
}

export function collectLoopBreakControls(
  targetNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): LoopBreakControl[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return edges.flatMap((edge) => {
    if (edge.target !== targetNodeId || edge.targetHandle !== LOOP_BREAK_TARGET_HANDLE) {
      return [];
    }

    const sourceNode = nodesById.get(edge.source);
    if (!sourceNode || sourceNode.type !== 'loopBreakNode') {
      return [];
    }

    const reason = typeof sourceNode.data.loopBreakReason === 'string' && sourceNode.data.loopBreakReason.trim()
      ? sourceNode.data.loopBreakReason.trim()
      : undefined;

    return [{ nodeId: sourceNode.id, reason }];
  });
}

export function shouldBreakLoopAtIteration(
  targetNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  iterationIndex: number,
): LoopBreakDecision {
  const controls = collectLoopBreakControls(targetNodeId, nodes, edges);

  for (const control of controls) {
    const signal = evaluateNodeSignal(control.nodeId, nodes, edges);
    const blockingDiagnostics = getBlockingSignalDiagnostics(signal);

    if (blockingDiagnostics.length > 0) {
      return {
        shouldBreak: true,
        controlNodeId: control.nodeId,
        reason: blockingDiagnostics[0]?.message ?? control.reason,
      };
    }

    if (parseBooleanLike(signalToTextAt(signal, iterationIndex))) {
      return {
        shouldBreak: true,
        controlNodeId: control.nodeId,
        reason: control.reason,
      };
    }
  }

  return { shouldBreak: false };
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
