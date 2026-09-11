import { describe, expect, it, vi } from 'vitest';
import {
  getAndroidAcceleratorStatus,
  isRetryableAndroidAcceleratorError,
  isAndroidAcceleratorConfigured,
  normalizeAndroidAcceleratorBaseUrl,
  resolveAndroidModelAvailability,
  resolveAndroidUpscalerAvailability,
  runAndroidAcceleratorGenerate,
  runAndroidAcceleratorUpscale,
  runAndroidAcceleratorUpscaleWithRetry,
  summarizeAndroidAcceleratorStatus,
} from './androidAccelerator';

const sampleInputPng = `data:image/png;base64,${btoa('input-image')}`;
const sampleOutputPngBase64 = btoa('output-image');

describe('androidAccelerator', () => {
  it('normalizes and detects configured LAN accelerator endpoints', () => {
    expect(normalizeAndroidAcceleratorBaseUrl(' http://192.168.1.42:8788/// ')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('192.168.1.42:8788')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl(':8788')).toBe('http://127.0.0.1:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('8788')).toBe('http://127.0.0.1:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('http://192.168.1.42:8788/v1')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('http://192.168.1.42:8788/v1/capabilities')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('192.168.1.42:8788/v1/upscale')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('http://192.168.1.42:8788/v1/generate')).toBe('http://192.168.1.42:8788');
    expect(normalizeAndroidAcceleratorBaseUrl('http://192.168.1.42:8788/signal')).toBe('http://192.168.1.42:8788/signal');
    expect(normalizeAndroidAcceleratorBaseUrl('http://192.168.1.42:8788/v1/signal-labs')).toBe('http://192.168.1.42:8788/v1/signal-labs');
    expect(isAndroidAcceleratorConfigured({ androidAcceleratorBaseUrl: 'http://192.168.1.42:8788' })).toBe(true);
    expect(isAndroidAcceleratorConfigured({ androidAcceleratorBaseUrl: '   ' })).toBe(false);
    expect(isAndroidAcceleratorConfigured({ androidAcceleratorBaseUrl: 'not a url' })).toBe(false);
  });

  it('throws a connectivity-specific error when Android accelerator URL is malformed', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    await expect(runAndroidAcceleratorUpscale({
      baseUrl: '   ',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      outputFormat: 'png',
      fetchImpl,
    })).rejects.toThrow('Android accelerator URL is not usable');
  });

  it('loads health and capability state from the companion server', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      port: 8788,
      deviceName: 'Galaxy S26 Ultra',
      accelerator: 'qnn-htp',
      models: [{ id: 'local-dream-sdxl', kind: 'txt2img' }],
      upscalers: [{ id: 'upscaler_realistic', scale: 4 }],
      jobStatus: {
        active: true,
        activeJobs: 1,
        completedJobs: 4,
        failedJobs: 0,
        operation: 'upscale',
        modelId: 'upscaler_realistic',
        targetWidthPx: 2447,
        targetHeightPx: 1366,
      },
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getAndroidAcceleratorStatus({
      baseUrl: 'http://phone.local:8788/',
      authToken: 'pair-token',
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      port: 8788,
      accelerator: 'qnn-htp',
      models: [{ id: 'local-dream-sdxl' }],
      upscalers: [{ id: 'upscaler_realistic', scale: 4 }],
      jobStatus: {
        active: true,
        operation: 'upscale',
        targetWidthPx: 2447,
        targetHeightPx: 1366,
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith('http://phone.local:8788/v1/capabilities', {
      headers: { Authorization: 'Bearer pair-token', 'X-Signal-Loom-Auth': 'pair-token' },
      method: 'GET',
      signal: undefined,
    });
  });

  it('normalizes host-only and malformed endpoint variants before requesting capabilities', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/v1/capabilities')) {
        return new Response(JSON.stringify({
          ok: true,
          models: [],
          upscalers: [{ id: 'upscaler_realistic', scale: 4, downloaded: true }],
        }), {
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        image: sampleOutputPngBase64,
        mimeType: 'image/png',
        width: 600,
        height: 400,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(getAndroidAcceleratorStatus({
      baseUrl: '192.168.1.42:8788/v1/capabilities',
      authToken: 'pair-token',
      fetchImpl,
    })).resolves.toMatchObject({
      ok: true,
      upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
    });

    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe('http://192.168.1.42:8788/v1/capabilities');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer pair-token', 'X-Signal-Loom-Auth': 'pair-token' });

    fetchImpl.mockClear();
    await expect(runAndroidAcceleratorUpscale({
      baseUrl: ':8788/v1',
      authToken: 'pair-token',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 600,
      targetHeightPx: 400,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
      fetchImpl,
    })).resolves.toBeDefined();

    const upscaleCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes('/v1/upscale')) as unknown as [string, RequestInit] | undefined;
    expect(upscaleCall?.[0]).toBe('http://127.0.0.1:8788/v1/upscale');
    expect(upscaleCall?.[1]?.method).toBe('POST');
  });

  it('summarizes companion bridge readiness for setup UI', () => {
    expect(summarizeAndroidAcceleratorStatus({
      ok: true,
      deviceName: 'Galaxy S26 Ultra',
      accelerator: 'qnn-htp',
      models: [{ id: 'local-dream-active', kind: 'txt2img' }],
      upscalers: [{ id: 'upscaler_realistic', bridgeModeAvailable: true }],
      version: '0.1.0',
    })).toMatchObject({
      mode: 'bridge',
      title: 'Galaxy S26 Ultra online via standalone companion bridge',
      readyForGeneration: true,
      readyForUpscale: true,
      warnings: [],
    });
  });

  it('summarizes one-app Android readiness and model-data migration warnings', () => {
    const summary = summarizeAndroidAcceleratorStatus({
      ok: true,
      deviceName: 'Galaxy S26 Ultra',
      accelerator: 'qnn-htp',
      mode: 'local-dream-integrated',
      models: [],
      upscalers: [{ id: 'upscaler_realistic', downloaded: true }],
      version: '0.2.0-localdream',
      warnings: ['No Local Dream image model is downloaded in this app.'],
    });

    expect(summary).toMatchObject({
      mode: 'integrated',
      title: 'Galaxy S26 Ultra online via one-app Sloom Studio Android',
      readyForGeneration: false,
      readyForUpscale: true,
    });
    expect(summary.warnings.join(' ')).toContain('needs at least one downloaded model inside that app');
  });

  it('posts print-upscale jobs as JSON image requests and parses JSON image results', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/v1/capabilities')) {
        return new Response(JSON.stringify({
          ok: true,
          models: [],
          upscalers: [{ id: 'upscaler_realistic', scale: 4, downloaded: false, bridgeModeAvailable: true }],
        }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        image: sampleOutputPngBase64,
        mimeType: 'image/png',
        modelUsed: 'upscaler_realistic',
        width: 1200,
        height: 800,
        accelerator: 'qnn-htp',
      }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await runAndroidAcceleratorUpscale({
      baseUrl: 'http://192.168.1.42:8788',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
      fetchImpl,
    });

    expect(result).toMatchObject({
      dataUrl: `data:image/png;base64,${sampleOutputPngBase64}`,
      mimeType: 'image/png',
      modelUsed: 'upscaler_realistic',
      accelerator: 'qnn-htp',
    });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe('http://192.168.1.42:8788/v1/capabilities');
    const [, init] = calls[1];
    expect(calls[1][0]).toBe('http://192.168.1.42:8788/v1/upscale');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer secret',
      'X-Signal-Loom-Auth': 'secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      image: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
    });
  });

  it('preflights phone upscaler availability before posting image bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      models: [],
      upscalers: [{ id: 'upscaler_realistic', scale: 4, downloaded: false, bridgeModeAvailable: false }],
      warnings: ['Local Dream native backend was not reachable at 127.0.0.1:8081 during this capability check.'],
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(runAndroidAcceleratorUpscale({
      baseUrl: 'http://192.168.1.42:8788',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
      fetchImpl,
    })).rejects.toThrow('Android upscaler "upscaler_realistic" is not available. Open Local Dream on the phone');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://192.168.1.42:8788/v1/capabilities', expect.objectContaining({
      method: 'GET',
    }));
  });

  it('retries transient Android upscale failures before returning the image', async () => {
    const retryEvents: string[] = [];
    let upscaleAttempts = 0;
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/v1/capabilities')) {
        return new Response(JSON.stringify({
          ok: true,
          models: [],
          upscalers: [{ id: 'upscaler_realistic', scale: 4, downloaded: false, bridgeModeAvailable: true }],
        }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      upscaleAttempts += 1;
      if (upscaleAttempts === 1) {
        return new Response('phone busy', { status: 503 });
      }
      return new Response(JSON.stringify({
        image: sampleOutputPngBase64,
        mimeType: 'image/png',
        width: 1200,
        height: 800,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(runAndroidAcceleratorUpscaleWithRetry({
      baseUrl: 'http://192.168.1.42:8788',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
      fetchImpl,
    }, {
      maxAttempts: 2,
      delayMs: 0,
      onRetry: (event) => retryEvents.push(`${event.nextAttempt}/${event.maxAttempts}`),
    })).resolves.toMatchObject({
      dataUrl: `data:image/png;base64,${sampleOutputPngBase64}`,
      width: 1200,
      height: 800,
    });

    expect(upscaleAttempts).toBe(2);
    expect(retryEvents).toEqual(['2/2']);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not retry configuration or missing-model Android failures', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      models: [],
      upscalers: [{ id: 'upscaler_realistic', scale: 4, downloaded: false, bridgeModeAvailable: false }],
      warnings: ['No Local Dream image model is downloaded in this app.'],
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(runAndroidAcceleratorUpscaleWithRetry({
      baseUrl: 'http://192.168.1.42:8788',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      upscalerId: 'upscaler_realistic',
      outputFormat: 'png',
      fetchImpl,
    }, {
      maxAttempts: 3,
      delayMs: 0,
    })).rejects.toThrow('No Local Dream image model is downloaded');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rewords network connection failures into a connectivity hint', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(runAndroidAcceleratorUpscale({
      baseUrl: '192.168.1.42:8788',
      authToken: 'secret',
      sourceDataUrl: sampleInputPng,
      targetWidthPx: 1200,
      targetHeightPx: 800,
      outputFormat: 'png',
      fetchImpl,
    })).rejects.toThrow('Could not connect to Android accelerator at "http://192.168.1.42:8788"');
  });

  it('classifies retryable Android accelerator errors conservatively', () => {
    expect(isRetryableAndroidAcceleratorError(new Error('Android accelerator request failed (503): phone busy'))).toBe(true);
    expect(isRetryableAndroidAcceleratorError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableAndroidAcceleratorError(new Error('Android accelerator URL is not configured.'))).toBe(false);
    expect(isRetryableAndroidAcceleratorError(new Error('Upscaler is not downloaded.'))).toBe(false);
  });

  it('explains when the selected Android upscaler is not ready', () => {
    expect(resolveAndroidUpscalerAvailability({
      upscalers: [{ id: 'upscaler_realistic', downloaded: false, bridgeModeAvailable: false }],
      warnings: ['Local Dream backend is not reachable.'],
    }, 'upscaler_realistic')).toEqual({
      available: false,
      reason: 'Android upscaler "upscaler_realistic" is not available. Open Local Dream on the phone, choose/download the upscaler or model it uses, and wait for the bridge status to become reachable before retrying. Local Dream backend is not reachable.',
    });

    expect(resolveAndroidUpscalerAvailability({
      upscalers: [{ id: 'upscaler_realistic', downloaded: false, bridgeModeAvailable: true }],
    }, 'upscaler_realistic')).toEqual({ available: true });
  });

  it('posts text-to-image generation jobs to the companion API', async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/v1/capabilities')) {
        return new Response(JSON.stringify({
          ok: true,
          models: [{ id: 'local-dream-sd15', kind: 'txt2img' }],
          upscalers: [],
        }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        image: sampleOutputPngBase64,
        mimeType: 'image/png',
        modelUsed: 'local-dream-sd15',
        seed: 1234,
      }), {
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(runAndroidAcceleratorGenerate({
      baseUrl: 'http://phone.local:8788',
      modelId: 'local-dream-sd15',
      prompt: 'a production-safe comic panel',
      negativePrompt: 'blurry',
      width: 768,
      height: 512,
      steps: 24,
      cfgScale: 7,
      seed: 1234,
      fetchImpl,
    })).resolves.toMatchObject({
      dataUrl: `data:image/png;base64,${sampleOutputPngBase64}`,
      modelUsed: 'local-dream-sd15',
      seed: 1234,
    });

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe('http://phone.local:8788/v1/capabilities');
    const [, init] = calls[1];
    expect(calls[1][0]).toBe('http://phone.local:8788/v1/generate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      modelId: 'local-dream-sd15',
      prompt: 'a production-safe comic panel',
      negativePrompt: 'blurry',
      width: 768,
      height: 512,
      steps: 24,
      cfgScale: 7,
      seed: 1234,
    });
  });

  it('preflights Android generation model availability before posting prompt jobs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      models: [],
      upscalers: [],
      warnings: ['Local Dream native backend was not reachable at 127.0.0.1:8081 during this capability check.'],
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(runAndroidAcceleratorGenerate({
      baseUrl: 'http://phone.local:8788',
      modelId: 'local-dream-active',
      prompt: 'a production-safe comic panel',
      width: 768,
      height: 512,
      fetchImpl,
    })).rejects.toThrow('Android image model "local-dream-active" is not available. Open Local Dream on the phone');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://phone.local:8788/v1/capabilities', expect.objectContaining({
      method: 'GET',
    }));
  });

  it('explains when the selected Android generation model is not ready', () => {
    expect(resolveAndroidModelAvailability({
      models: [],
      warnings: ['Local Dream backend is not reachable.'],
    }, 'local-dream-active')).toEqual({
      available: false,
      reason: 'Android image model "local-dream-active" is not available. Open Local Dream on the phone, tap a downloaded NPU model, and wait for the Sloom Studio companion bridge status to become reachable before retrying. Local Dream backend is not reachable.',
    });

    expect(resolveAndroidModelAvailability({
      models: [{ id: 'local-dream-active' }],
    }, 'local-dream-active')).toEqual({ available: true });
  });
});
