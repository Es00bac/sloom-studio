import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem, type PermissionStatus } from '@capacitor/filesystem';
import { buildScratchAssetFileName } from './fileSystemWorkspace';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { EditorSourceKind } from '../types/flow';

export const ANDROID_SOURCE_ASSET_DIRECTORY = 'Sloom Studio/Source Library';

export class AndroidSourceAssetPermissionError extends Error {
  constructor(message = 'Sloom Studio needs Android file storage access before it can save generated assets.') {
    super(message);
    this.name = 'AndroidSourceAssetPermissionError';
  }
}

interface AndroidSourceAssetInput {
  id?: string;
  label: string;
  kind: Exclude<EditorSourceKind, 'text'>;
  mimeType: string;
  dataUrl: string;
  blob?: Blob;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  sourceKey?: string;
  originNodeId?: string;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
}

type AndroidFilesystemRuntime = Pick<typeof Filesystem, 'checkPermissions' | 'requestPermissions' | 'mkdir' | 'writeFile' | 'getUri'>;

type AndroidCapacitorRuntime = Pick<typeof Capacitor, 'convertFileSrc' | 'getPlatform' | 'isNativePlatform'>;

export interface AndroidSourceAssetRuntime {
  capacitor?: AndroidCapacitorRuntime;
  filesystem?: AndroidFilesystemRuntime;
  fetch?: typeof fetch;
}

export function shouldRequestAndroidPublicStoragePermission(status: PermissionStatus): boolean {
  return status.publicStorage !== 'granted';
}

export function isAndroidSourceAssetPermissionError(error: unknown): error is AndroidSourceAssetPermissionError {
  return error instanceof AndroidSourceAssetPermissionError
    || (error instanceof Error && error.name === 'AndroidSourceAssetPermissionError');
}

export async function materializeAndroidSourceAsset(
  input: AndroidSourceAssetInput,
  runtime: AndroidSourceAssetRuntime = {},
): Promise<SourceBinLibraryItem | undefined> {
  const capacitor = runtime.capacitor ?? Capacitor;
  const filesystem = runtime.filesystem ?? Filesystem;

  if (!capacitor.isNativePlatform() || capacitor.getPlatform() !== 'android') {
    return undefined;
  }

  const directory = await resolveAndroidSourceAssetDirectory(filesystem);

  const id = input.id ?? globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`;
  const blob = input.blob ?? await sourceAssetInputToBlob(input, runtime.fetch ?? fetch);
  const mimeType = blob.type || input.mimeType || 'application/octet-stream';
  const fileName = buildScratchAssetFileName({
    id,
    label: input.label,
    kind: input.kind,
    mimeType,
    createdAt: input.createdAt ?? Date.now(),
  });
  const path = `${ANDROID_SOURCE_ASSET_DIRECTORY}/${fileName}`;

  await filesystem.mkdir({
    directory,
    path: ANDROID_SOURCE_ASSET_DIRECTORY,
    recursive: true,
  }).catch((error) => {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  });

  const result = await filesystem.writeFile({
    data: await sourceAssetInputToBase64(input, blob),
    directory,
    path,
    recursive: true,
  });
  const nativeFilePath = result.uri || (await filesystem.getUri({ directory, path })).uri;

  return {
    id,
    label: input.label,
    kind: input.kind,
    mimeType,
    assetUrl: capacitor.convertFileSrc(nativeFilePath),
    nativeFilePath,
    createdAt: input.createdAt ?? Date.now(),
    sourceKey: input.sourceKey,
    originNodeId: input.originNodeId,
    isGenerated: input.isGenerated,
    pixelWidth: input.pixelWidth,
    pixelHeight: input.pixelHeight,
    envelopeId: input.envelopeId,
    envelopeLabel: input.envelopeLabel,
    envelopeIndex: input.envelopeIndex,
    envelopeCollapsed: input.envelopeCollapsed,
  };
}

async function resolveAndroidSourceAssetDirectory(filesystem: AndroidFilesystemRuntime): Promise<Directory> {
  const checked = await filesystem.checkPermissions().catch(() => ({ publicStorage: 'prompt' as const }));
  if (!shouldRequestAndroidPublicStoragePermission(checked)) {
    return Directory.Documents;
  }

  const status = await filesystem.requestPermissions().catch(() => ({ publicStorage: 'denied' as const }));

  return shouldRequestAndroidPublicStoragePermission(status)
    ? Directory.Data
    : Directory.Documents;
}

async function sourceAssetInputToBlob(input: AndroidSourceAssetInput, fetchImpl: typeof fetch): Promise<Blob> {
  if (input.dataUrl.startsWith('data:') || input.dataUrl.startsWith('blob:')) {
    const response = await fetchImpl(input.dataUrl);
    const blob = await response.blob();
    return blob.type || !input.mimeType ? blob : new Blob([blob], { type: input.mimeType });
  }

  const response = await fetchImpl(input.dataUrl);
  if (!response.ok) {
    throw new Error(`Generated asset fetch failed with status ${response.status}.`);
  }
  const blob = await response.blob();
  return blob.type || !input.mimeType ? blob : new Blob([blob], { type: input.mimeType });
}

async function sourceAssetInputToBase64(input: AndroidSourceAssetInput, blob: Blob): Promise<string> {
  if (!input.blob && input.dataUrl.startsWith('data:')) {
    return input.dataUrl.split(',', 2)[1] ?? '';
  }

  return blobToBase64(blob);
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read generated asset bytes.'));
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Generated asset bytes could not be converted to base64.'));
          return;
        }

        resolve(reader.result.split(',', 2)[1] ?? '');
      };
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /exist|already/i.test(error.message);
}
