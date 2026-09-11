import { describe, expect, it } from 'vitest';
import { tryRenderLayerEffectsGpu } from './ImageLayerEffectsGpu';
import type { ImageLayerEffect } from '../../types/imageEditor';

function makeSource(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  // mark fully opaque so effects have content to act on
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data } as ImageData;
}

const pad = { left: 4, right: 4, top: 4, bottom: 4 };

describe('ImageLayerEffectsGpu fallback contract', () => {
  // The Node/vitest environment has no WebGL2, so the GPU path must degrade gracefully to
  // null (the caller then uses the CPU renderer). This guarantees the GPU accelerator is
  // never a correctness dependency — it only ever speeds things up where available.
  it('returns null when WebGL2 is unavailable', () => {
    const stroke: ImageLayerEffect = {
      id: 's', kind: 'stroke', enabled: true, color: '#00ff00', opacity: 1, size: 4, position: 'outside',
    };
    expect(tryRenderLayerEffectsGpu(makeSource(32, 32), [stroke], pad)).toBeNull();
  });

  it('returns null for an empty effect list', () => {
    expect(tryRenderLayerEffectsGpu(makeSource(32, 32), [], pad)).toBeNull();
  });
});
