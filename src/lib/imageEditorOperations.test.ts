import { describe, expect, it } from 'vitest';
import {
  canRunImageEditorOperation,
  estimateImageEditorOperationCostUsd,
  getImageEditorOperationsForModel,
  listImageEditorOperationDefinitions,
} from './imageEditorOperations';

describe('imageEditorOperations', () => {
  it('defines the full image editor operation matrix', () => {
    expect(listImageEditorOperationDefinitions().map((operation) => operation.id)).toEqual([
      'inpaint',
      'editImage',
      'erase',
      'outpaint',
      'searchReplace',
      'searchRecolor',
      'removeBackground',
      'replaceBackground',
      'relight',
      'upscale',
      'resizeImage',
      'resizeCanvas',
    ]);
  });

  it('maps model capabilities into image editor operations with local geometry actions always available', () => {
    // gpt-image-1 truly honours a mask, so it offers BOTH localized Inpaint and whole-image Edit.
    expect(getImageEditorOperationsForModel('openai', 'gpt-image-1').map((operation) => operation.id)).toEqual([
      'inpaint',
      'editImage',
      'resizeImage',
      'resizeCanvas',
    ]);

    expect(getImageEditorOperationsForModel('stability', 'stable-image-edit-search-replace').map((operation) => operation.id)).toEqual([
      'searchReplace',
      'resizeImage',
      'resizeCanvas',
    ]);
    expect(getImageEditorOperationsForModel('stability', 'stable-image-edit-erase').map((operation) => operation.id)).toEqual([
      'erase',
      'resizeImage',
      'resizeCanvas',
    ]);

    // flux-2-pro can edit but has no mask field, so it must NOT offer Inpaint — only the honest
    // whole-image Edit — so a painted mask is never silently ignored.
    expect(getImageEditorOperationsForModel('bfl', 'flux-2-pro').map((operation) => operation.id)).toEqual([
      'editImage',
      'resizeImage',
      'resizeCanvas',
    ]);
    expect(getImageEditorOperationsForModel('bfl', 'flux-2-pro').map((operation) => operation.id)).not.toContain('inpaint');
  });

  it('gates source-layer and selection requirements before allowing a provider edit', () => {
    expect(
      canRunImageEditorOperation({
        operationId: 'inpaint',
        providerId: 'openai',
        modelId: 'gpt-image-1',
        hasActiveLayer: true,
        hasSelection: false,
      }),
    ).toEqual({ ok: false, reason: 'Select or mask an area before running Inpaint.' });

    expect(
      canRunImageEditorOperation({
        operationId: 'inpaint',
        providerId: 'openai',
        modelId: 'gpt-image-1',
        hasActiveLayer: true,
        hasSelection: true,
      }),
    ).toEqual({ ok: true });

    expect(
      canRunImageEditorOperation({
        operationId: 'resizeCanvas',
        providerId: 'gemini',
        modelId: 'gemini-2.5-flash-image',
        hasActiveLayer: false,
        hasSelection: false,
      }),
    ).toEqual({ ok: true });
  });

  it('reports realistic operation costs from provider metadata and local actions', () => {
    expect(
      estimateImageEditorOperationCostUsd({
        operationId: 'searchReplace',
        providerId: 'stability',
        modelId: 'stable-image-edit-search-replace',
      }),
    ).toMatchObject({
      costUsd: 0.05,
      unitLabel: '5 credits',
      confidence: 'published-fixed',
    });

    expect(
      estimateImageEditorOperationCostUsd({
        operationId: 'resizeImage',
        providerId: 'openai',
        modelId: 'gpt-image-1',
      }),
    ).toMatchObject({
      costUsd: 0,
      unitLabel: 'local',
      confidence: 'published-fixed',
    });

    expect(
      estimateImageEditorOperationCostUsd({
        operationId: 'editImage',
        providerId: 'bfl',
        modelId: 'flux-2-pro',
      }),
    ).toMatchObject({
      costUsd: 0.045,
      unitLabel: 'from $0.045/edit',
      confidence: 'published-minimum',
    });
  });
});
