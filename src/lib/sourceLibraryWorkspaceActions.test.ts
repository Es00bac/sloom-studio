import { describe, expect, it } from 'vitest';
import {
  canOpenSourceLibraryItemInImageWorkspace,
  getDraggedSourceLibraryItemId,
  hasDraggedSourceLibraryItem,
  resolveSourceLibraryPrimaryAction,
} from './sourceLibraryWorkspaceActions';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';

function item(kind: SourceBinLibraryItem['kind']): SourceBinLibraryItem {
  return {
    id: `${kind}-1`,
    label: `${kind} item`,
    kind,
    assetUrl: kind === 'text' ? undefined : `blob:${kind}`,
    text: kind === 'text' ? 'Text' : undefined,
    createdAt: Date.now(),
  };
}

describe('sourceLibraryWorkspaceActions', () => {
  it('opens image source items directly in the Image workspace', () => {
    expect(resolveSourceLibraryPrimaryAction('image', item('image'))).toBe('open-image-editor');
    expect(resolveSourceLibraryPrimaryAction('flow', item('image'))).toBe('preview');
    expect(canOpenSourceLibraryItemInImageWorkspace(item('image'))).toBe(true);
    expect(canOpenSourceLibraryItemInImageWorkspace({ ...item('image'), assetUrl: undefined })).toBe(false);
    expect(canOpenSourceLibraryItemInImageWorkspace(item('video'))).toBe(false);
  });

  it('places supported source items in Paper instead of previewing them', () => {
    expect(resolveSourceLibraryPrimaryAction('paper', item('image'))).toBe('place-paper');
    expect(resolveSourceLibraryPrimaryAction('paper', item('text'))).toBe('place-paper');
    expect(resolveSourceLibraryPrimaryAction('paper', item('document'))).toBe('place-paper');
  });

  it('parses dragged Source Library item ids from the shared drag payload', () => {
    expect(hasDraggedSourceLibraryItem({
      types: ['text/plain', 'application/x-flow-source-bin-item'],
    })).toBe(true);
    expect(getDraggedSourceLibraryItemId({
      getData: (type) => type === 'application/x-flow-source-bin-item'
        ? JSON.stringify({ itemId: 'image-1' })
        : '',
    })).toBe('image-1');
  });
});
