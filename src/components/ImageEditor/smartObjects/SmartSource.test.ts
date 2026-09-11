import { describe, expect, it } from 'vitest';
import type { ImageDocument, SmartSource } from '../../../types/imageEditor';
import { assertSmartSourceGraph, createEmbeddedSmartSource, SMART_SOURCE_LIMITS } from './SmartSource';

function source(id: string, extra: Partial<SmartSource> = {}): SmartSource {
  return { id, kind: 'embedded', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: id, version: 1, ...extra };
}

function document(id: string, sources?: Record<string, SmartSource>): ImageDocument {
  return { id, title: id, width: 2, height: 2, layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false, metadata: sources ? { smartSources: sources } : undefined };
}

describe('SmartSource', () => {
  it('hashes bounded embedded source bytes', async () => {
    const result = await createEmbeddedSmartSource({ id: 'source-a', label: 'plate', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]), nativeWidth: 2, nativeHeight: 2, bytesAssetId: 'smart-source-a' });
    expect(result.sha256).toHaveLength(64);
    expect(result.bytesAssetId).toBe('smart-source-a');
  });

  it('refuses aggregate size and recursive nested source authority before mutation', () => {
    const full = SMART_SOURCE_LIMITS.maxSourceBytes;
    expect(() => assertSmartSourceGraph({
      a: source('a', { byteLength: full }), b: source('b', { byteLength: full }), c: source('c', { byteLength: full }),
      d: source('d', { byteLength: full }), e: source('e', { byteLength: 1 }),
    })).toThrow(/256 MiB/);
    const recursive = source('a', { nested: document('nested', { a: source('a') }) });
    expect(() => assertSmartSourceGraph({ a: recursive })).toThrow(/ancestor/);
  });
});
