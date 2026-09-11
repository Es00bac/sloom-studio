// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayerFilter } from '../../../types/imageEditor';
import { ImageSmartFilterControls } from './ImageSmartFilterControls';

describe('ImageSmartFilterControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mounts the shared-source controls and sends a stack edit through one callback', () => {
    const onChange = vi.fn();
    const filters: ImageLayerFilter[] = [{
      id: 'blur', kind: 'blur', enabled: true, amount: 8, opacity: 1, blendMode: 'normal',
    }];
    act(() => {
      root.render(
        <ImageSmartFilterControls
          filters={filters}
          hasDivergentInstances
          instanceCount={2}
          onChange={onChange}
        />,
      );
    });

    expect(container.querySelector('[aria-label="Smart Filters"]')).not.toBeNull();
    expect(container.textContent).toContain('2 shared instances');
    expect(container.textContent).toContain('next Smart Filter edit will synchronize this source in one undo step');
    const toggle = container.querySelector<HTMLInputElement>('input[title="Enable filter"]');
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'blur', enabled: false })]);
  });
});
