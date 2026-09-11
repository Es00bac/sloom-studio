import { sha256Hex } from '../../../lib/slimgV2';
import type { ImageDocument, SmartSource } from '../../../types/imageEditor';

export const SMART_SOURCE_LIMITS = Object.freeze({
  maxSourceBytes: 64 * 1024 * 1024,
  maxDocumentBytes: 256 * 1024 * 1024,
  maxNestedDepth: 3,
});

export class SmartSourceError extends Error {
  readonly code: 'empty' | 'oversize' | 'aggregate-oversize' | 'invalid' | 'recursive' | 'depth';

  constructor(code: SmartSourceError['code'], message: string) {
    super(message);
    this.name = 'SmartSourceError';
    this.code = code;
  }
}

export async function createEmbeddedSmartSource(input: {
  id: string; label: string; mimeType: string; bytes: Uint8Array; nativeWidth: number; nativeHeight: number; bytesAssetId?: string;
}): Promise<SmartSource> {
  assertSmartSourceShape(input);
  if (input.bytes.byteLength === 0) throw new SmartSourceError('empty', 'Smart Object source bytes cannot be empty.');
  if (input.bytes.byteLength > SMART_SOURCE_LIMITS.maxSourceBytes) throw new SmartSourceError('oversize', 'Smart Object source exceeds the 64 MiB limit.');
  return {
    id: input.id, kind: 'embedded', mimeType: input.mimeType, byteLength: input.bytes.byteLength,
    sha256: await sha256Hex(input.bytes), nativeWidth: input.nativeWidth, nativeHeight: input.nativeHeight,
    label: input.label, version: 1, embeddedBytes: new Uint8Array(input.bytes), ...(input.bytesAssetId ? { bytesAssetId: input.bytesAssetId } : {}),
  };
}

export function assertSmartSourceGraph(sources: Record<string, SmartSource> | undefined, ancestorIds: readonly string[] = []): void {
  let total = 0;
  for (const [id, source] of Object.entries(sources ?? {})) {
    if (source.id !== id) throw new SmartSourceError('invalid', `Smart Object source ${id} has a mismatched identity.`);
    assertSmartSourceShape(source);
    if (!Number.isInteger(source.byteLength) || source.byteLength <= 0 || source.byteLength > SMART_SOURCE_LIMITS.maxSourceBytes) {
      throw new SmartSourceError('oversize', `Smart Object source ${id} exceeds its byte limit.`);
    }
    total += source.byteLength;
    if (source.nested) assertNestedDocument(source.nested, [...ancestorIds, id]);
  }
  if (total > SMART_SOURCE_LIMITS.maxDocumentBytes) throw new SmartSourceError('aggregate-oversize', 'Smart Object sources exceed the 256 MiB document limit.');
}

export function assertNestedDocument(document: ImageDocument, ancestors: readonly string[]): void {
  if (ancestors.length > SMART_SOURCE_LIMITS.maxNestedDepth) throw new SmartSourceError('depth', 'Smart Object nesting exceeds depth 3.');
  const nested = document.metadata?.smartSources;
  for (const source of Object.values(nested ?? {})) {
    if (ancestors.includes(source.id)) throw new SmartSourceError('recursive', 'A Smart Object source may not reference an ancestor source.');
  }
  assertSmartSourceGraph(nested, ancestors);
}

export function bumpSmartSourceVersion(source: SmartSource, patch: Pick<SmartSource, 'byteLength' | 'sha256' | 'mimeType' | 'nativeWidth' | 'nativeHeight' | 'bytesAssetId' | 'nested'>): SmartSource {
  const next = { ...source, ...patch, version: source.version + 1 };
  assertSmartSourceGraph({ [next.id]: next });
  return next;
}

function assertSmartSourceShape(value: { id: string; label: string; mimeType: string; nativeWidth: number; nativeHeight: number }): void {
  if (!value.id || !value.label || !/^[-\w.+/]+$/.test(value.mimeType)) throw new SmartSourceError('invalid', 'Smart Object source identity, label, or MIME type is invalid.');
  if (!Number.isInteger(value.nativeWidth) || !Number.isInteger(value.nativeHeight) || value.nativeWidth < 1 || value.nativeHeight < 1) {
    throw new SmartSourceError('invalid', 'Smart Object source dimensions are invalid.');
  }
}
