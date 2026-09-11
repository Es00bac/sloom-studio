import { describe, expect, it, vi } from 'vitest';
import { blobToDataUrl } from './imageEditorAi/blobUtils';
import {
  isLocalCpuUpscalerConfigured,
  normalizeLocalCpuUpscalerBaseUrl,
  runLocalCpuUpscaler,
} from './localCpuUpscaler';

describe('normalizeLocalCpuUpscalerBaseUrl', () => {
  it('normalizes IP and port shorthand URLs', () => {
    expect(normalizeLocalCpuUpscalerBaseUrl('192.168.1.42:8788/v1/upscale')).toBe('http://192.168.1.42:8788');
    expect(normalizeLocalCpuUpscalerBaseUrl(':8788')).toBe('http://127.0.0.1:8788');
    expect(normalizeLocalCpuUpscalerBaseUrl('   127.0.0.1:8788/  ')).toBe('http://127.0.0.1:8788');
  });
});

describe('isLocalCpuUpscalerConfigured', () => {
  it('checks if a valid local AI upscaler URL is present', () => {
    expect(isLocalCpuUpscalerConfigured({ localAiCpuEndpointUrl: '' })).toBe(false);
    expect(isLocalCpuUpscalerConfigured({ localAiCpuEndpointUrl: 'http://127.0.0.1:8788/v1/upscale' })).toBe(true);
  });
});

describe('runLocalCpuUpscaler', () => {
  it('posts to /v1/upscale and handles image responses', async () => {
    const fetchMock = async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('http://127.0.0.1:8788/v1/upscale');
      return new Response(await blobToDataUrl(new Blob(['upscaled'], { type: 'image/png' })), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    };
    vi.stubGlobal('fetch', fetchMock);

    const result = await runLocalCpuUpscaler({
      baseUrl: '127.0.0.1:8788',
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 512,
      targetHeightPx: 768,
      model: 'realesrgan-4x',
      outputFormat: 'png',
    });

    expect(result.dataUrl).toContain('data:image/png;base64,');
    expect(result.mimeType).toBe('image/png');
  });

  it('parses JSON base64 responses from compatible local AI upscalers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      image: 'c3VwZXJw',
      mimeType: 'image/png',
      modelUsed: 'realesrgan-4x',
      width: 512,
      height: 768,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runLocalCpuUpscaler({
      baseUrl: 'http://127.0.0.1:8788',
      sourceDataUrl: 'data:image/png;base64,source',
      targetWidthPx: 512,
      targetHeightPx: 768,
    });

    expect(result.dataUrl).toBe('data:image/png;base64,c3VwZXJw');
    expect(result.modelUsed).toBe('realesrgan-4x');
    expect(result.width).toBe(512);
    expect(result.height).toBe(768);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8788/v1/upscale',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
