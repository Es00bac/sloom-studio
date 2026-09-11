import './test-setup-window';
import { describe, expect, it } from 'vitest';
import { resolveDefaultLocale } from '../lib/i18n';
import type { OpenFontLibraryFace } from '../lib/paperOpenFontCatalog';
import {
  getApiKeyStorageCaveat,
  getApiKeyStorageMedium,
  getApiKeyStorageStatus,
  isApiKeyStorageEncryptedAtRest,
  redactApiKeysForDiagnostics,
  redactApiKeysForExport,
  redactApiKeysForUi,
  sanitizePersistedApiKeys,
  subscribeSettingsLocaleIntent,
  useSettingsStore,
} from './settingsStore';

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

describe('settingsStore image provider settings', () => {
  it('classifies API key storage with plaintext local-storage backing and no encryption', () => {
    const storageMedium = getApiKeyStorageMedium();
    const caveat = getApiKeyStorageCaveat(storageMedium);
    const status = getApiKeyStorageStatus({
      openai: 'openai-key',
      gemini: '',
      huggingface: 'huggingface-key',
      elevenlabs: '',
      bfl: 'bfl-key',
      stability: '',
      atlas: '',
    });

    expect(storageMedium).toBe('local-storage');
    expect(caveat).toContain('without at-rest encryption');
    expect(isApiKeyStorageEncryptedAtRest()).toBe(false);
    expect(status.encryptedAtRest).toBe(false);
    expect(status.storageMedium).toBe(storageMedium);
    expect(status.browserStorageAvailable).toBe(true);
    expect(status.caveat).toContain('localStorage');
    expect(status.descriptors.openai.configured).toBe(true);
    expect(status.descriptors.openai.redacted).toBe('[redacted]');
    expect(status.descriptors.gemini.configured).toBe(false);
  });

  it('redacts API keys consistently for ui/export/diagnostics views', () => {
    const ui = redactApiKeysForUi({
      openai: 'openai-key',
      gemini: 'gemini-key',
      huggingface: '',
      elevenlabs: 'eleven-key',
      bfl: '',
      stability: 'stability-key',
      atlas: 'atlas-key',
    });

    const diagnostic = redactApiKeysForDiagnostics({
      openai: 'openai-key',
      gemini: 'gemini-key',
      huggingface: '',
      elevenlabs: 'eleven-key',
      bfl: '',
      stability: 'stability-key',
      atlas: 'atlas-key',
    });

    const exportPayload = redactApiKeysForExport({
      openai: 'openai-key',
      gemini: 'gemini-key',
      huggingface: '',
      elevenlabs: 'eleven-key',
      bfl: '',
      stability: 'stability-key',
      atlas: 'atlas-key',
    });

    expect(ui).toEqual(diagnostic);
    expect(ui).toEqual(exportPayload);
    expect(ui).toMatchObject({
      openai: '[redacted]',
      gemini: '[redacted]',
      huggingface: '',
      elevenlabs: '[redacted]',
      bfl: '',
      stability: '[redacted]',
      atlas: '[redacted]',
    });
  });

  it('keeps legacy and malformed apiKey persistence payloads from crashing merge', () => {
    const persistOptions = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.();
    expect(persistOptions).toBeDefined();
    expect(persistOptions?.merge).toBeDefined();

    if (!persistOptions?.merge) {
      throw new Error('settings store persist merge option missing');
    }

    const mockCurrentState = useSettingsStore.getState();
    const mergedState = persistOptions.merge(
      {
        apiKeys: {
          openai: 42,
          bfl: 'legacy-bfl',
          atlas: true as unknown as string,
          unknownProvider: 'ignored',
        },
      } as unknown as Partial<SettingsState>,
      mockCurrentState,
    );

    expect(mergedState.apiKeys.openai).toBe('');
    expect(mergedState.apiKeys.bfl).toBe('legacy-bfl');
    expect(mergedState.apiKeys.atlas).toBe('');
    expect(mergedState.apiKeys.byteplus).toBe('');
    expect(mergedState.apiKeys.gemini).toBe(mockCurrentState.apiKeys.gemini);

    const mergedFromNull = persistOptions.merge(
      { apiKeys: null as unknown as Partial<SettingsState> },
      mockCurrentState,
    );
    expect(mergedFromNull.apiKeys).toEqual(mockCurrentState.apiKeys);
  });

  it('normalizes persisted API key objects to expected key shape', () => {
    expect(sanitizePersistedApiKeys({
      openai: 'openai-key',
      byteplus: 'byteplus-key',
      gemini: 42,
      unknown: 'ignored',
      bfl: '',
    })).toEqual({
      openai: 'openai-key',
      gemini: '',
      huggingface: '',
      elevenlabs: '',
      bfl: '',
      stability: '',
      atlas: '',
      byteplus: 'byteplus-key',
    });

    expect(sanitizePersistedApiKeys('bad-api-state')).toEqual({
      openai: '',
      gemini: '',
      huggingface: '',
      elevenlabs: '',
      bfl: '',
      stability: '',
      atlas: '',
      byteplus: '',
    });
  });

  it('rehydrates only validated metadata-only open font records', () => {
    const merge = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.().merge;
    expect(merge).toBeTypeOf('function');
    const current = useSettingsStore.getState();
    const valid = openFontLibraryFace();

    const merged = merge?.({ openFontLibrary: [valid, { face: { source: { kind: 'open-catalog' } } }], settingsPanel: 'fonts' }, current);
    expect(merged?.openFontLibrary).toEqual([valid]);
    expect(merged?.settingsPanel).toBe('fonts');
  });

  it('removes only a managed-library reference so an existing document can keep its exact asset', () => {
    const original = useSettingsStore.getState().openFontLibrary;
    const face = openFontLibraryFace();
    useSettingsStore.setState({ openFontLibrary: [] });
    try {
      useSettingsStore.getState().addOpenFontLibraryFace(face);
      expect(useSettingsStore.getState().openFontLibrary).toEqual([face]);

      useSettingsStore.getState().removeOpenFontLibraryFace(face.face.fontAsset.sha256);
      expect(useSettingsStore.getState().openFontLibrary).toEqual([]);
    } finally {
      useSettingsStore.setState({ openFontLibrary: original });
    }
  });

  it('defaults advanced cloud and local image provider settings to safe empty values', () => {
    const state = useSettingsStore.getState();

    expect(state.apiKeys.bfl).toBe('');
    expect(state.apiKeys.stability).toBe('');
    expect(state.apiKeys.atlas).toBe('');
    expect(state.providerSettings.localOpenImageEndpointUrl).toBe('');
    expect(state.providerSettings.localOpenImageAuthHeader).toBe('');
    expect(state.providerSettings.localOpenImageDefaultModel).toBe('Qwen/Qwen-Image-Edit');
    expect(state.providerSettings.atlasBaseUrl).toBe('');
    expect(state.providerSettings.androidAcceleratorBaseUrl).toBe('');
    expect(state.providerSettings.androidAcceleratorAuthToken).toBe('');
    expect(state.providerSettings.androidAcceleratorDefaultUpscaler).toBe('upscaler_realistic');
    expect(state.providerSettings.androidAcceleratorDefaultImageModel).toBe('local-dream-active');
    expect(state.providerSettings.vertexAuthMode).toBe('gcloud-adc');
    expect(state.providerSettings.vertexQuotaProjectId).toBe('');
    expect(state.providerSettings.vertexEnvironmentVariables).toBe('');
    expect(state.providerSettings.paperPrintUpscaleMethod).toBe('auto');
    expect(state.providerSettings.paperPdfRasterPreset).toBe('balanced-jpeg');
    expect(state.providerSettings.localNativeRenderToken).toBe('');
    expect(state.providerSettings.batchMaxRetries).toBe(10);
    expect(state.providerSettings.batchRetryBaseDelayMs).toBe(30000);
  });

  it('stores BFL, Stability, Local/Open, Android accelerator, Vertex, and print-production provider settings through the existing setters', () => {
    const state = useSettingsStore.getState();

    state.setApiKey('bfl', 'bfl-key');
    state.setApiKey('stability', 'stability-key');
    state.setApiKey('atlas', 'atlas-key');
    state.setProviderSetting('localOpenImageEndpointUrl', 'https://example.test/image-edit');
    state.setProviderSetting('localOpenImageAuthHeader', 'Bearer local-token');
    state.setProviderSetting('atlasBaseUrl', 'https://api.atlas-cloud.ai');
    state.setProviderSetting('androidAcceleratorBaseUrl', 'http://192.168.1.42:8788');
    state.setProviderSetting('androidAcceleratorAuthToken', 'pair-token');
    state.setProviderSetting('androidAcceleratorDefaultUpscaler', 'upscaler_anime');
    state.setProviderSetting('androidAcceleratorDefaultImageModel', 'local-dream-sdxl');
    state.setProviderSetting('vertexAuthMode', 'gcloud-adc');
    state.setProviderSetting('vertexQuotaProjectId', 'billing-project');
    state.setProviderSetting('vertexEnvironmentVariables', 'GOOGLE_APPLICATION_CREDENTIALS=/secure/vertex.json');
    state.setProviderSetting('paperPrintUpscaleMethod', 'vertex-imagen');
    state.setProviderSetting('paperPdfRasterPreset', 'proof-jpeg');
    state.setProviderSetting('localNativeRenderToken', 'render-secret');
    state.setProviderSetting('batchMaxRetries', 5);
    state.setProviderSetting('batchRetryBaseDelayMs', 15000);

    expect(useSettingsStore.getState().apiKeys.bfl).toBe('bfl-key');
    expect(useSettingsStore.getState().apiKeys.stability).toBe('stability-key');
    expect(useSettingsStore.getState().apiKeys.atlas).toBe('atlas-key');
    expect(useSettingsStore.getState().providerSettings.localOpenImageEndpointUrl).toBe('https://example.test/image-edit');
    expect(useSettingsStore.getState().providerSettings.localOpenImageAuthHeader).toBe('Bearer local-token');
    expect(useSettingsStore.getState().providerSettings.atlasBaseUrl).toBe('https://api.atlas-cloud.ai');
    expect(useSettingsStore.getState().providerSettings.androidAcceleratorBaseUrl).toBe('http://192.168.1.42:8788');
    expect(useSettingsStore.getState().providerSettings.androidAcceleratorAuthToken).toBe('pair-token');
    expect(useSettingsStore.getState().providerSettings.androidAcceleratorDefaultUpscaler).toBe('upscaler_anime');
    expect(useSettingsStore.getState().providerSettings.androidAcceleratorDefaultImageModel).toBe('local-dream-sdxl');
    expect(useSettingsStore.getState().providerSettings.vertexAuthMode).toBe('gcloud-adc');
    expect(useSettingsStore.getState().providerSettings.vertexQuotaProjectId).toBe('billing-project');
    expect(useSettingsStore.getState().providerSettings.vertexEnvironmentVariables).toBe('GOOGLE_APPLICATION_CREDENTIALS=/secure/vertex.json');
    expect(useSettingsStore.getState().providerSettings.paperPrintUpscaleMethod).toBe('vertex-imagen');
    expect(useSettingsStore.getState().providerSettings.paperPdfRasterPreset).toBe('proof-jpeg');
    expect(useSettingsStore.getState().providerSettings.localNativeRenderToken).toBe('render-secret');
    expect(useSettingsStore.getState().providerSettings.batchMaxRetries).toBe(5);
    expect(useSettingsStore.getState().providerSettings.batchRetryBaseDelayMs).toBe(15000);
  });
  it('migrates legacy global Vertex location to us-central1 while preserving explicit regions', () => {
    const persistOptions = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.();
    expect(persistOptions).toBeDefined();
    expect(persistOptions?.merge).toBeDefined();

    if (!persistOptions?.merge) {
      throw new Error('settings store persist merge option missing');
    }

    const mockCurrentState = useSettingsStore.getState();

    // Case 1: Preserves us-central1 for Veo-capable Vertex routes
    const mergedState1 = persistOptions.merge(
      {
        providerSettings: {
          vertexLocation: 'us-central1',
        },
      },
      mockCurrentState
    );
    expect(mergedState1.providerSettings.vertexLocation).toBe('us-central1');

    // Case 2: Migrates legacy global to us-central1
    const mergedState2 = persistOptions.merge(
      {
        providerSettings: {
          vertexLocation: 'global',
        },
      },
      mockCurrentState
    );
    expect(mergedState2.providerSettings.vertexLocation).toBe('us-central1');

    // Case 3: Preserves other valid locations (e.g. europe-west9)
    const mergedState3 = persistOptions.merge(
      {
        providerSettings: {
          vertexLocation: 'europe-west9',
        },
      },
      mockCurrentState
    );
    expect(mergedState3.providerSettings.vertexLocation).toBe('europe-west9');
  });

  it('defaults vertexServiceAccountJson to an empty string', () => {
    expect(useSettingsStore.getState().providerSettings.vertexServiceAccountJson).toBe('');
  });

});

describe('settingsStore interface density', () => {
  it('defaults to compact and sanitizes the setter', () => {
    expect(useSettingsStore.getState().interfaceDensity).toBe('compact');

    useSettingsStore.getState().setInterfaceDensity('comfortable');
    expect(useSettingsStore.getState().interfaceDensity).toBe('comfortable');

    useSettingsStore.getState().setInterfaceDensity('bogus' as never);
    expect(useSettingsStore.getState().interfaceDensity).toBe('compact');
  });

  it('rehydrates only known density values through the persist merge', () => {
    const merge = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.().merge;
    expect(merge).toBeTypeOf('function');
    const current = useSettingsStore.getState();

    expect(merge?.({ interfaceDensity: 'comfortable' }, current)?.interfaceDensity).toBe('comfortable');
    expect(merge?.({ interfaceDensity: 'gigantic' }, current)?.interfaceDensity).toBe('compact');
    expect(merge?.({}, current)?.interfaceDensity).toBe('compact');
  });
});

describe('settingsStore interface language', () => {
  const fallback = resolveDefaultLocale();

  it('sanitizes the setter to a valid locale', () => {
    useSettingsStore.getState().setLocale('ja');
    expect(useSettingsStore.getState().locale).toBe('ja');

    useSettingsStore.getState().setLocale('en');
    expect(useSettingsStore.getState().locale).toBe('en');

    useSettingsStore.getState().setLocale('bogus' as never);
    expect(useSettingsStore.getState().locale).toBe(fallback);
  });

  it('publishes explicit locale actions but not authoritative direct-store adoption', () => {
    const intents: Array<{ locale: string; localeChosen: boolean }> = [];
    const unsubscribe = subscribeSettingsLocaleIntent((intent) => intents.push(intent));

    useSettingsStore.getState().setLocale('ja');
    useSettingsStore.setState({ locale: 'en', localeChosen: true });
    unsubscribe();

    expect(intents).toEqual([{ locale: 'ja', localeChosen: true }]);
  });

  it('rehydrates only known locales through the persist merge', () => {
    const merge = (useSettingsStore as PersistableSettingsStore).persist?.getOptions?.().merge;
    expect(merge).toBeTypeOf('function');
    const current = useSettingsStore.getState();

    expect(merge?.({ locale: 'ja' }, current)?.locale).toBe('ja');
    expect(merge?.({ locale: 'en' }, current)?.locale).toBe('en');
    expect(merge?.({ locale: 'klingon' }, current)?.locale).toBe(fallback);
    expect(merge?.({}, current)?.locale).toBe(fallback);
  });
});
