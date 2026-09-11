import type { FlowProjectDocument } from './projectLibrary';
import type { SourceBinProjectSnapshot, SourceBinLibraryItem } from '../store/sourceBinStore';
import { loadImportedAssetBlob } from './assetStore';
import { inferDownloadExtension } from './mediaFormatRegistry';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import { sanitizeProjectDocument } from './projectValidation';

export const PROJECT_DOCUMENT_FILE_NAME = 'signal-loom-project.sloom';
export const SCRATCH_MANIFEST_FILE_NAME = 'scratch-manifest.json';
export const DEFAULT_SCRATCH_DIRECTORY_NAME = 'scratch';

const DB_NAME = 'signal-loom-file-system-workspaces';
const DB_VERSION = 1;
const STORE_NAME = 'handles';

interface FileSystemWorkspaceRecord {
  projectId: string;
  projectDirectoryHandle?: FileSystemDirectoryHandle;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
  projectDirectoryName?: string;
  scratchDirectoryName?: string;
  updatedAt: number;
}

export interface FileSystemWorkspaceSummary {
  projectId: string;
  projectDirectoryName?: string;
  scratchDirectoryName?: string;
  hasProjectDirectory: boolean;
  hasScratchDirectory: boolean;
}

export interface ScratchAssetManifestEntry {
  id: string;
  label: string;
  kind: SourceBinLibraryItem['kind'];
  mimeType?: string;
  fileName: string;
  originNodeId?: string;
  sourceKey?: string;
}

export interface FileSystemSaveResult {
  projectDirectoryName: string;
  scratchDirectoryName: string;
  scratchAssetCount: number;
}

type DirectoryPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (!picker) {
    throw new Error('This browser does not support choosing local project folders.');
  }

  return picker({ mode: 'readwrite' });
}

export function sanitizeFileSystemName(value: string, fallback = 'signal-loom-project'): string {
  const sanitized = value
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallback;
}

export function getExtensionForMimeType(
  mimeType: string | undefined,
  kind: SourceBinLibraryItem['kind'],
): string {
  return inferDownloadExtension(mimeType, getFallbackExtensionForSourceKind(kind));
}

function getFallbackExtensionForSourceKind(kind: SourceBinLibraryItem['kind']): string {
  switch (kind) {
    case 'image': return 'png';
    case 'video':
    case 'composition': return 'mp4';
    case 'audio': return 'mp3';
    case 'text': return 'txt';
    case 'document': return 'pdf';
    case 'subtitle': return 'vtt';
    case 'package': return 'zip';
  }
}

export function buildScratchAssetFileName(
  item: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'mimeType' | 'scratchFileName' | 'createdAt'> & { assetUrl?: string },
): string {
  if (item.scratchFileName) {
    return item.scratchFileName;
  }

  const extension = getExtensionForMimeType(item.mimeType, item.kind);
  const idPart = sanitizeFileSystemName(item.id, 'asset');
  const labelPart = sanitizeFileSystemName(item.label, item.kind);

  return `${idPart}-${labelPart}.${extension}`;
}

export async function storeScratchAssetBlob(input: {
  scratchDirectoryHandle: FileSystemDirectoryHandle;
  item: Pick<SourceBinLibraryItem, 'id' | 'label' | 'kind' | 'mimeType' | 'scratchFileName'>;
  blob: Blob;
  createObjectUrl?: (blob: Blob) => string;
}): Promise<{ fileName: string; assetUrl: string }> {
  const fileName = buildScratchAssetFileName({
    ...input.item,
    createdAt: 0,
  });
  await writeBlobFile(input.scratchDirectoryHandle, fileName, input.blob);

  return {
    fileName,
    assetUrl: (input.createObjectUrl ?? URL.createObjectURL)(input.blob),
  };
}

export async function loadScratchAssetBlob(
  scratchDirectoryHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<File> {
  const fileHandle = await scratchDirectoryHandle.getFileHandle(fileName);
  return fileHandle.getFile();
}

export function createScratchAssetManifest(
  snapshot: SourceBinProjectSnapshot,
): ScratchAssetManifestEntry[] {
  return collectSnapshotItems(snapshot).flatMap((item) => {
    if (item.kind === 'text' || (!item.assetUrl && !item.assetId)) {
      return [];
    }

    return [{
      id: item.id,
      label: item.label,
      kind: item.kind,
      mimeType: item.mimeType,
      fileName: buildScratchAssetFileName(item),
      originNodeId: item.originNodeId,
      sourceKey: item.sourceKey,
    }];
  });
}

function collectSnapshotItems(
  snapshot: SourceBinProjectSnapshot,
): Array<SourceBinLibraryItem & { assetUrl?: string }> {
  if (Array.isArray(snapshot.bins) && snapshot.bins.length > 0) {
    return snapshot.bins.flatMap((bin) => bin.items);
  }

  return snapshot.items ?? [];
}

export async function saveProjectDocumentToDirectory(
  projectDirectoryHandle: FileSystemDirectoryHandle,
  document: FlowProjectDocument,
): Promise<void> {
  await writeTextFile(
    projectDirectoryHandle,
    PROJECT_DOCUMENT_FILE_NAME,
    JSON.stringify(document, null, 2),
  );
}

export async function loadProjectDocumentFromDirectory(
  projectDirectoryHandle: FileSystemDirectoryHandle,
): Promise<FlowProjectDocument> {
  const fileHandle = await projectDirectoryHandle.getFileHandle(PROJECT_DOCUMENT_FILE_NAME);
  const file = await fileHandle.getFile();
  try {
    return sanitizeProjectDocument(JSON.parse(await file.text()), projectDirectoryHandle.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : `The selected folder does not contain a valid ${PROJECT_DOCUMENT_FILE_NAME}.`;
    throw new Error(message);
  }
}

export async function saveProjectWorkspaceToFileSystem(input: {
  document: FlowProjectDocument;
  projectDirectoryHandle: FileSystemDirectoryHandle;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
}): Promise<FileSystemSaveResult> {
  const scratchDirectoryHandle =
    input.scratchDirectoryHandle ??
    await input.projectDirectoryHandle.getDirectoryHandle(DEFAULT_SCRATCH_DIRECTORY_NAME, { create: true });
  const scratchAssetCount = input.document.sourceBin
    ? await writeScratchAssets(scratchDirectoryHandle, input.document.sourceBin)
    : 0;
  const document: FlowProjectDocument = {
    ...input.document,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    savedAt: Date.now(),
    fileSystem: {
      projectDirectoryName: input.projectDirectoryHandle.name,
      scratchDirectoryName: scratchDirectoryHandle.name,
      lastSavedToFolderAt: Date.now(),
      scratchAssetCount,
    },
  };

  await saveProjectDocumentToDirectory(input.projectDirectoryHandle, document);

  return {
    projectDirectoryName: input.projectDirectoryHandle.name,
    scratchDirectoryName: scratchDirectoryHandle.name,
    scratchAssetCount,
  };
}

export async function writeScratchAssets(
  scratchDirectoryHandle: FileSystemDirectoryHandle,
  sourceBin: SourceBinProjectSnapshot,
): Promise<number> {
  const manifest = createScratchAssetManifest(sourceBin);
  const allItems = collectSnapshotItems(sourceBin);

  for (const entry of manifest) {
    const item = allItems.find((candidate) => candidate.id === entry.id);

    if (!item?.assetUrl && !item?.assetId) {
      continue;
    }

    const blob = item.assetUrl
      ? await urlToBlob(item.assetUrl, item.mimeType)
      : item.assetId
        ? (await loadImportedAssetBlob(item.assetId))?.blob
        : undefined;

    if (!blob) {
      continue;
    }

    await writeBlobFile(scratchDirectoryHandle, entry.fileName, blob);
  }

  await writeTextFile(
    scratchDirectoryHandle,
    SCRATCH_MANIFEST_FILE_NAME,
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      assets: manifest,
    }, null, 2),
  );

  return manifest.length;
}

export async function saveFileSystemWorkspaceHandles(input: {
  projectId: string;
  projectDirectoryHandle?: FileSystemDirectoryHandle;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
}): Promise<FileSystemWorkspaceSummary> {
  const existing = await loadFileSystemWorkspaceRecord(input.projectId);
  const record: FileSystemWorkspaceRecord = {
    projectId: input.projectId,
    projectDirectoryHandle: input.projectDirectoryHandle ?? existing?.projectDirectoryHandle,
    scratchDirectoryHandle: input.scratchDirectoryHandle ?? existing?.scratchDirectoryHandle,
    projectDirectoryName:
      input.projectDirectoryHandle?.name ?? existing?.projectDirectoryName ?? existing?.projectDirectoryHandle?.name,
    scratchDirectoryName:
      input.scratchDirectoryHandle?.name ?? existing?.scratchDirectoryName ?? existing?.scratchDirectoryHandle?.name,
    updatedAt: Date.now(),
  };
  const database = await openWorkspaceDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Failed to save local folder handles for this project.'));
    store.put(record);
  });

  database.close();
  return summarizeWorkspaceRecord(record);
}

export async function loadFileSystemWorkspaceSummary(
  projectId: string | undefined,
): Promise<FileSystemWorkspaceSummary | undefined> {
  if (!projectId) {
    return undefined;
  }

  const record = await loadFileSystemWorkspaceRecord(projectId);
  return record ? summarizeWorkspaceRecord(record) : undefined;
}

export async function loadFileSystemWorkspaceHandles(
  projectId: string,
): Promise<{
  projectDirectoryHandle?: FileSystemDirectoryHandle;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
  summary?: FileSystemWorkspaceSummary;
}> {
  const record = await loadFileSystemWorkspaceRecord(projectId);

  return {
    projectDirectoryHandle: record?.projectDirectoryHandle,
    scratchDirectoryHandle: record?.scratchDirectoryHandle,
    summary: record ? summarizeWorkspaceRecord(record) : undefined,
  };
}

export async function loadMostRecentFileSystemWorkspaceHandles(): Promise<{
  projectDirectoryHandle?: FileSystemDirectoryHandle;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
  summary?: FileSystemWorkspaceSummary;
}> {
  const record = selectMostRecentScratchWorkspaceRecord(await loadAllFileSystemWorkspaceRecords());

  return {
    projectDirectoryHandle: record?.projectDirectoryHandle,
    scratchDirectoryHandle: record?.scratchDirectoryHandle,
    summary: record ? summarizeWorkspaceRecord(record) : undefined,
  };
}

export function selectMostRecentScratchWorkspaceRecord<
  TRecord extends {
    scratchDirectoryHandle?: FileSystemDirectoryHandle;
    updatedAt: number;
  },
>(records: TRecord[]): TRecord | undefined {
  return records
    .filter((record) => Boolean(record.scratchDirectoryHandle))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

async function writeTextFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  text: string,
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBlobFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function urlToBlob(url: string, fallbackMimeType?: string): Promise<Blob> {
  const response = await fetch(url);
  const blob = await response.blob();

  if (blob.type || !fallbackMimeType) {
    return blob;
  }

  return new Blob([blob], { type: fallbackMimeType });
}

async function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timeout opening local filesystem workspace database.'));
    }, 3000);

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      clearTimeout(timeoutId);
      reject(request.error ?? new Error('Failed to open the filesystem workspace database.'));
    };

    request.onblocked = () => {
      clearTimeout(timeoutId);
      console.warn('IndexedDB database open is blocked.');
      reject(new Error('IndexedDB database open is blocked by another connection.'));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
      }
    };

    request.onsuccess = () => {
      clearTimeout(timeoutId);
      resolve(request.result);
    };
  });
}

async function loadFileSystemWorkspaceRecord(projectId: string): Promise<FileSystemWorkspaceRecord | undefined> {
  const database = await openWorkspaceDatabase();
  const result = await new Promise<FileSystemWorkspaceRecord | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(projectId);

    request.onsuccess = () => resolve(request.result as FileSystemWorkspaceRecord | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to load local folder handles for this project.'));
  });

  database.close();
  return result;
}

async function loadAllFileSystemWorkspaceRecords(): Promise<FileSystemWorkspaceRecord[]> {
  const database = await openWorkspaceDatabase();
  const result = await new Promise<FileSystemWorkspaceRecord[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve((request.result as FileSystemWorkspaceRecord[] | undefined) ?? []);
    request.onerror = () =>
      reject(transaction.error ?? request.error ?? new Error('Failed to load local folder handles.'));
  });

  database.close();
  return result;
}

function summarizeWorkspaceRecord(record: FileSystemWorkspaceRecord): FileSystemWorkspaceSummary {
  return {
    projectId: record.projectId,
    projectDirectoryName: record.projectDirectoryName ?? record.projectDirectoryHandle?.name,
    scratchDirectoryName: record.scratchDirectoryName ?? record.scratchDirectoryHandle?.name,
    hasProjectDirectory: Boolean(record.projectDirectoryHandle),
    hasScratchDirectory: Boolean(record.scratchDirectoryHandle),
  };
}
