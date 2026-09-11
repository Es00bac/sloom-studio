import React from 'react';
import { ChevronRight, Download, LoaderCircle, RefreshCcw, ShieldCheck, Upload, X } from 'lucide-react';
import {
  ensureVoiceOption,
  EXPORT_COMPOSITOR_OPTIONS,
  getConfiguredProviders,
  getModelOptions,
  getProviderLabel,
  PAPER_PDF_RASTER_PRESET_OPTIONS,
  PAPER_PRINT_UPSCALE_METHOD_OPTIONS,
  RENDER_BACKEND_OPTIONS,
} from '../../lib/providerCatalog';
import { INTERFACE_THEMES, type InterfaceTheme } from '../../lib/interfaceThemes';
import { APP_LOCALES, APP_LOCALE_ENDONYM, normalizeLocale, translate } from '../../lib/i18n';
import { useI18n } from '../../lib/useI18n';
import {
  listImageModelPricingEntries,
  listImageProviderHelpEntries,
  type ImageModelPricingEntry,
  type ImageProviderHelpEntry,
} from '../../lib/imageProviderCapabilities';
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  getKeyboardShortcutLabel,
  normalizeShortcutLabel,
} from '../../lib/keyboardShortcuts';
import {
  GAMEPAD_CONTROL_DEFINITIONS,
  GAMEPAD_WORKSPACES,
  getGamepadCommandOptionsForWorkspace,
  type GamepadBindingProfile,
  type GamepadControlBinding,
  type GamepadControlId,
  type GamepadWorkspace,
} from '../../lib/gamepadBindings';
import { NATIVE_MENU_COMMANDS, type NativeMenuCommand } from '../../lib/nativeApp';
import { useCatalogStore } from '../../store/catalogStore';
import {
  getApiKeyStorageStatus,
  type LicenseOperationOutcome,
  useSettingsStore,
} from '../../store/settingsStore';
import type { Capability, ProviderSettings } from '../../types/flow';
import {
  getAndroidAcceleratorStatus,
  summarizeAndroidAcceleratorStatus,
} from '../../lib/androidAccelerator';
import { DockableDialog } from '../DockablePanel';
import { useMobilePhoneInterfaceDescriptor } from '../../lib/mobilePhoneInterface';
import {
  Section,
  TextInput,
  NumberInput,
  SelectInput,
  type InputProps,
} from './SettingsInputs';
import { Capacitor } from '@capacitor/core';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { VertexAuthPanel } from './VertexAuthPanel';
import { OssLicensesSection } from './OssLicensesSection';
import { CrashReportsSection } from './CrashReportsSection';
import { FontLibrarySection } from './FontLibrarySection';
import { downloadTextFile } from '../../shared/files/downloads';
import { useVertexAuth } from './useVertexAuth';
import { ProviderPackLibrarySection } from './ProviderPackLibrarySection';
import { SelfHostedProjectSyncSettings } from './SelfHostedProjectSyncSettings';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    toggleSettings,
    apiKeys,
    defaultModels,
    providerSettings,
    interfaceThemeId,
    interfaceDensity,
    locale,
    keyboardShortcuts,
    gamepadBindings,
    settingsPanel,
    setApiKey,
    setDefaultModel,
    setInterfaceThemeId,
    setInterfaceDensity,
    setLocale,
    setKeyboardShortcut,
    setGamepadBinding,
    setProviderSetting,
    resetKeyboardShortcuts,
    resetGamepadBindings,
    openSettings,
    exportSettingsBackup,
    importSettingsBackup,
    settingsBackupSupported,
    openFontLibrary,
    addOpenFontLibraryFace,
    removeOpenFontLibraryFace,
  } = useSettingsStore();
  const { t, tf } = useI18n();
  const keyStorageStatus = getApiKeyStorageStatus(apiKeys);
  const nativeBridge = getSignalLoomNativeBridge();
  const vertexPlatform: 'desktop' | 'mobile' = nativeBridge
    ? 'desktop'
    : (Capacitor.getPlatform?.() === 'android' ? 'mobile' : 'desktop');
  const vertexAuth = useVertexAuth({ providerSettings, setProviderSetting, platform: vertexPlatform });
  const {
    modelCatalog,
    elevenLabsVoices,
    isRefreshing,
    refreshError,
    lastRefreshedAt,
    refreshCatalogs,
  } = useCatalogStore();

  const configuredTextProviders = getConfiguredProviders('text', apiKeys, providerSettings);
  const configuredImageProviders = getConfiguredProviders('image', apiKeys, providerSettings);
  const configuredVideoProviders = getConfiguredProviders('video', apiKeys, providerSettings);
  const configuredAudioProviders = getConfiguredProviders('audio', apiKeys, providerSettings);
  const voiceOptions = ensureVoiceOption(elevenLabsVoices, providerSettings.elevenlabsVoiceId);
  const imageProviderHelpEntries = listImageProviderHelpEntries();
  const imageModelPricingEntries = listImageModelPricingEntries();
  const [androidAcceleratorStatus, setAndroidAcceleratorStatus] = React.useState<string>('');
  const [androidAcceleratorChecking, setAndroidAcceleratorChecking] = React.useState(false);
  const [reopenLastProjectOnStartup, setReopenLastProjectOnStartup] = React.useState(false);
  const [startupPreferenceSaving, setStartupPreferenceSaving] = React.useState(false);
  const [startupPreferenceError, setStartupPreferenceError] = React.useState('');

  React.useEffect(() => {
    if (!isSettingsOpen || !nativeBridge?.setReopenLastProjectOnStartup) return;
    let cancelled = false;
    void nativeBridge.getNativeState()
      .then((state) => {
        if (!cancelled) setReopenLastProjectOnStartup(state.reopenLastProjectOnStartup === true);
      })
      .catch((error) => {
        if (!cancelled) {
          setStartupPreferenceError(error instanceof Error ? error.message : t('settings.err.startupPreference'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSettingsOpen, nativeBridge, t]);

  const handleReopenLastProjectChange = async (enabled: boolean) => {
    if (!nativeBridge?.setReopenLastProjectOnStartup) return;
    const previous = reopenLastProjectOnStartup;
    setReopenLastProjectOnStartup(enabled);
    setStartupPreferenceSaving(true);
    setStartupPreferenceError('');
    try {
      const result = await nativeBridge.setReopenLastProjectOnStartup(enabled);
      setReopenLastProjectOnStartup(result.reopenLastProjectOnStartup);
    } catch (error) {
      setReopenLastProjectOnStartup(previous);
      setStartupPreferenceError(error instanceof Error ? error.message : t('settings.err.startupPreference'));
    } finally {
      setStartupPreferenceSaving(false);
    }
  };

  const handleRefresh = async () => {
    await refreshCatalogs({
      apiKeys,
      defaultModels,
      providerSettings,
    });
  };

  const handleTestAndroidAccelerator = async () => {
    setAndroidAcceleratorChecking(true);
    setAndroidAcceleratorStatus('');
    try {
      const status = await getAndroidAcceleratorStatus({
        baseUrl: providerSettings.androidAcceleratorBaseUrl ?? '',
        authToken: providerSettings.androidAcceleratorAuthToken,
      });
      const summary = summarizeAndroidAcceleratorStatus(status);
      const warningText = summary.warnings.length ? `\n${summary.warnings.join('\n')}` : '';
      setAndroidAcceleratorStatus(`${summary.title}\n${summary.detail}${warningText}`);
    } catch (error) {
      setAndroidAcceleratorStatus(error instanceof Error ? error.message : t('settings.err.androidAccelFailed'));
    } finally {
      setAndroidAcceleratorChecking(false);
    }
  };

  const phone = useMobilePhoneInterfaceDescriptor().enabled;

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 120, y: 72, width: 920, height: 680 }}
      dialogId="settings"
      minSize={{ width: 320, height: 360 }}
      onClose={toggleSettings}
      open={isSettingsOpen}
      title={settingsPanel === 'keyboard'
        ? t('settings.dialog.keyboard')
        : settingsPanel === 'gamepad'
          ? t('settings.dialog.gamepad')
          : settingsPanel === 'fonts'
            ? t('settings.dialog.fonts')
          : t('settings.dialog.providers')}
      workspaceId="app-dialogs"
    >
      <div
        className="signal-loom-themed theme-panel flex h-full min-h-0 flex-col overflow-hidden"
      >
        {phone ? (
          <div className="theme-surface theme-border flex items-center gap-2 overflow-x-auto border-b px-3 py-2">
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-800 bg-[#0b1018] p-1">
              {([['providers', 'settings.tab.providers'], ['keyboard', 'settings.tab.shortcuts'], ['gamepad', 'settings.tab.gamepad'], ['fonts', 'settings.tab.fonts']] as const).map(
                ([panel, labelKey]) => (
                  <button
                    key={panel}
                    className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                      settingsPanel === panel ? 'bg-blue-500/20 text-blue-100' : 'text-gray-300 hover:text-white'
                    }`}
                    onClick={() => openSettings(panel)}
                    type="button"
                  >
                    {t(labelKey)}
                  </button>
                ),
              )}
            </div>
            {settingsPanel !== 'fonts' ? (
              <button
                aria-label={t('settings.refreshCatalogs')}
                className="ml-auto shrink-0 rounded-lg border border-gray-700 bg-[#111217]/60 p-2 text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                onClick={() => void handleRefresh()}
                type="button"
              >
                {isRefreshing ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={`theme-surface theme-border ${phone ? 'hidden' : 'flex'} justify-between items-center p-5 border-b`}>
          <div>
            <h2 className="text-xl font-semibold text-gray-100">
              {settingsPanel === 'fonts'
                ? t('settings.header.fontLibrary')
                : t('settings.header.providerConfig')}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {settingsPanel === 'keyboard'
                ? t('settings.desc.keyboard')
                : settingsPanel === 'gamepad'
                  ? t('settings.desc.gamepad')
                  : settingsPanel === 'fonts'
                    ? t('settings.desc.fontLibrary')
                  : tf('settings.desc.keysStored', {
                        state: keyStorageStatus.encryptedAtRest ? t('settings.keys.encrypted') : t('settings.keys.notEncrypted'),
                        medium: t(
                          keyStorageStatus.storageMedium === 'local-storage'
                            ? 'settings.keys.medium.localStorage'
                            : 'settings.keys.medium.memoryOnly',
                        ),
                        caveat: t(
                          keyStorageStatus.storageMedium === 'memory-only'
                            ? 'settings.keys.caveat.memoryOnly'
                            : keyStorageStatus.encryptedAtRest
                              ? 'settings.keys.caveat.encrypted'
                              : 'settings.keys.caveat.localStorage',
                        ),
                      })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                settingsPanel === 'providers'
                  ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                  : 'border-gray-700 bg-[#111217]/60 text-gray-200 hover:border-gray-500 hover:text-white'
              }`}
              onClick={() => openSettings('providers')}
              type="button"
            >
              {t('settings.tab.providers')}
            </button>
            <button
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                settingsPanel === 'keyboard'
                  ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                  : 'border-gray-700 bg-[#111217]/60 text-gray-200 hover:border-gray-500 hover:text-white'
              }`}
              onClick={() => openSettings('keyboard')}
              type="button"
            >
              {t('settings.tab.shortcuts')}
            </button>
            <button
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                settingsPanel === 'gamepad'
                  ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                  : 'border-gray-700 bg-[#111217]/60 text-gray-200 hover:border-gray-500 hover:text-white'
              }`}
              onClick={() => openSettings('gamepad')}
              type="button"
            >
              {t('settings.tab.gamepad')}
            </button>
            <button
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                settingsPanel === 'fonts'
                  ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                  : 'border-gray-700 bg-[#111217]/60 text-gray-200 hover:border-gray-500 hover:text-white'
              }`}
              onClick={() => openSettings('fonts')}
              type="button"
            >
              {t('settings.tab.fonts')}
            </button>
            {settingsPanel !== 'fonts' ? (
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-[#111217]/60 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                onClick={() => void handleRefresh()}
                type="button"
              >
                {isRefreshing ? <LoaderCircle className="animate-spin" size={14} /> : <RefreshCcw size={14} />}
                {t('settings.refreshCatalogs')}
              </button>
            ) : null}
            <button
              onClick={toggleSettings}
              className="text-gray-400 hover:text-white transition-colors p-1 rounded-md hover:bg-gray-700"
              type="button"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className={`overflow-y-auto space-y-8 ${phone ? 'p-4' : 'p-6'}`}>
          {settingsPanel === 'keyboard' ? (
            <KeyboardShortcutsSection
              keyboardShortcuts={keyboardShortcuts}
              onChange={setKeyboardShortcut}
              onReset={resetKeyboardShortcuts}
            />
          ) : settingsPanel === 'gamepad' ? (
            <GamepadBindingsSection
              gamepadBindings={gamepadBindings}
              onChange={setGamepadBinding}
              onReset={resetGamepadBindings}
            />
          ) : settingsPanel === 'fonts' ? (
            <FontLibrarySection library={openFontLibrary} onInstall={addOpenFontLibraryFace} onRemove={removeOpenFontLibraryFace} />
          ) : (
            <>
          <ProviderPackLibrarySection />
          <Section title={`${translate('settings.section.interface', 'en')} · ${translate('settings.section.interface', 'ja')}`}>
            <SelectInput
              label={`${translate('settings.language', 'en')} · ${translate('settings.language', 'ja')}`}
              onChange={(value) => setLocale(normalizeLocale(value))}
              options={APP_LOCALES.map((code) => ({ value: code, label: APP_LOCALE_ENDONYM[code] }))}
              value={locale}
            />
            {nativeBridge?.setReopenLastProjectOnStartup ? (
              <label className="flex items-start gap-3 rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-300">
                <input
                  checked={reopenLastProjectOnStartup}
                  className="mt-1"
                  disabled={startupPreferenceSaving}
                  onChange={(event) => void handleReopenLastProjectChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="space-y-1">
                  <span className="block font-medium text-gray-200">{t('settings.field.reopenLastProject')}</span>
                  <span className="block text-xs leading-5 text-gray-500">{t('settings.desc.reopenLastProject')}</span>
                  {startupPreferenceError ? (
                    <span className="block text-xs leading-5 text-red-300">{startupPreferenceError}</span>
                  ) : null}
                </span>
              </label>
            ) : null}
          </Section>

          <Section title={t('settings.section.apiKeys')}>
            <div className="grid gap-4 md:grid-cols-2">
              <ApiKeyInput
                label="Google Gemini / Veo"
                value={apiKeys.gemini}
                onChange={(value) => setApiKey('gemini', value)}
                placeholder="AIzaSy..."
              />
              <ApiKeyInput
                label="OpenAI / Compatible"
                value={apiKeys.openai}
                onChange={(value) => setApiKey('openai', value)}
                placeholder="sk-..."
              />
              <ApiKeyInput
                label="Atlas"
                value={apiKeys.atlas ?? ''}
                onChange={(value) => setApiKey('atlas', value)}
                placeholder="sk-atlas-..."
              />
              <ApiKeyInput
                label="BytePlus (Seedream)"
                value={apiKeys.byteplus ?? ''}
                onChange={(value) => setApiKey('byteplus', value)}
                placeholder="ModelArk API key"
              />
              <ApiKeyInput
                label="Hugging Face"
                value={apiKeys.huggingface}
                onChange={(value) => setApiKey('huggingface', value)}
                placeholder="hf_..."
              />
              <ApiKeyInput
                label="Black Forest Labs"
                value={apiKeys.bfl ?? ''}
                onChange={(value) => setApiKey('bfl', value)}
                placeholder="BFL API key"
              />
              <ApiKeyInput
                label="Stability AI"
                value={apiKeys.stability ?? ''}
                onChange={(value) => setApiKey('stability', value)}
                placeholder="sk-..."
              />
              <ApiKeyInput
                label="ElevenLabs"
                value={apiKeys.elevenlabs}
                onChange={(value) => setApiKey('elevenlabs', value)}
                placeholder="sk_..."
              />
            </div>
          </Section>

          <SettingsBackupSection
            exportSettingsBackup={exportSettingsBackup}
            importSettingsBackup={importSettingsBackup}
            supported={settingsBackupSupported}
          />

          <SelfHostedProjectSyncSettings />

          <CrashReportsSection />

          <ImageProviderHelpSection entries={imageProviderHelpEntries} />
          <ImageModelPricingSection entries={imageModelPricingEntries} />

          <Section title={t('settings.section.runtimeOptions')}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput
                label={t('settings.field.openaiBaseUrl')}
                value={providerSettings.openaiBaseUrl}
                onChange={(value) => setProviderSetting('openaiBaseUrl', value)}
                placeholder="https://api.openai.com/v1"
              />
              <TextInput
                label={t('settings.field.atlasBaseUrl')}
                value={providerSettings.atlasBaseUrl ?? ''}
                onChange={(value) => setProviderSetting('atlasBaseUrl', value)}
                placeholder="https://api.atlas-cloud.ai/v1"
              />

              <SelectInput
                label={t('settings.field.geminiCredentialMode')}
                onChange={(value) => setProviderSetting('geminiCredentialMode', value as ProviderSettings['geminiCredentialMode'])}
                options={[
                  { value: 'api-key', label: t('settings.opt.geminiApiKey') },
                  { value: 'vertex-adc', label: t('settings.opt.vertexAdc') },
                ]}
                value={providerSettings.geminiCredentialMode}
              />

              {providerSettings.geminiCredentialMode === 'vertex-adc' ? (
                <div className="md:col-span-2">
                  <VertexAuthPanel
                    platform={vertexPlatform}
                    providerSettings={providerSettings}
                    setProviderSetting={setProviderSetting}
                    status={vertexAuth.status}
                    projects={vertexAuth.projects}
                    busy={vertexAuth.busy}
                    testResult={vertexAuth.testResult}
                    serviceAccountError={vertexAuth.serviceAccountError}
                    onSignIn={vertexAuth.onSignIn}
                    onDetect={vertexAuth.onDetect}
                    onRefreshProjects={vertexAuth.onRefreshProjects}
                    onTestConnection={vertexAuth.onTestConnection}
                    onServiceAccountFile={vertexAuth.onServiceAccountFile}
                    onServiceAccountText={vertexAuth.onServiceAccountText}
                  />
                </div>
              ) : null}

              <SelectInput
                label={t('settings.field.paperPrintUpscale')}
                onChange={(value) => setProviderSetting('paperPrintUpscaleMethod', value as ProviderSettings['paperPrintUpscaleMethod'])}
                options={PAPER_PRINT_UPSCALE_METHOD_OPTIONS}
                value={providerSettings.paperPrintUpscaleMethod}
              />

              <SelectInput
                label={t('settings.field.paperPdfRasterPreset')}
                onChange={(value) => setProviderSetting('paperPdfRasterPreset', value as ProviderSettings['paperPdfRasterPreset'])}
                options={PAPER_PDF_RASTER_PRESET_OPTIONS}
                value={providerSettings.paperPdfRasterPreset}
              />

              <NumberInput
                label={t('settings.field.batchMaxRetries')}
                value={providerSettings.batchMaxRetries ?? 10}
                onChange={(value) => setProviderSetting('batchMaxRetries', value)}
                min={0}
                max={50}
              />

              <NumberInput
                label={t('settings.field.batchRetryBaseDelay')}
                value={providerSettings.batchRetryBaseDelayMs ?? 30000}
                onChange={(value) => setProviderSetting('batchRetryBaseDelayMs', value)}
                min={1000}
                max={120000}
              />

              <SelectInput
                label={t('settings.field.localRenderBackend')}
                onChange={(value) => setProviderSetting('renderBackendPreference', value as ProviderSettings['renderBackendPreference'])}
                options={RENDER_BACKEND_OPTIONS}
                value={providerSettings.renderBackendPreference}
              />

              <SelectInput
                label={t('settings.field.exportCompositor')}
                onChange={(value) => setProviderSetting('exportCompositorPreference', value as ProviderSettings['exportCompositorPreference'])}
                options={EXPORT_COMPOSITOR_OPTIONS}
                value={providerSettings.exportCompositorPreference}
              />

              <SelectInput
                label={t('settings.field.interfaceTheme')}
                onChange={setInterfaceThemeId}
                options={INTERFACE_THEMES.map((theme) => ({
                  value: theme.id,
                  label: theme.name,
                }))}
                value={interfaceThemeId}
              />

              <SelectInput
                label={t('settings.field.interfaceDensity')}
                onChange={(value) => setInterfaceDensity(value === 'comfortable' ? 'comfortable' : 'compact')}
                options={[
                  { value: 'compact', label: t('settings.opt.densityCompact') },
                  { value: 'comfortable', label: t('settings.opt.densityComfortable') },
                ]}
                value={interfaceDensity}
              />

              <div className="md:col-span-2">
                <ThemeGrid
                  activeThemeId={interfaceThemeId}
                  onChange={setInterfaceThemeId}
                  themes={INTERFACE_THEMES}
                />
              </div>

              <TextInput
                label={t('settings.field.localNativeRenderUrl')}
                value={providerSettings.localNativeRenderUrl}
                onChange={(value) => setProviderSetting('localNativeRenderUrl', value)}
                placeholder="http://127.0.0.1:41736"
              />

              <ApiKeyInput
                label={t('settings.field.localNativeRenderToken')}
                value={providerSettings.localNativeRenderToken ?? ''}
                onChange={(value) => setProviderSetting('localNativeRenderToken', value)}
                placeholder="Matches SIGNAL_LOOM_NATIVE_RENDER_TOKEN"
              />

              <label className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-300">
                <input
                  checked={providerSettings.backendProxyEnabled}
                  onChange={(event) => setProviderSetting('backendProxyEnabled', event.target.checked)}
                  type="checkbox"
                />
                {t('settings.field.backendProxyToggle')}
              </label>

              <TextInput
                label={t('settings.field.backendProxyUrl')}
                value={providerSettings.backendProxyBaseUrl}
                onChange={(value) => setProviderSetting('backendProxyBaseUrl', value)}
                placeholder="http://127.0.0.1:8787"
              />

              <TextInput
                label={t('settings.field.localOpenImageEndpoint')}
                value={providerSettings.localOpenImageEndpointUrl ?? ''}
                onChange={(value) => setProviderSetting('localOpenImageEndpointUrl', value)}
                placeholder="http://127.0.0.1:8188/signal-loom-image-edit"
              />

              <TextInput
                label={t('settings.field.localOpenImageAuth')}
                value={providerSettings.localOpenImageAuthHeader ?? ''}
                onChange={(value) => setProviderSetting('localOpenImageAuthHeader', value)}
                placeholder="Bearer ..."
              />

              <TextInput
                label={t('settings.field.localOpenImageModel')}
                value={providerSettings.localOpenImageDefaultModel ?? 'Qwen/Qwen-Image-Edit'}
                onChange={(value) => setProviderSetting('localOpenImageDefaultModel', value)}
                placeholder="Qwen/Qwen-Image-Edit"
              />

              <TextInput
                label={t('settings.field.genericImageEndpoint')}
                value={providerSettings.genericImageEndpointUrl ?? ''}
                onChange={(value) => setProviderSetting('genericImageEndpointUrl', value)}
                placeholder="http://127.0.0.1:5000/inpaint"
              />

              <TextInput
                label={t('settings.field.genericImageAuth')}
                value={providerSettings.genericImageAuthHeader ?? ''}
                onChange={(value) => setProviderSetting('genericImageAuthHeader', value)}
                placeholder="Bearer ..."
              />

              <TextInput
                label={t('settings.field.androidAccelUrl')}
                value={providerSettings.androidAcceleratorBaseUrl ?? ''}
                onChange={(value) => setProviderSetting('androidAcceleratorBaseUrl', value)}
                placeholder="http://192.168.1.42:8788"
              />

              <TextInput
                label={t('settings.field.androidAccelToken')}
                value={providerSettings.androidAcceleratorAuthToken ?? ''}
                onChange={(value) => setProviderSetting('androidAcceleratorAuthToken', value)}
                placeholder={t('settings.ph.androidToken')}
              />

              <TextInput
                label={t('settings.field.androidDefaultUpscaler')}
                value={providerSettings.androidAcceleratorDefaultUpscaler ?? 'upscaler_realistic'}
                onChange={(value) => setProviderSetting('androidAcceleratorDefaultUpscaler', value)}
                placeholder="upscaler_realistic"
              />

              <TextInput
                label={t('settings.field.androidDefaultImageModel')}
                value={providerSettings.androidAcceleratorDefaultImageModel ?? defaultModels.image.android}
                onChange={(value) => {
                  setProviderSetting('androidAcceleratorDefaultImageModel', value);
                  setDefaultModel('image', 'android', value);
                }}
                placeholder="local-dream-active"
              />

              <div className="md:col-span-2 rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-xs leading-5 text-gray-400">
                <div>
                  {t('settings.help.androidAccelerator1')}
                </div>
                <div className="mt-2">
                  {t('settings.help.androidAccelerator2')}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-300/70"
                    disabled={androidAcceleratorChecking}
                    onClick={() => void handleTestAndroidAccelerator()}
                    type="button"
                  >
                    {androidAcceleratorChecking ? <LoaderCircle className="animate-spin" size={13} /> : <RefreshCcw size={13} />}
                    {t('settings.testAndroidAccelerator')}
                  </button>
                  {androidAcceleratorStatus ? (
                    <span className="whitespace-pre-line text-gray-300">{androidAcceleratorStatus}</span>
                  ) : null}
                </div>
              </div>

              {apiKeys.elevenlabs.trim() ? (
                <SelectInput
                  label={t('settings.field.defaultElevenLabsVoice')}
                  onChange={(value) => setProviderSetting('elevenlabsVoiceId', value)}
                  options={voiceOptions.map((voice) => ({
                    value: voice.value,
                    label: voice.category ? `${voice.label} · ${voice.category}` : voice.label,
                  }))}
                  value={providerSettings.elevenlabsVoiceId || voiceOptions[0]?.value || ''}
                />
              ) : (
                <div className="rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-400">
                  {t('settings.help.elevenlabsEmpty')}
                </div>
              )}
            </div>

            <CatalogStatus
              isRefreshing={isRefreshing}
              refreshError={refreshError}
              lastRefreshedAt={lastRefreshedAt}
            />
          </Section>

          {vertexPlatform === 'mobile' && (
            <Section title={t('settings.section.androidLanServer')}>
              <div className="rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-400 mb-4">
                {t('settings.help.lanServer')}
              </div>
              <div className="max-w-md">
                <SelectInput
                  label={t('settings.field.lanServerToggle')}
                  value={providerSettings.androidLanServerEnabled ? 'enabled' : 'disabled'}
                  onChange={(val) => setProviderSetting('androidLanServerEnabled', val === 'enabled')}
                  options={[
                    { value: 'enabled', label: t('settings.opt.enabled') },
                    { value: 'disabled', label: t('settings.opt.disabledAutostart') }
                  ]}
                />
              </div>
            </Section>
          )}

          <Section title={t('settings.section.defaultTextModels')}>
            <ConfiguredProviderGrid
              capability="text"
              configuredProviders={configuredTextProviders}
              defaultModels={defaultModels.text}
              modelCatalog={modelCatalog}
              onChange={(category, provider, value) =>
                setDefaultModel(category as 'text', provider as keyof typeof defaultModels.text, value)
              }
            />
          </Section>

          <Section title={t('settings.section.defaultImageModels')}>
            <ConfiguredProviderGrid
              capability="image"
              configuredProviders={configuredImageProviders}
              defaultModels={defaultModels.image}
              modelCatalog={modelCatalog}
              onChange={(category, provider, value) =>
                setDefaultModel(category as 'image', provider as keyof typeof defaultModels.image, value)
              }
            />
          </Section>

          <Section title={t('settings.section.defaultVideoModels')}>
            <ConfiguredProviderGrid
              capability="video"
              configuredProviders={configuredVideoProviders}
              defaultModels={defaultModels.video}
              modelCatalog={modelCatalog}
              onChange={(category, provider, value) =>
                setDefaultModel(category as 'video', provider as keyof typeof defaultModels.video, value)
              }
            />
          </Section>

          <Section title={t('settings.section.defaultAudioModels')}>
            <ConfiguredProviderGrid
              capability="audio"
              configuredProviders={configuredAudioProviders}
              defaultModels={defaultModels.audio}
              modelCatalog={modelCatalog}
              onChange={(category, provider, value) =>
                setDefaultModel(category as 'audio', provider as keyof typeof defaultModels.audio, value)
              }
            />
          </Section>
          <OssLicensesSection />
            </>
          )}
        </div>

        <div className="theme-panel theme-border p-5 border-t flex justify-end">
          <button
            onClick={toggleSettings}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
            type="button"
          >
            {t('settings.saveAndClose')}
          </button>
        </div>
      </div>
    </DockableDialog>
  );
};

function KeyboardShortcutsSection({
  keyboardShortcuts,
  onChange,
  onReset,
}: {
  keyboardShortcuts: Partial<Record<NativeMenuCommand, string>>;
  onChange: (command: NativeMenuCommand, shortcut: string) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <Section title={t('settings.section.keyboardShortcuts')}>
      <div className="rounded-xl border border-gray-800 bg-[#111217]/50 p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="text-sm text-gray-400">
            {t('settings.keyboard.hint')}
          </div>
          <button
            className="rounded-lg border border-gray-700 bg-[#0d0f15] px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-500 hover:text-white"
            onClick={onReset}
            type="button"
          >
            {t('settings.resetDefaults')}
          </button>
        </div>
        <div className="grid gap-2">
          {NATIVE_MENU_COMMANDS.map((command) => {
            const current = getKeyboardShortcutLabel(command, keyboardShortcuts) ?? '';
            const defaultShortcut = DEFAULT_KEYBOARD_SHORTCUTS[command] ?? '';
            return (
              <div
                className="grid items-center gap-3 rounded-lg border border-gray-800 bg-[#0b1018] px-3 py-2 md:grid-cols-[minmax(12rem,1fr)_10rem_12rem]"
                key={command}
              >
                <div>
                  <div className="text-sm font-medium text-gray-200">{formatShortcutCommandLabel(command)}</div>
                  <div className="text-xs text-gray-500">{command}</div>
                </div>
                <div className="text-xs text-gray-500">
                  {t('settings.keyboard.defaultLabel')} <span className="text-gray-300">{defaultShortcut || t('settings.common.none')}</span>
                </div>
                <input
                  className="w-full rounded-lg border border-gray-700 bg-[#111217] px-2.5 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
                  onBlur={(event) => onChange(command, normalizeShortcutLabel(event.target.value))}
                  onChange={(event) => onChange(command, event.target.value)}
                  placeholder={defaultShortcut || t('settings.keyboard.noShortcut')}
                  type="text"
                  value={current}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function GamepadBindingsSection({
  gamepadBindings,
  onChange,
  onReset,
}: {
  gamepadBindings: GamepadBindingProfile;
  onChange: (workspace: GamepadWorkspace, controlId: GamepadControlId, patch: Partial<GamepadControlBinding>) => void;
  onReset: () => void;
}) {
  const { t, tf } = useI18n();
  const [activeWorkspace, setActiveWorkspace] = React.useState<GamepadWorkspace>('flow');
  const commandOptions = getGamepadCommandOptionsForWorkspace(activeWorkspace);
  const workspaceBindings = gamepadBindings[activeWorkspace];
  const activeWorkspaceLabel = GAMEPAD_WORKSPACES.find((workspace) => workspace.id === activeWorkspace)?.label ?? activeWorkspace;

  return (
    <Section title={t('settings.section.gamepadBindings')}>
      <div className="rounded-xl border border-gray-800 bg-[#111217]/50 p-4" data-gamepad-bindings-panel="true">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg border border-gray-800 bg-[#0b1018] p-1">
            {GAMEPAD_WORKSPACES.map((workspace) => (
              <button
                aria-pressed={activeWorkspace === workspace.id}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                  activeWorkspace === workspace.id
                    ? 'bg-blue-500/20 text-blue-100'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-100'
                }`}
                key={workspace.id}
                onClick={() => setActiveWorkspace(workspace.id)}
                type="button"
              >
                {workspace.label}
              </button>
            ))}
          </div>
          <button
            className="rounded-lg border border-gray-700 bg-[#0d0f15] px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-500 hover:text-white"
            onClick={onReset}
            type="button"
          >
            {t('settings.resetDefaults')}
          </button>
        </div>
        <div className="grid gap-2">
          {GAMEPAD_CONTROL_DEFINITIONS.map((control) => {
            const binding = workspaceBindings[control.id];
            return (
              <div
                className="grid gap-3 rounded-lg border border-gray-800 bg-[#0b1018] px-3 py-2 lg:grid-cols-[11rem_minmax(14rem,1fr)_minmax(18rem,28rem)]"
                key={control.id}
              >
                <div>
                  <div className="text-sm font-medium text-gray-200">{control.label}</div>
                  <div className="text-xs capitalize text-gray-500">{control.kind}</div>
                </div>
                <select
                  aria-label={tf('settings.gamepad.commandAria', { workspace: activeWorkspaceLabel, control: control.label })}
                  className="w-full rounded-lg border border-gray-700 bg-[#111217] px-2.5 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40"
                  onChange={(event) => onChange(activeWorkspace, control.id, { command: event.target.value as NativeMenuCommand | '' })}
                  value={binding.command}
                >
                  <option value="">{t('settings.common.none')}</option>
                  {commandOptions.map((command) => (
                    <option key={command} value={command}>
                      {formatShortcutCommandLabel(command)}
                    </option>
                  ))}
                </select>
                <GamepadAdvancedControls
                  binding={binding}
                  controlId={control.id}
                  kind={control.kind}
                  onChange={(patch) => onChange(activeWorkspace, control.id, patch)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function GamepadAdvancedControls({
  binding,
  controlId,
  kind,
  onChange,
}: {
  binding: GamepadControlBinding;
  controlId: GamepadControlId;
  kind: string;
  onChange: (patch: Partial<GamepadControlBinding>) => void;
}) {
  const { t } = useI18n();
  const isAnalog = kind === 'axis' || kind === 'trigger';
  return (
    <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2">
      <NumberSetting
        label={t('settings.gamepad.threshold')}
        max={1}
        min={0.05}
        onChange={(threshold) => onChange({ threshold })}
        step={0.05}
        value={binding.threshold}
      />
      {kind === 'axis' ? (
        <>
          <NumberSetting
            label={t('settings.gamepad.deadzone')}
            max={0.95}
            min={0}
            onChange={(deadzone) => onChange({ deadzone })}
            step={0.05}
            value={binding.deadzone}
          />
          <NumberSetting
            label={t('settings.gamepad.sensitivity')}
            max={3}
            min={0.1}
            onChange={(sensitivity) => onChange({ sensitivity })}
            step={0.1}
            value={binding.sensitivity}
          />
          <label className="flex items-center gap-2 rounded-lg border border-gray-800 bg-[#111217] px-2 py-2">
            <input
              checked={binding.inverted}
              onChange={(event) => onChange({ inverted: event.target.checked })}
              type="checkbox"
            />
            {t('settings.gamepad.invert')}
          </label>
        </>
      ) : null}
      {!isAnalog ? (
        <div className="rounded-lg border border-gray-800 bg-[#111217] px-2 py-2 text-gray-500">
          {t('settings.gamepad.digitalEdge')}
        </div>
      ) : null}
      <input name={`gamepad-${controlId}-marker`} type="hidden" value={controlId} />
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[5rem_1fr] items-center gap-2 rounded-lg border border-gray-800 bg-[#111217] px-2 py-1.5">
      <span>{label}</span>
      <input
        className="min-w-0 rounded border border-gray-700 bg-[#0d0f15] px-2 py-1 font-mono text-xs text-gray-100"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={Number(value.toFixed(2))}
      />
    </label>
  );
}

function formatShortcutCommandLabel(command: NativeMenuCommand): string {
  return command
    .replace(/^[^:]+:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type SettingsBackupStatus = { tone: 'ok' | 'error' | 'info'; message: string } | null;

function backupErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : translate('settings.backup.errGeneric', useSettingsStore.getState().locale);
}

// Settings-backup export rides the shared Android-aware download helper: the plain anchor-click
// this file used to hand-roll silently failed on Android WebViews (owner report, 0.9.7), while
// shared/files/downloads.ts writes through the Capacitor Filesystem plugin there.

/**
 * Optional, user-initiated encrypted backup of editor preferences, API keys, and provider
 * credentials. The blob is sealed with a passphrase the user chooses (portable across machines) and
 * never leaves the device except as the file the user explicitly saves. See lib/settingsBackup.ts.
 */
function SettingsBackupSection({
  exportSettingsBackup,
  importSettingsBackup,
  supported,
}: {
  exportSettingsBackup: (passphrase: string) => Promise<string>;
  importSettingsBackup: (envelopeText: string, passphrase: string) => Promise<LicenseOperationOutcome>;
  supported: boolean;
}) {
  const [mode, setMode] = React.useState<'export' | 'import'>('export');
  const [passphrase, setPassphrase] = React.useState('');
  const [confirmPassphrase, setConfirmPassphrase] = React.useState('');
  const [importText, setImportText] = React.useState('');
  const [importFileName, setImportFileName] = React.useState('');
  const [exportedBlob, setExportedBlob] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<SettingsBackupStatus>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const resetFeedback = () => {
    setStatus(null);
    setExportedBlob('');
  };

  const switchMode = (next: 'export' | 'import') => {
    setMode(next);
    setPassphrase('');
    setConfirmPassphrase('');
    setImportText('');
    setImportFileName('');
    resetFeedback();
  };

  const handleExport = async () => {
    resetFeedback();
    if (passphrase.length < 8) {
      setStatus({ tone: 'error', message: t('settings.backup.errMinChars') });
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setStatus({ tone: 'error', message: t('settings.backup.errMismatch') });
      return;
    }
    setBusy(true);
    try {
      const blob = await exportSettingsBackup(passphrase);
      setExportedBlob(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`signal-loom-settings-${stamp}.slbackup`, blob);
      setStatus({
        tone: 'ok',
        message: t('settings.backup.saved'),
      });
      setPassphrase('');
      setConfirmPassphrase('');
    } catch (error) {
      setStatus({ tone: 'error', message: backupErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    resetFeedback();
    try {
      const text = await file.text();
      setImportText(text);
      setImportFileName(file.name);
      setStatus({ tone: 'info', message: tf('settings.backup.loaded', { name: file.name }) });
    } catch {
      setStatus({ tone: 'error', message: t('settings.backup.errReadFile') });
    }
  };

  const handleImport = async () => {
    setStatus(null);
    if (!importText.trim()) {
      setStatus({ tone: 'error', message: t('settings.backup.errNoFile') });
      return;
    }
    setBusy(true);
    try {
      const outcome = await importSettingsBackup(importText, passphrase);
      if (outcome.status === 'committed') {
        setStatus({ tone: 'ok', message: t('settings.backup.restored') });
        setImportText('');
        setImportFileName('');
        setPassphrase('');
      } else {
        setStatus({ tone: 'error', message: outcome.reason ?? 'The restore did not commit.' });
      }
    } catch (error) {
      setStatus({ tone: 'error', message: backupErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const { t, tf } = useI18n();
  const statusToneClass = status?.tone === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
    : status?.tone === 'error'
      ? 'border-red-500/30 bg-red-500/10 text-red-100'
      : 'border-blue-500/30 bg-blue-500/10 text-blue-100';

  return (
    <Section title={t('settings.section.settingsBackup')}>
      <div className="space-y-4 rounded-xl border border-gray-800 bg-[#111217]/50 p-4">
        <div className="flex items-start gap-3 text-sm text-gray-400">
          <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={18} />
          <p className="leading-5">
            {t('settings.backup.intro')}
          </p>
        </div>

        {!supported ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {t('settings.backup.unavailable')}
          </div>
        ) : (
          <>
            <div className="flex w-fit rounded-lg border border-gray-800 bg-[#0b1018] p-1">
              {([['export', 'settings.backup.modeExport'], ['import', 'settings.backup.modeRestore']] as const).map(([value, labelKey]) => (
                <button
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    mode === value ? 'bg-blue-500/20 text-blue-100' : 'text-gray-400 hover:text-gray-100'
                  }`}
                  key={value}
                  onClick={() => switchMode(value)}
                  type="button"
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>

            {mode === 'export' ? (
              <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
                <div className="grid gap-3 md:grid-cols-2">
                  <BackupPassphraseInput
                    autoComplete="new-password"
                    label={t('settings.backup.passphrase')}
                    onChange={setPassphrase}
                    placeholder={t('settings.backup.passphraseMin')}
                    value={passphrase}
                  />
                  <BackupPassphraseInput
                    autoComplete="new-password"
                    label={t('settings.backup.confirmPassphrase')}
                    onChange={setConfirmPassphrase}
                    placeholder={t('settings.backup.reenter')}
                    value={confirmPassphrase}
                  />
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-500/15 px-3 py-2 text-sm font-semibold text-blue-100 transition-colors hover:border-blue-300/70 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleExport()}
                  type="button"
                >
                  {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
                  {t('settings.backup.export')}
                </button>
                {exportedBlob ? (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">
                      {tf('settings.backup.downloadHint', { ext: '.slbackup' })}
                    </div>
                    <textarea
                      className="h-28 w-full resize-y rounded-lg border border-gray-700 bg-[#0d0f15] p-2 font-mono text-[11px] text-gray-300 outline-none"
                      readOnly
                      value={exportedBlob}
                    />
                    <button
                      className="rounded-lg border border-gray-700 bg-[#0d0f15] px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500 hover:text-white"
                      onClick={() => void navigator.clipboard?.writeText(exportedBlob)}
                      type="button"
                    >
                      {t('settings.backup.copyToClipboard')}
                    </button>
                  </div>
                ) : null}
              </form>
            ) : (
              <form className="space-y-3" onSubmit={(event) => event.preventDefault()}>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    accept=".slbackup,.json,application/json,text/plain"
                    className="hidden"
                    onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-[#0d0f15] px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-500 hover:text-white"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <Upload size={14} />
                    {t('settings.backup.chooseFile')}
                  </button>
                  {importFileName ? <span className="text-xs text-gray-400">{importFileName}</span> : null}
                </div>
                <textarea
                  className="h-24 w-full resize-y rounded-lg border border-gray-700 bg-[#0d0f15] p-2 font-mono text-[11px] text-gray-300 outline-none focus:border-blue-500"
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder={t('settings.backup.pasteHere')}
                  value={importText}
                />
                <BackupPassphraseInput
                  autoComplete="off"
                  label={t('settings.backup.passphrase')}
                  onChange={setPassphrase}
                  placeholder={t('settings.backup.restorePassphrase')}
                  value={passphrase}
                />
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-500/15 px-3 py-2 text-sm font-semibold text-blue-100 transition-colors hover:border-blue-300/70 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void handleImport()}
                  type="button"
                >
                  {busy ? <LoaderCircle className="animate-spin" size={14} /> : <Upload size={14} />}
                  {t('settings.backup.restoreFromBackup')}
                </button>
                <div className="text-xs text-gray-500">
                  {t('settings.backup.restoreWarning')}
                </div>
              </form>
            )}

            {status ? (
              <div className={`rounded-lg border px-3 py-2 text-xs ${statusToneClass}`}>{status.message}</div>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

function BackupPassphraseInput({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-gray-300">{label}</span>
      <input
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-gray-700 bg-[#111217] p-2.5 text-sm text-gray-200 outline-none transition-shadow focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="password"
        value={value}
      />
    </label>
  );
}

function ImageProviderHelpSection({ entries }: { entries: ImageProviderHelpEntry[] }) {
  const { t } = useI18n();
  return (
    <Section title={t('settings.section.imageProviderSetup')}>
      <p className="text-xs text-gray-500">
        {t('settings.help.imageProviderIntro')}
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map((entry) => (
          <ImageProviderHelpCard entry={entry} key={entry.providerId} />
        ))}
      </div>
    </Section>
  );
}

function ImageProviderHelpCard({ entry }: { entry: ImageProviderHelpEntry }) {
  // Collapsed by default: the setup instructions are bulky and only relevant during first-time signup,
  // so the card shows just the identity + sign-up/pricing links until the user expands it.
  const [expanded, setExpanded] = React.useState(false);
  const { t, tf } = useI18n();

  return (
    <article className="rounded-xl border border-gray-800 bg-[#111217]/50 text-sm text-gray-300">
      <div className="flex items-start justify-between gap-3 p-4">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <ChevronRight
            className={`mt-0.5 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            size={16}
          />
          <span className="min-w-0">
            <span className="block font-semibold text-gray-100">{entry.label}</span>
            <span className="mt-1 block text-xs leading-5 text-gray-400">{entry.capabilitySummary}</span>
            <span className="mt-1 block text-[11px] text-gray-500">{tf('settings.help.pricingVerified', { date: entry.lastVerifiedDate })}</span>
          </span>
        </button>
        <div className="flex shrink-0 gap-2 text-xs">
          <a className="text-blue-300 hover:text-blue-100" href={entry.signupUrl} rel="noreferrer" target="_blank">
            {t('settings.help.signUp')}
          </a>
          <a className="text-blue-300 hover:text-blue-100" href={entry.pricingUrl} rel="noreferrer" target="_blank">
            {t('settings.help.pricing')}
          </a>
        </div>
      </div>
      {expanded ? (
        <div className="space-y-2 border-t border-gray-800 px-4 pb-4 pt-3 text-xs leading-5 text-gray-400">
          <div>
            <div className="font-semibold uppercase tracking-[0.16em] text-gray-500">{t('settings.help.configure')}</div>
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              {entry.setupSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-[0.16em] text-gray-500">{t('settings.help.cost')}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {entry.costNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-[0.16em] text-gray-500">{t('settings.help.operations')}</div>
            <p className="mt-1 text-gray-400">
              {entry.supportedOperations.join(', ')}
            </p>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-[0.16em] text-gray-500">{t('settings.help.spendControls')}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {entry.spendControls.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-[0.16em] text-gray-500">{t('settings.help.troubleshooting')}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {entry.troubleshooting.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
          {entry.apiKeyUrl ? (
            <a className="inline-flex text-blue-300 hover:text-blue-100" href={entry.apiKeyUrl} rel="noreferrer" target="_blank">
              {t('settings.help.openApiKeyPage')}
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ImageModelPricingSection({ entries }: { entries: ImageModelPricingEntry[] }) {
  const { t } = useI18n();
  return (
    <Section title={t('settings.section.imageModelCostTable')}>
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#111217]/50">
        <div className="grid grid-cols-[1.1fr_1.6fr_1fr_1fr_0.9fr] gap-3 border-b border-gray-800 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
          <span>{t('settings.pricing.provider')}</span>
          <span>{t('settings.pricing.model')}</span>
          <span>{t('settings.pricing.operation')}</span>
          <span>{t('settings.pricing.cost')}</span>
          <span>{t('settings.pricing.confidence')}</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {entries.map((entry) => (
            <a
              className="grid grid-cols-[1.1fr_1.6fr_1fr_1fr_0.9fr] gap-3 border-b border-gray-900/80 px-4 py-2 text-xs text-gray-400 transition-colors last:border-b-0 hover:bg-blue-500/5"
              href={entry.sourceUrl}
              key={`${entry.providerId}:${entry.modelId}:${entry.operation}`}
              rel="noreferrer"
              target="_blank"
              title={`${entry.freeTierOrCredits} ${entry.notes.join(' ')}`}
            >
              <span className="text-gray-300">{getProviderLabel(entry.providerId)}</span>
              <span className="min-w-0 truncate text-gray-200">{entry.modelId}</span>
              <span>{entry.operation}</span>
              <span className="text-gray-100">
                {entry.unitPriceUsd === undefined ? entry.unit : `$${formatSettingsUsd(entry.unitPriceUsd)} / ${entry.unit}`}
              </span>
              <span>{entry.visibility}</span>
            </a>
          ))}
        </div>
      </div>
      <div className="text-xs leading-5 text-gray-500">
        {t('settings.pricing.footer')}
      </div>
    </Section>
  );
}

function formatSettingsUsd(value: number): string {
  if (value < 0.01) {
    return value.toFixed(4);
  }

  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function ApiKeyInput({ label, value, onChange, placeholder }: InputProps) {
  return (
    <form className="flex flex-col gap-1.5" onSubmit={(event) => event.preventDefault()}>
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <input
        autoComplete="username"
        className="sr-only"
        name={`${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-hint`}
        readOnly
        tabIndex={-1}
        type="text"
        value={label}
      />
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#111217] border border-gray-700 text-gray-200 text-sm rounded-lg p-2.5 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
        autoComplete="new-password"
        name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
      />
    </form>
  );
}

interface ThemeGridProps {
  activeThemeId: string;
  onChange: (themeId: string) => void;
  themes: InterfaceTheme[];
}

function ThemeGrid({ activeThemeId, onChange, themes }: ThemeGridProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-gray-300">{t('settings.grid.themePreviews')}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {themes.map((theme) => {
          const selected = theme.id === activeThemeId;
          return (
            <button
              aria-pressed={selected}
              className={`rounded-lg border p-2 text-left transition-all ${
                selected
                  ? 'border-[var(--sl-accent)] shadow-[0_0_0_1px_var(--sl-accent)]'
                  : 'border-gray-700/60 hover:border-gray-500'
              }`}
              key={theme.id}
              onClick={() => onChange(theme.id)}
              style={{
                background: theme.colors['--sl-panel'],
                color: theme.colors['--sl-text'],
              }}
              type="button"
            >
              <span className="block text-xs font-semibold">{theme.name}</span>
              <span className="mt-2 flex gap-1">
                {(['--sl-bg', '--sl-surface', '--sl-panel', '--sl-border', '--sl-accent'] as const).map((variable) => (
                  <span
                    className="h-4 flex-1 rounded-sm border border-white/10"
                    key={variable}
                    style={{ background: theme.colors[variable] }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CatalogStatusProps {
  isRefreshing: boolean;
  refreshError?: string;
  lastRefreshedAt?: string;
}

function CatalogStatus({ isRefreshing, refreshError, lastRefreshedAt }: CatalogStatusProps) {
  const { t, tf } = useI18n();
  return (
    <div className="rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-400">
      {isRefreshing ? t('settings.catalog.refreshing') : t('settings.catalog.auto')}
      {lastRefreshedAt ? ` ${tf('settings.catalog.lastRefresh', { time: new Date(lastRefreshedAt).toLocaleString() })}` : ''}
      <div className="mt-2 text-xs text-gray-500">
        {t('settings.catalog.ffmpegNote')}
      </div>
      {refreshError ? (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          {refreshError}
        </div>
      ) : null}
    </div>
  );
}

interface ConfiguredProviderGridProps<TCapability extends Capability> {
  capability: TCapability;
  configuredProviders: string[];
  defaultModels: Record<string, string>;
  modelCatalog: ReturnType<typeof useCatalogStore.getState>['modelCatalog'];
  onChange: (category: Capability, provider: string, value: string) => void;
}

function ConfiguredProviderGrid<TCapability extends Capability>({
  capability,
  configuredProviders,
  defaultModels,
  modelCatalog,
  onChange,
}: ConfiguredProviderGridProps<TCapability>) {
  const { t } = useI18n();
  if (configuredProviders.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-[#111217]/50 px-4 py-3 text-sm text-gray-400">
        {t('settings.grid.emptyProviders')}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {configuredProviders.map((provider) => {
        const modelValue = (defaultModels ?? {})[provider] ?? '';
        const options = getModelOptions(
          capability,
          provider as never,
          modelCatalog,
          modelValue,
        );

        return (
          <div key={`${capability}-${provider}`} className="space-y-2">
            <SelectInput
            key={`${capability}-${provider}`}
            label={getProviderLabel(provider as never)}
            onChange={(value) => onChange(capability, provider, value)}
            options={options}
            value={modelValue}
            />
            <TextInput
              label={t('settings.field.modelIdOverride')}
              onChange={(value) => onChange(capability, provider, value)}
              placeholder={t('settings.ph.modelId')}
              value={modelValue}
            />
          </div>
        );
      })}
    </div>
  );
}
