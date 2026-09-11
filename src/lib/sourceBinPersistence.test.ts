import { afterEach, describe, expect, it, vi } from 'vitest';
import { localizeAssetForProject } from './sourceBinPersistence';

describe('localizeAssetForProject', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps existing data URLs without refetching them', async () => {
    const localized = await localizeAssetForProject('data:video/mp4;base64,AAA', 'video/mp4');

    expect(localized).toEqual({
      dataUrl: 'data:video/mp4;base64,AAA',
      mimeType: 'video/mp4',
    });
  });

  it('converts fetched generated blobs into durable data URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['video-bytes'], { type: 'video/mp4' }))),
    );

    const localized = await localizeAssetForProject('blob:generated-video', 'video/mp4');

    expect(localized.mimeType).toBe('video/mp4');
    expect(localized.dataUrl).toMatch(/^data:video\/mp4;base64,/);
    expect(localized.dataUrl).not.toBe('blob:generated-video');
  });

  it('does not silently save transient blob URLs when localization fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('blob revoked');
      }),
    );

    await expect(localizeAssetForProject('blob:generated-video', 'video/mp4')).rejects.toThrow(
      'The source-bin asset could not be saved into the project scratch store.',
    );
  });
});
