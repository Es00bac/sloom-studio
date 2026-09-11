import {
  getMediaPreviewTitle,
  getMediaPreviewViewportClassName,
  type MediaPreviewKind,
} from '../../lib/mediaPreview';
import { DockableDialog } from '../DockablePanel';
import { useState } from 'react';

interface MediaPreviewModalProps {
  kind: MediaPreviewKind;
  src: string;
  label?: string;
  onClose: () => void;
}

export function MediaPreviewModal({
  kind,
  src,
  label,
  onClose,
}: MediaPreviewModalProps) {
  const title = getMediaPreviewTitle(kind, label);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const mediaFailed = failedSrc === src;

  return (
    <DockableDialog
      bodyClassName="min-h-0 flex-1 overflow-auto p-3"
      defaultFloatingRect={{ x: 148, y: 88, width: 860, height: 620 }}
      dialogId={`media-preview-${kind}`}
      minSize={{ width: 320, height: 240 }}
      onClose={onClose}
      open
      title={title}
      workspaceId="app-dialogs"
    >
      <div className="min-h-full rounded-2xl border border-gray-700/70 bg-[#0f131b] p-3 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">{title}</div>
            <div className="text-[11px] text-gray-500">Preview capped around 720p for fast inspection.</div>
          </div>
        </div>
        <div className="flex items-center justify-center rounded-xl bg-black p-2">
          {mediaFailed ? (
            <div className="flex min-h-[220px] w-full items-center justify-center rounded-lg border border-red-400/30 bg-red-500/10 px-4 text-center text-sm text-red-100">
              Preview unavailable. The source file may be missing or empty.
            </div>
          ) : kind === 'image' ? (
            <img
              alt={title}
              className={`${getMediaPreviewViewportClassName()} h-auto w-auto object-contain`}
              onError={() => setFailedSrc(src)}
              src={src}
            />
          ) : (
            <video
              className={`${getMediaPreviewViewportClassName()} h-auto w-auto object-contain`}
              controls
              onError={() => setFailedSrc(src)}
              src={src}
            />
          )}
        </div>
      </div>
    </DockableDialog>
  );
}
