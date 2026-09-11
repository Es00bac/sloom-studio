import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrame } from '../types/paper';
import type { WorkspaceWindowCommand } from './workspaceWindowCommands';

export type PaperFrameFlowSourceCommand = Extract<WorkspaceWindowCommand, { type: 'flow-create-source-node' }>;

export function getPaperFrameFlowSourceItem(
  frame: PaperFrame | undefined,
  sourceItems: readonly SourceBinLibraryItem[],
): SourceBinLibraryItem | undefined {
  if (!frame?.asset || frame.kind !== 'image' || frame.asset.kind !== 'image') {
    return undefined;
  }

  return sourceItems.find((item) => item.id === frame.asset?.sourceBinItemId && item.kind === 'image');
}

export function buildPaperFrameFlowSourceCommand(
  frame: PaperFrame | undefined,
  sourceItems: readonly SourceBinLibraryItem[],
  targetFlowWorkspaceId?: string,
  targetBinId?: string,
): PaperFrameFlowSourceCommand | undefined {
  const item = getPaperFrameFlowSourceItem(frame, sourceItems);
  if (!item) {
    return undefined;
  }

  return {
    type: 'flow-create-source-node',
    targetWorkspace: 'flow',
    targetFlowWorkspaceId,
    targetBinId,
    item,
  };
}
