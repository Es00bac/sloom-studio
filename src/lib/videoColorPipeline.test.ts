import { describe, expect, it } from 'vitest';
import { probeVideoProfessionalCapabilities } from './videoProfessionalCapabilities';
import {
  buildVideoColorPreviewDescriptor,
  compileVideoColorFfmpegFilters,
  computeVideoScopes,
  resolveVideoColorPipeline,
  validateVideoLutReference,
} from './videoColorPipeline';

describe('professional video color pipeline', () => {
  it('keeps the fixed input, correction, LUT, output order', () => {
    const pipeline = resolveVideoColorPipeline(
      { inputColorSpace: 'rec2020-pq' },
      { workingColorSpace: 'rec2020-pq', outputColorSpace: 'rec709', hdrPeakNits: 1_000 },
      { contrast: 1.1, lut: { id: 'film', name: 'Film', uri: '/luts/film.cube', format: 'cube' } },
    );
    const preview = buildVideoColorPreviewDescriptor(pipeline, { webGpu: true });
    expect(preview.stages.map(({ kind }) => kind)).toEqual(['input-transform', 'correction', 'lut', 'working-output']);
    expect(preview.toneMapping).toMatchObject({ applied: true, sourceTransfer: 'pq' });
    expect(preview.toneMapping.note).toContain('not an HDR reference monitor');

    const probe = probeVideoProfessionalCapabilities({ ffmpegFiltersText: '... zscale V->V\n... lut3d V->V' });
    const compiled = compileVideoColorFfmpegFilters(pipeline, probe);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.filters.join(',')).toMatch(/eq=.*lut3d=.*tonemap/u);
  });

  it('validates LUT references and reports missing FFmpeg capability', () => {
    expect(validateVideoLutReference({ id: '', name: '', uri: '', format: 'cube', size: 128, checksumSha256: 'no' })).toHaveLength(5);
    const compiled = compileVideoColorFfmpegFilters(
      resolveVideoColorPipeline({}, {}, { lut: { id: 'x', name: 'Look', uri: 'look.cube', format: 'cube' } }),
      probeVideoProfessionalCapabilities({}),
    );
    expect(compiled).toMatchObject({ ok: false, missingCapabilities: [{ id: 'lut3d' }] });
  });

  it('computes bounded scopes from a synthetic grayscale ramp', () => {
    const data = new Uint8ClampedArray(256 * 4);
    for (let value = 0; value < 256; value += 1) data.set([value, value, value, 255], value * 4);
    const scopes = computeVideoScopes({ data, width: 256, height: 1 }, 256);
    expect(scopes.sampleCount).toBe(256);
    expect(scopes.sampleStride).toBe(1);
    expect(scopes.histogram.every((count) => count === 1)).toBe(true);
    expect(scopes.waveform.bins).toHaveLength(256);
    expect(scopes.rgbParade.red).toEqual(scopes.rgbParade.green);
    expect(scopes.vectorscope.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(256);

    const bounded = computeVideoScopes({ data, width: 256, height: 1 }, 16);
    expect(bounded.sampleCount).toBeLessThanOrEqual(16);
  });
});
