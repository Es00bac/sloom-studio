import { describe, expect, it } from 'vitest';
import { extractWaveformPeaks } from './audioWaveform';

describe('audio waveform extraction', () => {
  it('returns an honest unavailable result when browser audio decoding is absent', async () => {
    await expect(extractWaveformPeaks('signal-loom-asset://asset/feature-audio', 72)).resolves.toEqual([]);
  });
});
