import type { NodeResultAttempt, ResultType, ResultValue, UsageTelemetry } from '../types/flow';

interface AttemptPayload {
  result: ResultValue;
  resultType: ResultType;
  statusMessage: string;
  usage?: UsageTelemetry;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  sourceBinItemId?: string;
}

export function appendResultAttempt(
  attempts: NodeResultAttempt[],
  payload: AttemptPayload,
): { attempts: NodeResultAttempt[]; selectedAttemptId: string } {
  const nextAttempt: NodeResultAttempt = {
    id: crypto.randomUUID(),
    result: payload.result,
    resultType: payload.resultType,
    statusMessage: payload.statusMessage,
    createdAt: new Date().toISOString(),
    usage: payload.usage,
    mimeType: payload.mimeType,
    extension: payload.extension,
    fileName: payload.fileName,
    outputMetadata: payload.outputMetadata,
    sourceBinItemId: payload.sourceBinItemId,
  };

  return {
    attempts: [...(Array.isArray(attempts) ? attempts : []), nextAttempt],
    selectedAttemptId: nextAttempt.id,
  };
}

export function resolveSelectedResultAttempt(
  attempts: NodeResultAttempt[],
  attemptId: string,
): NodeResultAttempt | undefined {
  if (!Array.isArray(attempts)) {
    return undefined;
  }

  return attempts.find((attempt) => attempt.id === attemptId);
}
