import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashExecutionParameters } from './flowExecution';
import type { ExecutionContext } from './flowExecution';

const mockConfig: import('../types/flow').ExecutionConfig = {
  aspectRatio: '1:1',
  steps: 30,
  durationSeconds: 5,
  videoResolution: '1080p',
  videoFrameRate: 24,
  imageOutputFormat: 'png',
  audioOutputFormat: 'mp3_44100_128',
};

describe('hashExecutionParameters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('generates a consistent hash for identical inputs', async () => {
    const nodeData = { provider: 'gemini', modelId: 'gemini-1.5-flash', prompt: 'test' };
    const context: ExecutionContext = { prompt: 'test', config: mockConfig };

    const hash1 = await hashExecutionParameters(nodeData, context);
    const hash2 = await hashExecutionParameters(nodeData, context);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex length
  });

  it('generates different hashes for different node data', async () => {
    const context: ExecutionContext = { prompt: 'test', config: mockConfig };

    const hash1 = await hashExecutionParameters({ provider: 'gemini', prompt: 'test' }, context);
    const hash2 = await hashExecutionParameters({ provider: 'openai', prompt: 'test' }, context);

    expect(hash1).not.toBe(hash2);
  });

  it('generates different hashes for different contexts', async () => {
    const nodeData = { provider: 'gemini' };

    const hash1 = await hashExecutionParameters(nodeData, { prompt: 'test', config: mockConfig });
    const hash2 = await hashExecutionParameters(nodeData, { prompt: 'test2', config: mockConfig });

    expect(hash1).not.toBe(hash2);
  });

  it('works in an HTTP LAN-served browser without SubtleCrypto', async () => {
    vi.stubGlobal('crypto', {});
    await expect(hashExecutionParameters(
      { provider: 'local' },
      { prompt: 'LAN session', config: mockConfig },
    )).resolves.toMatch(/^[a-f0-9]{64}$/);
  });
});
