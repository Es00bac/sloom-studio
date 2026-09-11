// @vitest-environment jsdom

import { flushSync } from 'react-dom';
import { createRoot as createClientRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomToolbar } from './BottomToolbar';
import { useSettingsStore } from '../../store/settingsStore';

describe('BottomToolbar Start menu focus behavior (MH-094 verdict repair)', () => {
  const originalLocale = useSettingsStore.getState().locale;
  let tracked: Array<{ container: HTMLElement; unmount: () => void }>;

  beforeEach(() => {
    tracked = [];
    useSettingsStore.getState().setLocale('en');
  });

  afterEach(() => {
    useSettingsStore.getState().setLocale(originalLocale);
    for (const entry of tracked) {
      entry.unmount();
      entry.container.remove();
    }
  });

  const mountToolbar = (
    onInsertStarterTemplate: (id: string) => void,
    onImportNodePack?: () => void,
  ) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createClientRoot(container);
    tracked.push({ container, unmount: () => root.unmount() });
    flushSync(() => root.render(
      <BottomToolbar
        onAddNode={() => undefined}
        onImportNodePack={onImportNodePack}
        onInsertStarterTemplate={onInsertStarterTemplate}
        variant="topbar"
      />,
    ));
    return container;
  };

  const openStartMenu = (container: HTMLElement) => {
    const details = container.querySelector<HTMLDetailsElement>('details[data-starter-template-menu="true"]')!;
    expect(details).not.toBeNull();
    details.open = true;
    return details;
  };

  it('restores focus to the summary trigger when Escape closes the open Start menu', () => {
    const container = mountToolbar(() => undefined);
    const details = openStartMenu(container);
    const summary = details.querySelector<HTMLElement>('summary')!;
    expect(summary).not.toBeNull();

    // Keyboard focus starts deep inside the menu (a template card).
    const card = details.querySelector<HTMLButtonElement>('[data-starter-template-card="text-to-image"]')!;
    card.focus();
    expect(document.activeElement).toBe(card);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync(() => undefined);

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('restores focus to the summary trigger when Escape fires from the gallery search input', () => {
    const container = mountToolbar(() => undefined);
    const details = openStartMenu(container);
    const summary = details.querySelector<HTMLElement>('summary')!;

    const search = details.querySelector<HTMLInputElement>('[data-starter-template-search="true"]')!;
    search.focus();
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync(() => undefined);

    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('restores focus to the summary trigger after inserting a template from the menu', () => {
    const onInsert = vi.fn();
    const container = mountToolbar(onInsert);
    const details = openStartMenu(container);
    const summary = details.querySelector<HTMLElement>('summary')!;

    const card = details.querySelector<HTMLButtonElement>('[data-starter-template-card="local-calculator"]')!;
    card.focus();
    card.click();
    flushSync(() => undefined);

    expect(onInsert).toHaveBeenCalledWith('local-calculator');
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('closes the Start menu and restores summary focus when importing a node pack (MH-097 verdict repair)', () => {
    const onImportNodePack = vi.fn();
    const container = mountToolbar(() => undefined, onImportNodePack);
    const details = openStartMenu(container);
    const summary = details.querySelector<HTMLElement>('summary')!;

    const importButton = details.querySelector<HTMLButtonElement>('[data-import-node-pack="true"]')!;
    expect(importButton).not.toBeNull();
    importButton.focus();
    importButton.click();
    flushSync(() => undefined);

    expect(onImportNodePack).toHaveBeenCalledTimes(1);
    // The native file chooser triggered by onImportNodePack is a separate modal surface;
    // the Start menu must not stay open covering the graph while it's up (Faye Rowan P2).
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});
