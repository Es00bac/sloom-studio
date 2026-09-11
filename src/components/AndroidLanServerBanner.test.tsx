// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enabled: true,
  pin: '',
  available: true,
}));

const startAndroidLanServer = vi.hoisted(() => vi.fn(async () => ({
  running: true,
  port: 8723,
  ip: '192.168.1.42',
  pin: '481206',
  url: 'http://192.168.1.42:8723/',
})));
const stopAndroidLanServer = vi.hoisted(() => vi.fn(async () => null));
const setProviderSetting = vi.hoisted(() => vi.fn());

vi.mock('../lib/androidLanServer', () => ({
  isAndroidLanServerAvailable: () => h.available,
  OPEN_ANDROID_LAN_SERVER_EVENT: 'sloom-open-android-lan-server',
  startAndroidLanServer,
  stopAndroidLanServer,
}));

vi.mock('../store/settingsStore', () => ({
  useSettingsStore: () => ({
    providerSettings: {
      androidLanServerEnabled: h.enabled,
      androidLanServerPin: h.pin,
    },
    setProviderSetting,
  }),
}));

vi.mock('./TeamReviewStatusPanel', () => ({
  TeamReviewStatusPanel: () => <div data-team-review-host-surface="true">Team review host controls</div>,
}));

import { AndroidLanServerBanner } from './AndroidLanServerBanner';

afterEach(() => {
  h.enabled = true;
  h.pin = '';
  h.available = true;
  startAndroidLanServer.mockClear();
  stopAndroidLanServer.mockClear();
  setProviderSetting.mockClear();
});

describe('AndroidLanServerBanner', () => {
  it('starts desktop serving without rendering a URL or PIN over the canvas', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<AndroidLanServerBanner />);
      await Promise.resolve();
    });

    expect(startAndroidLanServer).toHaveBeenCalledWith(undefined, '');
    expect(container.innerHTML).toBe('');

    act(() => {
      window.dispatchEvent(new Event('sloom-open-android-lan-server'));
    });

    const manual = container.querySelector<HTMLDetailsElement>('[data-android-lan-manual-address="true"]');
    expect(container.textContent).toContain('Serve to another screen');
    expect(container.textContent).toContain('481206');
    expect(manual?.open).toBe(false);
    expect(container.querySelector('[data-team-review-host-surface="true"]')).not.toBeNull();

    act(() => root.unmount());
  });

  it('stops the service quietly when desktop serving is disabled', async () => {
    h.enabled = false;
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<AndroidLanServerBanner />);
      await Promise.resolve();
    });

    expect(stopAndroidLanServer).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe('');

    act(() => root.unmount());
  });
});
