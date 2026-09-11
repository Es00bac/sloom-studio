import { describe, expect, it } from 'vitest';
import type { NodeData } from '../types/flow';
import {
  canUsePaintedMaskForNode,
  normalizeMaskDataUrl,
  resolveImageNodeMaskInput,
} from './imageNodeMask';

describe('image node mask helper', () => {
  it('normalizes image data URLs and rejects non-image values', () => {
    expect(normalizeMaskDataUrl(' data:image/png;base64,TUFTSw== ')).toBe('data:image/png;base64,TUFTSw==');
    expect(normalizeMaskDataUrl('data:text/plain;base64,TUFTSw==')).toBeUndefined();
    expect(normalizeMaskDataUrl('')).toBeUndefined();
  });

  it('prefers a connected mask over a node-painted mask', () => {
    const nodeData: NodeData = {
      provider: 'stability',
      modelId: 'stable-image-edit-inpaint',
      imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
    };

    expect(resolveImageNodeMaskInput({
      connectedMaskInput: 'data:image/png;base64,Q09OTkVDVEVE',
      nodeData,
    })).toBe('data:image/png;base64,Q09OTkVDVEVE');
  });

  it('uses a painted mask for mask-aware image edit models', () => {
    const nodeData: NodeData = {
      provider: 'localOpen',
      modelId: 'Qwen/Qwen-Image-Edit',
      imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
    };

    expect(canUsePaintedMaskForNode(nodeData)).toBe(true);
    expect(resolveImageNodeMaskInput({ nodeData })).toBe('data:image/png;base64,UEFJTlRFRA==');
  });

  it('does not submit painted masks for outpaint-only models', () => {
    const nodeData: NodeData = {
      provider: 'stability',
      modelId: 'stable-image-edit-outpaint',
      imageOperation: 'outpaint',
      imagePaintedMaskDataUrl: 'data:image/png;base64,UEFJTlRFRA==',
    };

    expect(canUsePaintedMaskForNode(nodeData)).toBe(false);
    expect(resolveImageNodeMaskInput({ nodeData })).toBeUndefined();
  });
});
