// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../store/settingsStore';
import { StartupInteractionSequence } from './StartupInteractionSequence';

vi.hoisted(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  } satisfies Storage);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function languageGate(): Element | null {
  return document.querySelector('[data-first-run-language-gate]');
}

async function renderSequence(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<StartupInteractionSequence />);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
  useSettingsStore.setState({ settingsHydrated: false, locale: 'en', localeChosen: false, isSettingsOpen: false });
});

afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  window.localStorage.clear();
  useSettingsStore.setState({ settingsHydrated: true, locale: 'en', localeChosen: false, isSettingsOpen: false });
});

describe('StartupInteractionSequence', () => {
  it('renders nothing until persisted settings are hydrated, then the language gate for a fresh profile', async () => {
    await renderSequence();
    expect(languageGate()).toBeNull();
    expect(container?.childElementCount ?? 0).toBe(0);

    await act(async () => {
      useSettingsStore.setState({ settingsHydrated: true });
    });
    expect(languageGate()).not.toBeNull();
  });

  it('shows no startup overlay at all for a returning profile that already chose a language', async () => {
    useSettingsStore.setState({ settingsHydrated: true, localeChosen: true });
    await renderSequence();
    expect(languageGate()).toBeNull();
    expect(container?.childElementCount ?? 0).toBe(0);
  });
});
