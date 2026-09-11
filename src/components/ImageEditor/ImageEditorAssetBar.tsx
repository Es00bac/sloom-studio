import { useMemo, useRef, useState } from 'react';
import { useFlowStore } from '../../store/flowStore';
import { useEditorStore } from '../../store/editorStore';
import { useSourceBinStore, type SourceBinLibraryItem } from '../../store/sourceBinStore';
import { useFlowWorkspaceStore } from '../../store/flowWorkspaceStore';
import { useConfirmationStore } from '../../store/confirmationStore';
import { showAlertDialog } from '../../store/alertDialogStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  buildImageDocumentExportLabel,
  getImageExportFormat,
  imageDocumentToDataUrl,
  selectionMaskToDataUrl,
} from './ImageDocumentExport';
import {
  IMAGE_DOCUMENT_SAVE_FORMATS,
  getVisibleImageSaveFormats,
  imageDocumentToSaveBlob,
  readStoredImageDocumentSaveMimeType,
  writeStoredImageDocumentSaveMimeType,
} from './ImageDocumentSave';
import { getSelection } from './selectionRegistry';
import {
  buildFlowNodePatchForSourceBinItem,
  getFlowNodeTypeForSourceBinItem,
} from '../../lib/sourceBinFlowBridge';
import {
  searchFreeImageResources,
  type FreeImageResource,
} from '../../lib/freeResourceSearch';
import { buildDownloadFilename, downloadBlob } from '../../lib/downloadAsset';
import {
  psdArrayBufferToImageDocument,
} from './ImagePsdInterop';
import {
  createImageDocumentFromSourceItem,
  createSourceBackedImageDocumentShell,
} from './ImageSourceDocument';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { postWorkspaceWindowCommand } from '../../lib/workspaceWindowCommands';

interface ImageEditorAssetBarProps {
  getNewFlowNodePosition: () => { x: number; y: number };
}

type ExportAction = 'source' | 'flow' | 'video' | 'mask' | 'open' | 'download' | 'psd-import';

export function ImageEditorAssetBar({ getNewFlowNodePosition }: ImageEditorAssetBarProps) {
  const bins = useSourceBinStore((s) => s.bins);
  const sourceBinItems = useMemo(
    () => bins.flatMap((bin) => bin.items).filter((item) => item.kind === 'image'),
    [bins],
  );
  const getActiveDocument = useImageEditorStore((s) => s.getActiveDocument);
  const openDocument = useImageEditorStore((s) => s.openDocument);
  const markDocumentClean = useImageEditorStore((s) => s.markDocumentClean);
  const addAssetItem = useSourceBinStore((s) => s.addAssetItem);
  const addNode = useFlowStore((s) => s.addNode);
  const patchNodeData = useFlowStore((s) => s.patchNodeData);
  const setWorkspaceView = useEditorStore((s) => s.setWorkspaceView);
  const setSourceBinTab = useEditorStore((s) => s.setSourceBinTab);
  const setSelectedSourceItemId = useEditorStore((s) => s.setSelectedSourceItemId);
  const activeFlowSourceBinId = useEditorStore((s) => s.activeFlowSourceBinId);
  const activeFlowWorkspaceId = useFlowWorkspaceStore((state) => state.activeWorkspaceId);
  const [activeExportAction, setActiveExportAction] = useState<ExportAction | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [exportMimeType, setExportMimeType] = useState('image/png');
  const [saveMimeType, setSaveMimeType] = useState(readStoredImageDocumentSaveMimeType);
  const [resourceQuery, setResourceQuery] = useState('');
  const [resourceResults, setResourceResults] = useState<FreeImageResource[]>([]);
  const [resourceSearching, setResourceSearching] = useState(false);
  const [importingResourceId, setImportingResourceId] = useState<string | null>(null);
  const psdFileInputRef = useRef<HTMLInputElement | null>(null);

  const saveActiveDocumentToSourceBin = async (targetBinId?: string): Promise<SourceBinLibraryItem | undefined> => {
    const doc = getActiveDocument();
    if (!doc) {
      await showAlertDialog({
        title: 'No Image Document',
        message: 'Open an image document before exporting.',
        tone: 'warning',
      });
      return undefined;
    }

    const currentItems = useSourceBinStore.getState().getAllItems();
    const sourceItem = doc.sourceBinItemId
      ? currentItems.find((item) => item.id === doc.sourceBinItemId)
      : undefined;

    let saveOver = false;
    if (doc.sourceBinItemId && sourceItem) {
      saveOver = await useConfirmationStore.getState().requestConfirmation(
        `Would you like to overwrite the existing source library item "${sourceItem.label}"?\n\n` +
        `Click OK to Save Over, or Cancel to Save a Copy.`,
        'Overwrite Existing Asset'
      );
    }

    const label = buildImageDocumentExportLabel({
      doc,
      sourceLabel: sourceItem?.label,
      existingItems: currentItems,
      suffix: 'edit',
    });
    const exportFormat = getImageExportFormat(exportMimeType);
    const dataUrl = await imageDocumentToDataUrl(doc, exportFormat.mimeType);

    let item: SourceBinLibraryItem;
    if (saveOver && doc.sourceBinItemId) {
      item = await useSourceBinStore.getState().updateAssetItemData(doc.sourceBinItemId, {
        label: sourceItem?.label,
        mimeType: exportFormat.mimeType,
        dataUrl,
      });
      setStatusMessage(`Overwrote "${item.label}" in the Source Bin.`);
    } else {
      item = await addAssetItem({
        label,
        kind: 'image',
        mimeType: exportFormat.mimeType,
        dataUrl,
      }, targetBinId);
      setStatusMessage(`Saved "${item.label}" to the Source Bin.`);
    }

    return item;
  };

  const runExportAction = async (
    action: ExportAction,
    callback: () => Promise<void>,
  ) => {
    if (activeExportAction) return;
    setActiveExportAction(action);
    setStatusMessage(null);
    try {
      await callback();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The image export failed.';
      setStatusMessage(message);
      await showAlertDialog({
        title: 'Image Export Failed',
        message,
        tone: 'danger',
      });
    } finally {
      setActiveExportAction(null);
    }
  };

  const handleSaveToSourceBin = () => {
    void runExportAction('source', async () => {
      await saveActiveDocumentToSourceBin();
    });
  };

  const handleDownloadFile = () => {
    void runExportAction('download', async () => {
      const doc = getActiveDocument();
      if (!doc) {
        await showAlertDialog({
          title: 'No Image Document',
          message: 'Open an image document before downloading.',
          tone: 'warning',
        });
        return;
      }

      const { blob, format } = await imageDocumentToSaveBlob(doc, saveMimeType);
      downloadBlob(blob, buildDownloadFilename(doc.title || 'image-document', format.mimeType, format.extension));
      if (format.kind === 'layered') markDocumentClean(doc.id);
      setStatusMessage(`Downloaded "${doc.title}" as ${format.label}.`);
    });
  };

  const handleExportMask = () => {
    void runExportAction('mask', async () => {
      const doc = getActiveDocument();
      if (!doc) {
        await showAlertDialog({
          title: 'No Image Document',
          message: 'Open an image document before exporting a mask.',
          tone: 'warning',
        });
        return;
      }

      const selection = getSelection(doc.id);
      if (!selection) {
        await showAlertDialog({
          title: 'No Selection',
          message: 'Create a selection before exporting a mask.',
          tone: 'warning',
        });
        return;
      }

      const currentItems = useSourceBinStore.getState().getAllItems();
      const sourceItem = doc.sourceBinItemId
        ? currentItems.find((item) => item.id === doc.sourceBinItemId)
        : undefined;
      const label = buildImageDocumentExportLabel({
        doc,
        sourceLabel: sourceItem?.label,
        existingItems: currentItems,
        suffix: 'mask',
      });
      const dataUrl = await selectionMaskToDataUrl(selection);
      const item = await addAssetItem({
        label,
        kind: 'image',
        mimeType: 'image/png',
        dataUrl,
      });
      setStatusMessage(`Saved "${item.label}" mask to the Source Bin.`);
    });
  };

  const handleSendToFlow = () => {
    void runExportAction('flow', async () => {
      const item = await saveActiveDocumentToSourceBin(activeFlowSourceBinId);
      if (!item) return;
      const bridge = getSignalLoomNativeBridge();
      if (bridge?.openWorkspaceWindow) {
        await bridge.openWorkspaceWindow('flow');
        window.setTimeout(() => {
          postWorkspaceWindowCommand({
            type: 'flow-create-source-node',
            targetWorkspace: 'flow',
            targetFlowWorkspaceId: activeFlowWorkspaceId,
            targetBinId: activeFlowSourceBinId,
            item,
          });
        }, 200);
      } else {
        const nodeId = addNode(getFlowNodeTypeForSourceBinItem(item), getNewFlowNodePosition());
        patchNodeData(nodeId, buildFlowNodePatchForSourceBinItem(item));
        setWorkspaceView('flow');
      }
    });
  };

  const handleSendToVideo = () => {
    void runExportAction('video', async () => {
      const item = await saveActiveDocumentToSourceBin();
      if (!item) return;
      const bridge = getSignalLoomNativeBridge();
      if (bridge?.openWorkspaceWindow) {
        await bridge.openWorkspaceWindow('editor');
        postWorkspaceWindowCommand({
          type: 'video-select-source-item',
          targetWorkspace: 'editor',
          item,
        });
      } else {
        setSelectedSourceItemId(item.id);
        setSourceBinTab('editorAssets');
        setWorkspaceView('editor');
      }
    });
  };

  const handleOpenAsset = (item: SourceBinLibraryItem) => {
    void runExportAction('source', async () => {
      try {
        openDocument(await createImageDocumentFromSourceItem(item));
        setStatusMessage(`Opened "${item.label}" as an editable image document.`);
      } catch (error) {
        openDocument(createSourceBackedImageDocumentShell(item));
        setStatusMessage(error instanceof Error
          ? `Opened "${item.label}" as a linked image shell; bitmap load failed: ${error.message}`
          : `Opened "${item.label}" as a linked image shell; bitmap load failed.`);
      }
    });
  };

  const handleOpenPsd = () => {
    if (activeExportAction) return;
    psdFileInputRef.current?.click();
  };

  const handlePsdFileSelected = (file: File | undefined) => {
    if (!file) return;

    void runExportAction('psd-import', async () => {
      const doc = psdArrayBufferToImageDocument(await file.arrayBuffer(), {
        id: `psd-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title: stripPsdExtension(file.name),
      });
      openDocument(doc);
      setStatusMessage(`Opened "${doc.title}" as a layered PSD document.`);
    });
  };

  const handleSearchResources = async () => {
    const query = resourceQuery.trim();
    if (!query || resourceSearching) return;

    setResourceSearching(true);
    setStatusMessage(null);
    try {
      const results = await searchFreeImageResources(query, { pageSize: 6 });
      setResourceResults(results);
      setStatusMessage(
        results.length > 0
          ? `Found ${results.length} free Openverse image${results.length === 1 ? '' : 's'}.`
          : 'No Openverse images found for that search.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Free resource search failed.';
      setStatusMessage(message);
    } finally {
      setResourceSearching(false);
    }
  };

  const handleImportResource = async (resource: FreeImageResource) => {
    if (importingResourceId) return;

    setImportingResourceId(resource.id);
    setStatusMessage(null);
    try {
      const item = await addAssetItem({
        label: `${resource.title} (${resource.license})`,
        kind: 'image',
        mimeType: resource.mimeType,
        dataUrl: resource.assetUrl,
        sourceKey: resource.id,
      });
      setStatusMessage(
        `Imported "${item.label}" from ${resource.provider}${resource.creator ? ` by ${resource.creator}` : ''}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The free resource could not be imported.';
      setStatusMessage(message);
    } finally {
      setImportingResourceId(null);
    }
  };

  const buttonLabel = (action: ExportAction, label: string) =>
    activeExportAction === action ? 'Working...' : label;
  const isBusy = Boolean(activeExportAction);

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-t border-cyan-300/10 bg-[#1a1b23] px-4 py-1.5">
      <span className="shrink-0 text-xs text-cyan-100/50">Source Assets:</span>
      {sourceBinItems.slice(0, 5).map((item) => (
        <button
          key={item.id}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-300/10 bg-[#252630] text-[9px] text-cyan-100/50 hover:border-cyan-400 hover:text-white"
          onClick={() => handleOpenAsset(item)}
          title={item.label}
          type="button"
        >
          img
        </button>
      ))}
      <input
        accept=".psd,.psb,image/vnd.adobe.photoshop,application/octet-stream"
        className="hidden"
        onChange={(event) => {
          handlePsdFileSelected(event.target.files?.[0]);
          event.target.value = '';
        }}
        ref={psdFileInputRef}
        type="file"
      />
      <button
        className="h-8 shrink-0 rounded-md border border-cyan-300/10 bg-[#252630] px-2 text-[11px] text-cyan-100/60 hover:border-cyan-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isBusy}
        onClick={handleOpenPsd}
        title="Open layered Photoshop PSD"
        type="button"
      >
        Open PSD
      </button>

      <div className="flex shrink-0 items-center gap-1 rounded-md border border-cyan-300/10 bg-[#10131b] px-1.5 py-1">
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/35">Free</span>
        <input
          className="h-6 w-28 rounded border border-cyan-300/10 bg-[#252630] px-1.5 text-xs text-cyan-100/75 placeholder:text-cyan-100/25"
          onChange={(event) => setResourceQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleSearchResources();
            }
          }}
          placeholder="Search"
          value={resourceQuery}
        />
        <button
          className="h-6 rounded bg-cyan-400/15 px-2 text-[11px] text-cyan-100 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={resourceSearching || !resourceQuery.trim()}
          onClick={() => void handleSearchResources()}
          type="button"
        >
          {resourceSearching ? '...' : 'Find'}
        </button>
        {resourceResults.slice(0, 4).map((resource) => (
          <button
            className="h-7 w-10 overflow-hidden rounded border border-cyan-300/10 bg-[#252630] text-[9px] text-cyan-100/40 hover:border-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={Boolean(importingResourceId)}
            key={resource.id}
            onClick={() => void handleImportResource(resource)}
            title={`${resource.title}\n${resource.license}${resource.creator ? `\n${resource.creator}` : ''}`}
            type="button"
          >
            {resource.thumbnailUrl ? (
              <img alt="" className="h-full w-full object-cover" src={resource.thumbnailUrl} />
            ) : (
              'img'
            )}
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {statusMessage ? (
          <div className="truncate text-[11px] text-cyan-100/55" title={statusMessage}>
            {statusMessage}
          </div>
        ) : null}
      </div>

      <select
        className="h-8 shrink-0 rounded-md border border-cyan-300/10 bg-[#252630] px-2 text-xs text-cyan-100/70"
        disabled={isBusy}
        onChange={(event) => setExportMimeType(event.target.value)}
        title="Workflow visible export format"
        value={exportMimeType}
      >
        {getVisibleImageSaveFormats().map((format) => (
          <option key={format.mimeType} value={format.mimeType}>
            {format.label}
          </option>
        ))}
      </select>

      <button
        className="shrink-0 rounded-md bg-[#252630] px-3 py-1 text-xs text-cyan-400 hover:bg-[#2a2b33] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isBusy}
        onClick={handleSaveToSourceBin}
        type="button"
      >
        {buttonLabel('source', 'Export Visible')}
      </button>
      <button
        className="shrink-0 rounded-md bg-[#252630] px-3 py-1 text-xs text-cyan-400 hover:bg-[#2a2b33] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isBusy}
        onClick={handleExportMask}
        type="button"
      >
        {buttonLabel('mask', 'Export Mask')}
      </button>
      <button
        className="shrink-0 rounded-md bg-[#252630] px-3 py-1 text-xs text-cyan-400 hover:bg-[#2a2b33] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isBusy}
        onClick={handleSendToVideo}
        type="button"
      >
        {buttonLabel('video', 'Send to Video')}
      </button>
      <button
        className="shrink-0 rounded-md bg-[#252630] px-3 py-1 text-xs text-cyan-400 hover:bg-[#2a2b33] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isBusy}
        onClick={handleSendToFlow}
        type="button"
      >
        {buttonLabel('flow', 'Send to Flow')}
      </button>
      <div className="flex shrink-0 items-center gap-1 rounded-md border border-cyan-300/10 bg-[#10131b] px-1.5 py-1">
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/35">Save</span>
        <select
          className="h-6 rounded border border-cyan-300/10 bg-[#252630] px-1 text-[11px] text-cyan-100/70"
          disabled={isBusy}
          onChange={(event) => {
            setSaveMimeType(event.target.value);
            writeStoredImageDocumentSaveMimeType(event.target.value);
          }}
          title="Standalone file save format"
          value={saveMimeType}
        >
          {IMAGE_DOCUMENT_SAVE_FORMATS.map((format) => (
            <option key={format.mimeType} value={format.mimeType}>
              {format.label}
            </option>
          ))}
        </select>
        <button
          className="h-6 rounded bg-cyan-400/15 px-2 text-[11px] text-cyan-100 hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={isBusy}
          onClick={handleDownloadFile}
          type="button"
        >
          {buttonLabel('download', 'Download')}
        </button>
      </div>
    </div>
  );
}

function stripPsdExtension(fileName: string): string {
  return fileName.replace(/\.ps[db]$/i, '').trim() || 'Untitled PSD';
}
