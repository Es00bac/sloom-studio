import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { BUNDLED_PROVIDER_PACKS } from './bundledProviderPacks';
import type { ProviderPackV1 } from './providerPackContracts';
import {
  configureProviderPackReleasePolicy,
  providerPackRegistry,
  sanitizeProviderPackSettingsBackup,
} from './providerPackRegistry';
import { serializeProviderPack } from './providerPackPortability';

const created: Array<{ packId: string; hash: string }> = [];

afterAll(async () => {
  configureProviderPackReleasePolicy(undefined);
  for (const record of created) {
    await providerPackRegistry.removeOverride(record.packId, record.hash);
  }
});

describe('provider-pack registry', () => {
  it('does not resolve a bundled provider requiring a missing local credential as executable', () => {
    const bundled = BUNDLED_PROVIDER_PACKS.find((pack) => pack.credentialSlots.some((slot) => slot.required));
    expect(bundled).toBeDefined();
    const card = bundled!.cards[0]!;
    const record = providerPackRegistry.getRecordByHash(bundled!.packId, providerPackRegistry.getActiveRecord(bundled!.packId)!.hash)!;

    expect(providerPackRegistry.hasCredential(bundled!.packId, bundled!.credentialSlots[0]!.id)).toBe(false);
    expect(providerPackRegistry.resolveCard({
      packId: bundled!.packId,
      version: bundled!.version,
      hash: record.hash,
      cardId: card.id,
    }).executable).toBe(false);
  });
  it('separates inactive review from approved execution and keeps pinned approved hashes runnable', async () => {
    const v1 = registryPack('test.registry.pinning', '1.0.0');
    const importedV1 = await providerPackRegistry.importText(serializeProviderPack(v1).json, {
      provenance: 'community',
      activate: false,
    });
    remember(importedV1.record);
    const refV1 = ref(importedV1.record);
    expect(providerPackRegistry.resolveCard(refV1).executable).toBe(false);

    await providerPackRegistry.approveOrigins(v1.packId, importedV1.record.hash, ['https://api.example.test']);
    await providerPackRegistry.activate(v1.packId, importedV1.record.hash);
    expect(providerPackRegistry.resolveCard(refV1).executable).toBe(true);

    const v2 = registryPack(v1.packId, '1.1.0');
    const importedV2 = await providerPackRegistry.importText(serializeProviderPack(v2).json, {
      provenance: 'community',
      activate: false,
    });
    remember(importedV2.record);
    expect(providerPackRegistry.resolveCard(ref(importedV2.record)).executable).toBe(false);
    expect(providerPackRegistry.resolveCard(refV1).executable).toBe(true);

    await providerPackRegistry.approveOrigins(v2.packId, importedV2.record.hash, ['https://api.example.test']);
    await providerPackRegistry.activate(v2.packId, importedV2.record.hash);
    expect(providerPackRegistry.getActiveRecord(v2.packId)?.hash).toBe(importedV2.record.hash);
    expect(providerPackRegistry.resolveCard(refV1).executable).toBe(true);
  });

  it('preserves credentials only across the same slot and exact origin', async () => {
    const packId = 'test.registry.credentials';
    const v1 = registryPack(packId, '1.0.0', true);
    const first = await providerPackRegistry.importText(serializeProviderPack(v1).json, { provenance: 'local' });
    remember(first.record);
    await providerPackRegistry.approveOrigins(packId, first.record.hash, ['https://api.example.test']);
    await providerPackRegistry.activate(packId, first.record.hash);
    await providerPackRegistry.setCredential(packId, 'default', 'portable-secret');
    expect(await providerPackRegistry.getCredential(packId, 'default', 'https://api.example.test'))
      .toBe('portable-secret');

    const v2 = registryPack(packId, '1.1.0', true);
    const second = await providerPackRegistry.importText(serializeProviderPack(v2).json, { provenance: 'local' });
    remember(second.record);
    await providerPackRegistry.approveOrigins(packId, second.record.hash, ['https://api.example.test']);
    await providerPackRegistry.activate(packId, second.record.hash);
    expect(providerPackRegistry.hasCredential(packId, 'default')).toBe(true);
    expect(await providerPackRegistry.getCredential(packId, 'default', 'https://api.example.test'))
      .toBe('portable-secret');

    const moved = registryPack(packId, '2.0.0', true, 'https://new-origin.example.test');
    const third = await providerPackRegistry.importText(serializeProviderPack(moved).json, { provenance: 'local' });
    remember(third.record);
    await providerPackRegistry.approveOrigins(packId, third.record.hash, ['https://new-origin.example.test']);
    await providerPackRegistry.activate(packId, third.record.hash);
    expect(providerPackRegistry.hasCredential(packId, 'default')).toBe(false);
    expect(await providerPackRegistry.getCredential(packId, 'default', 'https://new-origin.example.test'))
      .toBeNull();
  });

  it('versions drafts and stores only presentation-shaped personal defaults', async () => {
    const pack = registryPack('test.registry.drafts', '1.0.0');
    const imported = await providerPackRegistry.importText(serializeProviderPack(pack).json, { provenance: 'local' });
    remember(imported.record);
    const first = await providerPackRegistry.saveDraft('draft:test', pack);
    const second = await providerPackRegistry.saveDraft('draft:test', { ...pack, version: '1.0.1' });
    expect(second.revision).toBe(first.revision + 1);

    await providerPackRegistry.savePersonalLayout({
      schemaVersion: 1,
      packId: pack.packId,
      cardId: pack.cards[0].id,
      packHash: imported.record.hash,
      override: {
        schemaVersion: 1,
        cardId: pack.cards[0].id,
        width: 650,
        containers: [],
        elements: [],
        endpointPath: 'https://attacker.example.test',
      },
      updatedAt: Date.now(),
    } as never);
    const saved = providerPackRegistry.getPersonalLayout(pack.packId, pack.cards[0].id);
    expect(saved?.override.width).toBe(650);
    expect(JSON.stringify(saved)).not.toMatch(/endpoint|credential|transport|apiPath/);
  });

  it('exports dynamic state for the outer encrypted settings envelope and validates hard bounds', async () => {
    const backup = await providerPackRegistry.exportSettingsBackup();
    expect(backup).toMatchObject({ schemaVersion: 1 });
    expect(backup?.packs.length).toBeGreaterThan(0);
    expect(backup?.drafts.length).toBeGreaterThan(0);
    expect(backup?.personalLayouts.length).toBeGreaterThan(0);
    expect(backup?.credentials.some((credential) => credential.value === 'portable-secret')).toBe(true);
    expect(() => sanitizeProviderPackSettingsBackup({
      schemaVersion: 1,
      packs: [],
      drafts: [],
      personalLayouts: [],
      credentials: Array.from({ length: 513 }, () => ({})),
    })).toThrow(/safety limit/);
  });

  it('enforces release-owned pack, operation, origin, control, and value policy outside the pack', () => {
    const active = providerPackRegistry.getActiveRecord('test.registry.pinning');
    expect(active).toBeDefined();
    const card = active!.pack.cards[0];
    configureProviderPackReleasePolicy({
      lockedOperationIds: ['generate'],
      lockedFieldIds: ['prompt'],
      lockedValues: { prompt: ['blocked prompt'] },
      allowedApprovedOrigins: ['https://api.example.test'],
    });
    expect(providerPackRegistry.getReleasePolicy()?.lockedFieldIds).toEqual(['prompt']);
    expect(() => providerPackRegistry.assertExecutionAllowed(
      active!.pack,
      card,
      'generate',
      { prompt: 'hello' },
    )).toThrow(/release policy/);

    configureProviderPackReleasePolicy({
      lockedValues: { prompt: ['blocked prompt'] },
      allowedApprovedOrigins: ['https://api.example.test'],
    });
    expect(() => providerPackRegistry.assertExecutionAllowed(
      active!.pack,
      card,
      'generate',
      { prompt: 'blocked prompt' },
    )).toThrow(/value disabled/);
    configureProviderPackReleasePolicy(undefined);
  });
});

function remember(record: { pack: ProviderPackV1; hash: string }) {
  created.push({ packId: record.pack.packId, hash: record.hash });
}

function ref(record: { pack: ProviderPackV1; hash: string }) {
  return {
    packId: record.pack.packId,
    version: record.pack.version,
    hash: record.hash,
    cardId: record.pack.cards[0].id,
  };
}

function registryPack(
  packId: string,
  version: string,
  credential = false,
  origin = 'https://api.example.test',
): ProviderPackV1 {
  return {
    schemaVersion: 1,
    packId,
    version,
    displayName: 'Registry pack',
    provider: { name: 'Registry provider' },
    approvedOrigins: [{ origin }],
    credentialSlots: credential ? [{
      id: 'default',
      label: 'API key',
      authType: 'bearer',
      approvedOrigin: origin,
      required: true,
    }] : [],
    discovery: [],
    optionCatalogs: [],
    transports: [{
      id: 'route',
      label: 'Route',
      kind: 'http',
      approvedOrigin: origin,
      credentialSlotId: credential ? 'default' : undefined,
      method: 'POST',
      endpointPath: '/v1/generate',
      bodyKind: 'json',
    }],
    cards: [{
      schemaVersion: 1,
      id: 'model:test',
      modelId: 'test',
      displayName: 'Test',
      modalities: ['text'],
      fields: [{
        id: 'prompt',
        label: 'Prompt',
        apiPath: 'prompt',
        semanticRole: 'prompt',
        valueType: 'string',
        cardinality: 'one',
        required: true,
        connectable: true,
        operationIds: ['generate'],
        control: 'prompt',
      }],
      outputs: [{
        id: 'text-output',
        label: 'Text',
        semanticRole: 'text-output',
        resultType: 'text',
        primary: true,
        cardinality: 'one',
        operationIds: ['generate'],
      }],
      operations: [{
        id: 'generate',
        label: 'Generate',
        transportProfileId: 'route',
        requiredFieldIds: ['prompt'],
        visibleFieldIds: ['prompt'],
        inputPortFieldIds: ['prompt'],
        outputIds: ['text-output'],
        requestBindings: [{ fieldId: 'prompt', requestPath: 'prompt' }],
        outputExtractions: [{ outputId: 'text-output', kind: 'json-pointer', pointer: '/text' }],
      }],
      evidence: [],
      confidence: 'manual',
      status: 'ready-untested',
      layout: {
        schemaVersion: 1,
        id: 'layout',
        width: 390,
        minWidth: 260,
        maxWidth: 1040,
        fitTarget: '1080p',
        heightBudget: 900,
        containers: [{ id: 'main', kind: 'grid', order: 0, columns: 1 }],
        elements: [{ id: 'prompt', fieldId: 'prompt', containerId: 'main', order: 0, height: 42 }],
      },
    }],
  };
}
