import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAPER_PROJECT_1_AUDIT, paperAuditEntry } from './paperProductionAudit';

describe('Paper Project 1 audit ledger', () => {
  it('tracks every release-blocking production defect with evidence fields', () => {
    const required = [
      'asset-inline-base64', 'font-system-authority', 'icc-profile-substitution',
      'process-cmyk-roundtrip', 'spot-rich-text-overclaim', 'overprint-not-emitted',
      'pdfx-download-after-failure', 'stability-provider-contract', 'stability-effective-ppi',
    ];
    expect(PAPER_PROJECT_1_AUDIT.map((entry) => entry.id)).toEqual(expect.arrayContaining(required));
    for (const id of required) {
      expect(paperAuditEntry(id)).toMatchObject({ severity: expect.any(String), evidence: expect.any(Array) });
    }
  });

  it('records verified live Stability output evidence after both configured provider modes run', () => {
    expect(paperAuditEntry('stability-provider-contract')).toMatchObject({
      status: 'verified',
    });
    expect(paperAuditEntry('stability-effective-ppi')).toMatchObject({
      status: 'verified',
      evidence: expect.arrayContaining([
        'docs/audits/paper-stability-live-2026-07-14.md',
      ]),
    });
  });

  it('closes every local production defect only with current focused and repository-wide evidence', () => {
    const verifiedLocally = [
      'asset-inline-base64',
      'font-system-authority',
      'icc-profile-substitution',
      'process-cmyk-roundtrip',
      'spot-rich-text-overclaim',
      'overprint-not-emitted',
      'pdfx-download-after-failure',
      'stability-provider-contract',
    ];

    for (const id of verifiedLocally) {
      expect(paperAuditEntry(id)).toMatchObject({
        status: 'verified',
        tests: expect.arrayContaining([expect.any(String)]),
      });
    }
  });

  it('runs the golden verifier through the read-only-safe Vite runner loader', () => {
    const source = readFileSync('scripts/verify-paper-production.mjs', 'utf8');
    expect(source).toMatch(/vitestEntrypoint,[\s\S]{0,160}'--configLoader',[\s\S]{0,80}'runner'/);
  });
});
