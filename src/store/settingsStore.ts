import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretEnvelope,
  isSecretEncryptionActive,
} from '../lib/secretCipher';
import {
  decryptSettingsBackup,
  encryptSettingsBackup,
  isSettingsBackupSupported,
} from '../lib/settingsBackup';
import { DEFAULT_INTERFACE_THEME_ID, resolveInterfaceTheme } from '../lib/interfaceThemes';
import { normalizeLocale, resolveDefaultLocale, type AppLocale } from '../lib/i18n';
/**
 * Sloom Studio (GPL) has no licence keys. The former commercial-licence verification is replaced
 * by a constant "everything is available" verdict; the surrounding persistence plumbing is kept
 * only so older encrypted settings backups still import cleanly. It can be removed later.
 */
export interface LicenseVerification {
  licensed: boolean;
  email?: string;
  edition?: string;
  issued?: string;
  reason?: string;
}
async function verifyLicenseKey(_key: string): Promise<LicenseVerification> {
  return { licensed: true, edition: 'GPL' };
}
import { sanitizeKeyboardShortcutMap, type KeyboardShortcutMap } from '../lib/keyboardShortcuts';
import {
  createCropPreset,
  renameCropPreset,
  sanitizeCropPresets,
  type CropCustomPreset,
} from '../components/ImageEditor/cropPresets';
import type { BrushSettings } from '../types/imageEditor';
import {
  createDefaultGamepadBindings,
  normalizeGamepadBindings,
  type GamepadBindingProfile,
  type GamepadControlBinding,
  type GamepadControlId,
  type GamepadWorkspace,
} from '../lib/gamepadBindings';
import { sanitizeProviderPackSettingsBackup } from '../lib/providerPackBackup';
import type { ProviderPackSettingsBackupV1 } from '../lib/providerPackContracts';
import { DEFAULT_MODELS, DEFAULT_PROVIDER_SETTINGS } from '../lib/providerCatalog';
import type { NativeMenuCommand } from '../lib/nativeApp';
import {
  createUserBrushPreset,
  renameUserBrushPreset,
  sanitizeUserBrushPresets,
  type ImageBrushPreset,
} from '../components/ImageEditor/ImageBrushPresets';
import {
  isOpenFontLibraryFace,
  type OpenFontLibraryFace,
} from '../lib/paperOpenFontCatalog';
import type {
  ApiKeys,
  DefaultModelSettings,
  ImageProvider,
  ProviderSettings,
} from '../types/flow';

/** The provider+model a new Image node starts on, when the user has pinned one as default. */
export interface DefaultImageNodeModel {
  provider: ImageProvider;
  modelId: string;
}

export const SETTINGS_BACKUP_DATA_SCHEMA_VERSION = 1 as const;

const API_KEY_PROVIDERS = ['openai', 'gemini', 'huggingface', 'elevenlabs', 'bfl', 'stability', 'atlas', 'byteplus'] as const;
type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];
type ApiKeyValueMap = Record<ApiKeyProvider, string>;
type ApiKeyStorageDescriptorMap = {
  [provider in ApiKeyProvider]: ApiKeyStorageDescriptor;
};

const API_KEY_REDACTION = '[redacted]';
const SETTINGS_STORAGE_KEY = 'flow-settings-storage';
const SETTINGS_RECORD_SUFFIX = ':record:';
const SETTINGS_CHANGE_TOKEN_SUFFIX = ':change-token';
const SETTINGS_LICENSE_CHANGE_TOKEN_SUFFIX = ':license-change-token';
const LOCAL_STORAGE_CAVEAT = 'API keys are stored in browser localStorage without at-rest encryption in this app.';
const MEMORY_ONLY_CAVEAT = 'API keys are currently not persisted to browser storage in this session.';
const ENCRYPTED_CAVEAT = 'API keys are encrypted at rest (the OS keychain on desktop, WebCrypto on web and mobile) and only decrypted in memory while the app is open.';

const API_KEY_REDACTED_LABEL: ApiKeyValueMap = {
  openai: API_KEY_REDACTION,
  gemini: API_KEY_REDACTION,
  huggingface: API_KEY_REDACTION,
  elevenlabs: API_KEY_REDACTION,
  bfl: API_KEY_REDACTION,
  stability: API_KEY_REDACTION,
  atlas: API_KEY_REDACTION,
  byteplus: API_KEY_REDACTION,
};

export type ApiKeyStorageMedium = 'local-storage' | 'memory-only';

export interface ApiKeyStorageDescriptor {
  provider: ApiKeyProvider;
  configured: boolean;
  redacted: string;
  storageMedium: ApiKeyStorageMedium;
  encryptedAtRest: boolean;
}

export interface ApiKeyStorageStatus {
  encryptedAtRest: boolean;
  storageMedium: ApiKeyStorageMedium;
  browserStorageAvailable: boolean;
  caveat: string;
  descriptors: ApiKeyStorageDescriptorMap;
}

export function isApiKeyStorageEncryptedAtRest(): boolean {
  return isSecretEncryptionActive();
}

export function getApiKeyStorageMedium(): ApiKeyStorageMedium {
  return hasBrowserLocalStorage() ? 'local-storage' : 'memory-only';
}

export function getApiKeyStorageCaveat(storageMedium: ApiKeyStorageMedium = getApiKeyStorageMedium()): string {
  if (storageMedium === 'memory-only') return MEMORY_ONLY_CAVEAT;
  return isSecretEncryptionActive() ? ENCRYPTED_CAVEAT : LOCAL_STORAGE_CAVEAT;
}

export function sanitizePersistedApiKeys(input: unknown): ApiKeys {
  const source = isRecord(input) ? input : {};
  const apiKeys: ApiKeys = {
    openai: '',
    gemini: '',
    huggingface: '',
    elevenlabs: '',
    bfl: '',
    stability: '',
    atlas: '',
    byteplus: '',
  };

  for (const provider of API_KEY_PROVIDERS) {
    const value = source[provider];
    if (typeof value === 'string') {
      apiKeys[provider] = value;
    }
  }

  return apiKeys;
}

export function redactApiKeysForUi(apiKeys: ApiKeys): ApiKeyValueMap {
  return buildRedactedApiKeys(apiKeys);
}

export function redactApiKeysForExport(apiKeys: ApiKeys): ApiKeyValueMap {
  return buildRedactedApiKeys(apiKeys);
}

export function redactApiKeysForDiagnostics(apiKeys: ApiKeys): ApiKeyValueMap {
  return buildRedactedApiKeys(apiKeys);
}

export function getApiKeyStorageStatus(apiKeys: ApiKeys): ApiKeyStorageStatus {
  const storageMedium = getApiKeyStorageMedium();
  const browserStorageAvailable = storageMedium === 'local-storage';
  const encryptedAtRest = isSecretEncryptionActive();
  const descriptors: ApiKeyStorageDescriptorMap = {} as ApiKeyStorageDescriptorMap;

  for (const provider of API_KEY_PROVIDERS) {
    const hasValue = Boolean(apiKeys[provider]?.trim());
    descriptors[provider] = {
      provider,
      configured: hasValue,
      redacted: hasValue ? API_KEY_REDACTION : '',
      storageMedium,
      encryptedAtRest,
    };
  }

  return {
    encryptedAtRest,
    storageMedium,
    browserStorageAvailable,
    caveat: getApiKeyStorageCaveat(storageMedium),
    descriptors,
  };
}

function hasBrowserLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwnField(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function sanitizeDefaultImageNodeModel(value: unknown): DefaultImageNodeModel | null {
  if (!isRecord(value) || typeof value.provider !== 'string' || typeof value.modelId !== 'string') {
    return null;
  }
  if (!hasOwnField(DEFAULT_MODELS.image, value.provider) || !value.modelId.trim()) {
    return null;
  }
  return {
    provider: value.provider as ImageProvider,
    modelId: value.modelId.trim(),
  };
}

function sanitizeAppMenuStyle(value: unknown): AppMenuStyle {
  return value === 'menubar' ? 'menubar' : 'compact';
}

function sanitizeInterfaceDensity(value: unknown): InterfaceDensity {
  return value === 'comfortable' ? 'comfortable' : 'compact';
}

function sanitizeLocaleChosen(value: unknown): boolean {
  return value === true;
}

function sanitizeOpenFontLibrary(value: unknown): OpenFontLibraryFace[] {
  return Array.isArray(value) ? value.filter(isOpenFontLibraryFace) : [];
}

interface SanitizedPortableEditorPreferences {
  defaultImageNodeModel: DefaultImageNodeModel | null;
  appMenuStyle: AppMenuStyle;
  interfaceDensity: InterfaceDensity;
  locale: AppLocale;
  localeChosen: boolean;
  openFontLibrary: OpenFontLibraryFace[];
}

/** Shared by persisted-profile hydration and portable backup import. */
function sanitizePortableEditorPreferences(input: unknown): SanitizedPortableEditorPreferences {
  const source = isRecord(input) ? input : {};
  return {
    defaultImageNodeModel: sanitizeDefaultImageNodeModel(source.defaultImageNodeModel),
    appMenuStyle: sanitizeAppMenuStyle(source.appMenuStyle),
    interfaceDensity: sanitizeInterfaceDensity(source.interfaceDensity),
    locale: normalizeLocale(source.locale),
    localeChosen: sanitizeLocaleChosen(source.localeChosen),
    openFontLibrary: sanitizeOpenFontLibrary(source.openFontLibrary),
  };
}

function buildRedactedApiKeys(apiKeys: ApiKeys): ApiKeyValueMap {
  const output: Partial<ApiKeyValueMap> = {};

  for (const provider of API_KEY_PROVIDERS) {
    output[provider] = apiKeys[provider]?.trim() ? API_KEY_REDACTION : '';
  }

  return {
    ...API_KEY_REDACTED_LABEL,
    ...output,
  };
}

/**
 * The user-meaningful slice of settings carried in an encrypted backup — everything worth restoring
 * after a reinstall/profile loss, including the bring-your-own-key API tokens and provider credentials.
 * Runtime-only UI flags, hydration state, actions, and the derived license verdict are excluded.
 */
export interface SettingsBackupData {
  schemaVersion: typeof SETTINGS_BACKUP_DATA_SCHEMA_VERSION;
  apiKeys: ApiKeys;
  defaultModels: DefaultModelSettings;
  defaultImageNodeModel: DefaultImageNodeModel | null;
  providerSettings: ProviderSettings;
  interfaceThemeId: string;
  appMenuStyle: AppMenuStyle;
  interfaceDensity: InterfaceDensity;
  locale: AppLocale;
  localeChosen: boolean;
  keyboardShortcuts: KeyboardShortcutMap;
  gamepadBindings: GamepadBindingProfile;
  customBrushPresets: ImageBrushPreset[];
  customCropPresets: CropCustomPreset[];
  openFontLibrary: OpenFontLibraryFace[];
  /** Commercial-license key; optional for backups created before licensing shipped. */
  licenseKey?: string;
  /** Optional because settings-backup schema v1 predates portable provider packs. */
  providerPacks?: ProviderPackSettingsBackupV1;
}

/** A caller may only present success when its own identity operation committed durable state. */
export type LicenseOperationOutcome = LicenseVerification & {
  status: 'committed' | 'superseded' | 'failed';
};

/** Desktop integrated app-menu presentation: a single ☰ button, or a classic horizontal menu bar. */
export type AppMenuStyle = 'compact' | 'menubar';

/**
 * UI density: 'compact' keeps today's tight layout; 'comfortable' raises the
 * smallest text sizes (sub-11px chips/labels) and lifts low-contrast secondary
 * text via root-scoped CSS (see index.css `.density-comfortable`).
 */
export type InterfaceDensity = 'compact' | 'comfortable';

interface SettingsState {
  apiKeys: ApiKeys;
  defaultModels: DefaultModelSettings;
  providerSettings: ProviderSettings;
  interfaceThemeId: string;
  /** Desktop integrated-menu presentation: 'compact' (single ☰) or 'menubar' (classic File/Edit/… row). */
  appMenuStyle: AppMenuStyle;
  interfaceDensity: InterfaceDensity;
  /** Interface language ('en' | 'ja'); drives `translate()` across the UI. */
  locale: AppLocale;
  /** True once the user has confirmed a language (first-run gate or Settings). Gates the first-run
   *  bilingual language chooser so it appears exactly once on a fresh install. */
  localeChosen: boolean;
  keyboardShortcuts: KeyboardShortcutMap;
  gamepadBindings: GamepadBindingProfile;
  customBrushPresets: ImageBrushPreset[];
  customCropPresets: CropCustomPreset[];
  /** Metadata-only records for locally downloaded open fonts; binary bytes remain in the Paper repository. */
  openFontLibrary: OpenFontLibraryFace[];
  /** Encrypt the declared portable preferences and credentials into a passphrase-locked backup blob. */
  exportSettingsBackup: (passphrase: string) => Promise<string>;
  /** Decrypt + restore a settings backup blob produced by exportSettingsBackup. */
  importSettingsBackup: (envelopeText: string, passphrase: string) => Promise<LicenseOperationOutcome>;
  settingsBackupSupported: boolean;
  setApiKey: (provider: keyof ApiKeys, key: string) => void;
  setDefaultModel: <
    TCategory extends keyof DefaultModelSettings,
    TProvider extends keyof DefaultModelSettings[TCategory],
  >(
    category: TCategory,
    provider: TProvider,
    value: string,
  ) => void;
  /** The provider+model new Image nodes start on (pinned via the node's "default" checkbox); null = built-in. */
  defaultImageNodeModel: DefaultImageNodeModel | null;
  setDefaultImageNodeModel: (value: DefaultImageNodeModel | null) => void;
  setProviderSetting: <TKey extends keyof ProviderSettings>(key: TKey, value: ProviderSettings[TKey]) => void;
  setInterfaceThemeId: (themeId: string) => void;
  setAppMenuStyle: (style: AppMenuStyle) => void;
  setInterfaceDensity: (density: InterfaceDensity) => void;
  setLocale: (locale: AppLocale) => void;
  setKeyboardShortcut: (command: NativeMenuCommand, shortcut: string) => void;
  resetKeyboardShortcuts: () => void;
  setGamepadBinding: (workspace: GamepadWorkspace, controlId: GamepadControlId, patch: Partial<GamepadControlBinding>) => void;
  resetGamepadBindings: () => void;
  saveCustomBrushPreset: (label: string, settings: Partial<BrushSettings>) => void;
  renameCustomBrushPreset: (id: string, label: string) => void;
  deleteCustomBrushPreset: (id: string) => void;
  setCustomBrushPresets: (presets: ImageBrushPreset[]) => void;
  saveCustomCropPreset: (label: string, ratio: number) => void;
  renameCustomCropPreset: (id: string, label: string) => void;
  deleteCustomCropPreset: (id: string) => void;
  addOpenFontLibraryFace: (entry: OpenFontLibraryFace) => void;
  /** Removes only the Settings collection reference. Existing documents remain the asset owner. */
  removeOpenFontLibraryFace: (fontAssetSha256: string) => void;
  isSettingsOpen: boolean;
  settingsPanel: 'providers' | 'keyboard' | 'gamepad' | 'fonts' | 'license';
  openSettings: (panel?: SettingsState['settingsPanel']) => void;
  toggleSettings: () => void;
  /** Raw commercial-license key string ('' = Community). Encrypted at rest with the settings blob. */
  licenseKey: string;
  /** Offline Ed25519 verification result for licenseKey; fail-closed {licensed:false} until revalidated. */
  license: LicenseVerification;
  /** Verify + store a pasted key. Invalid keys are NOT stored; the returned verification carries the reason. */
  setLicenseKey: (key: string) => Promise<LicenseOperationOutcome>;
  removeLicenseKey: () => LicenseOperationOutcome;
  /** Re-verify the persisted key (app boot; license is fail-closed after rehydration). */
  revalidateLicense: () => Promise<void>;
  /**
   * True once the persisted encrypted settings snapshot has finished its initial hydration — or
   * definitively failed to (missing storage, undecryptable foreign-profile envelope) — so
   * in-memory state is authoritative. Startup decisions that read persisted identity (the
   * commercial license above all) must wait for this instead of judging the pre-hydration
   * defaults.
   *
   * This is a one-shot initial latch by design: it stays true across later rehydrates (manual
   * persist.rehydrate(), cross-window license sync) and deliberately does not model
   * "rehydration in progress" — no caller needs that today. License consistency across later
   * rehydrates is owned by the generation-guarded canonical verification (revalidateLicense),
   * not by this flag; add separate state if a future caller needs in-progress visibility.
   */
  settingsHydrated: boolean;
}

export interface SettingsLocaleIntent {
  locale: AppLocale;
  localeChosen: boolean;
}

const settingsLocaleIntentListeners = new Set<(intent: SettingsLocaleIntent) => void>();

function publishSettingsLocaleIntent(intent: SettingsLocaleIntent): void {
  for (const listener of settingsLocaleIntentListeners) {
    try {
      listener({ ...intent });
    } catch {
      // A renderer integration listener cannot make a settings action fail.
    }
  }
}

/** Explicit user/import locale intents only. Hydration and native adoption do not emit here. */
export function subscribeSettingsLocaleIntent(
  listener: (intent: SettingsLocaleIntent) => void,
): () => void {
  settingsLocaleIntentListeners.add(listener);
  return () => settingsLocaleIntentListeners.delete(listener);
}

type PortableSettingsBackupField = keyof Omit<SettingsBackupData, 'schemaVersion' | 'providerPacks'>;

/**
 * The complete declared portable-settings schema. Export is generated from this inventory, so adding
 * a user-meaningful backup field to SettingsBackupData cannot silently leave it out of the encrypted
 * payload. Runtime-only panels, dialogs, hydration state, and the derived license verdict are absent
 * by construction.
 */
const PORTABLE_SETTINGS_BACKUP_SCHEMA = {
  apiKeys: true,
  defaultModels: true,
  defaultImageNodeModel: true,
  providerSettings: true,
  interfaceThemeId: true,
  appMenuStyle: true,
  interfaceDensity: true,
  locale: true,
  localeChosen: true,
  keyboardShortcuts: true,
  gamepadBindings: true,
  customBrushPresets: true,
  customCropPresets: true,
  openFontLibrary: true,
  licenseKey: true,
} as const satisfies Record<PortableSettingsBackupField, true>;

export const PORTABLE_SETTINGS_BACKUP_FIELDS = Object.freeze(
  Object.keys(PORTABLE_SETTINGS_BACKUP_SCHEMA) as PortableSettingsBackupField[],
);

const LEGACY_SETTINGS_BACKUP_FIELDS = Object.freeze([
  'apiKeys',
  'defaultModels',
  'providerSettings',
  'interfaceThemeId',
  'keyboardShortcuts',
  'gamepadBindings',
  'customBrushPresets',
  'customCropPresets',
] as const satisfies readonly PortableSettingsBackupField[]);

type ParsedSettingsBackupData =
  | { ok: true; data: Partial<SettingsBackupData> }
  | { ok: false; reason: string };

function parseSettingsBackupData(parsed: unknown): ParsedSettingsBackupData {
  if (!isPlainRecord(parsed)) {
    return { ok: false, reason: 'The backup contents must be a settings object.' };
  }

  if (hasOwnField(parsed, 'schemaVersion')) {
    if (parsed.schemaVersion !== SETTINGS_BACKUP_DATA_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'This backup uses an unsupported portable settings schema. Update Sloom Studio, then import again.',
      };
    }
    const missingField = PORTABLE_SETTINGS_BACKUP_FIELDS.find((field) => !hasOwnField(parsed, field));
    if (missingField) {
      return { ok: false, reason: `The settings backup is incomplete (missing ${missingField}).` };
    }
    if (hasOwnField(parsed, 'providerPacks')) {
      try {
        sanitizeProviderPackSettingsBackup(parsed.providerPacks);
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'Dynamic provider backup data is invalid.',
        };
      }
    }
  } else {
    // Version-0 exports predate the portable data-schema marker. They always carried this
    // complete core; the six preferences added by schema v1 remain absent and therefore keep
    // their current values during merge.
    const missingField = LEGACY_SETTINGS_BACKUP_FIELDS.find((field) => !hasOwnField(parsed, field));
    if (missingField) {
      return { ok: false, reason: `The legacy settings backup is incomplete (missing ${missingField}).` };
    }
    // Project a schema-less payload onto exactly what the legacy exporter could produce. An
    // untrusted or hand-edited payload must not smuggle schema-v1 preferences into the legacy
    // compatibility path and overwrite settings that a genuine old backup could never carry.
    const legacyData = Object.fromEntries(
      LEGACY_SETTINGS_BACKUP_FIELDS.map((field) => [field, parsed[field]]),
    ) as Partial<SettingsBackupData>;
    if (typeof parsed.licenseKey === 'string') {
      legacyData.licenseKey = parsed.licenseKey;
    }
    return { ok: true, data: legacyData };
  }

  return { ok: true, data: parsed as Partial<SettingsBackupData> };
}

function createSettingsBackupData(state: SettingsState): SettingsBackupData {
  const fields = Object.fromEntries(
    PORTABLE_SETTINGS_BACKUP_FIELDS.map((field) => [field, state[field]]),
  ) as Pick<SettingsBackupData, PortableSettingsBackupField>;
  return {
    schemaVersion: SETTINGS_BACKUP_DATA_SCHEMA_VERSION,
    ...fields,
  };
}

const INITIAL_API_KEYS: ApiKeys = {
  openai: '',
  gemini: '',
  huggingface: '',
  elevenlabs: '',
  bfl: '',
  stability: '',
  atlas: '',
};

/**
 * Persist storage that encrypts the serialized settings blob at rest (see secretCipher) and migrates
 * any pre-existing plaintext on first read. Decryption happens in memory during hydration; the value
 * on disk (localStorage) is opaque ciphertext.
 */
function createEncryptedSettingsStorage(): StateStorage {
  const backing = (): Storage | null => {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  const adapter: StateStorage = {
    getItem: async (name) => {
      const hydrationRead = takeNextHydrationRead();
      const plaintext = await readConvergedSettings(backing(), name, hydrationRead?.startRevision);
      recordHydrationSnapshotVersion(hydrationRead, plaintext);
      return plaintext;
    },
    setItem: (name, value) => {
      const broadcastAfterWrite = licenseSyncBroadcastArmed;
      licenseSyncBroadcastArmed = false;
      const write = pendingSettingsWrite.then(async () => {
        const didPersist = await writeConvergedSettings(backing(), name, value);
        if (broadcastAfterWrite && didPersist) postLicenseSyncBroadcast();
      });
      pendingSettingsWrite = write;
      return write;
    },
    removeItem: (name) => {
      try {
        backing()?.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
  settingsStorageAdapter = adapter;
  return adapter;
}

/**
 * Hydration latch (AUD-015): the encrypted settings storage above decrypts asynchronously, so the
 * store exists — with default state — before the persisted snapshot lands. This promise settles
 * exactly once, when persist finishes its hydration attempt (restored, empty, or failed), letting
 * license validation and other persisted-identity readers sequence themselves after it.
 */
let settingsHydrationSettled = false;
let resolveSettingsHydration: () => void = () => {};
const settingsHydrationPromise = new Promise<void>((resolve) => {
  resolveSettingsHydration = resolve;
});

/** Resolves once the persisted settings snapshot has hydrated (or definitively failed to). */
export function waitForSettingsHydration(): Promise<void> {
  return settingsHydrationPromise;
}

function markSettingsHydrated(): void {
  if (settingsHydrationSettled) {
    return;
  }
  settingsHydrationSettled = true;
  useSettingsStore.setState({ settingsHydrated: true });
  resolveSettingsHydration();
}

/** Serializes this renderer's writes. Other renderers meet only in per-record durable truth. */
let pendingSettingsWrite: Promise<void> = Promise.resolve();
let settingsStorageAdapter: StateStorage | null = null;
type PersistedEnvelope = { state?: Record<string, unknown>; version?: number } & Record<string, unknown>;
interface DurableSettingsRecord { clock: number; actor: string; value: unknown; tombstone?: boolean }

let lastObservedSettingsEnvelope: PersistedEnvelope | null = null;
let operationClock = 0;
const operationActor = (() => {
  const bytes = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `renderer-${bytes[0].toString(36)}${bytes[1].toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

function recordStoragePrefix(name: string, path: string): string {
  return `${name}${SETTINGS_RECORD_SUFFIX}${encodeURIComponent(path)}:`;
}

function recordStorageKey(name: string, path: string, record: DurableSettingsRecord): string {
  // The identity is part of the key, not a read/increment/write reservation. Simultaneous
  // renderers therefore append distinct immutable candidates even when both observed clock 10.
  return `${recordStoragePrefix(name, path)}${record.clock.toString(36)}.${encodeURIComponent(record.actor)}`;
}

function splitSettingsRecords(state: Record<string, unknown> | undefined): Record<string, unknown> {
  const records: Record<string, unknown> = {};
  if (!state) return records;
  for (const [key, value] of Object.entries(state)) {
    if (key === 'license' || key === 'settingsHydrated' || key === 'isSettingsOpen' || key === 'settingsPanel') continue;
    if ((key === 'apiKeys' || key === 'providerSettings' || key === 'defaultModels') && isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (key === 'defaultModels' && isRecord(nestedValue)) {
          for (const [modelProvider, modelValue] of Object.entries(nestedValue)) {
            records[`${key}.${nestedKey}.${modelProvider}`] = modelValue;
          }
        } else {
          records[`${key}.${nestedKey}`] = nestedValue;
        }
      }
    } else {
      records[key] = value;
    }
  }
  return records;
}

function applySettingsRecord(state: Record<string, unknown>, path: string, record: DurableSettingsRecord): void {
  const keys = path.split('.');
  let target: Record<string, unknown> = state;
  for (const key of keys.slice(0, -1)) {
    target[key] = isRecord(target[key]) ? { ...target[key] } : {};
    target = target[key] as Record<string, unknown>;
  }
  const key = keys[keys.length - 1];
  if (record.tombstone) delete target[key];
  else target[key] = record.value;
}

function compareOperations(a: DurableSettingsRecord, b: DurableSettingsRecord): number {
  return a.clock === b.clock ? a.actor.localeCompare(b.actor) : a.clock - b.clock;
}

function parseEnvelope(value: string | null): PersistedEnvelope | null {
  if (!value) return null;
  try { return JSON.parse(value) as PersistedEnvelope; } catch { return null; }
}

async function decryptEnvelope(raw: string | null): Promise<PersistedEnvelope | null> {
  if (!raw) return null;
  const plaintext = isEncryptedSecretEnvelope(raw) ? await decryptSecret(raw) : raw;
  return parseEnvelope(plaintext);
}

async function readDurableRecord(store: Storage, name: string, path: string): Promise<DurableSettingsRecord | null> {
  const prefix = recordStoragePrefix(name, path);
  let winner: DurableSettingsRecord | null = null;
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(prefix)) continue;
    const parsed = await decryptEnvelope(store.getItem(key));
    if (!parsed || !isRecord(parsed)) continue;
    const clock = parsed.clock;
    const actor = parsed.actor;
    if (typeof clock !== 'number' || !Number.isSafeInteger(clock) || clock < 0 || typeof actor !== 'string') continue;
    const candidate = parsed as unknown as DurableSettingsRecord;
    if (!winner || compareOperations(candidate, winner) > 0) winner = candidate;
  }
  return winner;
}

async function garbageCollectDurableRecords(store: Storage, name: string, path: string, winner: DurableSettingsRecord): Promise<void> {
  const prefix = recordStoragePrefix(name, path);
  const stale: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(prefix)) continue;
    const parsed = await decryptEnvelope(store.getItem(key));
    if (!parsed || !isRecord(parsed)) continue;
    const clock = parsed.clock;
    const actor = parsed.actor;
    if (typeof clock !== 'number' || typeof actor !== 'string') continue;
    if (compareOperations(parsed as unknown as DurableSettingsRecord, winner) < 0) stale.push(key);
  }
  for (const key of stale) store.removeItem(key);
}

async function readConvergedSettings(store: Storage | null, name: string, readStartRevision?: number): Promise<string | null> {
  if (!store) return lastObservedSettingsEnvelope ? JSON.stringify(lastObservedSettingsEnvelope) : null;
  let envelope: PersistedEnvelope | null;
  try { envelope = await decryptEnvelope(store.getItem(name)); } catch { return null; }
  if (!envelope) return null;
  // A mutation made by this renderer while its old ciphertext was decrypting already owns its
  // exact records. Let the merge's local guard retain it instead of awaiting those just-written
  // sidecars; a later poll/reload still replays them. Remote writers never satisfy this branch.
  if (readStartRevision !== undefined && localMutationRevision > readStartRevision) {
    lastObservedSettingsEnvelope = envelope;
    return JSON.stringify(envelope);
  }
  const state = isRecord(envelope.state) ? { ...envelope.state } : {};
  const paths = new Set(Object.keys(splitSettingsRecords(state)));
  for (const provider of API_KEY_PROVIDERS) paths.add(`apiKeys.${provider}`);
  for (const path of paths) {
    try {
      const record = await readDurableRecord(store, name, path);
      if (record) applySettingsRecord(state, path, record);
    } catch { /* a corrupt sidecar cannot erase the last valid encrypted profile */ }
  }
  const resolved = { ...envelope, state };
  lastObservedSettingsEnvelope = resolved;
  return JSON.stringify(resolved);
}

async function writeConvergedSettings(store: Storage | null, name: string, serialized: string): Promise<boolean> {
  const next = parseEnvelope(serialized);
  if (!next || !isRecord(next.state)) return false;
  const previous = lastObservedSettingsEnvelope;
  const before = splitSettingsRecords(previous?.state);
  const after = splitSettingsRecords(next.state);
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]));
  // Advance our local observation immediately. A later unrelated set must not reassert stale
  // complete-snapshot values merely because this write is still encrypting.
  lastObservedSettingsEnvelope = next;
  if (!store) return false;
  let didPersist = false;
  for (const path of paths) {
    try {
      const existing = await readDurableRecord(store, name, path);
      operationClock = Math.max(operationClock, existing?.clock ?? 0) + 1;
      const candidate: DurableSettingsRecord = {
        clock: operationClock,
        actor: operationActor,
        value: after[path],
        tombstone: !(path in after),
      };
      // Each record has its own key. A racing same-key writer is resolved by the Lamport clock
      // plus actor identity; after write, a loser restores the greater value rather than trusting
      // localStorage timing.
      store.setItem(recordStorageKey(name, path, candidate), await encryptSecret(JSON.stringify(candidate)));
      const winner = await readDurableRecord(store, name, path);
      if (winner) await garbageCollectDurableRecords(store, name, path, winner);
      didPersist = true;
    } catch { /* this record was not committed; the prior durable record remains authoritative */ }
  }
  try {
    // Cache only after sidecars. A crash here leaves the last committed encrypted profile valid;
    // on restart record tombstones/operations are replayed over it.
    const cache = await encryptSecret(JSON.stringify(next));
    store.setItem(name, cache);
    store.setItem(`${name}${SETTINGS_CHANGE_TOKEN_SUFFIX}`, `${operationClock}:${operationActor}`);
    if (paths.includes('licenseKey')) {
      store.setItem(`${name}${SETTINGS_LICENSE_CHANGE_TOKEN_SUFFIX}`, `${operationClock}:${operationActor}`);
    }
    didPersist = true;
  } catch { /* sidecars still carry all successfully committed mutations */ }
  return didPersist;
}

function persistResolvedSettingsState(): void {
  const state = useSettingsStore.getState();
  void settingsStorageAdapter?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

/**
 * Mutation-vs-hydration guard (AUD-015 residual): hydration reads + decrypts the persisted blob
 * asynchronously, so a (re)hydrate that started BEFORE a local mutation can still be holding the
 * old blob when the mutation lands. Zustand's own hydrationVersion only drops superseded
 * *rehydrates*; nothing stops a stale read from being merged over a newer local write. Each
 * top-level key therefore carries the revision of its latest local mutation, and every real
 * hydration captures the revision present when its read begins. Merge keeps only keys written
 * *after that specific read began*. This is deliberately not a global pending-marker drain: a
 * completed newer cross-window snapshot can replace a mutation that predates its read, while an
 * older in-flight read still cannot clobber a later local write.
 */
let localMutationRevision = 0;
interface LocalMutationMarker {
  revision: number;
  /** True until the write that contains this mutation reaches durable storage. */
  pendingWrite: boolean;
  /** Durable ordering claim for that write; absent for direct non-persisting setState calls. */
  writeVersion?: number;
}
const localMutationRevisionByKey = new Map<keyof SettingsState, LocalMutationMarker>();
const pendingLocalMutationWrite = new Map<keyof SettingsState, number>();

function recordLocalMutationKeys(partial: unknown, persists = false): void {
  if (!isRecord(partial)) {
    return;
  }
  const keys = Object.keys(partial);
  if (keys.length === 0) {
    return;
  }
  const revision = ++localMutationRevision;
  for (const key of keys) {
    const typedKey = key as keyof SettingsState;
    localMutationRevisionByKey.set(typedKey, { revision, pendingWrite: persists });
    if (persists) {
      pendingLocalMutationWrite.set(typedKey, revision);
    }
  }
}


/**
 * Wrap a zustand set function so every local mutation records the top-level keys it writes.
 * Function partials are evaluated through a pass-through so their result keys are recorded too.
 */
type SettingsSetState = {
  (
    partial:
      | SettingsState
      | Partial<SettingsState>
      | ((state: SettingsState) => SettingsState | Partial<SettingsState>),
    replace?: false,
  ): void;
  (state: SettingsState | ((state: SettingsState) => SettingsState), replace: true): void;
};

function trackLocalMutationWrites(set: SettingsSetState): SettingsSetState {
  return ((partial: unknown, replace?: boolean) => {
    if (typeof partial === 'function') {
      return set(((state: SettingsState) => {
        const result = (partial as (state: SettingsState) => SettingsState | Partial<SettingsState>)(state);
        recordLocalMutationKeys(result, true);
        return result;
      }) as never, replace as never);
    }
    recordLocalMutationKeys(partial, true);
    return set(partial as never, replace as never);
  }) as SettingsSetState;
}

/** True when the last applied hydration merge kept locally-mutated keys over the stale snapshot. */
let lastHydrationKeptLocalMutations = false;

/**
 * Armed by onRehydrateStorage at the start of every real hydration read. Only an armed merge
 * applies the mutation-vs-hydration keep-override; out-of-band merge invocations (unit tests,
 * tooling) retain plain sanitizing behavior. A read-start revision, rather than a global drain,
 * means an old local marker cannot override a durable snapshot that began later.
 */
interface HydrationRead {
  startRevision: number;
}

let activeHydrationRead: HydrationRead | null = null;
const queuedHydrationReads: HydrationRead[] = [];

function takeNextHydrationRead(): HydrationRead | undefined {
  return queuedHydrationReads.shift();
}

function recordHydrationSnapshotVersion(read: HydrationRead | undefined, value: string | null): void {
  // Reading replays per-key durable records over the encrypted cache. The argument is retained
  // for the storage adapter boundary and intentionally has no scalar snapshot generation.
  void read;
  void value;
}

/**
 * A snapshot owns a merge only while no later write is either committed or in progress. The
 * claim protects the gap while another renderer encrypts; failed claimants release themselves,
 * so an unavailable storage backend cannot poison reads indefinitely.
 */
function isHydrationSnapshotCurrent(store: Storage | null, name: string, read: HydrationRead | undefined): boolean {
  void store;
  void name;
  return Boolean(read);
}

/**
 * A write that this renderer started after the read is the one exception to rejecting an older
 * snapshot: the per-key merge guard will retain that local state, then persist the resolved
 * snapshot. A remote claim can never satisfy this check because it has no local marker.
 */
function localMutationOwnsLaterStorageGeneration(
  store: Storage | null,
  name: string,
  read: HydrationRead | undefined,
): boolean {
  void store;
  void name;
  void read;
  return false;
}

function localMutationsAfterReadStart(read: HydrationRead | null): Array<keyof SettingsState> {
  if (read === null) {
    return [];
  }
  return [...localMutationRevisionByKey]
    .filter(([, marker]) => marker.revision > read.startRevision)
    .map(([key]) => key);
}

/**
 * License-identity generation (AUD-015): verification is asynchronous, so every mutation of the
 * persisted license identity — key removal, activation, backup import, any applied rehydrate —
 * bumps this counter to invalidate whatever verification is still in flight. A verification may
 * only apply its verdict while both the generation and the key it captured are still current;
 * anything resolving later is discarded, so a stale positive can never fail open.
 */
let licenseVerificationGeneration = 0;

interface SettingsImportAttempt {
  attemptOrder: number;
  observedExternalIdentityGeneration: number;
}

// Invocation order is captured separately from valid-operation order. Rejected files never enter
// the latter, while two valid imports still resolve by invocation order even when decryption
// completes out of order.
let settingsImportAttemptOrder = 0;
let latestValidatedSettingsImportOrder = 0;
let externalLicenseIdentityGeneration = 0;

function beginSettingsImport(): SettingsImportAttempt {
  return {
    attemptOrder: ++settingsImportAttemptOrder,
    observedExternalIdentityGeneration: externalLicenseIdentityGeneration,
  };
}

function canClaimValidatedSettingsImport(attempt: SettingsImportAttempt): boolean {
  latestValidatedSettingsImportOrder = Math.max(
    latestValidatedSettingsImportOrder,
    attempt.attemptOrder,
  );
  return attempt.attemptOrder === latestValidatedSettingsImportOrder
    && attempt.observedExternalIdentityGeneration === externalLicenseIdentityGeneration;
}

/** The one in-flight canonical verification; concurrent triggers coalesce onto it instead of duplicating. */
let pendingLicenseVerification: { generation: number; key: string; promise: Promise<void> } | null = null;

function invalidatePendingLicenseVerification(): void {
  licenseVerificationGeneration += 1;
}

/** Claim a monotonic identity generation before an identity action can await anything. */
function claimLicenseIdentityGeneration(): number {
  invalidatePendingLicenseVerification();
  return licenseVerificationGeneration;
}

/**
 * Activation, removal, and applied rehydration are authorities outside settings-import ordering.
 * Track them separately so an earlier valid import's verifier generation cannot make a later-valid
 * import appear externally superseded merely because decryption completed out of order.
 */
function claimExternalLicenseIdentityGeneration(): number {
  externalLicenseIdentityGeneration += 1;
  return claimLicenseIdentityGeneration();
}

function isCurrentLicenseIdentityGeneration(generation: number): boolean {
  return generation === licenseVerificationGeneration;
}

/**
 * Cross-window license-identity sync (AUD-015): every renderer window runs its own store over the
 * shared encrypted settings blob, so a key removal/activation/import in one window must reach the
 * others. The mutating window arms a broadcast that the storage layer above posts only after the
 * persist write carrying the new identity has landed; receiving windows rehydrate, which
 * fail-closes `license` in merge and re-verifies through the canonical path. This is deliberately
 * scoped to license identity/rehydration — no other store state is synchronized here.
 */
const LICENSE_SYNC_CHANNEL_NAME = 'flow-license-identity-sync';
const LICENSE_SYNC_MESSAGE = 'license-identity-changed';
let licenseSyncBroadcastArmed = false;
let licenseSyncChannel: BroadcastChannel | null = null;

function getLicenseSyncChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!licenseSyncChannel) {
    try {
      licenseSyncChannel = new BroadcastChannel(LICENSE_SYNC_CHANNEL_NAME);
    } catch {
      // Opaque-origin or shutting-down contexts can refuse the channel; degrade to no sync.
      return null;
    }
    // Node exposes unref (test runs); browsers have no such member.
    (licenseSyncChannel as unknown as { unref?: () => void }).unref?.();
  }
  return licenseSyncChannel;
}

function armLicenseSyncBroadcast(): void {
  licenseSyncBroadcastArmed = true;
}

function postLicenseSyncBroadcast(): void {
  try {
    getLicenseSyncChannel()?.postMessage(LICENSE_SYNC_MESSAGE);
  } catch {
    /* channel closed / unavailable */
  }
}

/**
 * Subscribe this window to license-identity changes made by other windows (install once per
 * renderer, e.g. from the App shell). Returns the cleanup that detaches the listener.
 */
export function installLicenseCrossWindowSync(): () => void {
  const channel = getLicenseSyncChannel();
  let scheduled = false;
  const rehydrate = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void useSettingsStore.persist.rehydrate();
    });
  };
  const handleMessage = (event: MessageEvent) => {
    if (event.data !== LICENSE_SYNC_MESSAGE) {
      return;
    }
    rehydrate();
  };
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === `${SETTINGS_STORAGE_KEY}${SETTINGS_LICENSE_CHANGE_TOKEN_SUFFIX}`
      || event.key?.startsWith(recordStoragePrefix(SETTINGS_STORAGE_KEY, 'licenseKey'))
    ) rehydrate();
  };
  channel?.addEventListener('message', handleMessage);
  const eventWindow = window as unknown as {
    addEventListener?: (type: string, listener: (event: StorageEvent) => void) => void;
    removeEventListener?: (type: string, listener: (event: StorageEvent) => void) => void;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
  };
  eventWindow.addEventListener?.('storage', handleStorage);
  let lastLicenseChangeToken: string | null = null;
  try { lastLicenseChangeToken = window.localStorage.getItem(`${SETTINGS_STORAGE_KEY}${SETTINGS_LICENSE_CHANGE_TOKEN_SUFFIX}`); } catch { /* unavailable */ }
  const timer = (eventWindow.setInterval ?? setInterval)(() => {
    try {
      const next = window.localStorage.getItem(`${SETTINGS_STORAGE_KEY}${SETTINGS_LICENSE_CHANGE_TOKEN_SUFFIX}`);
      if (next !== lastLicenseChangeToken) {
        lastLicenseChangeToken = next;
        rehydrate();
      }
    } catch { /* unavailable storage remains fail-closed */ }
  }, 2_000);
  (timer as unknown as { unref?: () => void }).unref?.();
  return () => {
    channel?.removeEventListener('message', handleMessage);
    eventWindow.removeEventListener?.('storage', handleStorage);
    (eventWindow.clearInterval ?? clearInterval)(timer);
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (persistSet, get) => {
      // Every action-level mutation records the top-level keys it touches so the persist `merge`
      // below can protect them from stale in-flight hydration reads (mutation-vs-hydration guard).
      const set = trackLocalMutationWrites(persistSet);
      return ({
      apiKeys: INITIAL_API_KEYS,
      defaultModels: DEFAULT_MODELS,
      defaultImageNodeModel: null,
      providerSettings: {
        openaiBaseUrl: DEFAULT_PROVIDER_SETTINGS.openaiBaseUrl,
        atlasBaseUrl: DEFAULT_PROVIDER_SETTINGS.atlasBaseUrl,
        elevenlabsVoiceId: DEFAULT_PROVIDER_SETTINGS.elevenlabsVoiceId,
        renderBackendPreference: DEFAULT_PROVIDER_SETTINGS.renderBackendPreference,
        exportCompositorPreference: DEFAULT_PROVIDER_SETTINGS.exportCompositorPreference,
        localNativeRenderUrl: DEFAULT_PROVIDER_SETTINGS.localNativeRenderUrl,
        localNativeRenderToken: DEFAULT_PROVIDER_SETTINGS.localNativeRenderToken,
        backendProxyEnabled: DEFAULT_PROVIDER_SETTINGS.backendProxyEnabled,
        backendProxyBaseUrl: DEFAULT_PROVIDER_SETTINGS.backendProxyBaseUrl,
        geminiCredentialMode: DEFAULT_PROVIDER_SETTINGS.geminiCredentialMode,
        vertexAuthMode: DEFAULT_PROVIDER_SETTINGS.vertexAuthMode,
        vertexProjectId: DEFAULT_PROVIDER_SETTINGS.vertexProjectId,
        vertexLocation: DEFAULT_PROVIDER_SETTINGS.vertexLocation,
        vertexQuotaProjectId: DEFAULT_PROVIDER_SETTINGS.vertexQuotaProjectId,
        vertexEnvironmentVariables: DEFAULT_PROVIDER_SETTINGS.vertexEnvironmentVariables,
        vertexServiceAccountJson: DEFAULT_PROVIDER_SETTINGS.vertexServiceAccountJson,
        paperPrintUpscaleMethod: DEFAULT_PROVIDER_SETTINGS.paperPrintUpscaleMethod,
        paperPdfRasterPreset: DEFAULT_PROVIDER_SETTINGS.paperPdfRasterPreset,
        localOpenImageEndpointUrl: DEFAULT_PROVIDER_SETTINGS.localOpenImageEndpointUrl,
        localOpenImageAuthHeader: DEFAULT_PROVIDER_SETTINGS.localOpenImageAuthHeader,
        localOpenImageDefaultModel: DEFAULT_PROVIDER_SETTINGS.localOpenImageDefaultModel,
        genericImageEndpointUrl: DEFAULT_PROVIDER_SETTINGS.genericImageEndpointUrl,
        genericImageAuthHeader: DEFAULT_PROVIDER_SETTINGS.genericImageAuthHeader,
        localAiCpuEndpointUrl: DEFAULT_PROVIDER_SETTINGS.localAiCpuEndpointUrl,
        localAiCpuAuthHeader: DEFAULT_PROVIDER_SETTINGS.localAiCpuAuthHeader,
        localAiCpuModel: DEFAULT_PROVIDER_SETTINGS.localAiCpuModel,
        androidAcceleratorBaseUrl: DEFAULT_PROVIDER_SETTINGS.androidAcceleratorBaseUrl,
        androidAcceleratorAuthToken: DEFAULT_PROVIDER_SETTINGS.androidAcceleratorAuthToken,
        androidAcceleratorDefaultUpscaler: DEFAULT_PROVIDER_SETTINGS.androidAcceleratorDefaultUpscaler,
        androidAcceleratorDefaultImageModel: DEFAULT_PROVIDER_SETTINGS.androidAcceleratorDefaultImageModel,
        batchMaxRetries: DEFAULT_PROVIDER_SETTINGS.batchMaxRetries,
        batchRetryBaseDelayMs: DEFAULT_PROVIDER_SETTINGS.batchRetryBaseDelayMs,
        androidLanServerEnabled: DEFAULT_PROVIDER_SETTINGS.androidLanServerEnabled,
        androidLanServerPin: DEFAULT_PROVIDER_SETTINGS.androidLanServerPin,
      },
      interfaceThemeId: DEFAULT_INTERFACE_THEME_ID,
      appMenuStyle: 'compact',
      interfaceDensity: 'compact',
      locale: resolveDefaultLocale(),
      localeChosen: false,
      keyboardShortcuts: {},
      gamepadBindings: createDefaultGamepadBindings(),
      customBrushPresets: [],
      customCropPresets: [],
      openFontLibrary: [],
      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key },
        })),
      setDefaultModel: (category, provider, value) =>
        set((state) => ({
          defaultModels: {
            ...state.defaultModels,
            [category]: {
              ...state.defaultModels[category],
              [provider]: value,
            },
          },
        })),
      setDefaultImageNodeModel: (value) => set({ defaultImageNodeModel: value }),
      setProviderSetting: (key, value) =>
        set((state) => ({
          providerSettings: {
            ...state.providerSettings,
            [key]: value,
          },
        })),
      setInterfaceThemeId: (themeId) =>
        set({ interfaceThemeId: resolveInterfaceTheme(themeId).id }),
      setAppMenuStyle: (style) =>
        set({ appMenuStyle: style === 'menubar' ? 'menubar' : 'compact' }),
      setInterfaceDensity: (density) =>
        set({ interfaceDensity: density === 'comfortable' ? 'comfortable' : 'compact' }),
      setLocale: (locale) => {
        const intent = { locale: normalizeLocale(locale), localeChosen: true };
        set(intent);
        publishSettingsLocaleIntent(intent);
      },
      setKeyboardShortcut: (command, shortcut) =>
        set((state) => ({
          keyboardShortcuts: sanitizeKeyboardShortcutMap({
            ...state.keyboardShortcuts,
            [command]: shortcut,
          }),
        })),
      resetKeyboardShortcuts: () => set({ keyboardShortcuts: {} }),
      setGamepadBinding: (workspace, controlId, patch) =>
        set((state) => {
          const bindings = normalizeGamepadBindings(state.gamepadBindings);
          bindings[workspace][controlId] = {
            ...bindings[workspace][controlId],
            ...patch,
          };
          return { gamepadBindings: normalizeGamepadBindings(bindings) };
        }),
      resetGamepadBindings: () => set({ gamepadBindings: createDefaultGamepadBindings() }),
      saveCustomBrushPreset: (label, settings) =>
        set((state) => ({
          customBrushPresets: [
            ...state.customBrushPresets,
            createUserBrushPreset(
              label,
              settings,
              [
                ...IMAGE_BUILT_IN_BRUSH_IDS,
                ...state.customBrushPresets.map((preset) => preset.id),
              ],
            ),
          ],
        })),
      renameCustomBrushPreset: (id, label) =>
        set((state) => ({
          customBrushPresets: state.customBrushPresets.map((preset) =>
            preset.id === id ? renameUserBrushPreset(preset, label) : preset),
        })),
      deleteCustomBrushPreset: (id) =>
        set((state) => ({
          customBrushPresets: state.customBrushPresets.filter((preset) => preset.id !== id),
        })),
      setCustomBrushPresets: (presets) =>
        set(() => ({
          customBrushPresets: sanitizeUserBrushPresets(presets),
        })),
      saveCustomCropPreset: (label, ratio) =>
        set((state) => ({
          customCropPresets: [
            ...state.customCropPresets,
            createCropPreset(label, ratio, state.customCropPresets.map((preset) => preset.id)),
          ],
        })),
      renameCustomCropPreset: (id, label) =>
        set((state) => ({
          customCropPresets: state.customCropPresets.map((preset) =>
            preset.id === id ? renameCropPreset(preset, label) : preset),
        })),
      deleteCustomCropPreset: (id) =>
        set((state) => ({
          customCropPresets: state.customCropPresets.filter((preset) => preset.id !== id),
        })),
      addOpenFontLibraryFace: (entry) =>
        set((state) => ({
          openFontLibrary: [
            ...state.openFontLibrary.filter((current) => current.face.fontAsset.sha256 !== entry.face.fontAsset.sha256),
            entry,
          ],
        })),
      removeOpenFontLibraryFace: (fontAssetSha256) =>
        set((state) => ({
          openFontLibrary: state.openFontLibrary.filter((entry) => entry.face.fontAsset.sha256 !== fontAssetSha256),
        })),
      exportSettingsBackup: async (passphrase) => {
        const { providerPackRegistry } = await import('../lib/providerPackRegistry');
        const providerPacks = await providerPackRegistry.exportSettingsBackup();
        const data: SettingsBackupData = {
          ...createSettingsBackupData(get()),
          ...(providerPacks ? { providerPacks } : {}),
        };
        return encryptSettingsBackup(JSON.stringify(data), passphrase);
      },
      importSettingsBackup: async (envelopeText, passphrase) => {
        // Capture invocation order without touching valid-operation order or license identity.
        // A later valid identity action/import can supersede this attempt while it decrypts, but
        // an invalid file cannot cancel a valid import, activation, or verifier merely by selection.
        const attempt = beginSettingsImport();
        let plaintext: string;
        try {
          plaintext = await decryptSettingsBackup(envelopeText, passphrase);
        } catch (error) {
          return { licensed: false, status: 'failed', reason: error instanceof Error ? error.message : 'The backup could not be decrypted.' };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(plaintext);
        } catch {
          // Decryption succeeded but the payload wasn't JSON — a corrupted or tampered backup.
          return { licensed: false, status: 'failed', reason: 'The backup contents were unreadable.' };
        }
        const parsedData = parseSettingsBackupData(parsed);
        if (!parsedData.ok) {
          return { licensed: false, status: 'failed', reason: parsedData.reason };
        }
        const data = parsedData.data;
        // The imported payload owns the license identity now: invalidate in-flight verification,
        // apply fail-closed, then settle entitlement through the one canonical verification.
        // Callers get a deterministic postcondition — when this resolves, `license` reflects the
        // verifier's verdict on the imported key. Other windows learn through the broadcast.
        if (!canClaimValidatedSettingsImport(attempt)) {
          return { licensed: false, status: 'superseded', reason: 'A newer settings operation superseded this import.' };
        }
        // This check and claim are synchronous, so no identity action can interleave between
        // observing ownership and taking the generation that guards set + revalidation.
        const generation = claimLicenseIdentityGeneration();
        armLicenseSyncBroadcast();
        set((current) => mergeSettingsBackupData(current, data));
        if (data.providerPacks) {
          const { providerPackRegistry } = await import('../lib/providerPackRegistry');
          await providerPackRegistry.importSettingsBackup(data.providerPacks);
        }
        if (hasOwnField(data, 'locale') || hasOwnField(data, 'localeChosen')) {
          publishSettingsLocaleIntent({ locale: get().locale, localeChosen: get().localeChosen });
        }
        await get().revalidateLicense();
        if (!isCurrentLicenseIdentityGeneration(generation)) {
          return { licensed: false, status: 'superseded', reason: 'A newer settings operation superseded this import.' };
        }
        return { ...get().license, status: 'committed' };
      },
      settingsBackupSupported: isSettingsBackupSupported(),
      isSettingsOpen: false,
      settingsPanel: 'providers',
      openSettings: (panel = 'providers') => set({ isSettingsOpen: true, settingsPanel: panel }),
      toggleSettings: () =>
        set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
      licenseKey: '',
      license: { licensed: true, edition: 'GPL' },
      settingsHydrated: false,
      setLicenseKey: async (key) => {
        // Claim before verification starts. A later removal/import/rehydrate must be able to
        // invalidate this activation while its verifier is still pending.
        const generation = claimExternalLicenseIdentityGeneration();
        const verification = await verifyLicenseKey(key);
        if (verification.licensed && isCurrentLicenseIdentityGeneration(generation)) {
          // This verifier-backed activation still owns the identity. Rejected activations and
          // superseded activations never write either key or verdict into newer state.
          armLicenseSyncBroadcast();
          set({ licenseKey: key.trim(), license: verification });
          return { ...verification, status: 'committed' };
        }
        if (!isCurrentLicenseIdentityGeneration(generation)) {
          return { ...verification, status: 'superseded', reason: 'A newer license operation superseded this activation.' };
        }
        return { ...verification, status: 'failed' };
      },
      removeLicenseKey: () => {
        // Removal fail-closes immediately and invalidates whatever verification is still in
        // flight — a stale positive verdict for the removed key must never resurrect the grant.
        claimExternalLicenseIdentityGeneration();
        armLicenseSyncBroadcast();
        set({ licenseKey: '', license: { licensed: false } });
        return { licensed: false, status: 'committed' };
      },
      revalidateLicense: async () => {
        // AUD-015: encrypted hydration is asynchronous, so a boot-time call can observe the
        // default empty key. Judge the license only against the hydrated snapshot.
        await waitForSettingsHydration();
        const generation = licenseVerificationGeneration;
        const storedKey = get().licenseKey;
        if (
          pendingLicenseVerification
          && pendingLicenseVerification.generation === generation
          && pendingLicenseVerification.key === storedKey
        ) {
          // The identical verification is already in flight — join it instead of duplicating it.
          return pendingLicenseVerification.promise;
        }
        const verification = (async () => {
          // Fail closed for the whole verification window: the commercial gates read this
          // boolean directly and must never trust a verdict that predates the current key.
          if (get().license.licensed) {
            set({ license: { licensed: false } });
          }
          if (!storedKey) {
            return;
          }
          let verdict: LicenseVerification;
          try {
            verdict = await verifyLicenseKey(storedKey);
          } catch {
            // verifyLicenseKey is itself fail-closed, but the store must not depend on that
            // contract: a rejection still resolves this promise, still fail-closed.
            verdict = { licensed: false, reason: 'License verification failed.' };
          }
          if (generation !== licenseVerificationGeneration || get().licenseKey !== storedKey) {
            // A newer identity event (removal, activation, import, rehydrate) owns the state
            // now; applying this verdict would attach it to a key it never verified.
            return;
          }
          set({ license: verdict });
        })();
        pendingLicenseVerification = { generation, key: storedKey, promise: verification };
        try {
          await verification;
        } finally {
          if (pendingLicenseVerification?.promise === verification) {
            pendingLicenseVerification = null;
          }
        }
      },
      });
    },
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => createEncryptedSettingsStorage()),
      // Fires after every hydration attempt — restored, empty, or errored — including manual
      // rehydrate() calls; the latch itself only settles once. Every completed rehydrate then
      // re-verifies the (fail-closed) license exactly once through the canonical path: a
      // key-change subscription cannot do this job, because a same-key rehydrate also resets
      // `license` without ever changing the key string.
      onRehydrateStorage: () => {
        // A real hydration read starts now; its merge may apply a blob captured before local
        // mutations landed, so the mutation-vs-hydration guard records this read's start
        // revision. Zustand applies only its latest rehydrate, and therefore only this latest
        // captured revision can pair with merge.
        const read: HydrationRead = {
          startRevision: localMutationRevision,
        };
        activeHydrationRead = read;
        queuedHydrationReads.push(read);
        return (_hydratedState: SettingsState | undefined) => {
          // Read failures skip merge. Do not leave a stale arm for an out-of-band merge after
          // that failure; a later real hydration will capture a new start revision.
          if (activeHydrationRead === read) {
            activeHydrationRead = null;
          }
          markSettingsHydrated();
          if (lastHydrationKeptLocalMutations) {
            lastHydrationKeptLocalMutations = false;
            // The merge kept locally-mutated keys at their newer values, so memory is now
            // ahead of what the mutating writes persisted (they captured pre-hydration state).
            // Enqueue one write of the resolved state — on the same serialized write chain — so
            // storage converges on the newer local mutation instead of the stale snapshot.
            persistResolvedSettingsState();
          }
          // Let an already-resolved verifier clear its in-flight slot before a same-key
          // rehydrate asks for the canonical fresh verdict.
          queueMicrotask(() => void useSettingsStore.getState().revalidateLicense());
        };
      },
      merge: (persistedState, currentState) => {
        const hydrationRead = activeHydrationRead;
        // The final ownership check is intentionally adjacent to the merge. A snapshot can be
        // read/decrypted long before this callback runs; if another renderer committed (or is
        // still claiming) a later storage generation, returning that snapshot would let Zustand
        // immediately persist it as a brand-new write and resurrect removed secrets.
        if (
          hydrationRead
          && !isHydrationSnapshotCurrent(
            typeof window !== 'undefined' ? window.localStorage : null,
            SETTINGS_STORAGE_KEY,
            hydrationRead,
          )
          && !localMutationOwnsLaterStorageGeneration(
            typeof window !== 'undefined' ? window.localStorage : null,
            SETTINGS_STORAGE_KEY,
            hydrationRead,
          )
        ) {
          activeHydrationRead = null;
          lastHydrationKeptLocalMutations = false;
          return currentState;
        }
        // Every applied rehydrate replaces the license identity and fail-closes `license` below,
        // so whatever verification was in flight before it is stale by definition.
        claimExternalLicenseIdentityGeneration();
        // Mutation-vs-hydration guard: this read may have started before local mutations landed,
        // making its blob stale for exactly the keys those mutations wrote. Everything else in
        // the snapshot is still the newest durable fact and applies normally.
        const locallyMutatedKeys = localMutationsAfterReadStart(hydrationRead);
        activeHydrationRead = null;
        const typedPersistedState = persistedState as Partial<SettingsState> | undefined;
        const persistedApiKeys = sanitizePersistedApiKeys(typedPersistedState?.apiKeys);
        const portablePreferences = sanitizePortableEditorPreferences(typedPersistedState);

        let genericImageEndpointUrl = typedPersistedState?.providerSettings?.genericImageEndpointUrl;
        let genericImageAuthHeader = typedPersistedState?.providerSettings?.genericImageAuthHeader;
        let localOpenImageEndpointUrl = typedPersistedState?.providerSettings?.localOpenImageEndpointUrl;
        let localOpenImageAuthHeader = typedPersistedState?.providerSettings?.localOpenImageAuthHeader;

        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            const legacyEndpoint = window.localStorage.getItem('image-editor-generic-endpoint');
            const legacyAuth = window.localStorage.getItem('image-editor-generic-auth');

            if (legacyEndpoint) {
              if (!genericImageEndpointUrl) {
                genericImageEndpointUrl = legacyEndpoint;
              }
              if (!localOpenImageEndpointUrl) {
                localOpenImageEndpointUrl = legacyEndpoint;
              }
              window.localStorage.removeItem('image-editor-generic-endpoint');
            }

            if (legacyAuth) {
              if (!genericImageAuthHeader) {
                genericImageAuthHeader = legacyAuth;
              }
              if (!localOpenImageAuthHeader) {
                localOpenImageAuthHeader = legacyAuth;
              }
              window.localStorage.removeItem('image-editor-generic-auth');
            }
          } catch (e) {
            console.error('Failed to migrate image editor fallback settings from localStorage', e);
          }
        }

        const mergedState: SettingsState = {
          ...currentState,
          ...typedPersistedState,
          apiKeys: {
            ...currentState.apiKeys,
            ...persistedApiKeys,
          },
          defaultModels: {
            text: {
              ...currentState.defaultModels.text,
              ...typedPersistedState?.defaultModels?.text,
            },
            image: {
              ...currentState.defaultModels.image,
              ...typedPersistedState?.defaultModels?.image,
            },
            video: {
              ...currentState.defaultModels.video,
              ...typedPersistedState?.defaultModels?.video,
            },
            audio: {
              ...currentState.defaultModels.audio,
              ...typedPersistedState?.defaultModels?.audio,
            },
          },
          providerSettings: {
            ...currentState.providerSettings,
            ...typedPersistedState?.providerSettings,
            ...(typedPersistedState?.providerSettings?.vertexLocation === 'global'
              ? { vertexLocation: 'us-central1' }
              : {}),
            ...(genericImageEndpointUrl ? { genericImageEndpointUrl } : {}),
            ...(genericImageAuthHeader ? { genericImageAuthHeader } : {}),
            ...(localOpenImageEndpointUrl ? { localOpenImageEndpointUrl } : {}),
            ...(localOpenImageAuthHeader ? { localOpenImageAuthHeader } : {}),
          },
          defaultImageNodeModel: portablePreferences.defaultImageNodeModel,
          interfaceThemeId: resolveInterfaceTheme(typedPersistedState?.interfaceThemeId).id,
          appMenuStyle: portablePreferences.appMenuStyle,
          interfaceDensity: portablePreferences.interfaceDensity,
          locale: portablePreferences.locale,
          localeChosen: portablePreferences.localeChosen,
          keyboardShortcuts: sanitizeKeyboardShortcutMap(typedPersistedState?.keyboardShortcuts ?? {}),
          gamepadBindings: normalizeGamepadBindings(typedPersistedState?.gamepadBindings),
          customBrushPresets: sanitizeUserBrushPresets(typedPersistedState?.customBrushPresets),
          customCropPresets: sanitizeCropPresets(typedPersistedState?.customCropPresets),
          openFontLibrary: portablePreferences.openFontLibrary,
          settingsPanel: typedPersistedState?.settingsPanel === 'keyboard'
            || typedPersistedState?.settingsPanel === 'gamepad'
            || typedPersistedState?.settingsPanel === 'fonts'
            || typedPersistedState?.settingsPanel === 'license'
            ? typedPersistedState.settingsPanel
            : 'providers',
          licenseKey: typeof typedPersistedState?.licenseKey === 'string' ? typedPersistedState.licenseKey : '',
          // Fail-closed: never trust a persisted verification result. App boot calls
          // revalidateLicense(), which re-verifies the stored key offline in milliseconds.
          license: { licensed: false },
          // merge only runs while hydration data is being applied; never let a stale persisted
          // copy of this session flag claim otherwise.
          settingsHydrated: true,
        };

        // Locally-mutated keys win over the stale read. The two machinery-owned fields are
        // excluded: `license` is a derived verdict that merge always fail-closes and the
        // post-rehydrate hook re-verifies, and `settingsHydrated` is the hydration latch itself.
        let keptLocalMutations = false;
        if (locallyMutatedKeys.length > 0) {
          const mergedRecord = mergedState as unknown as Record<string, unknown>;
          const currentRecord = currentState as unknown as Record<string, unknown>;
          for (const key of locallyMutatedKeys) {
            if (key === 'license' || key === 'settingsHydrated' || !(key in mergedRecord)) {
              continue;
            }
            mergedRecord[key] = currentRecord[key];
            keptLocalMutations = true;
          }
        }
        lastHydrationKeptLocalMutations = keptLocalMutations;

        return mergedState;
      },
    },
  ),
);

// Direct api.setState writes bypass the creator's tracked set; record their top-level keys too so
// the mutation-vs-hydration guard covers every local mutation path, not only store actions.
const untrackedSetState = useSettingsStore.setState;
useSettingsStore.setState = ((partial: unknown, replace?: boolean) => {
  if (typeof partial === 'function') {
    return untrackedSetState(((state: SettingsState) => {
      const result = (partial as (state: SettingsState) => Partial<SettingsState>)(state);
      recordLocalMutationKeys(result);
      return result;
    }) as never, replace as never);
  }
  recordLocalMutationKeys(partial);
  return untrackedSetState(partial as never, replace as never);
}) as typeof untrackedSetState;

/**
 * Sanitize + merge a decrypted settings-backup payload onto the current state. Mirrors the persist
 * `merge` config so an imported backup is validated exactly like a rehydrated profile: unknown
 * providers/shortcuts/presets are dropped, the theme falls back to a known one, and credentials layer
 * over the current values rather than wiping them.
 */
function mergeSettingsBackupData(
  current: SettingsState,
  data: Partial<SettingsBackupData>,
): Partial<SettingsState> {
  const portablePreferences = sanitizePortableEditorPreferences(data);
  return {
    apiKeys: {
      ...current.apiKeys,
      ...sanitizePersistedApiKeys(data.apiKeys),
    },
    defaultModels: {
      text: { ...current.defaultModels.text, ...data.defaultModels?.text },
      image: { ...current.defaultModels.image, ...data.defaultModels?.image },
      video: { ...current.defaultModels.video, ...data.defaultModels?.video },
      audio: { ...current.defaultModels.audio, ...data.defaultModels?.audio },
    },
    providerSettings: {
      ...current.providerSettings,
      ...(isRecord(data.providerSettings) ? data.providerSettings : {}),
    },
    interfaceThemeId: resolveInterfaceTheme(
      typeof data.interfaceThemeId === 'string' ? data.interfaceThemeId : undefined,
    ).id,
    ...(hasOwnField(data, 'defaultImageNodeModel')
      ? { defaultImageNodeModel: portablePreferences.defaultImageNodeModel }
      : {}),
    ...(hasOwnField(data, 'appMenuStyle')
      ? { appMenuStyle: portablePreferences.appMenuStyle }
      : {}),
    ...(hasOwnField(data, 'interfaceDensity')
      ? { interfaceDensity: portablePreferences.interfaceDensity }
      : {}),
    ...(hasOwnField(data, 'locale')
      ? { locale: portablePreferences.locale }
      : {}),
    ...(hasOwnField(data, 'localeChosen')
      ? { localeChosen: portablePreferences.localeChosen }
      : {}),
    keyboardShortcuts: sanitizeKeyboardShortcutMap(
      isRecord(data.keyboardShortcuts) ? data.keyboardShortcuts : {},
    ),
    gamepadBindings: normalizeGamepadBindings(data.gamepadBindings),
    customBrushPresets: sanitizeUserBrushPresets(data.customBrushPresets),
    customCropPresets: sanitizeCropPresets(data.customCropPresets),
    ...(hasOwnField(data, 'openFontLibrary')
      ? { openFontLibrary: portablePreferences.openFontLibrary }
      : {}),
    // The license key travels with a settings backup; it is re-verified fail-closed on import.
    ...(typeof data.licenseKey === 'string'
      ? { licenseKey: data.licenseKey, license: { licensed: false } as LicenseVerification }
      : {}),
  };
}

const IMAGE_BUILT_IN_BRUSH_IDS = new Set<string>([
  'pencil',
  'marker',
  'charcoal',
  'textureStipple',
  'inker',
  'brushPen',
  'calligraphyChisel',
  'technicalLiner',
  'airbrush',
  'dryBrush',
  'watercolorWash',
  'gouacheFlat',
  'oilBristle',
  'cloudGlaze',
  'mangaInker',
  'screentoneDots',
  'speedLine',
  'storyboardBlue',
  'halftoneBlock',
  'fxSpark',
  'rimLight',
  'glowBloom',
  'hardRound',
  'softRound',
  'softEraser',
  'hardEraser',
]);
