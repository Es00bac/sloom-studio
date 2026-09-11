import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { DEFAULT_PROVIDER_SETTINGS } from '../../lib/providerCatalog';

let mockSettingsPanel: 'providers' | 'keyboard' | 'gamepad' | 'fonts' = 'providers';

vi.mock('../DockablePanel', () => ({
  DockableDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../store/settingsStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/settingsStore')>('../../store/settingsStore');

  return {
    ...actual,
    getApiKeyStorageStatus: () => ({
      storageMedium: 'local-storage' as const,
      encryptedAtRest: false,
      caveat: 'API keys are stored in browser localStorage without at-rest encryption in this app.',
    }),
    useSettingsStore: () => ({
      isSettingsOpen: true,
      settingsPanel: mockSettingsPanel,
      apiKeys: {
        openai: '',
        gemini: '',
        huggingface: '',
        elevenlabs: '',
        bfl: '',
        stability: '',
      },
      defaultModels: { text: {}, image: {}, video: {}, audio: {} },
      keyboardShortcuts: {},
      openFontLibrary: [],
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        batchMaxRetries: 7,
        batchRetryBaseDelayMs: 42000,
      },
      setProviderSetting: vi.fn(),
      setDefaultModel: vi.fn(),
      setKeyboardShortcut: vi.fn(),
      resetKeyboardShortcuts: vi.fn(),
      addOpenFontLibraryFace: vi.fn(),
      openSettings: vi.fn((panel?: 'providers' | 'keyboard' | 'gamepad' | 'fonts') => {
        mockSettingsPanel = panel ?? 'providers';
      }),
      toggleSettings: vi.fn(),
    }),
  };
});

describe('SettingsModal', () => {
  it('displays API key storage readiness caveat in provider mode', () => {
    mockSettingsPanel = 'providers';
    const html = renderToStaticMarkup(<SettingsModal />);

    expect(html).toContain('Keys are');
    expect(html).toContain('local-storage');
    expect(html).toContain('not encrypted');
  });

  it('renders numeric inputs for batch generation retry configuration', () => {
    mockSettingsPanel = 'providers';
    const html = renderToStaticMarkup(<SettingsModal />);

    expect(html).toContain('Batch max retries');
    expect(html).toContain('value="7"');

    expect(html).toContain('Batch retry base delay (ms)');
    expect(html).toContain('value="42000"');
    expect(html).toContain('Local native render token');
    expect(html).toContain('Matches SIGNAL_LOOM_NATIVE_RENDER_TOKEN');
  });

  it('mounts the self-hosted project authority setup with its no-hosted-cloud boundary', () => {
    mockSettingsPanel = 'providers';
    const html = renderToStaticMarkup(<SettingsModal />);

    expect(html).toContain('Self-hosted project authority');
    expect(html).toContain('Check authority');
    expect(html).toContain('not Sloom-hosted cloud storage');
  });

  it('renders the opt-in Fonts settings tab without browsing automatically', () => {
    mockSettingsPanel = 'fonts';
    const html = renderToStaticMarkup(<SettingsModal />);

    expect(html).toContain('Fonts');
    expect(html).toContain('Browse open fonts');
  });

  it('renders editable keyboard shortcuts with defaults and a reset action', () => {
    mockSettingsPanel = 'keyboard';
    const html = renderToStaticMarkup(<SettingsModal />);

    expect(html).toContain('Keyboard Shortcuts');
    expect(html).toContain('Reset Defaults');
    expect(html).toContain('Ctrl+N');
    expect(html).toContain('>New</div>');
    expect(html).toContain('>file:new</div>');
  });
});
