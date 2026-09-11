import { describe, expect, it } from 'vitest';
import { getPaperDtpParityPriorities, PAPER_DTP_PARITY_FEATURES } from './paperDtpParity';

describe('paperDtpParity', () => {
  it('prioritizes the highest-impact comic DTP gaps first', () => {
    const features = getPaperDtpParityPriorities();

    expect(features.slice(0, 3).every((feature) => feature.priority === 'highest')).toBe(true);
    expect(features.map((feature) => feature.id)).toEqual(expect.arrayContaining([
      'linked-flow-assets',
      'facing-pages',
      'print-preflight',
    ]));
  });

  it('keeps side-by-side InDesign and Sloom Studio status data for each feature', () => {
    expect(PAPER_DTP_PARITY_FEATURES.every((feature) => (
      feature.indesign.length > 0
      && feature.signalLoom.length > 0
      && feature.comicImpact.length > 0
    ))).toBe(true);
  });

  it('marks integrated Paper/InDesign features as available with action targets', () => {
    const available = PAPER_DTP_PARITY_FEATURES.filter((feature) => ['linked-flow-assets', 'facing-pages', 'print-preflight'].includes(feature.id));

    expect(available.every((feature) => feature.status === 'available')).toBe(true);
    expect(available.map((feature) => feature.actionTarget)).toEqual(['linked-assets', 'spreads', 'preflight']);
  });
});
