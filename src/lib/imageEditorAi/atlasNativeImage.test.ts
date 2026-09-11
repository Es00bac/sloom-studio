import { describe, expect, it } from 'vitest';
import {
  extractAtlasOutputUrl,
  isAtlasNativeImageModelId,
  normalizeAtlasBaseUrl,
} from './atlasNativeImage';

describe('normalizeAtlasBaseUrl', () => {
  it('defaults empty/blank to the native Atlas API (never OpenAI)', () => {
    expect(normalizeAtlasBaseUrl(undefined)).toBe('https://api.atlascloud.ai/api/v1');
    expect(normalizeAtlasBaseUrl('')).toBe('https://api.atlascloud.ai/api/v1');
    expect(normalizeAtlasBaseUrl('   ')).toBe('https://api.atlascloud.ai/api/v1');
    expect(normalizeAtlasBaseUrl('https://api.atlascloud.ai')).toBe('https://api.atlascloud.ai/api/v1');
  });
  it('keeps a custom base URL (trailing slash trimmed)', () => {
    expect(normalizeAtlasBaseUrl('https://example.com/v1/')).toBe('https://example.com/v1');
  });
});

describe('isAtlasNativeImageModelId', () => {
  it('treats vendor slugs as native (use Atlas /model/generateImage)', () => {
    expect(isAtlasNativeImageModelId('google/nano-banana-2/edit')).toBe(true);
    expect(isAtlasNativeImageModelId('atlascloud/qwen-image/edit')).toBe(true);
    expect(isAtlasNativeImageModelId('black-forest-labs/flux-schnell')).toBe(true);
  });
  it('treats gpt-image / openai routes as OpenAI-compatible', () => {
    expect(isAtlasNativeImageModelId('gpt-image-2')).toBe(false);
    expect(isAtlasNativeImageModelId('openai/gpt-image-2/edit')).toBe(false);
  });
});

describe('extractAtlasOutputUrl', () => {
  it('reads nested and top-level output shapes', () => {
    expect(extractAtlasOutputUrl({ data: { outputs: ['https://a/img.png'] } })).toBe('https://a/img.png');
    expect(extractAtlasOutputUrl({ image: 'https://b/img.png' })).toBe('https://b/img.png');
    expect(extractAtlasOutputUrl({})).toBeUndefined();
  });
});
