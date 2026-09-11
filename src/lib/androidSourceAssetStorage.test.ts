import { describe, expect, it, vi } from 'vitest';
import {
  ANDROID_SOURCE_ASSET_DIRECTORY,
  materializeAndroidSourceAsset,
  shouldRequestAndroidPublicStoragePermission,
} from './androidSourceAssetStorage';

describe('androidSourceAssetStorage', () => {
  it('detects when public storage permission must be requested', () => {
    expect(shouldRequestAndroidPublicStoragePermission({ publicStorage: 'prompt' })).toBe(true);
    expect(shouldRequestAndroidPublicStoragePermission({ publicStorage: 'prompt-with-rationale' })).toBe(true);
    expect(shouldRequestAndroidPublicStoragePermission({ publicStorage: 'denied' })).toBe(true);
    expect(shouldRequestAndroidPublicStoragePermission({ publicStorage: 'granted' })).toBe(false);
  });

  it('materializes generated assets into Android Documents with a usable WebView URL', async () => {
    const filesystem = {
      checkPermissions: vi.fn(async () => ({ publicStorage: 'prompt' as const })),
      requestPermissions: vi.fn(async () => ({ publicStorage: 'granted' as const })),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ uri: 'file:///storage/emulated/0/Documents/Sloom Studio/Source Library/panel.png' })),
      getUri: vi.fn(),
    };

    const item = await materializeAndroidSourceAsset({
      id: 'panel-1',
      label: 'Panel One',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      isGenerated: true,
      originNodeId: 'image-node-1',
      sourceKey: 'image:image-node-1:data:image/png;base64,AAAA',
    }, {
      capacitor: {
        convertFileSrc: (uri) => `capacitor://${uri}`,
        getPlatform: () => 'android',
        isNativePlatform: () => true,
      },
      filesystem,
    });

    expect(filesystem.requestPermissions).toHaveBeenCalledOnce();
    expect(filesystem.mkdir).toHaveBeenCalledWith({
      directory: 'DOCUMENTS',
      path: ANDROID_SOURCE_ASSET_DIRECTORY,
      recursive: true,
    });
    expect(filesystem.writeFile).toHaveBeenCalledWith({
      data: 'AAAA',
      directory: 'DOCUMENTS',
      path: `${ANDROID_SOURCE_ASSET_DIRECTORY}/panel-1-Panel-One.png`,
      recursive: true,
    });
    expect(item).toMatchObject({
      id: 'panel-1',
      label: 'Panel One',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: 'capacitor://file:///storage/emulated/0/Documents/Sloom Studio/Source Library/panel.png',
      nativeFilePath: 'file:///storage/emulated/0/Documents/Sloom Studio/Source Library/panel.png',
      isGenerated: true,
      originNodeId: 'image-node-1',
    });
  });

  it('falls back to app-private Android data storage when public storage permission is denied', async () => {
    const filesystem = {
      checkPermissions: vi.fn(async () => ({ publicStorage: 'denied' as const })),
      requestPermissions: vi.fn(async () => ({ publicStorage: 'denied' as const })),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => ({ uri: 'file:///data/user/0/studio.sloom.slstapp/files/Sloom Studio/Source Library/panel-denied.png' })),
      getUri: vi.fn(),
    };

    const item = await materializeAndroidSourceAsset({
      id: 'panel-denied',
      label: 'Denied',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
    }, {
      capacitor: {
        convertFileSrc: (uri) => uri,
        getPlatform: () => 'android',
        isNativePlatform: () => true,
      },
      filesystem,
    });

    expect(filesystem.requestPermissions).toHaveBeenCalledOnce();
    expect(filesystem.mkdir).toHaveBeenCalledWith({
      directory: 'DATA',
      path: ANDROID_SOURCE_ASSET_DIRECTORY,
      recursive: true,
    });
    expect(filesystem.writeFile).toHaveBeenCalledWith({
      data: 'AAAA',
      directory: 'DATA',
      path: `${ANDROID_SOURCE_ASSET_DIRECTORY}/panel-denied-Denied.png`,
      recursive: true,
    });
    expect(item).toMatchObject({
      id: 'panel-denied',
      assetUrl: 'file:///data/user/0/studio.sloom.slstapp/files/Sloom Studio/Source Library/panel-denied.png',
      nativeFilePath: 'file:///data/user/0/studio.sloom.slstapp/files/Sloom Studio/Source Library/panel-denied.png',
    });
  });
});
