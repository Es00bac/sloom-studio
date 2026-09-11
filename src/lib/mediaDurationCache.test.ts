import { describe, expect, it } from 'vitest';
import { createMediaDurationResolver } from './mediaDurationCache';

describe('createMediaDurationResolver', () => {
  it('deduplicates repeated duration loads for the same url and media kind', async () => {
    const calls: string[] = [];
    const resolveDuration = createMediaDurationResolver(async (url, kind) => {
      calls.push(`${kind}:${url}`);
      return 12;
    });

    const [first, second, third] = await Promise.all([
      resolveDuration('clip.mp4', 'video'),
      resolveDuration('clip.mp4', 'video'),
      resolveDuration('clip.mp4', 'audio'),
    ]);

    expect([first, second, third]).toEqual([12, 12, 12]);
    expect(calls).toEqual(['video:clip.mp4', 'audio:clip.mp4']);
  });
});
