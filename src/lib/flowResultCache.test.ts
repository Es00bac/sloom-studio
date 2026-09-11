import { describe, expect, it } from 'vitest';
import {
  clearFlowResultCache,
  createFlowResultCacheKey,
  flowResultCacheSize,
  getFlowResultCacheEntry,
  isValidFlowResultCacheEntry,
  setFlowResultCacheEntry,
} from './flowResultCache';
import type { RuntimeSettingsSnapshot } from '../types/flow';

const settings = {
  apiKeys: { gemini: 'secret-a' },
  defaultModels: { text: { gemini: 'text-a' }, image: {}, video: {}, audio: {} },
  providerSettings: { batchMaxRetries: 2, backendProxyBaseUrl: 'http://proxy-a', backendProxyAuthToken: 'secret-b' },
} as unknown as RuntimeSettingsSnapshot;

const node = { id: 'node-a', data: { nodeInstanceId: 'instance-a' } } as never;
const context = { prompt: 'hello' } as never;

describe('flow result cache', () => {
  it('builds deterministic keys from executable inputs and redacts credentials', () => {
    const first = createFlowResultCacheKey({ node, nodeData: { provider: 'gemini', modelId: 'text-a' }, context, settings });
    const second = createFlowResultCacheKey({
      node,
      nodeData: { modelId: 'text-a', provider: 'gemini' },
      context,
      settings: { ...settings, apiKeys: { ...settings.apiKeys, gemini: 'different' } },
    });
    expect(first).toBe(second);
    expect(first).not.toContain('secret');
    expect(first).toContain('text-a');
  });

  it('keeps safe execution settings in the identity while excluding credential-shaped settings', () => {
    const secureSettings = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        vertexServiceAccountJson: '{"private_key":"VERTEX_PRIVATE_KEY_SHOULD_NOT_APPEAR"}',
        androidLanServerPin: 'ANDROID_PIN_SHOULD_NOT_APPEAR',
        localOpenImageAuthHeader: 'Bearer LOCAL_OPEN_SECRET_SHOULD_NOT_APPEAR',
        genericImageAuthHeader: 'Bearer GENERIC_SECRET_SHOULD_NOT_APPEAR',
        localAiCpuAuthHeader: 'Bearer CPU_SECRET_SHOULD_NOT_APPEAR',
        androidAcceleratorAuthToken: 'ANDROID_TOKEN_SHOULD_NOT_APPEAR',
        localNativeRenderToken: 'NATIVE_TOKEN_SHOULD_NOT_APPEAR',
        backendProxyAuthToken: 'PROXY_TOKEN_SHOULD_NOT_APPEAR',
        batchMaxRetries: 2,
      },
    } as RuntimeSettingsSnapshot;
    const changedSafeSettings = {
      ...secureSettings,
      providerSettings: {
        ...secureSettings.providerSettings,
        batchMaxRetries: 3,
      },
    };
    const first = createFlowResultCacheKey({
      node,
      nodeData: { provider: 'gemini', modelId: 'text-a' },
      context,
      settings: secureSettings,
    });
    const changed = createFlowResultCacheKey({
      node,
      nodeData: { provider: 'gemini', modelId: 'text-a' },
      context,
      settings: changedSafeSettings,
    });

    expect(first).toContain('batchMaxRetries');
    expect(first).toContain('"batchMaxRetries":2');
    expect(changed).not.toBe(first);
    for (const secret of [
      'VERTEX_PRIVATE_KEY_SHOULD_NOT_APPEAR',
      'ANDROID_PIN_SHOULD_NOT_APPEAR',
      'LOCAL_OPEN_SECRET_SHOULD_NOT_APPEAR',
      'GENERIC_SECRET_SHOULD_NOT_APPEAR',
      'CPU_SECRET_SHOULD_NOT_APPEAR',
      'ANDROID_TOKEN_SHOULD_NOT_APPEAR',
      'NATIVE_TOKEN_SHOULD_NOT_APPEAR',
      'PROXY_TOKEN_SHOULD_NOT_APPEAR',
    ]) {
      expect(first).not.toContain(secret);
    }
    expect(first).not.toContain('vertexServiceAccountJson');
    expect(first).not.toContain('androidLanServerPin');
  });

  it('normalizes endpoint identity to origin and path while dropping URL credentials and request metadata', () => {
    const endpointSettings = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        openaiBaseUrl: 'https://user:URL_PASSWORD@example.test/v1?api_key=URL_QUERY_SECRET#URL_FRAGMENT_SECRET',
        localNativeRenderUrl: 'https://native.example.test/render?token=NATIVE_QUERY_SECRET#NATIVE_FRAGMENT_SECRET',
        backendProxyBaseUrl: 'https://proxy.example.test/api?access_token=PROXY_QUERY_SECRET',
        genericImageEndpointUrl: 'not-a-valid-url?token=MALFORMED_URL_SECRET',
      },
    } as RuntimeSettingsSnapshot;
    const samePath = {
      ...endpointSettings,
      providerSettings: {
        ...endpointSettings.providerSettings,
        openaiBaseUrl: 'https://example.test/v1',
        localNativeRenderUrl: 'https://native.example.test/render',
        backendProxyBaseUrl: 'https://proxy.example.test/api',
      },
    } as RuntimeSettingsSnapshot;
    const changedPath = {
      ...samePath,
      providerSettings: {
        ...samePath.providerSettings,
        openaiBaseUrl: 'https://example.test/v2',
      },
    } as RuntimeSettingsSnapshot;
    const key = createFlowResultCacheKey({ node, nodeData: { provider: 'openai', modelId: 'gpt-4.1' }, context, settings: endpointSettings });
    const samePathKey = createFlowResultCacheKey({ node, nodeData: { provider: 'openai', modelId: 'gpt-4.1' }, context, settings: samePath });
    const changedPathKey = createFlowResultCacheKey({ node, nodeData: { provider: 'openai', modelId: 'gpt-4.1' }, context, settings: changedPath });

    expect(key).toBe(samePathKey);
    expect(changedPathKey).not.toBe(samePathKey);
    for (const secret of ['URL_PASSWORD', 'URL_QUERY_SECRET', 'URL_FRAGMENT_SECRET', 'NATIVE_QUERY_SECRET', 'NATIVE_FRAGMENT_SECRET', 'PROXY_QUERY_SECRET', 'MALFORMED_URL_SECRET']) {
      expect(key).not.toContain(secret);
    }
    expect(key).toContain('https://example.test/v1');
    expect(key).not.toContain('?api_key=');
    expect(key).not.toContain('#URL_FRAGMENT_SECRET');
  });

  it('rejects missing, failed, empty, and wrong-type entries', () => {
    const key = 'key';
    expect(isValidFlowResultCacheEntry(undefined, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: '', resultType: 'text', status: 'succeeded', statusMessage: 'Done', createdAt: '' }, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: 'ok', resultType: 'text', status: 'succeeded', statusMessage: '', createdAt: '' }, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: 'ok', resultType: 'text', status: 'failed', statusMessage: 'Done', createdAt: '' }, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: 'ok', resultType: 'text', status: 'cancelled', statusMessage: 'Done', createdAt: '' }, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: 'ok', resultType: 'text', status: 'error' as never, statusMessage: 'Done', createdAt: '' }, key)).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: 'ok', resultType: 'text', status: 'succeeded', statusMessage: 'Failed', createdAt: '' }, key, 'image')).toBe(false);
    expect(isValidFlowResultCacheEntry({ key, nodeId: 'n', result: false, resultType: 'boolean', status: 'succeeded', statusMessage: 'Done', createdAt: '' }, key, 'boolean')).toBe(true);
  });

  it('evicts oldest entries at a bounded size and supports reset', () => {
    clearFlowResultCache();
    for (let index = 0; index < 140; index += 1) {
      setFlowResultCacheEntry({ key: `key-${index}`, nodeId: 'n', result: `result-${index}`, resultType: 'text', status: 'succeeded', statusMessage: 'Done', createdAt: '' });
    }
    expect(flowResultCacheSize()).toBeLessThanOrEqual(128);
    expect(getFlowResultCacheEntry('key-0')).toBeUndefined();
    clearFlowResultCache();
    expect(flowResultCacheSize()).toBe(0);
  });
});
