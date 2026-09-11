import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { TRANSCRIPTION_OUTPUT_HANDLES } from './timedTranscript';
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
    openaiBaseUrl: '',
    elevenlabsVoiceId: '',
    renderBackendPreference: 'auto',
    exportCompositorPreference: 'stage',
    localNativeRenderUrl: '',
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
    batchMaxRetries: 5,
    batchRetryBaseDelayMs: 1,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
} as RuntimeSettingsSnapshot;

function transcriptionNode(data: AppNode['data'] = {}): AppNode {
  return {
    id: 'scribe-1',
    type: 'transcriptionNode',
    position: { x: 0, y: 0 },
    data: {
      transcriptionDiarize: true,
      transcriptionTagAudioEvents: true,
      transcriptionTimestampGranularity: 'word',
      ...data,
    },
  } as AppNode;
}

describe('executeNodeRequest ElevenLabs transcription', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uploads one media file and emits text, timed JSON, VTT, and SRT from one Scribe call', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'Hello world.',
      language_code: 'en',
      words: [
        { text: 'Hello', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_0' },
        { text: ' ', type: 'spacing' },
        { text: 'world.', start: 0.45, end: 1, type: 'word', speaker_id: 'speaker_0' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    let objectUrlIndex = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:caption-${++objectUrlIndex}`);

    const execution = await executeNodeRequest(
      transcriptionNode({
        transcriptionLanguageCode: 'en',
        transcriptionNumSpeakers: 2,
        transcriptionKeyterms: 'Sloom, Tilt Mark',
      }),
      {
        prompt: '',
        config: DEFAULT_EXECUTION_CONFIG,
        audioSourceInput: 'data:audio/wav;base64,UklGRg==',
      },
      settings,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.headers).toEqual({ 'xi-api-key': 'xi-key' });
    const body = init.body as FormData;
    expect(body.get('model_id')).toBe('scribe_v2');
    expect(body.get('language_code')).toBe('en');
    expect(body.get('num_speakers')).toBe('2');
    expect(body.getAll('keyterms')).toEqual(['Sloom', 'Tilt Mark']);
    expect(body.get('file')).toBeInstanceOf(Blob);

    expect(execution.result).toBe('Hello world.');
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.text]?.result).toBe('Hello world.');
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.timed]?.result).toContain('"startMs": 0');
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.vtt]).toMatchObject({
      result: 'blob:caption-1',
      resultType: 'text',
      assetKind: 'subtitle',
      mimeType: 'text/vtt',
      extension: 'vtt',
    });
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.srt]).toMatchObject({
      result: 'blob:caption-2',
      assetKind: 'subtitle',
      extension: 'srt',
    });
  });

  it('does not replay a Scribe upload after a transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      transcriptionNode(),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG, sourceVideoInput: 'data:video/mp4;base64,AAAA' },
      settings,
    )).rejects.toThrow('connection reset');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aligns exact known text without sending Scribe-only fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      characters: [
        { text: '熊', start: 0, end: 0.3 },
        { text: 'で', start: 0.3, end: 0.5 },
        { text: 'す', start: 0.5, end: 0.8 },
        { text: '。', start: 0.8, end: 1 },
      ],
      words: [{ text: '熊です。', start: 0, end: 1, loss: 0.1 }],
      loss: 0.12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementationOnce(() => 'blob:aligned-vtt').mockImplementationOnce(() => 'blob:aligned-srt');

    const execution = await executeNodeRequest(
      transcriptionNode({
        transcriptionOperation: 'align',
        transcriptionAlignmentText: '  熊です。  ',
      }),
      { prompt: '', config: DEFAULT_EXECUTION_CONFIG, audioSourceInput: 'data:audio/wav;base64,UklGRg==' },
      settings,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/forced-alignment');
    const body = init.body as FormData;
    expect(body.get('text')).toBe('  熊です。  ');
    expect(body.get('model_id')).toBeNull();
    expect(body.get('diarize')).toBeNull();
    expect(execution.result).toBe('  熊です。  ');
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.timed]?.result).toContain('"alignmentLoss": 0.12');
    expect(execution.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.vtt]).toMatchObject({
      result: 'blob:aligned-vtt',
      fileName: 'aligned-captions.vtt',
    });
    expect(execution.usage?.modelId).toBe('forced_alignment');
  });
});
