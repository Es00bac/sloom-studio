// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppClassicMenuBar } from './AppClassicMenuBar';
import { buildAppMenuGroups } from '../../lib/appMenuModel';

describe('AppClassicMenuBar', () => {
  let container: HTMLDivElement;
  let root: Root;
  const groups = buildAppMenuGroups('image', {});

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders one top-level button per menu group', () => {
    act(() => {
      root.render(
        <AppClassicMenuBar groups={groups} onCommand={() => undefined} onSwitchToCompact={() => undefined} />,
      );
    });

    const bar = container.querySelector('[data-app-classic-menu-bar="true"]');
    expect(bar).not.toBeNull();
    for (const group of groups) {
      const button = container.querySelector(`[data-menu-group="${group.id}"]`);
      expect(button?.textContent).toBe(group.label);
    }
  });

  it('opens only the clicked group\'s dropdown and dispatches the item command', () => {
    const onCommand = vi.fn();
    act(() => {
      root.render(
        <AppClassicMenuBar groups={groups} onCommand={onCommand} onSwitchToCompact={() => undefined} />,
      );
    });

    const firstGroup = groups[0];
    const firstItem = firstGroup.items[0];

    // No dropdown until a label is clicked.
    expect(document.body.querySelector('[data-menu-group-dropdown]')).toBeNull();

    const groupButton = container.querySelector<HTMLButtonElement>(`[data-menu-group="${firstGroup.id}"]`);
    act(() => {
      groupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Exactly this group's dropdown is open (portaled to <body>).
    const dropdowns = document.body.querySelectorAll('[data-menu-group-dropdown]');
    expect(dropdowns).toHaveLength(1);
    expect(dropdowns[0]?.getAttribute('data-menu-group-dropdown')).toBe(firstGroup.id);

    const itemButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (button) => button.textContent?.includes(firstItem.label),
    );
    expect(itemButton).toBeTruthy();
    act(() => {
      itemButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCommand).toHaveBeenCalledWith(firstItem.command);
    // Selecting an item closes the menu.
    expect(document.body.querySelector('[data-menu-group-dropdown]')).toBeNull();
  });

  it('switches back to the compact menu via the trailing control', () => {
    const onSwitchToCompact = vi.fn();
    act(() => {
      root.render(
        <AppClassicMenuBar groups={groups} onCommand={() => undefined} onSwitchToCompact={onSwitchToCompact} />,
      );
    });

    const switchButton = container.querySelector<HTMLButtonElement>('[data-app-menu-style-switch="compact"]');
    expect(switchButton).not.toBeNull();
    act(() => {
      switchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSwitchToCompact).toHaveBeenCalledTimes(1);
  });
});
