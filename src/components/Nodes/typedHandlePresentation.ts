import type { FlowPortContract } from '../../lib/flowNodeContracts';
import {
  describeFlowDataType,
  flowDataTypeColor,
  type FlowDataType,
} from '../../lib/flowPortTypes';

export interface TypedHandlePresentation {
  color: string;
  direction: FlowPortContract['direction'];
  disabled: boolean;
  title: string;
  typeLabel: string;
}

export function getTypedHandlePresentation(
  port: FlowPortContract,
  carriedType?: FlowDataType,
): TypedHandlePresentation {
  const displayType = carriedType ?? port.types[0] ?? { kind: 'unknown' };
  const typeLabel = describeFlowDataType(displayType);
  return {
    color: flowDataTypeColor(displayType),
    direction: port.direction,
    disabled: Boolean(port.disabledReason),
    title: [port.label, typeLabel, port.disabledReason].filter(Boolean).join(' · '),
    typeLabel,
  };
}
