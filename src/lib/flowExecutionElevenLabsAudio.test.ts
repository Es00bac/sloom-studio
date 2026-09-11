import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { NonRetryableError } from './exponentialBackoff';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import type { AppNode, AudioGenerationMode, AudioOutputFormat, RuntimeSettingsSnapshot } from '../types/flow';

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: '',
    openai: '',
    atlas: '',
    huggingface: '',
    elevenlabs: 'xi-key',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-3-flash-preview',
      openai: 'gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-4B-Instruct-2507',
    },
    image: {
      gemini: 'gemini-3-pro-image-preview',
      openai: 'gpt-image-2',
      atlas: 'black-forest-labs/flux-schnell',
      huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'flux-2-pro',
      stability: 'stable-image-core',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-4.5',
    },
    video: {
      gemini: 'veo-3.1-generate-001',
      huggingface: 'Wan-AI/Wan2.2-T2V-A14B',
      atlas: 'google/veo3.1/text-to-video',
    },
    audio: {
      gemini: 'gemini-3.1-flash-tts-preview',
      elevenlabs: 'eleven_multilingual_v2',
      huggingface: 'hexgrad/Kokoro-82M',
    },
  },
  providerSettings: {
    openaiBaseUrl: '',
    elevenlabsVoiceId: 'default-voice',
    renderBackendPreference: 'auto',
    localNativeRenderUrl: 'http://127.0.0.1:41736',
    backendProxyEnabled: false,
    backendProxyBaseUrl: '',
    geminiCredentialMode: 'api-key',
    vertexAuthMode: 'gcloud-user',
    vertexProjectId: '',
    vertexLocation: 'global',
    vertexQuotaProjectId: '',
    vertexEnvironmentVariables: '',
    vertexServiceAccountJson: '',
    paperPrintUpscaleMethod: 'auto',
    paperPdfRasterPreset: 'balanced-jpeg',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
} as RuntimeSettingsSnapshot;

function createAudioNode(data: AppNode['data'] = {}): AppNode {
  return {
    id: 'audio-1',
    type: 'audioGen',
    position: { x: 0, y: 0 },
    data: {
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice-abc',
      ...data,
    },
  } as AppNode;
}

function audioResponse(): Response {
  return new Response(new Blob(['MP3'], { type: 'audio/mpeg' }), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

function timestampedAudioResponse(payload: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    audio_base64: 'TVAz',
    alignment: {
      characters: ['H', 'i', ' ', 'a', 'l', 'l'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    },
    ...payload,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const rawPcmSamples = new Uint8Array([0x00, 0x80, 0xff, 0x7f]);

const elevenLabsModes: Array<{
  mode: AudioGenerationMode;
  modelId: string;
  prompt: string;
  path: string;
}> = [
  { mode: 'speech', modelId: 'eleven_multilingual_v2', prompt: 'Hello there', path: '/v1/text-to-speech/' },
  { mode: 'soundEffect', modelId: 'eleven_text_to_sound_v2', prompt: 'A metal door impact', path: '/v1/sound-generation' },
  { mode: 'music', modelId: 'music_v2', prompt: 'A restrained string pulse', path: '/v1/music' },
  { mode: 'voiceChange', modelId: 'eleven_multilingual_sts_v2', prompt: '', path: '/v1/speech-to-speech/' },
];

function byteResponse(bytes: Uint8Array, type: string): Response {
  return new Response(new Blob([Uint8Array.from(bytes).buffer], { type }), {
    status: 200,
    headers: { 'content-type': type },
  });
}

function stubModeFetch(mode: AudioGenerationMode, providerResponse: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (mode === 'voiceChange' && String(input).startsWith('data:')) {
      return byteResponse(new Uint8Array([0x52, 0x49, 0x46, 0x46]), 'audio/wav');
    }
    return providerResponse;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function nodeForMode(mode: AudioGenerationMode, modelId: string): AppNode {
  return createAudioNode({
    modelId,
    audioGenerationMode: mode,
  });
}

function contextForMode(mode: AudioGenerationMode, prompt: string, outputFormat: AudioOutputFormat | string) {
  return {
    prompt,
    config: { ...DEFAULT_EXECUTION_CONFIG, audioOutputFormat: outputFormat as AudioOutputFormat },
    ...(mode === 'voiceChange' ? { audioSourceInput: 'data:audio/wav;base64,UklGRg==' } : {}),
  };
}

async function captureCreatedBlob<T>(operation: () => Promise<T>): Promise<{ result: T; blob: Blob }> {
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    if (blob instanceof Blob) blobs.push(blob);
    return `blob:elevenlabs-${blobs.length}`;
  });
  const result = await operation();
  expect(blobs).toHaveLength(1);
  return { result, blob: blobs[0] };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function expectPcm44100Wave(bytes: Uint8Array, payload: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes).toHaveLength(44 + payload.length);
  expect(ascii(bytes, 0, 4)).toBe('RIFF');
  expect(view.getUint32(4, true)).toBe(36 + payload.length);
  expect(ascii(bytes, 8, 4)).toBe('WAVE');
  expect(ascii(bytes, 12, 4)).toBe('fmt ');
  expect(view.getUint32(16, true)).toBe(16);
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(44_100);
  expect(view.getUint32(28, true)).toBe(88_200);
  expect(view.getUint16(32, true)).toBe(2);
  expect(view.getUint16(34, true)).toBe(16);
  expect(ascii(bytes, 36, 4)).toBe('data');
  expect(view.getUint32(40, true)).toBe(payload.length);
  expect(bytes.slice(44)).toEqual(payload);
}

function retryingSettings(maxRetries = 3): RuntimeSettingsSnapshot {
  return {
    ...settings,
    providerSettings: {
      ...settings.providerSettings,
      batchMaxRetries: maxRetries,
      batchRetryBaseDelayMs: 1,
    },
  } as RuntimeSettingsSnapshot;
}

async function captureRejection(operation: Promise<unknown>): Promise<Error & {
  usage?: { provider?: string; modelId?: string; characters?: number };
}> {
  return operation.then(
    () => {
      throw new Error('Expected operation to reject.');
    },
    (error: unknown) => error as Error & {
      usage?: { provider?: string; modelId?: string; characters?: number };
    },
  );
}

describe('executeNodeRequest ElevenLabs speech', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends voice_settings and seed when the node sets them, clamped to documented ranges', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createAudioNode({
        audioStability: 0.3,
        audioSimilarityBoost: 0.9,
        audioStyleExaggeration: 0.2,
        audioSpeed: 2, // documented max is 1.2 — must clamp
        audioSeed: 42.7,
      }),
      { prompt: 'Hello there', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/text-to-speech/voice-abc');
    expect(url).not.toContain('/with-timestamps');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.seed).toBe(42);
    expect(body.voice_settings).toEqual({
      stability: 0.3,
      similarity_boost: 0.9,
      style: 0.2,
      speed: 1.2,
    });
  });

  it('omits voice_settings and seed entirely when the node leaves them blank (voice defaults win)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createAudioNode(),
      { prompt: 'Hello there', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({ text: 'Hello there', model_id: 'eleven_multilingual_v2' });
  });

  it('sends only the voice settings the user actually set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createAudioNode({ audioStability: 0.8 }),
      { prompt: 'Hello there', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.voice_settings).toEqual({ stability: 0.8 });
    expect(body.seed).toBeUndefined();
  });

  it('uses the official timestamp endpoint only when flagged and publishes bounded credential-free timing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(timestampedAudioResponse({
      api_key: 'provider-response-secret-must-not-persist',
      authorization: 'provider-response-authorization-must-not-persist',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, blob } = await captureCreatedBlob(() => executeNodeRequest(
      createAudioNode({ audioTtsWithTimestamps: true }),
      {
        prompt: 'Hi all',
        config: { ...DEFAULT_EXECUTION_CONFIG, audioOutputFormat: 'mp3_44100_128' },
      },
      settings,
    ));

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-abc/with-timestamps?output_format=mp3_44100_128',
    );
    expect(await blob.text()).toBe('MP3');
    expect(result).toMatchObject({
      resultType: 'audio',
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      outputMetadata: {
        container: 'mp3',
        ttsTiming: {
          version: 1,
          provider: 'elevenlabs',
          alignmentSource: 'alignment',
          text: 'Hi all',
          textMatchesPrompt: true,
          durationMs: 600,
          words: [
            { index: 0, text: 'Hi', startCharacterIndex: 0, endCharacterIndex: 2, startMs: 0, endMs: 200 },
            { index: 1, text: 'all', startCharacterIndex: 3, endCharacterIndex: 6, startMs: 300, endMs: 600 },
          ],
        },
      },
    });
    const timing = result.outputMetadata?.ttsTiming as { characters: unknown[] };
    expect(timing.characters).toHaveLength(6);
    expect(timing.characters[0]).toEqual({ index: 0, text: 'H', startMs: 0, endMs: 100 });
    const serializedMetadata = JSON.stringify(result.outputMetadata);
    expect(serializedMetadata).not.toContain('provider-response-secret');
    expect(serializedMetadata).not.toContain('provider-response-authorization');
    expect(serializedMetadata).not.toContain('xi-key');
  });

  it('rejects over-limit accepted timestamp metadata once without resubmitting the paid request', async () => {
    const overLimitCharacters = Array.from({ length: 40_001 }, () => 'a');
    const fetchMock = vi.fn().mockResolvedValue(timestampedAudioResponse({
      alignment: {
        characters: overLimitCharacters,
        character_start_times_seconds: overLimitCharacters.map(() => 0),
        character_end_times_seconds: overLimitCharacters.map(() => 0.1),
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await captureRejection(executeNodeRequest(
      createAudioNode({ audioTtsWithTimestamps: true }),
      { prompt: 'Bound this result', config: DEFAULT_EXECUTION_CONFIG },
      retryingSettings(),
    ));

    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error.message).toContain('40,000 characters');
    expect(error.usage).toMatchObject({
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      characters: 'Bound this result'.length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('composes Music v2 with prompt-route controls and documented units', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal('fetch', fetchMock);

    await executeNodeRequest(
      createAudioNode({
        modelId: 'music_v2',
        audioGenerationMode: 'music',
        audioDurationSeconds: 12.5,
        audioForceInstrumental: true,
        audioSeed: 123,
      }),
      {
        prompt: 'Cinematic chamber strings with a restrained pulse.',
        config: { ...DEFAULT_EXECUTION_CONFIG, audioOutputFormat: 'mp3_48000_192' },
      },
      settings,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192');
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'Cinematic chamber strings with a restrained pulse.',
      model_id: 'music_v2',
      music_length_ms: 12_500,
      force_instrumental: true,
    });
  });

  it('fails closed before fetch when a selected model cannot run the selected mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      createAudioNode({ modelId: 'eleven_v3', audioGenerationMode: 'soundEffect' }),
      { prompt: 'A heavy metal door impact.', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    )).rejects.toThrow('does not support text to sound effect');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('executeNodeRequest ElevenLabs audio response materialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('materializes a remote voice-change source before the ElevenLabs request', async () => {
    const remoteAudio = 'https://cdn.example/source.wav?temporary=hidden';
    const sourceBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input) === remoteAudio) return byteResponse(sourceBytes, 'audio/wav');
      return audioResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    await captureCreatedBlob(() => executeNodeRequest(
      nodeForMode('voiceChange', 'eleven_multilingual_sts_v2'),
      {
        prompt: '',
        audioSourceInput: remoteAudio,
        config: { ...DEFAULT_EXECUTION_CONFIG, audioOutputFormat: 'mp3_44100_128' },
      },
      settings,
    ));

    const providerCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/v1/speech-to-speech/'));
    const form = providerCall?.[1]?.body as FormData;
    const source = form.get('audio') as File;
    expect(source.type).toBe('audio/wav');
    expect(await blobBytes(source)).toEqual(sourceBytes);
    expect(String(providerCall?.[0])).not.toContain(remoteAudio);
  });

  it.each(elevenLabsModes)(
    'wraps raw pcm_44100 as an exact mono signed-16 LE WAV for $mode',
    async ({ mode, modelId, prompt, path }) => {
      const fetchMock = stubModeFetch(mode, byteResponse(rawPcmSamples, 'application/octet-stream'));

      const { result, blob } = await captureCreatedBlob(() => executeNodeRequest(
        nodeForMode(mode, modelId),
        contextForMode(mode, prompt, 'pcm_44100'),
        settings,
      ));

      const providerCall = fetchMock.mock.calls.find(([url]) => String(url).includes('api.elevenlabs.io'));
      expect(String(providerCall?.[0])).toContain(path);
      expect(String(providerCall?.[0])).toContain('output_format=pcm_44100');
      expect(blob.type).toBe('audio/wav');
      expectPcm44100Wave(await blobBytes(blob), rawPcmSamples);
      expect(result.blob).toBe(blob);
      expect(result).toMatchObject({
        resultType: 'audio',
        mimeType: 'audio/wav',
        extension: 'wav',
        outputMetadata: {
          providerOutputFormat: 'pcm_44100',
          container: 'wav',
          codec: 'pcm_s16le',
          sampleRateHz: 44_100,
          channels: 1,
          bitsPerSample: 16,
          endianness: 'little',
        },
      });
    },
  );

  it.each(elevenLabsModes)(
    'preserves encoded MP3 payload bytes and reports truthful media identity for $mode',
    async ({ mode, modelId, prompt }) => {
      const mp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0xaa, 0x55]);
      stubModeFetch(mode, byteResponse(mp3Bytes, 'application/octet-stream'));

      const { result, blob } = await captureCreatedBlob(() => executeNodeRequest(
        nodeForMode(mode, modelId),
        contextForMode(mode, prompt, 'mp3_44100_128'),
        settings,
      ));

      expect(await blobBytes(blob)).toEqual(mp3Bytes);
      expect(blob.type).toBe('audio/mpeg');
      expect(result.blob).toBe(blob);
      expect(result).toMatchObject({
        resultType: 'audio',
        mimeType: 'audio/mpeg',
        extension: 'mp3',
        outputMetadata: {
          providerOutputFormat: 'mp3_44100_128',
          container: 'mp3',
          codec: 'mp3',
          sampleRateHz: 44_100,
          bitRateKbps: 128,
        },
      });
    },
  );

  it('preserves an unknown encoded format and its provider MIME without inventing a WAV container', async () => {
    const encodedBytes = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
    stubModeFetch('speech', byteResponse(encodedBytes, 'audio/flac'));

    const { result, blob } = await captureCreatedBlob(() => executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'future_lossless'),
      settings,
    ));

    expect(await blobBytes(blob)).toEqual(encodedBytes);
    expect(blob.type).toBe('audio/flac');
    expect(result).toMatchObject({
      mimeType: 'audio/flac',
      extension: 'flac',
      outputMetadata: {
        providerOutputFormat: 'future_lossless',
        container: 'provider',
        codec: 'unknown',
      },
    });
  });

  it.each([
    ['empty', new Uint8Array()],
    ['truncated 16-bit sample', new Uint8Array([0x7f])],
  ])('fails closed without retrying a successful-but-%s PCM response', async (_case, bytes) => {
    const fetchMock = stubModeFetch('speech', byteResponse(bytes, 'application/octet-stream'));

    const run = executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      retryingSettings(),
    );

    await expect(run).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient transport failure, then materializes the one successful PCM response', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('temporary connection reset'))
      .mockResolvedValueOnce(byteResponse(rawPcmSamples, 'application/octet-stream'));
    vi.stubGlobal('fetch', fetchMock);

    const { blob } = await captureCreatedBlob(() => executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      retryingSettings(1),
    ));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectPcm44100Wave(await blobBytes(blob), rawPcmSamples);
  });

  it('does not resubmit when reading the accepted response blob fails and retains its usage', async () => {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: vi.fn().mockRejectedValue(new TypeError('response blob read failed')),
    } as unknown as Response;
    const fetchMock = stubModeFetch('speech', response);

    const error = await captureRejection(executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      retryingSettings(),
    ));

    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error.message).toBe('response blob read failed');
    expect(error.usage).toMatchObject({
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      characters: 'Hello there'.length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.blob).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit when accepted response bytes fail to materialize and retains its usage', async () => {
    const arrayBuffer = vi.fn().mockRejectedValue(new TypeError('audio byte read failed'));
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: vi.fn().mockResolvedValue({
        type: 'application/octet-stream',
        size: rawPcmSamples.byteLength,
        arrayBuffer,
      }),
    } as unknown as Response;
    const fetchMock = stubModeFetch('speech', response);

    const error = await captureRejection(executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      retryingSettings(),
    ));

    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error.message).toBe('audio byte read failed');
    expect(error.usage).toMatchObject({ provider: 'elevenlabs', characters: 'Hello there'.length });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.blob).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit when the accepted result object URL cannot be created and retains its usage', async () => {
    const response = byteResponse(rawPcmSamples, 'application/octet-stream');
    const responseBlob = vi.spyOn(response, 'blob');
    const fetchMock = stubModeFetch('speech', response);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new TypeError('object URL creation failed');
    });

    const error = await captureRejection(executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      retryingSettings(),
    ));

    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error.message).toBe('object URL creation failed');
    expect(error.usage).toMatchObject({ provider: 'elevenlabs', characters: 'Hello there'.length });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(responseBlob).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('cancels while response bytes are materializing and never publishes a stale object URL', async () => {
    const controller = new AbortController();
    let resolveBlob!: (blob: Blob) => void;
    const pendingBlob = new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    });
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: vi.fn(() => pendingBlob),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');

    const run = executeNodeRequest(
      nodeForMode('speech', 'eleven_multilingual_v2'),
      contextForMode('speech', 'Hello there', 'pcm_44100'),
      settings,
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(response.blob).toHaveBeenCalledOnce(), { timeout: 4_000 });
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await expect(run).rejects.toMatchObject({
      usage: {
        provider: 'elevenlabs',
        modelId: 'eleven_multilingual_v2',
        characters: 'Hello there'.length,
      },
    });
    resolveBlob(new Blob([Uint8Array.from(rawPcmSamples).buffer], { type: 'application/octet-stream' }));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
