import type { PersistedFlowEdgeContract } from '../../lib/flowConnectionContracts';
import {
  describeFlowDataType,
  flowTypeLineStyle,
  type FlowDataType,
  type FlowLinePattern,
} from '../../lib/flowPortTypes';

export type FlowEdgeContractData = PersistedFlowEdgeContract;

export interface FlowEdgePresentation {
  color: string;
  dashArray?: string;
  invalid: boolean;
  markerAtTarget: true;
  pattern: FlowLinePattern | 'invalid';
  strokeWidth: number;
  typeLabel: string;
}

const fallbackType: FlowDataType = { kind: 'unknown' };

export function getFlowEdgePresentation(
  contract: FlowEdgeContractData | undefined,
): FlowEdgePresentation {
  const carriedType = contract?.carriedType ?? fallbackType;
  const typeStyle = flowTypeLineStyle(carriedType);

  if (contract?.valid === false) {
    return {
      color: '#f87171',
      dashArray: '6 4',
      invalid: true,
      markerAtTarget: true,
      pattern: 'invalid',
      strokeWidth: 2.5,
      typeLabel: describeFlowDataType(carriedType),
    };
  }

  return {
    color: typeStyle.color,
    dashArray: typeStyle.dashArray,
    invalid: false,
    markerAtTarget: true,
    pattern: typeStyle.pattern,
    strokeWidth: typeStyle.strokeWidth,
    typeLabel: describeFlowDataType(carriedType),
  };
}

export function readFlowEdgeContract(
  data: Record<string, unknown> | undefined,
): FlowEdgeContractData | undefined {
  const candidate = data?.flowContract;
  if (!candidate || typeof candidate !== 'object' || !('valid' in candidate)) return undefined;
  return candidate as FlowEdgeContractData;
}
