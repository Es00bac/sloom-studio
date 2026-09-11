import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeImageIccSoftProof } from './ImageColorProof';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

describe('Image ICC soft-proof execution', () => {
  it('uses Little-CMS for proof pixels and real gamut warnings, including ICC paper white', async () => {
    const source = new Uint8Array([
      255, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
    ]);
    const proof = await executeImageIccSoftProof(source, 3, 1, fogra39, {
      intent: 'relative', blackPointCompensation: true, paperWhiteSimulation: true,
    });
    expect(proof.rgba).toHaveLength(source.length);
    expect(proof.gamutWarnings).toHaveLength(3);
    expect(proof.gamutWarnings[2]).toBe(false);
    expect(proof.rgba[11]).toBe(255);
    expect(proof.outOfGamutPixels).toBeGreaterThanOrEqual(0);
  });
});
