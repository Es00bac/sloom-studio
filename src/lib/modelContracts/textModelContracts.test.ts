import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, FALLBACK_MODEL_OPTIONS } from '../providerCatalog';
import { getProviderModelContract } from '../providerModelContracts';
import { getTextModelContract, TEXT_MODEL_CONTRACTS } from './textModelContracts';

describe('TEXT_MODEL_CONTRACTS', () => {
  it('covers every normal fallback option with an exact verified or unverified contract', () => {
    for (const [providerId, options] of Object.entries(FALLBACK_MODEL_OPTIONS.text)) {
      for (const option of options) {
        const contract = getProviderModelContract(TEXT_MODEL_CONTRACTS, providerId, option.value);
        expect(contract, `${providerId}/${option.value}`).toBeDefined();
        expect(contract?.modelId).toBe(option.value);
        expect(contract?.operations).toContain('text-generation');
        expect(contract?.outputModalities).toContain('text');
        expect(contract?.requestBuilder).toBeTruthy();
        if (contract?.lifecycle !== 'unverified') {
          expect(contract?.evidence.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses current documented OpenAI GPT-5.6 tiers as normal choices', () => {
    expect(DEFAULT_MODELS.text.openai).toBe('gpt-5.6-terra');
    expect(FALLBACK_MODEL_OPTIONS.text.openai.map((option) => option.value)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  it('removes shut-down Gemini preview aliases while preserving current stable and preview IDs', () => {
    const ids = FALLBACK_MODEL_OPTIONS.text.gemini.map((option) => option.value);

    expect(ids).toEqual([
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash-lite',
    ]);
    expect(ids).not.toContain('gemini-3.1-flash-lite-preview');
  });

  it('encodes exact Gemini 3 thinking controls and does not send them to Gemini 2.5', () => {
    const pro = getProviderModelContract(TEXT_MODEL_CONTRACTS, 'gemini', 'gemini-3.1-pro-preview');
    const flash = getProviderModelContract(TEXT_MODEL_CONTRACTS, 'gemini', 'gemini-3.5-flash');
    const legacy25 = getProviderModelContract(TEXT_MODEL_CONTRACTS, 'gemini', 'gemini-2.5-flash');

    expect(
      pro?.parameters.find((parameter) => parameter.id === 'thinkingLevel')?.options?.map(
        (option) => option.value,
      ),
    ).toEqual(['default', 'low', 'medium', 'high']);
    expect(
      flash?.parameters.find((parameter) => parameter.id === 'thinkingLevel')?.options?.map(
        (option) => option.value,
      ),
    ).toEqual(['default', 'minimal', 'low', 'medium', 'high']);
    expect(legacy25?.parameters.some((parameter) => parameter.id === 'thinkingLevel')).toBe(false);
  });

  it('uses Hugging Face models currently recommended for chat completion and marks routing as account-dependent', () => {
    expect(DEFAULT_MODELS.text.huggingface).toBe('Qwen/Qwen3-4B-Thinking-2507');
    expect(FALLBACK_MODEL_OPTIONS.text.huggingface.map((option) => option.value)).toEqual([
      'Qwen/Qwen3-4B-Thinking-2507',
      'openai/gpt-oss-120b',
      'Qwen/Qwen3-Coder-480B-A35B-Instruct',
      'zai-org/GLM-4.5',
      'deepseek-ai/DeepSeek-R1',
    ]);

    for (const option of FALLBACK_MODEL_OPTIONS.text.huggingface) {
      expect(
        getProviderModelContract(TEXT_MODEL_CONTRACTS, 'huggingface', option.value),
      ).toMatchObject({
        availability: 'account-dependent',
        apiFamily: 'huggingface-inference',
      });
    }
  });

  it('fails closed to a safe unverified text-only contract for an unknown live model', () => {
    expect(getTextModelContract('huggingface', 'vendor/new-chat-model')).toMatchObject({
      modelId: 'vendor/new-chat-model',
      lifecycle: 'unverified',
      inputModalities: ['text'],
      outputModalities: ['text'],
      operations: ['text-generation'],
    });
  });
});
