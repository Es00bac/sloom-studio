import { describe, expect, it } from 'vitest';
import {
  appendProjectUsageEntry,
  createProjectUsageEntryFromTelemetry,
  sanitizeProjectUsageLedgerSnapshot,
  summarizeProjectUsageLedger,
} from './projectUsageLedger';
import { FLOW_NODE_TYPES } from './projectSchema';
import type { UsageTelemetry } from '../types/flow';

const baseUsage: UsageTelemetry = {
  source: 'actual',
  confidence: 'measured',
  provider: 'bfl',
  modelId: 'flux-2-pro',
  costUsd: 0.05,
  imageCount: 1,
};

describe('projectUsageLedger', () => {
  it('keeps every current Flow node type when sanitizing usage entries', () => {
    const sanitized = sanitizeProjectUsageLedgerSnapshot({
      version: 1,
      entries: FLOW_NODE_TYPES.map((nodeType, index) => ({
        id: `entry-${index}`,
        createdAt: index,
        workspace: 'flow',
        operation: nodeType,
        nodeType,
        source: 'actual',
        confidence: 'measured',
      })),
    });

    expect(sanitized.entries.map((entry) => entry.nodeType)).toEqual(FLOW_NODE_TYPES);
  });

  it('does not create project usage entries with unknown runtime node types', () => {
    const entry = createProjectUsageEntryFromTelemetry({
      nodeId: 'unknown-1',
      nodeType: 'mysteryNode' as never,
      nodeData: {},
      workspace: 'flow',
      usage: baseUsage,
      createdAt: 100,
    });

    expect(entry.nodeType).toBeUndefined();
    expect(entry.operation).toBe('unknown-operation');
  });

  it('creates a durable project usage entry from node telemetry', () => {
    const entry = createProjectUsageEntryFromTelemetry({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: { imageOperation: 'mask-inpaint' },
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      usage: baseUsage,
      createdAt: 100,
    });

    expect(entry).toMatchObject({
      nodeId: 'image-1',
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      operation: 'mask-inpaint',
      provider: 'bfl',
      modelId: 'flux-2-pro',
      costUsd: 0.05,
      imageCount: 1,
      createdAt: 100,
    });
    expect(entry.id).toContain('image-1');
    expect(entry.id).toContain('mask-inpaint');
  });

  it('summarizes spend by provider, model, operation, and workspace', () => {
    const ledger = {
      version: 1 as const,
      entries: [
        createProjectUsageEntryFromTelemetry({
          nodeId: 'image-1',
          nodeType: 'imageGen',
          nodeData: { imageOperation: 'mask-inpaint' },
          workspace: 'flow',
          usage: baseUsage,
          createdAt: 100,
        }),
        createProjectUsageEntryFromTelemetry({
          nodeId: 'paper-upscale-1',
          nodeType: 'imageGen',
          nodeData: { imageOperation: 'upscale' },
          workspace: 'paper',
          usage: { ...baseUsage, provider: 'stability', modelId: 'stable-image-upscale-fast', costUsd: 0.02 },
          createdAt: 101,
        }),
        createProjectUsageEntryFromTelemetry({
          nodeId: 'text-1',
          nodeType: 'textNode',
          nodeData: {},
          workspace: 'flow',
          usage: { source: 'actual', confidence: 'unknown', provider: 'huggingface', modelId: 'provider-routed' },
          createdAt: 102,
        }),
      ],
    };

    const summary = summarizeProjectUsageLedger(ledger);

    expect(summary.totalKnownCostUsd).toBe(0.07);
    expect(summary.knownCostEntryCount).toBe(2);
    expect(summary.unknownCostEntryCount).toBe(1);
    expect(summary.byProvider.map((row) => [row.key, row.totalKnownCostUsd, row.entryCount])).toEqual([
      ['bfl', 0.05, 1],
      ['stability', 0.02, 1],
      ['huggingface', 0, 1],
    ]);
    expect(summary.byOperation.map((row) => row.key)).toEqual(['mask-inpaint', 'upscale', 'text-generation']);
    expect(summary.byWorkspace.map((row) => [row.key, row.totalKnownCostUsd])).toEqual([
      ['flow', 0.05],
      ['paper', 0.02],
    ]);
  });

  it('appends entries idempotently and sanitizes project snapshots', () => {
    const entry = createProjectUsageEntryFromTelemetry({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: {},
      workspace: 'flow',
      usage: baseUsage,
      createdAt: 100,
    });

    const ledger = appendProjectUsageEntry(appendProjectUsageEntry(undefined, entry), entry);
    expect(ledger.entries).toHaveLength(1);

    expect(sanitizeProjectUsageLedgerSnapshot({
      version: 'bad',
      entries: [
        { ...entry, costUsd: 0.05, createdAt: 100, flowWorkspaceId: 'workspace-a', flowWorkspaceName: 'Issue 1' },
        { id: '', provider: 123 },
      ],
    })).toMatchObject({
      version: 1,
      entries: [expect.objectContaining({
        id: entry.id,
        provider: 'bfl',
        costUsd: 0.05,
        flowWorkspaceId: 'workspace-a',
        flowWorkspaceName: 'Issue 1',
      })],
    });
  });

  it('keeps unknown actual usage explicit without fabricating zero-valued fields', () => {
    const entry = createProjectUsageEntryFromTelemetry({
      nodeId: 'hf-audio',
      nodeType: 'audioGen',
      nodeData: { audioGenerationMode: 'speech' },
      workspace: 'flow',
      usage: {
        source: 'actual',
        confidence: 'unknown',
        provider: 'huggingface',
        modelId: 'hexgrad/Kokoro-82M',
      },
      createdAt: 700,
    });
    const restored = sanitizeProjectUsageLedgerSnapshot({ version: 1, entries: [entry] });

    expect(restored.entries).toEqual([expect.objectContaining({
      operation: 'audio-speech',
      source: 'actual',
      confidence: 'unknown',
      provider: 'huggingface',
      modelId: 'hexgrad/Kokoro-82M',
      createdAt: 700,
    })]);
    expect(restored.entries[0]?.costUsd).toBeUndefined();
    expect(restored.entries[0]?.inputTokens).toBeUndefined();
    expect(restored.entries[0]?.outputTokens).toBeUndefined();
    expect(summarizeProjectUsageLedger(restored)).toMatchObject({
      totalKnownCostUsd: 0,
      knownCostEntryCount: 0,
      unknownCostEntryCount: 1,
      entryCount: 1,
    });
  });
});
