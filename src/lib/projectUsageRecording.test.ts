import { describe, expect, it, vi } from 'vitest';
import {
  executeAndRecordProjectUsage,
  recordProjectUsageFromExecution,
} from './projectUsageRecording';
import type { AppNode } from '../types/flow';

describe('projectUsageRecording', () => {
  it('records known usage, but requires an explicit success boundary before synthesizing unknown usage', () => {
    const recordUsage = vi.fn();
    const node = {
      id: 'image-1',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { imageOperation: 'outpaint' },
    } as AppNode;

    recordProjectUsageFromExecution({
      node,
      usage: {
        source: 'actual',
        confidence: 'fixed',
        provider: 'stability',
        modelId: 'stable-image-outpaint',
        costUsd: 0.04,
      },
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      recordUsage,
      createdAt: 100,
    });

    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: node.data,
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      usage: expect.objectContaining({ provider: 'stability', costUsd: 0.04 }),
      createdAt: 100,
    }));

    recordProjectUsageFromExecution({
      node,
      usage: undefined,
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      recordUsage,
      createdAt: 101,
    });
    expect(recordUsage).toHaveBeenCalledTimes(1);

    recordProjectUsageFromExecution({
      node,
      usage: undefined,
      executionSucceeded: true,
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      recordUsage,
      createdAt: 101,
    });
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(recordUsage).toHaveBeenLastCalledWith(expect.objectContaining({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: node.data,
      workspace: 'flow',
      flowWorkspaceId: 'workspace-a',
      flowWorkspaceName: 'Issue 1',
      createdAt: 101,
      usage: {
        source: 'actual',
        confidence: 'unknown',
        provider: 'gemini',
        notes: [expect.stringContaining('did not report numeric usage')],
      },
    }));
    expect(recordUsage.mock.calls[1][0].usage).not.toHaveProperty('costUsd');
    expect(recordUsage.mock.calls[1][0].usage).not.toHaveProperty('inputTokens');
    expect(recordUsage.mock.calls[1][0].usage).not.toHaveProperty('outputTokens');

    recordProjectUsageFromExecution({
      node: { ...node, type: 'textNode', data: { mode: 'prompt', prompt: 'local text' } } as AppNode,
      usage: undefined,
      workspace: 'flow',
      recordUsage,
    });
    expect(recordUsage).toHaveBeenCalledTimes(2);
  });

  it('records exactly once after an explicit async success and never on failure or cancellation', async () => {
    const recordUsage = vi.fn();
    const events: string[] = [];
    const node = {
      id: 'editor-narration-1',
      type: 'audioGen',
      position: { x: 0, y: 0 },
      data: { provider: 'elevenlabs', modelId: 'eleven_multilingual_v2', audioGenerationMode: 'speech' },
    } as AppNode;

    const execution = await executeAndRecordProjectUsage({
      node,
      workspace: 'editor',
      recordUsage: (input) => {
        events.push('record');
        recordUsage(input);
      },
      execute: async () => {
        events.push('execute');
        return {
          result: 'data:audio/mpeg;base64,QQ==',
          usage: undefined,
        };
      },
    });
    events.push('caller');

    expect(execution.result).toContain('data:audio/mpeg');
    expect(events).toEqual(['execute', 'record', 'caller']);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'editor',
      usage: expect.objectContaining({
        source: 'actual',
        confidence: 'unknown',
        provider: 'elevenlabs',
        modelId: 'eleven_multilingual_v2',
      }),
    }));

    await expect(executeAndRecordProjectUsage({
      node,
      workspace: 'editor',
      recordUsage,
      execute: async () => { throw new Error('provider failed'); },
    })).rejects.toThrow('provider failed');
    await expect(executeAndRecordProjectUsage({
      node,
      workspace: 'editor',
      recordUsage,
      execute: async () => { throw new DOMException('cancelled', 'AbortError'); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
});
