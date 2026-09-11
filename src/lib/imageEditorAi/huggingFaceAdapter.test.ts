import { describe, expect, it, beforeEach } from 'vitest';
import { useSettingsStore } from '../../store/settingsStore';
import { runHuggingFaceInpaint } from './huggingFaceAdapter';
import type { GenerativeFillRequest } from '../imageEditorAi';

function baseRequest(overrides: Partial<GenerativeFillRequest> = {}): GenerativeFillRequest {
  return {
    source: new Blob(['source']),
    mask: new Blob(['mask']),
    prompt: 'a cozy cabin in the woods',
    provider: 'huggingface',
    ...overrides,
  };
}

describe('runHuggingFaceInpaint', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, huggingface: 'test-hf-token' },
    });
  });

  it('rejects requests carrying reference images instead of silently dropping them', async () => {
    // The public HF Inference API's masked-inpainting task (`parameters: {image, mask_image}`)
    // has no reference-image field in its real schema — a populated `references` array must fail
    // loudly rather than silently generate a reference-free image (every Hugging Face catalog
    // model correctly reports maxReferenceImages: 0, so the editor never offers this control, but
    // the adapter should not depend on the UI alone to prevent silent data loss).
    await expect(runHuggingFaceInpaint(baseRequest({
      references: [{ id: 'ref-1', imageUrl: 'blob:ref-1' }],
    }))).rejects.toThrow(/no reference-image parameter/i);
  });

  it('requires an API key before doing anything else', async () => {
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, huggingface: '' },
    });
    await expect(runHuggingFaceInpaint(baseRequest())).rejects.toThrow(/API key not configured/i);
  });
});
