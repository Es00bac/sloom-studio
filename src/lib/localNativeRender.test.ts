import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeLoudnessViaLocalNativeFFmpeg,
  renderViaLocalNativeFFmpeg,
  renderViaLocalNativeFFmpegToFile,
  renderViaLocalNativeFFmpegWithArtifacts,
  resolveNativeRenderTarget,
} from './localNativeRender';
import type { ProviderSettings } from '../types/flow';

const baseSettings: ProviderSettings = {
  renderBackendPreference: 'auto',
  exportCompositorPreference: 'stage',
  localNativeRenderUrl: 'http://127.0.0.1:41736',
  localNativeRenderToken: '',
  openaiBaseUrl: '',
  elevenlabsVoiceId: '',
  backendProxyEnabled: false,
  backendProxyBaseUrl: '',
  geminiCredentialMode: 'vertex-adc',
  vertexAuthMode: 'gcloud-adc',
  vertexProjectId: '',
  vertexLocation: 'us-central1',
  vertexQuotaProjectId: '',
  vertexEnvironmentVariables: '',
  vertexServiceAccountJson: '',
  paperPrintUpscaleMethod: 'auto',
  paperPdfRasterPreset: 'balanced-jpeg',
  localOpenImageEndpointUrl: '',
  localOpenImageAuthHeader: '',
  localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
  genericImageEndpointUrl: '',
  genericImageAuthHeader: '',
  localAiCpuEndpointUrl: '',
  localAiCpuAuthHeader: '',
  localAiCpuModel: 'realesrgan-4x',
  androidAcceleratorBaseUrl: '',
  androidAcceleratorAuthToken: '',
  androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
  androidAcceleratorDefaultImageModel: 'local-dream-active',
  batchMaxRetries: 10,
  batchRetryBaseDelayMs: 30000, androidLanServerEnabled: false, androidLanServerPin: "",
};

function installWindowTimers() {
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
  });
}

function mockHealth(health: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(health), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })));
}

describe('localNativeRender', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('auto selects AMD VAAPI GPU rendering when the local service reports it', async () => {
    installWindowTimers();
    mockHealth({
      ok: true,
      availableBackends: ['cpu', 'amd-vaapi'],
      recommendedBackend: 'amd-vaapi',
      backendDetails: {
        amdVaapi: {
          devicePath: '/dev/dri/renderD128',
          encoder: 'h264_vaapi',
        },
      },
    });

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      localNativeRenderUrl: 'http://127.0.0.1:41737',
      renderBackendPreference: 'auto',
    })).resolves.toEqual({
      endpoint: 'http://127.0.0.1:41737',
      backend: 'amd-vaapi',
    });
  });

  it('forced AMD VAAPI reports a clear error when the GPU backend is unavailable', async () => {
    installWindowTimers();
    mockHealth({
      ok: true,
      availableBackends: ['cpu'],
      recommendedBackend: 'cpu',
    });

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      localNativeRenderUrl: 'http://127.0.0.1:41738',
      renderBackendPreference: 'native-amd-vaapi',
    })).rejects.toThrow('AMD VAAPI rendering is not available');
  });

  it('selects probed NVENC and Quick Sync backends and refuses unprobed forcing', async () => {
    installWindowTimers();
    mockHealth({ ok: true, availableBackends: ['cpu', 'nvidia-nvenc', 'intel-qsv'], recommendedBackend: 'nvidia-nvenc' });

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      renderBackendPreference: 'auto',
    })).resolves.toMatchObject({ backend: 'nvidia-nvenc' });
    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      renderBackendPreference: 'native-intel-qsv',
    })).resolves.toMatchObject({ backend: 'intel-qsv' });

    mockHealth({ ok: true, availableBackends: ['cpu'], recommendedBackend: 'cpu' });
    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      localNativeRenderUrl: 'http://127.0.0.1:41747',
      renderBackendPreference: 'native-nvidia-nvenc',
    })).rejects.toThrow('NVIDIA NVENC rendering is not available');
  });

  it('browser preference bypasses the native renderer probe', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      renderBackendPreference: 'browser',
    })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats malformed native render health responses as unavailable in auto mode', async () => {
    installWindowTimers();
    mockHealth({ ok: true, availableBackends: 'amd-vaapi', recommendedBackend: 'amd-vaapi' });

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      localNativeRenderUrl: 'http://127.0.0.1:41740',
      renderBackendPreference: 'auto',
    })).resolves.toBeNull();
  });

  it('ignores unknown native render backends in health responses', async () => {
    installWindowTimers();
    mockHealth({
      ok: true,
      availableBackends: ['cuda', 'cpu'],
      recommendedBackend: 'cuda',
    });

    await expect(resolveNativeRenderTarget({
      ...baseSettings,
      localNativeRenderUrl: 'http://127.0.0.1:41741',
      renderBackendPreference: 'auto',
    })).resolves.toEqual({
      endpoint: 'http://127.0.0.1:41741',
      backend: 'cpu',
    });
  });

  it('sends the configured native render token with render jobs', async () => {
    installWindowTimers();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          availableBackends: ['cpu', 'amd-vaapi'],
          recommendedBackend: 'amd-vaapi',
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url === 'blob:clip') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), { status: 200 });
      }

      if (url.endsWith('/render')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          'X-Signal-Loom-Render-Token': 'render-secret',
        });
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: 'video/mp4' }), { status: 200 });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderViaLocalNativeFFmpeg({
      providerSettings: {
        ...baseSettings,
        localNativeRenderUrl: 'http://127.0.0.1:41739',
        localNativeRenderToken: 'render-secret',
      },
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'out.mp4'],
      inputs: [{ name: 'clip.mp4', url: 'blob:clip' }],
    });

    expect(result).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:41739/render', expect.any(Object));
  });

  it('returns only the compact first-pass report from the localhost loudness endpoint', async () => {
    installWindowTimers();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, availableBackends: ['cpu'], recommendedBackend: 'cpu' }), {
          headers: { 'Content-Type': 'application/json' }, status: 200,
        });
      }
      if (url === 'blob:audio') return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), { status: 200 });
      if (url.endsWith('/analyze-loudness')) {
        expect(init?.headers).toMatchObject({ 'X-Signal-Loom-Render-Token': 'render-secret' });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          command: expect.arrayContaining(['-f', 'null', '-']),
          inputs: [expect.objectContaining({ name: 'mix.wav' })],
        });
        return new Response(JSON.stringify({ report: '{"input_i":"-18.1"}' }), {
          headers: { 'Content-Type': 'application/json' }, status: 200,
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(analyzeLoudnessViaLocalNativeFFmpeg({
      providerSettings: { ...baseSettings, localNativeRenderUrl: 'http://127.0.0.1:41752', localNativeRenderToken: 'render-secret' },
      command: ['-i', 'mix.wav', '-af', 'loudnorm=I=-14:print_format=json', '-f', 'null', '-'],
      inputs: [{ name: 'mix.wav', url: 'blob:audio' }],
    })).resolves.toBe('{"input_i":"-18.1"}');
  });

  it('passes linked originals by path without fetching or base64-encoding their bytes', async () => {
    installWindowTimers();
    let renderBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, availableBackends: ['cpu'], recommendedBackend: 'cpu' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url.endsWith('/render')) {
        renderBody = JSON.parse(String(init?.body));
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: 'video/mp4' }), { status: 200 });
      }

      throw new Error(`Linked source bytes must not be fetched: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderViaLocalNativeFFmpeg({
      providerSettings: {
        ...baseSettings,
        localNativeRenderUrl: 'http://127.0.0.1:41744',
        renderBackendPreference: 'native-cpu',
      },
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'out.mp4'],
      inputs: [{ name: 'clip.mp4', filePath: '/media/camera/A001.mov' }],
    });

    expect(renderBody).toMatchObject({
      inputs: [{
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        filePath: '/media/camera/A001.mov',
      }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps feature-length native output on disk instead of reading it into a Blob', async () => {
    installWindowTimers();
    let renderBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, availableBackends: ['cpu'], recommendedBackend: 'cpu' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      if (url.endsWith('/render')) {
        renderBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          filePath: '/project/movie.sloom-scratch/sequence-output-render-42.mp4',
          fileName: 'sequence-output-render-42.mp4',
        }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
      }
      throw new Error(`Feature-length source bytes must not be fetched: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(renderViaLocalNativeFFmpegToFile({
      providerSettings: {
        ...baseSettings,
        localNativeRenderUrl: 'http://127.0.0.1:41745',
        renderBackendPreference: 'native-cpu',
      },
      outputName: 'sequence-output.mp4',
      outputDirectoryPath: '/project/movie.sloom-scratch',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'sequence-output.mp4'],
      inputs: [{ name: 'clip.mp4', filePath: '/media/camera/A001.mov' }],
    })).resolves.toEqual({
      filePath: '/project/movie.sloom-scratch/sequence-output-render-42.mp4',
      fileName: 'sequence-output-render-42.mp4',
    });

    expect(renderBody).toMatchObject({
      outputDirectoryPath: '/project/movie.sloom-scratch',
      inputs: [{ filePath: '/media/camera/A001.mov' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('inserts container provenance metadata before the output path (licensing spec §6)', async () => {
    installWindowTimers();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    let postedCommand: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, availableBackends: ['cpu'], recommendedBackend: 'cpu' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      if (url === 'blob:clip') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), { status: 200 });
      }
      if (url.endsWith('/render')) {
        postedCommand = (JSON.parse(String(init?.body)) as { command: string[] }).command;
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: 'video/mp4' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderViaLocalNativeFFmpeg({
      providerSettings: baseSettings,
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'out.mp4'],
      inputs: [{ name: 'clip.mp4', url: 'blob:clip' }],
    });

    const metadataIndex = postedCommand.indexOf('-metadata');
    expect(metadataIndex).toBeGreaterThan(-1);
    expect(postedCommand[metadataIndex + 1]).toMatch(/^comment=Sloom Studio .*Community \(unlicensed\)$/);
    expect(postedCommand[postedCommand.length - 1]).toBe('out.mp4');
    // never break a render: unexpected command shapes pass through untouched
    await renderViaLocalNativeFFmpeg({
      providerSettings: baseSettings,
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-f', 'null', '-'],
      inputs: [{ name: 'clip.mp4', url: 'blob:clip' }],
    });
    expect(postedCommand).toEqual(['-i', 'clip.mp4', '-f', 'null', '-']);
  });

  it('sends a native assembly manifest with render jobs when supplied', async () => {
    installWindowTimers();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    let renderBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          availableBackends: ['cpu'],
          recommendedBackend: 'cpu',
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url === 'blob:clip') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), { status: 200 });
      }

      if (url.endsWith('/render')) {
        renderBody = JSON.parse(String(init?.body));
        return new Response(new Blob([new Uint8Array([4, 5, 6])], { type: 'video/mp4' }), { status: 200 });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderViaLocalNativeFFmpeg({
      providerSettings: {
        ...baseSettings,
        localNativeRenderUrl: 'http://127.0.0.1:41742',
        renderBackendPreference: 'native-cpu',
      },
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'out.mp4'],
      inputs: [{ name: 'clip.mp4', url: 'blob:clip' }],
      assemblyManifest: {
        version: 1,
        kind: 'video-render-segment-assembly',
        mode: 'safe-artifact-assembly',
        summary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
        caveat: 'Native artifact assembly can reuse materialized cached spans; dirty spans are still extracted from a full render until dirty-span-only rendering lands.',
        segments: [
          {
            key: '0-1000',
            startMs: 0,
            endMs: 1000,
            activeClipIds: ['hero'],
            signature: 'sig-hero',
            action: 'reuse-cached-segment',
            cachedUrl: 'blob:segment-hero',
          },
          {
            key: '1000-2000',
            startMs: 1000,
            endMs: 2000,
            activeClipIds: ['title'],
            signature: 'sig-title',
            action: 'render-dirty-span',
            reason: 'timeline span changed',
          },
        ],
      },
    });

    expect(renderBody).toMatchObject({
      assemblyManifest: {
        kind: 'video-render-segment-assembly',
        mode: 'safe-artifact-assembly',
        segments: [
          { key: '0-1000', action: 'reuse-cached-segment', cachedUrl: 'blob:segment-hero' },
          { key: '1000-2000', action: 'render-dirty-span', reason: 'timeline span changed' },
        ],
      },
    });
  });

  it('can opt into native segment artifact JSON responses without changing raw render callers', async () => {
    installWindowTimers();
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
    let renderBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          availableBackends: ['cpu'],
          recommendedBackend: 'cpu',
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      if (url === 'blob:clip') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }), { status: 200 });
      }

      if (url.endsWith('/render')) {
        renderBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          backend: 'cpu',
          outputName: 'out.mp4',
          mimeType: 'video/mp4',
          outputBase64: 'BAUG',
          assembledFromSegments: false,
          assemblyUnavailableReason: 'Cached segment 0-1000 must be a materialized data URL for native assembly.',
          segmentArtifacts: [
            {
              key: '1000-2000',
              signature: 'sig-title',
              startMs: 1000,
              endMs: 2000,
              fileName: 'segment-1000-2000.mp4',
              mimeType: 'video/mp4',
              base64: 'AQID',
            },
          ],
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await renderViaLocalNativeFFmpegWithArtifacts({
      providerSettings: {
        ...baseSettings,
        localNativeRenderUrl: 'http://127.0.0.1:41743',
        renderBackendPreference: 'native-cpu',
      },
      outputName: 'out.mp4',
      command: ['-i', 'clip.mp4', '-c:v', 'copy', 'out.mp4'],
      inputs: [{ name: 'clip.mp4', url: 'blob:clip' }],
    });

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected native artifact render result.');
    }
    expect(renderBody).toMatchObject({ returnSegmentArtifacts: true });
    expect(await result.blob.arrayBuffer()).toEqual(new Uint8Array([4, 5, 6]).buffer);
    expect(result.assemblyResult).toEqual({
      assembledFromSegments: false,
      assemblyUnavailableReason: 'Cached segment 0-1000 must be a materialized data URL for native assembly.',
    });
    expect(result.segmentArtifacts).toEqual([
      {
        key: '1000-2000',
        signature: 'sig-title',
        startMs: 1000,
        endMs: 2000,
        fileName: 'segment-1000-2000.mp4',
        mimeType: 'video/mp4',
        base64: 'AQID',
      },
    ]);
  });
});
