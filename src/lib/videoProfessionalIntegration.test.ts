import { describe, expect, it } from 'vitest';
import { buildVideoCompositionRenderCacheSignature } from './videoRenderCache';
import { buildVideoRenderClipSignature } from './videoRenderSegments';
import { createDefaultEditorProfessionalVideoState } from '../types/videoProfessional';

describe('professional Video render invalidation', () => {
  it('invalidates only a clip signature when its professional finishing state changes', () => {
    const base = buildVideoRenderClipSignature({ id: 'clip-1', sourceNodeId: 'camera-a' });
    const changed = buildVideoRenderClipSignature({
      id: 'clip-1',
      sourceNodeId: 'camera-a',
      professional: { chromaKeyMode: 'green' },
    });

    expect(changed).not.toBe(base);
  });

  it('invalidates the composition cache when shared mixer/color/track state changes', () => {
    const state = createDefaultEditorProfessionalVideoState();
    const base = buildVideoCompositionRenderCacheSignature({ professionalState: state });
    const changed = buildVideoCompositionRenderCacheSignature({
      professionalState: { ...state, workingColorSpace: 'rec2020-pq' },
    });

    expect(changed).not.toBe(base);
  });
});
