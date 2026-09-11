import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { applyChromaKeyToImageData } from './chromaKeyPreview';
import { buildFFmpegClipEffectFilters } from './editorClipEffects';

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

const greenKey = {
  enabled: true,
  color: '#00ff00',
  similarityPercent: 20,
  blendPercent: 6,
};

function renderDecodedColorOverWhite(color: string): Buffer {
  const chromaFilter = buildFFmpegClipEffectFilters({
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    chromaKey: greenKey,
  })[0];

  return execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-filter_threads',
    '1',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=1x1:d=1`,
    '-f',
    'lavfi',
    '-i',
    'color=c=white:s=1x1:d=1',
    '-filter_complex',
    `[0:v]format=rgba,${chromaFilter}[fg];[1:v]format=rgba[bg];[bg][fg]overlay=format=auto,format=rgba`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
}

function renderRawRgbaFrame(source: Uint8ClampedArray, width: number): Buffer {
  const chromaFilter = buildFFmpegClipEffectFilters({
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    chromaKey: greenKey,
  })[0];

  return execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-filter_threads',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-video_size',
    `${width}x1`,
    '-framerate',
    '1',
    '-i',
    '-',
    '-vf',
    `format=rgba,${chromaFilter}`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ], { input: source, encoding: 'buffer', maxBuffer: 1024 * 1024 });
}

describe.skipIf(!hasFfmpeg)('native FFmpeg chroma-key parity artifact', () => {
  it('preserves decoded opaque red while keying decoded green over white', () => {
    // `color=c=red` is decoded by FFmpeg as RGB [254,0,0], which is the exact
    // failure fixture from the native QA packet. The old chromakey route
    // produced white here because it incorrectly made that red pixel fully
    // transparent. The generated geq route must preserve it.
    const red = renderDecodedColorOverWhite('red');
    expect(red[0]).toBeGreaterThan(240);
    expect(red[1]).toBeLessThan(10);
    expect(red[2]).toBeLessThan(10);
    expect(red[3]).toBe(255);

    const green = renderDecodedColorOverWhite('0x00ff00');
    expect(Array.from(green.subarray(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('matches browser alpha for keyed, edge-blended, opaque, and partially opaque decoded pixels', () => {
    const source = new Uint8ClampedArray([
      0, 255, 0, 255,
      254, 0, 0, 255,
      0, 154, 0, 255,
      254, 0, 0, 128,
    ]);
    const expected = {
      data: new Uint8ClampedArray(source),
      width: 4,
      height: 1,
    };
    applyChromaKeyToImageData(expected, greenKey);

    expect(Array.from(renderRawRgbaFrame(source, 4))).toEqual(Array.from(expected.data));
  });
});

describe('native chroma-key refusal boundary', () => {
  it('does not emit a native key filter when keying is disabled', () => {
    expect(buildFFmpegClipEffectFilters({
      cropLeftPercent: 0,
      cropRightPercent: 0,
      cropTopPercent: 0,
      cropBottomPercent: 0,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      filterStack: [],
      chromaKey: { ...greenKey, enabled: false },
    })).toEqual([]);
  });
});
