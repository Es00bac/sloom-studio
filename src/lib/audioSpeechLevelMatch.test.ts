import { describe, expect, it } from 'vitest';
import { measureSpeechLevelMatch, SpeechLevelMatchError } from './audioSpeechLevelMatch';

function tone(amplitude: number, seconds = 1, sampleRate = 1_000, invertedRight = false) {
  const samples = Float32Array.from({ length: seconds * sampleRate }, (_, index) =>
    amplitude * Math.sin((index / sampleRate) * Math.PI * 2 * 50));
  return {
    sampleRate,
    channels: invertedRight
      ? [samples, Float32Array.from(samples, (sample) => -sample)]
      : [samples],
  };
}

describe('speech level matching', () => {
  it('measures active RMS gain without cancelling anti-phase stereo', () => {
    const measurement = measureSpeechLevelMatch(tone(0.25), tone(0.125, 1, 1_000, true));
    expect(measurement.gainDb).toBeCloseTo(6.0206, 2);
    expect(measurement.activeDurationSeconds).toBeGreaterThanOrEqual(0.98);
    expect(measurement.peakLimited).toBe(false);
  });

  it('caps correction at the conservative sample-peak ceiling', () => {
    const measurement = measureSpeechLevelMatch(tone(0.9), tone(0.45));
    expect(measurement.gainDb).toBeCloseTo(-3 - (20 * Math.log10(0.45)), 2);
    expect(measurement.peakLimited).toBe(true);
  });

  it('never lets peak protection push the automatic correction beyond the ±12 dB contract', () => {
    const measurement = measureSpeechLevelMatch(tone(10), tone(10));
    expect(measurement.gainDb).toBe(-12);
    expect(measurement.peakLimited).toBe(true);
  });

  it('refuses silence instead of applying arbitrary gain', () => {
    expect(() => measureSpeechLevelMatch(tone(0.1), tone(0))).toThrowError(SpeechLevelMatchError);
  });

  it('handles different sample rates on a common time grid', () => {
    const measurement = measureSpeechLevelMatch(tone(0.2, 1, 2_000), tone(0.1, 1, 1_000));
    expect(measurement.gainDb).toBeCloseTo(6.0206, 1);
  });
});
