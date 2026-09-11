import { useCallback, type DragEvent } from 'react';
import { showAlertDialog } from '../../../store/alertDialogStore';
import type { SourceBinLibraryItem } from '../../../store/sourceBinStore';

interface FlowCanvasDropImportOptions {
  importFiles: (files: File[] | FileList, targetBinId?: string) => Promise<SourceBinLibraryItem[]>;
  onPlaceSourceBinItem: (item: SourceBinLibraryItem, position: { x: number; y: number }) => void;
  onSetLatestImportDuration: (durationMs: number | undefined) => void;
  onShowSourceBin: () => void;
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  sourceBinTargetId?: string;
  sourceBinItems: SourceBinLibraryItem[];
}

export function useFlowCanvasDropImport({
  importFiles,
  onPlaceSourceBinItem,
  onSetLatestImportDuration,
  onShowSourceBin,
  screenToFlowPosition,
  sourceBinTargetId,
  sourceBinItems,
}: FlowCanvasDropImportOptions) {
  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const rawFiles = Array.from(event.dataTransfer.files ?? []);
    const isOsFileDrop = rawFiles.length > 0 || event.dataTransfer.types.includes('Files');

    if (isOsFileDrop && rawFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      void (async () => {
        try {
          const importStartedAt = performance.now();
          const importedItems = await importFiles(rawFiles, sourceBinTargetId);
          onSetLatestImportDuration(Math.round(performance.now() - importStartedAt));
          if (importedItems.length === 0) {
            return;
          }

          onShowSourceBin();
          importedItems.forEach((item, index) => {
            onPlaceSourceBinItem(item, {
              x: position.x + index * 48,
              y: position.y + index * 48,
            });
          });
        } catch (error) {
          await showAlertDialog({
            title: 'Import Media Failed',
            message: error instanceof Error ? error.message : 'The dropped media could not be imported into the Flow workspace.',
            tone: 'danger',
          });
        }
      })();
      return;
    }

    const rawPayload = event.dataTransfer.getData('application/x-flow-source-bin-item');

    if (!rawPayload) {
      return;
    }

    event.preventDefault();

    const { itemId } = JSON.parse(rawPayload) as { itemId?: string };
    const item = sourceBinItems.find((candidate) => candidate.id === itemId);

    if (!item) {
      return;
    }

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onPlaceSourceBinItem(item, position);
  }, [
    importFiles,
    onPlaceSourceBinItem,
    onSetLatestImportDuration,
    onShowSourceBin,
    screenToFlowPosition,
    sourceBinTargetId,
    sourceBinItems,
  ]);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (
      event.dataTransfer.types.includes('application/x-flow-source-bin-item') ||
      event.dataTransfer.types.includes('Files')
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  return {
    handleDrop,
    handleDragOver,
  };
}
