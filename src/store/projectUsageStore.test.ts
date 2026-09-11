import { afterEach, describe, expect, it } from 'vitest';
import { useProjectUsageStore } from './projectUsageStore';

afterEach(() => {
  useProjectUsageStore.getState().restoreSnapshot(undefined);
});

describe('projectUsageStore', () => {
  it('records usage entries and restores sanitized project snapshots', () => {
    useProjectUsageStore.getState().recordUsage({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: { imageOperation: 'upscale' },
      workspace: 'flow',
      usage: {
        source: 'actual',
        confidence: 'fixed',
        provider: 'stability',
        modelId: 'stable-image-upscale-fast',
        costUsd: 0.02,
        imageCount: 1,
      },
      createdAt: 100,
    });

    expect(useProjectUsageStore.getState().summary.totalKnownCostUsd).toBe(0.02);
    expect(useProjectUsageStore.getState().exportSnapshot().entries).toHaveLength(1);

    useProjectUsageStore.getState().restoreSnapshot({
      version: 1,
      entries: [{
        id: 'restored',
        createdAt: 101,
        workspace: 'paper',
        operation: 'print-upscale',
        provider: 'stability',
        modelId: 'stable-image-upscale-conservative',
        source: 'actual',
        confidence: 'fixed',
        costUsd: 0.4,
      }],
    });

    expect(useProjectUsageStore.getState().summary.totalKnownCostUsd).toBe(0.4);
    expect(useProjectUsageStore.getState().ledger.entries[0]?.workspace).toBe('paper');
  });
});
