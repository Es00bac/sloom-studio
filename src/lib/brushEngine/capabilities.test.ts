import { describe, expect, it } from 'vitest';
import { detectBrushBackend } from './capabilities';

describe('detectBrushBackend', () => {
  it('returns the cpu backend for cpu preference and for auto in P1', () => {
    expect(detectBrushBackend('cpu').id).toBe('cpu');
    expect(detectBrushBackend('auto').id).toBe('cpu');
  });

  it('falls back to cpu when a forced GPU backend is unavailable (P1)', () => {
    const result = detectBrushBackend('webgpu');
    expect(result.id).toBe('cpu');
    expect(result.downgradedFrom).toBe('webgpu');
    expect(detectBrushBackend('webgl2').downgradedFrom).toBe('webgl2');
  });

  it('exposes a usable backend instance', () => {
    expect(typeof detectBrushBackend('auto').backend.beginStroke).toBe('function');
  });
});
