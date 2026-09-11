import { describe, expect, it } from 'vitest';
import { resolveLiveNodeResultAssetUrl } from './useLiveNodeResultAssetUrl';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';

function item(overrides: Partial<SourceBinLibraryItem>): SourceBinLibraryItem {
  return {
    id: overrides.id ?? 'item-1',
    label: 'Generated asset',
    kind: 'image',
    mimeType: 'image/png',
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  } as SourceBinLibraryItem;
}

describe('resolveLiveNodeResultAssetUrl', () => {
  it('returns undefined when disabled (e.g. import mode)', () => {
    const items = [item({ id: 'a', originNodeId: 'node-1', assetUrl: 'blob:file:///x' })];
    expect(
      resolveLiveNodeResultAssetUrl(items, { nodeId: 'node-1', enabled: false, servedSession: false }),
    ).toBeUndefined();
  });

  it('resolves the selected attempt by sourceBinItemId over loose linkage', () => {
    const items = [
      item({ id: 'selected', originNodeId: 'node-1', assetUrl: 'blob:file:///selected', createdAt: 1 }),
      item({ id: 'newer', originNodeId: 'node-1', assetUrl: 'blob:file:///newer', createdAt: 99 }),
    ];
    expect(
      resolveLiveNodeResultAssetUrl(items, {
        nodeId: 'node-1',
        enabled: true,
        resultSourceBinItemId: 'selected',
        servedSession: false,
      }),
    ).toBe('blob:file:///selected');
  });

  it('falls back to the most recent item linked by originNodeId when no attempt id is given', () => {
    const items = [
      item({ id: 'old', originNodeId: 'node-1', assetUrl: 'blob:file:///old', createdAt: 1 }),
      item({ id: 'new', originNodeId: 'node-1', assetUrl: 'blob:file:///new', createdAt: 50 }),
      item({ id: 'other', originNodeId: 'node-2', assetUrl: 'blob:file:///other', createdAt: 100 }),
    ];
    expect(
      resolveLiveNodeResultAssetUrl(items, { nodeId: 'node-1', enabled: true, servedSession: false }),
    ).toBe('blob:file:///new');
  });

  it('matches loop/envelope-scoped origin ids prefixed with `${nodeId}:`', () => {
    const items = [item({ id: 'a', originNodeId: 'node-1:0', assetUrl: 'blob:file:///loop', createdAt: 1 })];
    expect(
      resolveLiveNodeResultAssetUrl(items, { nodeId: 'node-1', enabled: true, servedSession: false }),
    ).toBe('blob:file:///loop');
  });

  // The regression this fix targets: the resolver always returns the item's CURRENT assetUrl. After the
  // store revokes a stale blob and stores a fresh one, the next read hands back the fresh URL — the node
  // can never get stuck rendering a revoked blob the way a one-time `data.result` cache did.
  it('reflects the current assetUrl after the store replaces a revoked blob', () => {
    const before = [item({ id: 'gen', originNodeId: 'node-1', assetUrl: 'blob:file:///stale' })];
    const after = [item({ id: 'gen', originNodeId: 'node-1', assetUrl: 'blob:file:///fresh' })];
    const params = { nodeId: 'node-1', enabled: true, resultSourceBinItemId: 'gen', servedSession: false };
    expect(resolveLiveNodeResultAssetUrl(before, params)).toBe('blob:file:///stale');
    expect(resolveLiveNodeResultAssetUrl(after, params)).toBe('blob:file:///fresh');
  });

  it('rejects non-data URLs on a served session (the phone-local blob is unreachable there)', () => {
    const items = [item({ id: 'gen', originNodeId: 'node-1', assetUrl: 'blob:file:///phone-local' })];
    expect(
      resolveLiveNodeResultAssetUrl(items, {
        nodeId: 'node-1',
        enabled: true,
        resultSourceBinItemId: 'gen',
        servedSession: true,
      }),
    ).toBeUndefined();
  });

  it('accepts a data: URL on a served session', () => {
    const items = [item({ id: 'gen', originNodeId: 'node-1', assetUrl: 'data:image/png;base64,AAAA' })];
    expect(
      resolveLiveNodeResultAssetUrl(items, {
        nodeId: 'node-1',
        enabled: true,
        resultSourceBinItemId: 'gen',
        servedSession: true,
      }),
    ).toBe('data:image/png;base64,AAAA');
  });

  it('returns undefined when the linked item has no assetUrl', () => {
    const items = [item({ id: 'gen', originNodeId: 'node-1', assetUrl: undefined })];
    expect(
      resolveLiveNodeResultAssetUrl(items, { nodeId: 'node-1', enabled: true, servedSession: false }),
    ).toBeUndefined();
  });
});
