import type { FlowNodeType, NodeData, UsageTelemetry, WorkspaceView } from '../types/flow';
import { isFlowNodeType } from './projectSchema';

export interface ProjectUsageLedgerEntry {
  id: string;
  createdAt: number;
  workspace: WorkspaceView;
  flowWorkspaceId?: string;
  flowWorkspaceName?: string;
  operation: string;
  nodeId?: string;
  nodeType?: FlowNodeType;
  provider?: string;
  modelId?: string;
  source: UsageTelemetry['source'];
  confidence: UsageTelemetry['confidence'];
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  characters?: number;
  durationSeconds?: number;
  imageCount?: number;
  notes?: string[];
}

export interface ProjectUsageLedgerSnapshot {
  version: 1;
  entries: ProjectUsageLedgerEntry[];
}

export interface ProjectUsageLedgerBucket {
  key: string;
  totalKnownCostUsd: number;
  knownCostEntryCount: number;
  unknownCostEntryCount: number;
  entryCount: number;
}

export interface ProjectUsageLedgerSummary {
  totalKnownCostUsd: number;
  knownCostEntryCount: number;
  unknownCostEntryCount: number;
  entryCount: number;
  byProvider: ProjectUsageLedgerBucket[];
  byModel: ProjectUsageLedgerBucket[];
  byOperation: ProjectUsageLedgerBucket[];
  byWorkspace: ProjectUsageLedgerBucket[];
}

interface CreateProjectUsageEntryInput {
  nodeId?: string;
  nodeType?: FlowNodeType;
  nodeData?: Pick<NodeData, 'imageOperation' | 'audioGenerationMode' | 'mediaMode' | 'mode'>;
  workspace: WorkspaceView;
  flowWorkspaceId?: string;
  flowWorkspaceName?: string;
  usage: UsageTelemetry;
  createdAt?: number;
  operation?: string;
}

export function createProjectUsageEntryFromTelemetry(input: CreateProjectUsageEntryInput): ProjectUsageLedgerEntry {
  const createdAt = input.createdAt ?? Date.now();
  const nodeType = isFlowNodeType(input.nodeType) ? input.nodeType : undefined;
  const operation = input.operation ?? resolveUsageOperation(nodeType, input.nodeData);
  return {
    id: buildProjectUsageEntryId(
      input.nodeId,
      input.usage,
      createdAt,
      operation,
      input.workspace === 'flow' ? input.flowWorkspaceId : undefined,
    ),
    createdAt,
    workspace: input.workspace,
    flowWorkspaceId: sanitizeFlowWorkspaceId(input.workspace, input.flowWorkspaceId),
    flowWorkspaceName: sanitizeFlowWorkspaceName(input.workspace, input.flowWorkspaceName),
    operation,
    nodeId: input.nodeId,
    nodeType,
    provider: input.usage.provider,
    modelId: input.usage.modelId,
    source: input.usage.source,
    confidence: input.usage.confidence,
    costUsd: finiteOptionalNumber(input.usage.costUsd),
    inputTokens: finiteOptionalNumber(input.usage.inputTokens),
    outputTokens: finiteOptionalNumber(input.usage.outputTokens),
    totalTokens: finiteOptionalNumber(input.usage.totalTokens),
    characters: finiteOptionalNumber(input.usage.characters),
    durationSeconds: finiteOptionalNumber(input.usage.durationSeconds),
    imageCount: finiteOptionalNumber(input.usage.imageCount),
    notes: sanitizeNotes(input.usage.notes),
  };
}

export function appendProjectUsageEntry(
  snapshot: ProjectUsageLedgerSnapshot | undefined,
  entry: ProjectUsageLedgerEntry,
): ProjectUsageLedgerSnapshot {
  const current = sanitizeProjectUsageLedgerSnapshot(snapshot);
  if (current.entries.some((candidate) => candidate.id === entry.id)) {
    return current;
  }
  return {
    version: 1,
    entries: [...current.entries, entry],
  };
}

export function summarizeProjectUsageLedger(
  snapshot: ProjectUsageLedgerSnapshot | undefined,
): ProjectUsageLedgerSummary {
  const entries = sanitizeProjectUsageLedgerSnapshot(snapshot).entries;
  const knownEntries = entries.filter((entry) => typeof entry.costUsd === 'number');
  const totalKnownCostUsd = roundUsd(knownEntries.reduce((total, entry) => total + (entry.costUsd ?? 0), 0));
  const unknownCostEntryCount = entries.length - knownEntries.length;
  return {
    totalKnownCostUsd,
    knownCostEntryCount: knownEntries.length,
    unknownCostEntryCount,
    entryCount: entries.length,
    byProvider: summarizeBuckets(entries, (entry) => entry.provider ?? 'unknown-provider'),
    byModel: summarizeBuckets(entries, (entry) => entry.modelId ?? 'unknown-model'),
    byOperation: summarizeBuckets(entries, (entry) => entry.operation),
    byWorkspace: summarizeBuckets(entries, (entry) => entry.workspace),
  };
}

export function sanitizeProjectUsageLedgerSnapshot(value: unknown): ProjectUsageLedgerSnapshot {
  if (!isRecord(value)) {
    return { version: 1, entries: [] };
  }
  const entries = Array.isArray(value.entries)
    ? value.entries.flatMap((entry) => sanitizeProjectUsageLedgerEntry(entry) ?? [])
    : [];
  return { version: 1, entries };
}

function sanitizeProjectUsageLedgerEntry(value: unknown): ProjectUsageLedgerEntry | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const workspace = stringValue(value.workspace);
  const operation = stringValue(value.operation);
  const source = stringValue(value.source);
  const confidence = stringValue(value.confidence);
  if (!id || !workspace || !operation || !isUsageSource(source) || !isUsageConfidence(confidence)) {
    return undefined;
  }
  const normalizedWorkspace = isWorkspaceView(workspace) ? workspace : 'flow';
  return {
    id,
    createdAt: finiteNumber(value.createdAt, Date.now()),
    workspace: normalizedWorkspace,
    flowWorkspaceId: sanitizeFlowWorkspaceId(normalizedWorkspace, stringValue(value.flowWorkspaceId)),
    flowWorkspaceName: sanitizeFlowWorkspaceName(normalizedWorkspace, stringValue(value.flowWorkspaceName)),
    operation,
    nodeId: stringValue(value.nodeId),
    nodeType: isFlowNodeType(value.nodeType) ? value.nodeType : undefined,
    provider: stringValue(value.provider),
    modelId: stringValue(value.modelId),
    source,
    confidence,
    costUsd: finiteOptionalNumber(value.costUsd),
    inputTokens: finiteOptionalNumber(value.inputTokens),
    outputTokens: finiteOptionalNumber(value.outputTokens),
    totalTokens: finiteOptionalNumber(value.totalTokens),
    characters: finiteOptionalNumber(value.characters),
    durationSeconds: finiteOptionalNumber(value.durationSeconds),
    imageCount: finiteOptionalNumber(value.imageCount),
    notes: sanitizeNotes(value.notes),
  };
}

function summarizeBuckets(
  entries: ProjectUsageLedgerEntry[],
  keyForEntry: (entry: ProjectUsageLedgerEntry) => string,
): ProjectUsageLedgerBucket[] {
  const buckets = new Map<string, ProjectUsageLedgerBucket>();
  for (const entry of entries) {
    const key = keyForEntry(entry);
    const bucket = buckets.get(key) ?? {
      key,
      totalKnownCostUsd: 0,
      knownCostEntryCount: 0,
      unknownCostEntryCount: 0,
      entryCount: 0,
    };
    bucket.entryCount += 1;
    if (typeof entry.costUsd === 'number') {
      bucket.knownCostEntryCount += 1;
      bucket.totalKnownCostUsd = roundUsd(bucket.totalKnownCostUsd + entry.costUsd);
    } else {
      bucket.unknownCostEntryCount += 1;
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => (
    right.totalKnownCostUsd - left.totalKnownCostUsd
    || right.entryCount - left.entryCount
    || left.key.localeCompare(right.key)
  ));
}

function resolveUsageOperation(
  nodeType: FlowNodeType | undefined,
  nodeData: Pick<NodeData, 'imageOperation' | 'audioGenerationMode' | 'mediaMode' | 'mode'> | undefined,
): string {
  if (nodeType === 'imageGen') {
    return stringValue(nodeData?.imageOperation) ?? 'image-generation';
  }
  if (nodeType === 'cropImageNode') return 'image-crop';
  if (nodeType === 'videoGen') return 'video-generation';
  if (nodeType === 'audioGen') {
    return nodeData?.audioGenerationMode ? `audio-${nodeData.audioGenerationMode}` : 'audio-generation';
  }
  if (nodeType === 'composition') return 'composition-render';
  if (nodeType === 'textNode') return 'text-generation';
  return nodeType ?? 'unknown-operation';
}

function buildProjectUsageEntryId(
  nodeId: string | undefined,
  usage: UsageTelemetry,
  createdAt: number,
  operation: string | undefined,
  flowWorkspaceId?: string,
): string {
  const parts = [
    nodeId ?? 'workspace',
    flowWorkspaceId ?? 'flow-workspace',
    usage.provider ?? 'unknown',
    usage.modelId ?? 'model',
    operation ?? 'operation',
    String(createdAt),
  ];
  return parts.join(':').replace(/[^a-z0-9:_-]/gi, '-');
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeNotes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const notes = value.filter((note): note is string => typeof note === 'string' && note.trim().length > 0);
  return notes.length > 0 ? notes : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUsageSource(value: unknown): value is UsageTelemetry['source'] {
  return value === 'actual' || value === 'estimate';
}

function isUsageConfidence(value: unknown): value is UsageTelemetry['confidence'] {
  return value === 'measured' || value === 'heuristic' || value === 'fixed' || value === 'unknown';
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return value === 'flow' || value === 'editor' || value === 'image' || value === 'paper';
}

function sanitizeFlowWorkspaceId(
  workspace: unknown,
  flowWorkspaceId: string | undefined,
): string | undefined {
  return workspace === 'flow' ? flowWorkspaceId : undefined;
}

function sanitizeFlowWorkspaceName(
  workspace: unknown,
  flowWorkspaceName: string | undefined,
): string | undefined {
  return workspace === 'flow' ? flowWorkspaceName : undefined;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
