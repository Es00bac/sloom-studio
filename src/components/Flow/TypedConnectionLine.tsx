import type {
  ConnectionLineComponent,
  ConnectionLineComponentProps,
  Edge,
} from '@xyflow/react';
import type { AppNode } from '../../types/flow';
import {
  resolveFlowOutputType,
  validateFlowConnection,
  type FlowGraphContractContext,
} from '../../lib/flowConnectionContracts';
import { getFlowEdgePresentation } from './flowEdgePresentation';

export interface TypedConnectionEndpoints {
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: 'source' | 'target';
  toNodeId?: string;
  toHandleId: string | null;
  toHandleType?: 'source' | 'target';
}

export interface TypedConnectionLineState {
  color: string;
  dashArray?: string;
  invalidReason?: string;
  markerAt: 'from' | 'to';
  strokeWidth: number;
  typeLabel: string;
  valid: boolean | null;
}

export function resolveTypedConnectionLineState(
  endpoints: TypedConnectionEndpoints,
  context: FlowGraphContractContext,
): TypedConnectionLineState {
  const fromSource = endpoints.fromHandleType === 'source';
  const sourceNodeId = fromSource ? endpoints.fromNodeId : endpoints.toNodeId;
  const sourceHandle = fromSource ? endpoints.fromHandleId : endpoints.toHandleId;
  const targetNodeId = fromSource ? endpoints.toNodeId : endpoints.fromNodeId;
  const targetHandle = fromSource ? endpoints.toHandleId : endpoints.fromHandleId;
  const endpointTypesMatch = endpoints.toHandleType === undefined
    || endpoints.toHandleType !== endpoints.fromHandleType;
  const carriedType = sourceNodeId
    ? resolveFlowOutputType(sourceNodeId, sourceHandle, context)
    : { kind: 'unknown' as const };
  const validation = sourceNodeId && targetNodeId && endpointTypesMatch
    ? validateFlowConnection({
      source: sourceNodeId,
      sourceHandle,
      target: targetNodeId,
      targetHandle,
    }, context)
    : undefined;
  const invalidReason = endpointTypesMatch
    ? validation?.reason
    : 'Connect an output handle to an input handle.';
  const valid = validation ? validation.valid : invalidReason ? false : null;
  const presentation = getFlowEdgePresentation({
    valid: valid !== false,
    carriedType,
    reason: invalidReason,
  });

  return {
    color: presentation.color,
    dashArray: presentation.dashArray,
    invalidReason,
    markerAt: fromSource ? 'to' : 'from',
    strokeWidth: presentation.strokeWidth,
    typeLabel: presentation.typeLabel,
    valid,
  };
}

export function createTypedConnectionLine(
  nodes: readonly AppNode[],
  edges: readonly Edge[],
): ConnectionLineComponent<AppNode> {
  const context = { nodes, edges };

  function TypedConnectionLine(props: ConnectionLineComponentProps<AppNode>) {
    const state = resolveTypedConnectionLineState({
      fromNodeId: props.fromNode.id,
      fromHandleId: props.fromHandle.id ?? null,
      fromHandleType: props.fromHandle.type,
      toNodeId: props.toNode?.id,
      toHandleId: props.toHandle?.id ?? null,
      toHandleType: props.toHandle?.type,
    }, context);
    const startX = state.markerAt === 'to' ? props.fromX : props.toX;
    const startY = state.markerAt === 'to' ? props.fromY : props.toY;
    const endX = state.markerAt === 'to' ? props.toX : props.fromX;
    const endY = state.markerAt === 'to' ? props.toY : props.fromY;
    const midpointX = (startX + endX) / 2;
    const midpointY = (startY + endY) / 2;
    const path = `M ${startX} ${startY} C ${midpointX} ${startY}, ${midpointX} ${endY}, ${endX} ${endY}`;
    const accessibleLabel = state.invalidReason
      ? `Invalid connection: ${state.invalidReason}`
      : `${state.typeLabel} connection`;

    return (
      <g aria-label={accessibleLabel} pointerEvents="none" role="img">
        <defs>
          <marker
            id="typed-flow-connection-arrow"
            markerHeight="8"
            markerUnits="strokeWidth"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
            viewBox="0 0 8 8"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill={state.color} />
          </marker>
        </defs>
        <path
          d={path}
          fill="none"
          markerEnd="url(#typed-flow-connection-arrow)"
          stroke={state.color}
          strokeDasharray={state.dashArray}
          strokeLinecap="round"
          strokeWidth={state.strokeWidth}
        />
        {state.invalidReason ? (
          <text
            fill="#fecaca"
            fontSize="10"
            fontWeight="700"
            paintOrder="stroke"
            stroke="#111827"
            strokeWidth="3"
            textAnchor="middle"
            x={midpointX}
            y={midpointY - 8}
          >
            {compactReason(state.invalidReason)}
          </text>
        ) : null}
      </g>
    );
  }

  return TypedConnectionLine;
}

function compactReason(reason: string): string {
  return reason.length <= 64 ? reason : `${reason.slice(0, 61)}…`;
}
