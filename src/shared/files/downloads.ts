import { inferDownloadExtension } from '../../lib/mediaFormatRegistry';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { showUserNotice } from '../ui/userNotice';

export interface DownloadRuntime {
  document?: Document;
  fetch?: typeof fetch;
  setTimeout?: (callback: () => void, delay?: number) => unknown;
  url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export type DownloadFileOutcome =
  | { status: 'started'; platform: 'browser' }
  | { status: 'saved'; platform: 'native'; uri: string; location: string }
  | { status: 'failed'; platform: 'browser' | 'native'; error: string };

export function buildDownloadFilename(
  baseName: string,
  mimeType: string | undefined,
  fallbackExtension: string,
): string {
  const safeBaseName = baseName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'flow-asset';
  return `${safeBaseName}.${inferDownloadExtension(mimeType, fallbackExtension)}`;
}

/**
 * Build a download filename for a Sloom Studio container format (`.slimg` / `.slppr`).
 * Unlike {@link buildDownloadFilename}, the extension is taken literally — these are our own
 * container types, not media MIME types, so they must not pass through MIME/extension inference.
 */
export function buildWorkspaceDownloadFilename(baseName: string | undefined, extension: string): string {
  const safeBaseName = (baseName ?? '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'signal-loom';
  const safeExtension = extension.replace(/^\.+/, '').toLowerCase();
  return `${safeBaseName}.${safeExtension}`;
}

export function downloadBlob(
  blob: Blob,
  fileName: string,
  runtime: DownloadRuntime = {},
): void {
  if (Capacitor.isNativePlatform()) {
    // Existing fire-and-forget callers still receive a durable success/failure notice. Callers that
    // must not report completion early use downloadBlobWithOutcome and await the same operation.
    void downloadBlobWithOutcome(blob, fileName, runtime);
    return;
  }

  startBrowserBlobDownload(blob, fileName, runtime);
}

function startBrowserBlobDownload(blob: Blob, fileName: string, runtime: DownloadRuntime): void {
  const { document, setTimeout, url } = resolveRuntime(runtime);
  const objectUrl = url.createObjectURL(blob);
  try {
    triggerHrefDownload(objectUrl, fileName, { document });
  } catch (error) {
    url.revokeObjectURL(objectUrl);
    throw error;
  }
  setTimeout(() => url.revokeObjectURL(objectUrl), 1000);
}

/** Awaitable download contract for callers whose user-facing status must reflect the real operation. */
export async function downloadBlobWithOutcome(
  blob: Blob,
  fileName: string,
  runtime: DownloadRuntime = {},
): Promise<DownloadFileOutcome> {
  if (Capacitor.isNativePlatform()) {
    try {
      const saved = await saveBlobOnDevice(blob, fileName);
      showUserNotice(`Saved “${fileName}” to ${saved.location}.`, 'success');
      return { status: 'saved', platform: 'native', ...saved };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showUserNotice(`Couldn’t save “${fileName}”: ${message}`, 'error');
      return { status: 'failed', platform: 'native', error: message };
    }
  }

  try {
    startBrowserBlobDownload(blob, fileName, runtime);
    // Browsers do not expose download completion. This means the user gesture was dispatched,
    // deliberately reported as "started" rather than claiming the file reached disk.
    return { status: 'started', platform: 'browser' };
  } catch (error) {
    return {
      status: 'failed',
      platform: 'browser',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write a blob to device storage on Capacitor. Public `Documents` is preferred (user-visible), but
 * scoped storage silently blocks raw writes there on many Android 13+ devices (targetSdk 33+), so we
 * fall back to the app's external files dir, then app-private data. Returns where it landed; throws
 * only if every target fails — so the caller surfaces a real error instead of failing silently.
 */
async function saveBlobOnDevice(blob: Blob, fileName: string): Promise<{ uri: string; location: string }> {
  const targets: Array<{ directory: Directory; location: string }> = [
    { directory: Directory.Documents, location: 'Documents' },
    { directory: Directory.External, location: 'app storage (Android ▸ data ▸ studio.sloom.slstapp ▸ files)' },
    { directory: Directory.Data, location: 'app private storage' },
  ];
  let lastError: unknown;
  for (const target of targets) {
    try {
      await writeBlobInChunks(blob, fileName, target.directory);
      const { uri } = await Filesystem.getUri({ directory: target.directory, path: fileName });
      return { uri, location: target.location };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Device storage is not writable.');
}

// Capacitor's `writeFile` takes the WHOLE file as a single base64 string and decodes it again in Java.
// For a large `.sloom` (mostly embedded base64 assets) that's a ~1.3× blob-sized string on top of the
// blob and the bridge copy — which OOMs the app heap (observed: tried to allocate ~70MB with ~6MB free).
// Stream it in heap-bounded chunks instead: writeFile the first chunk (create/truncate), append the rest.
// 3 MiB is a multiple of 3 bytes, so the per-chunk base64 strings concatenate to the exact file bytes.
const WRITE_CHUNK_BYTES = 3 * 1024 * 1024;

async function writeBlobInChunks(blob: Blob, path: string, directory: Directory): Promise<void> {
  if (blob.size <= WRITE_CHUNK_BYTES) {
    await Filesystem.writeFile({ path, data: await blobToBase64Data(blob), directory, recursive: true });
    return;
  }
  for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_BYTES) {
    const slice = blob.slice(offset, Math.min(offset + WRITE_CHUNK_BYTES, blob.size));
    const data = await blobToBase64Data(slice);
    if (offset === 0) {
      await Filesystem.writeFile({ path, data, directory, recursive: true });
    } else {
      await Filesystem.appendFile({ path, data, directory });
    }
  }
}

function blobToBase64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file for saving.'));
    reader.readAsDataURL(blob);
  });
}

export function downloadTextFile(
  fileName: string,
  contents: string,
  mimeType = 'text/plain',
  runtime: DownloadRuntime = {},
): void {
  downloadBlob(new Blob([contents], { type: mimeType }), fileName, runtime);
}

export function downloadTextFileWithOutcome(
  fileName: string,
  contents: string,
  mimeType = 'text/plain',
  runtime: DownloadRuntime = {},
): Promise<DownloadFileOutcome> {
  return downloadBlobWithOutcome(new Blob([contents], { type: mimeType }), fileName, runtime);
}

export function downloadJsonFile(
  fileName: string,
  payload: unknown,
  runtime: DownloadRuntime = {},
): void {
  downloadTextFile(fileName, JSON.stringify(payload, null, 2), 'application/json', runtime);
}

export async function downloadUrlAsFile(
  assetUrl: string,
  fileName: string,
  runtime: DownloadRuntime = {},
): Promise<void> {
  const resolved = resolveRuntime(runtime);

  try {
    const response = await resolved.fetch(assetUrl);

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    downloadBlob(await response.blob(), fileName, resolved);
    return;
  } catch {
    triggerHrefDownload(assetUrl, fileName, {
      document: resolved.document,
      rel: 'noreferrer',
      target: '_blank',
    });
  }
}

export const downloadAsset = downloadUrlAsFile;

function triggerHrefDownload(
  href: string,
  fileName: string,
  options: {
    document: Document;
    rel?: string;
    target?: string;
  },
): void {
  const anchor = options.document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  if (options.target) anchor.target = options.target;
  if (options.rel) anchor.rel = options.rel;
  options.document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function resolveRuntime(runtime: DownloadRuntime): Required<DownloadRuntime> {
  return {
    document: runtime.document ?? document,
    fetch: runtime.fetch ?? fetch,
    setTimeout: runtime.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay)),
    url: runtime.url ?? URL,
  };
}
