import { Capacitor, registerPlugin } from '@capacitor/core';

export type AndroidFontPackDownloadStatus =
  | 'not-installed'
  | 'pending'
  | 'downloading'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'waiting-for-wifi'
  | 'confirmation-required'
  | 'corrupt'
  | 'unknown';

export interface AndroidFontPackStatus {
  supported: boolean;
  packName: string;
  downloaded: boolean;
  available: boolean;
  verified: boolean;
  status: AndroidFontPackDownloadStatus;
  bytesDownloaded: number;
  totalBytes: number;
  errorCode: number;
  errorMessage?: string;
  signature?: string;
}

interface AndroidFontResourceInfo {
  path: string;
  byteLength: number;
  sha256: string;
  chunkSize: number;
}

interface AndroidFontResourceChunk {
  path: string;
  offset: number;
  byteLength: number;
  base64: string;
}

interface SloomFontPackPlugin {
  getStatus(): Promise<AndroidFontPackStatus>;
  requestDownload(): Promise<AndroidFontPackStatus & { requested: boolean }>;
  cancelDownload(): Promise<AndroidFontPackStatus & { canceled: boolean }>;
  requestDownloadConfirmation(): Promise<{ accepted: boolean }>;
  getResourceInfo(options: { path: string }): Promise<AndroidFontResourceInfo>;
  readResourceChunk(options: { path: string; offset: number; length: number }): Promise<AndroidFontResourceChunk>;
}

const PLUGIN_CACHE_KEY = '__sloomFontPackPlugin';
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES = 1024 * 1024;
const SAFE_RESOURCE_PATH = /^[-A-Za-z0-9._/\u005B\u005D\u005C]{1,512}$/;

function getPlugin(): SloomFontPackPlugin {
  const globalState = globalThis as typeof globalThis & {
    [PLUGIN_CACHE_KEY]?: SloomFontPackPlugin;
  };
  if (!globalState[PLUGIN_CACHE_KEY]) {
    globalState[PLUGIN_CACHE_KEY] = registerPlugin<SloomFontPackPlugin>('SloomFontPack');
  }
  return globalState[PLUGIN_CACHE_KEY];
}

export function isAndroidFontPackRuntime(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function getAndroidFontPackStatus(): Promise<AndroidFontPackStatus> {
  if (!isAndroidFontPackRuntime()) {
    return {
      supported: false,
      packName: 'sloom_fonts',
      downloaded: false,
      available: false,
      verified: false,
      status: 'not-installed',
      bytesDownloaded: 0,
      totalBytes: 0,
      errorCode: 0,
    };
  }
  return getPlugin().getStatus();
}

export async function requestAndroidFontPackDownload(): Promise<AndroidFontPackStatus & { requested: boolean }> {
  if (!isAndroidFontPackRuntime()) {
    throw new Error('The optional publishing font pack can only be downloaded by the Android Play build.');
  }
  return getPlugin().requestDownload();
}

export async function requestAndroidFontPackDownloadConfirmation(): Promise<boolean> {
  if (!isAndroidFontPackRuntime()) return false;
  const result = await getPlugin().requestDownloadConfirmation();
  return result.accepted === true;
}

export async function cancelAndroidFontPackDownload(): Promise<AndroidFontPackStatus & { canceled: boolean }> {
  if (!isAndroidFontPackRuntime()) {
    throw new Error('The publishing font pack is not downloading in this runtime.');
  }
  return getPlugin().cancelDownload();
}

function validateResourcePath(path: string): void {
  if (!SAFE_RESOURCE_PATH.test(path) || path.startsWith('/') || path.includes('//')
    || path === '..' || path.includes('../') || path.endsWith('/..')) {
    throw new Error('The font resource path is invalid.');
  }
}

function decodeBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

/** Read one verified pack resource through bounded native chunks; no Android file path is exposed. */
export async function readAndroidFontPackResource(path: string): Promise<Uint8Array> {
  if (!isAndroidFontPackRuntime()) {
    throw new Error('The Android publishing font-pack transport is unavailable.');
  }
  validateResourcePath(path);
  const plugin = getPlugin();
  const info = await plugin.getResourceInfo({ path });
  if (info.path !== path || !Number.isSafeInteger(info.byteLength) || info.byteLength < 1
    || info.byteLength > MAX_RESOURCE_BYTES || !/^[0-9a-f]{64}$/.test(info.sha256)) {
    throw new Error('The Android font-pack resource metadata is invalid.');
  }
  const chunkSize = Math.min(
    MAX_CHUNK_BYTES,
    Number.isSafeInteger(info.chunkSize) && info.chunkSize > 0 ? info.chunkSize : MAX_CHUNK_BYTES,
  );
  const result = new Uint8Array(info.byteLength);
  for (let offset = 0; offset < info.byteLength; offset += chunkSize) {
    const length = Math.min(chunkSize, info.byteLength - offset);
    const chunk = await plugin.readResourceChunk({ path, offset, length });
    const decoded = decodeBase64(chunk.base64);
    if (chunk.path !== path || chunk.offset !== offset || chunk.byteLength !== length || decoded.byteLength !== length) {
      throw new Error('The Android font-pack resource chunk is malformed or out of order.');
    }
    result.set(decoded, offset);
  }
  return result;
}
