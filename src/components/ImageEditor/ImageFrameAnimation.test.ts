import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../../types/imageEditor';
import { appendAnimationFrame, applyAnimationFrame, getImageFrameAnimation } from './ImageFrameAnimation';

function document(): ImageDocument {
  return { id: 'animation-doc', title: 'Animation', width: 32, height: 32, activeLayerId: 'ink', layers: [
    { id: 'paper', name: 'Paper', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null },
    { id: 'ink', name: 'Ink', type: 'image', visible: false, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null },
  ], hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false };
}

describe('ImageFrameAnimation', () => {
  it('retains visibility cels and restores the selected frame deterministically', () => {
    const source = document();
    const first = getImageFrameAnimation(source);
    const next = appendAnimationFrame({ ...source, metadata: { animation: first }, layers: source.layers.map((layer) => ({ ...layer, visible: !layer.visible })) });
    expect(next.frames).toHaveLength(2);
    expect(applyAnimationFrame(source, next, first.currentFrameId).layers.map((layer) => layer.visible)).toEqual([true, false]);
    expect(applyAnimationFrame(source, next, next.currentFrameId).layers.map((layer) => layer.visible)).toEqual([false, true]);
  });
});
