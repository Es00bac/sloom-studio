import type { AspectRatio, VideoReferenceType, VideoResolution } from '../types/flow';

interface GeminiVideoConfig {
  aspectRatio: AspectRatio;
  durationSeconds: number;
  videoResolution: VideoResolution;
  seed?: number;
  negativePrompt?: string;
  sampleCount?: number;
}

interface GeminiSdkImage {
  imageBytes: string;
  mimeType: string;
}

interface GeminiSdkVideo {
  videoBytes: string;
  mimeType: string;
}

interface GeminiReferenceImageInput {
  image: GeminiSdkImage;
  referenceType: VideoReferenceType;
}

export interface GeminiVideoRestRequest {
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
      encodedVideo: string;
      encoding: string;
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

export interface GeminiVideoRequestInputs {
  prompt?: string;
  startImage?: GeminiSdkImage;
  endImage?: GeminiSdkImage;
  referenceImages?: GeminiReferenceImageInput[];
  extensionVideo?: GeminiSdkVideo;
}

export function buildGeminiVideoRequest(
  inputs: GeminiVideoRequestInputs,
  config: GeminiVideoConfig,
): GeminiVideoRestRequest {
  const prompt = inputs.prompt?.trim() || undefined;
  const hasReferenceImages = (inputs.referenceImages?.length ?? 0) > 0;
  const instance: GeminiVideoRestRequest['instances'][number] = {
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
      encodedVideo: inputs.extensionVideo.videoBytes,
      encoding: inputs.extensionVideo.mimeType,
    };
  }

  const parameters: GeminiVideoRestRequest['parameters'] = {
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

function resolvePersonGeneration(inputs: GeminiVideoRequestInputs): 'allow_all' | 'allow_adult' {
  return inputs.startImage || inputs.endImage || (inputs.referenceImages?.length ?? 0) > 0
    ? 'allow_adult'
    : 'allow_all';
}
