import {
  FLOW_NODE_TYPES as FLOW_NODE_TYPE_VALUES,
  type FlowNodeType,
} from '../types/flow';
import projectSchemaManifest from '../../shared/project-schema.json';

export const CURRENT_PROJECT_SCHEMA_VERSION = projectSchemaManifest.schemaVersion as 1;

export const FLOW_NODE_TYPES = FLOW_NODE_TYPE_VALUES satisfies readonly FlowNodeType[];

const FLOW_NODE_TYPE_SET = new Set<string>(FLOW_NODE_TYPES);

export function isFlowNodeType(value: unknown): value is FlowNodeType {
  return typeof value === 'string' && FLOW_NODE_TYPE_SET.has(value);
}
