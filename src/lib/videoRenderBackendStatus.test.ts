import { describe, expect, it } from 'vitest';
import { summarizeVideoRenderBackend } from './videoRenderBackendStatus';

describe('summarizeVideoRenderBackend', () => {
  it('labels auto mode as GPU-first so AMD VAAPI intent is visible', () => {
    const summary = summarizeVideoRenderBackend('auto');

    expect(summary.label).toBe('Auto GPU-first');
    expect(summary.detail).toContain('prefers AMD VAAPI GPU');
    expect(summary.tone).toBe('gpu');
  });

  it('labels forced AMD VAAPI as GPU rendering', () => {
    const summary = summarizeVideoRenderBackend('native-amd-vaapi');

    expect(summary.label).toBe('AMD VAAPI');
    expect(summary.detail).toContain('Forced AMD VAAPI GPU encode');
    expect(summary.tone).toBe('gpu');
  });

  it('labels browser mode as compatibility CPU rendering', () => {
    const summary = summarizeVideoRenderBackend('browser');

    expect(summary.label).toBe('Browser FFmpeg');
    expect(summary.detail).toContain('GPU acceleration is not used');
    expect(summary.tone).toBe('browser');
  });
});
