import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_SCOPE_CAPTURE_HEIGHT,
  DEFAULT_VIDEO_SCOPE_CAPTURE_WIDTH,
  VIDEO_DECODED_FRAME_SCOPE_SCHEMA,
  buildDecodedFrameScopesPanelKey,
  compactVideoScopeBinsForDisplay,
  measureDecodedVideoFrameScopes,
  type DecodedVideoFrameScopeCanvas,
} from './videoDecodedFrameScopes';

function createCanvas(data: Uint8ClampedArray, onDraw?: (width: number, height: number) => void): DecodedVideoFrameScopeCanvas {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (_image, _x, _y, width, height) => onDraw?.(width, height),
      getImageData: () => ({ data }) as ImageData,
    }),
  };
}

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const x = pixel % width;
    const value = Math.round((x / Math.max(1, width - 1)) * 255);
    data.set([value, value, value, 255], pixel * 4);
  }
  return data;
}

describe('decoded rendered-video frame scopes', () => {
  it('uses a distinct transient-panel identity for a new rendition, mode, or output kind', () => {
    const rendered = buildDecodedFrameScopesPanelKey({
      isImageSequenceOutput: false,
      isRenderedPreview: true,
      previewIdentity: 'blob:render-a',
    });

    expect(rendered).not.toBe(buildDecodedFrameScopesPanelKey({
      isImageSequenceOutput: false,
      isRenderedPreview: true,
      previewIdentity: 'blob:render-b',
    }));
    expect(rendered).not.toBe(buildDecodedFrameScopesPanelKey({
      isImageSequenceOutput: false,
      isRenderedPreview: false,
      previewIdentity: 'blob:render-a',
    }));
    expect(rendered).not.toBe(buildDecodedFrameScopesPanelKey({
      isImageSequenceOutput: true,
      isRenderedPreview: true,
      previewIdentity: 'blob:render-a',
    }));
  });

  it('measures actual decoded pixels at a bounded monitor size without returning the pixel buffer', () => {
    const sampledWidth = DEFAULT_VIDEO_SCOPE_CAPTURE_WIDTH;
    const sampledHeight = DEFAULT_VIDEO_SCOPE_CAPTURE_HEIGHT;
    const drawn: Array<[number, number]> = [];
    const result = measureDecodedVideoFrameScopes({
      currentTime: 1.25,
      readyState: 2,
      videoHeight: 1_080,
      videoWidth: 1_920,
    }, {
      createCanvas: () => createCanvas(gradient(sampledWidth, sampledHeight), (width, height) => drawn.push([width, height])),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(drawn).toEqual([[sampledWidth, sampledHeight]]);
    expect(result.value).toMatchObject({
      schema: VIDEO_DECODED_FRAME_SCOPE_SCHEMA,
      source: 'rendered-program-monitor',
      capturedAtMilliseconds: 1_250,
      sourceDimensions: { width: 1_920, height: 1_080 },
      sampledDimensions: { width: sampledWidth, height: sampledHeight },
    });
    expect(result.value.scopes.sampleCount).toBeLessThanOrEqual(32_768);
    expect(result.value.scopes.histogram.filter((count) => count > 0).length).toBeGreaterThan(128);
    expect(result.value.scopes.waveform.bins.length).toBeLessThanOrEqual(512);
    expect(result.value.scopes.rgbParade.red.length).toBeLessThanOrEqual(512);
    expect(result.value.scopes.rgbParade.green.length).toBeLessThanOrEqual(512);
    expect(result.value.scopes.rgbParade.blue.length).toBeLessThanOrEqual(512);
    expect(result.value.scopes.vectorscope.bins.length).toBeLessThanOrEqual(512);
    expect(result.value.scopes.waveform.bins.reduce((total, bin) => total + bin.count, 0)).toBe(result.value.scopes.sampleCount);
    expect(JSON.stringify(result.value)).not.toContain('data');
  });

  it('refuses a missing or not-yet-decoded monitor instead of generating simulated scopes', () => {
    expect(measureDecodedVideoFrameScopes(null)).toMatchObject({ ok: false, reason: 'monitor-unavailable' });
    expect(measureDecodedVideoFrameScopes({
      currentTime: 0,
      readyState: 1,
      videoHeight: 1080,
      videoWidth: 1920,
    })).toMatchObject({ ok: false, reason: 'monitor-not-ready' });
    expect(measureDecodedVideoFrameScopes({
      currentTime: 0,
      readyState: 2,
      videoHeight: 0,
      videoWidth: 0,
    })).toMatchObject({ ok: false, reason: 'no-decoded-frame' });
  });

  it('reports security-blocked canvas readback instead of using an untrusted fallback', () => {
    const result = measureDecodedVideoFrameScopes({
      currentTime: 0,
      readyState: 2,
      videoHeight: 2,
      videoWidth: 2,
    }, {
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => { throw { name: 'SecurityError' }; },
        }),
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: 'canvas-readback-blocked' });
  });

  it('caps caller-provided dimensions and sampling budget', () => {
    const result = measureDecodedVideoFrameScopes({
      currentTime: 0,
      readyState: 2,
      videoHeight: 360,
      videoWidth: 640,
    }, {
      maxHeight: 99_999,
      maxSamples: 99_999,
      maxWidth: 99_999,
      createCanvas: () => createCanvas(gradient(640, 360)),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sampledDimensions).toEqual({ width: 640, height: 360 });
    expect(result.value.scopes.sampleCount).toBeLessThanOrEqual(65_536);
  });

  it('compacts dense scope marks for display while preserving their counted samples', () => {
    const bins = Array.from({ length: 1_024 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), count: index + 1 }));
    const compacted = compactVideoScopeBinsForDisplay(bins, 64, 16, 128);
    expect(compacted.length).toBeLessThanOrEqual(128);
    expect(compacted.reduce((total, bin) => total + bin.count, 0)).toBe(bins.reduce((total, bin) => total + bin.count, 0));
  });
});
