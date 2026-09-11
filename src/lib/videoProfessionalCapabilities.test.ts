import { describe, expect, it } from 'vitest';
import {
  findMissingVideoCapabilities,
  probeVideoProfessionalCapabilities,
} from './videoProfessionalCapabilities';

describe('probeVideoProfessionalCapabilities', () => {
  it('parses supplied FFmpeg listings without assuming optional filters exist', () => {
    const probe = probeVideoProfessionalCapabilities({
      ffmpegFiltersText: `Filters:\n TSC lut3d V->V Apply a 3D LUT.\n .SC zscale V->V Scale.\n ... ebur128 A->N EBU.\n ... vidstabdetect V->V detect`,
      ffmpegEncodersText: ' V..... libx264 H.264\n A..... aac AAC',
      browser: { webAudio: true, webGpu: false },
    });

    expect(probe.capabilities.lut3d.supported).toBe(true);
    expect(probe.capabilities.zscale.supported).toBe(true);
    expect(probe.capabilities.colorspace.supported).toBe(false);
    expect(probe.capabilities.minterpolate.reason).toContain('does not expose');
    expect(probe.capabilities.vidstab.supported).toBe(false);
    expect(probe.capabilities.vidstab.reason).toContain('both');
    expect(probe.capabilities.aaf).toMatchObject({ supported: false, source: 'application' });
    expect(probe.encoders).toEqual(['aac', 'libx264']);
    expect(probe.browser).toMatchObject({ webAudio: true, webGpu: false });
  });

  it('requires both vidstab filters and reports exact missing requirements', () => {
    const probe = probeVideoProfessionalCapabilities({
      ffmpegFiltersText: '... vidstabdetect V->V\n... vidstabtransform V->V\n... minterpolate V->V',
    });
    expect(probe.capabilities.vidstab.supported).toBe(true);
    expect(findMissingVideoCapabilities(probe, ['lut3d', 'lut3d', 'aaf']).map(({ id }) => id))
      .toEqual(['lut3d', 'aaf']);
  });
});
