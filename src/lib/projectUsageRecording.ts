import type { AppNode, UsageTelemetry, WorkspaceView } from '../types/flow';

interface UnknownActualUsageIdentity {
  provider?: string;
  modelId?: string;
  imageCount?: number;
}

interface RecordProjectUsageInput {
  node: AppNode;
  usage?: UsageTelemetry;
  /** Required before missing telemetry may be synthesized as a successful actual execution. */
  executionSucceeded?: true;
  workspace: WorkspaceView;
  flowWorkspaceId?: string;
  flowWorkspaceName?: string;
  createdAt?: number;
  recordUsage: (input: {
    nodeId: string;
    nodeType: AppNode['type'];
    nodeData: AppNode['data'];
    workspace: WorkspaceView;
    flowWorkspaceId?: string;
    flowWorkspaceName?: string;
    usage: UsageTelemetry;
    createdAt?: number;
  }) => void;
}

export function recordProjectUsageFromExecution({
  node,
  usage,
  executionSucceeded,
  workspace,
  flowWorkspaceId,
  flowWorkspaceName,
  createdAt,
  recordUsage,
}: RecordProjectUsageInput): void {
  const actualUsage = usage ?? (executionSucceeded ? createUnknownActualUsageForExecution(node) : undefined);
  if (!actualUsage) return;
  recordUsage({
    nodeId: node.id,
    nodeType: node.type,
    nodeData: node.data,
    workspace,
    flowWorkspaceId,
    flowWorkspaceName,
    usage: actualUsage,
    createdAt,
  });
}

/**
 * Owns the exact success transition for provider calls made outside Flow's run store. The recorder
 * runs once after the provider promise resolves and before the successful result is returned to its
 * caller. A rejected or cancelled execution never crosses this boundary and therefore cannot create
 * a synthetic actual record.
 */
export async function executeAndRecordProjectUsage<T extends { usage?: UsageTelemetry }>(input: {
  node: AppNode;
  workspace: WorkspaceView;
  flowWorkspaceId?: string;
  flowWorkspaceName?: string;
  createdAt?: number;
  recordUsage: RecordProjectUsageInput['recordUsage'];
  execute: () => Promise<T>;
}): Promise<T> {
  const execution = await input.execute();
  recordProjectUsageFromExecution({
    node: input.node,
    usage: execution.usage,
    executionSucceeded: true,
    workspace: input.workspace,
    flowWorkspaceId: input.flowWorkspaceId,
    flowWorkspaceName: input.flowWorkspaceName,
    createdAt: input.createdAt,
    recordUsage: input.recordUsage,
  });
  return execution;
}

/**
 * Successful provider/model calls are financial history even when their API does not return
 * token or price telemetry. Keep that uncertainty explicit: no absent number is coerced to zero.
 * Prompt-only text nodes are local source values, not model executions, and therefore return
 * undefined here rather than creating a false usage event.
 */
export function createUnknownActualUsageForExecution(
  node: AppNode,
  identity: UnknownActualUsageIdentity = {},
): UsageTelemetry | undefined {
  if (!isUsageBearingExecutionNode(node)) return undefined;

  const provider = nonEmpty(identity.provider)
    ?? nonEmpty(typeof node.data.provider === 'string' ? node.data.provider : undefined)
    ?? defaultProviderForNode(node);
  const modelId = nonEmpty(identity.modelId)
    ?? nonEmpty(typeof node.data.modelId === 'string' ? node.data.modelId : undefined);
  const imageCount = finitePositiveInteger(identity.imageCount);

  return {
    source: 'actual',
    confidence: 'unknown',
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(imageCount !== undefined ? { imageCount } : {}),
    notes: ['Execution completed, but the provider did not report numeric usage or cost; pricing remains unknown.'],
  };
}

function isUsageBearingExecutionNode(node: AppNode): boolean {
  if (node.type === 'textNode') return (node.data.mode ?? 'prompt') === 'generate';
  return node.type === 'imageGen'
    || node.type === 'videoGen'
    || node.type === 'audioGen'
    || node.type === 'visionVerifyNode';
}

function defaultProviderForNode(node: AppNode): string | undefined {
  if (node.type === 'textNode' || node.type === 'imageGen' || node.type === 'videoGen' || node.type === 'visionVerifyNode') {
    return 'gemini';
  }
  if (node.type === 'audioGen') return 'elevenlabs';
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function finitePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
