import type {
  AudioProvider,
  DefaultModelSettings,
  ImageProvider,
  ProviderSettings,
  TextProvider,
  VideoProvider,
} from '../types/flow';
import { sanitizeReferenceGroupsForProxy } from './referenceGroups';

export interface BackendProxySettingsLike {
  backendProxyEnabled?: boolean;
  backendProxyBaseUrl?: string;
}

export interface BackendProxyExecuteRequestInput {
  baseUrl: string;
  node: unknown;
  context: unknown;
  settings: {
    defaultModels: Partial<DefaultModelSettings> | Record<string, unknown>;
    providerSettings: Partial<ProviderSettings> | Record<string, unknown>;
  };
}

/**
 * Version stamp of the outbound execution-settings DTO. The consuming proxy service is external —
 * this repository ships no server implementation or shared schema — so this constant together
 * with the policy map below IS the client-side half of the contract. Bump it whenever the
 * forwarded shape changes so an external implementation can validate or dispatch on the shape it
 * receives; how any existing external server treats an unknown field or version cannot be
 * verified from this repository.
 */
export const BACKEND_PROXY_EXECUTION_SETTINGS_VERSION = 1;

/**
 * Outbound policy for every ProviderSettings field (AUD-012). The proxy body is BUILT from the
 * forwarding entries — never by copying the settings object and deleting secrets — so a field the
 * policy does not know about can never reach the wire. `satisfies` keeps the map exhaustive:
 * adding a ProviderSettings field refuses to compile until it is explicitly classified here.
 *
 * Forwarding is consumption-based: a field travels only when the flow-execution provider paths
 * genuinely read it to run a node ('forward' for plain values, 'forward-endpoint' for URLs that
 * are additionally reduced to safe components — see sanitizeForwardedEndpointUrl). Everything
 * credential-like (tokens, auth headers, service-account JSON, ADC environment variables, PINs)
 * is withheld, as is everything consumed only by client-side code: the Image-editor generic
 * adapter (genericImage*), the client-side auto-upscaler (localAiCpu*, androidAccelerator*,
 * paperPrintUpscaleMethod — upscaling is post-processing applied on this device, including to
 * proxied results), the client-native Vertex auth broker (vertexAuthMode, vertexQuotaProjectId),
 * the client-side retry wrapper that also wraps proxy calls (batch*), local render/export
 * preferences, Paper output presets, and the proxy's own address.
 */
const PROVIDER_SETTING_EXECUTION_POLICY = {
  openaiBaseUrl: 'forward-endpoint',
  elevenlabsVoiceId: 'forward',
  renderBackendPreference: 'withhold',
  exportCompositorPreference: 'withhold',
  localNativeRenderUrl: 'withhold',
  localNativeRenderToken: 'withhold',
  backendProxyEnabled: 'withhold',
  backendProxyBaseUrl: 'withhold',
  geminiCredentialMode: 'forward',
  vertexAuthMode: 'withhold',
  vertexProjectId: 'forward',
  vertexLocation: 'forward',
  vertexQuotaProjectId: 'withhold',
  vertexEnvironmentVariables: 'withhold',
  vertexServiceAccountJson: 'withhold',
  paperPrintUpscaleMethod: 'withhold',
  paperPdfRasterPreset: 'withhold',
  localOpenImageEndpointUrl: 'forward-endpoint',
  localOpenImageAuthHeader: 'withhold',
  localOpenImageDefaultModel: 'forward',
  genericImageEndpointUrl: 'withhold',
  genericImageAuthHeader: 'withhold',
  localAiCpuEndpointUrl: 'withhold',
  localAiCpuAuthHeader: 'withhold',
  localAiCpuModel: 'withhold',
  atlasBaseUrl: 'forward-endpoint',
  bytePlusBaseUrl: 'forward-endpoint',
  androidAcceleratorBaseUrl: 'withhold',
  androidAcceleratorAuthToken: 'withhold',
  androidAcceleratorDefaultUpscaler: 'withhold',
  androidAcceleratorDefaultImageModel: 'withhold',
  batchMaxRetries: 'withhold',
  batchRetryBaseDelayMs: 'withhold',
  androidLanServerEnabled: 'withhold',
  androidLanServerPin: 'withhold',
} as const satisfies Record<keyof ProviderSettings, 'forward' | 'forward-endpoint' | 'withhold'>;

type ProviderSettingExecutionPolicy = typeof PROVIDER_SETTING_EXECUTION_POLICY;

export type BackendProxyForwardedProviderSettingKey = {
  [TKey in keyof ProviderSettingExecutionPolicy]: ProviderSettingExecutionPolicy[TKey] extends 'withhold'
    ? never
    : TKey;
}[keyof ProviderSettingExecutionPolicy];

/** The allowlisted, credential-free ProviderSettings subset a proxy request may carry. */
export type BackendProxyForwardedProviderSettings = Partial<
  Pick<ProviderSettings, BackendProxyForwardedProviderSettingKey>
>;

export const BACKEND_PROXY_FORWARDED_PROVIDER_SETTING_KEYS = (
  Object.keys(PROVIDER_SETTING_EXECUTION_POLICY) as Array<keyof ProviderSettings>
).filter(
  (key): key is BackendProxyForwardedProviderSettingKey =>
    PROVIDER_SETTING_EXECUTION_POLICY[key] !== 'withhold',
);

const DEFAULT_MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;

/**
 * Per-capability provider keys a defaultModels entry may travel under. Exhaustive both ways via
 * `satisfies Record<Provider, true>`: a provider added to a capability union refuses to compile
 * until listed, and an alias that is not a real provider of that capability never reaches the
 * wire — model VALUES under valid providers pass through as-is, since an arbitrary legitimate
 * model name is not interpretable at this boundary.
 */
const TEXT_PROVIDER_KEYS = {
  gemini: true,
  openai: true,
  huggingface: true,
} as const satisfies Record<TextProvider, true>;

const IMAGE_PROVIDER_KEYS = {
  gemini: true,
  openai: true,
  huggingface: true,
  bfl: true,
  stability: true,
  localOpen: true,
  android: true,
  atlas: true,
  byteplus: true,
} as const satisfies Record<ImageProvider, true>;

const VIDEO_PROVIDER_KEYS = {
  gemini: true,
  huggingface: true,
  atlas: true,
} as const satisfies Record<VideoProvider, true>;

const AUDIO_PROVIDER_KEYS = {
  gemini: true,
  elevenlabs: true,
  huggingface: true,
} as const satisfies Record<AudioProvider, true>;

const CAPABILITY_PROVIDER_KEYS: Record<
  (typeof DEFAULT_MODEL_CAPABILITIES)[number],
  Record<string, true>
> = {
  text: TEXT_PROVIDER_KEYS,
  image: IMAGE_PROVIDER_KEYS,
  video: VIDEO_PROVIDER_KEYS,
  audio: AUDIO_PROVIDER_KEYS,
};

export type BackendProxyDefaultModels = Record<
  (typeof DEFAULT_MODEL_CAPABILITIES)[number],
  Record<string, string>
>;

/** Versioned, explicitly allowlisted execution settings — the only settings shape sent to a proxy. */
export interface BackendProxyExecutionSettings {
  version: typeof BACKEND_PROXY_EXECUTION_SETTINGS_VERSION;
  defaultModels: BackendProxyDefaultModels;
  providerSettings: BackendProxyForwardedProviderSettings;
}

export interface BackendProxyExecuteRequest {
  url: string;
  body: {
    node: unknown;
    context: unknown;
    settings: BackendProxyExecutionSettings;
  };
}

export function shouldUseBackendProxy(settings: BackendProxySettingsLike): boolean {
  return Boolean(settings.backendProxyEnabled && settings.backendProxyBaseUrl?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reduce a forwarded endpoint URL to safe components: http(s) scheme, host, port, and path only.
 * Query and fragment never travel; a URL carrying userinfo — whose semantics we cannot preserve
 * without forwarding a credential — drops the whole field, as do unparseable or non-HTTP values.
 * This is component reconstruction, not pattern redaction.
 */
function sanitizeForwardedEndpointUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return undefined;
  }

  return parsed.pathname === '/' ? parsed.origin : `${parsed.origin}${parsed.pathname}`;
}

function buildForwardedProviderSettings(source: unknown): BackendProxyForwardedProviderSettings {
  const record = isRecord(source) ? source : {};
  const forwarded: Record<string, string | number | boolean> = {};

  for (const key of BACKEND_PROXY_FORWARDED_PROVIDER_SETTING_KEYS) {
    const value = record[key];

    if (PROVIDER_SETTING_EXECUTION_POLICY[key] === 'forward-endpoint') {
      if (typeof value === 'string') {
        const safeEndpoint = sanitizeForwardedEndpointUrl(value);
        if (safeEndpoint !== undefined) {
          forwarded[key] = safeEndpoint;
        }
      }
      continue;
    }

    // Primitives only: an object smuggled into an allowlisted slot never travels.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      forwarded[key] = value;
    }
  }

  return forwarded as BackendProxyForwardedProviderSettings;
}

function buildForwardedDefaultModels(source: unknown): BackendProxyDefaultModels {
  const record = isRecord(source) ? source : {};
  const models = {} as BackendProxyDefaultModels;

  for (const capability of DEFAULT_MODEL_CAPABILITIES) {
    const entries = record[capability];
    const knownProviders = CAPABILITY_PROVIDER_KEYS[capability];
    const forwarded: Record<string, string> = {};
    if (isRecord(entries)) {
      for (const [provider, modelId] of Object.entries(entries)) {
        if (typeof modelId === 'string' && Object.prototype.hasOwnProperty.call(knownProviders, provider)) {
          forwarded[provider] = modelId;
        }
      }
    }
    models[capability] = forwarded;
  }

  return models;
}

/**
 * AUD-011: numbered reference groups travel to the proxy as an explicitly rebuilt, bounded,
 * JSON-safe DTO — the sanitizer rebuilds every group from an allowlist (so stray or
 * credential-shaped keys never travel) and rejects malformed or oversized guidance with a
 * non-retryable diagnostic BEFORE any network or provider work. Contexts without groups pass
 * through untouched.
 */
function buildForwardedExecutionContext(context: unknown): unknown {
  if (!isRecord(context) || !('referenceGroups' in context)) {
    return context;
  }
  const sanitizedGroups = sanitizeReferenceGroupsForProxy(context.referenceGroups);
  const { referenceGroups: _referenceGroups, ...rest } = context;
  return sanitizedGroups === undefined ? rest : { ...rest, referenceGroups: sanitizedGroups };
}

export function buildBackendProxyExecuteRequest(
  input: BackendProxyExecuteRequestInput,
): BackendProxyExecuteRequest {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');

  return {
    url: `${baseUrl}/api/flow/execute-node`,
    body: {
      node: input.node,
      context: buildForwardedExecutionContext(input.context),
      settings: {
        version: BACKEND_PROXY_EXECUTION_SETTINGS_VERSION,
        defaultModels: buildForwardedDefaultModels(input.settings.defaultModels),
        providerSettings: buildForwardedProviderSettings(input.settings.providerSettings),
      },
    },
  };
}
