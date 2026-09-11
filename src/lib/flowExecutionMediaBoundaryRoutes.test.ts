import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest, type ExecutionContext } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG, DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';
import { getProviderLimiter } from './providerRateLimiter';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const routeCapture = vi.hoisted(() => ({
  extractSelectedVideoFrame: vi.fn(),
  generateContent: vi.fn(async (_request: Record<string, unknown>) => ({
    candidates: [{ content: { parts: [{ text: 'Document analyzed.' }] } }],
  })),
}));

vi.mock('./videoFrameExtraction', () => ({
  extractSelectedVideoFrame: routeCapture.extractSelectedVideoFrame,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: routeCapture.generateContent };
  },
}));

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key', openai: '', atlas: '', huggingface: '', elevenlabs: '', bfl: '', stability: '',
  },
  defaultModels: {
    text: { gemini: 'gemini-3.5-flash', openai: 'gpt-4.1-mini', huggingface: 'Qwen/Qwen3-4B-Instruct-2507' },
    image: {
      gemini: 'gemini-3-pro-image-preview', openai: 'gpt-image-2', atlas: 'gpt-image-2',
      huggingface: 'black-forest-labs/FLUX.1-dev', bfl: 'flux-2-pro', stability: 'stable-image-core',
      localOpen: 'Qwen/Qwen-Image-Edit', android: 'local-dream-active', byteplus: 'seedream-5-0-260128',
    },
    video: { gemini: 'veo-3.1-generate-preview', huggingface: 'Wan-AI/Wan2.2-T2V-A14B', atlas: 'google/veo3.1/text-to-video' },
    audio: { gemini: 'gemini-3.1-flash-tts-preview', elevenlabs: 'eleven_multilingual_v2', huggingface: 'hexgrad/Kokoro-82M' },
  },
  providerSettings: { ...DEFAULT_PROVIDER_SETTINGS, geminiCredentialMode: 'api-key', batchMaxRetries: 0 },
};

function imageNode(): AppNode {
  return {
    id: 'source-video-frame', type: 'imageGen', position: { x: 0, y: 0 },
    data: { provider: 'gemini', modelId: 'gemini-3-pro-image-preview', videoFrameSelection: 'first' },
  } as AppNode;
}

function imageContext(sourceVideoInput: string): ExecutionContext {
  return { prompt: '', sourceVideoInput, config: DEFAULT_EXECUTION_CONFIG };
}

describe('Flow shared downstream-media boundary routes (AUD-029)', () => {
  beforeEach(() => {
    getProviderLimiter('gemini').minDelayMs = 0;
    routeCapture.extractSelectedVideoFrame.mockReset();
    routeCapture.generateContent.mockClear();
  });

  afterEach(() => {
    getProviderLimiter('gemini').minDelayMs = 1500;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('materializes a remote source video, extracts one frame, and revokes only the temporary source URL', async () => {
    const remoteVideo = 'https://media.example/source.mp4?Signature=temporary';
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['VIDEO'], { type: 'video/mp4' }), {
      status: 200, headers: { 'content-type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:temporary-source-video')
      .mockReturnValueOnce('blob:published-frame');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    routeCapture.extractSelectedVideoFrame.mockResolvedValue(new Blob(['FRAME'], { type: 'image/png' }));

    const result = await executeNodeRequest(imageNode(), imageContext(remoteVideo), settings);

    expect(result.result).toBe('blob:published-frame');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(routeCapture.extractSelectedVideoFrame).toHaveBeenCalledWith('blob:temporary-source-video', 'first');
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:temporary-source-video');
    expect(routeCapture.generateContent).not.toHaveBeenCalled();
  });

  it('revokes the temporary source-video URL when frame extraction fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['VIDEO'], { type: 'video/mp4' }), {
      status: 200, headers: { 'content-type': 'video/mp4' },
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-source-video');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    routeCapture.extractSelectedVideoFrame.mockRejectedValue(new Error('decoder failed'));

    await expect(executeNodeRequest(
      imageNode(), imageContext('https://media.example/failure.mp4'), settings,
    )).rejects.toThrow('decoder failed');

    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:failed-source-video');
    expect(routeCapture.generateContent).not.toHaveBeenCalled();
  });

  it('revokes the temporary source-video URL when cancellation wins frame extraction', async () => {
    let resolveFrame!: (value: Blob) => void;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Blob(['VIDEO'], { type: 'video/mp4' }), {
      status: 200, headers: { 'content-type': 'video/mp4' },
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cancelled-source-video');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    routeCapture.extractSelectedVideoFrame.mockImplementation(() => new Promise<Blob>((resolve) => {
      resolveFrame = resolve;
    }));
    const controller = new AbortController();

    const pending = executeNodeRequest(
      imageNode(), imageContext('https://media.example/cancel.mp4'), settings, undefined, { signal: controller.signal },
    );
    await vi.waitFor(() => expect(routeCapture.extractSelectedVideoFrame).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cancelled-source-video');
    expect(routeCapture.generateContent).not.toHaveBeenCalled();
    resolveFrame(new Blob(['LATE'], { type: 'image/png' }));
  });

  it('materializes a remote document reference before submitting Gemini text analysis', async () => {
    const remoteDocument = 'https://media.example/reference.pdf?Signature=temporary';
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['%PDF'], { type: 'application/pdf' }), {
      status: 200, headers: { 'content-type': 'application/pdf' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const node: AppNode = {
      id: 'document-analysis', type: 'textNode', position: { x: 0, y: 0 },
      data: { mode: 'generate', provider: 'gemini', modelId: 'gemini-3.5-flash' },
    } as AppNode;

    const result = await executeNodeRequest(node, {
      prompt: 'Summarize this document.',
      textMediaInputs: [{ url: remoteDocument, kind: 'document', mimeType: 'application/pdf' }],
      config: DEFAULT_EXECUTION_CONFIG,
    }, settings);

    expect(result.result).toBe('Document analyzed.');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(routeCapture.generateContent).toHaveBeenCalledOnce();
    const request = routeCapture.generateContent.mock.calls[0][0] as { contents?: unknown[] };
    expect(request.contents).toContainEqual({ inlineData: { data: 'JVBERg==', mimeType: 'application/pdf' } });
    expect(JSON.stringify(request)).not.toContain(remoteDocument);
  });
});
