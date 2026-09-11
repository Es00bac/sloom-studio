import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { value: 'android' },
  setFullscreen: vi.fn(async (options: { enabled: boolean }) => ({ enabled: options.enabled })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform.value },
  registerPlugin: () => ({ setFullscreen: mocks.setFullscreen }),
}));

import { isAndroidNativeFullscreenAvailable, setAndroidFullscreen } from './androidSystemUi';

describe('androidSystemUi', () => {
  afterEach(() => {
    mocks.platform.value = 'android';
    mocks.setFullscreen.mockClear();
  });

  it('reports availability only on the native Android platform', () => {
    mocks.platform.value = 'android';
    expect(isAndroidNativeFullscreenAvailable()).toBe(true);
    mocks.platform.value = 'web';
    expect(isAndroidNativeFullscreenAvailable()).toBe(false);
    mocks.platform.value = 'ios';
    expect(isAndroidNativeFullscreenAvailable()).toBe(false);
  });

  it('enters fullscreen via the native plugin and returns the applied state', async () => {
    await expect(setAndroidFullscreen(true)).resolves.toBe(true);
    expect(mocks.setFullscreen).toHaveBeenCalledWith({ enabled: true });
  });

  it('exits fullscreen via the native plugin', async () => {
    await expect(setAndroidFullscreen(false)).resolves.toBe(false);
    expect(mocks.setFullscreen).toHaveBeenCalledWith({ enabled: false });
  });
});
