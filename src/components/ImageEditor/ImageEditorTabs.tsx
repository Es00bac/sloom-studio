import { useRef, useState } from 'react';
import { X, Plus, FolderOpen, ClipboardPaste, CornerDownLeft, Loader2, RotateCcw } from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  completeLinkedImageDocumentClose,
  describeLinkedEditTarget,
  saveLinkedImageEdit,
} from '../../lib/imageLinkedEdit';
import { showUserNotice } from '../../shared/ui/userNotice';
import {
  finishImageDocumentClose,
  type ImageDocumentCloseDecision,
} from './ImageDocumentClose';
import { ImageDocumentCloseDialog } from './ImageDocumentCloseDialog';

const OPEN_IMAGE_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/tiff',
  'image/x-exr',
  'image/exr',
  'image/svg+xml',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
  '.exr',
  '.svg',
].join(',');

interface ImageEditorTabsProps {
  disabled?: boolean;
  onOpenImageFile?: (file: File) => void | Promise<void>;
  onNewCanvas?: () => void;
  onNewFromClipboard?: () => void | Promise<void>;
}

export function ImageEditorTabs({ disabled = false, onOpenImageFile, onNewCanvas, onNewFromClipboard }: ImageEditorTabsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documents = useImageEditorStore((s) => s.documents);
  const activeDocId = useImageEditorStore((s) => s.activeDocId);
  const setActiveDocument = useImageEditorStore((s) => s.setActiveDocument);
  const closeDocument = useImageEditorStore((s) => s.closeDocument);
  const discardedDocumentRecoveries = useImageEditorStore((s) => s.discardedDocumentRecoveries);
  const restoreDiscardedDocument = useImageEditorStore((s) => s.restoreDiscardedDocument);
  const [linkedBusyDocId, setLinkedBusyDocId] = useState<string | null>(null);
  const [pendingCloseDocId, setPendingCloseDocId] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);

  const activeDoc = documents.find((doc) => doc.id === activeDocId);
  const activeLinkedTarget = describeLinkedEditTarget(activeDoc?.linkedEdit);
  const pendingCloseDocument = documents.find((doc) => doc.id === pendingCloseDocId);
  const latestRecovery = discardedDocumentRecoveries.at(-1);

  const runLinkedAction = (docId: string, action: () => Promise<unknown>, failure: string) => {
    if (linkedBusyDocId) return;
    setLinkedBusyDocId(docId);
    void action()
      .catch((error: unknown) => {
        showUserNotice(error instanceof Error ? error.message : failure, 'error');
      })
      .finally(() => setLinkedBusyDocId(null));
  };

  const requestDocumentClose = (docId: string) => {
    if (closeBusy || pendingCloseDocId) return;
    const document = useImageEditorStore.getState().documents.find((candidate) => candidate.id === docId);
    if (!document) return;
    if (!document.dirty) {
      closeDocument(document.id);
      void completeLinkedImageDocumentClose(document.linkedEdit);
      return;
    }
    setPendingCloseDocId(document.id);
  };

  const decideDocumentClose = (decision: ImageDocumentCloseDecision) => {
    if (closeBusy) return;
    if (decision === 'cancel') {
      setPendingCloseDocId(null);
      return;
    }
    const document = useImageEditorStore.getState().documents.find((candidate) => candidate.id === pendingCloseDocId);
    if (!document) {
      setPendingCloseDocId(null);
      return;
    }
    if (!document.dirty) {
      setPendingCloseDocId(null);
      closeDocument(document.id);
      void completeLinkedImageDocumentClose(document.linkedEdit);
      return;
    }
    setCloseBusy(true);
    void finishImageDocumentClose(document, decision)
      .then((outcome) => {
        if (outcome === 'saved') setPendingCloseDocId(null);
      })
      .catch((error: unknown) => {
        showUserNotice(
          error instanceof Error ? error.message : 'The editable image document could not be saved.',
          'error',
        );
      })
      .finally(() => setCloseBusy(false));
  };

  return (
    <div className="flex h-8 items-center border-b border-cyan-300/10 bg-[#14151d]">
      <input
        accept={OPEN_IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void onOpenImageFile?.(file);
        }}
        ref={fileInputRef}
        type="file"
      />
      {onNewCanvas && (
        <button
          aria-label="Create new canvas"
          className="flex h-full items-center px-3 text-cyan-100/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 border-r border-cyan-300/10"
          disabled={disabled}
          onClick={onNewCanvas}
          title="Create new canvas"
          type="button"
        >
          <Plus size={14} />
        </button>
      )}
      {latestRecovery ? (
        <button
          aria-label={`Restore discarded Image document ${latestRecovery.snapshot.title}`}
          className="flex h-full items-center border-r border-cyan-300/10 px-3 text-amber-200/60 transition-colors hover:bg-amber-300/5 hover:text-amber-100"
          onClick={() => void restoreDiscardedDocument(latestRecovery.id)}
          title={`Restore discarded “${latestRecovery.snapshot.title}”`}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={13} />
        </button>
      ) : null}
      <button
        aria-label="Open image file"
        className="flex h-full items-center px-3 text-cyan-100/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 border-r border-cyan-300/10"
        disabled={disabled || !onOpenImageFile}
        onClick={() => fileInputRef.current?.click()}
        title="Open image file"
        type="button"
      >
        <FolderOpen size={14} />
      </button>
      {onNewFromClipboard && (
        <button
          aria-label="New image from clipboard"
          className="flex h-full items-center px-3 text-cyan-100/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 border-r border-cyan-300/10"
          disabled={disabled}
          onClick={() => void onNewFromClipboard()}
          title="New image from clipboard"
          type="button"
        >
          <ClipboardPaste size={14} />
        </button>
      )}
      {documents.map((doc) => (
        <div
          key={doc.id}
          className={`flex h-full cursor-pointer items-center gap-2 border-r border-cyan-300/10 px-3 text-xs ${
            doc.id === activeDocId
              ? 'bg-[#1a1b23] text-cyan-100'
              : 'text-cyan-100/50 hover:bg-[#1a1b23]/50'
          }`}
          onClick={() => setActiveDocument(doc.id)}
        >
          <span className="flex items-center gap-1">
            {doc.dirty && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />}
            {doc.title}
          </span>
          <button
            aria-label={`Close ${doc.title}`}
            className="text-cyan-100/30 hover:text-white"
            disabled={closeBusy || linkedBusyDocId !== null}
            onClick={(e) => {
              e.stopPropagation();
              requestDocumentClose(doc.id);
            }}
            title="Close"
            type="button"
          >
            {linkedBusyDocId === doc.id ? <Loader2 className="animate-spin" size={12} /> : <X size={12} />}
          </button>
        </div>
      ))}
      {activeDoc && activeLinkedTarget ? (
        <button
          className="ml-auto mr-2 flex h-6 shrink-0 items-center gap-1.5 rounded border border-cyan-400/40 bg-cyan-500/15 px-2.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || linkedBusyDocId !== null || !activeDoc.dirty}
          onClick={() => runLinkedAction(
            activeDoc.id,
            () => saveLinkedImageEdit(activeDoc),
            `Could not save the edit back to ${activeLinkedTarget}.`,
          )}
          title={`Apply this edit back to ${activeLinkedTarget} and keep working here`}
          type="button"
        >
          {linkedBusyDocId === activeDoc.id
            ? <Loader2 className="animate-spin" size={12} />
            : <CornerDownLeft size={12} />}
          Save &amp; Return to {activeLinkedTarget}
        </button>
      ) : null}
      {pendingCloseDocument ? (
        <ImageDocumentCloseDialog
          busy={closeBusy}
          documentTitle={pendingCloseDocument.title}
          onDecision={decideDocumentClose}
        />
      ) : null}
    </div>
  );
}
