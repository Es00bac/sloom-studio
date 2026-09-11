import 'fake-indexeddb/auto';
import './test-setup-window';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultGamepadBindings } from '../lib/gamepadBindings';
import type { OpenFontLibraryFace } from '../lib/paperOpenFontCatalog';
import { DEFAULT_MODELS, DEFAULT_PROVIDER_SETTINGS } from '../lib/providerCatalog';
import { BUNDLED_PROVIDER_PACKS } from '../lib/bundledProviderPacks';
import { serializeProviderPack } from '../lib/providerPackPortability';
import { providerPackRegistry } from '../lib/providerPackRegistry';
import { decryptSettingsBackup, encryptSettingsBackup } from '../lib/settingsBackup';
import { useSettingsStore } from './settingsStore';

const PASSPHRASE = 'portable settings test passphrase';

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

type SettingsPersistOptions = {
  merge?: (persistedState: unknown, currentState: SettingsState) => SettingsState;
};

type PersistableSettingsStore = typeof useSettingsStore & {
  persist?: {
    getOptions?: () => SettingsPersistOptions;
  };
};

function openFontLibraryFace(): OpenFontLibraryFace {
  const fontSha256 = 'a'.repeat(64);
  const licenseSha256 = 'b'.repeat(64);
  return {
    subset: 'latin',
    retrievedAt: 1234,
    face: {
      id: 'open-example-sans-latin-400-normal',
      familyId: 'example sans',
      familyName: 'Example Sans',
      postscriptName: 'ExampleSans-Regular',
      weight: 400,
      style: 'normal',
      stretchPercent: 100,
      collectionIndex: 0,
      variableAxes: {},
      unicodeRanges: [{ start: 0x20, end: 0x7e }],
      format: 'truetype',
      fontAsset: { id: `sha256:${fontSha256}`, sha256: fontSha256, mimeType: 'font/ttf', byteLength: 4 },
      embeddability: 'unknown',
      canSubset: true,
      source: {
        kind: 'open-catalog',
        url: 'https://cdn.jsdelivr.net/fontsource/fonts/example-sans@1.2.3/latin-400-normal.ttf',
        version: '1.2.3',
      },
      license: {
        id: 'OFL-1.1',
        textAsset: { id: `sha256:${licenseSha256}`, sha256: licenseSha256, mimeType: 'text/plain', byteLength: 4 },
      },
    },
  };
}

function legacyBackupData() {
  return {
    apiKeys: { openai: 'legacy-openai-key' },
    defaultModels: DEFAULT_MODELS,
    providerSettings: DEFAULT_PROVIDER_SETTINGS,
    interfaceThemeId: 'high-contrast',
    keyboardShortcuts: {},
    gamepadBindings: createDefaultGamepadBindings(),
    customBrushPresets: [],
    customCropPresets: [],
    licenseKey: '',
  };
}

function portableStateSnapshot() {
  const state = useSettingsStore.getState();
  return structuredClone({
    apiKeys: state.apiKeys,
    defaultModels: state.defaultModels,
    defaultImageNodeModel: state.defaultImageNodeModel,
    providerSettings: state.providerSettings,
    interfaceThemeId: state.interfaceThemeId,
    appMenuStyle: state.appMenuStyle,
    interfaceDensity: state.interfaceDensity,
    locale: state.locale,
    localeChosen: state.localeChosen,
    keyboardShortcuts: state.keyboardShortcuts,
    gamepadBindings: state.gamepadBindings,
    customBrushPresets: state.customBrushPresets,
    customCropPresets: state.customCropPresets,
    openFontLibrary: state.openFontLibrary,
    licenseKey: state.licenseKey,
    license: state.license,
    isSettingsOpen: state.isSettingsOpen,
    settingsPanel: state.settingsPanel,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  useSettingsStore.setState({
    apiKeys: { openai: '', gemini: '', huggingface: '', elevenlabs: '', bfl: '', stability: '', atlas: '', byteplus: '' },
    defaultModels: DEFAULT_MODELS,
    defaultImageNodeModel: null,
    providerSettings: DEFAULT_PROVIDER_SETTINGS,
    interfaceThemeId: 'default',
    appMenuStyle: 'compact',
    interfaceDensity: 'compact',
    locale: 'en',
    localeChosen: false,
    keyboardShortcuts: {},
    gamepadBindings: createDefaultGamepadBindings(),
    customBrushPresets: [],
    customCropPresets: [],
    openFontLibrary: [],
    isSettingsOpen: false,
    settingsPanel: 'providers',
    licenseKey: '',
    license: { licensed: false },
  });
});

describe('portable encrypted settings backup schema (AUD-042)', () => {
  it('exports, decrypts, and imports every declared user-meaningful persisted setting', async () => {
    const font = openFontLibraryFace();
    const gamepadBindings = createDefaultGamepadBindings();
    gamepadBindings.flow.buttonSouth = {
      ...gamepadBindings.flow.buttonSouth,
      command: 'file:open',
      sensitivity: 1.25,
    };
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, openai: 'sk-portable' },
      defaultModels: {
        ...DEFAULT_MODELS,
        text: { ...DEFAULT_MODELS.text, openai: 'gpt-portable-preference' },
      },
      defaultImageNodeModel: { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell' },
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        atlasBaseUrl: 'https://portable.example.test',
        batchMaxRetries: 4,
      },
      interfaceThemeId: 'high-contrast',
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      keyboardShortcuts: { 'file:new': 'Ctrl+Alt+Shift+N' },
      gamepadBindings,
      openFontLibrary: [font],
      isSettingsOpen: true,
      settingsPanel: 'fonts',
    });
    useSettingsStore.getState().saveCustomBrushPreset('Portable Brush', { size: 17, opacity: 0.61 });
    useSettingsStore.getState().saveCustomCropPreset('Portable Crop', 1.91);

    const source = useSettingsStore.getState();
    const expectedPortableState = structuredClone({
      apiKeys: source.apiKeys,
      defaultModels: source.defaultModels,
      defaultImageNodeModel: source.defaultImageNodeModel,
      providerSettings: source.providerSettings,
      interfaceThemeId: source.interfaceThemeId,
      appMenuStyle: source.appMenuStyle,
      interfaceDensity: source.interfaceDensity,
      locale: source.locale,
      localeChosen: source.localeChosen,
      keyboardShortcuts: source.keyboardShortcuts,
      gamepadBindings: source.gamepadBindings,
      customBrushPresets: source.customBrushPresets,
      customCropPresets: source.customCropPresets,
      openFontLibrary: source.openFontLibrary,
      licenseKey: source.licenseKey,
    });

    const encrypted = await useSettingsStore.getState().exportSettingsBackup(PASSPHRASE);
    const data = JSON.parse(await decryptSettingsBackup(encrypted, PASSPHRASE)) as Record<string, unknown>;

    expect(Object.keys(data).sort()).toEqual([
      'apiKeys',
      'appMenuStyle',
      'customBrushPresets',
      'customCropPresets',
      'defaultImageNodeModel',
      'defaultModels',
      'gamepadBindings',
      'interfaceDensity',
      'interfaceThemeId',
      'keyboardShortcuts',
      'licenseKey',
      'locale',
      'localeChosen',
      'openFontLibrary',
      'providerSettings',
      'schemaVersion',
    ]);
    expect(data).toEqual({ schemaVersion: 1, ...expectedPortableState });
    expect(data).not.toHaveProperty('isSettingsOpen');
    expect(data).not.toHaveProperty('settingsPanel');
    expect(data).not.toHaveProperty('settingsHydrated');
    expect(data).not.toHaveProperty('license');

    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, openai: '' },
      defaultModels: DEFAULT_MODELS,
      defaultImageNodeModel: null,
      providerSettings: DEFAULT_PROVIDER_SETTINGS,
      interfaceThemeId: 'default',
      appMenuStyle: 'compact',
      interfaceDensity: 'compact',
      locale: 'en',
      localeChosen: false,
      keyboardShortcuts: {},
      gamepadBindings: createDefaultGamepadBindings(),
      customBrushPresets: [],
      customCropPresets: [],
      openFontLibrary: [],
    });

    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'committed' });
    const imported = useSettingsStore.getState();
    expect({
      apiKeys: imported.apiKeys,
      defaultModels: imported.defaultModels,
      defaultImageNodeModel: imported.defaultImageNodeModel,
      providerSettings: imported.providerSettings,
      interfaceThemeId: imported.interfaceThemeId,
      appMenuStyle: imported.appMenuStyle,
      interfaceDensity: imported.interfaceDensity,
      locale: imported.locale,
      localeChosen: imported.localeChosen,
      keyboardShortcuts: imported.keyboardShortcuts,
      gamepadBindings: imported.gamepadBindings,
      customBrushPresets: imported.customBrushPresets,
      customCropPresets: imported.customCropPresets,
      openFontLibrary: imported.openFontLibrary,
      licenseKey: imported.licenseKey,
    }).toEqual(expectedPortableState);
    expect(imported).toMatchObject({
      isSettingsOpen: true,
      settingsPanel: 'fonts',
    });
  });

  it('sanitizes hostile portable preference fields exactly like persisted settings hydration', async () => {
    const font = openFontLibraryFace();
    const hostile = {
      schemaVersion: 1,
      ...legacyBackupData(),
      defaultImageNodeModel: { provider: 'foreign-provider', modelId: ['not-a-string'] },
      appMenuStyle: 'floating',
      interfaceDensity: 'microscopic',
      locale: 'xx',
      localeChosen: 'yes',
      openFontLibrary: [font, { face: { source: { kind: 'open-catalog' } } }],
      isSettingsOpen: true,
      settingsPanel: 'license',
    };
    const merge = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.().merge;
    expect(merge).toBeTypeOf('function');
    const hydrated = merge?.(hostile, useSettingsStore.getState());

    const encrypted = await encryptSettingsBackup(JSON.stringify(hostile), PASSPHRASE);
    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'committed' });

    const imported = useSettingsStore.getState();
    expect({
      defaultImageNodeModel: imported.defaultImageNodeModel,
      appMenuStyle: imported.appMenuStyle,
      interfaceDensity: imported.interfaceDensity,
      locale: imported.locale,
      localeChosen: imported.localeChosen,
      openFontLibrary: imported.openFontLibrary,
    }).toEqual({
      defaultImageNodeModel: hydrated?.defaultImageNodeModel,
      appMenuStyle: hydrated?.appMenuStyle,
      interfaceDensity: hydrated?.interfaceDensity,
      locale: hydrated?.locale,
      localeChosen: hydrated?.localeChosen,
      openFontLibrary: hydrated?.openFontLibrary,
    });
    expect(imported).toMatchObject({
      defaultImageNodeModel: null,
      appMenuStyle: 'compact',
      interfaceDensity: 'compact',
      locale: 'en',
      localeChosen: false,
      openFontLibrary: [font],
      isSettingsOpen: false,
      settingsPanel: 'providers',
    });
  });

  it('imports a legacy schema-less backup without erasing preferences that older builds could not carry', async () => {
    const font = openFontLibraryFace();
    useSettingsStore.setState({
      defaultImageNodeModel: { provider: 'bfl', modelId: 'flux-2-pro' },
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      openFontLibrary: [font],
    });
    const encrypted = await encryptSettingsBackup(JSON.stringify(legacyBackupData()), PASSPHRASE);

    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'committed' });
    expect(useSettingsStore.getState()).toMatchObject({
      apiKeys: expect.objectContaining({ openai: 'legacy-openai-key' }),
      defaultImageNodeModel: { provider: 'bfl', modelId: 'flux-2-pro' },
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      openFontLibrary: [font],
    });
  });

  it('projects schema-less backups onto the legacy exporter core instead of applying newer fields', async () => {
    const font = openFontLibraryFace();
    useSettingsStore.setState({
      defaultImageNodeModel: { provider: 'bfl', modelId: 'flux-2-pro' },
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      openFontLibrary: [font],
    });
    const encrypted = await encryptSettingsBackup(JSON.stringify({
      ...legacyBackupData(),
      defaultImageNodeModel: null,
      appMenuStyle: 'compact',
      interfaceDensity: 'compact',
      locale: 'en',
      localeChosen: false,
      openFontLibrary: [],
      arbitraryFutureField: 'must not enter the merge',
    }), PASSPHRASE);

    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'committed' });
    expect(useSettingsStore.getState()).toMatchObject({
      apiKeys: expect.objectContaining({ openai: 'legacy-openai-key' }),
      defaultImageNodeModel: { provider: 'bfl', modelId: 'flux-2-pro' },
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      openFontLibrary: [font],
    });
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a primitive', JSON.stringify('not a settings object')],
    ['an incomplete current schema', JSON.stringify({ schemaVersion: 1, apiKeys: {} })],
    ['an unsupported current schema', JSON.stringify({ schemaVersion: 2 })],
  ])('rejects %s atomically without changing settings or identity', async (_label, plaintext) => {
    const font = openFontLibraryFace();
    useSettingsStore.setState({
      apiKeys: { ...useSettingsStore.getState().apiKeys, openai: 'keep-openai-key' },
      defaultImageNodeModel: { provider: 'atlas', modelId: 'keep-image-model' },
      interfaceThemeId: 'high-contrast',
      appMenuStyle: 'menubar',
      interfaceDensity: 'comfortable',
      locale: 'ja',
      localeChosen: true,
      keyboardShortcuts: { 'file:new': 'Ctrl+Shift+Alt+N' },
      openFontLibrary: [font],
      licenseKey: 'keep-license-identity',
      license: { licensed: true, email: 'buyer@example.test', edition: 'commercial' },
      isSettingsOpen: true,
      settingsPanel: 'fonts',
    });
    const before = portableStateSnapshot();
    const encrypted = await encryptSettingsBackup(plaintext, PASSPHRASE);

    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'failed', licensed: false });

    expect(portableStateSnapshot()).toEqual(before);
  });

  it('encrypts and restores dynamic provider packs, drafts, layouts, and exact-origin credentials', async () => {
    const pack = structuredClone(
      BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.credentialSlots.length > 0)!,
    );
    pack.packId = 'test.settings-backup.dynamic-provider';
    pack.displayName = 'Dynamic provider backup';
    const imported = await providerPackRegistry.importText(serializeProviderPack(pack).json, {
      provenance: 'local',
      sourceLabel: 'Settings backup regression',
      activate: false,
    });
    const slot = pack.credentialSlots[0];
    await providerPackRegistry.setCredential(pack.packId, slot.id, 'dynamic-provider-secret');
    await providerPackRegistry.saveDraft(`${pack.packId}:draft`, pack);
    await providerPackRegistry.savePersonalLayout({
      schemaVersion: 1,
      packId: pack.packId,
      packHash: imported.record.hash,
      cardId: pack.cards[0].id,
      override: {
        schemaVersion: 1,
        cardId: pack.cards[0].id,
        width: 650,
      },
      updatedAt: Date.now(),
    });

    const encrypted = await useSettingsStore.getState().exportSettingsBackup(PASSPHRASE);
    expect(encrypted).not.toContain('dynamic-provider-secret');
    const decrypted = JSON.parse(await decryptSettingsBackup(encrypted, PASSPHRASE)) as {
      providerPacks?: {
        packs: Array<{ pack: { packId: string } }>;
        drafts: Array<{ id: string }>;
        personalLayouts: Array<{ packId: string }>;
        credentials: Array<{ value: string; approvedOrigin: string }>;
      };
    };
    expect(decrypted.providerPacks?.packs.some((entry) => entry.pack.packId === pack.packId)).toBe(true);
    expect(decrypted.providerPacks?.drafts.some((entry) => entry.id === `${pack.packId}:draft`)).toBe(true);
    expect(decrypted.providerPacks?.personalLayouts.some((entry) => entry.packId === pack.packId)).toBe(true);
    expect(decrypted.providerPacks?.credentials).toContainEqual(expect.objectContaining({
      value: 'dynamic-provider-secret',
      approvedOrigin: slot.approvedOrigin,
    }));

    await providerPackRegistry.removeOverride(pack.packId, imported.record.hash);
    await expect(useSettingsStore.getState().importSettingsBackup(encrypted, PASSPHRASE))
      .resolves.toMatchObject({ status: 'committed' });
    expect(await providerPackRegistry.getCredential(pack.packId, slot.id, slot.approvedOrigin))
      .toBe('dynamic-provider-secret');

    const restored = providerPackRegistry.listRecords().find((record) => record.pack.packId === pack.packId);
    if (restored) await providerPackRegistry.removeOverride(pack.packId, restored.hash);
  });
});
