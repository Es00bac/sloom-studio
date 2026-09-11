// Actions behind the .slimg Flow node — a FILE-CENTRIC bridge between Flow and Image (no live in-memory
// sync). Three explicit operations:
//   • saveImageAsSlimg  — capture a connected image into a NEW .slimg (save-as dialog) and open it to edit
//   • importSlimgFromDisk — pick an EXISTING .slimg, open it in Image to edit, and set the node's output
//   • readSlimgFromDisk — (re)read a saved .slimg from disk and flatten it to the output (run after editing)
// Output is always explicit (set by these actions), never auto-synced. Kept free of React/flow-store
// imports so it composes cleanly.
import { createImageDocumentFromFile } from '../components/ImageEditor/ImageSourceDocument';
import { saveImageDocumentAsSlimg, openSlimgDocument } from '../components/ImageEditor/ImageSlimgCodec';
import { imageDocumentToDataUrl } from '../components/ImageEditor/ImageDocumentExport';
import { useImageEditorStore } from '../store/imageEditorStore';
import { useEditorStore } from '../store/editorStore';
import { getSignalLoomNativeBridge } from './nativeApp';
import { downloadBlob, buildWorkspaceDownloadFilename } from '../shared/files/downloads';

export interface SlimgNodeOutput {
  /** Flattened PNG data URL — the node's output for downstream image inputs. */
  flattened: string;
  /** Absolute file path of the .slimg on disk, when known (Electron). */
  filePath?: string;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

function makeSlimgDocId(): string {
  return `slimg-flow-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

/** Capture the connected image as a NEW .slimg (save-as dialog) and open it in Image to edit. */
export async function saveImageAsSlimg(
  inputImageUrl: string,
  title?: string,
): Promise<SlimgNodeOutput | null> {
  const url = inputImageUrl?.trim();
  if (!url) throw new Error('Connect an image to the .slimg node before saving.');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the input image (HTTP ${response.status}).`);
  const blob = await response.blob();
  const mimeType = blob.type || 'image/png';
  const docTitle = title?.trim() || 'Flow Image';
  const file = new File([blob], `${docTitle}.${extensionForMimeType(mimeType)}`, { type: mimeType });

  const doc = await createImageDocumentFromFile(file, { id: makeSlimgDocId() });
  const bytes = await saveImageDocumentAsSlimg(doc);

  const bridge = getSignalLoomNativeBridge();
  let filePath: string | undefined;
  if (bridge?.saveImageDocumentFileAs) {
    const result = await bridge.saveImageDocumentFileAs(bytes);
    if (result?.canceled) return null;
    filePath = result?.path;
  } else {
    downloadBlob(
      new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
      buildWorkspaceDownloadFilename(doc.title, 'slimg'),
    );
  }

  // Linked edit: with a known path, closing the tab in Image (or "Save & Return")
  // overwrites the .slimg and refreshes this node's output automatically.
  if (filePath) {
    doc.linkedEdit = { kind: 'slimg-node', filePath };
  }
  useImageEditorStore.getState().openDocument(doc);
  useEditorStore.getState().setWorkspaceView('image');
  const flattened = await imageDocumentToDataUrl(doc);
  return { flattened, filePath };
}

async function pickSlimgBytes(): Promise<{ bytes: Uint8Array; filePath?: string } | null> {
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.openImageDocumentFile) {
    throw new Error('Reading a .slimg from disk needs the desktop app.');
  }
  const result = await bridge.openImageDocumentFile();
  if (result.canceled || !result.bytes) return null;
  return { bytes: new Uint8Array(result.bytes), filePath: result.path };
}

/** Pick an existing .slimg from disk, open it in Image to edit, and set the node's output. */
export async function importSlimgFromDisk(): Promise<SlimgNodeOutput | null> {
  const picked = await pickSlimgBytes();
  if (!picked) return null;
  const doc = await openSlimgDocument(picked.bytes);
  if (picked.filePath) {
    doc.linkedEdit = { kind: 'slimg-node', filePath: picked.filePath };
  }
  useImageEditorStore.getState().openDocument(doc);
  useEditorStore.getState().setWorkspaceView('image');
  const flattened = await imageDocumentToDataUrl(doc);
  return { flattened, filePath: picked.filePath };
}

/**
 * Re-read the node's OWN saved .slimg (by its known path, no dialog) and flatten it to the output.
 * Run after editing + saving the file in Image to refresh what flows downstream.
 */
export async function readSlimgFromDisk(filePath: string): Promise<SlimgNodeOutput | null> {
  const path = filePath?.trim();
  if (!path) {
    throw new Error('Save or import a .slimg on this node first — then "Read disk" re-reads that file.');
  }
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.readImageDocumentFile) {
    throw new Error('Reading a .slimg by path needs the desktop app.');
  }
  const result = await bridge.readImageDocumentFile(path);
  if (result.error || !result.bytes) {
    throw new Error(result.error || 'Could not read the .slimg file from disk.');
  }
  const doc = await openSlimgDocument(new Uint8Array(result.bytes));
  const flattened = await imageDocumentToDataUrl(doc);
  return { flattened, filePath: path };
}
