// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { ImageBatchFolderRunnerPanel } from './ImageBatchFolderRunnerPanel';

describe('ImageBatchFolderRunnerPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      quickActionMacros: [{
        id: 'macro-cleanup',
        name: 'Cleanup',
        createdAt: 1,
        updatedAt: 1,
        steps: [{ actionId: 'selectCanvas' }],
      }],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests read-write authority through the shared directory picker', async () => {
    const pick = vi.fn(async (options?: { mode?: string }) => {
      expect(options).toEqual({ mode: 'readwrite' });
      return { name: 'approved-output' } as FileSystemDirectoryHandle;
    });
    vi.stubGlobal('showDirectoryPicker', pick);
    act(() => root.render(<ImageBatchFolderRunnerPanel />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Choose batch output folder"]')?.click();
    });

    expect(pick).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Output ready');
  });

  it('surfaces denied output-directory authority instead of silently retaining no access', async () => {
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => {
      throw new Error('Write permission was denied.');
    }));
    act(() => root.render(<ImageBatchFolderRunnerPanel />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Choose batch output folder"]')?.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Write permission was denied.');
  });
});
