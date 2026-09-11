// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '../store/settingsStore';
import { useI18n } from './useI18n';

// A minimal consumer that exercises both lookup modes through the real hook + store, mounted on a
// real (jsdom) DOM so the zustand subscription drives a re-render — the exact path a user triggers
// by changing the Language setting. `flushSync` forces React to commit synchronously (this project
// has no @testing-library/react, and a concurrent root would otherwise defer the commit).
function Probe() {
  const { locale, t, tBoth } = useI18n();
  return (
    <div>
      <span data-role="locale">{locale}</span>
      <span data-role="chrome">{t('paper.view.spreads')}</span>
      <span data-role="jp-term">{tBoth('paper.jp.rtlBinding')}</span>
    </div>
  );
}

function text(container: HTMLElement, role: string): string | null | undefined {
  return container.querySelector(`[data-role="${role}"]`)?.textContent;
}

describe('useI18n (store-driven rendering)', () => {
  const original = useSettingsStore.getState().locale;
  afterEach(() => useSettingsStore.getState().setLocale(original));

  it('re-renders UI chrome into the active language when the setting changes', () => {
    useSettingsStore.getState().setLocale('en');
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Probe />));
    expect(text(container, 'chrome')).toBe('Spreads');

    // Flipping the persisted setting must re-render the mounted component into Japanese.
    flushSync(() => useSettingsStore.getState().setLocale('ja'));
    expect(text(container, 'locale')).toBe('ja');
    expect(text(container, 'chrome')).toBe('見開き');

    flushSync(() => root.unmount());
  });

  it('keeps bilingual typographic terms in both languages regardless of the setting', () => {
    useSettingsStore.getState().setLocale('en');
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Probe />));
    expect(text(container, 'jp-term')).toBe('RTL 右綴じ');

    flushSync(() => useSettingsStore.getState().setLocale('ja'));
    expect(text(container, 'jp-term')).toBe('RTL 右綴じ');

    flushSync(() => root.unmount());
  });
});
