import { describe, expect, it } from 'vitest';

import { buildPaperFrameFlowSourceCommand } from './paperFrameFlowBridge';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrame } from '../types/paper';

function sourceItem(id: string): SourceBinLibraryItem {
  return {
    id,
    label: 'Cover panel.png',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: `signal-loom-asset://${id}`,
    createdAt: 1,
  };
}

describe('paper frame flow bridge', () => {
  it('builds a Flow source-node command for an image frame asset', () => {
    const item = sourceItem('source-cover');
    const frame = {
      id: 'frame-1',
      kind: 'image',
      asset: {
        sourceBinItemId: item.id,
        label: item.label,
        kind: 'image',
        mimeType: item.mimeType,
      },
    } as PaperFrame;

    expect(buildPaperFrameFlowSourceCommand(frame, [item], 'workspace-a')).toEqual({
      type: 'flow-create-source-node',
      targetWorkspace: 'flow',
      targetFlowWorkspaceId: 'workspace-a',
      item,
    });
  });

  it('rejects frames that are not backed by a source-library image', () => {
    const textFrame = {
      id: 'text-1',
      kind: 'text',
    } as PaperFrame;

    expect(buildPaperFrameFlowSourceCommand(textFrame, [])).toBeUndefined();
  });
});
