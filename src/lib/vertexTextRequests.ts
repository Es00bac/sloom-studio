export interface VertexGeminiTextRequestInput {
  prompt: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
}

export function buildVertexGeminiTextRequestBody(input: VertexGeminiTextRequestInput): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxOutputTokens ?? 8192,
    temperature: input.temperature ?? 0.2,
  };

  if (input.responseMimeType) {
    generationConfig.responseMimeType = input.responseMimeType;
  }

  if (input.responseSchema) {
    generationConfig.responseSchema = input.responseSchema;
  }

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: input.prompt,
          },
        ],
      },
    ],
    generationConfig,
  };
}

export function extractVertexGeneratedText(response: unknown): string | undefined {
  const responseRecord = isRecord(response) ? response : undefined;
  const candidates = Array.isArray(responseRecord?.candidates) ? responseRecord.candidates : [];
  const textParts: string[] = [];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];

    for (const part of parts) {
      if (!isRecord(part) || typeof part.text !== 'string' || !part.text.trim()) {
        continue;
      }

      textParts.push(part.text);
    }
  }

  const text = textParts.join('\n').trim();
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
