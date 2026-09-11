import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: vi.fn(),
}));

vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn(),
}));

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { ComposeSequenceVisualClip } from './mediaComposition';
import { getVideoExportPresetOption } from './videoPremiereParity';

interface BrowserFfmpegFake {
  load: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  listDir: ReturnType<typeof vi.fn>;
}

function createFfmpegFake(overrides: Partial<BrowserFfmpegFake> = {}): BrowserFfmpegFake {
  return {
    load: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    listDir: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function configureFfmpegInstances(...instances: BrowserFfmpegFake[]) {
  const constructor = vi.mocked(FFmpeg);
  constructor.mockImplementation(function createMockFfmpeg() {
    const instance = instances.shift();
    if (!instance) {
      throw new Error('Unexpected FFmpeg instance.');
    }
    return instance as never;
  });
}

const compositionOptions = {
  videoUrl: 'https://example.invalid/video.mp4',
  audioTracks: [],
};

const imageClip: ComposeSequenceVisualClip = {
  sourceNodeId: 'image-source',
  sourceKind: 'image',
  trackIndex: 0,
  startMs: 0,
  assetUrl: 'https://example.invalid/image.png',
  durationSeconds: 1,
  trimStartMs: 0,
  trimEndMs: 0,
  playbackRate: 1,
  reversePlayback: false,
  fitMode: 'contain',
  scalePercent: 100,
  scaleMotionEnabled: false,
  endScalePercent: 100,
  opacityPercent: 100,
  rotationDeg: 0,
  rotationMotionEnabled: false,
  endRotationDeg: 0,
  flipHorizontal: false,
  flipVertical: false,
  positionX: 0,
  positionY: 0,
  motionEnabled: false,
  endPositionX: 0,
  endPositionY: 0,
  transitionIn: 'none',
  transitionOut: 'none',
  transitionDurationMs: 0,
  textFontFamily: 'Inter, system-ui, sans-serif',
  textSizePx: 64,
  textColor: '#ffffff',
  textEffect: 'none',
  textBackgroundOpacityPercent: 0,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser FFmpeg reliability', () => {
  it('refuses to materialize a feature-length export in browser memory', async () => {
    const { composeSequenceMedia } = await import('./mediaComposition');

    await expect(composeSequenceMedia({
      visualClips: [{ ...imageClip, durationSeconds: 30 * 60 }],
      audioTracks: [],
    })).rejects.toThrow(/Feature-length exports.*desktop native renderer/);

    expect(FFmpeg).not.toHaveBeenCalled();
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('evicts a rejected shared load so a retry creates a fresh instance', async () => {
    const rejected = createFfmpegFake({ load: vi.fn().mockRejectedValue(new Error('load failed')) });
    const healthy = createFfmpegFake();
    configureFfmpegInstances(rejected, healthy);
    const { composeMedia } = await import('./mediaComposition');

    await expect(composeMedia(compositionOptions)).rejects.toThrow('load failed');
    await expect(composeMedia(compositionOptions)).resolves.toBeInstanceOf(Blob);

    expect(FFmpeg).toHaveBeenCalledTimes(2);
    expect(healthy.load).toHaveBeenCalledTimes(1);
  });

  it('shares a healthy load while overlapping operations receive disjoint paths and explicit overwrite', async () => {
    let resolveLoad: (() => void) | undefined;
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    const ffmpeg = createFfmpegFake({ load: vi.fn().mockReturnValue(load) });
    configureFfmpegInstances(ffmpeg);
    const { composeMedia } = await import('./mediaComposition');

    const first = composeMedia(compositionOptions);
    const second = composeMedia(compositionOptions);
    expect(FFmpeg).toHaveBeenCalledTimes(1);

    resolveLoad?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    const commands = ffmpeg.exec.mock.calls.map(([command]) => command as string[]);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.includes('-y'))).toBe(true);
    expect(new Set(commands.map((command) => command.at(-1))).size).toBe(2);
    expect(new Set(ffmpeg.writeFile.mock.calls.map(([path]) => path)).size).toBe(2);
  });

  it('cleans only successfully written inputs when a later write fails', async () => {
    const writeFailure = new Error('audio write failed');
    const ffmpeg = createFfmpegFake({
      writeFile: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(writeFailure),
    });
    configureFfmpegInstances(ffmpeg);
    const { composeMedia } = await import('./mediaComposition');

    await expect(composeMedia({
      ...compositionOptions,
      audioTracks: [{ url: 'https://example.invalid/audio.mp3', delayMs: 0, volumePercent: 100, enabled: true }],
    })).rejects.toBe(writeFailure);

    expect(ffmpeg.deleteFile.mock.calls.map(([path]) => path)).toEqual([
      ffmpeg.writeFile.mock.calls[0][0],
    ]);
  });

  it('preserves an exec failure while cleaning every created input', async () => {
    const execFailure = new Error('exec failed');
    const ffmpeg = createFfmpegFake({ exec: vi.fn().mockRejectedValue(execFailure) });
    configureFfmpegInstances(ffmpeg);
    const { composeMedia } = await import('./mediaComposition');

    await expect(composeMedia({
      ...compositionOptions,
      audioTracks: [{ url: 'https://example.invalid/audio.mp3', delayMs: 0, volumePercent: 100, enabled: true }],
    })).rejects.toBe(execFailure);

    expect(ffmpeg.deleteFile.mock.calls.map(([path]) => path)).toEqual(
      ffmpeg.writeFile.mock.calls.map(([path]) => path),
    );
  });

  it('preserves a read failure when output cleanup also fails', async () => {
    const readFailure = new Error('read failed');
    const cleanupFailure = new Error('cleanup failed');
    const ffmpeg = createFfmpegFake({
      readFile: vi.fn().mockRejectedValue(readFailure),
      deleteFile: vi.fn().mockRejectedValueOnce(cleanupFailure).mockResolvedValue(undefined),
    });
    configureFfmpegInstances(ffmpeg);
    const { composeMedia } = await import('./mediaComposition');

    await expect(composeMedia(compositionOptions)).rejects.toBe(readFailure);
    expect(ffmpeg.deleteFile).toHaveBeenCalledTimes(2);
  });

  it('surfaces a cleanup failure after otherwise successful browser work', async () => {
    const cleanupFailure = new Error('cleanup failed');
    const ffmpeg = createFfmpegFake({ deleteFile: vi.fn().mockRejectedValue(cleanupFailure) });
    configureFfmpegInstances(ffmpeg);
    const { composeMedia } = await import('./mediaComposition');

    await expect(composeMedia(compositionOptions)).rejects.toBe(cleanupFailure);
  });

  it('gives overlapping sequence renders distinct input and output names', async () => {
    const ffmpeg = createFfmpegFake();
    configureFfmpegInstances(ffmpeg);
    const { composeSequenceMedia } = await import('./mediaComposition');

    await expect(Promise.all([
      composeSequenceMedia({ visualClips: [imageClip], audioTracks: [] }),
      composeSequenceMedia({ visualClips: [imageClip], audioTracks: [] }),
    ])).resolves.toHaveLength(2);

    const commands = ffmpeg.exec.mock.calls.map(([command]) => command as string[]);
    expect(commands).toHaveLength(2);
    expect(commands.every((command) => command.includes('-y'))).toBe(true);
    expect(new Set(commands.map((command) => command.at(-1))).size).toBe(2);
    expect(new Set(ffmpeg.writeFile.mock.calls.map(([path]) => path)).size).toBe(2);
  });

  it.each([
    ['png-image-sequence', 'png'],
    ['jpeg-image-sequence', 'jpg'],
  ])('keeps %s ZIP and manifest frame names public while retaining raw MEMFS names', async (presetId, extension) => {
    const operationId = 'deterministic-operation-id';
    const rawFrames = [
      `sequence-frame-00010-${operationId}.${extension}`,
      `sequence-frame-00002-${operationId}.${extension}`,
    ];
    vi.stubGlobal('crypto', { randomUUID: () => operationId });
    const ffmpeg = createFfmpegFake({
      listDir: vi.fn().mockResolvedValue(rawFrames.map((name) => ({ name, isDir: false }))),
    });
    configureFfmpegInstances(ffmpeg);
    const { composeSequenceMedia } = await import('./mediaComposition');

    const result = await composeSequenceMedia({
      visualClips: [imageClip],
      audioTracks: [],
      exportPresetId: presetId,
    });
    const entries = unzipSync(new Uint8Array(await result.blob!.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    const publicFrames = [
      `sequence-frame-00002.${extension}`,
      `sequence-frame-00010.${extension}`,
    ];

    expect(Object.keys(entries)).toEqual(expect.arrayContaining(['manifest.json', ...publicFrames]));
    expect(Object.keys(entries).join(' ')).not.toContain(operationId);
    expect(manifest.frames).toEqual(publicFrames);
    expect(result.manifest?.frames).toEqual(publicFrames);
    expect(result.fileName).toBe(`${getVideoExportPresetOption(presetId).id}.zip`);
    expect(ffmpeg.readFile.mock.calls.map(([path]) => path)).toEqual(rawFrames.slice().reverse());
    expect(ffmpeg.deleteFile.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining(rawFrames));
  });
});
