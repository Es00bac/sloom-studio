import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { ImageDocument } from '../types/imageEditor';
import {
  createImageDocumentFromSourceItem,
  createSourceBackedImageDocumentShell,
} from '../components/ImageEditor/ImageSourceDocument';
import { getSignalLoomNativeBridge } from './nativeApp';
import { canOpenSourceLibraryItemInImageWorkspace } from './sourceLibraryWorkspaceActions';
import { showAlertDialog } from '../store/alertDialogStore';

export type SourceLibraryImageOpenResult = 'opened' | 'shell' | 'unsupported';

interface OpenSourceLibraryImageDocumentOptions {
  item: SourceBinLibraryItem;
  openDocument: (doc: ImageDocument) => void;
  createDocument?: (item: SourceBinLibraryItem) => Promise<ImageDocument>;
  createShell?: (item: SourceBinLibraryItem) => ImageDocument;
  onStatus?: (message: string) => void;
  alertOnFailure?: boolean;
  openWorkspaceWindow?: (workspaceId: 'image') => void | Promise<void>;
}

export async function openSourceLibraryImageDocument({
  item,
  openDocument,
  createDocument = createImageDocumentFromSourceItem,
  createShell = createSourceBackedImageDocumentShell,
  onStatus,
  alertOnFailure = false,
  openWorkspaceWindow = openImageWorkspaceWindow,
}: OpenSourceLibraryImageDocumentOptions): Promise<SourceLibraryImageOpenResult> {
  if (!canOpenSourceLibraryItemInImageWorkspace(item)) {
    onStatus?.('Drop an image Source Library item with a stored asset to open it in the Image editor.');
    return 'unsupported';
  }

  onStatus?.(`Opening "${item.label}"...`);
  try {
    const doc = await createDocument(item);
    openDocument(doc);
    onStatus?.(`Opened "${item.label}" as an editable image document.`);
    await openWorkspaceWindow('image');
    return 'opened';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The image source could not be opened as editable pixels.';
    if (alertOnFailure) {
      await showAlertDialog({
        title: 'Open Image Failed',
        message,
        tone: 'danger',
      });
    }
    openDocument(createShell(item));
    onStatus?.(`Opened "${item.label}" as a linked image shell; bitmap load failed: ${message}`);
    await openWorkspaceWindow('image');
    return 'shell';
  }
}

async function openImageWorkspaceWindow(workspaceId: 'image'): Promise<void> {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.openWorkspaceWindow) {
    await bridge.openWorkspaceWindow(workspaceId);
  }
}
