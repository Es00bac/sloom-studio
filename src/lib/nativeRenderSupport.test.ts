import { describe, expect, it } from 'vitest';
import {
  describeNativeSequencePresetMapping,
  getNativeRenderThreadArgs,
  getNativeSequenceCommandPrefix,
  getNativeSequenceEncoderArgs,
  getNativeSequenceOutputFilter,
  getNativeSequencePixelFormatFilter,
} from './nativeRenderSupport';

describe('nativeRenderSupport', () => {
  it('adds thread hints for native CPU rendering', () => {
    expect(getNativeRenderThreadArgs()).toEqual([
      '-threads',
      '0',
      '-filter_threads',
      '0',
      '-filter_complex_threads',
      '0',
    ]);
  });

  it('maps executable presets to native CPU libx264 options', () => {
    expect(getNativeSequenceEncoderArgs('cpu', { crf: 18 })).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
    ]);
  });

  it('uses VAAPI upload and encoder settings for AMD acceleration', () => {
    expect(getNativeSequenceCommandPrefix('amd-vaapi')).toContain('/dev/dri/renderD128');
    expect(getNativeSequenceOutputFilter('base4', 'amd-vaapi')).toBe('[base4]format=nv12,hwupload[vout]');
    expect(getNativeSequenceEncoderArgs('amd-vaapi')).toEqual([
      '-c:v',
      'h264_vaapi',
      '-qp',
      '20',
    ]);
  });

  it('normalizes VAAPI limitations instead of silently ignoring preset intent', () => {
    const mapping = describeNativeSequencePresetMapping('amd-vaapi', {
      label: 'Archive High Quality',
      crf: 18,
      profile: 'high',
    });

    expect(mapping.videoCodecArgs).toEqual(['-c:v', 'h264_vaapi', '-qp', '19']);
    expect(mapping.notes.join(' ')).toContain('normalized to VAAPI QP');
  });

  it('maps only the explicitly probed NVENC and Quick Sync hardware backends', () => {
    expect(getNativeSequenceEncoderArgs('nvidia-nvenc', { crf: 18 })).toEqual([
      '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18', '-pix_fmt', 'yuv420p',
    ]);
    expect(getNativeSequenceEncoderArgs('intel-qsv', { crf: 18 })).toEqual([
      '-c:v', 'h264_qsv', '-global_quality', '18', '-pix_fmt', 'nv12',
    ]);
    expect(getNativeSequenceOutputFilter('base4', 'nvidia-nvenc')).toBe('[base4]format=yuv420p[vout]');
    expect(describeNativeSequencePresetMapping('intel-qsv', { label: 'Review' }).notes.join(' ')).toContain('Quick Sync');
  });

  it('keeps alpha on the software-only alpha preset instead of routing it to hardware', () => {
    expect(getNativeSequenceOutputFilter('base4', 'cpu', 'yuva420p')).toBe('[base4]format=yuva420p[vout]');
    expect(getNativeSequenceOutputFilter('base4', 'amd-vaapi', 'yuva420p')).toBe('[base4]format=yuva420p[vout]');
  });

  it('propagates a native preset pixel-format requirement through both FFmpeg filter forms', () => {
    const preset = { nativeMapping: { cpu: { outputFilter: 'yuv422p' as const } } };

    expect(getNativeSequencePixelFormatFilter('cpu', preset)).toBe('format=yuv422p');
    expect(getNativeSequenceOutputFilter('base4', 'cpu', preset)).toBe('[base4]format=yuv422p[vout]');
  });
});
