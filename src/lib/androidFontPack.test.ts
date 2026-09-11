import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  getStatus: vi.fn(),
  requestDownload: vi.fn(),
  requestDownloadConfirmation: vi.fn(),
  cancelDownload: vi.fn(),
  getResourceInfo: vi.fn(),
  readResourceChunk: vi.fn(),
  registerPlugin: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: (...args: unknown[]) => {
    mocks.registerPlugin(...args);
    return {
      getStatus: mocks.getStatus,
      requestDownload: mocks.requestDownload,
      requestDownloadConfirmation: mocks.requestDownloadConfirmation,
      cancelDownload: mocks.cancelDownload,
      getResourceInfo: mocks.getResourceInfo,
      readResourceChunk: mocks.readResourceChunk,
    };
  },
}));

import {
  getAndroidFontPackStatus,
  isAndroidFontPackRuntime,
  readAndroidFontPackResource,
  requestAndroidFontPackDownload,
} from './androidFontPack';

describe('Android Play Asset Delivery font transport', () => {
  beforeEach(() => {
    mocks.platform = 'web';
    vi.clearAllMocks();
    delete (globalThis as typeof globalThis & { __sloomFontPackPlugin?: unknown }).__sloomFontPackPlugin;
  });

  it('stays unavailable without registering a native plugin on web', async () => {
    expect(isAndroidFontPackRuntime()).toBe(false);
    await expect(getAndroidFontPackStatus()).resolves.toMatchObject({ supported: false, available: false });
    await expect(requestAndroidFontPackDownload()).rejects.toThrow(/Android Play build/i);
    expect(mocks.registerPlugin).not.toHaveBeenCalled();
  });

  it('requests the optional pack through the Android plugin', async () => {
    mocks.platform = 'android';
    mocks.requestDownload.mockResolvedValue({ requested: true, status: 'pending' });
    await expect(requestAndroidFontPackDownload()).resolves.toMatchObject({ requested: true, status: 'pending' });
    expect(mocks.registerPlugin).toHaveBeenCalledWith('SloomFontPack');
  });

  it('assembles bounded native chunks in order', async () => {
    mocks.platform = 'android';
    mocks.getResourceInfo.mockResolvedValue({
      path: 'collection/base/example/font.ttf',
      byteLength: 5,
      sha256: 'a'.repeat(64),
      chunkSize: 3,
    });
    mocks.readResourceChunk
      .mockResolvedValueOnce({ path: 'collection/base/example/font.ttf', offset: 0, byteLength: 3, base64: 'AQID' })
      .mockResolvedValueOnce({ path: 'collection/base/example/font.ttf', offset: 3, byteLength: 2, base64: 'BAU=' });

    await expect(readAndroidFontPackResource('collection/base/example/font.ttf'))
      .resolves.toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(mocks.readResourceChunk).toHaveBeenCalledTimes(2);
  });

  it('rejects traversal and malformed native chunks', async () => {
    mocks.platform = 'android';
    await expect(readAndroidFontPackResource('../secret')).rejects.toThrow(/path is invalid/i);

    mocks.getResourceInfo.mockResolvedValue({
      path: 'inventory/font-inventory.json',
      byteLength: 2,
      sha256: 'b'.repeat(64),
      chunkSize: 2,
    });
    mocks.readResourceChunk.mockResolvedValue({
      path: 'inventory/font-inventory.json', offset: 1, byteLength: 2, base64: 'e30=',
    });
    await expect(readAndroidFontPackResource('inventory/font-inventory.json')).rejects.toThrow(/out of order/i);
  });
});
