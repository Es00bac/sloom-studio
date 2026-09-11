import { describe, expect, it } from 'vitest';
import {
  buildScratchAssetFileName,
  createScratchAssetManifest,
  getExtensionForMimeType,
  sanitizeFileSystemName,
  selectMostRecentScratchWorkspaceRecord,
  storeScratchAssetBlob,
} from './fileSystemWorkspace';
import type { SourceBinProjectSnapshot } from '../store/sourceBinStore';

describe('file system workspace helpers', () => {
  it('sanitizes project and asset names for local file system writes', () => {
    expect(sanitizeFileSystemName(' My / Weird : Project * Name ')).toBe('My-Weird-Project-Name');
    expect(sanitizeFileSystemName('')).toBe('signal-loom-project');
  });

  it('derives stable scratch asset filenames from source-bin items', () => {
    expect(
      buildScratchAssetFileName({
        id: 'source-video-1',
        label: 'Hero Clip',
        kind: 'video',
        mimeType: 'video/mp4',
        assetUrl: 'data:video/mp4;base64,AAA',
        createdAt: 1,
      }),
    ).toBe('source-video-1-Hero-Clip.mp4');
  });

  it('uses an existing scratch file name when a source item is already scratch-backed', () => {
    expect(
      buildScratchAssetFileName({
        id: 'source-video-1',
        label: 'Hero Clip',
        kind: 'video',
        mimeType: 'video/mp4',
        scratchFileName: 'already-on-scratch.mp4',
        createdAt: 1,
      }),
    ).toBe('already-on-scratch.mp4');
  });

  it('maps common media mime types to useful extensions', () => {
    expect(getExtensionForMimeType('image/png', 'image')).toBe('png');
    expect(getExtensionForMimeType('image/jpeg', 'image')).toBe('jpg');
    expect(getExtensionForMimeType('audio/mpeg', 'audio')).toBe('mp3');
    expect(getExtensionForMimeType(undefined, 'composition')).toBe('mp4');
  });

  it('builds a scratch asset manifest for media items only', () => {
    const snapshot: SourceBinProjectSnapshot = {
      dismissedSourceKeys: [],
      items: [
        {
          id: 'text-1',
          label: 'Prompt',
          kind: 'text',
          text: 'hello',
          createdAt: 1,
        },
        {
          id: 'image-1',
          label: 'Reference Image',
          kind: 'image',
          mimeType: 'image/png',
          assetId: 'stored-image-asset',
          createdAt: 2,
        },
      ],
    };

    expect(createScratchAssetManifest(snapshot)).toEqual([
      {
        id: 'image-1',
        label: 'Reference Image',
        kind: 'image',
        mimeType: 'image/png',
        fileName: 'image-1-Reference-Image.png',
        originNodeId: undefined,
        sourceKey: undefined,
      },
    ]);
  });

  it('stores scratch assets without routing large media through IndexedDB', async () => {
    const writes: Array<{ fileName: string; blob: Blob }> = [];
    const directoryHandle = {
      async getFileHandle(fileName: string) {
        return {
          async createWritable() {
            return {
              async write(blob: Blob) {
                writes.push({ fileName, blob });
              },
              async close() {},
            };
          },
        };
      },
    } as unknown as FileSystemDirectoryHandle;
    const blob = new Blob(['video-bytes'], { type: 'video/mp4' });

    const stored = await storeScratchAssetBlob({
      scratchDirectoryHandle: directoryHandle,
      item: {
        id: 'source-video-1',
        label: 'Hero Clip',
        kind: 'video',
        mimeType: 'video/mp4',
      },
      blob,
      createObjectUrl: () => 'blob:scratch-video',
    });

    expect(stored).toEqual({
      fileName: 'source-video-1-Hero-Clip.mp4',
      assetUrl: 'blob:scratch-video',
    });
    expect(writes).toEqual([{ fileName: 'source-video-1-Hero-Clip.mp4', blob }]);
  });

  it('selects the most recently linked scratch workspace for crash-reload recovery', () => {
    const olderScratchHandle = { name: 'old-scratch' } as FileSystemDirectoryHandle;
    const newerScratchHandle = { name: 'xtra-scratch' } as FileSystemDirectoryHandle;

    expect(
      selectMostRecentScratchWorkspaceRecord([
        {
          projectId: 'browser-only',
          updatedAt: 30,
        },
        {
          projectId: 'older',
          scratchDirectoryHandle: olderScratchHandle,
          updatedAt: 10,
        },
        {
          projectId: 'newer',
          scratchDirectoryHandle: newerScratchHandle,
          updatedAt: 20,
        },
      ]),
    ).toMatchObject({
      projectId: 'newer',
      scratchDirectoryHandle: newerScratchHandle,
    });
  });
});
