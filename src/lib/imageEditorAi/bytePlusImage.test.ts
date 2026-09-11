import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../../store/settingsStore';
import { bytePlusGenerateImage, runBytePlusImage } from './bytePlusImage';
import type { GenerativeFillRequest } from '../imageEditorAi';

function baseRequest(overrides: Partial<GenerativeFillRequest> = {}): GenerativeFillRequest {
  return {
    source: new Blob(['source']),
    mask: new Blob(['mask']),
    prompt: 'a cozy cabin in the woods',
    provider: 'byteplus',
    ...overrides,
  };
}

describe('runBytePlusImage', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, byteplus: 'test-byteplus-key' },
    });
  });

  it('rejects requests carrying reference images instead of silently dropping them', async () => {
    // BytePlus/Seedream has no confirmed edit/reference endpoint in this app yet (see
    // flowExecution.ts's byteplus case + bytePlusImage.ts docs) — a populated `references`
    // array must fail loudly rather than silently generate a reference-free image.
    await expect(runBytePlusImage(baseRequest({
      references: [{ id: 'ref-1', imageUrl: 'blob:ref-1' }],
    }))).rejects.toThrow(/reference-image endpoint/i);
  });

  it('requires an API key before doing anything else', async () => {
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, byteplus: '' },
    });
    await expect(runBytePlusImage(baseRequest())).rejects.toThrow(/API key not configured/i);
  });
});

describe('bytePlusGenerateImage', () => {
  it('uses the exact documented ModelArk request shape with no watermark', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'https://example.test/image.png' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(bytePlusGenerateImage({
      apiKey: 'test-key',
      baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
      modelId: 'seedream-5-0-260128',
      prompt: 'A clear editorial portrait',
      size: '2K',
      seed: 42,
    })).resolves.toBe('https://example.test/image.png');

    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'seedream-5-0-260128',
      prompt: 'A clear editorial portrait',
      response_format: 'url',
      size: '2K',
      seed: 42,
      watermark: false,
    });
    fetchMock.mockRestore();
  });
});
