// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_EVENT_WAIT_MS, MaskTrackingMediaError, runBrowserMaskTracking, trackMaskAcrossDecodedFrames } from './videoRotoTracking';

function frame(timeMs: number, squareX: number) {
  const width = 32;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 8; y < 16; y += 1) for (let x = squareX; x < squareX + 8; x += 1) {
    const index = (y * width + x) * 4;
    data[index] = 255; data[index + 1] = 255; data[index + 2] = 255; data[index + 3] = 255;
  }
  return { timeMs, width, height, data };
}

function wideFrame(timeMs: number, width: number, height: number, squareX: number | null) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (squareX !== null) for (let y = 8; y < 16; y += 1) for (let x = squareX; x < squareX + 8; x += 1) {
    const index = (y * width + x) * 4;
    data[index] = 255; data[index + 1] = 255; data[index + 2] = 255; data[index + 3] = 255;
  }
  return { timeMs, width, height, data };
}

function gradientSquare(x: number) {
  const width = 64;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  const columns = [255, 224, 192, 160, 128, 96, 64, 32];
  for (let y = 8; y < 16; y += 1) for (let column = 0; column < 8; column += 1) {
    const index = (y * width + x + column) * 4;
    data[index] = columns[column]!; data[index + 1] = columns[column]!; data[index + 2] = columns[column]!; data[index + 3] = 255;
  }
  return { width, height, data };
}

function overlaySquares(timeMs: number, width: number, height: number, squares: Array<{ width: number; height: number; data: Uint8ClampedArray }>) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const square of squares) {
    for (let index = 0; index < square.data.length; index += 4) {
      if (square.data[index]! > 0) {
        data[index] = square.data[index]!; data[index + 1] = square.data[index + 1]!; data[index + 2] = square.data[index + 2]!; data[index + 3] = 255;
      }
    }
  }
  return { timeMs, width, height, data };
}

function withScriptedMedia(run: (video: HTMLVideoElement) => Promise<void>): Promise<void> {
  const video = document.createElement('video');
  video.load = () => undefined;
  const originalCreateElement = document.createElement.bind(document);
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => (tag === 'video' ? video : originalCreateElement(tag)));
  return run(video).finally(() => createSpy.mockRestore());
}

function reportMetadata(video: HTMLVideoElement) {
  Object.defineProperty(video, 'duration', { value: 8, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: 64, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 48, configurable: true });
  video.dispatchEvent(new window.Event('loadedmetadata'));
}

function stubCanvasContext() {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => undefined,
    getImageData: () => ({ data: new Uint8ClampedArray(64 * 48 * 4) }),
  } as unknown as CanvasRenderingContext2D);
}

describe('trackMaskAcrossDecodedFrames', () => {
  const mask = { id: 'mask', kind: 'rectangle' as const, points: [{ x: 4 / 32, y: 8 / 24 }, { x: 12 / 32, y: 16 / 24 }], featherPercent: 0, opacityPercent: 100, inverted: false };

  it('derives bounded persisted offsets from sequential decoded frames', () => {
    const result = trackMaskAcrossDecodedFrames(mask, [frame(0, 4), frame(500, 7), frame(1_000, 10)]);

    expect(result.sampledFrames).toBe(3);
    expect(result.keyframes).toEqual([
      { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
      { timeMs: 500, offsetX: 3 / 32, offsetY: 0, scale: 1 },
      { timeMs: 1_000, offsetX: 6 / 32, offsetY: 0, scale: 1 },
    ]);
  });

  it('fails without a partial result when cancelled or given unsupported masks', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => trackMaskAcrossDecodedFrames(mask, [frame(0, 4)], controller.signal)).toThrow('Tracking cancelled');
    expect(() => trackMaskAcrossDecodedFrames({ ...mask, kind: 'bezier' }, [frame(0, 4)])).toThrow('rectangle and ellipse');
  });

  it('refuses a textureless decoded patch instead of saving arbitrary tracking offsets', () => {
    const data = new Uint8ClampedArray(32 * 24 * 4);
    expect(() => trackMaskAcrossDecodedFrames(mask, [{ timeMs: 0, width: 32, height: 24, data }])).toThrow('not visually distinguishable');
  });

  it('refuses non-typed-array decoded frame data before any tracking work', () => {
    expect(() => trackMaskAcrossDecodedFrames(mask, [{ timeMs: 0, width: 32, height: 24, data: undefined as unknown as Uint8ClampedArray }])).toThrow('invalid or over-bound decoded frame');
    expect(() => trackMaskAcrossDecodedFrames(mask, [{ timeMs: 0, width: 32, height: 24, data: new Array(32 * 24 * 4).fill(0) as unknown as Uint8ClampedArray }])).toThrow('invalid or over-bound decoded frame');
  });

  it('refuses a window-edge-pinned best match instead of saving the clamp radius as motion', () => {
    const wideMask = { ...mask, points: [{ x: 28 / 64, y: 8 / 48 }, { x: 36 / 64, y: 16 / 48 }] };
    expect(() => trackMaskAcrossDecodedFrames(wideMask, [wideFrame(0, 64, 48, 28), wideFrame(500, 64, 48, 42)]))
      .toThrow('edge of its bounded search window');
  });

  it('refuses a near-ambiguous best match whose score margin is below the bounded requirement', () => {
    const wideMask = { ...mask, points: [{ x: 28 / 64, y: 8 / 48 }, { x: 36 / 64, y: 16 / 48 }] };
    const decoy = gradientSquare(22);
    const dimmedTrue = gradientSquare(30);
    dimmedTrue.data[(8 * 64 + 30) * 4] -= 1;
    dimmedTrue.data[(8 * 64 + 30) * 4 + 1] -= 1;
    dimmedTrue.data[(8 * 64 + 30) * 4 + 2] -= 1;
    expect(() => trackMaskAcrossDecodedFrames(wideMask, [{ timeMs: 0, ...gradientSquare(28) }, overlaySquares(500, 64, 48, [decoy, dimmedTrue])]))
      .toThrow('not visually distinguishable');
  });

  it('refuses a single-cell search window instead of persisting blank-media keyframes', () => {
    const fullFrameMask = { ...mask, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(() => trackMaskAcrossDecodedFrames(fullFrameMask, [wideFrame(0, 32, 24, null), wideFrame(500, 32, 24, null), wideFrame(1_000, 32, 24, null)]))
      .toThrow('single candidate cell');
  });
});

describe('runBrowserMaskTracking media failures', () => {
  const mask = { id: 'mask', kind: 'rectangle' as const, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], featherPercent: 0, opacityPercent: 100, inverted: false };

  it('rejects within the wall-clock bound when metadata never arrives and cleans the media element', async () => {
    vi.useFakeTimers();
    try {
      await withScriptedMedia(async (video) => {
        const pending = runBrowserMaskTracking({ assetUrl: 'blob:stalled', mask });
        const expectation = expect(pending).rejects.toThrow('Timed out waiting for the source media to report its metadata');
        await vi.advanceTimersByTimeAsync(MAX_EVENT_WAIT_MS + 1);
        await expectation;
        await expect(pending).rejects.toBeInstanceOf(MaskTrackingMediaError);
        expect(video.getAttribute('src')).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with the decode error message when the source reports a media error', async () => {
    await withScriptedMedia(async (video) => {
      const pending = runBrowserMaskTracking({ assetUrl: 'blob:broken', mask });
      const expectation = expect(pending).rejects.toThrow('The source media could not be decoded: DEMUXER_ERROR_COULD_NOT_OPEN');
      Object.defineProperty(video, 'error', { value: { message: 'DEMUXER_ERROR_COULD_NOT_OPEN' }, configurable: true });
      video.dispatchEvent(new window.Event('error'));
      await expectation;
      expect(video.getAttribute('src')).toBeNull();
    });
  });

  it('rejects when a seek stalls and then reports a media error mid-wait', async () => {
    const contextStub = stubCanvasContext();
    try {
      await withScriptedMedia(async (video) => {
        const pending = runBrowserMaskTracking({ assetUrl: 'blob:seek-hang', mask });
        const expectation = expect(pending).rejects.toThrow('The source media could not be decoded: SEEK_HANG');
        reportMetadata(video);
        await Promise.resolve();
        await Promise.resolve();
        expect(video.currentTime).toBe(0);
        Object.defineProperty(video, 'error', { value: { message: 'SEEK_HANG' }, configurable: true });
        video.dispatchEvent(new window.Event('error'));
        await expectation;
        expect(video.getAttribute('src')).toBeNull();
      });
    } finally {
      contextStub.mockRestore();
    }
  });

  it('rejects within the wall-clock bound when a seek never completes', async () => {
    vi.useFakeTimers();
    const contextStub = stubCanvasContext();
    try {
      await withScriptedMedia(async (video) => {
        const pending = runBrowserMaskTracking({ assetUrl: 'blob:seek-stall', mask });
        const expectation = expect(pending).rejects.toThrow('Timed out waiting for the source media to finish seeking');
        reportMetadata(video);
        await vi.advanceTimersByTimeAsync(MAX_EVENT_WAIT_MS + 1);
        await expectation;
        expect(video.getAttribute('src')).toBeNull();
      });
    } finally {
      contextStub.mockRestore();
      vi.useRealTimers();
    }
  });
});
