// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CompactToolbarMenu } from './CompactToolbarMenu';

describe('CompactToolbarMenu', () => {
  it('opens a viewport-safe portal and dispatches one checked menu item', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    const onSelect = vi.fn();
    act(() => {
      root = createRoot(host);
      root.render(
        <CompactToolbarMenu
          icon={<span>V</span>}
          items={[{ id: 'guides', label: 'Guides', active: true, onSelect }]}
          label="View"
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>('[data-compact-toolbar-menu="View"]')?.click());
    const popup = document.body.querySelector<HTMLElement>('[data-compact-toolbar-menu-popup="View"]');
    expect(popup).not.toBeNull();
    expect(popup?.className).toContain('fixed');
    expect(popup?.textContent).toContain('Guides');
    act(() => popup?.querySelector<HTMLButtonElement>('button')?.click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-compact-toolbar-menu-popup="View"]')).toBeNull();

    act(() => root?.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('focuses the menu and supports arrow-key navigation before restoring trigger focus on Escape', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    act(() => {
      root = createRoot(host);
      root.render(
        <CompactToolbarMenu
          icon={<span>P</span>}
          items={[
            { id: 'pages', label: 'Pages', onSelect: vi.fn() },
            { id: 'layers', label: 'Layers', onSelect: vi.fn() },
          ]}
          label="Panels"
        />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-compact-toolbar-menu="Panels"]');
    act(() => trigger?.click());
    await act(async () => { await Promise.resolve(); });

    const options = [...document.body.querySelectorAll<HTMLButtonElement>('[data-compact-toolbar-menu-popup="Panels"] button')];
    expect(document.activeElement).toBe(options[0]);
    act(() => options[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' })));
    expect(document.activeElement).toBe(options[1]);
    act(() => options[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(document.activeElement).toBe(trigger);
    expect(document.body.querySelector('[data-compact-toolbar-menu-popup="Panels"]')).toBeNull();

    act(() => root?.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
