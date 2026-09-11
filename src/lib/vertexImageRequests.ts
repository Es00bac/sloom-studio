import type { AspectRatio } from '../types/flow';

export type VertexImageRoute = 'gemini-generate-content' | 'imagen-predict';
export type VertexImagenUpscaleFactor = 'x2' | 'x3' | 'x4';
export type VertexImagenOutputMimeType = 'image/png' | 'image/jpeg';

export const VERTEX_IMAGEN_UPSCALE_MODEL_ID = 'imagen-4.0-upscale-preview';

export interface VertexInlineImage {
  mimeType: string;
  data: string;
}

export interface VertexGeneratedImage {
  mimeType: string;
  data: string;
}

export interface VertexGeminiImageReference {
  image: VertexInlineImage;
  /**
   * AUD-011: optional numbered-slot guidance rendered as a text part immediately BEFORE this
   * reference image, so the association is explicit and positional in the parts array.
   */
  instruction?: string;
}

export interface VertexGeminiImageRequestInput {
  prompt: string;
  aspectRatio: AspectRatio;
  /** Gemini 3.x image_size tier ('1K' | '2K' | '4K'); omitted = provider default. */
  imageSize?: '1K' | '2K' | '4K';
  sourceImage?: VertexInlineImage;
  references?: VertexGeminiImageReference[];
}

export interface VertexImagenPredictRequestInput {
  prompt: string;
  aspectRatio: AspectRatio;
}

export interface VertexImagenUpscaleRequestInput {
  image: VertexInlineImage;
  upscaleFactor: VertexImagenUpscaleFactor;
  outputMimeType?: VertexImagenOutputMimeType;
  compressionQuality?: number;
}

export function isVertexImagenModelId(modelId: string | undefined): boolean {
  return (modelId ?? '').trim().toLowerCase().startsWith('imagen-');
}

export function getVertexImageRoute(modelId: string): VertexImageRoute {
  return isVertexImagenModelId(modelId) ? 'imagen-predict' : 'gemini-generate-content';
}

export function buildVertexGeminiImageRequestBody(input: VertexGeminiImageRequestInput): Record<string, unknown> {
  const parts: Array<{ text: string } | { inlineData: VertexInlineImage }> = [
    { text: input.prompt },
  ];

  if (input.sourceImage) {
    parts.push({ inlineData: input.sourceImage });
  }

  for (const reference of input.references ?? []) {
    if (reference.instruction) {
      parts.push({ text: reference.instruction });
    }
    parts.push({ inlineData: reference.image });
  }

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: input.aspectRatio,
        ...(input.imageSize ? { imageSize: input.imageSize } : {}),
      },
    },
  };
}

export function buildVertexImagenPredictRequestBody(input: VertexImagenPredictRequestInput): Record<string, unknown> {
  return {
    instances: [{ prompt: input.prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: input.aspectRatio,
    },
  };
}

export function buildVertexImagenUpscaleRequestBody(input: VertexImagenUpscaleRequestInput): Record<string, unknown> {
  const outputOptions: Record<string, unknown> = {
    mimeType: input.outputMimeType ?? 'image/png',
  };

  if (typeof input.compressionQuality === 'number') {
    outputOptions.compressionQuality = Math.max(0, Math.min(100, Math.round(input.compressionQuality)));
  }

  return {
    instances: [
      {
        prompt: 'Upscale the image',
        image: {
          bytesBase64Encoded: input.image.data,
        },
      },
    ],
    parameters: {
      mode: 'upscale',
      outputOptions,
      upscaleConfig: {
        upscaleFactor: input.upscaleFactor,
      },
    },
  };
}

export function dataUrlToVertexInlineImage(dataUrl: string, fallbackMimeType = 'image/png'): VertexInlineImage {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Unsupported image data URL format for Vertex image request.');
  }

  return {
    mimeType: match[1] || fallbackMimeType,
    data: match[2],
  };
}

export function extractVertexGeneratedImage(response: unknown): VertexGeneratedImage | undefined {
  const responseRecord = isRecord(response) ? response : undefined;
  const candidateParts = getCandidateParts(responseRecord);

  for (const part of candidateParts) {
    const inlineData = getInlineData(part);

    if (inlineData) {
      return inlineData;
    }
  }

  const predictions = Array.isArray(responseRecord?.predictions) ? responseRecord.predictions : [];

  for (const prediction of predictions) {
    const image = getImagenPredictionImage(prediction);

    if (image) {
      return image;
    }
  }

  return undefined;
}

function getCandidateParts(response: Record<string, unknown> | undefined): unknown[] {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const parts: unknown[] = [];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const candidateParts = Array.isArray(content?.parts) ? content.parts : [];
    parts.push(...candidateParts);
  }

  return parts;
}

function getInlineData(part: unknown): VertexGeneratedImage | undefined {
  if (!isRecord(part)) {
    return undefined;
  }

  const inlineData = isRecord(part.inlineData)
    ? part.inlineData
    : isRecord(part.inline_data)
      ? part.inline_data
      : undefined;
  const data = typeof inlineData?.data === 'string' ? inlineData.data : undefined;

  if (!data) {
    return undefined;
  }

  return {
    mimeType: typeof inlineData?.mimeType === 'string' ? inlineData.mimeType : 'image/png',
    data,
  };
}

function getImagenPredictionImage(prediction: unknown): VertexGeneratedImage | undefined {
  if (!isRecord(prediction)) {
    return undefined;
  }

  const directData = typeof prediction.bytesBase64Encoded === 'string'
    ? prediction.bytesBase64Encoded
    : typeof prediction.bytes_base64_encoded === 'string'
      ? prediction.bytes_base64_encoded
      : undefined;

  if (directData) {
    return {
      mimeType: typeof prediction.mimeType === 'string' ? prediction.mimeType : 'image/png',
      data: directData,
    };
  }

  const image = isRecord(prediction.image) ? prediction.image : undefined;
  const imageData = typeof image?.bytesBase64Encoded === 'string'
    ? image.bytesBase64Encoded
    : typeof image?.bytes_base64_encoded === 'string'
      ? image.bytes_base64_encoded
      : undefined;

  if (!imageData) {
    return undefined;
  }

  return {
    mimeType: typeof image?.mimeType === 'string' ? image.mimeType : 'image/png',
    data: imageData,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
