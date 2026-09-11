export interface CompositionMediaRef {
  handle: string;
  nodeId: string;
  resultType: 'video' | 'audio';
  url: string;
}

export function buildCompositionMediaSignature(
  mediaSources: Array<CompositionMediaRef | undefined>,
): string {
  return JSON.stringify(
    mediaSources.flatMap((media) => (
      media
        ? [{
            handle: media.handle,
            nodeId: media.nodeId,
            resultType: media.resultType,
            url: media.url,
          }]
        : []
    )),
  );
}

export function parseCompositionMediaSignature(signature: string): CompositionMediaRef[] {
  if (!signature) {
    return [];
  }

  return JSON.parse(signature) as CompositionMediaRef[];
}

export function mergeDurationMap(
  previous: Record<string, number>,
  entries: ReadonlyArray<readonly [string, number]>,
): Record<string, number> {
  const next = Object.fromEntries(entries) as Record<string, number>;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);

  if (
    previousKeys.length === nextKeys.length &&
    nextKeys.every((key) => previous[key] === next[key])
  ) {
    return previous;
  }

  return next;
}
