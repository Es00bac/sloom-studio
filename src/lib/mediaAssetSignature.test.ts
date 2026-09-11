import { describe, expect, it } from 'vitest';
import { buildMediaAssetSignaturePart } from './mediaAssetSignature';

describe('buildMediaAssetSignaturePart', () => {
  it('keeps short URLs readable', () => {
    expect(buildMediaAssetSignaturePart('blob:http://localhost/video-1')).toBe('blob:http://localhost/video-1');
  });

  it('does not copy large data URLs into editor cache signatures', () => {
    const largeDataUrl = `data:video/mp4;base64,${'A'.repeat(50_000)}ZZZ`;
    const signature = buildMediaAssetSignaturePart(largeDataUrl);

    expect(signature.length).toBeLessThan(260);
    expect(signature).toContain('len=50025');
    expect(signature).not.toContain('A'.repeat(1000));
  });
});
