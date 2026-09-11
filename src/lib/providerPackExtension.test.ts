import { describe, expect, it } from 'vitest';
import { BUNDLED_PROVIDER_PACKS } from './bundledProviderPacks';
import {
  inspectProviderPackExtension,
  PROVIDER_PACK_EXTENSION_KIND,
} from './providerPackExtension';
import type { ProviderPackRuntimeRecord } from './providerPackContracts';

const bundled = BUNDLED_PROVIDER_PACKS[0];

function record(overrides: Partial<ProviderPackRuntimeRecord> = {}): ProviderPackRuntimeRecord {
  return {
    pack: bundled,
    hash: 'test-hash',
    provenance: 'local',
    importedAt: 1,
    active: false,
    executionApproved: false,
    trustApprovedOrigins: [],
    testStatusByOperation: {},
    ...overrides,
  };
}

describe('provider-pack extension boundary', () => {
  it('reports the declarative capabilities and review state without granting code execution', () => {
    const report = inspectProviderPackExtension(record());
    expect(report).toMatchObject({
      kind: PROVIDER_PACK_EXTENSION_KIND,
      schemaVersion: 1,
      readiness: 'review',
      cardCount: bundled.cards.length,
      operationCount: bundled.cards.reduce((total, card) => total + card.operations.length, 0),
      credentialMaterial: 'local-slots-only',
      arbitraryCode: false,
    });
    expect(report.transportKinds).toEqual([...new Set(bundled.transports.map((transport) => transport.kind))].sort());
  });

  it('reports an active local pack ready only after exact origins and required slots are approved', () => {
    const origin = bundled.approvedOrigins[0]?.origin ?? 'https://example.test';
    const candidate = structuredClone(bundled);
    const originalSlot = bundled.credentialSlots[0];
    candidate.credentialSlots = [{
      id: 'required',
      label: originalSlot?.label ?? 'Required key',
      authType: originalSlot?.authType ?? 'bearer',
      approvedOrigin: origin,
      ...(originalSlot?.builtInEngineId ? { builtInEngineId: originalSlot.builtInEngineId } : {}),
      ...(originalSlot?.headerName ? { headerName: originalSlot.headerName } : {}),
      required: true,
    }];
    candidate.transports = candidate.transports.map((transport) => ({
      ...transport,
      ...(transport.credentialSlotId ? { credentialSlotId: 'required' } : {}),
    }));
    candidate.discovery = candidate.discovery.map((recipe) => ({
      ...recipe,
      ...(recipe.credentialSlotId ? { credentialSlotId: 'required' } : {}),
    }));
    const active = record({ pack: candidate, active: true, executionApproved: true, trustApprovedOrigins: [origin] });
    expect(inspectProviderPackExtension(active, { isCredentialConfigured: () => false }).readiness).toBe('review');
    expect(inspectProviderPackExtension(active, { isCredentialConfigured: (slotId) => slotId === 'required' }).readiness).toBe('ready');
  });

  it('blocks malformed packs even when an old record says active', () => {
    const malformed = structuredClone(bundled);
    malformed.packId = '';
    const report = inspectProviderPackExtension(record({ pack: malformed, active: true, executionApproved: true }));
    expect(report.readiness).toBe('blocked');
    expect(report.validationIssueCount).toBeGreaterThan(0);
  });

  it('fails malformed record shapes closed instead of dereferencing them', () => {
    for (const malformed of [
      undefined,
      { pack: { packId: 'missing-arrays' }, provenance: 'bundled' },
      { ...record(), trustApprovedOrigins: undefined },
      { ...record(), pack: { ...bundled, cards: undefined } },
    ]) {
      expect(() => inspectProviderPackExtension(malformed as ProviderPackRuntimeRecord)).not.toThrow();
      expect(inspectProviderPackExtension(malformed as ProviderPackRuntimeRecord).readiness).toBe('blocked');
    }
  });

  it('reports supersession and release restrictions without treating them as runtime authority', () => {
    const active = record({
      active: true,
      executionApproved: true,
      provenance: 'bundled',
      trustApprovedOrigins: bundled.approvedOrigins.map((origin) => origin.origin),
    });
    const report = inspectProviderPackExtension(active, {
      isCredentialConfigured: () => true,
      isSuperseded: true,
      releasePolicy: { lockedPackIds: [bundled.packId] },
    });

    expect(report).toMatchObject({
      readiness: 'review',
      supersession: 'superseded',
      releasePolicy: 'restricted',
    });
    expect(report.readinessReasons).toContain('superseded by another active version');
  });
});
