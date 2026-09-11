import { describe, expect, it } from 'vitest';
import { IMAGE_PHOTOSHOP_PARITY_ITEMS } from './ImagePhotoshopParity';

describe('ImagePhotoshopParity puppet warp row', () => {
  it('tracks the retained on-canvas Puppet mesh and bounded perspective plane without claiming full Photoshop parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('retained on-canvas Puppet mesh'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('draggable 4×4 cage');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('visible single-plane grid');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('save/reopen');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('Photoshop-weighted triangulated');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.parityEstimate).toBeGreaterThanOrEqual(62);
  });
});
