import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { resolveFlowNodePorts } from './flowNodeContracts';
import { executeNodeRequest, parseVisionVerificationResponse } from './flowExecution';
import { NonRetryableError } from './exponentialBackoff';

const response = vi.hoisted(() => ({ text: 'true\nThe subject matches the reference.' as unknown, calls: 0 }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async () => {
        response.calls += 1;
        return { text: response.text, usageMetadata: {} };
      },
    };
  },
}));

const settings = {
  apiKeys: { gemini: 'test-key' },
  providerSettings: {
    backendProxyEnabled: false,
    batchMaxRetries: 0,
    batchRetryBaseDelayMs: 1,
    geminiCredentialMode: 'api-key',
  },
} as RuntimeSettingsSnapshot;

function visionVerifyNode(): AppNode {
  return {
    id: 'verify',
    type: 'visionVerifyNode',
    position: { x: 0, y: 0 },
    data: { modelId: 'gemini-3.5-flash' },
  } as AppNode;
}

describe('Vision Verify execution contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    response.calls = 0;
  });

  it.each([
    ['true', 'The subject matches the reference.', true],
    ['false', 'The subject does not match the reference.', false],
    [' TrUe ', 'The subject matches the reference.', true],
    ['\tFaLsE\t', 'The subject does not match the reference.', false],
  ])('emits %s as a Boolean at the executor-to-port boundary', async (decision, explanation, expected) => {
    response.text = `${decision}\n${explanation}`;
    const node = visionVerifyNode();

    const execution = await executeNodeRequest(node, {
      prompt: 'Check the character design.',
      editImageInput: 'data:image/png;base64,U1VCSkVDVA==',
      config: DEFAULT_EXECUTION_CONFIG,
    }, settings);

    const output = resolveFlowNodePorts({ node, nodes: [node], edges: [] })
      .find((port) => port.direction === 'output');

    expect(output?.types).toEqual([{ kind: 'boolean' }]);
    expect(execution).toMatchObject({ result: expected, resultType: 'boolean' });
    expect(typeof execution.result).toBe('boolean');
    expect(execution.usage?.notes).toContain(explanation);
    expect(execution.usage).toMatchObject({
      source: 'actual',
      confidence: 'unknown',
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
    });
    expect(execution.usage).not.toHaveProperty('inputTokens');
    expect(execution.usage).not.toHaveProperty('totalTokens');
  });

  it.each([
    ['', 'empty'],
    ['maybe', 'unknown token'],
    ['untrue', 'embedded token'],
    ['true false', 'contradictory true-first line'],
    ['false true', 'contradictory false-first line'],
    [undefined, 'missing result'],
    [null, 'null result'],
    [42, 'numeric result'],
    [{ decision: true }, 'object result'],
  ])('rejects malformed API-key responses without retrying a paid submission: %s', async (value, _description) => {
    response.text = value;
    const retryingSettings = {
      ...settings,
      providerSettings: { ...settings.providerSettings, batchMaxRetries: 2 },
    } as RuntimeSettingsSnapshot;

    await expect(executeNodeRequest(visionVerifyNode(), {
      prompt: 'Check the character design.',
      editImageInput: 'data:image/png;base64,U1VCSkVDVA==',
      config: DEFAULT_EXECUTION_CONFIG,
    }, retryingSettings)).rejects.toBeInstanceOf(NonRetryableError);

    expect(response.calls).toBe(1);
  });

  it('uses the same strict parser for Vertex output and fails provider rejections without a retry', async () => {
    const generateVertexText = vi.fn()
      .mockResolvedValueOnce({ text: ' FALSE \nThe reference outfit is absent.' })
      .mockResolvedValueOnce({ text: 'true false' })
      .mockResolvedValueOnce({ error: 'provider rejected the image' });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexText } });
    const vertexSettings = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        geminiCredentialMode: 'vertex-adc',
        vertexProjectId: 'vision-project',
        vertexLocation: 'us-central1',
        vertexQuotaProjectId: '',
        vertexEnvironmentVariables: '',
        vertexServiceAccountJson: '',
        batchMaxRetries: 2,
      },
    } as RuntimeSettingsSnapshot;
    const context = {
      prompt: 'Check the character design.',
      editImageInput: 'data:image/png;base64,U1VCSkVDVA==',
      config: DEFAULT_EXECUTION_CONFIG,
    };

    await expect(executeNodeRequest(visionVerifyNode(), context, vertexSettings)).resolves.toMatchObject({
      result: false,
      resultType: 'boolean',
    });
    await expect(executeNodeRequest(visionVerifyNode(), context, vertexSettings)).rejects.toBeInstanceOf(NonRetryableError);
    await expect(executeNodeRequest(visionVerifyNode(), context, vertexSettings)).rejects.toBeInstanceOf(NonRetryableError);
    expect(generateVertexText).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['true\nIt matches.', true],
    [' FaLsE \nIt does not match.', false],
    ['', undefined],
    ['maybe', undefined],
    ['untrue', undefined],
    ['true false', undefined],
    ['false true', undefined],
    [undefined, undefined],
    [null, undefined],
    [42, undefined],
    [{ decision: true }, undefined],
  ])('applies the strict decision contract to Vertex responses: %s', async (text, expected) => {
    const generateVertexText = vi.fn().mockResolvedValue({ text });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexText } });
    const vertexSettings = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        geminiCredentialMode: 'vertex-adc', vertexProjectId: 'vision-project', vertexLocation: 'us-central1',
        vertexQuotaProjectId: '', vertexEnvironmentVariables: '', vertexServiceAccountJson: '', batchMaxRetries: 2,
      },
    } as RuntimeSettingsSnapshot;
    const run = executeNodeRequest(visionVerifyNode(), {
      prompt: 'Check the character design.', editImageInput: 'data:image/png;base64,U1VCSkVDVA==', config: DEFAULT_EXECUTION_CONFIG,
    }, vertexSettings);

    if (expected === undefined) {
      await expect(run).rejects.toBeInstanceOf(NonRetryableError);
    } else {
      await expect(run).resolves.toMatchObject({ result: expected, resultType: 'boolean' });
    }
    expect(generateVertexText).toHaveBeenCalledTimes(1);
  });

  it('accepts only a provider Boolean or one standalone first decision line', () => {
    expect(parseVisionVerificationResponse(true)).toEqual({ value: true, explanation: '' });
    expect(parseVisionVerificationResponse(false)).toEqual({ value: false, explanation: '' });
    expect(parseVisionVerificationResponse('  tRuE  \nIt matches.')).toEqual({ value: true, explanation: 'It matches.' });
    expect(() => parseVisionVerificationResponse('true\nfalse')).toThrow(NonRetryableError);
  });
});
