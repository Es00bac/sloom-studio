/**
 * Linked image edits — the managed round-trip between the Image workspace and the
 * content that owns the pixels:
 *
 *   • a Paper image frame  ("Edit in Image Workspace" on the frame's context menu)
 *   • a Flow .slimg node   (its "Save .slimg & Open" / "Import" actions)
 *
 * A document carrying `linkedEdit` auto-returns when its tab is closed: it is
 * flattened, handed back to its origin (frame asset replaced / .slimg overwritten
 * and the node refreshed), and the view switches back to the origin workspace.
 * "Save & Return" does the same without closing the tab.
 *
 * Multi-window desktop: the origin usually lives in ANOTHER window, so the return
 * rides the workspace-window command bus. Single-window (browser/phone): commands
 * don't loop back to the sender, so the return applies to the local stores directly.
 */
import { imageDocumentToDataUrl } from '../components/ImageEditor/ImageDocumentExport';
import { saveImageDocumentAsSlimg } from '../components/ImageEditor/ImageSlimgCodec';
import {
  createImageDocumentFromSourceItem,
  createSourceBackedImageDocumentShell,
} from '../components/ImageEditor/ImageSourceDocument';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { usePaperStore } from '../store/paperStore';
import { useFlowStore } from '../store/flowStore';
import { useSourceBinStore } from '../store/sourceBinStore';
import { useEditorStore } from '../store/editorStore';
import { getSignalLoomNativeBridge } from './nativeApp';
import { postWorkspaceWindowCommand } from './workspaceWindowCommands';
import type { ImageDocument, ImageDocumentLinkedEdit } from '../types/imageEditor';
import { saveSmartObjectContents } from '../components/ImageEditor/smartObjects/SmartObjectCommands';
import { rerasterizeSmartObjectInstances } from '../components/ImageEditor/smartObjects/SmartObjectRender';
import { renderImageDocumentLayersToBitmap } from '../components/ImageEditor/ImageAdjustmentLayer';
import { sha256Hex } from './slimgV2';

export type LinkedEditTargetWorkspace = 'paper' | 'flow';

export function getLinkedEditTargetWorkspace(
  linkedEdit: ImageDocumentLinkedEdit | undefined,
): LinkedEditTargetWorkspace | undefined {
  if (!linkedEdit) return undefined;
  return linkedEdit.kind === 'paper-frame' ? 'paper' : 'flow';
}

export function describeLinkedEditTarget(linkedEdit: ImageDocumentLinkedEdit | undefined): string | undefined {
  if (!linkedEdit) return undefined;
  return linkedEdit.kind === 'paper-frame' ? 'Paper' : linkedEdit.kind === 'smart-object' ? 'Smart Object' : 'Flow';
}

/** The Source Library item a returning Paper-frame edit becomes (pure — unit tested). */
export function buildPaperLinkedEditReturnItem(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  linkedEdit: Extract<ImageDocumentLinkedEdit, { kind: 'paper-frame' }>,
  dataUrl: string,
  now: number = Date.now(),
): {
  label: string;
  kind: 'image';
  mimeType: string;
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  isGenerated: boolean;
  sourceKey: string;
  originNodeId: string;
} {
  const base = linkedEdit.sourceLabel.replace(/\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i, '').trim() || 'Paper image';
  return {
    label: `${base} (edited).png`,
    kind: 'image',
    mimeType: 'image/png',
    dataUrl,
    pixelWidth: doc.width,
    pixelHeight: doc.height,
    isGenerated: false,
    sourceKey: `paper-linked-edit:${linkedEdit.frameId}:${now}`,
    originNodeId: 'paper-linked-edit',
  };
}

function isMultiWindowDesktop(): boolean {
  return Boolean(getSignalLoomNativeBridge()?.openWorkspaceWindow);
}

/** Deterministic id: re-opening the same source focuses the existing tab instead of duplicating it. */
export function linkedImageDocumentId(itemId: string): string {
  return `linked-${itemId}`;
}

/**
 * Build and open a (linked) image document from a Source Library item in THIS
 * window's store — used directly in single-window mode, and by the Image window
 * when the `image-open-linked-document` command arrives from another window.
 */
export async function openLinkedImageDocumentFromItem(
  item: SourceBinLibraryItem,
  linkedEdit?: ImageDocumentLinkedEdit,
): Promise<void> {
  const id = linkedImageDocumentId(item.id);
  let doc: ImageDocument;
  try {
    doc = await createImageDocumentFromSourceItem(item);
  } catch {
    doc = createSourceBackedImageDocumentShell(item);
  }
  useImageEditorStore.getState().openDocument({
    ...doc,
    id,
    ...(linkedEdit ? { linkedEdit } : {}),
  });
}

async function switchToWorkspace(target: LinkedEditTargetWorkspace): Promise<void> {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.openWorkspaceWindow) {
    await bridge.openWorkspaceWindow(target === 'paper' ? 'paper' : 'flow');
    return;
  }
  useEditorStore.getState().setWorkspaceView(target === 'paper' ? 'paper' : 'flow');
}

async function returnToPaperFrame(
  doc: ImageDocument,
  linkedEdit: Extract<ImageDocumentLinkedEdit, { kind: 'paper-frame' }>,
): Promise<void> {
  const dataUrl = await imageDocumentToDataUrl(doc);
  // Adding locally gives the item a real id and lets the existing source-library
  // sync seams distribute it; the command (or local placement) then binds the frame.
  const item = await useSourceBinStore.getState().addAssetItem(
    buildPaperLinkedEditReturnItem(doc, linkedEdit, dataUrl),
  );

  if (isMultiWindowDesktop()) {
    postWorkspaceWindowCommand({
      type: 'paper-place-source-asset',
      item,
      pageId: linkedEdit.pageId,
      frameId: linkedEdit.frameId,
      targetWorkspace: 'paper',
    });
    return;
  }

  usePaperStore.getState().placeSourceAssetAt({
    item,
    pageId: linkedEdit.pageId,
    targetFrameId: linkedEdit.frameId,
  });
}

/** Refresh every .slimg node bound to `filePath` in the local Flow store. */
export function applySlimgFileUpdateToLocalFlow(filePath: string, flattened: string): number {
  const { nodes, patchNodeData } = useFlowStore.getState();
  let updated = 0;
  for (const node of nodes) {
    if (node.type !== 'slimgNode') continue;
    if (node.data.slimgFilePath !== filePath) continue;
    patchNodeData(node.id, {
      result: flattened,
      statusMessage: 'Updated from the Image workspace.',
      error: undefined,
    });
    updated += 1;
  }
  return updated;
}

async function returnToSlimgNode(
  doc: ImageDocument,
  linkedEdit: Extract<ImageDocumentLinkedEdit, { kind: 'slimg-node' }>,
): Promise<void> {
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.writeImageDocumentFile) {
    throw new Error('Returning a .slimg edit to Flow needs the desktop app.');
  }

  const bytes = await saveImageDocumentAsSlimg(doc);
  const written = await bridge.writeImageDocumentFile(linkedEdit.filePath, bytes);
  if (written?.error) {
    throw new Error(written.error);
  }

  const flattened = await imageDocumentToDataUrl(doc);
  // Local flow copy stays consistent in every mode; other windows get the command.
  applySlimgFileUpdateToLocalFlow(linkedEdit.filePath, flattened);
  if (isMultiWindowDesktop()) {
    postWorkspaceWindowCommand({
      type: 'flow-slimg-file-updated',
      filePath: linkedEdit.filePath,
      flattened,
      targetWorkspace: 'flow',
    });
  }
}

async function returnToSmartObject(doc: ImageDocument, linkedEdit: Extract<ImageDocumentLinkedEdit, { kind: 'smart-object' }>): Promise<void> {
  const store = useImageEditorStore.getState();
  const parent = store.documents.find((candidate) => candidate.id === linkedEdit.parentDocId);
  const source = parent?.metadata?.smartSources?.[linkedEdit.sourceId];
  if (!parent || !source) return;
  const native = renderImageDocumentLayersToBitmap(doc);
  const bytes = new Uint8Array(await (await native.convertToBlob({ type: 'image/png' })).arrayBuffer());
  const currentStore = useImageEditorStore.getState();
  const currentParent = currentStore.documents.find((candidate) => candidate.id === linkedEdit.parentDocId);
  const currentSource = currentParent?.metadata?.smartSources?.[linkedEdit.sourceId];
  if (!currentParent || !currentSource) return;
  const result = saveSmartObjectContents(currentParent, linkedEdit.sourceId, {
    byteLength: bytes.byteLength, sha256: sha256Hex(bytes), mimeType: 'image/png', nativeWidth: doc.width, nativeHeight: doc.height,
    bytesAssetId: undefined, embeddedBytes: bytes, nested: { ...doc, linkedEdit: undefined },
  });
  if (!result.ok) throw result.reason;
  const rerendered = rerasterizeSmartObjectInstances(result.document, linkedEdit.sourceId, native);
  currentStore.setDocumentSmartSources(currentParent.id, rerendered.metadata?.smartSources ?? {});
  currentStore.setLayers(currentParent.id, rerendered.layers, currentParent.activeLayerId);
}

/** Flatten the document and hand the result back to its origin. Does not close or navigate. */
export async function returnLinkedImageEdit(doc: ImageDocument): Promise<LinkedEditTargetWorkspace> {
  const linkedEdit = doc.linkedEdit;
  if (!linkedEdit) {
    throw new Error('This image document is not linked to another workspace.');
  }
  if (linkedEdit.kind === 'paper-frame') {
    await returnToPaperFrame(doc, linkedEdit);
    return 'paper';
  }
  if (linkedEdit.kind === 'smart-object') {
    await returnToSmartObject(doc, linkedEdit);
    return 'flow';
  }
  await returnToSlimgNode(doc, linkedEdit);
  return 'flow';
}

/** "Save & Return": hand the edit back and keep the tab open. Only .slimg preserves layers. */
export async function saveLinkedImageEdit(doc: ImageDocument): Promise<LinkedEditTargetWorkspace> {
  const target = await returnLinkedImageEdit(doc);
  if (doc.linkedEdit?.kind === 'slimg-node') {
    useImageEditorStore.getState().markDocumentClean(doc.id);
  }
  return target;
}

/** Navigate back after a linked tab has been safely closed or explicitly discarded. */
export async function completeLinkedImageDocumentClose(
  linkedEdit: ImageDocumentLinkedEdit | undefined,
): Promise<void> {
  const target = getLinkedEditTargetWorkspace(linkedEdit);
  if (target) {
    await switchToWorkspace(target);
  }
}
