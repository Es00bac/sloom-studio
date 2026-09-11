import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenverseImageSearchUrl,
  inferResourceMimeType,
  searchFreeImageResources,
} from './freeResourceSearch';

describe('freeResourceSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds bounded Openverse image-search URLs', () => {
    const url = buildOpenverseImageSearchUrl('storyboard forest', { pageSize: 42 });

    expect(url.toString()).toBe(
      'https://api.openverse.org/v1/images/?q=storyboard+forest&page_size=20',
    );
  });

  it('maps Openverse results into source-bin-ready free resource records', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'open-1',
            title: 'Forest plate',
            url: 'https://example.test/forest.jpg',
            thumbnail: 'https://example.test/thumb.jpg',
            creator: 'Artist Name',
            creator_url: 'https://example.test/artist',
            license: 'by',
            license_version: '4.0',
            license_url: 'https://creativecommons.org/licenses/by/4.0/',
            foreign_landing_url: 'https://example.test/source',
            source: 'flickr',
          },
        ],
      }),
    } as Response);

    const results = await searchFreeImageResources('forest');

    expect(results).toEqual([
      {
        id: 'openverse:open-1',
        provider: 'Openverse',
        title: 'Forest plate',
        assetUrl: 'https://example.test/forest.jpg',
        thumbnailUrl: 'https://example.test/thumb.jpg',
        creator: 'Artist Name',
        creatorUrl: 'https://example.test/artist',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://example.test/source',
        sourceName: 'flickr',
        mimeType: 'image/jpeg',
      },
    ]);
  });

  it('infers common remote image mime types from URLs', () => {
    expect(inferResourceMimeType('https://example.test/asset.png?size=large')).toBe('image/png');
    expect(inferResourceMimeType('https://example.test/asset.webp')).toBe('image/webp');
    expect(inferResourceMimeType('https://example.test/no-extension')).toBe('image/jpeg');
  });
});
