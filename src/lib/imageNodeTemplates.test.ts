import { describe, expect, it } from 'vitest';
import {
  createImageNodeTemplateDataPatch,
  getImageNodeOperationCostRows,
  listImageNodeTemplates,
} from './imageNodeTemplates';

describe('imageNodeTemplates', () => {
  it('offers capability-specific image node templates for the first-class cloud and open providers', () => {
    const templateIds = listImageNodeTemplates().map((template) => template.id);

    expect(templateIds).toEqual(expect.arrayContaining([
      'gemini-reference-edit',
      'openai-mask-edit',
      'huggingface-open-model',
      'bfl-flux2-reference',
      'stability-inpaint',
      'stability-outpaint',
      'stability-erase',
      'stability-search-replace',
      'stability-background-relight',
      'local-open-qwen-edit',
    ]));
  });

  it('creates initial Image-node data patches that select the matching provider, model, and operation', () => {
    expect(createImageNodeTemplateDataPatch('stability-outpaint')).toMatchObject({
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-outpaint',
      imageOperation: 'outpaint',
      imageOutpaintLeft: 256,
      imageOutpaintRight: 256,
      customTitle: 'Stability Outpaint',
    });
    expect(createImageNodeTemplateDataPatch('stability-erase')).toMatchObject({
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-erase',
      imageOperation: 'erase',
      customTitle: 'Stability Erase',
    });

    expect(createImageNodeTemplateDataPatch('bfl-flux2-reference')).toMatchObject({
      mediaMode: 'generate',
      provider: 'bfl',
      modelId: 'flux-2-pro',
      customTitle: 'FLUX.2 Multi-Reference',
    });
  });

  it('summarizes per-operation model costs instead of showing only the first listed operation', () => {
    expect(getImageNodeOperationCostRows('bfl', 'flux-2-pro')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'text-to-image',
        estimateLabel: '$0.03 (from $0.03/image)',
        confidence: 'published-minimum',
      }),
      expect.objectContaining({
        operation: 'image-edit',
        estimateLabel: '$0.045 (from $0.045/edit)',
        confidence: 'published-minimum',
      }),
    ]));

    expect(getImageNodeOperationCostRows('stability', 'stable-image-edit-search-replace')).toEqual([
      expect.objectContaining({
        operation: 'search-replace',
        estimateLabel: '$0.05 (5 credits)',
        confidence: 'published-fixed',
      }),
    ]);

    expect(getImageNodeOperationCostRows('stability', 'stable-image-upscale-fast')).toEqual([
      expect.objectContaining({
        operation: 'upscale',
        estimateLabel: '$0.02 (2 credits)',
        confidence: 'published-fixed',
      }),
    ]);

    expect(getImageNodeOperationCostRows('stability', 'stable-image-upscale-conservative')).toEqual([
      expect.objectContaining({
        operation: 'upscale',
        estimateLabel: '$0.4 (40 credits)',
        confidence: 'published-fixed',
      }),
    ]);
  });
});
