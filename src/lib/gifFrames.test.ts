import { describe, expect, it, vi } from 'vitest';
import {
  compositeGifRawFrames,
  createPassthroughGifCompositeSurface,
  decodeGifFrames,
  describeGifForFfmpeg,
  getGifFrameTimeline,
  getGifTotalDurationMs,
  planGifFrameComposition,
  probeGifAnimation,
  requiresGifCompositing,
  selectGifFrameIndexAtTime,
  type GifCompositeSurface,
  type GifDecodeBackend,
  type GifDecodeResult,
  type GifFrameDisposalDescriptor,
  type GifRawFrame,
} from './gifFrames';

describe('planGifFrameComposition', () => {
  it('never clears or restores before the very first frame, regardless of its own disposal', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'restoreToPrevious' },
    ];

    const [step] = planGifFrameComposition(frames);

    expect(step.clearRegionBeforeDraw).toBeNull();
    expect(step.restoreSnapshotBeforeDraw).toBe(false);
    // Its own disposal still means a snapshot must be captured before it's drawn.
    expect(step.captureSnapshotBeforeDraw).toBe(true);
  });

  it('leaves the canvas alone after "none" and "unspecified" disposal', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'none' },
      { x: 1, y: 1, width: 4, height: 4, disposal: 'unspecified' },
      { x: 2, y: 2, width: 4, height: 4, disposal: 'none' },
    ];

    const steps = planGifFrameComposition(frames);

    expect(steps[1].clearRegionBeforeDraw).toBeNull();
    expect(steps[1].restoreSnapshotBeforeDraw).toBe(false);
    expect(steps[2].clearRegionBeforeDraw).toBeNull();
    expect(steps[2].restoreSnapshotBeforeDraw).toBe(false);
  });

  it('clears exactly the previous frame\'s region after "restoreToBackground"', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 3, y: 5, width: 6, height: 7, disposal: 'restoreToBackground' },
      { x: 0, y: 0, width: 20, height: 20, disposal: 'none' },
    ];

    const steps = planGifFrameComposition(frames);

    expect(steps[1].clearRegionBeforeDraw).toEqual({ x: 3, y: 5, width: 6, height: 7 });
    expect(steps[1].restoreSnapshotBeforeDraw).toBe(false);
  });

  it('requests a snapshot restore after "restoreToPrevious", never a clear', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 3, y: 5, width: 6, height: 7, disposal: 'restoreToPrevious' },
      { x: 0, y: 0, width: 20, height: 20, disposal: 'none' },
    ];

    const steps = planGifFrameComposition(frames);

    expect(steps[1].restoreSnapshotBeforeDraw).toBe(true);
    expect(steps[1].clearRegionBeforeDraw).toBeNull();
  });

  it('captures a pre-draw snapshot only for frames whose own disposal is "restoreToPrevious"', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 1, height: 1, disposal: 'none' },
      { x: 0, y: 0, width: 1, height: 1, disposal: 'restoreToPrevious' },
      { x: 0, y: 0, width: 1, height: 1, disposal: 'restoreToBackground' },
    ];

    const steps = planGifFrameComposition(frames);

    expect(steps.map((step) => step.captureSnapshotBeforeDraw)).toEqual([false, true, false]);
  });

  it('produces the exact expected plan for a mixed real-world-shaped sequence', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'none' }, // full background frame
      { x: 2, y: 2, width: 3, height: 3, disposal: 'restoreToBackground' }, // sprite that should vanish
      { x: 2, y: 2, width: 3, height: 3, disposal: 'restoreToPrevious' }, // sprite that should undo itself
      { x: 5, y: 5, width: 2, height: 2, disposal: 'none' },
    ];

    expect(planGifFrameComposition(frames)).toEqual([
      { frameIndex: 0, clearRegionBeforeDraw: null, restoreSnapshotBeforeDraw: false, captureSnapshotBeforeDraw: false },
      { frameIndex: 1, clearRegionBeforeDraw: null, restoreSnapshotBeforeDraw: false, captureSnapshotBeforeDraw: false },
      { frameIndex: 2, clearRegionBeforeDraw: { x: 2, y: 2, width: 3, height: 3 }, restoreSnapshotBeforeDraw: false, captureSnapshotBeforeDraw: true },
      { frameIndex: 3, clearRegionBeforeDraw: null, restoreSnapshotBeforeDraw: true, captureSnapshotBeforeDraw: false },
    ]);
  });
});

describe('requiresGifCompositing', () => {
  it('is false when every frame is a full-canvas, disposal:none image', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'none' },
      { x: 0, y: 0, width: 10, height: 10, disposal: 'unspecified' },
    ];

    expect(requiresGifCompositing(frames, 10, 10)).toBe(false);
  });

  it('is true when any frame uses a partial region', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'none' },
      { x: 1, y: 1, width: 4, height: 4, disposal: 'none' },
    ];

    expect(requiresGifCompositing(frames, 10, 10)).toBe(true);
  });

  it('is true when any frame uses a disposal method other than none/unspecified', () => {
    const frames: GifFrameDisposalDescriptor[] = [
      { x: 0, y: 0, width: 10, height: 10, disposal: 'restoreToBackground' },
      { x: 0, y: 0, width: 10, height: 10, disposal: 'none' },
    ];

    expect(requiresGifCompositing(frames, 10, 10)).toBe(true);
  });
});

// A tiny in-memory "surface": each pixel is a single character in a string,
// so composited frames can be asserted on as plain strings. No canvas, no
// ImageData, no browser required.
function createStringCompositeSurface(canvasWidth: number, background = '.'): GifCompositeSurface<string, string> {
  let canvas = background.repeat(canvasWidth).split('');

  return {
    clearRegion(region) {
      for (let i = 0; i < region.width; i += 1) {
        canvas[region.x + i] = background;
      }
    },
    drawImage(image, region) {
      for (let i = 0; i < region.width; i += 1) {
        canvas[region.x + i] = image[i] ?? background;
      }
    },
    snapshot() {
      return canvas.join('');
    },
    restore(snapshot) {
      canvas = snapshot.split('');
    },
    toFrameImage() {
      return canvas.join('');
    },
  };
}

describe('compositeGifRawFrames', () => {
  it('leaves earlier content visible under a "none"-disposal overlay', () => {
    const frames: GifRawFrame<string>[] = [
      { x: 0, y: 0, width: 6, height: 1, disposal: 'none', durationMs: 100, image: 'BBBBBB' },
      { x: 1, y: 0, width: 2, height: 1, disposal: 'none', durationMs: 100, image: 'XX' },
    ];

    const output = compositeGifRawFrames(frames, createStringCompositeSurface(6));

    expect(output).toEqual(['BBBBBB', 'BXXBBB']);
  });

  it('clears the sprite region to background after "restoreToBackground"', () => {
    const frames: GifRawFrame<string>[] = [
      { x: 0, y: 0, width: 6, height: 1, disposal: 'none', durationMs: 100, image: 'BBBBBB' },
      { x: 1, y: 0, width: 2, height: 1, disposal: 'restoreToBackground', durationMs: 100, image: 'XX' },
      { x: 0, y: 0, width: 0, height: 0, disposal: 'none', durationMs: 100, image: '' },
    ];

    const output = compositeGifRawFrames(frames, createStringCompositeSurface(6));

    expect(output[1]).toBe('BXXBBB');
    // The sprite's own region reverts to background; nothing is drawn by frame 3.
    expect(output[2]).toBe('B..BBB');
  });

  it('restores the canvas to its pre-draw state after "restoreToPrevious"', () => {
    const frames: GifRawFrame<string>[] = [
      { x: 0, y: 0, width: 6, height: 1, disposal: 'none', durationMs: 100, image: 'BBBBBB' },
      { x: 1, y: 0, width: 2, height: 1, disposal: 'restoreToPrevious', durationMs: 100, image: 'XX' },
      { x: 0, y: 0, width: 0, height: 0, disposal: 'none', durationMs: 100, image: '' },
    ];

    const output = compositeGifRawFrames(frames, createStringCompositeSurface(6));

    expect(output[1]).toBe('BXXBBB');
    // Restored to exactly what frame 1 produced -- the sprite draw is undone.
    expect(output[2]).toBe('BBBBBB');
  });

  it('handles back-to-back "restoreToPrevious" frames by always restoring to the immediately preceding pre-draw state', () => {
    const frames: GifRawFrame<string>[] = [
      { x: 0, y: 0, width: 4, height: 1, disposal: 'none', durationMs: 50, image: 'AAAA' },
      { x: 0, y: 0, width: 1, height: 1, disposal: 'restoreToPrevious', durationMs: 50, image: '1' },
      { x: 1, y: 0, width: 1, height: 1, disposal: 'restoreToPrevious', durationMs: 50, image: '2' },
      { x: 0, y: 0, width: 0, height: 0, disposal: 'none', durationMs: 50, image: '' },
    ];

    const output = compositeGifRawFrames(frames, createStringCompositeSurface(4));

    expect(output).toEqual(['AAAA', '1AAA', 'A2AA', 'AAAA']);
  });

  it('runs unmodified through createPassthroughGifCompositeSurface when every frame is already a full composite', () => {
    const frames: GifRawFrame<string>[] = [
      { x: 0, y: 0, width: 4, height: 4, disposal: 'none', durationMs: 40, image: 'frame-0' },
      { x: 0, y: 0, width: 4, height: 4, disposal: 'none', durationMs: 40, image: 'frame-1' },
    ];

    const output = compositeGifRawFrames(frames, createPassthroughGifCompositeSurface<string>());

    expect(output).toEqual(['frame-0', 'frame-1']);
  });
});

describe('getGifFrameTimeline / getGifTotalDurationMs', () => {
  it('returns cumulative start times, including through a zero-duration frame', () => {
    const frames = [{ durationMs: 100 }, { durationMs: 0 }, { durationMs: 40 }, { durationMs: 60 }];

    expect(getGifFrameTimeline(frames)).toEqual([0, 100, 100, 140]);
    expect(getGifTotalDurationMs(frames)).toBe(200);
  });

  it('returns an empty timeline and zero duration for no frames', () => {
    expect(getGifFrameTimeline([])).toEqual([]);
    expect(getGifTotalDurationMs([])).toBe(0);
  });

  it('treats negative durations as zero-width so they never go backwards', () => {
    const frames = [{ durationMs: 100 }, { durationMs: -50 }, { durationMs: 30 }];

    expect(getGifFrameTimeline(frames)).toEqual([0, 100, 100]);
    expect(getGifTotalDurationMs(frames)).toBe(130);
  });
});

describe('selectGifFrameIndexAtTime', () => {
  const frames = [{ durationMs: 100 }, { durationMs: 50 }, { durationMs: 200 }];
  // timeline: [0, 100, 150], total 350

  it('returns 0 for an empty frame list', () => {
    expect(selectGifFrameIndexAtTime([], 500)).toBe(0);
  });

  it('returns 0 when every frame has zero duration', () => {
    expect(selectGifFrameIndexAtTime([{ durationMs: 0 }, { durationMs: 0 }], 10)).toBe(0);
  });

  it('always returns 0 for a single-frame animation regardless of time or loop option', () => {
    expect(selectGifFrameIndexAtTime([{ durationMs: 100 }], 99999, { loop: false })).toBe(0);
    expect(selectGifFrameIndexAtTime([{ durationMs: 100 }], -99999, { loop: true })).toBe(0);
  });

  it('picks the frame whose window contains timeMs', () => {
    expect(selectGifFrameIndexAtTime(frames, 0)).toBe(0);
    expect(selectGifFrameIndexAtTime(frames, 50)).toBe(0);
    expect(selectGifFrameIndexAtTime(frames, 99)).toBe(0);
    expect(selectGifFrameIndexAtTime(frames, 100)).toBe(1);
    expect(selectGifFrameIndexAtTime(frames, 149)).toBe(1);
    expect(selectGifFrameIndexAtTime(frames, 150)).toBe(2);
    expect(selectGifFrameIndexAtTime(frames, 349)).toBe(2);
  });

  it('wraps forward past the end when loop is true (the default)', () => {
    expect(selectGifFrameIndexAtTime(frames, 350)).toBe(0); // exactly one full loop
    expect(selectGifFrameIndexAtTime(frames, 350 + 150)).toBe(2); // one full loop + into frame 2's window
    expect(selectGifFrameIndexAtTime(frames, 350 * 3 + 20)).toBe(0);
  });

  it('wraps negative time backwards from the end when loop is true', () => {
    expect(selectGifFrameIndexAtTime(frames, -1)).toBe(2); // one tick before wrap = last frame
    expect(selectGifFrameIndexAtTime(frames, -350)).toBe(0); // exactly a full loop back
    expect(selectGifFrameIndexAtTime(frames, -350 - 10)).toBe(2); // 340ms into the loop, still frame 2's window
  });

  it('clamps to the last frame once time reaches or passes the total when loop is false', () => {
    expect(selectGifFrameIndexAtTime(frames, 350, { loop: false })).toBe(2);
    expect(selectGifFrameIndexAtTime(frames, 100000, { loop: false })).toBe(2);
  });

  it('clamps negative time to the first frame when loop is false', () => {
    expect(selectGifFrameIndexAtTime(frames, -1, { loop: false })).toBe(0);
  });
});

describe('describeGifForFfmpeg', () => {
  function makeResult(frameCount: number, totalDurationMs: number): GifDecodeResult {
    return {
      width: 10,
      height: 10,
      loopCount: 0,
      totalDurationMs,
      frames: Array.from({ length: frameCount }, (_unused, index) => ({
        index,
        durationMs: totalDurationMs / Math.max(1, frameCount),
        timestampMs: 0,
        bitmap: {} as ImageData,
      })),
    };
  }

  it('reports single-frame GIFs as not animated', () => {
    expect(describeGifForFfmpeg(makeResult(1, 0))).toEqual({
      isAnimated: false,
      frameCount: 1,
      avgFrameDelayMs: 0,
    });
  });

  it('reports multi-frame GIFs as animated, with the average per-frame delay', () => {
    expect(describeGifForFfmpeg(makeResult(4, 400))).toEqual({
      isAnimated: true,
      frameCount: 4,
      avgFrameDelayMs: 100,
    });
  });
});

describe('probeGifAnimation', () => {
  function makeProbeBackend(overrides: Partial<GifDecodeBackend> = {}): GifDecodeBackend {
    return {
      width: 10,
      height: 10,
      loopCount: 0,
      frameCount: 1,
      decodeFrame: vi.fn(async () => {
        throw new Error('probeGifAnimation must never decode frame pixels');
      }),
      ...overrides,
    };
  }

  it('reports a single-frame backend as not animated', async () => {
    const backend = makeProbeBackend({ frameCount: 1 });

    await expect(probeGifAnimation(new Uint8Array([1]), {
      createBackend: async () => backend,
    })).resolves.toEqual({ isAnimated: false, frameCount: 1 });
    expect(backend.decodeFrame).not.toHaveBeenCalled();
  });

  it('reports a multi-frame backend as animated, without decoding any frame', async () => {
    const backend = makeProbeBackend({ frameCount: 24 });

    await expect(probeGifAnimation(new Uint8Array([1]), {
      createBackend: async () => backend,
    })).resolves.toEqual({ isAnimated: true, frameCount: 24 });
    expect(backend.decodeFrame).not.toHaveBeenCalled();
  });

  it('closes the backend after probing', async () => {
    const close = vi.fn();
    const backend = makeProbeBackend({ frameCount: 3, close });

    await probeGifAnimation(new Uint8Array([1]), { createBackend: async () => backend });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resolves a graceful single-frame result when no backend is available', async () => {
    await expect(probeGifAnimation(new Uint8Array([1]), {
      createBackend: async () => null,
    })).resolves.toEqual({ isAnimated: false, frameCount: 1 });
  });

  it('resolves a graceful single-frame result when backend creation rejects', async () => {
    await expect(probeGifAnimation(new Uint8Array([1]), {
      createBackend: async () => {
        throw new Error('boom');
      },
    })).resolves.toEqual({ isAnimated: false, frameCount: 1 });
  });
});

describe('decodeGifFrames', () => {
  function makeBackend(overrides: Partial<GifDecodeBackend> & { rawFrames: GifRawFrame[] }): GifDecodeBackend {
    const { rawFrames, ...rest } = overrides;

    return {
      width: 10,
      height: 10,
      loopCount: 0,
      frameCount: rawFrames.length,
      decodeFrame: async (index: number) => rawFrames[index],
      ...rest,
    };
  }

  it('never throws and resolves a graceful single frame when no backend is available', async () => {
    const result = await decodeGifFrames(new Uint8Array([1, 2, 3]), {
      createBackend: async () => null,
    });

    expect(result.frames).toHaveLength(1);
    expect(result.totalDurationMs).toBe(0);
    expect(result.loopCount).toBe(0);
  });

  it('never throws and resolves a graceful single frame when the backend rejects', async () => {
    const result = await decodeGifFrames(new Uint8Array([1, 2, 3]), {
      createBackend: async () => {
        throw new Error('boom');
      },
    });

    expect(result.frames).toHaveLength(1);
  });

  it('never throws and resolves gracefully when a frame decode rejects mid-stream', async () => {
    const backend = makeBackend({
      rawFrames: [],
      frameCount: 2,
      decodeFrame: async (index: number) => {
        if (index === 1) {
          throw new Error('corrupt frame');
        }
        return { x: 0, y: 0, width: 10, height: 10, disposal: 'none', durationMs: 50, image: {} as ImageData };
      },
    });

    const result = await decodeGifFrames(new Uint8Array([1, 2, 3]), {
      createBackend: async () => backend,
    });

    expect(result.frames).toHaveLength(1);
  });

  it('passes full-canvas disposal:none frames straight through without needing a compositing surface', async () => {
    const frameA = { x: 0, y: 0, width: 10, height: 10, disposal: 'none' as const, durationMs: 80, image: { tag: 'a' } as unknown as ImageData };
    const frameB = { x: 0, y: 0, width: 10, height: 10, disposal: 'none' as const, durationMs: 120, image: { tag: 'b' } as unknown as ImageData };
    const backend = makeBackend({ rawFrames: [frameA, frameB], loopCount: 3 });
    const createSurface = vi.fn();

    const result = await decodeGifFrames(new Uint8Array([1]), {
      createBackend: async () => backend,
      createSurface,
    });

    expect(createSurface).not.toHaveBeenCalled();
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.loopCount).toBe(3);
    expect(result.totalDurationMs).toBe(200);
    expect(result.frames.map((frame) => frame.bitmap)).toEqual([frameA.image, frameB.image]);
    expect(result.frames.map((frame) => frame.timestampMs)).toEqual([0, 80]);
  });

  it('routes through the injected compositing surface when disposal requires real compositing', async () => {
    const spriteFrame = {
      x: 2, y: 0, width: 3, height: 1, disposal: 'restoreToBackground' as const, durationMs: 50, image: 'sprite',
    };
    const nextFrame = {
      x: 0, y: 0, width: 10, height: 1, disposal: 'none' as const, durationMs: 50, image: 'next',
    };
    const backend = makeBackend({ rawFrames: [spriteFrame, nextFrame] as unknown as GifRawFrame[], width: 10, height: 1 });

    const calls: string[] = [];
    const createSurface = vi.fn((width: number) => {
      const surface = createStringCompositeSurface(width);
      return {
        clearRegion: (region: { x: number; width: number }) => {
          calls.push(`clear:${region.x}:${region.width}`);
          surface.clearRegion(region as never);
        },
        drawImage: (image: unknown, region: { x: number; width: number }) => {
          calls.push(`draw:${region.x}:${region.width}`);
          surface.drawImage(image as string, region as never);
        },
        snapshot: () => surface.snapshot(),
        restore: (snapshot: string) => surface.restore(snapshot),
        toFrameImage: () => surface.toFrameImage(),
      };
    });

    const result = await decodeGifFrames(new Uint8Array([1]), {
      createBackend: async () => backend,
      createSurface: createSurface as unknown as NonNullable<Parameters<typeof decodeGifFrames>[1]>['createSurface'],
    });

    expect(createSurface).toHaveBeenCalledWith(10, 1);
    // Frame 1 draws first; only once frame 2 is about to draw does the sprite's
    // own region get cleared (that's frame 1's restoreToBackground disposal).
    expect(calls).toEqual(['draw:2:3', 'clear:2:3', 'draw:0:10']);
    expect(result.frames).toHaveLength(2);
  });

  it('decodes a single, non-animated frame cleanly', async () => {
    const decodeFrame = vi.fn(async () => ({
      x: 0, y: 0, width: 4, height: 4, disposal: 'none' as const, durationMs: 0, image: {} as ImageData,
    }));
    const backend = makeBackend({ rawFrames: [], frameCount: 1, width: 4, height: 4, decodeFrame });

    const result = await decodeGifFrames(new Uint8Array([1]), { createBackend: async () => backend });

    expect(decodeFrame).toHaveBeenCalledTimes(1);
    expect(result.frames).toHaveLength(1);
    expect(result.totalDurationMs).toBe(0);
  });

  it('reads bytes the same way from an ArrayBuffer, a Uint8Array, and a Blob', async () => {
    const received: number[][] = [];
    const createBackend = async (bytes: Uint8Array) => {
      received.push(Array.from(bytes));
      return null;
    };

    const source = new Uint8Array([10, 20, 30]);
    await decodeGifFrames(source, { createBackend });
    await decodeGifFrames(source.buffer, { createBackend });
    await decodeGifFrames(new Blob([source]), { createBackend });

    expect(received).toEqual([[10, 20, 30], [10, 20, 30], [10, 20, 30]]);
  });
});
