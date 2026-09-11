import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentProjectAuthorityClaim } from '../lib/nativeApp';
import {
  sanitizePersistedSourceBinState,
  useSourceBinStore,
} from './sourceBinStore';

afterEach(() => {
  setCurrentProjectAuthorityClaim(undefined);
  vi.unstubAllGlobals();
  useSourceBinStore.setState({
    bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
    dismissedSourceKeys: [],
    scratchDirectoryHandle: undefined,
    nativeScratchDirectoryPath: undefined,
  });
});

describe('relinked and consolidated Source Library persistence', () => {
  it('retains the professional fingerprint and online state through persisted-state sanitization', () => {
    const snapshot = sanitizePersistedSourceBinState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'camera-a',
          label: 'A001.mov',
          kind: 'video',
          mimeType: 'video/quicktime',
          assetUrl: 'signal-loom-asset://asset/camera-a',
          nativeFilePath: '/project/Media/A001.mov',
          createdAt: 2,
          professional: {
            version: 1,
            origin: 'imported',
            onlineState: 'online',
            sourceFingerprint: `sha256:${'a'.repeat(64)}`,
            proxy: { status: 'none' },
          },
        }],
      }],
    });

    expect(snapshot.bins?.[0].items[0]).toMatchObject({
      id: 'camera-a',
      nativeFilePath: '/project/Media/A001.mov',
      professional: {
        version: 1,
        origin: 'imported',
        onlineState: 'online',
        sourceFingerprint: `sha256:${'a'.repeat(64)}`,
        proxy: { status: 'none' },
      },
    });
  });

  it('keeps an opaque native URL online only when main proves its capability is available', async () => {
    const persisted = new Map<string, string>();
    vi.stubGlobal('window', {
      signalLoomNative: {
        getVideoMediaAvailability: vi.fn().mockResolvedValue({
          ok: true,
          items: [{ itemId: 'camera-a', available: true }],
          authority: { authorityId: 'media-project', version: 3 },
        }),
      },
      localStorage: {
        getItem: (key: string) => persisted.get(key) ?? null,
        setItem: (key: string, value: string) => persisted.set(key, value),
        removeItem: (key: string) => persisted.delete(key),
      },
    });
    setCurrentProjectAuthorityClaim({ authorityId: 'media-project', version: 3 });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'camera-a',
          label: 'A001.mov',
          kind: 'video',
          mimeType: 'video/quicktime',
          assetUrl: 'signal-loom-asset://asset/camera-a',
          nativeFilePath: '/project/Media/A001.mov',
          createdAt: 2,
          durability: 'unavailable',
          durabilityMessage: 'stale browser-only state',
          professional: { version: 1, origin: 'imported', onlineState: 'offline' },
        }],
      }],
      dismissedSourceKeys: [],
      scratchDirectoryHandle: undefined,
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(useSourceBinStore.getState().getAllItems()[0]).toMatchObject({
      id: 'camera-a',
      assetUrl: 'signal-loom-asset://asset/camera-a',
      nativeFilePath: '/project/Media/A001.mov',
      durability: undefined,
      durabilityMessage: undefined,
      professional: expect.objectContaining({ onlineState: 'online' }),
    });
  });

  it('marks cold-open external media offline and relink-required when main withholds capability', async () => {
    const persisted = new Map<string, string>();
    const getVideoMediaAvailability = vi.fn().mockResolvedValue({
      ok: true,
      items: [{ itemId: 'external-camera', available: false }],
      authority: { authorityId: 'cold-project', version: 1 },
    });
    vi.stubGlobal('window', {
      signalLoomNative: { getVideoMediaAvailability },
      localStorage: {
        getItem: (key: string) => persisted.get(key) ?? null,
        setItem: (key: string, value: string) => persisted.set(key, value),
        removeItem: (key: string) => persisted.delete(key),
      },
    });
    setCurrentProjectAuthorityClaim({ authorityId: 'cold-project', version: 1 });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'external-camera',
          label: 'External.mov',
          kind: 'video',
          mimeType: 'video/quicktime',
          assetUrl: 'signal-loom-asset://asset/external-camera',
          nativeFilePath: '/outside/project/External.mov',
          createdAt: 2,
          professional: { version: 1, origin: 'imported', onlineState: 'online' },
        }],
      }],
      dismissedSourceKeys: [],
      scratchDirectoryHandle: undefined,
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(getVideoMediaAvailability).toHaveBeenCalledWith({
      itemIds: ['external-camera'],
      claim: { authorityId: 'cold-project', version: 1 },
    });
    expect(useSourceBinStore.getState().getAllItems()[0]).toMatchObject({
      id: 'external-camera',
      assetUrl: undefined,
      nativeFilePath: '/outside/project/External.mov',
      durability: 'unavailable',
      durabilityMessage: expect.stringMatching(/Relink/),
      professional: expect.objectContaining({ onlineState: 'offline' }),
    });
  });
});
