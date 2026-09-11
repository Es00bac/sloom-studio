import { describe, it, expect } from 'vitest';
import {
  buildProviderCatalogSnapshot,
  diffModelIds,
  extractModelIds,
  hasCatalogDrift,
} from './sync-provider-catalog.mjs';

describe('diffModelIds', () => {
  it('reports models added and removed versus the committed list', () => {
    expect(diffModelIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
  });
  it('is empty when the lists match', () => {
    expect(diffModelIds(['x'], ['x'])).toEqual({ added: [], removed: [] });
  });
});

describe('extractModelIds', () => {
  it('reads Gemini models[].name and strips the models/ prefix', () => {
    const ids = extractModelIds('gemini', { models: [{ name: 'models/gemini-3-pro-image' }, { name: 'models/x' }] });
    expect(ids).toEqual(['gemini-3-pro-image', 'x']);
  });
  it('reads OpenAI-compatible data[].id (openai/atlas)', () => {
    const ids = extractModelIds('atlas', { data: [{ id: 'google/nano-banana-2/edit' }, { id: 'flux' }] });
    expect(ids).toEqual(['google/nano-banana-2/edit', 'flux']);
  });
  it('reads ElevenLabs model IDs from array and object response shapes', () => {
    expect(extractModelIds('elevenlabs', [{ model_id: 'eleven_v3' }, { modelId: 'music_v2' }])).toEqual([
      'eleven_v3',
      'music_v2',
    ]);
  });
});

describe('hasCatalogDrift', () => {
  it('fails a check for any provider addition or removal', () => {
    expect(hasCatalogDrift({ gemini: { added: [], removed: [] } })).toBe(false);
    expect(hasCatalogDrift({ gemini: { added: ['new'], removed: [] } })).toBe(true);
  });
});

describe('buildProviderCatalogSnapshot', () => {
  it('dedupes + sorts per provider and stamps fetchedAt', () => {
    const snap = buildProviderCatalogSnapshot({ atlas: ['z', 'a', 'a'] }, '2026-06-15T00:00:00.000Z');
    expect(snap.providers.atlas).toEqual(['a', 'z']);
    expect(snap.fetchedAt).toBe('2026-06-15T00:00:00.000Z');
    expect(snap.generatedBy).toBe('sync-provider-catalog');
  });
});
