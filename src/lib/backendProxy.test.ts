import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';
import type { ProviderSettings } from '../types/flow';
import { buildBackendProxyExecuteRequest, shouldUseBackendProxy } from './backendProxy';

/**
 * AUD-012 expected outbound policy, duplicated here on purpose: the implementation must agree
 * with this classification key-for-key, so quietly moving a credential onto the wire requires
 * editing this test as well. Together the two lists must cover every ProviderSettings key.
 *
 * Forwarding is consumption-based: a field is forwarded only when the flow-execution provider
 * paths actually read it. Fields consumed exclusively by client-side code — the Image-editor
 * generic adapter, the client-side auto-upscaler (legacy local route / Android accelerator), the
 * client-native Vertex auth broker, and the client-side retry wrapper that also wraps proxy
 * calls — stay on this device.
 */
const EXPECTED_FORWARDED_PROVIDER_SETTING_KEYS = [
  'openaiBaseUrl',
  'elevenlabsVoiceId',
  'geminiCredentialMode',
  'vertexProjectId',
  'vertexLocation',
  'localOpenImageEndpointUrl',
  'localOpenImageDefaultModel',
  'atlasBaseUrl',
  'bytePlusBaseUrl',
] as const;

const EXPECTED_WITHHELD_PROVIDER_SETTING_KEYS = [
  'renderBackendPreference',
  'exportCompositorPreference',
  'localNativeRenderUrl',
  'localNativeRenderToken',
  'backendProxyEnabled',
  'backendProxyBaseUrl',
  'vertexAuthMode',
  'vertexQuotaProjectId',
  'vertexEnvironmentVariables',
  'vertexServiceAccountJson',
  'paperPrintUpscaleMethod',
  'paperPdfRasterPreset',
  'localOpenImageAuthHeader',
  'genericImageEndpointUrl',
  'genericImageAuthHeader',
  'localAiCpuEndpointUrl',
  'localAiCpuAuthHeader',
  'localAiCpuModel',
  'androidAcceleratorBaseUrl',
  'androidAcceleratorAuthToken',
  'androidAcceleratorDefaultUpscaler',
  'androidAcceleratorDefaultImageModel',
  'batchMaxRetries',
  'batchRetryBaseDelayMs',
  'androidLanServerEnabled',
  'androidLanServerPin',
] as const;

/** Every credential-bearing ProviderSettings field, each carrying a unique traceable sentinel. */
const CREDENTIAL_SENTINELS = {
  localNativeRenderToken: 'SECRET-local-native-render-token',
  vertexEnvironmentVariables: 'GOOGLE_APPLICATION_CREDENTIALS=SECRET-vertex-adc-path',
  vertexServiceAccountJson: '{"type":"service_account","private_key":"SECRET-vertex-private-key"}',
  localOpenImageAuthHeader: 'Bearer SECRET-local-open-image-token',
  genericImageAuthHeader: 'Bearer SECRET-generic-image-token',
  localAiCpuAuthHeader: 'Bearer SECRET-local-cpu-token',
  androidAcceleratorAuthToken: 'SECRET-android-accelerator-token',
  androidLanServerPin: 'SECRET-lan-pin-1234',
} satisfies Partial<ProviderSettings>;

/** Distinct values for every field a proxy legitimately needs to execute a node. */
const NON_SECRET_EXECUTION_VALUES = {
  openaiBaseUrl: 'https://openai-compatible.example/v1',
  elevenlabsVoiceId: 'voice-abc',
  geminiCredentialMode: 'vertex-adc',
  vertexProjectId: 'render-project',
  vertexLocation: 'us-central1',
  localOpenImageEndpointUrl: 'https://lan-image.example/edit',
  localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
  atlasBaseUrl: 'https://api.atlas-cloud.ai',
  bytePlusBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
} satisfies Partial<ProviderSettings>;

function buildHostileProviderSettings(): ProviderSettings {
  return {
    ...DEFAULT_PROVIDER_SETTINGS,
    ...NON_SECRET_EXECUTION_VALUES,
    ...CREDENTIAL_SENTINELS,
    // Client-only fields that must never travel even though their values are strings/numbers:
    genericImageEndpointUrl: 'https://SECRET-generic-editor-endpoint.example/generate',
    localAiCpuEndpointUrl: 'https://SECRET-local-cpu-endpoint.example/upscale',
    localAiCpuModel: 'SECRET-local-cpu-model',
    // Hostile / future shapes an allowlist must drop even though they are not typed today:
    apiKeys: { openai: 'SECRET-nested-api-key' },
    futureAuthBlock: { serviceAccount: { private_key: 'SECRET-future-private-key' } },
  } as unknown as ProviderSettings;
}

function buildRequestFromHostileSettings() {
  return buildBackendProxyExecuteRequest({
    baseUrl: 'https://proxy.local/',
    node: { id: 'node-1', type: 'imageGen', data: { prompt: 'hello', imageAutoUpscale: true } },
    context: { prompt: 'hello' },
    settings: {
      defaultModels: { text: { gemini: 'gemini-3' }, image: { openai: 'gpt-image-1' } },
      providerSettings: buildHostileProviderSettings(),
    },
  });
}

/** Depth-first collection of every string value reachable anywhere in a JSON-ish structure. */
function collectStringValues(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStringValues(entry, found);
  }
  return found;
}

describe('backend proxy settings', () => {
  it('only enables proxy mode when both enabled and a base URL are present', () => {
    expect(shouldUseBackendProxy({ backendProxyEnabled: true, backendProxyBaseUrl: 'https://proxy.local' })).toBe(true);
    expect(shouldUseBackendProxy({ backendProxyEnabled: true, backendProxyBaseUrl: '   ' })).toBe(false);
    expect(shouldUseBackendProxy({ backendProxyEnabled: false, backendProxyBaseUrl: 'https://proxy.local' })).toBe(false);
  });

  it('builds an execute-node request without browser provider keys', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local/',
      node: { id: 'node-1', type: 'textNode', data: { prompt: 'hello' } },
      context: { prompt: 'hello' },
      settings: {
        defaultModels: { text: { gemini: 'gemini' } },
        providerSettings: { backendProxyEnabled: true, backendProxyBaseUrl: 'https://proxy.local/' },
      },
    });

    expect(request.url).toBe('https://proxy.local/api/flow/execute-node');
    expect(request.body).not.toHaveProperty('apiKeys');
    expect(request.body).toMatchObject({
      node: { id: 'node-1' },
      context: { prompt: 'hello' },
    });
  });
});

describe('backend proxy execution settings DTO (AUD-012)', () => {
  it('classifies every ProviderSettings key exactly once (drift guard)', () => {
    const classified = [
      ...EXPECTED_FORWARDED_PROVIDER_SETTING_KEYS,
      ...EXPECTED_WITHHELD_PROVIDER_SETTING_KEYS,
    ];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(Object.keys(DEFAULT_PROVIDER_SETTINGS).sort());
  });

  it('stamps the outbound settings DTO with an explicit schema version', () => {
    const request = buildRequestFromHostileSettings();
    expect(request.body.settings.version).toBe(1);
  });

  it('withholds every credential-bearing value recursively, including hostile nesting', () => {
    const request = buildRequestFromHostileSettings();

    // No string anywhere in the outbound body may carry a planted secret.
    const strings = collectStringValues(request.body);
    const leaked = strings.filter((value) => value.includes('SECRET-'));
    expect(leaked).toEqual([]);

    // Belt and braces: the serialized wire payload (keys included) is also clean.
    expect(JSON.stringify(request.body)).not.toContain('SECRET-');

    // Each known credential field is structurally absent, not blanked or renamed.
    for (const key of Object.keys(CREDENTIAL_SENTINELS)) {
      expect(request.body.settings.providerSettings, `credential field forwarded: ${key}`).not.toHaveProperty(key);
    }
    expect(request.body.settings.providerSettings).not.toHaveProperty('apiKeys');
    expect(request.body.settings.providerSettings).not.toHaveProperty('futureAuthBlock');
  });

  it('withholds fields consumed only by client-side code (editor adapter, upscaler, retry wrapper, native auth)', () => {
    const request = buildRequestFromHostileSettings();
    const forwarded = request.body.settings.providerSettings as Record<string, unknown>;

    for (const key of [
      'genericImageEndpointUrl',
      'localAiCpuEndpointUrl',
      'localAiCpuModel',
      'batchMaxRetries',
      'batchRetryBaseDelayMs',
      'vertexAuthMode',
      'vertexQuotaProjectId',
      'paperPrintUpscaleMethod',
    ]) {
      expect(forwarded, `client-only field forwarded: ${key}`).not.toHaveProperty(key);
    }
  });

  it('forwards only allowlisted keys, and all required non-secret execution settings survive', () => {
    const request = buildRequestFromHostileSettings();
    const forwarded = request.body.settings.providerSettings as Record<string, unknown>;

    const allowlist = new Set<string>(EXPECTED_FORWARDED_PROVIDER_SETTING_KEYS);
    for (const key of Object.keys(forwarded)) {
      expect(allowlist.has(key), `unexpected forwarded provider setting: ${key}`).toBe(true);
    }

    for (const [key, value] of Object.entries(NON_SECRET_EXECUTION_VALUES)) {
      expect(forwarded[key], `missing required execution setting: ${key}`).toBe(value);
    }

    // The node payload itself is not restructured: execution options like the auto-upscale
    // request stay visible to the run (the client applies upscaling after the proxy returns).
    expect((request.body.node as { data: Record<string, unknown> }).data.imageAutoUpscale).toBe(true);
  });

  it('drops non-primitive values even for allowlisted keys', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local',
      node: {},
      context: {},
      settings: {
        defaultModels: {},
        providerSettings: {
          openaiBaseUrl: { smuggled: 'SECRET-object-valued-base-url' },
          atlasBaseUrl: 'https://api.atlas-cloud.ai',
        } as unknown as Partial<ProviderSettings>,
      },
    });

    expect(request.body.settings.providerSettings).not.toHaveProperty('openaiBaseUrl');
    expect(JSON.stringify(request.body)).not.toContain('SECRET-');
    expect((request.body.settings.providerSettings as Record<string, unknown>).atlasBaseUrl)
      .toBe('https://api.atlas-cloud.ai');
  });

  it('forwards endpoint URLs by safe components only: no userinfo, query, or fragment', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local',
      node: {},
      context: {},
      settings: {
        defaultModels: {},
        providerSettings: {
          // Userinfo makes the whole field untrustworthy: dropped, not stripped-and-forwarded.
          openaiBaseUrl: 'https://SECRET-url-user:SECRET-url-pass@openai.example/v1',
          // Query and fragment components never travel, whatever their keys are called.
          atlasBaseUrl: 'https://atlas.example/api?api_key=SECRET-query-key&region=eu#SECRET-fragment',
          // Non-HTTP(S) schemes and unparseable values are dropped entirely.
          bytePlusBaseUrl: 'ftp://byteplus.example/api/v3',
          localOpenImageEndpointUrl: 'not a url at all',
        } as Partial<ProviderSettings>,
      },
    });

    const forwarded = request.body.settings.providerSettings as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('openaiBaseUrl');
    expect(forwarded.atlasBaseUrl).toBe('https://atlas.example/api');
    expect(forwarded).not.toHaveProperty('bytePlusBaseUrl');
    expect(forwarded).not.toHaveProperty('localOpenImageEndpointUrl');
    expect(JSON.stringify(request.body)).not.toContain('SECRET-');
  });

  it('keeps ports and paths of clean endpoint URLs byte-stable', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local',
      node: {},
      context: {},
      settings: {
        defaultModels: {},
        providerSettings: {
          openaiBaseUrl: 'http://127.0.0.1:8188/v1',
          atlasBaseUrl: 'https://api.atlas-cloud.ai',
        } as Partial<ProviderSettings>,
      },
    });

    const forwarded = request.body.settings.providerSettings as Record<string, unknown>;
    expect(forwarded.openaiBaseUrl).toBe('http://127.0.0.1:8188/v1');
    expect(forwarded.atlasBaseUrl).toBe('https://api.atlas-cloud.ai');
  });

  it('rebuilds defaultModels from the four capabilities with string-valued entries only', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local',
      node: {},
      context: {},
      settings: {
        defaultModels: {
          text: { gemini: 'gemini-3', broken: 42 },
          image: { openai: { smuggled: 'SECRET-model-object' } },
          video: { atlas: 'google/veo3.1/text-to-video' },
          rogueCapability: { provider: 'SECRET-rogue-model' },
        },
        providerSettings: {},
      },
    });

    const models = request.body.settings.defaultModels as Record<string, Record<string, unknown>>;
    expect(models.text).toEqual({ gemini: 'gemini-3' });
    expect(models.image).toEqual({});
    expect(models.video).toEqual({ atlas: 'google/veo3.1/text-to-video' });
    expect(models.audio).toEqual({});
    expect(models).not.toHaveProperty('rogueCapability');
    expect(JSON.stringify(request.body)).not.toContain('SECRET-');
  });

  it('forwards defaultModels only under the known provider keys of each capability', () => {
    const request = buildBackendProxyExecuteRequest({
      baseUrl: 'https://proxy.local',
      node: {},
      context: {},
      settings: {
        defaultModels: {
          // A string value under an unknown alias must not travel; a legitimate model name
          // under a real provider passes through as-is (its content is not interpretable here).
          text: { gemini: 'gemini-3', rogueAlias: 'SECRET-string-under-rogue-alias' },
          // Provider keys are per-capability: elevenlabs is an audio provider, not an image one.
          image: { byteplus: 'seedream-4.5', elevenlabs: 'SECRET-cross-capability-smuggle' },
          audio: { elevenlabs: 'eleven_multilingual_v2' },
          video: { atlas: 'google/veo3.1/text-to-video', openai: 'SECRET-not-a-video-provider' },
        },
        providerSettings: {},
      },
    });

    const models = request.body.settings.defaultModels as Record<string, Record<string, unknown>>;
    expect(models.text).toEqual({ gemini: 'gemini-3' });
    expect(models.image).toEqual({ byteplus: 'seedream-4.5' });
    expect(models.audio).toEqual({ elevenlabs: 'eleven_multilingual_v2' });
    expect(models.video).toEqual({ atlas: 'google/veo3.1/text-to-video' });
    expect(JSON.stringify(request.body)).not.toContain('SECRET-');
  });
});
