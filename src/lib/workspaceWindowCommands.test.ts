import { beforeEach, describe, expect, it } from 'vitest';

import {
  createWorkspaceWindowCommandEnvelope,
  getWorkspaceWindowCommandForWorkspace,
  mergeSourceBinItemsIntoBins,
  removeSourceBinItemFromBins,
  renameSourceBinItemInBins,
  shouldRunFlowOwnedSourceBinIngest,
} from './workspaceWindowCommands';
import type { SourceBin, SourceBinLibraryItem } from '../store/sourceBinStore';
import { beginProjectAuthorityTransition, setCurrentProjectAuthorityClaim } from './nativeApp';

function item(id: string): SourceBinLibraryItem {
  return {
    id,
    label: id,
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: `data:image/png;base64,${id}`,
    createdAt: 1,
  };
}

function bin(items: SourceBinLibraryItem[], id = 'default'): SourceBin {
  return {
    id,
    name: id,
    items,
    collapsed: false,
    createdAt: 1,
  };
}

describe('workspace window commands', () => {
  beforeEach(() => {
    setCurrentProjectAuthorityClaim({ authorityId: 'authority-test', version: 1 });
  });

  it('rejects a stale workspace command authority before any local workspace mutation', () => {
    const envelope = createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'source-bin-items-added',
      items: [item('stale-image')],
    });
    setCurrentProjectAuthorityClaim({ authorityId: 'authority-new', version: 2 });
    expect(getWorkspaceWindowCommandForWorkspace(envelope, 'sender-image', 'image')).toBeUndefined();
  });

  it('cannot construct a Source-affecting workspace command without exact authority', () => {
    setCurrentProjectAuthorityClaim(undefined);
    expect(() => createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'source-bin-items-added',
      items: [item('claimless-image')],
    })).toThrow(/exact current project authority/);

    setCurrentProjectAuthorityClaim({ authorityId: 'authority-test', version: 1 });
    const endTransition = beginProjectAuthorityTransition();
    expect(() => createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'source-bin-items-added',
      items: [item('half-switched-image')],
    })).toThrow(/exact current project authority/);
    endTransition();
  });

  it('ignores commands from the same renderer and commands for another workspace', () => {
    const ownEnvelope = createWorkspaceWindowCommandEnvelope('sender-a', {
      type: 'source-bin-items-added',
      targetWorkspace: 'paper',
      items: [item('image-1')],
    });
    const otherEnvelope = createWorkspaceWindowCommandEnvelope('sender-b', {
      type: 'source-bin-items-added',
      targetWorkspace: 'image',
      items: [item('image-1')],
    });

    expect(getWorkspaceWindowCommandForWorkspace(ownEnvelope, 'sender-a', 'paper')).toBeUndefined();
    expect(getWorkspaceWindowCommandForWorkspace(otherEnvelope, 'sender-a', 'paper')).toBeUndefined();
    expect(getWorkspaceWindowCommandForWorkspace(otherEnvelope, 'sender-a', 'image')).toEqual(otherEnvelope.command);
  });

  it('routes a plain (non-linked) image-open command to the Image workspace window', () => {
    // Paper page-export opens a flattened page as a standalone document — NOT a linked
    // edit — so the command carries no `linkedEdit` field at all.
    const envelope = createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'image-open-linked-document',
      item: item('exported-page-1'),
      targetWorkspace: 'image',
    });

    const routed = getWorkspaceWindowCommandForWorkspace(envelope, 'sender-image', 'image');
    expect(routed).toEqual(envelope.command);
    expect(routed && 'linkedEdit' in routed ? routed.linkedEdit : undefined).toBeUndefined();
    expect(getWorkspaceWindowCommandForWorkspace(envelope, 'sender-image', 'paper')).toBeUndefined();
  });

  it('routes a linked Paper-frame image-open command, and rejects a malformed linkedEdit', () => {
    const linked = createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'image-open-linked-document',
      item: item('frame-source-1'),
      linkedEdit: { kind: 'paper-frame', pageId: 'page-1', frameId: 'frame-1', sourceLabel: 'panel.png' },
      targetWorkspace: 'image',
    });
    expect(getWorkspaceWindowCommandForWorkspace(linked, 'sender-image', 'image')).toEqual(linked.command);

    const malformed = createWorkspaceWindowCommandEnvelope('sender-paper', {
      type: 'image-open-linked-document',
      item: item('frame-source-2'),
      // @ts-expect-error — intentionally malformed to prove the validator rejects it
      linkedEdit: { kind: 'paper-frame', pageId: 'page-1' },
      targetWorkspace: 'image',
    });
    expect(getWorkspaceWindowCommandForWorkspace(malformed, 'sender-image', 'image')).toBeUndefined();
  });

  it('routes the linked-edit return trip and the .slimg refresh command', () => {
    const returnTrip = createWorkspaceWindowCommandEnvelope('sender-image', {
      type: 'paper-place-source-asset',
      item: item('edited-frame-asset'),
      pageId: 'page-3',
      frameId: 'frame-9',
      targetWorkspace: 'paper',
    });
    expect(getWorkspaceWindowCommandForWorkspace(returnTrip, 'sender-paper', 'paper')).toEqual(returnTrip.command);

    const slimgUpdate = createWorkspaceWindowCommandEnvelope('sender-image', {
      type: 'flow-slimg-file-updated',
      filePath: '/tmp/x.slimg',
      flattened: 'data:image/png;base64,AAAA',
      targetWorkspace: 'flow',
    });
    expect(getWorkspaceWindowCommandForWorkspace(slimgUpdate, 'sender-flow', 'flow')).toEqual(slimgUpdate.command);
  });

  it('merges incoming source-bin items without replacing the local library', () => {
    const current = [bin([item('local-1'), item('local-2')])];
    const next = mergeSourceBinItemsIntoBins(current, [item('remote-1'), item('local-1')]);

    expect(next[0].items.map((sourceItem) => sourceItem.id)).toEqual([
      'remote-1',
      'local-1',
      'local-2',
    ]);
  });

  it('expands the target source bin when incoming items are added', () => {
    const current = [{ ...bin([item('local-1')]), collapsed: true }];
    const next = mergeSourceBinItemsIntoBins(current, [item('remote-1')]);

    expect(next[0].collapsed).toBe(false);
    expect(next[0].items.map((sourceItem) => sourceItem.id)).toEqual(['remote-1', 'local-1']);
  });

  it('keeps the local item reference when an incoming copy is scalar-equal (811 F5)', () => {
    const local = item('local-1');
    const current = [bin([local])];
    // A structurally identical echo (re-broadcast/live-sync) must not churn the local reference.
    const next = mergeSourceBinItemsIntoBins(current, [{ ...local }]);

    expect(next[0].items[0]).toBe(local);
  });

  it('replaces the local item when any scalar field differs (811 F5)', () => {
    const local = item('local-1');
    const current = [bin([local])];
    const renamed = { ...local, label: 'Renamed remotely' };
    const next = mergeSourceBinItemsIntoBins(current, [renamed]);

    expect(next[0].items[0]).toBe(renamed);
  });

  it('skips incoming source-bin items that already exist under the same source key', () => {
    const current = [bin([{ ...item('local-1'), sourceKey: 'image:node-1:asset-a' }])];
    const next = mergeSourceBinItemsIntoBins(current, [
      { ...item('remote-duplicate'), sourceKey: 'image:node-1:asset-a' },
      { ...item('remote-2'), sourceKey: 'image:node-2:asset-b' },
    ]);

    expect(next[0].items.map((sourceItem) => sourceItem.id)).toEqual([
      'remote-2',
      'local-1',
    ]);
  });

  it('replaces existing source-bin items with the same id so asset updates converge', () => {
    const current = [bin([{ ...item('image-1'), label: 'Old panel', assetUrl: 'blob:old' }])];
    const next = mergeSourceBinItemsIntoBins(current, [
      { ...item('image-1'), label: 'New panel', assetUrl: 'blob:new' },
    ]);

    expect(next[0].items).toHaveLength(1);
    expect(next[0].items[0]).toMatchObject({
      id: 'image-1',
      label: 'New panel',
      assetUrl: 'blob:new',
    });
  });

  it('creates a target bin if the command names a missing bin', () => {
    const current = [bin([item('local-1')])];
    const next = mergeSourceBinItemsIntoBins(current, [item('remote-1')], 'incoming');

    expect(next.map((sourceBin) => sourceBin.id)).toEqual(['default', 'incoming']);
    expect(next[1].items.map((sourceItem) => sourceItem.id)).toEqual(['remote-1']);
  });

  it('keeps Flow source-item ingestion owned by the Flow workspace window', () => {
    expect(shouldRunFlowOwnedSourceBinIngest('flow')).toBe(true);
    expect(shouldRunFlowOwnedSourceBinIngest('paper')).toBe(false);
    expect(shouldRunFlowOwnedSourceBinIngest('image')).toBe(false);
    expect(shouldRunFlowOwnedSourceBinIngest('editor')).toBe(false);
  });

  it('applies source-bin item rename commands without losing asset metadata', () => {
    const current = [bin([{ ...item('image-1'), label: 'image_001.png', assetId: 'asset-1' }])];
    const next = renameSourceBinItemInBins(current, 'image-1', '  Cover panel.png  ');

    expect(next[0].items[0]).toEqual(expect.objectContaining({
      id: 'image-1',
      label: 'Cover panel.png',
      assetId: 'asset-1',
      assetUrl: 'data:image/png;base64,image-1',
    }));
  });

  it('applies source-bin item removal commands without replacing other local items', () => {
    const current = [bin([item('image-1'), item('image-2')])];
    const next = removeSourceBinItemFromBins(current, 'image-1');

    expect(next[0].items.map((sourceItem) => sourceItem.id)).toEqual(['image-2']);
  });
});
