import type { AspectRatio, VideoReferenceType, VideoResolution } from '../types/flow';

interface VertexVideoConfig {
  aspectRatio: AspectRatio;
  durationSeconds: number;
  videoResolution: VideoResolution;
  seed?: number;
  negativePrompt?: string;
  sampleCount?: number;
}

interface VertexSdkImage {
  imageBytes: string;
  mimeType: string;
}

interface VertexSdkVideo {
  videoBytes: string;
  mimeType: string;
}

interface VertexReferenceImageInput {
  image: VertexSdkImage;
  referenceType: VideoReferenceType;
}

export type VertexVideoRoute = 'veo-predict-long-running' | 'gemini-generate-content';

export interface VertexVideoRestRequest extends Record<string, unknown> {
  instances: Array<{
    prompt?: string;
    image?: {
      bytesBase64Encoded: string;
      mimeType: string;
    };
    lastFrame?: {
      bytesBase64Encoded: string;
      mimeType: string;
    };
    referenceImages?: Array<{
      image: {
        bytesBase64Encoded: string;
        mimeType: string;
      };
      referenceType: VideoReferenceType;
    }>;
    video?: {
      bytesBase64Encoded: string;
      mimeType: string;
    };
  }>;
  parameters?: {
    aspectRatio?: AspectRatio;
    durationSeconds?: number;
    resolution?: VideoResolution;
    seed?: number;
    negativePrompt?: string;
    sampleCount?: number;
    personGeneration?: 'allow_all' | 'allow_adult';
  };
}

export interface VertexVeoVideoRequestInputs {
  prompt?: string;
  startImage?: VertexSdkImage;
  endImage?: VertexSdkImage;
  referenceImages?: VertexReferenceImageInput[];
  extensionVideo?: VertexSdkVideo;
}

export interface VertexOmniVideoMediaInput {
  inlineData: {
    data: string;
    mimeType: string;
  };
  instruction?: string;
}

export interface VertexGeneratedVideo {
  mimeType: string;
  data?: string;
  uri?: string;
  gcsUri?: string;
}

export function buildVertexVeoVideoRequestBody(
  inputs: VertexVeoVideoRequestInputs,
  config: VertexVideoConfig,
): VertexVideoRestRequest {
  const prompt = inputs.prompt?.trim() || undefined;
  const hasReferenceImages = (inputs.referenceImages?.length ?? 0) > 0;
  const instance: VertexVideoRestRequest['instances'][number] = {
    prompt,
  };

  if (!hasReferenceImages && !inputs.extensionVideo && inputs.startImage) {
    instance.image = {
      bytesBase64Encoded: inputs.startImage.imageBytes,
      mimeType: inputs.startImage.mimeType,
    };
  }

  if (!hasReferenceImages && !inputs.extensionVideo && inputs.endImage) {
    instance.lastFrame = {
      bytesBase64Encoded: inputs.endImage.imageBytes,
      mimeType: inputs.endImage.mimeType,
    };
  }

  if (hasReferenceImages) {
    instance.referenceImages = inputs.referenceImages?.map((reference) => ({
      image: {
        bytesBase64Encoded: reference.image.imageBytes,
        mimeType: reference.image.mimeType,
      },
      referenceType: reference.referenceType,
    }));
  }

  if (inputs.extensionVideo) {
    instance.video = {
      bytesBase64Encoded: inputs.extensionVideo.videoBytes,
      mimeType: inputs.extensionVideo.mimeType,
    };
  }

  const parameters: VertexVideoRestRequest['parameters'] = {
    aspectRatio: config.aspectRatio,
    durationSeconds: config.durationSeconds,
    resolution: config.videoResolution,
    personGeneration: resolvePersonGeneration(inputs),
  };

  if (typeof config.seed === 'number' && Number.isFinite(config.seed)) {
    parameters.seed = config.seed;
  }

  const negativePrompt = config.negativePrompt?.trim();

  if (negativePrompt) {
    parameters.negativePrompt = negativePrompt;
  }

  if (typeof config.sampleCount === 'number' && Number.isFinite(config.sampleCount)) {
    parameters.sampleCount = 1;
  }

  return {
    instances: [instance],
    parameters,
  };
}

export function buildVertexOmniVideoRequestBody(input: {
  prompt: string;
  media: VertexOmniVideoMediaInput[];
}): Record<string, unknown> {
  const parts: Array<{ text: string } | { inlineData: VertexOmniVideoMediaInput['inlineData'] }> = [];
  const prompt = input.prompt.trim();

  if (prompt) {
    parts.push({ text: prompt });
  }

  for (const media of input.media) {
    if (media.instruction?.trim()) {
      parts.push({ text: media.instruction.trim() });
    }
    parts.push({ inlineData: media.inlineData });
  }

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ['VIDEO'],
    },
  };
}

export function extractVertexGeneratedVideo(response: unknown): VertexGeneratedVideo | undefined {
  const responseRecord = isRecord(response) ? response : undefined;
  const responseBody = isRecord(responseRecord?.response) ? responseRecord.response : responseRecord;
  const directVideos = Array.isArray(responseBody?.videos) ? responseBody.videos : [];

  for (const video of directVideos) {
    const extracted = getVertexVideoPayload(video);

    if (extracted) {
      return extracted;
    }
  }

  const generatedSamples = Array.isArray(
    isRecord(responseBody?.generateVideoResponse)
      ? responseBody.generateVideoResponse.generatedSamples
      : undefined,
  )
    ? (responseBody?.generateVideoResponse as { generatedSamples: unknown[] }).generatedSamples
    : [];

  for (const sample of generatedSamples) {
    const sampleRecord = isRecord(sample) ? sample : undefined;
    const extracted = getVertexVideoPayload(sampleRecord?.video ?? sample);

    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function resolvePersonGeneration(inputs: VertexVeoVideoRequestInputs): 'allow_all' | 'allow_adult' {
  return inputs.startImage || inputs.endImage || (inputs.referenceImages?.length ?? 0) > 0
    ? 'allow_adult'
    : 'allow_all';
}

function getVertexVideoPayload(value: unknown): VertexGeneratedVideo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const data = getString(value.bytesBase64Encoded)
    ?? getString(value.bytes_base64_encoded)
    ?? getString(value.encodedVideo)
    ?? getString(value.videoBytes)
    ?? getString(value.video_bytes);
  const mimeType = getString(value.mimeType)
    ?? getString(value.mime_type)
    ?? getString(value.encoding)
    ?? 'video/mp4';
  const gcsUri = getString(value.gcsUri) ?? getString(value.gcs_uri);
  const uri = getString(value.uri);

  if (!data && !gcsUri && !uri) {
    return undefined;
  }

  return {
    mimeType,
    ...(data ? { data } : {}),
    ...(gcsUri ? { gcsUri } : {}),
    ...(uri ? { uri } : {}),
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
