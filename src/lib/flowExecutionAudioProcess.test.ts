import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { AUDIO_PROCESS_OUTPUT_HANDLES } from './audioProcess';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const settings = {
  apiKeys: { gemini: '', openai: '', atlas: '', huggingface: '', elevenlabs: 'xi-key' },
  defaultModels: {
    text: { gemini: '', openai: '', huggingface: '' },
    image: { gemini: '', openai: '', atlas: '', huggingface: '', bfl: '', stability: '', localOpen: '', android: '', byteplus: '' },
    video: { gemini: '', huggingface: '', atlas: '' },
    audio: { gemini: '', elevenlabs: '', huggingface: '' },
  },
  providerSettings: {
    openaiBaseUrl: '', elevenlabsVoiceId: '', renderBackendPreference: 'auto', exportCompositorPreference: 'stage',
    localNativeRenderUrl: '', backendProxyEnabled: false, backendProxyBaseUrl: '', geminiCredentialMode: 'api-key',
    vertexAuthMode: 'gcloud-user', vertexProjectId: '', vertexLocation: 'global', vertexQuotaProjectId: '',
    vertexEnvironmentVariables: '', vertexServiceAccountJson: '', paperPrintUpscaleMethod: 'auto',
    paperPdfRasterPreset: 'balanced-jpeg', batchMaxRetries: 5, batchRetryBaseDelayMs: 1,
    androidLanServerEnabled: false, androidLanServerPin: '',
  },
} as RuntimeSettingsSnapshot;

const node = {
  id: 'isolate-1',
  type: 'audioProcessNode',
  position: { x: 0, y: 0 },
  data: { audioProcessOperation: 'isolate-voice' },
} as AppNode;

describe('executeNodeRequest ElevenLabs Voice Isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads one media source and publishes durable-ready isolated audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([73, 68, 51, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'request-id': 'isolation-request-1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:isolated-dialogue');

    const execution = await executeNodeRequest(
      node,
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG, sourceVideoInput: 'data:video/mp4;base64,AAAA' },
      settings,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/audio-isolation');
    expect(init.headers).toEqual({ 'xi-api-key': 'xi-key' });
    const body = init.body as FormData;
    expect(body.get('audio')).toBeInstanceOf(Blob);
    expect(body.get('file_format')).toBe('other');
    expect(execution).toMatchObject({ result: 'blob:isolated-dialogue', resultType: 'audio', mimeType: 'audio/mpeg' });
    expect(execution.namedOutputs?.[AUDIO_PROCESS_OUTPUT_HANDLES.isolatedAudio]).toMatchObject({
      result: 'blob:isolated-dialogue',
      resultType: 'audio',
      assetKind: 'audio',
      fileName: 'isolated-dialogue.mp3',
    });
  });

  it('does not replay an ambiguous isolation transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      node,
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG, audioSourceInput: 'data:audio/wav;base64,UklGRg==' },
      settings,
    )).rejects.toThrow('connection reset');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
