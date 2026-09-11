import { describe, expect, it } from 'vitest';
import {
  resolvePaperFrameSelectionMode,
  shouldReplacePaperFrameSelectionForContextMenu,
  shouldTogglePaperFrameSelectionOnModifiedClick,
} from './paperFrameSelection';

describe('Paper frame context-menu selection', () => {
  it('preserves an existing multi-selection when a selected frame is right-clicked', () => {
    expect(shouldReplacePaperFrameSelectionForContextMenu(true)).toBe(false);
  });

  it('selects an unselected frame before opening its context menu', () => {
    expect(shouldReplacePaperFrameSelectionForContextMenu(false)).toBe(true);
  });

  it('uses conventional Shift-add and Ctrl/Cmd-toggle selection semantics', () => {
    expect(resolvePaperFrameSelectionMode({ shiftKey: true })).toBe('add');
    expect(resolvePaperFrameSelectionMode({ ctrlKey: true })).toBe('toggle');
    expect(resolvePaperFrameSelectionMode({ metaKey: true })).toBe('toggle');
    expect(resolvePaperFrameSelectionMode()).toBe('replace');
  });

  it('ignores a trailing modified click from a macOS Ctrl-click context menu', () => {
    expect(shouldTogglePaperFrameSelectionOnModifiedClick({
      modified: true,
      lastContextMenuAt: 1_000,
      now: 1_120,
    })).toBe(false);
    expect(shouldTogglePaperFrameSelectionOnModifiedClick({
      modified: true,
      lastContextMenuAt: 1_000,
      now: 1_700,
    })).toBe(true);
    expect(shouldTogglePaperFrameSelectionOnModifiedClick({
      modified: false,
      lastContextMenuAt: 0,
      now: 1_700,
    })).toBe(false);
  });
});
