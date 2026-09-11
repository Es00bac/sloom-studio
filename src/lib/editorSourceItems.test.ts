import { describe, expect, it } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import {
  buildEditorSourceItemLookup,
  mapLibraryItemToEditorSourceItem,
} from './editorSourceItems';

function createLibraryItem(
  overrides: Partial<SourceBinLibraryItem> = {},
): SourceBinLibraryItem {
  return {
    id: 'saved-video-1',
    label: 'Generated clip',
    kind: 'video',
    mimeType: 'video/mp4',
    assetId: 'asset-1',
    assetUrl: 'data:video/mp4;base64,AAA',
    createdAt: 1,
    originNodeId: 'video-node-1',
    ...overrides,
  };
}

describe('editor source item mapping', () => {
  it('uses the saved source-bin item id as the timeline source identity', () => {
    const sourceItem = mapLibraryItemToEditorSourceItem(createLibraryItem({
      nativeFilePath: '/media/camera/A001.mp4',
    }));

    expect(sourceItem.id).toBe('saved-video-1');
    expect(sourceItem.nodeId).toBe('saved-video-1');
    expect(sourceItem.assetUrl).toBe('data:video/mp4;base64,AAA');
    expect(sourceItem.nativeFilePath).toBe('/media/camera/A001.mp4');
  });

  it('preserves source-library envelope metadata for Video workspace cards and storyboard references', () => {
    const sourceItem = mapLibraryItemToEditorSourceItem(createLibraryItem({
      envelopeId: 'paper-page-imports:paper-1:page-2',
      envelopeLabel: 'Page 2 imports',
      envelopeIndex: 3,
      envelopeCollapsed: false,
    }));

    expect(sourceItem).toMatchObject({
      envelopeId: 'paper-page-imports:paper-1:page-2',
      envelopeLabel: 'Page 2 imports',
      envelopeIndex: 3,
      envelopeCollapsed: false,
    });
  });

  it('preserves generated/imported classification and storage status for the Video media library', () => {
    expect(mapLibraryItemToEditorSourceItem(createLibraryItem({
      isGenerated: false,
      scratchFileName: 'A001-copy.mov',
      durability: 'recovery-inline',
    }))).toMatchObject({
      isGenerated: false,
      scratchFileName: 'A001-copy.mov',
      durability: 'recovery-inline',
    });

    expect(mapLibraryItemToEditorSourceItem(createLibraryItem({ isGenerated: true })).isGenerated).toBe(true);
  });

  it('keeps legacy origin-node clip references resolvable without overriding stable item ids', () => {
    const newest = createLibraryItem({
      id: 'saved-video-new',
      assetUrl: 'data:video/mp4;base64,NEW',
      originNodeId: 'video-node-1',
      createdAt: 2,
    });
    const older = createLibraryItem({
      id: 'saved-video-old',
      assetUrl: 'data:video/mp4;base64,OLD',
      originNodeId: 'video-node-1',
      createdAt: 1,
    });

    const lookup = buildEditorSourceItemLookup([newest, older]);

    expect(lookup.get('saved-video-new')?.assetUrl).toBe('data:video/mp4;base64,NEW');
    expect(lookup.get('saved-video-old')?.assetUrl).toBe('data:video/mp4;base64,OLD');
    expect(lookup.get('video-node-1')?.assetUrl).toBe('data:video/mp4;base64,NEW');
  });
});
