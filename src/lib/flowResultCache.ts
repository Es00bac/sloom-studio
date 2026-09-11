import type { ExecutionContext } from './flowExecution';
import type {
  AppNode,
  ProviderSettings,
  ResultType,
  ResultValue,
  RuntimeSettingsSnapshot,
} from '../types/flow';

/** A bounded, process-local cache entry for one successful Flow node output. */
export interface FlowResultCacheEntry {
  key: string;
  nodeId: string;
  nodeInstanceId?: string;
  result: ResultValue;
  resultType: ResultType;
  /** Only completed provider results are eligible for replay. */
  status: 'succeeded' | 'failed' | 'cancelled';
  resultMimeType?: string;
  resultExtension?: string;
  resultFileName?: string;
  resultOutputMetadata?: Record<string, unknown>;
  sourceBinItemId?: string;
  statusMessage: string;
  createdAt: string;
}

export interface FlowResultCacheKeyInput {
  node: Pick<AppNode, 'id' | 'data'>;
  nodeData: unknown;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  iterationIndex?: number;
}

const MAX_ENTRIES = 128;
const entries = new Map<string, FlowResultCacheEntry>();

function stableSerialize(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Blob) return JSON.stringify({ blobType: value.type, blobSize: value.size });
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined && typeof nested !== 'function' && typeof nested !== 'symbol')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
    .join(',')}}`;
}

/**
 * Only settings that can change executable routing, model selection, or retry/output behavior
 * belong in a cache identity. Credential material and unknown future fields are deliberately
 * excluded by construction rather than filtered by a best-effort secret-name regex.
 */
type FlowResultCacheProviderSettings = Pick<ProviderSettings,
  | 'openaiBaseUrl'
  | 'elevenlabsVoiceId'
  | 'renderBackendPreference'
  | 'exportCompositorPreference'
  | 'localNativeRenderUrl'
  | 'backendProxyEnabled'
  | 'backendProxyBaseUrl'
  | 'geminiCredentialMode'
  | 'vertexAuthMode'
  | 'vertexProjectId'
  | 'vertexLocation'
  | 'vertexQuotaProjectId'
  | 'paperPrintUpscaleMethod'
  | 'paperPdfRasterPreset'
  | 'localOpenImageEndpointUrl'
  | 'localOpenImageDefaultModel'
  | 'genericImageEndpointUrl'
  | 'localAiCpuEndpointUrl'
  | 'localAiCpuModel'
  | 'atlasBaseUrl'
  | 'bytePlusBaseUrl'
  | 'androidAcceleratorBaseUrl'
  | 'androidAcceleratorDefaultUpscaler'
  | 'androidAcceleratorDefaultImageModel'
  | 'batchMaxRetries'
  | 'batchRetryBaseDelayMs'
  | 'androidLanServerEnabled'
>;

/**
 * Keep endpoint identity useful for execution invalidation without carrying URL credentials
 * or request metadata into persisted cache signatures. Malformed values are omitted rather than
 * echoed back, so an invalid endpoint can never leak its original text through the fallback.
 */
function safeEndpointIdentity(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    const parsed = new URL(endpoint);
    if (!parsed.origin || parsed.origin === 'null' || !parsed.hostname) return undefined;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function flowResultCacheProviderSettings(settings: ProviderSettings): FlowResultCacheProviderSettings {
  return {
    openaiBaseUrl: safeEndpointIdentity(settings.openaiBaseUrl) ?? '',
    elevenlabsVoiceId: settings.elevenlabsVoiceId,
    renderBackendPreference: settings.renderBackendPreference,
    exportCompositorPreference: settings.exportCompositorPreference,
    localNativeRenderUrl: safeEndpointIdentity(settings.localNativeRenderUrl) ?? '',
    backendProxyEnabled: settings.backendProxyEnabled,
    backendProxyBaseUrl: safeEndpointIdentity(settings.backendProxyBaseUrl) ?? '',
    geminiCredentialMode: settings.geminiCredentialMode,
    vertexAuthMode: settings.vertexAuthMode,
    vertexProjectId: settings.vertexProjectId,
    vertexLocation: settings.vertexLocation,
    vertexQuotaProjectId: settings.vertexQuotaProjectId,
    paperPrintUpscaleMethod: settings.paperPrintUpscaleMethod,
    paperPdfRasterPreset: settings.paperPdfRasterPreset,
    localOpenImageEndpointUrl: safeEndpointIdentity(settings.localOpenImageEndpointUrl),
    localOpenImageDefaultModel: settings.localOpenImageDefaultModel,
    genericImageEndpointUrl: safeEndpointIdentity(settings.genericImageEndpointUrl),
    localAiCpuEndpointUrl: safeEndpointIdentity(settings.localAiCpuEndpointUrl),
    localAiCpuModel: settings.localAiCpuModel,
    atlasBaseUrl: safeEndpointIdentity(settings.atlasBaseUrl),
    bytePlusBaseUrl: safeEndpointIdentity(settings.bytePlusBaseUrl),
    androidAcceleratorBaseUrl: safeEndpointIdentity(settings.androidAcceleratorBaseUrl),
    androidAcceleratorDefaultUpscaler: settings.androidAcceleratorDefaultUpscaler,
    androidAcceleratorDefaultImageModel: settings.androidAcceleratorDefaultImageModel,
    batchMaxRetries: settings.batchMaxRetries,
    batchRetryBaseDelayMs: settings.batchRetryBaseDelayMs,
    androidLanServerEnabled: settings.androidLanServerEnabled,
  };
}

/**
 * The key intentionally includes resolved executable context and provider settings while
 * excluding credentials. It is deterministic across save/reopen and stable for unchanged
 * upstream outputs.
 */
export function createFlowResultCacheKey(input: FlowResultCacheKeyInput): string {
  return stableSerialize({
    version: 1,
    nodeId: input.node.id,
    nodeData: input.nodeData,
    context: input.context,
    settings: {
      defaultModels: input.settings.defaultModels,
      providerSettings: flowResultCacheProviderSettings(input.settings.providerSettings),
    },
    iterationIndex: input.iterationIndex ?? 0,
  });
}

export function isValidFlowResultCacheEntry(
  entry: FlowResultCacheEntry | undefined,
  key: string,
  expectedType?: ResultType,
): entry is FlowResultCacheEntry {
  if (!entry || entry.key !== key || entry.status !== 'succeeded' || entry.statusMessage.trim().length === 0) return false;
  if (expectedType && entry.resultType !== expectedType) return false;
  if (entry.resultType === 'boolean') return typeof entry.result === 'boolean';
  return typeof entry.result === 'string' && entry.result.trim().length > 0;
}

export function getFlowResultCacheEntry(key: string): FlowResultCacheEntry | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  // LRU touch keeps repeated graph reads bounded without allowing unbounded growth.
  entries.delete(key);
  entries.set(key, entry);
  return entry;
}

export function setFlowResultCacheEntry(entry: FlowResultCacheEntry): void {
  if (!isValidFlowResultCacheEntry(entry, entry.key)) return;
  entries.delete(entry.key);
  entries.set(entry.key, { ...entry });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function deleteFlowResultCacheEntry(key: string): void {
  entries.delete(key);
}

export function clearFlowResultCache(): void {
  entries.clear();
}

export function flowResultCacheSize(): number {
  return entries.size;
}
