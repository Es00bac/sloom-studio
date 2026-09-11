import { describe, expect, it } from 'vitest';
import { IMAGE_PHOTOSHOP_PARITY_ITEMS } from './ImagePhotoshopParity';

describe('ImagePhotoshopParity CMYK / Lab / Grayscale row', () => {
  it('tracks deterministic grayscale and CMYK preview helpers without overstating color-mode parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('deterministic RGB-to-grayscale helper'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('CMYK channel separation preview arrays');
    expect(row?.signalLoom).toContain('color-mode state');
    expect(row?.signalLoom).toContain('ICC transforms');
    expect(row?.signalLoom).toContain('native CMYK export');
    expect(row?.signalLoom).toContain('indexed preview limits');
    expect(row?.signalLoom).toContain('full Lab workflow remain incomplete');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(14);
  });
});
