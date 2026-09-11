// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument } from '../../types/imageEditor';
import { ImageFrameAnimationPanel } from './ImageFrameAnimationPanel';

function mountedDocument(animation: unknown): ImageDocument {
  return {
    ...createEmptyImageDocument({ id: 'mounted-animation', title: 'Mounted animation', width: 8, height: 8 }),
    metadata: { animation } as ImageDocument['metadata'],
  };
}

describe('MH-064 mounted hostile animation probes', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      animationPlayback: null,
    });
  });

  it('mounts a malformed reopened record as one safe frame and keeps Play disabled', () => {
    const malformed = mountedDocument({
      version: 1,
      frameRate: 12,
      currentFrameId: 'missing',
      onionSkin: { enabled: true },
      frames: [{ id: 'frame-1' }],
    });
    act(() => useImageEditorStore.getState().openDocument(malformed));
    act(() => root.render(<ImageFrameAnimationPanel />));

    expect(container.textContent).toContain('1 frames');
    const play = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle animation playback"]');
    expect(play?.disabled).toBe(true);
    expect(container.textContent).toContain('Onion skin enabled (previous 28% / next 16%)');
  });

  it('adds promptly from a mounted hostile numeric id without producing Infinity', () => {
    const hostile = mountedDocument({
      version: 1,
      frameRate: 12,
      currentFrameId: `frame-${'9'.repeat(320)}`,
      onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
      frames: [{
        id: `frame-${'9'.repeat(320)}`,
        name: 'Hostile',
        durationMs: 1000 / 12,
        layerVisibility: {},
      }],
    });
    act(() => useImageEditorStore.getState().openDocument(hostile));
    act(() => root.render(<ImageFrameAnimationPanel />));

    const add = container.querySelector<HTMLButtonElement>('button[aria-label="Add animation frame"]');
    expect(add).not.toBeNull();
    act(() => add?.click());

    const current = useImageEditorStore.getState().getActiveDocument();
    const ids = current?.metadata?.animation?.frames.map((frame) => frame.id) ?? [];
    expect(ids).toContain('frame-2');
    expect(ids.some((id) => id.includes('Infinity'))).toBe(false);
  });
});
